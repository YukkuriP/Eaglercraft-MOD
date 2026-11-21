/* Static machine field write-path tracing for Jar2Zeus Phase 27.
 * Reads decoded JVM instruction metadata only; never executes or simulates Java.
 */
(function(root){
"use strict";
const BLOCKED=/(?:cannon|artillery|projectile|munition|firearm|weapon|rifle|pistol|musket|sword|bow|crossbow|trident)/i;
const MAX_CLASSES=1000,MAX_FIELDS=3000,MAX_METHODS=12000,MAX_TOTAL_INSTRUCTIONS=300000,MAX_METHOD_INSTRUCTIONS=6000,MAX_WRITERS=6000,MAX_CALLS=10000,MAX_DETAILS=3000,MAX_READS_PER_WRITER=60,MAX_WRITES_PER_WRITER=40,MAX_CALLS_PER_WRITER=50;
const PERSIST=/^(?:save|load|read|write|serialize|deserialize|encode|decode|saveAdditional|loadAdditional|saveNBTData|loadNBTData|writeToNBT|readFromNBT)$/i;
const SYNC=/^(?:sync|onDataPacket|getUpdateTag|handleUpdateTag|getUpdatePacket|sendBlockUpdated|setChanged|markDirty|notifyUpdate|sendUpdates|broadcastChanges)$/i;
const TICK=/^(?:tick|serverTick|clientTick|tickServer|tickClient|onTick|updateTick|onLoad|neighborChanged)$/i;
const PROCESS=/(?:process|recipe|craft|smelt|work|operation|consume|produce|advance)/i;
function arr(v){return Array.isArray(v)?v:[];}
function safe(v){return typeof v==="string"&&!BLOCKED.test(v);}
function clean(v,max){return String(v==null?"":v).replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim().slice(0,max||180);}
function norm(v){return String(v||"").replace(/\./g,"/").replace(/^L|;$/g,"");}
function descriptorMatch(a,b){return !a||!b||a===b;}
function methodId(owner,name,descriptor){return norm(owner)+"."+String(name||"")+"("+String(descriptor||"")+")";}
function key(owner,name,descriptor){return norm(owner)+"#"+String(name||"")+":"+(descriptor||"");}
function flags(method){return Number(method&&method.accessFlags)||0;}
function invocationEvidence(instructions){
 const out=[];
 for(const ins of instructions){
  if(!ins||!["invokevirtual","invokespecial","invokestatic","invokeinterface","invokedynamic"].includes(ins.name))continue;
  const m=ins.member;
  if(m&&safe(m.owner)&&safe(m.name)&&safe(m.descriptor||"")){
   out.push({pc:Number.isInteger(ins.pc)?ins.pc:null,owner:norm(m.owner),name:m.name,descriptor:m.descriptor||null,opcode:ins.name});
  }else if(ins.name==="invokedynamic"){
   const n=clean(ins.dynamic&&ins.dynamic.name||"invokedynamic",100),d=clean(ins.dynamic&&ins.dynamic.descriptor||"",160);
   if(safe(n)&&safe(d))out.push({pc:Number.isInteger(ins.pc)?ins.pc:null,owner:"<dynamic>",name:n,descriptor:d||null,opcode:ins.name});
  }
  if(out.length>=MAX_CALLS_PER_WRITER)break;
 }
 return out;
}
function evidenceRole(methodName,calls,accessFlags){
 const n=String(methodName||"");
 const callNames=calls.map(c=>c.name);
 const hasPersistCall=callNames.some(v=>/(?:serialize|deserialize|save|load|putInt|putLong|getInt|getLong|putBoolean|getBoolean|putString|getString|CompoundTag|NBT)/i.test(v));
 const hasSyncCall=callNames.some(v=>SYNC.test(v)||/(?:sendBlockUpdated|blockEntityData|setChanged|markDirty|broadcastChanges)/i.test(v));
 if(n==="<init>"||n==="<clinit>")return {role:"initialization",basis:"constructor-name",confidence:"method-name-only"};
 if(PERSIST.test(n))return {role:"persistence",basis:"method-name-pattern",confidence:"candidate-only"};
 if(SYNC.test(n))return {role:"synchronization",basis:"method-name-pattern",confidence:"candidate-only"};
 if(TICK.test(n))return {role:"tick-or-lifecycle",basis:"method-name-pattern",confidence:"candidate-only"};
 if(PROCESS.test(n))return {role:"processing",basis:"method-name-pattern",confidence:"candidate-only"};
 if(/^set[A-Z_]/.test(n)||/^set_/.test(n)||/^update[A-Z_]/.test(n))return {role:"setter-or-update",basis:"method-name-pattern",confidence:"candidate-only"};
 if(hasPersistCall)return {role:"persistence",basis:"persistence-like-call-name",confidence:"candidate-only"};
 if(hasSyncCall)return {role:"synchronization",basis:"synchronization-like-call-name",confidence:"candidate-only"};
 if(flags({accessFlags})&0x0100)return {role:"native-or-external",basis:"native-access-flag",confidence:"manual-review"};
 return {role:"other-writer",basis:"field-write-opcode",confidence:"structural-bytecode-evidence"};
}
function writeEvidence(method,fieldMap,className,path){
 const code=method&&method.code,ins=arr(code&&code.instructions);
 const decodeError=!!(code&&code.decodeError);
 const verified=!!(code&&code.verification&&code.verification.valid===true);
 const writes=[],reads=[],branchSites=[],calls=invocationEvidence(ins);
 const opcodeCounts={};let instructionCost=Math.min(ins.length,MAX_METHOD_INSTRUCTIONS),writeSeen=0;
 for(let i=0;i<ins.length&&i<MAX_METHOD_INSTRUCTIONS;i++){
  const x=ins[i];if(!x||typeof x.name!=="string")continue;
  opcodeCounts[x.name]=(opcodeCounts[x.name]||0)+1;
  if(x.name==="getfield"||x.name==="getstatic"||x.name==="putfield"||x.name==="putstatic"){
   const m=x.member;
   if(!m||m.kind!=="field"||!safe(m.owner)||!safe(m.name)||!safe(m.descriptor||""))continue;
   const owner=norm(m.owner),fieldKey=key(owner,m.name,m.descriptor);
   if(x.name==="putfield"||x.name==="putstatic"){
    const matches=fieldMap.get(fieldKey)||fieldMap.get(key(owner,m.name,""))||[];
    if(matches.length){
     writeSeen++;
     for(const candidate of matches){
      if(writes.length<MAX_WRITES_PER_WRITER)writes.push({pc:Number.isInteger(x.pc)?x.pc:null,opcode:x.name,fieldName:m.name,fieldDescriptor:m.descriptor||null,fieldOwner:owner,metric:candidate.metric||null,providerKey:candidate.providerKey||null,staticWrite:x.name==="putstatic"});
     }
    }
   }else if(reads.length<MAX_READS_PER_WRITER)reads.push({pc:Number.isInteger(x.pc)?x.pc:null,opcode:x.name,fieldName:m.name,fieldDescriptor:m.descriptor||null,fieldOwner:owner});
  }
  if(/^(?:if|goto|jsr|tableswitch|lookupswitch)/.test(x.name)&&branchSites.length<40)branchSites.push({pc:Number.isInteger(x.pc)?x.pc:null,opcode:x.name,target:Number.isInteger(x.target)?x.target:null});
 }
 const fieldIds=Array.from(new Set(writes.map(w=>key(w.fieldOwner,w.fieldName,w.fieldDescriptor))));
 const role=evidenceRole(method.name,calls,method.accessFlags);
 return {
  methodId:methodId(className,method.name,method.descriptor),
  sourceClass:className,sourcePath:path,methodName:method.name,methodDescriptor:method.descriptor||null,
  accessFlags:flags(method),staticMethod:!!(flags(method)&0x0008),visibility:(flags(method)&1)?"public":(flags(method)&4)?"protected":(flags(method)&2)?"private":"package",
  bytecodeDecoded:!!code&&!decodeError,decodeError:decodeError,
  structuralVerificationValid:verified,codeInstructionCount:ins.length,
  fieldWrites:writes,matchedFieldKeys:fieldIds,fieldReads:reads,methodCalls:calls,
  branchSites:branchSites,opcodeCounts:opcodeCounts,role:role,
  writeInstructionCount:writeSeen,hasMultipleWriteSites:writeSeen>1,
  fieldValueExpressionRecovered:false,assignmentSourceDataflowRecovered:false,
  javaMethodExecuted:false,instructionCost:instructionCost
 };
}
function analyze(input,options){
 input=input&&typeof input==="object"?input:{};
 options=options&&typeof options==="object"?options:{};
 const source=input.sourceAnalysis||{};
 const fields=arr(source.fieldCandidates);
 const classes=arr(input.classes);
 const detailLimit=Number.isInteger(options.detailLimit)&&options.detailLimit>0?Math.min(options.detailLimit,MAX_WRITERS):MAX_WRITERS;
 const classNames=new Set(arr(source.machineClasses).filter(x=>x&&safe(x)).map(norm));
 const fieldMap=new Map(),fieldRows=[],metrics=new Set();
 let fieldsSeen=0;
 for(const f of fields){
  if(!f||!safe(f.sourceClass)||!safe(f.fieldName)||!safe(f.fieldDescriptor||""))continue;
  const owner=norm(f.sourceClass),fieldName=String(f.fieldName),desc=f.fieldDescriptor||"";
  const row={sourceClass:owner,fieldName,fieldDescriptor:desc||null,metric:f.metric||null,providerKey:f.providerKey||null,evidenceSource:f.evidenceSource||null};
  const k=key(owner,fieldName,desc);
  if(!fieldMap.has(k))fieldMap.set(k,[]);
  const pushUnique=(mapKey)=>{if(!fieldMap.has(mapKey))fieldMap.set(mapKey,[]);if(!fieldMap.get(mapKey).some(existing=>existing.metric===row.metric&&existing.providerKey===row.providerKey))fieldMap.get(mapKey).push(row);};
  pushUnique(k);
  const loose=key(owner,fieldName,"");
  if(loose!==k)pushUnique(loose);
  if(!fieldRows.some(existing=>key(existing.sourceClass,existing.fieldName,existing.fieldDescriptor)===k&&existing.metric===row.metric&&existing.providerKey===row.providerKey))fieldRows.push(row);classNames.add(owner);if(f.metric)metrics.add(f.metric);fieldsSeen++;
 }
 const limitedNames=Array.from(classNames).slice(0,MAX_CLASSES);
 const classMap=new Map();
 for(const entry of classes.slice(0,MAX_CLASSES)){
  const info=entry&&entry.classInfo?entry.classInfo:entry;
  if(!info||info.valid!==true||!safe(info.className))continue;
  const name=norm(info.className);
  if(!classNames.has(name))continue;
  classMap.set(name,{info,path:entry&&typeof entry.path==="string"&&safe(entry.path)?entry.path:null});
 }
 const methodMap=new Map(),methodsSeen=[];
 let methodCandidatesSeen=0,methodsWithoutCode=0,methodsDecodeErrors=0,methodsTruncated=0,totalCost=0;
 for(const className of limitedNames){
  const holder=classMap.get(className);if(!holder)continue;
  for(const method of arr(holder.info.methods)){
   if(!method||!safe(method.name)||!safe(method.descriptor||""))continue;
   methodCandidatesSeen++;
   const record={method,className,path:holder.path};
   methodsSeen.push(record);
   const id=methodId(className,method.name,method.descriptor);
   if(!methodMap.has(id))methodMap.set(id,record);
  }
 }
 const allWrites=[],writesByField=new Map(),callersByTarget=new Map(),calleeMap=new Map();
 let writesObserved=0,decodedWriterMethods=0,verifiedWriterMethods=0,methodsWithCalls=0,methodsWithBranches=0,methodsWithWriteButNoExactCandidate=0;
 for(const rec of methodsSeen){
  const ins=arr(rec.method&&rec.method.code&&rec.method.code.instructions);
  totalCost+=Math.min(ins.length,MAX_METHOD_INSTRUCTIONS);
  if(totalCost>MAX_TOTAL_INSTRUCTIONS){methodsTruncated++;continue;}
  if(!rec.method.code)methodsWithoutCode++;
  if(rec.method.code&&rec.method.code.decodeError)methodsDecodeErrors++;
  const row=writeEvidence(rec.method,fieldMap,rec.className,rec.path);
  if(row.bytecodeDecoded)decodedWriterMethods+=row.fieldWrites.length?1:0;
  if(row.fieldWrites.length&&row.structuralVerificationValid)verifiedWriterMethods++;
  if(row.methodCalls.length)methodsWithCalls++;
  if(row.branchSites.length)methodsWithBranches++;
  if(row.writeInstructionCount>row.fieldWrites.length&&row.fieldWrites.length===0)methodsWithWriteButNoExactCandidate++;
  const ownId=row.methodId;
  const localCalls=row.methodCalls.filter(c=>c.owner!=="<dynamic>"&&methodMap.has(methodId(c.owner,c.name,c.descriptor)));
  calleeMap.set(ownId,localCalls.map(c=>methodId(c.owner,c.name,c.descriptor)));
  for(const c of localCalls){
   const target=methodId(c.owner,c.name,c.descriptor);
   if(!callersByTarget.has(target))callersByTarget.set(target,[]);
   callersByTarget.get(target).push({callerMethodId:ownId,callerClass:row.sourceClass,callerMethod:row.methodName,pc:c.pc});
  }
  if(row.branchSites.length)row.controlFlowStatus="branch-or-switch-present";
  else row.controlFlowStatus="no-decoded-branch-instruction-observed";
  if(row.fieldWrites.length){
   writesObserved+=row.writeInstructionCount;
   for(const write of row.fieldWrites){
    const k=key(write.fieldOwner,write.fieldName,write.fieldDescriptor),loose=key(write.fieldOwner,write.fieldName,"");
    if(!writesByField.has(k))writesByField.set(k,[]);
    if(!writesByField.get(k).some(existing=>existing.methodId===row.methodId))writesByField.get(k).push(row);
    if(!writesByField.has(loose))writesByField.set(loose,[]);
    if(!writesByField.get(loose).some(existing=>existing.methodId===row.methodId))writesByField.get(loose).push(row);
   }
   allWrites.push(row);
  }
 }
 for(const row of allWrites){
  row.internalCallers=(callersByTarget.get(row.methodId)||[]).slice(0,MAX_CALLS_PER_WRITER);
  row.internalCallees=(calleeMap.get(row.methodId)||[]).slice(0,MAX_CALLS_PER_WRITER);
  row.internalCallerCount=(callersByTarget.get(row.methodId)||[]).length;
  row.internalCalleeCount=(calleeMap.get(row.methodId)||[]).length;
 }
 const fieldSummaries=[];
 for(const f of fieldRows.slice(0,MAX_FIELDS)){
  const k=key(f.sourceClass,f.fieldName,f.fieldDescriptor);
  const writers=writesByField.get(k)||writesByField.get(key(f.sourceClass,f.fieldName,""))||[];
  const uniqueWriters=Array.from(new Map(writers.map(w=>[w.methodId,w])).values());
  const roles=Array.from(new Set(uniqueWriters.map(w=>w.role.role)));
  fieldSummaries.push({
   sourceClass:f.sourceClass,fieldName:f.fieldName,fieldDescriptor:f.fieldDescriptor,
   metric:f.metric,providerKey:f.providerKey,evidenceSource:f.evidenceSource,
   writerMethodCount:uniqueWriters.length,writeInstructionCount:uniqueWriters.reduce((n,w)=>n+w.fieldWrites.filter(x=>x.fieldName===f.fieldName&&x.fieldOwner===f.sourceClass).length,0),
   writerRoles:roles,writerMethods:uniqueWriters.slice(0,24).map(w=>({methodName:w.methodName,methodDescriptor:w.methodDescriptor,role:w.role,structuralVerificationValid:w.structuralVerificationValid,callerCount:w.internalCallerCount,calleeCount:w.internalCalleeCount})),
   updatePathStatus:uniqueWriters.length?"static-write-sites-found":"no-exact-write-site-found"
  });
 }
 const roleCounts={};
 for(const row of allWrites)roleCounts[row.role.role]=(roleCounts[row.role.role]||0)+1;
 const report={
  schema:"jar2zeus.machine-state-write-trace.v1",
  status:allWrites.length?"static-field-write-evidence-found":fieldsSeen?"machine-fields-without-exact-write-evidence":"no-machine-field-candidates",
  supportStatus:"static-field-write-and-call-relationship-worklist-only",
  target:{runtime:"decoded JVM class-file instruction analysis",output:"manual source-owned machine update trace"},
  machineClasses:limitedNames,
  fieldSummaries:fieldSummaries,
  writerMethods:allWrites.slice(0,detailLimit),
  roleSummary:Object.keys(roleCounts).sort().map(role=>({role,writerMethodCount:roleCounts[role]})),
  manualTasks:[
   {area:"assignment-value",status:"not-reconstructed",reason:"PUTFIELD/PUTSTATIC identifies a write site, not the exact value placed on the JVM operand stack. The preceding instruction window is not treated as a proven assignment expression."},
   {area:"update-trigger",status:"candidate-only",reason:"Method names and local invocation references can suggest tick, processing, persistence or synchronization roles; they do not prove when the write executes."},
   {area:"source-owned-adapter",status:"not-generated",reason:"A developer must follow the source implementation, confirm server/client authority and call the Phase 24 publisher only from a valid source-owned update path."}
  ],
  limitations:[
   "Only decoded PUTFIELD/PUTSTATIC references to known machine telemetry field candidates are counted as exact writes.",
   "The analyzer does not execute Java, evaluate operand stacks, recover assigned values or prove the runtime order of updates.",
   "Method-name patterns and invocation names are hints, not verified lifecycle or event registrations.",
   "Local call relationships are based on exact owner/name/descriptor matches among the analyzed machine classes; reflection, virtual dispatch and dynamic call targets are unresolved.",
   "No Java callback, tick hook, state reader, event publication or live telemetry connection is generated."
  ],
  totals:{
   machineClasses:limitedNames.length,parsedMachineClasses:classMap.size,
   fieldCandidatesSeen:fieldsSeen,fieldCandidatesReported:fieldSummaries.length,
   methodCandidatesSeen:methodCandidatesSeen,methodsWithCodeMissing:methodsWithoutCode,
   methodsWithDecodeErrors:methodsDecodeErrors,methodsWithCalls:methodsWithCalls,
   methodsWithBranches:methodsWithBranches,writerMethodsObserved:allWrites.length,
   writerMethodsReported:Math.min(allWrites.length,detailLimit),writeInstructionsObserved:writesObserved,
   structurallyVerifiedWriterMethods:verifiedWriterMethods,decodedWriterMethods:decodedWriterMethods,
   methodsTruncated:methodsTruncated,classesOmitted:Math.max(0,classNames.size-limitedNames.length),
   detailsTruncated:methodsTruncated>0||allWrites.length>detailLimit||fieldsSeen>MAX_FIELDS||classNames.size>limitedNames.length
  },
  javaMethodsExecuted:false,assignmentValuesRecovered:false,updateTimingRecovered:false,
  sourceRuntimeValuesRecovered:false,sourceReaderCallbacksGenerated:0,eventPublicationsWired:0,
  liveValuesConnected:false,arbitraryJavaBlockEntityAccess:false,
  reportFile:"machine-state-write-trace-plan.json"
 };
 return report;
}
root.Jar2ZeusMachineStateWriteTrace={analyze:analyze};
})(typeof globalThis!=="undefined"?globalThis:this);
