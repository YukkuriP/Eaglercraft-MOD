const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const box={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,"..","package-validator.js"),"utf8"),box);
const validate=box.Jar2ZeusPackageValidator.validate;
const base=()=>({
 metadata:{id:"example"},
 mainLua:"-- generated",
 analysis:{schema:"jar2zeus.generic-analysis.v1",classes:{count:0},unsupportedIndicators:[]},
 adapterReport:{schema:"jar2zeus.pipeline.v1",adapters:[]},
 apiValidation:{schema:"jar2zeus.zeus-api-validation.v1",valid:true,requiredApis:["blocks.register"],unsupportedApis:[]},
 packageFiles:[{path:"metadata.json",size:20},{path:"main.lua",size:40}],
 textureMappings:[],
 availableTextures:[],
 runtimeTested:false,
 targetRuntimeEvidence:{apiPresenceVerified:false,versionVerified:false}
});

test("accepts structurally valid output but does not claim runtime compatibility",()=>{
 const r=validate(base());
 assert.equal(r.valid,true);
 assert.equal(r.canImportForTesting,true);
 assert.equal(r.readyToImport,false);
 assert.equal(r.runtimeTested,false);
 assert.equal(r.gameplayVerified,false);
 assert.ok(r.warnings.some(w=>w.includes("Static HTML inspection")));
});

test("rejects missing output, failed adapters and missing API validation",()=>{
 const x=base();x.mainLua="";x.apiValidation=null;
 x.adapterReport.adapters.push({id:"example",status:"failed",error:"bad"});
 const r=validate(x);
 assert.equal(r.valid,false);
 assert.ok(r.errors.length>=3);
});

test("rejects unsupported API calls even when other package fields are valid",()=>{
 const x=base();
 x.apiValidation={schema:"jar2zeus.zeus-api-validation.v1",valid:false,requiredApis:[],unsupportedApis:["mod.warn"]};
 const r=validate(x);
 assert.equal(r.valid,false);
 assert.ok(r.errors.some(e=>e.includes("mod.warn")));
});

test("rejects missing texture inputs and unsafe output paths",()=>{
 const x=base();x.textureMappings=[{source:"missing.png",target:"../escape.png"}];
 x.packageFiles.push({path:"../escape.lua",size:1});
 const r=validate(x);assert.equal(r.valid,false);assert.ok(r.errors.length>=3);
});

test("rejects packages exceeding documented Zeus limits",()=>{
 const x=base();
 x.packageLimits={files:4097,bytes:64*1024*1024+1,maxFiles:4096,maxBytes:64*1024*1024};
 const r=validate(x);
 assert.equal(r.valid,false);
 assert.ok(r.errors.some(e=>e.includes("file limit")));
 assert.ok(r.errors.some(e=>e.includes("size limit")));
});

test("marks omitted files as incomplete rather than ready to import",()=>{
 const x=base();x.packageSkipped=[{path:"assets/demo/large.png",reason:"size"}];
 x.runtimeTested=true;x.targetRuntimeEvidence={apiPresenceVerified:true,versionVerified:true};
 const r=validate(x);
 assert.equal(r.valid,true);
 assert.equal(r.readyToImport,false);
 assert.ok(r.warnings.some(w=>w.includes("omitted")));
});

test("ready to import requires exact-client API and version verification",()=>{
 const x=base();x.runtimeTested=true;x.targetRuntimeEvidence={apiPresenceVerified:true,versionVerified:true};
 const r=validate(x);
 assert.equal(r.readyToImport,true);
});
