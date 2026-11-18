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


test("resolves inherited custom block and item models with texture variables",()=>{
 const entries=[
  {path:"assets/demo/blockstates/blue_panel.json",content:JSON.stringify({variants:{"facing=north":{model:"demo:block/base_panel"},"facing=south":{model:"demo:block/base_panel"}}})},
  {path:"assets/demo/models/block/base_panel.json",content:JSON.stringify({parent:"demo:block/panel_parent",textures:{side:"#layer",up:"demo:block/panel_top",down:"demo:block/panel_bottom"}})},
  {path:"assets/demo/models/block/panel_parent.json",content:JSON.stringify({parent:"minecraft:block/cube",textures:{layer:"demo:block/panel_side"}})},
  {path:"assets/demo/textures/block/panel_side.png",content:"png"},
  {path:"assets/demo/textures/block/panel_top.png",content:"png"},
  {path:"assets/demo/textures/block/panel_bottom.png",content:"png"},
  {path:"assets/demo/models/item/blue_gem.json",content:JSON.stringify({parent:"demo:item/generated_parent"})},
  {path:"assets/demo/models/item/generated_parent.json",content:JSON.stringify({parent:"minecraft:item/generated",textures:{layer0:"demo:item/blue_gem"}})},
  {path:"assets/demo/textures/item/blue_gem.png",content:"png"}
 ];
 const r=D.convert(entries,"demo");
 assert.equal(r.report.blocks.length,1);
 assert.equal(r.report.items.length,1);
 assert.match(r.lua,/\["top"\]/);
 assert.match(r.lua,/\["bottom"\]/);
 assert.ok(r.copied.some(x=>x.source.endsWith("blue_gem.png")));
});

test("skips blockstates with different models rather than guessing",()=>{
 const entries=[
  {path:"assets/demo/blockstates/variant_block.json",content:JSON.stringify({variants:{"axis=x":{model:"demo:block/a"},"axis=z":{model:"demo:block/b"}}})},
  {path:"assets/demo/models/block/a.json",content:JSON.stringify({textures:{all:"demo:block/a"}})},
  {path:"assets/demo/models/block/b.json",content:JSON.stringify({textures:{all:"demo:block/b"}})},
  {path:"assets/demo/textures/block/a.png",content:"png"},
  {path:"assets/demo/textures/block/b.png",content:"png"}
 ];
 const r=D.convert(entries,"demo");
 assert.equal(r.report.blocks.length,0);
 assert.match(r.report.skipped[0].reason,/different models/);
});
