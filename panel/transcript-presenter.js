var XYZ_TRANSCRIPT_PRESENTER = (() => {
  const SPEAKER_COLORS = ["#d9701f", "#2f6fed", "#1f9d55", "#8b5cf6", "#db2777", "#0d9488"];

  function speakerColor(speakerId) {
    if (speakerId === null || speakerId === undefined) return "#6b7280";
    return SPEAKER_COLORS[Math.abs(Number(speakerId) || 0) % SPEAKER_COLORS.length];
  }

  function speakerNameFromEntry(entry) {
    const raw = String(entry?.rawText || "").trim();
    const text = String(entry?.text || "");
    if (!raw || !text.endsWith(raw)) return "";
    return text.slice(0, text.length - raw.length).replace(/[:：]\s*$/, "").trim();
  }

    function toDisplayRows(turns) {
      return (Array.isArray(turns) ? turns : []).map((turn) => {
        const numericStart = Number(turn?.start);
        const hasTimestamp = turn?.start !== null
          && turn?.start !== undefined
          && Number.isFinite(numericStart)
          && numericStart >= 0;
        return {
          start: hasTimestamp ? numericStart : null,
          hasTimestamp,
          text: String(turn.rawText || turn.text || ""),
          speaker: turn.speaker ?? null,
          speakerName: speakerNameFromEntry(turn),
        };
      });
    }

  return { speakerColor, toDisplayRows };
})();
