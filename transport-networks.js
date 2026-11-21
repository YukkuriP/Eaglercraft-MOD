/* Conservative item/fluid/energy transport and network inventory. Static analysis only. */
(function(root){
"use strict";
const LIMIT=5000;
const BLOCKED=/(?:cannon|artillery|projectile|munition|firearm|weapon|rifle|pistol|musket|sword|bow|crossbow|trident)/i;
const ITEM_OWNERS=new Set([
"net/minecraftforge/items/IItemHandler","net/minecraftforge/items/IItemHandlerModifiable",
"net/minecraftforge/items/ItemStackHandler","net/neoforged/neoforge/items/IItemHandler",
"net/neoforged/neoforge/items/IItemHandlerModifiable","net/neoforged/neoforge/items/ItemStackHandler",
"net/fabricmc/fabric/api/transfer/v1/item/ItemStorage",
"net/fabricmc/fabric/api/transfer/v1/item/InventoryStorage",
"net/fabricmc/fabric/api/transfer/v1/item/ItemVariant",
"net/neoforged/neoforge/transfer/ItemResource"
]);
const FLUID_OWNERS=new Set([
"net/minecraftforge/fluids/capability/IFluidHandler",
"net/minecraftforge/fluids/capability/IFluidHandlerItem",
"net/minecraftforge/fluids/FluidTank",
"net/neoforged/neoforge/fluids/capability/IFluidHandler",
"net/neoforged/neoforge/fluids/capability/IFluidHandlerItem",
"net/neoforged/neoforge/fluids/FluidTank",
"net/fabricmc/fabric/api/transfer/v1/fluid/FluidStorage",
"net/fabricmc/fabric/api/transfer/v1/fluid/FluidVariant",
"net/neoforged/neoforge/transfer/FluidResource"
]);
const NEO_RESOURCE_OWNERS=new Set([
"net/neoforged/neoforge/transfer/ResourceHandler",
"net/neoforged/neoforge/transfer/Resource"
]);
const FABRIC_STORAGE_OWNERS=new Set([
"net/fabricmc/fabric/api/transfer/v1/storage/Storage",
"net/fabricmc/fabric/api/transfer/v1/storage/StorageView",
"net/fabricmc/fabric/api/transfer/v1/transaction/Transaction",
"net/fabricmc/fabric/api/transfer/v1/transaction/TransactionContext"
]);
const ITEM_METHODS={
insertItem:"item_transfer_insert",extractItem:"item_transfer_extract",
getSlots:"item_handler_slot_count",getStackInSlot:"item_handler_slot_read",
setStackInSlot:"item_handler_slot_write",getSlotLimit:"item_handler_slot_capacity",
isItemValid:"item_handler_filter_check",insert:"resource_insert",extract:"resource_extract",
getSlot:"resource_slot_read",getAmount:"resource_amount_read",getResource:"resource_read",
getCapacity:"resource_capacity_read",getCapacityAsInt:"resource_capacity_read",
getCapacityAsLong:"resource_capacity_read",size:"resource_handler_size",
isValid:"resource_validity_check",supportsInsertion:"resource_insert_check",
supportsExtraction:"resource_extract_check",find:"transport_storage_lookup",
registerForBlockEntity:"transport_storage_provider_register"
};
const FLUID_METHODS={
fill:"fluid_transfer_fill",drain:"fluid_transfer_drain",
getFluidInTank:"fluid_tank_contents_read",getTankCapacity:"fluid_tank_capacity_read",
getTanks:"fluid_tank_count",isFluidValid:"fluid_filter_check",
getFluidAmount:"fluid_amount_read",getFluid:"fluid_contents_read",
getTank:"fluid_tank_read",getFluidInTank:"fluid_tank_contents_read",
insert:"resource_insert",extract:"resource_extract",getAmount:"resource_amount_read",
getResource:"resource_read",getCapacity:"resource_capacity_read",
getCapacityAsInt:"resource_capacity_read",getCapacityAsLong:"resource_capacity_read",
size:"resource_handler_size",isValid:"resource_validity_check",
supportsInsertion:"resource_insert_check",supportsExtraction:"resource_extract_check",find:"transport_storage_lookup",
registerForBlockEntity:"transport_storage_provider_register"
};
const ENERGY_METHODS={
receiveEnergy:"energy_transfer_receive",extractEnergy:"energy_transfer_extract",
insert:"resource_insert",extract:"resource_extract",getEnergyStored:"energy_storage_read",
getMaxEnergyStored:"energy_capacity_read",canReceive:"energy_receive_check",
canExtract:"energy_extract_check",getAmount:"resource_amount_read",
getCapacity:"resource_capacity_read"
};
const NETWORK_METHODS={
connect:"network_connect",disconnect:"network_disconnect",isConnected:"network_connection_check",
canConnect:"network_connection_check",getConnections:"network_connections_read",
getConnectedSides:"network_connected_sides_read",getConnection:"network_connection_read",
getNetwork:"network_reference_read",getNode:"network_node_read",addNode:"network_node_add",
removeNode:"network_node_remove",merge:"network_merge",split:"network_split",
updateNetwork:"network_rebuild_or_update",rebuildNetwork:"network_rebuild_or_update",
markNetworkDirty:"network_mark_dirty",getAdjacent:"network_adjacent_lookup",
getNeighbor:"network_neighbor_lookup",getNeighbours:"network_neighbor_lookup",
getNeighbors:"network_neighbor_lookup",getEndpoints:"network_endpoints_read",
getTransferRate:"network_transfer_rate_read",getMaxTransfer:"network_transfer_rate_read",
getMaxTransferRate:"network_transfer_rate_read",getTransferLimit:"network_transfer_rate_read",
transfer:"resource_transfer_candidate",move:"resource_move_candidate",
push:"resource_push_candidate",pull:"resource_pull_candidate",send:"resource_send_candidate",
receive:"resource_receive_candidate",insert:"resource_insert",extract:"resource_extract"
};
const TRANSPORT_CLASS_RE=/(?:pipe|piping|tube|duct|conveyor|transport|transfer|pump|tank|fluid|valve|itemhandler|itemstorage|fluidstorage|cable|wire|channel|endpoint|networknode|storagenode|resourcehandler)/i;
const CAPABILITY_METHODS={
getCapability:"transport_capability_lookup",hasCapability:"transport_capability_check",
getCapabilityProvider:"transport_capability_provider_lookup",find:"transport_storage_lookup"
};
const TRANSACTION_METHODS={
open:"resource_transaction_open",openRoot:"resource_transaction_open",
openOuter:"resource_transaction_open",openNested:"resource_transaction_nested_open",
commit:"resource_transaction_commit",abort:"resource_transaction_abort",
close:"resource_transaction_close"
};
const ITEM_CONTEXT_RE=/(?:item|inventory|slot|stack|conveyor|chute|hopper|drawer|crate|container)/i;
const FLUID_CONTEXT_RE=/(?:fluid|liquid|tank|pipe|pump|valve|reservoir|hose)/i;
const ENERGY_CONTEXT_RE=/(?:energy|power|electric|battery|capacitor|generator|cable|wire)/i;
const NETWORK_CONTEXT_RE=/(?:network|node|connection|neighbor|neighbour|adjacent|route|endpoint|pipe|tube|duct|conveyor|cable|wire|channel)/i;
const FIELD_RE=/(?:pipe|tube|duct|conveyor|transport|transfer|pump|tank|fluid|liquid|item|inventory|slot|stack|capacity|buffer|amount|rate|throughput|connection|neighbor|neighbour|adjacent|side|face|direction|input|output|filter|route|endpoint|node|network|valve|energy|power|cable|wire)/i;
const METHOD_RE=/(?:insert|extract|fill|drain|transfer|move|push|pull|send|receive|connect|disconnect|network|neighbor|neighbour|adjacent|route|endpoint|capacity|transferRate|throughput|pump|filter|pipe|tank|fluid|item|storage|resource)/i;
function norm(v){return typeof v==="string"?v.replace(/\\./g,"/").replace(/^L|;$/g,""):"";}
function blocked(v){return BLOCKED.test(String(v||""));}
function family(owner){
 if(ITEM_OWNERS.has(owner)||/(?:\/item\/(?:ItemStorage|InventoryStorage|ItemVariant)|\/items\/(?:IItemHandler|ItemStackHandler))$/.test(owner))return "item";
 if(FLUID_OWNERS.has(owner)||/(?:\/fluid\/(?:FluidStorage|FluidVariant)|\/fluids\/capability\/IFluidHandler|\/fluids\/FluidTank)$/.test(owner))return "fluid";
 if(/(?:IEnergyStorage|EnergyStorage|EnergyHandler)$/.test(owner))return "energy";
 if(NEO_RESOURCE_OWNERS.has(owner)||/\/transfer\/(?:ResourceHandler|ItemResource|FluidResource)$/.test(owner))return "resource";
 if(FABRIC_STORAGE_OWNERS.has(owner)||/\/transfer\/v1\/storage\/(?:Storage|StorageView)$/.test(owner))return "generic-storage";
 return null;
}
function kindsFor(owner){
 const f=family(owner);
 if(f==="item")return ["item"];
 if(f==="fluid")return ["fluid"];
 if(f==="energy")return ["energy"];
 if(f==="resource")return ["item","fluid","energy"];
 if(f==="generic-storage")return ["item","fluid"];
 return [];
}
function operation(owner,name,descriptor,context){
 const f=family(owner),evidence=String(owner||"")+" "+String(descriptor||"")+" "+String(context||"");
 if(owner.includes("/transaction/")&&TRANSACTION_METHODS[name])return TRANSACTION_METHODS[name];
 if(CAPABILITY_METHODS[name]&&/(?:capabilit|storage|handler|resource|direction|item|fluid|energy)/i.test(evidence))return CAPABILITY_METHODS[name];
 if(f==="item")return ITEM_METHODS[name]||null;
 if(f==="fluid")return FLUID_METHODS[name]||null;
 if(f==="energy")return ENERGY_METHODS[name]||null;
 if(f==="resource"||f==="generic-storage")return ITEM_METHODS[name]||FLUID_METHODS[name]||ENERGY_METHODS[name]||null;
 if(NETWORK_METHODS[name]&&NETWORK_CONTEXT_RE.test(owner+" "+String(context||"")))return NETWORK_METHODS[name];
 return null;
}
function limitOf(v){const n=Number(v);return Number.isInteger(n)&&n>0?Math.min(n,LIMIT):LIMIT;}
function analyze(input,options){
 input=input&&typeof input==="object"?input:{};
 options=options&&typeof options==="object"?options:{};
 const limit=limitOf(options.detailLimit),classes=Array.isArray(input.classes)?input.classes:[];
 const report={schema:"jar2zeus.transport-networks.v1",status:"no-transport-api-observed",supportStatus:"analysis-and-migration-plan-only",detailLimit:limit,
 totals:{classesSeen:classes.length,classesAnalyzed:0,restrictedClassesSkipped:0,transportClasses:0,itemTransportClasses:0,fluidTransportClasses:0,energyTransportClasses:0,multiResourceClasses:0,networkClasses:0,bufferOrTankClasses:0,apiReferences:0,itemOperationsObserved:0,fluidOperationsObserved:0,energyOperationsObserved:0,networkOperationsObserved:0,unclassifiedTransferOperations:0,fieldsObserved:0,fieldsReported:0,methodsObserved:0,methodsReported:0,operationsObserved:0,operationsReported:0,detailsTruncated:false},
 systems:[],apiReferences:[],operations:[],fields:[],methods:[],migrationTasks:[],limitations:[
 "Transport candidates are identified from parsed class metadata, descriptors, fields and bytecode invocation references only.",
 "Forge/NeoForge capability APIs, Fabric Transfer API storage abstractions and MOD-specific transport implementations have distinct contracts; names are not treated as interchangeable.",
 "A generic ResourceHandler or Storage reference does not prove whether the resource is an item, fluid or energy unless a typed resource, capability, or additional evidence is present.",
 "Actual connection geometry, neighbor topology, sided rules, filters, routing priorities, transfer rates, transaction commits, simulation flags and tick order are not reconstructed.",
 "No transport operation is automatically converted into a working Zeus pipe, pump, cable, conveyor or network.",
 "Runtime throughput, persistence, chunk-boundary behavior and server/client synchronization require separate implementation and in-game testing."
 ]};
 const classIndex=new Map(),seedKinds=new Map(),systems=[],apiRefs=[],operations=[],fields=[],methods=[];
 let opSeen=0,fieldSeen=0,methodSeen=0,apiSeen=0;
 function push(arr,row,kind){
  if(arr.length<limit)arr.push(row);
  if(kind==="op")opSeen++;else if(kind==="field")fieldSeen++;else if(kind==="method")methodSeen++;else apiSeen++;
 }
 for(const entry of classes){
  const info=entry&&entry.classInfo?entry.classInfo:entry;
  if(!info||info.valid!==true||typeof info.className!=="string")continue;
  const name=norm(info.className),path=entry&&typeof entry.path==="string"?entry.path:name+".class";
  if(blocked(name)||blocked(path)){report.totals.restrictedClassesSkipped++;continue;}
  classIndex.set(name,{info,path});
 }
 function evidenceFor(name,info,path){
  const refs=new Set([].concat(info.references||[],info.superName||[],info.interfaces||[]).filter(Boolean).map(norm));
  for(const f of info.fields||[])for(const m of String(f&&f.descriptor||"").matchAll(/L([^;]+);/g))refs.add(norm(m[1]));
  for(const m of info.methods||[])for(const x of String(m&&m.descriptor||"").matchAll(/L([^;]+);/g))refs.add(norm(x[1]));
  const fieldEvidence=(info.fields||[]).filter(f=>FIELD_RE.test(String(f&&f.name||""))||Array.from(String(f&&f.descriptor||"").matchAll(/L([^;]+);/g)).some(m=>family(norm(m[1]))));
  const methodEvidence=(info.methods||[]).filter(m=>METHOD_RE.test(String(m&&m.name||"")));
  const apiOwners=Array.from(refs).filter(r=>family(r));
  const context=[name,path,info.superName||"",...(info.interfaces||[]),...Array.from(refs)].join(" ");
  const typedApiOwners=apiOwners.filter(o=>["item","fluid","energy"].includes(family(o)));
  const genericApiOwners=apiOwners.filter(o=>["resource","generic-storage"].includes(family(o)));
  const hasTypedApi=typedApiOwners.length>0,hasGenericApi=genericApiOwners.length>0;
  const typedKinds=new Set(typedApiOwners.map(family));
  const item=typedKinds.has("item")||!hasTypedApi&&(ITEM_CONTEXT_RE.test(context)&&fieldEvidence.some(f=>/(?:item|inventory|slot|stack|conveyor|hopper)/i.test(String(f.name||""))));
  const fluid=typedKinds.has("fluid")||!hasTypedApi&&(FLUID_CONTEXT_RE.test(context)&&fieldEvidence.some(f=>/(?:fluid|liquid|tank|pump|valve)/i.test(String(f.name||""))));
  const energy=typedKinds.has("energy")||!hasTypedApi&&(ENERGY_CONTEXT_RE.test(context)&&fieldEvidence.some(f=>/(?:energy|power|capacity|buffer)/i.test(String(f.name||""))));
  const network=NETWORK_CONTEXT_RE.test(context)&&(fieldEvidence.length>0||methodEvidence.some(m=>/(?:connect|network|neighbor|neighbour|route|endpoint|adjacent)/i.test(String(m.name||""))));
  const resource=hasGenericApi;
  const kindSet=new Set();
  if(item)kindSet.add("item");if(fluid)kindSet.add("fluid");if(energy)kindSet.add("energy");
  if(resource&&kindSet.size===0){
   if(ITEM_CONTEXT_RE.test(context))kindSet.add("item");
   if(FLUID_CONTEXT_RE.test(context))kindSet.add("fluid");
   if(ENERGY_CONTEXT_RE.test(context))kindSet.add("energy");
  }
  const transportHint=TRANSPORT_CLASS_RE.test(context);
  const strongTransport=apiOwners.length>0||kindSet.size>0&&fieldEvidence.length>0||network&&methodEvidence.length>0;
  const hasTransport=strongTransport||(transportHint&&fieldEvidence.length>=2)||(transportHint&&methodEvidence.some(m=>/(?:transfer|insert|extract|fill|drain|connect|route|pump|push|pull)/i.test(String(m.name||""))));
  return {refs,fieldEvidence,methodEvidence,apiOwners,kindSet,network,hasTransport,transportHint};
 }
 for(const [name,rec] of classIndex){
  const ev=evidenceFor(name,rec.info,rec.path);
  if(ev.hasTransport)seedKinds.set(name,ev.kindSet);
 }
 // Include descendants of identified transport base classes and API interfaces.
 let changed=true;
 while(changed){
  changed=false;
  for(const [name,rec] of classIndex){
   if(seedKinds.has(name))continue;
   const parents=[rec.info.superName].concat(rec.info.interfaces||[]).filter(Boolean).map(norm);
   const matched=parents.find(p=>seedKinds.has(p)||family(p));
   if(matched){
    const baseKinds=seedKinds.get(matched)||new Set(kindsFor(matched));
    seedKinds.set(name,new Set(baseKinds));changed=true;
   }
  }
 }
 function inheritance(info){
  const chain=[],seen=new Set(),queue=[norm(info&&info.superName||""),...(info&&info.interfaces||[]).map(norm)].filter(Boolean);
  while(queue.length){
   const p=queue.shift();if(seen.has(p))continue;seen.add(p);chain.push(p);
   const r=classIndex.get(p);if(r)queue.push(norm(r.info.superName||""),...(r.info.interfaces||[]).map(norm));
  }
  return chain;
 }
 for(const [name,rec] of classIndex){
  report.totals.classesAnalyzed++;
  const {info,path}=rec,ev=evidenceFor(name,info,path);
  if(!seedKinds.has(name))continue;
  const parentChain=inheritance(info),inheritedKinds=new Set();
  for(const p of parentChain){for(const k of seedKinds.get(p)||kindsFor(p))inheritedKinds.add(k);}
  const kinds=new Set([...(seedKinds.get(name)||[]),...inheritedKinds]);
  if(kinds.size===0&&ev.network)kinds.add("network");
  const hints=[name,path,...Array.from(ev.refs)].join(" ");
  const isNetwork=ev.network||NETWORK_CONTEXT_RE.test(hints);
  const isBuffer=/(?:tank|reservoir|buffer|storage|accumulator|container)/i.test(hints)||ev.fieldEvidence.some(f=>/(?:capacity|amount|stored|buffer)/i.test(String(f.name||"")));
  const record={sourcePath:path,className:name,superName:info.superName||null,interfaces:(info.interfaces||[]).map(norm),inheritanceChain:parentChain,resourceKinds:Array.from(kinds),apiOwners:ev.apiOwners,networkNodeCandidate:isNetwork,bufferOrTankCandidate:isBuffer,adapterStatus:"unmapped",runtimeTopologyRecovered:false};
  systems.push(record);report.totals.transportClasses++;
  if(kinds.has("item"))report.totals.itemTransportClasses++;
  if(kinds.has("fluid"))report.totals.fluidTransportClasses++;
  if(kinds.has("energy"))report.totals.energyTransportClasses++;
  if(kinds.size>1)report.totals.multiResourceClasses++;
  if(isNetwork)report.totals.networkClasses++;
  if(isBuffer)report.totals.bufferOrTankClasses++;
  for(const owner of ev.apiOwners){
   const f=family(owner);
   const kindsForApi=kindsFor(owner);
   push(apiRefs,{sourcePath:path,sourceClass:name,owner,family:f,resourceKinds:kindsForApi,evidence:"Class, interface, superclass or descriptor reference",mappingStatus:"unmapped"},"api");
  }
  for(const field of info.fields||[]){
   const n=String(field&&field.name||""),desc=String(field&&field.descriptor||"");
   if(!FIELD_RE.test(n)&&!Array.from(desc.matchAll(/L([^;]+);/g)).some(m=>family(norm(m[1]))))continue;
   push(fields,{sourcePath:path,sourceClass:name,name:n||null,descriptor:desc||null,accessFlags:field.accessFlags==null?null:field.accessFlags,resourceKinds:Array.from(kinds),semanticStatus:"name-or-type-candidate-unresolved"},"field");
  }
  for(const method of info.methods||[]){
   const mn=String(method&&method.name||""),desc=String(method&&method.descriptor||"");
   const invocations=method&&method.code&&Array.isArray(method.code.invocations)?method.code.invocations:[];
   if(METHOD_RE.test(mn))push(methods,{sourcePath:path,sourceClass:name,name:mn,descriptor:desc,invocationCount:invocations.length,resourceKinds:Array.from(kinds),portStatus:"unmapped"},"method");
   for(const inv of invocations){
    const owner=norm(inv&&inv.owner),member=String(inv&&inv.name||"");
    if(!owner||blocked(owner))continue;
    const apiFamily=family(owner),candidate=operation(owner,member);
    let opKinds=apiFamily?kindsFor(owner):Array.from(kinds);
    if(apiFamily==="resource"||apiFamily==="generic-storage"){
     const descriptor=String(inv.descriptor||"");
     if(/FluidResource|FluidVariant/.test(descriptor)||/fluid/i.test(owner))opKinds=["fluid"];
     else if(/ItemResource|ItemVariant/.test(descriptor)||/item/i.test(owner))opKinds=["item"];
     else opKinds=kinds.size?Array.from(kinds):["item","fluid","energy"];
    }
    const networkOp=NETWORK_METHODS[member]&&NETWORK_CONTEXT_RE.test(owner+" "+name);
    if(!candidate&&!networkOp)continue;
    const opName=candidate||NETWORK_METHODS[member];
    const resource=opKinds.length===1?opKinds[0]:apiFamily==="resource"?"resource-api":"multi-resource";
    push(operations,{sourcePath:path,sourceClass:name,sourceMethod:mn||null,sourceDescriptor:desc||null,pc:Number.isInteger(inv.pc)?inv.pc:null,owner,name:member,descriptor:inv.descriptor||null,apiFamily:apiFamily||"mod-specific",resourceKind:resource,operationCandidate:opName,evidence:"Parsed bytecode invocation with API owner/member or transport context",confidence:apiFamily&&apiFamily!=="mod-specific"?"high":"medium",portStatus:"unmapped",autoConverted:false},"op");
    if(resource==="item")report.totals.itemOperationsObserved++;
    else if(resource==="fluid")report.totals.fluidOperationsObserved++;
    else if(resource==="energy")report.totals.energyOperationsObserved++;
    else if(opName.startsWith("network_"))report.totals.networkOperationsObserved++;
    else report.totals.unclassifiedTransferOperations++;
   }
  }
 }
 report.systems=systems;report.apiReferences=apiRefs;report.operations=operations;report.fields=fields;report.methods=methods;
 report.totals.apiReferences=apiSeen;report.totals.fieldsObserved=fieldSeen;report.totals.fieldsReported=fields.length;
 report.totals.methodsObserved=methodSeen;report.totals.methodsReported=methods.length;
 report.totals.operationsObserved=opSeen;report.totals.operationsReported=operations.length;
 report.totals.detailsTruncated=opSeen>operations.length||fieldSeen>fields.length||methodSeen>methods.length||apiSeen>apiRefs.length;
 if(systems.length||opSeen||fieldSeen||methodSeen)report.status="manual-transport-system-port-required";
 const taskMap=new Map();
 for(const op of operations){
  const key=op.resourceKind+":"+op.operationCandidate;
  const value=taskMap.get(key)||{resourceKind:op.resourceKind,operationCandidate:op.operationCandidate,sites:0,status:"unimplemented"};
  value.sites++;taskMap.set(key,value);
 }
 for(const item of taskMap.values())report.migrationTasks.push({...item,requiredWork:"Implement a version-specific Zeus adapter; reconstruct typed resource semantics, side rules, filters, topology, limits, persistence and tick timing before runtime testing."});
 if(systems.length&&!report.migrationTasks.length)report.migrationTasks.push({resourceKind:"transport-network",operationCandidate:"transport-topology-and-transfer",sites:0,status:"unimplemented",requiredWork:"Inspect class fields and methods to reconstruct connection rules, resource filters, topology and transfer scheduling."});
 if(!systems.length)report.migrationTasks.push({resourceKind:"unknown",operationCandidate:"transport-api-discovery",sites:0,status:"not-observed",requiredWork:"No transport API evidence was found in the inspected classes; inspect registrations, mixins and runtime capabilities before concluding transport is absent."});
 return report;
}
root.Jar2ZeusTransportNetworks={analyze,family,kindsFor,operation};
})(typeof globalThis!=="undefined"?globalThis:this);
