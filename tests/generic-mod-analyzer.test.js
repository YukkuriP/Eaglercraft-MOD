const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const box={TextDecoder};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,"..","generic-mod-analyzer.js"),"utf8"),box);
const A=box.Jar2ZeusGenericAnalyzer;

function fakeClass(name, refs=[]) {
  const all=[name,...refs];
  const count=1+all.length*2;
  const parts=[Buffer.from([0xca,0xfe,0xba,0xbe,0,0,0,61,count>>8,count&255])];
  all.forEach((value,i)=>{
    const bytes=Buffer.from(value,"utf8");
    parts.push(Buffer.from([1,bytes.length>>8,bytes.length&255]),bytes);
    parts.push(Buffer.from([7,0,(i+1)*2-1]));
  });
  return Buffer.concat(parts);
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
