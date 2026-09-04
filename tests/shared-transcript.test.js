const test = require("node:test");
const assert = require("node:assert/strict");

global.XYZ_DOMAIN = require("../shared/domain.js");
const transcript = require("../shared/transcript.js");

test("shared episode utilities validate the canonical episode path", () => {
  assert.equal(
    XYZ_DOMAIN.extractEpisodeId("https://www.xiaoyuzhoufm.com/episode/66e9a7a25ca6d0ace389af8c"),
    "66e9a7a25ca6d0ace389af8c",
  );
  assert.equal(XYZ_DOMAIN.extractEpisodeId("https://www.xiaoyuzhoufm.com/podcast/foo"), null);
  assert.equal(XYZ_DOMAIN.formatTimestamp(65.9), "1:05");
});

test("shared transcript builder keeps all same-speaker text and applies one merge limit", () => {
  const result = transcript.buildTranscript([
    { rawText: "第一句。", speaker: 0, start: 0, duration: 2 },
    { rawText: "第二句。", speaker: 0, start: 3, duration: 2 },
    { rawText: "第三句。", speaker: 1, start: 6, duration: 2 },
  ]);
  assert.equal(result.transcript.length, 3);
  assert.equal(result.turns.length, 2);
  assert.equal(result.turns[0].rawText, "第一句。第二句。");
  assert.match(result.transcriptTextTimestamped, /^\[0:00\] 说话人0：第一句。第二句。/);
});
