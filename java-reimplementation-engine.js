/* Conservative Java bytecode -> Lua reimplementation. */
(function(root){
 "use strict";
 const RESTRICTED=/(?:cannon|artillery|projectile|munition|firearm|weapon|rifle|pistol|musket|sword|bow|crossbow|trident)/i;
 function descriptor(s){
  if(typeof s!=="string"||s[0]!=="(")return null;
  let p=1;const args=[];
  while(p<s.length&&s[p]!==")"){
   const c=s[p++];
   if(c==="L"){const e=s.indexOf(";",p);if(e<0)return null;p=e+1;args.push("L");}
   else if(c==="["){while(s[p]==="[")p++;if(s[p]==="L"){const e=s.indexOf(";",p);if(e<0)return null;p=e+1;}else p++;args.push("A");}
   else if("ZBCSIJFD".includes(c))args.push(c);else return null;
  }
  if(s[p++]!==")")return null;
  const result=s[p++];
  if(!"VZBCSIJFDL[".includes(result))return null;
  if(result==="L"){const e=s.indexOf(";",p);if(e<0)return null;p=e+1;}
  else if(result==="["){while(s[p]==="[")p++;if(s[p]==="L"){const e=s.indexOf(";",p);if(e<0)return null;p=e+1;}else p++;}
  if(p!==s.length)return null;
  return {args,result};
 }
 function q(s){return '"'+String(s).replace(/\\/g,"\\\\").replace(/"/g,'\\"').replace(/\r/g,"\\r").replace(/\n/g,"\\n")+'"';}
 function pureHelper(clazz,m){
  const d=descriptor(m.descriptor),c=m.code;
  const intTypes=new Set(["Z","B","C","S","I"]);
  if(!(m.accessFlags&8)||!d||!intTypes.has(d.result)||d.args.some(x=>!intTypes.has(x))||!c||c.decodeError)return null;
  if(c.exceptions&&c.exceptions.length)return null;
  if(m.name.startsWith("<")||RESTRICTED.test(clazz.className+"."+m.name))return null;
  if((c.fieldAccesses||[]).length)return null;
  const ins=c.instructions||[];
  if(!ins.length||ins.length>5000||c.codeLength>20000)return null;
  const pcs=new Set(ins.map(x=>x.pc));
  for(const target of c.branchTargets||[])if(!pcs.has(target))return null;
  for(let i=0;i<ins.length;i++){
   const x=ins[i],n=x.name;
   if(["goto","goto_w","ifeq","ifne","iflt","ifge","ifgt","ifle","if_icmpeq","if_icmpne","if_icmplt","if_icmpge","if_icmpgt","if_icmple"].includes(n)&&!pcs.has(x.target))return null;
   if(n==="tableswitch"&&(!pcs.has(x.pc+x.defaultOffset)||(x.targets||[]).some(t=>!pcs.has(t))))return null;
   if(n==="lookupswitch"&&(!pcs.has(x.pc+x.defaultOffset)||(x.pairs||[]).some(t=>!pcs.has(t.target))))return null;
  }
  const invocationInstructions=ins.filter(x=>/^invoke/.test(x.name));
  for(const x of invocationInstructions){
   if(x.name!=="invokestatic"||!x.member||x.member.owner!=="java/lang/Math")return null;
   const md=descriptor(x.member.descriptor);
   if(!md||md.args.some(t=>t!=="I")||md.result!=="I")return null;
   const valid=(x.member.name==="abs"&&md.args.length===1)||((x.member.name==="min"||x.member.name==="max")&&md.args.length===2);
   if(!valid)return null;
  }
  const params=[];
  for(let i=0;i<d.args.length;i++)params.push("arg"+i);
  const localInit=params.map((name,i)=>"__locals["+i+"] = "+name);
  const nextPc=i=>i+1<ins.length?ins[i+1].pc:null;
  const cases=[];
  function targetOrError(value){return value==null?"error('Java method fell through without return')":"__pc = "+value;}
  function localIndex(x,n){
   if(x.wideOpcode!=null)return x.local;
   if(n.endsWith("_0"))return 0;
   if(n.endsWith("_1"))return 1;
   if(n.endsWith("_2"))return 2;
   if(n.endsWith("_3"))return 3;
   return x.operand;
  }
  function integerReturn(expr){
   if(d.result==="Z")return "("+expr+" ~= 0)";
   if(d.result==="B")return "((("+expr+") & 255) >= 128 and (("+expr+") & 255) - 256 or (("+expr+") & 255))";
   if(d.result==="S")return "((("+expr+") & 65535) >= 32768 and (("+expr+") & 65535) - 65536 or (("+expr+") & 65535))";
   if(d.result==="C")return "(("+expr+") & 65535)";
   return "__jar2zeus_i32("+expr+")";
  }
  for(let i=0;i<ins.length;i++){
   const x=ins[i],n=x.name,next=nextPc(i),fall=targetOrError(next),code=[];
   const push=e=>"__push("+e+")";
   const pop=()=> "__pop()";
   if(n==="nop")code.push(fall);
   else if(n==="iconst_m1")code.push(push("-1"),fall);
   else if(/^iconst_[0-5]$/.test(n))code.push(push(n.slice(-1)),fall);
   else if(n==="bipush"||n==="sipush")code.push(push(String(x.operand)),fall);
   else if(n==="ldc"||n==="ldc_w"||n==="ldc2_w"){
    if(!Number.isInteger(x.constant))return null;
    code.push(push(String(x.constant)),fall);
   }else{
    let match=n.match(/^iload(?:_([0-3]))?$/);
    if(match){
     const slot=match[1]==null?localIndex(x,n):Number(match[1]);
     if(!Number.isInteger(slot))return null;
     code.push(push("__locals["+slot+"]"),fall);
    }else if((match=n.match(/^istore(?:_([0-3]))?$/))){
     const slot=match[1]==null?localIndex(x,n):Number(match[1]);
     if(!Number.isInteger(slot))return null;
     code.push("__locals["+slot+"] = "+pop(),fall);
    }else if(n==="iinc"){
     const slot=x.local!=null?x.local:x.operand;
     if(!Number.isInteger(slot)||!Number.isInteger(x.increment))return null;
     code.push("__locals["+slot+"] = __jar2zeus_i32(__locals["+slot+"] + ("+x.increment+"))",fall);
    }else if(["iadd","isub","imul","idiv","irem","iand","ior","ixor","ishl","ishr","iushr"].includes(n)){
     const a="__a",b="__b";
     code.push("local "+a+" = "+pop(),"local "+b+" = "+pop());
     let expr;
     if(n==="iadd")expr=b+" + "+a;
     else if(n==="isub")expr=b+" - "+a;
     else if(n==="imul")expr=b+" * "+a;
     else if(n==="idiv")expr="__jar2zeus_idiv("+b+", "+a+")";
     else if(n==="irem")expr="__jar2zeus_irem("+b+", "+a+")";
     else if(n==="iand")expr="("+b+" & "+a+")";
     else if(n==="ior")expr="("+b+" | "+a+")";
     else if(n==="ixor")expr="("+b+" ~ "+a+")";
     else if(n==="ishl")expr="("+b+" << ("+a+" & 31))";
     else if(n==="ishr")expr="__jar2zeus_ishr("+b+", "+a+")";
     else expr="(("+b+" & 0xffffffff) >> ("+a+" & 31))";
     code.push(push("__jar2zeus_i32("+expr+")"),fall);
    }else if(n==="ineg"){
     code.push(push("__jar2zeus_i32(-("+pop()+"))"),fall);
    }else if(n==="i2b"||n==="i2s"||n==="i2c"){
     const v="__v";code.push("local "+v+" = "+pop());
     let expr=n==="i2c"?"("+v+" & 65535)":n==="i2b"?"((("+v+" & 255) >= 128) and ("+v+" & 255) - 256 or ("+v+" & 255))":"((("+v+" & 65535) >= 32768) and ("+v+" & 65535) - 65536 or ("+v+" & 65535))";
     code.push(push("__jar2zeus_i32("+expr+")"),fall);
    }else if(n==="invokestatic"){
     const md=descriptor(x.member.descriptor),args=[];
     for(let z=0;z<md.args.length;z++)args.unshift(pop());
     let expr;
     if(x.member.name==="abs")expr="math.abs("+args[0]+")";
     else if(x.member.name==="min")expr="math.min("+args.join(", ")+")";
     else expr="math.max("+args.join(", ")+")";
     code.push(push("__jar2zeus_i32("+expr+")"),fall);
    }else if(n==="pop")code.push(pop(),fall);
    else if(n==="pop2")code.push(pop(),pop(),fall);
    else if(n==="dup"){
     code.push("local __v = "+pop(),push("__v"),push("__v"),fall);
    }else if(n==="dup_x1"){
     code.push("local __a = "+pop(),"local __b = "+pop(),push("__a"),push("__b"),push("__a"),fall);
    }else if(n==="dup_x2"){
     code.push("local __a = "+pop(),"local __b = "+pop(),"local __c = "+pop(),push("__a"),push("__c"),push("__b"),push("__a"),fall);
    }else if(n==="dup2"){
     code.push("local __a = "+pop(),"local __b = "+pop(),push("__b"),push("__a"),push("__b"),push("__a"),fall);
    }else if(n==="dup2_x1"){
     code.push("local __a = "+pop(),"local __b = "+pop(),"local __c = "+pop(),push("__b"),push("__a"),push("__c"),push("__b"),push("__a"),fall);
    }else if(n==="dup2_x2"){
     code.push("local __a = "+pop(),"local __b = "+pop(),"local __c = "+pop(),"local __d = "+pop(),push("__b"),push("__a"),push("__d"),push("__c"),push("__b"),push("__a"),fall);
    }else if(n==="swap"){
     code.push("local __a = "+pop(),"local __b = "+pop(),push("__a"),push("__b"),fall);
    }else if(n==="goto"||n==="goto_w")code.push("__pc = "+x.target);
    else if(["ifeq","ifne","iflt","ifge","ifgt","ifle"].includes(n)){
     const v="__v";code.push("local "+v+" = "+pop());
     const test={"ifeq":v+" == 0","ifne":v+" ~= 0","iflt":v+" < 0","ifge":v+" >= 0","ifgt":v+" > 0","ifle":v+" <= 0"}[n];
     code.push("if "+test+" then __pc = "+x.target+" else "+fall+" end");
    }else if(["if_icmpeq","if_icmpne","if_icmplt","if_icmpge","if_icmpgt","if_icmple"].includes(n)){
     code.push("local __a = "+pop(),"local __b = "+pop());
     const op={"if_icmpeq":"==","if_icmpne":"~=","if_icmplt":"<","if_icmpge":">=","if_icmpgt":">","if_icmple":"<="}[n];
     code.push("if __b "+op+" __a then __pc = "+x.target+" else "+fall+" end");
    }else if(n==="tableswitch"){
     const v="__switch";code.push("local "+v+" = "+pop(),"if false then __pc = "+(x.pc+x.defaultOffset));
     for(let k=0;k<(x.targets||[]).length;k++)code.push("elseif "+v+" == "+(x.low+k)+" then __pc = "+x.targets[k]);
     code.push("else __pc = "+(x.pc+x.defaultOffset)+" end");
    }else if(n==="lookupswitch"){
     const v="__switch";code.push("local "+v+" = "+pop(),"if false then __pc = "+(x.pc+x.defaultOffset));
     for(const pair of x.pairs||[])code.push("elseif "+v+" == "+pair.key+" then __pc = "+pair.target);
     code.push("else __pc = "+(x.pc+x.defaultOffset)+" end");
    }else if(n==="ireturn"){
     const v=pop();code.push("return "+integerReturn(v));
    }else return null;
   }
   cases.push((i===0?"if":"elseif")+" __pc == "+x.pc+" then\n      "+code.join("\n      "));
  }
  const body=[
   "local __stack, __sp = {}, 0",
   "local __locals = {}",
   ...localInit,
   "local function __push(v) __sp = __sp + 1; __stack[__sp] = v end",
   "local function __pop() if __sp < 1 then error('Java operand stack underflow') end; local v = __stack[__sp]; __stack[__sp] = nil; __sp = __sp - 1; return v end",
   "local __pc = "+ins[0].pc,
   "local __budget = 100000",
   "while __budget > 0 do",
   "  __budget = __budget - 1",
   "  "+cases.join("\n  "),
   "  else error('Invalid Java bytecode PC: ' .. tostring(__pc)) end",
   "end",
   "error('Java method instruction budget exceeded')"
  ].join("\n");
  return {params,lua:body,descriptor:m.descriptor,controlFlow:(c.branchTargets||[]).length>0};
 }
 function isRestrictedClass(clazz){
  if(RESTRICTED.test(clazz.className||""))return true;
  for(const m of clazz.methods||[]){
   if(RESTRICTED.test(m.name||""))return true;
   for(const call of (m.code&&m.code.invocations)||[])if(RESTRICTED.test((call.owner||"")+"."+ (call.name||"")))return true;
   for(const field of (m.code&&m.code.fieldAccesses)||[])if(RESTRICTED.test((field.owner||"")+"."+ (field.name||"")))return true;
   for(const value of (m.code&&m.code.stringConstants)||[])if(RESTRICTED.test(value))return true;
  }
  return false;
 }
 function role(method){
  const s=(method.name+" "+(method.code&&method.code.invocations||[]).map(x=>(x.owner||"")+"."+x.name).join(" ")).toLowerCase();
  if(/recipe|crafting|smelt/.test(s))return "recipes";
  if(/block|item|registry|register/.test(s))return "blocks-items";
  if(/entity|mob/.test(s))return "entities";
  if(/render|model|texture/.test(s))return "rendering";
  if(/network|packet/.test(s))return "networking";
  if(/worldgen|biome|chunk/.test(s))return "world-generation";
  if(/screen|gui|menu/.test(s))return "ui";
  if(/config|setting/.test(s))return "configuration";
  if(/storage|nbt|save/.test(s))return "storage";
  if(/event|tick|init|setup/.test(s))return "events-and-timers";
  return "general-java-logic";
 }
 function run(input){
  const classes=Array.isArray(input&&input.classes)?input.classes:[];
  const report={schema:"jar2zeus.reimplementation.v1",engine:"integer-control-flow-subset",status:"analysis-only",classesSeen:classes.length,methodsSeen:0,utilityMethodsTranslated:0,controlFlowMethodsTranslated:0,methodsPending:0,methodsSkipped:0,translated:[],pending:[],skipped:[],warnings:[]};
  const plan={schema:"jar2zeus.reimplementation-plan.v1",tasks:[],featureCounts:{},notes:[
   "自動翻訳は整数系static補助メソッドの限定的なJVM命令に限ります。",
   "対応する条件分岐・switch・ループは命令予算を設けたLua実行関数へ変換します。",
   "Minecraft/Forge/Fabricの状態・イベント処理はZeus APIアダプターによる再設計が必要です。",
   "生成した補助関数はJava側の呼び出し経路やゲームイベントへ自動接続されるわけではありません。"
  ]};
  const lua=["-- Conservative Java-to-Lua reimplementation generated by Jar2Zeus.","local function __jar2zeus_i32(v) local n=math.tointeger(v) or math.tointeger(math.floor(tonumber(v) or 0)) or 0; n=n & 0xffffffff; if n>=0x80000000 then return n-0x100000000 end; return n end","local function __jar2zeus_ishr(value,count) local shift=(math.tointeger(count) or 0) & 31; local v=__jar2zeus_i32(value); if shift==0 then return v end; local result=v >> shift; if v<0 then result=result | ((0xffffffff << (32-shift)) & 0xffffffff) end; return __jar2zeus_i32(result) end","local __jar2zeus_java_helpers = {}","local function __jar2zeus_idiv(a,b) if b == 0 then error('java.lang.ArithmeticException: / by zero') end; if a == -2147483648 and b == -1 then return -2147483648 end; return math.modf(a / b) end","local function __jar2zeus_irem(a,b) if b == 0 then error('java.lang.ArithmeticException: / by zero') end; return a - __jar2zeus_idiv(a,b) * b end"];
  for(const clazz of classes){
   if(!clazz||!clazz.valid)continue;
   if(isRestrictedClass(clazz)){
    report.methodsSkipped+=(clazz.methods||[]).length;
    report.skipped.push({className:clazz.className,reason:"restricted feature family"});
    continue;
   }
   for(const m of clazz.methods||[]){
    if(!m.code)continue;
    report.methodsSeen++;
    if(RESTRICTED.test(m.name||"")){report.methodsSkipped++;continue;}
    const converted=pureHelper(clazz,m);
    if(converted){
     const key=clazz.className+"."+m.name+m.descriptor;
     lua.push("__jar2zeus_java_helpers["+q(key)+"] = function("+converted.params.join(", ")+")");
     lua.push(converted.lua);
     lua.push("end");
     report.utilityMethodsTranslated++;
     report.translated.push({className:clazz.className,method:m.name,descriptor:m.descriptor,kind:"pure-static-primitive-helper",symbol:key,controlFlow:converted.controlFlow===true});
     if(converted.controlFlow)report.controlFlowMethodsTranslated++;
    }else{
     const feature=role(m),calls=(m.code.invocations||[]).slice(0,60).map(x=>({owner:x.owner,name:x.name,descriptor:x.descriptor}));
     report.methodsPending++;
     report.pending.push({className:clazz.className,method:m.name,descriptor:m.descriptor,feature,evidence:calls,reason:m.code.decodeError?"bytecode decode error: "+m.code.decodeError:(m.code.exceptions||[]).length?"exception handlers require a dedicated adapter":(m.code.fieldAccesses||[]).length?"method reads or changes Java object/static state":calls.length?"Java/loader API or a helper outside the verified translation subset":"descriptor, opcode, or stack behavior is outside the verified translation subset"});
     plan.featureCounts[feature]=(plan.featureCounts[feature]||0)+1;
    }
   }
  }
  const groups=new Map();
  for(const item of report.pending){if(!groups.has(item.feature))groups.set(item.feature,[]);groups.get(item.feature).push(item);}
  for(const [feature,items] of groups){
   const observed=Array.from(new Set(items.flatMap(x=>x.evidence.map(v=>(v.owner||"")+"."+v.name)))).slice(0,80);
   plan.tasks.push({id:"rewrite-"+feature,feature,sourceMethods:items.map(x=>x.className+"."+x.method+x.descriptor),observedCalls:observed,requiredWork:"Zeus APIを使う機能アダプターとして同等の処理を再実装し、実機で検証する"});
  }
  report.status=report.methodsPending?"partial-reimplementation":report.utilityMethodsTranslated?"utility-subset-translated":"no-translatable-methods";
  if(!report.methodsSeen)report.warnings.push("解析可能なJavaメソッド本体が見つかりませんでした。");
  if(report.methodsPending)report.warnings.push("未再実装のJavaメソッドが残っています。完全移植とは判定しません。");
  if(!report.utilityMethodsTranslated)report.warnings.push("自動翻訳できる単純なint型補助メソッドは見つかりませんでした。");
  return {lua:lua.join("\n")+"\n",report,plan};
 }
 root.Jar2ZeusReimplementation={run,descriptor,pureHelper};
})(typeof globalThis!=="undefined"?globalThis:this);
