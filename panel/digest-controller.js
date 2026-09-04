var XYZ_DIGEST_CONTROLLER = (() => {
  function create({ getState, setState, ui, storage, library, debugLog }) {
    let digestInFlightVideoId = null;
    let retranscriptionInProgress = false;
    // 二次识别不能只依赖运行中的全局状态：转录期间若面板状态被其他事件刷新，
    // 取消后仍须能恢复点击「重新识别」前的完整文字稿。
    let retranscriptionFallback = null;
    let navigationRefreshTimer = null;
    let panelWindowId = null;

    function state() {
      return getState();
    }

    function update(patch) {
      setState(patch);
    }

    function syncState(stateName) {
      ui.showState(stateName, { inFlight: Boolean(digestInFlightVideoId) });
    }

    function initTabTracking() {
      chrome.windows.getCurrent().then((window) => {
        panelWindowId = window.id;
      });
      chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        if (panelWindowId !== null && tab.windowId !== panelWindowId) return;
        if (!tab.active && tabId !== state().xiaoyuzhouTabId) return;
        // URL 变更后首次恢复缓存；页面 complete 后再确认一次，覆盖内容脚本、
        // 页面元信息及浏览器标签状态仍在切换中的时序。
        if (changeInfo.url) handleFrontTabUrl(changeInfo.url, tabId);
        else if (changeInfo.status === "complete") handleFrontTabUrl(tab.url || tab.pendingUrl || "", tabId, true);
      });
      chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
        if (panelWindowId !== null && windowId !== panelWindowId) return;
        try {
          const tab = await chrome.tabs.get(tabId);
          handleFrontTabUrl(tab.url || tab.pendingUrl || "", tabId, true);
        } catch (_error) {
          // The tab was closed before its URL could be read.
        }
      });
    }

    function scheduleDigestRefresh(tabId) {
      clearTimeout(navigationRefreshTimer);
      navigationRefreshTimer = setTimeout(() => void checkCurrentTab(tabId), 600);
    }

    function handleFrontTabUrl(url, tabId, forceRefresh = false) {
      // side panel 本身无法通过页面脚本可靠地关闭；切到非单集页时清空旧内容，
      // 并展示欢迎态，避免把上一集文字稿带到无关页面。
      if (!extractVideoId(url)) {
        clearForInactiveTab();
        return;
      }
      const videoId = extractVideoId(url);
      // 从历史记录跳转时，必须锁定触发跳转的标签页；不能在异步回调中重新
      // 猜测“当前活动标签页”，否则焦点切到侧栏或页面尚未稳定时会误清空结果。
      if (forceRefresh || videoId !== state().currentVideoId || !ui.isShowingResults()) {
        scheduleDigestRefresh(tabId);
      }
    }

    function clearForInactiveTab() {
      clearTimeout(navigationRefreshTimer);
      update({
        xiaoyuzhouTabId: null,
        currentVideoId: null,
        currentVideoUrl: null,
        currentAnalysis: null,
        currentTranscript: null,
        currentTurns: null,
        currentTranscriptText: null,
        currentTranscriptTimestamped: null,
        currentTranscriptLanguage: null,
        currentVideoTitle: "",
        currentChannelName: "",
        currentVideoDescription: "",
        currentVideoDuration: 0,
        currentVideoImage: "",
        currentDiarization: null,
        currentAsrModel: null,
        transcriptLoadedFromCache: false,
      });
      ui.clearVideoInfo();
      ui.setStartDigestAvailable(false);
      ui.resetOverviewLoading();
      syncState("welcome");
    }

    async function checkCurrentTab(preferredTabId = null) {
      try {
        let tab = null;
        if (Number.isInteger(preferredTabId)) {
          try {
            tab = await chrome.tabs.get(preferredTabId);
          } catch (_error) {
            // 目标标签页可能在导航期间被关闭，回退到当前活动标签页。
          }
        }
        if (!tab) {
          const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
          tab = tabs[0] || null;
        }
        debugLog("[小宇宙 Digest Panel] Active tab:", tab?.id, tab?.url);
        if (!tab?.url) {
          clearForInactiveTab();
          return;
        }

        const videoId = extractVideoId(tab.url);
        if (!videoId) {
          clearForInactiveTab();
          return;
        }
        update({ xiaoyuzhouTabId: tab.id });

        const previous = state().currentVideoId;
        update({ currentVideoId: videoId, currentVideoUrl: tab.url });
        if (videoId !== previous) {
          library.resetActivePodcast();
          update({
            currentPodcastId: "",
            currentVideoTitle: "",
            currentChannelName: "",
            currentVideoDescription: "",
            currentVideoDuration: 0,
            currentVideoImage: "",
            currentAnalysis: null,
            currentTranscript: null,
            currentTurns: null,
            currentTranscriptText: null,
            currentTranscriptTimestamped: null,
            currentTranscriptLanguage: null,
            currentDiarization: null,
            currentAsrModel: null,
            transcriptLoadedFromCache: false,
          });
        }
        await loadVideoInfo(tab);
        // 返回曾完成转录的单集时，优先恢复持久缓存；只有没有缓存才显示手动获取入口。
        const cached = await storage.load(videoId);
        if (cached) {
          await restoreCachedDigest(videoId, tab.url, cached);
          return;
        }
        ui.setStartDigestAvailable(true);
        // 打开侧边栏仅识别当前单集并展示入口；ASR 由用户明确点击后才发起。
        if (videoId === previous && state().currentTranscript) {
          syncState("results");
          return;
        }
        syncState("welcome");
      } catch (error) {
        console.error("Tab check error:", error);
        syncState("welcome");
      }
    }

    async function loadVideoInfo(tab) {
      try {
        const result = await chrome.runtime.sendMessage({
          action: "relayToContent",
          payload: { action: "getVideoInfo" },
        });
        if (result.success && result.response) {
          update({
            currentVideoTitle: result.response.title || "",
            currentChannelName: result.response.channelName || "",
            currentPodcastId: result.response.podcastId || "",
            currentVideoDescription: result.response.description || "",
            currentVideoDuration: result.response.duration || 0,
            currentVideoImage: result.response.image || "",
          });
        }
      } catch (error) {
        console.error("[小宇宙 Digest Panel] getVideoInfo error:", error);
        update({
          currentVideoTitle: "",
          currentChannelName: "",
          currentVideoDescription: "",
          currentVideoDuration: 0,
          currentVideoImage: "",
        });
      }
      const current = state();
      if (!tab.title || (current.currentVideoTitle && current.currentChannelName)) return;
      const main = String(tab.title)
        .replace(/\s*[-–—|·:]\s*听播客[，,\s]*上小宇宙\s*$/i, "")
        .replace(/\s*听播客[，,\s]*上小宇宙\s*$/i, "")
        .replace(/\s*[-–—|·:]\s*(小宇宙|xiaoyuzhoufm\.com)\s*$/i, "")
        .replace(/\s*(小宇宙|xiaoyuzhoufm\.com)\s*$/i, "")
        .trim();
      const separator = main.lastIndexOf(" - ");
      update({
        currentVideoTitle: current.currentVideoTitle || (separator > 0 ? main.slice(0, separator).trim() : main),
        currentChannelName: current.currentChannelName || (separator > 0 ? main.slice(separator + 3).trim() : ""),
      });
    }

    function restoreRetranscriptionFallback(videoId, error, message) {
      if (!retranscriptionInProgress || !retranscriptionFallback) return false;
      update(retranscriptionFallback);
      ui.resetOverviewLoading();
      ui.resetChaptersView();
      ui.renderVideoInfo();
      ui.renderTranscript();
      ui.renderCachedAnalysis(retranscriptionFallback.currentAnalysis);
      syncState("results");
      ui.loadNotes(videoId);
      ui.setupExplainFeature();
      ui.showTransientNotice(error === "TRANSCRIPTION_CANCELED"
        ? "已停止重新识别，正在继续使用原有文字稿。"
        : `重新识别失败，正在继续使用原有文字稿：${message || error || "未知错误"}`);
      return true;
    }

    async function startDigest(videoId, videoUrl, force = false) {
      if (!videoId || !videoUrl) return;
      let current = state();
      if (!force && videoId === current.currentVideoId && current.currentTranscript) {
        syncState("results");
        return;
      }
      if (!force && videoId === digestInFlightVideoId) return;
      digestInFlightVideoId = videoId;
      try {
        current = state();
        if (!retranscriptionInProgress) {
          update({
            currentVideoId: videoId,
            currentVideoUrl: videoUrl,
            currentAnalysis: null,
            currentTranscript: null,
            currentTurns: null,
            currentTranscriptText: null,
            currentTranscriptTimestamped: null,
            currentTranscriptLanguage: null,
            currentDiarization: null,
            currentAsrModel: null,
            transcriptLoadedFromCache: false,
          });
          ui.resetOverviewLoading();
        }

        // 先切换到加载态，再读取本地缓存或向后台发送消息。此前缓存读取、
        // service worker 重启等异步步骤抛错时，界面会停在「开始获取」而没有任何反馈。
        ui.renderVideoInfo();
        syncState("loading");
        ui.updateLoading(
          retranscriptionInProgress ? "正在重新识别" : "正在准备转录",
          retranscriptionInProgress
            ? "原有文字稿会保留到新识别成功。"
            : "正在连接转录服务…",
          0,
        );

        let cached = null;
        if (!force) {
          try {
            cached = await storage.load(videoId);
          } catch (error) {
            // 缓存仅用于加速，读取失败不能阻断用户发起新的转录。
            console.warn("[小宇宙 Digest Panel] Cache load error:", error);
          }
        }
        if (cached) {
          await restoreCachedDigest(videoId, videoUrl, cached);
          return;
        }

        const result = await chrome.runtime.sendMessage({
          action: "fetchTranscript",
          videoId,
          tabId: state().xiaoyuzhouTabId,
          force: Boolean(force),
        });
        if (!result?.success) {
          const error = result?.error || "转录服务未返回有效结果。";
          const message = result?.message || error;
          if (restoreRetranscriptionFallback(videoId, error, message)) return;
          ui.showError(error === "NO_AUDIO" ? "无法读取单集信息" : "转写失败", message);
          return;
        }
        update({
          currentAnalysis: null,
          currentTranscript: result.transcript,
          currentTurns: result.turns || null,
          currentTranscriptText: result.transcriptText,
          currentTranscriptTimestamped: resolveTimestampedTranscript(
          result.transcriptTextTimestamped,
          result.turns,
          result.transcript,
        ),
          currentTranscriptLanguage: result.language || null,
          currentDiarization: result.diarization || null,
          currentAsrModel: result.asrModel || null,
          transcriptLoadedFromCache: false,
        });
        ui.resetOverviewLoading();
        ui.resetChaptersView();
        ui.renderTranscript();
        syncState("results");
        ui.loadNotes(videoId);
        ui.setupExplainFeature();
        await saveToCache(videoId);
      } catch (error) {
        console.error("[小宇宙 Digest Panel] Start transcription error:", error);
        const message = error?.message || "启动转录时发生未知错误。";
        if (!restoreRetranscriptionFallback(videoId, error?.code, message)) {
          ui.showError("转写失败", message);
        }
      } finally {
        if (digestInFlightVideoId === videoId) digestInFlightVideoId = null;
        retranscriptionInProgress = false;
        retranscriptionFallback = null;
      }
    }

    function buildTimestampedTranscript(turns, transcript) {
      const entries = Array.isArray(turns) && turns.length
        ? turns
        : (Array.isArray(transcript) ? transcript : []);
      return entries
        .map((entry) => {
          const seconds = Number(entry?.start ?? entry?.timestampSeconds ?? entry?.timestamp);
          const text = String(entry?.text || entry?.rawText || "").trim();
          if (!Number.isFinite(seconds) || seconds < 0 || !text) return "";
          return `[${XYZ_DOMAIN.formatTimestamp(seconds)}] ${text}`;
        })
        .filter(Boolean)
        .join("\n");
    }

    function resolveTimestampedTranscript(value, turns, transcript) {
      const timestamped = typeof value === "string" ? value.trim() : "";
      if (/\[\d+:\d{2}\]/.test(timestamped)) return timestamped;
      return buildTimestampedTranscript(turns, transcript);
    }

    function rebuildCachedTranscript(timestampedText) {
      return String(timestampedText || "")
        .split("\n")
        .map((line) => {
          const match = line.match(/^\s*\[(\d+):(\d{2})\]\s*(.+?)\s*$/);
          if (!match) return null;
          const start = Number(match[1]) * 60 + Number(match[2]);
          const text = match[3].trim();
          return Number.isFinite(start) && text
            ? { start, duration: 0, rawText: text, text, speaker: null }
            : null;
        })
        .filter(Boolean);
    }

    function rebuildPlainTextTranscript(transcriptText) {
      return String(transcriptText || "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        // 早期纯文本缓存不包含真实时间轴；保留内容展示，但不伪造可跳转的时刻。
        .map((text) => ({ start: null, duration: 0, rawText: text, text, speaker: null }));
    }

    async function restoreCachedDigest(videoId, videoUrl, cached) {
      const current = state();
      const restoredTimestampedTranscript = resolveTimestampedTranscript(
        cached.transcriptTimestamped || cached.transcriptTextTimestamped,
        cached.turns,
        cached.transcript,
      );
      const recoveredTimestampedEntries = rebuildCachedTranscript(restoredTimestampedTranscript);
      const restoredTranscript = Array.isArray(cached.transcript) && cached.transcript.length
        ? cached.transcript
        : recoveredTimestampedEntries.length
          ? recoveredTimestampedEntries
          : rebuildPlainTextTranscript(cached.transcriptText);
      const restoredTurns = Array.isArray(cached.turns) && cached.turns.length
        ? cached.turns
        : restoredTranscript;
      const restoredTranscriptText = cached.transcriptText
        || restoredTurns.map((entry) => entry.text || entry.rawText || "").filter(Boolean).join("\n");
      const isCurrentEpisode = current.currentVideoId === videoId;
      update({
        currentVideoId: videoId,
        currentVideoUrl: videoUrl,
        currentPodcastId: isCurrentEpisode ? current.currentPodcastId : "",
        currentVideoTitle: isCurrentEpisode
          ? current.currentVideoTitle || cached.videoTitle || ""
          : cached.videoTitle || "",
        currentChannelName: isCurrentEpisode
          ? current.currentChannelName || cached.channelName || ""
          : cached.channelName || "",
        currentVideoDescription: isCurrentEpisode ? current.currentVideoDescription : "",
        currentVideoDuration: isCurrentEpisode ? current.currentVideoDuration : 0,
        currentAnalysis: {
          chapters: Array.isArray(cached.chapters) ? cached.chapters : null,
          coreChallenges: Array.isArray(cached.coreChallenges) ? cached.coreChallenges : null,
          counterIntuitive: Array.isArray(cached.counterIntuitive) ? cached.counterIntuitive : null,
        },
        currentTranscript: restoredTranscript.length ? restoredTranscript : null,
        currentTurns: restoredTurns.length ? restoredTurns : null,
        currentTranscriptText: restoredTranscriptText || null,
        currentTranscriptTimestamped: restoredTimestampedTranscript || null,
        currentTranscriptLanguage: cached.transcriptLanguage || null,
        currentDiarization: cached.diarization || null,
        currentAsrModel: cached.asrModel || null,
        currentVideoImage: isCurrentEpisode
          ? current.currentVideoImage || cached.coverImage || ""
          : cached.coverImage || "",
        transcriptLoadedFromCache: true,
      });
      ui.resetOverviewLoading();
      if (!cached.coverImage && state().currentVideoImage) {
        try {
          await storage.save(videoId, { ...cached, coverImage: state().currentVideoImage });
        } catch (_error) {
          // Metadata backfill is best-effort.
        }
      }
      ui.renderVideoInfo();
      ui.resetChaptersView();
      ui.renderTranscript();
      ui.renderCachedAnalysis(state().currentAnalysis);
      syncState("results");
      ui.loadNotes(videoId);
      ui.setupExplainFeature();
    }

    async function restoreHistoryEpisode(videoId) {
      if (!videoId) return false;
      try {
        const cached = await storage.load(videoId);
        if (!cached) return false;
        await restoreCachedDigest(videoId, XYZ_DOMAIN.canonicalEpisodeUrl(videoId), cached);
        return true;
      } catch (error) {
        console.error("[小宇宙 Digest Panel] Restore history digest error:", error);
        return false;
      }
    }

    async function retranscribe() {
      const current = state();
      const { currentVideoId, currentVideoUrl } = current;
      if (!currentVideoId || retranscriptionInProgress) return;
      if (!window.confirm("要按当前设置重新识别本集语音吗？新识别完成前会保留当前文字稿；失败或停止时将继续使用旧稿。")) return;
      // 除了页面内存，额外读取持久缓存。这样即使页面此前没有正确渲染旧稿，
      // 停止二次识别时也能够从本地缓存回退。
      const cached = await storage.load(currentVideoId);
      const source = current.currentTranscript || current.currentTurns ? current : cached;
      retranscriptionFallback = source && {
        currentVideoId,
        currentVideoUrl,
        currentAnalysis: source.currentAnalysis || {
          chapters: Array.isArray(source.chapters) ? source.chapters : null,
          coreChallenges: Array.isArray(source.coreChallenges) ? source.coreChallenges : null,
          counterIntuitive: Array.isArray(source.counterIntuitive) ? source.counterIntuitive : null,
        },
        currentTranscript: source.currentTranscript || source.transcript || null,
        currentTurns: source.currentTurns || source.turns || null,
        currentTranscriptText: source.currentTranscriptText || source.transcriptText || null,
        currentTranscriptTimestamped: resolveTimestampedTranscript(
          source.currentTranscriptTimestamped || source.transcriptTimestamped || source.transcriptTextTimestamped,
          source.currentTurns || source.turns,
          source.currentTranscript || source.transcript,
        ),
        currentTranscriptLanguage: source.currentTranscriptLanguage || source.transcriptLanguage || null,
        currentDiarization: source.currentDiarization || source.diarization || null,
        currentAsrModel: source.currentAsrModel || source.asrModel || null,
        transcriptLoadedFromCache: source === cached || Boolean(source.transcriptLoadedFromCache),
      };
      retranscriptionInProgress = true;
      await startDigest(currentVideoId, currentVideoUrl, true);
    }

    async function stopTranscription() {
      if (!digestInFlightVideoId) return;
      const videoId = digestInFlightVideoId;
      ui.setStopping();
      ui.updateLoading("正在停止转录", "正在取消本地转录任务，请稍候…");
      try {
        await chrome.runtime.sendMessage({ action: "cancelTranscript", videoId });
      } catch (error) {
        console.error("停止转录失败：", error);
      }
    }

    async function saveToCache(videoId) {
      const current = state();
      if (!videoId || !current.currentTranscript) return;
      try {
        await storage.save(videoId, {
          chapters: current.currentAnalysis?.chapters ?? null,
          coreChallenges: current.currentAnalysis?.coreChallenges ?? null,
          counterIntuitive: current.currentAnalysis?.counterIntuitive ?? null,
          transcript: current.currentTranscript,
          turns: current.currentTurns,
          transcriptText: current.currentTranscriptText,
          transcriptTimestamped: current.currentTranscriptTimestamped,
          transcriptLanguage: current.currentTranscriptLanguage,
          diarization: current.currentDiarization,
          asrModel: current.currentAsrModel || null,
          videoTitle: current.currentVideoTitle,
          channelName: current.currentChannelName,
          coverImage: current.currentVideoImage || "",
          timestamp: Date.now(),
        });
        await library.upsertHistoryEntry(videoId, current.currentVideoTitle, current.currentChannelName, current.currentVideoImage);
      } catch (error) {
        console.error("Cache save error:", error);
      }
    }

    function handleProgress(message) {
      if (message.episodeId && state().currentVideoId && message.episodeId !== state().currentVideoId) return;
      ui.updateLoading(message.title, message.subtitle, message.progress);
    }

    function extractVideoId(url) {
      try {
        const match = new URL(url).pathname.match(/\/episode\/([0-9a-fA-F]+)/);
        return match ? match[1] : null;
      } catch {
        return null;
      }
    }

    async function startCurrentDigest() {
      let { currentVideoId, currentVideoUrl } = state();
      // 侧边栏刚打开时，用户可能在 tab 信息异步读取完成前点击按钮。
      // 不再静默返回：先重新读取活动单集，再明确展示可恢复的错误状态。
      if (!currentVideoId || !currentVideoUrl) {
        await checkCurrentTab();
        ({ currentVideoId, currentVideoUrl } = state());
      }
      if (!currentVideoId || !currentVideoUrl) {
        ui.showError("未找到可转录的单集", "请确认当前打开的是小宇宙单集页面，然后重试。");
        return;
      }
      await startDigest(currentVideoId, currentVideoUrl);
    }

    return { initTabTracking, checkCurrentTab, startDigest, startCurrentDigest, restoreHistoryEpisode, retranscribe, stopTranscription, handleProgress, saveToCache };
  }

  return { create };
})();
