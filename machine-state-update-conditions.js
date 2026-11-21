/* Static condition-context evidence for machine field writes (Phase 28).
 * Reports nearby bytecode context only; it does not prove control dependence or execute Java.
 */
(function(root){
"use strict";
const BLOCKED=/(?:cannon|artillery|projectile|munition|firearm|weapon|rifle|pistol|musket|sword|bow|crossbow|trident)/i;
const MAX_WRITERS=1000,MAX_WRITES=2000,MAX_WINDOW=32,MAX_DETAILS=1200,MAX_READS=16,MAX_CALLS=16,MAX_BRANCHES=16;
const COMPARE=/^(?:if_icmp|if_acmp|ifnull|ifnonnull|ifeq|ifne|iflt|ifle|ifgt|ifge|lcmp|fcmpl|fcmpg|dcmpl|dcmpg)/;
const BRANCH=/^(?:if|goto|jsr|tableswitch|lookupswitch)/;
const INVOKE=new Set(["invokevirtual","invokespecial","invokestatic","invokeinterface","invokedynamic"]);
function arr(v){return Array.isArray(v)?v:[];}
function safe(v){return typeof v==="string"&&!BLOCKED.test(v);}
function norm(v){return String(v||"").replace(/\\./g,"/").replace(/^L|;$/g,"");}
function id(owner,name,desc){return norm(owner)+"."+String(name||"")+String(desc||"");}
function clean(v,n){return String(v==null?"":v).replace(/[\\u0000-\\u001f\\u007f]/g," ").replace(/\\s+/g," ").trim().slice(0,n||160);}
function analyze(input,options){
 input=input&&typeof input==="object"?input:{};options=options&&typeof options==="object"?options:{};
 const trace=input.writeTrace||{},classes=arr(input.classes),classMap=new Map();
 for(const entry of classes){const c=entry&&entry.classInfo?entry.classInfo:entry;if(c&&c.valid===true&&safe(c.className))classMap.set(norm(c.className),c);}
 const writerLimit=Math.min(MAX_WRITERS,Number.isInteger(options.writerLimit)&&options.writerLimit>0?options.writerLimit:MAX_WRITERS);
 const writers=[],summary={writesSeen:0,conditionCandidates:0,branchSitesNearWrites:0,comparisonSitesNearWrites:0,fieldReadsNearWrites:0,callsBeforeWrites:0,writerMethodsMissing:0,decodeErrors:0,detailsTruncated:false};
 for(const wr of arr(trace.writerMethods).slice(0,writerLimit)){
  const c=classMap.get(norm(wr.sourceClass));if(!c){summary.writerMethodsMissing++;continue;}
  const m=arr(c.methods).find(x=>x&&x.name===wr.methodName&&(x.descriptor||null)===(wr.methodDescriptor||null));
  const code=m&&m.code,ins=arr(code&&code.instructions);
  if(!code||code.decodeError){summary.decodeErrors++;continue;}
  const writeRows=[];
  for(const w of arr(wr.fieldWrites)){
   summary.writesSeen++;
   const wi=ins.findIndex(x=>x&&x.pc===w.pc&&x.name===w.opcode);
   if(wi<0){writeRows.push({pc:w.pc,fieldName:w.fieldName,opcode:w.opcode,contextStatus:"write-instruction-not-found",nearbyComparisons:[],nearbyBranches:[],fieldReadsBeforeWrite:[],callsBeforeWrite:[],controlDependenceProven:false});continue;}
   const start=Math.max(0,wi-MAX_WINDOW),window=ins.slice(start,wi);
   const comparisons=[],branches=[],reads=[],calls=[];
   for(let j=0;j<window.length;j++){
    const x=window[j];if(!x||typeof x.name!=="string")continue;
    const row={pc:Number.isInteger(x.pc)?x.pc:null,opcode:x.name,instructionDistance:window.length-j};
    if(COMPARE.test(x.name)&&comparisons.length<MAX_BRANCHES)comparisons.push(row);
    if(BRANCH.test(x.name)&&branches.length<MAX_BRANCHES)branches.push(Object.assign({},row,{target:Number.isInteger(x.target)?x.target:null,targetRelativeToWrite:Number.isInteger(x.target)&&Number.isInteger(w.pc)?(x.target<w.pc?"before-write":x.target>w.pc?"after-write":"at-write"):"unknown"}));
    if((x.name==="getfield"||x.name==="getstatic")&&x.member&&x.member.kind==="field"&&safe(x.member.owner)&&safe(x.member.name)&&reads.length<MAX_READS)reads.push({pc:row.pc,opcode:x.name,owner:norm(x.member.owner),name:x.member.name,descriptor:x.member.descriptor||null,instructionDistance:row.instructionDistance});
    if(INVOKE.has(x.name)&&calls.length<MAX_CALLS){const mm=x.member||{};if((x.name==="invokedynamic"||safe(mm.owner)&&safe(mm.name))){calls.push({pc:row.pc,opcode:x.name,owner:mm.owner?norm(mm.owner):"<dynamic>",name:clean(mm.name||x.dynamic&&x.dynamic.name||"invokedynamic",100),descriptor:mm.descriptor||x.dynamic&&x.dynamic.descriptor||null,instructionDistance:row.instructionDistance});}}
   }
   const conditionCount=comparisons.length+branches.length;
   summary.conditionCandidates+=conditionCount?1:0;summary.branchSitesNearWrites+=branches.length;summary.comparisonSitesNearWrites+=comparisons.length;summary.fieldReadsNearWrites+=reads.length;summary.callsBeforeWrites+=calls.length;
   writeRows.push({pc:w.pc,fieldName:w.fieldName,opcode:w.opcode,contextStatus:conditionCount?"nearby-condition-instructions-found":"no-nearby-condition-instructions",windowInstructionCount:window.length,windowStartPc:Number.isInteger(window[0]&&window[0].pc)?window[0].pc:null,nearbyComparisons:comparisons,nearbyBranches:branches,fieldReadsBeforeWrite:reads,callsBeforeWrite:calls,controlDependenceProven:false,comparisonToBranchPairingProven:false,operandStackConditionRecovered:false,assignmentValueRecovered:false});
  }
  if(writeRows.length)writers.push({methodId:wr.methodId,sourceClass:wr.sourceClass,methodName:wr.methodName,methodDescriptor:wr.methodDescriptor,role:wr.role||null,writes:writeRows});
 }
 const report={schema:"jar2zeus.machine-state-update-conditions.v1",status:writers.length?"nearby-update-condition-context-found":"no-writer-context-available",supportStatus:"bounded-nearby-bytecode-context-only",sourceWriteTraceSchema:trace.schema||null,writers:writers.slice(0,MAX_DETAILS),manualTasks:[{area:"control-dependence",status:"not-proven",reason:"A nearby comparison or branch is not sufficient to prove that it gates a particular write. Full control-flow dominance and exception-edge analysis are not performed here."},{area:"condition-operands",status:"not-recovered",reason:"Field reads are listed as nearby evidence only; operand-stack provenance and comparison operand pairing are not reconstructed."},{area:"update-order",status:"not-recovered",reason:"Static instruction offsets and call positions do not prove runtime execution order, dispatch, tick timing or server/client authority."}],limitations:["Only the bounded instruction window immediately before each known telemetry field write is inspected.","Nearby branch targets are reported by offset only; branch reachability and control dependence are not established.","No Java method is executed and no runtime values, assignment expressions or event hooks are generated.","Reflection, virtual dispatch, invokedynamic targets, exception-driven paths and interprocedural control flow remain unresolved."],totals:Object.assign(summary,{writerMethodsReported:writers.length,writerMethodsOmitted:Math.max(0,arr(trace.writerMethods).length-writerLimit),writesReported:writers.reduce((n,w)=>n+w.writes.length,0),detailsTruncated:arr(trace.writerMethods).length>writerLimit||writers.length>MAX_DETAILS}),javaMethodsExecuted:false,controlDependenceRecovered:false,conditionOperandsRecovered:false,assignmentValuesRecovered:false,updateTimingRecovered:false,sourceRuntimeValuesRecovered:false,sourceReaderCallbacksGenerated:0,eventPublicationsWired:0,liveValuesConnected:false,arbitraryJavaBlockEntityAccess:false,reportFile:"machine-state-update-conditions-plan.json"};
 return report;
}
root.Jar2ZeusMachineStateUpdateConditions={analyze:analyze};
})(typeof globalThis!=="undefined"?globalThis:this);
