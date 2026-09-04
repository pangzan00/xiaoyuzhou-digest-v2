var XYZ_LIBRARY_CONTROLLER = (() => {
  const HISTORY_STORAGE_KEY = "xyz_history";
  const HISTORY_MAX_ENTRIES = 200;
  const PODCASTS_STORAGE_KEY = "xyz_podcasts";
  const PODCASTS_MAX_ENTRIES = 200;
  const PODCAST_METADATA_BACKFILL_LIMIT = 6;

    function create({ getState, setState, escapeHtml, renderFailureState, downloadTextFile, restoreHistoryEpisode }) {
    const episodesCache = new Map();

    function state() {
      return getState();
    }

    function update(patch) {
      setState(patch);
    }

    function getActivePodcastId() {
      const { activePodcastPid, currentPodcastId } = state();
      return activePodcastPid || currentPodcastId;
    }

    async function upsertHistoryEntry(videoId, title, channel, image) {
      if (!videoId || !title) return;
      try {
        const result = await chrome.storage.local.get(HISTORY_STORAGE_KEY);
        let history = Array.isArray(result[HISTORY_STORAGE_KEY])
          ? result[HISTORY_STORAGE_KEY]
          : [];
        history = history.filter((entry) => entry && entry.videoId !== videoId);
        history.unshift({
          videoId,
          title,
          channel: channel || "",
          image: image || "",
          timestamp: Date.now(),
        });
        await chrome.storage.local.set({
          [HISTORY_STORAGE_KEY]: history.slice(0, HISTORY_MAX_ENTRIES),
        });
      } catch (error) {
        console.error("[小宇宙 Digest Panel] Upsert history error:", error);
      }
    }

    async function backfillHistoryFromCache() {
      try {
        const allData = await chrome.storage.local.get(null);
        const result = await chrome.storage.local.get(HISTORY_STORAGE_KEY);
        let stored = Array.isArray(result[HISTORY_STORAGE_KEY])
          ? result[HISTORY_STORAGE_KEY]
          : [];
        const storedIds = new Set(stored.map((entry) => entry?.videoId).filter(Boolean));
        const missing = Object.keys(allData)
          .filter((key) => key.startsWith("digest_"))
          .map((key) => {
            const digest = allData[key];
            return {
              videoId: key.slice("digest_".length),
              title: digest?.videoTitle || "",
              channel: digest?.channelName || "",
              image: digest?.coverImage || "",
              timestamp: Number(digest?.timestamp) || 0,
            };
          })
          .filter((entry) => entry.videoId && entry.title && !storedIds.has(entry.videoId));

        if (missing.length) {
          stored = [...missing, ...stored]
            .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
            .slice(0, HISTORY_MAX_ENTRIES);
          await chrome.storage.local.set({ [HISTORY_STORAGE_KEY]: stored });
        }
      } catch (error) {
        console.error("[小宇宙 Digest Panel] Backfill history error:", error);
      }
    }

    async function exportHistory() {
      const button = document.getElementById("exportHistoryBtn");
      if (button) button.disabled = true;
      try {
        await backfillHistoryFromCache();
        const allData = await chrome.storage.local.get(null);
        const result = await chrome.storage.local.get(HISTORY_STORAGE_KEY);
        const entries = (Array.isArray(result[HISTORY_STORAGE_KEY])
          ? result[HISTORY_STORAGE_KEY]
          : []
        )
          .filter((entry) => entry?.videoId && entry.title)
          .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        if (!entries.length) return;

        const lines = [
          "# 小宇宙 Digest 历史导出",
          "",
          `导出时间: ${new Date().toLocaleString()}`,
          `共 ${entries.length} 集`,
          "",
          "=".repeat(60),
          "",
        ];
        entries.forEach((entry, index) => {
          lines.push(`## ${index + 1}. ${entry.title}`, "");
          if (entry.channel) lines.push(`- 播客: ${entry.channel}`);
          lines.push(`- 链接: https://www.xiaoyuzhoufm.com/episode/${entry.videoId}`);
          if (entry.timestamp) lines.push(`- 保存时间: ${new Date(entry.timestamp).toLocaleString()}`);
          lines.push("");
          appendCachedDigest(lines, allData[`digest_${entry.videoId}`]);
          lines.push("-".repeat(60), "");
        });
        downloadTextFile(
          lines.join("\n"),
          `xiaoyuzhou-history-${new Date().toISOString().slice(0, 10)}.md`,
        );
      } catch (error) {
        console.error("[小宇宙 Digest Panel] Export history error:", error);
      } finally {
        if (button) button.disabled = false;
      }
    }

    function appendCachedDigest(lines, cached) {
      if (!cached) return;
      const transcript = cached.transcriptTimestamped || cached.transcriptText || "";
      if (transcript) lines.push("### 文字稿", "", transcript, "");
      const hasChapters = Array.isArray(cached.chapters) && cached.chapters.length;
      const hasChallenges = Array.isArray(cached.coreChallenges) && cached.coreChallenges.length;
      const hasCounter = Array.isArray(cached.counterIntuitive) && cached.counterIntuitive.length;
      if (!(hasChapters || hasChallenges || hasCounter)) return;
      lines.push("### 概览", "");
      if (hasChapters) {
        lines.push("#### 章节", "");
        cached.chapters.forEach((item) => {
          lines.push(`- [${item.timestamp}] ${item.title}`);
          if (item.summary) lines.push(`  ${item.summary}`);
        });
        lines.push("");
      }
      if (hasChallenges) {
        lines.push("#### 核心挑战", "");
        cached.coreChallenges.forEach((item) => {
          lines.push(`- 挑战${item.topic ? `（${item.topic}）` : ""}: ${item.challenge}`);
          if (item.solution) lines.push(`  - 解决: ${item.solution}`);
        });
        lines.push("");
      }
      if (hasCounter) {
        lines.push("#### 反常识", "");
        cached.counterIntuitive.forEach((item) => {
          lines.push(`- ${item.claim}`);
          if (item.explanation) lines.push(`  ${item.explanation}`);
        });
        lines.push("");
      }
    }

    async function toggleHistoryPanel() {
      const panel = document.getElementById("historyPanel");
      const button = document.getElementById("historyBtn");
      if (!panel) return;
      if (isOpen(panel)) {
        closeHistoryPanel();
        return;
      }
      closeEpisodesPanel();
      await loadHistory();
      openPanel(panel, button);
    }

    function closeHistoryPanel() {
      closePanel("historyPanel", "historyBtn");
    }

    async function prefetchEpisodes(episodeId, podcastId) {
      if ((podcastId && episodesCache.has(podcastId)) || !episodeId) return;
      try {
        const result = await chrome.runtime.sendMessage({
          action: "fetchPodcastEpisodes",
          episodeId,
          podcastId,
        });
        if (result?.success && result.pid) {
          episodesCache.set(result.pid, result);
          await rememberBrowsedPodcast(result, getCurrentPodcastFallback(result.pid));
        }
      } catch (_error) {
        // 点击「更多」时会再次请求。
      }
    }

    function firstNonEmptyText(...values) {
      for (const value of values) {
        const text = typeof value === "string" ? value.trim() : "";
        if (text) return text;
      }
      return "";
    }

    function positiveNumber(...values) {
      for (const value of values) {
        const number = Number(value);
        if (Number.isFinite(number) && number > 0) return number;
      }
      return 0;
    }

    function buildPodcastRecord(data, existing = {}, fallback = {}, lastVisitedAt = Date.now()) {
      const pid = String(data?.pid || existing?.pid || "").trim();
      return {
        pid,
        // 新解析到的字段优先；解析暂时缺字段时保留已有资料，绝不以空值覆盖。
        title: firstNonEmptyText(data?.title, fallback?.title, existing?.title),
        author: firstNonEmptyText(data?.author, fallback?.author, existing?.author),
        image: firstNonEmptyText(data?.coverImage, data?.image, fallback?.image, existing?.image),
        episodeCount: positiveNumber(data?.episodeCount, fallback?.episodeCount, existing?.episodeCount),
        rssUrl: firstNonEmptyText(
          data?.rssUrl,
          fallback?.rssUrl,
          existing?.rssUrl,
          pid ? `https://www.xiaoyuzhoufm.com/podcast/${pid}` : "",
        ),
        lastVisitedAt,
      };
    }

    function getCurrentPodcastFallback(podcastId) {
      const current = state();
      if (!podcastId || String(current.currentPodcastId || "") !== String(podcastId)) return {};
      return {
        title: current.currentChannelName,
        image: current.currentVideoImage,
      };
    }

    function needsPodcastMetadata(podcast) {
      return !firstNonEmptyText(podcast?.title) || !firstNonEmptyText(podcast?.image);
    }

    async function rememberBrowsedPodcast(data, fallback = {}) {
      if (!data?.pid) return;
      try {
        const result = await chrome.storage.local.get(PODCASTS_STORAGE_KEY);
        let podcasts = Array.isArray(result[PODCASTS_STORAGE_KEY])
          ? result[PODCASTS_STORAGE_KEY]
          : [];
        const existing = podcasts.find((podcast) => podcast?.pid === data.pid) || {};
        const record = buildPodcastRecord(data, existing, fallback);
        podcasts = podcasts.filter((podcast) => podcast?.pid !== data.pid);
        podcasts.unshift(record);
        podcasts = podcasts.slice(0, PODCASTS_MAX_ENTRIES);
        await chrome.storage.local.set({ [PODCASTS_STORAGE_KEY]: podcasts });
        update({ browsedPodcasts: podcasts });
      } catch (error) {
        console.error("[小宇宙 Digest Panel] Remember podcast error:", error);
      }
    }

    async function backfillBrowsedPodcastMetadata(entries) {
      const incomplete = entries
        .filter((podcast) => podcast?.pid && needsPodcastMetadata(podcast))
        .slice(0, PODCAST_METADATA_BACKFILL_LIMIT);
      if (!incomplete.length) return entries;

      const recovered = new Map();
      for (const podcast of incomplete) {
        try {
          const result = await chrome.runtime.sendMessage({
            action: "fetchPodcastEpisodes",
            episodeId: "",
            podcastId: podcast.pid,
          });
          if (result?.success && result.pid) recovered.set(result.pid, result);
        } catch (_error) {
          // 单个节目页读取失败时保留旧记录，下一次打开仍会重试修复。
        }
      }
      if (!recovered.size) return entries;

      const repaired = entries.map((podcast) => {
        const data = recovered.get(podcast.pid);
        return data
          ? buildPodcastRecord(data, podcast, {}, Number(podcast.lastVisitedAt) || Date.now())
          : podcast;
      });
      await chrome.storage.local.set({ [PODCASTS_STORAGE_KEY]: repaired });
      return repaired;
    }

    async function toggleEpisodesPanel() {
      const panel = document.getElementById("episodesPanel");
      const button = document.getElementById("episodesBtn");
      if (!panel) return;
      if (isOpen(panel)) {
        closeEpisodesPanel();
        return;
      }
      closeHistoryPanel();
      openPanel(panel, button);
      switchEpisodesTab("current");
      await loadEpisodes();
    }

    function closeEpisodesPanel() {
      closePanel("episodesPanel", "episodesBtn");
    }

    function switchEpisodesTab(tabName) {
      document.querySelectorAll(".episodes-tab").forEach((tab) => {
        const active = tab.dataset.episodesTab === tabName;
        tab.classList.toggle("active", active);
        tab.setAttribute("aria-selected", String(active));
      });
      const episodesList = document.getElementById("episodesList");
      const podcastList = document.getElementById("podcastList");
      if (episodesList) episodesList.hidden = tabName !== "current";
      if (podcastList) podcastList.hidden = tabName !== "history";
      const openButton = document.getElementById("openPodcastBtn");
      if (openButton) openButton.hidden = tabName !== "current";
    }

    async function loadEpisodes() {
      const list = document.getElementById("episodesList");
      if (!list) return;
      const { currentVideoId, currentPodcastId, activePodcastPid } = state();
      const podcastId = getActivePodcastId();
      const isBrowsingAnotherPodcast = Boolean(activePodcastPid && activePodcastPid !== currentPodcastId);
      const cached = podcastId ? episodesCache.get(podcastId) : null;
      // 早期版本可能留下 success 但 episodes 为空的缓存；不能让它永久遮蔽
      // 后台的新版解析结果，否则「本节目单集」会一直显示空列表。
      if (cached && Array.isArray(cached.episodes) && cached.episodes.length) {
        renderEpisodes(cached);
        return;
      }
      if (cached && podcastId) episodesCache.delete(podcastId);
      list.innerHTML = '<div class="history-empty">正在获取节目单集…</div>';
      try {
        const result = await chrome.runtime.sendMessage({
          action: "fetchPodcastEpisodes",
          // 浏览历史节目时不能把当前页面的单集当作目标节目锚点；
          // 后台只需使用明确的目标 pid 请求节目页。
          episodeId: isBrowsingAnotherPodcast ? "" : currentVideoId,
          podcastId: podcastId || currentPodcastId,
        });
        if (!result?.success || !Array.isArray(result.episodes) || !result.episodes.length) {
          list.innerHTML = renderFailureState(
            result?.message || result?.error || "未读取到该节目可展示的单集，请重试。",
            "episodes-failure-state",
          );
          return;
        }
        if (result.pid) episodesCache.set(result.pid, result);
        await rememberBrowsedPodcast(result, getCurrentPodcastFallback(result.pid));
        renderEpisodes(result);
      } catch (error) {
        list.innerHTML = renderFailureState(`获取节目单集失败：${error.message}`, "episodes-failure-state");
      }
    }

    function renderEpisodes(data) {
      const list = document.getElementById("episodesList");
      if (!list) return;
      const episodes = Array.isArray(data.episodes) ? data.episodes : [];
      const total = Number(data.episodeCount) || episodes.length;
      setEpisodesHeader(data.title || "节目单集", `${total} 集`);
      list.innerHTML = "";
      if (!episodes.length) {
        list.appendChild(createEmpty("未找到该节目的其他单集。"));
        return;
      }
      if (total > episodes.length) {
        const note = document.createElement("div");
        note.className = "episodes-note";
        note.textContent = `仅展示最新 ${episodes.length} 集，共 ${total} 集，可打开节目主页查看全部。`;
        list.appendChild(note);
      }
      const { activePodcastPid, currentPodcastId, currentVideoId } = state();
      if (activePodcastPid && activePodcastPid !== currentPodcastId) {
        const back = document.createElement("div");
        back.className = "episodes-note episodes-back";
        back.innerHTML = '正在查看其他节目的单集 <button class="episodes-back-btn" type="button">返回本节目</button>';
        back.querySelector(".episodes-back-btn").addEventListener("click", () => {
          update({ activePodcastPid: null });
          void loadEpisodes();
        });
        list.appendChild(back);
      }
      episodes.forEach((episode) => {
        const item = createListItem({
          image: episode.image,
          title: episode.title,
          meta: [
            episode.duration && formatDuration(episode.duration),
            episode.pubDate && formatPubDate(episode.pubDate),
          ].filter(Boolean),
          current: data.pid === currentPodcastId && episode.eid === currentVideoId,
        });
        item.addEventListener("click", () => void openEpisode(episode.eid));
        list.appendChild(item);
      });
    }

    async function loadBrowsedPodcasts() {
      let entries = [];
      try {
        const result = await chrome.storage.local.get(PODCASTS_STORAGE_KEY);
        entries = (Array.isArray(result[PODCASTS_STORAGE_KEY]) ? result[PODCASTS_STORAGE_KEY] : [])
          .filter((podcast) => podcast?.pid)
          .sort((a, b) => (b.lastVisitedAt || 0) - (a.lastVisitedAt || 0));
        // 兼容修复前已经入库的空标题/空封面记录；只更新缺字段的条目，
        // 并保留原先的浏览时间，避免修复过程打乱历史排序。
        entries = await backfillBrowsedPodcastMetadata(entries);
        entries.sort((a, b) => (b.lastVisitedAt || 0) - (a.lastVisitedAt || 0));
        update({ browsedPodcasts: entries });
      } catch (error) {
        console.error("[小宇宙 Digest Panel] Load podcasts error:", error);
      }
      setEpisodesHeader("浏览过的节目", entries.length ? `${entries.length} 个节目` : "");
      renderBrowsedPodcasts(entries);
    }

    function renderBrowsedPodcasts(entries) {
      const list = document.getElementById("podcastList");
      if (!list) return;
      list.innerHTML = "";
      if (!entries.length) {
        list.appendChild(createEmpty("还没有浏览过的节目。打开任意单集转写后，会自动记录到这里。"));
        return;
      }
      const { currentPodcastId } = state();
      entries.forEach((podcast) => {
        const item = createListItem({
          image: podcast.image,
          title: podcast.title || podcast.author || "未命名节目",
          meta: [
            podcast.episodeCount && `${podcast.episodeCount} 集`,
            podcast.lastVisitedAt && formatHistoryTime(podcast.lastVisitedAt),
          ].filter(Boolean),
          current: podcast.pid === currentPodcastId,
        });
        item.addEventListener("click", () => {
          update({ activePodcastPid: podcast.pid });
          switchEpisodesTab("current");
          void loadEpisodes();
        });
        list.appendChild(item);
      });
    }

    async function openEpisode(episodeId) {
      closeEpisodesPanel();
      await openEpisodeUrl(episodeId, "Open episode");
    }

    async function openHistoryEpisode(videoId) {
      closeHistoryPanel();
      // 本地缓存是历史记录的主数据源：先恢复已保存的文字稿，页面导航仅用于
      // 让用户回到对应单集并继续播放，避免等待小宇宙页面重载导致内容空白。
      await restoreHistoryEpisode?.(videoId);
      await openEpisodeUrl(videoId, "Open history episode");
    }

    async function openEpisodeUrl(videoId, logLabel) {
      if (!videoId) return;
      const url = `https://www.xiaoyuzhoufm.com/episode/${videoId}`;
      try {
        if (state().xiaoyuzhouTabId) {
          await chrome.tabs.update(state().xiaoyuzhouTabId, { url, active: true });
        } else {
          await chrome.tabs.create({ url });
        }
      } catch (error) {
        console.error(`[小宇宙 Digest Panel] ${logLabel} error:`, error);
        try {
          await chrome.tabs.create({ url });
        } catch (fallbackError) {
          console.error("[小宇宙 Digest Panel] Create tab error:", fallbackError);
        }
      }
    }

    function openPodcastPage() {
      const podcastId = getActivePodcastId();
      if (podcastId) chrome.tabs.create({ url: `https://www.xiaoyuzhoufm.com/podcast/${podcastId}` });
    }

    async function loadHistory() {
      const list = document.getElementById("historyList");
      const count = document.getElementById("historyCount");
      if (!list) return;
      let entries = [];
      try {
        await backfillHistoryFromCache();
        const result = await chrome.storage.local.get(HISTORY_STORAGE_KEY);
        entries = (Array.isArray(result[HISTORY_STORAGE_KEY]) ? result[HISTORY_STORAGE_KEY] : [])
          .filter((entry) => entry?.videoId && entry.title)
          .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      } catch (error) {
        console.error("[小宇宙 Digest Panel] Load history error:", error);
      }
      if (count) count.textContent = entries.length ? `${entries.length} 集` : "";
      list.innerHTML = "";
      if (!entries.length) {
        list.appendChild(createEmpty("还没有转写记录。打开一个小宇宙单集转写后，会自动出现在这里。"));
        return;
      }
      const { currentVideoId } = state();
      entries.forEach((entry) => {
        const item = createListItem({
          image: entry.image,
          title: entry.title,
          channel: entry.channel,
          meta: entry.timestamp ? [formatHistoryTime(entry.timestamp)] : [],
          current: entry.videoId === currentVideoId,
        });
        item.addEventListener("click", () => void openHistoryEpisode(entry.videoId));
        list.appendChild(item);
      });
    }

    function init() {
      document.getElementById("historyBtn")?.addEventListener("click", () => void toggleHistoryPanel());
      document.getElementById("episodesBtn")?.addEventListener("click", () => void toggleEpisodesPanel());
      document.getElementById("openPodcastBtn")?.addEventListener("click", openPodcastPage);
      document.getElementById("episodesTabCurrent")?.addEventListener("click", () => {
        switchEpisodesTab("current");
        void loadEpisodes();
      });
      document.getElementById("episodesTabHistory")?.addEventListener("click", () => {
        switchEpisodesTab("history");
        void loadBrowsedPodcasts();
      });
      document.getElementById("exportHistoryBtn")?.addEventListener("click", () => void exportHistory());
      document.addEventListener("click", closePanelsOnOutsideClick);
    }

    function closePanelsOnOutsideClick(event) {
      closeWhenClickOutside(event, "historyPanel", "historyBtn", closeHistoryPanel);
      closeWhenClickOutside(event, "episodesPanel", "episodesBtn", closeEpisodesPanel);
    }

    function resetActivePodcast() {
      update({ activePodcastPid: null });
    }

    return {
      init,
      backfillHistoryFromCache,
      upsertHistoryEntry,
      prefetchEpisodes,
      resetActivePodcast,
    };
  }

  function createListItem({ image, title, channel, meta, current }) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "history-item";
    if (current) item.classList.add("current");
    const cover = image
      ? `<span class="history-item-thumb"><img class="history-item-cover" src="${escapeHtml(image)}" alt="" loading="lazy" referrerpolicy="no-referrer" /></span>`
      : '<span class="history-item-thumb history-item-thumb-empty"></span>';
    const metadata = [];
    if (channel) metadata.push(`<span class="history-item-channel">${escapeHtml(channel)}</span>`);
    (meta || []).forEach((value) => {
      if (metadata.length) metadata.push('<span class="history-item-dot">·</span>');
      metadata.push(`<span>${escapeHtml(value)}</span>`);
    });
    item.innerHTML = `${cover}<span class="history-item-body"><span class="history-item-title">${escapeHtml(title)}</span><span class="history-item-meta">${metadata.join("")}</span></span>`;
    const coverImage = item.querySelector(".history-item-cover");
    coverImage?.addEventListener("error", () => {
      coverImage.style.display = "none";
      coverImage.parentElement?.classList.add("history-item-thumb-empty");
    });
    return item;
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text || "";
    return div.innerHTML;
  }

  function createEmpty(text) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = text;
    return empty;
  }

  function setEpisodesHeader(title, count) {
    const titleElement = document.getElementById("episodesPanelTitle");
    const countElement = document.getElementById("episodesCount");
    if (titleElement) titleElement.textContent = title;
    if (countElement) countElement.textContent = count;
  }

  function closeWhenClickOutside(event, panelId, buttonId, close) {
    const panel = document.getElementById(panelId);
    const button = document.getElementById(buttonId);
    if (panel && isOpen(panel) && !panel.contains(event.target) && !button?.contains(event.target)) close();
  }

  function openPanel(panel, button) {
    panel.hidden = false;
    button?.classList.add("active");
    button?.setAttribute("aria-expanded", "true");
  }

  function closePanel(panelId, buttonId) {
    const panel = document.getElementById(panelId);
    const button = document.getElementById(buttonId);
    if (panel) panel.hidden = true;
    button?.classList.remove("active");
    button?.setAttribute("aria-expanded", "false");
  }

  function isOpen(panel) {
    return !panel.hidden;
  }

  function formatDuration(seconds) {
    const minutes = Math.floor(Math.max(0, Math.round(Number(seconds) || 0)) / 60);
    return minutes >= 60 ? `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分` : `${minutes} 分钟`;
  }

  function formatPubDate(iso) {
    const date = new Date(iso);
    if (!iso || Number.isNaN(date.getTime())) return "";
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function formatHistoryTime(timestamp) {
    const date = new Date(timestamp);
    const difference = new Date() - date;
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    if (difference < minute) return "刚刚";
    if (difference < hour) return `${Math.floor(difference / minute)} 分钟前`;
    if (difference < day) return `${Math.floor(difference / hour)} 小时前`;
    if (difference < 7 * day) return `${Math.floor(difference / day)} 天前`;
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  return { create };
})();
