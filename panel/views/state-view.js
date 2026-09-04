var XYZ_STATE_VIEW = (() => {
  const STATE_NAMES = ["welcome", "loading", "error", "results"];

  function create() {
    function show(state, { inFlight = false } = {}) {
      const stop = document.getElementById("stopTranscriptionBtn");
      if (stop) {
        stop.hidden = state !== "loading" || !inFlight;
        stop.disabled = false;
        stop.textContent = "停止转录";
      }
      STATE_NAMES.forEach((name) => {
        const element = document.getElementById(`${name}State`);
        if (element) element.hidden = state !== name;
      });
    }

    function updateLoading(title, subtitle, progress) {
      const loadingText = document.getElementById("loadingText");
      const loadingSubtext = document.getElementById("loadingSubtext");
      const progressFill = document.getElementById("progressFill");
      const progressMeta = document.getElementById("progressMeta");
      if (loadingText) loadingText.textContent = title;
      if (loadingSubtext) loadingSubtext.textContent = subtitle;
      if (typeof progress !== "number" || !Number.isFinite(progress)) return;
      const percentage = Math.min(100, Math.max(0, progress));
      if (progressFill) progressFill.style.width = `${percentage}%`;
      if (progressMeta) progressMeta.textContent = `${Math.round(percentage)}%`;
    }

    function showError(title, message) {
      const errorTitle = document.getElementById("errorTitle");
      const errorMessage = document.getElementById("errorMessage");
      const errorButton = document.getElementById("errorBtn");
      if (errorTitle) errorTitle.textContent = title;
      if (errorMessage) errorMessage.textContent = message;
      if (errorButton) errorButton.textContent = "重试";
    }

    function setStartDigestAvailable(available) {
      const illustration = document.getElementById("welcomeIllustration");
      const icon = document.getElementById("welcomeIcon");
      const title = document.getElementById("welcomeTitle");
      const description = document.getElementById("welcomeDescription");
      const start = document.getElementById("startDigestBtn");
      if (illustration) illustration.hidden = !available;
      if (icon) icon.hidden = available;
      if (title) title.textContent = available ? "准备获取本集内容" : "准备好学习了吗";
      if (description) {
        description.textContent = available
          ? "点击开始获取，生成本集的文字稿与学习内容。"
          : "打开一个小宇宙单集，再点击扩展图标即可开始。";
      }
      if (start) start.hidden = !available;
    }

    function setStopping() {
      const button = document.getElementById("stopTranscriptionBtn");
      if (!button) return;
      button.disabled = true;
      button.textContent = "正在停止…";
    }

    function isShowingResults() {
      return !document.getElementById("resultsState")?.hidden;
    }

    function bind({ onRetry, onStartDigest, onRetranscribe, onStopTranscription }) {
      document.getElementById("errorBtn")?.addEventListener("click", onRetry);
      document.getElementById("startDigestBtn")?.addEventListener("click", onStartDigest);
      document.getElementById("retranscribeBtn")?.addEventListener("click", onRetranscribe);
      document.getElementById("stopTranscriptionBtn")?.addEventListener("click", onStopTranscription);
    }

    return {
      show,
      updateLoading,
      showError,
      setStartDigestAvailable,
      setStopping,
      isShowingResults,
      bind,
    };
  }

  return { create };
})();
