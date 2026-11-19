const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const box={};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,"..","zeus-api-contract.js"),"utf8"),box);
const api=box.Jar2ZeusApiValidator;

test("accepts only documented Zeus API calls used by generated mods",()=>{
 const result=api.scan([
  'blocks.register("belt", {})',
  'items.register("wrench", {})',
  'recipes.shaped({})',
  'timer.every(0.25, function() end)',
  'hud.add(function(ctx) ctx:text("ok", 0, 0) end)',
  'world.exists()',
  'commands.run("say test")'
 ].join("\n"));
 assert.equal(result.valid,true);
 assert.deepEqual(Array.from(result.unsupportedApis),[]);
 assert.ok(result.requiredApis.includes("blocks.register"));
 assert.ok(result.requiredApis.includes("commands.run"));
});

test("rejects undocumented guessed APIs such as mod.warn and mod.log",()=>{
 const result=api.scan('mod.warn("warning")\nmod.log("loaded")');
 assert.equal(result.valid,false);
 assert.deepEqual(Array.from(result.unsupportedApis),["mod.log","mod.warn"]);
});

test("does not mistake strings or comments for API calls",()=>{
 const result=api.scan([
  '-- blocks.fake()',
  'local text = "items.notARealMethod()"',
  'local long = [[recipes.unknown()]]',
  'items.register("sample", {})'
 ].join("\n"));
 assert.equal(result.valid,true);
 assert.deepEqual(Array.from(result.requiredApis),["items.register"]);
});

test("runtime guards are generated for every required API",()=>{
 const validation=api.scan('blocks.register("x", {})\nrecipes.shaped({})');
 const guarded=api.guardLua('blocks.register("x", {})\nrecipes.shaped({})',validation);
 assert.match(guarded,/type\(blocks\) ~= "table"/);
 assert.match(guarded,/missing blocks\.register/);
 assert.match(guarded,/missing recipes\.shaped/);
});

test("runtime probe does not mutate the world and checks the key namespaces",()=>{
 const probe=api.runtimeProbeLua();
 assert.match(probe,/blocks\.register/);
 assert.match(probe,/items\.register/);
 assert.match(probe,/recipes\.shaped/);
 assert.match(probe,/world\.entities/);
 assert.match(probe,/MISSING/);
 assert.doesNotMatch(probe,/commands\.run\(["']/);
});
