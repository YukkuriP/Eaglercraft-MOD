/* Converts vanilla-style blockstates/models into documented Zeus block/item registrations. */
(function(root){
 "use strict";
 const BLOCKED=/(?:cannon|artillery|projectile|munition|firearm|weapon|rifle|pistol|musket|sword|bow|crossbow|trident)/i;
 const SAFE_ID=/^[a-z0-9_.-]+:[a-z0-9_./-]+$/;
 function q(s){return '"'+String(s).replace(/\\/g,"\\\\").replace(/"/g,'\\"').replace(/[\r\n\t]/g,c=>c==="\n"?"\\n":c==="\r"?"\\r":"\\t")+'"'}
 function lua(v){if(typeof v==="string")return q(v);if(typeof v==="number"||typeof v==="boolean")return String(v);if(Array.isArray(v))return "{ "+v.map(lua).join(", ")+" }";if(v&&typeof v==="object")return "{ "+Object.keys(v).sort().map(k=>"["+q(k)+"] = "+lua(v[k])).join(", ")+" }";return "nil"}
 function safe(p){return typeof p==="string"&&!p.startsWith("/")&&!p.includes("\\")&&!p.split("/").some(x=>x===".."||x===".")}
 function localId(id){return id.split("/").filter(Boolean).join("_").replace(/[^a-z0-9_]/g,"_").slice(0,64)}
 function modelPath(id,kind,ns){
  if(typeof id!=="string")return null;
  let n=ns,p=id;
  if(p.includes(":")){const a=p.split(":");if(a.length!==2)return null;n=a[0];p=a[1]}
  if(n!=="minecraft"&&n!==ns)return null;
  if(p.startsWith("block/"))p=p.slice(6);
  else if(p.startsWith("item/"))p=p.slice(5);
  else if(p.includes("/"))return null;
  return "assets/"+n+"/models/"+kind+"/"+p+".json";
 }
 function texturePath(ns,ref){
  if(typeof ref!=="string"||ref.startsWith("#"))return null;
  let n=ns,p=ref;
  if(p.includes(":")){const a=p.split(":");if(a.length!==2)return null;n=a[0];p=a[1]}
  if(n==="minecraft")return {source:null,target:"minecraft:"+p};
  if(n!==ns)return null;
  if(!p.includes("/"))p="block/"+p;
  const source="assets/"+ns+"/textures/"+p+".png";
  return safe(source)?{source,target:"textures/"+ns+"_"+p.replace(/\//g,"_")+".png"}:null;
 }
 function convert(entries,modNamespace){
  const files=new Map(entries.filter(e=>safe(e.path)).map(e=>[e.path,e.content]));
  const json=new Map(),langs={};
  for(const [path,raw] of files){
   if(typeof raw!=="string"||!path.endsWith(".json"))continue;
   try{json.set(path,JSON.parse(raw))}catch(_){}
   const lm=path.match(/^assets\/([^/]+)\/lang\/[a-z0-9_-]+\.json$/i);
   if(lm&&lm[1]===modNamespace){try{Object.assign(langs,JSON.parse(raw))}catch(_){}}
  }
  function resolveModel(id,kind,depth=0,seen=new Set()){
   if(depth>12||typeof id!=="string")return null;
   const path=modelPath(id,kind,modNamespace);
   if(!path||seen.has(path))return null;
   const own=json.get(path);if(!own||typeof own!=="object")return null;
   const next=new Set(seen);next.add(path);
   let parent={textures:{},elements:null};
   if(own.parent){
    const pp=modelPath(own.parent,kind,modNamespace);
    if(pp&&json.has(pp))parent=resolveModel(own.parent,kind,depth+1,next)||parent;
    else parent={textures:{},elements:null,parent:own.parent};
   }
   return {textures:Object.assign({},parent.textures||{},own.textures||{}),elements:own.elements||parent.elements||null,parent:own.parent||parent.parent||null,parents:[own.parent].concat(parent.parents||[]).filter(Boolean),ambientocclusion:own.ambientocclusion};
  }
  function resolveTexture(ref,textures,depth=0){
   if(typeof ref!=="string"||depth>12)return null;
   if(ref[0]==="#")return resolveTexture(textures[ref.slice(1)],textures,depth+1);
   return ref;
  }
  function chooseBlockModel(state){
   if(!state||typeof state!=="object")return {error:"invalid blockstate"};
   const models=[];
   if(state.variants&&typeof state.variants==="object"){
    for(const value of Object.values(state.variants)){
     const choices=Array.isArray(value)?value:[value];
     for(const choice of choices){const model=typeof choice==="string"?choice:choice&&choice.model;if(typeof model==="string")models.push(model)}
    }
   }
   if(state.multipart&&Array.isArray(state.multipart))return {error:"multipart blockstates need per-state logic"};
   const unique=Array.from(new Set(models));
   if(!unique.length)return {error:"no variant model found"};
   if(unique.length!==1)return {error:"different models across blockstate variants"};
   return {model:unique[0]};
  }
  function blockTextures(model,ns){
   const tex=model.textures||{},out={},used=[];
   const map={all:"all",top:"top",bottom:"bottom",side:"side",front:"front",north:"north",south:"south",east:"east",west:"west"};
   for(const [face,key] of Object.entries(map)){
    let ref=resolveTexture(tex[key],tex);
    if(!ref&&face==="top")ref=resolveTexture(tex.up,tex);
    if(!ref&&face==="bottom")ref=resolveTexture(tex.down,tex);
    if(!ref&&key==="top")ref=resolveTexture(tex.end,tex);
    if(!ref&&key==="bottom")ref=resolveTexture(tex.end,tex);
    if(!ref&&key==="side")ref=resolveTexture(tex.all,tex);
    if(!ref&&key==="front")ref=resolveTexture(tex.front,tex);
    const t=texturePath(ns,ref);
    if(t){out[face]=t.target;if(t.source)used.push(t)}
   }
   if(!Object.keys(out).length&&Array.isArray(model.elements)){
    const faces={};
    for(const el of model.elements)for(const [face,def] of Object.entries(el.faces||{})){
     const ref=resolveTexture(def.texture,tex),t=texturePath(ns,ref);
     if(t){faces[face]=t.target;if(t.source)used.push(t)}
    }
    const side=faces.north||faces.south||faces.east||faces.west;
    if(side){out.side=side;if(faces.north)out.north=faces.north;if(faces.south)out.south=faces.south;if(faces.east)out.east=faces.east;if(faces.west)out.west=faces.west}
    if(faces.up)out.top=faces.up;if(faces.down)out.bottom=faces.down;
   }
   const unique=new Set(Object.values(out));
   if(unique.size===1)return {texture:out.all||out.side||out.top||out.front||Object.values(out)[0],used};
   return {texture:out,used};
  }
  const lines=["-- Generated by Jar2Zeus using documented Zeus blocks/items APIs.","-- Unsupported Java logic and complex blockstate behavior are reported, not guessed.",""];
  const copied=[],report={blocks:[],items:[],skipped:[],counts:{blocks:0,items:0,skipped:0}};
  const seenIds=new Set();
  for(const [path,state] of json){
   const match=path.match(/^assets\/([^/]+)\/blockstates\/(.+)\.json$/);
   if(!match||match[1]!==modNamespace||BLOCKED.test(path))continue;
   const id=match[1]+":"+match[2];if(!SAFE_ID.test(id))continue;
   const selected=chooseBlockModel(state);
   if(selected.error){report.skipped.push({id,reason:selected.error});continue}
   const model=resolveModel(selected.model,"block");
   if(!model){report.skipped.push({id,reason:"model or parent could not be resolved"});continue}
   const tex=blockTextures(model,match[1]);
   if(!tex.texture){report.skipped.push({id,reason:"no supported texture reference"});continue}
   const local=localId(match[2]);if(!local||seenIds.has("b:"+local)){report.skipped.push({id,reason:"empty or duplicate local Zeus id"});continue}
   const translation=langs["block."+match[1]+"."+match[2].replace(/\//g,".")];
   const props={name:translation||local.replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase()),texture:tex.texture,hardness:1.5,sound:"stone"};
   const parent=String(model.parent||"");
   if(/cube_column/.test(parent))props.rotate="axis";
   if(/glass|leaves/.test(match[2]))props.transparent=true;
   lines.push("blocks.register("+q(local)+", "+lua(props)+")");
   seenIds.add("b:"+local);report.blocks.push(id);
   copied.push(...tex.used);
  }
  for(const [path,raw] of json){
   const match=path.match(/^assets\/([^/]+)\/models\/item\/(.+)\.json$/);
   if(!match||match[1]!==modNamespace||BLOCKED.test(path))continue;
   const id=match[1]+":"+match[2];if(!SAFE_ID.test(id))continue;
   const model=resolveModel(match[1]+":item/"+match[2],"item");
   if(!model){report.skipped.push({id,reason:"item model or parent could not be resolved"});continue}
   if(!model.parents.some(p=>String(p).endsWith("item/generated")||String(p).endsWith("item/handheld"))){
    report.skipped.push({id,reason:"item parent is not item/generated or item/handheld"});continue;
   }
   const ref=resolveTexture(model.textures&&(model.textures.layer0||model.textures.layer1),model.textures||{});
   const tex=texturePath(match[1],ref);
   if(!tex|| (tex.source&&!files.has(tex.source))){report.skipped.push({id,reason:"generated item texture missing"});continue}
   const local=localId(match[2]);if(!local||seenIds.has("i:"+local)){report.skipped.push({id,reason:"empty or duplicate local Zeus id"});continue}
   const translation=langs["item."+match[1]+"."+match[2].replace(/\//g,".")];
   const props={name:translation||local.replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase()),texture:tex.target,stack:64};
   if(model.parents.some(p=>String(p).endsWith("item/handheld")))props.handheld=true;
   lines.push("items.register("+q(local)+", "+lua(props)+")");
   seenIds.add("i:"+local);report.items.push(id);if(tex.source)copied.push(tex);
  }
  const dedup=new Map();for(const x of copied)if(x.source)dedup.set(x.source,x);
  const mappings=Array.from(dedup.values());
  report.counts={blocks:report.blocks.length,items:report.items.length,skipped:report.skipped.length};
  report.skippedCount=report.skipped.length;
  return {lua:lines.join("\n"),copied:mappings,report};
 }
 root.Jar2ZeusDefinitions={convert};
})(typeof globalThis!=="undefined"?globalThis:this);
