const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const box={};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,"..","zeus-api-contract.js"),"utf8"),box);
const api=box.Jar2ZeusApiValidator;

test("accepts documented APIs used by generated mods, including mod.warn and mod.log",()=>{
 const result=api.scan([
  'blocks.register("belt", {})',
  'items.register("wrench", {})',
  'recipes.shaped({})',
  'timer.every(0.25, function() end)',
  'hud.add(function(ctx) ctx:text("ok", 0, 0) end)',
  'world.exists()',
  'commands.run("say test")',
  'mod.warn("warning")',
  'mod.log("loaded")'
 ].join("\\n"));
 assert.equal(result.valid,true);
 assert.deepEqual(Array.from(result.unsupportedApis),[]);
 assert.ok(result.requiredApis.includes("blocks.register"));
 assert.ok(result.requiredApis.includes("commands.run"));
 assert.ok(result.requiredApis.includes("mod.warn"));
});

test("rejects misspelled or undocumented calls in known Zeus namespaces",()=>{
 const result=api.scan('blocks.regster("x", {})\\nworld.teleport(1, 2, 3)\\nmod.unknown()');
 assert.equal(result.valid,false);
 assert.deepEqual(Array.from(result.unsupportedApis).sort(),["blocks.regster","mod.unknown","world.teleport"]);
});

test("does not mistake normal strings, long strings or comments for API calls",()=>{
 const result=api.scan([
  '-- blocks.fake()',
  'local text = "items.notARealMethod()"',
  'local long = [[recipes.unknown()]]',
  'local equals = [=[world.notReal()]=]',
  'items.register("sample", {})'
 ].join("\\n"));
 assert.equal(result.valid,true);
 assert.deepEqual(Array.from(result.requiredApis),["items.register"]);
});

test("guards global APIs but never treats callback-local ctx as a global",()=>{
 const source='hud.add(function(ctx) ctx:text("ok", 0, 0) end)\\nblocks.register("x", {})';
 const validation=api.scan(source);
 const guarded=api.guardLua(source,validation);
 assert.match(guarded,/type\\(blocks\\) ~= "table"/);
 assert.match(guarded,/missing blocks\\.register/);
 assert.doesNotMatch(guarded,/type\\(ctx\\)/);
});

test("runtime probe is read-only and checks the key documented API tables",()=>{
 const probe=api.runtimeProbeLua();
 assert.match(probe,/blocks\\.register/);
 assert.match(probe,/items\\.register/);
 assert.match(probe,/recipes\\.shaped/);
 assert.match(probe,/world\\.entities/);
 assert.match(probe,/mod\\.warn/);
 assert.match(probe,/MISSING/);
 assert.doesNotMatch(probe,/commands\\.run\\(["']/);
});
