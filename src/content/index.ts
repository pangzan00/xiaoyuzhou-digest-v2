/**
 * CONTENT SCRIPT
 *
 * 运行在小宇宙单集页上，负责：
 * 1. 从页面的 __NEXT_DATA__ 提取单集信息（标题、播客名、简介、时长）
 * 2. 注入「Digest」浮动按钮（打开侧边栏）
 * 3. 注入「记笔记」浮动按钮（保存带时间戳的笔记）
 * 4. 控制音频播放器的跳转、读取播放进度
 */

import type { EpisodeInfo } from '../types';

// Content scripts are loaded as classic scripts by Chrome, so keep these
// small helpers local instead of importing an ESM shared chunk.
function extractEpisodeId(url: string): string | null {
  try {
    const match = new URL(url).pathname.match(/\/episode\/([0-9a-fA-F]{24})/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function cleanEpisodeTitle(title: string): string {
  return String(title || '')
    .replace(/\s*[-–—|·:]\s*听播客[，,\s]*上小宇宙\s*$/i, '')
    .replace(/\s*听播客[，,\s]*上小宇宙\s*$/i, '')
    .replace(/\s*[-–—|·:]\s*(小宇宙|xiaoyuzhoufm\.com)\s*$/i, '')
    .replace(/\s*(小宇宙|xiaoyuzhoufm\.com)\s*$/i, '')
    .trim();
}

// ============================================================
// CONSTANTS
// ============================================================

const DEBUG = false;
const ACCENT = '#25B4E1';
const ACCENT_HOVER = '#1a97bf';

const debugLog = (...args: unknown[]) => {
  if (DEBUG) console.log('[小宇宙 Digest v2.0 Content]', ...args);
};

// 倍速档位：直接平铺展示，不做下拉。
interface SpeedOption {
  value: number;
  label: string;
}

const SPEED_OPTIONS: SpeedOption[] = [
  { value: 1, label: '1.0x' },
  { value: 1.25, label: '1.25x' },
  { value: 1.5, label: '1.5x' },
  { value: 2, label: '2.0x' },
];

// ============================================================
// GLOBAL STATE
// ============================================================

let xyzDigestButton: HTMLButtonElement | null = null;
let xyzNoteButton: HTMLButtonElement | null = null;
let xyzNoteButtonTimer: ReturnType<typeof setTimeout> | null = null;
let xyzNoteKeyboardListenerAdded = false;
let xyzSpeedControl: HTMLDivElement | null = null;
let lastKnownUrl = window.location.href;
let navigationPollTimer: ReturnType<typeof setInterval> | null = null;

// ============================================================
// HELPERS
// ============================================================

function isEpisodePage(): boolean {
  return /^\/episode\/[0-9a-fA-F]+/.test(window.location.pathname);
}

function getAudioElement(): HTMLAudioElement | null {
  return document.querySelector('audio');
}

function escapeHtmlForContent(text: string): string {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

function showDigestOpenError(message: string): void {
  const existing = document.getElementById('xyz-digest-error-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'xyz-digest-error-toast';
  toast.textContent = message;
  Object.assign(toast.style, {
    position: 'fixed',
    right: '20px',
    bottom: '20px',
    zIndex: '100000',
    maxWidth: '340px',
    padding: '12px 16px',
    borderRadius: '10px',
    background: '#b42318',
    color: '#ffffff',
    fontFamily: 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
    fontSize: '13px',
    lineHeight: '1.5',
    boxShadow: '0 8px 24px rgba(180, 35, 24, 0.3)',
  });
  document.body.appendChild(toast);
  window.setTimeout(() => toast.remove(), 4000);
}

// ============================================================
// INITIALIZATION
// ============================================================

function init(): void {
  if (!xyzNoteKeyboardListenerAdded) {
    document.addEventListener('keydown', handleNoteKeyboardShortcut);
    xyzNoteKeyboardListenerAdded = true;
  }

  // 站点自身或用户改倍速时（ratechange 不冒泡，用捕获阶段监听），同步高亮。
  document.addEventListener(
    'ratechange',
    (e) => {
      if (e.target && (e.target as HTMLElement).tagName === 'AUDIO')
        updateSpeedActive();
    },
    true
  );

  injectDigestButton();
  injectNoteButton();
  injectSpeedControl();
  setupNavigationDetection();
  handleNoteTimestampHash();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// ============================================================
// MESSAGE HANDLING
// ============================================================

chrome.runtime.onMessage.addListener(
  (message, _sender, sendResponse) => {
    debugLog('Received message:', message.action, message);

    switch (message.action) {
      case 'ping':
        // 后台用它判断本脚本是否存活（扩展重载后旧脚本会失联）。
        sendResponse({ ok: true });
        return false;

      case 'getVideoInfo':
        sendResponse(extractVideoInfo());
        return false;

      case 'highlightMoments':
        sendResponse({ success: true });
        return false;

      case 'getCurrentTime': {
        const audio = getAudioElement();
        sendResponse({
          currentTime: audio ? audio.currentTime : 0,
          paused: audio ? audio.paused : true,
        });
        return false;
      }

      case 'seekTo': {
        const seconds = Number(message.seconds) || 0;
        const audio = getAudioElement();
        console.warn(
          '[Digest 诊断][页面]',
          `收到 seekTo(${seconds}s)；音频元素: ${audio ? '已找到' : '未找到'}；页面路径: ${window.location.pathname}`
        );
        if (audio) {
          performSeek(audio, seconds);
          sendResponse({
            success: true,
            audioFound: true,
            readyState: audio.readyState,
            currentTime: audio.currentTime,
          });
        } else {
          // 音频元素可能还没挂载，后台重试。
          void seekWithRetry(seconds);
          sendResponse({ success: true, audioFound: false, detail: '音频元素未挂载，正在轮询重试' });
        }
        return false;
      }

      case 'showNoteSavedFeedback':
        showNoteSavedToast(message.note);
        sendResponse({ success: true });
        return false;

      default:
        sendResponse({ success: false, error: 'Unknown action' });
        return false;
    }
  }
);

// ============================================================
// FLOATING BUTTONS
// ============================================================

function createFloatingButton(
  id: string,
  label: string,
  top: number,
  icon: string
): HTMLButtonElement {
  const button = document.createElement('button');
  button.id = id;
  button.type = 'button';
  button.setAttribute('aria-label', label);
  button.innerHTML = icon + `<span>${label}</span>`;

  Object.assign(button.style, {
    position: 'fixed',
    right: '20px',
    top: `${top}px`,
    zIndex: '99999',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '10px 16px',
    border: 'none',
    borderRadius: '999px',
    background: ACCENT,
    color: 'white',
    fontFamily:
      'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
    fontSize: '13px',
    fontWeight: '700',
    cursor: 'pointer',
    boxShadow: '0 4px 14px rgba(37, 180, 225, 0.35)',
    transition: 'background 0.18s ease, transform 0.18s ease, box-shadow 0.18s ease',
  });

  button.addEventListener('mouseenter', () => {
    button.style.background = ACCENT_HOVER;
    button.style.boxShadow = '0 6px 18px rgba(37, 180, 225, 0.4)';
    button.style.transform = 'translateY(-1px)';
  });

  button.addEventListener('mouseleave', () => {
    button.style.background = ACCENT;
    button.style.boxShadow = '0 4px 14px rgba(37, 180, 225, 0.35)';
    button.style.transform = 'translateY(0)';
  });

  document.body.appendChild(button);
  return button;
}

function injectDigestButton(): void {
  const existing = document.getElementById('xyz-digest-button');
  if (existing) existing.remove();
  if (!isEpisodePage()) return;

  xyzDigestButton = createFloatingButton(
    'xyz-digest-button',
    'Digest',
    76,
    '<span style="font-size:12px;">▶</span>'
  );

  xyzDigestButton.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const result = await chrome.runtime.sendMessage({ action: 'openSidePanel' });
      if (!result?.success) {
        throw new Error(result?.error || '无法打开 Digest 侧边栏。');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '无法打开 Digest 侧边栏。';
      console.error('[小宇宙 Digest v2.0] Failed to open side panel:', err);
      showDigestOpenError(message);
    }
  });
}

function injectNoteButton(): void {
  const existing = document.getElementById('xyz-note-button');
  if (existing) existing.remove();
  if (!isEpisodePage()) return;

  xyzNoteButton = createFloatingButton(
    'xyz-note-button',
    '记笔记',
    20,
    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="flex:0 0 auto;">
      <path d="M12 20h9"></path>
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
    </svg>`
  );

  xyzNoteButton.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await saveCurrentNote();
  });
}

// ============================================================
// PLAYBACK SPEED — 页面上的浮动倍速按钮
// ============================================================

function injectSpeedControl(): void {
  const existing = document.getElementById('xyz-speed-control');
  if (existing) existing.remove();
  if (!isEpisodePage()) return;

  const container = document.createElement('div');
  container.id = 'xyz-speed-control';
  container.setAttribute('aria-label', '播放倍速');

  Object.assign(container.style, {
    position: 'fixed',
    right: '20px',
    top: '132px',
    zIndex: '99999',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '2px',
    padding: '4px',
    background: '#ffffff',
    border: '1px solid #e1e1e1',
    borderRadius: '999px',
    boxShadow: '0 4px 14px rgba(0, 0, 0, 0.12)',
  });

  SPEED_OPTIONS.forEach((option) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = option.label;
    btn.dataset.speed = String(option.value);

    Object.assign(btn.style, {
      padding: '6px 10px',
      border: 'none',
      borderRadius: '999px',
      background: 'transparent',
      color: '#555555',
      fontFamily:
        'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
      fontSize: '12px',
      fontWeight: '600',
      cursor: 'pointer',
      transition: 'background 0.18s ease, color 0.18s ease',
    });

    btn.addEventListener('click', () => {
      setPlaybackRate(option.value);
      updateSpeedActive();
    });

    container.appendChild(btn);
  });

  document.body.appendChild(container);
  xyzSpeedControl = container;
  updateSpeedActive();
}

function setPlaybackRate(rate: number): void {
  const audio = getAudioElement();
  if (!audio) return;
  try {
    audio.playbackRate = rate;
  } catch (e) {
    console.error('[小宇宙 Digest v2.0] 设置倍速失败:', e);
  }
}

function updateSpeedActive(): void {
  if (!xyzSpeedControl) return;
  const audio = getAudioElement();
  const currentRate = audio ? audio.playbackRate : 1;

  xyzSpeedControl.querySelectorAll('button').forEach((btn) => {
    const isActive =
      Math.abs(Number(btn.dataset.speed) - currentRate) < 0.01;
    btn.style.background = isActive ? ACCENT : 'transparent';
    btn.style.color = isActive ? '#ffffff' : '#555555';
  });
}

// ============================================================
// NAVIGATION DETECTION（小宇宙是 Next.js SPA）
// ============================================================

function setupNavigationDetection(): void {
  window.addEventListener('popstate', onNavigated);
  navigationPollTimer = setInterval(() => {
    if (window.location.href !== lastKnownUrl) {
      lastKnownUrl = window.location.href;
      onNavigated();
    }
  }, 500);
}

function onNavigated(): void {
  document.getElementById('xyz-digest-button')?.remove();
  document.getElementById('xyz-note-button')?.remove();
  document.getElementById('xyz-speed-control')?.remove();
  xyzDigestButton = null;
  xyzNoteButton = null;
  xyzSpeedControl = null;

  setTimeout(() => {
    injectDigestButton();
    injectNoteButton();
    injectSpeedControl();
  }, 500);

  // 从笔记跳转过来（SPA 导航或带 hash 的新页面）时，定位到对应时间点。
  setTimeout(handleNoteTimestampHash, 600);
}

// ============================================================
// NOTE JUMP（从侧边栏历史笔记跳转：URL 带 #xyz-note-t=<秒>）
// ============================================================

const NOTE_HASH_PREFIX = '#xyz-note-t=';

function handleNoteTimestampHash(): void {
  if (!window.location.hash.startsWith(NOTE_HASH_PREFIX)) return;

  const seconds = Math.max(0, Math.floor(Number(window.location.hash.slice(NOTE_HASH_PREFIX.length)) || 0));

  // 清理 hash，避免刷新/前进后退后重复跳转。
  try {
    history.replaceState(null, '', window.location.pathname + window.location.search);
  } catch {
    // ignore
  }

  if (!seconds) return;

  // 音频元素可能延迟渲染，轮询等待后再 seek + 播放。
  void seekWithRetry(seconds);
}

// ============================================================
// NOTE SAVING
// ============================================================

function handleNoteKeyboardShortcut(e: KeyboardEvent): void {
  if (!isEpisodePage()) return;
  if (e.key !== 'n' && e.key !== 'N') return;

  const active = document.activeElement;
  if (
    active &&
    ((active.tagName === 'INPUT' ||
      active.tagName === 'TEXTAREA' ||
      (active as HTMLElement).isContentEditable) as boolean)
  ) {
    return;
  }

  e.preventDefault();
  e.stopPropagation();
  saveCurrentNote();
}

async function saveCurrent(): Promise<void> {
  const audio = getAudioElement();
  if (!audio) {
    console.error('[小宇宙 Digest v2.0] 未找到音频元素');
    return;
  }

  // 回退 3 秒，捕捉刚刚说过的话（用户听到后才反应）。
  const currentTime = Math.max(0, Math.floor(audio.currentTime) - 3);
  const videoInfo = extractVideoInfo();
  const episodeId = extractEpisodeId(window.location.href);

  const noteButton = xyzNoteButton;
  const originalContent = noteButton ? noteButton.innerHTML : '';

  if (noteButton) {
    noteButton.innerHTML = '<span style="letter-spacing: 0.2px;">保存中...</span>';
    (noteButton as HTMLElement).style.pointerEvents = 'none';
  }

  try {
    const result = await chrome.runtime.sendMessage({
      action: 'saveNote',
      videoId: episodeId,
      timestamp: currentTime,
      videoTitle: videoInfo.title,
      channelName: videoInfo.channelName,
    });

    if (result.success) {
      if (noteButton) {
        noteButton.innerHTML = '<span style="letter-spacing: 0.2px;">已保存</span>';
      }
      showNoteSavedToast(result.note);
    } else {
      if (noteButton) {
        noteButton.innerHTML = '<span style="letter-spacing: 0.2px;">出错</span>';
      }
      console.error('[小宇宙 Digest v2.0] Save note error:', result.error);
    }
  } catch (err) {
    if (noteButton) {
      noteButton.innerHTML = '<span style="letter-spacing: 0.2px;">出错</span>';
    }
    console.error('[小宇宙 Digest v2.0] Save note exception:', err);
  }

  setTimeout(() => {
    if (noteButton) {
      noteButton.innerHTML = originalContent;
      (noteButton as HTMLElement).style.pointerEvents = 'auto';
    }
  }, 2000);
}

// Alias for export
export const saveCurrentNote = saveCurrent;

function showNoteSavedToast(note: { timestamp: string; videoTitle: string; text: string }): void {
  const existing = document.getElementById('xyz-note-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'xyz-note-toast';
  toast.innerHTML = `
    <div style="font-weight: 700; margin-bottom: 6px; color: #111111;">📝 笔记已保存</div>
    <div style="font-size: 12px; color: #555555; margin-bottom: 8px;">${escapeHtmlForContent(note.timestamp)} — ${escapeHtmlForContent(note.videoTitle)}</div>
    <div style="font-size: 13px; line-height: 1.55; color: #111111;">"${escapeHtmlForContent(note.text)}"</div>
  `;

  Object.assign(toast.style, {
    position: 'fixed',
    bottom: '20px',
    right: '20px',
    zIndex: '999999',
    background: '#ffffff',
    border: '1px solid #e1e1e1',
    borderRadius: '14px',
    padding: '16px 20px',
    maxWidth: '350px',
    boxShadow: '0 12px 32px rgba(0, 0, 0, 0.16)',
    fontFamily:
      'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
    animation: 'xyzSlideIn 0.3s ease',
  });

  const style = document.createElement('style');
  style.textContent = `
    @keyframes xyzSlideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
  `;
  document.head.appendChild(style);

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'xyzSlideIn 0.3s ease reverse';
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}

// ============================================================
// INFO EXTRACTION（优先 __NEXT_DATA__，兼容新版页面结构并回退 DOM 元信息）
// ============================================================

type MetadataRecord = Record<string, unknown>;

function asMetadataRecord(value: unknown): MetadataRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as MetadataRecord
    : null;
}

/** 小宇宙部分页面会把文本包在 { text/value } 对象中，不能直接 String(value)。 */
function readMetadataText(value: unknown, depth = 0): string {
  if (typeof value === 'string') return value.trim();
  if (depth >= 2 || !value || typeof value !== 'object') return '';
  const record = asMetadataRecord(value);
  if (!record) return '';
  for (const key of ['text', 'value', 'content', 'name', 'title']) {
    const text = readMetadataText(record[key], depth + 1);
    if (text) return text;
  }
  return '';
}

function readMetadataField(source: MetadataRecord | null, keys: string[]): string {
  if (!source) return '';
  for (const key of keys) {
    const text = readMetadataText(source[key]);
    if (text) return text;
  }
  return '';
}

function collectMetadataObjects(root: unknown): MetadataRecord[] {
  const objects: MetadataRecord[] = [];
  const visited = new WeakSet<object>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const record = value as MetadataRecord;
    objects.push(record);
    Object.values(record).forEach(visit);
  };
  visit(root);
  return objects;
}

const EPISODE_TITLE_FIELDS = ['title', 'episodeTitle', 'episode_title', 'name'];
const EPISODE_ID_FIELDS = ['eid', 'episodeId', 'episode_id'];

/**
 * 仅把真正的单集对象作为匹配结果。
 *
 * Next.js 的 pageProps 及评论 owner 也会带与当前地址相同的 `id`；它们并不是单集，
 * 若只按 id 深度优先查找，容易先命中外层 pageProps，进而丢失 title。
 */
function isCurrentEpisodeRecord(source: MetadataRecord, episodeId: string): boolean {
  if (!episodeId) return false;
  const normalizedId = episodeId.toLowerCase();
  const episodeSpecificId = readMetadataField(source, EPISODE_ID_FIELDS).toLowerCase();
  if (episodeSpecificId === normalizedId) return true;

  const objectId = readMetadataField(source, ['id']).toLowerCase();
  const type = readMetadataField(source, ['type']).toLowerCase();
  return objectId === normalizedId && /episode/.test(type);
}

function episodeRecordScore(source: MetadataRecord, episodeId: string): number {
  let score = 0;
  const normalizedId = episodeId.toLowerCase();
  if (readMetadataField(source, EPISODE_ID_FIELDS).toLowerCase() === normalizedId) score += 100;
  if (readMetadataField(source, ['type']).toLowerCase() === 'episode') score += 40;
  if (readMetadataField(source, EPISODE_TITLE_FIELDS)) score += 20;
  if (source.enclosure || source.media || source.audioUrl || source.audio_url) score += 10;
  return score;
}

function findEpisodeRecord(data: unknown, episodeId: string): MetadataRecord | null {
  const root = asMetadataRecord(data);
  const props = asMetadataRecord(root?.props);
  const pageProps = asMetadataRecord(props?.pageProps);

  // 小宇宙当前页面在 pageProps.episode 提供完整单集对象；先读取确定路径，
  // 不让同一树中无标题的 pageProps / 评论对象抢占结果。
  const directCandidates = [
    asMetadataRecord(pageProps?.episode),
    asMetadataRecord(root?.episode),
  ].filter((item): item is MetadataRecord => Boolean(item));
  const directEpisode = directCandidates.find((item) =>
    !episodeId || isCurrentEpisodeRecord(item, episodeId)
  );
  if (directEpisode) return directEpisode;

  const objects = collectMetadataObjects(data);
  const matches = objects
    .filter((item) => isCurrentEpisodeRecord(item, episodeId))
    .sort((left, right) => episodeRecordScore(right, episodeId) - episodeRecordScore(left, episodeId));
  if (matches[0]) return matches[0];

  // 兼容以后页面不再把 episode 直接放在 pageProps 下的情况。
  return objects.find((item) => {
    const title = readMetadataField(item, EPISODE_TITLE_FIELDS);
    const hasAudio = Boolean(item.enclosure || item.media || item.audioUrl || item.audio_url);
    return Boolean(title && hasAudio);
  }) || null;
}

function findPodcastRecord(data: unknown, episode: MetadataRecord | null): MetadataRecord | null {
  const directCandidates = [
    episode?.podcast,
    episode?.show,
    episode?.program,
    episode?.podcastInfo,
    asMetadataRecord(asMetadataRecord(asMetadataRecord(data)?.props)?.pageProps)?.podcast,
  ];
  const direct = directCandidates
    .map(asMetadataRecord)
    .find((item): item is MetadataRecord => Boolean(item && readMetadataField(item, ['title', 'name'])));
  if (direct) return direct;

  return collectMetadataObjects(data).find((item) => {
    const title = readMetadataField(item, ['title', 'name']);
    const podcastId = readMetadataField(item, ['pid', 'podcastId', 'podcast_id']);
    const episodeId = readMetadataField(item, ['eid', 'episodeId', 'episode_id']);
    return Boolean(title && podcastId && !episodeId);
  }) || null;
}

function readMetaContent(selector: string): string {
  return document.querySelector(selector)?.getAttribute('content')?.trim() || '';
}

function findPodcastNameInDocument(): string {
  const podcastLink = document.querySelector<HTMLAnchorElement>('a[href*="/podcast/"]');
  return podcastLink?.textContent?.trim() || '';
}

/**
 * 页面可见的单集名是 episode 主内容区域的 H1（当前为 h1.title）。
 * 将它放在社交分享 meta 之前作为回退，避免站点异步更新 meta 或其包含播客名时误识别。
 */
function findEpisodeTitleInDocument(): string {
  const candidates = document.querySelectorAll<HTMLElement>(
    'h1.title, h1, [role="heading"][aria-level="1"]'
  );
  for (const candidate of candidates) {
    const title = candidate.textContent?.replace(/\s+/g, ' ').trim() || '';
    if (title) return title;
  }
  return '';
}

function extractVideoInfo(): EpisodeInfo {
  let data: unknown = null;
  const nextData = document.getElementById('__NEXT_DATA__');
  if (nextData) {
    try {
      data = JSON.parse(nextData.textContent || '');
    } catch {
      // 解析失败则继续使用页面元信息兜底。
    }
  }

  const episodeId = extractEpisodeId(window.location.href) || '';
  const episode = findEpisodeRecord(data, episodeId);
  const podcast = findPodcastRecord(data, episode);
  const pageProps = asMetadataRecord(asMetadataRecord(asMetadataRecord(data)?.props)?.pageProps);

  const title = cleanEpisodeTitle(
    readMetadataField(episode, EPISODE_TITLE_FIELDS) ||
      readMetadataField(pageProps, ['episodeTitle', 'episode_title']) ||
      findEpisodeTitleInDocument() ||
      readMetaContent('meta[property="og:title"]') ||
      readMetaContent('meta[name="twitter:title"]') ||
      document.title
  );
  const channelName =
    readMetadataField(podcast, ['title', 'name', 'author']) ||
    readMetadataField(episode, ['podcastTitle', 'podcastName', 'showTitle']) ||
    findPodcastNameInDocument();
  const podcastId =
    readMetadataField(podcast, ['pid', 'podcastId', 'podcast_id', 'id']) ||
    readMetadataField(episode, ['podcastId', 'podcast_id', 'pid']);

  return {
    title,
    channelName,
    podcastId,
    description: readMetadataField(episode, ['description', 'summary', 'showNotes']),
    duration: Number(readMetadataField(episode, ['duration', 'durationSeconds', 'length'])) || 0,
    image: episode ? extractCoverImage(episode) : readMetaContent('meta[property="og:image"]'),
  };
}

/**
 * 从 episode 对象里提取封面图 URL。
 */
function extractCoverImage(episode: Record<string, unknown>): string {
  const candidateFields = [
    'image',
    'cover',
    'coverUrl',
    'pic',
    'picUrl',
    'logo',
    'avatar',
  ];

  const firstHttp = (obj: unknown): string => {
    if (!obj || typeof obj !== 'object') return '';
    for (const field of candidateFields) {
      const value = (obj as Record<string, unknown>)[field];
      if (typeof value === 'string' && value.trim().startsWith('http')) {
        return value.trim();
      }
    }
    return '';
  };

  return (
    firstHttp(episode) ||
    firstHttp((episode as Record<string, unknown>).podcast as Record<string, unknown>) ||
    document.querySelector('meta[property="og:image"]')?.getAttribute('content')?.trim() ||
    ''
  );
}

// ============================================================
// SEEK
// ============================================================

const delay = (ms: number) => new Promise<void>((resolve) => { window.setTimeout(resolve, ms); });

function formatSeekTimestamp(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

/** 兜底：自动播放被浏览器策略拦截时，尝试点击页面自己的播放按钮。 */
function triggerSitePlay(): void {
  const buttons = document.querySelectorAll<HTMLElement>('button, [role="button"]');
  for (const el of buttons) {
    const className = typeof el.className === 'string' ? el.className : '';
    const hint = `${el.getAttribute('aria-label') || ''} ${className}`.toLowerCase();
    if (/(^|[\s_-])play|播放/.test(hint) && !/pause|暂停/.test(hint)) {
      el.click();
      return;
    }
  }
}

function showSeekPausedToast(seconds: number): void {
  const existing = document.getElementById('xyz-seek-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'xyz-seek-toast';
  toast.textContent = `已定位到 ${formatSeekTimestamp(seconds)}，请点击页面播放按钮开始播放`;

  Object.assign(toast.style, {
    position: 'fixed',
    right: '20px',
    bottom: '20px',
    zIndex: '100000',
    maxWidth: '300px',
    padding: '12px 16px',
    borderRadius: '10px',
    background: '#333333',
    color: '#ffffff',
    fontFamily: 'system-ui, -system-ui, "PingFang SC", "Microsoft YaHei", sans-serif',
    fontSize: '13px',
    lineHeight: '1.5',
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3)',
  });
  document.body.appendChild(toast);
  window.setTimeout(() => toast.remove(), 4000);
}

function performSeek(audio: HTMLAudioElement, seconds: number): void {
  const applySeek = () => {
    try {
      audio.currentTime = seconds;
      console.warn('[Digest 诊断][页面]', `currentTime 已设为 ${seconds}s（readyState=${audio.readyState}）`);
    } catch (e) {
      console.error('[小宇宙 Digest v2.0] 跳转失败:', e);
      console.warn('[Digest 诊断][页面]', `currentTime 赋值抛错: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    if (!audio.paused) {
      console.warn('[Digest 诊断][页面]', '音频正在播放，无需触发 play()');
      return;
    }

    audio.play().then(
      () => console.warn('[Digest 诊断][页面]', 'play() 成功，已开始播放'),
      () => {
        console.warn('[Digest 诊断][页面]', 'play() 被浏览器拦截，尝试点击页面播放按钮');
        // 自动播放被拦截：先试页面自己的播放按钮，仍不行则提示用户手动点播放。
        triggerSitePlay();
        window.setTimeout(() => {
          if (audio.paused) {
            console.warn('[Digest 诊断][页面]', '自动播放仍被拦截，展示手动播放提示');
            showSeekPausedToast(seconds);
          }
        }, 700);
      }
    );
  };

  // 音频元数据未就绪时直接赋值 currentTime 可能被重置，等 metadata 加载后再跳。
  if (audio.readyState >= 1) {
    applySeek();
  } else {
    const onReady = () => applySeek();
    audio.addEventListener('loadedmetadata', onReady, { once: true });
    // 元数据一直不加载（例如暂停状态）也要兜底。
    window.setTimeout(() => audio.removeEventListener('loadedmetadata', onReady), 5000);
    window.setTimeout(applySeek, 500);
  }
}

/** 音频元素可能延迟挂载，轮询等待后再跳转。 */
async function seekWithRetry(seconds: number, maxAttempts = 40): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const audio = getAudioElement();
    if (audio) {
      if (attempt > 0) console.warn('[Digest 诊断][页面]', `第 ${attempt + 1} 次轮询后找到音频元素`);
      performSeek(audio, seconds);
      return;
    }
    await delay(500);
  }
  console.warn('[Digest 诊断][页面]', `轮询 ${maxAttempts} 次后仍未找到音频元素，放弃跳转`);
}

function seekToTimestamp(seconds: number): void {
  const audio = getAudioElement();
  if (!audio) {
    console.error('[小宇宙 Digest v2.0] 未找到音频元素用于跳转');
    return;
  }
  performSeek(audio, seconds);
}
