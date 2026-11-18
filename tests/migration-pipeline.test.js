const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const box={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,"..","migration-pipeline.js"),"utf8"),box);
test("runs ordered adapters and combines Lua output",async()=>{
 const p=box.Jar2ZeusPipeline.create();
 p.register({id:"first",run:()=>({lua:"blocks.register('a', {})",files:{"a.json":"{}"}})});
 p.register({id:"second",detect:c=>c.enabled,run:()=>({lua:"items.register('b', {})"})});
 const r=await p.run({enabled:true});
 assert.equal(r.report.adapters.length,2);
 assert.equal(r.report.adapters[0].status,"completed");
 assert.equal(r.report.adapters[1].status,"completed");
 assert.match(r.lua,/blocks\.register/);assert.match(r.lua,/items\.register/);
});
test("isolates adapter failures and rejects unsafe output paths",async()=>{
 const p=box.Jar2ZeusPipeline.create();
 p.register({id:"broken",run:()=>{throw Error("adapter failed")}});
 p.register({id:"unsafe",run:()=>({files:{"../escape":"x"}})});
 p.register({id:"safe",run:()=>({lua:"-- still runs"})});
 const r=await p.run({});
 assert.equal(r.report.errors.length,2);
 assert.equal(r.report.adapters[2].status,"completed");
});
