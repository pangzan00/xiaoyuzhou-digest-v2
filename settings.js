/**
 * Shared, non-secret configuration helpers.
 *
 * API keys are stored in chrome.storage.local by options.js. This file contains
 * defaults and validation only, so it is safe to publish.
 */
var XYZ_SETTINGS = (() => {
  const STORAGE_KEY = "xyz_settings";

  // 可选 ASR 模型：paraformer-v2 更便宜（也有每月滚动免费额度），
  // fun-asr 为旧默认，准确率略好但更贵。
  const ASR_MODELS = Object.freeze(["paraformer-v2", "fun-asr"]);

  const DEFAULTS = Object.freeze({
    provider: "deepseek",
    aiApiKey: "",
    aiBaseUrl: "https://api.deepseek.com",
    aiModel: "deepseek-v4-flash",
    dashscopeApiKey: "",
    asrModel: "paraformer-v2",
    diarizationMode: "auto", // "auto" | "on" | "off"
    speakerCount: 2,
  });

  function normalizeSpeakerCount(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return DEFAULTS.speakerCount;
    return Math.min(100, Math.max(2, Math.round(n)));
  }

  function normalizeAsrModel(value) {
    if (ASR_MODELS.includes(value)) return value;
    return DEFAULTS.asrModel;
  }

  function normalizeDiarizationMode(value) {
    if (value === "auto" || value === "on" || value === "off") return value;
    // 兼容旧版布尔值 `diarization`
    if (typeof value === "boolean") return value ? "on" : "off";
    return DEFAULTS.diarizationMode;
  }

  function normalize(input = {}) {
    const mode =
      input.diarizationMode !== undefined
        ? input.diarizationMode
        : input.diarization;
    return {
      provider: DEFAULTS.provider,
      aiApiKey:
        typeof input.aiApiKey === "string" ? input.aiApiKey.trim() : "",
      aiBaseUrl: DEFAULTS.aiBaseUrl,
      aiModel: DEFAULTS.aiModel,
      dashscopeApiKey:
        typeof input.dashscopeApiKey === "string"
          ? input.dashscopeApiKey.trim()
          : "",
      asrModel: normalizeAsrModel(input.asrModel),
      diarizationMode: normalizeDiarizationMode(mode),
      speakerCount: normalizeSpeakerCount(input.speakerCount),
    };
  }

  function chatCompletionsUrl() {
    return `${DEFAULTS.aiBaseUrl}/chat/completions`;
  }

  function dashscopeTranscriptionUrl() {
    return "https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription";
  }

  function dashscopeTaskUrl(taskId) {
    const normalized = String(taskId || "").trim();
    if (!/^[A-Za-z0-9-]{8,}$/.test(normalized)) {
      throw new Error("Invalid DashScope task ID.");
    }
    return `https://dashscope.aliyuncs.com/api/v1/tasks/${normalized}`;
  }

  function canonicalXiaoyuzhouUrl(episodeId) {
    const normalized = String(episodeId || "").trim();
    // 小宇宙 episode id 是 24 位十六进制（Mongo ObjectId）。
    if (!/^[0-9a-fA-F]{24}$/.test(normalized)) {
      throw new Error("Invalid Xiaoyuzhou episode ID.");
    }
    return `https://www.xiaoyuzhoufm.com/episode/${normalized}`;
  }

  return {
    STORAGE_KEY,
    DEFAULTS,
    ASR_MODELS,
    normalize,
    chatCompletionsUrl,
    dashscopeTranscriptionUrl,
    dashscopeTaskUrl,
    canonicalXiaoyuzhouUrl,
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = XYZ_SETTINGS;
}
