const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

require(path.join(__dirname, "..", "machine-state-write-trace.js"));
const analyzer = globalThis.Jar2ZeusMachineStateWriteTrace;
const CLASS = "sample/machine/CrusherBlockEntity";
function ins(name, extra = {}) { return Object.assign({ name }, extra); }
function field(name = "progress", descriptor = "I", owner = CLASS) {
  return { kind: "field", owner, name, descriptor };
}
function call(owner, name, descriptor = "()V") {
  return { kind: "method", owner, name, descriptor };
}
function method(name, descriptor, instructions, valid = true, extra = {}) {
  return Object.assign({
    name, descriptor, accessFlags: 1,
    code: {
      instructions: instructions || [], exceptions: [],
      decodeError: null,
      verification: { valid, structuralOnly: true, errors: [] }
    }
  }, extra);
}
function candidate(fieldName, descriptor, metric, providerKey) {
  return { sourceClass: CLASS, sourcePath: CLASS + ".class", fieldName,
    fieldDescriptor: descriptor, metric, providerKey, evidenceSource: "synthetic-test" };
}
function data(methods, fields) {
  return {
    sourceAnalysis: {
      schema: "jar2zeus.machine-state-source-analysis.v1",
      machineClasses: [CLASS],
      fieldCandidates: fields || [
        candidate("progress", "I", "processing.progress", "progress"),
        candidate("energyStored", "J", "energy.stored", "energy")
      ]
    },
    classes: [{
      path: CLASS + ".class",
      classInfo: { valid: true, className: CLASS, methods }
    }]
  };
}

test("finds exact PUTFIELD writes and maps them to telemetry fields", () => {
  const writer = method("setProgress", "(I)V", [
    ins("aload_0", { pc: 0 }), ins("iload_1", { pc: 1 }),
    ins("putfield", { pc: 2, member: field("progress") }), ins("return", { pc: 5 })
  ]);
  const report = analyzer.analyze(data([writer]));
  assert.equal(report.schema, "jar2zeus.machine-state-write-trace.v1");
  assert.equal(report.status, "static-field-write-evidence-found");
  assert.equal(report.totals.writerMethodsObserved, 1);
  assert.equal(report.writerMethods[0].fieldWrites[0].fieldName, "progress");
  assert.equal(report.writerMethods[0].role.role, "setter-or-update");
  assert.equal(report.fieldSummaries[0].writerMethodCount, 1);
});

test("distinguishes static field writes from instance field writes", () => {
  const writer = method("setEnergy", "(J)V", [
    ins("lload_0", { pc: 0 }),
    ins("putstatic", { pc: 1, member: field("energyStored", "J") }),
    ins("return", { pc: 4 })
  ]);
  const report = analyzer.analyze(data([writer]));
  const row = report.writerMethods[0].fieldWrites[0];
  assert.equal(row.opcode, "putstatic");
  assert.equal(row.staticWrite, true);
});

test("classifies update roles using method/call names only as candidates", () => {
  const tick = method("serverTick", "()V", [
    ins("aload_0"), ins("iconst_1"),
    ins("putfield", { member: field("progress") }),
    ins("aload_0"),
    ins("invokevirtual", { member: call(CLASS, "setChanged") }),
    ins("return")
  ]);
  const persist = method("saveAdditional", "(Lsample/Tag;)V", [
    ins("aload_0"), ins("iconst_1"),
    ins("putfield", { member: field("progress") }), ins("return")
  ]);
  const report = analyzer.analyze(data([tick, persist]));
  assert.ok(report.writerMethods.some(row => row.role.role === "tick-or-lifecycle"));
  assert.ok(report.writerMethods.some(row => row.role.role === "persistence"));
  assert.ok(report.writerMethods.every(row => row.role.confidence === "candidate-only"));
});

test("tracks exact local call edges into a writer method", () => {
  const setter = method("setProgress", "(I)V", [
    ins("aload_0"), ins("iload_1"), ins("putfield", { member: field("progress") }), ins("return")
  ]);
  const tick = method("serverTick", "()V", [
    ins("aload_0"),
    ins("invokevirtual", { member: call(CLASS, "setProgress", "(I)V") }),
    ins("return")
  ]);
  const report = analyzer.analyze(data([setter, tick]));
  const row = report.writerMethods.find(x => x.methodName === "setProgress");
  assert.equal(row.internalCallerCount, 1);
  assert.equal(row.internalCallers[0].callerMethod, "serverTick");
});

test("records field reads, arithmetic, and branches without claiming assignment dataflow", () => {
  const writer = method("advanceProgress", "()V", [
    ins("aload_0"), ins("getfield", { member: field("progress") }),
    ins("iconst_1"), ins("iadd"),
    ins("aload_0"), ins("swap"),
    ins("putfield", { member: field("progress") }),
    ins("goto", { target: 0 }), ins("return")
  ]);
  const report = analyzer.analyze(data([writer]));
  const row = report.writerMethods[0];
  assert.equal(row.fieldReads.length, 1);
  assert.equal(row.branchSites.length, 1);
  assert.equal(row.assignmentSourceDataflowRecovered, false);
});

test("ignores writes to unrelated fields and classes", () => {
  const unrelated = method("setOther", "()V", [
    ins("aload_0"), ins("iconst_1"),
    ins("putfield", { member: field("decorationFlag") }), ins("return")
  ]);
  const otherClass = "sample/other/DecorationBlockEntity";
  const other = method("setProgress", "()V", [
    ins("aload_0"), ins("iconst_1"),
    ins("putfield", { member: field("progress", "I", otherClass) }), ins("return")
  ]);
  const report = analyzer.analyze(data([unrelated, other]));
  assert.equal(report.writerMethods.length, 0);
  assert.equal(report.status, "machine-fields-without-exact-write-evidence");
});

test("does not classify a getter read as a field write", () => {
  const getter = method("getProgress", "()I", [
    ins("aload_0"), ins("getfield", { member: field("progress") }), ins("ireturn")
  ]);
  const report = analyzer.analyze(data([getter]));
  assert.equal(report.writerMethods.length, 0);
  assert.equal(report.fieldSummaries[0].updatePathStatus, "no-exact-write-site-found");
});

test("keeps missing code and decode errors separate from observed writers", () => {
  const noCode = method("setProgress", "()V", [], true);
  noCode.code = null;
  const bad = method("setEnergy", "()V", [], false);
  bad.code.decodeError = "bad decode";
  const report = analyzer.analyze(data([noCode, bad]));
  assert.equal(report.totals.methodsWithCodeMissing, 1);
  assert.equal(report.totals.methodsWithDecodeErrors, 1);
  assert.equal(report.writerMethods.length, 0);
});

test("bounds writer details and records truncation", () => {
  const writers = Array.from({ length: 12 }, (_, i) => method("setProgress" + i, "()V", [
    ins("aload_0"), ins("iconst_1"),
    ins("putfield", { member: field("progress") }), ins("return")
  ]));
  const report = analyzer.analyze(data(writers), { detailLimit: 4 });
  assert.equal(report.totals.writerMethodsObserved, 12);
  assert.equal(report.totals.writerMethodsReported, 4);
  assert.equal(report.totals.detailsTruncated, true);
});

test("rejects restricted class identifiers and makes no Java/runtime claims", () => {
  const restrictedClass = "sample/weapon/Controller";
  const row = candidate("progress", "I", "processing.progress", "progress");
  row.sourceClass = restrictedClass;
  const report = analyzer.analyze({
    sourceAnalysis: { machineClasses: [restrictedClass], fieldCandidates: [row] },
    classes: [{ classInfo: { valid: true, className: restrictedClass, methods: [
      method("setProgress", "()V", [
        ins("aload_0"), ins("iconst_1"),
        ins("putfield", { member: field("progress", "I", restrictedClass) }), ins("return")
      ])
    ] } }]
  });
  assert.equal(report.writerMethods.length, 0);
  assert.equal(report.javaMethodsExecuted, false);
  assert.equal(report.assignmentValuesRecovered, false);
  assert.equal(report.updateTimingRecovered, false);
  assert.equal(report.liveValuesConnected, false);
  assert.equal(report.sourceReaderCallbacksGenerated, 0);
});

test("does not treat a PUTFIELD in an instruction window beyond the cap as observed evidence", () => {
  const instructions = Array.from({ length: 6005 }, (_, i) => ins("nop", { pc: i }));
  instructions.push(ins("aload_0"), ins("iconst_1"), ins("putfield", { member: field("progress") }));
  const report = analyzer.analyze(data([method("setProgress", "()V", instructions)]));
  assert.equal(report.writerMethods.length, 0);
  assert.equal(report.totals.writerMethodsObserved, 0);
});

test("propagates upstream Phase 25 field-candidate truncation", () => {
  const input = data([method("setProgress", "()V", [
    ins("aload_0"), ins("iconst_1"), ins("putfield", { member: field("progress") }), ins("return")
  ])]);
  input.sourceAnalysis.totals = { fieldCandidatesSeen: 50 };
  const report = analyzer.analyze(input);
  assert.equal(report.totals.fieldCandidatesSeen, 50);
  assert.equal(report.totals.sourceFieldCandidatesOmitted, 48);
  assert.equal(report.totals.detailsTruncated, true);
});
