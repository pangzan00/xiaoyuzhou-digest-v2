/**
 * Transcript parsing and building utilities
 */

import { TranscriptSentence, TranscriptTurn, ParsedTranscript } from '../types';
import { TURN_MERGE_LIMITS, formatTimestamp } from './domain';

// ============================================================
// SPEAKER DISPLAY NAME
// ============================================================

export function speakerDisplayName(
  speaker: number | null,
  speakerNames: Record<number, string> | null
): string | null {
  if (speaker === null || speaker === undefined) return null;
  return speakerNames?.[speaker] || `说话人${speaker}`;
}

// ============================================================
// SENTENCE PARSING
// ============================================================

export interface RawSentence {
  text?: string;
  begin_time?: number;
  end_time?: number;
  speaker_id?: number | null;
}

export interface RawTranscript {
  transcripts?: Array<{
    sentences?: RawSentence[];
  }>;
}

export function parseSentences(
  data: RawTranscript,
  diarizationEnabled: boolean
): TranscriptSentence[] {
  const sentences: TranscriptSentence[] = [];

  for (const transcript of data?.transcripts || []) {
    for (const sentence of transcript?.sentences || []) {
      const rawText = String(sentence?.text || '').trim();
      if (!rawText) continue;

      const beginMs = Number(sentence?.begin_time) || 0;
      const endMs = Math.max(beginMs, Number(sentence?.end_time) || beginMs);
      const rawSpeakerId = sentence?.speaker_id;
      const speakerId =
        rawSpeakerId === null || rawSpeakerId === undefined
          ? NaN
          : Number(rawSpeakerId);

      sentences.push({
        rawText,
        speaker:
          diarizationEnabled && Number.isInteger(speakerId) ? speakerId : null,
        start: Math.max(0, beginMs / 1000),
        duration: Math.max(0, Math.floor((endMs - beginMs) / 1000)),
      });
    }
  }

  return sentences;
}

// ============================================================
// TRANSCRIPT BUILDING
// ============================================================

interface MergeLimits {
  maxChars: number;
  maxSeconds: number;
}

export function buildTranscript(
  sentences: TranscriptSentence[],
  speakerNames: Record<number, string> | null,
  limits: MergeLimits = TURN_MERGE_LIMITS
): ParsedTranscript {
  const transcript: TranscriptSentence[] = [];
  const turns: TranscriptTurn[] = [];

  for (const sentence of sentences) {
    const name = speakerDisplayName(sentence.speaker, speakerNames);
    const text = name ? `${name}：${sentence.rawText}` : sentence.rawText;

    transcript.push({ ...sentence, text });

    const last = turns[turns.length - 1];
    const canMerge =
      sentence.speaker !== null &&
      sentence.speaker !== undefined &&
      last &&
      last.speaker === sentence.speaker;

    const combinedRaw = canMerge ? last.rawText + sentence.rawText : '';
    const combinedDuration = canMerge
      ? sentence.start + sentence.duration - last.start
      : 0;

    if (
      canMerge &&
      combinedRaw.length <= limits.maxChars &&
      combinedDuration <= limits.maxSeconds
    ) {
      last.rawText = combinedRaw;
      last.text = `${name}：${combinedRaw}`;
      last.duration = Math.max(last.duration, combinedDuration);
    } else {
      turns.push({ ...sentence, text });
    }
  }

  const transcriptText = turns.map((turn) => turn.text).join('\n');
  const transcriptTextTimestamped = turns
    .map((turn) => `[${formatTimestamp(turn.start)}] ${turn.text}`)
    .join('\n');

  return {
    transcript,
    turns,
    transcriptText,
    transcriptTextTimestamped,
    language: 'zh',
  };
}

// ============================================================
// TRANSCRIPT SAMPLE (for AI processing)
// ============================================================

/**
 * Builds a timestamped opening excerpt for conservative intro/outro analysis.
 * Speaker IDs are intentionally omitted: a mixed-media intro must not influence
 * either the boundary model or later speaker identity mapping.
 */
export function buildIntroDetectionSample(
  sentences: TranscriptSentence[],
  maxSeconds = 300,
  maxChars = 6000
): string {
  let text = '';
  for (const sentence of sentences) {
    if (sentence.start >= maxSeconds) break;
    const line = `[${formatTimestamp(sentence.start)}] ${sentence.rawText}\n`;
    if (text.length + line.length > maxChars) {
      if (!text) text = line.slice(0, maxChars);
      break;
    }
    text += line;
  }
  return text.trim();
}

export function buildTranscriptSample(
  sentences: TranscriptSentence[],
  maxChars = 4000
): string {
  const groups = new Map<number, TranscriptSentence[]>();
  for (const sentence of sentences) {
    if (sentence.speaker === null || sentence.speaker === undefined) continue;
    const group = groups.get(sentence.speaker) || [];
    group.push(sentence);
    groups.set(sentence.speaker, group);
  }

  // 只截取开头会遗漏后出场的嘉宾。按每个实际 speaker 均分样本，
  // 确保姓名识别模型至少能看到每个聚类出的声纹对应的文本。
  if (groups.size >= 2) {
    const limit = Math.max(1, Math.floor(maxChars));
    const perSpeakerLimit = Math.max(1, Math.floor((limit - groups.size + 1) / groups.size));
    let text = '';

    for (const [speaker, entries] of groups) {
      let excerpt = '';
      for (const entry of entries) {
        const line = `说话人${speaker}：${entry.rawText}\n`;
        if (excerpt.length + line.length > perSpeakerLimit) {
          if (!excerpt) excerpt = line.slice(0, perSpeakerLimit);
          break;
        }
        excerpt += line;
      }
      text += excerpt;
      if (text.length >= limit) break;
    }
    return text.slice(0, limit);
  }

  let text = '';
  for (const sentence of sentences) {
    text += `${
      sentence.speaker === null || sentence.speaker === undefined
        ? ''
        : `说话人${sentence.speaker}：`
    }${sentence.rawText}\n`;
    if (text.length >= maxChars) break;
  }
  return text.slice(0, maxChars);
}

// Export as a unified API object (compatible with original XYZ_TRANSCRIPT)
export const TranscriptAPI = {
  speakerDisplayName,
  parseSentences,
  buildTranscript,
  buildIntroDetectionSample,
  buildTranscriptSample,
};

export default TranscriptAPI;
