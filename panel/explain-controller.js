var XYZ_EXPLAIN_CONTROLLER = (() => {
  function create({ getTranscriptText, getEpisodeTitle, escapeHtml, renderFailureState }) {
    function setup() {
      const transcriptList = document.getElementById("transcriptList");
      if (!transcriptList) return;
      document.getElementById("explainTooltip")?.remove();
      const tooltip = document.createElement("div");
      tooltip.id = "explainTooltip";
      tooltip.className = "explain-tooltip";
      tooltip.innerHTML = `<button class="explain-btn">💡 讲解</button>`;
      tooltip.style.display = "none";
      document.body.appendChild(tooltip);
      let selectedText = "";
      tooltip.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      tooltip.addEventListener("mouseup", (event) => {
        event.stopPropagation();
      });
      tooltip.addEventListener("click", (event) => {
        event.stopPropagation();
      });
      document.addEventListener("mouseup", () => {
        const selection = window.getSelection();
        const text = selection.toString().trim();
        if (text && transcriptList.contains(selection.anchorNode)) {
          selectedText = text;
          const rect = selection.getRangeAt(0).getBoundingClientRect();
          tooltip.style.display = "block";
          tooltip.style.top = `${rect.bottom + window.scrollY + 8}px`;
          tooltip.style.left = `${rect.left + rect.width / 2}px`;
        } else tooltip.style.display = "none";
      });
      document.addEventListener("mousedown", (event) => {
        if (!tooltip.contains(event.target)) tooltip.style.display = "none";
      });
      tooltip.querySelector(".explain-btn").addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!selectedText) return;
        tooltip.style.display = "none";
        await show(selectedText);
      });
    }

    async function show(selectedText) {
      const modal = document.createElement("div");
      modal.id = "explainModal";
      modal.className = "explain-modal-overlay";
      modal.innerHTML = `<div class="explain-modal"><div class="explain-modal-header"><div class="explain-modal-title">讲解</div><button class="explain-modal-close" id="closeExplain">✕</button></div><div class="explain-selected-text">"${escapeHtml(selectedText.slice(0, 200))}${selectedText.length > 200 ? "..." : ""}"</div><div class="explain-modal-content" id="explanationContent"><div class="explain-loading"><div class="loading-bar"></div><span>正在分析...</span></div></div></div>`;
      document.body.appendChild(modal);
      modal.querySelector("#closeExplain").addEventListener("click", () => modal.remove());
      modal.addEventListener("click", (event) => { if (event.target === modal) modal.remove(); });
      const fullText = getTranscriptText() || "";
      const index = fullText.indexOf(selectedText);
      const transcriptContext = index < 0 ? "" : fullText.slice(Math.max(0, index - 200), index + selectedText.length + 200);
      const content = modal.querySelector("#explanationContent");
      try {
        const result = await chrome.runtime.sendMessage({ action: XYZ_DOMAIN.ACTIONS.EXPLAIN_SELECTION, selectedText, transcriptContext, videoTitle: getEpisodeTitle() });
        content.innerHTML = result?.success
          ? `<div class="explain-text">${escapeHtml(result.explanation).replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>")}</div>`
          : renderFailureState(`获取讲解失败：${result?.error || "未知错误"}`, "explain-error");
      } catch (error) {
        content.innerHTML = renderFailureState(`获取讲解失败：${error.message}`, "explain-error");
      }
    }

    return { setup };
  }
  return { create };
})();
