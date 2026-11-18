/* Compare safe JAR resources with resources already embedded in an Eaglercraft EPW/EPK client.
 * This is an inventory comparison only; new entries are not inserted into the target game.
 */
(function(root){
 "use strict";
 const RESTRICTED_PATH=/(?:cannon|artillery|projectile|munition|firearm|weapon|rifle|pistol|musket|sword|bow|crossbow|trident)/i;
 const MAX_HASH_BYTES=64*1024*1024;
 function safePath(path){return typeof path==="string"&&!path.startsWith("/")&&!path.includes("\\")&&!path.split("/").some(x=>!x||x==="."||x==="..")}
 function namespaceOf(path){
  const m=String(path||"").match(/^(?:assets|data)\/([^/]+)\//);
  return m?m[1]:null;
 }
 function classify(path){
  const p=String(path||"").toLowerCase();
  if(/\/textures\/.*\.(png|jpe?g|webp)$/i.test(p))return "textures";
  if(/\/models\/|\/(block|item)\//i.test(p)||/\.(obj|mtl|ie)$/i.test(p))return "models";
  if(/\/blockstates\/.*\.json$/i.test(p))return "blockstates";
  if(/\/recipes?\/.*\.json$/i.test(p))return "recipes";
  if(/\/lang\/.*\.(lang|json)$/i.test(p))return "language";
  if(/\/sounds?\/|sounds\.json$|\.ogg$/i.test(p))return "sounds";
  if(/\/shaders?\//i.test(p))return "shaders";
  if(/\/tags?\//i.test(p))return "tags";
  return "other";
 }
 function makeTargetIndex(analysis){
  const files=new Map();
  for(const pack of analysis&&analysis.epk||[]){
   if(!pack||!pack.valid||!Array.isArray(pack.files))continue;
   for(const file of pack.files){
    if(!file||!file.safe||!file.path)continue;
    if(!files.has(file.path))files.set(file.path,[]);
    files.get(file.path).push(file);
   }
  }
  return files;
 }
 async function compareJarZip(jarZip,targetAnalysis){
  const base={
   schema:"jar2zeus.resource-compatibility.v1",
   status:"unavailable",
   counts:{sourceResources:0,targetResources:0,exactMatches:0,conflicts:0,newPaths:0,excludedRestricted:0,unhashedLargeFiles:0,ambiguousTargetPaths:0,unsafeSourcePaths:0},
   namespaces:{source:[],target:[],shared:[]},
   exactMatches:[],conflicts:[],newPaths:[],warnings:[]
  };
  if(!jarZip||!jarZip.files){base.warnings.push("JAR archive is unavailable");return base}
  if(!targetAnalysis||targetAnalysis.deepAnalysis?.status!=="complete"||!Array.isArray(targetAnalysis.epk)||targetAnalysis.epk.length===0||targetAnalysis.epk.some(x=>!x.valid)){
   base.warnings.push("Target EPW/EPK inventory is incomplete; resource matching was not guessed");
   return base;
  }
  const targetMap=makeTargetIndex(targetAnalysis);
  const targetNamespaces=new Set();
  for(const path of targetMap.keys()){const ns=namespaceOf(path);if(ns)targetNamespaces.add(ns)}
  const sourceNamespaces=new Set(),seenSource=new Set(),counts={};
  const names=Object.keys(jarZip.files);
  for(const path of names){
   const entry=jarZip.files[path];
   if(!entry||entry.dir||!(/^(assets|data)\//.test(path)))continue;
   if(!safePath(path)){base.counts.unsafeSourcePaths++;continue}
   if(RESTRICTED_PATH.test(path)){base.counts.excludedRestricted++;continue}
   if(seenSource.has(path))continue;
   seenSource.add(path);
   base.counts.sourceResources++;
   const ns=namespaceOf(path);if(ns)sourceNamespaces.add(ns);
   const category=classify(path);counts[category]=(counts[category]||0)+1;
   const targetCandidates=targetMap.get(path);
   if(!targetCandidates){
    base.counts.newPaths++;
    if(base.newPaths.length<300)base.newPaths.push({path,category,sourceSize:entry._data&&entry._data.uncompressedSize||null});
    continue;
   }
   if(targetCandidates.length!==1){
    base.counts.ambiguousTargetPaths++;
    if(base.conflicts.length<300)base.conflicts.push({path,category,reason:"duplicate target path entries",targetCopies:targetCandidates.length});
    continue;
   }
   const target=targetCandidates[0];
   let bytes;
   try{bytes=await entry.async("uint8array")}catch(e){
    base.warnings.push("Could not read source resource: "+path);
    continue;
   }
   if(bytes.byteLength>MAX_HASH_BYTES){
    base.counts.unhashedLargeFiles++;
    continue;
   }
   const sourceCrc=root.Jar2ZeusTargetInspector&&root.Jar2ZeusTargetInspector.crc32
    ?root.Jar2ZeusTargetInspector.crc32(bytes):null;
   const identical=sourceCrc!==null&&target.crcValid===true&&bytes.byteLength===target.size&&sourceCrc===target.crc32;
   if(identical){
    base.counts.exactMatches++;
    if(base.exactMatches.length<300)base.exactMatches.push({path,category,size:bytes.byteLength,crc32:sourceCrc});
   }else{
    base.counts.conflicts++;
    if(base.conflicts.length<300)base.conflicts.push({path,category,sourceSize:bytes.byteLength,targetSize:target.size,sourceCrc32:sourceCrc,targetCrc32:target.crc32,reason:target.crcValid===true?"same path but content differs":"target checksum is not verified"});
   }
  }
  base.counts.targetResources=targetMap.size;
  base.categoryCounts=counts;
  base.namespaces={
   source:Array.from(sourceNamespaces).sort(),
   target:Array.from(targetNamespaces).sort(),
   shared:Array.from(sourceNamespaces).filter(x=>targetNamespaces.has(x)).sort()
  };
  base.newPathsTruncated=Math.max(0,base.counts.newPaths-base.newPaths.length);
  base.conflictsTruncated=Math.max(0,base.counts.conflicts-base.conflicts.length);
  base.exactMatchesTruncated=Math.max(0,base.counts.exactMatches-base.exactMatches.length);
  base.status="complete";
  if(base.counts.unhashedLargeFiles)base.warnings.push("Some source resources exceeded the per-file hashing limit");
  return base;
 }
 root.Jar2ZeusResourceCompatibility={compareJarZip,namespaceOf,classify};
})(typeof globalThis!=="undefined"?globalThis:this);
