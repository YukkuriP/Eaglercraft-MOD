const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync(require("node:path").join(__dirname, "..", "converter.js"), "utf8");
const sandbox = {};
vm.runInNewContext(source, sandbox);
const C = sandbox.Jar2ZeusConverter;

function recipe(path, value) {
  return C.convertRecipe(path, JSON.stringify(value));
}

test("converts shaped recipes", () => {
  const r = recipe("data/demo/recipes/shape.json", {
    type: "minecraft:crafting_shaped", pattern: ["AA"],
    key: { A: { item: "minecraft:stone" } },
    result: { item: "demo:tile", count: 4 }
  });
  assert.equal(r.status, "converted");
  assert.match(r.lua, /recipes\.shaped/);
  assert.match(r.lua, /demo:tile/);
});

test("converts shapeless recipes and tags", () => {
  const r = recipe("data/demo/recipes/mix.json", {
    type: "minecraft:crafting_shapeless",
    ingredients: [{ tag: "c:planks" }, { item: "minecraft:stick" }],
    result: "demo:mix"
  });
  assert.equal(r.status, "converted");
  assert.match(r.lua, /#c:planks/);
});

test("converts smelting time from ticks to seconds", () => {
  const r = recipe("data/demo/recipes/smelt.json", {
    type: "minecraft:smelting", ingredient: { item: "minecraft:iron_ore" },
    result: "demo:iron", cookingtime: 400, experience: 0.5
  });
  assert.equal(r.status, "converted");
  assert.match(r.lua, /\["seconds"\] = 20/);
});

test("rejects traversal paths and invalid output ids", () => {
  const badPath = recipe("data/demo/recipes/../escape.json", {
    type: "minecraft:crafting_shaped", pattern: ["A"],
    key: { A: { item: "minecraft:stone" } }, result: "demo:x"
  });
  const badId = recipe("data/demo/recipes/bad.json", {
    type: "minecraft:crafting_shaped", pattern: ["A"],
    key: { A: { item: "minecraft:stone" } }, result: "demo:../escape"
  });
  assert.equal(badPath.status, "ignored");
  assert.equal(badId.status, "skipped");
});

test("excludes weapon-related recipe content", () => {
  const r = recipe("data/demo/recipes/restricted.json", {
    type: "minecraft:crafting_shaped", pattern: ["A"],
    key: { A: { item: "minecraft:iron_ingot" } }, result: "demo:cannon_part"
  });
  assert.equal(r.status, "excluded");
});

test("reports malformed and unsupported recipes", () => {
  assert.equal(C.convertRecipe("data/demo/recipes/bad.json", "{").reason, "invalid JSON");
  const unknown = recipe("data/demo/recipes/unknown.json", {
    type: "demo:machine", result: "demo:thing"
  });
  assert.match(unknown.reason, /unsupported recipe type/);
});

test("Lua string output escapes line breaks and quotes", () => {
  const output = C.lua('hello "world"\nnext');
  assert.equal(output, '"hello \\"world\\"\\nnext"');
});
