/* Conservative item and inventory migration inventory. Static analysis only; no bytecode execution. */
(function(root){
"use strict";
const PREFIX="net/minecraft/";
const BLOCKED=/(?:cannon|artillery|projectile|munition|firearm|weapon|rifle|pistol|musket|sword|bow|crossbow|trident)/i;
const LIMIT=5000;
const ITEM_TYPES=new Set([
"net/minecraft/world/item/Item","net/minecraft/world/item/BlockItem",
"net/minecraft/world/item/Items","net/minecraft/world/item/ItemStack",
"net/minecraft/world/item/ArmorItem","net/minecraft/world/item/SpawnEggItem",
"net/minecraft/world/item/BucketItem"
]);
const STACK_OPS={
getCount:"stack_count_read",setCount:"stack_count_write",shrink:"stack_shrink",grow:"stack_grow",
isEmpty:"stack_empty_check",copy:"stack_copy",split:"stack_split",getItem:"stack_item_read",
isDamageableItem:"stack_damageable_check",isDamaged:"stack_damaged_check",getDamageValue:"stack_damage_read",
setDamageValue:"stack_damage_write",getMaxDamage:"stack_max_damage_read",hurt:"stack_hurt",
hurtAndBreak:"stack_hurt_and_break",getTag:"stack_tag_read",getOrCreateTag:"stack_tag_create",
hasTag:"stack_tag_check",is:"stack_item_compare",sameItem:"stack_same_item",sameItemSameTags:"stack_same_item_tags"
};
const INVENTORY_OPS={
getItem:"inventory_slot_read",setItem:"inventory_slot_write",removeItem:"inventory_remove_item",
removeItemNoUpdate:"inventory_remove_item_no_update",getContainerSize:"inventory_size_read",
isEmpty:"inventory_empty_check",clearContent:"inventory_clear",setChanged:"inventory_changed",
getMaxStackSize:"inventory_max_stack_read",canPlaceItem:"inventory_can_place_check",
getSlot:"inventory_slot_read",set:"inventory_slot_write",hasItem:"inventory_has_item",
add:"inventory_add_item",addItem:"inventory_add_item",remove:"inventory_remove_item",
getFreeSlot:"inventory_free_slot_read",getSelected:"inventory_selected_read",
setSelected:"inventory_selected_write",getArmor:"inventory_armor_read",setItemSlot:"inventory_equipment_write"
};
const ITEM_OPS={
use:"item_use",useOn:"item_use_on",finishUsingItem:"item_finish_using",useTick:"item_use_tick",
releaseUsing:"item_release_using",inventoryTick:"item_inventory_tick",onCraftedBy:"item_crafted",
getUseDuration:"item_use_duration_read",getUseAnimation:"item_use_animation_read",
getEnchantmentValue:"item_enchantment_value_read",isFoil:"item_foil_check",
getDefaultInstance:"item_default_stack_create",getDescriptionId:"item_description_read"
};
const PROPERTY_OPS={
stacksTo:"item_stack_limit_property",durability:"item_durability_property",defaultDurability:"item_default_durability_property",
fireResistant:"item_fire_resistant_property",rarity:"item_rarity_property",food:"item_food_property",
craftRemainder:"item_craft_remainder_property",setNoRepair:"item_no_repair_property"
};
function norm(v){return typeof v==="string"?v.replace(/\\./g,"/").replace(/^L|;$/g,""):"";}
function blocked(v){return BLOCKED.test(String(v||""));}
function operation(owner,name){
const short=owner.split("/").pop();
if(short==="ItemStack")return STACK_OPS[name]||null;
if(["Container","AbstractContainerMenu","Inventory","PlayerInventory","SimpleContainer"].includes(short))return INVENTORY_OPS[name]||null;
if(short==="Item"||short.endsWith("Item"))return ITEM_OPS[name]||null;
if(short==="Item$Properties"||short==="Properties"&&owner.includes("/world/item/"))return PROPERTY_OPS[name]||null;
return null;
}
function analyze(input,options){
input=input&&typeof input==="object"?input:{};
options=options&&typeof options==="object"?options:{};
const n=Number(options.detailLimit),limit=Number.isInteger(n)&&n>0?Math.min(n,LIMIT):LIMIT;
const classes=Array.isArray(input.classes)?input.classes:[];
const report={schema:"jar2zeus.item-inventory-conversion.v1",status:"no-item-api-observed",supportStatus:"analysis-and-migration-plan-only",detailLimit:limit,
totals:{classesSeen:classes.length,classesAnalyzed:0,restrictedClassesSkipped:0,itemClasses:0,itemStackClasses:0,inventoryClasses:0,itemTypeReferences:0,stackOperations:0,inventoryOperations:0,itemBehaviorOperations:0,registrationOperations:0,unmappedOperations:0,detailsObserved:0,detailsReported:0,detailsTruncated:false},
itemClasses:[],stackTypes:[],inventoryTypes:[],operations:[],migrationTasks:[],limitations:[
"Item and inventory behavior is inventoried from class metadata and bytecode; Java code is never executed.",
"Exact owner/name matches are candidates only; mappings, descriptors and overload semantics vary by Minecraft version.",
"Constructor arguments, item properties, callbacks, runtime ItemStack values, NBT contents and slot contents are not reconstructed.",
"Forge/Fabric registration, creative tabs, item use context, cooldowns, equipment, attributes, loot and container synchronization need separate adapters.",
"No generated operation is claimed to be a working Zeus item registration until target API semantics are implemented and tested."
]};
const itemClasses=new Map(),stackClasses=new Map(),inventoryClasses=new Map(),ops=[];
let observed=0;
function push(row){observed++;if(ops.length<limit)ops.push(row);}
for(const entry of classes){
const info=entry&&entry.classInfo?entry.classInfo:entry;
if(!info||info.valid!==true||typeof info.className!=="string")continue;
const className=norm(info.className),path=entry&&typeof entry.path==="string"?entry.path:className+".class";
if(blocked(path)||blocked(className)){report.totals.restrictedClassesSkipped++;continue;}
report.totals.classesAnalyzed++;
const refs=new Set([].concat(info.references||[],info.superName||[],info.interfaces||[]).filter(Boolean).map(norm));
for(const f of info.fields||[])for(const m of String(f&&f.descriptor||"").matchAll(/L([^;]+);/g))refs.add(norm(m[1]));
for(const m of info.methods||[])for(const x of String(m&&m.descriptor||"").matchAll(/L([^;]+);/g))refs.add(norm(x[1]));
const itemRef=Array.from(refs).some(r=>ITEM_TYPES.has(r)||r.startsWith("net/minecraft/world/item/")&&!r.includes("/crafting/"));
const stackRef=refs.has("net/minecraft/world/item/ItemStack");
const inventoryRef=Array.from(refs).some(r=>/net\/minecraft\/world\/(?:Container|entity\/player\/Inventory|inventory\/)/.test(r)||r.endsWith("/AbstractContainerMenu")||r.endsWith("/Slot"));
if(itemRef){itemClasses.set(className,{sourcePath:path,className,superName:info.superName||null,itemReferences:Array.from(refs).filter(r=>ITEM_TYPES.has(r)||r.startsWith("net/minecraft/world/item/")),registrationStatus:"unresolved",propertiesStatus:"unresolved"});report.totals.itemTypeReferences++;}
if(stackRef)stackClasses.set(className,{sourcePath:path,className,stackSemantics:"unresolved"});
if(inventoryRef)inventoryClasses.set(className,{sourcePath:path,className,inventorySemantics:"unresolved"});
for(const method of info.methods||[]){
for(const inv of method&&method.code&&method.code.invocations||[]){
const owner=norm(inv.owner);if(!owner.startsWith(PREFIX)||blocked(owner))continue;
const name=inv.name||"",op=operation(owner,name);
const short=owner.split("/").pop();
const registration=/DeferredRegister|RegistryObject|RegisterEvent|CreativeModeTab|ItemProperties|Item\.Properties/.test(owner+" "+name);
const inventory=!!INVENTORY_OPS[name]&&(/Container|Inventory|Menu|Slot/.test(short));
const stack=!!STACK_OPS[name]&&short==="ItemStack";
const item=!!ITEM_OPS[name]&&/Item/.test(short);
const property=!!PROPERTY_OPS[name];
const itemOwner=owner.startsWith("net/minecraft/world/item/");
if(!op&&!registration&&!itemOwner)continue;
const family=registration?"item-registration":inventory?"inventory":stack?"item-stack":property?"item-properties":item?"item-behavior":"item-api";
if(inventory)report.totals.inventoryOperations++;
else if(stack)report.totals.stackOperations++;
else if(registration)report.totals.registrationOperations++;
else if(item||property)report.totals.itemBehaviorOperations++;
if(!op)report.totals.unmappedOperations++;
push({sourcePath:path,sourceClass:className,sourceMethod:method.name||null,sourceDescriptor:method.descriptor||null,pc:Number.isInteger(inv.pc)?inv.pc:null,owner,name,descriptor:inv.descriptor||null,family,operationCandidate:op,confidence:op?"high":"medium",evidence:op?"Exact owner and member name match in parsed bytecode":"Item namespace or registration heuristic; semantics unresolved",portStatus:"unmapped",autoConverted:false});
}
}
}
report.itemClasses=Array.from(itemClasses.values());
report.stackTypes=Array.from(stackClasses.values());
report.inventoryTypes=Array.from(inventoryClasses.values());
report.operations=ops;
report.totals.itemClasses=report.itemClasses.length;
report.totals.itemStackClasses=report.stackTypes.length;
report.totals.inventoryClasses=report.inventoryTypes.length;
report.totals.detailsObserved=observed;
report.totals.detailsReported=ops.length;
report.totals.detailsTruncated=observed>ops.length;
if(report.itemClasses.length||report.stackTypes.length||report.inventoryTypes.length||ops.length)report.status="manual-item-inventory-port-required";
const tasks=new Map();
for(const row of ops){const key=row.operationCandidate||row.family;tasks.set(key,(tasks.get(key)||0)+1);}
for(const [operationCandidate,sites] of tasks)report.migrationTasks.push({operationCandidate,sites,status:"unimplemented",requiredWork:"Implement and verify a version-specific Zeus adapter; preserve item identity, stack limits, durability, inventory semantics and source evidence."});
if(!ops.length&&!report.itemClasses.length&&!report.stackTypes.length&&!report.inventoryTypes.length)report.migrationTasks.push({operationCandidate:"item-inventory-discovery",sites:0,status:"not-observed",requiredWork:"No item or inventory API evidence was found in analyzed class files; inspect resources and runtime hooks before concluding these features are absent."});
return report;
}
root.Jar2ZeusItemInventoryConversion={analyze,operation};
})(typeof globalThis!=="undefined"?globalThis:this);
