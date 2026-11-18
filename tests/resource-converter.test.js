const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const box={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,"..","resource-converter.js"),"utf8"),box);
const R=box.Jar2ZeusResources;
test("indexes item/block tags with normalized ids and nested tags",()=>{
 const x=R.parseTag("data/demo/tags/items/tools.json",JSON.stringify({replace:true,values:["demo:hammer","stick","#c:ingots"]}));
 assert.equal(x.status,"indexed");assert.equal(x.id,"demo:tools");assert.deepEqual(Array.from(x.values),["demo:hammer","minecraft:stick","#c:ingots"]);
});
test("rejects invalid tag paths and malformed JSON",()=>{
 assert.equal(R.parseTag("data/demo/tags/items/../escape.json","{}").status,"ignored");
 assert.equal(R.parseTag("data/demo/tags/items/tools.json","{").status,"skipped");
});
test("indexes translations and model references",()=>{
 const x=R.index([{path:"assets/demo/lang/ja_jp.json",content:'{"item.demo.hammer":"ハンマー"}'},{path:"assets/demo/models/item/hammer.json",content:"{}"},{path:"assets/demo/blockstates/machine.json",content:"{}"}]);
 assert.equal(x.counts.translations,1);assert.equal(x.counts.models,1);assert.equal(x.counts.blockstates,1);
});
test("filters weapon-related tag values",()=>{
 const x=R.parseTag("data/demo/tags/items/tools.json",'{"values":["demo:hammer","demo:rifle"]}');
 assert.deepEqual(Array.from(x.values),["demo:hammer"]);
});
