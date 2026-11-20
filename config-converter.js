/* Converts simple scalar config defaults into Zeus-managed settings.
 * This is configuration-data migration only; it does not rewrite Java config APIs.
 */
(function(root){
 "use strict";
 const BLOCKED=/(?:cannon|artillery|projectile|munition|firearm|weapon|rifle|pistol|musket|sword|bow|crossbow|trident)/i;
 const SECRET=/(?:password|passwd|secret|token|credential|private.?key|access.?token|api.?key|session.?id)/i;
 function lua(value){
  if(typeof value==="boolean")return String(value);
  if(typeof value==="number")return Number.isFinite(value)?String(value):"nil";
  const text=String(value);
  return '"'+text.replace(/\\/g,"\\\\").replace(/"/g,'\\"').replace(/\r/g,"\\r").replace(/\n/g,"\\n").replace(/\t/g,"\\t")+'"';
 }
 function safePath(path){
  return typeof path==="string"&&!path.startsWith("/")&&!path.includes("\\")&&!path.split("/").some(x=>!x||x==="."||x==="..");
 }
 function scalar(raw){
  const value=String(raw).trim();
  if(!value||value==="null"||value==="~"||value.startsWith("[")||value.startsWith("{"))return null;
  if(value==="true")return {type:"boolean",value:true};
  if(value==="false")return {type:"boolean",value:false};
  if((value.startsWith('"')&&value.endsWith('"'))){
   try{const parsed=JSON.parse(value);return typeof parsed==="string"?{type:"string",value:parsed}:null}catch(_){return null}
  }
  if(value.startsWith("'")&&value.endsWith("'"))return {type:"string",value:value.slice(1,-1)};
  if(/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)){
   const number=Number(value);return Number.isFinite(number)?{type:"number",value:number}:null;
  }
  return {type:"string",value:value};
 }
 function addValue(out,key,value,path,report){
  if(!key||SECRET.test(key)){report.excludedSensitiveKeys++;return}
  if(typeof value==="string"&&BLOCKED.test(key+" "+value)){report.skipped.push({path,reason:"restricted configuration content is excluded"});return}
  if(typeof value==="string"&&value.length>512){report.skipped.push({path,key,reason:"string setting exceeds 512 characters"});return}
  if(typeof value==="number"&&!Number.isFinite(value))return;
  if(!["boolean","number","string"].includes(typeof value))return;
  out.push({path,key,valueType:typeof value,value});
 }
 function flattenJson(value,prefix,out,path,report,depth){
  if(depth>8){report.skipped.push({path,reason:"JSON configuration nesting exceeds 8 levels"});return}
  if(value&&typeof value==="object"&&!Array.isArray(value)){
   for(const key of Object.keys(value).sort()){
    const next=prefix?prefix+"."+key:key;
    if(SECRET.test(next)){report.excludedSensitiveKeys++;continue}
    flattenJson(value[key],next,out,path,report,depth+1);
   }
   return;
  }
  addValue(out,prefix,value,path,report);
 }
 function stripTomlComment(line){
  let quote=null,escaped=false;
  for(let i=0;i<line.length;i++){
   const c=line[i];
   if(escaped){escaped=false;continue}
   if(c==="\\"&&quote==='"'){escaped=true;continue}
   if((c==='"'||c==="'")&&(!quote||quote===c)){quote=quote?null:c;continue}
   if(c==="#"&&!quote)return line.slice(0,i);
  }
  return line;
 }
 function parseToml(raw,path,out,report){
  let section="";
  const lines=raw.split(/\r?\n/);
  for(let i=0;i<lines.length;i++){
   const line=stripTomlComment(lines[i]).trim();
   if(!line)continue;
   const sectionMatch=line.match(/^\[([^\[\]]+)\]$/);
   if(sectionMatch){section=sectionMatch[1].trim();continue}
   if(line.startsWith("[["))continue;
   const match=line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
   if(!match)continue;
   const key=section?section+"."+match[1]:match[1];
   const parsed=scalar(match[2]);
   if(parsed)addValue(out,key,parsed.value,path,report);
  }
 }
 function parseProperties(raw,path,out,report){
  for(const lineRaw of raw.split(/\r?\n/)){
   const line=lineRaw.trim();
   if(!line||line.startsWith("#")||line.startsWith("!"))continue;
   const match=line.match(/^([^:=\s]+)\s*[:=]\s*(.*)$/);
   if(!match)continue;
   const parsed=scalar(match[2]);
   if(parsed)addValue(out,match[1],parsed.value,path,report);
  }
 }
 function convert(entries){
  const report={schema:"jar2zeus.config-settings.v1",filesSeen:0,settingsGenerated:0,excludedSensitiveKeys:0,sourceReadersRewritten:false,migrationMode:"zeus-settings-export-only",skipped:[],warnings:[]};
  const candidates=(entries||[]).filter(e=>e&&typeof e.path==="string"&&safePath(e.path)&&/^(?:config|defaultconfigs)\//i.test(e.path)&&/\.(?:json|toml|properties)$/i.test(e.path)).sort((a,b)=>a.path.localeCompare(b.path));
  const values=[];
  for(const entry of candidates){
   report.filesSeen++;
   if(typeof entry.content!=="string"||entry.content.length>1024*1024){report.skipped.push({path:entry.path,reason:"missing text or configuration exceeds 1 MiB"});continue}
   if(BLOCKED.test(entry.path+" "+entry.content)){report.skipped.push({path:entry.path,reason:"restricted configuration content is excluded"});continue}
   const local=[];
   const ext=entry.path.split(".").pop().toLowerCase();
   try{
    if(ext==="json"){
     const parsed=JSON.parse(entry.content);
     if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw new Error("JSON root must be an object");
     flattenJson(parsed,"",local,entry.path,report,0);
    }else if(ext==="toml")parseToml(entry.content,entry.path,local,report);
    else parseProperties(entry.content,entry.path,local,report);
   }catch(error){report.skipped.push({path:entry.path,reason:"configuration parse failed: "+String(error&&error.message||error)});continue}
   for(const item of local)values.push(item);
  }
  const unique=new Map();
  for(const item of values)unique.set(item.path+"\n"+item.key,item);
  const settings=Array.from(unique.values()).slice(0,256);
  if(values.length>256)report.skipped.push({reason:(values.length-256)+" additional settings omitted by the 256-setting safety limit"});
  const lines=["-- Simple config defaults migrated into Zeus settings.","-- Java/Fabric/Forge config classes are not redirected automatically.",""];
  const fields=[];
  settings.forEach((item,index)=>{
   const id="jar2zeus_cfg_"+String(index+1).padStart(3,"0");
   const label=(item.path+" :: "+item.key).slice(0,120);
   const description=("Migrated default from "+item.path).slice(0,180);
   if(item.valueType==="boolean"){
    lines.push("settings.toggle("+lua(id)+", { label = "+lua(label)+", description = "+lua(description)+", default = "+lua(item.value)+" })");
   }else{
    lines.push("settings.text("+lua(id)+", { label = "+lua(label)+", description = "+lua(description)+", default = "+lua(String(item.value))+" })");
   }
   fields.push({sourcePath:item.path,sourceKey:item.key,settingKey:id,valueType:item.valueType,default:item.value});
  });
  if(fields.length){
   lines.push("mod.export = mod.export or {}");
   lines.push("mod.export.jar2zeus = mod.export.jar2zeus or {}");
   lines.push("mod.export.jar2zeus.config = { get = function()");
   lines.push("  local values = {}");
   for(const field of fields){
    let expr;
    if(field.valueType==="boolean")expr="(function() local v = settings.get("+lua(field.settingKey)+"); if v == nil then return "+lua(field.default)+" end; return v end)()";
    else if(field.valueType==="number"){
     const fallback=lua(field.default);
     const key=lua(field.settingKey);
     expr="(function() local n = tonumber(settings.get("+key+")); if n == nil or n ~= n or n == math.huge or n == -math.huge then return "+fallback+" end; return n end)()";
    }else expr="(settings.get("+lua(field.settingKey)+") or "+lua(field.default)+")";
    lines.push("  values["+lua(field.sourcePath+"::"+field.sourceKey)+"] = "+expr);
   }
   lines.push("  return values");
   lines.push("end }");
  }
  report.settingsGenerated=fields.length;
  if(!fields.length)report.warnings.push("No simple scalar config defaults were found; nested lists, object values and secret-like keys are not converted.");
  else report.warnings.push("These are editable Zeus settings and exported config values; original Java config readers are not automatically redirected.");
  return {lua:lines.join("\n"),report,fields};
 }
 root.Jar2ZeusConfigConverter={convert,safePath,scalar};
})(typeof globalThis!=="undefined"?globalThis:this);
