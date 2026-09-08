export const DIGEST_BACKUP_FORMAT = 'xiaoyuzhou-digest-backup';
export const DIGEST_BACKUP_VERSION = 1;

export const HISTORY_KEY = 'xyz_history';
export const NOTES_KEY = 'xyz_notes';
export const PODCASTS_KEY = 'xyz_podcasts';
const DIGEST_KEY_PATTERN = /^digest_[0-9a-fA-F]{24}$/;

export interface DigestBackup {
  format: typeof DIGEST_BACKUP_FORMAT;
  version: typeof DIGEST_BACKUP_VERSION;
  exportedAt: string;
  data: {
    history: unknown[];
    notes: unknown[];
    podcasts: unknown[];
    digests: Record<string, Record<string, unknown>>;
  };
}

export interface ParsedDigestBackup {
  items: Record<string, unknown>;
  historyCount: number;
  noteCount: number;
  podcastCount: number;
  digestCount: number;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function isDigestDataKey(key: string): boolean {
  return key === HISTORY_KEY || key === NOTES_KEY || key === PODCASTS_KEY || DIGEST_KEY_PATTERN.test(key);
}

export function createDigestBackup(allData: Record<string, unknown>): DigestBackup {
  const digests: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(allData)) {
    if (!DIGEST_KEY_PATTERN.test(key)) continue;
    const digest = asObject(value);
    if (digest) digests[key] = digest;
  }

  return {
    format: DIGEST_BACKUP_FORMAT,
    version: DIGEST_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      history: asArray(allData[HISTORY_KEY]),
      notes: asArray(allData[NOTES_KEY]),
      podcasts: asArray(allData[PODCASTS_KEY]),
      digests,
    },
  };
}

export function parseDigestBackup(input: unknown): ParsedDigestBackup {
  const root = asObject(input);
  if (root?.format !== DIGEST_BACKUP_FORMAT) {
    throw new Error('这不是小宇宙 Digest 的备份文件。');
  }
  if (root.version !== DIGEST_BACKUP_VERSION) {
    throw new Error(`备份版本 ${String(root.version || '未知')} 暂不支持。`);
  }

  const data = asObject(root.data);
  if (!data) throw new Error('备份文件缺少数据内容。');

  const digests: Record<string, Record<string, unknown>> = {};
  const rawDigests = asObject(data.digests);
  for (const [key, value] of Object.entries(rawDigests || {})) {
    const digest = asObject(value);
    if (DIGEST_KEY_PATTERN.test(key) && digest) digests[key] = digest;
  }

  const history = asArray(data.history);
  const notes = asArray(data.notes);
  const podcasts = asArray(data.podcasts);
  const items: Record<string, unknown> = {
    [HISTORY_KEY]: history,
    [NOTES_KEY]: notes,
    [PODCASTS_KEY]: podcasts,
    ...digests,
  };

  return {
    items,
    historyCount: history.length,
    noteCount: notes.length,
    podcastCount: podcasts.length,
    digestCount: Object.keys(digests).length,
  };
}

function mergeByKey(
  current: unknown[],
  imported: unknown[],
  key: string,
  limit = 500
): unknown[] {
  const merged = new Map<string, unknown>();
  for (const item of [...current, ...imported]) {
    const record = asObject(item);
    const value = String(record?.[key] || '').trim();
    if (value) merged.set(value, item);
  }
  return [...merged.values()].slice(-limit);
}

function mergeNewestFirstByKey(
  current: unknown[],
  imported: unknown[],
  key: string,
  timestampKey: string,
  limit = 500
): unknown[] {
  const merged = new Map<string, unknown>();
  for (const item of [...current, ...imported]) {
    const record = asObject(item);
    const value = String(record?.[key] || '').trim();
    if (!value) continue;
    const existing = asObject(merged.get(value));
    const existingTimestamp = Number(existing?.[timestampKey]) || 0;
    const itemTimestamp = Number(record?.[timestampKey]) || 0;
    if (!existing || itemTimestamp >= existingTimestamp) merged.set(value, item);
  }
  return [...merged.values()]
    .sort((left, right) => (Number(asObject(right)?.[timestampKey]) || 0) - (Number(asObject(left)?.[timestampKey]) || 0))
    .slice(0, limit);
}

export function mergeDigestData(
  currentData: Record<string, unknown>,
  importedData: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = {
    ...currentData,
  };
  const currentHistory = asArray(currentData[HISTORY_KEY]);
  const importedHistory = asArray(importedData[HISTORY_KEY]);
  const history = mergeByKey(currentHistory, importedHistory, 'videoId', 200)
    .sort((left, right) => {
      const leftTime = Number(asObject(left)?.timestamp) || 0;
      const rightTime = Number(asObject(right)?.timestamp) || 0;
      return rightTime - leftTime;
    });
  merged[HISTORY_KEY] = history;
  merged[NOTES_KEY] = mergeNewestFirstByKey(
    asArray(currentData[NOTES_KEY]),
    asArray(importedData[NOTES_KEY]),
    'id',
    'createdAt'
  );
  merged[PODCASTS_KEY] = mergeNewestFirstByKey(
    asArray(currentData[PODCASTS_KEY]),
    asArray(importedData[PODCASTS_KEY]),
    'pid',
    'lastVisitedAt',
    200
  );

  for (const [key, importedValue] of Object.entries(importedData)) {
    if (!DIGEST_KEY_PATTERN.test(key)) continue;
    const currentValue = asObject(currentData[key]);
    const importedRecord = asObject(importedValue);
    if (!importedRecord) continue;
    const currentTimestamp = Number(currentValue?.timestamp) || 0;
    const importedTimestamp = Number(importedRecord.timestamp) || 0;
    if (!currentValue || importedTimestamp >= currentTimestamp) {
      merged[key] = importedRecord;
    }
  }
  return merged;
}
