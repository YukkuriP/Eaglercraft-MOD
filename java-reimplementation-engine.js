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
  if(!(m.accessFlags&8)||!d||d.args.some(x=>x!=="I")||d.result!=="I"||!c||c.decodeError)return null;
  if((c.branchTargets||[]).length||(c.exceptions||[]).length||(c.fieldAccesses||[]).length)return null;
  const invocationInstructions=(c.instructions||[]).filter(x=>/^invoke/.test(x.name));
  if(invocationInstructions.some(x=>x.name!=="invokestatic"||!x.member||x.member.owner!=="java/lang/Math"||!["abs","max","min"].includes(x.member.name)))return null;
  if(m.name.startsWith("<")||RESTRICTED.test(clazz.className+"."+m.name))return null;
  const stack=[],locals=new Map(),params=[];
  for(let i=0;i<d.args.length;i++){const n="arg"+i;locals.set(i,n);params.push(n);}
  const lines=[];
  function pop(){if(!stack.length)throw Error("stack underflow");return stack.pop();}
  function i32(x){return "((("+x+") + 2147483648) % 4294967296 - 2147483648)";}
  try{
   for(const x of c.instructions||[]){
    const n=x.name;
    if(n==="nop")continue;
    if(n==="iconst_m1"){stack.push("-1");continue;}
    if(/^iconst_[0-5]$/.test(n)){stack.push(n.slice(-1));continue;}
    if(n==="bipush"||n==="sipush"){stack.push(String(x.operand));continue;}
    let match=n.match(/^iload_([0-3])$/);
    if(match){const v=locals.get(Number(match[1]));if(!v)return null;stack.push(v);continue;}
    if(n==="iload"){const v=locals.get(x.operand);if(!v)return null;stack.push(v);continue;}
    match=n.match(/^istore_([0-3])$/);
    if(match){const slot=Number(match[1]),v="v"+slot;locals.set(slot,v);lines.push("  local "+v+" = "+pop());continue;}
    if(n==="istore"){const v="v"+x.operand;locals.set(x.operand,v);lines.push("  local "+v+" = "+pop());continue;}
    if(n==="iinc"){const v=locals.get(x.local);if(!v)return null;lines.push("  "+v+" = "+i32(v+" + "+x.increment));continue;}
    if(["iadd","isub","imul","idiv","irem","iand","ior","ixor","ishl","ishr","iushr"].includes(n)){
     const b=pop(),a=pop();let e;
     if(n==="idiv")e="math.modf(("+a+") / ("+b+"))";
     else if(n==="irem")e="(("+a+") - math.modf(("+a+") / ("+b+")) * ("+b+"))";
     else if(n==="iand")e="("+a+" & "+b+")";
     else if(n==="ior")e="("+a+" | "+b+")";
     else if(n==="ixor")e="("+a+" ~ "+b+")";
     else if(n==="ishl")e="("+a+" << ("+b+" & 31))";
     else if(n==="ishr")e="("+a+" >> ("+b+" & 31))";
     else if(n==="iushr")e="(("+a+" & 0xffffffff) >> ("+b+" & 31))";
     else e="("+a+") "+({iadd:"+",isub:"-",imul:"*"}[n])+" ("+b+")";
     stack.push(i32(e));continue;
    }
    if(n==="invokestatic"&&x.member&&x.member.owner==="java/lang/Math"){
     const desc=descriptor(x.member.descriptor);
     if(!desc||desc.args.some(t=>t!=="I")||desc.result!=="I")return null;
     const args=[];for(let ai=0;ai<desc.args.length;ai++)args.unshift(pop());
     if(x.member.name==="abs"&&args.length===1)stack.push(i32("math.abs("+args[0]+")"));
     else if(x.member.name==="max"&&args.length===2)stack.push(i32("math.max("+args[0]+", "+args[1]+")"));
     else if(x.member.name==="min"&&args.length===2)stack.push(i32("math.min("+args[0]+", "+args[1]+")"));
     else return null;
     continue;
    }
    if(n==="i2b"||n==="i2s"||n==="i2c"){
     const a=pop(),mask=n==="i2b"?255:65535;
     const signed=n==="i2b"?128:32768;
     const converted=n==="i2c"?"(("+a+") & "+mask+")":"((("+a+") & "+mask+") >= "+signed+" and (("+a+") & "+mask+") - "+(mask+1)+" or (("+a+") & "+mask+"))";
     stack.push(i32(converted));continue;
    }
    if(n==="ineg"){stack.push(i32("-("+pop()+")"));continue;}
    if(n==="pop"){pop();continue;}
    if(n==="dup"){const a=pop();stack.push(a,a);continue;}
    if(n==="ireturn")return {params,lua:lines.concat(["  return "+i32(pop())]).join("\n")};
    return null;
   }
  }catch(_){return null;}
  return null;
 }
 function isRestrictedClass(clazz){
  if(RESTRICTED.test(clazz.className||""))return true;
  for(const m of clazz.methods||[]){
   if(RESTRICTED.test(m.name||""))return true;
   for(const call of (m.code&&m.code.invocations)||[])if(RESTRICTED.test((call.owner||"")+"."+ (call.name||"")))return true;
   for(const field of (m.code&&m.code.fieldAccesses)||[])if(RESTRICTED.test((field.owner||"")+"."+ (field.name||"")))return true;
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
  const report={schema:"jar2zeus.reimplementation.v1",engine:"conservative-jvm-subset",status:"analysis-only",classesSeen:classes.length,methodsSeen:0,utilityMethodsTranslated:0,methodsPending:0,methodsSkipped:0,translated:[],pending:[],skipped:[],warnings:[]};
  const plan={schema:"jar2zeus.reimplementation-plan.v1",tasks:[],featureCounts:{},notes:[
   "自動翻訳は副作用のないint型static補助メソッドの限定的なバイトコードに限ります。",
   "Minecraft/Forge/Fabricの処理はZeus APIへ対応するアダプターによる再設計が必要です。",
   "Lua関数の生成だけではゲームイベントとの接続・同等動作の保証にはなりません。"
  ]};
  const lua=["-- Conservative Java-to-Lua reimplementation generated by Jar2Zeus.","local __jar2zeus_java_helpers = {}"];
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
     report.translated.push({className:clazz.className,method:m.name,descriptor:m.descriptor,kind:"pure-static-int-helper",symbol:key});
    }else{
     const feature=role(m),calls=(m.code.invocations||[]).slice(0,60).map(x=>({owner:x.owner,name:x.name,descriptor:x.descriptor}));
     report.methodsPending++;
     report.pending.push({className:clazz.className,method:m.name,descriptor:m.descriptor,feature,evidence:calls,reason:(m.code.branchTargets||[]).length?"control flow must be reconstructed":calls.length?"Java/loader API calls need a Zeus adapter":"method uses bytecode outside the safe auto-translation subset"});
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
  report.status=report.methodsPending?"partial-reimplementation":"utility-subset-translated";
  if(!report.methodsSeen)report.warnings.push("解析可能なJavaメソッド本体が見つかりませんでした。");
  if(report.methodsPending)report.warnings.push("未再実装のJavaメソッドが残っています。完全移植とは判定しません。");
  if(!report.utilityMethodsTranslated)report.warnings.push("自動翻訳できる単純なint型補助メソッドは見つかりませんでした。");
  return {lua:lua.join("\n")+"\n",report,plan};
 }
 root.Jar2ZeusReimplementation={run,descriptor,pureHelper};
})(typeof globalThis!=="undefined"?globalThis:this);
