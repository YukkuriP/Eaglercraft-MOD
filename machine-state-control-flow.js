/* Static machine update control-flow analysis (Phase 29).
 * Uses the structural CFG already produced by Jar2ZeusBytecodeVerifier.
 * Never executes Java, evaluates branch conditions, or reconstructs runtime values.
 */
(function(root){
"use strict";
const BLOCKED=/(?:cannon|artillery|projectile|munition|firearm|weapon|rifle|pistol|musket|sword|bow|crossbow|trident)/i;
const MAX_METHODS=1000,MAX_BLOCKS=512,MAX_EDGES=4096,MAX_WRITES=2000,MAX_ITERATIONS=512,MAX_CANDIDATES_PER_WRITE=24,MAX_REPORT_WRITERS=1200;
const BRANCH=/^(?:ifeq|ifne|iflt|ifge|ifgt|ifle|if_icmpeq|if_icmpne|if_icmplt|if_icmpge|if_icmpgt|if_icmple|if_acmpeq|if_acmpne|ifnull|ifnonnull|tableswitch|lookupswitch)$/;
function arr(v){return Array.isArray(v)?v:[];}
function safe(v){return typeof v==="string"&&!BLOCKED.test(v);}
function norm(v){return String(v||"").replace(/\\./g,"/").replace(/^L|;$/g,"");}
function methodId(owner,name,desc){return norm(owner)+"."+String(name||"")+String(desc||"");}
function intersection(sets,universe){
 if(!sets.length)return new Set();
 const out=new Set(sets[0]);
 for(const value of out){for(let i=1;i<sets.length;i++)if(!sets[i].has(value)){out.delete(value);break;}}
 return out;
}
function equalSet(a,b){if(a.size!==b.size)return false;for(const x of a)if(!b.has(x))return false;return true;}
function buildGraph(cf){
 const blocks=arr(cf&&cf.basicBlocks),edges=arr(cf&&cf.edges);
 if(!blocks.length||blocks.length>MAX_BLOCKS||edges.length>MAX_EDGES)return {ok:false,reason:"cfg-size-out-of-bounds"};
 const byId=new Map(),ids=[];
 for(const b of blocks){
  if(!b||!Number.isInteger(b.id)||!Number.isInteger(b.start)||!Number.isInteger(b.end)||b.start<0||b.end<=b.start||byId.has(b.id))return {ok:false,reason:"cfg-basic-block-shape-invalid"};
  byId.set(b.id,b);ids.push(b.id);
 }
 const succ=new Map(ids.map(id=>[id,[]])),pred=new Map(ids.map(id=>[id,[]])),normalizedEdges=[];
 for(const e of edges){
  if(!e||!byId.has(e.from)||!byId.has(e.to)||typeof e.kind!=="string")return {ok:false,reason:"cfg-edge-shape-invalid"};
  if(!succ.get(e.from).includes(e.to))succ.get(e.from).push(e.to);
  if(!pred.get(e.to).includes(e.from))pred.get(e.to).push(e.from);
  normalizedEdges.push({from:e.from,to:e.to,kind:e.kind});
 }
 const entry=blocks.slice().sort((a,b)=>a.start-b.start)[0].id;
 const reachable=new Set(),queue=[entry];
 while(queue.length){const n=queue.shift();if(reachable.has(n))continue;reachable.add(n);for(const to of succ.get(n)||[])if(!reachable.has(to))queue.push(to);}
 if(!reachable.size)return {ok:false,reason:"cfg-entry-unreachable"};
 const sinks=Array.from(reachable).filter(n=>(succ.get(n)||[]).every(to=>!reachable.has(to)));
 if(!sinks.length)return {ok:false,reason:"cfg-has-no-reachable-exit"};
 const universe=new Set(reachable),dom=new Map(),postdom=new Map();
 for(const n of reachable){dom.set(n,n===entry?new Set([n]):new Set(universe));postdom.set(n,sinks.includes(n)?new Set([n]):new Set(universe));}
 let changed=true,iterations=0;
 while(changed&&iterations<MAX_ITERATIONS){
  changed=false;iterations++;
  for(const n of reachable){
   if(n===entry)continue;
   const ps=(pred.get(n)||[]).filter(x=>reachable.has(x));
   const next=intersection(ps.map(x=>dom.get(x)||new Set()),universe);next.add(n);
   if(!equalSet(next,dom.get(n))){dom.set(n,next);changed=true;}
  }
 }
 const dominatorsConverged=!changed;
 changed=true;let postIterations=0;
 while(changed&&postIterations<MAX_ITERATIONS){
  changed=false;postIterations++;
  const order=Array.from(reachable).sort((a,b)=>byId.get(b).start-byId.get(a).start);
  for(const n of order){
   if(sinks.includes(n))continue;
   const ss=(succ.get(n)||[]).filter(x=>reachable.has(x));
   if(!ss.length)continue;
   const next=intersection(ss.map(x=>postdom.get(x)||new Set()),universe);next.add(n);
   if(!equalSet(next,postdom.get(n))){postdom.set(n,next);changed=true;}
  }
 }
 const postdominatorsConverged=!changed;
 return {ok:dominatorsConverged&&postdominatorsConverged,reason:dominatorsConverged&&postdominatorsConverged?null:"cfg-fixed-point-limit",blocks,byId,edges:normalizedEdges,succ,pred,entry,reachable,sinks,dom,postdom,iterations,postIterations};
}
function analyze(input,options){
 input=input&&typeof input==="object"?input:{};options=options&&typeof options==="object"?options:{};
 const update=input.updateConditions||{},classes=arr(input.classes),classMap=new Map();
 for(const entry of classes){
  const c=entry&&entry.classInfo?entry.classInfo:entry;
  if(c&&c.valid===true&&safe(c.className))classMap.set(norm(c.className),c);
 }
 const methodLimit=Math.min(MAX_METHODS,Number.isInteger(options.methodLimit)&&options.methodLimit>0?options.methodLimit:MAX_METHODS);
 const reportWriters=[],totals={writerMethodsSeen:0,writerMethodsAnalyzed:0,writerMethodsMissing:0,writerMethodsWithoutValidCfg:0,writerMethodsWithInvalidCfg:0,writesSeen:0,writesAnalyzed:0,controlDependenceCandidates:0,writesWithNoControlDependenceFound:0,writeInstructionsMissing:0,unreachableWriteBlocks:0,controlFlowIterations:0,detailsTruncated:false};
 let methodSeen=0,writeBudget=0;
 for(const writer of arr(update.writers)){
  if(methodSeen>=methodLimit){totals.detailsTruncated=true;break;}
  methodSeen++;totals.writerMethodsSeen++;
  if(!writer||!safe(writer.sourceClass)||!safe(writer.methodName))continue;
  const c=classMap.get(norm(writer.sourceClass));
  if(!c){totals.writerMethodsMissing++;continue;}
  const m=arr(c.methods).find(x=>x&&x.name===writer.methodName&&(x.descriptor||null)===(writer.methodDescriptor||null));
  const code=m&&m.code,verification=code&&code.verification,cf=verification&&verification.controlFlow;
  if(!code||!verification||verification.valid!==true||verification.structuralOnly!==true||!cf){totals.writerMethodsWithoutValidCfg++;continue;}
  const graph=buildGraph(cf);
  if(!graph.ok){
   if(graph.reason==="cfg-size-out-of-bounds"||graph.reason==="cfg-basic-block-shape-invalid"||graph.reason==="cfg-edge-shape-invalid"||graph.reason==="cfg-fixed-point-limit")totals.writerMethodsWithInvalidCfg++;
   else totals.writerMethodsWithoutValidCfg++;
   continue;
  }
  totals.writerMethodsAnalyzed++;totals.controlFlowIterations+=graph.iterations+graph.postIterations;
  const instructions=arr(code.instructions),blocks=graph.blocks;
  const normalBranchKinds=new Set(["conditional-true","conditional-false","switch-case","switch-default"]);
  const branchNodes=[];
  for(const b of blocks){
   if(!BRANCH.test(String(b.lastOpcode||"")))continue;
   const outs=graph.edges.filter(e=>e.from===b.id&&normalBranchKinds.has(e.kind)&&graph.reachable.has(e.to));
   if(outs.length>=2)branchNodes.push({block:b,edges:outs});
  }
  const writeResults=[];
  for(const write of arr(writer.writes)){
   totals.writesSeen++;
   if(writeBudget>=MAX_WRITES){totals.detailsTruncated=true;break;}
   writeBudget++;
   const ins=instructions.find(x=>x&&x.pc===write.pc&&x.name===write.opcode);
   if(!ins){totals.writeInstructionsMissing++;writeResults.push({pc:write.pc,fieldName:write.fieldName,status:"write-instruction-not-found",controlDependenceCandidates:[],controlDependenceProven:false});continue;}
   const block=blocks.find(b=>write.pc>=b.start&&write.pc<b.end);
   if(!block){totals.writeInstructionsMissing++;writeResults.push({pc:write.pc,fieldName:write.fieldName,status:"write-pc-outside-cfg-blocks",controlDependenceCandidates:[],controlDependenceProven:false});continue;}
   if(!graph.reachable.has(block.id)){totals.unreachableWriteBlocks++;writeResults.push({pc:write.pc,fieldName:write.fieldName,status:"write-block-unreachable",writeBlockId:block.id,controlDependenceCandidates:[],controlDependenceProven:false});continue;}
   const candidates=[];
   for(const branch of branchNodes){
    const branchId=branch.block.id;
    if(branchId===block.id||!graph.dom.get(block.id).has(branchId))continue;
    if(graph.postdom.get(branchId).has(block.id))continue;
    for(const edge of branch.edges){
     const successorPostdom=graph.postdom.get(edge.to);
     if(successorPostdom&&successorPostdom.has(block.id)){
      candidates.push({branchBlockId:branchId,branchStartPc:branch.block.start,branchOpcode:branch.block.lastOpcode,branchPc:(instructions.find(x=>x&&x.pc>=branch.block.start&&x.pc<branch.block.end&&x.name===branch.block.lastOpcode)||{}).pc??null,successorBlockId:edge.to,successorEdgeKind:edge.kind,branchBlockDominatesWriteBlock:true,writeBlockPostdominatesSuccessor:true,writeBlockPostdominatesBranchBlock:false,evidence:"structural-cfg-control-dependence"});
      if(candidates.length>=MAX_CANDIDATES_PER_WRITE)break;
     }
    }
    if(candidates.length>=MAX_CANDIDATES_PER_WRITE)break;
   }
   totals.writesAnalyzed++;
   if(candidates.length)totals.controlDependenceCandidates+=candidates.length;else totals.writesWithNoControlDependenceFound++;
   writeResults.push({pc:write.pc,fieldName:write.fieldName,opcode:write.opcode,writeBlockId:block.id,status:candidates.length?"cfg-control-dependence-candidate":"no-control-dependence-found-in-cfg",controlDependenceCandidates:candidates,controlDependenceProven:false,staticCfgRelationshipEstablished:candidates.length>0});
  }
  if(writeResults.length)reportWriters.push({methodId:writer.methodId||methodId(writer.sourceClass,writer.methodName,writer.methodDescriptor),sourceClass:writer.sourceClass,methodName:writer.methodName,methodDescriptor:writer.methodDescriptor,role:writer.role||null,cfg:{status:"structural-cfg-analyzed",entryBlockId:graph.entry,blockCount:graph.blocks.length,edgeCount:graph.edges.length,reachableBlockCount:graph.reachable.size,unreachableBlockCount:graph.blocks.length-graph.reachable.size,exitBlockCount:graph.sinks.length,exceptionEdgesIncluded:graph.edges.some(e=>e.kind==="exception"),dominatorIterations:graph.iterations,postdominatorIterations:graph.postIterations},writes:writeResults});
 }
 totals.writerMethodsAnalyzed=totals.writerMethodsAnalyzed;
 totals.writerMethodsOmitted=Math.max(0,arr(update.writers).length-methodSeen);
 totals.writesReported=reportWriters.reduce((n,w)=>n+w.writes.length,0);
 totals.detailsTruncated=totals.detailsTruncated||totals.writesSeen>MAX_WRITES||reportWriters.length>MAX_REPORT_WRITERS;
 return {schema:"jar2zeus.machine-state-control-flow.v1",status:totals.controlDependenceCandidates?"cfg-control-dependence-candidates-found":totals.writerMethodsAnalyzed?"structural-cfg-analyzed-no-control-dependence-found":"control-flow-analysis-unavailable",supportStatus:"bounded-structural-cfg-dominator-and-postdominator-analysis",sourceUpdateConditionsSchema:update.schema||null,writers:reportWriters.slice(0,MAX_REPORT_WRITERS),manualTasks:[{area:"control-dependence",status:"structural-cfg-candidate-only",reason:"Candidates use the verifier CFG's dominator and postdominator relations. The CFG is structural, exception-table edges are conservative approximations, and this is not proof of runtime branch evaluation or Java control semantics."},{area:"branch-condition-value",status:"not-recovered",reason:"No comparison operands, boolean values, stack provenance or runtime branch outcomes are evaluated."},{area:"execution-order-and-timing",status:"not-recovered",reason:"Static reachability does not establish runtime call order, tick schedule, threading, server/client authority or external dispatch."}],limitations:["Only methods with a valid structural verification report and a bounded CFG are analyzed.","Dominators and postdominators are computed over the verifier's full edge set, including conservative exception-table edges where present.","A candidate requires the branch block to dominate the write block, the write block to postdominate one branch successor, and the write block not to postdominate the branch block.","The analyzer does not execute Java, evaluate conditions, recover assignment values, determine runtime timing or create event hooks.","Reflection, virtual dispatch, native code, dynamically linked targets, and external methods are unresolved."],totals,javaMethodsExecuted:false,controlDependenceRecovered:false,conditionOperandsRecovered:false,branchOutcomesRecovered:false,assignmentValuesRecovered:false,updateTimingRecovered:false,sourceRuntimeValuesRecovered:false,sourceReaderCallbacksGenerated:0,eventPublicationsWired:0,liveValuesConnected:false,arbitraryJavaBlockEntityAccess:false,reportFile:"machine-state-control-flow-plan.json"};
}
root.Jar2ZeusMachineStateControlFlow={analyze:analyze};
})(typeof globalThis!=="undefined"?globalThis:this);
