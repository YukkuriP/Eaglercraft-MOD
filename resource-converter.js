/* Resource indexer for Jar2Zeus. Produces portable metadata; does not invent Zeus APIs. */
(function(root){
  "use strict";
  const BLOCKED=/(?:cannon|artillery|projectile|munition|firearm|weapon|rifle|pistol|musket|sword|bow|crossbow|trident)/i;
  const ID=/^[a-z0-9_.-]+:[a-z0-9_./-]+$/;
  function safePath(p){return typeof p==="string"&&!p.startsWith("/")&&!p.includes("\\")&&!p.split("/").some(x=>x===".."||x===".");}
  function idFromPath(path,kind){
    const m=path.match(new RegExp("^data/([a-z0-9_.-]+)/tags/"+kind+"/(.+)\\.json$"));
    return m?m[1]+":"+m[2]:null;
  }
  function parseTag(path,raw){
    const kindMatch=path.match(/^data\/[^/]+\/tags\/(blocks|items|fluids|entity_types)\/.+\.json$/);
    if(!kindMatch||!safePath(path)||BLOCKED.test(path))return {status:"ignored"};
    let obj;try{obj=JSON.parse(raw)}catch(_){return {status:"skipped",reason:"invalid JSON"}}
    if(!obj||!Array.isArray(obj.values))return {status:"skipped",reason:"tag values must be an array"};
    const values=[],invalid=[];
    for(const v of obj.values){
      const entry=typeof v==="string"?v:(v&&typeof v.id==="string"?v.id:null);
      if(!entry){invalid.push(v);continue}
      const tag=entry.startsWith("#"),id=tag?entry.slice(1):entry;
      const normalized=id.includes(":")?id:"minecraft:"+id;
      if(!ID.test(normalized)||normalized.split(":")[1].split("/").some(x=>!x||x===".."||x===".")){invalid.push(v);continue}
      if(BLOCKED.test(normalized))continue;
      values.push((tag?"#":"")+normalized);
    }
    const id=idFromPath(path,kindMatch[1]);
    return {status:"indexed",id,kind:kindMatch[1],replace:obj.replace===true,values:Array.from(new Set(values)),invalid_count:invalid.length};
  }
  function index(entries){
    const result={tags:[],translations:{},models:[],blockstates:[],skipped:[],counts:{}};
    for(const e of entries){
      if(!safePath(e.path)||BLOCKED.test(e.path)){result.skipped.push({path:e.path,reason:"unsafe or restricted path"});continue}
      if(/^data\/[^/]+\/tags\/(blocks|items|fluids|entity_types)\/.+\.json$/.test(e.path)){
        const t=parseTag(e.path,e.content);
        if(t.status==="indexed")result.tags.push(t);else if(t.status==="skipped")result.skipped.push({path:e.path,reason:t.reason});
      } else if(/^assets\/[^/]+\/lang\/[a-z0-9_-]+\.json$/.test(e.path)){
        try{
          const lang=JSON.parse(e.content);
          if(!lang||typeof lang!=="object"||Array.isArray(lang))throw Error("language file must be an object");
          for(const [k,v] of Object.entries(lang))if(typeof v==="string"&&!BLOCKED.test(k))result.translations[k]=v;
        }catch(_){result.skipped.push({path:e.path,reason:"invalid language JSON"})}
      } else if(/^assets\/[^/]+\/models\/.+\.json$/.test(e.path)) result.models.push(e.path);
      else if(/^assets\/[^/]+\/blockstates\/.+\.json$/.test(e.path)) result.blockstates.push(e.path);
    }
    result.tags.sort((a,b)=>a.id.localeCompare(b.id));
    result.models.sort();result.blockstates.sort();
    result.counts={tags:result.tags.length,translations:Object.keys(result.translations).length,models:result.models.length,blockstates:result.blockstates.length,skipped:result.skipped.length};
    return result;
  }
  root.Jar2ZeusResources={index,parseTag};
})(typeof globalThis!=="undefined"?globalThis:this);
