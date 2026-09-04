var XYZ_PANEL_STORAGE = (() => {
  const digestKey = (episodeId) => `digest_${episodeId}`;

  function hasTranscript(cached) {
    return Boolean(
      cached
      && (cached.transcript || cached.transcriptText || cached.transcriptTimestamped || cached.turns?.length),
    );
  }

  async function loadDigest(episodeId) {
    const key = digestKey(episodeId);
    const result = await chrome.storage.local.get(key);
    const cached = result[key];
    // ASR 模型、缓存结构升级都不应删除用户已保存的文字稿。旧稿仍可展示，
    // 用户可在需要时主动重新识别来更新它。
    return hasTranscript(cached) ? cached : null;
  }

  async function saveDigest(episodeId, data) {
    await chrome.storage.local.set({
      [digestKey(episodeId)]: { ...data, schemaVersion: XYZ_DOMAIN.CACHE_SCHEMA_VERSION, timestamp: Date.now() },
    });
  }

  async function evictDigests() {
    // 保留该接口以兼容启动流程，但不再静默淘汰用户保存的文字稿。
    // 缓存只由用户在设置页明确执行「清除缓存」时删除。
  }

  async function upsertHistory(entry) {
    if (!entry?.episodeId || !entry.title) return;
    const key = XYZ_DOMAIN.STORAGE_KEYS.HISTORY;
    const result = await chrome.storage.local.get(key);
    const history = Array.isArray(result[key]) ? result[key] : [];
    const next = [{ ...entry, timestamp: Date.now() }, ...history.filter((item) => item?.episodeId !== entry.episodeId)].slice(0, 200);
    await chrome.storage.local.set({ [key]: next });
  }

  return { loadDigest, saveDigest, evictDigests, upsertHistory };
})();
