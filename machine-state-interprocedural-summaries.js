/* Bounded interprocedural summaries for helper-call origins (Phase 32).
 * Resolves only exact, same-JAR static/private straight-line helper bodies.
 * This is symbolic bytecode inspection, never Java execution or runtime evaluation.
 */
(function(root){
"use strict";
const BLOCKED=/(?:cannon|artillery|projectile|munition|firearm|weapon|rifle|pistol|musket|sword|bow|crossbow|trident)/i;
const MAX_METHODS=300,MAX_CALLS=1200,MAX_SUMMARIES=400,MAX_INSTRUCTIONS=20000,MAX_TOTAL_INSTRUCTIONS=50000,MAX_STACK=128,MAX_DEPTH=8,MAX_NODES=64;
const LOAD=/^(?:[ilfda]load)(?:_[0-3])?$/;
const STORE=/^(?:[ilfda]store)(?:_[0-3])?$/;
const BINARY=new Set(["iadd","ladd","fadd","dadd","isub","lsub","fsub","dsub","imul","lmul","fmul","dmul","idiv","ldiv","fdiv","ddiv","irem","lrem","frem","drem","ishl","lshl","ishr","lshr","iushr","lushr","iand","land","ior","lor","ixor","lxor"]);
const UNARY=new Set(["ineg","lneg","fneg","dneg","i2l","i2f","i2d","l2i","l2f","l2d","f2i","f2l","f2d","d2i","d2l","d2f","i2b","i2c","i2s"]);
const COMPARES=new Set(["lcmp","fcmpl","fcmpg","dcmpl","dcmpg"]);
function arr(v){return Array.isArray(v)?v:[];}
function safe(v){return typeof v==="string"&&v.length>0&&v.length<=240&&!BLOCKED.test(v);}
function norm(v){return String(v||"").replace(/\./g,"/").replace(/^L|;$/g,"");}
function origin(kind,data){return Object.assign({kind:kind},data||{});}
function parseType(desc,pos,allowVoid){
 let p=pos,dims=0;
 while(desc[p]==="["){dims++;p++;if(dims>255)return null;}
 const ch=desc[p++];
 if("ZBCSIF".includes(ch))return {descriptor:desc.slice(pos,p),category:1,next:p,kind:dims?"reference":ch};
 if(ch==="J"||ch==="D")return {descriptor:desc.slice(pos,p),category:dims?1:2,next:p,kind:dims?"reference":ch};
 if(ch==="L"){const end=desc.indexOf(";",p);if(end<=p)return null;return {descriptor:desc.slice(pos,end+1),category:1,next:end+1,kind:"reference"};}
 if(ch==="V"&&allowVoid&&!dims)return {descriptor:"V",category:0,next:p,kind:"void"};
 return null;
}
function parseMethod(desc){
 if(typeof desc!=="string"||desc[0]!=="(")return null;
 let p=1;const args=[];
 while(p<desc.length&&desc[p]!==")"){const t=parseType(desc,p,false);if(!t)return null;args.push(t);p=t.next;}
 if(desc[p++]!==")")return null;
 const result=parseType(desc,p,true);
 if(!result||result.next!==desc.length)return null;
 return {args:args,result:result};
}
function compact(v,depth){
 if(!v||typeof v!=="object")return {kind:"unknown-value"};
 if(depth>MAX_DEPTH)return {kind:"truncated-origin"};
 const out={kind:typeof v.kind==="string"?v.kind:"unknown-value"};
 const keys=["pc","slot","storedFromPc","parameterIndex","descriptor","owner","name","opcode","operator","constantKind","constantValue","constantLength","methodName","methodOwner","methodDescriptor","methodOpcode","fieldStatic","arrayType","category","reason","resolutionStatus","resolutionReason","callSitePc"];
 for(const k of keys)if(v[k]!==undefined&&v[k]!==null)out[k]=v[k];
 if(v.receiver)out.receiver=compact(v.receiver,depth+1);
 for(const k of ["operands","arguments","inputs"])if(Array.isArray(v[k]))out[k]=v[k].slice(0,MAX_NODES).map(x=>compact(x,depth+1));
 return out;
}
function localSlot(x){
 const n=String(x.name||"");
 let m=/^[ilfda](?:load|store)_([0-3])$/.exec(n);
 if(m)return Number(m[1]);
 if(/^(?:iload|lload|fload|dload|aload|istore|lstore|fstore|dstore|astore)$/.test(n)||x.wideOpcode!=null)return Number.isInteger(x.local)?x.local:x.operand;
 return null;
}
function constant(x){
 const n=String(x.name||"");
 if(n==="aconst_null")return origin("null-constant",{pc:x.pc,descriptor:"Ljava/lang/Object;",category:1});
 if(n==="iconst_m1")return origin("constant",{pc:x.pc,constantKind:"integer",constantValue:-1,descriptor:"I",category:1});
 let m=/^iconst_([0-5])$/.exec(n);
 if(m)return origin("constant",{pc:x.pc,constantKind:"integer",constantValue:Number(m[1]),descriptor:"I",category:1});
 m=/^lconst_([01])$/.exec(n);if(m)return origin("constant",{pc:x.pc,constantKind:"long",constantValue:Number(m[1]),descriptor:"J",category:2});
 m=/^fconst_([012])$/.exec(n);if(m)return origin("constant",{pc:x.pc,constantKind:"float",constantValue:Number(m[1]),descriptor:"F",category:1});
 m=/^dconst_([01])$/.exec(n);if(m)return origin("constant",{pc:x.pc,constantKind:"double",constantValue:Number(m[1]),descriptor:"D",category:2});
 if(n==="bipush"||n==="sipush")return Number.isFinite(Number(x.operand))?origin("constant",{pc:x.pc,constantKind:"integer",constantValue:Number(x.operand),descriptor:"I",category:1}):null;
 if(n==="ldc"||n==="ldc_w"||n==="ldc2_w"){
  const tag=Number(x.constantTag),desc=tag===5?"J":tag===6?"D":tag===4?"F":tag===3?"I":tag===8?"Ljava/lang/String;":tag===7?"Ljava/lang/Class;":"";
  const category=tag===5||tag===6?2:tag===3||tag===4||tag===7||tag===8?1:null;
  if(category==null)return null;
  const data={pc:x.pc,constantKind:tag===8?"string":tag===7?"class":tag===5?"long":tag===6?"double":tag===4?"float":"integer",descriptor:desc,category:category};
  if(typeof x.constant==="number"&&Number.isFinite(x.constant))data.constantValue=x.constant;
  else if(typeof x.constant==="string")data.constantLength=x.constant.length;
  return origin("constant",data);
 }
 return null;
}
function expectedCategory(op){return op[0]==="l"||op[0]==="d"?2:1;}
function seedLocals(method,parsed){
 const map=new Map();let slot=Number(method.accessFlags)&8?0:1;
 if(!(Number(method.accessFlags)&8))map.set(0,origin("this",{slot:0,descriptor:"Ljava/lang/Object;",category:1}));
 parsed.args.forEach((t,i)=>{map.set(slot,origin("method-parameter",{slot:slot,parameterIndex:i,descriptor:t.descriptor,category:t.category}));slot+=t.category;});
 return map;
}
function summarizeMethod(method){
 const code=method&&method.code,verification=code&&code.verification,cf=verification&&verification.controlFlow;
 if(!method||!code||code.decodeError||!verification||verification.valid!==true||verification.structuralOnly!==true||!cf)return {ok:false,reason:"helper-bytecode-not-structurally-verified"};
 if(arr(cf.basicBlocks).length!==1||arr(cf.edges).length!==0)return {ok:false,reason:"helper-has-control-flow-or-multiple-blocks"};
 if(arr(code.exceptionTable||code.exceptions).length)return {ok:false,reason:"helper-has-exception-handlers"};
 const parsed=parseMethod(method.descriptor||"");if(!parsed)return {ok:false,reason:"helper-method-descriptor-invalid"};
 if(parsed.result.category===0)return {ok:false,reason:"helper-returns-void"};
 const instructions=arr(code.instructions).filter(x=>x&&Number.isInteger(x.pc)).slice().sort((a,b)=>a.pc-b.pc);
 if(!instructions.length||instructions.length>MAX_INSTRUCTIONS)return {ok:false,reason:"helper-instruction-limit-or-empty"};
 const stack=[],locals=seedLocals(method,parsed);
 let result=null,returnPc=null,reason=null;
 function fail(r){reason=r;}
 function push(v){if(stack.length>=MAX_STACK){fail("helper-stack-limit-exceeded");return;}stack.push(compact(v,0));}
 function pop(category,pc){
  if(!stack.length){fail("helper-stack-underflow");return origin("unknown-value",{pc,category:category});}
  const v=stack.pop();
  if(category!=null&&v.category!==category){fail("helper-operand-category-mismatch");return origin("unknown-value",{pc,category:category});}
  return v;
 }
 function localValue(slot,pc,cat){
  const v=locals.get(slot);
  if(!v){fail("helper-local-slot-unresolved");return origin("unknown-value",{slot:slot,pc,category:cat});}
  if(cat!=null&&v.category!==cat){fail("helper-local-category-mismatch");return origin("unknown-value",{slot:slot,pc,category:cat});}
  return compact(v,0);
 }
 for(let i=0;i<instructions.length;i++){
  const x=instructions[i],n=String(x.name||"");
  if(reason)break;
  const cv=constant(x);if(cv){push(cv);continue;}
  if(LOAD.test(n)){const slot=localSlot(x),cat=expectedCategory(n);if(!Number.isInteger(slot)||slot<0){fail("helper-local-load-invalid");break;}push(localValue(slot,x.pc,cat));continue;}
  if(STORE.test(n)){const slot=localSlot(x),cat=expectedCategory(n);if(!Number.isInteger(slot)||slot<0){fail("helper-local-store-invalid");break;}const v=pop(cat,x.pc);locals.set(slot,origin(v.kind,Object.assign({},v,{slot:slot,storedFromPc:v.pc,pc:x.pc,category:cat})));if(cat===2)locals.delete(slot+1);continue;}
  if(n==="iinc"){
   const slot=Number(x.local),inc=Number(x.increment);
   if(!Number.isInteger(slot)||slot<0||!Number.isFinite(inc)){fail("helper-iinc-invalid");break;}
   const before=localValue(slot,x.pc,1);
   locals.set(slot,origin("calculated-value",{pc:x.pc,operator:"iinc",operands:[before,origin("constant",{constantKind:"integer",constantValue:inc,descriptor:"I",category:1})],descriptor:"I",category:1}));continue;
  }
  if(n==="nop")continue;
  if(n==="getstatic"||n==="getfield"){
   const mm=x.member||{},type=typeof mm.descriptor==="string"?parseType(mm.descriptor,0,false):null;
   if(mm.kind!=="field"||!safe(norm(mm.owner))||!safe(mm.name)||!safe(mm.descriptor)||!type||type.next!==mm.descriptor.length){fail("helper-field-reference-invalid");break;}
   const receiver=n==="getfield"?pop(1,x.pc):null;
   push(origin("field-read",{pc:x.pc,opcode:n,owner:norm(mm.owner),name:mm.name,descriptor:mm.descriptor,fieldStatic:n==="getstatic",receiver:receiver,category:type.category}));continue;
  }
  if(BINARY.has(n)){
   const cat=expectedCategory(n),shift=/^(?:ishl|ishr|iushr|lshl|lshr|lushr)$/.test(n);
   const right=pop(shift?1:cat,x.pc),left=pop(cat,x.pc);
   const desc=cat===2?(n[0]==="l"?"J":"D"):(n[0]==="f"?"F":"I");
   push(origin("calculated-value",{pc:x.pc,operator:n,operands:[left,right],descriptor:desc,category:cat}));continue;
  }
  if(UNARY.has(n)){
   const cat=expectedCategory(n),a=pop(cat,x.pc);
   const dest={i2l:"J",i2f:"F",i2d:"D",l2i:"I",l2f:"F",l2d:"D",f2i:"I",f2l:"J",f2d:"D",d2i:"I",d2l:"J",d2f:"F",i2b:"I",i2c:"I",i2s:"I"}[n]||(n[0]==="l"?"J":n[0]==="d"?"D":n[0]==="f"?"F":"I");
   push(origin("calculated-value",{pc:x.pc,operator:n,operands:[a],descriptor:dest,category:dest==="J"||dest==="D"?2:1}));continue;
  }
  if(COMPARES.has(n)){const cat=expectedCategory(n),right=pop(cat,x.pc),left=pop(cat,x.pc);push(origin("comparison-result",{pc:x.pc,operator:n,operands:[left,right],descriptor:"I",category:1}));continue;}
  if(n==="checkcast"||n==="instanceof"){
   if(!safe(String(x.className||""))){fail("helper-cast-type-unsafe-or-missing");break;}
   const value=pop(1,x.pc);
   if(n==="checkcast")push(origin("cast-value",{pc:x.pc,receiver:value,descriptor:String(x.className),category:1}));
   else push(origin("instanceof-result",{pc:x.pc,receiver:value,descriptor:"Z",category:1}));
   continue;
  }
  if(n==="pop"){const v=pop(null,x.pc);if(v.category!==1)fail("helper-invalid-pop-category");continue;}
  if(n==="dup"){const v=pop(1,x.pc);push(v);push(v);continue;}
  if(n==="swap"){const a=pop(1,x.pc),b=pop(1,x.pc);push(a);push(b);continue;}
  if(/^(?:ireturn|lreturn|freturn|dreturn|areturn)$/.test(n)){
   const cat=n==="lreturn"||n==="dreturn"?2:1;
   const returnKind=parsed.result.kind;
   const opcodeMatches=(n==="ireturn"&&"ZBCSI".includes(returnKind))||(n==="lreturn"&&returnKind==="J")||(n==="freturn"&&returnKind==="F")||(n==="dreturn"&&returnKind==="D")||(n==="areturn"&&returnKind==="reference");
   if(!opcodeMatches){fail("helper-return-type-mismatch");break;}
   result=pop(cat,x.pc);returnPc=x.pc;
   if(stack.length!==0){fail("helper-return-stack-not-empty");break;}
   if(i!==instructions.length-1){fail("helper-has-instructions-after-return");break;}
   break;
  }
  if(n==="return"){fail("helper-void-return-mismatch");break;}
  fail("helper-unsupported-opcode:"+n);
 }
 if(reason)return {ok:false,reason:reason};
 if(!result||returnPc==null)return {ok:false,reason:"helper-return-not-recovered"};
 if(result.kind==="unknown-value"||result.kind==="unknown-stack-entry")return {ok:false,reason:"helper-return-origin-unknown"};
 return {ok:true,expression:compact(result,0),returnPc: returnPc,instructionCount:instructions.length,methodId:String(method.name||"")+String(method.descriptor||"")};
}
function substitute(expr,args,receiver,depth){
 if(depth>MAX_DEPTH)return origin("unknown-value",{reason:"helper-summary-substitution-depth-limit"});
 if(!expr||typeof expr!=="object")return origin("unknown-value");
 if(expr.kind==="method-parameter"){
  const v=args[Number(expr.parameterIndex)];
  return v?compact(v,0):origin("unknown-value",{reason:"helper-argument-origin-missing",parameterIndex:expr.parameterIndex});
 }
 if(expr.kind==="this")return receiver?compact(receiver,0):origin("unknown-value",{reason:"helper-receiver-origin-missing"});
 const out=compact(expr,0);
 if(expr.receiver)out.receiver=substitute(expr.receiver,args,receiver,depth+1);
 for(const k of ["operands","arguments","inputs"])if(Array.isArray(expr[k]))out[k]=expr[k].slice(0,MAX_NODES).map(v=>substitute(v,args,receiver,depth+1));
 if(out.kind==="unknown-value"||out.kind==="truncated-origin")return out;
 return out;
}
function findMethod(c,name,descriptor){
 return arr(c&&c.methods).find(m=>m&&m.name===name&&(m.descriptor||null)===(descriptor||null))||null;
}
function analyze(input,options){
 input=input&&typeof input==="object"?input:{};options=options&&typeof options==="object"?options:{};
 const phase31=input.crossBlockDataflow||{},classes=arr(input.classes),classMap=new Map();
 for(const entry of classes){const c=entry&&entry.classInfo?entry.classInfo:entry;if(c&&c.valid===true&&safe(c.className))classMap.set(norm(c.className),c);}
 const methodLimit=Math.min(MAX_METHODS,Number.isInteger(options.methodLimit)&&options.methodLimit>0?options.methodLimit:MAX_METHODS);
 const callLimit=Math.min(MAX_CALLS,Number.isInteger(options.callLimit)&&options.callLimit>0?options.callLimit:MAX_CALLS);
 const summaryLimit=Math.min(MAX_SUMMARIES,Number.isInteger(options.summaryLimit)&&options.summaryLimit>0?options.summaryLimit:MAX_SUMMARIES);
 const summaryCache=new Map(),summaryRows=new Map(),callRows=[],methods=[];
 const totals={methodsSeen:0,methodsAnalyzed:0,branchesSeen:0,branchesWithHelperCalls:0,methodResultsSeen:0,methodResultsResolved:0,methodResultsUnresolved:0,helperSummariesResolved:0,helperSummariesRejected:0,helperInstructionsAnalyzed:0,callsOmitted:0,detailsTruncated:false};
 let calls=0,summaryCount=0;
 function resolveCall(node,callerClass,callerMethod){
  totals.methodResultsSeen++;
  const callPc=Number(node.pc),owner=norm(node.methodOwner),name=String(node.methodName||""),desc=String(node.methodDescriptor||"");
  const unresolved=(reason)=>{totals.methodResultsUnresolved++;callRows.push({callerClass:callerClass.className,callerMethod:callerMethod.name,callSitePc:Number.isInteger(callPc)?callPc:null,methodOwner:owner,methodName:name,methodDescriptor:desc,status:"unresolved",reason:reason});const out=compact(node,0);out.resolutionStatus="unresolved";out.resolutionReason=reason;return out;};
  if(calls>=callLimit){totals.callsOmitted++;totals.detailsTruncated=true;return unresolved("helper-call-limit-exceeded");}
  calls++;
  if(!Number.isInteger(callPc)||!safe(owner)||!safe(name)||name==="<init>"||name==="<clinit>")return unresolved("unsafe-or-invalid-helper-reference");
  const callerCode=callerMethod.code,ins=arr(callerCode&&callerCode.instructions).find(x=>x&&x.pc===callPc);
  if(!ins||!(ins.name==="invokestatic"||ins.name==="invokespecial"))return unresolved("invocation-dispatch-not-exact");
  const member=ins.member||{};
  if(member.kind!=="method"||norm(member.owner)!==owner||member.name!==name||member.descriptor!==desc)return unresolved("callsite-reference-mismatch");
  if(owner!==norm(callerClass.className))return unresolved("helper-owner-not-caller-class");
  const targetDescriptor=parseMethod(desc),callArgs=arr(node.arguments);
  if(!targetDescriptor||callArgs.length!==targetDescriptor.args.length)return unresolved("helper-argument-count-mismatch");
  for(let i=0;i<callArgs.length;i++)if(callArgs[i]&&callArgs[i].category!=null&&callArgs[i].category!==targetDescriptor.args[i].category)return unresolved("helper-argument-category-mismatch");
  if(ins.name==="invokestatic"&&node.receiver)return unresolved("static-helper-has-unexpected-receiver");
  if(ins.name==="invokespecial"&&!node.receiver)return unresolved("private-helper-receiver-missing");
  const targetClass=classMap.get(owner);if(!targetClass)return unresolved("helper-class-not-in-jar");
  const target=findMethod(targetClass,name,desc);if(!target)return unresolved("helper-method-not-found");
  const flags=Number(target.accessFlags)||0;
  if(flags&0x0400||flags&0x0100)return unresolved("abstract-or-native-helper");
  if(ins.name==="invokestatic"&&!(flags&0x0008))return unresolved("invokestatic-target-not-static");
  if(ins.name==="invokespecial"&&((flags&0x0008)||!(flags&0x0002)))return unresolved("invokespecial-target-not-private-instance-method");
  const key=owner+"."+name+desc;
  let summary=summaryCache.get(key);
  if(!summary){
   if(summaryCount>=summaryLimit){totals.detailsTruncated=true;return unresolved("helper-summary-limit-exceeded");}
   summaryCount++;
   summary=summarizeMethod(target);
   if(summary.ok&&totals.helperInstructionsAnalyzed+summary.instructionCount>MAX_TOTAL_INSTRUCTIONS)summary={ok:false,reason:"aggregate-helper-instruction-budget-exceeded"};
   summaryCache.set(key,summary);
   if(summary.ok){totals.helperSummariesResolved++;totals.helperInstructionsAnalyzed+=summary.instructionCount;}
   else totals.helperSummariesRejected++;
   summaryRows.set(key,{methodOwner:owner,methodName:name,methodDescriptor:desc,status:summary.ok?"resolved":"rejected",reason:summary.reason||null,expression:summary.ok?summary.expression:null,instructionsAnalyzed:summary.instructionCount||0});
  }
  if(!summary.ok)return unresolved(summary.reason||"helper-summary-unavailable");
  const args=arr(node.arguments).map(x=>compact(x,0)),receiver=node.receiver?compact(node.receiver,0):null;
  const expression=substitute(summary.expression,args,receiver,0);
  if(expression.kind==="unknown-value")return unresolved("helper-summary-arguments-not-substituted");
  totals.methodResultsResolved++;
  callRows.push({callerClass:callerClass.className,callerMethod:callerMethod.name,callSitePc:callPc,invocationOpcode:ins.name,methodOwner:owner,methodName:name,methodDescriptor:desc,status:"resolved"});
  return {kind:"interprocedural-summary-result",pc:callPc,methodOwner:owner,methodName:name,methodDescriptor:desc,methodOpcode:ins.name,callSitePc:callPc,descriptor:node.descriptor||null,category:node.category==null?null:node.category,expression:expression,resolutionStatus:"resolved"};
 }
 function walk(node,callerClass,callerMethod,depth){
  if(depth>MAX_DEPTH||!node||typeof node!=="object")return node;
  if(node.kind==="method-result"){
   const prepared=compact(node,0);
   if(Array.isArray(prepared.arguments))prepared.arguments=prepared.arguments.map(x=>walk(x,callerClass,callerMethod,depth+1));
   if(prepared.receiver)prepared.receiver=walk(prepared.receiver,callerClass,callerMethod,depth+1);
   return resolveCall(prepared,callerClass,callerMethod);
  }
  const out=compact(node,0);
  if(node.receiver)out.receiver=walk(node.receiver,callerClass,callerMethod,depth+1);
  for(const k of ["operands","arguments","inputs"])if(Array.isArray(node[k]))out[k]=node[k].slice(0,MAX_NODES).map(x=>walk(x,callerClass,callerMethod,depth+1));
  return out;
 }
 const reportRows=arr(phase31.methods);
 for(const row of reportRows){
  if(totals.methodsSeen>=methodLimit){totals.detailsTruncated=true;break;}
  totals.methodsSeen++;
  if(!row||!safe(row.sourceClass)||!safe(row.methodName))continue;
  const callerClass=classMap.get(norm(row.sourceClass));if(!callerClass)continue;
  const callerMethod=findMethod(callerClass,row.methodName,row.methodDescriptor);
  if(!callerMethod||!callerMethod.code)continue;
  const branches=[];
  for(const branch of arr(row.branches)){
   totals.branchesSeen++;
   const before=totals.methodResultsSeen;
   const operandOrigins=arr(branch.operandOrigins).map(v=>walk(v,callerClass,callerMethod,0));
   const found=totals.methodResultsSeen-before;
   if(found)totals.branchesWithHelperCalls++;
   branches.push(Object.assign({},branch,{operandOrigins,helperCallsSeen:found,helperCallsResolved:operandOrigins.reduce((n,v)=>n+countResolved(v),0)}));
  }
  totals.methodsAnalyzed++;
  methods.push({sourceClass:row.sourceClass,methodName:row.methodName,methodDescriptor:row.methodDescriptor,branches:branches});
 }
 function countResolved(v,depth){
  if(!v||typeof v!=="object"||depth>MAX_DEPTH)return 0;
  let n=v.kind==="interprocedural-summary-result"&&v.resolutionStatus==="resolved"?1:0;
  for(const k of ["receiver","expression"])if(v[k])n+=countResolved(v[k],depth+1);
  for(const k of ["operands","arguments","inputs"])for(const x of arr(v[k]))n+=countResolved(x,depth+1);
  return n;
 }
 totals.detailsTruncated=totals.detailsTruncated||reportRows.length>methodLimit||calls>=callLimit;
 return {schema:"jar2zeus.machine-state-interprocedural-summaries.v1",status:totals.methodResultsResolved?"helper-call-origins-expanded":totals.methodResultsSeen?"helper-call-origins-partial":"no-eligible-helper-calls",supportStatus:"bounded-exact-dispatch-straight-line-helper-summary",sourceCrossBlockSchema:phase31.schema||null,helperCallsInspected:true,interproceduralOriginsRecovered:totals.methodResultsResolved>0,methods:methods,calls:callRows,helperSummaries:Array.from(summaryRows.values()),manualTasks:[{area:"conditional-helpers",status:"unresolved",reason:"Methods with branches, loops, multiple basic blocks, exception handlers or unsupported instructions are not summarized."},{area:"dynamic-dispatch",status:"unresolved",reason:"Only exact invokestatic and same-class private invokespecial calls are eligible; virtual/interface dispatch is not guessed."},{area:"runtime-state",status:"not-recovered",reason:"Summaries preserve symbolic field/parameter/calculation origins only; they do not evaluate Java or retrieve runtime machine values."}],limitations:["Only exact same-class helper references in the uploaded JAR are considered.","Only invokestatic and same-class private invokespecial calls are eligible; virtual, interface, inherited and dynamic calls remain unresolved.","Only structurally verified single-basic-block helpers with no exception handlers and a supported straight-line instruction subset are summarized.","Helper calls inside helper bodies, writes, object construction, array operations, branches, loops and unsupported bytecode stop summary extraction.","Parameter and receiver substitution preserves symbolic origins, not runtime values or proof of runtime dispatch.","Method, call, summary, instruction, stack, recursion and expression sizes are bounded.","No Java execution, runtime value recovery, branch outcome prediction, state assignment recovery, update timing, callback generation, event publication or live telemetry occurs."],totals:totals,javaMethodsExecuted:false,runtimeValuesRecovered:false,comparisonRuntimeValuesRecovered:false,branchOutcomesRecovered:false,assignmentValuesRecovered:false,updateTimingRecovered:false,sourceRuntimeValuesRecovered:false,sourceReaderCallbacksGenerated:0,eventPublicationsWired:0,liveValuesConnected:false,arbitraryJavaBlockEntityAccess:false,reportFile:"machine-state-interprocedural-summaries-plan.json"};
}
root.Jar2ZeusMachineStateInterproceduralSummaries={analyze:analyze};
})(typeof globalThis!=="undefined"?globalThis:this);
