const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

require(path.join(__dirname, "..", "machine-state-write-value-analysis.js"));
const analyzer = globalThis.Jar2ZeusMachineStateWriteValueAnalysis;
const CLASS = "sample/machine/CrusherBlockEntity";
function ins(name, extra = {}) { return Object.assign({ name }, extra); }
function field(name = "progress", descriptor = "I", owner = CLASS) {
  return { kind: "field", owner, name, descriptor };
}
function method(name, descriptor, instructions, valid = true, extra = {}) {
  return Object.assign({
    name, descriptor, accessFlags: 1,
    code: {
      instructions, exceptions: [], decodeError: null,
      verification: { valid, structuralOnly: true, errors: [] }
    }
  }, extra);
}
function writer(name, descriptor, fieldName, fieldDescriptor, pc, opcode = "putfield") {
  return {
    methodId: CLASS + "." + name + descriptor,
    sourceClass: CLASS, sourcePath: CLASS + ".class",
    methodName: name, methodDescriptor: descriptor,
    fieldWrites: [{
      pc, opcode, fieldOwner: CLASS, fieldName,
      fieldDescriptor, metric: "processing.progress",
      providerKey: "progress", staticWrite: opcode === "putstatic"
    }]
  };
}
function data(methods, writes) {
  const classInfo = { valid: true, className: CLASS, methods };
  return {
    writeTrace: {
      schema: "jar2zeus.machine-state-write-trace.v1",
      writerMethods: writes
    },
    classes: [{ path: CLASS + ".class", classInfo }]
  };
}

test("recovers a direct setter argument as symbolic assignment provenance", () => {
  const body = [
    ins("aload_0", { pc: 0 }), ins("iload_1", { pc: 1 }),
    ins("putfield", { pc: 2, member: field("progress") }), ins("return", { pc: 5 })
  ];
  const report = analyzer.analyze(data(
    [method("setProgress", "(I)V", body)],
    [writer("setProgress", "(I)V", "progress", "I", 2)]
  ));
  const row = report.writeAnalyses[0];
  assert.equal(report.schema, "jar2zeus.machine-state-write-value-analysis.v1");
  assert.equal(row.status, "resolved");
  assert.equal(row.valueExpression.text, "arg0");
  assert.deepEqual(row.valueExpression.argumentDependencies, [0]);
  assert.equal(row.assignedRuntimeValueRecovered, false);
});

test("recovers a numeric constant assigned to a machine field", () => {
  const body = [
    ins("aload_0", { pc: 0 }), ins("bipush", { pc: 1, operand: 42 }),
    ins("putfield", { pc: 3, member: field("progress") }), ins("return", { pc: 6 })
  ];
  const row = analyzer.analyze(data(
    [method("resetProgress", "()V", body)],
    [writer("resetProgress", "()V", "progress", "I", 3)]
  )).writeAnalyses[0];
  assert.equal(row.status, "resolved");
  assert.equal(row.valueExpression.text, "42");
  assert.deepEqual(row.valueExpression.numericConstants, [42]);
});

test("recovers a field-derived increment expression with correct PUTFIELD stack order", () => {
  const body = [
    ins("aload_0", { pc: 0 }), ins("dup", { pc: 1 }),
    ins("getfield", { pc: 2, member: field("progress") }),
    ins("iconst_1", { pc: 5 }), ins("iadd", { pc: 6 }),
    ins("putfield", { pc: 7, member: field("progress") }), ins("return", { pc: 10 })
  ];
  const row = analyzer.analyze(data(
    [method("advanceProgress", "()V", body)],
    [writer("advanceProgress", "()V", "progress", "I", 7)]
  )).writeAnalyses[0];
  assert.equal(row.status, "resolved");
  assert.equal(row.valueExpression.text, "(sample/machine/CrusherBlockEntity.progress + 1)");
  assert.equal(row.fieldReads[0].name, "progress");
});

test("tracks simple local stores and iinc before the write site", () => {
  const body = [
    ins("iload_1", { pc: 0 }), ins("istore_2", { pc: 1 }),
    ins("iinc", { pc: 2, local: 2, increment: 1 }),
    ins("aload_0", { pc: 5 }), ins("iload_2", { pc: 6 }),
    ins("putfield", { pc: 7, member: field("progress") }), ins("return", { pc: 10 })
  ];
  const row = analyzer.analyze(data(
    [method("setProgressAdjusted", "(I)V", body)],
    [writer("setProgressAdjusted", "(I)V", "progress", "I", 7)]
  )).writeAnalyses[0];
  assert.equal(row.status, "resolved");
  assert.equal(row.valueExpression.text, "(arg0 + 1)");
  assert.deepEqual(row.valueExpression.argumentDependencies, [0]);
});

test("tracks long arguments in two JVM local slots and category-2 stack width", () => {
  const body = [
    ins("aload_0", { pc: 0 }), ins("lload_1", { pc: 1 }),
    ins("putfield", { pc: 2, member: field("energyStored", "J") }), ins("return", { pc: 5 })
  ];
  const row = analyzer.analyze(data(
    [method("setEnergy", "(J)V", body)],
    [writer("setEnergy", "(J)V", "energyStored", "J", 2)]
  )).writeAnalyses[0];
  assert.equal(row.status, "resolved");
  assert.equal(row.valueExpression.text, "arg0");
  assert.equal(row.valueExpression.stackSlots, 2);
});

test("traces PUTSTATIC values without an instance receiver", () => {
  const body = [
    ins("iconst_1", { pc: 0 }),
    ins("putstatic", { pc: 1, member: field("progress", "I") }),
    ins("return", { pc: 4 })
  ];
  const row = analyzer.analyze(data(
    [method("setGlobalProgress", "()V", body, true, { accessFlags: 9 })],
    [writer("setGlobalProgress", "()V", "progress", "I", 1, "putstatic")]
  )).writeAnalyses[0];
  assert.equal(row.status, "resolved");
  assert.equal(row.valueExpression.text, "1");
  assert.equal(row.stackShapeAtWrite.receiver, null);
});

test("stops at branch instructions rather than guessing a path", () => {
  const body = [
    ins("aload_0", { pc: 0 }), ins("iload_1", { pc: 1 }),
    ins("ifeq", { pc: 2, target: 8 }),
    ins("putfield", { pc: 5, member: field("progress") }), ins("return", { pc: 8 })
  ];
  const row = analyzer.analyze(data(
    [method("conditionalSetProgress", "(I)V", body)],
    [writer("conditionalSetProgress", "(I)V", "progress", "I", 5)]
  )).writeAnalyses[0];
  assert.equal(row.status, "unresolved");
  assert.equal(row.reason, "control-flow-before-write");
  assert.equal(row.branchSites[0].opcode, "ifeq");
});

test("stops at method calls before a target write", () => {
  const body = [
    ins("aload_0", { pc: 0 }), ins("invokestatic", {
      pc: 1, member: { kind: "method", owner: "sample/machine/Helper", name: "next", descriptor: "()I" }
    }),
    ins("putfield", { pc: 4, member: field("progress") }), ins("return", { pc: 7 })
  ];
  const row = analyzer.analyze(data(
    [method("updateProgress", "()V", body)],
    [writer("updateProgress", "()V", "progress", "I", 4)]
  )).writeAnalyses[0];
  assert.equal(row.status, "unresolved");
  assert.equal(row.reason, "method-call-before-write");
});

test("does not resolve bodies with exception handlers or unverified bytecode", () => {
  const body = [
    ins("aload_0", { pc: 0 }), ins("iload_1", { pc: 1 }),
    ins("putfield", { pc: 2, member: field("progress") }), ins("return", { pc: 5 })
  ];
  const withHandler = method("setProgress", "(I)V", body, true);
  withHandler.code.exceptions = [{ startPc: 0, endPc: 2, handlerPc: 5, catchType: null }];
  const handlerRow = analyzer.analyze(data([withHandler], [writer("setProgress", "(I)V", "progress", "I", 2)])).writeAnalyses[0];
  assert.equal(handlerRow.reason, "exception-table-present-before-write-cannot-be-ruled-out");
  const unverifiedRow = analyzer.analyze(data(
    [method("setProgress", "(I)V", body, false)],
    [writer("setProgress", "(I)V", "progress", "I", 2)]
  )).writeAnalyses[0];
  assert.equal(unverifiedRow.status, "unverified");
  assert.equal(unverifiedRow.reason, "bytecode-structure-not-verified");
});

test("rejects a write whose receiver is not proven to be this", () => {
  const body = [
    ins("aload_1", { pc: 0 }), ins("iload_2", { pc: 1 }),
    ins("putfield", { pc: 2, member: field("progress") }), ins("return", { pc: 5 })
  ];
  const row = analyzer.analyze(data(
    [method("copyProgress", "(Lsample/Other;I)V", body)],
    [writer("copyProgress", "(Lsample/Other;I)V", "progress", "I", 2)]
  )).writeAnalyses[0];
  assert.equal(row.status, "unresolved");
  assert.equal(row.reason, "target-field-receiver-not-proven-to-be-this");
});

test("checks exact target field, method owner, descriptor, and write pc", () => {
  const body = [
    ins("aload_0", { pc: 0 }), ins("iload_1", { pc: 1 }),
    ins("putfield", { pc: 2, member: field("energyStored", "J") }), ins("return", { pc: 5 })
  ];
  const row = analyzer.analyze(data(
    [method("setProgress", "(I)V", body)],
    [writer("setProgress", "(I)V", "progress", "I", 2)]
  )).writeAnalyses[0];
  assert.equal(row.status, "unresolved");
  assert.equal(row.reason, "exact-write-instruction-not-found");
});

test("requires field descriptor stack width to match assigned expression", () => {
  const body = [
    ins("aload_0", { pc: 0 }), ins("lload_1", { pc: 1 }),
    ins("putfield", { pc: 2, member: field("progress", "I") }), ins("return", { pc: 5 })
  ];
  const row = analyzer.analyze(data(
    [method("invalidSet", "(J)V", body)],
    [writer("invalidSet", "(J)V", "progress", "I", 2)]
  )).writeAnalyses[0];
  assert.equal(row.status, "unresolved");
  assert.equal(row.reason, "assigned-expression-stack-width-does-not-match-field-descriptor");
});

test("reports bounded analysis totals without recovering live machine values", () => {
  const body = [
    ins("aload_0", { pc: 0 }), ins("iconst_1", { pc: 1 }),
    ins("putfield", { pc: 2, member: field("progress") }), ins("return", { pc: 5 })
  ];
  const report = analyzer.analyze(data(
    [method("setProgress", "()V", body)],
    [writer("setProgress", "()V", "progress", "I", 2)]
  ));
  assert.equal(report.status, "static-assignment-expression-evidence-found");
  assert.equal(report.totals.writeSitesSeen, 1);
  assert.equal(report.totals.resolvedWriteExpressions, 1);
  assert.equal(report.symbolicAssignmentExpressionsRecovered, true);
  assert.equal(report.assignedRuntimeValuesRecovered, false);
  assert.equal(report.javaMethodsExecuted, false);
  assert.equal(report.updateTimingRecovered, false);
  assert.equal(report.sourceReaderCallbacksGenerated, 0);
});

test("filters restricted class and field identifiers", () => {
  const restrictedClass = "sample/weapon/MachineController";
  const row = writer("setProgress", "()V", "progress", "I", 2);
  row.sourceClass = restrictedClass;
  row.fieldWrites[0].fieldOwner = restrictedClass;
  const report = analyzer.analyze({
    writeTrace: { schema: "jar2zeus.machine-state-write-trace.v1", writerMethods: [row] },
    classes: [{ classInfo: { valid: true, className: restrictedClass, methods: [
      method("setProgress", "()V", [
        ins("aload_0"), ins("iconst_1"),
        ins("putfield", { member: field("progress", "I", restrictedClass) })
      ])
    ] } }]
  });
  assert.equal(report.writeAnalyses.length, 0);
  assert.equal(report.javaMethodsExecuted, false);
});

test("does not leak restricted field identifiers encountered before a telemetry write", () => {
  const body = [
    ins("aload_0", { pc: 0 }), ins("iconst_1", { pc: 1 }),
    ins("putfield", { pc: 2, member: field("weaponFlag", "I") }),
    ins("aload_0", { pc: 5 }), ins("iconst_2", { pc: 6 }),
    ins("putfield", { pc: 7, member: field("progress", "I") })
  ];
  const row = analyzer.analyze(data(
    [method("setFields", "()V", body)],
    [writer("setFields", "()V", "progress", "I", 7)]
  )).writeAnalyses[0];
  assert.notEqual(row.status, "resolved");
  assert.equal(row.reason, "invalid-or-excluded-field-write-reference");
});

test("enforces per-method and aggregate instruction bounds", () => {
  const instructions = Array.from({ length: 5998 }, (_, i) => ins("nop", { pc: i }));
  instructions.push(ins("aload_0", { pc: 5998 }), ins("iconst_1", { pc: 5999 }),
    ins("putfield", { pc: 6000, member: field("progress") }));
  const methodRow = method("setProgress", "()V", instructions);
  const result = analyzer.analyze(data(
    [methodRow],
    [writer("setProgress", "()V", "progress", "I", 6000)]
  ));
  assert.equal(result.writeAnalyses[0].status, "truncated");
  assert.equal(result.writeAnalyses[0].reason, "write-site-beyond-instruction-limit");
});

test("propagates an earlier same-object field write into a later field read", () => {
  const body = [
    ins("aload_0", { pc: 0 }), ins("bipush", { pc: 1, operand: 7 }),
    ins("putfield", { pc: 3, member: field("progress") }),
    ins("aload_0", { pc: 6 }), ins("dup", { pc: 7 }),
    ins("getfield", { pc: 8, member: field("progress") }),
    ins("iconst_1", { pc: 11 }), ins("iadd", { pc: 12 }),
    ins("putfield", { pc: 13, member: field("progress") })
  ];
  const row = analyzer.analyze(data(
    [method("resetThenAdvance", "()V", body)],
    [writer("resetThenAdvance", "()V", "progress", "I", 13)]
  )).writeAnalyses[0];
  assert.equal(row.status, "resolved");
  assert.equal(row.valueExpression.text, "(7 + 1)");
  assert.equal(row.priorWriteSites.length, 1);
  assert.equal(row.priorWriteSites[0].pc, 3);
});
