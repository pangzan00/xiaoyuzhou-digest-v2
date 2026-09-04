var XYZ_TRANSCRIPT_VIEW = (() => {
  function create({ renderingController, playbackController }) {
    function resetChaptersView() {
      const slider = document.getElementById("transcriptSlider");
      const button = document.getElementById("toggleChaptersBtn");
      const title = document.getElementById("transcriptViewTitle");
      slider?.classList.remove("chapters-active");
      if (button) {
        button.setAttribute("aria-pressed", "false");
        button.setAttribute("title", "切换到章节预览");
      }
      if (title) title.textContent = "逐字稿";
    }

    function isChaptersViewActive() {
      return document.getElementById("transcriptSlider")?.classList.contains("chapters-active") || false;
    }

    function toggleChaptersView({ onActivateChapters, onActivateTranscript } = {}) {
      const slider = document.getElementById("transcriptSlider");
      const button = document.getElementById("toggleChaptersBtn");
      const title = document.getElementById("transcriptViewTitle");
      if (!slider) return;
      const showingChapters = !slider.classList.contains("chapters-active");
      slider.classList.toggle("chapters-active", showingChapters);
      if (button) {
        button.setAttribute("aria-pressed", String(showingChapters));
        button.setAttribute("title", showingChapters ? "切换到逐字稿" : "切换到章节预览");
      }
      if (title) title.textContent = showingChapters ? "章节预览" : "逐字稿";
      if (showingChapters) onActivateChapters?.();
      else onActivateTranscript?.();
    }

    function clear() {
      document.getElementById("transcriptList")?.replaceChildren();
      document.getElementById("transcriptSourceBadge")?.remove();
      document.querySelector(".transcript-diarization-hint")?.remove();
    }

    function bind({ onToggleChapters, onCopy, onExport }) {
      document.getElementById("toggleChaptersBtn")?.addEventListener("click", onToggleChapters);
      document.getElementById("copyTranscriptBtn")?.addEventListener("click", onCopy);
      document.getElementById("exportTranscriptBtn")?.addEventListener("click", onExport);
    }

    return {
      render: () => renderingController.renderTranscript(),
      renderChapters: (items) => renderingController.renderChapters(items),
      resetChaptersView,
      isChaptersViewActive,
      toggleChaptersView,
      clear,
      bind,
    };
  }

  return { create };
})();
