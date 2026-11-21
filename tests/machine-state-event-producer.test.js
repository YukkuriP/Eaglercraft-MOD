const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

require(path.join(__dirname, "..", "machine-state-event-producer.js"));
require(path.join(__dirname, "..", "zeus-api-contract.js"));
const sdk = globalThis.Jar2ZeusMachineStateEventProducer;
const apiValidator = globalThis.Jar2ZeusApiValidator;

function providerReport(overrides) {
  return Object.assign({
    schema: "jar2zeus.machine-state-provider-sdk.v1",
    provider: { id: "sample_mod_state_provider", sourceModId: "sample_mod" },
    contract: {
      schema: "jar2zeus.machine-state-provider.v1",
      apiVersion: 1,
      eventSchema: "jar2zeus.machine-state-event.v1",
      eventName: "sample_mod_state_provider:machine_state_update",
      exportName: "read_machine_state"
    }
  }, overrides || {});
}

test("generates a producer helper matched to the Phase 23 provider contract", () => {
  const result = sdk.convert({ providerSdk: providerReport() }, {
    targetVersion: "26.2",
    providerId: "sample_mod_state_provider",
    sourceModId: "sample_mod"
  });
  assert.equal(result.report.schema, "jar2zeus.machine-state-event-producer-sdk.v1");
  assert.equal(result.report.status, "explicit-publisher-helper-generated");
  assert.equal(result.report.target.minecraft, "26.2");
  assert.equal(result.report.provider.id, "sample_mod_state_provider");
  assert.equal(result.report.producer.sourceModId, "sample_mod");
  assert.equal(result.report.contract.schema, "jar2zeus.machine-state-event.v1");
  assert.equal(result.report.contract.apiVersion, 1);
  assert.equal(result.report.publisherFunction, "mod.export.publish_machine_state");
});

test("uses the exact provider ID and event channel contract", () => {
  const result = sdk.convert({ providerSdk: providerReport() }, {});
  assert.match(result.lua, /local PROVIDER_ID = "sample_mod_state_provider"/);
  assert.match(result.lua, /local EXPECTED_SOURCE_ID = "sample_mod"/);
  assert.match(result.lua, /provider\.event_schema ~= EVENT_SCHEMA/);
  assert.match(result.lua, /provider\.api_version ~= API_VERSION/);
  assert.match(result.lua, /provider\.event_name ~= eventName/);
  assert.match(result.lua, /local eventName = PROVIDER_ID \.\. ":machine_state_update"/);
  assert.match(result.lua, /events\.emit, eventName, payload/);
});

test("exports a callable helper but creates no automatic source or tick callbacks", () => {
  const result = sdk.convert({ providerSdk: providerReport() }, {});
  assert.match(result.lua, /exports\.publish_machine_state = publishMachineState/);
  assert.match(result.lua, /mod\.export = exports/);
  assert.match(result.lua, /No source reader, timer, world scan/);
  assert.equal(result.report.publisherHelperGenerated, true);
  assert.equal(result.report.sourceReaderCallbacksGenerated, 0);
  assert.equal(result.report.eventPublicationsWired, 0);
  assert.equal(result.report.automaticPublication, false);
  assert.equal(result.report.realStateCallbacksRegistered, false);
  assert.equal(result.report.valuesConnected, false);
  assert.equal(result.report.sourceValuesIndependentlyVerified, false);
  assert.equal(result.report.sourceRuntimeValuesRecovered, false);
  assert.equal(result.report.arbitraryJavaBlockEntityAccess, false);
  assert.doesNotMatch(result.lua, /timer\.every|timer\.after|on\("tick"|on\('tick'/);
  assert.doesNotMatch(result.lua, /world\.block|nbt\.read|java\.getField/i);
});

test("validates coordinates, block IDs, scalar keys, data types and numeric bounds", () => {
  const result = sdk.convert({ providerSdk: providerReport() }, {});
  for (const fragment of [
    "validCoordinate(value)",
    "math.abs(value) <= MAX_COORDINATE",
    "validBlockId(value)",
    "segment == \".\" or segment == \"..\"",
    "sanitizeValues(sourceValues)",
    "KEY_TYPES[key]",
    "value == math.huge",
    "value == -math.huge",
    "math.abs(value) > MAX_VALUE",
    "type(value) ~= \"boolean\"",
    "type(value) ~= \"string\"",
    "if count > 19 then return nil end",
    "if count == 0 then return nil end"
  ]) assert.ok(result.lua.includes(fragment), "missing validation: " + fragment);
});

test("reports that event submission does not prove receiver delivery or sender identity", () => {
  const result = sdk.convert({ providerSdk: providerReport() }, {});
  assert.match(result.lua, /receiver availability is not confirmed/);
  assert.ok(result.report.limitations.some(text => text.includes("does not confirm that the provider received")));
  assert.ok(result.report.limitations.some(text => text.includes("do not authenticate the sender")));
  assert.equal(result.report.valuesConnected, false);
});

test("does not claim a compatible provider when Phase 23 contract metadata differs", () => {
  const result = sdk.convert({ providerSdk: providerReport({
    contract: { schema: "unknown", apiVersion: 2, eventSchema: "wrong", eventName: "wrong" }
  }) }, {});
  assert.equal(result.report.status, "provider-contract-mismatch");
  assert.equal(result.report.contract.schema, "jar2zeus.machine-state-event.v1");
});

test("filters unsafe provider or source identifiers", () => {
  assert.equal(sdk.validId("sample_mod"), true);
  assert.equal(sdk.validId("provider-01"), true);
  assert.equal(sdk.validId(".hidden"), false);
  assert.equal(sdk.validId("bad id"), false);
  assert.equal(sdk.validId("weapon_mod"), false);
});

test("generated producer helper uses only documented Zeus API calls", () => {
  const result = sdk.convert({ providerSdk: providerReport() }, {});
  const scan = apiValidator.scan(result.lua);
  assert.equal(scan.valid, true);
  assert.deepEqual(scan.unsupportedApis, []);
  assert.ok(scan.requiredApis.includes("mods.get"));
  assert.ok(scan.requiredApis.includes("events.emit"));
  assert.ok(scan.requiredApis.includes("mod.log"));
});
