const test = require("node:test");
const assert = require("node:assert/strict");
require("../converter.js");
require("../definition-converter.js");
require("../resource-converter.js");
require("../generic-mod-analyzer.js");
require("../migration-pipeline.js");
require("../package-validator.js");

test("sample safe Fabric-style JAR: amber brick block and crafting recipe", async () => {
  // A small, synthetic JAR entry set representing a harmless decorative-block MOD.
  const entries = [
    { path: "fabric.mod.json", content: JSON.stringify({
      schemaVersion: 1, id: "garden", version: "1.0.0",
      name: "Garden Blocks", depends: { minecraft: "1.20.1" }
    }) },
    { path: "assets/garden/blockstates/amber_bricks.json", content: JSON.stringify({
      variants: { "": { model: "garden:block/amber_bricks" } }
    }) },
    { path: "assets/garden/models/block/amber_bricks.json", content: JSON.stringify({
      parent: "minecraft:block/cube_all",
      textures: { all: "garden:blocks/amber_bricks" }
    }) },
    { path: "assets/garden/textures/blocks/amber_bricks.png", content: "synthetic-png-fixture" },
    { path: "assets/garden/lang/en_us.json", content: JSON.stringify({
      "block.garden.amber_bricks": "Amber Bricks"
    }) },
    { path: "data/garden/recipes/amber_bricks.json", content: JSON.stringify({
      type: "minecraft:crafting_shaped",
      pattern: ["AAA", "AAA", "AAA"],
      key: { A: "minecraft:clay_ball" },
      result: { item: "garden:amber_bricks" }
    }) }
  ];

  const analysis = globalThis.Jar2ZeusGenericAnalyzer.analyze(entries);
  assert.deepEqual(analysis.loaders, ["Fabric"]);
  assert.equal(analysis.metadata.fabric.id, "garden");
  assert.equal(analysis.resources.blockstates, 1);
  assert.equal(analysis.resources.models, 1);

  const recipeEntries = entries
    .filter(e => /^data\/[^/]+\/recipes?\/.+\.json$/.test(e.path))
    .map(e => ({ path: e.path, content: e.content }));
  const resourceEntries = entries
    .filter(e => e.path.startsWith("assets/") || e.path.startsWith("data/"))
    .filter(e => e.path.endsWith(".json"))
    .map(e => ({ path: e.path, content: e.content }));

  const pipeline = globalThis.Jar2ZeusPipeline.create();
  pipeline.register({ id: "recipes", run: ctx => {
    const result = globalThis.Jar2ZeusConverter.convert(ctx.recipeEntries);
    return { lua: result.mainLua, report: result.report };
  }});
  pipeline.register({ id: "definitions", run: ctx => {
    const result = globalThis.Jar2ZeusDefinitions.convert(ctx.resourceEntries, "garden");
    return { lua: result.lua, report: result.report, copied: result.copied };
  }});

  const result = await pipeline.run({ recipeEntries, resourceEntries });
  const recipeLua = result.results.recipes.lua;
  const definitionLua = result.results.definitions.lua;
  const mainLua = result.lua;

  assert.match(definitionLua, /blocks\.register\("amber_bricks"/);
  assert.match(definitionLua, /"Amber Bricks"/);
  assert.match(recipeLua, /recipes\.shaped\(/);
  assert.match(recipeLua, /"garden:amber_bricks"/);
  assert.equal(result.results.definitions.report.counts.blocks, 1);
  assert.equal(result.results.recipes.report.converted, 1);
  assert.equal(result.report.errors.length, 0);

  const texture = result.results.definitions.copied[0];
  assert.equal(texture.source, "assets/garden/textures/blocks/amber_bricks.png");
  assert.equal(texture.target, "textures/garden_blocks_amber_bricks.png");

  const metadata = {
    id: "garden", name: "Garden Blocks (partial port)", version: "0.1.0-port",
    description: "Generated test fixture", authors: ["Jar2Zeus"],
    main: "main.lua", api: 1, minecraft: ["26.2", "26.3"]
  };
  const packageFiles = [
    { path: "metadata.json" },
    { path: "main.lua" },
    { path: texture.target }
  ];
  const validation = globalThis.Jar2ZeusPackageValidator.validate({
    metadata, mainLua, analysis, adapterReport: result.report,
    textureMappings: [texture],
    availableTextures: [texture.source],
    packageFiles,
    packageLimits: { files: 3, bytes: 1024, maxFiles: 4096, maxBytes: 64 * 1024 * 1024 },
    packageSkipped: [],
    runtimeTested: false
  });
  assert.equal(validation.valid, true);
  assert.equal(validation.runtimeTested, false);
  assert.equal(validation.readyToImport, false);
});
