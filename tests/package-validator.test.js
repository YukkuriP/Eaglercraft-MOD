const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const box={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,"..","package-validator.js"),"utf8"),box);
const validate=box.Jar2ZeusPackageValidator.validate;
const base=()=>({metadata:{id:"example"},mainLua:"-- generated",analysis:{schema:"jar2zeus.generic-analysis.v1",classes:{count:0},unsupportedIndicators:[]},adapterReport:{schema:"jar2zeus.pipeline.v1",adapters:[]},textureMappings:[],availableTextures:[],runtimeTested:false});
test("accepts structurally valid output but never claims runtime success without an in-game test",()=>{
 const r=validate(base());assert.equal(r.valid,true);assert.equal(r.readyToImport,false);assert.equal(r.runtimeTested,false);
});
test("rejects missing output and failed adapters",()=>{
 const x=base();x.mainLua="";x.adapterReport.adapters.push({id:"example",status:"failed",error:"bad"});
 const r=validate(x);assert.equal(r.valid,false);assert.ok(r.errors.length>=2);
});
test("rejects missing texture inputs and unsafe output paths",()=>{
 const x=base();x.textureMappings=[{source:"missing.png",target:"../escape.png"}];
 const r=validate(x);assert.equal(r.valid,false);assert.equal(r.errors.length,2);
});
