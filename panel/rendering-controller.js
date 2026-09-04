var XYZ_RENDERING_CONTROLLER = (() => {
  function create({
    getState,
    seekTo,
    startPlaybackTracking,
    reloadNotes,
    downloadTextFile,
    sanitizeFilename,
  }) {
    let cardNoteMap = new Map();

    function escapeHtml(text) {
      const div = document.createElement("div");
      div.textContent = text || "";
      return div.innerHTML;
    }

    function renderFailureState(message, className = "") {
      return `
        <div class="failure-state ${className}">
          <img class="failure-state-img" src="assets/failure-state.webp" alt="" aria-hidden="true" />
          <div class="failure-state-message">${escapeHtml(message || "加载失败，请稍后重试。")}</div>
        </div>
      `;
    }

    function renderChapters(chapters) {
      const chapterList = document.getElementById("chapterList");
      if (!chapterList) return;
      chapterList.innerHTML = "";
      const items = Array.isArray(chapters) ? chapters : [];
      if (!items.length) {
        chapterList.innerHTML = '<li class="chapter-item chapter-item--placeholder">本集未识别到章节</li>';
        return;
      }
      items.forEach((chapter) => {
        const li = document.createElement("li");
        li.className = "chapter-item";
        li.dataset.seconds = chapter.timestampSeconds;
        li.innerHTML = `<span class="chapter-timestamp">${escapeHtml(chapter.timestamp)}</span><div class="chapter-content"><span class="chapter-title">${escapeHtml(chapter.title)}</span><span class="chapter-summary">${escapeHtml(chapter.summary || "")}</span></div>`;
        li.addEventListener("click", () => seekTo(chapter.timestampSeconds));
        chapterList.appendChild(li);
      });
    }

    function renderCounter(counter) {
      const counterList = document.getElementById("counterIntuitiveList");
      if (!counterList) return;
      counterList.innerHTML = "";
      const items = [...(Array.isArray(counter) ? counter : [])].sort((a, b) => (a.timestampSeconds || 0) - (b.timestampSeconds || 0));
      if (!items.length) {
        counterList.innerHTML = '<div class="counter-item analysis-card--placeholder">本集未识别到反常识洞察</div>';
        return;
      }
      items.forEach((item) => {
        const div = document.createElement("div");
        div.className = "counter-item";
        div.dataset.seconds = item.timestampSeconds;
        div.innerHTML = `<div class="counter-head"><span class="counter-label">反常识</span><span class="counter-timestamp">${escapeHtml(item.timestamp)}</span></div><div class="counter-claim">${escapeHtml(item.claim)}</div><div class="counter-explanation">${escapeHtml(item.explanation || "")}</div>`;
        div.addEventListener("click", () => seekTo(item.timestampSeconds));
        div.appendChild(createCardNoteButton(`反常识：${item.claim}${item.explanation ? `\n${item.explanation}` : ""}`, item.timestampSeconds));
        counterList.appendChild(div);
      });
    }

    function renderChallenges(challenges) {
      const challengesList = document.getElementById("challengesList");
      if (!challengesList) return;
      challengesList.innerHTML = "";
      const items = [...(Array.isArray(challenges) ? challenges : [])].sort((a, b) => (a.timestampSeconds || 0) - (b.timestampSeconds || 0));
      if (!items.length) {
        challengesList.innerHTML = '<div class="challenge-item analysis-card--placeholder">本集未识别到核心挑战</div>';
        return;
      }
      const groups = new Map();
      items.forEach((item) => {
        const topic = String(item.topic || "").trim();
        if (!groups.has(topic)) groups.set(topic, []);
        groups.get(topic).push(item);
      });
      groups.forEach((group, topic) => {
        if (topic) {
          const title = document.createElement("div");
          title.className = "challenge-group-title";
          title.textContent = topic;
          challengesList.appendChild(title);
        }
        group.forEach((item) => {
          const div = document.createElement("div");
          div.className = "challenge-item";
          div.dataset.seconds = item.timestampSeconds;
          div.innerHTML = `<div class="challenge-head"><span class="challenge-label">挑战</span><span class="challenge-timestamp">${escapeHtml(item.timestamp)}</span></div><div class="challenge-text">${escapeHtml(item.challenge)}</div><div class="challenge-solution"><span class="solution-label">解决方案</span><span class="solution-text">${escapeHtml(item.solution || "")}</span></div>`;
          div.addEventListener("click", () => seekTo(item.timestampSeconds));
          div.appendChild(createCardNoteButton(`挑战：${item.challenge}${item.solution ? `\n解决方案：${item.solution}` : ""}`, item.timestampSeconds));
          challengesList.appendChild(div);
        });
      });
    }

    function buildCardKey(videoId, timestampSeconds, text) {
      return `${videoId}::${Math.floor(Number(timestampSeconds) || 0)}::${text}`;
    }

    function rebuildCardNoteMap(notes) {
      cardNoteMap = new Map();
      (notes || []).forEach((note) => {
        if (note?.videoId) cardNoteMap.set(buildCardKey(note.videoId, note.timestampSeconds, note.text), note.id);
      });
    }

    function createCardNoteButton(noteText, timestampSeconds) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "card-note-btn";
      button.innerHTML = '<img src="assets/note-before.png" alt="" aria-hidden="true" />';
      const state = getState();
      const key = buildCardKey(state.currentVideoId, timestampSeconds, noteText);
      button.dataset.cardKey = key;
      if (cardNoteMap.has(key)) setCardNoteSaved(button, cardNoteMap.get(key));
      else setCardNoteUnsaved(button);
      button.addEventListener("click", async (event) => {
        event.stopPropagation();
        event.preventDefault();
        if (button.dataset.saved === "true") {
          const noteId = cardNoteMap.get(key);
          if (noteId && await deleteNoteFromStorage(noteId)) {
            cardNoteMap.delete(key);
            setCardNoteUnsaved(button);
            reloadNotes();
          }
          return;
        }
        const note = await saveCardAsNote(noteText, timestampSeconds);
        if (note) {
          cardNoteMap.set(key, note.id);
          setCardNoteSaved(button, note.id);
        }
      });
      return button;
    }

    async function saveCardAsNote(text, timestampSeconds) {
      const state = getState();
      if (!state.currentVideoId) return null;
      try {
        const result = await chrome.runtime.sendMessage({ action: "saveCardNote", videoId: state.currentVideoId, timestampSeconds, videoTitle: state.currentVideoTitle, channelName: state.currentChannelName, text });
        return result?.success && result.note ? result.note : null;
      } catch (error) {
        console.error("[小宇宙 Digest Panel] 保存卡片笔记失败:", error);
        return null;
      }
    }

    async function deleteNoteFromStorage(noteId) {
      try {
        return Boolean((await chrome.runtime.sendMessage({ action: "deleteNote", noteId }))?.success);
      } catch (error) {
        console.error("[小宇宙 Digest Panel] Delete note error:", error);
        return false;
      }
    }

    function setCardNoteSaved(button, noteId) {
      button.dataset.saved = "true";
      if (noteId) button.dataset.noteId = String(noteId);
      const image = button.querySelector("img");
      if (image) image.src = "assets/note-after.png";
      button.setAttribute("aria-label", "取消收藏");
      button.setAttribute("title", "取消收藏");
    }

    function setCardNoteUnsaved(button) {
      button.dataset.saved = "false";
      delete button.dataset.noteId;
      const image = button.querySelector("img");
      if (image) image.src = "assets/note-before.png";
      button.setAttribute("aria-label", "保存为笔记");
      button.setAttribute("title", "保存为笔记");
    }

    function resetCardNoteButtonByKey(key) {
      document.querySelectorAll(".card-note-btn").forEach((button) => {
        if (button.dataset.cardKey === key) setCardNoteUnsaved(button);
      });
    }

    function syncCardNoteButtons() {
      document.querySelectorAll(".card-note-btn").forEach((button) => {
        const key = button.dataset.cardKey;
        if (key && cardNoteMap.has(key)) setCardNoteSaved(button, cardNoteMap.get(key));
        else setCardNoteUnsaved(button);
      });
    }

    function hasNonCollapsedTextSelection() {
      const selection = window.getSelection();
      return Boolean(selection && selection.rangeCount > 0 && !selection.isCollapsed);
    }

    function renderSubtitleInlineMarkup(text) {
      return escapeHtml(text).replace(/&lt;(\/?)(i|em|b|strong|u)&gt;|&lt;br(?:\s*\/)?&gt;/gi, (_match, closing, tagName) => tagName ? `<${closing}${tagName.toLowerCase()}>` : "<br>");
    }

    function renderTranscript() {
      const state = getState();
      if (!state.currentTranscript && !state.currentTurns) return;
      const transcriptList = document.getElementById("transcriptList");
      if (!transcriptList) return;
      transcriptList.innerHTML = "";
      document.getElementById("transcriptSourceBadge")?.remove();
      document.querySelector(".transcript-diarization-hint")?.remove();
      const badge = document.createElement("div");
      badge.id = "transcriptSourceBadge";
      badge.className = "transcript-source-badge";
      const parts = [`${state.currentAsrModel || "语音识别"} 语音转写`, state.currentDiarization?.enabled ? "已分离说话人" : "未做说话人分离"];
      if (state.transcriptLoadedFromCache) parts.push("已缓存");
      badge.innerHTML = `<span class="source-dot source-dot--subs"></span> ${parts.join(" · ")}`;
      const headerMain = document.getElementById("transcriptHeaderMain");
      if (headerMain) headerMain.appendChild(badge);
      else transcriptList.parentElement?.insertBefore(badge, transcriptList);
      if (state.transcriptLoadedFromCache && !state.currentDiarization?.enabled) {
        const hint = document.createElement("div");
        hint.className = "transcript-diarization-hint";
        hint.textContent = "此稿为旧缓存，未做说话人分离。若本集实际为主持人+嘉宾对谈，可点击右上角「重新识别」按当前设置重新转写。";
        transcriptList.parentElement?.insertBefore(hint, transcriptList);
      }
      const rows = state.currentTurns?.length ? XYZ_TRANSCRIPT_PRESENTER.toDisplayRows(state.currentTurns) : state.groupTranscriptEntries(state.currentTranscript).map((group) => ({ start: group.start, hasTimestamp: true, text: group.text, speaker: null, speakerName: "" }));
      rows.forEach((row) => {
        const div = document.createElement("div");
        div.className = "transcript-entry";
        if (row.hasTimestamp !== false) div.dataset.seconds = row.start;
        else div.classList.add("transcript-entry--untimed");
        const timestamp = row.hasTimestamp === false
          ? "历史文本"
          : `${Math.floor(row.start / 60)}:${String(Math.floor(row.start % 60)).padStart(2, "0")}`;
        const color = XYZ_TRANSCRIPT_PRESENTER.speakerColor(row.speaker);
        const speakerHtml = row.speakerName ? `<span class="transcript-speaker" style="color:${color};border-color:${color};background:${color}16;">${escapeHtml(row.speakerName)}</span>` : "";
        div.innerHTML = `<span class="transcript-time">${timestamp}</span>${speakerHtml}<span class="transcript-text">${renderSubtitleInlineMarkup(row.text)}</span>`;
        div.addEventListener("click", (event) => {
          if (hasNonCollapsedTextSelection()) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          if (row.hasTimestamp !== false) seekTo(row.start);
        });
        transcriptList.appendChild(div);
      });
      startPlaybackTracking();
    }

    async function copyTranscript() {
      const state = getState();
      const button = document.getElementById("copyTranscriptBtn");
      if (!button) return;
      const original = button.textContent;
      try {
        await navigator.clipboard.writeText(state.currentTranscriptText || "");
        button.textContent = "✓ 已复制";
        setTimeout(() => { button.textContent = original; }, 2000);
      } catch (error) {
        console.error("Copy failed:", error);
      }
    }

    function exportTranscript() {
      const state = getState();
      const url = `https://www.xiaoyuzhoufm.com/episode/${state.currentVideoId}`;
      let text = `文字稿\n${"=".repeat(60)}\n\n标题: ${state.currentVideoTitle || "未知"}\n播客: ${state.currentChannelName || "未知"}\n链接: ${url}\n\n${"—".repeat(60)}\n\n`;
      if (state.currentVideoDescription) text += `简介:\n${state.currentVideoDescription}\n\n${"—".repeat(60)}\n\n`;
      text += `文字稿:\n\n${state.currentTranscriptText || ""}\n\n${"—".repeat(60)}\n由 小宇宙 Digest 导出\n`;
      downloadTextFile(text, `${sanitizeFilename(state.currentVideoTitle)}-transcript.txt`);
    }

    return { escapeHtml, renderFailureState, renderChapters, renderCounter, renderChallenges, buildCardKey, rebuildCardNoteMap, resetCardNoteButtonByKey, syncCardNoteButtons, renderTranscript, copyTranscript, exportTranscript };
  }

  return { create };
})();
