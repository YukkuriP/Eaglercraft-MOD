const test=require("node:test");
const assert=require("node:assert/strict");
const path=require("node:path");
require(path.join(__dirname,"..","machine-state-nested-helper-summaries.js"));
const analyzer=globalThis.Jar2ZeusMachineStateNestedHelperSummaries;
const owner="sample/machine/CrusherBlockEntity";
function ins(name,pc,extra={}){return Object.assign({name:name,pc:pc},extra);}
function method(name,descriptor,accessFlags,instructions,blocks){
 const end=instructions.reduce((max,x)=>Math.max(max,Number(x.pc)||0),-1)+1;
 return {name:name,descriptor:descriptor,accessFlags:accessFlags,code:{instructions:instructions,exceptionTable:[],verification:{valid:true,structuralOnly:true,controlFlow:{basicBlocks:blocks||[{id:0,start:0,end:end}],edges:[]}}}};
}
function call(owner,name,descriptor){return {kind:"method",owner:owner,name:name,descriptor:descriptor};}
function fixture({root,helpers,args=[],receiver=null,rootOpcode="invokestatic",className=owner,extraCallerInstructions=[]}){
 const callerCall=ins(rootOpcode,100,{member:call(className,root.name,root.descriptor)});
 const caller={name:"serverTick",descriptor:"()V",accessFlags:0,code:{instructions:[...extraCallerInstructions,callerCall]}};
 const resultDescriptor=root.descriptor.slice(root.descriptor.indexOf(")")+1);
 const resultCategory=resultDescriptor==="J"||resultDescriptor==="D"?2:resultDescriptor==="V"?0:1;
 const methodResult={kind:"method-result",pc:100,methodOwner:className,methodName:root.name,methodDescriptor:root.descriptor,descriptor:resultDescriptor,category:resultCategory,arguments:args,receiver:receiver};
 return {
  crossBlockDataflow:{schema:"jar2zeus.machine-state-cross-block-dataflow.v1",methods:[{sourceClass:className,methodName:"serverTick",methodDescriptor:"()V",branches:[{branchBlockId:0,pc:120,opcode:"ifeq",status:"resolved",operandOrigins:[methodResult]}]}]},
  classes:[{classInfo:{valid:true,className:className,methods:[caller,root,...helpers]}}]
 };
}
function valueOf(report){return report.methods[0].branches[0].operandOrigins[0];}
test("expands a nested static helper chain and substitutes the original caller field origin",()=>{
 const inner=method("doubleValue","(I)I",0x0008,[ins("iload_0",0),ins("iconst_2",1),ins("imul",2),ins("ireturn",3)]);
 const outer=method("calculate","(I)I",0x0008,[ins("iload_0",0),ins("invokestatic",1,{member:call(owner,"doubleValue","(I)I")}),ins("ireturn",4)]);
 const input=fixture({root:outer,helpers:[inner],args:[{kind:"field-read",owner:owner,name:"progress",descriptor:"I",category:1}]});
 const report=analyzer.analyze(input),root=valueOf(report),nested=root.expression;
 assert.equal(root.kind,"interprocedural-summary-result");
 assert.equal(root.resolutionStatus,"resolved");
 assert.equal(nested.kind,"nested-helper-result");
 assert.equal(nested.methodName,"doubleValue");
 assert.equal(nested.expression.kind,"calculated-value");
 assert.equal(nested.expression.operator,"imul");
 assert.equal(nested.expression.operands[0].name,"progress");
 assert.equal(nested.expression.operands[1].constantValue,2);
 assert.equal(report.totals.nestedCallsSeen,1);
 assert.equal(report.totals.nestedCallsResolved,1);
 assert.equal(report.totals.topLevelCallsResolved,1);
});
test("propagates an instance receiver through an invokespecial private helper",()=>{
 const field={kind:"field",owner:owner,name:"progress",descriptor:"I"};
 const inner=method("readProgress","()I",0x0002,[ins("aload_0",0),ins("getfield",1,{member:field}),ins("ireturn",4)]);
 const objectDesc="Lsample/machine/CrusherBlockEntity;";
 const outer=method("readMachine","("+objectDesc+")I",0x0008,[ins("aload_0",0),ins("invokespecial",1,{member:call(owner,"readProgress","()I")}),ins("ireturn",4)]);
 const input=fixture({root:outer,helpers:[inner],args:[{kind:"local-slot",slot:3,descriptor:objectDesc,category:1}]});
 const nested=valueOf(analyzer.analyze(input)).expression;
 assert.equal(nested.kind,"nested-helper-result");
 assert.equal(nested.methodOpcode,"invokespecial");
 assert.equal(nested.expression.kind,"field-read");
 assert.equal(nested.expression.name,"progress");
 assert.equal(nested.expression.receiver.kind,"local-slot");
 assert.equal(nested.expression.receiver.slot,3);
});
test("detects and rejects recursive helper cycles",()=>{
 const a=method("cycleA","()I",0x0008,[ins("invokestatic",0,{member:call(owner,"cycleB","()I")}),ins("ireturn",3)]);
 const b=method("cycleB","()I",0x0008,[ins("invokestatic",0,{member:call(owner,"cycleA","()I")}),ins("ireturn",3)]);
 const input=fixture({root:a,helpers:[b]});
 const report=analyzer.analyze(input),value=valueOf(report);
 assert.equal(value.resolutionStatus,"unresolved");
 assert.equal(value.resolutionReason,"recursive-helper-cycle");
 assert.equal(report.totals.recursiveCyclesDetected,1);
 assert.equal(report.totals.javaMethodsExecuted,undefined);
 assert.equal(report.javaMethodsExecuted,false);
});
test("rejects a nested helper with multiple basic blocks",()=>{
 const inner=method("conditional","(I)I",0x0008,[ins("iload_0",0),ins("ifeq",1,{target:5}),ins("iconst_1",2),ins("ireturn",3),ins("iconst_0",5),ins("ireturn",6)],[{id:0,start:0,end:4},{id:1,start:5,end:7}]);
 const outer=method("outer","(I)I",0x0008,[ins("iload_0",0),ins("invokestatic",1,{member:call(owner,"conditional","(I)I")}),ins("ireturn",4)]);
 const report=analyzer.analyze(fixture({root:outer,helpers:[inner],args:[{kind:"constant",constantKind:"integer",constantValue:1,descriptor:"I",category:1}]}));
 const value=valueOf(report);
 assert.equal(value.resolutionStatus,"unresolved");
 assert.equal(value.resolutionReason,"helper-has-control-flow-or-multiple-blocks");
 assert.equal(report.totals.nestedCallsUnresolved,1);
});
test("rejects virtual dispatch inside a helper instead of guessing its implementation",()=>{
 const inner=method("dynamic","(I)I",0x0001,[ins("iload_1",0),ins("ireturn",1)]);
 const outer=method("outer","(I)I",0x0008,[ins("iload_0",0),ins("invokevirtual",1,{member:call(owner,"dynamic","(I)I")}),ins("ireturn",4)]);
 const value=valueOf(analyzer.analyze(fixture({root:outer,helpers:[inner],args:[{kind:"constant",constantValue:1,category:1}]})));
 assert.equal(value.resolutionStatus,"unresolved");
 assert.equal(value.resolutionReason,"nested-invocation-dispatch-not-exact");
});
test("stops a nested chain at the configured hard depth bound",()=>{
 const chain=[];
 for(let i=0;i<8;i++){
  const instructions=i===7?[ins("iconst_1",0),ins("ireturn",1)]:[ins("invokestatic",0,{member:call(owner,"helper"+(i+1),"()I")}),ins("ireturn",3)];
  chain.push(method("helper"+i,"()I",0x0008,instructions));
 }
 const report=analyzer.analyze(fixture({root:chain[0],helpers:chain.slice(1)})),value=valueOf(report);
 assert.equal(value.resolutionStatus,"unresolved");
 assert.equal(value.resolutionReason,"nested-helper-depth-limit-exceeded");
 assert.equal(report.totals.depthLimitHits,1);
});
test("checks category-2 arguments before entering a nested helper",()=>{
 const inner=method("acceptInt","(I)I",0x0008,[ins("iload_0",0),ins("ireturn",1)]);
 const outer=method("outer","(J)J",0x0008,[ins("lload_0",0),ins("invokestatic",1,{member:call(owner,"acceptInt","(I)I")}),ins("lreturn",4)]);
 const value=valueOf(analyzer.analyze(fixture({root:outer,helpers:[inner],args:[{kind:"constant",constantKind:"long",constantValue:4,descriptor:"J",category:2}]})));
 assert.equal(value.resolutionStatus,"unresolved");
 assert.equal(value.resolutionReason,"nested-helper-argument-category-mismatch");
});
test("enforces the summary-count budget across the nested call tree",()=>{
 const inner=method("identity","(I)I",0x0008,[ins("iload_0",0),ins("ireturn",1)]);
 const outer=method("outer","(I)I",0x0008,[ins("iload_0",0),ins("invokestatic",1,{member:call(owner,"identity","(I)I")}),ins("ireturn",4)]);
 const report=analyzer.analyze(fixture({root:outer,helpers:[inner],args:[{kind:"constant",constantValue:7,category:1}]}),{summaryLimit:1});
 const value=valueOf(report);
 assert.equal(value.resolutionStatus,"unresolved");
 assert.equal(value.resolutionReason,"helper-summary-limit-exceeded");
 assert.equal(report.totals.detailsTruncated,true);
});
test("resolves helper calls inside call arguments before resolving the outer helper",()=>{
 const inner=method("constantValue","()I",0x0008,[ins("iconst_5",0),ins("ireturn",1)]);
 const outer=method("doubleValue","(I)I",0x0008,[ins("iload_0",0),ins("iconst_2",1),ins("imul",2),ins("ireturn",3)]);
 const caller={name:"serverTick",descriptor:"()V",accessFlags:0,code:{instructions:[
  ins("invokestatic",50,{member:call(owner,"constantValue","()I")}),
  ins("invokestatic",100,{member:call(owner,"doubleValue","(I)I")})
 ]}};
 const arg={kind:"method-result",pc:50,methodOwner:owner,methodName:"constantValue",methodDescriptor:"()I",descriptor:"I",category:1,arguments:[]};
 const root={kind:"method-result",pc:100,methodOwner:owner,methodName:"doubleValue",methodDescriptor:"(I)I",descriptor:"I",category:1,arguments:[arg]};
 const input={crossBlockDataflow:{schema:"jar2zeus.machine-state-cross-block-dataflow.v1",methods:[{sourceClass:owner,methodName:"serverTick",methodDescriptor:"()V",branches:[{operandOrigins:[root]}]}]},classes:[{classInfo:{valid:true,className:owner,methods:[caller,inner,outer]}}]};
 const report=analyzer.analyze(input),value=valueOf(report);
 assert.equal(value.resolutionStatus,"resolved");
 assert.equal(value.expression.kind,"calculated-value");
 assert.equal(value.expression.operator,"imul");
 assert.equal(value.expression.operands[0].kind,"interprocedural-summary-result");
 assert.equal(value.expression.operands[0].expression.constantValue,5);
 assert.equal(report.totals.topLevelCallsResolved,2);
});
test("excludes blocked weapon-related class paths",()=>{
 const blocked="sample/weapon/CannonMachine";
 const root=method("simple","()I",0x0008,[ins("iconst_1",0),ins("ireturn",1)]);
 const caller={name:"serverTick",descriptor:"()V",accessFlags:0,code:{instructions:[ins("invokestatic",100,{member:call(blocked,"simple","()I")})]}};
 const input={crossBlockDataflow:{schema:"jar2zeus.machine-state-cross-block-dataflow.v1",methods:[{sourceClass:blocked,methodName:"serverTick",methodDescriptor:"()V",branches:[{operandOrigins:[{kind:"method-result",pc:100,methodOwner:blocked,methodName:"simple",methodDescriptor:"()I",descriptor:"I",category:1,arguments:[]}]}]}]},classes:[{classInfo:{valid:true,className:blocked,methods:[caller,root]}}]};
 const report=analyzer.analyze(input);
 assert.equal(report.methods.length,0);
 assert.equal(report.javaMethodsExecuted,false);
 assert.equal(report.nestedHelperCallsInspected,true);
});
test("reports bounded symbolic-only analysis metadata",()=>{
 const inner=method("identity","(I)I",0x0008,[ins("iload_0",0),ins("ireturn",1)]);
 const outer=method("outer","(I)I",0x0008,[ins("iload_0",0),ins("invokestatic",1,{member:call(owner,"identity","(I)I")}),ins("ireturn",4)]);
 const report=analyzer.analyze(fixture({root:outer,helpers:[inner],args:[{kind:"constant",constantValue:3,category:1}]}),{methodLimit:1,totalCallLimit:4,topCallLimit:2,summaryLimit:4});
 assert.equal(report.schema,"jar2zeus.machine-state-nested-helper-summaries.v1");
 assert.equal(report.nestedHelperCallsInspected,true);
 assert.equal(report.nestedHelperOriginsRecovered,true);
 assert.equal(report.javaMethodsExecuted,false);
 assert.equal(report.runtimeValuesRecovered,false);
 assert.equal(report.branchOutcomesRecovered,false);
 assert.ok(report.totals.helperInstructionsAnalyzed<=50000);
});


test("rechecks cached helper depth when the same helper is reached from a deeper call path",()=>{
 const c=method("cachedChild","()I",0x0008,[ins("iconst_1",0),ins("ireturn",1)]);
 const b=method("cachedParent","()I",0x0008,[ins("invokestatic",0,{member:call(owner,"cachedChild","()I")}),ins("ireturn",3)]);
 const chain=[];
 for(let i=0;i<6;i++){
  const target=i===5?"cachedParent":"deep"+(i+1);
  chain.push(method("deep"+i,"()I",0x0008,[ins("invokestatic",0,{member:call(owner,target,"()I")}),ins("ireturn",3)]));
 }
 const caller={name:"serverTick",descriptor:"()V",accessFlags:0,code:{instructions:[
  ins("invokestatic",100,{member:call(owner,"cachedParent","()I")}),
  ins("invokestatic",200,{member:call(owner,"deep0","()I")})
 ]}};
 const node=(pc,name)=>({kind:"method-result",pc,methodOwner:owner,methodName:name,methodDescriptor:"()I",descriptor:"I",category:1,arguments:[]});
 const input={crossBlockDataflow:{schema:"jar2zeus.machine-state-cross-block-dataflow.v1",methods:[{sourceClass:owner,methodName:"serverTick",methodDescriptor:"()V",branches:[{operandOrigins:[node(100,"cachedParent"),node(200,"deep0")]}]}]},classes:[{classInfo:{valid:true,className:owner,methods:[caller,b,c,...chain]}}]};
 const report=analyzer.analyze(input);
 const values=report.methods[0].branches[0].operandOrigins;
 assert.equal(values[0].resolutionStatus,"resolved");
 assert.equal(values[1].resolutionStatus,"unresolved");
 assert.equal(values[1].resolutionReason,"nested-helper-depth-limit-exceeded");
});


test("enforces the aggregate helper-instruction budget before analysis",()=>{
 const root=method("small","()I",0x0008,[ins("iconst_1",0),ins("ireturn",1)]);
 const report=analyzer.analyze(fixture({root}),{totalInstructionLimit:1});
 const value=valueOf(report);
 assert.equal(value.resolutionStatus,"unresolved");
 assert.equal(value.resolutionReason,"aggregate-helper-instruction-budget-exceeded");
 assert.equal(report.totals.helperInstructionsBudgeted,0);
 assert.equal(report.totals.detailsTruncated,true);
});
