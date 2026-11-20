/* Aggregate parsed JVM bytecode into migration-oriented metrics and call relationships.
 * Input class records come from Jar2ZeusBytecode.parse; no bytecode is executed.
 */
(function(root){
 "use strict";
 const ENTRY_NAMES=new Set(["<clinit>","<init>","init","initialize","onInitialize","onCommonSetup","onClientSetup","register","setup","load","start"]);
 const BRANCH=/^(?:if|goto|jsr)/;
 function methodId(c,m){return String(c.className||"<unknown>")+"."+String(m.name||"<unnamed>")+String(m.descriptor||"");}
 function analyze(classes){
  const list=(classes||[]).filter(c=>c&&c.valid),classNames=new Set(list.map(c=>c.className));
  const report={
   schema:"jar2zeus.bytecode-analysis.v1",
   scope:"static class-file and bytecode analysis only; no Java execution or full JVM type verification",
   totals:{classesSeen:(classes||[]).length,validClasses:list.length,methodsSeen:0,methodsWithCode:0,methodsWithoutCode:0,methodsVerified:0,methodsRejected:0,decodeErrors:0,instructions:0,basicBlocks:0,controlFlowEdges:0,branches:0,loopBackEdges:0,exceptionHandlers:0,invocations:0,internalInvocations:0,externalInvocations:0,dynamicCallSites:0,unreachableBlocks:0},
   classVersions:{},opcodeFrequency:{},methodSummaries:[],callGraph:{nodes:[],edges:[],truncated:false},
   entrypointCandidates:[],externalCallOwners:{},methodSummariesTruncated:false,warnings:[]
  };
  const nodeIds=new Set(),methodNodes=new Set(),edges=[];
  for(const c of list){
   report.classVersions[c.major]=(report.classVersions[c.major]||0)+1;
   for(const m of c.methods||[]){const id=methodId(c,m);nodeIds.add(id);methodNodes.add(id);}
  }
  for(const c of list){
   for(const m of c.methods||[]){
    report.totals.methodsSeen++;
    if(!m.code){report.totals.methodsWithoutCode++;continue;}
    report.totals.methodsWithCode++;
    const code=m.code,ins=code.instructions||[],verification=code.verification||{},cfg=verification.controlFlow||{};
    const id=methodId(c,m);
    report.totals.instructions+=ins.length;
    report.totals.exceptionHandlers+=(code.exceptions||[]).length;
    if(code.decodeError){report.totals.decodeErrors++;report.totals.methodsRejected++;}
    else if(verification.valid)report.totals.methodsVerified++;
    else report.totals.methodsRejected++;
    report.totals.basicBlocks+=cfg.counts&&cfg.counts.blocks||0;
    report.totals.controlFlowEdges+=cfg.counts&&cfg.counts.edges||0;
    report.totals.loopBackEdges+=cfg.counts&&cfg.counts.loops||0;
    report.totals.unreachableBlocks+=cfg.counts&&cfg.counts.unreachableBlocks||0;
    let branchCount=0,dynamicCount=0;
    for(const x of ins){
     const op=x.name||"unknown";
     report.opcodeFrequency[op]=(report.opcodeFrequency[op]||0)+1;
     if(BRANCH.test(op)||op==="tableswitch"||op==="lookupswitch")branchCount++;
     if(op==="invokedynamic")dynamicCount++;
    }
    report.totals.branches+=branchCount;
    report.totals.dynamicCallSites+=dynamicCount;
    const calls=code.invocations||[];
    report.totals.invocations+=calls.length;
    let internal=0,external=0;
    for(const call of calls){
     const owner=call.owner||"<unknown>";
     if(classNames.has(owner)){
      internal++;report.totals.internalInvocations++;
      const targetId=owner+"."+String(call.name||"")+String(call.descriptor||"");
      if(edges.length<20000)edges.push({from:id,to:targetId,kind:methodNodes.has(targetId)?"resolved-method-call":"unresolved-internal-method-call"});
      else report.callGraph.truncated=true;
     }else{
      external++;report.totals.externalInvocations++;
      report.externalCallOwners[owner]=(report.externalCallOwners[owner]||0)+1;
     }
    }
    if(ENTRY_NAMES.has(m.name))report.entrypointCandidates.push({className:c.className,method:m.name,descriptor:m.descriptor,static:!!(m.accessFlags&8),evidence:"method-name heuristic; not proof of loader registration"});
    if(report.methodSummaries.length<3000){
     report.methodSummaries.push({
      id,className:c.className,name:m.name,descriptor:m.descriptor,accessFlags:m.accessFlags,
      instructionCount:ins.length,branchCount,exceptionHandlers:(code.exceptions||[]).length,
      invocations:calls.length,internalInvocations:internal,externalInvocations:external,dynamicCallSites:dynamicCount,
      verified:verification.valid===true,verificationErrors:(verification.errors||[]).slice(0,8),
      controlFlow:cfg.counts||{blocks:0,edges:0,loops:0,unreachableBlocks:0},
      complexityEstimate:1+branchCount+(cfg.counts&&cfg.counts.loops||0)*2
     });
    }else report.methodSummariesTruncated=true;
   }
  }
  report.callGraph.nodes=Array.from(nodeIds).slice(0,10000);
  if(nodeIds.size>10000)report.callGraph.truncated=true;
  report.callGraph.edges=edges;
  report.opcodeFrequency=Object.fromEntries(Object.entries(report.opcodeFrequency).sort((a,b)=>b[1]-a[1]).slice(0,100));
  report.externalCallOwners=Object.fromEntries(Object.entries(report.externalCallOwners).sort((a,b)=>b[1]-a[1]).slice(0,100));
  report.entrypointCandidates.sort((a,b)=>a.className.localeCompare(b.className)||a.method.localeCompare(b.method));
  report.methodSummaries.sort((a,b)=>b.complexityEstimate-a.complexityEstimate);
  if(report.totals.methodsRejected)report.warnings.push("一部メソッドは命令構造検証に合格していません。自動再実装対象に含めないでください。");
  if(report.totals.dynamicCallSites)report.warnings.push("invokedynamicが存在します。BootstrapMethodsと実行時リンクの意味解析は別途必要です。");
  if(report.callGraph.truncated)report.warnings.push("巨大な呼び出しグラフの一部はレポート上限により省略されました。");
  if(report.methodSummariesTruncated)report.warnings.push("メソッド別詳細の一部はレポート上限により省略されました。");
  report.limits={methodSummaries:3000,callGraphNodes:10000,callGraphEdges:20000,opcodeKinds:100,externalCallOwners:100};
  return report;
 }
 root.Jar2ZeusBytecodeAnalysis={analyze};
})(typeof globalThis!=="undefined"?globalThis:this);
