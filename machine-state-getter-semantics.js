/* Static JVM getter-body semantics for Jar2Zeus Phase 26.
 * This is a conservative bytecode evidence reader: it never executes Java or invokes methods.
 */
(function(root){
"use strict";
const BLOCKED=/(?:cannon|artillery|projectile|munition|firearm|weapon|rifle|pistol|musket|sword|bow|crossbow|trident)/i;
const MAX_CLASSES=1000,MAX_CANDIDATES=3000,MAX_INSTRUCTIONS_PER_METHOD=4000,MAX_TOTAL_INSTRUCTIONS=100000,MAX_DETAILS=3000,MAX_FIELDS=80,MAX_CALLS=80,MAX_BRANCHES=80,MAX_OPCODE_KINDS=120;
const BINARY=new Set(["iadd","ladd","fadd","dadd","isub","lsub","fsub","dsub","imul","lmul","fmul","dmul","idiv","ldiv","fdiv","ddiv","irem","lrem","frem","drem","ishl","lshl","ishr","lshr","iushr","lushr","iand","land","ior","lor","ixor","lxor"]);
const UNARY=new Set(["ineg","lneg","fneg","dneg","i2l","i2f","i2d","l2i","l2f","l2d","f2i","f2l","f2d","d2i","d2l","d2f","i2b","i2c","i2s"]);
const BRANCH=/^(?:if|goto|jsr|tableswitch|lookupswitch)/;
function arr(v){return Array.isArray(v)?v:[];}
function safe(v){return typeof v==="string"&&!BLOCKED.test(v);}
function text(v,n){return String(v==null?"":v).replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim().slice(0,n||180);}
function norm(v){return String(v||"").replace(/\./g,"/").replace(/^L|;$/g,"");}
function idOf(c,m){return norm(c)+"."+text(m,120);}
function fieldKey(f){return norm(f.owner)+"#"+f.name+":"+String(f.descriptor||"");}
function descriptorKind(desc){
 const m=/^\(\)(Z|B|C|S|I|J|F|D|Ljava\/lang\/String;)$/.exec(String(desc||""));
 if(!m)return null;
 const d=m[1];return d==="Z"?"boolean":d==="Ljava/lang/String;"?"string":"number";
}
function constFromInstruction(ins){
 const n=ins.name||"";
 let m=/^iconst_(-1|0|1|2|3|4|5)$/.exec(n);
 if(m)return {value:Number(m[1]),kind:"number"};
 m=/^lconst_([01])$/.exec(n);if(m)return {value:Number(m[1]),kind:"number"};
 m=/^fconst_([012])$/.exec(n);if(m)return {value:Number(m[1]),kind:"number"};
 m=/^dconst_([01])$/.exec(n);if(m)return {value:Number(m[1]),kind:"number"};
 if((n==="bipush"||n==="sipush")&&Number.isFinite(ins.operand))return {value:Number(ins.operand),kind:"number"};
 if(["ldc","ldc_w","ldc2_w"].includes(n)&&typeof ins.constant==="number"&&Number.isFinite(ins.constant))return {value:ins.constant,kind:"number"};
 return null;
}
function exprText(v,depth){
 if(!v||depth>8)return "?";
 if(v.kind==="this")return "this";
 if(v.kind==="const")return String(v.value);
 if(v.kind==="field")return text(v.owner,100)+"."+text(v.name,80);
 if(v.kind==="static-field")return text(v.owner,100)+"."+text(v.name,80);
 if(v.kind==="unary")return v.op+"("+exprText(v.value,depth+1)+")";
 if(v.kind==="binary")return "("+exprText(v.left,depth+1)+" "+v.op+" "+exprText(v.right,depth+1)+")";
 if(v.kind==="compare")return "compare("+exprText(v.left,depth+1)+","+exprText(v.right,depth+1)+")";
 return "?";
}
function collectFields(v,out,depth){
 if(!v||depth>12)return;
 if(v.kind==="field"||v.kind==="static-field"){
  out.push({owner:v.owner,name:v.name,descriptor:v.descriptor,access:v.kind==="field"?"instance":"static"});
  return;
 }
 if(v.kind==="unary")collectFields(v.value,out,depth+1);
 if(v.kind==="binary"||v.kind==="compare"){collectFields(v.left,out,depth+1);collectFields(v.right,out,depth+1);}
}
function uniqueRows(rows,keyFn){const seen=new Set(),out=[];for(const row of rows){const k=keyFn(row);if(!seen.has(k)){seen.add(k);out.push(row);}}return out;}
function summarizeMethod(candidate,holder){
 const method=candidate.method;
 const methodMissing=!method;
 const code=method&&method.code;
 const instructions=arr(code&&code.instructions);
 const decodeError=!!(code&&code.decodeError);
 const verification=code&&code.verification||{};
 const verified=verification.valid===true;
 const exceptionHandlerCount=arr(code&&code.exceptions).length;
 const exceptionFlowDetected=exceptionHandlerCount>0;
 const counts={},fieldReads=[],fieldWrites=[],calls=[],branches=[],constants=[],arithmetic=[],conversions=[],returnOps=[];
 let unsupported=[],writeDetected=false,branchDetected=false,helperDetected=false,monitorDetected=false;
 for(const ins of instructions.slice(0,MAX_INSTRUCTIONS_PER_METHOD)){
  if(!ins||typeof ins.name!=="string")continue;
  const n=ins.name;counts[n]=(counts[n]||0)+1;
  if(BRANCH.test(n)){branchDetected=true;if(branches.length<MAX_BRANCHES)branches.push({pc:Number.isInteger(ins.pc)?ins.pc:null,opcode:n,target:Number.isInteger(ins.target)?ins.target:null});}
  if(n==="getfield"||n==="getstatic"||n==="putfield"||n==="putstatic"){
   const m=ins.member;
   if(m&&m.kind==="field"&&safe(m.owner)&&safe(m.name)&&safe(m.descriptor||"")){
    const row={pc:Number.isInteger(ins.pc)?ins.pc:null,owner:norm(m.owner),name:m.name,descriptor:m.descriptor||null,opcode:n};
    if(n==="getfield"||n==="getstatic"){if(fieldReads.length<MAX_FIELDS)fieldReads.push(row);}
    else{writeDetected=true;if(fieldWrites.length<MAX_FIELDS)fieldWrites.push(row);}
   }else if(n==="putfield"||n==="putstatic")writeDetected=true;
  }
  if(n==="invokevirtual"||n==="invokespecial"||n==="invokestatic"||n==="invokeinterface"){
   helperDetected=true;
   const m=ins.member;
   if(m&&safe(m.owner)&&safe(m.name)&&safe(m.descriptor||"")&&calls.length<MAX_CALLS)calls.push({pc:Number.isInteger(ins.pc)?ins.pc:null,owner:norm(m.owner),name:m.name,descriptor:m.descriptor||null,opcode:n});
  }
  if(n==="invokedynamic"){helperDetected=true;const dynamicName=text(ins.dynamic&&ins.dynamic.name||"invokedynamic",80),dynamicDescriptor=text(ins.dynamic&&ins.dynamic.descriptor||"",120);if(safe(dynamicName)&&safe(dynamicDescriptor)&&calls.length<MAX_CALLS)calls.push({pc:Number.isInteger(ins.pc)?ins.pc:null,owner:"<dynamic>",name:dynamicName,descriptor:dynamicDescriptor,opcode:n});}
  if(n==="monitorenter"||n==="monitorexit"||n==="athrow")monitorDetected=true;
  const cv=constFromInstruction(ins);if(cv&&constants.length<MAX_DETAILS)constants.push({pc:Number.isInteger(ins.pc)?ins.pc:null,value:cv.value,kind:cv.kind,opcode:n});
  if(BINARY.has(n)&&arithmetic.length<MAX_DETAILS)arithmetic.push({pc:Number.isInteger(ins.pc)?ins.pc:null,opcode:n});
  if(UNARY.has(n)&&conversions.length<MAX_DETAILS)conversions.push({pc:Number.isInteger(ins.pc)?ins.pc:null,opcode:n,conversion:n.includes("2")});
  if(/^(?:[ilfda]?return)$/.test(n)&&returnOps.length<8)returnOps.push({pc:Number.isInteger(ins.pc)?ins.pc:null,opcode:n});
 }
 let expression=null,expressionStatus="not-attempted",expressionError=null;
 const allowedNoop=new Set(["nop"]);
 const stack=[];
 const push=v=>stack.push(v);
 const pop=()=>stack.length?stack.pop():null;
 function runExpression(){
  if(decodeError||!code)return {status:"unavailable",value:null,error:decodeError?"bytecode-decode-error":"method-has-no-code"};
  if(instructions.length>MAX_INSTRUCTIONS_PER_METHOD)return {status:"unsupported",value:null,error:"method-instruction-limit-exceeded"};
  if(branchDetected||helperDetected||writeDetected||monitorDetected||exceptionFlowDetected)return {status:"unsupported",value:null,error:"control-flow-call-or-side-effect-present"};
  for(const ins of instructions){
   const n=ins.name;
   if(allowedNoop.has(n))continue;
   if(n==="aload_0"||n==="aload"&&ins.operand===0){
    if(candidate.instanceMethod){push({kind:"this"});continue;}
    return {status:"unsupported",value:null,error:"local-zero-is-not-an-instance-receiver"};
   }
   if(["iload_0","lload_0","fload_0","dload_0"].includes(n)||(["iload","lload","fload","dload"].includes(n)&&ins.operand===0)){
    return {status:"unsupported",value:null,error:"non-receiver-local-read"};
   }
   const cv=constFromInstruction(ins);if(cv){push({kind:"const",value:cv.value});continue;}
   if(n==="getfield"||n==="getstatic"){
    const m=ins.member;if(!m||m.kind!=="field"||!safe(m.owner)||!safe(m.name))return {status:"unsupported",value:null,error:"field-reference-unavailable-or-excluded"};
    if(n==="getfield"){
     const receiver=pop();if(!receiver||receiver.kind!=="this")return {status:"unsupported",value:null,error:"getfield-receiver-not-proven-to-be-this"};
     push({kind:"field",owner:norm(m.owner),name:m.name,descriptor:m.descriptor||null});
    }else push({kind:"static-field",owner:norm(m.owner),name:m.name,descriptor:m.descriptor||null});
    continue;
   }
   if(BINARY.has(n)){
    const right=pop(),left=pop();if(!left||!right)return {status:"unsupported",value:null,error:"operand-stack-underflow-at-"+n};
    const op=({iadd:"+",ladd:"+",fadd:"+",dadd:"+",isub:"-",lsub:"-",fsub:"-",dsub:"-",imul:"*",lmul:"*",fmul:"*",dmul:"*",idiv:"/",ldiv:"/",fdiv:"/",ddiv:"/",irem:"%",lrem:"%",frem:"%",drem:"%",ishl:"<<",lshl:"<<",ishr:">>",lshr:">>",iushr:">>>",lushr:">>>",iand:"&",land:"&",ior:"|",lor:"|",ixor:"^",lxor:"^"})[n];
    push({kind:"binary",op,left,right,opcode:n});continue;
   }
   if(UNARY.has(n)){
    const value=pop();if(!value)return {status:"unsupported",value:null,error:"operand-stack-underflow-at-"+n};
    push({kind:"unary",op:n,value});continue;
   }
   if(n==="lcmp"||n==="fcmpl"||n==="fcmpg"||n==="dcmpl"||n==="dcmpg"){
    const right=pop(),left=pop();if(!left||!right)return {status:"unsupported",value:null,error:"operand-stack-underflow-at-"+n};
    push({kind:"compare",op:n,left,right});continue;
   }
   if(n==="dup"){if(!stack.length)return {status:"unsupported",value:null,error:"operand-stack-underflow-at-dup"};push(stack[stack.length-1]);continue;}
   if(n==="swap"){if(stack.length<2)return {status:"unsupported",value:null,error:"operand-stack-underflow-at-swap"};const a=pop(),b=pop();push(a);push(b);continue;}
   if(["ireturn","lreturn","freturn","dreturn","areturn"].includes(n)){
    const value=pop();if(!value||stack.length!==0)return {status:"unsupported",value:null,error:"return-stack-shape-not-understood"};
    return {status:"resolved",value,error:null};
   }
   return {status:"unsupported",value:null,error:"unsupported-opcode-"+text(n,50)};
  }
  return {status:"unsupported",value:null,error:"no-supported-return-instruction"};
 }
 const evaluated=runExpression();
 if(evaluated.status==="resolved"){expression=evaluated.value;expressionStatus="resolved";}
 else{expressionStatus=evaluated.status;expressionError=evaluated.error;}
 const expressionFields=[];collectFields(expression,expressionFields,0);
 const uniqueFieldReads=uniqueRows(fieldReads,row=>fieldKey(row));
 const matched=arr(candidate.fieldMatches);
 const fieldMatchesRead=matched.map(f=>{
  const found=uniqueFieldReads.some(r=>r.owner===candidate.sourceClass&&r.name===f.fieldName&&(!f.fieldDescriptor||!r.descriptor||f.fieldDescriptor===r.descriptor));
  return {fieldName:f.fieldName,metric:f.metric,providerKey:f.providerKey,readByBody:found};
 });
 const directReturn=expression&&expression.kind==="field"&&fieldMatchesRead.some(f=>f.readByBody&&f.fieldName===expression.name);
 const hasArithmetic=arithmetic.length>0||conversions.length>0;
 const multipleFields=uniqueFieldReads.length>1;
 let classification="unresolved-body";
 if(methodMissing)classification="method-not-found-in-parsed-class";
 else if(!code)classification="no-bytecode";
 else if(decodeError)classification="bytecode-decode-error";
 else if(writeDetected)classification="state-mutating-getter";
 else if(monitorDetected||exceptionFlowDetected)classification="side-effect-or-exception-flow";
 else if(branchDetected)classification="conditional-or-loop-dependent";
 else if(helperDetected)classification="helper-call-dependent";
 else if(directReturn&&expressionStatus==="resolved"&&!hasArithmetic)classification="direct-field-return";
 else if(expressionStatus==="resolved"&&expressionFields.length&&hasArithmetic)classification="calculated-from-field";
 else if(expressionStatus==="resolved"&&expressionFields.length)classification="field-derived-return";
 else if(expressionStatus==="resolved"&&expression.kind==="const")classification="constant-return";
 else if(expressionStatus==="resolved"&&expression.kind==="static-field")classification="static-field-return";
 else if(multipleFields)classification="multiple-field-dependencies";
 else if(expressionStatus==="unsupported")classification="unsupported-bytecode-body";
 else classification="unresolved-body";
 const expressionSummary=expression?{
  text:exprText(expression,0),
  kind:expression.kind,
  usesCandidateField:expressionFields.some(f=>matched.some(m=>m.fieldName===f.name&&norm(candidate.sourceClass)===f.owner)),
  fieldDependencies:uniqueRows(expressionFields,f=>norm(f.owner)+"#"+f.name+":"+f.descriptor),
  numericOperations:arithmetic.map(x=>x.opcode),
  conversions:conversions.map(x=>x.opcode)
 }:null;
 return {
  candidateId:idOf(candidate.sourceClass,candidate.methodName+candidate.methodDescriptor),
  sourceClass:candidate.sourceClass,sourcePath:candidate.sourcePath||null,
  classParsed:!!holder,methodFound:!methodMissing,
  methodName:candidate.methodName,methodDescriptor:candidate.methodDescriptor,
  metricMatches:matched.slice(0,12).map(f=>({metric:f.metric,providerKey:f.providerKey,fieldName:f.fieldName,fieldDescriptor:f.fieldDescriptor||null})),
  classification,confidence:verified?"structural-bytecode-evidence":"low-unverified-bytecode-evidence",
  bytecodeDecoded:!!code&&!decodeError,structuralVerificationValid:verified,
  instructionCount:instructions.length,opcodeCounts:Object.keys(counts).slice(0,MAX_OPCODE_KINDS).reduce((o,k)=>(o[k]=counts[k],o),{}),
  fieldReads:uniqueFieldReads.slice(0,MAX_FIELDS),fieldWrites:fieldWrites.slice(0,MAX_FIELDS),
  methodCalls:calls.slice(0,MAX_CALLS),branchSites:branches.slice(0,MAX_BRANCHES),
  numericConstants:constants.slice(0,MAX_DETAILS),arithmeticOperations:arithmetic.slice(0,MAX_DETAILS),
  conversions:conversions.slice(0,MAX_DETAILS),returnInstructions:returnOps,
  matchedFieldReads:fieldMatchesRead,expressionStatus,expression:expressionSummary,
  helperCallObserved:helperDetected,stateWriteObserved:writeDetected,branchObserved:branchDetected,
  monitorOrThrowObserved:monitorDetected,exceptionHandlerCount:exceptionHandlerCount,unknownBytecodeReason:expressionError,
  sourceRuntimeValueRecovered:false,javaMethodExecuted:false
 };
}
function analyze(input,options){
 input=input&&typeof input==="object"?input:{};
 options=options&&typeof options==="object"?options:{};
 const source=input.sourceAnalysis||{};
 const candidates=arr(source.getterCandidates);
 const classes=arr(input.classes);
 const detailLimit=Number.isInteger(options.detailLimit)&&options.detailLimit>0?Math.min(options.detailLimit,MAX_CANDIDATES):MAX_CANDIDATES;
 const classesOmitted=Math.max(0,classes.length-MAX_CLASSES);
 const classMap=new Map();
 for(const entry of classes.slice(0,MAX_CLASSES)){
  const info=entry&&entry.classInfo?entry.classInfo:entry;
  if(!info||info.valid!==true||!safe(info.className))continue;
  classMap.set(norm(info.className),{info,path:entry&&typeof entry.path==="string"?entry.path:null});
 }
 const getterAnalyses=[];const summary={};let candidatesSeen=0,decodedMethods=0,verifiedMethods=0,instructionCount=0,methodsOmitted=0;
 const maxTotal=MAX_TOTAL_INSTRUCTIONS;
 for(const candidate of candidates.slice(0,MAX_CANDIDATES)){
  if(!candidate||!safe(candidate.sourceClass)||!safe(candidate.methodName)||!safe(candidate.methodDescriptor||""))continue;
  candidatesSeen++;
  const holder=classMap.get(norm(candidate.sourceClass));
  const method=holder&&arr(holder.info.methods).find(m=>m&&m.name===candidate.methodName&&m.descriptor===candidate.methodDescriptor);
  const methodInstructionCost=Math.min(arr(method&&method.code&&method.code.instructions).length,MAX_INSTRUCTIONS_PER_METHOD);
  if(instructionCount+methodInstructionCost>maxTotal){methodsOmitted++;continue;}
  const row=summarizeMethod(Object.assign({},candidate,{method,instanceMethod:candidate.instanceMethod===true}),holder);
  if(row.bytecodeDecoded)decodedMethods++;
  if(row.structuralVerificationValid)verifiedMethods++;
  instructionCount+=methodInstructionCost;
  summary[row.classification]=(summary[row.classification]||0)+1;
  if(getterAnalyses.length<detailLimit)getterAnalyses.push(row);else methodsOmitted++;
 }
 const classificationSummary=Object.keys(summary).sort().map(k=>({classification:k,count:summary[k]}));
 const report={
  schema:"jar2zeus.machine-state-getter-semantics.v1",
  status:candidatesSeen?"static-getter-body-evidence-found":"no-getter-body-candidates",
  supportStatus:"static-bytecode-semantics-worklist-only",
  sourceAnalysisSchema:source.schema||null,
  getterAnalyses,classificationSummary,
  manualTasks:[
   {area:"calculation-review",status:candidatesSeen?"review-required":"not-observed",reason:"The symbolic expression is produced only for a narrow, straight-line JVM instruction subset. Check Java source, units, rounding, overflow, clamps and side effects before relying on it."},
   {area:"helper-and-control-flow",status:"not-reconstructed",reason:"Branches, loops, helper calls, dynamic calls and complex stack patterns are reported as dependencies; their runtime behavior is not executed or guessed."},
   {area:"source-owned-adapter",status:"not-generated",reason:"A source MOD developer must implement and test a reader while the Java object is available, then explicitly publish validated scalar telemetry."}
  ],
  limitations:[
   "This module inspects already-decoded bytecode only and never executes Java methods.",
   "The symbolic evaluator accepts a narrow straight-line instruction subset; unresolved methods are classified rather than guessed.",
   "Structural bytecode verification is not full JVM type verification and does not prove source-level semantics.",
   "Field names and numeric constants do not establish units, rounding rules, clamping, server authority or update timing.",
   "Calls, branches, loops, writes, monitor operations and exceptions can alter behavior and are not reconstructed as executable logic.",
   "No Lua reader, Java bridge, callback, event hook or live machine value is generated."
  ],
  totals:{
   getterCandidatesSeen:candidatesSeen,getterAnalysesReported:getterAnalyses.length,
   decodedMethods:decodedMethods,
   structurallyVerifiedMethods:verifiedMethods,totalInstructionsAnalyzed:instructionCount,
   methodsOmitted:methodsOmitted,classesOmitted:classesOmitted,detailsTruncated:methodsOmitted>0||candidates.length>MAX_CANDIDATES||classesOmitted>0
  },
  javaMethodsExecuted:false,sourceRuntimeValuesRecovered:false,
  sourceReaderCallbacksGenerated:0,eventPublicationsWired:0,
  liveValuesConnected:false,arbitraryJavaBlockEntityAccess:false,
  reportFile:"machine-state-getter-semantics-plan.json"
 };
 return report;
}
root.Jar2ZeusMachineStateGetterSemantics={analyze:analyze};
})(typeof globalThis!=="undefined"?globalThis:this);
