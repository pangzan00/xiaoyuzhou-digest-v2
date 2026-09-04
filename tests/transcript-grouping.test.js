const test = require("node:test");
const assert = require("node:assert/strict");

const grouping = require("../panel/transcript-grouping.js");

test("transcript grouping merges short adjacent Chinese caption fragments", () => {
  const rows = grouping.group([
    { text: "你好，", start: 0, duration: 2 },
    { text: "欢迎收听。", start: 2, duration: 2 },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].text, "你好，欢迎收听。");
  assert.equal(rows[0].start, 0);
});

test("transcript grouping splits oversized thoughts at natural punctuation", () => {
  const text = `${"甲".repeat(190)}，${"乙".repeat(190)}。`;
  const rows = grouping.group([{ text, start: 0, duration: 30 }], {
    ...grouping.DEFAULT_LIMITS,
    maxChars: 200,
  });
  assert.ok(rows.length >= 2);
  assert.equal(rows.map((row) => row.text).join(""), text);
});
