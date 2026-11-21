const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
require(path.join(__dirname, "..", "machine-state-condition-operands.js"));
const analyzer = globalThis.Jar2ZeusMachineConditionOperands;
const owner = "sample/machine/CrusherBlockEntity";
const progress = {kind:"field",owner,name:"progress",descriptor:"I"};
function ins(name,pc,extra={}){return Object.assign({name,pc},extra);}
function fixture({instructions,branchPc,branchOpcode,descriptor="(I)V",blockStart=0,blockEnd=16,writerClass=owner}){
 const branchCandidate={branchBlockId:0,branchPc,branchOpcode,successorBlockId:1,successorEdgeKind:"conditional-true"};
 const flow={schema:"jar2zeus.machine-state-control-flow.v1",writers:[{methodId:owner+".serverTick"+descriptor,sourceClass:writerClass,methodName:"serverTick",methodDescriptor:descriptor,cfg:{status:"structural-cfg-analyzed"},writes:[{pc:40,fieldName:"progress",controlDependenceCandidates:[branchCandidate]}]}]};
 const code={instructions,verification:{valid:true,structuralOnly:true,errors:[],controlFlow:{basicBlocks:[{id:0,start:blockStart,end:blockEnd,lastOpcode:branchOpcode}],edges:[{from:0,to:1,kind:"conditional-true"}]}}};
 return {controlFlow:flow,classes:[{classInfo:{valid:true,className:writerClass,methods:[{name:"serverTick",descriptor,accessFlags:1,code}]}}]};
}
test("traces a field read and method parameter into integer comparison operands",()=>{
 const input=fixture({instructions:[ins("aload_0",0),ins("getfield",1,{member:progress}),ins("iload_1",4),ins("if_icmpge",5,{target:12})],branchPc:5,branchOpcode:"if_icmpge",blockEnd:8});
 const report=analyzer.analyze(input),branch=report.methods[0].branches[0];
 assert.equal(report.schema,"jar2zeus.machine-condition-operands.v1");
 assert.equal(branch.status,"resolved");
 assert.equal(branch.branch.branchKind,"integer-pair");
 assert.equal(branch.branch.operandOrigins[0].kind,"field-read");
 assert.equal(branch.branch.operandOrigins[0].name,"progress");
 assert.equal(branch.branch.operandOrigins[1].kind,"method-parameter");
 assert.equal(branch.branch.operandOrigins[1].parameterIndex,0);
 assert.equal(report.comparisonRuntimeValuesRecovered,false);
});
test("preserves a simple arithmetic expression in a unary branch operand",()=>{
 const input=fixture({instructions:[ins("iload_1",0),ins("iconst_1",1),ins("iadd",2),ins("ifle",3,{target:10})],branchPc:3,branchOpcode:"ifle",blockEnd:6});
 const report=analyzer.analyze(input),operand=report.methods[0].branches[0].branch.operandOrigins[0];
 assert.equal(operand.kind,"calculated-value");
 assert.equal(operand.operator,"iadd");
 assert.equal(operand.operands[0].kind,"method-parameter");
 assert.equal(operand.operands[1].constantValue,1);
});
test("marks missing incoming stack values as partial instead of guessing",()=>{
 const input=fixture({instructions:[ins("ifeq",0,{target:8})],branchPc:0,branchOpcode:"ifeq",blockEnd:3,descriptor:"()V"});
 const report=analyzer.analyze(input);
 assert.equal(report.methods[0].branches[0].status,"partial");
 assert.equal(report.methods[0].branches[0].branch.operandOrigins[0].kind,"unknown-stack-entry");
});
test("tracks a helper method's symbolic return without executing it",()=>{
 const call={kind:"method",owner,name:"canProcess",descriptor:"()Z"};
 const input=fixture({instructions:[ins("aload_0",0),ins("invokevirtual",1,{member:call}),ins("ifeq",4,{target:12})],branchPc:4,branchOpcode:"ifeq",blockEnd:7,descriptor:"()V"});
 const report=analyzer.analyze(input),operand=report.methods[0].branches[0].branch.operandOrigins[0];
 assert.equal(operand.kind,"method-result");
 assert.equal(operand.methodName,"canProcess");
 assert.equal(report.javaMethodsExecuted,false);
});
test("stops when an unsupported stack opcode would make provenance unsafe",()=>{
 const input=fixture({instructions:[ins("iload_1",0),ins("iconst_1",1),ins("dup_x1",2),ins("if_icmpge",3,{target:10})],branchPc:3,branchOpcode:"if_icmpge",blockEnd:6});
 const report=analyzer.analyze(input);
 assert.equal(report.methods[0].branches[0].status,"unsupported");
 assert.equal(report.methods[0].branches[0].reason,"unsupported-stack-manipulation:dup_x1");
});
test("reports a missing candidate branch instruction",()=>{
 const input=fixture({instructions:[ins("return",0)],branchPc:8,branchOpcode:"ifeq",blockEnd:12});
 const report=analyzer.analyze(input);
 assert.equal(report.methods[0].branches[0].status,"branch-instruction-mismatch");
});
test("does not analyze blocked machine class names",()=>{
 const input=fixture({instructions:[ins("ifeq",0,{target:8})],branchPc:0,branchOpcode:"ifeq",blockEnd:3,descriptor:"()V",writerClass:"sample/weapon/CannonBlockEntity"});
 const report=analyzer.analyze(input);
 assert.equal(report.totals.writerMethodsMissing,0);
 assert.equal(report.methods.length,0);
});
