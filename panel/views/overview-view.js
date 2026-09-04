var XYZ_OVERVIEW_VIEW = (() => {
  const MODULES = Object.freeze({
    chapters: { listId: "chapterList", field: "chapters", loadingText: "正在生成章节..." },
    challenges: { listId: "challengesList", field: "coreChallenges", loadingText: "正在提取核心挑战..." },
    counter: { listId: "counterIntuitiveList", field: "counterIntuitive", loadingText: "正在提取反常识洞察..." },
  });

  function create({ escapeHtml, renderFailureState, renderChapters, renderChallenges, renderCounter }) {
    function getModule(key) {
      return MODULES[key] || null;
    }

    function setLoading(key, text) {
      const list = document.getElementById(getModule(key)?.listId);
      if (!list) return;
      list.innerHTML = `<div class="module-loading"><img class="module-loading-img" src="assets/overview-loading.webp" alt="" aria-hidden="true" /><span class="module-loading-text">${escapeHtml(text)}</span></div>`;
    }

    function setError(key, message) {
      const list = document.getElementById(getModule(key)?.listId);
      if (list) list.innerHTML = renderFailureState(`分析失败：${message || "未知错误"}`, "module-failure-state");
    }

    function render(key, items) {
      if (key === "chapters") renderChapters(items);
      else if (key === "challenges") renderChallenges(items);
      else if (key === "counter") renderCounter(items);
    }

    function setReanalyzing(key, isLoading) {
      const button = document.querySelector(`.module-reanalyze-btn[data-module="${key}"]`);
      if (!button) return;
      button.disabled = isLoading;
      button.classList.toggle("reanalyzing", isLoading);
    }

    function renderCached(analysis) {
      if (Array.isArray(analysis?.chapters)) render("chapters", analysis.chapters);
      if (Array.isArray(analysis?.coreChallenges)) render("challenges", analysis.coreChallenges);
      if (Array.isArray(analysis?.counterIntuitive)) render("counter", analysis.counterIntuitive);
    }

    function bind({ onReanalyze }) {
      document.addEventListener("click", (event) => {
        const button = event.target.closest(".module-reanalyze-btn");
        if (button) onReanalyze?.(button.dataset.module);
      });
    }

    return { getModule, setLoading, setError, render, setReanalyzing, renderCached, bind };
  }

  return { MODULES, create };
})();
