const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("manifest declares a minimal Xiaoyuzhou MV3 extension", () => {
  const manifest = JSON.parse(read("manifest.json"));
  const packageJson = JSON.parse(read("package.json"));

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.minimum_chrome_version, "116");
  assert.equal(packageJson.version, manifest.version);
  assert.equal(manifest.name, "小宇宙 Digest v2.0");
  assert.equal(packageJson.name, "xiaoyuzhou-digest-v2");
  assert.equal(manifest.version, "2.0.0");
  assert.equal(manifest.options_ui.page, "dist/options.html");
  assert.ok(manifest.host_permissions.includes("https://www.xiaoyuzhoufm.com/*"));
  assert.ok(manifest.host_permissions.includes("https://dashscope.aliyuncs.com/*"));
  assert.ok(manifest.host_permissions.includes("https://api.deepseek.com/*"));
  assert.ok(manifest.permissions.includes("unlimitedStorage"));
assert.ok(!manifest.permissions.includes("activeTab"));
  assert.equal(Object.hasOwn(manifest, "optional_host_permissions"), false);
});

test("runtime has no source-file credential dependency or retired model", () => {
  const runtime = [
    "background.js",
    "content.js",
    "sidepanel.js",
    "panel/rendering-controller.js",
    "panel/digest-controller.js",
    "options.js",
    "settings.js",
  ]
    .map(read)
    .join("\n");

  assert.doesNotMatch(runtime, /\bCONFIG\./);
  assert.doesNotMatch(runtime, /importScripts\(["']config\.js/);
  assert.doesNotMatch(runtime, /\bdeepseek-chat\b/);
  assert.match(runtime, /deepseek-v4-flash/);
  assert.doesNotMatch(runtime, /bld_notes|BLD_SETTINGS|bilibili\.com/);
});

test("background fetches transcripts through a configurable DashScope ASR model", () => {
  const background = read("background.js");

  assert.match(background, /paraformer-v2/);
  assert.match(background, /fun-asr/);
  assert.match(background, /settings\.asrModel/);
  assert.match(background, /message\.force/);
  assert.match(background, /diarization_enabled/);
  assert.match(background, /X-DashScope-Async/);
  assert.match(background, /function parseSentences\(/);
  assert.match(background, /function buildTranscript\(/);
  assert.match(background, /function buildTranscriptSample\(/);
  assert.match(background, /function identifySpeakers\(/);
  assert.match(background, /function speakerDisplayName\(/);
  assert.match(background, /function findTranscriptionUrl\(/);
  assert.match(background, /function resolveDiarization\(/);
  assert.match(background, /function detectConversation\(/);
  assert.match(background, /estimateTranscribeSeconds/);
  assert.match(background, /transcriptProgress/);
  assert.match(background, /NOTES_STORAGE_KEY/);
  assert.match(background, /cancelTranscript/);
  assert.match(background, /AbortController/);
  assert.match(background, /TRANSCRIPTION_CANCELED/);
});

test("background handles podcast episode list requests", () => {
  const background = read("background.js");

  assert.match(background, /message\.action === "fetchPodcastEpisodes"/);
  assert.match(background, /function handleFetchPodcastEpisodes\(/);
  assert.match(background, /function fetchXiaoyuzhouPodcastHtml\(/);
  assert.match(background, /function parsePodcastEpisodesPage\(/);
  assert.match(background, /function normalizePodcastEpisodes\(/);
  assert.match(background, /props\?\.pageProps\?\.podcast/);
  assert.match(background, /function getNextDataBuildId\(/);
  assert.match(background, /function fetchNextPodcastData\(/);
  assert.match(background, /function parseEmbeddedJsonPayloads\(/);
  assert.match(background, /function parsePodcastPageMetadata\(/);
  assert.match(background, /function parseEpisodeLinksFromHtml\(/);
  assert.match(background, /episodePodcast\.title/);
  assert.match(background, /function isXiaoyuzhouObjectId\(/);
  assert.match(background, /episodeIdOf/);
  assert.match(background, /episodeArray/);
  assert.match(background, /function extractImageUrl\(/);
  assert.match(background, /extractImageUrl\(item\)/);
});

test("history podcast requests use the selected podcast instead of the current episode", () => {
  const library = read("panel/library-controller.js");

  assert.match(library, /const isBrowsingAnotherPodcast = Boolean\(activePodcastPid && activePodcastPid !== currentPodcastId\)/);
  assert.match(library, /episodeId: isBrowsingAnotherPodcast \? "" : currentVideoId/);
  assert.match(library, /podcastId: podcastId \|\| currentPodcastId/);
  assert.match(library, /Array\.isArray\(cached\.episodes\) && cached\.episodes\.length/);
  assert.match(library, /!Array\.isArray\(result\.episodes\) \|\| !result\.episodes\.length/);
});

test("browsed podcasts preserve metadata and repair prior incomplete entries", () => {
  const library = read("panel/library-controller.js");

  assert.match(library, /function buildPodcastRecord\(/);
  assert.match(library, /title: firstNonEmptyText\(data\?\.title, fallback\?\.title, existing\?\.title\)/);
  assert.match(library, /image: firstNonEmptyText\(data\?\.coverImage, data\?\.image, fallback\?\.image, existing\?\.image\)/);
  assert.match(library, /async function backfillBrowsedPodcastMetadata\(/);
  assert.match(library, /PODCAST_METADATA_BACKFILL_LIMIT = 6/);
  assert.match(library, /entries = await backfillBrowsedPodcastMetadata\(entries\)/);
  assert.match(library, /title: podcast\.title \|\| podcast\.author \|\| "未命名节目"/);
});

test("current episode context accepts alternate podcast id fields", () => {
  const content = read("content.js");

  assert.match(content, /episode\.podcast\?\.pid \|\| episode\.podcast\?\.id \|\| episode\.pid/);
});

test("background falls back to enabling diarization for guest/conversation signals", () => {
  const background = read("background.js");

  assert.match(background, /function weaklySignalsConversation\(/);
  // 保守兜底：AI 判成非对谈，但标题/简介含「对谈 XX」「对话」等信号时仍开启分离。
  assert.match(background, /weaklySignalsConversation\(page\)/);
  assert.match(background, /dialog|对谈|访谈|嘉宾|圆桌|连麦|做客|主播/);
});

test("sidepanel initializes an injected rendering controller", () => {
  const html = read("sidepanel.html");
  const sidepanel = read("sidepanel.js");
  const rendering = read("panel/rendering-controller.js");

  assert.match(html, /src="panel\/rendering-controller\.js"/);
  assert.match(sidepanel, /XYZ_RENDERING_CONTROLLER\.create\(\{/);
  assert.match(sidepanel, /const getState = \(\) => \(\{/);
  assert.match(rendering, /function create\(\{[\s\S]*?getState,[\s\S]*?seekTo,[\s\S]*?startPlaybackTracking,[\s\S]*?reloadNotes,/);
  assert.match(rendering, /function renderChapters\(/);
  assert.match(rendering, /function renderTranscript\(/);
  assert.match(rendering, /function exportTranscript\(/);
  assert.match(rendering, /function createCardNoteButton\(/);
});

test("digest controller owns injected detection, tab tracking, and transcription orchestration", () => {
  const html = read("sidepanel.html");
  const sidepanel = read("sidepanel.js");
  const controller = read("panel/digest-controller.js");

  assert.match(html, /src="panel\/digest-controller\.js"/);
  assert.match(sidepanel, /XYZ_DIGEST_CONTROLLER\.create\(\{/);
  assert.match(sidepanel, /digestController\.initTabTracking\(\)/);
  assert.match(sidepanel, /digestController\.checkCurrentTab\(\)/);
  assert.doesNotMatch(sidepanel, /async function checkCurrentTab\(/);
  assert.doesNotMatch(sidepanel, /async function startDigest\(/);
  assert.match(controller, /function create\(\{ getState, setState, ui, storage, library, debugLog \}\)/);
  assert.match(controller, /async function checkCurrentTab\(/);
  assert.match(controller, /function initTabTracking\(/);
  assert.match(controller, /async function startDigest\(/);
  assert.match(controller, /async function retranscribe\(/);
  assert.match(controller, /async function stopTranscription\(/);
  assert.match(controller, /function clearForInactiveTab\(/);
  assert.match(controller, /async function startCurrentDigest\(/);
  assert.match(controller, /ASR 由用户明确点击后才发起/);
  assert.match(controller, /返回曾完成转录的单集时，优先恢复持久缓存/);
  assert.match(controller, /const cached = await storage\.load\(videoId\)/);
  assert.match(controller, /await restoreCachedDigest\(videoId, tab\.url, cached\)/);
  assert.match(controller, /let tab = null;[\s\S]*?tab = tabs\[0\] \|\| null/);
  assert.match(controller, /ui\.clearVideoInfo\(\)/);
assert.match(controller, /let cached = null;[\s\S]*?if \(!force\)[\s\S]*?cached = await storage\.load\(videoId\)/);
assert.match(controller, /原有文字稿会保留到新识别成功/);
  assert.match(controller, /已停止重新识别，正在继续使用原有文字稿/);
});

test("opening a Xiaoyuzhou episode waits for an explicit manual start", () => {
const html = read("sidepanel.html");
const sidepanel = read("sidepanel.js");
const background = read("background.js");
const controller = read("panel/digest-controller.js");

assert.match(html, /id="startDigestBtn"[\s\S]*?开始获取/);
assert.match(html, /src="assets\/manual-start\.png"/);
assert.match(sidepanel, /digestController\.startCurrentDigest\(\)/);
assert.match(html, /src="panel\/views\/state-view\.js"/);
assert.match(sidepanel, /stateView\.setStartDigestAvailable\(available\)/);
assert.doesNotMatch(background, /sendMessage\(\{ action: "startDigestFromButton" \}\)/);
assert.match(controller, /syncState\("loading"\)[\s\S]*?await storage\.load\(videoId\)/);
assert.match(controller, /await checkCurrentTab\(\);[\s\S]*?ui\.showError\("未找到可转录的单集"/);
assert.match(controller, /if \(!result\?\.success\)/);
});

test("side panel disables itself outside Xiaoyuzhou and distinguishes configuration read failures", () => {
const background = read("background.js");
const sidepanel = read("sidepanel.js");

assert.match(background, /enabled: isXiaoyuzhou/);
assert.match(background, /success: true,[\s\S]*?hasDashscopeKey/);
assert.match(background, /success: false,[\s\S]*?无法读取扩展设置/);
assert.match(sidepanel, /function checkConfigWithRetry\(\)/);
assert.match(sidepanel, /CONFIG_CHECK_MAX_ATTEMPTS = 3/);
assert.match(sidepanel, /waitForConfigRetry\(CONFIG_CHECK_RETRY_DELAY_MS \* \(attempt \+ 1\)\)/);
assert.match(sidepanel, /function initializeConfigAndCurrentTab\(\)/);
assert.match(sidepanel, /function showConfigCheckError\(error\)/);
assert.match(sidepanel, /errorAction = \(\) => void initializeConfigAndCurrentTab\(\)/);
});

test("settings save preserves existing API keys when password fields are empty", () => {
const options = read("options.js");

assert.match(options, /let loadedSettings = null/);
assert.match(options, /const persisted = settingsApi\.normalize\(stored\[settingsApi\.STORAGE_KEY\]\)/);
assert.match(options, /persisted\.dashscopeApiKey \|\| loadedSettings\?\.dashscopeApiKey \|\| ""/);
assert.match(options, /dashscopeApiKeyInput\.value\.trim\(\) \|\| existing\.dashscopeApiKey/);
assert.match(options, /aiApiKeyInput\.value\.trim\(\) \|\| existing\.aiApiKey/);
assert.match(options, /已保留现有 API 密钥/);
});

test("published prompt files contain runtime sections and no translation prompt", () => {
  const expectedSections = {
    "prompts/analysis-chapters.md": ["System prompt", "User prompt"],
    "prompts/analysis-challenges.md": ["System prompt", "User prompt"],
    "prompts/analysis-counter.md": ["System prompt", "User prompt"],
    "prompts/explain.md": ["System prompt", "User prompt"],
    "prompts/note-cleanup.md": ["System prompt", "User prompt"],
    "prompts/diarization.md": ["System prompt", "User prompt"],
    "prompts/speakers.md": ["System prompt", "User prompt"],
  };

  for (const [file, sections] of Object.entries(expectedSections)) {
    const markdown = read(file);
    for (const section of sections) {
      assert.match(markdown, new RegExp(`^## ${section}$`, "m"));
    }
  }

  assert.equal(fs.existsSync(path.join(root, "prompts/translation.md")), false);
});

test("notes filters preserve selected contrast and expose pressed state", () => {
  const html = read("sidepanel.html");
  const css = read("styles/notes.css");
  const js = read("sidepanel.js");
  const notesView = read("panel/views/notes-view.js");

  assert.match(
    html,
    /id="notesFilterThis"[\s\S]*?aria-pressed="true"[\s\S]*?>[\s\S]*?本单集/,
  );
  assert.match(
    html,
    /id="notesFilterAll"[\s\S]*?aria-pressed="false"[\s\S]*?>[\s\S]*?全部笔记/,
  );
  assert.match(js, /notesView\.setFilter\(showAll\)/);
  assert.match(notesView, /function setFilter\(showAll\)/);
  assert.match(notesView, /setAttribute\("aria-pressed", String\(!showAll\)\)/);
  assert.match(notesView, /setAttribute\("aria-pressed", String\(showAll\)\)/);
  assert.match(css, /\.notes-filter \.enhance-btn\.active/);
});

test("digest controller supports stopping ASR and preserves the old transcript during re-transcription", () => {
  const html = read("sidepanel.html");
  const js = read("sidepanel.js");
  const controller = read("panel/digest-controller.js");

  assert.match(html, /id="retranscribeBtn"/);
  assert.match(html, /id="stopTranscriptionBtn"/);
  assert.match(js, /digestController\.retranscribe\(\)/);
  assert.match(js, /digestController\.stopTranscription\(\)/);
  assert.match(controller, /action: "cancelTranscript"/);
  assert.match(controller, /原有文字稿会保留到新识别成功/);
assert.match(controller, /已停止重新识别，正在继续使用原有文字稿/);
assert.match(controller, /let retranscriptionFallback = null/);
assert.match(controller, /const cached = await storage\.load\(currentVideoId\)/);
assert.match(controller, /update\(retranscriptionFallback\)/);
assert.match(controller, /currentAsrModel/);
});

test("transcript cache preserves old records instead of silently evicting them", () => {
const storage = read("panel/storage-repository.js");

assert.match(storage, /function hasTranscript\(cached\)/);
assert.match(storage, /async function loadDigest\(episodeId\)/);
assert.doesNotMatch(storage, /CACHE_TTL_MS|CACHE_MAX_ENTRIES|chrome\.storage\.local\.remove/);
});

test("opening a history entry restores its cached digest before page navigation settles", () => {
  const controller = read("panel/digest-controller.js");
  const library = read("panel/library-controller.js");
  const rendering = read("panel/rendering-controller.js");
  const playback = read("panel/playback-controller.js");
  const css = read("styles/transcript.css");

  assert.match(library, /await restoreHistoryEpisode\?\.\(videoId\);[\s\S]*?await openEpisodeUrl\(videoId, "Open history episode"\)/);
  assert.match(controller, /async function restoreHistoryEpisode\(videoId\)[\s\S]*?const cached = await storage\.load\(videoId\)[\s\S]*?restoreCachedDigest\(videoId, XYZ_DOMAIN\.canonicalEpisodeUrl\(videoId\), cached\)/);
  assert.match(controller, /changeInfo\.status === "complete"[\s\S]*?handleFrontTabUrl\(tab\.url \|\| tab\.pendingUrl \|\| "", tabId, true\)/);
  assert.match(controller, /setTimeout\(\(\) => void checkCurrentTab\(tabId\), 600\)/);
  assert.match(controller, /function rebuildCachedTranscript\(/);
  assert.match(controller, /function rebuildPlainTextTranscript\(/);
  assert.match(controller, /currentTranscript: restoredTranscript\.length \? restoredTranscript : null/);
  assert.match(rendering, /transcript-entry--untimed/);
  assert.match(rendering, /if \(row\.hasTimestamp !== false\) seekTo\(row\.start\)/);
  assert.match(playback, /\.transcript-entry\[data-seconds\]/);
  assert.match(css, /\.transcript-entry--untimed/);
});

test("overview analysis accepts recovered timestamped transcripts and common model result shapes", () => {
const sidepanel = read("sidepanel.js");
const controller = read("panel/digest-controller.js");
const background = read("background.js");

assert.match(sidepanel, /function hasOverviewTranscript\(\)/);
assert.match(sidepanel, /setOverviewInputError/);
assert.match(controller, /function resolveTimestampedTranscript\(/);
assert.match(controller, /function buildTimestampedTranscript\(/);
assert.match(background, /function validateModuleItems\(/);
assert.match(background, /core_challenges/);
assert.match(background, /counter_intuitive/);
assert.match(background, /parseTimestampSeconds/);
});

test("episode chat uses the current timestamped transcript and DeepSeek conversation history", () => {
  const html = read("sidepanel.html");
  const sidepanel = read("sidepanel.js");
  const chat = read("panel/episode-chat-controller.js");
  const background = read("background.js");
  const content = read("content.js");
  const domain = read("shared/domain.js");
  const css = read("styles/chat.css");

  assert.match(html, /data-tab="overview">精选[\s\S]*?data-tab="chat">问答[\s\S]*?data-tab="notes">笔记/);
  assert.match(html, /id="episodeChatForm"/);
  assert.match(html, /id="episodeChatInput"/);
  assert.match(html, /id="episodeChatMessages"/);
  assert.match(html, /id="clearEpisodeChatBtn"/);
  assert.match(domain, /ASK_EPISODE_QUESTION: "askEpisodeQuestion"/);
  assert.match(domain, /EPISODE_CHAT_STREAM: "episodeChatStream"/);
  assert.match(sidepanel, /XYZ_EPISODE_CHAT_CONTROLLER\.create\(/);
  assert.match(chat, /function hasTranscript\(\)/);
  assert.match(chat, /async function sendQuestion\(/);
  assert.match(chat, /chrome\.runtime\.connect\(\{ name: XYZ_DOMAIN\.PORTS\.EPISODE_CHAT_STREAM \}\)/);
  assert.match(chat, /message\?\.type === "chunk"/);
  assert.match(chat, /assistant\.content \+= String\(message\.content \|\| ""\)/);
  assert.match(chat, /transcriptText: state\.currentTranscriptTimestamped/);
  assert.match(chat, /conversation,/);
  assert.match(chat, /function timestampToSeconds\(/);
  assert.match(chat, /function appendTimestamp\([\s\S]*?timestamp\.addEventListener\("click", \(\) => \{[\s\S]*?seekTo\(seconds\)/);
  assert.match(content, /if \(message\.action === "seekTo"\) \{[\s\S]*?seekToTimestamp\(message\.seconds\)/);
  assert.match(content, /function seekToTimestamp\(seconds\) \{[\s\S]*?audio\.currentTime = seconds;[\s\S]*?audio\.play\(\)/);
  assert.match(sidepanel, /currentVideoId !== previousVideoId\) episodeChatController\.reset\(\)/);
  assert.match(background, /chrome\.runtime\.onConnect\.addListener/);
  assert.match(background, /handleAskEpisodeQuestionStream/);
  assert.match(background, /async function requestAiCompletionStream\(/);
  assert.match(background, /stream: true/);
  assert.match(background, /text\/event-stream/);
  assert.match(background, /normalizeEpisodeChatHistory/);
  assert.match(background, /requestAiCompletion\(/);
  assert.match(background, /EPISODE_CHAT_MAX_TRANSCRIPT_CHARS/);
  assert.match(background, /不可信资料/);
  assert.match(css, /\.episode-chat-composer/);
  assert.match(css, /\.episode-chat-timestamp/);
  assert.match(css, /\.episode-chat-message--streaming/);
});

test("saved notes are retained until the user deletes them", () => {
const background = read("background.js");

assert.match(background, /const NOTES_STORAGE_KEY = XYZ_DOMAIN\.STORAGE_KEYS\.NOTES/);
assert.match(background, /function normalizeStoredNotes\(/);
assert.match(background, /function sortNotesNewestFirst\(/);
assert.doesNotMatch(background, /notes\.splice\(100\)|notes\.length > 100/);
});

test("retired Remix and reader files are absent", () => {
  for (const file of [
    "reader.html",
    "reader.js",
    "remix-prompts.js",
    "config.example.js",
  ]) {
    assert.equal(fs.existsSync(path.join(root, file)), false, file);
  }
});
