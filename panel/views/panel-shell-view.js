var XYZ_PANEL_SHELL_VIEW = (() => {
  function create() {
    function setChatActive(active) {
      document.getElementById("contentArea")?.classList.toggle("chat-active", active);
    }

    function updateBackToTopVisibility(playbackController, isChaptersViewActive) {
      if (document.getElementById("contentArea")?.classList.contains("chat-active")) {
        const button = document.getElementById("backToTopBtn");
        if (button) button.hidden = true;
        return;
      }
      playbackController.updateBackToTopVisibility(isChaptersViewActive);
    }

    function showTransientNotice(message) {
      document.getElementById("transcriptionNotice")?.remove();
      const notice = document.createElement("div");
      notice.id = "transcriptionNotice";
      notice.className = "transcription-notice";
      notice.textContent = message;
      document.body.appendChild(notice);
      setTimeout(() => notice.remove(), 5000);
    }

    function bind({ onBackToTop, onContentScroll, onChatScroll }) {
      document.getElementById("backToTopBtn")?.addEventListener("click", onBackToTop);
      document.getElementById("contentArea")?.addEventListener("scroll", onContentScroll);
      document.getElementById("episodeChatMessages")?.addEventListener("scroll", onChatScroll);
    }

    return { setChatActive, updateBackToTopVisibility, showTransientNotice, bind };
  }

  return { create };
})();
