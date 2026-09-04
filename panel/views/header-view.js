var XYZ_HEADER_VIEW = (() => {
  function create() {
    function setVideoInfo({ title = "", channel = "" } = {}) {
      const videoInfo = document.getElementById("videoInfo");
      const videoTitle = document.getElementById("videoTitle");
      const videoChannel = document.getElementById("videoChannel");
      if (!videoInfo || !videoTitle || !videoChannel) return;
      videoTitle.textContent = title;
      videoChannel.textContent = channel;
      videoInfo.hidden = !(title || channel);
    }

    function clearVideoInfo() {
      setVideoInfo();
    }

    function setTabsVisible(visible) {
      const tabs = document.getElementById("tabsNav");
      if (tabs) tabs.hidden = !visible;
    }

    function activateTab(tabName) {
      document.querySelectorAll(".tab").forEach((tab) => {
        tab.classList.toggle("active", tab.dataset.tab === tabName);
      });
      document.querySelectorAll(".tab-panel").forEach((panel) => {
        panel.classList.toggle("active", panel.dataset.panel === tabName);
      });
    }

    function bind({ onTabChange, onOpenSettings }) {
      document.querySelectorAll(".tab").forEach((tab) => {
        tab.addEventListener("click", () => onTabChange?.(tab.dataset.tab));
      });
      document.getElementById("settingsBtn")?.addEventListener("click", () => onOpenSettings?.());
    }

    return { setVideoInfo, clearVideoInfo, setTabsVisible, activateTab, bind };
  }

  return { create };
})();
