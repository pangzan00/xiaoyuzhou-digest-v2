var XYZ_DOMAIN = (() => {
  const ACTIONS = Object.freeze({
    FETCH_TRANSCRIPT: "fetchTranscript",
    CANCEL_TRANSCRIPT: "cancelTranscript",
    ANALYZE_TRANSCRIPT: "analyzeTranscript",
    EXPLAIN_SELECTION: "explainSelection",
    ASK_EPISODE_QUESTION: "askEpisodeQuestion",
    SAVE_NOTE: "saveNote",
    SAVE_CARD_NOTE: "saveCardNote",
    GET_NOTES: "getNotes",
    DELETE_NOTE: "deleteNote",
    GET_EPISODE_INFO: "getVideoInfo",
    CHECK_CONFIG: "checkConfig",
    OPEN_OPTIONS: "openOptions",
    FETCH_PODCAST_EPISODES: "fetchPodcastEpisodes",
    OPEN_SIDE_PANEL: "openSidePanel",
    RELAY_TO_CONTENT: "relayToContent",
    TRANSCRIPT_PROGRESS: "transcriptProgress",
    NOTE_SAVED: "noteSaved",
    GET_CURRENT_TIME: "getCurrentTime",
    SEEK_TO: "seekTo",
  });

  const PORTS = Object.freeze({
    EPISODE_CHAT_STREAM: "episodeChatStream",
  });

  const STORAGE_KEYS = Object.freeze({
    NOTES: "xyz_notes",
    HISTORY: "xyz_history",
    PODCASTS: "xyz_podcasts",
  });

  const CACHE_SCHEMA_VERSION = 2;
  const TURN_MERGE_LIMITS = Object.freeze({ maxChars: 70, maxSeconds: 15 });

  function extractEpisodeId(url) {
    try {
      const match = new URL(url).pathname.match(/\/episode\/([0-9a-fA-F]{24})/);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  }

  function formatTimestamp(totalSeconds) {
    const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }

  function cleanEpisodeTitle(title) {
    return String(title || "")
      .replace(/\s*[-–—|·:]\s*听播客[，,\s]*上小宇宙\s*$/i, "")
      .replace(/\s*听播客[，,\s]*上小宇宙\s*$/i, "")
      .replace(/\s*[-–—|·:]\s*(小宇宙|xiaoyuzhoufm\.com)\s*$/i, "")
      .replace(/\s*(小宇宙|xiaoyuzhoufm\.com)\s*$/i, "")
      .trim();
  }

  function canonicalEpisodeUrl(episodeId) {
    return XYZ_SETTINGS.canonicalXiaoyuzhouUrl(episodeId);
  }

  return {
    ACTIONS,
    PORTS,
    STORAGE_KEYS,
    CACHE_SCHEMA_VERSION,
    TURN_MERGE_LIMITS,
    extractEpisodeId,
    formatTimestamp,
    cleanEpisodeTitle,
    canonicalEpisodeUrl,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = XYZ_DOMAIN;
