/* Bounded nested helper summaries for machine-state operand origins (Phase 33).
 * Resolves acyclic same-class static/private helper call trees using verified straight-line bytecode only.
 * Symbolic origin analysis only: never executes Java or evaluates runtime values.
 */
(function(root){
"use strict";
const BLOCKED=/(?:cannon|artillery|projectile|munition|firearm|weapon|rifle|pistol|musket|sword|bow|crossbow|trident)/i;
const MAX_METHODS=300,MAX_TOP_CALLS=1200,MAX_TOTAL_CALLS=2400,MAX_SUMMARIES=400;
const MAX_METHOD_INSTRUCTIONS=20000,MAX_TOTAL_INSTRUCTIONS=50000,MAX_STACK=128;
const MAX_NESTED_DEPTH=6,MAX_EXPR_DEPTH=8,MAX_EXPR_ITEMS=64;
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
 if(depth>MAX_EXPR_DEPTH)return {kind:"truncated-origin"};
 const out={kind:typeof v.kind==="string"?v.kind:"unknown-value"};
 const keys=["pc","slot","storedFromPc","parameterIndex","descriptor","owner","name","opcode","operator","constantKind","constantValue","constantLength","methodName","methodOwner","methodDescriptor","methodOpcode","fieldStatic","arrayType","category","reason","resolutionStatus","resolutionReason","callSitePc","nestedDepth","nestedCallsResolved"];
 for(const k of keys)if(v[k]!==undefined&&v[k]!==null)out[k]=v[k];
 if(v.receiver)out.receiver=compact(v.receiver,depth+1);
 if(v.expression)out.expression=compact(v.expression,depth+1);
 for(const k of ["operands","arguments","inputs"])if(Array.isArray(v[k]))out[k]=v[k].slice(0,MAX_EXPR_ITEMS).map(x=>compact(x,depth+1));
 return out;
}
function localSlot(x){
 const n=String(x.name||"");let m=/^[ilfda](?:load|store)_([0-3])$/.exec(n);
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
function substitute(expr,args,receiver,depth){
 if(depth>MAX_EXPR_DEPTH)return origin("unknown-value",{reason:"helper-summary-substitution-depth-limit"});
 if(!expr||typeof expr!=="object")return origin("unknown-value");
 if(expr.kind==="method-parameter"){
  const v=args[Number(expr.parameterIndex)];
  if(!v||v.category!=null&&expr.category!=null&&v.category!==expr.category)return origin("unknown-value",{reason:"helper-argument-origin-missing-or-category-mismatch",parameterIndex:expr.parameterIndex});
  return compact(v,0);
 }
 if(expr.kind==="this")return receiver?compact(receiver,0):origin("unknown-value",{reason:"helper-receiver-origin-missing"});
 const out=compact(expr,0);
 if(expr.receiver)out.receiver=substitute(expr.receiver,args,receiver,depth+1);
 if(expr.expression)out.expression=substitute(expr.expression,args,receiver,depth+1);
 for(const k of ["operands","arguments","inputs"])if(Array.isArray(expr[k]))out[k]=expr[k].slice(0,MAX_EXPR_ITEMS).map(v=>substitute(v,args,receiver,depth+1));
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
 const topCallLimit=Math.min(MAX_TOP_CALLS,Number.isInteger(options.topCallLimit)&&options.topCallLimit>0?options.topCallLimit:MAX_TOP_CALLS);
 const totalCallLimit=Math.min(MAX_TOTAL_CALLS,Number.isInteger(options.totalCallLimit)&&options.totalCallLimit>0?options.totalCallLimit:MAX_TOTAL_CALLS);
 const summaryLimit=Math.min(MAX_SUMMARIES,Number.isInteger(options.summaryLimit)&&options.summaryLimit>0?options.summaryLimit:MAX_SUMMARIES);
 const cache=new Map(),summaryRows=new Map(),callRows=[],methodRows=[];
 const totals={methodsSeen:0,methodsAnalyzed:0,branchesSeen:0,topLevelCallsSeen:0,topLevelCallsResolved:0,topLevelCallsUnresolved:0,nestedCallsSeen:0,nestedCallsResolved:0,nestedCallsUnresolved:0,recursiveCyclesDetected:0,depthLimitHits:0,helperMethodsResolved:0,helperMethodsRejected:0,helperInstructionsAnalyzed:0,detailsTruncated:false};
 let callCount=0,summaryCount=0;
 function recordCall(row,level){
  callRows.push(row);
  if(level===0){if(row.status==="resolved")totals.topLevelCallsResolved++;else totals.topLevelCallsUnresolved++;}
  else{if(row.status==="resolved")totals.nestedCallsResolved++;else totals.nestedCallsUnresolved++;}
 }
 function summarize(owner,method,depth,active){
  const name=String(method&&method.name||""),desc=String(method&&method.descriptor||""),key=owner+"."+name+desc;
  if(active.has(key)){totals.recursiveCyclesDetected++;return {ok:false,reason:"recursive-helper-cycle"};}
  if(depth>MAX_NESTED_DEPTH){totals.depthLimitHits++;return {ok:false,reason:"nested-helper-depth-limit-exceeded"};}
  if(cache.has(key))return cache.get(key);
  if(summaryCount>=summaryLimit){totals.detailsTruncated=true;return {ok:false,reason:"helper-summary-limit-exceeded"};}
  summaryCount++;
  const result=summarizeBody(owner,method,depth,active);
  if(result.ok){
   if(totals.helperInstructionsAnalyzed+result.instructionCount>MAX_TOTAL_INSTRUCTIONS){totals.detailsTruncated=true;result.ok=false;result.reason="aggregate-helper-instruction-budget-exceeded";}
   else{totals.helperInstructionsAnalyzed+=result.instructionCount;totals.helperMethodsResolved++;}
  }
  if(!result.ok)totals.helperMethodsRejected++;
  cache.set(key,result);
  summaryRows.set(key,{methodOwner:owner,methodName:name,methodDescriptor:desc,status:result.ok?"resolved":"rejected",reason:result.reason||null,expression:result.ok?result.expression:null,instructionsAnalyzed:result.instructionCount||0,nestedCalls:result.nestedCalls||0,maxNestedDepth:result.maxNestedDepth||0});
  return result;
 }
 function resolveNestedCall(x,owner,callerClass,callerMethod,stack,depth,active){
  totals.nestedCallsSeen++;
  if(callCount>=totalCallLimit){totals.detailsTruncated=true;return {ok:false,reason:"total-helper-call-limit-exceeded"};}
  callCount++;
  const n=String(x.name||""),mm=x.member||{},targetOwner=norm(mm.owner),targetName=String(mm.name||""),targetDesc=String(mm.descriptor||"");
  const reject=reason=>({ok:false,reason:reason});
  if(n!=="invokestatic"&&n!=="invokespecial")return reject("nested-invocation-dispatch-not-exact");
  if(mm.kind!=="method"||!safe(targetOwner)||!safe(targetName)||targetName==="<init>"||targetName==="<clinit>")return reject("nested-helper-reference-invalid");
  if(targetOwner!==owner)return reject("nested-helper-owner-not-same-class");
  const targetDescriptor=parseMethod(targetDesc);if(!targetDescriptor||targetDescriptor.result.category===0)return reject("nested-helper-descriptor-invalid-or-void");
  const targetClass=classMap.get(targetOwner);if(!targetClass)return reject("nested-helper-class-not-in-jar");
  const target=findMethod(targetClass,targetName,targetDesc);if(!target)return reject("nested-helper-method-not-found");
  const flags=Number(target.accessFlags)||0;
  if(flags&0x0400||flags&0x0100)return reject("nested-helper-abstract-or-native");
  if(n==="invokestatic"&&!(flags&0x0008))return reject("nested-invokestatic-target-not-static");
  if(n==="invokespecial"&&((flags&0x0008)||!(flags&0x0002)))return reject("nested-invokespecial-target-not-private-instance-method");
  if(stack.length<targetDescriptor.args.length+(n==="invokespecial"?1:0))return reject("nested-helper-call-stack-underflow");
  const args=new Array(targetDescriptor.args.length);
  for(let i=targetDescriptor.args.length-1;i>=0;i--){
   const v=stack.pop();if(!v||v.category!==targetDescriptor.args[i].category)return reject("nested-helper-argument-category-mismatch");args[i]=v;
  }
  const receiver=n==="invokespecial"?stack.pop():null;
  if(n==="invokespecial"&&(!receiver||receiver.category!==1))return reject("nested-helper-receiver-category-mismatch");
  const key=targetOwner+"."+targetName+targetDesc;
  if(active.has(key)){totals.recursiveCyclesDetected++;return reject("recursive-helper-cycle");}
  const summary=summarize(targetOwner,target,depth+1,active);
  if(!summary.ok)return reject(summary.reason||"nested-helper-summary-unavailable");
  const expression=substitute(summary.expression,args,receiver,0);
  if(expression.kind==="unknown-value"||expression.kind==="truncated-origin")return reject("nested-helper-substitution-unresolved");
  return {ok:true,value:origin("nested-helper-result",{pc:x.pc,methodOwner:targetOwner,methodName:targetName,methodDescriptor:targetDesc,methodOpcode:n,callSitePc:x.pc,descriptor:targetDescriptor.result.descriptor,category:targetDescriptor.result.category,expression:expression,nestedDepth:depth+1,nestedCallsResolved:summary.nestedCalls||0}),nestedCalls:1+(summary.nestedCalls||0),maxNestedDepth:Math.max(depth+1,summary.maxNestedDepth||0)};
 }
 function summarizeBody(owner,method,depth,active){
  const code=method&&method.code,verification=code&&code.verification,cf=verification&&verification.controlFlow;
  if(!method||!code||code.decodeError||!verification||verification.valid!==true||verification.structuralOnly!==true||!cf)return {ok:false,reason:"helper-bytecode-not-structurally-verified"};
  if(arr(cf.basicBlocks).length!==1||arr(cf.edges).length!==0)return {ok:false,reason:"helper-has-control-flow-or-multiple-blocks"};
  if(arr(code.exceptionTable||code.exceptions).length)return {ok:false,reason:"helper-has-exception-handlers"};
  const parsed=parseMethod(method.descriptor||"");if(!parsed)return {ok:false,reason:"helper-method-descriptor-invalid"};
  if(parsed.result.category===0)return {ok:false,reason:"helper-returns-void"};
  const instructions=arr(code.instructions).filter(x=>x&&Number.isInteger(x.pc)).slice().sort((a,b)=>a.pc-b.pc);
  if(!instructions.length||instructions.length>MAX_METHOD_INSTRUCTIONS)return {ok:false,reason:"helper-instruction-limit-or-empty"};
  const stack=[],locals=seedLocals(method,parsed);
  let result=null,returnPc=null,reason=null,nestedCalls=0,maxNestedDepth=depth;
  const nextActive=new Set(active);nextActive.add(owner+"."+String(method.name||"")+String(method.descriptor||""));
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
   if(n==="invokestatic"||n==="invokespecial"||n==="invokevirtual"||n==="invokeinterface"||n==="invokedynamic"){
    const nested=resolveNestedCall(x,owner,classMap.get(owner),method,stack,depth,nextActive);
    if(!nested.ok){fail(nested.reason||"nested-helper-unresolved");break;}
    push(nested.value);nestedCalls+=nested.nestedCalls||1;maxNestedDepth=Math.max(maxNestedDepth,nested.maxNestedDepth||depth+1);continue;
   }
   if(n==="pop"){const v=pop(null,x.pc);if(v.category!==1)fail("helper-invalid-pop-category");continue;}
   if(n==="dup"){const v=pop(1,x.pc);push(v);push(v);continue;}
   if(n==="swap"){const a=pop(1,x.pc),b=pop(1,x.pc);push(a);push(b);continue;}
   if(/^(?:ireturn|lreturn|freturn|dreturn|areturn)$/.test(n)){
    const cat=n==="lreturn"||n==="dreturn"?2:1,kind=parsed.result.kind;
    const opcodeMatches=(n==="ireturn"&&"ZBCSI".includes(kind))||(n==="lreturn"&&kind==="J")||(n==="freturn"&&kind==="F")||(n==="dreturn"&&kind==="D")||(n==="areturn"&&kind==="reference");
    if(!opcodeMatches){fail("helper-return-type-mismatch");break;}
    result=pop(cat,x.pc);returnPc=x.pc;
    if(stack.length!==0){fail("helper-return-stack-not-empty");break;}
    if(i!==instructions.length-1){fail("helper-has-instructions-after-return");break;}
    break;
   }
   if(n==="return"){fail("helper-void-return-mismatch");break;}
   fail("helper-unsupported-opcode:"+n);
  }
  if(reason)return {ok:false,reason:reason,instructionCount:instructions.length,nestedCalls:nestedCalls,maxNestedDepth:maxNestedDepth};
  if(!result||returnPc==null)return {ok:false,reason:"helper-return-not-recovered",instructionCount:instructions.length,nestedCalls:nestedCalls,maxNestedDepth:maxNestedDepth};
  if(result.kind==="unknown-value"||result.kind==="unknown-stack-entry"||result.kind==="truncated-origin")return {ok:false,reason:"helper-return-origin-unknown",instructionCount:instructions.length,nestedCalls:nestedCalls,maxNestedDepth:maxNestedDepth};
  return {ok:true,expression:compact(result,0),returnPc:returnPc,instructionCount:instructions.length,nestedCalls:nestedCalls,maxNestedDepth:maxNestedDepth,methodId:String(method.name||"")+String(method.descriptor||"")};
 }
 function resolveTopCall(node,callerClass,callerMethod,active){
  totals.topLevelCallsSeen++;
  if(callCount>=topCallLimit||callCount>=totalCallLimit){totals.detailsTruncated=true;return unresolvedNode(node,"top-level-helper-call-limit-exceeded",callerClass,callerMethod,0);}
  callCount++;
  return resolveCallNode(node,callerClass,callerMethod,0,active,true);
 }
 function unresolvedNode(node,reason,callerClass,callerMethod,level){
  recordCall({callerClass:callerClass.className,callerMethod:callerMethod.name,callSitePc:Number.isInteger(Number(node.pc))?Number(node.pc):null,methodOwner:norm(node.methodOwner),methodName:String(node.methodName||""),methodDescriptor:String(node.methodDescriptor||""),depth:level,status:"unresolved",reason:reason},level);
  const out=compact(node,0);out.resolutionStatus="unresolved";out.resolutionReason=reason;return out;
 }
 function resolveCallNode(node,callerClass,callerMethod,level,active,isTop){
  const callPc=Number(node.pc),owner=norm(node.methodOwner),name=String(node.methodName||""),desc=String(node.methodDescriptor||"");
  const reject=reason=>unresolvedNode(node,reason,callerClass,callerMethod,level);
  if(level>MAX_NESTED_DEPTH){totals.depthLimitHits++;return reject("nested-helper-depth-limit-exceeded");}
  if(!Number.isInteger(callPc)||!safe(owner)||!safe(name)||name==="<init>"||name==="<clinit>")return reject("helper-reference-invalid");
  const callInstruction=arr(callerMethod.code&&callerMethod.code.instructions).find(x=>x&&x.pc===callPc);
  if(!callInstruction||!(callInstruction.name==="invokestatic"||callInstruction.name==="invokespecial"))return reject("invocation-dispatch-not-exact");
  const member=callInstruction.member||{};
  if(member.kind!=="method"||norm(member.owner)!==owner||member.name!==name||member.descriptor!==desc)return reject("callsite-reference-mismatch");
  if(owner!==norm(callerClass.className))return reject("helper-owner-not-same-class");
  const targetDescriptor=parseMethod(desc);
  if(!targetDescriptor||targetDescriptor.result.category===0)return reject("helper-descriptor-invalid-or-void");
  if(node.descriptor&&node.descriptor!==targetDescriptor.result.descriptor)return reject("helper-return-descriptor-mismatch");
  const args=arr(node.arguments);
  if(args.length!==targetDescriptor.args.length)return reject("helper-argument-count-mismatch");
  for(let i=0;i<args.length;i++)if(!args[i]||args[i].category!=null&&args[i].category!==targetDescriptor.args[i].category)return reject("helper-argument-category-mismatch");
  const receiver=node.receiver?compact(node.receiver,0):null;
  if(callInstruction.name==="invokestatic"&&receiver)return reject("static-helper-has-unexpected-receiver");
  if(callInstruction.name==="invokespecial"&&(!receiver||receiver.category!==1))return reject("private-helper-receiver-missing-or-invalid");
  const targetClass=classMap.get(owner);if(!targetClass)return reject("helper-class-not-in-jar");
  const target=findMethod(targetClass,name,desc);if(!target)return reject("helper-method-not-found");
  const flags=Number(target.accessFlags)||0;
  if(flags&0x0400||flags&0x0100)return reject("abstract-or-native-helper");
  if(callInstruction.name==="invokestatic"&&!(flags&0x0008))return reject("invokestatic-target-not-static");
  if(callInstruction.name==="invokespecial"&&((flags&0x0008)||!(flags&0x0002)))return reject("invokespecial-target-not-private-instance-method");
  const key=owner+"."+name+desc;
  const summary=summarize(owner,target,level,new Set(active));
  if(!summary.ok)return reject(summary.reason||"helper-summary-unavailable");
  const expression=substitute(summary.expression,args,receiver,0);
  if(expression.kind==="unknown-value"||expression.kind==="truncated-origin")return reject("helper-summary-substitution-unresolved");
  totals.helperInstructionsAnalyzed=Math.min(MAX_TOTAL_INSTRUCTIONS,totals.helperInstructionsAnalyzed);
  recordCall({callerClass:callerClass.className,callerMethod:callerMethod.name,callSitePc:callPc,invocationOpcode:callInstruction.name,methodOwner:owner,methodName:name,methodDescriptor:desc,depth:level,status:"resolved",nestedCalls:summary.nestedCalls||0},level);
  return {kind:isTop?"interprocedural-summary-result":"nested-helper-result",pc:callPc,methodOwner:owner,methodName:name,methodDescriptor:desc,methodOpcode:callInstruction.name,callSitePc:callPc,descriptor:targetDescriptor.result.descriptor,category:targetDescriptor.result.category,expression:expression,nestedDepth:summary.maxNestedDepth||level,nestedCallsResolved:summary.nestedCalls||0,resolutionStatus:"resolved"};
 }
 function walkOrigin(node,callerClass,callerMethod,depth){
  if(depth>MAX_EXPR_DEPTH||!node||typeof node!=="object")return node;
  if(node.kind==="method-result")return resolveTopCall(node,callerClass,callerMethod,new Set());
  const out=compact(node,0);
  if(node.receiver)out.receiver=walkOrigin(node.receiver,callerClass,callerMethod,depth+1);
  if(node.expression)out.expression=walkOrigin(node.expression,callerClass,callerMethod,depth+1);
  for(const k of ["operands","arguments","inputs"])if(Array.isArray(node[k]))out[k]=node[k].slice(0,MAX_EXPR_ITEMS).map(v=>walkOrigin(v,callerClass,callerMethod,depth+1));
  return out;
 }
 function countNested(v,depth){
  if(!v||typeof v!=="object"||depth>MAX_EXPR_DEPTH)return 0;
  let n=(v.kind==="nested-helper-result"||v.kind==="interprocedural-summary-result")&&v.resolutionStatus==="resolved"?1:0;
  if(v.receiver)n+=countNested(v.receiver,depth+1);
  if(v.expression)n+=countNested(v.expression,depth+1);
  for(const k of ["operands","arguments","inputs"])for(const x of arr(v[k]))n+=countNested(x,depth+1);
  return n;
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
   const origins=arr(branch.operandOrigins).map(v=>walkOrigin(v,callerClass,callerMethod,0));
   branches.push(Object.assign({},branch,{operandOrigins:origins,helperCallsResolved:origins.reduce((n,v)=>n+countNested(v,0),0)}));
  }
  totals.methodsAnalyzed++;
  methodRows.push({sourceClass:row.sourceClass,methodName:row.methodName,methodDescriptor:row.methodDescriptor,branches:branches});
 }
 totals.detailsTruncated=totals.detailsTruncated||reportRows.length>methodLimit||callCount>=totalCallLimit||callCount>=topCallLimit;
 return {schema:"jar2zeus.machine-state-nested-helper-summaries.v1",status:totals.topLevelCallsResolved?"nested-helper-origins-expanded":totals.topLevelCallsSeen?"nested-helper-origins-partial":"no-eligible-helper-calls",supportStatus:"bounded-acyclic-same-class-helper-call-tree",sourceCrossBlockSchema:phase31.schema||null,sourceInterproceduralSchema:"jar2zeus.machine-state-interprocedural-summaries.v1",nestedHelperCallsInspected:true,nestedHelperOriginsRecovered:totals.nestedCallsResolved>0,methods:methodRows,calls:callRows,helperSummaries:Array.from(summaryRows.values()),manualTasks:[{area:"control-flow-helpers",status:"unresolved",reason:"Helpers with branches, loops, multiple basic blocks or exception handlers remain unresolved."},{area:"recursive-helpers",status:"unresolved",reason:"Cyclic call graphs are detected and rejected; recursion is never executed or approximated."},{area:"dynamic-dispatch",status:"unresolved",reason:"Only exact invokestatic and same-class private invokespecial calls are eligible; virtual/interface/inherited/dynamic calls remain unresolved."},{area:"runtime-state",status:"not-recovered",reason:"Nested summaries preserve symbolic field/parameter/calculation origins only; runtime machine values are not evaluated."}],limitations:["Only exact same-class helper calls in the uploaded JAR are considered.","Only invokestatic and same-class private invokespecial helper calls are eligible.","Every summarized helper must have valid structural bytecode verification, one basic block and no exception handlers.","Branches, loops, exception handlers, nested array/object semantics, state writes and unsupported opcodes stop the affected summary.","Recursive/cyclic helper graphs, excessive depth, call counts, summary counts, instructions, stack height or expression size remain unresolved.","Method arguments and receiver are substituted symbolically; no Java method is executed and no runtime result is calculated.","No runtime values, branch outcomes, final assignments, update timing, callbacks, event publication or live telemetry are recovered/generated."],totals:totals,javaMethodsExecuted:false,runtimeValuesRecovered:false,comparisonRuntimeValuesRecovered:false,branchOutcomesRecovered:false,assignmentValuesRecovered:false,updateTimingRecovered:false,sourceRuntimeValuesRecovered:false,sourceReaderCallbacksGenerated:0,eventPublicationsWired:0,liveValuesConnected:false,arbitraryJavaBlockEntityAccess:false,reportFile:"machine-state-nested-helper-summaries-plan.json"};
}
root.Jar2ZeusMachineStateNestedHelperSummaries={analyze:analyze};
})(typeof globalThis!=="undefined"?globalThis:this);
