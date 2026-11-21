const test=require("node:test");
const assert=require("node:assert/strict");
const path=require("node:path");
require(path.join(__dirname,"..","machine-state-interprocedural-summaries.js"));
const analyzer=globalThis.Jar2ZeusMachineStateInterproceduralSummaries;
const owner="sample/machine/CrusherBlockEntity";
function ins(name,pc,extra={}){return Object.assign({name:name,pc:pc},extra);}
function helper(name,descriptor,accessFlags,instructions,blocks){
 return {name:name,descriptor:descriptor,accessFlags:accessFlags,code:{instructions:instructions,verification:{valid:true,structuralOnly:true,controlFlow:{basicBlocks:blocks||[{id:0,start:0,end:instructions.length}],edges:[]}}}};
}
function fixture({callOpcode="invokestatic",helperMethod,callName=helperMethod.name,callDescriptor=helperMethod.descriptor,operand,argumentOrigins=[],receiver=null,className=owner,extraMethods=[]}){
 const member={kind:"method",owner:className,name:callName,descriptor:callDescriptor};
 const caller={name:"serverTick",descriptor:"()V",accessFlags:0,code:{instructions:[ins(callOpcode,3,{member:member})]}};
 const methodResult=operand||{kind:"method-result",pc:3,methodOwner:className,methodName:callName,methodDescriptor:callDescriptor,descriptor:callDescriptor.slice(callDescriptor.indexOf(")")+1),category:1,receiver:receiver,arguments:argumentOrigins};
 return {crossBlockDataflow:{schema:"jar2zeus.machine-state-cross-block-dataflow.v1",methods:[{sourceClass:className,methodName:"serverTick",methodDescriptor:"()V",branches:[{pc:20,opcode:"ifeq",status:"resolved",operandOrigins:[methodResult]}]}]},classes:[{classInfo:{valid:true,className:className,methods:[caller,helperMethod,...extraMethods]}}]};
}
function resolved(report){return report.methods[0].branches[0].operandOrigins[0];}
test("substitutes an exact same-class static helper parameter with the call-site origin",()=>{
 const h=helper("identity","(I)I",0x0008,[ins("iload_0",0),ins("ireturn",1)]);
 const input=fixture({helperMethod:h,argumentOrigins:[{kind:"constant",constantKind:"integer",constantValue:9,descriptor:"I",category:1}]});
 const report=analyzer.analyze(input),value=resolved(report);
 assert.equal(value.kind,"interprocedural-summary-result");
 assert.equal(value.resolutionStatus,"resolved");
 assert.equal(value.expression.kind,"constant");
 assert.equal(value.expression.constantValue,9);
 assert.equal(report.totals.methodResultsResolved,1);
});
test("expands a pure arithmetic helper without evaluating the expression",()=>{
 const h=helper("twice","(I)I",0x0008,[ins("iload_0",0),ins("iconst_2",1),ins("imul",2),ins("ireturn",3)]);
 const input=fixture({helperMethod:h,argumentOrigins:[{kind:"field-read",owner:owner,name:"progress",descriptor:"I",category:1}]});
 const value=resolved(analyzer.analyze(input));
 assert.equal(value.expression.kind,"calculated-value");
 assert.equal(value.expression.operator,"imul");
 assert.equal(value.expression.operands[0].name,"progress");
 assert.equal(value.expression.operands[1].constantValue,2);
 assert.equal(value.expression.constantValue,undefined);
});
test("maps an instance receiver through a private invokespecial helper",()=>{
 const field={kind:"field",owner:owner,name:"progress",descriptor:"I"};
 const h=helper("readProgress","()I",0x0002,[ins("aload_0",0),ins("getfield",1,{member:field}),ins("ireturn",4)]);
 const input=fixture({callOpcode:"invokespecial",helperMethod:h,receiver:{kind:"this",category:1}});
 const value=resolved(analyzer.analyze(input));
 assert.equal(value.kind,"interprocedural-summary-result");
 assert.equal(value.expression.kind,"field-read");
 assert.equal(value.expression.name,"progress");
 assert.equal(value.expression.receiver.kind,"this");
});
test("maps a static helper object parameter into a field-read receiver",()=>{
 const field={kind:"field",owner:owner,name:"progress",descriptor:"I"};
 const h=helper("readProgress","(Lsample/machine/CrusherBlockEntity;)I",0x0008,[ins("aload_0",0),ins("getfield",1,{member:field}),ins("ireturn",4)]);
 const input=fixture({helperMethod:h,argumentOrigins:[{kind:"local-slot",slot:2,descriptor:"Lsample/machine/CrusherBlockEntity;",category:1}]});
 const value=resolved(analyzer.analyze(input));
 assert.equal(value.expression.kind,"field-read");
 assert.equal(value.expression.receiver.kind,"local-slot");
 assert.equal(value.expression.receiver.slot,2);
});
test("rejects a helper with branches or multiple basic blocks",()=>{
 const h=helper("conditional","(I)I",0x0008,[ins("iload_0",0),ins("ifeq",1,{target:5}),ins("iconst_1",2),ins("ireturn",3),ins("iconst_0",5),ins("ireturn",6)],[{id:0,start:0,end:4},{id:1,start:5,end:7}]);
 const input=fixture({helperMethod:h,argumentOrigins:[{kind:"constant",constantValue:1,category:1}]});
 const report=analyzer.analyze(input),value=resolved(report);
 assert.equal(value.kind,"method-result");
 assert.equal(value.resolutionStatus,"unresolved");
 assert.equal(value.resolutionReason,"helper-has-control-flow-or-multiple-blocks");
});
test("rejects state-mutating helper bodies instead of summarizing them",()=>{
 const field={kind:"field",owner:owner,name:"progress",descriptor:"I"};
 const h=helper("mutate","()I",0x0002,[ins("aload_0",0),ins("iconst_0",1),ins("putfield",2,{member:field}),ins("aload_0",5),ins("getfield",6,{member:field}),ins("ireturn",9)]);
 const input=fixture({callOpcode:"invokespecial",helperMethod:h,receiver:{kind:"this",category:1}});
 const value=resolved(analyzer.analyze(input));
 assert.equal(value.kind,"method-result");
 assert.equal(value.resolutionReason,"helper-unsupported-opcode:putfield");
});
test("refuses virtual dispatch because the concrete callee is not proven",()=>{
 const h=helper("identity","(I)I",0x0001,[ins("iload_1",0),ins("ireturn",1)]);
 const input=fixture({callOpcode:"invokevirtual",helperMethod:h,argumentOrigins:[{kind:"constant",constantValue:1,category:1}],receiver:{kind:"this",category:1}});
 const value=resolved(analyzer.analyze(input));
 assert.equal(value.kind,"method-result");
 assert.equal(value.resolutionReason,"invocation-dispatch-not-exact");
});
test("rejects call-site owner or descriptor mismatches",()=>{
 const h=helper("identity","(I)I",0x0008,[ins("iload_0",0),ins("ireturn",1)]);
 const input=fixture({helperMethod:h,callDescriptor:"(J)I",argumentOrigins:[{kind:"constant",constantValue:1,category:1}]});
 const value=resolved(analyzer.analyze(input));
 assert.equal(value.kind,"method-result");
 assert.equal(value.resolutionReason,"callsite-reference-mismatch");
});
test("excludes blocked weapon-related class paths",()=>{
 const blocked="sample/weapon/CannonMachine";
 const h=helper("identity","(I)I",0x0008,[ins("iload_0",0),ins("ireturn",1)]);
 const input=fixture({helperMethod:h,className:blocked,argumentOrigins:[{kind:"constant",constantValue:1,category:1}]});
 const report=analyzer.analyze(input);
 assert.equal(report.methods.length,0);
 assert.equal(report.javaMethodsExecuted,false);
});
test("reports static-only boundaries and bounded analysis metadata",()=>{
 const h=helper("identity","(I)I",0x0008,[ins("iload_0",0),ins("ireturn",1)]);
 const input=fixture({helperMethod:h,argumentOrigins:[{kind:"constant",constantValue:4,category:1}]});
 const report=analyzer.analyze(input,{methodLimit:1,callLimit:4,summaryLimit:2});
 assert.equal(report.schema,"jar2zeus.machine-state-interprocedural-summaries.v1");
 assert.equal(report.helperCallsInspected,true);
 assert.equal(report.interproceduralOriginsRecovered,true);
 assert.equal(report.javaMethodsExecuted,false);
 assert.equal(report.runtimeValuesRecovered,false);
 assert.equal(report.branchOutcomesRecovered,false);
 assert.ok(report.totals.helperInstructionsAnalyzed<=20000);
});
