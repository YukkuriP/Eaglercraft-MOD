/* Conservative block and BlockState migration inventory. Static analysis only. */
(function(root){
"use strict";
const PREFIX="net/minecraft/";
const BLOCKED=/(?:cannon|artillery|projectile|munition|firearm|weapon|rifle|pistol|musket|sword|bow|crossbow|trident)/i;
const LIMIT=5000;
const BLOCK_TYPES=new Set([
"net/minecraft/world/level/block/Block",
"net/minecraft/world/level/block/BaseEntityBlock",
"net/minecraft/world/level/block/EntityBlock",
"net/minecraft/world/level/block/HorizontalDirectionalBlock",
"net/minecraft/world/level/block/RotatedPillarBlock",
"net/minecraft/world/level/block/SlabBlock",
"net/minecraft/world/level/block/StairBlock",
"net/minecraft/world/level/block/FenceBlock",
"net/minecraft/world/level/block/WallBlock",
"net/minecraft/world/level/block/TrapDoorBlock",
"net/minecraft/world/level/block/DoorBlock",
"net/minecraft/world/level/block/PressurePlateBlock",
"net/minecraft/world/level/block/ButtonBlock",
"net/minecraft/world/level/block/FlowerBlock",
"net/minecraft/world/level/block/CropBlock",
"net/minecraft/world/level/block/FarmBlock",
"net/minecraft/world/level/block/ChestBlock",
"net/minecraft/world/level/block/FurnaceBlock",
"net/minecraft/world/level/block/BarrelBlock",
"net/minecraft/world/level/block/LeverBlock",
"net/minecraft/world/level/block/RedstoneLampBlock"
]);
const OPS={
"BlockState.getValue":"state_property_read",
"BlockState.setValue":"state_property_write",
"BlockState.hasProperty":"state_property_check",
"BlockState.getBlock":"state_block_read",
"BlockState.isAir":"state_air_check",
"BlockState.canSurvive":"state_survival_check",
"BlockState.getFluidState":"state_fluid_read",
"BlockState.getLightEmission":"state_light_read",
"BlockState.getDestroySpeed":"state_destroy_speed_read",
"BlockState.getShape":"state_shape_read",
"BlockState.getCollisionShape":"state_collision_shape_read",
"BlockState.getSoundType":"state_sound_read",
"Block.defaultBlockState":"block_default_state",
"Block.getStateDefinition":"block_state_definition",
"Block.registerDefaultState":"block_default_state_registration",
"BlockBehaviour.Properties.of":"block_properties_factory",
"BlockBehaviour.Properties.strength":"block_strength_property",
"BlockBehaviour.Properties.sound":"block_sound_property",
"BlockBehaviour.Properties.lightLevel":"block_light_property",
"BlockBehaviour.Properties.noOcclusion":"block_no_occlusion_property",
"BlockBehaviour.Properties.noCollission":"block_no_collision_property",
"BlockBehaviour.Properties.requiresCorrectToolForDrops":"block_tool_requirement",
"BlockBehaviour.Properties.randomTicks":"block_random_tick_property",
"BlockBehaviour.Properties.friction":"block_friction_property",
"BlockBehaviour.Properties.speedFactor":"block_speed_property",
"BlockBehaviour.Properties.jumpFactor":"block_jump_property"
};
function norm(v){return typeof v==="string"?v.replace(/\\./g,"/").replace(/^L|;$/g,""):"";}
function isBlocked(v){return BLOCKED.test(String(v||""));}
function safeLimit(v){const n=Number(v);return Number.isInteger(n)&&n>0?Math.min(n,LIMIT):LIMIT;}
function operation(owner,name){
const short=owner.split("/").pop();
if(short==="BlockState"||short==="BlockBehaviour$BlockState"){
const map={getValue:"state_property_read",setValue:"state_property_write",hasProperty:"state_property_check",getBlock:"state_block_read",isAir:"state_air_check",canSurvive:"state_survival_check",getFluidState:"state_fluid_read",getLightEmission:"state_light_read",getDestroySpeed:"state_destroy_speed_read",getShape:"state_shape_read",getCollisionShape:"state_collision_shape_read",getSoundType:"state_sound_read"};
return map[name]||null;
}
if(short==="Block"){
const map={defaultBlockState:"block_default_state",getStateDefinition:"block_state_definition",registerDefaultState:"block_default_state_registration",getDescriptionId:"block_description_id",getDrops:"block_drops_query"};
return map[name]||null;
}
if(short==="Properties"&&owner.endsWith("/BlockBehaviour$Properties")){
const map={of:"block_properties_factory",strength:"block_strength_property",sound:"block_sound_property",lightLevel:"block_light_property",noOcclusion:"block_no_occlusion_property",noCollission:"block_no_collision_property",requiresCorrectToolForDrops:"block_tool_requirement",randomTicks:"block_random_tick_property",friction:"block_friction_property",speedFactor:"block_speed_property",jumpFactor:"block_jump_property"};
return map[name]||null;
}
if(short==="StateDefinition"){
const map={any:"state_definition_any",getProperty:"state_definition_property_lookup",getPossibleStates:"state_definition_possible_states"};
return map[name]||null;
}
return null;
}
function analyze(input,options){
input=input&&typeof input==="object"?input:{};
options=options&&typeof options==="object"?options:{};
const limit=safeLimit(options.detailLimit),classes=Array.isArray(input.classes)?input.classes:[];
const report={schema:"jar2zeus.block-state-conversion.v1",status:"no-block-api-observed",supportStatus:"analysis-and-migration-plan-only",detailLimit:limit,
totals:{classesSeen:classes.length,classesAnalyzed:0,restrictedClassesSkipped:0,blockClasses:0,blockStateClasses:0,blockTypeReferences:0,statePropertyOperations:0,blockPropertyOperations:0,placementBreakOperations:0,unmappedOperations:0,detailsObserved:0,detailsReported:0,detailsTruncated:false},
blockClasses:[],stateTypes:[],operations:[],migrationTasks:[],limitations:[
"Block and BlockState behavior is inventoried from class metadata and bytecode; Java code is not executed.",
"Exact owner/name matches are candidates only; Minecraft mappings and descriptors vary by version.",
"Property values, constructor arguments, lambda bodies, callbacks, shapes and runtime state are not reconstructed.",
"Forge/Fabric registration, block placement/break hooks, loot, redstone, fluids, ticking and BlockEntity behavior need separate adapters.",
"No generated operation is claimed to be a working Zeus block registration until target API semantics are implemented and tested."
]};
const seenBlocks=new Set(),seenStates=new Set(),operations=[];let observed=0;
function push(row){observed++;if(operations.length<limit)operations.push(row);}
for(const item of classes){
const info=item&&item.classInfo?item.classInfo:item;
if(!info||info.valid!==true||typeof info.className!=="string")continue;
const className=norm(info.className),path=item&&typeof item.path==="string"?item.path:className+".class";
if(isBlocked(path)||isBlocked(className)){report.totals.restrictedClassesSkipped++;continue;}
report.totals.classesAnalyzed++;
const refs=new Set([].concat(info.references||[],info.superName||[],info.interfaces||[]).filter(Boolean).map(norm));
for(const f of info.fields||[])for(const m of String(f&&f.descriptor||"").matchAll(/L([^;]+);/g))refs.add(norm(m[1]));
for(const m of info.methods||[])for(const x of String(m&&m.descriptor||"").matchAll(/L([^;]+);/g))refs.add(norm(x[1]));
const isBlock=Array.from(refs).some(r=>BLOCK_TYPES.has(r)||r.startsWith("net/minecraft/world/level/block/"));
const isState=Array.from(refs).some(r=>r==="net/minecraft/world/level/block/state/BlockState"||r==="net/minecraft/world/level/block/state/StateDefinition"||r.endsWith("/Property"));
if(isBlock){seenBlocks.add(className);report.totals.blockTypeReferences++;}
if(isState){seenStates.add(className);}
for(const method of info.methods||[]){
for(const inv of method&&method.code&&method.code.invocations||[]){
const owner=norm(inv.owner);if(!owner.startsWith(PREFIX)||isBlocked(owner))continue;
const op=operation(owner,inv.name||"");
const placement=/BlockPlaceContext|BlockItem|useOn|setPlacedBy|onPlace|onRemove|playerWillDestroy|playerDestroy|updateShape|neighborChanged/.test(owner+" "+(inv.name||""));
const isBlockOwner=owner.includes("/world/level/block/")||owner.endsWith("/Block")||owner.includes("BlockBehaviour");
const isStateOwner=owner.endsWith("/BlockState")||owner.endsWith("/StateDefinition")||owner.endsWith("/Property");
if(!op&&!placement&&!isBlockOwner&&!isStateOwner)continue;
const family=placement?"placement-or-break":isStateOwner?"block-state": "block-properties-or-behavior";
if(op==="state_property_read"||op==="state_property_write"||op==="state_property_check"||op==="state_definition_property_lookup")report.totals.statePropertyOperations++;
if(op&&op.startsWith("block_"))report.totals.blockPropertyOperations++;
if(placement)report.totals.placementBreakOperations++;
if(!op)report.totals.unmappedOperations++;
push({sourcePath:path,sourceClass:className,sourceMethod:method.name||null,sourceDescriptor:method.descriptor||null,pc:Number.isInteger(inv.pc)?inv.pc:null,owner,name:inv.name||null,descriptor:inv.descriptor||null,family,operationCandidate:op,confidence:op?"high":"medium",evidence:op?"Exact owner and method name match in parsed bytecode":"Block-related namespace/member heuristic; semantics unresolved",portStatus:"unmapped",autoConverted:false});
}
}
if(isBlock)report.blockClasses.push({sourcePath:path,className,superName:info.superName||null,interfaces:(info.interfaces||[]).map(norm).filter(r=>r.startsWith(PREFIX)&&!isBlocked(r)),blockApiReferences:Array.from(refs).filter(r=>BLOCK_TYPES.has(r)),registrationStatus:"unresolved",defaultStateStatus:"unresolved"});
if(isState)report.stateTypes.push({sourcePath:path,className,referencedTypes:Array.from(refs).filter(r=>r.includes("/block/state/")||r.endsWith("/Property")),propertySemantics:"unresolved"});
}
report.operations=operations;
report.totals.blockClasses=report.blockClasses.length;
report.totals.blockStateClasses=report.stateTypes.length;
report.totals.detailsObserved=observed;
report.totals.detailsReported=operations.length;
report.totals.detailsTruncated=observed>operations.length;
if(report.blockClasses.length||report.stateTypes.length||operations.length)report.status="manual-block-state-port-required";
const taskCounts=new Map();
for(const op of operations){const key=op.operationCandidate||op.family;taskCounts.set(key,(taskCounts.get(key)||0)+1);}
for(const [operationCandidate,sites] of taskCounts)report.migrationTasks.push({operationCandidate,sites,status:"unimplemented",requiredWork:"Implement and verify a version-specific Zeus adapter; preserve source evidence and test in-game."});
if(!report.blockClasses.length&&!report.stateTypes.length&&!operations.length)report.migrationTasks.push({operationCandidate:"block-state-discovery",sites:0,status:"not-observed",requiredWork:"No block/state API evidence was found in the analyzed class files; inspect resources and runtime hooks before concluding blocks are absent."});
return report;
}
root.Jar2ZeusBlockStateConversion={analyze,operation};
})(typeof globalThis!=="undefined"?globalThis:this);
