var XYZ_NOTES_VIEW = (() => {
  function create() {
    function setFilter(showAll) {
      const current = document.getElementById("notesFilterThis");
      const all = document.getElementById("notesFilterAll");
      current?.classList.toggle("active", !showAll);
      current?.setAttribute("aria-pressed", String(!showAll));
      all?.classList.toggle("active", showAll);
      all?.setAttribute("aria-pressed", String(showAll));
    }

    function isShowingAll() {
      return document.getElementById("notesFilterAll")?.classList.contains("active") || false;
    }

    function bind({ onFilterChange }) {
      document.getElementById("notesFilterThis")?.addEventListener("click", () => onFilterChange?.(false));
      document.getElementById("notesFilterAll")?.addEventListener("click", () => onFilterChange?.(true));
    }

    return { setFilter, isShowingAll, bind };
  }

  return { create };
})();
