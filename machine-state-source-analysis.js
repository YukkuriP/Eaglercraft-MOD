/* Maps machine telemetry field hints to statically visible Java getter candidates.
 * No Java method is executed and no Lua-to-Java bridge is implied.
 */
(function(root){
"use strict";
const BLOCKED=/(?:cannon|artillery|projectile|munition|firearm|weapon|rifle|pistol|musket|sword|bow|crossbow|trident)/i;
const MAX_CLASSES=1000,MAX_FIELDS=3000,MAX_GETTERS=3000,MAX_READS=6000;
const METRIC_KEYS={
 "processing.progress":"progress",
 "processing.progress_max":"progress_max",
 "processing.duration":"duration",
 "processing.active":"active",
 "energy.stored":"energy",
 "energy.capacity":"energy_max",
 "energy.rate":"energy_usage",
 "thermal.temperature":"temperature",
 "thermal.pressure":"pressure",
 "fluid.amount":"fluid_amount",
 "fluid.capacity":"fluid_capacity",
 "fluid.state":"fluid",
 "fuel.remaining":"fuel_remaining",
 "fuel.capacity":"fuel_capacity",
 "machine.status":"status",
 "kinetic.speed":"kinetic_speed",
 "kinetic.stress":"kinetic_stress"
};
const KEY_KINDS={
 progress:"number",progress_max:"number",duration:"number",active:"boolean",
 energy:"number",energy_max:"number",energy_usage:"number",
 temperature:"number",pressure:"number",fluid:"string",fluid_amount:"number",
 fluid_capacity:"number",fuel:"string",fuel_remaining:"number",fuel_capacity:"number",
 working:"boolean",status:"string",kinetic_speed:"number",kinetic_stress:"number"
};
function arr(v){return Array.isArray(v)?v:[];}
function safe(v){return typeof v==="string"&&!BLOCKED.test(v);}
function clean(v,max){return String(v==null?"":v).replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim().slice(0,max||180);}
function norm(v){return String(v||"").replace(/\./g,"/").replace(/^L|;$/g,"");}
function inferMetric(value){
 const n=String(value||"").replace(/^.*[/:.]/,"").replace(/[^a-zA-Z0-9]+/g,"_").toLowerCase();
 if(/(?:fuel|burn)/.test(n))return /(?:max|capacity)/.test(n)?"fuel.capacity":"fuel.remaining";
 if(/(?:energy|power|rf|joule|fe|charge)/.test(n))return /(?:capacity|max)/.test(n)?"energy.capacity":/(?:usage|consumption|production|rate)/.test(n)?"energy.rate":"energy.stored";
 if(/(?:temperature|temp|heat)/.test(n))return "thermal.temperature";
 if(/pressure/.test(n))return "thermal.pressure";
 if(/(?:fluid|tank)/.test(n))return /(?:capacity|max)/.test(n)?"fluid.capacity":/(?:amount|quantity|stored|level)/.test(n)?"fluid.amount":"fluid.state";
 if(/(?:maxprogress|maxcooktime|progressmax)/.test(n))return "processing.progress_max";
 if(/(?:progress|cooktime|workdone|workprogress)/.test(n))return "processing.progress";
 if(/(?:duration|processtime|processingtime|ticktime|totaltime|worktime)/.test(n))return "processing.duration";
 if(/(?:active|working|running|processing|enabled)/.test(n))return "processing.active";
 if(/(?:speed|rpm|rotation)/.test(n))return "kinetic.speed";
 if(/(?:stress|torque)/.test(n))return "kinetic.stress";
 if(/(?:status|state|mode)/.test(n))return "machine.status";
 return null;
}
function parseNoArgReturn(desc){
 if(typeof desc!=="string")return null;
 const m=/^\(\)(Z|B|C|S|I|J|F|D|Ljava\/lang\/String;)$/.exec(desc);
 if(!m)return null;
 const d=m[1];
 return {descriptor:d,kind:d==="Z"?"boolean":d==="Ljava/lang/String;"?"string":"number"};
}
function getterName(name){
 return typeof name==="string"&&(/^(?:get|is|has)[A-Z0-9_]/.test(name)||/^(?:get|is|has)_/.test(name));
}
function visibility(flags){
 const value=Number(flags)||0;
 if(value&0x0001)return "public";
 if(value&0x0004)return "protected";
 if(value&0x0002)return "private";
 return "package";
}
function expectedKind(metric){
 const key=METRIC_KEYS[metric];
 return key?KEY_KINDS[key]||null:null;
}
function fieldReadEvidence(method){
 const out=[];
 for(const ins of arr(method&&method.code&&method.code.instructions)){
  if(!ins||ins.name!=="getfield"||!ins.member)continue;
  const member=ins.member;
  if(member.kind!=="field"||!safe(member.owner)||!safe(member.name)||!safe(member.descriptor||""))continue;
  out.push({owner:norm(member.owner),name:member.name,descriptor:member.descriptor||null,pc:Number.isInteger(ins.pc)?ins.pc:null,operation:"getfield"});
  if(out.length>=MAX_READS)break;
 }
 return out;
}
function analyze(input,options){
 input=input&&typeof input==="object"?input:{};
 options=options&&typeof options==="object"?options:{};
 const limit=Number.isInteger(options.detailLimit)&&options.detailLimit>0?Math.min(options.detailLimit,MAX_GETTERS):MAX_GETTERS;
 const classes=arr(input.classes);
 const state=input.stateBridge||{};
 const rawFields=arr(state.fieldCandidates);
 const fieldMap=new Map(),metricSet=new Set(),machineClassSet=new Set();
 let eligibleFieldsSeen=0;
 for(const row of rawFields){
  if(!row||!safe(row.sourceClass)||!safe(row.fieldName)||!safe(row.descriptor||""))continue;
  if(row.source==="gui-control")continue;
  const metric=METRIC_KEYS[row.metric]?row.metric:inferMetric(row.fieldName);
  if(!metric||!METRIC_KEYS[metric])continue;
  const kind=expectedKind(metric);
  const descriptorKind=parseNoArgReturn("()"+String(row.descriptor||""));
  const fieldKind=descriptorKind?descriptorKind.kind:null;
  const key=norm(row.sourceClass);
  if(!fieldMap.has(key))fieldMap.set(key,[]);
  fieldMap.get(key).push({
   sourceClass:key,sourcePath:safe(row.sourcePath||"")?row.sourcePath:null,
   fieldName:row.fieldName,fieldDescriptor:row.descriptor||null,
   metric:metric,providerKey:METRIC_KEYS[metric],expectedKind:kind,
   fieldKind:fieldKind,fieldTypeCompatible:fieldKind===null||fieldKind===kind,
   evidenceSource:row.source||"state-bridge-field-hint"
  });
  metricSet.add(metric);machineClassSet.add(key);eligibleFieldsSeen++;
 }
 for(const row of arr(state.machineClasses))if(row&&safe(row.className))machineClassSet.add(norm(row.className));
 for(const row of arr(input.blockEntityMachineState&&input.blockEntityMachineState.blockEntities))if(row&&row.machineLike===true&&safe(row.className))machineClassSet.add(norm(row.className));
 for(const row of arr(input.machinePowerSystems&&input.machinePowerSystems.systems))if(row&&safe(row.className))machineClassSet.add(norm(row.className));
 for(const row of arr(input.machineProcessAnalysis&&input.machineProcessAnalysis.machineClasses))if(row&&safe(row.className))machineClassSet.add(norm(row.className));
 const limitedClasses=Array.from(machineClassSet).slice(0,MAX_CLASSES);
 const classInfoMap=new Map();
 for(const entry of classes){
  const info=entry&&entry.classInfo?entry.classInfo:entry;
  if(!info||info.valid!==true||typeof info.className!=="string")continue;
  const name=norm(info.className),path=entry&&typeof entry.path==="string"?entry.path:name+".class";
  if(!safe(name)||!safe(path))continue;
  classInfoMap.set(name,{info,path});
 }
 const getters=[],unmapped=[],metricSummary=[];
 let gettersSeen=0,signatureCandidates=0,verifiedCandidates=0,directReadLinks=0,methodsSkipped=0,methodsWithDecodeErrors=0;
 for(const className of limitedClasses){
  const holder=classInfoMap.get(className);
  if(!holder)continue;
  const fields=fieldMap.get(className)||[];
  if(!fields.length)continue;
  const classInfo=holder.info;
  const sourceFields=classInfo.fields||[];
  const sourceFieldMap=new Map(sourceFields.filter(f=>f&&safe(f.name)).map(f=>[f.name,f]));
  for(const method of arr(classInfo.methods)){
   if(!method||!safe(method.name)||BLOCKED.test(method.name))continue;
   if(!getterName(method.name))continue;
   const signature=parseNoArgReturn(method.descriptor);
   if(!signature)continue;
   signatureCandidates++;
   const flags=Number(method.accessFlags)||0;
   const access=visibility(flags);
   const instance=!(flags&0x0008);
   const visible=access==="public"||access==="protected";
   const synthetic=!!(flags&0x1000)||!!(flags&0x0040);
   const reads=fieldReadEvidence(method);
   const metricFromMethod=inferMetric(method.name);
   const matchedFields=[];
   for(const field of fields){
    const sameMetric=metricFromMethod===field.metric;
    const exactRead=reads.some(read=>read.owner===className&&read.name===field.fieldName&&(!read.descriptor||!field.fieldDescriptor||read.descriptor===field.fieldDescriptor));
    if(!sameMetric&&!exactRead)continue;
    const actualField=sourceFieldMap.get(field.fieldName);
    const actualDescriptor=actualField&&actualField.descriptor||field.fieldDescriptor;
    const actualKind=parseNoArgReturn("()"+String(actualDescriptor||""));
    const returnTypeCompatible=signature.kind===field.expectedKind&&(!actualKind||actualKind.kind===signature.kind);
    if(!returnTypeCompatible)continue;
    matchedFields.push({
     fieldName:field.fieldName,fieldDescriptor:actualDescriptor||null,
     metric:field.metric,providerKey:field.providerKey,
     exactGetFieldRead:exactRead,methodNameMetricMatch:sameMetric,
     evidence:exactRead?"GETFIELD references the candidate field and return type matches the telemetry metric": "Getter name and return type match the statically inferred telemetry metric"
    });
   }
   if(!matchedFields.length)continue;
   gettersSeen++;
   const code=method.code||null;
   const decoded=!!(code&&Array.isArray(code.instructions)&&!code.decodeError);
   const verificationValid=!!(code&&code.verification&&code.verification.valid===true);
   if(code&&code.decodeError)methodsWithDecodeErrors++;
   if(verificationValid)verifiedCandidates++;
   if(reads.length)directReadLinks+=matchedFields.filter(m=>m.exactGetFieldRead).length;
   const uniqueMetrics=Array.from(new Set(matchedFields.map(m=>m.metric)));
   const reason=matchedFields.some(m=>m.exactGetFieldRead)?"matching GETFIELD evidence and return signature":"matching getter name and return signature";
   const row={
    sourcePath:holder.path,sourceClass:className,
    methodName:method.name,methodDescriptor:method.descriptor,
    accessFlags:flags,visibility:access,instanceMethod:instance,
    staticMethod:!instance,syntheticOrBridge:synthetic,
    returnDescriptor:signature.descriptor,returnKind:signature.kind,
    getterMetric:metricFromMethod,
    fieldMatches:matchedFields.slice(0,12),
    fieldReadEvidence:reads.slice(0,24),
    evidenceReason:reason,
    bytecodeDecoded:decoded,
    structuralVerificationValid:verificationValid,
    sourceMethodExecutableFromZeusLua:false,
    requiresSourceOwnedAdapter:true,
    candidateStatus:verificationValid?"structurally-verified-getter-candidate":decoded?"decoded-unverified-getter-candidate":"signature-only-getter-candidate"
   };
   if(!visible||!instance||synthetic)row.requiresManualReview=true;
   if(row.requiresManualReview||!verificationValid)row.confidence="low";
   else if(matchedFields.some(m=>m.exactGetFieldRead))row.confidence="high";
   else row.confidence="medium";
   if(getters.length<limit)getters.push(row);
  }
 }
 const mappedMetrics=new Set(getters.flatMap(row=>row.fieldMatches.map(field=>field.metric)));
 for(const metric of Array.from(metricSet).sort()){
  metricSummary.push({
   metric,providerKey:METRIC_KEYS[metric],
   fieldCandidates:(rawFields.filter(row=>row&&row.metric===metric&&row.source!=="gui-control")).length,
   getterCandidates:getters.filter(row=>row.fieldMatches.some(field=>field.metric===metric)).length,
   mappedToGetter:mappedMetrics.has(metric)
  });
  if(!mappedMetrics.has(metric))unmapped.push(metric);
 }
 const report={
  schema:"jar2zeus.machine-state-source-analysis.v1",
  status:gettersSeen?"static-getter-evidence-found":eligibleFieldsSeen?"machine-fields-without-getter-evidence":"no-machine-getter-evidence",
  supportStatus:"static-source-method-worklist-only",
  target:{runtime:"JVM bytecode inspection",output:"manual Zeus source adapter plan"},
  machineClasses:limitedClasses,
  fieldCandidates:rawFields.filter(row=>row&&row.source!=="gui-control"&&METRIC_KEYS[row.metric]).slice(0,MAX_FIELDS).map(row=>({
   sourceClass:row.sourceClass,sourcePath:safe(row.sourcePath||"")?row.sourcePath:null,
   fieldName:row.fieldName,fieldDescriptor:row.descriptor||null,metric:row.metric,
   providerKey:METRIC_KEYS[row.metric],evidenceSource:row.source||null
  })),
  getterCandidates:getters,
  metricSummary:metricSummary,
  metricsWithoutGetterEvidence:unmapped,
  manualTasks:[
   {area:"getter-confirmation",status:gettersSeen?"manual-review-required":"not-observed",reason:"Candidate methods are inferred from names, descriptors and optional GETFIELD references. Review the actual Java logic and units before using any candidate."},
   {area:"source-owned-reader",status:"not-generated",reason:"Java getters are not callable from Zeus Lua. Implement a source-side adapter in the MOD that owns the Java object, then pass genuine values to the Phase 24 publisher."},
   {area:"runtime-and-sync",status:"not-generated",reason:"Confirm server/client authority, update timing, persistence and units in the actual target MOD before publishing telemetry."}
  ],
  limitations:[
   "This module reads parsed class metadata and decoded JVM instructions only; it never executes Java methods.",
   "A getter name or GETFIELD instruction does not prove the method returns the raw field value; calculations, unit scaling, clamping or side effects may exist.",
   "The candidate method is not callable from Zeus Lua and no Java-to-Lua object bridge is generated.",
   "Only no-argument primitive or java.lang.String getter signatures are considered; object, enum, collection and array return types are excluded.",
   "GETFIELD references and bytecode verifier results are static evidence; neither proves server-authoritative correctness or runtime freshness.",
   "No source callback, tick handler, event publication or machine value connection is generated."
  ],
  totals:{
   machineClasses:limitedClasses.length,
   classesWithParsedBytecode:classInfoMap.size,
   fieldCandidatesSeen:eligibleFieldsSeen,
   fieldCandidatesReported:Math.min(eligibleFieldsSeen,MAX_FIELDS),
   getterSignaturesObserved:signatureCandidates,
   getterCandidatesObserved:gettersSeen,
   getterCandidatesReported:getters.length,
   structurallyVerifiedGetterCandidates:verifiedCandidates,
   directFieldReadLinks:directReadLinks,
   metricsWithGetterCandidates:mappedMetrics.size,
   metricsWithoutGetterEvidence:unmapped.length,
   methodsWithDecodeErrors:methodsWithDecodeErrors,
   methodsOmitted:Math.max(0,gettersSeen-getters.length),
   machineClassesOmitted:Math.max(0,machineClassSet.size-limitedClasses.length),
   detailsTruncated:machineClassSet.size>limitedClasses.length||eligibleFieldsSeen>MAX_FIELDS||gettersSeen>getters.length
  },
  sourceReaderCallbacksGenerated:0,
  eventPublicationsWired:0,
  javaMethodsInvoked:false,
  liveValuesConnected:false,
  sourceRuntimeValuesRecovered:false,
  arbitraryJavaBlockEntityAccess:false,
  reportFile:"machine-state-source-analysis-plan.json"
 };
 return report;
}
root.Jar2ZeusMachineStateSourceAnalysis={analyze:analyze,inferMetric:inferMetric,parseNoArgReturn:parseNoArgReturn,fieldReadEvidence:fieldReadEvidence};
})(typeof globalThis!=="undefined"?globalThis:this);
