var XYZ_TRANSCRIPT_GROUPING = (() => {
  const DEFAULT_LIMITS = Object.freeze({
    minChars: 60,
    idealChars: 180,
    maxChars: 320,
    maxSeconds: 60,
    minSeconds: 20,
  });

  function normalizeCaptionText(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .replace(/([\u3400-\u9fff])\s+([\u3400-\u9fff])/g, "$1$2")
      .replace(/([，。；：！？])\s+(?=[\u3400-\u9fff])/g, "$1")
      .replace(/\s+([,.;:!?，。；：！？])/g, "$1")
      .trim();
  }

  function splitOversizedThought(text, maxChars) {
    const parts = [];
    let rest = normalizeCaptionText(text);
    while (rest.length > maxChars) {
      const windowText = rest.slice(0, maxChars + 1);
      const lowerBound = Math.floor(maxChars * 0.55);
      let cut = -1;
      for (const pattern of [/[;:；：]\s*/g, /[,，]\s*/g, /\s/g]) {
        let match;
        while ((match = pattern.exec(windowText))) {
          if (match.index >= lowerBound) cut = match.index + match[0].length;
        }
        if (cut > 0) break;
      }
      if (cut <= 0) cut = maxChars;
      parts.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) parts.push(rest);
    return parts;
  }

  function group(entries, limits = DEFAULT_LIMITS) {
    if (!Array.isArray(entries) || entries.length === 0) return [];
    const pieces = [];
    entries.forEach((entry, entryIndex) => {
      const text = normalizeCaptionText(entry?.text);
      if (!text) return;
      const start = Number.isFinite(Number(entry.start)) ? Number(entry.start) : 0;
      const duration = Math.max(0, Number(entry.duration) || 0);
      const sentences = text.match(/[^.!?;:,。！？；：，]+(?:[.!?;:,。！？；：，]+["')\]”’）】」』]*|$)/g) || [text];
      let consumedChars = 0;
      sentences.forEach((sentence) => {
        splitOversizedThought(sentence, limits.maxChars).forEach((part, partIndex, parts) => {
          const ratio = text.length ? Math.min(1, consumedChars / text.length) : 0;
          pieces.push({
            text: part,
            start: start + duration * ratio,
            semanticEnd: /[.!?。！？]["')\]”’）】」』]*$/.test(part) || parts.length > 1,
            clauseEnd: /[;:,；：，]["')\]”’）】」』]*$/.test(part),
            sourceOrder: `${entryIndex}:${partIndex}`,
          });
          consumedChars += part.length + 1;
        });
      });
    });
    const grouped = [];
    let current = null;
    const flush = () => {
      if (!current?.text.trim()) return;
      const text = normalizeCaptionText(current.text);
      grouped.push({ id: `segment-${grouped.length}-${Math.round(current.start * 1000)}`, start: current.start, text, texts: [text] });
      current = null;
    };
    pieces.forEach((piece) => {
      if (!current) current = { start: piece.start, text: "" };
      current.text = normalizeCaptionText(`${current.text} ${piece.text}`);
      const elapsed = Math.max(0, piece.start - current.start);
      const comfortablySized = current.text.length >= limits.minChars;
      const reachedIdeal = current.text.length >= limits.idealChars;
      const atNaturalBoundary = piece.semanticEnd || (piece.clauseEnd && (reachedIdeal || current.text.length >= limits.maxChars || elapsed >= limits.maxSeconds));
      const reachedGuardrail = atNaturalBoundary && (current.text.length >= limits.maxChars || elapsed >= limits.maxSeconds);
      const reachedHardGuardrail = current.text.length >= Math.round(limits.maxChars * 1.2) || elapsed >= limits.maxSeconds + 5;
      if ((atNaturalBoundary && (comfortablySized || elapsed >= (limits.minSeconds ?? 8))) || (atNaturalBoundary && reachedIdeal) || reachedGuardrail || reachedHardGuardrail) flush();
    });
    flush();
    return grouped;
  }

  return { DEFAULT_LIMITS, normalizeCaptionText, splitOversizedThought, group };
})();

if (typeof module !== "undefined" && module.exports) module.exports = XYZ_TRANSCRIPT_GROUPING;
