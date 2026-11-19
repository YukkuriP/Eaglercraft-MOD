/* Structural output validation. This never substitutes for running the package in the target game. */
(function(root){
 "use strict";
 function unsafePath(path){
  return typeof path!=="string" || !path || path.startsWith("/") ||
   path.includes("\\") || path.split("/").some(p=>!p||p===".."||p===".");
 }
 function validate(input){
  const errors=[],warnings=[];
  if(!input||typeof input!=="object")return {valid:false,readyToImport:false,canImportForTesting:false,runtimeTested:false,gameplayVerified:false,errors:["validation input missing"],warnings:[]};
  if(!input.metadata||typeof input.metadata.id!=="string"||!input.metadata.id)errors.push("metadata.id missing");
  if(typeof input.mainLua!=="string"||!input.mainLua.trim())errors.push("main.lua missing or empty");
  if(!input.analysis||input.analysis.schema!=="jar2zeus.generic-analysis.v1")errors.push("generic analysis report missing");
  if(!input.adapterReport||input.adapterReport.schema!=="jar2zeus.pipeline.v1")errors.push("adapter report missing");
  else for(const a of input.adapterReport.adapters||[])if(a.status==="failed")errors.push("adapter failed: "+a.id+" ("+(a.error||"unknown")+")");
  const api=input.apiValidation;
  if(!api||api.schema!=="jar2zeus.zeus-api-validation.v1")errors.push("Zeus API contract validation missing");
  else {
   if(api.valid!==true)errors.push("generated Lua contains undocumented Zeus API calls: "+(api.unsupportedApis||[]).join(", "));
   if(!Array.isArray(api.requiredApis))errors.push("Zeus API validation has no requiredApis list");
  }
  const mappings=Array.isArray(input.textureMappings)?input.textureMappings:[];
  const packageLimits=input.packageLimits||{files:0,bytes:0,maxFiles:4096,maxBytes:64*1024*1024};
  if(packageLimits.files>packageLimits.maxFiles)errors.push("Zeus package file limit exceeded");
  if(packageLimits.bytes>packageLimits.maxBytes)errors.push("Zeus package unpacked size limit exceeded");
  const packageFiles=Array.isArray(input.packageFiles)?input.packageFiles:[];
  if(input.packageSkipped&&input.packageSkipped.length)warnings.push("Some source resources were omitted because of safety or Zeus package limits");
  const packagePaths=new Set();
  for(const file of packageFiles){
   if(!file||unsafePath(file.path))errors.push("unsafe package file path");
   else if(packagePaths.has(file.path))errors.push("duplicate package file: "+file.path);
   else packagePaths.add(file.path);
  }
  if(!packagePaths.has("metadata.json"))errors.push("metadata.json missing from package root");
  if(!packagePaths.has("main.lua"))errors.push("main.lua missing from package root");
  const available=new Set(input.availableTextures||[]);
  for(const m of mappings){
   if(!m||typeof m.source!=="string"||unsafePath(m.target))errors.push("invalid or unsafe texture mapping");
   else if(!available.has(m.source))errors.push("missing source texture: "+m.source);
  }
  if(input.analysis&&input.analysis.classes&&input.analysis.classes.count>0){
   const rebuild=input.reimplementation;
   if(rebuild&&rebuild.schema==="jar2zeus.reimplementation.v1"){
    if((rebuild.utilityMethodsTranslated||0)>0)warnings.push("Some pure Java helper methods were emitted as Lua, but this does not by itself connect them to game events");
    if((rebuild.methodsPending||0)>0)warnings.push((rebuild.methodsPending||0)+" Java methods still need feature-specific Zeus reimplementation");
    if((rebuild.methodsPending||0)===0&&(rebuild.utilityMethodsTranslated||0)===0)warnings.push("Java bytecode was inspected but no method was translated");
   }else warnings.push("Java bytecode was analyzed but no reimplementation report was supplied");
  }
  if(input.analysis&&input.analysis.unsupportedIndicators&&input.analysis.unsupportedIndicators.length)warnings.push("MOD contains unsupported runtime features: "+input.analysis.unsupportedIndicators.join(", "));
  if(input.runtimeTested!==true)warnings.push("The selected Zeus target has not passed an in-game runtime test");
  const targetEvidence=input.targetRuntimeEvidence||{};
  if(targetEvidence.apiPresenceVerified!==true)warnings.push("Required Zeus API presence has not been verified in the selected game build");
  if(targetEvidence.versionVerified!==true)warnings.push("The running game version has not been confirmed by an in-game report; the package version is based on the selection");
  const valid=errors.length===0;
  const skipped=!!(input.packageSkipped&&input.packageSkipped.length);
  const runtimeTested=input.runtimeTested===true;
  const gameplayVerified=input.gameplayVerified===true;
  const readyToImport=valid&&runtimeTested&&!skipped&&targetEvidence.apiPresenceVerified===true&&targetEvidence.versionVerified===true;
  return {
   valid,
   structurallyValid:valid,
   canImportForTesting:valid,
   readyToImport,
   runtimeTested,
   gameplayVerified,
   targetRuntimeEvidence:{
    apiPresenceVerified:targetEvidence.apiPresenceVerified===true,
    versionVerified:targetEvidence.versionVerified===true
   },
   packageLimits,
   requiredApis:api&&Array.isArray(api.requiredApis)?api.requiredApis:[],
   errors,
   warnings
  };
 }
 root.Jar2ZeusPackageValidator={validate};
})(typeof globalThis!=="undefined"?globalThis:this);
