var XYZ_PLAYBACK_CONTROLLER = (() => {
  function create({ getTranscript, isChaptersViewActive }) {
    let autoScrollEnabled = true;
    let autoScrollInterval = null;
    let lastAutoScrollTime = 0;

    function followButton() {
      return document.getElementById("followPlaybackBtn");
    }

    function start(autoscroll = true) {
      const transcript = getTranscript();
      if (!transcript?.length || autoScrollInterval) return;
      autoScrollEnabled = autoscroll;
      const button = followButton();
      if (button) button.hidden = autoscroll;
      autoScrollInterval = setInterval(tick, 200);
      const contentArea = document.getElementById("contentArea");
      contentArea?.removeEventListener("scroll", onContentAreaScroll);
      contentArea?.addEventListener("scroll", onContentAreaScroll);
    }

    function stop() {
      if (autoScrollInterval) clearInterval(autoScrollInterval);
      autoScrollInterval = null;
      autoScrollEnabled = true;
      lastAutoScrollTime = 0;
      const button = followButton();
      if (button) button.hidden = true;
      document.querySelectorAll(".transcript-entry.active-playback").forEach((element) => {
        element.classList.remove("active-playback");
      });
    }

    async function tick() {
      try {
        const result = await chrome.runtime.sendMessage({
          action: XYZ_DOMAIN.ACTIONS.RELAY_TO_CONTENT,
          payload: { action: XYZ_DOMAIN.ACTIONS.GET_CURRENT_TIME },
        });
        if (result?.success && result.response) highlight(result.response.currentTime || 0);
      } catch {
        // 标签页关闭或导航期间无须打断侧边栏。
      }
    }

    function scrollToActive() {
      const active = document.querySelector("#transcriptList .transcript-entry.active-playback");
      if (!active) return false;
      lastAutoScrollTime = Date.now();
      active.scrollIntoView({ behavior: "smooth", block: "center" });
      return true;
    }

    function highlight(currentSeconds) {
      const entries = Array.from(document.querySelectorAll("#transcriptList .transcript-entry[data-seconds]"));
      let active = null;
      entries.forEach((entry, index) => {
        const start = Number(entry.dataset.seconds);
        const next = entries[index + 1] ? Number(entries[index + 1].dataset.seconds) : Infinity;
        if (currentSeconds >= start && currentSeconds < next) active = entry;
      });
      if (!active || active.classList.contains("active-playback")) return;
      document.querySelectorAll("#transcriptList .transcript-entry").forEach((entry) => entry.classList.remove("active-playback"));
      active.classList.add("active-playback");
      if (autoScrollEnabled) {
        lastAutoScrollTime = Date.now();
        active.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }

    function resumeFollowing() {
      autoScrollEnabled = true;
      const button = followButton();
      if (button) button.hidden = true;
      if (!scrollToActive()) void tick();
    }

    function onContentAreaScroll() {
      if (Date.now() - lastAutoScrollTime < 1000) return;
      if (autoScrollEnabled && autoScrollInterval) {
        autoScrollEnabled = false;
        const button = followButton();
        if (button) button.hidden = false;
      }
    }

    function updateBackToTopVisibility(isChaptersViewActiveOverride) {
      const contentArea = document.getElementById("contentArea");
      const button = document.getElementById("backToTopBtn");
      if (!contentArea || !button) return;
      const transcriptPanel = document.querySelector('.tab-panel[data-panel="transcript"]');
      const isChaptersView = typeof isChaptersViewActiveOverride === "function"
        ? isChaptersViewActiveOverride()
        : isChaptersViewActive();
      const isTranscript = transcriptPanel?.classList.contains("active") && !isChaptersView;
      button.hidden = !(isTranscript && contentArea.scrollTop > 200);
    }

    return { start, stop, scrollToActive, resumeFollowing, updateBackToTopVisibility };
  }

  return { create };
})();
