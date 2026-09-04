/**
 * Domain utilities for Xiaoyuzhou Digest
 * - URL parsing and validation
 * - Timestamp formatting
 * - Title cleaning
 */

import { AsrModel, DEFAULT_SETTINGS } from '../types';

// ============================================================
// CONSTANTS
// ============================================================

export const TURN_MERGE_LIMITS = Object.freeze({ maxChars: 70, maxSeconds: 15 });
export const CACHE_SCHEMA_VERSION = 5;
export const ASR_MODELS: readonly AsrModel[] = Object.freeze(['paraformer-v2', 'fun-asr']);

// ============================================================
// URL & ID EXTRACTION
// ============================================================

export function extractEpisodeId(url: string): string | null {
  try {
    const match = new URL(url).pathname.match(/\/episode\/([0-9a-fA-F]{24})/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export function isXiaoyuzhouObjectId(value: string): boolean {
  return typeof value === 'string' && /^[0-9a-f]{24}$/i.test(value.trim());
}

// ============================================================
// TIMESTAMP FORMATTING
// ============================================================

export function formatTimestamp(totalSeconds: number | string): string {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

// ============================================================
// TITLE CLEANING
// ============================================================

export function cleanEpisodeTitle(title: string): string {
  return String(title || '')
    .replace(/\s*[-–—|·:]\s*听播客[，,\s]*上小宇宙\s*$/i, '')
    .replace(/\s*听播客[，,\s]*上小宇宙\s*$/i, '')
    .replace(/\s*[-–—|·:]\s*(小宇宙|xiaoyuzhoufm\.com)\s*$/i, '')
    .replace(/\s*(小宇宙|xiaoyuzhoufm\.com)\s*$/i, '')
    .trim();
}

// ============================================================
// URL HELPERS
// ============================================================

export function canonicalXiaoyuzhouUrl(episodeId: string): string {
  const normalized = String(episodeId || '').trim();
  if (!/^[0-9a-fA-F]{24}$/.test(normalized)) {
    throw new Error('Invalid Xiaoyuzhou episode ID.');
  }
  return `https://www.xiaoyuzhoufm.com/episode/${normalized}`;
}

// ============================================================
// SETTINGS HELPERS
// ============================================================

const STORAGE_KEY = 'xyz_settings';

export { STORAGE_KEY };

export interface SettingsAPI {
  STORAGE_KEY: typeof STORAGE_KEY;
  DEFAULTS: Readonly<typeof DEFAULT_SETTINGS>;
  ASR_MODELS: readonly AsrModel[];
  normalize: (input?: Partial<SettingsInput>) => NormalizedSettings;
  chatCompletionsUrl: () => string;
  dashscopeTranscriptionUrl: () => string;
  dashscopeTaskUrl: (taskId: string) => string;
  canonicalXiaoyuzhouUrl: (episodeId: string) => string;
}

export interface SettingsInput {
  provider?: string;
  aiApiKey?: string;
  aiBaseUrl?: string;
  aiModel?: string;
  dashscopeApiKey?: string;
  asrModel?: string;
  diarizationMode?: string | boolean;
  speakerCount?: number;
  diarization?: boolean;
}

export interface NormalizedSettings {
  provider: string;
  aiApiKey: string;
  aiBaseUrl: string;
  aiModel: string;
  dashscopeApiKey: string;
  asrModel: AsrModel;
  diarizationMode: 'auto' | 'on' | 'off';
  speakerCount: number;
}

function normalizeSpeakerCount(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.speakerCount;
  return Math.min(100, Math.max(2, Math.round(n)));
}

function normalizeAsrModel(value: unknown): AsrModel {
  if (ASR_MODELS.includes(value as AsrModel)) return value as AsrModel;
  return DEFAULT_SETTINGS.asrModel;
}

function normalizeDiarizationMode(value: unknown): 'auto' | 'on' | 'off' {
  if (value === 'auto' || value === 'on' || value === 'off') return value;
  // Backward compatibility with old boolean `diarization`
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  return DEFAULT_SETTINGS.diarizationMode;
}

export function normalize(input: SettingsInput = {}): NormalizedSettings {
  const mode =
    input.diarizationMode !== undefined
      ? input.diarizationMode
      : input.diarization;

  return {
    provider: DEFAULT_SETTINGS.provider,
    aiApiKey:
      typeof input.aiApiKey === 'string' ? input.aiApiKey.trim() : '',
    aiBaseUrl: DEFAULT_SETTINGS.aiBaseUrl,
    aiModel: DEFAULT_SETTINGS.aiModel,
    dashscopeApiKey:
      typeof input.dashscopeApiKey === 'string'
        ? input.dashscopeApiKey.trim()
        : '',
    asrModel: normalizeAsrModel(input.asrModel),
    diarizationMode: normalizeDiarizationMode(mode),
    speakerCount: normalizeSpeakerCount(input.speakerCount),
  };
}

export function chatCompletionsUrl(): string {
  return `${DEFAULT_SETTINGS.aiBaseUrl}/chat/completions`;
}

export function dashscopeTranscriptionUrl(): string {
  return 'https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription';
}

export function dashscopeTaskUrl(taskId: string): string {
  const normalized = String(taskId || '').trim();
  if (!/^[A-Za-z0-9-]{8,}$/.test(normalized)) {
    throw new Error('Invalid DashScope task ID.');
  }
  return `https://dashscope.aliyuncs.com/api/v1/tasks/${normalized}`;
}

// Export as a unified settings API object (compatible with original XYZ_SETTINGS)
export const SettingsAPI: SettingsAPI = {
  STORAGE_KEY,
  DEFAULTS: DEFAULT_SETTINGS,
  ASR_MODELS,
  normalize,
  chatCompletionsUrl,
  dashscopeTranscriptionUrl,
  dashscopeTaskUrl,
  canonicalXiaoyuzhouUrl,
};

export default SettingsAPI;
