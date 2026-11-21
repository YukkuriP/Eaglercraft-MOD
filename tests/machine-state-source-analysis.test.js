const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

require(path.join(__dirname, "..", "machine-state-source-analysis.js"));
require(path.join(__dirname, "..", "machine-state-getter-semantics.js"));
require(path.join(__dirname, "..", "package-validator.js"));
const analyzer = globalThis.Jar2ZeusMachineStateSourceAnalysis;
const validator = globalThis.Jar2ZeusPackageValidator;

const CLASS = "sample/machine/CrusherBlockEntity";
function method(name, descriptor, accessFlags, instructions, valid = true) {
  return {
    name, descriptor, accessFlags,
    code: {
      instructions: instructions || [],
      invocations: [],
      decodeError: null,
      verification: { valid, structuralOnly: true, errors: [] }
    }
  };
}
function fieldRead(name, descriptor, pc = 1) {
  return {
    pc, name: "getfield",
    member: { kind: "field", owner: CLASS, name, descriptor }
  };
}
function input() {
  return {
    stateBridge: {
      machineClasses: [{ className: CLASS }],
      fieldCandidates: [
        { source: "process-field", sourceClass: CLASS, sourcePath: CLASS + ".class", fieldName: "progress", descriptor: "I", metric: "processing.progress" },
        { source: "power-field", sourceClass: CLASS, sourcePath: CLASS + ".class", fieldName: "energyStored", descriptor: "J", metric: "energy.stored" },
        { source: "block-entity-data-field", sourceClass: CLASS, sourcePath: CLASS + ".class", fieldName: "active", descriptor: "Z", metric: "processing.active" },
        { source: "gui-control", sourceClass: CLASS, sourceLabel: "progress", metric: "processing.progress" }
      ]
    },
    classes: [{
      path: CLASS + ".class",
      classInfo: {
        valid: true,
        className: CLASS,
        fields: [
          { name: "progress", descriptor: "I", accessFlags: 2 },
          { name: "energyStored", descriptor: "J", accessFlags: 2 },
          { name: "active", descriptor: "Z", accessFlags: 2 }
        ],
        methods: [
          method("getProgress", "()I", 1, [{ pc: 0, name: "aload_0" }, fieldRead("progress", "I"), { pc: 4, name: "ireturn" }]),
          method("getEnergyStored", "()J", 1, [{ pc: 0, name: "aload_0" }, fieldRead("energyStored", "J"), { pc: 4, name: "lreturn" }]),
          method("isActive", "()Z", 1, [{ pc: 0, name: "aload_0" }, fieldRead("active", "Z"), { pc: 4, name: "ireturn" }]),
          method("getProgress", "(I)I", 1, [{ pc: 0, name: "ireturn" }]),
          method("getPlayer", "()Lnet/minecraft/world/entity/player/Player;", 1, [{ pc: 0, name: "areturn" }]),
          method("getPrivateEnergy", "()J", 2, [{ pc: 0, name: "aload_0" }, fieldRead("energyStored", "J"), { pc: 4, name: "lreturn" }]),
          method("getStaticEnergy", "()J", 9, [{ pc: 0, name: "getstatic" }, { pc: 1, name: "lreturn" }])
        ]
      }
    }]
  };
}

test("maps machine fields to matching no-argument typed getter candidates", () => {
  const report = analyzer.analyze(input());
  assert.equal(report.schema, "jar2zeus.machine-state-source-analysis.v1");
  assert.equal(report.status, "static-getter-evidence-found");
  const names = new Set(report.getterCandidates.map(row => row.methodName));
  assert.ok(names.has("getProgress"));
  assert.ok(names.has("getEnergyStored"));
  assert.ok(names.has("isActive"));
  assert.equal(report.totals.directFieldReadLinks, 4);
  assert.equal(report.sourceReaderCallbacksGenerated, 0);
});

test("rejects parameterized and arbitrary object-returning methods", () => {
  const report = analyzer.analyze(input());
  assert.ok(!report.getterCandidates.some(row => row.methodName === "getPlayer"));
  assert.ok(report.getterCandidates.every(row => row.methodDescriptor.startsWith("()")));
});

test("records inaccessible/static getter candidates for manual review only", () => {
  const report = analyzer.analyze(input());
  const privateRow = report.getterCandidates.find(row => row.methodName === "getPrivateEnergy");
  const staticRow = report.getterCandidates.find(row => row.methodName === "getStaticEnergy");
  assert.ok(privateRow);
  assert.ok(staticRow);
  assert.equal(privateRow.confidence, "low");
  assert.equal(privateRow.requiresManualReview, true);
  assert.equal(staticRow.confidence, "low");
  assert.equal(staticRow.staticMethod, true);
  assert.equal(staticRow.requiresManualReview, true);
});

test("keeps bytecode evidence distinct from actual Java execution and source callbacks", () => {
  const report = analyzer.analyze(input());
  assert.ok(report.getterCandidates.every(row => row.sourceMethodExecutableFromZeusLua === false));
  assert.ok(report.getterCandidates.every(row => row.requiresSourceOwnedAdapter === true));
  assert.equal(report.javaMethodsInvoked, false);
  assert.equal(report.liveValuesConnected, false);
  assert.equal(report.sourceRuntimeValuesRecovered, false);
  assert.equal(report.arbitraryJavaBlockEntityAccess, false);
  assert.equal(report.eventPublicationsWired, 0);
  assert.ok(report.limitations.some(text => text.includes("does not prove the method returns the raw field value")));
});

test("ignores GUI labels and restricted class paths", () => {
  const data = input();
  data.stateBridge.fieldCandidates = [
    { source: "gui-control", sourceClass: CLASS, sourceLabel: "energy", metric: "energy.stored" }
  ];
  data.classes.push({
    path: "sample/restricted/DeviceController.class",
    classInfo: {
      valid: true,
      className: "sample/restricted/DeviceController",
      fields: [{ name: "energy", descriptor: "J" }],
      methods: [method("getEnergy", "()J", 1, [{ pc: 0, name: "lreturn" }])]
    }
  });
  const report = analyzer.analyze(data);
  assert.equal(report.fieldCandidates.length, 0);
  assert.equal(report.getterCandidates.length, 0);
  assert.equal(report.totals.metricsWithoutGetterEvidence, 0);
});

test("bounds very large field evidence and marks truncation", () => {
  const data = input();
  data.stateBridge.fieldCandidates = Array.from({ length: 3200 }, (_, i) => ({
    source: "power-field",
    sourceClass: CLASS,
    fieldName: "energyStored" + i,
    descriptor: "J",
    metric: "energy.stored"
  }));
  const report = analyzer.analyze(data, { detailLimit: 10 });
  assert.equal(report.fieldCandidates.length, 10);
  assert.equal(report.getterCandidates.length, 3);
  assert.equal(report.totals.fieldCandidatesReported, 3000);
  assert.equal(report.totals.detailsTruncated, true);
});


function packageInput() {
  const packageFiles = [
    "metadata.json", "main.lua", "machine-gui-state-bridge-plan.json",
    "machine-gui-live-binding-plan.json", "machine-state-provider-sdk-plan.json",
    "machine-state-event-producer-plan.json", "machine-state-source-analysis-plan.json", "machine-state-getter-semantics-plan.json"
  ].map(path => ({ path, size: 0 }));
  return {
    metadata: { id: "sample_mod", name: "Sample Mod", version: "1.0.0", main: "main.lua", api: 1, minecraft: ["26.3"], permissions: [] },
    mainLua: "-- sample\nexports.publish_machine_state = publishMachineState",
    analysis: { schema: "jar2zeus.generic-analysis.v1", classes: { count: 0 }, loaders: [], unsupportedIndicators: [] },
    adapterReport: { schema: "jar2zeus.pipeline.v1", adapters: [] },
    apiValidation: { schema: "jar2zeus.zeus-api-validation.v1", valid: true, requiredApis: ["mods.get", "events.emit"] },
    packageFiles,
    packageLimits: { files: packageFiles.length, bytes: 0, maxFiles: 4096, maxBytes: 64 * 1024 * 1024 },
    packageSkipped: [],
    runtimeTested: true,
    gameplayVerified: true,
    targetRuntimeEvidence: { apiPresenceVerified: true, versionVerified: true },
    eventLifecycle: { schema: "jar2zeus.java-event-lifecycle.v1", totals: {} },
    javaTypeCompatibility: { totals: { classesRegistered: 0 }, limitations: [] },
    machineProcessAnalysis: { schema: "jar2zeus.machine-process-analysis.v1", totals: {} },
    machineProcessFileCount: 0,
    machineGuiInteraction: { schema: "jar2zeus.machine-gui-interaction.v1", totals: { guiClasses: 0 } },
    machineGuiResourceFileCount: 0,
    machineGuiConversion: { schema: "jar2zeus.machine-gui-conversion-plan.v1", sourceBehaviorPorted: false, executableMachineGui: false },
    machineGuiConversionFileCount: 1,
    machineGuiStateBridge: {
      schema: "jar2zeus.machine-gui-state-bridge.v1", machineValuesConnected: false,
      runtimeValuesRecovered: false, worldWritesPerformed: false,
      providerValuesIndependentlyVerified: false,
      optionalProvider: { schema: "jar2zeus.machine-state-provider.v1", apiVersion: 1, providerValuesIndependentlyVerified: false },
      totals: { machineClasses: 0, fieldsObserved: 0, operationCandidates: 0 }
    },
    machineGuiStateBridgeFileCount: 1,
    machineGuiLiveBinding: {
      schema: "jar2zeus.machine-gui-live-binding.v1", liveValuesConnected: false,
      sourceValuesIndependentlyVerified: false, worldWritesPerformed: false,
      sourceCallbacksRegistered: 0,
      providerContract: { providerModId: "sample_mod_state_provider" },
      totals: { candidateBindingsReported: 0 }
    },
    machineGuiLiveBindingFileCount: 1,
    machineStateProviderSdk: {
      schema: "jar2zeus.machine-state-provider-sdk.v1",
      provider: { id: "sample_mod_state_provider", sourceModId: "sample_mod" },
      contract: { schema: "jar2zeus.machine-state-provider.v1", apiVersion: 1, eventSchema: "jar2zeus.machine-state-event.v1", exportName: "read_machine_state" },
      readerRegistrationsGenerated: 0, eventReaderRegistrationsGenerated: 0,
      realSourceReadersRegistered: false, valuesConnected: false,
      sourceValuesIndependentlyVerified: false, arbitraryJavaBlockEntityAccess: false
    },
    machineStateProviderSdkFileCount: 1,
    machineStateEventProducer: {
      schema: "jar2zeus.machine-state-event-producer-sdk.v1",
      status: "explicit-publisher-helper-generated",
      provider: { id: "sample_mod_state_provider", eventName: "sample_mod_state_provider:machine_state_update" },
      producer: { sourceModId: "sample_mod" },
      contract: {
        schema: "jar2zeus.machine-state-event.v1", apiVersion: 1,
        eventName: "sample_mod_state_provider:machine_state_update",
        providerSchema: "jar2zeus.machine-state-provider.v1", providerApiVersion: 1
      },
      publisherFunction: "mod.export.publish_machine_state",
      publisherHelperGenerated: true, sourceReaderCallbacksGenerated: 0,
      eventPublicationsWired: 0, automaticPublication: false,
      realStateCallbacksRegistered: false, valuesConnected: false,
      sourceValuesIndependentlyVerified: false, sourceRuntimeValuesRecovered: false,
      arbitraryJavaBlockEntityAccess: false,
      totals: { sourceReaderCallbacksGenerated: 0, eventPublicationsWired: 0, valuesConnected: 0 }
    },
    machineStateEventProducerFileCount: 1,
    machineStateSourceAnalysis: {
      schema: "jar2zeus.machine-state-source-analysis.v1",
      fieldCandidates: [{ sourceClass: "sample/machine/Crusher", fieldName: "progress", metric: "processing.progress", providerKey: "progress" }],
      getterCandidates: [{ sourceClass: "sample/machine/Crusher", methodName: "getProgress", methodDescriptor: "()I", sourceMethodExecutableFromZeusLua: false }],
      metricSummary: [{ metric: "processing.progress", getterCandidates: 1 }],
      totals: { fieldCandidatesSeen: 1, fieldCandidatesReported: 1, getterCandidatesObserved: 1, getterCandidatesReported: 1, structurallyVerifiedGetterCandidates: 1 },
      sourceReaderCallbacksGenerated: 0, eventPublicationsWired: 0,
      javaMethodsInvoked: false, liveValuesConnected: false,
      sourceRuntimeValuesRecovered: false, arbitraryJavaBlockEntityAccess: false
    },
    machineStateSourceAnalysisFileCount: 1,
    machineStateGetterSemantics: {
      schema: "jar2zeus.machine-state-getter-semantics.v1",
      getterAnalyses: [{ classification: "direct-field-return", javaMethodExecuted: false }],
      classificationSummary: [{ classification: "direct-field-return", count: 1 }],
      totals: { getterCandidatesSeen: 1, getterAnalysesReported: 1 },
      javaMethodsExecuted: false, sourceRuntimeValuesRecovered: false,
      sourceReaderCallbacksGenerated: 0, eventPublicationsWired: 0,
      liveValuesConnected: false, arbitraryJavaBlockEntityAccess: false
    },
    machineStateGetterSemanticsFileCount: 1,
    reimplementation: { schema: "jar2zeus.reimplementation.v1", methodsPending: 0, methodsSkipped: 0, utilityMethodsTranslated: 0 },
    recipeReport: {}, definitionReport: {}, configReport: {}
  };
}

test("metric mapping counts remain accurate when getter details are truncated", () => {
  const data = input();
  const info = data.classes[0].classInfo;
  info.methods = [
    method("getProgress", "()I", 1, [{ pc: 0, name: "aload_0" }, fieldRead("progress", "I"), { pc: 4, name: "ireturn" }]),
    method("getProgressValue", "()I", 1, [{ pc: 0, name: "aload_0" }, fieldRead("progress", "I"), { pc: 4, name: "ireturn" }]),
    method("getProgressAmount", "()I", 1, [{ pc: 0, name: "aload_0" }, fieldRead("progress", "I"), { pc: 4, name: "ireturn" }])
  ];
  const report = analyzer.analyze(data, { detailLimit: 1 });
  const progress = report.metricSummary.find(row => row.metric === "processing.progress");
  assert.equal(report.getterCandidates.length, 1);
  assert.equal(report.totals.getterCandidatesObserved, 3);
  assert.equal(progress.getterCandidates, 3);
  assert.equal(progress.mappedToGetter, true);
  assert.equal(report.metricsWithoutGetterEvidence.includes("processing.progress"), false);
});

test("validator accepts the static getter map but keeps live conversion incomplete", () => {
  const result = validator.validate(packageInput());
  assert.equal(result.valid, true);
  assert.equal(result.conversionComplete, false);
  assert.ok(result.warnings.some(text => text.includes("Java getters are not callable from Zeus Lua")));
});

test("validator rejects any claim that static source analysis invoked or connected Java state", () => {
  const input = packageInput();
  input.machineStateSourceAnalysis.javaMethodsInvoked = true;
  const result = validator.validate(input);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(text => text.includes("Machine-state source analysis incorrectly claims")));
});

test("validator reports a missing source-analysis plan instead of treating it as complete", () => {
  const input = packageInput();
  input.machineStateSourceAnalysis = {};
  const result = validator.validate(input);
  assert.equal(result.valid, true);
  assert.equal(result.conversionComplete, false);
  assert.ok(result.warnings.some(text => text.includes("Machine-state source-analysis plan is missing")));
});

test("validator accepts static getter-body evidence but keeps conversion incomplete", () => {
  const input = packageInput();
  const result = validator.validate(input);
  assert.equal(result.valid, true);
  assert.equal(result.conversionComplete, false);
  assert.ok(result.warnings.some(text => text.includes("getter bodies remain static evidence only")));
});

test("validator rejects claims that getter semantics executed Java or recovered runtime values", () => {
  const input = packageInput();
  input.machineStateGetterSemantics.javaMethodsExecuted = true;
  const result = validator.validate(input);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(text => text.includes("getter-semantics report incorrectly claims")));
});

test("validator flags a missing getter-semantics plan when Phase 25 candidates exist", () => {
  const input = packageInput();
  input.machineStateGetterSemantics = {};
  input.machineStateGetterSemanticsFileCount = 0;
  input.packageFiles = input.packageFiles.filter(file => file.path !== "machine-state-getter-semantics-plan.json");
  input.packageLimits.files = input.packageFiles.length;
  const result = validator.validate(input);
  assert.equal(result.valid, true);
  assert.equal(result.conversionComplete, false);
  assert.ok(result.warnings.some(text => text.includes("getter-semantics plan is missing")));
});
