const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

test("browser entry point has syntactically valid inline scripts and loads the inspector", () => {
  const html = fs.readFileSync(require("node:path").join(__dirname, "..", "index.html"), "utf8");
  const scripts = Array.from(html.matchAll(/<script\\b[^>]*>([\\s\\S]*?)<\\/script>/gi))
    .map(match => match[1])
    .filter(source => source.trim().length > 0);

  assert.ok(scripts.length > 0, "expected an inline application script");
  scripts.forEach((source, index) => {
    assert.doesNotThrow(() => new vm.Script(source, { filename: "index.html:inline-" + index }));
  });
  assert.match(html, /target-client-inspector\\.js/);
  assert.match(html, /id="referenceHtml"/);
  assert.match(html, /pako@2\\.1\\.0/);
  assert.match(html, /xzwasm@0\\.1\\.2/);
});
