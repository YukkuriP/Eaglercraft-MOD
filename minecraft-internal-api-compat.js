/* Conservative Minecraft internal API inventory. Static analysis only; no bytecode execution. */
(function(root){
"use strict";
const PREFIX="net/minecraft/";
const LIMIT=5000;
const AREAS=[
["blockEntitiesAndMachines",/^net\/minecraft\/world\/level\/block\/entity\//],
["blocksAndStates",/^net\/minecraft\/world\/level\/block\//],
["recipesAndData",/^net\/minecraft\/(?:world\/item\/crafting|data)\//],
["itemsAndStacks",/^net\/minecraft\/world\/item\//],
["inventoryAndContainers",/^net\/minecraft\/world\/(?:Container|entity\/player\/Inventory|inventory\/)/],
["entitiesAndPlayers",/^net\/minecraft\/world\/entity\//],
["worldGeneration",/^net\/minecraft\/world\/level\/(?:levelgen|biome)\//],
["worldAndLevel",/^net\/minecraft\/world\/level\//],
["registriesAndResources",/^net\/minecraft\/(?:core\/Registry|core\/registries|resources\/)/],
["commands",/^net\/minecraft\/commands\//],
["clientUi",/^net\/minecraft\/client\/gui\//],
["clientRendering",/^net\/minecraft\/client\/renderer\//],
["audioAndEffects",/^net\/minecraft\/(?:sounds|client\/sounds|core\/particles)\//],
["networking",/^net\/minecraft\/network\//],
["mathAndGeometry",/^net\/minecraft\/(?:world\/phys|core\/(?:Vec|Direction|BlockPos|Position)|world\/level\/ChunkPos)/]
];
function normalize(v){return typeof v==="string"?v.replace(/\./g,"/").replace(/^L|;$/g,""):"";}
function categoryFor(owner){for(const [name,re] of AREAS)if(re.test(owner))return name;return "otherMinecraftApi";}
function descriptorOwners(d){const out=[];if(typeof d!=="string")return out;for(const m of d.matchAll(/L([^;]+);/g)){const n=normalize(m[1]);if(n.startsWith(PREFIX))out.push(n);}return out;}
function operationFor(owner,name,descriptor,kind){
if(kind==="field"){
 if(owner==="net/minecraft/world/item/Items"||owner==="net/minecraft/world/level/block/Blocks")return{id:"vanilla_content_registry_reference",confidence:"high",reason:"Exact vanilla content holder field reference"};
 return null;
}
if(owner==="net/minecraft/world/level/Level"&&name==="getBlockState")return{id:"read_block_state",confidence:"high",reason:"Exact Level.getBlockState reference"};
if(owner==="net/minecraft/world/level/Level"&&name==="setBlock")return{id:"write_block_state",confidence:"high",reason:"Exact Level.setBlock reference"};
if(owner==="net/minecraft/world/level/Level"&&name==="getBlockEntity")return{id:"read_block_entity",confidence:"high",reason:"Exact Level.getBlockEntity reference"};
if(owner==="net/minecraft/world/item/ItemStack"&&["getCount","setCount","shrink","grow","isEmpty"].includes(name))return{id:"item_stack_operation",confidence:"high",reason:"Exact ItemStack quantity/state reference"};
if(owner==="net/minecraft/world/Container"&&["getItem","setItem","removeItem","getContainerSize"].includes(name))return{id:"container_inventory_operation",confidence:"high",reason:"Exact Container inventory reference"};
if(owner==="net/minecraft/world/level/block/entity/BlockEntity"&&["getBlockPos","getBlockState","setChanged"].includes(name))return{id:"block_entity_state_operation",confidence:"high",reason:"Exact BlockEntity state/lifecycle reference"};
if(owner==="net/minecraft/core/Registry"&&["get","getOptional","register"].includes(name))return{id:"registry_lookup_or_registration",confidence:"high",reason:"Exact Registry API reference"};
if(owner==="net/minecraft/resources/ResourceLocation"&&["parse","tryParse","withPrefix","withSuffix"].includes(name))return{id:"resource_identifier_operation",confidence:"high",reason:"Exact ResourceLocation helper reference"};
if(owner==="net/minecraft/world/entity/Entity"&&["getX","getY","getZ","blockPosition","isAlive"].includes(name))return{id:"entity_state_query",confidence:"high",reason:"Exact Entity state query reference"};
if(owner==="net/minecraft/world/entity/player/Player"&&["getInventory","getAbilities"].includes(name))return{id:"player_state_access",confidence:"high",reason:"Exact Player state access reference"};
if(owner==="net/minecraft/world/level/Level"&&["isClientSide","getGameTime","getDayTime"].includes(name))return{id:"world_state_query",confidence:"high",reason:"Exact Level state query reference"};
if(owner==="net/minecraft/world/item/crafting/RecipeManager"&&["getRecipeFor","getAllRecipesFor"].includes(name))return{id:"recipe_lookup",confidence:"high",reason:"Exact RecipeManager lookup reference"};
return null;
}
function safeLimit(v){const n=Number(v);return Number.isInteger(n)&&n>0?Math.min(n,LIMIT):LIMIT;}
function analyze(input,options){
input=input&&typeof input==="object"?input:{};options=options&&typeof options==="object"?options:{};
const limit=safeLimit(options.detailLimit),classes=Array.isArray(input.classes)?input.classes:[];
const report={schema:"jar2zeus.minecraft-internal-api-compatibility.v1",status:"no-minecraft-api-references-observed",supportStatus:"analysis-only",detailLimit:limit,
totals:{classesSeen:classes.length,classesAnalyzed:0,restrictedClassesSkipped:0,classesWithMinecraftApi:0,classReferenceSites:0,invocationSites:0,fieldAccessSites:0,knownCategorySites:0,unknownCategorySites:0,candidateOperationSites:0,unmappedSites:0,uniqueApiClasses:0,detailsObserved:0,detailsReported:0,detailsTruncated:false},
categories:{},apiClasses:[],invocations:[],fieldAccesses:[],classReferences:[],
limitations:["Minecraft internal API references are inventoried, not translated into Zeus API calls.","Minecraft names and descriptors vary by version, mappings and obfuscation; exact owner/name matches remain candidates.","Mixin/access transformer/reflection/runtime behavior and invokedynamic targets are not reconstructed.","Descriptors do not reveal generic semantics, runtime values, side restrictions or callback behavior.","No candidate is auto-converted; explicit target API implementation and runtime validation are required."]};
const apiCounts=new Map(),classSeen=new Set(),emitted=new Set(),cats=Object.create(null),invocations=[],fields=[],refs=[];let observed=0;
function record(raw,source){const owner=normalize(raw);if(!owner.startsWith(PREFIX))return null;const category=categoryFor(owner);apiCounts.set(owner,(apiCounts.get(owner)||0)+1);if(!cats[category])cats[category]={classReferences:0,invocations:0,fieldAccesses:0};if(source)classSeen.add(source);return{owner,category};}
function push(target,row){observed++;if(target.length<limit)target.push(row);}
for(const item of classes){
const info=item&&item.classInfo?item.classInfo:item;if(!info||info.valid!==true||typeof info.className!=="string")continue;
const sourceClass=normalize(info.className),sourcePath=item&&typeof item.path==="string"?item.path:sourceClass+".class";

report.totals.classesAnalyzed++;
const local=new Set([].concat(info.references||[],info.superName||[],info.interfaces||[]).filter(Boolean));
for(const f of info.fields||[])for(const o of descriptorOwners(f&&f.descriptor))local.add(o);
for(const m of info.methods||[])for(const o of descriptorOwners(m&&m.descriptor))local.add(o);
for(const method of info.methods||[]){
for(const inv of method&&method.code&&method.code.invocations||[]){
const hit=record(inv.owner,sourceClass);if(!hit)continue;cats[hit.category].invocations++;report.totals.invocationSites++;report.totals.unmappedSites++;
const op=operationFor(hit.owner,inv.name,inv.descriptor,"method");if(hit.category==="otherMinecraftApi")report.totals.unknownCategorySites++;else report.totals.knownCategorySites++;if(op)report.totals.candidateOperationSites++;
push(invocations,{sourcePath,sourceClass,sourceMethod:method.name||null,sourceDescriptor:method.descriptor||null,pc:Number.isInteger(inv.pc)?inv.pc:null,owner:hit.owner,name:inv.name||null,descriptor:inv.descriptor||null,memberKind:inv.kind||"method",category:hit.category,operationCandidate:op?op.id:null,confidence:op?op.confidence:"high",evidence:op?op.reason:"Exact net.minecraft namespace method reference in parsed bytecode",portStatus:"unmapped",autoConverted:false});local.add(hit.owner);
}
for(const f of method&&method.code&&method.code.fieldAccesses||[]){
const hit=record(f.owner,sourceClass);if(!hit)continue;cats[hit.category].fieldAccesses++;report.totals.fieldAccessSites++;report.totals.unmappedSites++;
const op=operationFor(hit.owner,f.name,f.descriptor,"field");if(hit.category==="otherMinecraftApi")report.totals.unknownCategorySites++;else report.totals.knownCategorySites++;if(op)report.totals.candidateOperationSites++;
push(fields,{sourcePath,sourceClass,sourceMethod:method.name||null,sourceDescriptor:method.descriptor||null,pc:Number.isInteger(f.pc)?f.pc:null,owner:hit.owner,name:f.name||null,descriptor:f.descriptor||null,category:hit.category,operationCandidate:op?op.id:null,confidence:op?op.confidence:"high",evidence:op?op.reason:"Exact net.minecraft namespace field reference in parsed bytecode",portStatus:"unmapped",autoConverted:false});local.add(hit.owner);
}}
for(const raw of local){const owner=normalize(raw);if(!owner.startsWith(PREFIX))continue;const key=sourceClass+"|"+owner;if(emitted.has(key))continue;emitted.add(key);const category=categoryFor(owner);classSeen.add(sourceClass);if(!apiCounts.has(owner))apiCounts.set(owner,1);if(!cats[category])cats[category]={classReferences:0,invocations:0,fieldAccesses:0};cats[category].classReferences++;report.totals.classReferenceSites++;
push(refs,{sourcePath,sourceClass,apiClass:owner,category,confidence:"medium",evidence:"Minecraft class appears in parsed class references, descriptors or bytecode member owners",usageResolved:false,portStatus:"unverified",autoConverted:false});
}}
report.invocations=invocations;report.fieldAccesses=fields;report.classReferences=refs;report.categories=cats;
report.totals.classesWithMinecraftApi=classSeen.size;report.totals.uniqueApiClasses=apiCounts.size;report.totals.detailsObserved=observed;report.totals.detailsReported=invocations.length+fields.length+refs.length;report.totals.detailsTruncated=observed>report.totals.detailsReported;
report.apiClasses=Array.from(apiCounts.entries()).map(([name,count])=>({name,references:count,category:categoryFor(name)})).sort((a,b)=>a.name.localeCompare(b.name)).slice(0,1000);
if(report.totals.unmappedSites||report.totals.classReferenceSites)report.status="manual-port-required";return report;
}
root.Jar2ZeusMinecraftInternalApiCompatibility={analyze,categoryFor,operationFor,descriptorOwners};
})(typeof globalThis!=="undefined"?globalThis:this);
