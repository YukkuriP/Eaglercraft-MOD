const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const box={TextDecoder};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,"..","generic-mod-analyzer.js"),"utf8"),box);
const A=box.Jar2ZeusGenericAnalyzer;

function fakeClass(name, refs=[]) {
  const utf8=[];
  function add(s){const b=Buffer.from(s,"utf8");utf8.push(Buffer.from([1,b.length>>8,b.length&255]),b);return utf8.length;}
  const all=[name,...refs];
  const indices=all.map(add);
  const cp=[];
  for(const i of indices)cp.push(Buffer.from([7,i>>8,i&255]));
  const count=1+all.length*2;
  return Buffer.concat([
    Buffer.from([0xca,0xfe,0xba,0xbe,0,0,0,61,count>>8,count&255]),
    ...all.flatMap((s,i)=>[Buffer.from([1,s.length>>8,s.length&255]),Buffer.from(s),Buffer.from([7,(i*2+2)>>8,(i*2+2)&255])]),
    Buffer.from([0,1,0,2,0,3,0,0,0,0,0,0,0,0])
  ]);
}

test("detects loader metadata, mixins, resources and nested jars",()=>{
 const r=A.analyze([
  {path:"fabric.mod.json",content:JSON.stringify({id:"bigmod",depends:{minecraft:">=1.20"},entrypoints:{main:["demo.Main"]},jars:[{file:"META-INF/jars/lib.jar"}]})},
  {path:"demo/Main.class",bytes:new Uint8Array(fakeClass("demo/Main",["net/fabricmc/api/ModInitializer"]))},
  {path:"demo.mixins.json",content:'{"mixins":["demo.MixinA"]}'},
  {path:"META-INF/jars/lib.jar",size:100},
  {path:"assets/demo/textures/block/a.png",size:20},
  {path:"data/demo/recipes/a.json",content:"{}"}
 ]);
 assert.ok(r.loaders.includes("Fabric"));
 assert.equal(r.classes.count,1);
 assert.ok(r.mixinConfigs.length);
 assert.ok(r.nestedJars.length);
 assert.equal(r.resources.textures,1);
 assert.equal(r.resources.recipes,1);
 assert.ok(r.entrypoints.some(x=>x.value==="demo.Main"));
});

test("rejects unsafe archive paths and records restricted feature paths for review",()=>{
 const r=A.analyze([
  {path:"../escape.class",size:1},
  {path:"assets/demo/models/item/rifle.json",size:2},
  {path:"assets/demo/models/item/stone.json",size:3}
 ]);
 assert.deepEqual(Array.from(r.archive.unsafePaths),["../escape.class"]);
 assert.equal(r.featureReview.restrictedPathCount,1);
 assert.equal(r.resources.models,2);
});

test("parses class-file header and constant-pool class references",()=>{
 const b=new Uint8Array(fakeClass("demo/Example",["net/minecraftforge/common/Mod"]));
 const c=A.parseClass(b);
 assert.equal(c.valid,true);
 assert.equal(c.major,61);
 assert.ok(c.references.includes("net/minecraftforge/common/Mod"));
});
