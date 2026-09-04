/**
 * CONTENT SCRIPT
 *
 * 运行在小宇宙单集页上，负责：
 * 1. 从页面的 __NEXT_DATA__ 提取单集信息（标题、播客名、简介、时长）
 * 2. 注入「Digest」浮动按钮（打开侧边栏）
 * 3. 注入「记笔记」浮动按钮（保存带时间戳的笔记）
 * 4. 控制音频播放器的跳转、读取播放进度
 */

const DEBUG = false;
const debugLog = (...args) => {
  if (DEBUG) console.log(...args);
};

const ACCENT = "#25B4E1";
const ACCENT_HOVER = "#1a97bf";

// ============================================================
// GLOBAL STATE
// ============================================================

let xyzDigestButton = null;
let xyzNoteButton = null;
let xyzNoteButtonTimer = null;
let xyzNoteKeyboardListenerAdded = false;
let xyzSpeedControl = null;
let lastKnownUrl = window.location.href;
let navigationPollTimer = null;

// 倍速档位：直接平铺展示，不做下拉。
const SPEED_OPTIONS = [
  { value: 1, label: "1.0x" },
  { value: 1.25, label: "1.25x" },
  { value: 1.5, label: "1.5x" },
  { value: 2, label: "2.0x" },
];

// ============================================================
// HELPERS
// ============================================================

function isEpisodePage() {
  return /^\/episode\/[0-9a-fA-F]+/.test(window.location.pathname);
}

function extractEpisodeId(url) {
  return XYZ_DOMAIN.extractEpisodeId(url);
}

function getAudioElement() {
  return document.querySelector("audio");
}

// ============================================================
// INITIALIZATION
// ============================================================

function init() {
  if (!xyzNoteKeyboardListenerAdded) {
    document.addEventListener("keydown", handleNoteKeyboardShortcut);
    xyzNoteKeyboardListenerAdded = true;
  }

  // 站点自身或用户改倍速时（ratechange 不冒泡，用捕获阶段监听），同步高亮。
  document.addEventListener(
    "ratechange",
    (e) => {
      if (e.target && e.target.tagName === "AUDIO") updateSpeedActive();
    },
    true,
  );

  injectDigestButton();
  injectNoteButton();
  injectSpeedControl();
  setupNavigationDetection();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

// ============================================================
// MESSAGE HANDLING
// ============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  debugLog("[小宇宙 Digest Content] Received message:", message.action, message);

  if (message.action === "getVideoInfo") {
    sendResponse(extractVideoInfo());
    return false;
  }

  if (message.action === "highlightMoments") {
    // 进度条标记已禁用——章节只展示在侧边栏中。
    sendResponse({ success: true });
    return false;
  }

  if (message.action === "getCurrentTime") {
    const audio = getAudioElement();
    sendResponse({
      // 返回小数秒，让侧边栏的「跟随播放」能对齐到真实发声时刻（不再只到整秒）。
      currentTime: audio ? audio.currentTime : 0,
      paused: audio ? audio.paused : true,
    });
    return false;
  }

  if (message.action === "seekTo") {
    seekToTimestamp(message.seconds);
    sendResponse({ success: true });
    return false;
  }

  if (message.action === "showNoteSavedFeedback") {
    showNoteSavedToast(message.note);
    sendResponse({ success: true });
    return false;
  }

  sendResponse({ success: false, error: "Unknown action" });
  return false;
});

// ============================================================
// FLOATING BUTTONS
// ============================================================

function createFloatingButton(id, label, top, icon) {
  const button = document.createElement("button");
  button.id = id;
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.innerHTML = icon + `<span>${label}</span>`;

  button.style.cssText = `
    position: fixed;
    right: 20px;
    top: ${top}px;
    z-index: 99999;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 10px 16px;
    border: none;
    border-radius: 999px;
    background: ${ACCENT};
    color: white;
    font-family: system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    box-shadow: 0 4px 14px rgba(37, 180, 225, 0.35);
    transition: background 0.18s ease, transform 0.18s ease, box-shadow 0.18s ease;
  `;

  button.addEventListener("mouseenter", () => {
    button.style.background = ACCENT_HOVER;
    button.style.boxShadow = "0 6px 18px rgba(37, 180, 225, 0.4)";
    button.style.transform = "translateY(-1px)";
  });

  button.addEventListener("mouseleave", () => {
    button.style.background = ACCENT;
    button.style.boxShadow = "0 4px 14px rgba(37, 180, 225, 0.35)";
    button.style.transform = "translateY(0)";
  });

  document.body.appendChild(button);
  return button;
}

function injectDigestButton() {
  const existing = document.getElementById("xyz-digest-button");
  if (existing) existing.remove();
  if (!isEpisodePage()) return;

  xyzDigestButton = createFloatingButton(
    "xyz-digest-button",
    "Digest",
    76,
    '<span style="font-size:12px;">▶</span>',
  );

  xyzDigestButton.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await chrome.runtime.sendMessage({ action: "openSidePanel" });
    } catch (err) {
      console.error("[小宇宙 Digest] Failed to open side panel:", err);
    }
  });
}

function injectNoteButton() {
  const existing = document.getElementById("xyz-note-button");
  if (existing) existing.remove();
  if (!isEpisodePage()) return;

  xyzNoteButton = createFloatingButton(
    "xyz-note-button",
    "记笔记",
    20,
    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="flex:0 0 auto;">
      <path d="M12 20h9"></path>
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
    </svg>`,
  );

  xyzNoteButton.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await saveCurrentNote();
  });
}

// ============================================================
// PLAYBACK SPEED — 页面上的浮动倍速按钮
// ============================================================

function injectSpeedControl() {
  const existing = document.getElementById("xyz-speed-control");
  if (existing) existing.remove();
  if (!isEpisodePage()) return;

  const container = document.createElement("div");
  container.id = "xyz-speed-control";
  container.setAttribute("aria-label", "播放倍速");
  container.style.cssText = `
    position: fixed;
    right: 20px;
    top: 132px;
    z-index: 99999;
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 4px;
    background: #ffffff;
    border: 1px solid #e1e1e1;
    border-radius: 999px;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
  `;

  SPEED_OPTIONS.forEach((option) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = option.label;
    btn.dataset.speed = String(option.value);
    btn.style.cssText = `
      padding: 6px 10px;
      border: none;
      border-radius: 999px;
      background: transparent;
      color: #555555;
      font-family: system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.18s ease, color 0.18s ease;
    `;
    btn.addEventListener("click", () => {
      setPlaybackRate(option.value);
      updateSpeedActive();
    });
    container.appendChild(btn);
  });

  document.body.appendChild(container);
  xyzSpeedControl = container;
  updateSpeedActive();
}

function setPlaybackRate(rate) {
  const audio = getAudioElement();
  if (!audio) return;
  try {
    audio.playbackRate = rate;
  } catch (e) {
    console.error("[小宇宙 Digest] 设置倍速失败:", e);
  }
}

function updateSpeedActive() {
  if (!xyzSpeedControl) return;
  const audio = getAudioElement();
  const currentRate = audio ? audio.playbackRate : 1;
  xyzSpeedControl.querySelectorAll("button").forEach((btn) => {
    const isActive = Math.abs(Number(btn.dataset.speed) - currentRate) < 0.01;
    btn.style.background = isActive ? ACCENT : "transparent";
    btn.style.color = isActive ? "#ffffff" : "#555555";
  });
}

// ============================================================
// NAVIGATION DETECTION（小宇宙是 Next.js SPA）
// ============================================================

function setupNavigationDetection() {
  window.addEventListener("popstate", onNavigated);
  navigationPollTimer = setInterval(() => {
    if (window.location.href !== lastKnownUrl) {
      lastKnownUrl = window.location.href;
      onNavigated();
    }
  }, 500);
}

function onNavigated() {
  document.getElementById("xyz-digest-button")?.remove();
  document.getElementById("xyz-note-button")?.remove();
  document.getElementById("xyz-speed-control")?.remove();
  xyzDigestButton = null;
  xyzNoteButton = null;
  xyzSpeedControl = null;

  setTimeout(() => {
    injectDigestButton();
    injectNoteButton();
    injectSpeedControl();
  }, 500);
}

// ============================================================
// NOTE SAVING
// ============================================================

function handleNoteKeyboardShortcut(e) {
  if (!isEpisodePage()) return;
  if (e.key !== "n" && e.key !== "N") return;

  const active = document.activeElement;
  if (
    active &&
    (active.tagName === "INPUT" ||
      active.tagName === "TEXTAREA" ||
      active.isContentEditable)
  ) {
    return;
  }

  e.preventDefault();
  e.stopPropagation();
  saveCurrentNote();
}

async function saveCurrentNote() {
  const audio = getAudioElement();
  if (!audio) {
    console.error("[小宇宙 Digest] 未找到音频元素");
    return;
  }

  // 回退 3 秒，捕捉刚刚说过的话（用户听到后才反应）。
  const currentTime = Math.max(0, Math.floor(audio.currentTime) - 3);
  const videoInfo = extractVideoInfo();
  const episodeId = extractEpisodeId(window.location.href);

  const noteButton = xyzNoteButton;
  const originalContent = noteButton ? noteButton.innerHTML : "";

  if (noteButton) {
    noteButton.innerHTML =
      '<span style="letter-spacing: 0.2px;">保存中...</span>';
    noteButton.style.pointerEvents = "none";
  }

  try {
    const result = await chrome.runtime.sendMessage({
      action: "saveNote",
      videoId: episodeId,
      timestamp: currentTime,
      videoTitle: videoInfo.title,
      channelName: videoInfo.channelName,
    });

    if (result.success) {
      if (noteButton) {
        noteButton.innerHTML =
          '<span style="letter-spacing: 0.2px;">已保存</span>';
      }
      showNoteSavedToast(result.note);
    } else {
      if (noteButton) {
        noteButton.innerHTML =
          '<span style="letter-spacing: 0.2px;">出错</span>';
      }
      console.error("[小宇宙 Digest] Save note error:", result.error);
    }
  } catch (err) {
    if (noteButton) {
      noteButton.innerHTML =
        '<span style="letter-spacing: 0.2px;">出错</span>';
    }
    console.error("[小宇宙 Digest] Save note exception:", err);
  }

  setTimeout(() => {
    if (noteButton) {
      noteButton.innerHTML = originalContent;
      noteButton.style.pointerEvents = "auto";
    }
  }, 2000);
}

function showNoteSavedToast(note) {
  const existing = document.getElementById("xyz-note-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "xyz-note-toast";
  toast.innerHTML = `
    <div style="font-weight: 700; margin-bottom: 6px; color: #111111;">📝 笔记已保存</div>
    <div style="font-size: 12px; color: #555555; margin-bottom: 8px;">${escapeHtmlForContent(note.timestamp)} — ${escapeHtmlForContent(note.videoTitle)}</div>
    <div style="font-size: 13px; line-height: 1.55; color: #111111;">"${escapeHtmlForContent(note.text)}"</div>
  `;

  toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 999999;
    background: #ffffff;
    border: 1px solid #e1e1e1;
    border-radius: 14px;
    padding: 16px 20px;
    max-width: 350px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.16);
    font-family: system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
    animation: xyzSlideIn 0.3s ease;
  `;

  const style = document.createElement("style");
  style.textContent = `
    @keyframes xyzSlideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
  `;
  document.head.appendChild(style);

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = "xyzSlideIn 0.3s ease reverse";
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}

// ============================================================
// INFO EXTRACTION（优先 __NEXT_DATA__，回退 og meta）
// ============================================================

/**
 * 去掉标题末尾的小宇宙站点名与广告语（「听播客，上小宇宙」「小宇宙」等）。
 * 小宇宙页面的 <title> / og:title 常带这些品牌后缀，剥离后只保留节目本身的标题。
 */
function cleanTitle(title) {
  return XYZ_DOMAIN.cleanEpisodeTitle(title);
}

function extractVideoInfo() {
  const nextData = document.getElementById("__NEXT_DATA__");
  if (nextData) {
    try {
      const data = JSON.parse(nextData.textContent);
      const episode = data?.props?.pageProps?.episode;
      if (episode && typeof episode === "object") {
        return {
          title: cleanTitle(episode.title),
          channelName:
            episode.podcast?.title ||
            episode.podcast?.name ||
            episode.podcast?.author ||
            "",
          // 不同页面版本可能把节目 ID 放在 podcast.pid、podcast.id 或单集 pid。
          // 不能因其中一个字段暂缺而让「本节目单集」请求退化为不稳定兜底。
          podcastId: episode.podcast?.pid || episode.podcast?.id || episode.pid || "",
          description: episode.description || "",
          duration: Number(episode.duration) || 0,
          image: extractCoverImage(episode),
        };
      }
    } catch (e) {
      // 解析失败则回退。
    }
  }

  const ogTitle =
    document.querySelector('meta[property="og:title"]')?.content || "";
  const ogImage =
    document.querySelector('meta[property="og:image"]')?.content || "";
  return {
    title: cleanTitle(ogTitle),
    channelName: "",
    podcastId: "",
    description: "",
    duration: 0,
    image: ogImage,
  };
}

/**
 * 从 episode 对象里提取封面图 URL。
 * 小宇宙的数据结构可能把封面放在 episode 本身或 episode.podcast 上，
 * 字段名也可能是 image / cover / logo 等，逐一尝试；最后回退到 og:image。
 */
function extractCoverImage(episode) {
  const candidateFields = [
    "image",
    "cover",
    "coverUrl",
    "pic",
    "picUrl",
    "logo",
    "avatar",
  ];

  const firstHttp = (obj) => {
    if (!obj || typeof obj !== "object") return "";
    for (const field of candidateFields) {
      const value = obj[field];
      if (typeof value === "string" && value.trim().startsWith("http")) {
        return value.trim();
      }
    }
    return "";
  };

  return (
    firstHttp(episode) ||
    firstHttp(episode?.podcast) ||
    document.querySelector('meta[property="og:image"]')?.content?.trim() ||
    ""
  );
}

// ============================================================
// SEEK
// ============================================================

function seekToTimestamp(seconds) {
  const audio = getAudioElement();
  if (!audio) {
    console.error("[小宇宙 Digest] 未找到音频元素用于跳转");
    return;
  }

  audio.currentTime = seconds;
  if (audio.paused) {
    audio.play().catch(() => {}); // 忽略自动播放限制错误
  }
}

function escapeHtmlForContent(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}
