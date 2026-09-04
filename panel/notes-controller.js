var XYZ_NOTES_CONTROLLER = (() => {
  function create({
    rebuildCardNoteMap,
    syncCardNoteButtons,
    buildCardKey,
    resetCardNoteButtonByKey,
    removeCardNoteMapping,
    playNote,
    getCurrentEpisodeId,
  }) {
    async function load(episodeId) {
      try {
        const result = await chrome.runtime.sendMessage({
          action: XYZ_DOMAIN.ACTIONS.GET_NOTES,
          videoId: episodeId,
        });
        if (!result?.success) return;
        const notes = Array.isArray(result.notes) ? result.notes : [];
        rebuildCardNoteMap(notes);
        render(notes, episodeId);
        syncCardNoteButtons();
      } catch (error) {
        console.error("[小宇宙 Digest Panel] Load notes error:", error);
      }
    }

    function render(notes, filteredEpisodeId) {
      const notesList = document.getElementById("notesList");
      const notesIntro = document.getElementById("notesIntro");
      if (!notesList || !notesIntro) return;
      notesList.innerHTML = "";
      if (!notes?.length) {
        notesIntro.hidden = false;
        notesIntro.textContent = filteredEpisodeId
          ? "这个单集还没有笔记。点击页面右下角的「记笔记」即可保存。"
          : "还没有保存任何笔记。点击页面右下角的「记笔记」即可保存。";
        return;
      }
      notesIntro.hidden = true;
      notes.forEach((note) => notesList.appendChild(createItem(note, filteredEpisodeId)));
    }

    function createItem(note, filteredEpisodeId) {
      const element = document.createElement("div");
      element.className = "note-item";
      element.innerHTML = `
        <div class="note-header">
          <span class="note-timestamp">${escapeHtml(note.timestamp)}</span>
          ${!filteredEpisodeId ? `<span class="note-video-title">${escapeHtml(note.videoTitle)}</span>` : ""}
          <button class="note-delete" title="删除笔记">✕</button>
        </div>
        <div class="note-text">"${escapeHtml(note.text)}"</div>
        <div class="note-actions">
          <button class="note-action-btn note-copy-text">⧉ 复制文本</button>
          <button class="note-action-btn note-copy-link">🔗 复制时间戳</button>
          <button class="note-action-btn note-play">▶ 播放</button>
        </div>`;
      element.querySelector(".note-timestamp").addEventListener("click", () => playNote(note));
      element.querySelector(".note-delete").addEventListener("click", async (event) => {
        event.stopPropagation();
        await remove(note);
        void load(filteredEpisodeId);
      });
      bindCopy(element.querySelector(".note-copy-text"), note.text, "⧉ 复制文本");
      bindCopy(element.querySelector(".note-copy-link"), note.timestampedUrl, "🔗 复制时间戳");
      element.querySelector(".note-play").addEventListener("click", () => playNote(note));
      return element;
    }

    function bindCopy(button, text, originalLabel) {
      button.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(text);
          button.textContent = "✓ 已复制!";
          setTimeout(() => { button.textContent = originalLabel; }, 2000);
        } catch (error) {
          console.error("Copy failed:", error);
        }
      });
    }

    async function remove(note) {
      try {
        const result = await chrome.runtime.sendMessage({
          action: XYZ_DOMAIN.ACTIONS.DELETE_NOTE,
          noteId: note.id,
        });
        if (result?.success) {
          const key = buildCardKey(note.videoId, note.timestampSeconds, note.text);
          removeCardNoteMapping(key);
          resetCardNoteButtonByKey(key);
        }
        return Boolean(result?.success);
      } catch (error) {
        console.error("[小宇宙 Digest Panel] Delete note error:", error);
        return false;
      }
    }

    function reloadCurrent() {
      const showAll = document.getElementById("notesFilterAll")?.classList.contains("active");
      void load(showAll ? null : getCurrentEpisodeId());
    }

    return { load, remove, reloadCurrent };
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text || "";
    return div.innerHTML;
  }

  return { create };
})();
