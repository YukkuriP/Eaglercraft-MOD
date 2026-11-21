/* Structural output validation. This never substitutes for running the package in the target game. */
(function(root){
 "use strict";
 function unsafePath(path){
  return typeof path!=="string" || !path || path.startsWith("/") ||
   path.includes("\\") || path.split("/").some(p=>!p||p===".."||p===".");
 }
 function validate(input){
  const errors=[],warnings=[];
  if(!input||typeof input!=="object")return {valid:false,readyToImport:false,canImportForTesting:false,runtimeTested:false,gameplayVerified:false,errors:["validation input missing"],warnings:[]};
  const metadata=input.metadata;
  if(!metadata||typeof metadata!=="object")errors.push("metadata.json missing or invalid");
  else {
   if(typeof metadata.id!=="string"||!/^(?!\.)(?!.*_$)[a-z0-9_.-]{1,64}$/.test(metadata.id))errors.push("metadata.id must be 1-64 lowercase letters, digits, dot, hyphen or underscore; it cannot start with dot or end with underscore");
   if(typeof metadata.name!=="string"||!metadata.name.trim())errors.push("metadata.name missing");
   if(typeof metadata.version!=="string"||!metadata.version.trim())errors.push("metadata.version missing");
   if(metadata.main!=="main.lua")errors.push("metadata.main must point to main.lua");
   if(metadata.api!==1)errors.push("metadata.api must be Zeus API version 1");
   if(!Array.isArray(metadata.minecraft)||!metadata.minecraft.length||metadata.minecraft.some(v=>!["26.2","26.3"].includes(v)))errors.push("metadata.minecraft must explicitly list supported Zeus target versions");
   const allowedPermissions=new Set(["network","clipboard","commands","microphone","webrtc","gl"]);
   if(metadata.permissions!=null&&(!Array.isArray(metadata.permissions)||metadata.permissions.some(p=>!allowedPermissions.has(p))))errors.push("metadata.permissions contains an unknown permission");
   if(Array.isArray(metadata.permissions)&&new Set(metadata.permissions).size!==metadata.permissions.length)errors.push("metadata.permissions contains duplicates");
  }
  if(typeof input.mainLua!=="string"||!input.mainLua.trim())errors.push("main.lua missing or empty");
  if(!input.analysis||input.analysis.schema!=="jar2zeus.generic-analysis.v1")errors.push("generic analysis report missing");
  if(!input.adapterReport||input.adapterReport.schema!=="jar2zeus.pipeline.v1")errors.push("adapter report missing");
  else for(const a of input.adapterReport.adapters||[])if(a.status==="failed")errors.push("adapter failed: "+a.id+" ("+(a.error||"unknown")+")");
  const api=input.apiValidation;
  if(!api||api.schema!=="jar2zeus.zeus-api-validation.v1")errors.push("Zeus API contract validation missing");
  else {
   if(api.valid!==true)errors.push("generated Lua contains undocumented Zeus API calls: "+(api.unsupportedApis||[]).join(", "));
   if(!Array.isArray(api.requiredApis))errors.push("Zeus API validation has no requiredApis list");
  }
  const mappings=Array.isArray(input.textureMappings)?input.textureMappings:[];
  const packageLimits=input.packageLimits||{files:0,bytes:0,maxFiles:4096,maxBytes:64*1024*1024};
  if(packageLimits.files>packageLimits.maxFiles)errors.push("Zeus package file limit exceeded");
  if(packageLimits.bytes>packageLimits.maxBytes)errors.push("Zeus package unpacked size limit exceeded");
  const packageFiles=Array.isArray(input.packageFiles)?input.packageFiles:[];
  if(input.packageSkipped&&input.packageSkipped.length)warnings.push("Some source resources were omitted because of safety or Zeus package limits");
  const packagePaths=new Set();let listedBytes=0;
  for(const file of packageFiles){
   if(!file||unsafePath(file.path))errors.push("unsafe package file path");
   else if(packagePaths.has(file.path))errors.push("duplicate package file: "+file.path);
   else packagePaths.add(file.path);
   const size=Number(file&&file.size);
   if(!Number.isFinite(size)||size<0)errors.push("invalid package file size: "+(file&&file.path||"unknown"));
   else listedBytes+=size;
  }
  if(packageLimits.files!==packageFiles.length)errors.push("package file count does not match the output file list");
  if(packageLimits.bytes!==listedBytes)errors.push("package byte count does not match the output file list");
  if(!packagePaths.has("metadata.json"))errors.push("metadata.json missing from package root");
  if(!packagePaths.has("main.lua"))errors.push("main.lua missing from package root");
  if(metadata&&typeof metadata.main==="string"&&!packagePaths.has(metadata.main))errors.push("metadata.main points to a file missing from the package");
  const available=new Set(input.availableTextures||[]);
  for(const m of mappings){
   if(!m||typeof m.source!=="string"||unsafePath(m.target))errors.push("invalid or unsafe texture mapping");
   else if(!available.has(m.source))errors.push("missing source texture: "+m.source);
  }
  if(input.analysis&&input.analysis.classes&&input.analysis.classes.count>0){
   const rebuild=input.reimplementation;
   if(rebuild&&rebuild.schema==="jar2zeus.reimplementation.v1"){
    if((rebuild.utilityMethodsTranslated||0)>0)warnings.push("Some pure Java helper methods were emitted as Lua, but this does not by itself connect them to game events");
    if((rebuild.methodsPending||0)>0)warnings.push((rebuild.methodsPending||0)+" Java methods still need feature-specific Zeus reimplementation");
    if((rebuild.methodsPending||0)===0&&(rebuild.utilityMethodsTranslated||0)===0)warnings.push("Java bytecode was inspected but no method was translated");
   }else warnings.push("Java bytecode was analyzed but no reimplementation report was supplied");
  }
  if(input.analysis&&input.analysis.unsupportedIndicators&&input.analysis.unsupportedIndicators.length)warnings.push("MOD contains unsupported runtime features: "+input.analysis.unsupportedIndicators.join(", "));
  if(input.runtimeTested!==true)warnings.push("The selected Zeus target has not passed an in-game runtime test");
  const targetEvidence=input.targetRuntimeEvidence||{};
  if(targetEvidence.apiPresenceVerified!==true)warnings.push("Required Zeus API presence has not been verified in the selected game build");
  if(targetEvidence.versionVerified!==true)warnings.push("The running game version has not been confirmed by an in-game report; the package version is based on the selection");
  const valid=errors.length===0;
  const skipped=!!(input.packageSkipped&&input.packageSkipped.length);
  const runtimeTested=input.runtimeTested===true;
  const gameplayVerified=input.gameplayVerified===true;
  const reimplementation=input.reimplementation||{};
  const recipeReport=input.recipeReport||{};
  const definitionReport=input.definitionReport||{};
  const configReport=input.configReport||{};
  const configNotWired=(Number(configReport.settingsGenerated)||0)>0&&configReport.sourceReadersRewritten!==true;
  if(configNotWired)warnings.push("Simple config values were exposed as Zeus settings, but original Java config readers were not redirected.");
  const javaTypeCompatibility=input.javaTypeCompatibility||{};
  const hasJavaClasses=(Number(javaTypeCompatibility.totals&&javaTypeCompatibility.totals.classesRegistered)||0)>0;
  const typeLayerIncomplete=hasJavaClasses&&(!Array.isArray(javaTypeCompatibility.limitations)||javaTypeCompatibility.limitations.length>0);
  if(typeLayerIncomplete)warnings.push("Java type compatibility is only a scaffold: constructors, class initializers and complete JVM object semantics remain unimplemented.");
  const eventLifecycle=input.eventLifecycle||{};
  const lifecyclePending=Number(eventLifecycle.totals&&eventLifecycle.totals.loaderEntrypoints||0)+
   Number(eventLifecycle.totals&&eventLifecycle.totals.lifecycleCandidates||0)+
   Number(eventLifecycle.totals&&eventLifecycle.totals.annotationBearingMethods||0)+
   Number(eventLifecycle.totals&&eventLifecycle.totals.eventRegistrationSites||0)+
   Number(eventLifecycle.totals&&eventLifecycle.totals.eventReferenceCandidates||0)+
   Number(eventLifecycle.totals&&eventLifecycle.totals.timerSites||0)+
   Number(eventLifecycle.totals&&eventLifecycle.totals.blockingWaitSites||0)+
   Number(eventLifecycle.totals&&eventLifecycle.totals.cancellationSites||0);
  if(eventLifecycle.schema==="jar2zeus.java-event-lifecycle.v1"&&lifecyclePending>0)
   warnings.push(lifecyclePending+" Java lifecycle, event or timer candidates still need an explicit Zeus-side rewrite; none were auto-wired");
  if(eventLifecycle.schema!=="jar2zeus.java-event-lifecycle.v1")
   warnings.push("Java lifecycle analysis is missing; event-driven Java behavior has not been proven absent");
  const forgeApiCompatibility=input.forgeApiCompatibility||{};
  const forgeApiReportMissing=forgeApiCompatibility.schema!=="jar2zeus.forge-api-compatibility.v1"&&hasJavaClasses;
  const forgeApiPending=forgeApiCompatibility.schema==="jar2zeus.forge-api-compatibility.v1"?
   (Number(forgeApiCompatibility.totals&&forgeApiCompatibility.totals.unmappedSites)||0)+
   (Number(forgeApiCompatibility.totals&&forgeApiCompatibility.totals.classReferenceSites)||0):0;
  if(forgeApiPending>0)warnings.push(forgeApiPending+" Forge API call, field or class-reference candidates are not mapped to Zeus; manual porting is required.");
  if(forgeApiReportMissing)warnings.push("Forge API compatibility analysis is missing; imported Forge API use has not been reviewed.");
  const detectedFabricLoader=!!(input.analysis&&Array.isArray(input.analysis.loaders)&&input.analysis.loaders.includes("Fabric"));
  const fabricApiCompatibility=input.fabricApiCompatibility||{};
  const fabricApiReportMissing=(hasJavaClasses||detectedFabricLoader)&&fabricApiCompatibility.schema!=="jar2zeus.fabric-api-compatibility.v1";
  const fabricMetadata=fabricApiCompatibility.metadata||{};
  const fabricApiPending=fabricApiCompatibility.schema==="jar2zeus.fabric-api-compatibility.v1"?
   (Number(fabricApiCompatibility.totals&&fabricApiCompatibility.totals.unmappedSites)||0)+
   (Number(fabricApiCompatibility.totals&&fabricApiCompatibility.totals.fabricApiClassReferenceSites)||0)+
   (Number(fabricApiCompatibility.totals&&fabricApiCompatibility.totals.loaderApiClassReferenceSites)||0)+
   (Number(fabricApiCompatibility.totals&&fabricApiCompatibility.totals.commonApiClassReferenceSites)||0)+
   (Number(fabricApiCompatibility.totals&&fabricApiCompatibility.totals.entrypointsDeclared)||0)+
   (fabricMetadata.accessWidener?1:0)+
   (Array.isArray(fabricMetadata.mixins)?fabricMetadata.mixins.length:0)+
   (Array.isArray(fabricMetadata.nestedJars)?fabricMetadata.nestedJars.length:0):0;
  if(fabricApiPending>0)warnings.push(fabricApiPending+" Fabric API, Loader, entrypoint or metadata candidates still require explicit Zeus-side review; none were auto-wired.");
  if(fabricApiReportMissing)warnings.push("Fabric API compatibility analysis is missing; Fabric API and Loader use has not been reviewed.");
  const minecraftInternalApiCompatibility=input.minecraftInternalApiCompatibility||{};
  const minecraftInternalApiReportMissing=hasJavaClasses&&minecraftInternalApiCompatibility.schema!=="jar2zeus.minecraft-internal-api-compatibility.v1";
  const minecraftInternalApiPending=minecraftInternalApiCompatibility.schema==="jar2zeus.minecraft-internal-api-compatibility.v1"?
   (Number(minecraftInternalApiCompatibility.totals&&minecraftInternalApiCompatibility.totals.unmappedSites)||0)+
   (Number(minecraftInternalApiCompatibility.totals&&minecraftInternalApiCompatibility.totals.classReferenceSites)||0):0;
  if(minecraftInternalApiPending>0)warnings.push(minecraftInternalApiPending+" Minecraft internal API call, field or class-reference candidates remain unmapped; version-specific manual porting is required.");
  if(minecraftInternalApiReportMissing)warnings.push("Minecraft internal API compatibility analysis is missing; vanilla game API references have not been reviewed.");
  const blockStateConversion=input.blockStateConversion||{};
  const blockStateReportMissing=hasJavaClasses&&blockStateConversion.schema!=="jar2zeus.block-state-conversion.v1";
  const blockStatePending=blockStateConversion.schema==="jar2zeus.block-state-conversion.v1"?
   (Number(blockStateConversion.totals&&blockStateConversion.totals.unmappedOperations)||0)+
   (Number(blockStateConversion.totals&&blockStateConversion.totals.blockClasses)||0)+
   (Number(blockStateConversion.totals&&blockStateConversion.totals.blockStateClasses)||0):0;
  if(blockStatePending>0)warnings.push(blockStatePending+" block/BlockState classes or operations remain unmapped; a version-specific Zeus block adapter and in-game checks are still required.");
  if(blockStateReportMissing)warnings.push("Block/BlockState conversion analysis is missing; Java block behavior has not been reviewed.");
  const itemInventoryConversion=input.itemInventoryConversion||{};
  const itemInventoryReportMissing=hasJavaClasses&&itemInventoryConversion.schema!=="jar2zeus.item-inventory-conversion.v1";
  const itemInventoryPending=itemInventoryConversion.schema==="jar2zeus.item-inventory-conversion.v1"?
   (Number(itemInventoryConversion.totals&&itemInventoryConversion.totals.unmappedOperations)||0)+
   (Number(itemInventoryConversion.totals&&itemInventoryConversion.totals.itemClasses)||0)+
   (Number(itemInventoryConversion.totals&&itemInventoryConversion.totals.itemStackClasses)||0)+
   (Number(itemInventoryConversion.totals&&itemInventoryConversion.totals.inventoryClasses)||0):0;
  if(itemInventoryPending>0)warnings.push(itemInventoryPending+" item, ItemStack or inventory classes/operations remain unmapped; a version-specific Zeus item adapter and in-game checks are still required.");
  if(itemInventoryReportMissing)warnings.push("Item/inventory conversion analysis is missing; Java item and inventory behavior has not been reviewed.");
  const blockEntityMachineState=input.blockEntityMachineState||{};
  const blockEntityMachineStateReportMissing=hasJavaClasses&&blockEntityMachineState.schema!=="jar2zeus.block-entity-machine-state.v1";
  const blockEntityMachineStatePending=blockEntityMachineState.schema==="jar2zeus.block-entity-machine-state.v1"?
   (Number(blockEntityMachineState.totals&&blockEntityMachineState.totals.blockEntityClasses)||0)+
   (Number(blockEntityMachineState.totals&&blockEntityMachineState.totals.operationsObserved)||0)+
   (Number(blockEntityMachineState.totals&&blockEntityMachineState.totals.dataFieldsObserved)||0):0;
  if(blockEntityMachineStatePending>0)warnings.push(blockEntityMachineStatePending+" BlockEntity, persistence, NBT or machine-state details remain unmapped; a version-specific adapter and save/reload/tick checks are still required.");
  if(blockEntityMachineStateReportMissing)warnings.push("BlockEntity/machine-state analysis is missing; Java persistence and ticking behavior has not been reviewed.");
  const machinePowerSystems=input.machinePowerSystems||{};
  const machinePowerSystemsReportMissing=hasJavaClasses&&machinePowerSystems.schema!=="jar2zeus.machine-power-systems.v1";
  const machinePowerSystemsPending=machinePowerSystems.schema==="jar2zeus.machine-power-systems.v1"?
   (Number(machinePowerSystems.totals&&machinePowerSystems.totals.powerRelatedClasses)||0)+
   (Number(machinePowerSystems.totals&&machinePowerSystems.totals.operationsReported)||0)+
   (Number(machinePowerSystems.totals&&machinePowerSystems.totals.fieldsObserved)||0)+
   (Number(machinePowerSystems.totals&&machinePowerSystems.totals.methodsObserved)||0):0;
  if(machinePowerSystemsPending>0)warnings.push(machinePowerSystemsPending+" power/energy/kinetic classes, methods or fields remain unmapped; a version-specific adapter and network/transfer/tick validation are required.");
  if(machinePowerSystemsReportMissing)warnings.push("Machine power analysis is missing; energy and kinetic API usage has not been reviewed.");
  const transportNetworks=input.transportNetworks||{};
  const transportNetworksReportMissing=hasJavaClasses&&transportNetworks.schema!=="jar2zeus.transport-networks.v1";
  const transportNetworksPending=transportNetworks.schema==="jar2zeus.transport-networks.v1"?
   (Number(transportNetworks.totals&&transportNetworks.totals.transportClasses)||0)+
   (Number(transportNetworks.totals&&transportNetworks.totals.operationsObserved)||0)+
   (Number(transportNetworks.totals&&transportNetworks.totals.fieldsObserved)||0)+
   (Number(transportNetworks.totals&&transportNetworks.totals.methodsObserved)||0)+
   (Number(transportNetworks.totals&&transportNetworks.totals.apiReferences)||0):0;
  if(transportNetworksPending>0)warnings.push(transportNetworksPending+" item/fluid/energy transport, routing or network details remain unmapped; version-specific adapters and topology/transfer tests are required.");
  if(transportNetworksReportMissing)warnings.push("Transport network analysis is missing; item/fluid/energy transfer behavior has not been reviewed.");
  const incompleteJava=(reimplementation.methodsPending||0)>0||(reimplementation.methodsSkipped||0)>0||configNotWired||typeLayerIncomplete||lifecyclePending>0||eventLifecycle.schema!=="jar2zeus.java-event-lifecycle.v1"||forgeApiPending>0||forgeApiReportMissing||fabricApiPending>0||fabricApiReportMissing||minecraftInternalApiPending>0||minecraftInternalApiReportMissing||blockStatePending>0||blockStateReportMissing||itemInventoryPending>0||itemInventoryReportMissing||blockEntityMachineStatePending>0||blockEntityMachineStateReportMissing||machinePowerSystemsPending>0||machinePowerSystemsReportMissing||transportNetworksPending>0||transportNetworksReportMissing;
  const skippedResources=(Array.isArray(recipeReport.skipped)?recipeReport.skipped.length:0)+
   (Array.isArray(recipeReport.excluded)?recipeReport.excluded.length:0)+
   (Array.isArray(definitionReport.skipped)?definitionReport.skipped.length:0)+
   (Array.isArray(definitionReport.ignoredNamespaces)?definitionReport.ignoredNamespaces.length:0)+
   (input.entityReport&&Array.isArray(input.entityReport.skipped)?input.entityReport.skipped.length:0)+
   (input.entityReport&&Array.isArray(input.entityReport.animationsUnmapped)?input.entityReport.animationsUnmapped.length:0)+
   (input.entityReport&&Array.isArray(input.entityReport.machineAnimationsUnmapped)?input.entityReport.machineAnimationsUnmapped.length:0)+
   (input.entityReport&&Array.isArray(input.entityReport.machineAssetsUnmapped)?input.entityReport.machineAssetsUnmapped.length:0)+
   (Array.isArray(configReport.skipped)?configReport.skipped.length:0)+
   (Number(configReport.excludedSensitiveKeys)||0);
  const restrictedResources=!!(input.analysis&&input.analysis.featureReview&&input.analysis.featureReview.restrictedPathCount>0);
  const unsupportedRuntime=!!(input.analysis&&input.analysis.unsupportedIndicators&&input.analysis.unsupportedIndicators.length);
  const conversionComplete=valid&&!skipped&&!incompleteJava&&skippedResources===0&&!restrictedResources&&!unsupportedRuntime;
  if(!conversionComplete)warnings.push("The generated package is a partial port; review skipped resources, restricted-content exclusions, Java reimplementation tasks and runtime indicators");
  const readyToImport=conversionComplete&&runtimeTested&&gameplayVerified&&targetEvidence.apiPresenceVerified===true&&targetEvidence.versionVerified===true;
  return {
   valid,
   conversionComplete,
   structurallyValid:valid,
   canImportForTesting:valid,
   readyToImport,
   runtimeTested,
   gameplayVerified,
   targetRuntimeEvidence:{
    apiPresenceVerified:targetEvidence.apiPresenceVerified===true,
    versionVerified:targetEvidence.versionVerified===true
   },
   packageLimits,
   requiredApis:api&&Array.isArray(api.requiredApis)?api.requiredApis:[],
   errors,
   warnings
  };
 }
 root.Jar2ZeusPackageValidator={validate};
})(typeof globalThis!=="undefined"?globalThis:this);
