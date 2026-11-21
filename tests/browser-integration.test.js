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
 for(const file of ["converter.js","resource-converter.js","definition-converter.js","generic-mod-analyzer.js","migration-pipeline.js","package-validator.js","machine-gui-state-bridge.js","machine-gui-live-binding.js","machine-state-provider-sdk.js","machine-state-event-producer.js","machine-state-source-analysis.js","machine-state-getter-semantics.js"])
  assert.ok(html.includes('<script src="'+file+'"></script>'),"missing "+file);
});

test("export creates a standalone Zeus package with root metadata and clear import workflow",()=>{
 assert.match(html,/var out=new JSZip\(\),modZip=new JSZip\(\)/);
 assert.match(html,/modZip\.file\(path,data\)/);
 assert.match(html,/modZip\.generateAsync\(\{type:"blob"/);
 assert.match(html,/out\.file\(id\+"-zeus-mod\.zip",modBlob\)/);
 assert.ok(html.includes('if(!addPackageFile("metadata.json"'));
 assert.ok(html.includes('if(!addPackageFile("main.lua"'));
 assert.equal(html.includes('migration-package/"+path'),false);
});

test("outer diagnostics export includes the live GUI telemetry consumer",()=>{
 assert.ok(html.includes("machine-gui-live-binding.js"));
 assert.ok(html.includes("machineGuiLiveBindingFileCount:1"));
 assert.ok(html.includes("machine-gui-live-binding-plan.json"));
 assert.ok(html.includes("generatedMain+=") && html.includes("machineGuiLiveBinding.lua;"));
 assert.ok(html.includes('out.file("diagnostics/machine-gui-live-binding.lua",machineGuiLiveBinding.lua)'));
});

test("outer diagnostics export includes the provider starter template",()=>{
 assert.match(html,/diagnostics\/machine-state-provider-template\.lua/);
 assert.match(html,/machineGuiStateBridge\.providerTemplateLua/);
});

test("Phase 23 exports a separate companion provider ZIP and matching default ID",()=>{
 assert.ok(html.includes("machine-state-provider-sdk.js"));
 assert.ok(html.includes("providerModId:providerModId"));
 assert.ok(html.includes("providerId:providerModId"));
 assert.ok(html.includes("machineStateProviderSdkFileCount:1"));
 assert.ok(html.includes("machine-state-provider-sdk-plan.json"));
 assert.ok(html.includes("diagnostics/machine-state-provider-sdk.lua"));
 assert.ok(html.includes('providerZip.file("metadata.json"'));
 assert.ok(html.includes('providerZip.file("main.lua",machineStateProviderSdk.lua)'));
 assert.ok(html.includes("out.file(machineStateProviderSdk.report.packageFileName,providerZipBlob)"));
 assert.ok(html.includes('generatedMain+="\\n\\n-- Jar2Zeus live machine telemetry utility (read-only)\\n"+machineGuiLiveBinding.lua;'));
});

test("Phase 24 appends an opt-in event publisher and exports its diagnostics",()=>{
 assert.ok(html.includes("machine-state-event-producer.js"));
 assert.ok(html.includes("Jar2ZeusMachineStateEventProducer.convert"));
 assert.ok(html.includes("machineStateEventProducer.lua"));
 assert.ok(html.includes("machine-state-event-producer-plan.json"));
 assert.ok(html.includes("diagnostics/machine-state-event-producer.lua"));
 assert.ok(html.includes("machineStateEventProducerFileCount:1"));
 assert.ok(html.includes("generatedMain+=\"\\n\\n-- Jar2Zeus explicit machine-state event publisher helper (manual call only)\\n\"+machineStateEventProducer.lua;"));
 assert.ok(html.includes("machineStateEventProducer:jarReport.machine_state_event_producer"));
 assert.ok(html.includes("mod.export.publish_machine_state"));
});

test("Phase 25 maps machine field hints to static Java getter evidence",()=>{
 assert.ok(html.includes("machine-state-source-analysis.js"));
 assert.ok(html.includes("Jar2ZeusMachineStateSourceAnalysis.analyze"));
 assert.ok(html.includes("machineStateSourceAnalysisFileCount:1"));
 assert.ok(html.includes('addPackageFile("machine-state-source-analysis-plan.json"'));
 assert.ok(html.includes('out.file("diagnostics/machine-state-source-analysis-plan.json"'));
});

test("Phase 26 analyzes getter bodies and exports the static semantics plan",()=>{
 assert.ok(html.includes("machine-state-getter-semantics.js"));
 assert.ok(html.includes("Jar2ZeusMachineStateGetterSemantics.analyze"));
 assert.ok(html.includes("machineStateGetterSemanticsFileCount:1"));
 assert.ok(html.includes('addPackageFile("machine-state-getter-semantics-plan.json"'));
 assert.ok(html.includes('out.file("diagnostics/machine-state-getter-semantics-plan.json"'));
 assert.ok(html.includes("javaMethodsExecuted:false"));
 assert.ok(html.includes("sourceRuntimeValuesRecovered:false"));
});
