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

export async function handleGetVideoInfo(tabId?: number): Promise<VideoInfoResponse> {
  try {
    let targetTabId = typeof tabId === 'number' ? tabId : undefined;

    if (targetTabId === undefined) {
      const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      targetTabId = activeTab?.id;
    }

    if (targetTabId === undefined) {
      return { title: '', channelName: '', podcastId: '', description: '', duration: 0, image: '' };
    }

    const response = await chrome.tabs.sendMessage(targetTabId, { action: 'getVideoInfo' });
    return {
      title: String(response?.title || ''),
      channelName: String(response?.channelName || ''),
      podcastId: String(response?.podcastId || ''),
      description: String(response?.description || ''),
      duration: Number(response?.duration) || 0,
      image: String(response?.image || ''),
    };
  } catch (_error) {
    return { title: '', channelName: '', podcastId: '', description: '', duration: 0, image: '' };
  }
}
