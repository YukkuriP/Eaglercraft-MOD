const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("browser entry point parses and loads the current migration modules", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const scripts = Array.from(html.matchAll(/<script\\b[^>]*>([\\s\\S]*?)<\\/script>/gi))
    .map(match => match[1])
    .filter(source => source.trim().length > 0);

  assert.ok(scripts.length > 0, "expected an inline application script");
  scripts.forEach((source, index) => {
    assert.doesNotThrow(() => new vm.Script(source, { filename: "index.html:inline-" + index }));
  });

  for (const file of [
    "archive-inspector.js",
    "converter.js",
    "resource-converter.js",
    "definition-converter.js",
    "machine-gui-converter.js",
    "machine-gui-state-bridge.js",
    "machine-gui-live-binding.js",
    "machine-state-provider-sdk.js",
    "zeus-api-contract.js",
    "package-validator.js"
  ]) {
    assert.ok(html.includes('<script src="' + file + '"></script>'), "missing " + file);
  }
});

test("browser entry point exposes the current JAR and Zeus version inputs", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(html, /id="jar" type="file" accept="\.jar,\.zip"/);
  assert.match(html, /id="targetVersion"/);
  assert.match(html, /value="26\.2"/);
  assert.match(html, /value="26\.3"/);
  assert.match(html, /id="analyze"/);
  assert.match(html, /id="build"/);
  assert.match(html, /jszip@3\.10\.1/);
});
