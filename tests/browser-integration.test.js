const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const html=fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
test("browser application inline JavaScript parses",()=>{
 const scripts=Array.from(html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi));
 assert.ok(scripts.length>0);
 for(const match of scripts){if(match[1].trim())assert.doesNotThrow(()=>new vm.Script(match[1]));}
});
test("browser application loads every migration engine module",()=>{
 for(const file of ["converter.js","resource-converter.js","definition-converter.js","generic-mod-analyzer.js","migration-pipeline.js","package-validator.js","machine-gui-state-bridge.js","machine-gui-live-binding.js"])
  assert.ok(html.includes('<script src="'+file+'"></script>'),"missing "+file);
});

test("export creates a standalone Zeus package with root metadata and clear import workflow",()=>{
 assert.match(html,/var out=new JSZip\(\),modZip=new JSZip\(\)/);
 assert.match(html,/modZip\.file\(path,data\)/);
 assert.match(html,/modZip\.generateAsync\(\{type:"blob"/);
 assert.match(html,/out\.file\(id\+"-zeus-mod\.zip",modBlob\)/);
 assert.match(html,/metadata\.json and main\.lua are at the ZIP root/);
 assert.equal(html.includes('migration-package/"+path'),false);
});

test("outer diagnostics export includes the live GUI telemetry consumer",()=>{
 assert.match(html,/machine-gui-live-binding\\.js/);
 assert.match(html,/machineGuiLiveBindingFileCount:1/);
 assert.match(html,/machine-gui-live-binding-plan\\.json/);
});

test("outer diagnostics export includes the provider starter template",()=>{
 assert.match(html,/diagnostics\/machine-state-provider-template\.lua/);
 assert.match(html,/machineGuiStateBridge\.providerTemplateLua/);
});
