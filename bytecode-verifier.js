/* Structural JVM bytecode verifier and CFG analyzer. Does not execute or fully type-verify bytecode. */
(function(root){
 "use strict";
 function parseMethodDescriptor(desc){
  if(typeof desc!=="string"||desc[0]!=="(")return null;
  let p=1,slots=0,args=0;
  function readType(allowVoid){
   let dims=0;while(desc[p]==="["){dims++;p++;if(dims>255)return null;}
   const c=desc[p++];
   if("ZBCSIF".includes(c))return {kind:dims?"reference":c,slots:1};
   if(c==="J"||c==="D")return {kind:dims?"reference":c,slots:dims?1:2};
   if(c==="L"){
    const e=desc.indexOf(";",p);if(e<0||e===p)return null;
    const n=desc.slice(p,e);if(n.startsWith("/")||n.endsWith("/")||n.includes(".")||n.includes("//")||n.includes("[")||n.includes(";"))return null;
    p=e+1;return {kind:"reference",slots:1};
   }
   if(c==="V"&&allowVoid&&!dims)return {kind:"void",slots:0};
   return null;
  }
  while(p<desc.length&&desc[p]!==")"){const t=readType(false);if(!t)return null;slots+=t.slots;args++;if(slots>255)return null;}
  if(desc[p++]!==")")return null;
  const result=readType(true);if(!result||p!==desc.length)return null;
  return {args,argumentSlots:slots,result:result.kind};
 }
 function verify(input){
  const code=input&&input.code||{},insns=code.instructions||[],length=code.codeLength;
  const errors=[],warnings=[],fail=s=>{if(!errors.includes(s))errors.push(s);},warn=s=>{if(!warnings.includes(s))warnings.push(s);};
  const descriptor=parseMethodDescriptor(input&&input.descriptor);
  if(!descriptor)fail("invalid method descriptor");
  if(!Number.isInteger(length)||length<1||length>65535)fail("invalid Code.code_length");
  if(!Number.isInteger(code.maxLocals)||code.maxLocals<0||code.maxLocals>65535||!Number.isInteger(code.maxStack)||code.maxStack<0||code.maxStack>65535)fail("invalid max_locals/max_stack");
  if(!insns.length&&!code.decodeError)fail("non-empty Code attribute has no decoded instructions");
  if(descriptor&&descriptor.argumentSlots+(input&&input.isStatic?0:1)>code.maxLocals)fail("method parameters exceed max_locals");
  const byPc=new Map(),leaders=new Set(),branchTargets=new Set();let expected=0,previous=-1;
  for(const ins of insns){
   if(!ins||!Number.isInteger(ins.pc)||ins.pc<0||ins.pc>=length){fail("instruction offset is outside Code array");continue;}
   if(ins.pc<=previous)fail("instruction offsets are not strictly increasing");
   if(byPc.has(ins.pc))fail("duplicate instruction offset "+ins.pc);
   if(ins.pc!==expected)fail("gap or overlap in decoded instruction stream at byte "+expected);
   if(!Number.isInteger(ins.length)||ins.length<1||ins.pc+ins.length>length)fail("invalid instruction size at byte "+ins.pc);
   else expected=ins.pc+ins.length;
   byPc.set(ins.pc,ins);previous=ins.pc;
  }
  if(insns.length&&insns[0].pc!==0)fail("first instruction does not start at byte zero");
  if(insns.length&&expected!==length)fail("decoded instructions do not cover the full Code array");
  if(insns.length)leaders.add(insns[0].pc);
  const wide2=n=>n==="lload"||n==="dload"||n==="lstore"||n==="dstore"||/^([ld])(?:load|store)_[0-3]$/.test(n);
  const localOf=ins=>{
   const n=ins.name||"";
   if(ins.wideOpcode!=null)return {slot:ins.local,width:wide2(n)?2:1};
   const m=n.match(/_(\d)$/);
   if(m&&/^(?:[ilfda]load|[ilfda]store)_/.test(n))return {slot:Number(m[1]),width:wide2(n.replace(/_[0-3]$/,""))?2:1};
   if(/^(?:iload|lload|fload|dload|aload|istore|lstore|fstore|dstore|astore|ret)$/.test(n))return {slot:ins.operand,width:wide2(n)?2:1};
   if(n==="iinc")return {slot:ins.local,width:1};
   return null;
  };
  const conditional=/^(?:ifeq|ifne|iflt|ifge|ifgt|ifle|if_icmpeq|if_icmpne|if_icmplt|if_icmpge|if_icmpgt|if_icmple|if_acmpeq|if_acmpne|ifnull|ifnonnull)$/;
  const terminal=new Set(["ireturn","lreturn","freturn","dreturn","areturn","return","athrow","ret","goto","goto_w"]);
  const exceptions=[];
  function target(pc,at,label){if(!Number.isInteger(pc)||!byPc.has(pc))fail(label+" target is not an instruction boundary at "+at+": "+pc);else{leaders.add(pc);branchTargets.add(pc);}}
  for(let i=0;i<insns.length;i++){
   const x=insns[i],n=x.name||"",pc=x.pc,next=i+1<insns.length?insns[i+1].pc:length;
   if(x.target!==undefined)target(x.target,pc,"branch");
   for(const t of x.targets||[])target(t,pc,"tableswitch");
   for(const pair of x.pairs||[])target(pair.target,pc,"lookupswitch");
   if(x.defaultOffset!==undefined)target(pc+x.defaultOffset,pc,"switch default");
   if(x.target!==undefined||x.targets||x.pairs||x.defaultOffset!==undefined){if(next<length)leaders.add(next);}
   const local=localOf(x);if(local&&(!Number.isInteger(local.slot)||local.slot<0||local.slot+local.width>code.maxLocals))fail("local-variable index exceeds max_locals at "+pc);
   if(x.wideOpcode!=null&&!["iload","lload","fload","dload","aload","istore","lstore","fstore","dstore","astore","ret","iinc"].includes(n))fail("invalid wide opcode at "+pc);
   if(n==="newarray"&&(!Number.isInteger(x.operand)||x.operand<4||x.operand>11))fail("newarray has invalid atype at "+pc);
   if(n==="invokeinterface"&&(!Number.isInteger(x.count)||x.count<1||x.zero!==0))fail("invokeinterface count/trailing byte invalid at "+pc);
   if(n==="invokedynamic"&&x.zero!==0)fail("invokedynamic trailing bytes invalid at "+pc);
   if(n==="multianewarray"&&(!Number.isInteger(x.dimensions)||x.dimensions<1||x.dimensions>255))fail("multianewarray dimensions invalid at "+pc);
   if(n==="tableswitch"&&(!Number.isInteger(x.low)||!Number.isInteger(x.high)||x.high<x.low))fail("tableswitch range invalid at "+pc);
   if(n==="lookupswitch"){let last=-Infinity;for(const pair of x.pairs||[]){if(pair.key<=last)fail("lookupswitch keys not strictly increasing at "+pc);last=pair.key;}}
   if(n==="jsr"||n==="jsr_w"||n==="ret"||x.wideOpcode===0xa9)warn("legacy jsr/ret subroutine bytecode is parsed but not normalized");
   if(conditional.test(n)||["goto","goto_w","jsr","jsr_w","tableswitch","lookupswitch"].includes(n)||terminal.has(n)){if(next<length)leaders.add(next);}
   if(n==="ireturn"&&descriptor&&!"ZBCSIF".includes(descriptor.result))fail("ireturn does not match method return descriptor at "+pc);
   if(n==="lreturn"&&descriptor&&descriptor.result!=="J")fail("lreturn does not match method return descriptor at "+pc);
   if(n==="freturn"&&descriptor&&descriptor.result!=="F")fail("freturn does not match method return descriptor at "+pc);
   if(n==="dreturn"&&descriptor&&descriptor.result!=="D")fail("dreturn does not match method return descriptor at "+pc);
   if(n==="areturn"&&descriptor&&descriptor.result!=="reference")fail("areturn does not match method return descriptor at "+pc);
   if(n==="return"&&descriptor&&descriptor.result!=="void")fail("return does not match method return descriptor at "+pc);
  }
  for(const ex of code.exceptions||[]){
   if(!Number.isInteger(ex.start)||!Number.isInteger(ex.end)||!Number.isInteger(ex.handler)||ex.start<0||ex.start>=ex.end||ex.end>length)fail("invalid exception-table range");
   else{
    if(!byPc.has(ex.start))fail("exception start_pc is not an instruction boundary");
    if(ex.end!==length&&!byPc.has(ex.end))fail("exception end_pc is not an instruction boundary or code_length");
    if(!byPc.has(ex.handler))fail("exception handler_pc is not an instruction boundary");
    else{leaders.add(ex.handler);exceptions.push({start:ex.start,end:ex.end,handler:ex.handler,catchType:ex.catchType||null});}
   }
  }
  if(code.decodeError)fail("bytecode decoding failed: "+code.decodeError);
  const starts=Array.from(leaders).filter(x=>byPc.has(x)).sort((a,b)=>a-b),blocks=[];
  for(let i=0;i<starts.length;i++){
   const start=starts[i],end=i+1<starts.length?starts[i+1]:length,body=insns.filter(x=>x.pc>=start&&x.pc<end);
   if(body.length)blocks.push({id:blocks.length,start,end,instructionCount:body.length,firstOpcode:body[0].name,lastOpcode:body[body.length-1].name});
  }
  const blockAt=new Map(blocks.map(b=>[b.start,b])),edges=[];
  for(const b of blocks){
   const body=insns.filter(x=>x.pc>=b.start&&x.pc<b.end),tail=body[body.length-1],n=tail.name||"",next=b.end;
   const edge=(to,kind)=>{if(blockAt.has(to))edges.push({from:b.id,to:blockAt.get(to).id,kind});};
   if(n==="tableswitch"||n==="lookupswitch"){
    edge(tail.pc+tail.defaultOffset,"switch-default");for(const t of tail.targets||[])edge(t,"switch-case");for(const pair of tail.pairs||[])edge(pair.target,"switch-case");
   }else if(n==="goto"||n==="goto_w")edge(tail.target,"branch");
   else if(n==="jsr"||n==="jsr_w"){edge(tail.target,"subroutine");if(next<length)edge(next,"subroutine-return");}
   else if(conditional.test(n)){edge(tail.target,"conditional-true");if(next<length)edge(next,"conditional-false");}
   else if(!terminal.has(n)&&next<length)edge(next,"fallthrough");
  }
  for(const ex of exceptions)for(const b of blocks)if(b.start<ex.end&&b.end>ex.start)edges.push({from:b.id,to:blockAt.get(ex.handler).id,kind:"exception",catchType:ex.catchType});
  const loops=edges.filter(e=>e.kind!=="exception"&&blocks[e.to].start<=blocks[e.from].start);
  const reachable=new Set(),adj=new Map(blocks.map(b=>[b.id,[]]));
  for(const e of edges)adj.get(e.from).push(e.to);
  if(blocks.length){const queue=[blocks[0].id];while(queue.length){const id=queue.shift();if(reachable.has(id))continue;reachable.add(id);for(const to of adj.get(id)||[])if(!reachable.has(to))queue.push(to);}}
  const unreachable=blocks.filter(b=>!reachable.has(b.id)).map(b=>b.id);
  if(unreachable.length)warn("unreachable basic blocks detected: "+unreachable.length);
  if(blocks.length){const last=blocks[blocks.length-1].lastOpcode;if(!terminal.has(last)&&!["tableswitch","lookupswitch"].includes(last))fail("control flow falls off the end of the method");}
  return {valid:errors.length===0,structuralOnly:true,errors,warnings,instructionCount:insns.length,descriptor,
   controlFlow:{basicBlocks:blocks,edges,branchTargets:Array.from(branchTargets).sort((a,b)=>a-b),loopBackEdges:loops.map(e=>({from:e.from,to:e.to,kind:e.kind})),reachableBlockIds:Array.from(reachable).sort((a,b)=>a-b),unreachableBlockIds:unreachable,counts:{blocks:blocks.length,edges:edges.length,loops:loops.length,unreachableBlocks:unreachable.length}}};
 }
 root.Jar2ZeusBytecodeVerifier={verify,parseMethodDescriptor};
})(typeof globalThis!=="undefined"?globalThis:this);
