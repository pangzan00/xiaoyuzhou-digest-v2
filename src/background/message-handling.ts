/**
 * Message Handling for Background Service Worker
 */

import { handleFetchTranscript, handleCancelTranscript } from './transcription';
import { handleAnalyzeTranscript } from './analysis';
import { handleExplainSelection } from './explain';
import { handleAskEpisodeQuestion, handleAskEpisodeQuestionStream, handleGenerateSuggestedQuestions } from './episode-chat';
import { handleSaveNote, handleSaveCardNote, handleGetNotes, handleDeleteNote } from './notes';
import { handleGetVideoInfo } from './video-info';
import { getSettings } from './index';
import { handleFetchPodcastEpisodes } from './podcast-parser';
import { injectContentScriptIfNeeded, isXiaoyuzhouUrl, openSidePanelForTab } from './sidepanel-setup';

// ============================================================
// MESSAGE HANDLING
// ============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case 'fetchTranscript':
      handleFetchTranscript(message.videoId, message.force)
        .then(sendResponse)
        .catch((err) => sendResponse({ error: err.message }));
      return true;

    case 'cancelTranscript':
      sendResponse(handleCancelTranscript(message.videoId));
      return false;

    case 'analyzeTranscript':
      handleAnalyzeTranscript(
        message.module,
        message.transcriptText,
        message.videoTitle,
        message.channelName,
        message.videoDescription,
        message.videoDuration
      )
        .then(sendResponse)
        .catch((err) => sendResponse({ error: err.message }));
      return true;

    case 'explainSelection':
      handleExplainSelection(
        message.selectedText,
        message.transcriptContext,
        message.videoTitle
      )
        .then(sendResponse)
        .catch((err) => sendResponse({ error: err.message }));
      return true;

    case 'askEpisodeQuestion':
      handleAskEpisodeQuestion({
        question: message.question,
        transcriptText: message.transcriptText,
        videoTitle: message.videoTitle,
        channelName: message.channelName,
        videoDescription: message.videoDescription,
        conversation: message.conversation,
        chatMode: message.chatMode,
      })
        .then(sendResponse)
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    case 'generateSuggestedQuestions':
      handleGenerateSuggestedQuestions({
        transcriptText: message.transcriptText,
        videoTitle: message.videoTitle,
        channelName: message.channelName,
        videoDescription: message.videoDescription,
      })
        .then(sendResponse)
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    case 'saveNote':
      handleSaveNote(
        message.videoId,
        message.timestamp,
        message.videoTitle,
        message.channelName
      )
        .then(sendResponse)
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    case 'saveCardNote':
      handleSaveCardNote({
        videoId: message.videoId,
        timestampSeconds: message.timestampSeconds,
        videoTitle: message.videoTitle,
        channelName: message.channelName,
        text: message.text,
      })
        .then(sendResponse)
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    case 'getNotes':
      handleGetNotes(message.videoId)
        .then(sendResponse)
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    case 'deleteNote':
      handleDeleteNote(message.noteId)
        .then(sendResponse)
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    case 'getVideoInfo':
      handleGetVideoInfo(message.tabId)
        .then(sendResponse)
        .catch((err) => sendResponse({ error: err.message }));
      return true;

    case 'checkConfig':
      getSettings()
        .then((settings) =>
          sendResponse({
            success: true,
            hasDashscopeKey: !!settings.dashscopeApiKey,
            hasAiKey: !!settings.aiApiKey,
            asrModel: settings.asrModel || 'paraformer-v2',
          })
        )
        .catch((error) =>
          sendResponse({
            success: false,
            error: error?.message || '无法读取扩展设置。',
          })
        );
      return true;

    case 'openOptions':
      chrome.runtime.openOptionsPage();
      sendResponse({ success: true });
      return false;

    case 'fetchPodcastEpisodes':
      handleFetchPodcastEpisodes(message.episodeId, message.podcastId)
        .then(sendResponse)
        .catch((err) =>
          sendResponse({ success: false, error: err?.message || '获取节目单集失败' })
        );
      return true;

    case 'openSidePanel': {
      const tabId = sender.tab?.id;
      if (typeof tabId !== 'number') {
        sendResponse({ success: false, error: '无法确定当前小宇宙页面。' });
        return false;
      }

      // Call open before crossing an async boundary so Chrome keeps the click's
      // user-gesture permission for sidePanel.open().
      openSidePanelForTab(tabId, sender.tab?.url)
        .then(() => sendResponse({ success: true }))
        .catch((error) => {
          console.error('[小宇宙 Digest v2.0] Unable to open side panel:', error);
          sendResponse({
            success: false,
            error: error instanceof Error ? error.message : '无法打开侧边栏。',
          });
        });
      return true;
    }

    // 把侧边栏的消息转发给 content script
    case 'relayToContent': {
      (async () => {
        try {
          const requestedTabId = Number.isInteger(message.targetTabId) ? message.targetTabId : null;
          let targetTab: { id?: number; url?: string } | undefined;

          // 优先使用侧边栏记录的标签页，避免多个小宇宙页面打开时误发到别的页面。
          if (requestedTabId !== null) {
            try {
              const requestedTab = await chrome.tabs.get(requestedTabId);
              if (isXiaoyuzhouUrl(requestedTab.url)) targetTab = requestedTab;
            } catch {
              // 记录的标签页可能已经被关闭，继续按当前活动页查找。
            }
          }

          if (!targetTab) {
            const activeTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
            if (isXiaoyuzhouUrl(activeTabs[0]?.url)) targetTab = activeTabs[0];
          }

          if (!targetTab) {
            const xiaoyuzhouTabs = await chrome.tabs.query({ url: 'https://www.xiaoyuzhoufm.com/*' });
            targetTab = xiaoyuzhouTabs[0];
          }

          if (!targetTab?.id) {
            console.warn('[Digest 诊断][后台]', '未找到任何小宇宙标签页');
            sendResponse({ success: false, error: '未找到小宇宙标签页' });
            return;
          }

          const payload = message.payload;
          console.warn(
            '[Digest 诊断][后台]',
            `relayToContent 转发 ${payload?.action} → 标签页 #${targetTab.id} (${targetTab.url})`
          );

          try {
            const response = await chrome.tabs.sendMessage(targetTab.id, payload);
            console.warn('[Digest 诊断][后台]', `转发成功，页面返回: ${JSON.stringify(response) ?? 'undefined'}`);
            sendResponse({ success: true, response, tabId: targetTab.id, injected: false });
            return;
          } catch (sendError) {
            console.warn(
              '[Digest 诊断][后台]',
              `首次发送失败，尝试注入 content script: ${sendError instanceof Error ? sendError.message : String(sendError)}`
            );
          }

          await injectContentScriptIfNeeded(targetTab.id);
          const response = await chrome.tabs.sendMessage(targetTab.id, payload);
          console.warn('[Digest 诊断][后台]', `注入后重试成功，页面返回: ${JSON.stringify(response) ?? 'undefined'}`);
          sendResponse({ success: true, response, tabId: targetTab.id, injected: true });
        } catch (err) {
          console.error('[小宇宙 Digest v2.0 BG] Relay error:', err instanceof Error ? err.message : err);
          sendResponse({ success: false, error: err instanceof Error ? err.message : String(err) });
        }
      })();
      return true;
    }

    default:
      sendResponse({ success: false, error: 'Unknown action' });
      return false;
  }
});

// ============================================================
// LONG-LIVED PORTS (for streaming chat)
// ============================================================

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'episodeChatStream') return;

  let controller: AbortController | null = null;
  let disconnected = false;

  port.onDisconnect.addListener(() => {
    disconnected = true;
    controller?.abort();
  });

  port.onMessage.addListener((message) => {
    if (message?.action !== 'askEpisodeQuestion' || controller) return;

    controller = new AbortController();

    handleAskEpisodeQuestionStream(message, {
      signal: controller.signal,
      onChunk: (content: string) => {
        if (!disconnected) port.postMessage({ type: 'chunk', content });
      },
    })
      .then((result) => {
        if (!disconnected) port.postMessage({ type: 'done', ...result });
      })
      .catch((error) => {
        if (!disconnected) {
          port.postMessage({
            type: 'error',
            error: error?.message || '问答失败，请稍后重试。',
          });
        }
      });
  });
});
