/**
 * Video Info Extraction (via content script)
 */

interface VideoInfoResponse {
  title: string;
  channelName: string;
  podcastId: string;
  description: string;
  duration?: number;
  image?: string;
}

const EMPTY_VIDEO_INFO: VideoInfoResponse = {
  title: '',
  channelName: '',
  podcastId: '',
  description: '',
  duration: 0,
  image: '',
};

// 单集页是 SPA：节目名可能比 content script 更晚写入 DOM / Next 数据。
// 不能只要拿到播客名就提前返回，否则标题为空会被长期缓存并隐藏在侧边栏中。
const VIDEO_INFO_RETRY_DELAYS_MS = [0, 250, 600, 1200, 2000];

function normalizeVideoInfo(response: unknown): VideoInfoResponse {
  const value = response && typeof response === 'object' ? response as Record<string, unknown> : {};
  return {
    title: String(value.title || '').trim(),
    channelName: String(value.channelName || value.podcastTitle || '').trim(),
    podcastId: String(value.podcastId || '').trim(),
    description: String(value.description || '').trim(),
    duration: Number(value.duration) || 0,
    image: String(value.image || '').trim(),
  };
}

function hasEpisodeTitle(info: VideoInfoResponse): boolean {
  return Boolean(info.title);
}

function mergeVideoInfo(previous: VideoInfoResponse, next: VideoInfoResponse): VideoInfoResponse {
  return {
    title: next.title || previous.title,
    channelName: next.channelName || previous.channelName,
    podcastId: next.podcastId || previous.podcastId,
    description: next.description || previous.description,
    duration: next.duration || previous.duration || 0,
    image: next.image || previous.image,
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 兜底直接从页面 DOM 读取主标题。
 *
 * 内容脚本刚被扩展更新替换、或小宇宙 SPA 尚未完成初始化时，tabs.sendMessage
 * 可能没有响应或只返回半成品元数据；但浏览器已经渲染出的 H1 仍可通过 scripting
 * 读取。这保证侧边栏不会因为消息链路短暂失效而把标题区域隐藏。
 */
async function readVideoInfoFromPageDom(tabId: number): Promise<VideoInfoResponse> {
  try {
    const [execution] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const readMeta = (selector: string) =>
          document.querySelector(selector)?.getAttribute('content')?.trim() || '';
        const titleCandidates = document.querySelectorAll<HTMLElement>(
          'h1.title, main h1, h1, [role="heading"][aria-level="1"]'
        );
        let title = '';
        for (const element of titleCandidates) {
          title = element.textContent?.replace(/\s+/g, ' ').trim() || '';
          if (title) break;
        }
        if (!title) {
          title = readMeta('meta[property="og:title"]') ||
            readMeta('meta[name="twitter:title"]') ||
            document.title;
        }

        return {
          title,
          channelName: document.querySelector<HTMLAnchorElement>('a[href*="/podcast/"]')?.textContent?.trim() || '',
          image: readMeta('meta[property="og:image"]'),
        };
      },
    });
    return normalizeVideoInfo(execution?.result);
  } catch {
    return EMPTY_VIDEO_INFO;
  }
}

export async function handleGetVideoInfo(tabId?: number): Promise<VideoInfoResponse> {
  try {
    let targetTabId = typeof tabId === 'number' ? tabId : undefined;

    if (targetTabId === undefined) {
      const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      targetTabId = activeTab?.id;
    }

    if (targetTabId === undefined) return EMPTY_VIDEO_INFO;

    let bestInfo = EMPTY_VIDEO_INFO;
    for (const delay of VIDEO_INFO_RETRY_DELAYS_MS) {
      if (delay) await wait(delay);
      try {
        const response = await chrome.tabs.sendMessage(targetTabId, { action: 'getVideoInfo' });
        const info = normalizeVideoInfo(response);
        bestInfo = mergeVideoInfo(bestInfo, info);
        // 标题是侧边栏展示的必填元信息；只拿到播客名时继续等页面完成渲染。
        if (hasEpisodeTitle(bestInfo)) return bestInfo;
      } catch {
        // SPA 切换单集时 content script 可能暂时还未就绪，继续重试。
      }
    }

    // 最后从已渲染 DOM 读取主标题，绕过内容脚本就绪时序与消息通道问题。
    return mergeVideoInfo(bestInfo, await readVideoInfoFromPageDom(targetTabId));
  } catch (_error) {
    return EMPTY_VIDEO_INFO;
  }
}
