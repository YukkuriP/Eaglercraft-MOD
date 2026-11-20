/* JVM class/object structure reconstruction for Jar2Zeus.
 * Builds a conservative metadata model from parsed class files; never executes Java.
 * It does not claim to recover runtime object values or arbitrary JVM semantics.
 */
(function(root){
 "use strict";
 const BLOCKED=/(?:cannon|artillery|projectile|munition|firearm|weapon|rifle|pistol|musket|sword|bow|crossbow|trident)/i;
 const ACC={PUBLIC:1,PRIVATE:2,PROTECTED:4,STATIC:8,FINAL:16,SYNCHRONIZED:32,VOLATILE:64,TRANSIENT:128,NATIVE:256,INTERFACE:512,ABSTRACT:1024,STRICT:2048,SYNTHETIC:4096,ANNOTATION:8192,ENUM:16384,MODULE:32768};
 function parseType(s,p){
  if(typeof s!=="string"||p>=s.length)return null;
  let start=p,depth=0;
  while(s[p]==="["){depth++;p++;}
  const c=s[p++];
  if("ZBCSIJFDV".includes(c)){
   if(c==="V"&&(depth||p!==start+1))return null;
   return {descriptor:s.slice(start,p),kind:depth?"array":({Z:"boolean",B:"byte",C:"char",S:"short",I:"int",J:"long",F:"float",D:"double",V:"void"}[c]),slots:c==="V"?0:(depth?1:(c==="J"||c==="D"?2:1)),next:p};
  }
  if(c==="L"){
   const end=s.indexOf(";",p);if(end<0||end===p)return null;
   const name=s.slice(p,end);if(name.includes(".")||name.includes("[")||name.includes(";"))return null;
   return {descriptor:s.slice(start,end+1),kind:depth?"array":"object",className:name,slots:1,next:end+1};
  }
  return null;
 }
 function methodDescriptor(s){
  if(typeof s!=="string"||s[0]!=="(")return null;
  const args=[];let p=1,slots=0;
  while(p<s.length&&s[p]!==")"){
   const t=parseType(s,p);if(!t||t.kind==="void")return null;
   args.push({descriptor:t.descriptor,kind:t.kind,className:t.className||null,slots:t.slots});slots+=t.slots;p=t.next;
  }
  if(s[p++]!==")")return null;
  const result=parseType(s,p);if(!result||result.next!==s.length)return null;
  return {arguments:args,returnType:{descriptor:result.descriptor,kind:result.kind,className:result.className||null},argumentSlots:slots};
 }
 function fieldDescriptor(s){const t=parseType(s,0);return t&&t.next===s.length&&t.kind!=="void"?{descriptor:t.descriptor,kind:t.kind,className:t.className||null,slots:t.slots}:null;}
 function flags(n,isMethod){
  const names=isMethod?["PUBLIC","PRIVATE","PROTECTED","STATIC","FINAL","SYNCHRONIZED","BRIDGE","VARARGS","NATIVE","ABSTRACT","STRICT","SYNTHETIC"]:["PUBLIC","PRIVATE","PROTECTED","STATIC","FINAL","VOLATILE","TRANSIENT","SYNTHETIC","ENUM"];
  const bits=isMethod?[1,2,4,8,16,32,64,128,256,1024,2048,4096]:[1,2,4,8,16,64,128,4096,16384];
  return names.filter((x,i)=>(n&bits[i])!==0);
 }
 function analyze(classes){
  const accepted=(classes||[]).filter(c=>c&&c.valid&&typeof c.className==="string"&&!BLOCKED.test(c.className));
  const byName=new Map(accepted.map(c=>[c.className,c]));
  const report={schema:"jar2zeus.class-object-model.v1",scope:"static class-file metadata only; no Java execution, heap reconstruction, annotation evaluation, or full JVM verifier",totals:{classesSeen:(classes||[]).length,classesModeled:0,fields:0,staticFields:0,instanceFields:0,constantFields:0,methods:0,constructors:0,staticMethods:0,abstractMethods:0,syntheticMembers:0,internalFieldReferences:0,externalFieldReferences:0,internalCalls:0,externalCalls:0,objectAllocations:0,arrayAllocations:0,constructorCalls:0,constructorFieldWrites:0,staticInitializerFieldWrites:0,unresolvedSuperclasses:0,interfaces:0},classes:[],hierarchy:[],fieldUsage:[],objectAllocations:[],arrayAllocations:[],constructorCalls:[],callEdges:[],warnings:[]};
  for(const c of accepted){
   const classMethods=c.methods||[],fields=c.fields||[];
   const model={name:c.className,superName:c.superName||null,interfaces:(c.interfaces||[]).slice(),accessFlags:c.accessFlags||0,access:flags(c.accessFlags||0,false),kind:(c.accessFlags&8192)?"annotation":(c.accessFlags&512)?"interface":(c.accessFlags&16384)?"enum":"class",fields:[],methods:[],constructors:[],references:(c.references||[]).filter(x=>x!==c.className),relationships:{knownSuperclass:!!(c.superName&&byName.has(c.superName)),knownInterfaces:(c.interfaces||[]).filter(x=>byName.has(x)),externalInterfaces:(c.interfaces||[]).filter(x=>!byName.has(x))}};
   for(const f of fields){
    const d=fieldDescriptor(f.descriptor),isStatic=!!(f.accessFlags&8),isFinal=!!(f.accessFlags&16);
    const item={name:f.name,descriptor:f.descriptor,validDescriptor:!!d,type:d||null,accessFlags:f.accessFlags,access:flags(f.accessFlags,false),storage:isStatic?"static":"instance",mutable:!isFinal,synthetic:!!(f.accessFlags&4096),hasConstantValue:Object.prototype.hasOwnProperty.call(f,"constantValue"),constantValue:Object.prototype.hasOwnProperty.call(f,"constantValue")?f.constantValue:null,constantValueTag:f.constantValueTag||null,attributes:(f.attributes||[]).slice()};
    model.fields.push(item);report.totals.fields++;if(item.hasConstantValue)report.totals.constantFields++;if(isStatic)report.totals.staticFields++;else report.totals.instanceFields++;if(item.synthetic)report.totals.syntheticMembers++;
   }
   for(const m of classMethods){
    const d=methodDescriptor(m.descriptor),isStatic=!!(m.accessFlags&8),isAbstract=!!(m.accessFlags&1024),isNative=!!(m.accessFlags&256),isCtor=m.name==="<init>",isClinit=m.name==="<clinit>";
    const item={name:m.name,descriptor:m.descriptor,validDescriptor:!!d,signature:d,accessFlags:m.accessFlags,access:flags(m.accessFlags,true),static:isStatic,abstract:isAbstract,native:isNative,constructor:isCtor,classInitializer:isClinit,synthetic:!!(m.accessFlags&4096),attributes:(m.attributes||[]).slice(),codePresent:!!m.code,codeVerified:!!(m.code&&m.code.verification&&m.code.verification.valid===true),fieldAccesses:(m.code&&m.code.fieldAccesses||[]).map(x=>({pc:Number.isInteger(x.pc)?x.pc:null,owner:x.owner||null,name:x.name||null,descriptor:x.descriptor||null,kind:x.kind||null})),objectAllocations:(m.code&&m.code.objectAllocations||[]).map(x=>({pc:x.pc,className:x.className,kind:x.kind})),arrayAllocations:(m.code&&m.code.arrayAllocations||[]).map(x=>Object.assign({},x)),invocations:(m.code&&m.code.invocations||[]).map(x=>({owner:x.owner||null,name:x.name||null,descriptor:x.descriptor||null,kind:x.kind||null}))};
    if(isCtor)model.constructors.push(item);else model.methods.push(item);
    report.totals.methods++;if(isCtor)report.totals.constructors++;if(isStatic)report.totals.staticMethods++;if(isAbstract)report.totals.abstractMethods++;if(item.synthetic)report.totals.syntheticMembers++;
    for(const allocation of item.objectAllocations){report.objectAllocations.push({from:c.className+"."+m.name+m.descriptor,pc:allocation.pc,className:allocation.className,kind:allocation.kind,resolution:byName.has(allocation.className)?"internal-class":"external-class"});report.totals.objectAllocations++;}
    for(const allocation of item.arrayAllocations){report.arrayAllocations.push({from:c.className+"."+m.name+m.descriptor,...allocation});report.totals.arrayAllocations++;}
    for(const ref of item.fieldAccesses){const internal=byName.has(ref.owner);report.fieldUsage.push({from:c.className+"."+m.name+m.descriptor,pc:ref.pc,owner:ref.owner,name:ref.name,descriptor:ref.descriptor,kind:ref.kind||"unknown",resolution:internal?"internal-class":"external-class"});
     if(ref.owner===c.className&&ref.kind==="field"&&m.code&&m.code.instructions.some(i=>i.pc===ref.pc&&i.opcode===0xb5)&&isCtor)report.totals.constructorFieldWrites++;
     if(ref.owner===c.className&&ref.kind==="field"&&m.code&&m.code.instructions.some(i=>i.pc===ref.pc&&i.opcode===0xb3)&&isClinit)report.totals.staticInitializerFieldWrites++;if(internal)report.totals.internalFieldReferences++;else report.totals.externalFieldReferences++;}
    for(const call of item.invocations){const internal=byName.has(call.owner);if(call.name==="<init>"){report.totals.constructorCalls++;report.constructorCalls.push({from:c.className+"."+m.name+m.descriptor,pc:call.pc,owner:call.owner,descriptor:call.descriptor,resolution:internal?"internal-class":"external-class"});}report.callEdges.push({from:c.className+"."+m.name+m.descriptor,to:(call.owner||"<unknown>")+"."+(call.name||"")+"("+((call.descriptor)||"")+")",owner:call.owner||null,name:call.name||null,descriptor:call.descriptor||null,resolution:internal?"internal-class":"external-class"});if(internal)report.totals.internalCalls++;else report.totals.externalCalls++;}
   }
   model.lifecycleCandidates=model.methods.concat(model.constructors).filter(m=>["<clinit>","<init>","init","initialize","onInitialize","onCommonSetup","onClientSetup","register","setup","load","start"].includes(m.name)).map(m=>({name:m.name,descriptor:m.descriptor,evidence:"name heuristic only; loader registration not proven"}));
   report.classes.push(model);report.totals.classesModeled++;report.totals.interfaces+=model.kind==="interface"?1:0;
   if(c.superName)report.hierarchy.push({child:c.className,parent:c.superName,resolution:byName.has(c.superName)?"internal":"external-or-missing"});
   for(const iface of c.interfaces||[])report.hierarchy.push({child:c.className,parent:iface,relation:"implements",resolution:byName.has(iface)?"internal":"external-or-missing"});
   if(c.superName&&!byName.has(c.superName))report.totals.unresolvedSuperclasses++;
  }
  const known=new Set(report.classes.map(c=>c.name));
  report.warnings.push("ConstantValue attributes and bytecode allocation/constructor/field-write sites are indexed, but runtime heap values, aliasing, escape analysis and object identity are not reconstructed.");
  report.warnings.push("Generic signatures, annotations, parameter names, record components and nest metadata are not available in the current parser output.");
  report.warnings.push("Lifecycle candidates are name-based hints, not proof of Forge/Fabric registration or execution order.");
  report.warnings.push("Calls through reflection, invokedynamic, native code, mixins and external libraries may not be represented as direct class relationships.");
  report.warnings.push("Only classes accepted by the existing safe analyzer are modeled; excluded functionality is not analyzed or ported.");
  return report;
 }
 root.Jar2ZeusClassModel={analyze,parseMethodDescriptor:methodDescriptor,parseFieldDescriptor:fieldDescriptor};
})(typeof globalThis!=="undefined"?globalThis:this);
