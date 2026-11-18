const test = require("node:test");
const assert = require("node:assert/strict");
require("../target-client-inspector.js");
require("../resource-compatibility.js");

const api = globalThis.Jar2ZeusResourceCompatibility;
const crc32 = globalThis.Jar2ZeusTargetInspector.crc32;

function sourceEntry(bytes) {
  return {
    dir: false,
    _data: { uncompressedSize: bytes.length },
    async: async () => new Uint8Array(bytes)
  };
}

test("JAR resource comparison separates exact matches, conflicts and new paths", async () => {
  const exactBytes = new Uint8Array([1, 2, 3]);
  const conflictBytes = new Uint8Array([9, 9]);
  const jarZip = { files: {
    "assets/demo/textures/exact.png": sourceEntry(exactBytes),
    "assets/demo/models/block/changed.json": sourceEntry(conflictBytes),
    "data/demo/recipes/new.json": sourceEntry(new Uint8Array([7])),
    "assets/demo/../unsafe.png": sourceEntry(new Uint8Array([8]))
  }};
  const targetAnalysis = {
    deepAnalysis: { status: "complete" },
    epk: [{ valid: true, files: [
      { path: "assets/demo/textures/exact.png", safe: true, size: 3, crc32: crc32(exactBytes), crcValid: true },
      { path: "assets/demo/models/block/changed.json", safe: true, size: 2, crc32: crc32(new Uint8Array([4, 4])), crcValid: true }
    ]}]
  };
  const report = await api.compareJarZip(jarZip, targetAnalysis);
  assert.equal(report.status, "complete");
  assert.equal(report.counts.sourceResources, 3);
  assert.equal(report.counts.exactMatches, 1);
  assert.equal(report.counts.conflicts, 1);
  assert.equal(report.counts.newPaths, 1);
  assert.equal(report.counts.unsafeSourcePaths, 1);
  assert.deepEqual(report.namespaces.shared, ["demo"]);
  assert.equal(report.exactMatches[0].path, "assets/demo/textures/exact.png");
  assert.equal(report.conflicts[0].path, "assets/demo/models/block/changed.json");
  assert.equal(report.newPaths[0].path, "data/demo/recipes/new.json");
});

test("JAR resource comparison refuses to guess from incomplete target inventory", async () => {
  const report = await api.compareJarZip({ files: {} }, {
    deepAnalysis: { status: "partial" },
    epk: []
  });
  assert.equal(report.status, "unavailable");
  assert.match(report.warnings.join(" "), /incomplete/);
});
