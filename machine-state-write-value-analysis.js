/* Static assignment-expression provenance at machine telemetry write sites.
 * Replays a narrow, straight-line symbolic stack only; never executes Java.
 */
(function(root){
"use strict";
const BLOCKED=/(?:cannon|artillery|projectile|munition|firearm|weapon|rifle|pistol|musket|sword|bow|crossbow|trident)/i;
const MAX_CLASSES=1000,MAX_WRITER_METHODS=1500,MAX_WRITE_SITES=3000,MAX_METHOD_INSTRUCTIONS=6000,MAX_TOTAL_INSTRUCTIONS=120000,MAX_DETAILS=1500,MAX_EXPRESSION_DEPTH=12,MAX_EXPRESSION_NODES=160;
const BINARY={
 iadd:"+",ladd:"+",fadd:"+",dadd:"+",
 isub:"-",lsub:"-",fsub:"-",dsub:"-",
 imul:"*",lmul:"*",fmul:"*",dmul:"*",
 idiv:"/",ldiv:"/",fdiv:"/",ddiv:"/",
 irem:"%",lrem:"%",frem:"%",drem:"%",
 ishl:"<<",lshl:"<<",ishr:">>",lshr:">>",iushr:">>>",lushr:">>>",
 iand:"&",land:"&",ior:"|",lor:"|",ixor:"^",lxor:"^"
};
const UNARY={
 ineg:"-",lneg:"-",fneg:"-",dneg:"-",
 i2l:"i2l",i2f:"i2f",i2d:"i2d",l2i:"l2i",l2f:"l2f",l2d:"l2d",
 f2i:"f2i",f2l:"f2l",f2d:"f2d",d2i:"d2i",d2l:"d2l",d2f:"d2f",
 i2b:"i2b",i2c:"i2c",i2s:"i2s"
};
function arr(v){return Array.isArray(v)?v:[];}
function safe(v){return typeof v==="string"&&!BLOCKED.test(v);}
function clean(v,max){return String(v==null?"":v).replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim().slice(0,max||180);}
function norm(v){return String(v||"").replace(/\./g,"/").replace(/^L|;$/g,"");}
function descriptorType(desc,pos){
 let p=pos||0,dims=0;
 while(desc[p]==="["){dims++;p++;if(dims>16)return null;}
 const c=desc[p++];
 if("ZBCSIF".includes(c))return {descriptor:desc.slice(pos||0,p),kind:dims?"reference":"number",slots:dims?1:1,next:p};
 if(c==="J"||c==="D")return {descriptor:desc.slice(pos||0,p),kind:dims?"reference":"number",slots:dims?1:2,next:p};
 if(c==="L"){
  const end=desc.indexOf(";",p);if(end<0||end===p)return null;
  return {descriptor:desc.slice(pos||0,end+1),kind:dims?"reference":"reference",slots:1,next:end+1};
 }
 return null;
}
function parseMethodDescriptor(desc){
 if(typeof desc!=="string"||desc[0]!=="(")return null;
 const args=[];let p=1,slots=0;
 while(p<desc.length&&desc[p]!==")"){
  const t=descriptorType(desc,p);if(!t)return null;
  args.push(t);slots+=t.slots;p=t.next;
  if(slots>255)return null;
 }
 if(desc[p++]!==")")return null;
 if(p>=desc.length)return null;
 if(desc[p]==="V")return p===desc.length-1?{args,result:{kind:"void",slots:0},argumentSlots:slots}:null;
 const result=descriptorType(desc,p);
 if(!result||result.next!==desc.length)return null;
 return {args,result,argumentSlots:slots};
}
function constant(ins){
 const n=ins.name||"";
 let m=/^iconst_(-1|0|1|2|3|4|5)$/.exec(n);
 if(m)return {value:Number(m[1]),kind:"number",slots:1};
 m=/^lconst_([01])$/.exec(n);if(m)return {value:Number(m[1]),kind:"number",slots:2};
 m=/^fconst_([012])$/.exec(n);if(m)return {value:Number(m[1]),kind:"number",slots:1};
 m=/^dconst_([01])$/.exec(n);if(m)return {value:Number(m[1]),kind:"number",slots:2};
 if((n==="bipush"||n==="sipush")&&Number.isFinite(ins.operand))return {value:Number(ins.operand),kind:"number",slots:1};
 if(["ldc","ldc_w","ldc2_w"].includes(n)&&typeof ins.constant==="number"&&Number.isFinite(ins.constant))
  return {value:ins.constant,kind:"number",slots:n==="ldc2_w"?2:1};
 return null;
}
function expr(kind,data,slots){
 const out=Object.assign({kind,slots:slots||1},data||{});
 return out;
}
function expressionText(v,depth){
 if(!v||depth>MAX_EXPRESSION_DEPTH)return "?";
 if(v.kind==="this")return "this";
 if(v.kind==="argument")return "arg"+v.index;
 if(v.kind==="constant")return String(v.value);
 if(v.kind==="field")return clean(v.owner,100)+"."+clean(v.name,80);
 if(v.kind==="static-field")return clean(v.owner,100)+"."+clean(v.name,80);
 if(v.kind==="local")return "local"+v.index;
 if(v.kind==="unary")return v.op+"("+expressionText(v.value,depth+1)+")";
 if(v.kind==="binary")return "("+expressionText(v.left,depth+1)+" "+v.op+" "+expressionText(v.right,depth+1)+")";
 if(v.kind==="comparison")return v.op+"("+expressionText(v.left,depth+1)+","+expressionText(v.right,depth+1)+")";
 return "?";
}
function walkExpression(v,callback,depth){
 if(!v||depth>MAX_EXPRESSION_DEPTH)return;
 callback(v);
 if(v.kind==="unary")walkExpression(v.value,callback,depth+1);
 if(v.kind==="binary"||v.kind==="comparison"){
  walkExpression(v.left,callback,depth+1);walkExpression(v.right,callback,depth+1);
 }
}
function summarizeExpression(v){
 const fields=[],args=[],constants=[],operations=[],locals=[];
 let nodes=0,tooDeep=false;
 walkExpression(v,node=>{
  nodes++;
  if(nodes>MAX_EXPRESSION_NODES){tooDeep=true;return;}
  if(node.kind==="field"||node.kind==="static-field")fields.push({owner:node.owner,name:node.name,descriptor:node.descriptor,access:node.kind==="field"?"instance":"static"});
  if(node.kind==="argument")args.push(node.index);
  if(node.kind==="constant")constants.push(node.value);
  if(node.kind==="binary"||node.kind==="unary"||node.kind==="comparison")operations.push(node.opcode||node.op);
  if(node.kind==="local")locals.push(node.index);
 },0);
 return {
  text:expressionText(v,0),kind:v&&v.kind||"unknown",stackSlots:v&&v.slots||null,
  fieldDependencies:unique(fields,x=>x.owner+"#"+x.name+":"+x.descriptor),
  argumentDependencies:Array.from(new Set(args)).sort((a,b)=>a-b),
  numericConstants:constants.slice(0,40),operations:operations.slice(0,40),
  localDependencies:Array.from(new Set(locals)).sort((a,b)=>a-b),
  expressionNodeCount:nodes,expressionTruncated:tooDeep||nodes>MAX_EXPRESSION_NODES
 };
}
function unique(rows,keyFn){
 const seen=new Set(),out=[];
 for(const row of rows){const key=keyFn(row);if(!seen.has(key)){seen.add(key);out.push(row);}}
 return out;
}
function localIndex(ins,kind){
 const n=ins.name||"";
 const m=new RegExp("^"+kind+"load_([0-3])$").exec(n);
 if(m)return Number(m[1]);
 if(n===kind+"load")return Number.isInteger(ins.local)?ins.local:Number(ins.operand);
 const s=new RegExp("^"+kind+"store_([0-3])$").exec(n);
 if(s)return Number(s[1]);
 if(n===kind+"store")return Number.isInteger(ins.local)?ins.local:Number(ins.operand);
 return null;
}
function localKind(name){
 if(name[0]==="i")return "i";
 if(name[0]==="l")return "l";
 if(name[0]==="f")return "f";
 if(name[0]==="d")return "d";
 if(name[0]==="a")return "a";
 return null;
}
function initialLocals(method){
 const parsed=parseMethodDescriptor(method.descriptor);
 if(!parsed)return null;
 const locals=new Map();let next=0,argIndex=0;
 const isStatic=!!((Number(method.accessFlags)||0)&0x0008);
 if(!isStatic){locals.set(0,expr("this",{},1));next=1;}
 for(const type of parsed.args){
  locals.set(next,expr("argument",{index:argIndex,descriptor:type.descriptor},type.slots));
  if(type.slots===2)locals.set(next+1,expr("category2-tail",{},0));
  next+=type.slots;argIndex++;
 }
 return {locals,parsed};
}
function arithmeticValue(name,stack){
 const right=stack.pop(),left=stack.pop();
 if(!left||!right)return {error:"operand-stack-underflow-at-"+name};
 const op=BINARY[name];
 return {value:expr("binary",{op,left,right,opcode:name},name[0]==="l"||name[0]==="d"?2:1)};
}
function targetMatches(ins,target){
 const m=ins&&ins.member;
 return !!m&&m.kind==="field"&&norm(m.owner)===norm(target.fieldOwner)&&m.name===target.fieldName&&(!target.fieldDescriptor||!m.descriptor||target.fieldDescriptor===m.descriptor)&&ins.name===target.opcode;
}
function traceToWrite(writer,method,target,options){
 const code=method&&method.code,all=arr(code&&code.instructions);
 const pc=target.pc;
 const base={
  writerMethodId:writer.methodId,sourceClass:writer.sourceClass,sourcePath:writer.sourcePath||null,
  methodName:writer.methodName,methodDescriptor:writer.methodDescriptor,
  writePc:pc,writeOpcode:target.opcode,fieldOwner:target.fieldOwner,fieldName:target.fieldName,
  fieldDescriptor:target.fieldDescriptor||null,metric:target.metric||null,providerKey:target.providerKey||null,
  structuralVerificationValid:!!(code&&code.verification&&code.verification.valid===true),
  javaMethodExecuted:false,assignedRuntimeValueRecovered:false,sourceRuntimeValuesRecovered:false
 };
 const finish=(status,reason,extra)=>{
  return Object.assign({},base,{status,reason:reason||null},extra||{});
 };
 if(!code)return finish("unavailable","method-has-no-code");
 if(code.decodeError)return finish("unavailable","bytecode-decode-error");
 if(!base.structuralVerificationValid)return finish("unverified","bytecode-structure-not-verified");
 if(arr(code.exceptions).length)return finish("unresolved","exception-table-present-before-write-cannot-be-ruled-out",{exceptionHandlerCount:arr(code.exceptions).length});
 const index=all.findIndex(ins=>ins&&ins.pc===pc&&targetMatches(ins,target));
 if(index<0)return finish("unresolved","exact-write-instruction-not-found");
 if(all.length>MAX_METHOD_INSTRUCTIONS||index>=MAX_METHOD_INSTRUCTIONS)return finish("truncated","write-site-beyond-instruction-limit",{instructionCount:all.length});
 const initial=initialLocals(method);
 if(!initial)return finish("unresolved","invalid-method-descriptor");
 const locals=initial.locals,stack=[],priorWrites=[],readFields=[],branches=[],steps=[];
 const pop=()=>stack.length?stack.pop():null;
 const push=v=>{if(!v)return false;stack.push(v);return stack.length<=256;};
 const fail=(reason,pcValue)=>finish("unresolved",reason,{stoppedAtPc:Number.isInteger(pcValue)?pcValue:null,priorWriteSites:priorWrites.slice(0,20),fieldReads:unique(readFields,x=>x.owner+"#"+x.name+":"+x.descriptor),branchSites:branches.slice(0,20),symbolicSteps:steps.slice(-30)});
 for(let i=0;i<=index;i++){
  const ins=all[i],n=ins&&ins.name;
  if(!ins||typeof n!=="string")return fail("invalid-instruction-record",ins&&ins.pc);
  if(n==="nop")continue;
  if(/^(?:if|goto|jsr|tableswitch|lookupswitch)/.test(n)){
   branches.push({pc:ins.pc,opcode:n,target:Number.isInteger(ins.target)?ins.target:null});
   return fail("control-flow-before-write",ins.pc);
  }
  if(n==="invokevirtual"||n==="invokespecial"||n==="invokestatic"||n==="invokeinterface"||n==="invokedynamic")
   return fail("method-call-before-write",ins.pc);
  if(n==="monitorenter"||n==="monitorexit"||n==="athrow"||n==="return"||/^[ilfda]return$/.test(n))
   return fail("side-effect-or-method-exit-before-write",ins.pc);
  const cv=constant(ins);
  if(cv){if(!push(expr("constant",cv,cv.slots)))return fail("operand-stack-limit-exceeded",ins.pc);steps.push({pc:ins.pc,operation:"constant"});continue;}
  if(n==="aconst_null")return fail("null-reference-before-write",ins.pc);
  if(["aload_0","aload_1","aload_2","aload_3","aload","iload_0","iload_1","iload_2","iload_3","iload","lload_0","lload_1","lload_2","lload_3","lload","fload_0","fload_1","fload_2","fload_3","fload","dload_0","dload_1","dload_2","dload_3","dload"].includes(n)){
   const kind=localKind(n),indexValue=localIndex(ins,kind);
   if(!Number.isInteger(indexValue)||!locals.has(indexValue))return fail("uninitialized-or-unknown-local-load",ins.pc);
   const value=locals.get(indexValue);
   if(value.kind==="category2-tail")return fail("invalid-category2-local-load",ins.pc);
   if(kind==="a"&&value.kind!=="this"&&value.kind!=="argument")return fail("unsupported-reference-local-load",ins.pc);
   if(kind!=="a"&&value.kind!=="argument"&&value.kind!=="constant"&&value.kind!=="field"&&value.kind!=="static-field"&&value.kind!=="binary"&&value.kind!=="unary")return fail("local-type-or-value-not-understood",ins.pc);
   if(!push(value))return fail("operand-stack-limit-exceeded",ins.pc);
   steps.push({pc:ins.pc,operation:"local-load",local:indexValue});continue;
  }
  if(["astore_0","astore_1","astore_2","astore_3","astore","istore_0","istore_1","istore_2","istore_3","istore","lstore_0","lstore_1","lstore_2","lstore_3","lstore","fstore_0","fstore_1","fstore_2","fstore_3","fstore","dstore_0","dstore_1","dstore_2","dstore_3","dstore"].includes(n)){
   const kind=localKind(n),indexValue=localIndex(ins,kind),value=pop();
   if(!Number.isInteger(indexValue)||!value)return fail("invalid-local-store",ins.pc);
   if(kind==="a"&&value.kind!=="this"&&value.kind!=="argument")return fail("unsupported-reference-local-store",ins.pc);
   locals.set(indexValue,value);
   if(value.slots===2)locals.set(indexValue+1,expr("category2-tail",{},0));
   steps.push({pc:ins.pc,operation:"local-store",local:indexValue});continue;
  }
  if(n==="iinc"){
   const indexValue=Number.isInteger(ins.local)?ins.local:ins.operand;
   const old=locals.get(indexValue);
   if(!old||!Number.isFinite(ins.increment))return fail("iinc-local-not-initialized",ins.pc);
   locals.set(indexValue,expr("binary",{op:"+",left:old,right:expr("constant",{value:ins.increment,kind:"number",slots:1},1),opcode:"iinc"},1));
   steps.push({pc:ins.pc,operation:"iinc",local:indexValue});continue;
  }
  if(n==="getfield"||n==="getstatic"){
   const m=ins.member;
   if(!m||m.kind!=="field"||!safe(m.owner)||!safe(m.name)||!safe(m.descriptor||""))return fail("field-reference-unavailable-or-excluded",ins.pc);
   if(n==="getfield"){
    const receiver=pop();
    if(!receiver||receiver.kind!=="this")return fail("getfield-receiver-not-proven-to-be-this",ins.pc);
    readFields.push({owner:norm(m.owner),name:m.name,descriptor:m.descriptor||null,pc:ins.pc});
    if(!push(expr("field",{owner:norm(m.owner),name:m.name,descriptor:m.descriptor||null},m.descriptor==="J"||m.descriptor==="D"?2:1)))return fail("operand-stack-limit-exceeded",ins.pc);
   }else{
    if(!push(expr("static-field",{owner:norm(m.owner),name:m.name,descriptor:m.descriptor||null},m.descriptor==="J"||m.descriptor==="D"?2:1)))return fail("operand-stack-limit-exceeded",ins.pc);
   }
   steps.push({pc:ins.pc,operation:n});continue;
  }
  if(BINARY[n]){
   const out=arithmeticValue(n,stack);
   if(out.error)return fail(out.error,ins.pc);
   if(!push(out.value))return fail("operand-stack-limit-exceeded",ins.pc);
   steps.push({pc:ins.pc,operation:"arithmetic",opcode:n});continue;
  }
  if(UNARY[n]){
   const value=pop();if(!value)return fail("operand-stack-underflow-at-"+n,ins.pc);
   const slots=(n==="i2l"||n==="i2d"||n==="f2l"||n==="f2d")?2:(n==="l2i"||n==="l2f"||n==="d2i"||n==="d2f")?1:value.slots;
   if(!push(expr("unary",{op:UNARY[n],value,opcode:n},slots)))return fail("operand-stack-limit-exceeded",ins.pc);
   steps.push({pc:ins.pc,operation:"conversion-or-negation",opcode:n});continue;
  }
  if(n==="dup"){
   if(!stack.length||stack[stack.length-1].slots!==1)return fail("unsupported-dup-stack-category",ins.pc);
   if(!push(stack[stack.length-1]))return fail("operand-stack-limit-exceeded",ins.pc);
   continue;
  }
  if(n==="swap"){
   if(stack.length<2||stack[stack.length-1].slots!==1||stack[stack.length-2].slots!==1)return fail("unsupported-swap-stack-category",ins.pc);
   const a=pop(),b=pop();push(a);push(b);continue;
  }
  if(n==="pop"){
   if(!stack.length||stack[stack.length-1].slots!==1)return fail("unsupported-pop-stack-category",ins.pc);
   pop();continue;
  }
  if(n==="putfield"||n==="putstatic"){
   const m=ins.member;
   if(!m||m.kind!=="field")return fail("invalid-field-write-reference",ins.pc);
   const value=pop();
   if(!value)return fail("operand-stack-underflow-at-field-write",ins.pc);
   let receiver=null;
   if(n==="putfield"){receiver=pop();if(!receiver)return fail("missing-field-write-receiver",ins.pc);}
   const exact=Number.isInteger(ins.pc)&&ins.pc===pc&&m.name===target.fieldName&&norm(m.owner)===norm(target.fieldOwner)&&(!target.fieldDescriptor||!m.descriptor||target.fieldDescriptor===m.descriptor)&&n===target.opcode;
   if(exact){
    if(n==="putfield"&&receiver.kind!=="this")return fail("target-field-receiver-not-proven-to-be-this",ins.pc);
    if(n==="putstatic"&&receiver!==null)return fail("unexpected-static-field-receiver",ins.pc);
    const summary=summarizeExpression(value);
    if(summary.expressionTruncated)return fail("symbolic-expression-node-limit-exceeded",ins.pc);
    return finish("resolved","bounded-straight-line-symbolic-stack-trace",{
     valueExpression:summary,fieldReads:unique(readFields,x=>x.owner+"#"+x.name+":"+x.descriptor),
     priorWriteSites:priorWrites.slice(0,20),symbolicSteps:steps.slice(-40),
     stackShapeAtWrite:{valueSlots:value.slots,receiver:n==="putfield"?"this":null,remainingStackValues:stack.length},
     branchSites:[],confidence:"bounded-static-expression-evidence",
     expressionSourceKinds:Array.from(new Set([value.kind].concat(summary.fieldDependencies.length?["field-dependency"]:[],summary.argumentDependencies.length?["argument-dependency"]:[])))
    });
   }
   priorWrites.push({pc:ins.pc,opcode:n,owner:norm(m.owner),name:m.name,descriptor:m.descriptor||null});
   steps.push({pc:ins.pc,operation:"prior-field-write"});continue;
  }
  return fail("unsupported-opcode-"+clean(n,50),ins.pc);
 }
 return fail("target-write-site-not-reached",pc);
}
function analyze(input,options){
 input=input&&typeof input==="object"?input:{};
 options=options&&typeof options==="object"?options:{};
 const writeTrace=input.writeTrace||{};
 const sourceWriters=arr(writeTrace.writerMethods);
 const classes=arr(input.classes);
 const detailLimit=Number.isInteger(options.detailLimit)&&options.detailLimit>0?Math.min(options.detailLimit,MAX_DETAILS):MAX_DETAILS;
 const classSet=new Set(sourceWriters.filter(x=>x&&safe(x.sourceClass)).map(x=>norm(x.sourceClass)));
 const classMap=new Map();
 for(const entry of classes){
  const info=entry&&entry.classInfo?entry.classInfo:entry;
  if(!info||info.valid!==true||!safe(info.className))continue;
  const name=norm(info.className);
  if(classSet.has(name)&&!classMap.has(name)&&classMap.size<MAX_CLASSES)classMap.set(name,{info,path:entry&&safe(entry.path)?entry.path:null});
 }
 const writeAnalyses=[],classificationCounts={};
 let writerMethodsSeen=0,writeSitesSeen=0,writeSitesAnalyzed=0,resolvedWrites=0,verifiedWrites=0,unresolvedWrites=0,methodsOmitted=0,totalInstructions=0;
 for(const writer of sourceWriters.slice(0,MAX_WRITER_METHODS)){
  if(!writer||!safe(writer.sourceClass)||!safe(writer.methodName)||!safe(writer.methodDescriptor||""))continue;
  writerMethodsSeen++;
  const holder=classMap.get(norm(writer.sourceClass));
  const method=holder&&arr(holder.info.methods).find(m=>m&&m.name===writer.methodName&&m.descriptor===writer.methodDescriptor);
  if(!method){methodsOmitted++;continue;}
  const writes=arr(writer.fieldWrites);
  for(const target of writes){
   if(!target||!safe(target.fieldOwner)||!safe(target.fieldName)||!safe(target.fieldDescriptor||""))continue;
   writeSitesSeen++;
   const cost=Math.min(arr(method.code&&method.code.instructions).length,MAX_METHOD_INSTRUCTIONS);
   if(totalInstructions+cost>MAX_TOTAL_INSTRUCTIONS){methodsOmitted++;continue;}
   totalInstructions+=cost;
   const row=traceToWrite(writer,method,target,options);
   writeSitesAnalyzed++;
   if(row.status==="resolved"){resolvedWrites++;if(row.structuralVerificationValid)verifiedWrites++;}
   else unresolvedWrites++;
   classificationCounts[row.status]=(classificationCounts[row.status]||0)+1;
   if(writeAnalyses.length<detailLimit)writeAnalyses.push(row);else methodsOmitted++;
   if(writeAnalyses.length>=detailLimit&&methodsOmitted>0)break;
  }
  if(writeAnalyses.length>=detailLimit&&methodsOmitted>0)break;
 }
 const report={
  schema:"jar2zeus.machine-state-write-value-analysis.v1",
  status:writeSitesSeen?(resolvedWrites?"static-assignment-expression-evidence-found":"write-sites-without-resolved-assignment-expressions"):"no-write-sites-to-analyze",
  supportStatus:"bounded-straight-line-symbolic-stack-evidence-only",
  sourceWriteTraceSchema:writeTrace.schema||null,
  writeAnalyses,
  classificationSummary:Object.keys(classificationCounts).sort().map(status=>({status,count:classificationCounts[status]})),
  manualTasks:[
   {area:"assignment-expression-review",status:resolvedWrites?"review-required":"not-observed",reason:"Expressions are reconstructed from a narrow linear JVM stack subset. Confirm source code, type conversions, integer overflow, nullability and intended semantics before use."},
   {area:"control-flow-and-helper-calls",status:"not-reconstructed",reason:"Branches, switches, calls, exception handlers and unsupported stack operations before a target write produce unresolved results; no control-flow path is guessed."},
   {area:"runtime-update",status:"not-recovered",reason:"A static assignment expression does not establish when it runs, whether it runs, server/client authority, synchronization or persistence behavior."},
   {area:"source-owned-adapter",status:"not-generated",reason:"A source-MOD developer must implement and verify the actual reader/update hook and explicitly publish only validated telemetry."}
  ],
  limitations:[
   "Only the straight-line instruction prefix ending at an exact Phase 27 telemetry PUTFIELD/PUTSTATIC site is considered.",
   "The symbolic interpreter supports only a deliberately limited set of constants, locals, field reads, arithmetic, conversions and simple category-1 stack operations.",
   "Branches, switches, method calls, exception tables, unsupported opcodes and unverified methods are not symbolically followed.",
   "The reported expression is static provenance, not the actual assigned runtime value or a proof of source-level Java equivalence.",
   "No Java method is executed, no live value is recovered, and no callback, tick hook, Lua bridge or event publication is generated."
  ],
  totals:{
   writerMethodsSeen:writerMethodsSeen,writeSitesSeen:writeSitesSeen,writeSitesAnalyzed:writeSitesAnalyzed,
   resolvedWriteExpressions:resolvedWrites,structurallyVerifiedResolvedWrites:verifiedWrites,
   unresolvedWriteExpressions:unresolvedWrites,methodsOmitted:methodsOmitted,
   totalInstructionsAnalyzed:totalInstructions,
   classesOmitted:Math.max(0,classSet.size-classMap.size),
   detailsTruncated:methodsOmitted>0||sourceWriters.length>MAX_WRITER_METHODS||writeSitesSeen>writeAnalyses.length||classes.length>MAX_CLASSES
  },
  symbolicAssignmentExpressionsRecovered:resolvedWrites>0,
  assignedRuntimeValuesRecovered:false,javaMethodsExecuted:false,
  updateTimingRecovered:false,sourceRuntimeValuesRecovered:false,
  sourceReaderCallbacksGenerated:0,eventPublicationsWired:0,
  liveValuesConnected:false,arbitraryJavaBlockEntityAccess:false,
  reportFile:"machine-state-write-value-analysis-plan.json"
 };
 return report;
}
root.Jar2ZeusMachineStateWriteValueAnalysis={analyze:analyze,parseMethodDescriptor:parseMethodDescriptor,traceToWrite:traceToWrite};
})(typeof globalThis!=="undefined"?globalThis:this);
