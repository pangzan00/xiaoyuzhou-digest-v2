/** Side-panel composition root: state, feature controllers, and view bindings. */
const DEBUG = false;
const debugLog = (...args) => {
  if (DEBUG) console.log(...args);
};

let currentVideoId = null;
let currentVideoUrl = null;
let currentAnalysis = null;
let currentTranscript = null;
let currentTurns = null;
let currentTranscriptText = null;
let currentTranscriptTimestamped = null;
let currentTranscriptLanguage = null;
let currentVideoTitle = "";
let currentChannelName = "";
let currentVideoDescription = "";
let currentVideoDuration = 0;
let currentVideoImage = "";
let currentDiarization = null;
let currentAsrModel = null;
let configuredAsrModel = "paraformer-v2";
let transcriptLoadedFromCache = false;
let xiaoyuzhouTabId = null;
let errorAction = null;
let currentPodcastId = "";
let activePodcastPid = null;
let browsedPodcasts = [];
const overviewLoading = { chapters: false, challenges: false, counter: false };
const CONFIG_CHECK_MAX_ATTEMPTS = 3;
const CONFIG_CHECK_RETRY_DELAY_MS = 250;

const getState = () => ({
  currentVideoId,
  currentVideoUrl,
  currentAnalysis,
  currentTranscript,
  currentTurns,
  currentTranscriptText,
  currentTranscriptTimestamped,
  currentTranscriptLanguage,
  currentVideoTitle,
  currentChannelName,
  currentVideoDescription,
  currentVideoDuration,
  currentVideoImage,
  currentDiarization,
  currentAsrModel,
  configuredAsrModel,
  transcriptLoadedFromCache,
  xiaoyuzhouTabId,
  currentPodcastId,
  activePodcastPid,
  browsedPodcasts,
  groupTranscriptEntries,
});

const setState = (patch) => {
  const previousVideoId = currentVideoId;
  ({
    currentVideoId,
    currentVideoUrl,
    currentAnalysis,
    currentTranscript,
    currentTurns,
    currentTranscriptText,
    currentTranscriptTimestamped,
    currentTranscriptLanguage,
    currentVideoTitle,
    currentChannelName,
    currentVideoDescription,
    currentVideoDuration,
    currentVideoImage,
    currentDiarization,
    currentAsrModel,
    configuredAsrModel,
    transcriptLoadedFromCache,
    xiaoyuzhouTabId,
    currentPodcastId,
    activePodcastPid,
    browsedPodcasts,
  } = { ...getState(), ...patch });
  if (currentVideoId !== previousVideoId) episodeChatController.reset();
};

const groupTranscriptEntries = XYZ_TRANSCRIPT_GROUPING.group;
const headerView = XYZ_HEADER_VIEW.create();
const stateView = XYZ_STATE_VIEW.create();
const shellView = XYZ_PANEL_SHELL_VIEW.create();
const playbackController = XYZ_PLAYBACK_CONTROLLER.create({
  getTranscript: () => currentTranscript,
  isChaptersViewActive: () => transcriptView.isChaptersViewActive(),
});
const renderingController = XYZ_RENDERING_CONTROLLER.create({
  getState,
  seekTo,
  startPlaybackTracking,
  reloadNotes: () => reloadCurrentNotes(),
  downloadTextFile,
  sanitizeFilename,
});
const transcriptView = XYZ_TRANSCRIPT_VIEW.create({ renderingController, playbackController });
const overviewView = XYZ_OVERVIEW_VIEW.create({
  escapeHtml: renderingController.escapeHtml,
  renderFailureState: renderingController.renderFailureState,
  renderChapters: (items) => transcriptView.renderChapters(items),
  renderChallenges: renderingController.renderChallenges,
  renderCounter: renderingController.renderCounter,
});
const notesView = XYZ_NOTES_VIEW.create();
const episodeChatController = XYZ_EPISODE_CHAT_CONTROLLER.create({ getState, seekTo });

const libraryController = XYZ_LIBRARY_CONTROLLER.create({
  getState,
  setState,
  escapeHtml: renderingController.escapeHtml,
  renderFailureState: renderingController.renderFailureState,
  downloadTextFile,
  restoreHistoryEpisode: (videoId) => digestController?.restoreHistoryEpisode(videoId),
});
const notesController = XYZ_NOTES_CONTROLLER.create({
  rebuildCardNoteMap: (notes) => renderingController.rebuildCardNoteMap(notes),
  syncCardNoteButtons: () => renderingController.syncCardNoteButtons(),
  buildCardKey: (videoId, timestampSeconds, text) => renderingController.buildCardKey(videoId, timestampSeconds, text),
  resetCardNoteButtonByKey: (key) => renderingController.resetCardNoteButtonByKey(key),
  removeCardNoteMapping: () => {},
  playNote,
  getCurrentEpisodeId: () => currentVideoId,
});
const explainController = XYZ_EXPLAIN_CONTROLLER.create({
  getTranscriptText: () => currentTranscriptText,
  getEpisodeTitle: () => currentVideoTitle,
  escapeHtml: renderingController.escapeHtml,
  renderFailureState: renderingController.renderFailureState,
});
const digestController = XYZ_DIGEST_CONTROLLER.create({
  getState,
  setState,
  debugLog,
  storage: {
    load: (videoId, asrModel) => XYZ_PANEL_STORAGE.loadDigest(videoId, asrModel),
    save: (videoId, data) => XYZ_PANEL_STORAGE.saveDigest(videoId, data),
    remove: (videoId) => chrome.storage.local.remove(`digest_${videoId}`),
  },
  library: libraryController,
  ui: {
    showState,
    isShowingResults: () => stateView.isShowingResults(),
    updateLoading: (title, subtitle, progress) => stateView.updateLoading(title, subtitle, progress),
    showError,
    renderVideoInfo,
    clearVideoInfo,
    setStartDigestAvailable,
    renderTranscript: () => transcriptView.render(),
    renderCachedAnalysis: (analysis) => overviewView.renderCached(analysis),
    resetChaptersView: () => transcriptView.resetChaptersView(),
    resetOverviewLoading,
    loadNotes,
    setupExplainFeature: () => explainController.setup(),
    showTransientNotice: (message) => shellView.showTransientNotice(message),
    setStopping: () => stateView.setStopping(),
  },
});

document.addEventListener("DOMContentLoaded", async () => {
  setupEventListeners();
  libraryController.init();
  digestController.initTabTracking();
  await libraryController.backfillHistoryFromCache();
  await XYZ_PANEL_STORAGE.evictDigests();
  await initializeConfigAndCurrentTab();
});

function waitForConfigRetry(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function checkConfigWithRetry() {
  let lastIncompleteStatus = null;
  let lastError = null;
  for (let attempt = 0; attempt < CONFIG_CHECK_MAX_ATTEMPTS; attempt += 1) {
    try {
      const status = await chrome.runtime.sendMessage({ action: "checkConfig" });
      if (status?.success && status.hasDashscopeKey && status.hasAiKey) return status;
      if (status?.success) lastIncompleteStatus = status;
      else lastError = status?.error || "后台尚未准备好。";
    } catch (error) {
      lastError = error;
    }
    if (attempt < CONFIG_CHECK_MAX_ATTEMPTS - 1) {
      await waitForConfigRetry(CONFIG_CHECK_RETRY_DELAY_MS * (attempt + 1));
    }
  }
  if (lastIncompleteStatus) return lastIncompleteStatus;
  throw lastError instanceof Error ? lastError : new Error(String(lastError || "无法读取设置。"));
}

async function initializeConfigAndCurrentTab() {
  let configStatus;
  try {
    configStatus = await checkConfigWithRetry();
  } catch (error) {
    showConfigCheckError(error);
    return;
  }
  configuredAsrModel = configStatus.asrModel || "paraformer-v2";
  if (!configStatus.hasDashscopeKey || !configStatus.hasAiKey) {
    showConfigError(configStatus);
    return;
  }
  await digestController.checkCurrentTab();
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "startDigestFromButton") void digestController.checkCurrentTab();
  if (message.action === "transcriptProgress") digestController.handleProgress(message);
  if (message.action === "noteSaved") reloadCurrentNotes();
  sendResponse({ success: true });
  return false;
});

function setupEventListeners() {
  headerView.bind({ onTabChange: switchTab, onOpenSettings: () => chrome.runtime.sendMessage({ action: "openOptions" }) });
  stateView.bind({
    onRetry: retryFromError,
    onStartDigest: () => void digestController.startCurrentDigest(),
    onRetranscribe: () => void digestController.retranscribe(),
    onStopTranscription: () => void digestController.stopTranscription(),
  });
  transcriptView.bind({
    onToggleChapters: toggleChaptersView,
    onCopy: () => renderingController.copyTranscript(),
    onExport: () => renderingController.exportTranscript(),
  });
  overviewView.bind({ onReanalyze: (key) => void reanalyzeModule(key) });
  notesView.bind({
    onFilterChange: (showAll) => {
      setNotesFilter(showAll);
      loadNotes(showAll ? null : currentVideoId);
    },
  });
  episodeChatController.bind();
  shellView.bind({
    onBackToTop: () => document.getElementById("contentArea")?.scrollTo({ top: 0, behavior: "smooth" }),
    onContentScroll: updateBackToTopVisibility,
    onChatScroll: updateBackToTopVisibility,
  });
  document.getElementById("followPlaybackBtn")?.addEventListener("click", () => playbackController.resumeFollowing());
  episodeChatController.render();
}

function retryFromError() {
  if (errorAction) return errorAction();
  if (currentVideoId) void digestController.startDigest(currentVideoId, currentVideoUrl);
}

function showState(state, { inFlight = false } = {}) {
  stateView.show(state, { inFlight });
  headerView.setTabsVisible(state === "results");
  shellView.setChatActive(state === "results" && document.querySelector('.tab[data-tab="chat"]')?.classList.contains("active"));
  if (state !== "results") stopPlaybackTracking();
}

function showError(title, message) {
  errorAction = null;
  showState("error");
  stateView.showError(title, message);
}

function showConfigError(configStatus) {
  const missing = [];
  if (!configStatus?.hasDashscopeKey) missing.push("DashScope");
  if (!configStatus?.hasAiKey) missing.push("DeepSeek");
  showError("缺少 API Key", `请在小宇宙 Digest 设置中填写 ${missing.join(" 和 ")} API key。`);
  const button = document.getElementById("errorBtn");
  if (button) button.textContent = "打开设置";
  errorAction = () => chrome.runtime.sendMessage({ action: "openOptions" });
}

function showConfigCheckError(error) {
  showError("无法读取设置", `暂时无法验证 API Key，请稍后重试。${error ? ` ${error.message || error}` : ""}`);
  errorAction = () => void initializeConfigAndCurrentTab();
}

function renderVideoInfo() {
  headerView.setVideoInfo({ title: currentVideoTitle, channel: currentChannelName });
}

function setStartDigestAvailable(available) {
  stateView.setStartDigestAvailable(available);
}

function clearVideoInfo() {
  headerView.clearVideoInfo();
  transcriptView.clear();
}

function resetOverviewLoading() {
  Object.keys(overviewLoading).forEach((key) => { overviewLoading[key] = false; });
}

function reloadCurrentNotes() {
  notesController.reloadCurrent();
}

function setNotesFilter(showAll) {
  notesView.setFilter(showAll);
}

function loadNotes(videoId) {
  return notesController.load(notesView.isShowingAll() ? null : videoId);
}

function switchTab(tabName) {
  headerView.activateTab(tabName);
  shellView.setChatActive(tabName === "chat");
  if (tabName === "transcript" && !transcriptView.isChaptersViewActive()) startPlaybackTracking();
  else stopPlaybackTracking();
  updateBackToTopVisibility();
  if (tabName === "overview") void ensureOverviewGenerated();
  if (tabName === "chat") episodeChatController.render();
}

function toggleChaptersView() {
  transcriptView.toggleChaptersView({
    onActivateChapters: () => {
      stopPlaybackTracking();
      void generateOverviewModule("chapters");
    },
    onActivateTranscript: () => startPlaybackTracking(false),
  });
  updateBackToTopVisibility();
}

function hasOverviewTranscript() {
  return typeof currentTranscriptTimestamped === "string" && /\[\d+:\d{2}\]/.test(currentTranscriptTimestamped);
}

function setOverviewInputError(key) {
  overviewView.setError(key, "当前文字稿缺少带时间戳的内容，请点击右上角“重新识别”后再试。");
}

async function ensureOverviewGenerated() {
  if (!hasOverviewTranscript()) {
    setOverviewInputError("challenges");
    setOverviewInputError("counter");
    return;
  }
  await Promise.allSettled([generateOverviewModule("challenges"), generateOverviewModule("counter")]);
  await digestController.saveToCache(currentVideoId);
}

async function generateOverviewModule(key) {
  const module = overviewView.getModule(key);
  if (!module || overviewLoading[key]) return;
  if (!hasOverviewTranscript()) {
    setOverviewInputError(key);
    return;
  }
  currentAnalysis ||= { chapters: null, coreChallenges: null, counterIntuitive: null };
  if (Array.isArray(currentAnalysis[module.field])) return;
  const requestVideoId = currentVideoId;
  const requestAnalysis = currentAnalysis;
  overviewLoading[key] = true;
  overviewView.setLoading(key, module.loadingText);
  overviewView.setReanalyzing(key, true);
  try {
    const result = await chrome.runtime.sendMessage({
      action: "analyzeTranscript",
      module: key,
      transcriptText: currentTranscriptTimestamped,
      videoTitle: currentVideoTitle,
      channelName: currentChannelName,
      videoDescription: currentVideoDescription,
      videoDuration: currentVideoDuration,
    });
    if (requestVideoId !== currentVideoId || requestAnalysis !== currentAnalysis) return;
    if (!result?.success) {
      overviewView.setError(key, result?.message || result?.error || "分析服务未返回有效结果。");
      return;
    }
    currentAnalysis[module.field] = Array.isArray(result.items) ? result.items : [];
    overviewView.render(key, currentAnalysis[module.field]);
    await digestController.saveToCache(requestVideoId);
  } catch (error) {
    if (requestVideoId === currentVideoId && requestAnalysis === currentAnalysis) overviewView.setError(key, error.message);
  } finally {
    if (requestVideoId === currentVideoId && requestAnalysis === currentAnalysis) {
      overviewLoading[key] = false;
      overviewView.setReanalyzing(key, false);
    }
  }
}

async function reanalyzeModule(key) {
  const module = overviewView.getModule(key);
  if (!module || overviewLoading[key]) return;
  if (!hasOverviewTranscript()) {
    setOverviewInputError(key);
    return;
  }
  currentAnalysis ||= { chapters: null, coreChallenges: null, counterIntuitive: null };
  currentAnalysis[module.field] = null;
  await generateOverviewModule(key);
}

async function seekTo(seconds) {
  if (seconds === undefined || seconds === null) return;
  const payload = { action: "seekTo", seconds: Number(seconds) };
  try {
    if (xiaoyuzhouTabId) {
      try {
        await chrome.tabs.sendMessage(xiaoyuzhouTabId, payload);
        return;
      } catch (_error) {
        // The content script may be reloading. Fall back to the service worker relay.
      }
    }
    await chrome.runtime.sendMessage({ action: "relayToContent", payload });
  } catch (error) {
    console.error("[小宇宙 Digest Panel] seekTo error:", error);
  }
}

function playNote(note) {
  if (note.videoId === currentVideoId) seekTo(note.timestampSeconds);
  else chrome.tabs.create({ url: note.timestampedUrl });
}

function downloadTextFile(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function sanitizeFilename(value) {
  return (value || "untitled").replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").substring(0, 50).toLowerCase();
}

function startPlaybackTracking(autoscroll = true) {
  playbackController.start(autoscroll);
}

function stopPlaybackTracking() {
  playbackController.stop();
}

function updateBackToTopVisibility() {
  shellView.updateBackToTopVisibility(playbackController, () => transcriptView.isChaptersViewActive());
}
