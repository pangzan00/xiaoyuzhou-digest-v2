var XYZ_TRANSCRIPT = (() => {
  function speakerDisplayName(speaker, speakerNames) {
    if (speaker === null || speaker === undefined) return null;
    return speakerNames?.[speaker] || `说话人${speaker}`;
  }

  function parseSentences(data, diarizationEnabled) {
    const sentences = [];
    for (const transcript of data?.transcripts || []) {
      for (const sentence of transcript?.sentences || []) {
        const rawText = String(sentence?.text || "").trim();
        if (!rawText) continue;
        const beginMs = Number(sentence?.begin_time) || 0;
        const endMs = Math.max(beginMs, Number(sentence?.end_time) || beginMs);
        const rawSpeakerId = sentence?.speaker_id;
        const speakerId = rawSpeakerId === null || rawSpeakerId === undefined ? NaN : Number(rawSpeakerId);
        sentences.push({
          rawText,
          speaker: diarizationEnabled && Number.isInteger(speakerId) ? speakerId : null,
          start: Math.max(0, beginMs / 1000),
          duration: Math.max(0, Math.floor((endMs - beginMs) / 1000)),
        });
      }
    }
    return sentences;
  }

  function buildTranscript(sentences, speakerNames, limits = XYZ_DOMAIN.TURN_MERGE_LIMITS) {
    const transcript = [];
    const turns = [];
    for (const sentence of sentences) {
      const name = speakerDisplayName(sentence.speaker, speakerNames);
      const text = name ? `${name}：${sentence.rawText}` : sentence.rawText;
      transcript.push({ ...sentence, text });
      const last = turns[turns.length - 1];
      const canMerge = sentence.speaker !== null && sentence.speaker !== undefined && last && last.speaker === sentence.speaker;
      const combinedRaw = canMerge ? last.rawText + sentence.rawText : "";
      const combinedDuration = canMerge ? sentence.start + sentence.duration - last.start : 0;
      if (canMerge && combinedRaw.length <= limits.maxChars && combinedDuration <= limits.maxSeconds) {
        last.rawText = combinedRaw;
        last.text = `${name}：${combinedRaw}`;
        last.duration = Math.max(last.duration, combinedDuration);
      } else {
        turns.push({ ...sentence, text });
      }
    }
    const transcriptText = turns.map((turn) => turn.text).join("\n");
    const transcriptTextTimestamped = turns
      .map((turn) => `[${XYZ_DOMAIN.formatTimestamp(turn.start)}] ${turn.text}`)
      .join("\n");
    return { transcript, turns, transcriptText, transcriptTextTimestamped, language: "zh" };
  }

  function buildTranscriptSample(sentences, maxChars = 4000) {
    let text = "";
    for (const sentence of sentences) {
      text += `${sentence.speaker === null || sentence.speaker === undefined ? "" : `说话人${sentence.speaker}：`}${sentence.rawText}\n`;
      if (text.length >= maxChars) break;
    }
    return text.slice(0, maxChars);
  }

  return { speakerDisplayName, parseSentences, buildTranscript, buildTranscriptSample };
})();

if (typeof module !== "undefined" && module.exports) module.exports = XYZ_TRANSCRIPT;
