const assert = require("assert");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(
  path.join(__dirname, "..", "src", "utils", "formatPercent.js"),
  "utf8",
);

const runnableSource = source
  .replace("export const formatPercent", "const formatPercent")
  .replace("export const sanitizePercentText", "const sanitizePercentText");

const { formatPercent, sanitizePercentText } = new Function(
  `${runnableSource}\nreturn { formatPercent, sanitizePercentText };`,
)();

assert.strictEqual(formatPercent(12.345678), "12.4%");
assert.strictEqual(formatPercent(99.01), "99.1%");
assert.strictEqual(formatPercent(99.99), "100%");
assert.strictEqual(formatPercent(100), "100%");
assert.strictEqual(formatPercent(100.0), "100%");
assert.strictEqual(formatPercent(0.01), "0.1%");
assert.strictEqual(formatPercent(0), "0%");
assert.strictEqual(formatPercent(Number.NaN), "0%");
assert.strictEqual(formatPercent(Number.POSITIVE_INFINITY), "0%");

assert.strictEqual(sanitizePercentText("Downloading 12.345678%"), "Downloading 12.4%");
assert.strictEqual(sanitizePercentText("Downloading NaN%"), "Downloading 0%");
assert.strictEqual(sanitizePercentText("Downloading Infinity%"), "Downloading 0%");

console.log("percentage formatting checks passed");
