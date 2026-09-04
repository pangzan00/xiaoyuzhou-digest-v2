const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.resolve(__dirname, "..", "content.js"),
  "utf8",
);

test("content script targets Xiaoyuzhou episode pages and injects a Digest button", () => {
  assert.match(source, /function isEpisodePage\(\)/);
  assert.match(source, /\[0-9a-fA-F\]\+/);
  assert.match(source, /xyz-digest-button/);
  assert.match(source, /function createFloatingButton\(/);
  assert.match(source, /chrome\.runtime\.sendMessage\(\{ action: "openSidePanel" \}\)/);
  assert.match(source, /#25B4E1/);
});

test("note button saves a timestamped note and seeks the native audio element", () => {
  assert.match(source, /xyz-note-button/);
  assert.match(source, /function getAudioElement\(\)/);
  assert.match(source, /audio\.currentTime = seconds/);
  assert.match(source, /action: "saveNote"/);
  assert.match(source, /function saveCurrentNote\(\)/);
});

test("content script delegates episode id parsing to the shared domain utility", () => {
  const domain = fs.readFileSync(path.resolve(__dirname, "..", "shared/domain.js"), "utf8");
  assert.match(source, /function extractEpisodeId\(url\)/);
  assert.match(source, /XYZ_DOMAIN\.extractEpisodeId\(url\)/);
  assert.match(domain, /pathname\.match/);
  assert.match(domain, /\[0-9a-fA-F\]\{24\}/);
});

test("episode info comes from __NEXT_DATA__ with og:title fallback", () => {
  assert.match(source, /getElementById\("__NEXT_DATA__"\)/);
  assert.match(source, /meta\[property="og:title"\]/);
});
