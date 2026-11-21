const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
require(path.join(__dirname, "..", "machine-state-cross-block-dataflow.js"));
const analyzer = globalThis.Jar2ZeusMachineStateCrossBlockDataflow;
const owner = "sample/machine/CrusherBlockEntity";
function ins(name,pc,extra={}){return Object.assign({name,pc},extra);}
function fixture({blocks,edges,instructions,descriptor="()V",className=owner,branches=[{branchBlockId:blocks[blocks.length-1].id,pc:instructions[instructions.length-2].pc,opcode:instructions[instructions.length-2].name,relatedWrites:[]}]}){
 const method={name:"serverTick",descriptor,accessFlags:0,code:{instructions,verification:{valid:true,structuralOnly:true,controlFlow:{basicBlocks:blocks,edges}}}};
 return {conditionOperands:{schema:"jar2zeus.machine-condition-operands.v1",methods:[{methodId:className+".serverTick"+descriptor,sourceClass:className,methodName:"serverTick",methodDescriptor:descriptor,branches}]},classes:[{classInfo:{valid:true,className,methods:[method]}}]};
}
function report(input,options){return analyzer.analyze(input,options).methods[0].branches[0];}
test("propagates a value stored in one basic block into a later branch block",()=>{
 const input=fixture({
  blocks:[{id:0,start:0,end:4},{id:1,start:4,end:7},{id:2,start:7,end:8}],
  edges:[{from:0,to:1,kind:"branch"},{from:1,to:2,kind:"conditional-true"},{from:1,to:2,kind:"conditional-false"}],
  instructions:[ins("iconst_5",0),ins("istore_1",1),ins("goto",2,{target:4}),ins("iload_1",4),ins("ifle",5,{target:7}),ins("return",7)]
 });
 const b=report(input);
 assert.equal(b.status,"resolved");
 assert.equal(b.operandOrigins[0].kind,"constant");
 assert.equal(b.operandOrigins[0].constantValue,5);
});
test("keeps the same incoming parameter origin across a multi-predecessor merge",()=>{
 const input=fixture({
  descriptor:"(I)V",
  blocks:[{id:0,start:0,end:3},{id:1,start:3,end:5},{id:2,start:5,end:7},{id:3,start:7,end:10}],
  edges:[{from:0,to:1,kind:"conditional-true"},{from:0,to:2,kind:"conditional-false"},{from:1,to:3,kind:"branch"},{from:2,to:3,kind:"branch"}],
  instructions:[ins("iconst_0",0),ins("ifeq",1,{target:5}),ins("goto",3,{target:7}),ins("goto",5,{target:7}),ins("iload_1",7),ins("ifle",8,{target:10}),ins("return",10)],
  branches:[{branchBlockId:3,pc:8,opcode:"ifle",relatedWrites:[]}]
 });
 const b=report(input);
 assert.equal(b.status,"resolved");
 assert.equal(b.operandOrigins[0].kind,"method-parameter");
 assert.equal(b.operandOrigins[0].parameterIndex,0);
});
test("preserves distinct static origins as a partial merged value",()=>{
 const input=fixture({
  blocks:[{id:0,start:0,end:2},{id:1,start:2,end:5},{id:2,start:5,end:8},{id:3,start:8,end:11}],
  edges:[{from:0,to:1,kind:"conditional-true"},{from:0,to:2,kind:"conditional-false"},{from:1,to:3,kind:"branch"},{from:2,to:3,kind:"branch"}],
  instructions:[ins("iconst_0",0),ins("ifeq",1,{target:5}),ins("iconst_1",2),ins("istore_2",3),ins("goto",4,{target:8}),ins("iconst_2",5),ins("istore_2",6),ins("goto",7,{target:8}),ins("iload_2",8),ins("ifle",9,{target:11}),ins("return",11)],
  branches:[{branchBlockId:3,pc:9,opcode:"ifle",relatedWrites:[]}]
 });
 const b=report(input);
 assert.equal(b.status,"partial");
 assert.equal(b.operandOrigins[0].kind,"merged-value");
 assert.equal(b.operandOrigins[0].inputs.length,2);
});
test("treats exception-handler locals and stack values as unknown",()=>{
 const input=fixture({
  blocks:[{id:0,start:0,end:2},{id:1,start:2,end:5}],
  edges:[{from:0,to:1,kind:"exception"}],
  instructions:[ins("nop",0),ins("return",1),ins("ifeq",2,{target:5}),ins("return",5)],
  branches:[{branchBlockId:1,pc:2,opcode:"ifeq",relatedWrites:[]}]
 });
 const b=report(input);
 assert.equal(b.status,"partial");
 assert.equal(b.operandOrigins[0].kind,"unknown-exception");
});
test("rejects incompatible operand-stack heights at a block merge",()=>{
 const input=fixture({
  blocks:[{id:0,start:0,end:2},{id:1,start:2,end:4},{id:2,start:4,end:5},{id:3,start:5,end:7}],
  edges:[{from:0,to:1,kind:"conditional-true"},{from:0,to:2,kind:"conditional-false"},{from:1,to:3,kind:"branch"},{from:2,to:3,kind:"branch"}],
  instructions:[ins("iconst_0",0),ins("ifeq",1,{target:4}),ins("iconst_1",2),ins("goto",3,{target:5}),ins("goto",4,{target:5}),ins("ifeq",5,{target:7}),ins("return",7)],
  branches:[{branchBlockId:3,pc:5,opcode:"ifeq",relatedWrites:[]}]
 });
 const b=report(input);
 assert.equal(b.status,"unsupported");
 assert.equal(b.reason,"incompatible-operand-stack-heights-at-merge");
});
test("does not propagate through unsupported bytecode",()=>{
 const input=fixture({
  blocks:[{id:0,start:0,end:2},{id:1,start:2,end:4}],
  edges:[{from:0,to:1,kind:"branch"}],
  instructions:[ins("jsr",0,{target:2}),ins("goto",1,{target:2}),ins("iload_1",2),ins("ifeq",3,{target:4}),ins("return",4)],
  branches:[{branchBlockId:1,pc:3,opcode:"ifeq",relatedWrites:[]}]
 });
 const b=report(input);
 assert.equal(b.status,"unsupported");
});
test("bounds loop-carried analysis and converges conservatively",()=>{
 const input=fixture({
  blocks:[{id:0,start:0,end:3},{id:1,start:3,end:6},{id:2,start:6,end:8},{id:3,start:8,end:9}],
  edges:[{from:0,to:1,kind:"branch"},{from:1,to:2,kind:"conditional-false"},{from:1,to:3,kind:"conditional-true"},{from:2,to:1,kind:"branch"}],
  instructions:[ins("iconst_0",0),ins("istore_1",1),ins("goto",2,{target:3}),ins("iload_1",3),ins("ifeq",4,{target:8}),ins("iinc",6,{local:1,increment:1}),ins("goto",7,{target:3}),ins("return",8)],
  branches:[{branchBlockId:1,pc:4,opcode:"ifeq",relatedWrites:[]}]
 });
 const result=analyzer.analyze(input),b=result.methods[0].branches[0];
 assert.equal(b.dataFlowConverged,true);
 assert.ok(["partial","resolved"].includes(b.status));
 assert.ok(result.totals.dataFlowIterations<=64*2);
});
test("excludes blocked class paths",()=>{
 const input=fixture({className:"sample/weapon/CannonMachine",blocks:[{id:0,start:0,end:2}],edges:[],instructions:[ins("iconst_0",0),ins("ifeq",1,{target:2})],branches:[{branchBlockId:0,pc:1,opcode:"ifeq",relatedWrites:[]}]});
 const result=analyzer.analyze(input);
 assert.equal(result.methods.length,0);
});
test("reports analysis limits without claiming runtime execution",()=>{
 const input=fixture({blocks:[{id:0,start:0,end:3}],edges:[],instructions:[ins("iconst_0",0),ins("ifeq",1,{target:3}),ins("return",2)],branches:[{branchBlockId:0,pc:1,opcode:"ifeq",relatedWrites:[]}]});
 const result=analyzer.analyze(input,{branchLimit:1,methodLimit:1});
 assert.equal(result.schema,"jar2zeus.machine-state-cross-block-dataflow.v1");
 assert.equal(result.javaMethodsExecuted,false);
 assert.equal(result.runtimeValuesRecovered,false);
});
