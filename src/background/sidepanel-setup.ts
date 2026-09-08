/**
 * Side Panel Setup for Background Service Worker
 */

const XIAOYUZHOU_URL_PATTERN = /^https:\/\/www\.xiaoyuzhoufm\.com(?:\/|$)/i;

export function isXiaoyuzhouUrl(url?: string): boolean {
  return typeof url === 'string' && XIAOYUZHOU_URL_PATTERN.test(url);
}

/**
 * Opens the panel for a Digest button click on a Xiaoyuzhou page.
 * The extension action itself is handled directly by Chrome through
 * openPanelOnActionClick below.
 */
export async function openSidePanelForTab(tabId: number, url?: string): Promise<void> {
  if (!isXiaoyuzhouUrl(url)) {
    throw new Error('请先打开一个小宇宙单集页面，再使用 Digest。');
  }

  await chrome.sidePanel.open({ tabId });
  // 等待侧边栏 React 入口完成挂载，再让它启动当前单集的 Digest 流程。
  // Service Worker 没有 window 对象，必须使用全局 setTimeout。
  setTimeout(() => {
    chrome.runtime.sendMessage({ action: 'startDigestFromButton' }).catch(() => {});
  }, 300);
}

/**
 * Keep the extension panel available for every tab. This makes the action icon
 * reliable even when Chrome starts the service worker after the current tab
 * has already finished loading. The panel UI itself handles unsupported pages.
 */
async function configureSidePanel(): Promise<void> {
  await chrome.sidePanel.setOptions({ enabled: true });
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}

void configureSidePanel().catch((error) => {
  console.warn('[小宇宙 Digest v2.0] Failed to configure side panel:', error);
});

// ============================================================
// CONTENT SCRIPT RE-INJECTION
// 扩展重载/更新后，Chrome 不会向已打开的页面重新注入 content script，
// 页面上的浮动按钮（Digest / 记笔记 / 倍速）会消失。这里在启动、
// 安装更新以及标签页切换/加载完成时主动补注入。
// ============================================================

const CONTENT_SCRIPT_URL_PATTERN = 'https://www.xiaoyuzhoufm.com/*';

function getContentScriptFiles(): string[] {
  const manifest = chrome.runtime.getManifest();
  return (manifest.content_scripts || []).flatMap((script) => script.js || []);
}

/** 通过 ping 判断页面上的 content script 是否还存活（扩展重载后会失联）。 */
async function isContentScriptAlive(tabId: number): Promise<boolean> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { action: 'ping' });
    return Boolean(response?.ok);
  } catch {
    return false;
  }
}

/**
 * 从 crxjs 生成的 loader 中解析主模块路径。
 * loader 采用固定 URL 的动态 import；页面模块缓存会阻止同 URL 模块重新执行，
 * 因此扩展重载后需要改用带时间戳的 URL 强制重新加载。
 */
async function getMainModulePath(files: string[]): Promise<string | null> {
  for (const file of files) {
    try {
      const response = await fetch(chrome.runtime.getURL(file));
      if (!response.ok) continue;
      const text = await response.text();
      const match = text.match(/getURL\(\s*["']([^"']+\.js)["']\s*\)/);
      if (match) return match[1];
    } catch {
      // 忽略，尝试下一个文件。
    }
  }
  return null;
}

/**
 * 扩展重载后旧脚本已失效但 DOM 里还残留旧按钮：用带时间戳的 URL 重新加载主模块，
 * 绕过页面的模块缓存。
 */
async function reinjectWithCacheBust(tabId: number, modulePath: string): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    args: [modulePath, Date.now()],
    func: (path: string, bust: number) => {
      const url = `${chrome.runtime.getURL(path)}?reinject=${bust}`;
      try {
        // 用 Function 构造动态 import：既绕过页面模块缓存（时间戳 URL），
        // 又避免打包器改写 import 语法（该函数会被序列化后在页面上下文执行）。
        new Function('u', 'return import(u);')(url).catch((error: unknown) => {
          console.error('[小宇宙 Digest v2.0] Re-inject failed:', error);
        });
      } catch (error) {
        console.error('[小宇宙 Digest v2.0] Re-inject failed:', error);
      }
    },
  });
}

export async function injectContentScriptIfNeeded(tabId: number): Promise<void> {
  const files = getContentScriptFiles();
  if (!files.length) throw new Error('扩展没有配置 content script 文件。');

  try {
    if (await isContentScriptAlive(tabId)) return;

    // DOM 里还残留旧按钮，说明是扩展重载后的失效脚本。
    const [hasStaleButtons] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => Boolean(document.getElementById('xyz-digest-button')),
    });

    if (hasStaleButtons?.result) {
      const modulePath = await getMainModulePath(files);
      if (modulePath) {
        await reinjectWithCacheBust(tabId, modulePath);

        // 验证复活是否成功；若页面 CSP 阻止了动态 import，回退到常规文件注入。
        await new Promise((resolve) => setTimeout(resolve, 600));
        if (await isContentScriptAlive(tabId)) return;
      }
    }

    // 常规路径：页面从未注入过，直接注入 manifest 声明的文件。
    await chrome.scripting.executeScript({ target: { tabId }, files });
    if (!(await isContentScriptAlive(tabId))) {
      throw new Error('content script 注入后仍未响应 ping。');
    }
  } catch (error) {
    // 主动注入场景需要把错误抛给调用方；生命周期事件调用方会自行吞掉。
    throw error instanceof Error ? error : new Error(String(error));
  }
}

async function injectIntoAllXiaoyuzhouTabs(): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({ url: CONTENT_SCRIPT_URL_PATTERN });
    await Promise.all(
      tabs
        .filter((tab) => typeof tab.id === 'number')
        .map((tab) => injectContentScriptIfNeeded(tab.id as number))
    );
  } catch (error) {
    console.warn('[小宇宙 Digest v2.0] Failed to re-inject content scripts:', error);
  }
}

chrome.runtime.onStartup.addListener(() => {
  void injectIntoAllXiaoyuzhouTabs();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!isXiaoyuzhouUrl(tab.url)) return;
  // changeInfo.url 覆盖纯 hash 导航（如带时间戳跳转复用已有标签页），
  // 此时也会触发 content script 补注入。
  if (changeInfo.status !== 'complete' && !changeInfo.url) return;
  void injectContentScriptIfNeeded(tabId).catch(() => {});
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void (async () => {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (isXiaoyuzhouUrl(tab.url)) await injectContentScriptIfNeeded(tabId).catch(() => {});
    } catch {
      // 标签页可能已被关闭。
    }
  })();
});

chrome.runtime.onInstalled.addListener(({ reason }) => {
  void configureSidePanel().catch((error) => {
    console.warn('[小宇宙 Digest v2.0] Failed to configure side panel after install:', error);
  });

  // 扩展安装/更新/重载后，恢复所有已打开小宇宙页面上的浮动按钮。
  void injectIntoAllXiaoyuzhouTabs();

  if (reason === 'install') chrome.runtime.openOptionsPage();
});
