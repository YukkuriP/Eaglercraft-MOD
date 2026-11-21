const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

require(path.join(__dirname, "..", "machine-state-provider-sdk.js"));
require(path.join(__dirname, "..", "zeus-api-contract.js"));
const sdk = globalThis.Jar2ZeusMachineStateProviderSdk;
const apiValidator = globalThis.Jar2ZeusApiValidator;

function inputReports() {
  return {
    stateBridge: {
      schema: "jar2zeus.machine-gui-state-bridge.v1",
      fieldCandidates: [
        { sourceClass: "sample/machine/CrusherBlockEntity", sourcePath: "sample/machine/CrusherBlockEntity.class", fieldName: "progress", metric: "processing.progress" },
        { sourceClass: "sample/machine/CrusherBlockEntity", sourcePath: "sample/machine/CrusherBlockEntity.class", fieldName: "maxProgress", metric: "processing.progress_max" },
        { sourceClass: "sample/machine/GeneratorBlockEntity", sourcePath: "sample/machine/GeneratorBlockEntity.class", fieldName: "energyStored", metric: "energy.stored" },
        { sourceClass: "sample/machine/TankBlockEntity", sourcePath: "sample/machine/TankBlockEntity.class", fieldName: "fluidAmount", metric: "fluid.amount" }
      ]
    },
    liveBinding: {
      schema: "jar2zeus.machine-gui-live-binding.v1",
      bindings: [
        { sourceClass: "sample/machine/HeaterBlockEntity", sourceField: "temperature", providerKey: "temperature" },
        { sourceClass: "sample/machine/GeneratorBlockEntity", sourceField: "maxEnergy", providerKey: "energy_max" }
      ]
    }
  };
}

test("generates a versioned provider contract for the matching Zeus target", () => {
  const result = sdk.convert(inputReports(), {
    targetVersion: "26.2",
    providerId: "test_mod_state_provider",
    sourceModId: "test_mod",
    providerName: "Test Mod State Provider"
  });

  assert.equal(result.report.schema, "jar2zeus.machine-state-provider-sdk.v1");
  assert.equal(result.report.target.minecraft, "26.2");
  assert.equal(result.report.provider.id, "test_mod_state_provider");
  assert.equal(result.report.provider.sourceModId, "test_mod");
  assert.equal(result.report.contract.schema, "jar2zeus.machine-state-provider.v1");
  assert.equal(result.report.contract.apiVersion, 1);
  assert.equal(result.report.contract.eventSchema, "jar2zeus.machine-state-event.v1");
  assert.equal(result.report.contract.exportName, "read_machine_state");
});

test("groups Phase 20 and Phase 22 field hints into provider metric keys", () => {
  const result = sdk.convert(inputReports(), { providerId: "test_mod_state_provider" });
  const byClass = new Map(result.report.sourceCandidates.map(row => [row.className, row.metricKeys]));

  assert.deepEqual(byClass.get("sample/machine/CrusherBlockEntity"), ["progress", "progress_max"]);
  assert.deepEqual(byClass.get("sample/machine/GeneratorBlockEntity"), ["energy", "energy_max"]);
  assert.deepEqual(byClass.get("sample/machine/TankBlockEntity"), ["fluid_amount"]);
  assert.deepEqual(byClass.get("sample/machine/HeaterBlockEntity"), ["temperature"]);
  assert.deepEqual(result.report.suggestedMetricKeys, [
    "energy", "energy_max", "fluid_amount", "progress", "progress_max", "temperature"
  ]);
});

test("does not generate or claim any real source readers", () => {
  const result = sdk.convert(inputReports(), { providerId: "test_mod_state_provider" });

  assert.equal(result.report.readerRegistrationsGenerated, 0);
  assert.equal(result.report.eventReaderRegistrationsGenerated, 0);
  assert.equal(result.report.totals.realSourceReadersRegistered, 0);
  assert.equal(result.report.realSourceReadersRegistered, false);
  assert.equal(result.report.valuesConnected, false);
  assert.equal(result.report.sourceValuesIndependentlyVerified, false);
  assert.equal(result.report.arbitraryJavaBlockEntityAccess, false);
  assert.match(result.lua, /Empty by default: no block readers or event readers are registered/);
});

test("creates a companion-provider Lua template with the same ID the consumer can use", () => {
  const result = sdk.convert(inputReports(), { providerId: "test_mod_state_provider" });

  assert.match(result.lua, /^-- name: Test Mod State Provider/m);
  assert.match(result.lua, /^-- id: test_mod_state_provider/m);
  assert.match(result.lua, /mod\.export = \{/);
  assert.match(result.lua, /schema = PROVIDER_SCHEMA/);
  assert.match(result.lua, /api_version = PROVIDER_API_VERSION/);
  assert.match(result.lua, /event_name = EVENT_NAME/);
  assert.match(result.lua, /read_machine_state = readMachineState/);
  assert.equal(result.report.packageFileName, "test_mod_state_provider-template.zip");
});

test("supports callback readers and validates every returned value", () => {
  const result = sdk.convert(inputReports(), { providerId: "test_mod_state_provider" });
  for (const fragment of [
    "registerMachineReader(blockId, declaredKeys, reader)",
    "pcall(reader.reader, x, y, z, blockId)",
    "copyDeclaredValues(sourceValues, reader.allowed)",
    "KEY_TYPES[key] == nil",
    "value ~= value",
    "value == math.huge",
    "value == -math.huge",
    "math.abs(value) > 1000000000000",
    "type(value) ~= \"boolean\"",
    "type(value) ~= \"string\""
  ]) assert.ok(result.lua.includes(fragment), "missing callback validation: " + fragment);
});

test("supports explicit event readers using the documented MOD event bus", () => {
  const result = sdk.convert(inputReports(), { providerId: "test_mod_state_provider" });

  assert.match(result.lua, /registerEventReader\(blockId, declaredKeys\)/);
  assert.match(result.lua, /on\(EVENT_NAME, function\(payload\)/);
  assert.match(result.lua, /payload\.schema ~= EVENT_SCHEMA/);
  assert.match(result.lua, /payload\.api_version ~= 1/);
  assert.match(result.lua, /payload\.block_id/);
  assert.match(result.lua, /cachedStates\[key\] = \{ values = values, updated_at = timer\.time\(\) \}/);
  assert.match(result.lua, /CACHE_SECONDS = 3\.0/);
  assert.match(result.lua, /MAX_CACHED_STATES = 128/);
  assert.match(result.lua, /events\.emit/);
  assert.match(result.lua, /mods\.get\("test_mod_state_provider"\)/);
});

test("returns nil for unregistered blocks, stale events and failed source callbacks", () => {
  const result = sdk.convert(inputReports(), {});
  assert.match(result.lua, /if reader == nil then return nil end/);
  assert.match(result.lua, /if not ok then return nil end/);
  assert.match(result.lua, /timer\.time\(\) - cached\.updated_at > CACHE_SECONDS then return nil/);
  assert.match(result.lua, /if values == nil then return nil end/);
});

test("bounds reader count, keys per reader, cache size and coordinate range", () => {
  const result = sdk.convert(inputReports(), {});
  assert.match(result.lua, /MAX_READERS = 128/);
  assert.match(result.lua, /MAX_CACHED_STATES = 128/);
  assert.match(result.lua, /if count > 19 then return nil end/);
  assert.match(result.lua, /MAX_COORDINATE = 30000000/);
  assert.match(result.lua, /reader registration limit reached/);
});

test("validates exact namespaced block IDs and source MOD IDs", () => {
  const result = sdk.convert(inputReports(), {});
  assert.match(result.lua, /local namespace, path = string\.match/);
  assert.match(result.lua, /segment == "\." or segment == "\.\."/);
  assert.match(result.lua, /local function validSourceId\(value\)/);
  assert.match(result.lua, /not validSourceId\(payload\.source_id\)/);
  assert.equal(sdk.validProviderId("test_mod"), true);
  assert.equal(sdk.validProviderId("provider-01"), true);
  assert.equal(sdk.validProviderId(".hidden"), false);
  assert.equal(sdk.validProviderId("invalid_"), false);
  assert.equal(sdk.validProviderId("has space"), false);
});

test("does not expose the mutable reader registry to other mods", () => {
  const result = sdk.convert(inputReports(), {});
  assert.match(result.lua, /local readers = \{\}/);
  assert.match(result.lua, /local function registerMachineReader/);
  assert.match(result.lua, /local function registerEventReader/);
  assert.doesNotMatch(result.lua, /mod\.export\.registerMachineReader/);
  assert.doesNotMatch(result.lua, /mod\.export\.readers/);
});

test("generated provider uses only documented Zeus API calls", () => {
  const result = sdk.convert(inputReports(), { providerId: "test_mod_state_provider" });
  const scan = apiValidator.scan(result.lua);

  assert.equal(scan.valid, true);
  assert.deepEqual(scan.unsupportedApis, []);
  assert.ok(scan.requiredApis.includes("global.on"));
  assert.ok(scan.requiredApis.includes("timer.time"));
  assert.ok(scan.requiredApis.includes("mod.log"));
});

test("filters restricted or malformed class candidates", () => {
  const result = sdk.convert({
    stateBridge: {
      fieldCandidates: [
        { sourceClass: "sample/machine/GoodBlockEntity", fieldName: "progress", metric: "processing.progress" },
        { sourceClass: "sample/weapon/RestrictedBlockEntity", fieldName: "progress", metric: "processing.progress" },
        { sourceClass: "sample/machine/BadBlockEntity", fieldName: "mystery", metric: "unknown.metric" }
      ]
    },
    liveBinding: { bindings: [] }
  }, {});

  assert.equal(result.report.sourceCandidates.length, 1);
  assert.equal(result.report.sourceCandidates[0].className, "sample/machine/GoodBlockEntity");
});

test("bounds source-class evidence and reports truncation", () => {
  const rows = Array.from({ length: 1100 }, (_, index) => ({
    sourceClass: "sample/machine/BlockEntity" + index,
    fieldName: "progress",
    metric: "processing.progress"
  }));
  const result = sdk.convert({ stateBridge: { fieldCandidates: rows }, liveBinding: {} }, {});

  assert.equal(result.report.sourceCandidates.length, 1000);
  assert.equal(result.report.totals.detailsTruncated, true);
});

test("keeps the event source as self-asserted and does not claim authentication", () => {
  const result = sdk.convert(inputReports(), {});
  assert.ok(result.report.limitations.some(text => text.includes("not authentication")));
  assert.ok(result.report.limitations.some(text => text.includes("source_id is self-asserted")));
  assert.equal(result.report.sourceValuesIndependentlyVerified, false);
});

test("exposes clear manual tasks for exact block IDs and a real source adapter", () => {
  const result = sdk.convert(inputReports(), {});
  assert.ok(result.report.manualTasks.some(row => row.area === "exact-block-id"));
  assert.ok(result.report.manualTasks.some(row => row.area === "source-reader"));
  assert.ok(result.report.manualTasks.some(row => row.area === "producer-integration"));
});
