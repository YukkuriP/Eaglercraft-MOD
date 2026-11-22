const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const box = { Uint8Array };
vm.runInNewContext(
  fs.readFileSync(path.join(__dirname, "..", "entity-model-converter.js"), "utf8"),
  box
);

test("converts a supported non-weapon Blockbench-style entity model", () => {
  const geometry = {
    "minecraft:geometry": [{
      description: {
        identifier: "demo:worker",
        texture_width: 16,
        texture_height: 16
      },
      bones: [{
        name: "root",
        pivot: [0, 0, 0],
        cubes: [{
          origin: [0, 0, 0],
          size: [4, 4, 4],
          uv: [0, 0]
        }]
      }]
    }]
  };

  const result = box.Jar2ZeusEntityModels.convert([
    {
      path: "assets/demo/entity/worker.geo.json",
      content: JSON.stringify(geometry)
    },
    {
      path: "assets/demo/textures/entity/worker.png",
      bytes: new Uint8Array([1, 2, 3])
    }
  ], "demo");

  assert.equal(result.report.counts.converted, 1);
  assert.match(result.lua, /entities\\.register\\("worker"/);
  assert.ok(result.files["textures/demo_worker_entity.png"]);
});

test("rejects unsafe model paths without crashing the analyzer", () => {
  const result = box.Jar2ZeusEntityModels.convert([
    {
      path: "assets/demo/../escape/worker.geo.json",
      content: JSON.stringify({
        bones: [{ name: "root", cubes: [] }]
      })
    }
  ], "demo");

  assert.equal(result.report.counts.converted, 0);
});
