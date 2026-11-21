const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

require(path.join(__dirname, "..", "machine-gui-live-binding.js"));
require(path.join(__dirname, "..", "zeus-api-contract.js"));
require(path.join(__dirname, "..", "package-validator.js"));

const binding = globalThis.Jar2ZeusMachineGuiLiveBinding;
const apiValidator = globalThis.Jar2ZeusApiValidator;
const packageValidator = globalThis.Jar2ZeusPackageValidator;

function sampleStateBridge() {
  return {
    schema: "jar2zeus.machine-gui-state-bridge.v1",
    inferredMachineMetrics: [
      "processing.progress",
      "energy.stored",
      "thermal.temperature",
      "fluid.amount"
    ],
    fieldCandidates: [
      {
        sourceClass: "sample/machine/CrusherBlockEntity",
        sourcePath: "sample/machine/CrusherBlockEntity.class",
        fieldName: "progress",
        metric: "processing.progress"
      },
      {
        sourceClass: "sample/machine/GeneratorBlockEntity",
        sourcePath: "sample/machine/GeneratorBlockEntity.class",
        fieldName: "energyStorage",
        metric: "energy.stored"
      },
      {
        sourceClass: "sample/machine/HeaterBlockEntity",
        sourcePath: "sample/machine/HeaterBlockEntity.class",
        fieldName: "temperature",
        metric: "thermal.temperature"
      },
      {
        sourceClass: "sample/machine/TankBlockEntity",
        sourcePath: "sample/machine/TankBlockEntity.class",
        fieldName: "fluidAmount",
        metric: "fluid.amount"
      }
    ]
  };
}

function sampleGuiConversion() {
  return {
    schema: "jar2zeus.machine-gui-conversion-plan.v1",
    controls: [
      { sourceClass: "sample/machine/CrusherScreen", sourceLabel: "progress" },
      { sourceClass: "sample/machine/GeneratorScreen", sourceLabel: "energy" }
    ]
  };
}

test("maps known machine telemetry candidates to an explicit provider key allow-list", () => {
  const result = binding.convert({
    stateBridge: sampleStateBridge(),
    guiConversion: sampleGuiConversion()
  }, { targetVersion: "26.2" });

  assert.equal(result.report.schema, "jar2zeus.machine-gui-live-binding.v1");
  assert.equal(result.report.target.minecraft, "26.2");
  assert.deepEqual(result.report.metrics, [
    "energy.stored",
    "fluid.amount",
    "processing.progress",
    "thermal.temperature"
  ]);
  assert.equal(result.report.bindings.length, 4);
  assert.equal(result.report.bindings[0].providerKey, "energy");
  assert.equal(result.report.bindings.every(row => row.runtimeConnected === false), true);
  assert.equal(result.report.liveValuesConnected, false);
  assert.equal(result.report.sourceValuesIndependentlyVerified, false);
  assert.equal(result.report.worldWritesPerformed, false);
});

test("generates a paginated read-only screen with automatic and manual refresh", () => {
  const result = binding.convert({
    stateBridge: sampleStateBridge(),
    guiConversion: sampleGuiConversion()
  }, { targetVersion: "26.3" });
  const lua = result.lua;

  for (const fragment of [
    "ui.screen",
    "Machine Telemetry (Read Only)",
    "screen:button",
    "screen_init",
    "world.exists()",
    "world.block",
    "mods.get",
    "read_machine_state",
    "timer.every(POLL_SECONDS, refreshState)",
    "pollTimer:cancel()",
    "onClose = function(s)",
    "on(\"screen_close\"",
    "on(\"world_leave\"",
    "Previous page",
    "Next page",
    "Refresh now",
    "state.x ~= selected.x",
    "state.block_id ~= blockId"
  ]) assert.ok(lua.includes(fragment), "missing generated Lua fragment: " + fragment);

  assert.equal(result.report.polling.intervalSeconds, 0.5);
  assert.equal(result.report.polling.automatic, true);
  assert.equal(result.report.providerMustBeExplicit, true);
  assert.equal(result.report.sourceCallbacksRegistered, 0);
  assert.equal(result.report.uiValueRows, 19);
  assert.equal(result.report.liveValuesConnected, false);
  assert.equal(lua.includes("setBlock("), false);
  assert.equal(lua.includes("setBlockState("), false);
  assert.equal(lua.includes("setInventory("), false);
});

test("generated Lua uses only APIs in the curated Zeus API contract", () => {
  const result = binding.convert({
    stateBridge: sampleStateBridge(),
    guiConversion: sampleGuiConversion()
  }, {});
  const scan = apiValidator.scan(result.lua);

  assert.equal(scan.valid, true);
  assert.deepEqual(scan.unsupportedApis, []);
  assert.ok(scan.requiredApis.includes("ui.screen"));
  assert.ok(scan.requiredApis.includes("ui.open"));
  assert.ok(scan.requiredApis.includes("world.block"));
  assert.ok(scan.requiredApis.includes("mods.get"));
  assert.ok(scan.requiredApis.includes("timer.every"));
  assert.ok(scan.requiredApis.includes("global.on"));

  const guarded = apiValidator.guardLua(result.lua, scan);
  assert.ok(guarded.includes("timer.every"));
  assert.ok(guarded.includes("documented Zeus API v1"));
});

test("does not invent values when the static analysis has no supported metrics", () => {
  const result = binding.convert({
    stateBridge: { schema: "jar2zeus.machine-gui-state-bridge.v1", fieldCandidates: [] },
    guiConversion: { controls: [] }
  }, { targetVersion: "26.3" });

  assert.equal(result.report.status, "no-live-metric-candidates");
  assert.equal(result.report.bindings.length, 0);
  assert.equal(result.report.liveValuesConnected, false);
  assert.equal(result.report.manualTasks[0].status, "no-candidate-values");
  assert.match(result.lua, /Provider MOD ID/);
});

test("bounds binding details and records omitted candidate rows", () => {
  const rows = Array.from({ length: 3200 }, (_, index) => ({
    sourceClass: "sample/machine/TelemetryBlockEntity",
    sourcePath: "sample/machine/TelemetryBlockEntity.class",
    fieldName: "telemetryField" + index,
    metric: "energy.stored"
  }));
  const result = binding.convert({
    stateBridge: { fieldCandidates: rows },
    guiConversion: {}
  }, {});

  assert.equal(result.report.bindings.length, 3000);
  assert.equal(result.report.totals.candidateBindingsOmitted, 200);
  assert.equal(result.report.totals.detailsTruncated, true);
});

function validPackageInput() {
  return {
    metadata: {
      id: "test_mod",
      name: "Test Mod",
      version: "1.0.0",
      main: "main.lua",
      api: 1,
      minecraft: ["26.3"],
      permissions: []
    },
    mainLua: "-- test\n",
    analysis: {
      schema: "jar2zeus.generic-analysis.v1",
      classes: { count: 0 },
      loaders: [],
      unsupportedIndicators: []
    },
    adapterReport: { schema: "jar2zeus.pipeline.v1", adapters: [] },
    apiValidation: { schema: "jar2zeus.zeus-api-validation.v1", valid: true, requiredApis: [] },
    packageFiles: [{ path: "metadata.json", size: 0 }, { path: "main.lua", size: 0 }],
    packageLimits: { files: 2, bytes: 0, maxFiles: 4096, maxBytes: 64 * 1024 * 1024 },
    packageSkipped: [],
    runtimeTested: true,
    gameplayVerified: true,
    targetRuntimeEvidence: { apiPresenceVerified: true, versionVerified: true },
    eventLifecycle: { schema: "jar2zeus.java-event-lifecycle.v1", totals: {} },
    javaTypeCompatibility: { totals: { classesRegistered: 0 }, limitations: [] },
    machineProcessAnalysis: { schema: "jar2zeus.machine-process-analysis.v1", totals: {} },
    machineProcessFileCount: 0,
    machineGuiInteraction: {
      schema: "jar2zeus.machine-gui-interaction.v1",
      totals: {
        guiClasses: 0,
        screenMenuLinks: 0,
        operationsObserved: 0,
        fieldsObserved: 0,
        guiSyncOperationsObserved: 0,
        packetReferenceSites: 0,
        guiResourceFilesSeen: 0,
        guiJsonReadErrors: 0,
        guiJsonInvalid: 0
      }
    },
    machineGuiResourceFileCount: 0,
    machineGuiConversion: {
      schema: "jar2zeus.machine-gui-conversion-plan.v1",
      sourceBehaviorPorted: false,
      executableMachineGui: false
    },
    machineGuiConversionFileCount: 1,
    machineGuiStateBridge: {
      schema: "jar2zeus.machine-gui-state-bridge.v1",
      machineValuesConnected: false,
      runtimeValuesRecovered: false,
      worldWritesPerformed: false,
      providerValuesIndependentlyVerified: false,
      optionalProvider: {
        schema: "jar2zeus.machine-state-provider.v1",
        apiVersion: 1,
        providerValuesIndependentlyVerified: false
      },
      totals: { machineClasses: 0, fieldsObserved: 0, operationCandidates: 0 }
    },
    machineGuiStateBridgeFileCount: 1,
    machineGuiLiveBinding: {
      schema: "jar2zeus.machine-gui-live-binding.v1",
      liveValuesConnected: false,
      sourceValuesIndependentlyVerified: false,
      worldWritesPerformed: false,
      sourceCallbacksRegistered: 0,
      totals: { candidateBindingsReported: 0 }
    },
    machineGuiLiveBindingFileCount: 1,
    reimplementation: {
      schema: "jar2zeus.reimplementation.v1",
      methodsPending: 0,
      methodsSkipped: 0,
      utilityMethodsTranslated: 0
    },
    recipeReport: {},
    definitionReport: {},
    configReport: {}
  };
}

test("package validator requires the live-binding report when it is packaged", () => {
  const input = validPackageInput();
  delete input.machineGuiLiveBinding;
  const result = packageValidator.validate(input);

  assert.equal(result.valid, true);
  assert.equal(result.conversionComplete, false);
  assert.ok(result.warnings.some(message => message.includes("Machine GUI live-binding report is missing")));
});

test("package validator rejects claims that telemetry is connected or independently verified", () => {
  const input = validPackageInput();
  input.machineGuiLiveBinding.liveValuesConnected = true;
  const result = packageValidator.validate(input);

  assert.equal(result.valid, false);
  assert.ok(result.errors.some(message => message.includes("Machine GUI live-binding report incorrectly claims")));
});

test("package validator keeps telemetry mappings pending until a provider source exists", () => {
  const input = validPackageInput();
  input.machineGuiLiveBinding.totals.candidateBindingsReported = 4;
  const result = packageValidator.validate(input);

  assert.equal(result.valid, true);
  assert.equal(result.conversionComplete, false);
  assert.ok(result.warnings.some(message => message.includes("GUI telemetry bindings still require a real companion-provider source")));
});

test("package validator accepts an explicitly disconnected empty binding report", () => {
  const result = packageValidator.validate(validPackageInput());

  assert.equal(result.valid, true);
  assert.equal(result.conversionComplete, true);
  assert.equal(result.runtimeTested, true);
  assert.equal(result.gameplayVerified, true);
});
