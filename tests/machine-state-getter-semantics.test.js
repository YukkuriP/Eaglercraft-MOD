const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

require(path.join(__dirname, "..", "machine-state-getter-semantics.js"));
const analyzer = globalThis.Jar2ZeusMachineStateGetterSemantics;
const CLASS = "sample/machine/CrusherBlockEntity";
function ins(name, extra = {}) { return Object.assign({ name }, extra); }
function field(name = "progress", descriptor = "I", owner = CLASS) {
  return { kind: "field", owner, name, descriptor };
}
function method(name, descriptor, instructions, valid = true) {
  return {
    name, descriptor, accessFlags: 1,
    code: {
      instructions, decodeError: null,
      verification: { valid, structuralOnly: true, errors: [] }
    }
  };
}
function candidate(name, fieldName = "progress", metric = "processing.progress", descriptor = "()I") {
  return {
    sourceClass: CLASS, sourcePath: CLASS + ".class",
    methodName: name, methodDescriptor: descriptor, instanceMethod: true,
    fieldMatches: [{
      fieldName, fieldDescriptor: "I", metric,
      providerKey: "progress", exactGetFieldRead: true
    }]
  };
}
function data(methods, candidates) {
  return {
    sourceAnalysis: {
      schema: "jar2zeus.machine-state-source-analysis.v1",
      getterCandidates: candidates || [candidate("getProgress")]
    },
    classes: [{
      path: CLASS + ".class",
      classInfo: { valid: true, className: CLASS, fields: [], methods }
    }]
  };
}
function directInstructions() {
  return [ins("aload_0", { pc: 0 }), ins("getfield", { pc: 1, member: field() }), ins("ireturn", { pc: 4 })];
}

test("recognizes a simple direct field return without claiming runtime recovery", () => {
  const report = analyzer.analyze(data([method("getProgress", "()I", directInstructions())]));
  const row = report.getterAnalyses[0];
  assert.equal(report.schema, "jar2zeus.machine-state-getter-semantics.v1");
  assert.equal(row.classification, "direct-field-return");
  assert.equal(row.expression.text, "sample/machine/CrusherBlockEntity.progress");
  assert.equal(row.matchedFieldReads[0].readByBody, true);
  assert.equal(row.javaMethodExecuted, false);
  assert.equal(report.sourceRuntimeValuesRecovered, false);
});

test("detects scaled/calculated field return and exposes a bounded symbolic expression", () => {
  const body = [
    ins("aload_0", { pc: 0 }), ins("getfield", { pc: 1, member: field() }),
    ins("iconst_2", { pc: 4 }), ins("imul", { pc: 5 }), ins("ireturn", { pc: 6 })
  ];
  const row = analyzer.analyze(data([method("getProgress", "()I", body)])).getterAnalyses[0];
  assert.equal(row.classification, "calculated-from-field");
  assert.equal(row.expression.text, "(sample/machine/CrusherBlockEntity.progress * 2)");
  assert.deepEqual(row.arithmeticOperations.map(x => x.opcode), ["imul"]);
});

test("keeps conditional methods unresolved instead of guessing a result", () => {
  const body = [
    ins("aload_0", { pc: 0 }), ins("getfield", { pc: 1, member: field() }),
    ins("ifeq", { pc: 4, target: 9 }), ins("iconst_1", { pc: 7 }),
    ins("ireturn", { pc: 8 }), ins("iconst_0", { pc: 9 }), ins("ireturn", { pc: 10 })
  ];
  const row = analyzer.analyze(data([method("getProgress", "()I", body)])).getterAnalyses[0];
  assert.equal(row.classification, "conditional-or-loop-dependent");
  assert.equal(row.branchObserved, true);
  assert.equal(row.expression, null);
});

test("marks helper calls as dependencies rather than treating them as safe field getters", () => {
  const body = [
    ins("aload_0", { pc: 0 }), ins("getfield", { pc: 1, member: field() }),
    ins("invokestatic", { pc: 4, member: { kind: "method", owner: "sample/machine/MathHelper", name: "scale", descriptor: "(I)I" } }),
    ins("ireturn", { pc: 7 })
  ];
  const row = analyzer.analyze(data([method("getProgress", "()I", body)])).getterAnalyses[0];
  assert.equal(row.classification, "helper-call-dependent");
  assert.equal(row.helperCallObserved, true);
  assert.equal(row.methodCalls[0].name, "scale");
});

test("detects state writes even when the method name looks like a getter", () => {
  const body = [
    ins("aload_0", { pc: 0 }), ins("iconst_0", { pc: 1 }),
    ins("putfield", { pc: 2, member: field("progress") }), ins("return", { pc: 5 })
  ];
  const row = analyzer.analyze(data([method("getProgress", "()I", body)])).getterAnalyses[0];
  assert.equal(row.classification, "state-mutating-getter");
  assert.equal(row.stateWriteObserved, true);
  assert.equal(row.fieldWrites.length, 1);
});

test("recognizes constants but does not infer a live machine value", () => {
  const row = analyzer.analyze(data([method("getProgress", "()I", [
    ins("iconst_0", { pc: 0 }), ins("ireturn", { pc: 1 })
  ])])).getterAnalyses[0];
  assert.equal(row.classification, "constant-return");
  assert.equal(row.expression.text, "0");
  assert.equal(row.sourceRuntimeValueRecovered, false);
});

test("unverified bytecode is always marked low confidence", () => {
  const row = analyzer.analyze(data([method("getProgress", "()I", directInstructions(), false)])).getterAnalyses[0];
  assert.equal(row.classification, "direct-field-return");
  assert.equal(row.confidence, "low-unverified-bytecode-evidence");
  assert.equal(row.structuralVerificationValid, false);
});

test("filters restricted class and method identifiers from output", () => {
  const blockedClass = "sample/weapon/LauncherBlockEntity";
  const blockedCandidate = candidate("getProgress");
  blockedCandidate.sourceClass = blockedClass;
  const report = analyzer.analyze({
    sourceAnalysis: { getterCandidates: [blockedCandidate] },
    classes: [{ classInfo: { valid: true, className: blockedClass, methods: [method("getProgress", "()I", directInstructions())] } }]
  });
  assert.equal(report.getterAnalyses.length, 0);
});

test("reports missing method bodies and bounds details while preserving totals", () => {
  const candidates = [candidate("getProgress"), candidate("getProgressExtra")];
  const report = analyzer.analyze(data([], candidates), { detailLimit: 1 });
  assert.equal(report.totals.getterCandidatesSeen, 2);
  assert.equal(report.getterAnalyses.length, 1);
  assert.equal(report.totals.methodsOmitted, 1);
  assert.equal(report.totals.detailsTruncated, true);
  assert.equal(report.getterAnalyses[0].classification, "no-bytecode");
});

test("never claims a Java bridge, callbacks, event wiring, or automatic telemetry", () => {
  const report = analyzer.analyze(data([method("getProgress", "()I", directInstructions())]));
  assert.equal(report.javaMethodsExecuted, false);
  assert.equal(report.sourceRuntimeValuesRecovered, false);
  assert.equal(report.sourceReaderCallbacksGenerated, 0);
  assert.equal(report.eventPublicationsWired, 0);
  assert.equal(report.liveValuesConnected, false);
  assert.equal(report.arbitraryJavaBlockEntityAccess, false);
});
