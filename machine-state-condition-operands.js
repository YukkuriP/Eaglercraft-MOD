/* Static operand-origin tracing for machine update branches (Phase 30).
 * Simulates only a bounded, straight-line JVM operand-stack subset inside one basic block.
 * Never executes Java or evaluates runtime values/branch outcomes.
 */
(function(root){
"use strict";
const BLOCKED=/(?:cannon|artillery|projectile|munition|firearm|weapon|rifle|pistol|musket|sword|bow|crossbow|trident)/i;
const MAX_METHODS=500,MAX_BRANCHES=1200,MAX_INSTRUCTIONS=60000,MAX_STACK=256,MAX_DEPTH=3,MAX_ORIGIN_ITEMS=4;
const CONDITIONAL=/^(?:ifeq|ifne|iflt|ifge|ifgt|ifle|if_icmpeq|if_icmpne|if_icmplt|if_icmpge|if_icmpgt|if_icmple|if_acmpeq|if_acmpne|ifnull|ifnonnull)$/;
const SWITCH=new Set(["tableswitch","lookupswitch"]);
const LOAD=/^(?:[ilfda]load)(?:_[0-3])?$/;
const STORE=/^(?:[ilfda]store)(?:_[0-3])?$/;
const BINARY=new Set(["iadd","ladd","fadd","dadd","isub","lsub","fsub","dsub","imul","lmul","fmul","dmul","idiv","ldiv","fdiv","ddiv","irem","lrem","frem","drem","ishl","lshl","ishr","lshr","iushr","lushr","iand","land","ior","lor","ixor","lxor"]);
const UNARY=new Set(["ineg","lneg","fneg","dneg","i2l","i2f","i2d","l2i","l2f","l2d","f2i","f2l","f2d","d2i","d2l","d2f","i2b","i2c","i2s"]);
const COMPARES=new Set(["lcmp","fcmpl","fcmpg","dcmpl","dcmpg"]);
const INVOKE=new Set(["invokevirtual","invokespecial","invokestatic","invokeinterface","invokedynamic"]);
function arr(v){return Array.isArray(v)?v:[];}
function safe(v){return typeof v==="string"&&!BLOCKED.test(v);}
function norm(v){return String(v||"").replace(/\\./g,"/").replace(/^L|;$/g,"");}
function clean(v,n){return String(v==null?"":v).replace(/[\\u0000-\\u001f\\u007f]/g," ").replace(/\\s+/g," ").trim().slice(0,n||140);}
function parseType(desc,pos,allowVoid){
 let p=pos,dims=0;while(desc[p]==="["){dims++;p++;if(dims>255)return null;}
 const ch=desc[p++];
 if("ZBCSIF".includes(ch))return {descriptor:desc.slice(pos,p),kind:dims?"reference":ch,category:1,next:p};
 if(ch==="J"||ch==="D")return {descriptor:desc.slice(pos,p),kind:dims?"reference":ch,category:dims?1:2,next:p};
 if(ch==="L"){const end=desc.indexOf(";",p);if(end<0||end===p)return null;return {descriptor:desc.slice(pos,end+1),kind:"reference",category:1,next:end+1};}
 if(ch==="V"&&allowVoid&&!dims)return {descriptor:"V",kind:"void",category:0,next:p};
 return null;
}
function parseMethod(desc){
 if(typeof desc!=="string"||desc[0]!=="(")return null;
 let p=1;const args=[];
 while(p<desc.length&&desc[p]!==")"){const t=parseType(desc,p,false);if(!t)return null;args.push(t);p=t.next;}
 if(desc[p++]!==")")return null;
 const result=parseType(desc,p,true);if(!result||result.next!==desc.length)return null;
 return {args,result};
}
function localSlot(ins){
 const n=String(ins.name||"");
 let m=/^([ilfda]load|[ilfda]store)_([0-3])$/.exec(n);
 if(m)return Number(m[2]);
 if(/^(?:iload|lload|fload|dload|aload|istore|lstore|fstore|dstore|astore|ret)$/.test(n)||ins.wideOpcode!=null&&/^(?:iload|lload|fload|dload|aload|istore|lstore|fstore|dstore|astore|ret)$/.test(n))return Number.isInteger(ins.local)?ins.local:ins.operand;
 return null;
}
function slotInfo(desc,isStatic){
 const parsed=parseMethod(desc);if(!parsed)return null;
 const map=new Map();let slot=isStatic?0:1,param=0;
 if(!isStatic)map.set(0,{kind:"this",slot:0,descriptor:"Ljava/lang/Object;",category:1});
 for(const t of parsed.args){map.set(slot,{kind:"method-parameter",slot,parameterIndex:param,descriptor:t.descriptor,category:t.category});slot+=t.category;param++;}
 return map;
}
function origin(kind,data){
 const o=Object.assign({kind},data||{});
 return o;
}
function publicOrigin(v,depth){
 if(!v||depth>MAX_DEPTH)return {kind:"truncated-origin"};
 const out={kind:v.kind||"unknown"};
 for(const k of ["pc","slot","parameterIndex","descriptor","owner","name","opcode","operator","constantKind","constantValue","constantLength","methodName","methodOwner","methodDescriptor","fieldStatic","arrayType","detail"])if(v[k]!==undefined&&v[k]!==null)out[k]=v[k];
 if(v.receiver)out.receiver=publicOrigin(v.receiver,depth+1);
 if(Array.isArray(v.operands))out.operands=v.operands.slice(0,MAX_ORIGIN_ITEMS).map(x=>publicOrigin(x,depth+1));
 if(Array.isArray(v.arguments))out.arguments=v.arguments.slice(0,MAX_ORIGIN_ITEMS).map(x=>publicOrigin(x,depth+1));
 return out;
}
function simulate(instructions,block,targetPc,method,instructionBudget){
 const ins=arr(instructions).filter(x=>x&&Number.isInteger(x.pc)&&x.pc>=block.start&&x.pc<block.end).sort((a,b)=>a.pc-b.pc);
 const stack=[],locals=new Map(),params=slotInfo(method.descriptor,!!(Number(method.accessFlags)&8));
 let unsupported=null,unknownStackEntries=0,instructionCount=0,branch=null;
 function push(v){if(stack.length>=MAX_STACK){unsupported="operand-stack-limit-exceeded";return;}stack.push(v);}
 function pop(n,pc){
  const out=[];for(let i=0;i<n;i++){if(stack.length)out.unshift(stack.pop());else{out.unshift(origin("unknown-stack-entry",{pc,detail:"basic-block-entry-stack-not-reconstructed"}));unknownStackEntries++;}}
  return out;
 }
 function valueType(desc){const t=parseType(String(desc||""),0,false);return t?t.category:1;}
 function localValue(slot,pc){
  if(locals.has(slot))return locals.get(slot);
  const p=params&&params.get(slot);
  if(p)return origin(p.kind,Object.assign({},p,{pc}));
  return origin("local-slot",{slot,pc,detail:"incoming-local-value-not-reconstructed"});
 }
 function constantValue(x){
  const n=x.name||"";
  if(n==="aconst_null")return origin("null-constant",{pc:x.pc});
  const int=/^iconst_m?([0-5])$/.exec(n);
  if(n==="iconst_m1")return origin("constant",{pc:x.pc,constantKind:"integer",constantValue:-1,descriptor:"I"});
  if(int)return origin("constant",{pc:x.pc,constantKind:"integer",constantValue:Number(int[1]),descriptor:"I"});
  const long=/^lconst_([01])$/.exec(n);if(long)return origin("constant",{pc:x.pc,constantKind:"long",constantValue:Number(long[1]),descriptor:"J"});
  const fl=/^fconst_([012])$/.exec(n);if(fl)return origin("constant",{pc:x.pc,constantKind:"float",constantValue:Number(fl[1]),descriptor:"F"});
  const dbl=/^dconst_([01])$/.exec(n);if(dbl)return origin("constant",{pc:x.pc,constantKind:"double",constantValue:Number(dbl[1]),descriptor:"D"});
  if(n==="bipush"||n==="sipush")return origin("constant",{pc:x.pc,constantKind:"integer",constantValue:Number(x.operand),descriptor:"I"});
  if(n==="ldc"||n==="ldc_w"||n==="ldc2_w"){
   const tag=Number(x.constantTag),desc=tag===5?"J":tag===6?"D":tag===4?"F":tag===3?"I":tag===8?"Ljava/lang/String;":tag===7?"Ljava/lang/Class;":"";
   const data={pc:x.pc,constantKind:tag===8?"string":tag===7?"class":tag===5?"long":tag===6?"double":tag===4?"float":tag===3?"integer":"dynamic",descriptor:desc||null};
   if(typeof x.constant==="number"&&Number.isFinite(x.constant))data.constantValue=x.constant;
   else if(typeof x.constant==="string")data.constantLength=x.constant.length;
   return origin("constant",data);
  }
  return null;
 }
 function stackManip(n,pc){
  const take=()=>stack.length?stack.pop():origin("unknown-stack-entry",{pc,detail:"stack-manipulation-underflow"});
  if(n==="pop"){const a=take();if(a.category===2)unsupported="invalid-pop-category";else if(a.category==null)unsupported="unknown-pop-entry-category";return;}
  if(n==="pop2"){const a=take();if(a.category==null){unsupported="unknown-pop2-entry-category";return;}if(a.category!==2){const b=take();if(b.category==null)unsupported="unknown-pop2-second-entry-category";else if(b.category===2)unsupported="invalid-pop2-category";}return;}
  if(n==="dup"){const a=take();if(a.category!==1){unsupported="unsupported-dup-category";return;}stack.push(a,a);return;}
  if(n==="swap"){const a=take(),b=take();if(a.category!==1||b.category!==1){unsupported="unsupported-swap-category";return;}stack.push(a,b);return;}
  if(n==="dup2"){
   const a=take();if(a.category===2){stack.push(a,a);return;}
   const b=take();if(b.category!==1){unsupported="unsupported-dup2-category";return;}stack.push(b,a,b,a);return;
  }
  unsupported="unsupported-stack-manipulation:"+n;
 }
 for(const x of ins){
  if(x.pc>targetPc)break;
  instructionCount++;
  if(instructionCount>instructionBudget)return {status:"unsupported",reason:"instruction-budget-exceeded",instructionCount,unknownStackEntries,branch:null};
  const n=String(x.name||"");
  const cv=constantValue(x);if(cv){cv.category=cv.descriptor==="J"||cv.descriptor==="D"?2:1;push(cv);continue;}
  if(LOAD.test(n)){
   const slot=localSlot(x);if(!Number.isInteger(slot)||slot<0){unsupported="invalid-local-load";break;}
   const v=localValue(slot,x.pc);push(origin(v.kind,Object.assign({},v,{pc:x.pc,opcode:n,slot,category:n[0]==="l"||n[0]==="d"?2:1})));continue;
  }
  if(STORE.test(n)){
   const slot=localSlot(x);if(!Number.isInteger(slot)||slot<0){unsupported="invalid-local-store";break;}
   const v=pop(1,x.pc)[0];locals.set(slot,origin(v.kind,Object.assign({},v,{pc:x.pc,storedFromPc:v.pc,slot,category:n[0]==="l"||n[0]==="d"?2:1})));continue;
  }
  if(n==="iinc"){
   const slot=Number(x.local);const current=localValue(slot,x.pc);
   locals.set(slot,origin("calculated-value",{pc:x.pc,operator:"iinc",operands:[current,origin("constant",{constantKind:"integer",constantValue:Number(x.increment),descriptor:"I"})],descriptor:"I",category:1}));continue;
  }
  if(n==="nop"||n==="goto"||n==="goto_w")continue;
  if(n==="pop"||n==="pop2"||n==="dup"||n==="dup2"||n==="swap"||n==="dup_x1"||n==="dup_x2"||n==="dup2_x1"||n==="dup2_x2"){stackManip(n,x.pc);if(unsupported)break;continue;}
  if(CONDITIONAL.test(n)||SWITCH.has(n)){
   let count=1,branchKind="single-value-test";
   if(/^if_icmp/.test(n)){count=2;branchKind="integer-pair";}
   else if(/^if_acmp/.test(n)){count=2;branchKind="reference-pair";}
   else if(n==="ifnull"||n==="ifnonnull")branchKind="null-test";
   else if(SWITCH.has(n))branchKind="switch-key";
   const operands=pop(count,x.pc);
   branch={pc:x.pc,opcode:n,branchKind,operandOrigins:operands.map(v=>publicOrigin(v,0)),unknownOperandCount:operands.filter(v=>v.kind==="unknown-stack-entry").length};
   break;
  }
  if(n==="getstatic"||n==="getfield"){
   const m=x.member||{};if(!m||m.kind!=="field"||!safe(m.owner)||!safe(m.name)){unsupported="unsafe-or-invalid-field-reference";break;}
   const recv=n==="getfield"?pop(1,x.pc)[0]:null;
   const desc=m.descriptor||"";
   push(origin("field-read",{pc:x.pc,opcode:n,owner:norm(m.owner),name:clean(m.name,100),descriptor:desc,fieldStatic:n==="getstatic",receiver:recv?publicOrigin(recv,0):null,category:valueType(desc)}));continue;
  }
  if(n==="putfield"||n==="putstatic"){pop(n==="putfield"?2:1,x.pc);continue;}
  if(INVOKE.has(n)){
   const mm=x.member||{},desc=n==="invokedynamic"?x.dynamic&&x.dynamic.descriptor:mm.descriptor,parsed=parseMethod(desc);
   if(!parsed){unsupported="invalid-invocation-descriptor";break;}
   const args=pop(parsed.args.length,x.pc),receiver=n==="invokestatic"||n==="invokedynamic"?null:pop(1,x.pc)[0];
   const owner=mm.owner?norm(mm.owner):"<dynamic>",name=mm.name||x.dynamic&&x.dynamic.name||"invokedynamic";
   if(!safe(name)||owner!=="<dynamic>"&&!safe(owner)){unsupported="unsafe-or-invalid-method-reference";break;}
   if(parsed.result.kind!=="void"){
    push(origin("method-result",{pc:x.pc,methodOwner:owner,methodName:clean(name,100),methodDescriptor:desc,receiver:receiver?publicOrigin(receiver,0):null,arguments:args.map(v=>publicOrigin(v,0)),descriptor:parsed.result.descriptor,category:parsed.result.category}));
   }
   continue;
  }
  if(BINARY.has(n)){
   const operands=pop(2,x.pc),prefix=n[0],desc=prefix==="l"?"J":prefix==="f"?"F":prefix==="d"?"D":"I";
   push(origin("calculated-value",{pc:x.pc,operator:n,operands:operands.map(v=>publicOrigin(v,0)),descriptor:desc,category:prefix==="l"||prefix==="d"?2:1}));continue;
  }
  if(UNARY.has(n)){
   const operand=pop(1,x.pc),conversion={i2l:"J",i2f:"F",i2d:"D",l2i:"I",l2f:"F",l2d:"D",f2i:"I",f2l:"J",f2d:"D",d2i:"I",d2l:"J",d2f:"F",i2b:"I",i2c:"I",i2s:"I"},dest=conversion[n]||(n[0]==="l"?"J":n[0]==="f"?"F":n[0]==="d"?"D":"I");
   push(origin("calculated-value",{pc:x.pc,operator:n,operands:operand.map(v=>publicOrigin(v,0)),descriptor:dest,category:dest==="J"||dest==="D"?2:1}));continue;
  }
  if(COMPARES.has(n)){
   const operands=pop(2,x.pc);push(origin("comparison-result",{pc:x.pc,operator:n,operands:operands.map(v=>publicOrigin(v,0)),descriptor:"I",category:1}));continue;
  }
  if(n==="new"){push(origin("new-object",{pc:x.pc,descriptor:x.className||null,category:1}));continue;}
  if(n==="newarray"||n==="anewarray"){const length=pop(1,x.pc)[0];push(origin("new-array",{pc:x.pc,arrayType:n==="newarray"?"primitive":"reference",length:publicOrigin(length,0),category:1}));continue;}
  if(n==="multianewarray"){const dims=pop(Number(x.dimensions)||0,x.pc);push(origin("new-array",{pc:x.pc,arrayType:"multi",dimensions:dims.length,descriptor:x.className||null,category:1}));continue;}
  if(/^(?:iaload|laload|faload|daload|aaload|baload|caload|saload)$/.test(n)){const a=pop(2,x.pc);push(origin("array-element",{pc:x.pc,operands:a.map(v=>publicOrigin(v,0)),descriptor:n[0]==="l"?"J":n[0]==="d"?"D":n[0]==="f"?"F":n[0]==="a"?"Ljava/lang/Object;":"I",category:n[0]==="l"||n[0]==="d"?2:1}));continue;}
  if(/^(?:iastore|lastore|fastore|dastore|aastore|bastore|castore|sastore)$/.test(n)){pop(3,x.pc);continue;}
  if(n==="arraylength"){const a=pop(1,x.pc)[0];push(origin("calculated-value",{pc:x.pc,operator:"arraylength",operands:[publicOrigin(a,0)],descriptor:"I",category:1}));continue;}
  if(n==="checkcast"){const a=pop(1,x.pc)[0];push(origin("cast-value",{pc:x.pc,receiver:publicOrigin(a,0),descriptor:x.className||null,category:1}));continue;}
  if(n==="instanceof"){const a=pop(1,x.pc)[0];push(origin("instanceof-result",{pc:x.pc,receiver:publicOrigin(a,0),descriptor:"Z",category:1}));continue;}
  if(n==="monitorenter"||n==="monitorexit"||n==="athrow"){pop(1,x.pc);continue;}
  if(n==="return")continue;
  if(n==="ireturn"||n==="freturn"||n==="areturn"||n==="lreturn"||n==="dreturn"){pop(1,x.pc);continue;}
  if(n==="tableswitch"||n==="lookupswitch"){const k=pop(1,x.pc)[0];branch={pc:x.pc,opcode:n,branchKind:"switch-key",operandOrigins:[publicOrigin(k,0)],unknownOperandCount:k.kind==="unknown-stack-entry"?1:0};break;}
  unsupported="unsupported-opcode:"+n;break;
 }
 if(unsupported)return {status:"unsupported",reason:unsupported,instructionCount,unknownStackEntries,branch:null};
 if(!branch||branch.pc!==targetPc)return {status:"branch-not-reached",reason:"target-branch-instruction-not-found-in-basic-block",instructionCount,unknownStackEntries,branch:null};
 branch.operandCountExpected=branch.operandOrigins.length;
 branch.operandOrigins=branch.operandOrigins.map((v,i)=>Object.assign({position:i===0?(branch.operandOrigins.length===2?"left-or-lower":"single"):"right-or-upper"},v));
 return {status:branch.unknownOperandCount===0?"resolved":"partial",reason:branch.unknownOperandCount?"one-or-more-operands-come-from-unreconstructed-block-entry-stack":null,instructionCount,unknownStackEntries,branch};
}
function analyze(input,options){
 input=input&&typeof input==="object"?input:{};options=options&&typeof options==="object"?options:{};
 const flow=input.controlFlow||{},classes=arr(input.classes),classMap=new Map();
 for(const entry of classes){const c=entry&&entry.classInfo?entry.classInfo:entry;if(c&&c.valid===true&&safe(c.className))classMap.set(norm(c.className),c);}
 const methodLimit=Math.min(MAX_METHODS,Number.isInteger(options.methodLimit)&&options.methodLimit>0?options.methodLimit:MAX_METHODS);
 const branches=[],totals={writerMethodsSeen:0,writerMethodsAnalyzed:0,writerMethodsMissing:0,methodsWithoutVerifiedCfg:0,methodsDecodeErrors:0,branchesSeen:0,branchesResolved:0,branchesPartial:0,branchesUnsupported:0,branchesMissing:0,operandOriginsReported:0,instructionsProcessed:0,detailsTruncated:false};
 let methodsProcessed=0,branchBudget=0;
 for(const writer of arr(flow.writers)){
  if(methodsProcessed>=methodLimit){totals.detailsTruncated=true;break;}
  methodsProcessed++;totals.writerMethodsSeen++;
  if(!writer||!safe(writer.sourceClass)||!safe(writer.methodName))continue;
  const c=classMap.get(norm(writer.sourceClass));if(!c){totals.writerMethodsMissing++;continue;}
  const m=arr(c.methods).find(x=>x&&x.name===writer.methodName&&(x.descriptor||null)===(writer.methodDescriptor||null));
  if(!m||!m.code||m.code.decodeError){totals.methodsDecodeErrors++;continue;}
  const verification=m.code.verification;
  if(!verification||verification.valid!==true||verification.structuralOnly!==true||!verification.controlFlow){totals.methodsWithoutVerifiedCfg++;continue;}
  const basicBlocks=arr(verification.controlFlow.basicBlocks),instructions=arr(m.code.instructions);
  const branchMap=new Map();
  for(const wr of arr(writer.writes))for(const candidate of arr(wr.controlDependenceCandidates)){
   const key=String(candidate.branchBlockId)+":"+String(candidate.branchPc);
   if(!branchMap.has(key))branchMap.set(key,{blockId:candidate.branchBlockId,pc:candidate.branchPc,opcode:candidate.branchOpcode,relatedWrites:[]});
   const row=branchMap.get(key);
   if(row.relatedWrites.length<32&&!row.relatedWrites.some(x=>x.pc===wr.pc&&x.fieldName===wr.fieldName))row.relatedWrites.push({pc:wr.pc,fieldName:wr.fieldName,edgeKind:candidate.successorEdgeKind,successorBlockId:candidate.successorBlockId});
  }
  const branchRows=[];
  for(const candidate of branchMap.values()){
   totals.branchesSeen++;
   if(branchBudget>=MAX_BRANCHES){totals.detailsTruncated=true;break;}
   branchBudget++;
   const block=basicBlocks.find(b=>b&&b.id===candidate.blockId);
   if(!block||!Number.isInteger(candidate.pc)){totals.branchesMissing++;branchRows.push({branchBlockId:candidate.blockId,pc:candidate.pc,status:"branch-location-missing",relatedWrites:candidate.relatedWrites,operandOrigins:[]});continue;}
   const targetIns=instructions.find(x=>x&&x.pc===candidate.pc);
   if(!targetIns||targetIns.name!==candidate.opcode){totals.branchesMissing++;branchRows.push({branchBlockId:candidate.blockId,pc:candidate.pc,opcode:candidate.opcode,status:"branch-instruction-mismatch",relatedWrites:candidate.relatedWrites,operandOrigins:[]});continue;}
   const remainingInstructionBudget=Math.max(0,MAX_INSTRUCTIONS-totals.instructionsProcessed);
   const result=simulate(instructions,block,candidate.pc,m,remainingInstructionBudget);
   totals.instructionsProcessed+=result.instructionCount||0;
   if(result.status==="resolved")totals.branchesResolved++;
   else if(result.status==="partial")totals.branchesPartial++;
   else totals.branchesUnsupported++;
   if(result.branch)totals.operandOriginsReported+=result.branch.operandOrigins.length;
   branchRows.push({branchBlockId:candidate.blockId,pc:candidate.pc,opcode:candidate.opcode,status:result.status,reason:result.reason||null,branch:result.branch,relatedWrites:candidate.relatedWrites,instructionCount:result.instructionCount,unknownStackEntries:result.unknownStackEntries});
  }
  if(branchRows.length)branches.push({methodId:writer.methodId,sourceClass:writer.sourceClass,methodName:writer.methodName,methodDescriptor:writer.methodDescriptor,cfgStatus:writer.cfg&&writer.cfg.status||null,branches:branchRows});
 }
 totals.writerMethodsOmitted=Math.max(0,arr(flow.writers).length-methodsProcessed);
 totals.detailsTruncated=totals.detailsTruncated||totals.branchesSeen>MAX_BRANCHES;
 return {schema:"jar2zeus.machine-condition-operands.v1",status:totals.branchesResolved?"comparison-operand-origins-resolved":totals.branchesPartial?"comparison-operand-origins-partial":totals.branchesUnsupported?"comparison-operand-analysis-limited": "no-control-flow-branch-candidates",supportStatus:"bounded-basic-block-local-abstract-stack-origin-tracing",sourceControlFlowSchema:flow.schema||null,methods:branches,manualTasks:[{area:"incoming-operand-stack",status:"not-reconstructed",reason:"Each basic block is analyzed independently. Values carried into a block from predecessor blocks are represented as unknown stack entries."},{area:"runtime-values",status:"not-recovered",reason:"The analyzer reports static origins such as local slots, field reads, constants, calculations and method results. It does not execute Java or evaluate values/branch outcomes."},{area:"control-flow-merges",status:"not-reconstructed",reason:"Stack/local value merging across predecessor paths, exception handlers and loop iterations is outside this bounded single-block analysis."}],limitations:["Only a defined subset of JVM instructions is simulated; unsupported stack operations or opcodes mark the branch unresolved.","Local variables are tracked only within the selected basic block; incoming local slots are symbolic parameters or unknown locals.","A resolved origin means the instruction's source was traced within this block, not that its runtime value is known.","Method invocations are represented as symbolic call results; callee behavior and return values are not analyzed here.","No Java method execution, runtime value recovery, branch outcome prediction, event hook generation or live telemetry access occurs."],totals,javaMethodsExecuted:false,comparisonOperandsRecovered:true,comparisonRuntimeValuesRecovered:false,branchOutcomesRecovered:false,assignmentValuesRecovered:false,updateTimingRecovered:false,sourceRuntimeValuesRecovered:false,sourceReaderCallbacksGenerated:0,eventPublicationsWired:0,liveValuesConnected:false,arbitraryJavaBlockEntityAccess:false,reportFile:"machine-condition-operands-plan.json"};
}
root.Jar2ZeusMachineConditionOperands={analyze:analyze};
})(typeof globalThis!=="undefined"?globalThis:this);
