/* Conservative machine processing and production recipe analysis. Static analysis only. */
(function(root){
"use strict";
const LIMIT=5000;
const BLOCKED=/(?:cannon|artillery|projectile|munition|firearm|weapon|rifle|pistol|musket|sword|bow|crossbow|trident)/i;
const RECIPE_PATH=/^data\/([a-z0-9_.-]+)\/(?:recipe|recipes)\/(.+)\.json$/i;
const RECIPE_TYPES=new Set([
"net/minecraft/world/item/crafting/Recipe",
"net/minecraft/world/item/crafting/RecipeType",
"net/minecraft/world/item/crafting/RecipeSerializer",
"net/minecraft/world/item/crafting/RecipeManager",
"net/minecraft/world/item/crafting/Ingredient",
"net/minecraft/world/item/crafting/RecipeInput",
"net/minecraft/world/item/crafting/SingleRecipeInput",
"net/minecraft/world/item/crafting/CraftingInput",
"net/minecraft/world/item/crafting/RecipeHolder"
]);
const RECIPE_OWNER_RE=/(?:\/crafting\/(?:Recipe|RecipeType|RecipeSerializer|RecipeManager|Ingredient|RecipeInput|RecipeHolder)|RecipeManager|RecipeSerializer|RecipeType)$/;
const RECIPE_METHODS={
matches:"recipe_match_inputs",assemble:"recipe_assemble_output",
getResultItem:"recipe_result_read",getIngredients:"recipe_ingredients_read",
getType:"recipe_type_read",getSerializer:"recipe_serializer_read",
getRemainingItems:"recipe_remaining_items_read",getCookingTime:"recipe_duration_read",
getExperience:"recipe_experience_read",isIncomplete:"recipe_validation_check",
canCraftInDimensions:"recipe_dimension_check",getRecipeFor:"recipe_lookup",
getRecipe:"recipe_lookup",getRecipes:"recipe_list_read",byKey:"recipe_lookup",
getAllRecipes:"recipe_list_read",getResult:"recipe_result_read",
getInput:"recipe_input_read",getOutput:"recipe_output_read"
};
const PROCESS_METHODS={
tick:"machine_process_tick",serverTick:"machine_process_server_tick",
hasRecipe:"machine_recipe_presence_check",findRecipe:"machine_recipe_lookup",
getRecipe:"machine_recipe_lookup",getCurrentRecipe:"machine_current_recipe_read",
canProcess:"machine_process_condition_check",canWork:"machine_work_condition_check",
canCraft:"machine_craft_condition_check",isWorking:"machine_working_state_read",
isActive:"machine_active_state_read",isProcessing:"machine_processing_state_read",
getProgress:"machine_progress_read",setProgress:"machine_progress_write",
getMaxProgress:"machine_max_progress_read",getProcessTime:"machine_duration_read",
getProcessingTime:"machine_duration_read",getCookTime:"machine_duration_read",
getBurnTime:"machine_fuel_time_read",getFuelTime:"machine_fuel_time_read",
hasFuel:"machine_fuel_presence_check",consumeFuel:"machine_fuel_consume",
consumeEnergy:"machine_energy_consume",getEnergy:"machine_energy_read",
getEnergyUsage:"machine_energy_usage_read",getEnergyConsumption:"machine_energy_usage_read",
getInput:"machine_input_read",getOutput:"machine_output_read",
getByproduct:"machine_byproduct_read",getSecondaryOutput:"machine_secondary_output_read",
completeProcess:"machine_process_complete",finishProcess:"machine_process_complete",
process:"machine_process_execute",craft:"machine_craft_execute",
updateProgress:"machine_progress_update",resetProgress:"machine_progress_reset",
markDirty:"machine_state_dirty",setChanged:"machine_state_dirty",
canInsertItem:"machine_input_acceptance_check",canExtractItem:"machine_output_extraction_check",
isValidInput:"machine_input_validation",isValidFuel:"machine_fuel_validation",
getTemperature:"machine_temperature_read",getPressure:"machine_pressure_read",
getRequiredTemperature:"machine_required_temperature_read",
getRequiredPressure:"machine_required_pressure_read"
};
const MACHINE_NAME_RE=/(?:machine|processor|processing|crusher|crushing|macerat|pulveriz|grind|grinder|mill|press|mixer|mixing|washer|washing|centrifug|refin|alloy|smelt|furnace|kiln|sawmill|compress|enrich|infus|dissolv|purif|electroly|metallurg|chemical|generator|separator|extractor|assembler|fabricator|brewer)/i;
const MACHINE_METHOD_RE=/(?:process|progress|cook|fuel|energy|recipe|craft|byproduct|secondaryoutput|working|active|temperature|pressure|heat|consume|duration)/i;
const PROCESS_FIELD_RE=/(?:progress|maxprogress|processtime|processingtime|cooktime|burntime|fueltime|duration|ticktime|worktime|energy|powerusage|energyusage|consumption|fuel|byproduct|secondaryoutput|chance|temperature|pressure|heat|input|output|ingredient|fluid|chemical|gas|catalyst|residue|experience|product)/i;
const INPUT_KEY_RE=/(?:^|_)(?:input|inputs|ingredient|ingredients|iteminput|fluidinput|chemicalinput|gasinput|catalyst|reagent|feedstock)(?:$|_)/i;
const FLUID_KEY_RE=/(?:fluid|liquid)/i;
const GAS_KEY_RE=/(?:gas|chemical|slurry|infuse|pigment)/i;
const OUTPUT_KEY_RE=/(?:^|_)(?:output|outputs|result|results|product|products|byproduct|byproducts|secondary|residue|waste)(?:$|_)/i;
const BYPRODUCT_KEY_RE=/(?:byproduct|secondary|residue|waste)/i;
const ENERGY_KEY_RE=/(?:energy|power|rf|fe|joule|consumption|usage|cost)/i;
const FUEL_KEY_RE=/(?:fuel|burn|combustion)/i;
const DURATION_KEY_RE=/(?:process|processing|cook|work|duration|time|ticks|progress)/i;
const CONDITION_KEY_RE=/(?:condition|conditions|requirement|requirements|temperature|pressure|heat|redstone|environment|biome|dimension|catalyst|fuel|minimum|maximum)/i;
const PROCESS_RECIPE_HINT_RE=/(?:processing|process|energy|power|fuel|burn|byproduct|secondary|residue|waste|fluid|chemical|gas|catalyst|temperature|pressure|heat|progress)/i;
const VANILLA_RECIPE_TYPE_RE=/^minecraft:(?:crafting_shaped|crafting_shapeless|smelting|blasting|smoking|campfire_cooking|stonecutting|smithing_transform|smithing_trim|crafting_transmute)$/;
function norm(v){return typeof v==="string"?v.replace(/\\./g,"/").replace(/^L|;$/g,""):"";}
function blocked(v){return BLOCKED.test(String(v||""));}
function limitOf(v){const n=Number(v);return Number.isInteger(n)&&n>0?Math.min(n,LIMIT):LIMIT;}
function addUnique(arr,value,cap){if(value==null||arr.length>=cap||arr.includes(value))return;arr.push(value);}
function ownerIsRecipe(owner){return RECIPE_TYPES.has(owner)||RECIPE_OWNER_RE.test(owner);}
function classRecipeEvidence(name,info){
 const refs=new Set([].concat(info.references||[],info.superName||[],info.interfaces||[]).filter(Boolean).map(norm));
 for(const f of info.fields||[])for(const m of String(f&&f.descriptor||"").matchAll(/L([^;]+);/g))refs.add(norm(m[1]));
 for(const m of info.methods||[])for(const x of String(m&&m.descriptor||"").matchAll(/L([^;]+);/g))refs.add(norm(x[1]));
 const owners=Array.from(refs).filter(ownerIsRecipe);
 const methodNames=(info.methods||[]).map(m=>String(m&&m.name||""));
 const recipeMethodCount=methodNames.filter(n=>Object.prototype.hasOwnProperty.call(RECIPE_METHODS,n)).length;
 const processMethodCount=methodNames.filter(n=>Object.prototype.hasOwnProperty.call(PROCESS_METHODS,n)||MACHINE_METHOD_RE.test(n)).length;
 const processFields=(info.fields||[]).filter(f=>PROCESS_FIELD_RE.test(String(f&&f.name||"")));
 const nameHint=MACHINE_NAME_RE.test(name);
 const recipeName=/(?:recipe|serializer|recipetype|ingredient)/i.test(name);
 const parents=[norm(info.superName||""),...(info.interfaces||[]).map(norm)];
 const serializerClass=/(?:recipe)?serializer$/i.test(name)||/RecipeCodec$/i.test(name)||parents.some(o=>o==="net/minecraft/world/item/crafting/RecipeSerializer");
 const recipeTypeClass=/(?:RecipeTypes?|recipe_type)$/i.test(name)||parents.some(o=>o==="net/minecraft/world/item/crafting/RecipeType");
 const recipeImplementationOwner=parents.some(o=>o==="net/minecraft/world/item/crafting/Recipe"||o==="net/minecraft/world/item/crafting/RecipeInput"||o==="net/minecraft/world/item/crafting/SingleRecipeInput"||o==="net/minecraft/world/item/crafting/CraftingInput");
 const recipeClass=recipeImplementationOwner||(!serializerClass&&!recipeTypeClass&&recipeName)||recipeMethodCount>=2;
 const machineClass=!recipeClass&&!serializerClass&&!recipeTypeClass&&((nameHint&&(processMethodCount>0||processFields.length>0))||
   processFields.some(f=>/(?:progress|process|cook|burn|fuel|energyusage|byproduct)/i.test(String(f.name||"")))&&processMethodCount>0);
 const lookupClass=owners.some(o=>/RecipeManager$/.test(o))||methodNames.some(n=>["getRecipeFor","getRecipes","getAllRecipes"].includes(n));
 return {refs,owners,recipeMethodCount,processMethodCount,processFields,recipeClass,machineClass,serializerClass,recipeTypeClass,lookupClass};
}
function analyze(input,options){
 input=input&&typeof input==="object"?input:{};
 options=options&&typeof options==="object"?options:{};
 const limit=limitOf(options.detailLimit),classes=Array.isArray(input.classes)?input.classes:[],recipes=Array.isArray(input.recipes)?input.recipes:[];
 const report={schema:"jar2zeus.machine-process-analysis.v1",status:"no-machine-process-evidence",supportStatus:"static-analysis-and-migration-plan-only",detailLimit:limit,
 totals:{classesSeen:classes.length,classesAnalyzed:0,restrictedClassesSkipped:0,recipeRelatedClasses:0,machineProcessorClasses:0,recipeImplementationClasses:0,recipeSerializerClasses:0,recipeTypeClasses:0,recipeLookupClasses:0,recipeJsonFilesSeen:recipes.length,recipeJsonParsed:0,recipeJsonInvalid:0,recipeJsonReadErrors:0,recipeDefinitionsObserved:0,machineRecipeCandidates:0,vanillaRecipeDefinitions:0,customRecipeDefinitions:0,recipeInputsObserved:0,itemInputCandidates:0,fluidInputCandidates:0,chemicalOrGasInputCandidates:0,recipeOutputsObserved:0,itemOutputCandidates:0,fluidOutputCandidates:0,byproductCandidates:0,processingDurationCandidates:0,energyRequirementCandidates:0,fuelRequirementCandidates:0,conditionCandidates:0,operationsObserved:0,operationsReported:0,fieldsObserved:0,fieldsReported:0,classesReported:0,recipesReported:0,detailsTruncated:false},
 recipeClasses:[],machineClasses:[],serializerClasses:[],recipeTypes:[],recipes:[],operations:[],fields:[],migrationTasks:[],limitations:[
 "Recipe files are parsed as data, but their custom serializer schemas and code-defined matching rules are not executed.",
 "RecipeType, RecipeSerializer, RecipeInput, matches, assemble and RecipeManager calls are recorded as static candidates; names do not prove their runtime behavior.",
 "Processing duration, progress, fuel and energy requirements may be stored in JSON, code constants, configuration, or runtime state; absence from a recipe file is not proof that a machine has no requirement.",
 "Byproduct chance, random outcomes, catalysts, fluid/chemical units, temperature/pressure limits, redstone conditions and environmental requirements are not simulated.",
 "Multiple recipe schemas exist across Minecraft and loader versions; custom fields remain unresolved until the associated serializer implementation is understood.",
 "No machine is claimed to process recipes in Zeus until its inputs, state transitions, consumption, outputs, persistence and tick behavior are implemented and tested."
 ]};
 const classIndex=new Map(),evidenceMap=new Map(),recipeNames=new Set(),machineNames=new Set(),serializerNames=new Set(),typeNames=new Set();
 const recipeClasses=[],machineClasses=[],serializers=[],types=[],operations=[],fields=[];
 let operationsSeen=0,fieldsSeen=0,classesSeen=0;
 function push(arr,row,kind){if(arr.length<limit)arr.push(row);if(kind==="op")operationsSeen++;else if(kind==="field")fieldsSeen++;else classesSeen++;}
 for(const entry of classes){
  const info=entry&&entry.classInfo?entry.classInfo:entry;
  if(!info||info.valid!==true||typeof info.className!=="string")continue;
  const name=norm(info.className),path=entry&&typeof entry.path==="string"?entry.path:name+".class";
  if(blocked(name)||blocked(path)){report.totals.restrictedClassesSkipped++;continue;}
  classIndex.set(name,{info,path});
  report.totals.classesAnalyzed++;
  const ev=classRecipeEvidence(name,info);
  evidenceMap.set(name,ev);
  if(ev.recipeClass)recipeNames.add(name);
  if(ev.machineClass)machineNames.add(name);
  if(ev.serializerClass)serializerNames.add(name);
  if(ev.recipeTypeClass)typeNames.add(name);
 }
 // Trace mod-local inheritance/interface descendants for recipe and machine implementations.
 let changed=true;
 while(changed){
  changed=false;
  for(const [name,rec] of classIndex){
   const parents=[rec.info.superName].concat(rec.info.interfaces||[]).filter(Boolean).map(norm);
   const current=evidenceMap.get(name);
   if(!recipeNames.has(name)&&parents.some(p=>recipeNames.has(p)||ownerIsRecipe(p))){
    if(current.recipeMethodCount>0||current.recipeClass){recipeNames.add(name);changed=true;}
   }
   if(!machineNames.has(name)&&parents.some(p=>machineNames.has(p))){
    if(current.processMethodCount>0||current.processFields.length>0||MACHINE_NAME_RE.test(name)){machineNames.add(name);changed=true;}
   }
  }
 }
 function chainFor(info){
  const chain=[],seen=new Set(),queue=[norm(info&&info.superName||""),...(info&&info.interfaces||[]).map(norm)].filter(Boolean);
  while(queue.length){const p=queue.shift();if(seen.has(p))continue;seen.add(p);chain.push(p);const rec=classIndex.get(p);if(rec)queue.push(norm(rec.info.superName||""),...(rec.info.interfaces||[]).map(norm));}
  return chain;
 }
 for(const [name,rec] of classIndex){
  const ev=evidenceMap.get(name),chain=chainFor(rec.info);
  const isRecipe=recipeNames.has(name)||ev.recipeClass;
  const isMachine=machineNames.has(name)||ev.machineClass;
  if(isRecipe){
   const row={sourcePath:rec.path,className:name,superName:rec.info.superName||null,inheritanceChain:chain,recipeApiReferences:ev.owners,recipeMethodCandidates:ev.recipeMethodCount,adapterStatus:"unmapped"};
   push(recipeClasses,row,"class");
   report.totals.recipeRelatedClasses++;
   report.totals.recipeImplementationClasses++;
  }
  if(isMachine){
   const row={sourcePath:rec.path,className:name,superName:rec.info.superName||null,inheritanceChain:chain,recipeRelated:isRecipe,processMethodCandidates:ev.processMethodCount,processStateFields:ev.processFields.map(f=>f.name),adapterStatus:"unmapped",runtimeStateRecovered:false};
   push(machineClasses,row,"class");
   report.totals.machineProcessorClasses++;
  }
  if(ev.serializerClass){push(serializers,{sourcePath:rec.path,className:name,recipeApiReferences:ev.owners,adapterStatus:"unmapped"},"class");report.totals.recipeSerializerClasses++;}
  if(ev.recipeTypeClass){push(types,{sourcePath:rec.path,className:name,recipeApiReferences:ev.owners,adapterStatus:"unmapped"},"class");report.totals.recipeTypeClasses++;}
  if(ev.lookupClass)report.totals.recipeLookupClasses++;
  for(const f of ev.processFields){
   const key=String(f.name||"");
   push(fields,{sourcePath:rec.path,sourceClass:name,name:key,descriptor:f.descriptor||null,accessFlags:f.accessFlags==null?null:f.accessFlags,category:ENERGY_KEY_RE.test(key)?"energy":FUEL_KEY_RE.test(key)?"fuel":DURATION_KEY_RE.test(key)?"duration":BYPRODUCT_KEY_RE.test(key)?"byproduct":CONDITION_KEY_RE.test(key)?"condition":"process-state",portStatus:"unmapped"},"field");
   report.totals.fieldsObserved++;
  }
  const recipeMethods=(rec.info.methods||[]).filter(m=>Object.prototype.hasOwnProperty.call(RECIPE_METHODS,String(m&&m.name||"")));
  const processMethods=(rec.info.methods||[]).filter(m=>Object.prototype.hasOwnProperty.call(PROCESS_METHODS,String(m&&m.name||""))||MACHINE_METHOD_RE.test(String(m&&m.name||"")));
  for(const method of recipeMethods.concat(processMethods)){
   const mn=String(method&&method.name||""),owner=name;
   const candidate=RECIPE_METHODS[mn]||PROCESS_METHODS[mn]||"machine_process_method_candidate";
   const invs=method&&method.code&&Array.isArray(method.code.invocations)?method.code.invocations:[];
   if(RECIPE_METHODS[mn])push(operations,{sourcePath:rec.path,sourceClass:name,sourceMethod:mn,owner,operationCandidate:RECIPE_METHODS[mn],invocationSites:invs.length,category:"recipe",portStatus:"unmapped"},"op");
   if(PROCESS_METHODS[mn]||MACHINE_METHOD_RE.test(mn))push(operations,{sourcePath:rec.path,sourceClass:name,sourceMethod:mn,owner,operationCandidate:candidate,invocationSites:invs.length,category:"machine-process",portStatus:"unmapped"},"op");
   for(const inv of invs){
    const invOwner=norm(inv&&inv.owner),invName=String(inv&&inv.name||"");
    if(blocked(invOwner))continue;
    if(RECIPE_METHODS[invName]&&ownerIsRecipe(invOwner))push(operations,{sourcePath:rec.path,sourceClass:name,sourceMethod:mn,owner:invOwner,name:invName,descriptor:inv.descriptor||null,pc:Number.isInteger(inv.pc)?inv.pc:null,operationCandidate:RECIPE_METHODS[invName],category:"recipe-api-invocation",portStatus:"unmapped"},"op");
    else if(PROCESS_METHODS[invName]||MACHINE_METHOD_RE.test(invName)){
     push(operations,{sourcePath:rec.path,sourceClass:name,sourceMethod:mn,owner:invOwner,name:invName,descriptor:inv.descriptor||null,pc:Number.isInteger(inv.pc)?inv.pc:null,operationCandidate:PROCESS_METHODS[invName]||"machine_process_method_candidate",category:"process-api-invocation",portStatus:"unmapped"},"op");
    }
   }
  }
 }
 const recipeDetails=[];
 function addCounter(key,n){report.totals[key]+=n;}
 function collectIds(value,path,out,seen,depth){
  if(depth>10||out.length>=100)return;
  if(value==null)return;
  if(typeof value==="string"){
   if(/(?:item|fluid|tag|chemical|gas|ingredient|result|output|input)/i.test(path)&&/^[a-z0-9_.-]+:[a-z0-9_./-]+$/i.test(value))addUnique(out,value,100);
   return;
  }
  if(typeof value!=="object")return;
  if(seen.has(value))return;seen.add(value);
  if(Array.isArray(value)){for(let i=0;i<value.length&&i<200;i++)collectIds(value[i],path+"["+i+"]",out,seen,depth+1);return;}
  for(const k of Object.keys(value).slice(0,200))collectIds(value[k],path+"."+k,out,seen,depth+1);
 }
 function inspectRecipe(entry){
  const path=String(entry&&entry.path||"");
  if(blocked(path))return;
  const match=path.match(RECIPE_PATH);
  if(!match)return;
  if(entry&&entry.readError){report.totals.recipeJsonReadErrors++;return;}
  const id=match[1]+":"+match[2];
  let data;
  try{data=typeof entry.content==="string"?JSON.parse(entry.content):entry.json&&typeof entry.json==="object"?entry.json:null;}
  catch(e){report.totals.recipeJsonInvalid++;return;}
  if(!data||typeof data!=="object"||Array.isArray(data)){report.totals.recipeJsonInvalid++;return;}
  report.totals.recipeJsonParsed++;
  const type=typeof data.type==="string"?data.type:null;
  const customType=!!type&&!VANILLA_RECIPE_TYPE_RE.test(type);
  const counts={inputs:0,itemInputs:0,fluidInputs:0,chemicalOrGasInputs:0,outputs:0,itemOutputs:0,fluidOutputs:0,byproducts:0,durations:0,energy:0,fuel:0,conditions:0};
  const fieldsFound=[],numericValues=[],resourceIds=[];
  let nodes=0,walkTruncated=false,fieldPathsTruncated=false;
  function walk(value,keyPath,depth){
   nodes++;if(nodes>4000||depth>12){walkTruncated=true;return;}
   if(value==null)return;
   const leafRaw=keyPath.split(".").pop();
   const leaf=leafRaw.replace(/([a-z0-9])([A-Z])/g,"$1_$2").toLowerCase();
   if(INPUT_KEY_RE.test(leaf)){
    counts.inputs++;
    if(FLUID_KEY_RE.test(keyPath))counts.fluidInputs++;
    else if(GAS_KEY_RE.test(keyPath))counts.chemicalOrGasInputs++;
    else counts.itemInputs++;
   }
   if(OUTPUT_KEY_RE.test(leaf)){
    counts.outputs++;
    if(BYPRODUCT_KEY_RE.test(leaf))counts.byproducts++;
    if(FLUID_KEY_RE.test(keyPath))counts.fluidOutputs++;else counts.itemOutputs++;
   }
   if(DURATION_KEY_RE.test(leaf)&&typeof value==="number"){counts.durations++;numericValues.push({path:keyPath,value,kind:"duration-candidate"});}
   if(ENERGY_KEY_RE.test(leaf)&&typeof value==="number"){counts.energy++;numericValues.push({path:keyPath,value,kind:"energy-candidate"});}
   if(FUEL_KEY_RE.test(leaf)){counts.fuel++;if(typeof value==="number")numericValues.push({path:keyPath,value,kind:"fuel-candidate"});}
   if(CONDITION_KEY_RE.test(leaf))counts.conditions++;
   if(PROCESS_FIELD_RE.test(leaf)){if(fieldsFound.length<200)addUnique(fieldsFound,keyPath,200);else fieldPathsTruncated=true;}
   if(typeof value==="string"){collectIds(value,keyPath,resourceIds,new Set(),0);return;}
   if(typeof value!=="object")return;
   if(Array.isArray(value)){if(value.length>300)walkTruncated=true;for(let j=0;j<value.length&&j<300;j++)walk(value[j],keyPath+"["+j+"]",depth+1);return;}
   const keys=Object.keys(value);if(keys.length>300)walkTruncated=true;
   for(const k of keys.slice(0,300))walk(value[k],keyPath?keyPath+"."+k:k,depth+1);
  }
  const rootKeys=Object.keys(data);if(rootKeys.length>300)walkTruncated=true;
  for(const k of rootKeys.slice(0,300))walk(data[k],k,0);
  const vanillaType=VANILLA_RECIPE_TYPE_RE.test(type||"");
  const pathHint=!vanillaType&&MACHINE_NAME_RE.test(path);
  const typeHint=!vanillaType&&!!type&&MACHINE_NAME_RE.test(type);
  const multiResource=counts.fluidInputs>0||counts.fluidOutputs>0||counts.chemicalOrGasInputs>0;
  const processFieldCandidate=fieldsFound.some(f=>PROCESS_RECIPE_HINT_RE.test(f));
  const machineSpecificEvidence=multiResource||counts.energy>0||counts.fuel>0||counts.byproducts>0||processFieldCandidate;
  const machineCandidate=vanillaType?machineSpecificEvidence:(pathHint||typeHint||machineSpecificEvidence);
  if(VANILLA_RECIPE_TYPE_RE.test(type||""))report.totals.vanillaRecipeDefinitions++;else if(customType)report.totals.customRecipeDefinitions++;
  if(machineCandidate)report.totals.machineRecipeCandidates++;
  report.totals.recipeDefinitionsObserved++;
  report.totals.recipeInputsObserved+=counts.inputs;
  report.totals.itemInputCandidates+=counts.itemInputs;
  report.totals.fluidInputCandidates+=counts.fluidInputs;
  report.totals.chemicalOrGasInputCandidates+=counts.chemicalOrGasInputs;
  report.totals.recipeOutputsObserved+=counts.outputs;
  report.totals.itemOutputCandidates+=counts.itemOutputs;
  report.totals.fluidOutputCandidates+=counts.fluidOutputs;
  report.totals.byproductCandidates+=counts.byproducts;
  report.totals.processingDurationCandidates+=counts.durations;
  report.totals.energyRequirementCandidates+=counts.energy;
  report.totals.fuelRequirementCandidates+=counts.fuel;
  report.totals.conditionCandidates+=counts.conditions;
  if(recipeDetails.length<limit)recipeDetails.push({sourcePath:path,recipeId:id,type,classification:machineCandidate?"machine-processing-candidate":customType?"custom-recipe":"general-recipe",machineCandidate,counts,fieldPaths:fieldsFound.slice(0,100),numericCandidates:numericValues.slice(0,100),resourceIdentifiers:resourceIds.slice(0,100),analysisNodes:Math.min(nodes,4000),truncated:walkTruncated||fieldPathsTruncated});
 }
 for(const recipe of recipes)inspectRecipe(recipe);
 report.recipeClasses=recipeClasses;report.machineClasses=machineClasses;report.serializerClasses=serializers;report.recipeTypes=types;report.recipes=recipeDetails;report.operations=operations;report.fields=fields;
 report.totals.classesReported=recipeClasses.length+machineClasses.length+serializers.length+types.length;
 report.totals.recipesReported=recipeDetails.length;
 report.totals.operationsObserved=operationsSeen;report.totals.operationsReported=operations.length;
 report.totals.fieldsObserved=Math.max(report.totals.fieldsObserved,fieldsSeen);report.totals.fieldsReported=fields.length;
 report.totals.detailsTruncated=operationsSeen>operations.length||fieldsSeen>fields.length||
  report.totals.recipeRelatedClasses>recipeClasses.length||report.totals.machineProcessorClasses>machineClasses.length||
  report.totals.recipeSerializerClasses>serializers.length||report.totals.recipeTypeClasses>types.length||
  report.totals.recipeDefinitionsObserved>recipeDetails.length;
 if(report.totals.recipeRelatedClasses||report.totals.machineProcessorClasses||report.totals.recipeDefinitionsObserved||report.totals.operationsObserved||report.totals.fieldsObserved)report.status="manual-machine-process-port-required";
 if(report.totals.recipeDefinitionsObserved||report.totals.recipeRelatedClasses)report.migrationTasks.push({area:"recipe-definition-and-serializer",status:"unmapped",requiredWork:"Map the exact recipe type/serializer schema, item and fluid ingredients, result templates, recipe lookup and matching rules."});
 if(report.totals.machineProcessorClasses||report.totals.machineRecipeCandidates)report.migrationTasks.push({area:"machine-processing-state",status:"unmapped",requiredWork:"Implement input validation, progress/tick updates, duration, fuel/energy use, completion and cancellation semantics."});
 if(report.totals.byproductCandidates||report.totals.fluidInputCandidates||report.totals.fluidOutputCandidates||report.totals.chemicalOrGasInputCandidates)report.migrationTasks.push({area:"secondary-and-fluid-products",status:"unmapped",requiredWork:"Implement fluid/chemical units, secondary output chance, residue and multi-output routing."});
 if(report.totals.conditionCandidates||report.totals.energyRequirementCandidates||report.totals.fuelRequirementCandidates)report.migrationTasks.push({area:"processing-requirements",status:"unmapped",requiredWork:"Implement required conditions, power/fuel accounting and environmental checks."});
 if(!report.migrationTasks.length)report.migrationTasks.push({area:"machine-process-discovery",status:"not-observed",requiredWork:"No machine processing evidence was identified; inspect data files, registrations, mixins and code-defined serializers before concluding it is absent."});
 return report;
}
root.Jar2ZeusMachineProcessAnalysis={analyze,classRecipeEvidence,ownerIsRecipe};
})(typeof globalThis!=="undefined"?globalThis:this);
