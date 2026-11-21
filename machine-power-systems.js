/* Conservative machine power/energy/kinetic API inventory. Static analysis only. */
(function(root){
"use strict";
const LIMIT=5000;
const BLOCKED=/(?:cannon|artillery|projectile|munition|firearm|weapon|rifle|pistol|musket|sword|bow|crossbow|trident)/i;
const PREFIX="net/minecraft/";
const ENERGY_OWNERS=new Set([
"net/minecraftforge/energy/IEnergyStorage",
"net/minecraftforge/energy/EnergyStorage",
"net/neoforged/neoforge/energy/IEnergyStorage",
"net/neoforged/neoforge/energy/EnergyStorage"
]);
const ENERGY_METHODS={
receiveEnergy:"energy_receive",extractEnergy:"energy_extract",
getEnergyStored:"energy_read_stored",getMaxEnergyStored:"energy_read_capacity",
canReceive:"energy_check_receive",canExtract:"energy_check_extract",
getEnergy:"energy_read",setEnergy:"energy_write",getCapacity:"energy_read_capacity",
getMaxEnergy:"energy_read_capacity",getStored:"energy_read_stored",
insert:"energy_insert",extract:"energy_extract",isEmpty:"energy_empty_check",
isFull:"energy_full_check"
};
const KINETIC_METHODS={
getSpeed:"kinetic_read_speed",setSpeed:"kinetic_write_speed",
getTheoreticalSpeed:"kinetic_read_theoretical_speed",getGeneratedSpeed:"kinetic_read_generated_speed",
getStress:"kinetic_read_stress",getStressCapacity:"kinetic_read_stress_capacity",
getAddedStress:"kinetic_read_added_stress",getImpact:"kinetic_read_impact",
getTheoreticalSpeed:"kinetic_read_theoretical_speed",getNetwork:"kinetic_read_network",
getRotation:"kinetic_read_rotation",getRotationSpeed:"kinetic_read_rotation_speed",
getTorque:"kinetic_read_torque",getPower:"kinetic_read_power",
getCapacity:"kinetic_read_capacity",getNetworkCapacity:"kinetic_read_network_capacity",
updateNetwork:"kinetic_network_update",removeFromNetwork:"kinetic_network_remove",
attachKinetics:"kinetic_network_attach",propagateRotation:"kinetic_rotation_propagate"
};
const GENERIC_METHODS={
getVoltage:"power_read_voltage",setVoltage:"power_write_voltage",
getCurrent:"power_read_current",getPower:"power_read_power",
getPowerUsage:"power_read_usage",getPowerProduction:"power_read_production",
getEnergyUsage:"power_read_usage",getEnergyProduction:"power_read_production",
getBurnTime:"generator_read_burn_time",getFuel:"generator_read_fuel",
getFuelTime:"generator_read_fuel_time",getProduction:"generator_read_production",
getOutput:"power_read_output",getInput:"power_read_input"
};
const ENERGY_OWNER_RE=/(?:energy|power|electric|electricity|battery|capacitor|generator|dynamo|alternator|accumulator|storage|cell|kinetic|rotation|stress)/i;
const KINETIC_OWNER_RE=/(?:create.*kinetic|kinetic|rotation|shaft|flywheel|gearbox|speedometer|stressometer)/i;
const VALUE_FIELD_RE=/(?:energy|capacity|stored|charge|power|voltage|current|production|consumption|usage|burntime|fuel|speed|rpm|torque|stress|impact|rotation|kinetic|generation)/i;
function norm(v){return typeof v==="string"?v.replace(/\\./g,"/").replace(/^L|;$/g,""):"";}
function blocked(v){return BLOCKED.test(String(v||""));}
function ownerKind(owner){
 if(ENERGY_OWNERS.has(owner)||/energy/i.test(owner))return "energy";
 if(KINETIC_OWNER_RE.test(owner))return "kinetic";
 if(ENERGY_OWNER_RE.test(owner))return "generic-power";
 return null;
}
function operation(owner,name){
 if(ENERGY_OWNERS.has(owner)&&ENERGY_METHODS[name])return ENERGY_METHODS[name];
 const kind=ownerKind(owner);
 if(kind==="kinetic"&&KINETIC_METHODS[name])return KINETIC_METHODS[name];
 if((kind==="energy"||kind==="generic-power")&&(ENERGY_METHODS[name]||GENERIC_METHODS[name]))return ENERGY_METHODS[name]||GENERIC_METHODS[name];
 if(kind&&GENERIC_METHODS[name])return GENERIC_METHODS[name];
 return null;
}
function limitOf(v){const n=Number(v);return Number.isInteger(n)&&n>0?Math.min(n,LIMIT):LIMIT;}
function analyze(input,options){
 input=input&&typeof input==="object"?input:{};
 options=options&&typeof options==="object"?options:{};
 const limit=limitOf(options.detailLimit),classes=Array.isArray(input.classes)?input.classes:[];
 const report={schema:"jar2zeus.machine-power-systems.v1",status:"no-power-api-observed",supportStatus:"analysis-and-migration-plan-only",detailLimit:limit,
 totals:{classesSeen:classes.length,classesAnalyzed:0,restrictedClassesSkipped:0,powerRelatedClasses:0,energyClasses:0,kineticClasses:0,generatorOrStorageClasses:0,energyOperationsObserved:0,kineticOperationsObserved:0,genericPowerOperationsObserved:0,unmappedPowerOperations:0,fieldsObserved:0,fieldsReported:0,methodsObserved:0,methodsReported:0,operationsReported:0,detailsTruncated:false},
 systems:[],operations:[],fields:[],methods:[],migrationTasks:[],limitations:[
 "Power and energy APIs are identified from static class metadata and bytecode invocation evidence only.",
 "Method-name and owner matches are candidates; API versions, units, sign conventions and runtime semantics may differ.",
 "Numeric field values, network topology, transfer order, loss/efficiency, simulation timing and redstone interactions are not reconstructed.",
 "Create-style kinetic networks and Forge/NeoForge energy capabilities require separate target adapters and version-specific validation.",
 "No power system is claimed to function in Zeus until an adapter is implemented and verified in-game."
 ]};
 const classMap=new Map(),systems=[],ops=[],fields=[],methods=[];
 const classIndex=new Map(),powerClassNames=new Set();
 for(const entry of classes){
  const info=entry&&entry.classInfo?entry.classInfo:entry;
  if(!info||info.valid!==true||typeof info.className!=="string")continue;
  const name=norm(info.className),path=entry&&typeof entry.path==="string"?entry.path:name+".class";
  if(blocked(name)||blocked(path))continue;
  classIndex.set(name,info);
  const refs=[].concat(info.references||[],info.superName||[],info.interfaces||[]).filter(Boolean).map(norm);
  for(const field of info.fields||[])for(const m of String(field&&field.descriptor||"").matchAll(/L([^;]+);/g))refs.push(norm(m[1]));
  for(const method of info.methods||[])for(const m of String(method&&method.descriptor||"").matchAll(/L([^;]+);/g))refs.push(norm(m[1]));
  const named=ENERGY_OWNER_RE.test(name)||VALUE_FIELD_RE.test(name);
  const fieldsHint=(info.fields||[]).some(field=>VALUE_FIELD_RE.test(String(field&&field.name||""))||/EnergyStorage|IEnergyStorage|EnergyContainer/.test(String(field&&field.descriptor||"")));
  if(refs.some(ref=>ownerKind(ref))||named||fieldsHint)powerClassNames.add(name);
 }
 // Follow mod-local superclass and interface chains, not just direct API descriptors.
 let changed=true;
 while(changed){
  changed=false;
  for(const [name,info] of classIndex){
   if(powerClassNames.has(name))continue;
   const parents=[info.superName].concat(info.interfaces||[]).filter(Boolean).map(norm);
   if(parents.some(parent=>powerClassNames.has(parent)||ownerKind(parent))){
    powerClassNames.add(name);changed=true;
   }
  }
 }
 function powerInheritanceChain(info){
  const chain=[],seen=new Set();
  const queue=[norm(info&&info.superName||""),...(info&&info.interfaces||[]).map(norm)].filter(Boolean);
  while(queue.length){
   const parent=queue.shift();if(seen.has(parent))continue;seen.add(parent);chain.push(parent);
   const parentInfo=classIndex.get(parent);
   if(parentInfo)queue.push(norm(parentInfo.superName||""),...(parentInfo.interfaces||[]).map(norm));
  }
  return chain;
 }
 let opsSeen=0,fieldsSeen=0,methodsSeen=0;
 function push(arr,row,kind){if(arr.length<limit)arr.push(row);if(kind==="op")opsSeen++;else if(kind==="field")fieldsSeen++;else methodsSeen++;}
 for(const entry of classes){
  const info=entry&&entry.classInfo?entry.classInfo:entry;
  if(!info||info.valid!==true||typeof info.className!=="string")continue;
  const name=norm(info.className),path=entry&&typeof entry.path==="string"?entry.path:name+".class";
  if(blocked(name)||blocked(path)){report.totals.restrictedClassesSkipped++;continue;}
  report.totals.classesAnalyzed++;
  const refs=new Set([].concat(info.references||[],info.superName||[],info.interfaces||[]).filter(Boolean).map(norm));
  for(const f of info.fields||[])for(const m of String(f&&f.descriptor||"").matchAll(/L([^;]+);/g))refs.add(norm(m[1]));
  for(const m of info.methods||[])for(const x of String(m&&m.descriptor||"").matchAll(/L([^;]+);/g))refs.add(norm(x[1]));
  const powerRefs=Array.from(refs).filter(r=>!blocked(r)&&ownerKind(r));
  const namedPower=ENERGY_OWNER_RE.test(name)||VALUE_FIELD_RE.test(name);
  const fieldEvidence=(info.fields||[]).filter(f=>VALUE_FIELD_RE.test(String(f&&f.name||""))||String(f&&f.descriptor||"").includes("Energy"));
  const inheritance=powerInheritanceChain(info),inheritedPowerRefs=inheritance.filter(ref=>ownerKind(ref)),hasPower=powerRefs.length>0||namedPower||fieldEvidence.length>0||powerClassNames.has(name);
  if(!hasPower)continue;
  const kinetic=powerRefs.concat(inheritedPowerRefs).some(r=>ownerKind(r)==="kinetic")||KINETIC_OWNER_RE.test(name)||fieldEvidence.some(f=>/(?:speed|rpm|torque|stress|rotation|kinetic)/i.test(f.name||""));
  const generator=/(?:generator|dynamo|alternator|battery|capacitor|accumulator|cell|flywheel)/i.test(name);
  const kind=kinetic?"kinetic":generator?"generator-or-storage":"energy-or-power";
  const record={sourcePath:path,className:name,superName:info.superName||null,powerApiReferences:powerRefs,inheritedPowerReferences:inheritedPowerRefs,powerInheritanceChain:inheritance,kind,adapterStatus:"unmapped",runtimeValuesRecovered:false};
  classMap.set(name,record);systems.push(record);
  report.totals.powerRelatedClasses++;
  if(kinetic)report.totals.kineticClasses++;else report.totals.energyClasses++;
  if(generator)report.totals.generatorOrStorageClasses++;
  for(const f of info.fields||[]){
   if(!VALUE_FIELD_RE.test(String(f&&f.name||""))&&!String(f&&f.descriptor||"").match(/(?:EnergyStorage|IEnergyStorage)/))continue;
   push(fields,{sourcePath:path,sourceClass:name,name:f.name||null,descriptor:f.descriptor||null,accessFlags:f.accessFlags==null?null:f.accessFlags,semanticStatus:"name-or-type-candidate-unresolved"},"field");
  }
  for(const method of info.methods||[]){
   const mn=method&&method.name||"",desc=method&&method.descriptor||"";
   const hints=/(?:energy|power|voltage|current|speed|rotation|stress|torque|kinetic|generation|production|consumption|fuel|burn)/i.test(mn);
   if(hints)push(methods,{sourcePath:path,sourceClass:name,name:mn,descriptor:desc,invocationCount:Array.isArray(method.code&&method.code.invocations)?method.code.invocations.length:null,portStatus:"unmapped"},"method");
   for(const inv of method&&method.code&&method.code.invocations||[]){
    const owner=norm(inv.owner),im=inv.name||"";
    if(blocked(owner)||!owner.startsWith(PREFIX)&&!ownerKind(owner))continue;
    const candidate=operation(owner,im);
    if(!candidate)continue;
    const k=ownerKind(owner)||"generic-power";
    push(ops,{sourcePath:path,sourceClass:name,sourceMethod:mn||null,sourceDescriptor:desc||null,pc:Number.isInteger(inv.pc)?inv.pc:null,owner,name:im,descriptor:inv.descriptor||null,system:k,operationCandidate:candidate,evidence:"Exact owner/member or power API naming candidate from parsed bytecode",confidence:ENERGY_OWNERS.has(owner)?"high":"medium",portStatus:"unmapped",autoConverted:false},"op");
    if(k==="kinetic")report.totals.kineticOperationsObserved++;
    else if(k==="energy")report.totals.energyOperationsObserved++;
    else report.totals.genericPowerOperationsObserved++;
    report.totals.unmappedPowerOperations++;
   }
  }
 }
 report.operations=ops;report.fields=fields;report.methods=methods;report.systems=systems;
 report.totals.operationsReported=ops.length;report.totals.fieldsObserved=fieldsSeen;report.totals.fieldsReported=fields.length;
 report.totals.methodsObserved=methodsSeen;report.totals.methodsReported=methods.length;
 report.totals.detailsTruncated=opsSeen>ops.length||fieldsSeen>fields.length||methodsSeen>methods.length;
 if(systems.length||opsSeen||fieldsSeen||methodsSeen)report.status="manual-power-system-port-required";
 const counts=new Map();for(const op of ops)counts.set(op.operationCandidate,(counts.get(op.operationCandidate)||0)+1);
 for(const [operationCandidate,sites] of counts)report.migrationTasks.push({operationCandidate,sites,status:"unimplemented",requiredWork:"Implement a version-specific Zeus power/energy adapter and verify units, transfer direction, network behavior, persistence and tick timing."});
 if(!systems.length)report.migrationTasks.push({operationCandidate:"power-system-discovery",sites:0,status:"not-observed",requiredWork:"No power API evidence found in analyzed classes; inspect metadata, mixins and runtime registrations before concluding the MOD has no power system."});
 return report;
}
root.Jar2ZeusMachinePowerSystems={analyze,operation,ownerKind};
})(typeof globalThis!=="undefined"?globalThis:this);
