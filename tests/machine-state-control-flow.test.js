const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
require(path.join(__dirname, "..", "machine-state-control-flow.js"));
const analyzer = globalThis.Jar2ZeusMachineStateControlFlow;
const owner = "sample/machine/CrusherBlockEntity";
const field = {kind:"field",owner,name:"progress",descriptor:"I"};
function ins(name,pc,extra={}){return Object.assign({name,pc},extra);}
function fixture({blocks,edges,instructions,valid=true}){
 const writer={methodId:owner+".serverTick()V",sourceClass:owner,methodName:"serverTick",methodDescriptor:"()V",role:{role:"tick-or-lifecycle"},writes:[{pc:instructions.find(x=>x.name==="putfield").pc,opcode:"putfield",fieldName:"progress"}]};
 const code={instructions,verification:{valid,structuralOnly:true,errors:[],controlFlow:{basicBlocks:blocks,edges}}};
 return {updateConditions:{schema:"jar2zeus.machine-state-update-conditions.v1",writers:[writer]},classes:[{classInfo:{valid:true,className:owner,methods:[{name:"serverTick",descriptor:"()V",code}]}}]};
}
const controlled=()=>fixture({
 blocks:[
  {id:0,start:0,end:4,instructionCount:2,firstOpcode:"iload_1",lastOpcode:"if_icmpge"},
  {id:1,start:4,end:7,instructionCount:1,firstOpcode:"goto",lastOpcode:"goto"},
  {id:2,start:7,end:11,instructionCount:2,firstOpcode:"aload_0",lastOpcode:"putfield"},
  {id:3,start:11,end:12,instructionCount:1,firstOpcode:"return",lastOpcode:"return"}
 ],
 edges:[
  {from:0,to:1,kind:"conditional-false"},
  {from:0,to:2,kind:"conditional-true"},
  {from:1,to:3,kind:"branch"},
  {from:2,to:3,kind:"fallthrough"}
 ],
 instructions:[ins("iload_1",0),ins("if_icmpge",1,{target:7}),ins("goto",4,{target:11}),ins("aload_0",7),ins("putfield",8,{member:field}),ins("return",11)]
});
test("finds a static control-dependence candidate from dominator/postdominator relations",()=>{
 const report=analyzer.analyze(controlled());
 assert.equal(report.schema,"jar2zeus.machine-state-control-flow.v1");
 assert.equal(report.totals.writesAnalyzed,1);
 const write=report.writers[0].writes[0];
 assert.equal(write.status,"cfg-control-dependence-candidate");
 assert.equal(write.controlDependenceCandidates[0].branchOpcode,"if_icmpge");
 assert.equal(write.controlDependenceCandidates[0].successorEdgeKind,"conditional-true");
 assert.equal(write.controlDependenceProven,false);
});
test("does not report a write after the two paths have joined",()=>{
 const input=controlled();
 input.updateConditions.writers[0].writes[0].pc=11;
 input.classes[0].classInfo.methods[0].code.instructions=[ins("iload_1",0),ins("if_icmpge",1,{target:7}),ins("goto",4,{target:11}),ins("nop",7),ins("putfield",11,{member:field}),ins("return",14)];
 input.classes[0].classInfo.methods[0].code.verification.controlFlow.basicBlocks=[
  {id:0,start:0,end:4,lastOpcode:"if_icmpge"},
  {id:1,start:4,end:7,lastOpcode:"goto"},
  {id:2,start:7,end:11,lastOpcode:"nop"},
  {id:3,start:11,end:15,lastOpcode:"return"}
 ];
 input.classes[0].classInfo.methods[0].code.verification.controlFlow.edges=[
  {from:0,to:1,kind:"conditional-false"},{from:0,to:2,kind:"conditional-true"},
  {from:1,to:3,kind:"branch"},{from:2,to:3,kind:"fallthrough"}
 ];
 const report=analyzer.analyze(input);
 assert.equal(report.writers[0].writes[0].status,"no-control-dependence-found-in-cfg");
});
test("does not claim control dependence for straight-line code",()=>{
 const input=fixture({
  blocks:[{id:0,start:0,end:3,lastOpcode:"return"}],
  edges:[],
  instructions:[ins("aload_0",0),ins("putfield",1,{member:field}),ins("return",2)]
 });
 const report=analyzer.analyze(input);
 assert.equal(report.writers[0].writes[0].status,"no-control-dependence-found-in-cfg");
});
test("rejects an invalid verifier result instead of using its CFG",()=>{
 const input=controlled();
 input.classes[0].classInfo.methods[0].code.verification.valid=false;
 const report=analyzer.analyze(input);
 assert.equal(report.totals.writerMethodsWithoutValidCfg,1);
 assert.equal(report.writers.length,0);
});
test("does not claim a control path when the CFG has no reachable exit",()=>{
 const input=controlled();
 const cfg=input.classes[0].classInfo.methods[0].code.verification.controlFlow;
 cfg.basicBlocks=[{id:0,start:0,end:4,lastOpcode:"if_icmpge"},{id:1,start:4,end:7,lastOpcode:"goto"},{id:2,start:7,end:11,lastOpcode:"goto"},{id:3,start:11,end:14,lastOpcode:"goto"}];
 cfg.edges=[{from:0,to:1,kind:"conditional-false"},{from:0,to:2,kind:"conditional-true"},{from:1,to:2,kind:"branch"},{from:2,to:3,kind:"branch"},{from:3,to:0,kind:"branch"}];
 const report=analyzer.analyze(input);
 assert.equal(report.totals.writerMethodsWithoutValidCfg,1);
 assert.equal(report.writers.length,0);
});
test("rejects malformed CFG edges and excludes blocked classes",()=>{
 const input=controlled();
 input.classes[0].classInfo.methods[0].code.verification.controlFlow.edges.push({from:99,to:0,kind:"branch"});
 input.updateConditions.writers.push(Object.assign({},input.updateConditions.writers[0],{sourceClass:"sample/weapon/CannonEntity"}));
 const report=analyzer.analyze(input);
 assert.equal(report.totals.writerMethodsWithInvalidCfg,1);
 assert.equal(report.totals.writerMethodsMissing,1);
});
