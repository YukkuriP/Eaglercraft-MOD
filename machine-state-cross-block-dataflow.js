/* Bounded inter-block static data-flow for machine-condition operand origins (Phase 31).
 * Uses only verifier CFG structure and a conservative abstract JVM subset.
 * Never executes Java, evaluates runtime values, or predicts branch outcomes.
 */
(function(root){
"use strict";
const BLOCKED=/(?:cannon|artillery|projectile|munition|firearm|weapon|rifle|pistol|musket|sword|bow|crossbow|trident)/i;
const MAX_METHODS=300,MAX_BRANCHES=900,MAX_BLOCKS=256,MAX_EDGES=2048,MAX_ITERATIONS=64,MAX_INSTRUCTIONS=50000,MAX_STACK=128,MAX_ORIGINS=4,MAX_DEPTH=3;
const CONDITIONAL=/^(?:ifeq|ifne|iflt|ifge|ifgt|ifle|if_icmpeq|if_icmpne|if_icmplt|if_icmpge|if_icmpgt|if_icmple|if_acmpeq|if_acmpne|ifnull|ifnonnull)$/;
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
 if("ZBCSIF".includes(ch))return {descriptor:desc.slice(pos,p),category:1,kind:dims?"reference":ch,next:p};
 if(ch==="J"||ch==="D")return {descriptor:desc.slice(pos,p),category:dims?1:2,kind:dims?"reference":ch,next:p};
 if(ch==="L"){const e=desc.indexOf(";",p);if(e<0||e===p)return null;return {descriptor:desc.slice(pos,e+1),category:1,kind:"reference",next:e+1};}
 if(ch==="V"&&allowVoid&&!dims)return {descriptor:"V",category:0,kind:"void",next:p};
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
function origin(kind,data){return Object.assign({kind},data||{});}
function compact(v,depth){
 if(!v||typeof v!=="object")return {kind:"unknown-value"};
 if(depth>MAX_DEPTH)return {kind:"truncated-origin",category:v.category==null?null:v.category};
 const out={kind:v.kind||"unknown-value"};
 for(const k of ["pc","storedFromPc","slot","parameterIndex","descriptor","owner","name","opcode","operator","constantKind","constantValue","constantLength","methodName","methodOwner","methodDescriptor","fieldStatic","arrayType","detail","category","reason"])if(v[k]!==undefined&&v[k]!==null)out[k]=v[k];
 if(v.receiver)out.receiver=compact(v.receiver,depth+1);
 for(const k of ["operands","arguments","inputs"])if(Array.isArray(v[k]))out[k]=v[k].slice(0,MAX_ORIGINS).map(x=>compact(x,depth+1));
 return out;
}
function key(v){return JSON.stringify(compact(v,0));}
function mergeValue(a,b){
 if(key(a)===key(b))return compact(a,0);
 const ca=compact(a,0),cb=compact(b,0),cat=ca.category===cb.category?ca.category:null;
 if(ca.kind==="unknown-value"||ca.kind==="unknown-stack-entry"||ca.kind==="unknown-exception"||cb.kind==="unknown-value"||cb.kind==="unknown-stack-entry"||cb.kind==="unknown-exception")return origin("unknown-value",{category:cat,reason:"one-or-more-predecessor-values-are-unknown"});
 let inputs=[];
 for(const v of [ca,cb]){const list=v.kind==="merged-value"&&Array.isArray(v.inputs)?v.inputs:[v];for(const item of list){const k=key(item);if(!inputs.some(x=>key(x)===k)&&inputs.length<MAX_ORIGINS)inputs.push(item);}}
 return origin("merged-value",{category:cat,inputs,alternativesTruncated:inputs.length>=MAX_ORIGINS});
}
function localSlot(x){
 const n=String(x.name||""),m=/^[ilfda](?:load|store)_([0-3])$/.exec(n);
 if(m)return Number(m[1]);
 if(/^(?:iload|lload|fload|dload|aload|istore|lstore|fstore|dstore|astore|ret)$/.test(n)||x.wideOpcode!=null)return Number.isInteger(x.local)?x.local:x.operand;
 return null;
}
function initialLocals(method){
 const map=new Map(),parsed=parseMethod(method.descriptor||"");
 if(!parsed)return null;
 let slot=Number(method.accessFlags)&8?0:1;
 if(!(Number(method.accessFlags)&8))map.set(0,origin("this",{slot:0,descriptor:"Ljava/lang/Object;",category:1}));
 parsed.args.forEach((t,i)=>{map.set(slot,origin("method-parameter",{slot,parameterIndex:i,descriptor:t.descriptor,category:t.category}));slot+=t.category;});
 return map;
}
function cloneState(s){return {stack:s.stack.map(x=>compact(x,0)),locals:new Map(Array.from(s.locals.entries()).map(([k,v])=>[k,compact(v,0)])),valid:s.valid,reason:s.reason||null};}
function stateKey(s){return JSON.stringify({valid:s.valid,reason:s.reason,stack:s.stack.map(x=>compact(x,0)),locals:Array.from(s.locals.entries()).sort((a,b)=>a[0]-b[0]).map(([k,v])=>[k,compact(v,0)])});}
function mergeStates(states){
 if(!states.length)return null;
 const good=states.filter(Boolean);if(!good.length)return null;
 if(good.some(s=>!s.valid))return {stack:[],locals:new Map(),valid:false,reason:"predecessor-state-unresolved"};
 const height=good[0].stack.length;
 if(good.some(s=>s.stack.length!==height))return {stack:[],locals:new Map(),valid:false,reason:"incompatible-operand-stack-heights-at-merge"};
 const merged={stack:[],locals:new Map(),valid:true,reason:null};
 for(let i=0;i<height;i++){
  const vals=good.map(s=>s.stack[i]);const cats=new Set(vals.map(v=>v.category==null?"?":String(v.category)));
  if(cats.size!==1)return {stack:[],locals:new Map(),valid:false,reason:"incompatible-operand-category-at-merge"};
  let v=vals[0];for(let j=1;j<vals.length;j++)v=mergeValue(v,vals[j]);merged.stack.push(v);
 }
 const slots=new Set();for(const s of good)for(const k of s.locals.keys())slots.add(k);
 for(const slot of slots){let v=good[0].locals.get(slot)||origin("unknown-value",{slot,reason:"local-not-defined-on-all-predecessors"});for(let j=1;j<good.length;j++)v=mergeValue(v,good[j].locals.get(slot)||origin("unknown-value",{slot,reason:"local-not-defined-on-all-predecessors"}));merged.locals.set(slot,v);}
 return merged;
}
function methodParamsForUnknown(method,slot,pc){
 const init=initialLocals(method);return init&&init.has(slot)?Object.assign({},init.get(slot),{pc}):origin("unknown-value",{slot,pc,reason:"incoming-local-value-not-reconstructed"});
}
function simulateBlock(instructions,block,startState,method,instructionBudget,branchTargets){
 const state=cloneState(startState),ins=arr(instructions).filter(x=>x&&Number.isInteger(x.pc)&&x.pc>=block.start&&x.pc<block.end).sort((a,b)=>a.pc-b.pc);
 let count=0,reason=null;
 const fail=r=>{reason=r;};
 function push(v){if(state.stack.length>=MAX_STACK){fail("operand-stack-limit-exceeded");return;}state.stack.push(compact(v,0));}
 function pop(cat,pc){
  if(!state.stack.length)return origin("unknown-stack-entry",{pc,category:cat,reason:"empty-stack-after-cfg-merge"});
  const v=state.stack.pop();
  if(cat!=null&&v.category!=null&&v.category!==cat){fail("operand-category-mismatch");return origin("unknown-value",{pc,category:cat,reason:"operand-category-mismatch"});}
  return v;
 }
 function localValue(slot,pc,cat){let v=state.locals.get(slot);if(!v)v=methodParamsForUnknown(method,slot,pc);if(cat!=null&&v.category!=null&&v.category!==cat){fail("local-category-mismatch");return origin("unknown-value",{slot,pc,category:cat});}return compact(Object.assign({},v,{pc,slot}),0);}
 function constValue(x){
  const n=x.name||"";
  if(n==="aconst_null")return origin("null-constant",{pc:x.pc,descriptor:"Ljava/lang/Object;",category:1});
  if(n==="iconst_m1")return origin("constant",{pc:x.pc,constantKind:"integer",constantValue:-1,descriptor:"I",category:1});
  let m=/^iconst_([0-5])$/.exec(n);if(m)return origin("constant",{pc:x.pc,constantKind:"integer",constantValue:Number(m[1]),descriptor:"I",category:1});
  m=/^lconst_([01])$/.exec(n);if(m)return origin("constant",{pc:x.pc,constantKind:"long",constantValue:Number(m[1]),descriptor:"J",category:2});
  m=/^fconst_([012])$/.exec(n);if(m)return origin("constant",{pc:x.pc,constantKind:"float",constantValue:Number(m[1]),descriptor:"F",category:1});
  m=/^dconst_([01])$/.exec(n);if(m)return origin("constant",{pc:x.pc,constantKind:"double",constantValue:Number(m[1]),descriptor:"D",category:2});
  if(n==="bipush"||n==="sipush")return origin("constant",{pc:x.pc,constantKind:"integer",constantValue:Number(x.operand),descriptor:"I",category:1});
  if(n==="ldc"||n==="ldc_w"||n==="ldc2_w"){
   const tag=Number(x.constantTag),desc=tag===5?"J":tag===6?"D":tag===4?"F":tag===3?"I":tag===8?"Ljava/lang/String;":tag===7?"Ljava/lang/Class;":"";
   const kind=tag===8?"string":tag===7?"class":tag===5?"long":tag===6?"double":tag===4?"float":tag===3?"integer":"dynamic";
   const o={pc:x.pc,constantKind:kind,descriptor:desc||null,category:n==="ldc2_w"||tag===5||tag===6?2:1};
   if(typeof x.constant==="number"&&Number.isFinite(x.constant))o.constantValue=x.constant;
   else if(typeof x.constant==="string")o.constantLength=x.constant.length;
   return origin("constant",o);
  }
  return null;
 }
 for(const x of ins){
  if(count>=instructionBudget){fail("instruction-budget-exceeded");break;}count++;
  const n=String(x.name||"");const cv=constValue(x);if(cv){push(cv);continue;}
  if(LOAD.test(n)){const slot=localSlot(x),cat=n[0]==="l"||n[0]==="d"?2:1;if(!Number.isInteger(slot)||slot<0){fail("invalid-local-load");break;}push(localValue(slot,x.pc,cat));continue;}
  if(STORE.test(n)){const slot=localSlot(x),cat=n[0]==="l"||n[0]==="d"?2:1;if(!Number.isInteger(slot)||slot<0){fail("invalid-local-store");break;}const v=pop(cat,x.pc);state.locals.set(slot,origin(v.kind,Object.assign({},v,{slot,storedFromPc:v.pc,pc:x.pc,category:cat})));if(cat===2)state.locals.delete(slot+1);continue;}
  if(n==="iinc"){const slot=Number(x.local);if(!Number.isInteger(slot)||slot<0){fail("invalid-iinc-local");break;}const cur=localValue(slot,x.pc,1);if(["merged-value","calculated-value","unknown-value"].includes(cur.kind))state.locals.set(slot,origin("unknown-value",{slot,pc:x.pc,category:1,reason:"loop-carried-iinc-merged-input"}));else state.locals.set(slot,origin("calculated-value",{pc:x.pc,operator:"iinc",operands:[cur,origin("constant",{constantKind:"integer",constantValue:Number(x.increment),descriptor:"I",category:1})],descriptor:"I",category:1}));continue;}
  if(n==="nop"||n==="goto"||n==="goto_w")continue;
  if(n==="pop"){const v=pop(null,x.pc);if(v.category!==1)fail("invalid-pop-category");continue;}
  if(n==="pop2"){const a=pop(null,x.pc);if(a.category===1){const b=pop(null,x.pc);if(b.category!==1)fail("invalid-pop2-category");}else if(a.category!==2)fail("unknown-pop2-category");continue;}
  if(n==="dup"){const a=pop(1,x.pc);push(a);push(a);continue;}
  if(n==="swap"){const a=pop(1,x.pc),b=pop(1,x.pc);push(a);push(b);continue;}
  if(n==="dup2"){const a=pop(null,x.pc);if(a.category===2){push(a);push(a);}else if(a.category===1){const b=pop(1,x.pc);push(b);push(a);push(b);push(a);}else fail("unknown-dup2-category");continue;}
  if(n==="getstatic"||n==="getfield"){
   const mm=x.member||{};if(mm.kind!=="field"||!safe(mm.owner)||!safe(mm.name)){fail("unsafe-or-invalid-field-reference");break;}
   const recv=n==="getfield"?pop(1,x.pc):null,desc=mm.descriptor||"",t=parseType(desc,0,false);
   if(!t){fail("invalid-field-descriptor");break;}
   push(origin("field-read",{pc:x.pc,opcode:n,owner:clean(norm(mm.owner),180),name:clean(mm.name,100),descriptor:clean(desc,180),fieldStatic:n==="getstatic",receiver:recv,category:t.category}));continue;
  }
  if(n==="putfield"){pop(null,x.pc);pop(1,x.pc);continue;}
  if(n==="putstatic"){pop(null,x.pc);continue;}
  if(INVOKE.has(n)){
   const mm=x.member||{},desc=n==="invokedynamic"?x.dynamic&&x.dynamic.descriptor:mm.descriptor,p=parseMethod(desc);
   if(!p){fail("invalid-invocation-descriptor");break;}
   const args=[];for(let i=p.args.length-1;i>=0;i--)args.unshift(pop(p.args[i].category,x.pc));
   let receiver=null;if(n!=="invokestatic"&&n!=="invokedynamic")receiver=pop(1,x.pc);
   const owner=mm.owner?norm(mm.owner):"<dynamic>",name=mm.name||x.dynamic&&x.dynamic.name||"invokedynamic";
   if(!safe(name)||(owner!=="<dynamic>"&&!safe(owner))){fail("unsafe-or-invalid-method-reference");break;}
   if(p.result.kind!=="void")push(origin("method-result",{pc:x.pc,methodOwner:clean(owner,180),methodName:clean(name,100),methodDescriptor:clean(desc,180),receiver,arguments:args,descriptor:p.result.descriptor,category:p.result.category}));
   continue;
  }
  if(BINARY.has(n)){const shift=/^(?:ishl|ishr|iushr|lshl|lshr|lushr)$/.test(n),cat=n[0]==="l"||n[0]==="d"?2:1,right=pop(shift?1:cat,x.pc),left=pop(cat,x.pc),desc=cat===2?(n[0]==="l"?"J":"D"):(n[0]==="f"?"F":"I");push(origin("calculated-value",{pc:x.pc,operator:n,operands:[left,right],descriptor:desc,category:cat}));continue;}
  if(UNARY.has(n)){const cat=n[0]==="l"||n[0]==="d"?2:1,a=pop(cat,x.pc),dest={i2l:"J",i2f:"F",i2d:"D",l2i:"I",l2f:"F",l2d:"D",f2i:"I",f2l:"J",f2d:"D",d2i:"I",d2l:"J",d2f:"F",i2b:"I",i2c:"I",i2s:"I"}[n]||(n[0]==="l"?"J":n[0]==="d"?"D":n[0]==="f"?"F":"I");push(origin("calculated-value",{pc:x.pc,operator:n,operands:[a],descriptor:dest,category:dest==="J"||dest==="D"?2:1}));continue;}
  if(COMPARES.has(n)){const cat=n[0]==="l"||n[0]==="d"?2:1,a=pop(cat,x.pc),b=pop(cat,x.pc);push(origin("comparison-result",{pc:x.pc,operator:n,operands:[b,a],descriptor:"I",category:1}));continue;}
  if(n==="new"){push(origin("new-object",{pc:x.pc,descriptor:clean(x.className||"",180)||null,category:1}));continue;}
  if(n==="newarray"||n==="anewarray"){const a=pop(1,x.pc);push(origin("new-array",{pc:x.pc,arrayType:n==="newarray"?"primitive":"reference",length:a,category:1}));continue;}
  if(n==="multianewarray"){const dims=Number(x.dimensions)||0,values=[];for(let i=0;i<dims;i++)values.unshift(pop(1,x.pc));push(origin("new-array",{pc:x.pc,arrayType:"multi",dimensions:dims,operands:values,category:1}));continue;}
  if(/^(?:iaload|laload|faload|daload|aaload|baload|caload|saload)$/.test(n)){const index=pop(1,x.pc),array=pop(1,x.pc),cat=n[0]==="l"||n[0]==="d"?2:1,desc=n[0]==="l"?"J":n[0]==="d"?"D":n[0]==="f"?"F":n[0]==="a"?"Ljava/lang/Object;":"I";push(origin("array-element",{pc:x.pc,operands:[array,index],descriptor:desc,category:cat}));continue;}
  if(/^(?:iastore|lastore|fastore|dastore|aastore|bastore|castore|sastore)$/.test(n)){pop(null,x.pc);pop(1,x.pc);pop(1,x.pc);continue;}
  if(n==="arraylength"){const a=pop(1,x.pc);push(origin("calculated-value",{pc:x.pc,operator:"arraylength",operands:[a],descriptor:"I",category:1}));continue;}
  if(n==="checkcast"){const a=pop(1,x.pc);push(origin("cast-value",{pc:x.pc,receiver:a,descriptor:clean(x.className||"",180)||null,category:1}));continue;}
  if(n==="instanceof"){const a=pop(1,x.pc);push(origin("instanceof-result",{pc:x.pc,receiver:a,descriptor:"Z",category:1}));continue;}
  if(n==="monitorenter"||n==="monitorexit"||n==="athrow"){pop(1,x.pc);continue;}
  if(CONDITIONAL.test(n)||n==="tableswitch"||n==="lookupswitch"){
   let count=1,kind="single-value-test";if(/^if_icmp/.test(n)){count=2;kind="integer-pair";}else if(/^if_acmp/.test(n)){count=2;kind="reference-pair";}else if(n==="ifnull"||n==="ifnonnull")kind="null-test";else if(n==="tableswitch"||n==="lookupswitch")kind="switch-key";
   const operands=[];for(let i=0;i<count;i++)operands.unshift(pop(1,x.pc));
   branchTargets.push({pc:x.pc,opcode:n,branchKind:kind,operandOrigins:operands.map(v=>compact(v,0)),unknownOperandCount:operands.filter(v=>/^(?:unknown-value|unknown-stack-entry)$/.test(v.kind)).length});
   break;
  }
  if(n==="return")continue;
  if(/^(?:ireturn|freturn|areturn|lreturn|dreturn)$/.test(n)){pop(null,x.pc);continue;}
  fail("unsupported-opcode:"+n);break;
 }
 if(reason)return {state:{stack:[],locals:new Map(),valid:false,reason},instructionCount:count,reason};
 return {state,instructionCount:count,reason:null};
}
function unknownExceptionState(){return {stack:[origin("unknown-exception",{category:1,reason:"exception-handler-entry"})],locals:new Map(),valid:true,reason:null};}
function analyze(input,options){
 input=input&&typeof input==="object"?input:{};options=options&&typeof options==="object"?options:{};
 const phase30=input.conditionOperands||{},classes=arr(input.classes),classMap=new Map();
 for(const entry of classes){const c=entry&&entry.classInfo?entry.classInfo:entry;if(c&&c.valid===true&&safe(c.className))classMap.set(norm(c.className),c);}
 const methodLimit=Math.min(MAX_METHODS,Number.isInteger(options.methodLimit)&&options.methodLimit>0?options.methodLimit:MAX_METHODS);
 const branchLimit=Math.min(MAX_BRANCHES,Number.isInteger(options.branchLimit)&&options.branchLimit>0?options.branchLimit:MAX_BRANCHES);
 const methods=[],totals={writerMethodsSeen:0,writerMethodsAnalyzed:0,writerMethodsMissing:0,methodsWithoutVerifiedCfg:0,methodsWithInvalidCfg:0,branchesSeen:0,branchesResolved:0,branchesPartial:0,branchesUnsupported:0,branchesMissing:0,blocksAnalyzed:0,blocksUnresolved:0,dataFlowIterations:0,instructionsProcessed:0,mergedValuesReported:0,exceptionEdgesSeen:0,loopBlocksSeen:0,detailsTruncated:false};
 let methodCount=0,branchCount=0;
 for(const methodRow of arr(phase30.methods)){
  if(methodCount>=methodLimit){totals.detailsTruncated=true;break;}methodCount++;totals.writerMethodsSeen++;
  if(!methodRow||!safe(methodRow.sourceClass)||!safe(methodRow.methodName))continue;
  const c=classMap.get(norm(methodRow.sourceClass));if(!c){totals.writerMethodsMissing++;continue;}
  const m=arr(c.methods).find(x=>x&&x.name===methodRow.methodName&&(x.descriptor||null)===(methodRow.methodDescriptor||null));
  const code=m&&m.code,verification=code&&code.verification,cf=verification&&verification.controlFlow;
  if(!code||code.decodeError||!verification||verification.valid!==true||verification.structuralOnly!==true||!cf){totals.methodsWithoutVerifiedCfg++;continue;}
  const blocks=arr(cf.basicBlocks),edges=arr(cf.edges),instructions=arr(code.instructions).filter(x=>x&&Number.isInteger(x.pc));
  if(!blocks.length||blocks.length>MAX_BLOCKS||edges.length>MAX_EDGES){totals.methodsWithInvalidCfg++;continue;}
  const byId=new Map();let shapeOk=true;
  for(const b of blocks){if(!b||!Number.isInteger(b.id)||!Number.isInteger(b.start)||!Number.isInteger(b.end)||b.end<=b.start||byId.has(b.id)){shapeOk=false;break;}byId.set(b.id,b);}
  const preds=new Map(blocks.map(b=>[b.id,[]])),succs=new Map(blocks.map(b=>[b.id,[]]));
  if(shapeOk)for(const e of edges){if(!e||!byId.has(e.from)||!byId.has(e.to)||typeof e.kind!=="string"){shapeOk=false;break;}preds.get(e.to).push(e);succs.get(e.from).push(e);}
  if(!shapeOk){totals.methodsWithInvalidCfg++;continue;}
  const entry=blocks.slice().sort((a,b)=>a.start-b.start)[0].id;
  const reachable=new Set(),q=[entry];while(q.length){const id=q.shift();if(reachable.has(id))continue;reachable.add(id);for(const e of succs.get(id)||[])if(!reachable.has(e.to))q.push(e.to);}
  const loopBlocks=new Set();for(const b of blocks)for(const e of succs.get(b.id)||[])if(e.to===b.id||byId.get(e.to).start<=b.start)loopBlocks.add(b.id);
  totals.loopBlocksSeen+=loopBlocks.size;
  totals.exceptionEdgesSeen+=edges.filter(e=>e.kind==="exception").length;
  if(reachable.size===0){totals.methodsWithInvalidCfg++;continue;}
  const inStates=new Map(),outStates=new Map();let converged=false,iterations=0,instructionBudget=Math.max(0,MAX_INSTRUCTIONS-totals.instructionsProcessed);
  const init=initialLocals(m);if(!init){totals.methodsWithInvalidCfg++;continue;}
  inStates.set(entry,{stack:[],locals:init,valid:true,reason:null});
  for(iterations=1;iterations<=MAX_ITERATIONS;iterations++){
   let changed=false;
   for(const block of blocks.slice().sort((a,b)=>a.start-b.start)){
    if(!reachable.has(block.id))continue;
    let incoming=[];
    if(block.id===entry)incoming.push({stack:[],locals:init,valid:true,reason:null});
    for(const edge of preds.get(block.id)||[]){
     if(!reachable.has(edge.from)||!outStates.has(edge.from))continue;
     if(edge.kind==="exception"){incoming.push(unknownExceptionState());continue;}
     incoming.push(outStates.get(edge.from));
    }
    if(!incoming.length)continue;
    const merged=mergeStates(incoming);if(!merged)continue;
    const prevIn=inStates.get(block.id);
    if(!prevIn||stateKey(prevIn)!==stateKey(merged)){inStates.set(block.id,merged);changed=true;}
    if(!merged.valid){if(!outStates.has(block.id)||outStates.get(block.id).valid!==false||outStates.get(block.id).reason!==merged.reason){outStates.set(block.id,{stack:[],locals:new Map(),valid:false,reason:merged.reason});changed=true;}continue;}
    const sink=[];const sim=simulateBlock(instructions,block,merged,m,instructionBudget,sink);
    totals.instructionsProcessed+=sim.instructionCount;instructionBudget=Math.max(0,instructionBudget-sim.instructionCount);
    if(instructionBudget<=0&&sim.reason!=="instruction-budget-exceeded"){sim.state.valid=false;sim.state.reason="aggregate-instruction-budget-exceeded";}
    const prevOut=outStates.get(block.id);
    if(!prevOut||stateKey(prevOut)!==stateKey(sim.state)){outStates.set(block.id,sim.state);changed=true;}
    if(instructionBudget<=0)break;
   }
   totals.dataFlowIterations++;
   if(!changed){converged=true;break;}
   if(instructionBudget<=0)break;
  }
  if(!converged){for(const block of blocks)if(reachable.has(block.id)&&inStates.has(block.id)){inStates.set(block.id,{stack:[],locals:new Map(),valid:false,reason:"data-flow-fixed-point-or-budget-limit"});outStates.set(block.id,{stack:[],locals:new Map(),valid:false,reason:"data-flow-fixed-point-or-budget-limit"});}}
  const branchRows=[];
  for(const candidate of arr(methodRow.branches)){
   if(branchCount>=branchLimit){totals.detailsTruncated=true;break;}branchCount++;totals.branchesSeen++;
   const block=byId.get(candidate.branchBlockId),pc=candidate.pc;
   if(!block||!Number.isInteger(pc)){totals.branchesMissing++;branchRows.push({branchBlockId:candidate.branchBlockId,pc,status:"branch-location-missing",operandOrigins:[]});continue;}
   const target=instructions.find(x=>x.pc===pc);
   if(!target||target.name!==candidate.opcode){totals.branchesMissing++;branchRows.push({branchBlockId:candidate.branchBlockId,pc,opcode:candidate.opcode,status:"branch-instruction-mismatch",operandOrigins:[]});continue;}
   const start=inStates.get(block.id);
   if(!start||!start.valid||!converged){totals.branchesUnsupported++;branchRows.push({branchBlockId:block.id,pc,opcode:candidate.opcode,status:"unsupported",reason:start&&start.reason||"block-entry-state-unresolved",operandOrigins:[],relatedWrites:candidate.relatedWrites||[]});continue;}
   const localSink=[],sim=simulateBlock(instructions,block,start,m,Math.max(0,MAX_INSTRUCTIONS-totals.instructionsProcessed),localSink);
   totals.instructionsProcessed+=sim.instructionCount;
   const branch=localSink.find(x=>x.pc===pc);
   if(sim.reason||!branch){totals.branchesUnsupported++;branchRows.push({branchBlockId:block.id,pc,opcode:candidate.opcode,status:"unsupported",reason:sim.reason||"branch-operands-not-recovered",operandOrigins:[],relatedWrites:candidate.relatedWrites||[]});continue;}
   const mergedCount=branch.operandOrigins.filter(v=>v.kind==="merged-value").length;
   const unknownCount=branch.operandOrigins.filter(v=>["unknown-value","unknown-stack-entry","unknown-exception","truncated-origin"].includes(v.kind)).length;
   const status=unknownCount?"partial":mergedCount?"partial":"resolved";
   totals["branches"+(status==="resolved"?"Resolved":"Partial")]++;
   totals.mergedValuesReported+=mergedCount;
   const operandOrigins=branch.operandOrigins.map((v,i)=>Object.assign({position:branch.operandOrigins.length===2?(i===0?"left-or-lower":"right-or-upper"):"single"},compact(v,0)));
   branchRows.push({branchBlockId:block.id,pc,opcode:candidate.opcode,status,reason:unknownCount?"one-or-more-origins-remain-unknown":mergedCount?"operand-has-multiple-static-predecessor-origins":null,branchKind:branch.branchKind,operandOrigins,unknownOperandCount:unknownCount,mergedOperandCount:mergedCount,relatedWrites:candidate.relatedWrites||[],dataFlowConverged:converged,iterations});
  }
  if(branchRows.length){totals.writerMethodsAnalyzed++;totals.blocksAnalyzed+=reachable.size;totals.blocksUnresolved+=Array.from(reachable).filter(id=>!inStates.has(id)||!inStates.get(id).valid).length;methods.push({methodId:methodRow.methodId||null,sourceClass:methodRow.sourceClass,methodName:methodRow.methodName,methodDescriptor:methodRow.methodDescriptor,cfg:{blockCount:blocks.length,edgeCount:edges.length,reachableBlockCount:reachable.size,exceptionEdges:edges.filter(e=>e.kind==="exception").length,loopCandidateBlocks:loopBlocks.size},dataFlow:{converged,iterations,limit:MAX_ITERATIONS,abstractExecutionOnly:true},branches:branchRows});}
 }
 totals.writerMethodsOmitted=Math.max(0,arr(phase30.methods).length-methodCount);
 totals.detailsTruncated=totals.detailsTruncated||totals.branchesSeen>branchLimit;
 return {schema:"jar2zeus.machine-state-cross-block-dataflow.v1",status:totals.branchesResolved?"cross-block-operand-origins-resolved":totals.branchesPartial?"cross-block-operand-origins-partial":totals.branchesUnsupported?"cross-block-dataflow-limited":"no-eligible-branch-candidates",supportStatus:"bounded-conservative-cfg-fixed-point-dataflow",sourceConditionOperandsSchema:phase30.schema||null,methods,manualTasks:[{area:"runtime-values",status:"not-recovered",reason:"This is abstract static data-flow only; runtime field values, calculations, object state and branch outcomes are not evaluated."},{area:"exception-paths",status:"conservative-unknown",reason:"Exception-handler incoming stacks and locals are treated as unknown; handler value provenance is not inferred."},{area:"loop-carried-values",status:"bounded",reason:"Loop iterations are bounded. Non-convergent or unsupported states remain unresolved; loop-carried updates are not evaluated."},{area:"method-calls",status:"symbolic-only",reason:"Method invocation results are symbolic origins; callees are not executed or recursively interpreted."}],limitations:["Only valid structural CFGs with bounded block/edge counts are analyzed.","Normal CFG edges carry abstract locals and operand stacks; exception edges reset locals and introduce an unknown exception object.","Stack-height and category mismatches at merges invalidate the affected state.","Only the explicitly supported JVM instruction subset is transferred; unsupported opcodes stop propagation for affected paths.","Merged values preserve a bounded set of static alternatives and do not imply that any alternative occurs at runtime.","Fixed-point, instruction, method, branch, stack and origin-size limits cause conservative unresolved results.","No Java execution, runtime value recovery, branch outcome prediction, assignment-value recovery, update timing, event wiring or live telemetry occurs."],totals,javaMethodsExecuted:false,crossBlockOriginsRecovered:true,runtimeValuesRecovered:false,comparisonRuntimeValuesRecovered:false,branchOutcomesRecovered:false,assignmentValuesRecovered:false,updateTimingRecovered:false,sourceRuntimeValuesRecovered:false,sourceReaderCallbacksGenerated:0,eventPublicationsWired:0,liveValuesConnected:false,arbitraryJavaBlockEntityAccess:false,reportFile:"machine-state-cross-block-dataflow-plan.json"};
}
root.Jar2ZeusMachineStateCrossBlockDataflow={analyze};
})(typeof globalThis!=="undefined"?globalThis:this);
