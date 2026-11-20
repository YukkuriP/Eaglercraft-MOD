/* Converts compatible Blockbench/Bedrock-style entity geometry into documented Zeus mob models.
 * Custom keyframe timelines are analyzed and reported; only Zeus built-in part motions are emitted.
 */
(function(root){
 "use strict";
 const BLOCKED=/(?:cannon|artillery|projectile|munition|firearm|weapon|rifle|pistol|musket|sword|bow|crossbow|trident)/i;
 const SAFE_ID=/^[a-z0-9_]{1,48}$/;
 function lua(v){
  if(v===null||v===undefined)return "nil";
  if(typeof v==="string")return '"'+v.replace(/\\/g,"\\\\").replace(/"/g,'\\"').replace(/[\r\n\t]/g,c=>c==="\n"?"\\n":c==="\r"?"\\r":"\\t").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,c=>"\\"+String(c.charCodeAt(0)).padStart(3,"0"))+'"';
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
 function normalizeAnimationTrack(raw){
  if(raw===undefined||raw===null)return {keys:[],error:null};
  if(typeof raw!=="object")return {keys:[],error:"animation channel is not an object"};
  const entries=Array.isArray(raw)?raw.map((value,index)=>[String(index),value]):Object.entries(raw);
  const keys=[];
  for(const [timeText,frame] of entries){
   const time=Number(timeText);
   if(!Number.isFinite(time)||time<0)return {keys:[],error:"invalid animation keyframe time: "+timeText};
   let value=frame,interpolation="linear";
   if(frame&&typeof frame==="object"&&!Array.isArray(frame)){
    interpolation=String(frame.lerp_mode||frame.interpolation||"linear").toLowerCase();
    if(frame.pre!==undefined&&frame.post!==undefined&&JSON.stringify(frame.pre)!==JSON.stringify(frame.post)){
     return {keys:[],error:"keyframe has distinct pre/post values; discontinuous keyframes are not supported"};
    }
    value=frame.post!==undefined?frame.post:(frame.value!==undefined?frame.value:frame.pre);
   }
   if(!Array.isArray(value)||value.length!==3||!value.every(v=>typeof v==="number"&&Number.isFinite(v))){
    return {keys:[],error:"keyframe is not a finite three-number vector"};
   }
   if(interpolation!=="linear"&&interpolation!=="step")return {keys:[],error:"unsupported interpolation: "+interpolation};
   keys.push({time,value:value.slice(),interpolation});
  }
  keys.sort((a,b)=>a.time-b.time);
  for(let i=1;i<keys.length;i++)if(keys[i].time===keys[i-1].time)return {keys:[],error:"duplicate keyframe time"};
  return {keys,error:null};
 }
 function animationInfo(entries,namespace){
  const list=[];
  for(const e of entries||[]){
   if(!e||!e.path||!e.path.startsWith("assets/"+namespace+"/animations/")||!e.path.endsWith(".json")||!e.content)continue;
   let parsed;try{parsed=JSON.parse(e.content)}catch(_){continue}
   const animations=parsed.animations||parsed;
   if(!animations||typeof animations!=="object")continue;
   for(const [name,anim] of Object.entries(animations)){
    const rawTracks=anim&&anim.bones&&typeof anim.bones==="object"?anim.bones:{};
    const boneTracks={},tracks={},trackErrors=[];
    for(const [bone,channels] of Object.entries(rawTracks)){
     const raw=channels&&typeof channels==="object"?channels:{},normalized={};
     for(const channel of ["position","rotation","scale"]){
      if(raw[channel]===undefined)continue;
      const result=normalizeAnimationTrack(raw[channel]);
      if(result.error)trackErrors.push({bone,channel,reason:result.error});
      else if(result.keys.length)normalized[channel]=result.keys;
     }
     const sourceChannels=["position","rotation","scale"].filter(key=>raw[key]!==undefined);
     const channelNames=Object.keys(normalized);
     tracks[bone]=normalized;
     boneTracks[bone]={channels:sourceChannels,supportedChannels:channelNames,hasPosition:sourceChannels.includes("position"),hasRotation:sourceChannels.includes("rotation"),hasScale:sourceChannels.includes("scale")};
    }
    const bones=Object.keys(boneTracks),hasTimeline=Object.values(boneTracks).some(track=>track.channels.length>0);
    const rawLoop=anim&&anim.loop!==undefined?anim.loop:false;
    const loop=rawLoop===true||rawLoop==="loop";
    const pingPong=rawLoop==="pingpong"||rawLoop==="ping_pong"||!!(anim&&anim.ping_pong===true);
    const maxTime=Object.values(tracks).flatMap(ch=>Object.values(ch).flatMap(keys=>keys.map(k=>k.time))).reduce((a,b)=>Math.max(a,b),0);
    const declaredLength=Number(anim&&anim.animation_length);
    list.push({name,path:e.path,bones,boneTracks,tracks,trackErrors,hasTimeline,length:Number.isFinite(declaredLength)&&declaredLength>0?declaredLength:maxTime,loop:rawLoop,looping:loop||pingPong,pingPong});
   }
  }
  return list;
 }
 function uniqueChannels(animationNames,records,bone){
  const set=new Set();
  for(const record of records||[]){
   if(!animationNames.includes(record.name)||!record.tracks||!record.tracks[bone])continue;
   for(const channel of Object.keys(record.tracks[bone]))set.add(channel);
  }
  return Array.from(set).sort();
 }
 function machineKind(name){
  const n=String(name||"").toLowerCase();
  if(/gear|cog|wheel|rotor|propeller|fan|shaft|axle|turbine|flywheel|roller|crankshaft/.test(n))return "rotary";
  if(/piston|plunger|slider|actuator|ram|conveyor|belt|chain|lift|elevator|hinge|door|valve|lever|gate|crank|pump_arm/.test(n))return "mechanical";
  return null;
 }
 function classifyMachineMotion(boneName,records){
  const kind=machineKind(boneName);
  if(!kind)return null;
  const sourceRelated=(records||[]).filter(record=>record.boneTracks&&record.boneTracks[boneName]&&record.boneTracks[boneName].channels.length);
  if(!sourceRelated.length)return null;
  const related=sourceRelated.filter(record=>(record.boneTracks[boneName].supportedChannels||record.boneTracks[boneName].channels).length>0);
  if(!related.length)return {kind,animation:null,sourceAnimations:sourceRelated.map(record=>record.name),reason:"all source keyframes for this part use unsupported values or interpolation"};
  const hasRotation=related.some(record=>(record.boneTracks[boneName].supportedChannels||record.boneTracks[boneName].channels).includes("rotation"));
  const hasPosition=related.some(record=>(record.boneTracks[boneName].supportedChannels||record.boneTracks[boneName].channels).includes("position"));
  const loopingRotations=related.filter(record=>record.looping&&(record.boneTracks[boneName].supportedChannels||record.boneTracks[boneName].channels).includes("rotation"));
  if(kind==="rotary"&&loopingRotations.length){
   return {kind:"rotary",animation:"spin",sourceAnimations:loopingRotations.map(record=>record.name),approximate:true};
  }
  let reason;
  if(kind==="rotary"&&hasRotation)reason="rotating machine part is animated, but its source timeline is not a continuous loop; Zeus spin cannot preserve one-shot timing or keyframes";
  else if(hasPosition)reason="linear machine movement (piston, slider, belt or conveyor travel) needs per-keyframe translation, which the documented Zeus part-motion labels do not provide";
  else if(hasRotation)reason="limited-angle or keyed mechanical rotation (such as a hinge, valve or lever) cannot be represented by continuous Zeus spin";
  else reason="the source animation channel is not supported by the documented Zeus part-motion labels";
  return {kind,animation:null,sourceAnimations:related.map(record=>record.name),reason,hasPosition,hasRotation};
 }
 function machineAssetCandidates(entries,namespace){
  const pattern=/(?:gear|cog|wheel|rotor|propeller|fan|shaft|axle|turbine|flywheel|roller|crank|piston|plunger|slider|actuator|conveyor|belt|chain|lift|elevator|hinge|door|valve|lever|gate|pump|motor|engine|generator|kinetic|mechanical)/i;
  return (entries||[]).filter(e=>e&&typeof e.path==="string"&&e.path.startsWith("assets/"+namespace+"/")&&(e.path.includes("/models/block/")||e.path.includes("/blockstates/"))&&pattern.test(e.path)).map(e=>({
   path:e.path,
   status:"static_model_only",
   reason:"the source asset looks like a machine component, but Zeus block models are static; Java block-entity ticking/rendering and per-frame block animation are not converted"
  }));
 }
 function convert(entries,namespace){
  const json=parseJsonEntries(entries),report={schema:"jar2zeus.entity-models.v1",geometriesFound:0,entitiesConverted:[],animationsFound:[],animationsMapped:[],animationsUnmapped:[],machineAnimationsMapped:[],machineAnimationsUnmapped:[],machineAssetsUnmapped:[],machineTypesGenerated:[],geometryUnmapped:[],skipped:[],warnings:[],counts:{converted:0,skipped:0,parts:0,cubes:0,animations:0,machineMapped:0,machineUnmapped:0,machineAssets:0,machineTypes:0,geometryUnmapped:0}},files={},lines=[],machineTypes=[],machineLua=[];
  const animations=animationInfo(entries,namespace);report.animationsFound=animations;
  const animationNames=animations.map(a=>a.name);
  report.machineAssetsUnmapped=machineAssetCandidates(entries,namespace);
  report.counts.machineAssets=report.machineAssetsUnmapped.length;
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
    const entityAnimations=animations.filter(a=>basename(a.path).toLowerCase()===entityBase);
    const entityAnimationNames=entityAnimations.map(a=>a.name);
    const textureCandidates=pngs.filter(e=>{
      const p=e.path.toLowerCase();
      const b=p.split("/").pop().replace(/\.png$/i,"").toLowerCase();
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
       if(cube.rotation!==undefined){
        const cubeRotation=vec(cube.rotation,3,"cube rotation");
        if(cubeRotation.some(value=>Math.abs(value)>3600))throw new Error("cube rotation exceeds supported bounds");
       }
       if(cube.pivot!==undefined)vec(cube.pivot,3,"cube pivot");
       if(Array.isArray(cube.uv))item.uv=vec(cube.uv,2,"cube UV");
       else if(cube.uv&&typeof cube.uv==="object")throw new Error("per-face UV maps cannot be represented by the Zeus cube UV pair");
       else item.uv=[0,0];
       if(cube.mirror===true)item.mirror=true;
       if(cube.inflate!==undefined){if(typeof cube.inflate!=="number"||!Number.isFinite(cube.inflate)||Math.abs(cube.inflate)>16)throw new Error("invalid cube inflate");item.inflate=cube.inflate}
       cubes.push(item);
      }
      if(cubes.length)part.cubes=cubes;
     }catch(error){report.skipped.push({path,id,bone:bone.name,reason:error.message});bad=true;break}
     const machineMotion=classifyMachineMotion(bone.name,entityAnimations);
     const hasRuntimeTrack=!!(machineKind(bone.name)&&entityAnimations.some(animation=>
      animation.boneTracks&&animation.boneTracks[bone.name]&&(animation.boneTracks[bone.name].supportedChannels||[]).length>0
     ));
     const motion=hasRuntimeTrack?null:(machineMotion?(machineMotion.animation||null):(machineKind(bone.name)?null:classifyMotion(bone.name,entityAnimationNames)));
     if(motion){
      part.animation=motion;
      if(/left|_l$|^l_/.test(bone.name.toLowerCase())&&(motion==="leg"||motion==="arm"||motion==="wing"))part.phase=180;
      report.animationsMapped.push({entity:id,bone:bone.name,motion});
      if(machineMotion&&machineMotion.animation){
       report.machineAnimationsMapped.push({entity:id,bone:bone.name,motion:"spin",sourceAnimations:machineMotion.sourceAnimations,approximate:true,limitations:["uses continuous built-in spin","source keyframe timing and exact rotation curve are not preserved"]});
      }
     }
     if(machineMotion&&!machineMotion.animation&&!hasRuntimeTrack){
      report.machineAnimationsUnmapped.push({entity:id,bone:bone.name,kind:machineMotion.kind,sourceAnimations:machineMotion.sourceAnimations,reason:machineMotion.reason});
     }
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

    const machineBoneNames=ordered.filter(part=>machineKind(part.name));
    const runtimeAnimations={};
    for(const animation of entityAnimations){
     const runtimeBones={};
     for(const [bone,channels] of Object.entries(animation.tracks||{})){
      const normalized={};
      for(const channel of ["position","rotation","scale"]){
       if(Array.isArray(channels[channel])&&channels[channel].length)normalized[channel]=channels[channel];
      }
      if(Object.keys(normalized).length)runtimeBones[bone]=normalized;
     }
     if(Object.keys(runtimeBones).length){
      runtimeAnimations[animation.name]={
       duration:animation.length||0,
       loop:animation.loop===true||animation.loop==="loop",
       pingPong:animation.pingPong===true,
       bones:runtimeBones
      };
     }
     for(const error of animation.trackErrors||[]){
      if(machineBoneNames.some(part=>part.name===error.bone)){
       report.machineAnimationsUnmapped.push({entity:id,bone:error.bone,animation:animation.name,channel:error.channel,reason:error.reason});
      }
     }
    }
    const animatedMachineBones=machineBoneNames.filter(part=>entityAnimations.some(animation=>
     animation.boneTracks&&animation.boneTracks[part.name]&&(animation.boneTracks[part.name].supportedChannels||[]).length>0
    ));
    if(animatedMachineBones.length&&Object.keys(runtimeAnimations).length){
     const runtimeModel={
      textureWidth:textureWidth,textureHeight:textureHeight,
      parts:ordered.map(part=>{
       const value={name:part.name};
       if(part.parent)value.parent=part.parent;
       if(part.pivot)value.pivot=part.pivot;
       if(part.rotation)value.rotation=part.rotation;
       value.color=[0.68,0.72,0.78];
       const sourceBone=rawParts.find(entry=>entry.bone.name===part.name);
       const sourceCubes=sourceBone&&Array.isArray(sourceBone.bone.cubes)?sourceBone.bone.cubes:[];
       value.cubes=(part.cubes||[]).map((cube,index)=>{
        const sourceCube=sourceCubes[index]||{};
        const item={origin:cube.origin,size:cube.size,color:[0.68,0.72,0.78]};
        if(Array.isArray(cube.uv))item.uv=cube.uv.slice();
        if(cube.mirror===true)item.mirror=true;
        if(cube.inflate!==undefined)item.inflate=cube.inflate;
        if(sourceCube.rotation!==undefined)item.rotation=vec(sourceCube.rotation,3,"runtime cube rotation");
        if(sourceCube.pivot!==undefined)item.pivot=vec(sourceCube.pivot,3,"runtime cube pivot");
        return item;
       });
       return value;
      })
     };
     const defaultAnimation=Object.keys(runtimeAnimations)[0]||null;
     const machineType={id,model:runtimeModel,texture:targetTexture,textureWidth:textureWidth,textureHeight:textureHeight,animations:runtimeAnimations,defaultAnimation};
     machineTypes.push(machineType);
     machineLua.push("__j2z_machine_runtime:registerType("+lua(id)+", "+lua(machineType)+")");
     for(const part of animatedMachineBones){
      const animationNames=entityAnimations.filter(animation=>animation.boneTracks[part.name]&&(animation.boneTracks[part.name].supportedChannels||[]).length).map(animation=>animation.name);
      report.machineAnimationsMapped.push({entity:id,bone:part.name,animations:animationNames,backend:"lua-machine-runtime",channels:uniqueChannels(animationNames,entityAnimations,part.name)});
     }
     report.machineTypesGenerated.push({id,source:path,parts:runtimeModel.parts.length,animations:Object.keys(runtimeAnimations),animatedMachineParts:animatedMachineBones.map(part=>part.name),note:"Rendered as an independent local virtual machine; not a vanilla block entity"});
    }else{
     for(const {bone} of rawParts){
      if((bone.cubes||[]).some(cube=>Array.isArray(cube.rotation)&&cube.rotation.some(value=>Math.abs(value)>1e-7))){
       report.geometryUnmapped.push({entity:id,bone:bone.name,reason:"cube-level rotation is not represented by the documented native Zeus entity model; no Lua machine runtime was generated for this geometry"});
      }
     }
    }
    files[targetTexture]=texture.bytes;
    usedIds.add(id);
    const partCount=ordered.length,cubeCount=ordered.reduce((n,p)=>n+(p.cubes||[]).length,0);
    report.entitiesConverted.push({id,source:path,texture:targetTexture,parts:partCount,cubes:cubeCount,textureWidth,textureHeight});
    report.counts.parts+=partCount;report.counts.cubes+=cubeCount;
   }
  }
  for(const animation of animations){
   const runtimeMapped=machineTypes.some(type=>!!(type.animations&&type.animations[animation.name]));
   const mapped=report.animationsMapped.some(m=>animation.bones.includes(m.bone));
   if(runtimeMapped&&!(animation.trackErrors||[]).length)continue;
   if(animation.hasTimeline&&!mapped&&!runtimeMapped)report.animationsUnmapped.push({name:animation.name,path:animation.path,bones:animation.bones,reason:"custom keyframe curves cannot be expressed by the documented Zeus built-in part-motion labels or the Lua runtime"});
   else if(animation.hasTimeline&&(mapped||runtimeMapped))report.animationsUnmapped.push({name:animation.name,path:animation.path,bones:animation.bones,reason:(animation.trackErrors||[]).length?"some keyframe channels use unsupported values or interpolation; see trackErrors":"only compatible built-in motions were mapped; exact keyframe timing and curves are not preserved"});
  }
  report.counts.converted=report.entitiesConverted.length;
  report.counts.skipped=report.skipped.length;
  report.counts.animations=report.animationsMapped.length;
  report.counts.machineMapped=report.machineAnimationsMapped.length;
  report.counts.machineUnmapped=report.machineAnimationsUnmapped.length;
  report.counts.machineTypes=machineTypes.length;
  report.counts.geometryUnmapped=report.geometryUnmapped.length;
  if(report.animationsUnmapped.length)report.warnings.push("Some source animation timelines were not reproduced exactly; see animationsUnmapped");
  if(report.machineAnimationsMapped.length)report.warnings.push("Some looping rotary machine parts were approximated with Zeus spin; exact source timing and curves are not preserved");
  if(report.machineAnimationsUnmapped.length)report.warnings.push("Some mechanical movements (for example pistons, conveyors and hinged parts) remain unmapped; see machineAnimationsUnmapped");
  if(report.machineAssetsUnmapped.length)report.warnings.push("Machine-like block model assets remain static because the documented Zeus block definition API does not expose animated block-entity rendering; see machineAssetsUnmapped");
  if(report.geometryUnmapped.length)report.warnings.push("Some cube-level static geometry rotations could not be represented by native Zeus entity models; see geometryUnmapped");
  if(machineTypes.length){
   machineLua.unshift("local __j2z_machine_runtime = require(\"lib.jar2zeus.machine_runtime\").new({storageKey=\"jar2zeus_machine_runtime\"})");
   machineLua.push("__j2z_machine_runtime:start()");
   report.warnings.push("Rigged machine models are rendered as local virtual 3D machines by the bundled Lua runtime; they are not native Minecraft block entities or server-synchronized blocks");
  }
  return {lua:[lines.join("\n"),machineLua.join("\n")].filter(Boolean).join("\n\n"),files,report,machineTypes,machineRuntimeRequired:machineTypes.length>0};
 }
 root.Jar2ZeusEntityModels={convert};
})(typeof globalThis!=="undefined"?globalThis:this);
