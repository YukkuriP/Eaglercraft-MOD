/* Static Java lifecycle/event/timer analysis for Jar2Zeus.
 * Maps source-framework signals to documented, non-combat Zeus event candidates.
 * This module never executes Java and never emits event-handler Lua.
 */
(function(root){
 "use strict";
 const RESTRICTED=/(?:cannon|artillery|projectile|munition|firearm|weapon|rifle|pistol|musket|sword|bow|crossbow|trident)/i;
 const LIFECYCLE=new Map([
  ["onInitialize","loader-initializer"],
  ["onInitializeClient","client-initializer"],
  ["onInitializeServer","server-initializer"],
  ["onCommonSetup","common-setup-candidate"],
  ["onClientSetup","client-setup-candidate"],
  ["initialize","initializer-name-candidate"],
  ["init","initializer-name-candidate"],
  ["setup","setup-name-candidate"],
  ["register","registration-name-candidate"],
  ["load","load-name-candidate"],
  ["start","start-name-candidate"]
 ]);
 const REGISTRATION_APIS=[
  {framework:"Fabric",owners:new Set(["net/fabricmc/fabric/api/event/Event"]),methods:new Set(["register"])},
  {framework:"Forge",owners:new Set(["net/minecraftforge/eventbus/api/IEventBus","net/minecraftforge/eventbus/EventBus"]),methods:new Set(["register","addListener","addGenericListener"])},
  {framework:"NeoForge",owners:new Set(["net/neoforged/bus/api/IEventBus","net/neoforged/bus/impl/EventBus"]),methods:new Set(["register","addListener","addGenericListener"])}
 ];
 function registrationInfo(call){
  const owner=String(call&&call.owner||""),name=String(call&&call.name||"");
  for(const api of REGISTRATION_APIS)if(api.owners.has(owner)&&api.methods.has(name))return {framework:api.framework,owner,name};
  return null;
 }
 const DETAIL_LIMIT=5000;
 function appendDetail(report,key,value){
  report.observed[key]=(report.observed[key]||0)+1;
  if(report[key].length<DETAIL_LIMIT)report[key].push(value);
  else report.truncation[key]=true;
 }
 const EVENT_RULES=[
  {id:"fabric-client-tick",framework:"Fabric",pattern:/net\/fabricmc\/fabric\/api\/client\/event\/lifecycle\/v1\/ClientTickEvents/,events:["tick"],reason:"Client tick callback class is referenced; its Java callback payload and phase are not reconstructed."},
  {id:"fabric-client-connection",framework:"Fabric",pattern:/net\/fabricmc\/fabric\/api\/client\/networking\/v1\/ClientPlayConnectionEvents/,events:["world_join","world_leave"],reason:"Client connection callbacks are referenced; Java connection objects and event timing differ from Zeus payloads."},
  {id:"fabric-hud-render",framework:"Fabric",pattern:/net\/fabricmc\/fabric\/api\/client\/rendering\/v1\/HudRenderCallback/,events:["hud"],reason:"HUD rendering callback is referenced; rendering context and callback signature require a manual adapter."},
  {id:"fabric-world-render",framework:"Fabric",pattern:/net\/fabricmc\/fabric\/api\/client\/rendering\/v1\/WorldRenderEvents/,events:["render_world"],reason:"World-render phases and Java render context are not equivalent to the Zeus render event payload."},
  {id:"fabric-screen",framework:"Fabric",pattern:/net\/fabricmc\/fabric\/api\/client\/screen\/v1\/ScreenEvents/,events:["screen_open","screen_close"],reason:"Screen lifecycle classes are referenced; Java screen instances are not passed through to Zeus."},
  {id:"forge-client-tick",framework:"Forge",pattern:/net\/minecraftforge\/event\/TickEvent\$ClientTickEvent/,events:["tick"],reason:"Forge client-tick event type is referenced; phase and callback object are not reconstructed."},
  {id:"forge-gui-render",framework:"Forge",pattern:/net\/minecraftforge\/client\/event\/RenderGuiEvent/,events:["hud"],reason:"Forge GUI render event is referenced; rendering context requires a manual adapter."},
  {id:"forge-client-connection",framework:"Forge",pattern:/net\/minecraftforge\/client\/event\/ClientPlayerNetworkEvent/,events:["world_join","world_leave"],reason:"Client network lifecycle type is referenced; event subclasses and Java payload semantics remain unresolved."},
  {id:"forge-screen",framework:"Forge",pattern:/net\/minecraftforge\/client\/event\/ScreenEvent/,events:["screen_open","screen_close"],reason:"Forge screen lifecycle type is referenced; Java screen objects are not compatible with Zeus screen IDs."},
  {id:"neoforge-client-tick",framework:"NeoForge",pattern:/net\/neoforged\/neoforge\/event\/tick\/PlayerTickEvent|net\/neoforged\/neoforge\/event\/TickEvent\$ClientTickEvent/,events:["tick"],reason:"NeoForge tick event type is referenced; phase and callback object are not reconstructed."},
  {id:"neoforge-gui-render",framework:"NeoForge",pattern:/net\/neoforged\/neoforge\/client\/event\/RenderGuiEvent/,events:["hud"],reason:"NeoForge GUI render event is referenced; rendering context requires a manual adapter."},
  {id:"neoforge-client-connection",framework:"NeoForge",pattern:/net\/neoforged\/neoforge\/client\/event\/ClientPlayerNetworkEvent/,events:["world_join","world_leave"],reason:"NeoForge client connection event type is referenced; Java payload semantics remain unresolved."},
  {id:"neoforge-screen",framework:"NeoForge",pattern:/net\/neoforged\/neoforge\/client\/event\/ScreenEvent/,events:["screen_open","screen_close"],reason:"NeoForge screen lifecycle type is referenced; Java screen objects are not compatible with Zeus screen IDs."}
 ];
 // Registration is recognized by exact API owners above; arbitrary names containing "event" are not enough.
 const ZEUS_SAFE_EVENTS=new Set(["tick","frame","resize","hud","screen_render","overlay","screen_open","screen_close","chat_receive","chat_send","world_join","world_leave","mod_loaded","mod_unloaded","unload"]);
 function isRestricted(clazz){
  if(RESTRICTED.test(clazz.className||""))return true;
  for(const name of clazz.references||[])if(RESTRICTED.test(name))return true;
  for(const method of clazz.methods||[]){
   if(RESTRICTED.test(method.name||"")||RESTRICTED.test(method.descriptor||""))return true;
   const code=method.code||{};
   for(const call of code.invocations||[])if(RESTRICTED.test((call.owner||"")+"."+(call.name||"")+" "+(call.descriptor||"")))return true;
   for(const field of code.fieldAccesses||[])if(RESTRICTED.test((field.owner||"")+"."+(field.name||"")+" "+(field.descriptor||"")))return true;
   for(const value of code.stringConstants||[])if(RESTRICTED.test(value))return true;
  }
  return false;
 }
 function classEvidence(clazz){
  const values=[clazz.className||"",...(clazz.references||[])];
  for(const method of clazz.methods||[]){
   values.push(method.name||"",method.descriptor||"");
   for(const call of (method.code&&method.code.invocations)||[])values.push(call.owner||"",call.name||"",call.descriptor||"");
   for(const field of (method.code&&method.code.fieldAccesses)||[])values.push(field.owner||"",field.name||"",field.descriptor||"");
  }
  return Array.from(new Set(values.filter(Boolean)));
 }
 function normalizeEntrypointClass(value){
  let name=String(value||"").trim();
  if(!name)return null;
  const separator=name.indexOf("::");
  if(separator>=0)name=name.slice(0,separator);
  if(name.startsWith("L")&&name.endsWith(";"))name=name.slice(1,-1);
  if(name.includes("/"))return /^[A-Za-z0-9_$/]+$/.test(name)?name:null;
  if(/^[A-Za-z_$][A-Za-z0-9_$.]*$/.test(name))return name.replace(/\./g,"/");
  return null;
 }
 function loaderEntrypoints(loaderAnalysis,classNames,report){
  const rows=(loaderAnalysis&&loaderAnalysis.entrypoints)||[];
  report.observed.loaderEntrypoints=rows.length;
  report.truncation.loaderEntrypoints=rows.length>DETAIL_LIMIT;
  return rows.slice(0,DETAIL_LIMIT).map(row=>{
   const value=String(row.value||"").slice(0,512),className=normalizeEntrypointClass(value);
   return {
    loader:String(row.loader||"unknown"),
    type:String(row.type||"unknown"),
    value,
    className,
    resolution:className&&classNames.has(className)?"class-file-found":"metadata-entrypoint-string-only",
    javaClassResolved:!!(className&&classNames.has(className)),
    executionConfirmed:false,
    autoWired:false
   };
  });
 }
 function analyze(input){
  const classes=Array.isArray(input&&input.classes)?input.classes:[];
  const loaderAnalysis=input&&input.loaderAnalysis||{};
  const accepted=[],excluded=[];
  for(const clazz of classes){
   if(!clazz||!clazz.valid||typeof clazz.className!=="string")continue;
   if(isRestricted(clazz)){excluded.push(clazz.className);continue;}
   accepted.push(clazz);
  }
  const report={
   schema:"jar2zeus.java-event-lifecycle.v1",
   scope:"static class-file and loader metadata inspection only; Java callbacks are never executed or auto-wired",
   status:"analysis-only",
   loaders:Array.isArray(loaderAnalysis.loaders)?loaderAnalysis.loaders.slice():[],
   totals:{classesSeen:classes.length,classesAnalyzed:accepted.length,restrictedClassesSkipped:excluded.length,loaderEntrypoints:0,entrypointsResolved:0,entrypointsUnresolved:0,lifecycleCandidates:0,eventReferenceCandidates:0,eventRegistrationSites:0,ambiguousEventRegistrationSites:0,unclassifiedEventRegistrationSites:0,timerSites:0,annotationBearingMethods:0,autoWiredHandlers:0},
   observed:{loaderEntrypoints:0,lifecycleCandidates:0,eventReferenceCandidates:0,eventRegistrations:0,timerSites:0},
   truncation:{loaderEntrypoints:false,lifecycleCandidates:false,eventReferenceCandidates:false,eventRegistrations:false,timerSites:false},
   loaderEntrypoints:[],
   lifecycleCandidates:[],
   eventRegistrations:[],
   eventReferenceCandidates:[],
   timerSites:[],
   zeusEventCatalog:Array.from(ZEUS_SAFE_EVENTS),
   warnings:[],
   limitations:[
    "The class-file parser records annotation attribute names but does not decode annotation values; annotation-based listener bindings such as SubscribeEvent cannot be resolved.",
    "Fabric event fields, lambda bootstrap arguments, method handles and callback objects are not linked to their target Java methods.",
    "Forge and NeoForge event-bus registration calls are detected as sites only; their callback parameter, event subclass, listener priority and execution order are not reconstructed.",
    "Java listener method bodies, instance receivers, Java object state and exception paths are not executable in the current Java-to-Lua subset.",
    "A Zeus event name is only a candidate when a known source event class is referenced. Similar names do not prove equivalent timing, scope or payload.",
    "Zeus main.lua runs once at mod load and registers Lua listeners at top level. This analyzer does not synthesize those listeners from Java entrypoints.",
    "Timer schedules are only classified as candidates. Java scheduler semantics, cancellation handles, thread behavior and callback objects are not converted.",
    "Event registration is recognized only for exact known API owners and methods; third-party event-bus wrappers are left unclassified rather than guessed.",
    "If a class references multiple known event types, the analyzer cannot assign each one to a specific registration instruction."
   ],
   zeusRuntimeRules:{
    listenerRegistration:"Register Lua listeners at main.lua top level; that file runs once when the mod loads.",
    worldJoin:"world_join fires on an actual world join. A mod loaded while already in a world must check current world/player state separately.",
    tick:"tick fires 20 times per second, including title screen and menus.",
    timers:"timer.after and timer.every take seconds; timers are checked once per frame.",
    listenerRemoval:"Remove listeners with the returned handle or events.off(handle).",
    automaticPorting:"These runtime facts guide manual rewrites only; Java handlers are not synthesized."
   },
   sources:[
    "https://dev.eaglercraft.com/docs/modding/api",
    "https://dev.eaglercraft.com/docs/modding/events-and-timers",
    "https://dev.eaglercraft.com/docs/modding/how-mods-run"
   ]
  };
  const classNames=new Set(accepted.map(clazz=>clazz.className));
  report.loaderEntrypoints=loaderEntrypoints(loaderAnalysis,classNames,report);
  report.totals.loaderEntrypoints=report.observed.loaderEntrypoints;
  report.totals.entrypointsResolved=(loaderAnalysis.entrypoints||[]).filter(row=>{const name=normalizeEntrypointClass(row&&row.value);return !!(name&&classNames.has(name));}).length;
  report.totals.entrypointsUnresolved=report.totals.loaderEntrypoints-report.totals.entrypointsResolved;
  const registrationIds=new Set();
  for(const clazz of accepted){
   const evidence=classEvidence(clazz);
   const matches=EVENT_RULES.filter(rule=>evidence.some(value=>rule.pattern.test(value)));
   const classRegistrationRules=new Set();
   for(const method of clazz.methods||[]){
    if(LIFECYCLE.has(method.name)){
     appendDetail(report,"lifecycleCandidates",{
      className:clazz.className,method:method.name,descriptor:method.descriptor,
      static:!!(method.accessFlags&8),codePresent:!!method.code,abstract:!!(method.accessFlags&1024),
      kind:LIFECYCLE.get(method.name),confidence:"name-only",evidence:"method-name heuristic; loader invocation and actual execution are not proven",
      autoWired:false
     });
    }else if(method.name==="<clinit>"){
     appendDetail(report,"lifecycleCandidates",{
      className:clazz.className,method:method.name,descriptor:method.descriptor,
      static:true,codePresent:!!method.code,kind:"class-initializer",confidence:"class-file-structure",evidence:"static initializer exists; its semantics and loader execution order are not reconstructed",
      autoWired:false
     });
    }
    const annotationAttributes=(method.attributes||[]).filter(name=>/Annotations$/.test(name));
    if(annotationAttributes.length)report.totals.annotationBearingMethods++;
    const calls=(method.code&&method.code.invocations)||[];
    for(const call of calls){
     const registration=registrationInfo(call);
     if(!registration)continue;
     const id=clazz.className+"."+method.name+method.descriptor+"@"+call.pc+":"+registration.owner+"."+registration.name;
     if(registrationIds.has(id))continue;
     registrationIds.add(id);
     const sourceFramework=registration.framework;
     const sourceFrameworkCandidates=Array.from(new Set(matches.map(rule=>rule.framework)));
     const candidateRules=matches.filter(rule=>rule.events.every(event=>ZEUS_SAFE_EVENTS.has(event)));
     const eventCandidates=Array.from(new Set(candidateRules.flatMap(rule=>rule.events)));
     if(matches.length>1)report.totals.ambiguousEventRegistrationSites++;
     if(!eventCandidates.length)report.totals.unclassifiedEventRegistrationSites++;
     for(const rule of candidateRules)classRegistrationRules.add(rule.id);
     appendDetail(report,"eventRegistrations",{
      id,className:clazz.className,method:method.name,descriptor:method.descriptor,pc:Number.isInteger(call.pc)?call.pc:null,
      sourceFramework,sourceFrameworkCandidates,registrationOwner:registration.owner,registrationMethod:registration.name,
      registrationApi:"exact-owner-and-method-match",sourceRuleResolution:matches.length===1?"single-class-level-fingerprint":matches.length>1?"ambiguous-class-level-fingerprints":"no-known-source-event-fingerprint",
      sourceRuleIds:candidateRules.map(rule=>rule.id),zeusEventCandidates:eventCandidates,
      status:eventCandidates.length?"candidate-only":"unclassified-registration-site",
      callbackResolved:false,callbackParameterRecovered:false,autoWired:false,
      reason:matches.length>1?
       "Multiple known event types are referenced by this class; they cannot be assigned to this particular registration site.":eventCandidates.length?
       "A known event class is referenced in this class, but its link to this registration instruction, callback target, Java signature, payload and behavior is not reconstructed.":
       "A recognized event-bus registration call was found without a known source-event fingerprint; manual analysis is required."
     });
    }
    for(const call of calls){
     const owner=String(call.owner||""),name=String(call.name||"");
     const isTimerOwner=/^java\/util\/(?:Timer|concurrent\/(?:ScheduledExecutorService|ScheduledThreadPoolExecutor))$/.test(owner);
     const isTimerMethod=["schedule","scheduleAtFixedRate","scheduleWithFixedDelay"].includes(name);
     if(!isTimerOwner||!isTimerMethod)continue;
     const recurring=name==="scheduleAtFixedRate"||name==="scheduleWithFixedDelay";
     appendDetail(report,"timerSites",{
      className:clazz.className,method:method.name,descriptor:method.descriptor,pc:Number.isInteger(call.pc)?call.pc:null,
      javaOwner:owner,javaMethod:name,javaDescriptor:call.descriptor||null,
      periodicity:name==="scheduleAtFixedRate"?"fixed-rate":name==="scheduleWithFixedDelay"?"fixed-delay":"unknown-single-or-periodic",
      hasTimeUnitParameter:/Ljava\/util\/concurrent\/TimeUnit;/.test(call.descriptor||""),
      zeusApiCandidates:recurring?["timer.every"]:["timer.after","timer.every"],
      status:"candidate-only",callbackResolved:false,autoWired:false,
      reason:"Java scheduler callback, actual delay values and units, cancellation, exception policy and threading are not reconstructed. Zeus timer.after/every use seconds and timers are checked once per frame; choose and implement the equivalent explicitly."
     });
    }
   }
   for(const rule of matches){
    if(!classRegistrationRules.has(rule.id)){
     appendDetail(report,"eventReferenceCandidates",{
      className:clazz.className,sourceFramework:rule.framework,sourceRuleId:rule.id,
      zeusEventCandidates:rule.events.filter(event=>ZEUS_SAFE_EVENTS.has(event)),
      status:"reference-only",registrationDetected:false,callbackResolved:false,autoWired:false,
      reason:rule.reason
     });
    }
   }
  }
  report.totals.lifecycleCandidates=report.observed.lifecycleCandidates;
  report.totals.eventReferenceCandidates=report.observed.eventReferenceCandidates;
  report.totals.eventRegistrationSites=report.observed.eventRegistrations;
  report.totals.timerSites=report.observed.timerSites;
  report.reportedCounts={loaderEntrypoints:report.loaderEntrypoints.length,lifecycleCandidates:report.lifecycleCandidates.length,eventReferenceCandidates:report.eventReferenceCandidates.length,eventRegistrations:report.eventRegistrations.length,timerSites:report.timerSites.length};
  report.detailLimit=DETAIL_LIMIT;
  if(report.eventRegistrations.length)report.warnings.push("Event registration sites were found, but no Java callback was connected to a Zeus listener.");
  if(report.eventReferenceCandidates.length)report.warnings.push("Known source event classes were referenced without a proven registration site; these are not confirmed listeners.");
  if(report.timerSites.length)report.warnings.push("Java timer/scheduler calls were found, but no timer callback was converted.");
  if(report.totals.annotationBearingMethods)report.warnings.push("Annotation-bearing methods exist; annotation values are not decoded, so annotation-based event subscriptions may be missing.");
  if(report.loaderEntrypoints.length)report.warnings.push("Loader metadata contains entrypoint declarations. Entrypoint classes and execution behavior require a loader-specific rewrite.");
  if(!report.totals.eventRegistrationSites&&!report.totals.eventReferenceCandidates&&!report.totals.timerSites)report.warnings.push("No supported event-registration or timer pattern was confirmed from the available class-file evidence.");
  if(Object.values(report.truncation).some(Boolean))report.warnings.push("Some detail arrays reached the 5,000-entry reporting cap; observed totals remain accurate, but not every detail row is stored.");
  report.plan=[
   {task:"review-lifecycle-methods",pending:report.totals.lifecycleCandidates+report.totals.annotationBearingMethods,requiredWork:"Confirm whether name-based or annotation-bearing methods are real loader/event entrypoints; decode annotations and verify execution before rewriting."},
   {task:"resolve-loader-entrypoints",pending:report.totals.loaderEntrypoints,requiredWork:"Resolve the declared loader entrypoint and replace it with safe top-level Lua initialization."},
   {task:"rewrite-event-listeners",pending:report.totals.eventRegistrationSites+report.totals.eventReferenceCandidates,requiredWork:"Resolve the Java callback and port its behavior manually to an equivalent documented Zeus listener."},
   {task:"rewrite-timers",pending:report.totals.timerSites,requiredWork:"Reimplement supported timing behavior with documented Zeus timer APIs and explicit cancellation handling."}
  ].filter(task=>task.pending>0);
  report.status=report.totals.eventRegistrationSites||report.totals.eventReferenceCandidates||report.totals.timerSites||report.totals.loaderEntrypoints||report.totals.lifecycleCandidates||report.totals.annotationBearingMethods?"partial-analysis":"no-event-hooks-detected";
  // No generated Lua is returned by design: this stage is evidence and planning only.
  return report;
 }
 root.Jar2ZeusEventLifecycle={analyze};
})(typeof globalThis!=="undefined"?globalThis:this);
