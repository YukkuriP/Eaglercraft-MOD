/* Converts compatible Blockbench/Bedrock-style entity geometry into documented Zeus mob models.
 * Custom keyframe timelines are analyzed and reported; only Zeus built-in part motions are emitted.
 */
(function(root){
 "use strict";
 const BLOCKED=/(?:cannon|artillery|projectile|munition|firearm|weapon|rifle|pistol|musket|sword|bow|crossbow|trident)/i;
 const SAFE_ID=/^[a-z0-9_]{1,48}$/;
 function lua(v){
  if(v===null||v===undefined)return "nil";
  if(typeof v==="string")return '"'+v.replace(/\\/g,"\\\\").replace(/"/g,'\\"').replace(/[\r\n\t]/g,c=>c==="\n"?"\\n":c==="\r"?"\\r":"\\t")+'"';
  if(typeof v==="number")return Number.isFinite(v)?String(v):"nil";
  if(typeof v==="boolean")return String(v);
  if(Array.isArray(v))return "{ "+v.map(lua).join(", ")+" }";
  if(typeof v==="object")return "{ "+Object.keys(v).sort().map(k=>"["+lua(k)+"] = "+lua(v[k])).join(", ")+" }";
  return "nil";
 }
 function vec(v,n,label){
  if(!Array.isArray(v)||v.length!==n||!v.every(x=>typeof x==="number"&&Number.isFinite(x)))throw new Error(label+" must be a "+n+"-number array");
  return v.slice();
 }
 function basename(path){return path.split("/").pop().replace(/\.(geo|geometry|animation)?\.json$/i,"").replace(/\.json$/i,"");}
 function safeName(s){return String(s||"entity").toLowerCase().replace(/[^a-z0-9_]/g,"_").replace(/^_+|_+$/g,"").slice(0,48)||"entity";}
 function parseJsonEntries(entries){
  const map=new Map();
  for(const e of entries||[]){
   if(!e||typeof e.path!=="string"||BLOCKED.test(e.path))continue;
   if(typeof e.content==="string"&&e.path.endsWith(".json")){try{map.set(e.path,JSON.parse(e.content))}catch(_){}}
  }
  return map;
 }
 function findGeometries(value){
  if(!value||typeof value!=="object")return [];
  const raw=value["minecraft:geometry"]||value.geometry||value.geometries;
  if(Array.isArray(raw))return raw;
  if(raw&&typeof raw==="object")return [raw];
  if(Array.isArray(value.bones))return [value];
  return [];
 }
 function classifyMotion(boneName,animationNames){
  const b=boneName.toLowerCase(),a=animationNames.join(" ").toLowerCase();
  if(/wing/.test(b)||(/fly|flap/.test(a)&&/wing/.test(b)))return "wing";
  if(/head|neck/.test(b))return "head";
  if(/leg|foot|feet/.test(b))return "leg";
  if(/arm|hand/.test(b))return "arm";
  if(/rotor|propeller/.test(b)&&/spin|rotate/.test(a))return "spin";
  if(/body|root/.test(b)&&/hover|float|idle_bob/.test(a))return "bob";
  return null;
 }
 function animationInfo(entries,namespace){
  const list=[];
  for(const e of entries||[]){
   if(!e||!e.path||!e.path.startsWith("assets/"+namespace+"/animations/")||!e.path.endsWith(".json")||!e.content)continue;
   let parsed;try{parsed=JSON.parse(e.content)}catch(_){continue}
   const animations=parsed.animations||parsed;
   if(!animations||typeof animations!=="object")continue;
   for(const [name,anim] of Object.entries(animations)){
    const bones=anim&&anim.bones&&typeof anim.bones==="object"?Object.keys(anim.bones):[];
    const hasTimeline=!!(anim&&anim.bones&&Object.values(anim.bones).some(ch=>ch&&["position","rotation","scale"].some(k=>ch[k]!==undefined)));
    list.push({name,path:e.path,bones,hasTimeline,length:Number(anim&&anim.animation_length)||null,loop:anim&&anim.loop||false});
   }
  }
  return list;
 }
 function convert(entries,namespace){
  const json=parseJsonEntries(entries),report={schema:"jar2zeus.entity-models.v1",geometriesFound:0,entitiesConverted:[],animationsFound:[],animationsMapped:[],animationsUnmapped:[],skipped:[],warnings:[],counts:{converted:0,skipped:0,parts:0,cubes:0,animations:0}},files={},lines=[];
  const animations=animationInfo(entries,namespace);report.animationsFound=animations;
  const animationNames=animations.map(a=>a.name);
  const pngs=(entries||[]).filter(e=>e&&e.path&&e.path.startsWith("assets/"+namespace+"/textures/")&&e.path.endsWith(".png")&&e.bytes instanceof Uint8Array&&(!e.pngInfo||e.pngInfo.valid));
  const usedIds=new Set();
  for(const [path,raw] of json){
   if(!path.startsWith("assets/"+namespace+"/")||!(/\/geo\/|\/models\/entity\//.test(path)||/\.geo\.json$/i.test(path)))continue;
   const geometries=findGeometries(raw);
   if(!geometries.length)continue;
   for(let gi=0;gi<geometries.length;gi++){
    const geometry=geometries[gi],description=geometry.description||{},bones=geometry.bones;
    report.geometriesFound++;
    if(!Array.isArray(bones)||!bones.length){report.skipped.push({path,reason:"geometry has no bones"});continue}
    const identifier=String(description.identifier||"");
    let id=safeName(identifier?identifier.split(/[.:]/).pop():basename(path)+(geometries.length>1?"_"+gi:""));
    if(!SAFE_ID.test(id)||usedIds.has(id)){report.skipped.push({path,reason:"unsafe or duplicate entity id: "+id});continue}
    const textureWidth=Number(description.texture_width||description.textureWidth||64),textureHeight=Number(description.texture_height||description.textureHeight||32);
    if(!Number.isInteger(textureWidth)||!Number.isInteger(textureHeight)||textureWidth<1||textureHeight<1||textureWidth>4096||textureHeight>4096){report.skipped.push({path,id,reason:"invalid texture dimensions"});continue}
    const entityBase=basename(path).replace(/\.geo$/i,"").toLowerCase();
    const textureCandidates=pngs.filter(e=>{
      const p=e.path.toLowerCase();
      const b=basename(p).toLowerCase();
      return (b===entityBase||b===id||p.includes("/textures/entity/"+entityBase+"/")||p.includes("/textures/entity/"+id+"/"));
    });
    if(textureCandidates.length!==1){report.skipped.push({path,id,reason:textureCandidates.length?"ambiguous entity texture candidates":"matching entity PNG texture not found"});continue}
    const texture=textureCandidates[0],targetTexture="textures/"+namespace+"_"+id+"_entity.png";
    const partByName=new Map(),rawParts=[];
    let bad=false;
    for(const bone of bones){
     if(!bone||typeof bone.name!=="string"||!bone.name.trim()||partByName.has(bone.name)){report.skipped.push({path,id,reason:"missing or duplicate bone name"});bad=true;break}
     const part={name:bone.name};
     if(bone.parent!==undefined&&bone.parent!==null&&bone.parent!=="")part.parent=String(bone.parent);
     try{
      if(bone.pivot!==undefined)part.pivot=vec(bone.pivot,3,"bone pivot");
      if(bone.rotation!==undefined)part.rotation=vec(bone.rotation,3,"bone rotation");
      const cubes=[];
      for(const cube of bone.cubes||[]){
       if(!cube||!Array.isArray(cube.origin)||!Array.isArray(cube.size)){throw new Error("cube origin/size missing")}
       const item={origin:vec(cube.origin,3,"cube origin"),size:vec(cube.size,3,"cube size")};
       if(item.size.some(n=>n<=0))throw new Error("cube size must be positive");
       if(Array.isArray(cube.uv))item.uv=vec(cube.uv,2,"cube UV");
       else if(cube.uv&&typeof cube.uv==="object")throw new Error("per-face UV maps cannot be represented by the Zeus cube UV pair");
       else item.uv=[0,0];
       if(cube.mirror===true)item.mirror=true;
       if(cube.inflate!==undefined){if(typeof cube.inflate!=="number"||!Number.isFinite(cube.inflate)||Math.abs(cube.inflate)>16)throw new Error("invalid cube inflate");item.inflate=cube.inflate}
       cubes.push(item);
      }
      if(cubes.length)part.cubes=cubes;
     }catch(error){report.skipped.push({path,id,bone:bone.name,reason:error.message});bad=true;break}
     const motion=classifyMotion(bone.name,animationNames);
     if(motion){part.animation=motion;if(/left|_l$|^l_/.test(bone.name.toLowerCase())&&(motion==="leg"||motion==="arm"||motion==="wing"))part.phase=180;report.animationsMapped.push({entity:id,bone:bone.name,motion});}
     partByName.set(bone.name,part);rawParts.push({bone,part});
    }
    if(bad)continue;
    for(const {bone} of rawParts)if(bone.parent&&!partByName.has(bone.parent)){report.skipped.push({path,id,bone:bone.name,reason:"parent bone is missing: "+bone.parent});bad=true}
    if(bad)continue;
    const ordered=[],visiting=new Set(),visited=new Set();
    function visit(name){
     if(visited.has(name))return;
     if(visiting.has(name))throw new Error("bone parent cycle detected at "+name);
     visiting.add(name);const bone=rawParts.find(x=>x.bone.name===name).bone;
     if(bone.parent)visit(bone.parent);
     visiting.delete(name);visited.add(name);ordered.push(partByName.get(name));
    }
    try{for(const {bone} of rawParts)visit(bone.name)}catch(error){report.skipped.push({path,id,reason:error.message});continue}
    const model={textureWidth,textureHeight,parts:ordered};
    const name=String(description.identifier||id).split(/[.:]/).pop().replace(/[_-]+/g," ");
    const definition={name:name,texture:targetTexture,model:model};
    lines.push("entities.register("+lua(id)+", "+lua(definition)+")");
    files[targetTexture]=texture.bytes;
    usedIds.add(id);
    const partCount=ordered.length,cubeCount=ordered.reduce((n,p)=>n+(p.cubes||[]).length,0);
    report.entitiesConverted.push({id,source:path,texture:targetTexture,parts:partCount,cubes:cubeCount,textureWidth,textureHeight});
    report.counts.parts+=partCount;report.counts.cubes+=cubeCount;
   }
  }
  for(const animation of animations){
   const mapped=report.animationsMapped.some(m=>animation.bones.includes(m.bone));
   if(animation.hasTimeline&&!mapped)report.animationsUnmapped.push({name:animation.name,path:animation.path,bones:animation.bones,reason:"custom keyframe curves cannot be expressed by the documented Zeus built-in part-motion labels"});
   else if(animation.hasTimeline)report.animationsUnmapped.push({name:animation.name,path:animation.path,bones:animation.bones,reason:"only compatible built-in motion labels were mapped; exact keyframe timing and curves are not preserved"});
  }
  report.counts.converted=report.entitiesConverted.length;
  report.counts.skipped=report.skipped.length;
  report.counts.animations=report.animationsMapped.length;
  if(report.animationsUnmapped.length)report.warnings.push("Some source animation timelines were not reproduced exactly; see animationsUnmapped");
  return {lua:lines.join("\n"),files,report};
 }
 root.Jar2ZeusEntityModels={convert};
})(typeof globalThis!=="undefined"?globalThis:this);
