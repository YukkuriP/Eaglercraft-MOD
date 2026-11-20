/* Java class-file and bytecode inspection for Jar2Zeus.
 * Parses structures and instruction summaries; never executes uploaded bytecode.
 */
(function(root){
 "use strict";
 const OPCODES=("nop aconst_null iconst_m1 iconst_0 iconst_1 iconst_2 iconst_3 iconst_4 iconst_5 lconst_0 lconst_1 fconst_0 fconst_1 fconst_2 dconst_0 dconst_1 bipush sipush ldc ldc_w ldc2_w iload lload fload dload aload iload_0 iload_1 iload_2 iload_3 lload_0 lload_1 lload_2 lload_3 fload_0 fload_1 fload_2 fload_3 dload_0 dload_1 dload_2 dload_3 aload_0 aload_1 aload_2 aload_3 iaload laload faload daload aaload baload caload saload istore lstore fstore dstore astore istore_0 istore_1 istore_2 istore_3 lstore_0 lstore_1 lstore_2 lstore_3 fstore_0 fstore_1 fstore_2 fstore_3 dstore_0 dstore_1 dstore_2 dstore_3 astore_0 astore_1 astore_2 astore_3 iastore lastore fastore dastore aastore bastore castore sastore pop pop2 dup dup_x1 dup_x2 dup2 dup2_x1 dup2_x2 swap iadd ladd fadd dadd isub lsub fsub dsub imul lmul fmul dmul idiv ldiv fdiv ddiv irem lrem frem drem ineg lneg fneg dneg ishl lshl ishr lshr iushr lushr iand land ior lor ixor lxor iinc i2l i2f i2d l2i l2f l2d f2i f2l f2d d2i d2l d2f i2b i2c i2s lcmp fcmpl fcmpg dcmpl dcmpg ifeq ifne iflt ifge ifgt ifle if_icmpeq if_icmpne if_icmplt if_icmpge if_icmpgt if_icmple if_acmpeq if_acmpne goto jsr ret tableswitch lookupswitch ireturn lreturn freturn dreturn areturn return getstatic putstatic getfield putfield invokevirtual invokespecial invokestatic invokeinterface invokedynamic new newarray anewarray arraylength athrow checkcast instanceof monitorenter monitorexit wide multianewarray ifnull ifnonnull goto_w jsr_w breakpoint").split(" ");
 function parse(input,options){
  const out={valid:false,major:null,minor:null,className:null,superName:null,interfaces:[],accessFlags:0,fields:[],methods:[],references:[],invocations:[],error:null};
  try{
   const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
   const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
   let p=0;
   function need(n){if(!Number.isInteger(n)||n<0||p+n>view.byteLength)throw new Error("class file is truncated");}
   function u1(){need(1);return view.getUint8(p++);}
   function s1(){need(1);return view.getInt8(p++);}
   function u2(){need(2);const v=view.getUint16(p);p+=2;return v;}
   function s2(){need(2);const v=view.getInt16(p);p+=2;return v;}
   function u4(){need(4);const v=view.getUint32(p);p+=4;return v;}
   function s4(){need(4);const v=view.getInt32(p);p+=4;return v;}
   function take(n){need(n);const a=bytes.subarray(p,p+n);p+=n;return a;}
   function decodeModifiedUtf8(data){
    const units=[];
    for(let i=0;i<data.length;){
     const a=data[i++];
     if(a===0)throw new Error("invalid zero byte in modified UTF-8");
     if(a<0x80){units.push(a);continue;}
     if((a&0xe0)===0xc0){
      if(i>=data.length)throw new Error("truncated modified UTF-8 sequence");
      const next=data[i++];if((next&0xc0)!==0x80)throw new Error("invalid modified UTF-8 continuation");
      const value=((a&0x1f)<<6)|(next&0x3f);
      if(value!==0&&value<0x80)throw new Error("overlong modified UTF-8 sequence");
      units.push(value);continue;
     }
     if((a&0xf0)===0xe0){
      if(i+1>=data.length)throw new Error("truncated modified UTF-8 sequence");
      const next=data[i++],last=data[i++];
      if((next&0xc0)!==0x80||(last&0xc0)!==0x80)throw new Error("invalid modified UTF-8 continuation");
      const value=((a&0x0f)<<12)|((next&0x3f)<<6)|(last&0x3f);
      if(value<0x800)throw new Error("overlong modified UTF-8 sequence");
      units.push(value);continue;
     }
     throw new Error("unsupported modified UTF-8 lead byte");
    }
    let result="";
    for(let i=0;i<units.length;i+=4096)result+=String.fromCharCode(...units.slice(i,i+4096));
    return result;
   }
   if(u4()!==0xCAFEBABE)throw new Error("invalid class magic");
   out.minor=u2();out.major=u2();
   const cpCount=u2(),cp=new Array(cpCount);
   for(let i=1;i<cpCount;i++){
    const tag=u1();let v={tag};
    if(tag===1){const n=u2();v.value=decodeModifiedUtf8(take(n));}
    else if(tag===3){v.value=s4();}
    else if(tag===4){need(4);v.value=view.getFloat32(p);p+=4;}
    else if(tag===5){const hi=u4(),lo=u4();v.value=String((BigInt(hi)<<32n)|BigInt(lo));cp[i]=v;i++;continue;}
    else if(tag===6){need(8);v.value=view.getFloat64(p);p+=8;cp[i]=v;i++;continue;}
    else if(tag===7||tag===8||tag===16||tag===19||tag===20)v.index=u2();
    else if(tag===9||tag===10||tag===11||tag===12||tag===17||tag===18){v.a=u2();v.b=u2();}
    else if(tag===15){v.kind=u1();v.index=u2();}
    else throw new Error("unsupported constant-pool tag "+tag);
    cp[i]=v;
   }
   function utf(i){const x=cp[i];return x&&x.tag===1?x.value:null;}
   function cls(i){const x=cp[i];return x&&x.tag===7?utf(x.index):null;}
   function nameType(i){const x=cp[i];return x&&x.tag===12?{name:utf(x.a),descriptor:utf(x.b)}:null;}
   function member(i){
    const x=cp[i];if(!x||(x.tag!==9&&x.tag!==10&&x.tag!==11))return null;
    const nt=nameType(x.b);return {kind:x.tag===9?"field":x.tag===11?"interface-method":"method",owner:cls(x.a),name:nt&&nt.name,descriptor:nt&&nt.descriptor};
   }
   function constant(i){
    const x=cp[i];if(!x)return null;
    if(x.tag===3||x.tag===4||x.tag===5||x.tag===6)return x.value;
    if(x.tag===8)return utf(x.index);
    if(x.tag===7)return {class:cls(i)};
    return null;
   }
   const cpErrors=[];
   function cpCheck(ok,message){if(!ok)cpErrors.push(message);}
   for(let ci=1;ci<cp.length;ci++){
    const x=cp[ci];if(!x)continue;
    if(x.tag===7)cpCheck(!!utf(x.index),"CONSTANT_Class has an invalid name_index at #"+ci);
    else if(x.tag===8)cpCheck(!!utf(x.index),"CONSTANT_String has an invalid string_index at #"+ci);
    else if(x.tag===16)cpCheck(!!utf(x.index),"CONSTANT_MethodType has an invalid descriptor_index at #"+ci);
    else if(x.tag===19||x.tag===20)cpCheck(!!utf(x.index),"module/package constant has an invalid name_index at #"+ci);
    else if(x.tag===9||x.tag===10||x.tag===11){
     cpCheck(!!cls(x.a),"member reference has an invalid class_index at #"+ci);
     const nt=nameType(x.b);cpCheck(!!nt&&!!nt.name&&!!nt.descriptor,"member reference has an invalid NameAndType at #"+ci);
    }else if(x.tag===12)cpCheck(!!utf(x.a)&&!!utf(x.b),"NameAndType has an invalid UTF-8 reference at #"+ci);
    else if(x.tag===15){
     const ref=cp[x.index],kind=x.kind;
     const allowed=kind>=1&&kind<=4?ref&&ref.tag===9:
      kind===5||kind===8?ref&&ref.tag===10:
      kind===6||kind===7?ref&&(ref.tag===10||(out.major>=52&&ref.tag===11)):
      kind===9?ref&&ref.tag===11:false;
     cpCheck(!!allowed,"MethodHandle has an invalid reference_kind/reference_index at #"+ci);
    }else if(x.tag===17||x.tag===18){
     cpCheck(x.tag===17?out.major>=55:out.major>=51,"Dynamic/InvokeDynamic constant is not supported by this class-file version");
     const nt=nameType(x.b);cpCheck(!!nt&&!!nt.name&&!!nt.descriptor,"Dynamic constant has an invalid NameAndType at #"+ci);
    }
   }
   if(cpErrors.length)throw new Error(cpErrors.slice(0,8).join("; "));
   function decodeCode(code){
    const ins=[],counts={},calls=[],fieldRefs=[],strings=[],branches=[];
    let q=0;
    function byte(){if(q>=code.length)throw new Error("truncated bytecode");return code[q++];}
    function short(){const a=byte(),b=byte();return (a<<8)|b;}
    function signedByte(){const v=byte();return v&0x80?v-0x100:v;}
    function signedShort(){const v=short();return v&0x8000?v-0x10000:v;}
    function int32(){const a=byte(),b=byte(),c=byte(),d=byte();return a*0x1000000+b*0x10000+c*0x100+d;}
    function signedInt(){const v=int32();return v>0x7fffffff?v-0x100000000:v;}
    while(q<code.length){
     const pc=q,op=byte(),name=OPCODES[op];
     if(!name||name==="breakpoint")throw new Error("reserved or invalid JVM opcode 0x"+op.toString(16));
     const x={pc,opcode:op,name};counts[name]=(counts[name]||0)+1;
     if(op===0x10)x.operand=signedByte();
     else if(op===0x11)x.operand=signedShort();
     else if(op===0x12){x.cpIndex=byte();x.constant=constant(x.cpIndex);x.constantTag=cp[x.cpIndex]&&cp[x.cpIndex].tag;}
     else if(op===0x13||op===0x14){x.cpIndex=short();x.constant=constant(x.cpIndex);x.constantTag=cp[x.cpIndex]&&cp[x.cpIndex].tag;}
     else if((op>=0x15&&op<=0x19)||(op>=0x36&&op<=0x3a)||op===0xa9||op===0xbc)x.operand=byte();
     else if(op===0x84){x.local=byte();x.increment=signedByte();}
     else if((op>=0x99&&op<=0xa8)||op===0xc6||op===0xc7){x.offset=signedShort();x.target=pc+x.offset;branches.push(x.target);}
     else if(op===0xc8||op===0xc9){x.offset=signedInt();x.target=pc+x.offset;branches.push(x.target);}
     else if((op>=0xb2&&op<=0xb8)||op===0xbb||op===0xbd||op===0xc0||op===0xc1){x.cpIndex=short();x.member=member(x.cpIndex);x.className=cls(x.cpIndex);if(x.member){if(op>=0xb2&&op<=0xb5)fieldRefs.push(x.member);else calls.push(x.member);}}
     else if(op===0xb9){
      x.cpIndex=short();x.count=byte();x.zero=byte();x.member=member(x.cpIndex);
      if(!x.member||x.member.kind!=="interface-method")throw new Error("invokeinterface must reference CONSTANT_InterfaceMethodref");
      if(x.count===0||x.zero!==0)throw new Error("invalid invokeinterface count or trailing byte");
      if(x.member)calls.push(x.member);
     }
     else if(op===0xba){
      x.cpIndex=short();x.zero=short();const dyn=cp[x.cpIndex],nt=dyn&&dyn.tag===18?nameType(dyn.b):null;
      if(!dyn||dyn.tag!==18||x.zero!==0)throw new Error("invokedynamic must reference CONSTANT_InvokeDynamic and have zero trailing bytes");
      x.dynamic=nt||null;
     }
     else if(op===0xc5){x.cpIndex=short();x.dimensions=byte();x.className=cls(x.cpIndex);}
     else if(op===0xaa){
      while(q%4!==0){if(byte()!==0)throw new Error("non-zero switch padding");}
      x.defaultOffset=signedInt();x.low=signedInt();x.high=signedInt();x.targets=[];
      const count=x.high-x.low+1;if(count<1||count>Math.floor((code.length-q)/4))throw new Error("invalid tableswitch range or truncated target table");
      for(let k=0;k<count;k++)x.targets.push(pc+signedInt());
      branches.push(pc+x.defaultOffset,...x.targets);
     }else if(op===0xab){
      while(q%4!==0)byte();
      x.defaultOffset=signedInt();const count=signedInt();if(count<0||count>Math.floor((code.length-q)/8))throw new Error("invalid lookupswitch size or truncated pair table");
      x.pairs=[];let previousKey=-Infinity;
      for(let k=0;k<count;k++){const key=signedInt(),target=pc+signedInt();if(key<=previousKey)throw new Error("lookupswitch keys are not strictly increasing");previousKey=key;x.pairs.push({key,target});}
      branches.push(pc+x.defaultOffset,...x.pairs.map(z=>z.target));
     }else if(op===0xc4){
      x.wideOpcode=byte();x.name=OPCODES[x.wideOpcode];
      if(!["iload","lload","fload","dload","aload","istore","lstore","fstore","dstore","astore","ret","iinc"].includes(x.name))throw new Error("invalid wide opcode");
      x.local=short();
      if(x.wideOpcode===0x84)x.increment=signedShort();
     }
     if(x.name==="ldc"||x.name==="ldc_w"||x.name==="ldc2_w"){
      if(typeof x.constant==="string")strings.push(x.constant);
     }
     ins.push(x);
    }
    if(q!==code.length)throw new Error("bytecode decoder did not consume the method");
    return {instructions:ins,opcodeCounts:counts,invocations:calls,fieldAccesses:fieldRefs,stringConstants:Array.from(new Set(strings)),branchTargets:Array.from(new Set(branches)).sort((a,b)=>a-b)};
   }
   out.accessFlags=u2();const thisIndex=u2(),superIndex=u2();
   out.className=cls(thisIndex);out.superName=superIndex?cls(superIndex):null;
   if(!out.className)throw new Error("this_class does not reference a valid CONSTANT_Class");
   if(superIndex&&!out.superName)throw new Error("super_class does not reference a valid CONSTANT_Class");
   const intCount=u2();for(let i=0;i<intCount;i++){const interfaceName=cls(u2());if(!interfaceName)throw new Error("interface index does not reference a valid CONSTANT_Class");out.interfaces.push(interfaceName);}
   function readMembers(target,isMethod){
    const count=u2();
    for(let i=0;i<count;i++){
     const access=u2(),name=utf(u2()),descriptor=utf(u2()),record={accessFlags:access,name,descriptor,attributes:[]};
     if(!name||!descriptor)throw new Error("member name or descriptor does not reference CONSTANT_Utf8");
     const ac=u2();
     for(let j=0;j<ac;j++){
      const attrName=utf(u2()),length=u4(),end=p+length;
      if(end>view.byteLength)throw new Error("attribute exceeds class file boundary");
      if(isMethod&&attrName==="Code"){
       const maxStack=u2(),maxLocals=u2(),codeLength=u4();
       if(codeLength>65535)throw new Error("Code.code_length exceeds JVM class-file limit");
       const codeBytes=take(codeLength);
       const exceptionCount=u2(),exceptions=[];
       for(let z=0;z<exceptionCount;z++){const start=u2(),end=u2(),handler=u2(),catchIndex=u2(),catchType=catchIndex?cls(catchIndex):null;if(catchIndex&&!catchType)throw new Error("exception catch_type does not reference CONSTANT_Class");exceptions.push({start,end,handler,catchType});}
       const nested=u2();
       for(let z=0;z<nested;z++){u2();const n=u4();take(n);}
       let decoded;
       try{decoded=decodeCode(codeBytes);}catch(error){decoded={instructions:[],opcodeCounts:{},invocations:[],fieldAccesses:[],stringConstants:[],branchTargets:[],decodeError:error.message};}
       record.code={maxStack,maxLocals,codeLength,instructions:decoded.instructions,opcodeCounts:decoded.opcodeCounts,invocations:decoded.invocations,fieldAccesses:decoded.fieldAccesses,stringConstants:decoded.stringConstants,branchTargets:decoded.branchTargets,exceptions,decodeError:decoded.decodeError||null};
       record.code.verification=root.Jar2ZeusBytecodeVerifier?
        root.Jar2ZeusBytecodeVerifier.verify({code:record.code,descriptor,isStatic:!!(access&8)}):
        {valid:false,structuralOnly:true,errors:["bytecode-verifier.js was not loaded"],warnings:[]};
      }else take(length);
      if(p>end)throw new Error("method attribute overread: "+attrName);
      if(attrName==="Code"&&p!==end)throw new Error("Code attribute length does not match its parsed contents");
      if(p!==end) p=end;
      record.attributes.push(attrName);
     }
     target.push(record);
    }
   }
   readMembers(out.fields,false);readMembers(out.methods,true);
   const attrCount=u2();
   for(let i=0;i<attrCount;i++){u2();const n=u4();take(n);}
   if(p!==view.byteLength)throw new Error("trailing bytes remain after the class-file structure");
   const refs=new Set([out.className,out.superName,...out.interfaces].filter(Boolean));
   for(let ci=1;ci<cp.length;ci++){if(cp[ci]&&cp[ci].tag===7){const v=cls(ci);if(v)refs.add(v);}}
   for(const m of out.methods)if(m.code)for(const inv of m.code.invocations)if(inv.owner)refs.add(inv.owner);
   out.references=Array.from(refs).sort();
   out.invocations=out.methods.flatMap(m=>(m.code&&m.code.invocations||[]).map(x=>Object.assign({method:m.name,descriptor:m.descriptor},x)));
   out.valid=true;
   return out;
  }catch(e){out.error=String(e&&e.message||e);return out;}
 }
 root.Jar2ZeusBytecode={parse,opcodes:OPCODES};
})(typeof globalThis!=="undefined"?globalThis:this);
