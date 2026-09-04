/**
 * Note Management for Background Service Worker
 */

import { Note } from '../types';
import { getSettings, loadPromptSection, requestAiCompletion, parseLooseJson } from './index';
import { canonicalXiaoyuzhouUrl } from '../shared/domain';
import { handleFetchTranscript } from './transcription';

const NOTES_STORAGE_KEY = 'xyz_notes';

// ============================================================
// HELPERS
// ============================================================

function normalizeStoredNotes(value: unknown): Note[] {
  return Array.isArray(value)
    ? value.filter((note): note is Note => note && typeof note === 'object')
    : [];
}

function sortNotesNewestFirst(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => {
    const leftTime = Number(a?.createdAt) || 0;
    const rightTime = Number(b?.createdAt) || 0;
    return rightTime - leftTime;
  });
}

async function saveNoteToStorage(note: Note): Promise<void> {
  const result = await chrome.storage.local.get(NOTES_STORAGE_KEY);
  const notes = normalizeStoredNotes(result[NOTES_STORAGE_KEY]);
  await chrome.storage.local.set({
    [NOTES_STORAGE_KEY]: sortNotesNewestFirst([note, ...notes]),
  });
}

// ============================================================
// NOTE TEXT CLEANUP (AI-powered)
// ============================================================

async function cleanupNoteText(
  targetText: string,
  beforeText: string,
  afterText: string,
  fullContext: string,
  videoTitle: string
): Promise<string> {
  const settings = await getSettings();

  if (!settings.aiApiKey) {
    return [beforeText, targetText, afterText].filter(Boolean).join(' ');
  }

  try {
    const variables: Record<string, string> = {
      videoTitle: videoTitle || '未知标题',
      fullContext,
      beforeText: beforeText || '（无）',
      targetText,
      afterText: afterText || '（无）',
    };

    const systemPrompt = await loadPromptSection('note-cleanup.md', 'System prompt', variables);
    const userPrompt = await loadPromptSection('note-cleanup.md', 'User prompt', variables);

    const { text: resultText } = await requestAiCompletion({
      maxTokens: 512,
      responseFormat: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    let result = resultText.trim() || targetText;

    try {
      const parsed = parseLooseJson(result);
      const parsedObj = parsed as Record<string, unknown>;
      if (typeof parsedObj?.quote === 'string' && parsedObj.quote.trim()) {
        return parsedObj.quote.trim().slice(0, 3000);
      }
    } catch (parseError) {
      console.warn('[小宇宙 Digest v2.0] JSON parse failed for note:', parseError);
      result = result.replace(/^(以下是?)?(润色后(的)?(文本|内容)?[：:]?\s*)/i, '');
      result = result.replace(/^["']|["']$/g, '');
    }

    return result.slice(0, 3000);
  } catch (e) {
    console.error('[小宇宙 Digest v2.0] Cleanup error:', e);
    return [beforeText, targetText, afterText].filter(Boolean).join(' ');
  }
}

// ============================================================
// PUBLIC API
// ============================================================

export async function handleSaveNote(
  videoId: string,
  timestamp: number,
  videoTitle: string,
  channelName: string
): Promise<{ success: boolean; note?: Note; error?: string }> {
  try {
    const canonicalVideoUrl = canonicalXiaoyuzhouUrl(videoId);
    const safeTimestamp = Math.max(0, Math.floor(Number(timestamp) || 0));

    let transcript: TranscriptSentence[] | null = null;

    try {
      const cached = await chrome.storage.local.get(`digest_${videoId}`);
      if ((cached as Record<string, unknown>)?.[`digest_${videoId}`]) {
        const digest = (cached as Record<string, Record<string, unknown>>)[`digest_${videoId}`];
        transcript = digest.transcript as TranscriptSentence[];
      }
    } catch (e) {
      // No cached transcript
    }

    if (!transcript) {
      const transcriptResult = await handleFetchTranscript(videoId);
      if (!transcriptResult.success) {
        return { success: false, error: '无法获取转写稿' };
      }
      transcript = transcriptResult.transcript;
    }

    // Find the matching line in transcript
    let matchedLine: TranscriptSentence | undefined;
    let matchedIndex = 0;
    let contextLines: string[] = [];
    let beforeLine: string | null = null;
    let afterLine: string | null = null;

    const typedTranscript = transcript as Array<{ start: number; text: string; rawText: string }>;

    for (let i = 0; i < typedTranscript.length; i++) {
      const line = typedTranscript[i];
      if (line.start <= safeTimestamp && (!typedTranscript[i + 1] || typedTranscript[i + 1].start > safeTimestamp)) {
        matchedLine = line;
        matchedIndex = i;

        const beforeLines: string[] = [];
        for (let j = 1; j <= 2 && i - j >= 0; j++) {
          beforeLines.unshift(typedTranscript[i - j].text);
        }
        if (beforeLines.length > 0) {
          beforeLine = beforeLines.join(' ');
        }

        const afterLines: string[] = [];
        for (let j = 1; j <= 4 && i + j < typedTranscript.length; j++) {
          afterLines.push(typedTranscript[i + j].text);
        }
        if (afterLines.length > 0) {
          afterLine = afterLines.join(' ');
        }

        const startIdx = Math.max(0, i - 8);
        const endIdx = Math.min(typedTranscript.length - 1, i + 12);
        for (let j = startIdx; j <= endIdx; j++) {
          contextLines.push(typedTranscript[j].text);
        }
        break;
      }
    }

    if (!matchedLine) {
      matchedLine = typedTranscript[typedTranscript.length - 1];
      matchedIndex = typedTranscript.length - 1;

      const beforeLines: string[] = [];
      for (let j = 1; j <= 2 && matchedIndex - j >= 0; j++) {
        beforeLines.unshift(typedTranscript[matchedIndex - j].text);
      }
      if (beforeLines.length > 0) {
        beforeLine = beforeLines.join(' ');
      }

      const startIdx = Math.max(0, matchedIndex - 8);
      for (let j = startIdx; j <= matchedIndex; j++) {
        contextLines.push(typedTranscript[j].text);
      }
    }

    const cleanedText = await cleanupNoteText(
      matchedLine.rawText || matchedLine.text,
      beforeLine || '',
      afterLine || '',
      contextLines.join(' '),
      videoTitle
    );

    const minutes = Math.floor(safeTimestamp / 60);
    const seconds = safeTimestamp % 60;
    const formattedTimestamp = `${minutes}:${String(seconds).padStart(2, '0')}`;

    const note: Note = {
      id: `note_${Date.now()}`,
      videoId,
      videoTitle: typeof videoTitle === 'string' ? videoTitle.slice(0, 500) : '未命名单集',
      channelName: typeof channelName === 'string' ? channelName.slice(0, 300) : '',
      timestamp: formattedTimestamp,
      timestampSeconds: safeTimestamp,
      timestampedUrl: canonicalVideoUrl,
      text: cleanedText,
      rawText: matchedLine.rawText || matchedLine.text,
      createdAt: Date.now(),
    };

    await saveNoteToStorage(note);

    chrome.runtime.sendMessage({ action: 'noteSaved', note }).catch(() => {});

    return { success: true, note };
  } catch (error) {
    console.error('[小宇宙 Digest v2.0] Save note error:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function handleSaveCardNote({
  videoId,
  timestampSeconds,
  videoTitle,
  channelName,
  text,
}: {
  videoId: string;
  timestampSeconds: number;
  videoTitle: string;
  channelName: string;
  text: string;
}): Promise<{ success: boolean; note?: Note; error?: string }> {
  try {
    const canonicalVideoUrl = canonicalXiaoyuzhouUrl(videoId);
    const safeTimestamp = Math.max(0, Math.floor(Number(timestampSeconds) || 0));

    const minutes = Math.floor(safeTimestamp / 60);
    const seconds = safeTimestamp % 60;
    const formattedTimestamp = `${minutes}:${String(seconds).padStart(2, '0')}`;

    const note: Note = {
      id: `note_${Date.now()}`,
      videoId,
      videoTitle: typeof videoTitle === 'string' ? videoTitle.slice(0, 500) : '未命名单集',
      channelName: typeof channelName === 'string' ? channelName.slice(0, 300) : '',
      timestamp: formattedTimestamp,
      timestampSeconds: safeTimestamp,
      timestampedUrl: canonicalVideoUrl,
      text: typeof text === 'string' ? text : '',
      createdAt: Date.now(),
    };

    await saveNoteToStorage(note);

    chrome.runtime.sendMessage({ action: 'noteSaved', note }).catch(() => {});

    return { success: true, note };
  } catch (error) {
    console.error('[小宇宙 Digest v2.0] Save card note error:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function handleGetNotes(
  videoId?: string
): Promise<{ success: boolean; notes?: Note[]; error?: string }> {
  try {
    const result = await chrome.storage.local.get(NOTES_STORAGE_KEY);
    let notes = normalizeStoredNotes(result[NOTES_STORAGE_KEY]);

    if (videoId) {
      notes = notes.filter((note) => note.videoId === videoId);
    }

    return { success: true, notes: sortNotesNewestFirst(notes) };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function handleDeleteNote(
  noteId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await chrome.storage.local.get(NOTES_STORAGE_KEY);
    const notes = normalizeStoredNotes(result[NOTES_STORAGE_KEY]);

    await chrome.storage.local.set({
      [NOTES_STORAGE_KEY]: notes.filter((note) => note.id !== noteId),
    });

    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// Type helper
interface TranscriptSentence {
  start: number;
  text?: string;
  rawText: string;
}
