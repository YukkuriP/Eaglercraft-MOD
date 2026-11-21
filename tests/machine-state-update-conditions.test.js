const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
require(path.join(__dirname, "..", "machine-state-update-conditions.js"));
const analyzer = globalThis.Jar2ZeusMachineStateUpdateConditions;
const owner = "sample/machine/CrusherBlockEntity";
const field = {kind:"field",owner,name:"progress",descriptor:"I"};
function ins(name,pc,extra={}){return Object.assign({name,pc},extra);}
function fixture(instructions){
 const writer={methodId:owner+".serverTick()V",sourceClass:owner,methodName:"serverTick",methodDescriptor:"()V",role:{role:"tick-or-lifecycle"},fieldWrites:[{pc:instructions.find(x=>x.name==="putfield").pc,opcode:"putfield",fieldName:"progress"}]};
 return {writeTrace:{schema:"jar2zeus.machine-state-write-trace.v1",writerMethods:[writer]},classes:[{classInfo:{valid:true,className:owner,methods:[{name:"serverTick",descriptor:"()V",code:{instructions,decodeError:null}}]}}]};
}
test("records nearby comparison, branch, and field-read evidence without claiming a guard",()=>{
 const input=fixture([ins("aload_0",0),ins("getfield",1,{member:field}),ins("iload_1",4),ins("if_icmpge",5,{target:15}),ins("aload_0",8),ins("iconst_1",9),ins("putfield",10,{member:field})]);
 const report=analyzer.analyze(input),write=report.writers[0].writes[0];
 assert.equal(report.schema,"jar2zeus.machine-state-update-conditions.v1");
 assert.equal(write.nearbyComparisons.length,1);
 assert.equal(write.nearbyBranches.length,1);
 assert.equal(write.fieldReadsBeforeWrite[0].name,"progress");
 assert.equal(write.controlDependenceProven,false);
 assert.equal(report.controlDependenceRecovered,false);
});
test("does not invent conditions for a straight-line write",()=>{
 const report=analyzer.analyze(fixture([ins("aload_0",0),ins("iload_1",1),ins("putfield",2,{member:field})]));
 assert.equal(report.writers[0].writes[0].contextStatus,"no-nearby-condition-instructions");
 assert.equal(report.writers[0].writes[0].nearbyBranches.length,0);
});
test("lists helper calls before the write as position-only evidence",()=>{
 const call={kind:"method",owner,name:"canProcess",descriptor:"()Z"};
 const report=analyzer.analyze(fixture([ins("aload_0",0),ins("invokevirtual",1,{member:call}),ins("aload_0",4),ins("putfield",5,{member:field})]));
 assert.equal(report.writers[0].writes[0].callsBeforeWrite[0].name,"canProcess");
 assert.equal(report.writers[0].writes[0].controlDependenceProven,false);
});
test("reports missing write offsets and decode errors conservatively",()=>{
 const input=fixture([ins("return",0)]);
 input.writeTrace.writerMethods[0].fieldWrites[0].pc=99;
 let report=analyzer.analyze(input);
 assert.equal(report.writers[0].writes[0].contextStatus,"write-instruction-not-found");
 input.classes[0].classInfo.methods[0].code.decodeError="bad";
 report=analyzer.analyze(input);
 assert.equal(report.totals.decodeErrors,1);
 assert.equal(report.writers.length,0);
});
test("excludes blocked class names from analyzed class records",()=>{
 const input=fixture([ins("aload_0",0),ins("putfield",1,{member:field})]);
 input.writeTrace.writerMethods.push(Object.assign({},input.writeTrace.writerMethods[0],{sourceClass:"sample/weapon/CannonEntity"}));
 const report=analyzer.analyze(input);
 assert.equal(report.writers.length,1);
 assert.equal(report.totals.writerMethodsMissing,1);
});
