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
  let valid=errors.length===0;
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
  const machineProcessAnalysis=input.machineProcessAnalysis||{};
  const machineProcessFileCount=Number(input.machineProcessFileCount)||0;
  const machineProcessReportMissing=(hasJavaClasses||machineProcessFileCount>0)&&machineProcessAnalysis.schema!=="jar2zeus.machine-process-analysis.v1";
  const machineProcessPending=machineProcessAnalysis.schema==="jar2zeus.machine-process-analysis.v1"?
   (Number(machineProcessAnalysis.totals&&machineProcessAnalysis.totals.recipeRelatedClasses)||0)+
   (Number(machineProcessAnalysis.totals&&machineProcessAnalysis.totals.machineProcessorClasses)||0)+
   (Number(machineProcessAnalysis.totals&&machineProcessAnalysis.totals.recipeSerializerClasses)||0)+
   (Number(machineProcessAnalysis.totals&&machineProcessAnalysis.totals.recipeTypeClasses)||0)+
   (Number(machineProcessAnalysis.totals&&machineProcessAnalysis.totals.machineRecipeCandidates)||0)+
   (Number(machineProcessAnalysis.totals&&machineProcessAnalysis.totals.customRecipeDefinitions)||0)+
   (Number(machineProcessAnalysis.totals&&machineProcessAnalysis.totals.recipeJsonReadErrors)||0)+
   (Number(machineProcessAnalysis.totals&&machineProcessAnalysis.totals.recipeJsonInvalid)||0)+
   (Number(machineProcessAnalysis.totals&&machineProcessAnalysis.totals.operationsObserved)||0)+
   (Number(machineProcessAnalysis.totals&&machineProcessAnalysis.totals.fieldsObserved)||0):0;
  if(machineProcessPending>0)warnings.push(machineProcessPending+" recipe, processing-state, duration, fuel, energy, condition or byproduct candidates remain unmapped; machine processing must be implemented and tested.");
  if(machineProcessReportMissing)warnings.push("Machine process analysis is missing; recipe serializers and production state have not been reviewed.");
  const machineGuiInteraction=input.machineGuiInteraction||{};
  const machineGuiResourceFileCount=Number(input.machineGuiResourceFileCount)||0;
  const machineGuiReportMissing=(hasJavaClasses||machineGuiResourceFileCount>0)&&machineGuiInteraction.schema!=="jar2zeus.machine-gui-interaction.v1";
  const machineGuiPending=machineGuiInteraction.schema==="jar2zeus.machine-gui-interaction.v1"?
   (Number(machineGuiInteraction.totals&&machineGuiInteraction.totals.guiClasses)||0)+
   (Number(machineGuiInteraction.totals&&machineGuiInteraction.totals.screenMenuLinks)||0)+
   (Number(machineGuiInteraction.totals&&machineGuiInteraction.totals.operationsObserved)||0)+
   (Number(machineGuiInteraction.totals&&machineGuiInteraction.totals.fieldsObserved)||0)+
   (Number(machineGuiInteraction.totals&&machineGuiInteraction.totals.guiSyncOperationsObserved)||0)+
   (Number(machineGuiInteraction.totals&&machineGuiInteraction.totals.packetReferenceSites)||0)+
   (Number(machineGuiInteraction.totals&&machineGuiInteraction.totals.guiResourceFilesSeen)||0)+
   (Number(machineGuiInteraction.totals&&machineGuiInteraction.totals.guiJsonReadErrors)||0)+
   (Number(machineGuiInteraction.totals&&machineGuiInteraction.totals.guiJsonInvalid)||0):0;
  if(machineGuiPending>0)warnings.push(machineGuiPending+" machine GUI, menu, widget, slot, interaction, asset or synchronization candidates remain unmapped; the Zeus UI and server-authoritative actions require implementation and testing.");
  if(machineGuiReportMissing)warnings.push("Machine GUI analysis is missing; screens, menus, widgets and server synchronization have not been reviewed.");
  const machineGuiConversion=input.machineGuiConversion||{};
  const machineGuiConversionFileCount=Number(input.machineGuiConversionFileCount)||0;
  const machineGuiConversionReportMissing=(machineGuiPending>0||machineGuiResourceFileCount>0||machineGuiConversionFileCount>0)&&machineGuiConversion.schema!=="jar2zeus.machine-gui-conversion-plan.v1";
  const machineGuiConversionUnsafeClaim=machineGuiConversion.schema==="jar2zeus.machine-gui-conversion-plan.v1"&&(machineGuiConversion.sourceBehaviorPorted!==false||machineGuiConversion.executableMachineGui!==false);
  if(machineGuiConversionReportMissing)warnings.push("Machine GUI Zeus conversion plan is missing; do not treat the preview scaffold as a completed port.");
  if(machineGuiConversionUnsafeClaim)errors.push("Machine GUI conversion plan incorrectly claims executable or source-behavior-complete migration.");
  const machineGuiStateBridge=input.machineGuiStateBridge||{};
  const machineGuiStateBridgeFileCount=Number(input.machineGuiStateBridgeFileCount)||0;
  const machineGuiStateBridgeReportMissing=(machineGuiConversionFileCount>0||machineGuiStateBridgeFileCount>0||machineGuiPending>0)&&machineGuiStateBridge.schema!=="jar2zeus.machine-gui-state-bridge.v1";
  const machineGuiStateBridgeUnsafeClaim=machineGuiStateBridge.schema==="jar2zeus.machine-gui-state-bridge.v1"&&(machineGuiStateBridge.machineValuesConnected!==false||machineGuiStateBridge.runtimeValuesRecovered!==false||machineGuiStateBridge.worldWritesPerformed!==false);
  const machineStateProviderContract=machineGuiStateBridge.optionalProvider||{};
  const machineStateProviderContractInvalid=machineGuiStateBridge.schema==="jar2zeus.machine-gui-state-bridge.v1"&&(machineStateProviderContract.schema!=="jar2zeus.machine-state-provider.v1"||machineStateProviderContract.apiVersion!==1||machineStateProviderContract.providerValuesIndependentlyVerified!==false||machineGuiStateBridge.providerValuesIndependentlyVerified!==false);
  const machineGuiStateBridgePending=machineGuiStateBridge.schema==="jar2zeus.machine-gui-state-bridge.v1"?
   (Number(machineGuiStateBridge.totals&&machineGuiStateBridge.totals.machineClasses)||0)+
   (Number(machineGuiStateBridge.totals&&machineGuiStateBridge.totals.fieldsObserved)||0)+
   (Number(machineGuiStateBridge.totals&&machineGuiStateBridge.totals.operationCandidates)||0):0;
  if(machineGuiStateBridgeReportMissing)warnings.push("Machine GUI state bridge plan is missing; actual machine values must not be assumed readable.");
  if(machineGuiStateBridgePending>0)warnings.push(machineGuiStateBridgePending+" machine-state evidence candidates remain disconnected; use only documented read APIs or an explicit external Zeus provider.");
  if(machineGuiStateBridgeUnsafeClaim)errors.push("Machine GUI state bridge incorrectly claims runtime machine values are connected/recovered or world writes are performed.");
  if(machineStateProviderContractInvalid)errors.push("Machine-state provider contract is missing, unsupported or incorrectly claims independent verification.");
  const machineGuiLiveBinding=input.machineGuiLiveBinding||{};
  const machineGuiLiveBindingFileCount=Number(input.machineGuiLiveBindingFileCount)||0;
  const machineGuiLiveBindingReportMissing=(machineGuiConversionFileCount>0||machineGuiStateBridgeFileCount>0||machineGuiLiveBindingFileCount>0||machineGuiPending>0)&&machineGuiLiveBinding.schema!=="jar2zeus.machine-gui-live-binding.v1";
  const machineGuiLiveBindingUnsafeClaim=machineGuiLiveBinding.schema==="jar2zeus.machine-gui-live-binding.v1"&&(machineGuiLiveBinding.liveValuesConnected!==false||machineGuiLiveBinding.sourceValuesIndependentlyVerified!==false||machineGuiLiveBinding.worldWritesPerformed!==false||Number(machineGuiLiveBinding.sourceCallbacksRegistered)!==0);
  const machineGuiLiveBindingPending=machineGuiLiveBinding.schema==="jar2zeus.machine-gui-live-binding.v1"?(Number(machineGuiLiveBinding.totals&&machineGuiLiveBinding.totals.candidateBindingsReported)||0):0;
  if(machineGuiLiveBindingReportMissing)warnings.push("Machine GUI live-binding report is missing; no live telemetry display should be assumed.");
  if(machineGuiLiveBindingPending>0)warnings.push(machineGuiLiveBindingPending+" GUI telemetry bindings still require a real companion-provider source.");
  if(machineGuiLiveBindingUnsafeClaim)errors.push("Machine GUI live-binding report incorrectly claims connected or independently verified source values, registered source callbacks, or world writes.");
  const machineStateProviderSdk=input.machineStateProviderSdk||{};
  const machineStateProviderSdkFileCount=Number(input.machineStateProviderSdkFileCount)||0;
  const machineStateProviderSdkRequired=machineGuiLiveBindingFileCount>0||machineGuiStateBridgeFileCount>0||machineGuiLiveBindingPending>0;
  const machineStateProviderSdkFilePresent=packageFiles.some(file=>file&&file.path==="machine-state-provider-sdk-plan.json");
  const machineStateProviderSdkReportMissing=machineStateProviderSdkRequired&&(machineStateProviderSdk.schema!=="jar2zeus.machine-state-provider-sdk.v1"||machineStateProviderSdkFileCount<1||!machineStateProviderSdkFilePresent);
  const machineStateProviderSdkUnsafeClaim=machineStateProviderSdk.schema==="jar2zeus.machine-state-provider-sdk.v1"&&(machineStateProviderSdk.readerRegistrationsGenerated!==0||machineStateProviderSdk.eventReaderRegistrationsGenerated!==0||machineStateProviderSdk.realSourceReadersRegistered!==false||machineStateProviderSdk.valuesConnected!==false||machineStateProviderSdk.sourceValuesIndependentlyVerified!==false||machineStateProviderSdk.arbitraryJavaBlockEntityAccess!==false);
  const machineStateProviderSdkContractInvalid=machineStateProviderSdk.schema==="jar2zeus.machine-state-provider-sdk.v1"&&(!machineStateProviderSdk.contract||machineStateProviderSdk.contract.schema!=="jar2zeus.machine-state-provider.v1"||machineStateProviderSdk.contract.apiVersion!==1||machineStateProviderSdk.contract.eventSchema!=="jar2zeus.machine-state-event.v1"||machineStateProviderSdk.contract.exportName!=="read_machine_state");
  const providerIdsMatch=!machineStateProviderSdkRequired||machineStateProviderSdk.schema!=="jar2zeus.machine-state-provider-sdk.v1"||machineGuiLiveBinding.schema!=="jar2zeus.machine-gui-live-binding.v1"||(machineStateProviderSdk.provider&&machineGuiLiveBinding.providerContract&&machineStateProviderSdk.provider.id===machineGuiLiveBinding.providerContract.providerModId);
  if(machineStateProviderSdkReportMissing)warnings.push("Machine-state provider SDK package/report is missing; live values still have no provider starter.");
  if(machineStateProviderSdkUnsafeClaim)errors.push("Machine-state provider SDK incorrectly claims that readers or verified machine values are already available.");
  if(machineStateProviderSdkContractInvalid)errors.push("Machine-state provider SDK contract schema or API version is invalid.");
  if(machineStateProviderSdkRequired&&!providerIdsMatch)errors.push("The generated provider ID does not match the live GUI consumer default provider ID.");
  const machineStateEventProducer=input.machineStateEventProducer||{};
  const machineStateEventProducerFileCount=Number(input.machineStateEventProducerFileCount)||0;
  const machineStateEventProducerFilePresent=packageFiles.some(file=>file&&file.path==="machine-state-event-producer-plan.json");
  const machineStateEventProducerRequired=machineStateProviderSdk.schema==="jar2zeus.machine-state-provider-sdk.v1"&&(machineStateEventProducerFileCount>0||machineStateEventProducerFilePresent||(typeof input.mainLua==="string"&&input.mainLua.includes("exports.publish_machine_state = publishMachineState")));
  const machineStateEventProducerHelperMissing=typeof input.mainLua!=="string"||!input.mainLua.includes("exports.publish_machine_state = publishMachineState");
  const machineStateEventProducerApiMissing=!api||!Array.isArray(api.requiredApis)||!api.requiredApis.includes("mods.get")||!api.requiredApis.includes("events.emit");
  const machineStateEventProducerReportMissing=machineStateEventProducerRequired&&(machineStateEventProducer.schema!=="jar2zeus.machine-state-event-producer-sdk.v1"||machineStateEventProducerFileCount<1||!machineStateEventProducerFilePresent||machineStateEventProducerHelperMissing||machineStateEventProducerApiMissing);
  const machineStateEventProducerUnsafeClaim=machineStateEventProducer.schema==="jar2zeus.machine-state-event-producer-sdk.v1"&&(machineStateEventProducer.publisherHelperGenerated!==true||machineStateEventProducer.sourceReaderCallbacksGenerated!==0||machineStateEventProducer.eventPublicationsWired!==0||machineStateEventProducer.automaticPublication!==false||machineStateEventProducer.realStateCallbacksRegistered!==false||machineStateEventProducer.valuesConnected!==false||machineStateEventProducer.sourceValuesIndependentlyVerified!==false||machineStateEventProducer.sourceRuntimeValuesRecovered!==false||machineStateEventProducer.arbitraryJavaBlockEntityAccess!==false);
  const machineStateEventProducerContractInvalid=machineStateEventProducer.schema==="jar2zeus.machine-state-event-producer-sdk.v1"&&(machineStateEventProducer.status!=="explicit-publisher-helper-generated"||!machineStateEventProducer.contract||machineStateEventProducer.contract.schema!=="jar2zeus.machine-state-event.v1"||machineStateEventProducer.contract.apiVersion!==1||machineStateEventProducer.contract.eventName!==machineStateEventProducer.provider?.eventName||machineStateEventProducer.contract.providerSchema!=="jar2zeus.machine-state-provider.v1"||machineStateEventProducer.contract.providerApiVersion!==1||machineStateEventProducer.publisherFunction!=="mod.export.publish_machine_state");
  const producerProviderIdsMatch=!machineStateEventProducerRequired||machineStateEventProducer.schema!=="jar2zeus.machine-state-event-producer-sdk.v1"||(machineStateEventProducer.provider&&machineStateProviderSdk.provider&&machineStateEventProducer.provider.id===machineStateProviderSdk.provider.id);
  const producerSourceIdsMatch=!machineStateEventProducerRequired||machineStateEventProducer.schema!=="jar2zeus.machine-state-event-producer-sdk.v1"||(machineStateEventProducer.producer&&machineStateProviderSdk.provider&&machineStateEventProducer.producer.sourceModId===machineStateProviderSdk.provider.sourceModId);
  if(machineStateEventProducerReportMissing)warnings.push("Machine-state event producer helper/report is missing; the converted MOD cannot publish the Phase 23 telemetry event through its generated helper.");
  if(machineStateEventProducerUnsafeClaim)errors.push("Machine-state event producer incorrectly claims automatic publication, connected source callbacks or recovered/verified live values.");
  if(machineStateEventProducerContractInvalid)errors.push("Machine-state event producer contract schema or API version is invalid.");
  if(machineStateEventProducerRequired&&(!producerProviderIdsMatch||!producerSourceIdsMatch))errors.push("The event producer provider/source IDs do not match the Phase 23 provider SDK.");
  if(machineStateEventProducer.schema==="jar2zeus.machine-state-event-producer-sdk.v1"&&machineStateEventProducer.totals&&(Number(machineStateEventProducer.totals.sourceReaderCallbacksGenerated)!==0||Number(machineStateEventProducer.totals.eventPublicationsWired)!==0||Number(machineStateEventProducer.totals.valuesConnected)!==0))errors.push("The event producer report contains non-zero automatic source wiring claims.");
  if(machineStateEventProducerRequired)warnings.push("Machine-state event publishing remains opt-in: connect genuine supported state in a source-owned callback and verify delivery in the target game.");
  const machineStateSourceAnalysis=input.machineStateSourceAnalysis||{};
  const machineStateSourceAnalysisFileCount=Number(input.machineStateSourceAnalysisFileCount)||0;
  const machineStateSourceAnalysisFilePresent=packageFiles.some(file=>file&&file.path==="machine-state-source-analysis-plan.json");
  const machineStateSourceAnalysisRequired=machineStateEventProducer.schema==="jar2zeus.machine-state-event-producer-sdk.v1"&&(machineStateSourceAnalysisFileCount>0||machineStateSourceAnalysisFilePresent);
  const machineStateSourceAnalysisReportMissing=machineStateSourceAnalysisRequired&&(machineStateSourceAnalysis.schema!=="jar2zeus.machine-state-source-analysis.v1"||machineStateSourceAnalysisFileCount<1||!machineStateSourceAnalysisFilePresent);
  const machineStateSourceAnalysisUnsafeClaim=machineStateSourceAnalysis.schema==="jar2zeus.machine-state-source-analysis.v1"&&(machineStateSourceAnalysis.sourceReaderCallbacksGenerated!==0||machineStateSourceAnalysis.eventPublicationsWired!==0||machineStateSourceAnalysis.javaMethodsInvoked!==false||machineStateSourceAnalysis.liveValuesConnected!==false||machineStateSourceAnalysis.sourceRuntimeValuesRecovered!==false||machineStateSourceAnalysis.arbitraryJavaBlockEntityAccess!==false);
  const machineStateSourceAnalysisShapeInvalid=machineStateSourceAnalysis.schema==="jar2zeus.machine-state-source-analysis.v1"&&(!Array.isArray(machineStateSourceAnalysis.fieldCandidates)||!Array.isArray(machineStateSourceAnalysis.getterCandidates)||!Array.isArray(machineStateSourceAnalysis.metricSummary)||!machineStateSourceAnalysis.totals||!Number.isFinite(Number(machineStateSourceAnalysis.totals.getterCandidatesObserved)));
  const machineStateSourceAnalysisPending=machineStateSourceAnalysis.schema==="jar2zeus.machine-state-source-analysis.v1"?(Number(machineStateSourceAnalysis.totals&&machineStateSourceAnalysis.totals.fieldCandidatesSeen)||0)+(Number(machineStateSourceAnalysis.totals&&machineStateSourceAnalysis.totals.getterCandidatesObserved)||0):0;
  const machineStateGetterSemantics=input.machineStateGetterSemantics||{};
  const machineStateGetterSemanticsFileCount=Number(input.machineStateGetterSemanticsFileCount)||0;
  const machineStateGetterSemanticsFilePresent=packageFiles.some(file=>file&&file.path==="machine-state-getter-semantics-plan.json");
  const machineStateGetterSemanticsRequired=machineStateSourceAnalysis.schema==="jar2zeus.machine-state-source-analysis.v1";
  const machineStateGetterSemanticsReportMissing=machineStateGetterSemanticsRequired&&(machineStateGetterSemantics.schema!=="jar2zeus.machine-state-getter-semantics.v1"||machineStateGetterSemanticsFileCount<1||!machineStateGetterSemanticsFilePresent);
  const machineStateGetterSemanticsUnsafeClaim=machineStateGetterSemantics.schema==="jar2zeus.machine-state-getter-semantics.v1"&&(machineStateGetterSemantics.javaMethodsExecuted!==false||machineStateGetterSemantics.sourceRuntimeValuesRecovered!==false||machineStateGetterSemantics.liveValuesConnected!==false||machineStateGetterSemantics.arbitraryJavaBlockEntityAccess!==false||machineStateGetterSemantics.sourceReaderCallbacksGenerated!==0||machineStateGetterSemantics.eventPublicationsWired!==0);
  const machineStateGetterSemanticsShapeInvalid=machineStateGetterSemantics.schema==="jar2zeus.machine-state-getter-semantics.v1"&&(!Array.isArray(machineStateGetterSemantics.getterAnalyses)||!Array.isArray(machineStateGetterSemantics.classificationSummary)||!machineStateGetterSemantics.totals||!Number.isFinite(Number(machineStateGetterSemantics.totals.getterCandidatesSeen)));
  const machineStateGetterSemanticsPending=machineStateGetterSemantics.schema==="jar2zeus.machine-state-getter-semantics.v1"?(Number(machineStateGetterSemantics.totals&&machineStateGetterSemantics.totals.getterCandidatesSeen)||0):0;
  const machineStateWriteTrace=input.machineStateWriteTrace||{};
  const machineStateWriteTraceFileCount=Number(input.machineStateWriteTraceFileCount)||0;
  const machineStateWriteTraceFilePresent=packageFiles.some(file=>file&&file.path==="machine-state-write-trace-plan.json");
  const machineStateWriteTraceRequired=machineStateGetterSemantics.schema==="jar2zeus.machine-state-getter-semantics.v1";
  const machineStateWriteTraceReportMissing=machineStateWriteTraceRequired&&(machineStateWriteTrace.schema!=="jar2zeus.machine-state-write-trace.v1"||machineStateWriteTraceFileCount<1||!machineStateWriteTraceFilePresent);
  const machineStateWriteTraceUnsafeClaim=machineStateWriteTrace.schema==="jar2zeus.machine-state-write-trace.v1"&&(machineStateWriteTrace.javaMethodsExecuted!==false||machineStateWriteTrace.assignmentValuesRecovered!==false||machineStateWriteTrace.updateTimingRecovered!==false||machineStateWriteTrace.sourceRuntimeValuesRecovered!==false||machineStateWriteTrace.liveValuesConnected!==false||machineStateWriteTrace.arbitraryJavaBlockEntityAccess!==false||machineStateWriteTrace.sourceReaderCallbacksGenerated!==0||machineStateWriteTrace.eventPublicationsWired!==0);
  const machineStateWriteTraceShapeInvalid=machineStateWriteTrace.schema==="jar2zeus.machine-state-write-trace.v1"&&(!Array.isArray(machineStateWriteTrace.fieldSummaries)||!Array.isArray(machineStateWriteTrace.writerMethods)||!Array.isArray(machineStateWriteTrace.roleSummary)||!machineStateWriteTrace.totals||!Number.isFinite(Number(machineStateWriteTrace.totals.writerMethodsObserved)));
  const machineStateWriteTracePending=machineStateWriteTrace.schema==="jar2zeus.machine-state-write-trace.v1"?(Number(machineStateWriteTrace.totals&&machineStateWriteTrace.totals.fieldCandidatesSeen)||0)+(Number(machineStateWriteTrace.totals&&machineStateWriteTrace.totals.writerMethodsObserved)||0):0;
  if(machineStateWriteTraceReportMissing)warnings.push("Machine-state write-trace plan is missing; decoded write sites and update-path candidates have not been reviewed.");
  if(machineStateWriteTracePending>0)warnings.push(machineStateWriteTracePending+" machine-state field/write-path evidence entries remain static only; assigned values and runtime update timing are not recovered.");
  if(machineStateWriteTraceUnsafeClaim)errors.push("Machine-state write-trace report incorrectly claims Java execution, recovered assignment values or update timing, connected runtime values, source callbacks, event wiring or arbitrary Java BlockEntity access.");
  if(machineStateWriteTraceShapeInvalid)errors.push("Machine-state write-trace report has an invalid schema shape.");

  const machineStateUpdateConditions=input.machineStateUpdateConditions||{};
  const machineStateUpdateConditionsFileCount=Number(input.machineStateUpdateConditionsFileCount)||0;
  const machineStateUpdateConditionsFilePresent=packageFiles.some(file=>file&&file.path==="machine-state-update-conditions-plan.json");
  const machineStateUpdateConditionsRequired=machineStateWriteTrace.schema==="jar2zeus.machine-state-write-trace.v1";
  const machineStateUpdateConditionsMissing=machineStateUpdateConditionsRequired&&(machineStateUpdateConditions.schema!=="jar2zeus.machine-state-update-conditions.v1"||machineStateUpdateConditionsFileCount<1||!machineStateUpdateConditionsFilePresent);
  const machineStateUpdateConditionsUnsafe=machineStateUpdateConditions.schema==="jar2zeus.machine-state-update-conditions.v1"&&(machineStateUpdateConditions.javaMethodsExecuted!==false||machineStateUpdateConditions.controlDependenceRecovered!==false||machineStateUpdateConditions.conditionOperandsRecovered!==false||machineStateUpdateConditions.assignmentValuesRecovered!==false||machineStateUpdateConditions.updateTimingRecovered!==false||machineStateUpdateConditions.sourceRuntimeValuesRecovered!==false||machineStateUpdateConditions.sourceReaderCallbacksGenerated!==0||machineStateUpdateConditions.eventPublicationsWired!==0||machineStateUpdateConditions.liveValuesConnected!==false||machineStateUpdateConditions.arbitraryJavaBlockEntityAccess!==false);
  const machineStateUpdateConditionsShapeInvalid=machineStateUpdateConditions.schema==="jar2zeus.machine-state-update-conditions.v1"&&(!Array.isArray(machineStateUpdateConditions.writers)||!Array.isArray(machineStateUpdateConditions.manualTasks)||!machineStateUpdateConditions.totals||!Number.isFinite(Number(machineStateUpdateConditions.totals.writesSeen)));
  if(machineStateUpdateConditionsMissing)warnings.push("Machine-state update-conditions plan is missing; nearby condition context has not been inspected.");
  if(machineStateUpdateConditionsUnsafe)errors.push("Machine-state update-conditions report incorrectly claims Java execution, proven control dependence, recovered operands/values/timing, runtime connection or generated callbacks.");
  if(machineStateUpdateConditionsShapeInvalid)errors.push("Machine-state update-conditions report has an invalid schema shape.");

  const machineStateControlFlow=input.machineStateControlFlow||{};
  const machineStateControlFlowFileCount=Number(input.machineStateControlFlowFileCount)||0;
  const machineStateControlFlowFilePresent=packageFiles.some(file=>file&&file.path==="machine-state-control-flow-plan.json");
  const machineStateControlFlowRequired=machineStateUpdateConditions.schema==="jar2zeus.machine-state-update-conditions.v1";
  const machineStateControlFlowMissing=machineStateControlFlowRequired&&(machineStateControlFlow.schema!=="jar2zeus.machine-state-control-flow.v1"||machineStateControlFlowFileCount<1||!machineStateControlFlowFilePresent);
  const machineStateControlFlowUnsafe=machineStateControlFlow.schema==="jar2zeus.machine-state-control-flow.v1"&&(machineStateControlFlow.javaMethodsExecuted!==false||machineStateControlFlow.controlDependenceRecovered!==false||machineStateControlFlow.conditionOperandsRecovered!==false||machineStateControlFlow.branchOutcomesRecovered!==false||machineStateControlFlow.assignmentValuesRecovered!==false||machineStateControlFlow.updateTimingRecovered!==false||machineStateControlFlow.sourceRuntimeValuesRecovered!==false||machineStateControlFlow.sourceReaderCallbacksGenerated!==0||machineStateControlFlow.eventPublicationsWired!==0||machineStateControlFlow.liveValuesConnected!==false||machineStateControlFlow.arbitraryJavaBlockEntityAccess!==false);
  const machineStateControlFlowShapeInvalid=machineStateControlFlow.schema==="jar2zeus.machine-state-control-flow.v1"&&(!Array.isArray(machineStateControlFlow.writers)||!Array.isArray(machineStateControlFlow.manualTasks)||!machineStateControlFlow.totals||!Number.isFinite(Number(machineStateControlFlow.totals.writesSeen)));
  if(machineStateControlFlowMissing)warnings.push("Machine-state control-flow plan is missing; structural branch/write relationships have not been reviewed.");
  if(machineStateControlFlowUnsafe)errors.push("Machine-state control-flow report incorrectly claims Java execution, recovered control dependence/conditions/values/timing, runtime connection or generated callbacks.");
  if(machineStateControlFlowShapeInvalid)errors.push("Machine-state control-flow report has an invalid schema shape.");

  const machineStateConditionOperands=input.machineStateConditionOperands||{};
  const machineStateConditionOperandsFileCount=Number(input.machineStateConditionOperandsFileCount)||0;
  const machineStateConditionOperandsFilePresent=packageFiles.some(file=>file&&file.path==="machine-condition-operands-plan.json");
  const machineStateConditionOperandsRequired=machineStateControlFlow.schema==="jar2zeus.machine-state-control-flow.v1";
  const machineStateConditionOperandsMissing=machineStateConditionOperandsRequired&&(machineStateConditionOperands.schema!=="jar2zeus.machine-condition-operands.v1"||machineStateConditionOperandsFileCount<1||!machineStateConditionOperandsFilePresent);
  const machineStateConditionOperandsUnsafe=machineStateConditionOperands.schema==="jar2zeus.machine-condition-operands.v1"&&(machineStateConditionOperands.javaMethodsExecuted!==false||machineStateConditionOperands.comparisonRuntimeValuesRecovered!==false||machineStateConditionOperands.branchOutcomesRecovered!==false||machineStateConditionOperands.assignmentValuesRecovered!==false||machineStateConditionOperands.updateTimingRecovered!==false||machineStateConditionOperands.sourceRuntimeValuesRecovered!==false||machineStateConditionOperands.sourceReaderCallbacksGenerated!==0||machineStateConditionOperands.eventPublicationsWired!==0||machineStateConditionOperands.liveValuesConnected!==false||machineStateConditionOperands.arbitraryJavaBlockEntityAccess!==false);
  const machineStateConditionOperandsShapeInvalid=machineStateConditionOperands.schema==="jar2zeus.machine-condition-operands.v1"&&(!Array.isArray(machineStateConditionOperands.methods)||!Array.isArray(machineStateConditionOperands.manualTasks)||!machineStateConditionOperands.totals||!Number.isFinite(Number(machineStateConditionOperands.totals.branchesSeen))||machineStateConditionOperands.comparisonOperandsRecovered!==true);
  if(machineStateConditionOperandsMissing)warnings.push("Machine condition-operands plan is missing; static branch operand origins have not been traced.");
  if(machineStateConditionOperandsUnsafe)errors.push("Machine condition-operands report incorrectly claims Java execution, runtime values, branch outcomes, assigned values/timing, live telemetry or generated callbacks.");
  if(machineStateConditionOperandsShapeInvalid)errors.push("Machine condition-operands report has an invalid schema shape or does not explicitly identify static operand-origin tracing.");
  const machineStateCrossBlockDataflow=input.machineStateCrossBlockDataflow||{};
  const machineStateCrossBlockDataflowFileCount=Number(input.machineStateCrossBlockDataflowFileCount)||0;
  const machineStateCrossBlockDataflowFilePresent=packageFiles.some(file=>file&&file.path==="machine-state-cross-block-dataflow-plan.json");
  const machineStateCrossBlockDataflowRequired=machineStateConditionOperands.schema==="jar2zeus.machine-condition-operands.v1";
  const machineStateCrossBlockDataflowMissing=machineStateCrossBlockDataflowRequired&&(machineStateCrossBlockDataflow.schema!=="jar2zeus.machine-state-cross-block-dataflow.v1"||machineStateCrossBlockDataflowFileCount<1||!machineStateCrossBlockDataflowFilePresent);
  const machineStateCrossBlockDataflowUnsafe=machineStateCrossBlockDataflow.schema==="jar2zeus.machine-state-cross-block-dataflow.v1"&&(machineStateCrossBlockDataflow.javaMethodsExecuted!==false||machineStateCrossBlockDataflow.runtimeValuesRecovered!==false||machineStateCrossBlockDataflow.comparisonRuntimeValuesRecovered!==false||machineStateCrossBlockDataflow.branchOutcomesRecovered!==false||machineStateCrossBlockDataflow.assignmentValuesRecovered!==false||machineStateCrossBlockDataflow.updateTimingRecovered!==false||machineStateCrossBlockDataflow.sourceRuntimeValuesRecovered!==false||machineStateCrossBlockDataflow.sourceReaderCallbacksGenerated!==0||machineStateCrossBlockDataflow.eventPublicationsWired!==0||machineStateCrossBlockDataflow.liveValuesConnected!==false||machineStateCrossBlockDataflow.arbitraryJavaBlockEntityAccess!==false);
  const machineStateCrossBlockDataflowShapeInvalid=machineStateCrossBlockDataflow.schema==="jar2zeus.machine-state-cross-block-dataflow.v1"&&(!Array.isArray(machineStateCrossBlockDataflow.methods)||!Array.isArray(machineStateCrossBlockDataflow.manualTasks)||!machineStateCrossBlockDataflow.totals||!Number.isFinite(Number(machineStateCrossBlockDataflow.totals.branchesSeen))||machineStateCrossBlockDataflow.crossBlockOriginsRecovered!==true);
  const machineStateCrossBlockDataflowPending=machineStateCrossBlockDataflow.schema==="jar2zeus.machine-state-cross-block-dataflow.v1"?(Number(machineStateCrossBlockDataflow.totals&&machineStateCrossBlockDataflow.totals.branchesSeen)||0):0;
  if(machineStateCrossBlockDataflowMissing)warnings.push("Machine cross-block data-flow plan is missing; predecessor/local/stack merge analysis has not been recorded.");
  if(machineStateCrossBlockDataflowPending>0)warnings.push(machineStateCrossBlockDataflowPending+" cross-block branch data-flow records remain static evidence; predecessor merging does not recover runtime values or branch outcomes.");
  if(machineStateCrossBlockDataflowUnsafe)errors.push("Machine cross-block data-flow report incorrectly claims Java execution, runtime values, branch outcomes, assignment values/timing, live telemetry or generated callbacks.");
  if(machineStateCrossBlockDataflowShapeInvalid)errors.push("Machine cross-block data-flow report has an invalid schema shape or does not explicitly identify static cross-block origin tracing.");
  if(machineStateGetterSemanticsReportMissing)warnings.push("Machine-state getter-semantics plan is missing; getter bodies have not been reviewed for calculations, branches, helper calls or state writes.");
  if(machineStateGetterSemanticsPending>0)warnings.push(machineStateGetterSemanticsPending+" machine-state getter bodies remain static evidence only; no Java code was executed or adapted.");
  if(machineStateGetterSemanticsUnsafeClaim)errors.push("Machine-state getter-semantics report incorrectly claims Java execution, recovered runtime values, connected values, source callbacks, event wiring or arbitrary Java BlockEntity access.");
  if(machineStateGetterSemanticsShapeInvalid)errors.push("Machine-state getter-semantics report has an invalid schema shape.");
  if(machineStateSourceAnalysisReportMissing)warnings.push("Machine-state source-analysis plan is missing; no Java getter candidate has been reviewed for a source-owned adapter.");
  if(machineStateSourceAnalysisPending>0)warnings.push(machineStateSourceAnalysisPending+" machine-state field/getter evidence entries remain static only; Java getters are not callable from Zeus Lua.");
  if(machineStateSourceAnalysisUnsafeClaim)errors.push("Machine-state source analysis incorrectly claims Java execution, connected values, source callbacks, or arbitrary Java BlockEntity access.");
  if(machineStateSourceAnalysisShapeInvalid)errors.push("Machine-state source-analysis report has an invalid schema shape.");

  const incompleteJava=(reimplementation.methodsPending||0)>0||(reimplementation.methodsSkipped||0)>0||configNotWired||typeLayerIncomplete||lifecyclePending>0||eventLifecycle.schema!=="jar2zeus.java-event-lifecycle.v1"||forgeApiPending>0||forgeApiReportMissing||fabricApiPending>0||fabricApiReportMissing||minecraftInternalApiPending>0||minecraftInternalApiReportMissing||blockStatePending>0||blockStateReportMissing||itemInventoryPending>0||itemInventoryReportMissing||blockEntityMachineStatePending>0||blockEntityMachineStateReportMissing||machinePowerSystemsPending>0||machinePowerSystemsReportMissing||transportNetworksPending>0||transportNetworksReportMissing||machineProcessPending>0||machineProcessReportMissing||machineGuiPending>0||machineGuiReportMissing||machineGuiConversionReportMissing||machineGuiStateBridgeReportMissing||machineGuiStateBridgePending>0||machineStateProviderContractInvalid||machineGuiLiveBindingReportMissing||machineGuiLiveBindingUnsafeClaim||machineGuiLiveBindingPending>0||machineStateProviderSdkReportMissing||machineStateProviderSdkUnsafeClaim||machineStateProviderSdkContractInvalid||!providerIdsMatch||machineStateEventProducerReportMissing||machineStateEventProducerUnsafeClaim||machineStateEventProducerContractInvalid||!producerProviderIdsMatch||!producerSourceIdsMatch||machineStateSourceAnalysisReportMissing||machineStateSourceAnalysisPending>0||machineStateSourceAnalysisUnsafeClaim||machineStateSourceAnalysisShapeInvalid||machineStateGetterSemanticsReportMissing||machineStateGetterSemanticsPending>0||machineStateGetterSemanticsUnsafeClaim||machineStateGetterSemanticsShapeInvalid||machineStateWriteTraceReportMissing||machineStateWriteTracePending>0||machineStateWriteTraceUnsafeClaim||machineStateWriteTraceShapeInvalid||machineStateCrossBlockDataflowMissing||machineStateCrossBlockDataflowPending>0||machineStateCrossBlockDataflowUnsafe||machineStateCrossBlockDataflowShapeInvalid;
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
  valid=errors.length===0;
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
