/* Structural output validation. This does not claim in-game compatibility. */
(function(root){
 "use strict";
 function validate(input){
  const errors=[],warnings=[];
  if(!input||typeof input!=="object")return {valid:false,readyToImport:false,runtimeTested:false,errors:["validation input missing"],warnings:[]};
  if(!input.metadata||typeof input.metadata.id!=="string"||!input.metadata.id)errors.push("metadata.id missing");
  if(typeof input.mainLua!=="string"||!input.mainLua.trim())errors.push("main.lua missing or empty");
  if(!input.analysis||input.analysis.schema!=="jar2zeus.generic-analysis.v1")errors.push("generic analysis report missing");
  if(!input.adapterReport||input.adapterReport.schema!=="jar2zeus.pipeline.v1")errors.push("adapter report missing");
  else for(const a of input.adapterReport.adapters||[])if(a.status==="failed")errors.push("adapter failed: "+a.id+" ("+(a.error||"unknown")+")");
  const mappings=Array.isArray(input.textureMappings)?input.textureMappings:[];
  const available=new Set(input.availableTextures||[]);
  for(const m of mappings){
   if(!m||typeof m.source!=="string"||typeof m.target!=="string")errors.push("invalid texture mapping");
   else if(!available.has(m.source))errors.push("missing source texture: "+m.source);
   else if(m.target.startsWith("/")||m.target.includes("\\")||m.target.split("/").some(p=>p===".."||p==="."))errors.push("unsafe texture target: "+m.target);
  }
  if(input.analysis&&input.analysis.classes&&input.analysis.classes.count>0)warnings.push("Java bytecode was analyzed, not ported into Zeus Lua");
  if(input.analysis&&input.analysis.unsupportedIndicators&&input.analysis.unsupportedIndicators.length)warnings.push("MOD contains unsupported runtime features: "+input.analysis.unsupportedIndicators.join(", "));
  if(!input.runtimeTested)warnings.push("In-game runtime test has not been performed");
  return {valid:errors.length===0,readyToImport:errors.length===0&&(!input.adapterReport||!(input.adapterReport.adapters||[]).some(a=>a.status==="failed")),runtimeTested:!!input.runtimeTested,errors,warnings};
 }
 root.Jar2ZeusPackageValidator={validate};
})(typeof globalThis!=="undefined"?globalThis:this);
