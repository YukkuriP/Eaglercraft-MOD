const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

require(path.join(__dirname, "..", "machine-gui-state-bridge.js"));
require(path.join(__dirname, "..", "package-validator.js"));
const bridge = globalThis.Jar2ZeusMachineGuiStateBridge;
const validator = globalThis.Jar2ZeusPackageValidator;

function sampleInputs() {
  return {
    guiConversion: {
      controls: [
        { sourceClass: "sample/machine/CrusherScreen", sourceLabel: "progress", sourcePath: "sample/machine/CrusherScreen.class" },
        { sourceClass: "sample/machine/GeneratorScreen", sourceLabel: "energyStored", sourcePath: "sample/machine/GeneratorScreen.class" }
      ]
    },
    blockEntityMachineState: {
      blockEntities: [{ className: "sample/machine/CrusherBlockEntity", machineLike: true }],
      dataFields: [
        { sourceClass: "sample/machine/CrusherBlockEntity", sourcePath: "sample/machine/CrusherBlockEntity.class", name: "progress", descriptor: "I" },
        { sourceClass: "sample/machine/CrusherBlockEntity", sourcePath: "sample/machine/CrusherBlockEntity.class", name: "temperature", descriptor: "D" },
        { sourceClass: "sample/machine/CrusherBlockEntity", sourcePath: "sample/machine/CrusherBlockEntity.class", name: "fluidAmount", descriptor: "I" }
      ],
      operations: [{ sourceClass: "sample/machine/CrusherBlockEntity", name: "getUpdateTag", operationCandidate: "block_entity_update_tag_write" }],
      lifecycleMethods: [{ sourceClass: "sample/machine/CrusherBlockEntity", name: "tick" }]
    },
    machinePowerSystems: {
      systems: [{ className: "sample/machine/GeneratorBlockEntity" }],
      fields: [
        { sourceClass: "sample/machine/GeneratorBlockEntity", sourcePath: "sample/machine/GeneratorBlockEntity.class", name: "energyStored", descriptor: "I" },
        { sourceClass: "sample/machine/GeneratorBlockEntity", sourcePath: "sample/machine/GeneratorBlockEntity.class", name: "maxEnergy", descriptor: "I" }
      ],
      operations: [{ sourceClass: "sample/machine/GeneratorBlockEntity", name: "getEnergyStored", operationCandidate: "energy_read_stored" }]
    },
    machineProcessAnalysis: {
      machineClasses: [{ className: "sample/machine/CrusherMachine" }],
      fields: [
        { sourceClass: "sample/machine/CrusherMachine", sourcePath: "sample/machine/CrusherMachine.class", name: "maxProgress", category: "duration", descriptor: "I" },
        { sourceClass: "sample/machine/CrusherMachine", sourcePath: "sample/machine/CrusherMachine.class", name: "burnTime", category: "fuel", descriptor: "I" }
      ],
      operations: [{ sourceClass: "sample/machine/CrusherMachine", sourceMethod: "getProgress", operationCandidate: "machine_progress_read" }]
    }
  };
}

test("maps static field hints to machine GUI telemetry categories", () => {
  const result = bridge.convert(sampleInputs(), { targetVersion: "26.2" });
  const metrics = new Set(result.report.fieldCandidates.map(row => row.metric));
  assert.ok(metrics.has("processing.progress"));
  assert.ok(metrics.has("processing.progress_max"));
  assert.ok(metrics.has("energy.stored"));
  assert.ok(metrics.has("energy.capacity"));
  assert.ok(metrics.has("thermal.temperature"));
  assert.ok(metrics.has("fluid.amount"));
  assert.ok(metrics.has("fuel.remaining"));
  assert.equal(result.report.target.minecraft, "26.2");
  assert.equal(result.report.machineClasses.length, 3);
  assert.ok(result.report.operationCandidates.length >= 3);
});

test("never claims Java runtime values are recovered or connected", () => {
  const result = bridge.convert(sampleInputs(), {});
  assert.equal(result.report.machineValuesConnected, false);
  assert.equal(result.report.runtimeValuesRecovered, false);
  assert.equal(result.report.worldWritesPerformed, false);
  assert.ok(result.report.fieldCandidates.every(row => row.valueRecovered === false && row.runtimeBinding === "not-connected"));
  assert.ok(result.report.metricsRequiringProvider.includes("energy.stored"));
});

test("uses only documented read APIs and an optional explicit provider", () => {
  const result = bridge.convert(sampleInputs(), {});
  const lua = result.scaffoldLua;
  assert.ok(result.report.coreApiReads.some(row => row.api === "world.block(x, y, z)"));
  assert.ok(lua.includes("world.exists()"));
  assert.ok(lua.includes("pcall(world.block"));
  assert.ok(lua.includes("mods.get(machineStateProbe.providerId)"));
  assert.ok(lua.includes("provider.read_machine_state"));
  assert.ok(lua.includes("formatProviderState"));
  assert.ok(lua.includes("never writes blocks"));
  assert.ok(!lua.includes("setBlock("));
  assert.ok(!lua.includes("getBlockEntity("));
  assert.ok(!lua.includes("getBlockState("));
});

test("generates a versioned machine-state provider contract with strict envelope checks", () => {
  const result = bridge.convert(sampleInputs(), { targetVersion: "26.3" });
  const contract = result.report.optionalProvider;
  assert.equal(contract.schema, "jar2zeus.machine-state-provider.v1");
  assert.equal(contract.apiVersion, 1);
  assert.equal(contract.providerValuesIndependentlyVerified, false);
  assert.deepEqual(contract.envelopeFields, ["schema", "api_version", "provider_id", "x", "y", "z", "block_id", "values"]);
  const lua = result.scaffoldLua;
  for (const fragment of [
    "provider.schema ~= PROVIDER_SCHEMA",
    "provider.api_version ~= PROVIDER_API_VERSION",
    "state.schema ~= PROVIDER_SCHEMA",
    "state.provider_id ~= providerId",
    "state.x ~= x or state.y ~= y or state.z ~= z",
    "state.block_id ~= blockId",
    "type(state.values) ~= \"table\"",
    "value ~= value or value == math.huge",
    "type(value) ~= \"boolean\"",
    "type(value) ~= \"string\"",
    "table.concat(lines, string.char(10))",
    "^[a-z0-9_.-]+$"
  ]) assert.ok(lua.includes(fragment), "missing provider check: " + fragment);
  assert.ok(!lua.includes("setBlock("));
  assert.ok(!lua.includes("setBlockState("));
});

test("exports a companion provider starter without inventing machine readings", () => {
  const result = bridge.convert(sampleInputs(), {});
  const template = result.providerTemplateLua;
  assert.ok(template.includes("local values = {}"));
  assert.ok(template.includes("schema = PROVIDER_SCHEMA"));
  assert.ok(template.includes("api_version = 1"));
  assert.ok(template.includes("provider_id = mod.id"));
  assert.ok(template.includes("mod.export.read_machine_state = readMachineState"));
  assert.ok(template.includes("does not prove their origin"));
  assert.equal(result.report.providerTemplateFile, "diagnostics/machine-state-provider-template.lua");
  assert.equal(result.report.providerValuesIndependentlyVerified, false);
});

test("bounds the reported fields and machine classes", () => {
  const input = {
    blockEntityMachineState: {
      blockEntities: Array.from({ length: 1100 }, (_, i) => ({ className: "sample/machine/Entity" + i, machineLike: true })),
      dataFields: Array.from({ length: 3200 }, (_, i) => ({ sourceClass: "sample/machine/Entity" + i, name: "energyStored" + i, descriptor: "I" }))
    }
  };
  const result = bridge.convert(input, {});
  assert.equal(result.report.machineClasses.length, 1000);
  assert.equal(result.report.fieldCandidates.length, 3000);
  assert.equal(result.report.totals.fieldCandidatesOmitted, 200);
  assert.equal(result.report.totals.detailsTruncated, true);
});

function validatorInput() {
  return {
    metadata: { id: "test_mod", name: "Test Mod", version: "1.0.0", main: "main.lua", api: 1, minecraft: ["26.3"], permissions: [] },
    mainLua: "-- test\n",
    analysis: { schema: "jar2zeus.generic-analysis.v1", classes: { count: 0 }, loaders: [], unsupportedIndicators: [] },
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
    machineGuiInteraction: { schema: "jar2zeus.machine-gui-interaction.v1", totals: { guiClasses: 0 } },
    machineGuiResourceFileCount: 0,
    machineGuiConversion: { schema: "jar2zeus.machine-gui-conversion-plan.v1", sourceBehaviorPorted: false, executableMachineGui: false },
    machineGuiConversionFileCount: 1,
    reimplementation: { schema: "jar2zeus.reimplementation.v1", methodsPending: 0, methodsSkipped: 0, utilityMethodsTranslated: 0 },
    recipeReport: {},
    definitionReport: {},
    configReport: {}
  };
}

test("validator requires the state bridge plan before complete conversion", () => {
  const input = validatorInput();
  input.machineGuiStateBridgeFileCount = 1;
  const result = validator.validate(input);
  assert.equal(result.valid, true);
  assert.equal(result.conversionComplete, false);
  assert.ok(result.warnings.some(w => w.includes("Machine GUI state bridge plan is missing")));
});

test("validator accepts explicit read-only and unconnected state bridge status", () => {
  const input = validatorInput();
  input.machineGuiStateBridgeFileCount = 1;
  input.machineGuiStateBridge = {
    schema: "jar2zeus.machine-gui-state-bridge.v1",
    machineValuesConnected: false,
    runtimeValuesRecovered: false,
    worldWritesPerformed: false,
    providerValuesIndependentlyVerified: false,
    optionalProvider: { schema: "jar2zeus.machine-state-provider.v1", apiVersion: 1, providerValuesIndependentlyVerified: false },
    totals: { machineClasses: 0, fieldsObserved: 0, operationCandidates: 0 }
  };
  const result = validator.validate(input);
  assert.equal(result.valid, true);
  assert.equal(result.conversionComplete, true);
});

test("validator keeps observed machine telemetry candidates incomplete", () => {
  const input = validatorInput();
  input.machineGuiStateBridgeFileCount = 1;
  input.machineGuiStateBridge = {
    schema: "jar2zeus.machine-gui-state-bridge.v1",
    machineValuesConnected: false,
    runtimeValuesRecovered: false,
    worldWritesPerformed: false,
    providerValuesIndependentlyVerified: false,
    optionalProvider: { schema: "jar2zeus.machine-state-provider.v1", apiVersion: 1, providerValuesIndependentlyVerified: false },
    totals: { machineClasses: 1, fieldsObserved: 2, operationCandidates: 1 }
  };
  const result = validator.validate(input);
  assert.equal(result.valid, true);
  assert.equal(result.conversionComplete, false);
  assert.ok(result.warnings.some(w => w.includes("machine-state evidence candidates remain disconnected")));
});

test("validator rejects claims that machine values are already connected or recovered", () => {
  const input = validatorInput();
  input.machineGuiStateBridgeFileCount = 1;
  input.machineGuiStateBridge = {
    schema: "jar2zeus.machine-gui-state-bridge.v1",
    machineValuesConnected: true,
    runtimeValuesRecovered: true,
    worldWritesPerformed: false,
    totals: {}
  };
  const result = validator.validate(input);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes("Machine GUI state bridge incorrectly claims")));
});
