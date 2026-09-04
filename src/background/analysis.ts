/**
 * DeepSeek Analysis (Challenges, Counter-intuitive insights, Chapters)
 */

import { getSettings, loadPromptSection, requestAiCompletion, parseLooseJson } from './index';
import { Chapter, Challenge, CounterIntuitiveItem } from '../types';

// ============================================================
// CONSTANTS
// ============================================================

const OVERVIEW_MODULE_PROMPTS: Record<string, string> = {
  chapters: 'analysis-chapters.md',
  challenges: 'analysis-challenges.md',
  counter: 'analysis-counter.md',
};

// ============================================================
// VALIDATION HELPERS
// ============================================================

function safeString(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function parseTimestampSeconds(value: unknown): number | null {
  if (typeof value === 'number') return value;
  const text = String(value ?? '').trim();
  const timestampMatch = text.match(/^\[?(\d+):([0-5]\d)\]?$/);
  if (timestampMatch) return Number(timestampMatch[1]) * 60 + Number(timestampMatch[2]);
  return /^\d+(?:\.\d+)?$/.test(text) ? Number(text) : NaN;
}

function safeSeconds(value: unknown, maxSeconds: number): number | null {
  const seconds = parseTimestampSeconds(value);
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > maxSeconds) return null;
  return Math.floor(seconds);
}

function safeStringFrom(item: unknown, keys: string[], maxLength: number): string {
  for (const key of keys) {
    const value = safeString((item as Record<string, unknown>)?.[key], maxLength);
    if (value) return value;
  }
  return '';
}

function safeSecondsFrom(item: unknown, maxSeconds: number): number | null {
  for (const value of [
    (item as Record<string, unknown>)?.timestampSeconds,
    (item as Record<string, unknown>)?.timestamp_seconds,
    (item as Record<string, unknown>)?.startSeconds,
    (item as Record<string, unknown>)?.start_seconds,
    (item as Record<string, unknown>)?.start,
    (item as Record<string, unknown>)?.timestamp,
    (item as Record<string, unknown>)?.time,
  ]) {
    const seconds = safeSeconds(value, maxSeconds);
    if (seconds !== null) return seconds;
  }
  return null;
}

function readItems(data: unknown, keys: string[]): unknown[] {
  for (const source of [data, (data as Record<string, unknown>)?.data, (data as Record<string, unknown>)?.result]) {
    for (const key of keys) {
      if (Array.isArray((source as Record<string, unknown>)?.[key])) {
        return (source as Record<string, unknown>)[key] as unknown[];
      }
    }
  }
  return [];
}

function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function normalizeItems<T extends { timestampSeconds: number }>(
  items: unknown[],
  limit: number,
  maxSeconds: number,
  mapItem: (item: unknown) => T | null
): T[] {
  return items
    .slice(0, limit)
    .map(mapItem)
    .filter((item): item is T => item !== null)
    .sort((a, b) => a.timestampSeconds - b.timestampSeconds);
}

// ============================================================
// MODULE VALIDATION
// ============================================================

function validateChapters(parsed: unknown, maxSeconds: number): Chapter[] {
  return normalizeItems(readItems(parsed, ['chapters', 'items']), 100, maxSeconds, (chapter) => {
    const seconds = safeSecondsFrom(chapter, maxSeconds);
    const title = safeStringFrom(chapter, ['title', 'chapter', 'name'], 300);
    if (seconds === null || !title) return null;
    return {
      title,
      summary: safeStringFrom(chapter, ['summary', 'description'], 1500),
      timestampSeconds: seconds,
      timestamp: formatTimestamp(seconds),
    };
  });
}

function validateChallenges(parsed: unknown, maxSeconds: number): Challenge[] {
  return normalizeItems(
    readItems(parsed, ['coreChallenges', 'core_challenges', 'challenges', 'items']),
    40,
    maxSeconds,
    (item) => {
      const seconds = safeSecondsFrom(item, maxSeconds);
      const challenge = safeStringFrom(item, ['challenge', 'coreChallenge', 'title', 'description'], 500);
      if (seconds === null || !challenge) return null;
      return {
        topic: safeStringFrom(item, ['topic', 'subject', 'theme'], 200),
        challenge,
        solution: safeStringFrom(item, ['solution', 'resolution', 'approach', 'answer'], 1500),
        timestampSeconds: seconds,
        timestamp: formatTimestamp(seconds),
      };
    }
  );
}

function validateCounter(parsed: unknown, maxSeconds: number): CounterIntuitiveItem[] {
  return normalizeItems(
    readItems(parsed, [
      'counterIntuitive',
      'counterintuitive',
      'counterIntuitives',
      'counter_intuitive',
      'insights',
      'items',
    ]),
    20,
    maxSeconds,
    (item) => {
      const seconds = safeSecondsFrom(item, maxSeconds);
      const claim = safeStringFrom(item, ['claim', 'insight', 'counterIntuitive', 'title', 'description'], 300);
      if (seconds === null || !claim) return null;
      return {
        claim,
        explanation: safeStringFrom(item, ['explanation', 'reason', 'detail', 'analysis'], 1500),
        timestampSeconds: seconds,
        timestamp: formatTimestamp(seconds),
      };
    }
  );
}

// ============================================================
// MAIN ANALYSIS FUNCTION
// ============================================================

export async function handleAnalyzeTranscript(
  module: string,
  transcriptText: string,
  videoTitle: string,
  channelName: string,
  videoDescription: string,
  videoDuration: number
): Promise<{ success: boolean; module?: string; items?: Chapter[] | Challenge[] | CounterIntuitiveItem[]; error?: string; message?: string }> {
  try {
    const normalizedTranscript = typeof transcriptText === 'string' ? transcriptText.trim() : '';

    if (!normalizedTranscript) {
      return {
        success: false,
        error: 'MISSING_TIMESTAMPED_TRANSCRIPT',
        message: '当前文字稿缺少可用于分析的带时间戳内容，请重新识别后重试。',
      };
    }

    const settings = await getSettings();

    if (!settings.aiApiKey) {
      return {
        success: false,
        error: 'NO_AI_KEY',
        message: '尚未配置 DeepSeek API key，请在小宇宙 Digest v2.0 设置中填写。',
      };
    }

    if (!OVERVIEW_MODULE_PROMPTS[module]) {
      return {
        success: false,
        error: 'UNKNOWN_MODULE',
        message: '未知的概览模块。',
      };
    }

    // Calculate duration from transcript timestamps
    let lastTranscriptSeconds = 0;
    const stampMatches = normalizedTranscript.match(/\[(\d+):(\d{2})\]/g) || [];
    if (stampMatches.length) {
      const last = stampMatches[stampMatches.length - 1].match(/\[(\d+):(\d{2})\]/);
      if (last) {
        lastTranscriptSeconds = parseInt(last[1]) * 60 + parseInt(last[2]);
      }
    }

    const effectiveSeconds = Math.max(Math.floor(videoDuration || 0), lastTranscriptSeconds);
    const durationMinutes = Math.floor(effectiveSeconds / 60);
    const durationSeconds = Math.floor(effectiveSeconds % 60);
    const durationFormatted = `${durationMinutes}:${String(durationSeconds).padStart(2, '0')}`;
    const maxTimestampSeconds = effectiveSeconds;

    const lateThresholdSeconds = Math.floor(effectiveSeconds * 0.75);
    const lateThreshold = `${Math.floor(lateThresholdSeconds / 60)}:${String(lateThresholdSeconds % 60).padStart(2, '0')}`;

    const promptVariables: Record<string, string> = {
      durationFormatted,
      lateThreshold,
      maxTimestampSeconds: String(maxTimestampSeconds),
      videoTitle: videoTitle || '未知标题',
      channelName: channelName || '未知播客',
      videoDescription: videoDescription || '暂无简介',
      transcriptText: normalizedTranscript,
    };

    const promptFile = OVERVIEW_MODULE_PROMPTS[module];
    const systemPrompt = await loadPromptSection(promptFile, 'System prompt', promptVariables);
    const userPrompt = await loadPromptSection(promptFile, 'User prompt', promptVariables);

    const { text: responseText } = await requestAiCompletion({
      maxTokens: 4096,
      responseFormat: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    const parsed = parseLooseJson(responseText);

    let items: Chapter[] | Challenge[] | CounterIntuitiveItem[];

    switch (module) {
      case 'chapters':
        items = validateChapters(parsed, maxTimestampSeconds);
        break;
      case 'challenges':
        items = validateChallenges(parsed, maxTimestampSeconds);
        break;
      case 'counter':
        items = validateCounter(parsed, maxTimestampSeconds);
        break;
      default:
        items = [];
    }

    return {
      success: true,
      module,
      items,
    };
  } catch (error) {
    console.error('Analysis error:', error);

    if ((error as Error & { status?: number })?.status === 401) {
      return { success: false, error: 'INVALID_AI_KEY', message: 'DeepSeek 拒绝了该 API key。' };
    }
    if ((error as Error & { status?: number })?.status === 429) {
      return { success: false, error: 'RATE_LIMITED', message: 'DeepSeek 触发限流，请稍后重试。' };
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : '分析转写稿失败',
    };
  }
}
