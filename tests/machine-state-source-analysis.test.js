const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

require(path.join(__dirname, "..", "machine-state-source-analysis.js"));
const analyzer = globalThis.Jar2ZeusMachineStateSourceAnalysis;

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
  assert.equal(report.getterCandidates.length, 1);
  assert.equal(report.totals.fieldCandidatesReported, 3000);
  assert.equal(report.totals.detailsTruncated, true);
});
