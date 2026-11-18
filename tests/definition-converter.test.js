const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const box={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,"..","definition-converter.js"),"utf8"),box);
const D=box.Jar2ZeusDefinitions;
test("generates a real Zeus block registration for cube_all",()=>{
 const entries=[
 {path:"assets/demo/blockstates/ruby_block.json",content:'{"variants":{"":{"model":"demo:block/ruby_block"}}}'},
 {path:"assets/demo/models/block/ruby_block.json",content:'{"parent":"minecraft:block/cube_all","textures":{"all":"demo:block/ruby_block"}}'},
 {path:"assets/demo/textures/block/ruby_block.png",content:"png"}
 ];
 const r=D.convert(entries,"demo");assert.equal(r.report.blocks.length,1);assert.match(r.lua,/blocks\.register\("ruby_block"/);assert.equal(r.copied[0].target,"textures/demo_block_ruby_block.png");
});
test("generates a real Zeus item registration for item/generated",()=>{
 const entries=[
 {path:"assets/demo/models/item/ruby.json",content:'{"parent":"minecraft:item/generated","textures":{"layer0":"demo:item/ruby"}}'},
 {path:"assets/demo/textures/item/ruby.png",content:"png"}
 ];
 const r=D.convert(entries,"demo");assert.equal(r.report.items.length,1);assert.match(r.lua,/items\.register\("ruby"/);
});
test("skips complex models and weapon-like ids",()=>{
 const entries=[
 {path:"assets/demo/blockstates/machine.json",content:'{"variants":{"":{"model":"demo:block/machine"}}}'},
 {path:"assets/demo/models/block/machine.json",content:'{"parent":"minecraft:block/orientable","textures":{"front":"demo:block/machine"}}'},
 {path:"assets/demo/blockstates/rifle_rack.json",content:'{"variants":{"":{"model":"demo:block/rifle_rack"}}}'}
 ];
 const r=D.convert(entries,"demo");assert.equal(r.report.blocks.length,0);
});
