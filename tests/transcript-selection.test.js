const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.resolve(__dirname, "..", "panel", "rendering-controller.js"),
  "utf8",
);
const explainSource = fs.readFileSync(
  path.resolve(__dirname, "..", "panel", "explain-controller.js"),
  "utf8",
);

test("all timestamped transcript row clicks use the selection-aware seek helper", () => {
  assert.match(
    source,
    /function hasNonCollapsedTextSelection\(\)[\s\S]*?selection\.rangeCount > 0 && !selection\.isCollapsed/,
  );

  assert.match(
    source,
    /div\.addEventListener\("click", \(event\) => \{[\s\S]*?if \(hasNonCollapsedTextSelection\(\)\) \{[\s\S]*?return;[\s\S]*?\}[\s\S]*?seekTo\(row\.start\);[\s\S]*?\}\);/,
    "raw transcript rows must use the guard",
  );
});

test("the Explain tooltip preserves selection and contains pointer events", () => {
  assert.match(
    explainSource,
    /tooltip\.addEventListener\("mousedown", \(event\) => \{\s+event\.preventDefault\(\);\s+event\.stopPropagation\(\);/,
  );
  assert.match(
    explainSource,
    /tooltip\.addEventListener\("mouseup", \(event\) => \{\s+event\.stopPropagation\(\);/,
  );
  assert.match(
    explainSource,
    /\.addEventListener\("click", async \(event\) => \{\s+event\.preventDefault\(\);\s+event\.stopPropagation\(\);/,
  );
});
