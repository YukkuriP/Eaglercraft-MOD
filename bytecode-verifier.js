/* Structural verifier for decoded JVM methods. This validates bytecode layout and metadata;
 * it does not execute code or claim full JVM type verification.
 */
(function(root){
 "use strict";
 function verify(input){
  const code=input&&input.code||{},instructions=code.instructions||[],length=code.codeLength;
  const errors=[],warnings=[];
  const fail=s=>{if(!errors.includes(s))errors.push(s);};
  if(!Number.isInteger(length)||length<0||length>65535)fail("invalid Code.code_length");
  if(!Number.isInteger(code.maxLocals)||code.maxLocals<0||!Number.isInteger(code.maxStack)||code.maxStack<0)fail("invalid max_locals/max_stack");
  if(length===0&&instructions.length)fail("empty Code attribute contains instructions");
  if(length>0&&!instructions.length&&!code.decodeError)fail("non-empty Code attribute has no decoded instructions");
  function descriptorSlots(desc){
   if(typeof desc!=="string"||desc[0]!=="(")return null;
   let p=1,slots=0;
   while(p<desc.length&&desc[p]!==")"){
    let c=desc[p++];
    while(c==="["){c=desc[p++];}
    if(c==="L"){const end=desc.indexOf(";",p);if(end<0)return null;p=end+1;slots++;}
    else if("ZBCSIF".includes(c))slots++;
    else if(c==="J"||c==="D")slots+=2;
    else return null;
   }
   if(desc[p]!==")")return null;
   return slots;
  }
  const args=descriptorSlots(input&&input.descriptor);
  if(args===null)fail("invalid method descriptor for local-slot verification");
  else if(args+(input&&input.isStatic?0:1)>code.maxLocals)fail("method parameters exceed max_locals");
  const byPc=new Map();
  let previous=-1;
  for(const ins of instructions){
   if(!ins||!Number.isInteger(ins.pc)||ins.pc<0||ins.pc>=length){fail("instruction offset is outside Code array");continue;}
   if(ins.pc<=previous)fail("instruction offsets are not strictly increasing");
   if(byPc.has(ins.pc))fail("duplicate instruction offset "+ins.pc);
   byPc.set(ins.pc,ins);previous=ins.pc;
  }
  const isTarget=(pc,allowEnd)=>Number.isInteger(pc)&&(byPc.has(pc)||(allowEnd&&pc===length));
  const localWidth=name=>(name==="lload"||name==="dload"||name==="lstore"||name==="dstore"||
    /^([ld])(?:load|store)_[0-3]$/.test(name))?2:1;
  for(let i=0;i<instructions.length;i++){
   const ins=instructions[i],name=ins.name,pc=ins.pc;
   const next=i+1<instructions.length?instructions[i+1].pc:length;
   if(next<=pc)continue;
   if(ins.target!==undefined&&!isTarget(ins.target,false))fail("branch target is not an instruction boundary at "+pc+": "+ins.target);
   if(ins.targets)for(const t of ins.targets)if(!isTarget(t,false))fail("tableswitch target is not an instruction boundary at "+pc+": "+t);
   if(ins.pairs)for(const pair of ins.pairs)if(!isTarget(pair.target,false))fail("lookupswitch target is not an instruction boundary at "+pc+": "+pair.target);
   if(ins.defaultOffset!==undefined&&!isTarget(pc+ins.defaultOffset,false))fail("switch default target is not an instruction boundary at "+pc);
   if(name==="invokeinterface"){
    if(!Number.isInteger(ins.count)||ins.count<1)fail("invokeinterface count must be non-zero at "+pc);
    if(ins.zero!==0)fail("invokeinterface trailing byte must be zero at "+pc);
   }
   if(name==="invokedynamic"&&ins.zero!==0)fail("invokedynamic trailing bytes must be zero at "+pc);
   if(name==="newarray"&&(ins.operand<4||ins.operand>11))fail("newarray has an invalid atype at "+pc);
   if(name==="multianewarray"&&(!Number.isInteger(ins.dimensions)||ins.dimensions<1))fail("multianewarray dimensions must be non-zero at "+pc);
   if(name==="tableswitch"&&(!Number.isInteger(ins.low)||!Number.isInteger(ins.high)||ins.high<ins.low))fail("tableswitch has an invalid low/high range at "+pc);
   if(name==="lookupswitch"){
    let last=-Infinity;
    for(const pair of ins.pairs||[]){if(pair.key<=last)fail("lookupswitch keys are not strictly increasing at "+pc);last=pair.key;}
   }
   let slot=null,width=1;
   if(ins.wideOpcode!=null){slot=ins.local;width=localWidth(name);}
   else {
    const m=name.match(/_(\d)$/);
    if(m&&/^(?:[ilfda]load|[ilfda]store)_/.test(name)){slot=Number(m[1]);width=localWidth(name.replace(/_[0-3]$/,""));}
    else if(/^(?:iload|lload|fload|dload|aload|istore|lstore|fstore|dstore|astore|ret)$/.test(name)){slot=ins.operand;width=localWidth(name);}
    else if(name==="iinc")slot=ins.local;
   }
   if(slot!==null&&(!Number.isInteger(slot)||slot<0||slot+width>code.maxLocals))
    fail("local-variable index exceeds max_locals at "+pc);
   if(name==="wide"||ins.opcode===0xc4){
    if(!Number.isInteger(ins.local)||ins.local<0||ins.local>=code.maxLocals)fail("wide local-variable index exceeds max_locals at "+pc);
   }
  }
  for(const ex of code.exceptions||[]){
   if(!Number.isInteger(ex.start)||!Number.isInteger(ex.end)||!Number.isInteger(ex.handler)||
      ex.start<0||ex.start>=ex.end||ex.end>length)
    fail("invalid exception-table range");
   else {
    if(!isTarget(ex.start,false))fail("exception start_pc is not an instruction boundary");
    if(!isTarget(ex.end,true))fail("exception end_pc is not an instruction boundary or code_length");
    if(!isTarget(ex.handler,false))fail("exception handler_pc is not an instruction boundary");
   }
  }
  if(code.decodeError)fail("bytecode decoding failed: "+code.decodeError);
  return {valid:errors.length===0,structuralOnly:true,errors,warnings,instructionCount:instructions.length};
 }
 root.Jar2ZeusBytecodeVerifier={verify};
})(typeof globalThis!=="undefined"?globalThis:this);
