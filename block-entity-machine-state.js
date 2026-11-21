/* Conservative BlockEntity and machine-state inventory. Static analysis only; no Java execution. */
(function(root){
"use strict";
const PREFIX="net/minecraft/";
const BLOCKED=/(?:cannon|artillery|projectile|munition|firearm|weapon|rifle|pistol|musket|sword|bow|crossbow|trident)/i;
const LIMIT=5000;
const BE_PREFIX="net/minecraft/world/level/block/entity/";
const BE_BASES=new Set([
"net/minecraft/world/level/block/entity/BlockEntity",
"net/minecraft/world/level/block/entity/BlockEntityType",
"net/minecraft/world/level/block/entity/BlockEntityTicker",
"net/minecraft/world/level/block/entity/RandomizableContainerBlockEntity",
"net/minecraft/world/level/block/entity/AbstractFurnaceBlockEntity",
"net/minecraft/world/level/block/entity/ChestBlockEntity",
"net/minecraft/world/level/block/entity/BarrelBlockEntity",
"net/minecraft/world/level/block/entity/HopperBlockEntity",
"net/minecraft/world/level/block/entity/BrewingStandBlockEntity",
"net/minecraft/world/level/block/entity/DispenserBlockEntity",
"net/minecraft/world/level/block/entity/DropperBlockEntity",
"net/minecraft/world/level/block/entity/BeaconBlockEntity",
"net/minecraft/world/level/block/entity/CampfireBlockEntity",
"net/minecraft/world/level/block/entity/SmokerBlockEntity",
"net/minecraft/world/level/block/entity/BlastFurnaceBlockEntity"
]);
const NBT_TYPES=new Set([
"net/minecraft/nbt/CompoundTag","net/minecraft/nbt/Tag","net/minecraft/nbt/ListTag",
"net/minecraft/nbt/ByteTag","net/minecraft/nbt/IntTag","net/minecraft/nbt/LongTag",
"net/minecraft/nbt/StringTag","net/minecraft/nbt/DoubleTag","net/minecraft/nbt/FloatTag"
]);
const BE_OPS={
getBlockPos:"block_entity_position_read",getBlockState:"block_entity_block_state_read",
getLevel:"block_entity_level_read",setChanged:"block_entity_mark_dirty",
isRemoved:"block_entity_removed_check",setRemoved:"block_entity_mark_removed",
clearRemoved:"block_entity_clear_removed",hasLevel:"block_entity_level_check",
getType:"block_entity_type_read",onlyOpCanSetNbt:"block_entity_nbt_permission_check",
getUpdateTag:"block_entity_update_tag_write",handleUpdateTag:"block_entity_update_tag_read",
getUpdatePacket:"block_entity_update_packet_write",onDataPacket:"block_entity_update_packet_read",
saveAdditional:"block_entity_save_additional",loadAdditional:"block_entity_load_additional",
saveWithoutMetadata:"block_entity_save",loadStatic:"block_entity_load"
};
const NBT_OPS={
getByte:"nbt_read_byte",putByte:"nbt_write_byte",getShort:"nbt_read_short",putShort:"nbt_write_short",
getInt:"nbt_read_int",putInt:"nbt_write_int",getLong:"nbt_read_long",putLong:"nbt_write_long",
getFloat:"nbt_read_float",putFloat:"nbt_write_float",getDouble:"nbt_read_double",putDouble:"nbt_write_double",
getBoolean:"nbt_read_boolean",putBoolean:"nbt_write_boolean",getString:"nbt_read_string",putString:"nbt_write_string",
getByteArray:"nbt_read_byte_array",putByteArray:"nbt_write_byte_array",getIntArray:"nbt_read_int_array",putIntArray:"nbt_write_int_array",
getLongArray:"nbt_read_long_array",putLongArray:"nbt_write_long_array",getCompound:"nbt_read_compound",getList:"nbt_read_list",
put:"nbt_write_tag",remove:"nbt_remove_tag",contains:"nbt_contains_key",getAllKeys:"nbt_list_keys",
copy:"nbt_copy",size:"nbt_size",isEmpty:"nbt_empty_check"
};
const BLOCK_ENTITY_TICK_NAMES=new Set(["tick","serverTick","clientTick","lazyTick","ticker"]);
const PERSISTENCE_NAMES=new Set(["load","loadAdditional","save","saveAdditional","saveWithoutMetadata","getUpdateTag","handleUpdateTag","getUpdatePacket","onDataPacket"]);
function norm(v){return typeof v==="string"?v.replace(/\\./g,"/").replace(/^L|;$/g,""):"";}
function isBlocked(v){return BLOCKED.test(String(v||""));}
function isBERef(v){return typeof v==="string"&&(v.startsWith(BE_PREFIX)||BE_BASES.has(v));}
function machineHint(name){return /(?:furnace|smoker|blastfurnace|chest|barrel|hopper|brewing|dispenser|dropper|beacon|campfire|lectern|spawner|machine|generator|processor|assembler|storage)/i.test(name);}
function operation(owner,name){
const short=owner.split("/").pop();
if(isBERef(owner)){
 if(BE_OPS[name])return BE_OPS[name];
 if(name==="tick"||name==="serverTick"||name==="clientTick"||name==="lazyTick")return "block_entity_tick";
}
if(owner.startsWith("net/minecraft/nbt/")&&NBT_OPS[name])return NBT_OPS[name];
if(owner==="net/minecraft/world/level/Level"&&["setBlock","getBlockState","getBlockEntity"].includes(name))return ({setBlock:"block_entity_world_write",getBlockState:"block_entity_world_state_read",getBlockEntity:"block_entity_lookup"}[name]);
return null;
}
function safeLimit(v){const n=Number(v);return Number.isInteger(n)&&n>0?Math.min(n,LIMIT):LIMIT;}
function analyze(input,options){
input=input&&typeof input==="object"?input:{};
options=options&&typeof options==="object"?options:{};
const limit=safeLimit(options.detailLimit),classes=Array.isArray(input.classes)?input.classes:[];
const report={schema:"jar2zeus.block-entity-machine-state.v1",status:"no-block-entity-api-observed",supportStatus:"analysis-and-migration-plan-only",detailLimit:limit,
totals:{classesSeen:classes.length,classesAnalyzed:0,restrictedClassesSkipped:0,blockEntityClasses:0,machineLikeBlockEntities:0,nbtTypeReferences:0,blockEntityOperations:0,persistenceOperations:0,nbtOperations:0,tickMethods:0,lifecycleMethods:0,dataFieldsObserved:0,dataFieldsReported:0,operationsObserved:0,operationsReported:0,methodSitesObserved:0,methodSitesReported:0,detailsTruncated:false},
blockEntities:[],operations:[],lifecycleMethods:[],dataFields:[],migrationTasks:[],limitations:[
"BlockEntity and machine-state behavior is inventoried from class metadata and bytecode; Java code is never executed.",
"Owner/member matches and method names are static candidates only; Minecraft mappings and descriptors vary by version.",
"Field runtime values, constructor logic, NBT key/value contents, callback bodies, tick timing and scheduler behavior are not reconstructed.",
"Chunk persistence, client/server synchronization, inventory and fluid/energy transfer semantics require dedicated adapters and runtime checks.",
"No BlockEntity or machine is claimed to run in Zeus until its target API adapter is implemented and tested."
]};
const entityMap=new Map(),operations=[],lifecycle=[],dataFields=[];
let operationsObserved=0,methodSitesObserved=0,dataFieldsObserved=0;
function pushOperation(row){operationsObserved++;if(operations.length<limit)operations.push(row);}
function pushMethod(row){methodSitesObserved++;if(lifecycle.length<limit)lifecycle.push(row);}
function pushField(row){dataFieldsObserved++;if(dataFields.length<limit)dataFields.push(row);}
for(const entry of classes){
 const info=entry&&entry.classInfo?entry.classInfo:entry;
 if(!info||info.valid!==true||typeof info.className!=="string")continue;
 const className=norm(info.className),path=entry&&typeof entry.path==="string"?entry.path:className+".class";
 if(isBlocked(path)||isBlocked(className)){report.totals.restrictedClassesSkipped++;continue;}
 report.totals.classesAnalyzed++;
 const refs=new Set([].concat(info.references||[],info.superName||[],info.interfaces||[]).filter(Boolean).map(norm));
 for(const f of info.fields||[])for(const m of String(f&&f.descriptor||"").matchAll(/L([^;]+);/g))refs.add(norm(m[1]));
 for(const m of info.methods||[])for(const x of String(m&&m.descriptor||"").matchAll(/L([^;]+);/g))refs.add(norm(x[1]));
 const beRefs=Array.from(refs).filter(isBERef),nbtRefs=Array.from(refs).filter(r=>NBT_TYPES.has(r)||r.startsWith("net/minecraft/nbt/"));
 const isBlockEntity=beRefs.length>0||isBERef(norm(info.superName||""));
 if(!isBlockEntity)continue;
 const machine=machineHint(className)||machineHint(path);
 const record={sourcePath:path,className,superName:info.superName||null,blockEntityApiReferences:beRefs,nbtApiReferences:nbtRefs,machineLike:machine,kind:machine?"machine-like-block-entity":"block-entity",persistenceStatus:"unresolved",tickStatus:"unresolved",syncStatus:"unresolved"};
 entityMap.set(className,record);
 report.totals.blockEntityClasses++;
 if(machine)report.totals.machineLikeBlockEntities++;
 report.totals.nbtTypeReferences+=nbtRefs.length;
 for(const field of info.fields||[]){
  const desc=String(field&&field.descriptor||"");
  const fieldTypes=Array.from(desc.matchAll(/L([^;]+);/g)).map(m=>norm(m[1]));
  const relevant=fieldTypes.some(t=>NBT_TYPES.has(t)||t.startsWith("net/minecraft/nbt/")||isBERef(t)||t==="net/minecraft/core/BlockPos"||t==="net/minecraft/world/level/Level"||t==="net/minecraft/world/item/ItemStack");
  if(relevant)pushField({sourcePath:path,sourceClass:className,name:field.name||null,descriptor:desc,types:fieldTypes,accessFlags:field.accessFlags==null?null:field.accessFlags,semanticStatus:"type-only-unresolved"});
 }
 for(const method of info.methods||[]){
  const methodName=method&&method.name||"",descriptor=method&&method.descriptor||"";
  const isTick=BLOCK_ENTITY_TICK_NAMES.has(methodName);
  const isPersistence=PERSISTENCE_NAMES.has(methodName);
  const isLifecycle=isTick||isPersistence||methodName==="onLoad"||methodName==="setChanged";
  if(isLifecycle){
   pushMethod({sourcePath:path,sourceClass:className,name:methodName,descriptor,kind:isTick?"tick":isPersistence?"persistence-or-sync":"lifecycle",invocationCount:Array.isArray(method.code&&method.code.invocations)?method.code.invocations.length:null,portStatus:"unmapped",bodyReconstructed:false});
   if(isTick)report.totals.tickMethods++;
   if(isPersistence)report.totals.persistenceOperations++;
   if(isLifecycle)report.totals.lifecycleMethods++;
  }
  for(const inv of method&&method.code&&method.code.invocations||[]){
   const owner=norm(inv.owner);if(!owner.startsWith(PREFIX)||isBlocked(owner))continue;
   const op=operation(owner,inv.name||"");
   if(!op)continue;
   const family=op.startsWith("nbt_")?"nbt-persistence":op.includes("tick")?"tick-scheduling":op.includes("packet")||op.includes("update_tag")?"client-sync":op.includes("save")||op.includes("load")?"persistence":"block-entity-lifecycle";
   const row={sourcePath:path,sourceClass:className,sourceMethod:methodName||null,sourceDescriptor:descriptor||null,pc:Number.isInteger(inv.pc)?inv.pc:null,owner,name:inv.name||null,descriptor:inv.descriptor||null,family,operationCandidate:op,confidence:"high",evidence:"Exact owner/member match from parsed bytecode; runtime semantics not evaluated",portStatus:"unmapped",autoConverted:false};
   pushOperation(row);
   if(family==="nbt-persistence")report.totals.nbtOperations++;
   else if(family==="persistence")report.totals.persistenceOperations++;
   else if(family==="client-sync")report.totals.blockEntityOperations++;
   else if(family==="tick-scheduling")report.totals.blockEntityOperations++;
   else report.totals.blockEntityOperations++;
  }
 }
}
report.blockEntities=Array.from(entityMap.values());
report.operations=operations;
report.lifecycleMethods=lifecycle;
report.dataFields=dataFields;
report.totals.operationsObserved=operationsObserved;
report.totals.operationsReported=operations.length;
report.totals.methodSitesObserved=methodSitesObserved;
report.totals.methodSitesReported=lifecycle.length;
report.totals.dataFieldsObserved=dataFieldsObserved;
report.totals.dataFieldsReported=dataFields.length;
report.totals.detailsTruncated=operationsObserved>operations.length||methodSitesObserved>lifecycle.length||dataFieldsObserved>dataFields.length;
if(report.blockEntities.length||operations.length||lifecycle.length||dataFields.length)report.status="manual-block-entity-machine-state-port-required";
const tasks=new Map();
for(const op of operations){const key=op.operationCandidate;tasks.set(key,(tasks.get(key)||0)+1);}
for(const [operationCandidate,sites] of tasks)report.migrationTasks.push({operationCandidate,sites,status:"unimplemented",requiredWork:"Implement a version-specific persistent BlockEntity/state adapter and verify save, reload, tick and client synchronization in-game."});
if(report.blockEntities.length){
 const types=new Set();
 for(const row of lifecycle)types.add(row.kind);
 if(!tasks.has("block-entity-lifecycle"))report.migrationTasks.push({operationCandidate:"block-entity-persistence-and-tick",sites:report.blockEntities.length,status:"unimplemented",requiredWork:"Recover field semantics, persistent NBT schema, lifecycle order and tick logic before porting."});
}
if(!report.blockEntities.length&&!operations.length&&!lifecycle.length)report.migrationTasks.push({operationCandidate:"block-entity-discovery",sites:0,status:"not-observed",requiredWork:"No BlockEntity evidence was found in analyzed classes; inspect resources and generated registrations before concluding such features are absent."});
return report;
}
root.Jar2ZeusBlockEntityMachineState={analyze,operation,isBlockEntityRef:isBERef};
})(typeof globalThis!=="undefined"?globalThis:this);
