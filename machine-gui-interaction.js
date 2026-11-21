/* Conservative machine GUI, menu, slot, interaction and synchronization analysis. Static analysis only. */
(function(root){
"use strict";
const LIMIT=5000;
const BLOCKED=/(?:cannon|artillery|projectile|munition|firearm|weapon|rifle|pistol|musket|sword|bow|crossbow|trident)/i;
const SCREEN_BASES=new Set([
"net/minecraft/client/gui/screens/Screen",
"net/minecraft/client/gui/screens/inventory/AbstractContainerScreen",
"net/minecraft/client/gui/screens/inventory/ContainerScreen",
"net/minecraft/client/gui/screens/recipebook/RecipeBookComponent",
"net/minecraft/client/gui/GuiScreen",
"net/minecraft/client/gui/inventory/GuiContainer",
"net/minecraft/client/gui/screen/Screen",
"net/minecraft/client/gui/screen/ingame/HandledScreen"
]);
const MENU_BASES=new Set([
"net/minecraft/world/inventory/AbstractContainerMenu",
"net/minecraft/world/inventory/ContainerMenu",
"net/minecraft/inventory/Container",
"net/minecraft/screen/ScreenHandler",
"net/minecraft/container/Container"
]);
const SLOT_BASES=new Set([
"net/minecraft/world/inventory/Slot",
"net/minecraft/world/inventory/SlotItemHandler",
"net/minecraft/inventory/Slot",
"net/minecraft/screen/slot/Slot"
]);
const WIDGET_BASES=new Set([
"net/minecraft/client/gui/components/AbstractWidget",
"net/minecraft/client/gui/components/Button",
"net/minecraft/client/gui/components/events/GuiEventListener",
"net/minecraft/client/gui/GuiButton",
"net/minecraft/client/gui/widget/ClickableWidget",
"net/minecraft/client/gui/widget/PressableWidget"
]);
const SCREEN_METHODS={
init:"screen_initialize",added:"screen_opened",removed:"screen_closed",
render:"screen_render",renderBg:"screen_background_render",renderBackground:"screen_background_render",
renderLabels:"screen_labels_render",containerTick:"screen_container_tick",tick:"screen_tick",
resize:"screen_resize",onClose:"screen_close_handler",shouldCloseOnEsc:"screen_escape_policy",
mouseClicked:"screen_mouse_click",mouseReleased:"screen_mouse_release",mouseDragged:"screen_mouse_drag",
mouseScrolled:"screen_mouse_scroll",mouseMoved:"screen_mouse_move",keyPressed:"screen_key_press",
keyReleased:"screen_key_release",charTyped:"screen_text_input",initGui:"screen_initialize",
drawScreen:"screen_render",actionPerformed:"screen_action_handler"
};
const MENU_METHODS={
addSlot:"menu_slot_register",addDataSlot:"menu_data_slot_register",
quickMoveStack:"menu_quick_move",clicked:"menu_slot_click",clickMenuButton:"menu_button_click",
stillValid:"menu_validity_check",broadcastChanges:"menu_state_broadcast",
broadcastFullState:"menu_full_state_broadcast",slotsChanged:"menu_slots_changed",
removed:"menu_removed",getCarried:"menu_carried_item_read",setCarried:"menu_carried_item_write",
getSlot:"menu_slot_lookup",getSlots:"menu_slots_read",getData:"menu_data_read",
setData:"menu_data_write",getStateId:"menu_state_id_read",incrementStateId:"menu_state_id_increment",
sendAllDataToRemote:"menu_data_sync",sendSlotChange:"menu_slot_sync",
moveItemStackTo:"menu_item_transfer",clearContainer:"menu_clear",tryClear:"menu_clear_attempt",
canTakeItemForPickAll:"menu_pick_all_check",onTake:"menu_slot_take",broadcastChangesToListeners:"menu_state_broadcast"
};
const SLOT_METHODS={
mayPlace:"slot_insert_permission_check",mayPickup:"slot_take_permission_check",
getItem:"slot_item_read",set:"slot_item_write",remove:"slot_item_remove",
onTake:"slot_take_callback",onQuickCraft:"slot_quick_craft_callback",
getMaxStackSize:"slot_stack_limit_read",getNoItemIcon:"slot_empty_icon_read",
isActive:"slot_active_check",hasItem:"slot_has_item"
};
const WIDGET_METHODS={
onPress:"widget_button_press",onClick:"widget_click",onChange:"widget_value_change",
setValue:"widget_value_write",getValue:"widget_value_read",setMessage:"widget_label_write",
setText:"widget_text_write",getMessage:"widget_label_read",setFocused:"widget_focus_write",
isFocused:"widget_focus_read",isMouseOver:"widget_hover_check",renderWidget:"widget_render",
renderButton:"widget_button_render",mouseClicked:"widget_mouse_click",keyPressed:"widget_key_press",
onRelease:"widget_release"
};
const SYNC_METHODS={
setChanged:"gui_data_dirty",broadcastChanges:"gui_state_broadcast",
broadcastFullState:"gui_full_state_broadcast",sendToServer:"gui_client_to_server_send",
sendToPlayer:"gui_server_to_client_send",send:"gui_packet_send",sendPacket:"gui_packet_send",
handle:"gui_packet_handle",encode:"gui_packet_encode",decode:"gui_packet_decode",
getUpdatePacket:"gui_update_packet_create",onDataPacket:"gui_update_packet_receive",
getUpdateTag:"gui_update_tag_create",handleUpdateTag:"gui_update_tag_apply",
setData:"gui_synced_data_write",getData:"gui_synced_data_read",
addDataSlot:"gui_data_slot_register",addListener:"gui_listener_register",
sendAllDataToRemote:"gui_data_sync",containerChanged:"gui_container_changed",
onSlotChanged:"gui_slot_changed",slotChanged:"gui_slot_changed"
};
const CLICK_METHOD_RE=/(?:onPress|onClick|clicked|mouseClicked|actionPerformed|buttonClicked|clickMenuButton|pressButton|onWidgetActivation|onValueChanged|valueChanged|onSubmit|keyPressed)/i;
const KEY_METHOD_RE=/(?:keyPressed|keyReleased|charTyped|keyTyped|handleKey|onKey)/i;
const SYNC_OWNER_RE=/(?:network|packet|payload|channel|clientbound|serverbound|friendlybytebuf|custompayload|networkevent|connection|dataslot|containerdata|intreferenceholder|trackeddata)/i;
const SCREEN_NAME_RE=/(?:screen|guiscreen|containerscreen|handledscreen|machine.*gui|gui.*machine|machine.*screen|screen.*machine)/i;
const MENU_NAME_RE=/(?:menu|container|screenhandler|guihandler|machine.*handler|handler.*machine)/i;
const SLOT_NAME_RE=/(?:slot|slotitemhandler)/i;
const WIDGET_NAME_RE=/(?:widget|button|slider|checkbox|textfield|editbox|label|tab|panel)/i;
const MACHINE_UI_RE=/(?:machine|processor|furnace|smelter|crusher|mixer|generator|assembler|refinery|centrifuge|mill|press|pump|tank|workbench|fabricator|brewer|washer|chemical|alloy)/i;
const GUI_FIELD_RE=/(?:imagewidth|imageheight|leftpos|toppos|guiwidth|guiheight|xpos|ypos|widget|button|selected|focused|visible|active|enabled|progress|cooktime|burntime|energy|power|temperature|pressure|fluid|tank|fuel|input|output|slot|tab|page|scroll|text|label|title|status|state|mode|recipe|work|process|heat|capacity|amount)/i;
const GUI_RESOURCE_RE=/(?:^|\/)(?:gui|guis|screen|screens|menu|menus|container|containers)(?:\/|$)|\/textures\/(?:gui|screen|container)(?:\/|$)/i;
const LANG_RESOURCE_RE=/\/lang\/[^/]+\.json$/i;
const GUI_JSON_RE=/(?:^|\/)(?:gui|guis|screen|screens|menu|menus|container|containers)\/.*\.json$/i;
const VANILLA_GUI_OWNER_RE=/(?:\/gui\/screens?\/|\/gui\/components?\/|\/gui\/widgets?\/|\/world\/inventory\/|\/screen\/|\/screen\/ingame\/|\/screen\/widget\/|\/screen\/slot\/|\/inventory\/Container$|\/inventory\/Slot$)/;
function norm(v){return typeof v==="string"?v.replace(/\\./g,"/").replace(/^L|;$/g,""):"";}
function blocked(v){return BLOCKED.test(String(v||""));}
function short(v){const s=String(v||"").split("/").pop()||"";return s.split("$").pop();}
function isScreenOwner(owner){return SCREEN_BASES.has(owner)||/\/gui\/screens?\/|\/client\/gui\/GuiScreen$|\/client\/gui\/screen\/Screen$/.test(owner);}
function isMenuOwner(owner){return MENU_BASES.has(owner)||/AbstractContainerMenu|ScreenHandler|ContainerMenu/.test(short(owner));}
function isSlotOwner(owner){return SLOT_BASES.has(owner)||short(owner)==="Slot"||short(owner)==="SlotItemHandler";}
function isWidgetOwner(owner){return WIDGET_BASES.has(owner)||/(?:AbstractWidget|GuiButton|ClickableWidget|PressableWidget|EditBox|TextField|Button|Slider|Checkbox|CycleButton|GuiEventListener)$/.test(short(owner));}
function ownerKinds(owner){
 const out=[];
 if(isScreenOwner(owner))out.push("screen");
 if(isMenuOwner(owner))out.push("menu");
 if(isSlotOwner(owner))out.push("slot");
 if(isWidgetOwner(owner))out.push("widget");
 if(SYNC_OWNER_RE.test(owner))out.push("sync");
 return out;
}
function operation(owner,name,sourceName){
 if(blocked(owner)||blocked(sourceName))return null;
 const kinds=ownerKinds(owner);
 if(SCREEN_METHODS[name]&&(kinds.includes("screen")||SCREEN_NAME_RE.test(sourceName||"")))return {kind:"screen",candidate:SCREEN_METHODS[name]};
 if(MENU_METHODS[name]&&(kinds.includes("menu")||MENU_NAME_RE.test(sourceName||"")))return {kind:"menu",candidate:MENU_METHODS[name]};
 if(SLOT_METHODS[name]&&(kinds.includes("slot")||SLOT_NAME_RE.test(sourceName||"")))return {kind:"slot",candidate:SLOT_METHODS[name]};
 if(WIDGET_METHODS[name]&&(kinds.includes("widget")||WIDGET_NAME_RE.test(sourceName||"")))return {kind:"widget",candidate:WIDGET_METHODS[name]};
 if(/(?:DataSlot|ContainerData|IntReferenceHolder|TrackedData)/i.test(short(owner))&&name==="get")return {kind:"synchronization",candidate:"gui_synced_value_read"};
 if(/(?:DataSlot|ContainerData|IntReferenceHolder|TrackedData)/i.test(short(owner))&&name==="set")return {kind:"synchronization",candidate:"gui_synced_value_write"};
 if(SYNC_METHODS[name]&&(kinds.includes("sync")||kinds.some(k=>k==="menu"||k==="screen")))return {kind:"synchronization",candidate:SYNC_METHODS[name]};
 if(CLICK_METHOD_RE.test(name)&&kinds.some(k=>k==="screen"||k==="menu"||k==="widget"))return {kind:"interaction",candidate:"gui_interaction_callback"};
 if(KEY_METHOD_RE.test(name)&&kinds.includes("screen"))return {kind:"interaction",candidate:"gui_keyboard_callback"};
 if((name==="addRenderableWidget"||name==="addWidget"||name==="addButton"||name==="button"||name==="toggle"||name==="slider"||name==="textField"||name==="textArea"||name==="list"||name==="canvas")&&kinds.includes("screen"))return {kind:"widget",candidate:"gui_widget_register"};
 return null;
}
function fieldCategory(name){
 const n=String(name||"").toLowerCase();
 if(/(?:progress|cooktime|burntime|worktime|processtime)/.test(n))return "process-progress";
 if(/(?:energy|power|temperature|pressure|fluid|tank|fuel|capacity|amount|heat)/.test(n))return "machine-gauge";
 if(/(?:slot|inventory|input|output|itemstack)/.test(n))return "inventory-state";
 if(/(?:imagewidth|imageheight|leftpos|toppos|width|height|x|y)/.test(n))return "layout-coordinate";
 if(/(?:button|selected|focused|visible|active|enabled|mode|tab|page)/.test(n))return "widget-state";
 if(/(?:text|label|title|status)/.test(n))return "display-text";
 return "gui-state";
}
function resourceKind(path){
 if(blocked(path))return null;
 const p=String(path||"");
 if(/\.png$/i.test(p)&&GUI_RESOURCE_RE.test(p))return "gui-texture";
 if(GUI_JSON_RE.test(p))return "gui-definition-json";
 if(LANG_RESOURCE_RE.test(p))return "language-labels";
 if(GUI_RESOURCE_RE.test(p))return "gui-resource";
 return null;
}
function limitOf(v){const n=Number(v);return Number.isInteger(n)&&n>0?Math.min(n,LIMIT):LIMIT;}
function addBounded(arr,row,limit){if(arr.length<limit)arr.push(row);}
function analyze(input,options){
 input=input&&typeof input==="object"?input:{};
 options=options&&typeof options==="object"?options:{};
 const limit=limitOf(options.detailLimit),classes=Array.isArray(input.classes)?input.classes:[],resources=Array.isArray(input.resources)?input.resources:[];
 const report={schema:"jar2zeus.machine-gui-interaction.v1",status:"no-machine-gui-evidence",supportStatus:"static-analysis-and-migration-plan-only",detailLimit:limit,
 totals:{classesSeen:classes.length,classesAnalyzed:0,restrictedClassesSkipped:0,guiClasses:0,screenClasses:0,menuClasses:0,widgetClasses:0,slotClasses:0,machineRelatedGuiClasses:0,screenMenuLinks:0,slotRegistrationsObserved:0,dataSlotRegistrationsObserved:0,widgetRegistrationsObserved:0,buttonInteractionCandidates:0,keyboardInteractionCandidates:0,slotInteractionCandidates:0,guiSyncOperationsObserved:0,packetReferenceSites:0,guiStateFieldsObserved:0,guiResourceFilesSeen:resources.length,guiTextures:0,guiDefinitionJsonFiles:0,guiJsonReadErrors:0,guiJsonInvalid:0,languageResourceFiles:0,guiJsonWidgetsObserved:0,operationsObserved:0,operationsReported:0,fieldsObserved:0,fieldsReported:0,classesReported:0,resourcesReported:0,detailsTruncated:false},
 screens:[],menus:[],widgets:[],slots:[],screenMenuLinks:[],operations:[],fields:[],syncSites:[],resources:[],guiDefinitions:[],migrationTasks:[],
 limitations:[
 "Screen and menu classes are identified from parsed class hierarchy, descriptors, fields and invocation references; no Java code or UI is executed.",
 "A screen, menu, slot or widget match is a static candidate and does not establish a usable Zeus screen or equivalent widget.",
 "Widget text, position, texture, scaling, animation, localization, mouse hitboxes and accessibility semantics may be computed dynamically or by custom renderers.",
 "Slot validation and quick-move rules, menu lifecycle, server authority, packet payloads, synchronization order and stale-state handling are not reconstructed.",
 "Progress bars, gauges and machine values may be rendered directly in custom code rather than stored as named fields.",
 "GUI textures and JSON-like UI resources are inventoried by path and bounded structural inspection; proprietary binary layout formats are not decoded.",
 "No machine GUI is considered ported until screen layout, inputs, validation, persistence, server synchronization and close/reopen behavior are implemented and tested."
 ]};
 const classIndex=new Map(),evidence=new Map(),screens=[],menus=[],widgets=[],slots=[],operations=[],fields=[],syncSites=[],links=[];
 let operationsSeen=0,fieldsSeen=0;
 function push(arr,row){addBounded(arr,row,limit);}
 for(const entry of classes){
  const info=entry&&entry.classInfo?entry.classInfo:entry;
  if(!info||info.valid!==true||typeof info.className!=="string")continue;
  const name=norm(info.className),path=entry&&typeof entry.path==="string"?entry.path:name+".class";
  if(blocked(name)||blocked(path)){report.totals.restrictedClassesSkipped++;continue;}
  classIndex.set(name,{info,path});
  report.totals.classesAnalyzed++;
 }
 function inspectClass(name,rec){
  const info=rec.info,path=rec.path;
  const refs=new Set([].concat(info.references||[],info.superName||[],info.interfaces||[]).filter(Boolean).map(norm));
  const fieldsList=Array.isArray(info.fields)?info.fields:[];
  const methods=Array.isArray(info.methods)?info.methods:[];
  for(const f of fieldsList)for(const m of String(f&&f.descriptor||"").matchAll(/L([^;]+);/g))refs.add(norm(m[1]));
  for(const m of methods)for(const x of String(m&&m.descriptor||"").matchAll(/L([^;]+);/g))refs.add(norm(x[1]));
  for(const m of methods){
   const inv=m&&m.code&&Array.isArray(m.code.invocations)?m.code.invocations:[];
   for(const call of inv)if(call&&call.owner)refs.add(norm(call.owner));
  }
  const owners=Array.from(refs),parentRefs=[norm(info.superName||""),...(info.interfaces||[]).map(norm)].filter(Boolean);
  const methodNames=methods.map(m=>String(m&&m.name||""));
  const screenByRef=parentRefs.some(r=>isScreenOwner(r));
  const menuByRef=parentRefs.some(r=>isMenuOwner(r));
  const slotByRef=parentRefs.some(r=>isSlotOwner(r));
  const widgetByRef=parentRefs.some(r=>isWidgetOwner(r));
  const methodScreen=methodNames.some(n=>["init","initGui","render","drawScreen","renderBg","mouseClicked","keyPressed","containerTick"].includes(n));
  const methodMenu=methodNames.some(n=>["addSlot","addDataSlot","quickMoveStack","stillValid","broadcastChanges","clickMenuButton","moveItemStackTo"].includes(n));
  const methodSlot=methodNames.some(n=>["mayPlace","mayPickup","getItem","set","remove","onTake"].includes(n));
  const screenClass=screenByRef||(!menuByRef&&(SCREEN_NAME_RE.test(name)||SCREEN_NAME_RE.test(path))&&methodScreen);
  const menuClass=menuByRef||(!screenClass&&MENU_NAME_RE.test(name)&&(methodMenu||fieldsList.some(f=>/(?:slot|inventory|data)/i.test(String(f&&f.name||"")))));
  const slotClass=slotByRef||(!screenClass&&!menuClass&&SLOT_NAME_RE.test(name)&&(methodSlot||fieldsList.some(f=>/slot/i.test(String(f&&f.name||"")))));
  const widgetClass=widgetByRef||(!screenClass&&!menuClass&&!slotClass&&WIDGET_NAME_RE.test(name)&&(methodNames.some(n=>CLICK_METHOD_RE.test(n))||fieldsList.some(f=>/(?:x|y|width|height|visible|active|message|label|value)/i.test(String(f&&f.name||"")))));
  const screenMenuReferences=Array.from(refs).filter(r=>isMenuOwner(r)||/Menu$|ScreenHandler$|Container$/i.test(short(r)));
  const uiMethods=methodNames.filter(n=>SCREEN_METHODS[n]||MENU_METHODS[n]||SLOT_METHODS[n]||WIDGET_METHODS[n]||SYNC_METHODS[n]||CLICK_METHOD_RE.test(n)||KEY_METHOD_RE.test(n));
  const uiFields=fieldsList.filter(f=>GUI_FIELD_RE.test(String(f&&f.name||"")));
  const guiLike=screenClass||menuClass||slotClass||widgetClass||uiMethods.length>0||screenMenuReferences.length>0;
  const infoOut={name,path,info,refs,parents:parentRefs,methods,fieldsList,owners,screenClass,menuClass,slotClass,widgetClass,guiLike,screenMenuReferences,uiMethods,uiFields};
  evidence.set(name,infoOut);return infoOut;
 }
 for(const [name,rec] of classIndex)inspectClass(name,rec);
 // Mark in-repository descendants of recognized GUI bases or GUI subclasses.
 let changed=true;
 while(changed){
  changed=false;
  for(const [name,ev] of evidence){
   const parentKinds=new Set();
   for(const parent of ev.parents){
    const parentEv=evidence.get(parent);
    if(parentEv){
     if(parentEv.screenClass)parentKinds.add("screen");
     if(parentEv.menuClass)parentKinds.add("menu");
     if(parentEv.widgetClass)parentKinds.add("widget");
     if(parentEv.slotClass)parentKinds.add("slot");
    }
    if(isScreenOwner(parent))parentKinds.add("screen");
    if(isMenuOwner(parent))parentKinds.add("menu");
    if(isWidgetOwner(parent))parentKinds.add("widget");
    if(isSlotOwner(parent))parentKinds.add("slot");
   }
   if(parentKinds.has("screen")&&!ev.screenClass&&!ev.menuClass){ev.screenClass=true;ev.guiLike=true;changed=true;}
   if(parentKinds.has("menu")&&!ev.menuClass&&!ev.screenClass){ev.menuClass=true;ev.guiLike=true;changed=true;}
   if(parentKinds.has("widget")&&!ev.widgetClass){ev.widgetClass=true;ev.guiLike=true;changed=true;}
   if(parentKinds.has("slot")&&!ev.slotClass){ev.slotClass=true;ev.guiLike=true;changed=true;}
  }
 }
 const machineClassNames=new Set();
 const processReport=input.machineProcessAnalysis||{};
 for(const row of processReport.machineClasses||[])if(row&&row.className)machineClassNames.add(norm(row.className));
 for(const row of input.machineClassNames||[])if(typeof row==="string")machineClassNames.add(norm(row));
 for(const [name,ev] of evidence){
  if(!ev.guiLike)continue;
  const isMachine=machineClassNames.has(name)||MACHINE_UI_RE.test(name+" "+ev.path)||Array.from(ev.refs).some(r=>machineClassNames.has(r)||MACHINE_UI_RE.test(short(r))&&/(?:blockentity|machine|processor)/i.test(r));
  const chain=[];
  const seen=new Set(),queue=ev.parents.slice();
  while(queue.length){const p=queue.shift();if(seen.has(p))continue;seen.add(p);chain.push(p);const pe=evidence.get(p);if(pe)queue.push(...pe.parents);}
  const row={sourcePath:ev.path,className:name,superName:ev.info.superName||null,interfaces:(ev.info.interfaces||[]).map(norm),inheritanceChain:chain,screen:ev.screenClass,menu:ev.menuClass,widget:ev.widgetClass,slot:ev.slotClass,machineRelated:isMachine,menuReferences:ev.screenMenuReferences,uiMethodCandidates:ev.uiMethods.slice(0,100),guiStateFieldNames:ev.uiFields.map(f=>String(f&&f.name||"")).slice(0,100),adapterStatus:"unmapped"};
  push(ev.screenClass?screens:ev.menuClass?menus:ev.widgetClass?widgets:slots,row);
  report.totals.guiClasses++;
  if(ev.screenClass)report.totals.screenClasses++;
  if(ev.menuClass)report.totals.menuClasses++;
  if(ev.widgetClass)report.totals.widgetClasses++;
  if(ev.slotClass)report.totals.slotClasses++;
  if(isMachine)report.totals.machineRelatedGuiClasses++;
  if(ev.screenClass&&ev.screenMenuReferences.length){
   for(const target of ev.screenMenuReferences){
    push(links,{screenClass:name,menuReference:target,knownClass:classIndex.has(target),linkStatus:classIndex.has(target)?"class-reference-observed":"external-or-unresolved"});
    report.totals.screenMenuLinks++;
   }
  }
  for(const field of ev.uiFields){
   const fieldName=String(field&&field.name||""),descriptor=String(field&&field.descriptor||"");
   push(fields,{sourcePath:ev.path,sourceClass:name,name:fieldName,descriptor:descriptor||null,accessFlags:field.accessFlags==null?null:field.accessFlags,category:fieldCategory(fieldName),menuOrScreen:ev.screenClass?"screen":ev.menuClass?"menu":ev.widgetClass?"widget":"slot",portStatus:"unmapped"});
   fieldsSeen++;report.totals.guiStateFieldsObserved++;
  }
  for(const method of ev.methods){
   const methodName=String(method&&method.name||""),methodDescriptor=String(method&&method.descriptor||"");
   const invocations=method&&method.code&&Array.isArray(method.code.invocations)?method.code.invocations:[];
   let ownOperation=null;
   if(ev.screenClass&&SCREEN_METHODS[methodName])ownOperation={kind:"screen",candidate:SCREEN_METHODS[methodName]};
   else if(ev.menuClass&&MENU_METHODS[methodName])ownOperation={kind:"menu",candidate:MENU_METHODS[methodName]};
   else if(ev.slotClass&&SLOT_METHODS[methodName])ownOperation={kind:"slot",candidate:SLOT_METHODS[methodName]};
   else if(ev.widgetClass&&WIDGET_METHODS[methodName])ownOperation={kind:"widget",candidate:WIDGET_METHODS[methodName]};
   else if(SYNC_METHODS[methodName]&&ev.guiLike)ownOperation={kind:"synchronization",candidate:SYNC_METHODS[methodName]};
   else if(CLICK_METHOD_RE.test(methodName)&&ev.guiLike)ownOperation={kind:"interaction",candidate:"gui_interaction_callback"};
   else if(KEY_METHOD_RE.test(methodName)&&ev.screenClass)ownOperation={kind:"interaction",candidate:"gui_keyboard_callback"};
   if(ownOperation){
    push(operations,{sourcePath:ev.path,sourceClass:name,sourceMethod:methodName,sourceDescriptor:methodDescriptor,owner:name,name:methodName,descriptor:methodDescriptor,pc:null,category:ownOperation.kind,operationCandidate:ownOperation.candidate,evidence:"GUI/menu/slot/widget class method declaration",portStatus:"unmapped"});operationsSeen++;
    if(ownOperation.category==="interaction"||ownOperation.kind==="interaction"){
     if(KEY_METHOD_RE.test(methodName))report.totals.keyboardInteractionCandidates++;
     else report.totals.buttonInteractionCandidates++;
    }
    if(ownOperation.kind==="menu"&&ownOperation.candidate==="menu_slot_register")report.totals.slotRegistrationsObserved++;
    if(ownOperation.kind==="menu"&&ownOperation.candidate==="menu_data_slot_register")report.totals.dataSlotRegistrationsObserved++;
    if(ownOperation.kind==="slot")report.totals.slotInteractionCandidates++;
    if(ownOperation.kind==="widget"&&ownOperation.candidate==="gui_widget_register")report.totals.widgetRegistrationsObserved++;
    if(ownOperation.kind==="synchronization"||SYNC_METHODS[methodName])report.totals.guiSyncOperationsObserved++;
   }
   for(const inv of invocations){
    const owner=norm(inv&&inv.owner),member=String(inv&&inv.name||"");
    if(!owner||blocked(owner))continue;
    const mapped=operation(owner,member,name);
    if(!mapped)continue;
    push(operations,{sourcePath:ev.path,sourceClass:name,sourceMethod:methodName||null,sourceDescriptor:methodDescriptor||null,owner,name:member,descriptor:inv.descriptor||null,pc:Number.isInteger(inv.pc)?inv.pc:null,category:mapped.kind,operationCandidate:mapped.candidate,evidence:"Parsed bytecode invocation owner/name/descriptor",portStatus:"unmapped"});operationsSeen++;
    if(mapped.kind==="interaction"){
     if(KEY_METHOD_RE.test(member))report.totals.keyboardInteractionCandidates++;else report.totals.buttonInteractionCandidates++;
    }
    if(mapped.kind==="slot"||mapped.candidate==="menu_slot_click")report.totals.slotInteractionCandidates++;
    if(mapped.candidate==="menu_slot_register")report.totals.slotRegistrationsObserved++;
    if(mapped.candidate==="menu_data_slot_register")report.totals.dataSlotRegistrationsObserved++;
    if(mapped.candidate==="gui_widget_register")report.totals.widgetRegistrationsObserved++;
    if(mapped.kind==="synchronization"||mapped.candidate.includes("sync")||mapped.candidate.includes("packet")||mapped.candidate.includes("broadcast"))report.totals.guiSyncOperationsObserved++;
    if(SYNC_OWNER_RE.test(owner)){
     report.totals.packetReferenceSites++;
     push(syncSites,{sourcePath:ev.path,sourceClass:name,sourceMethod:methodName||null,owner,name:member,descriptor:inv.descriptor||null,pc:Number.isInteger(inv.pc)?inv.pc:null,syncEvidence:"packet/network/data-slot reference",adapterStatus:"unmapped"});
    }
   }
  }
 }
 function inspectGuiJson(entry){
  const path=String(entry&&entry.path||"");if(blocked(path))return;
  if(!GUI_JSON_RE.test(path))return;
  let data;
  report.totals.guiDefinitionJsonFiles++;
  if(entry&&entry.readError){
   report.totals.guiJsonReadErrors++;
   push(report.guiDefinitions,{sourcePath:path,status:"read-error",reason:entry.readErrorReason||"GUI JSON could not be read",widgetKinds:{},fieldPaths:[],nodes:0,truncated:false});
   return;
  }
  try{data=typeof entry.content==="string"?JSON.parse(entry.content):entry.json&&typeof entry.json==="object"?entry.json:null;}
  catch(e){
   report.totals.guiJsonInvalid++;
   push(report.guiDefinitions,{sourcePath:path,status:"invalid-json",reason:"GUI JSON is invalid",widgetKinds:{},fieldPaths:[],nodes:0,truncated:false});
   return;
  }
  if(!data||typeof data!=="object"||Array.isArray(data)){
   report.totals.guiJsonInvalid++;
   push(report.guiDefinitions,{sourcePath:path,status:"invalid-json",reason:"GUI JSON is not an object",widgetKinds:{},fieldPaths:[],nodes:0,truncated:false});
   return;
  }
  const widgetKinds={},paths=[];let nodes=0,truncated=false;
  const widgetKeys=/^(?:button|buttons|toggle|toggles|slider|sliders|textfield|text_field|textarea|text_area|list|lists|image|images|canvas|label|labels|widget|widgets|slot|slots|progress|progressbar|gauge|tab|tabs)$/i;
  const important=/^(?:x|y|width|height|id|type|text|label|title|tooltip|texture|value|min|max|step|visible|active|enabled|slot|progress|energy|power|temperature|pressure|fluid|fuel)$/i;
  function walk(value,keyPath,depth){
   nodes++;if(nodes>4000||depth>12){truncated=true;return;}
   if(value==null||typeof value!=="object")return;
   if(Array.isArray(value)){
    if(value.length>300)truncated=true;
    for(let n=0;n<value.length&&n<300;n++)walk(value[n],keyPath+"["+n+"]",depth+1);
    return;
   }
   const keys=Object.keys(value);if(keys.length>300)truncated=true;
   for(const key of keys.slice(0,300)){
    const next=keyPath?keyPath+"."+key:key;
    if(widgetKeys.test(key)){
     const kind=key.toLowerCase().replace(/s$/,"");
     widgetKinds[kind]=(widgetKinds[kind]||0)+1;
     report.totals.guiJsonWidgetsObserved++;
    }
    if(important.test(key)&&paths.length<200)paths.push(next);
    walk(value[key],next,depth+1);
   }
  }
  walk(data,"",0);
  push(report.guiDefinitions,{sourcePath:path,status:truncated?"bounded-structure-inspected":"structure-inspected",widgetKinds,fieldPaths:paths,nodes:Math.min(nodes,4000),truncated});
 }
 for(const resource of resources){
  const path=String(resource&&resource.path||""),kind=resourceKind(path);
  if(!kind)continue;
  const row={sourcePath:path,bytes:Number(resource&&resource.size)||null,kind,contentInspected:typeof resource.content==="string",portStatus:"unmapped"};
  push(report.resources,row);report.totals.resourcesReported++;
  if(kind==="gui-texture")report.totals.guiTextures++;
  else if(kind==="gui-definition-json")inspectGuiJson(resource);
  else if(kind==="language-labels")report.totals.languageResourceFiles++;
 }
 report.screens=screens;report.menus=menus;report.widgets=widgets;report.slots=slots;
 report.screenMenuLinks=links;report.operations=operations;report.fields=fields;report.syncSites=syncSites;
 report.totals.classesReported=screens.length+menus.length+widgets.length+slots.length;
 report.totals.operationsObserved=operationsSeen;report.totals.operationsReported=operations.length;
 report.totals.fieldsObserved=fieldsSeen;report.totals.fieldsReported=fields.length;
 report.totals.detailsTruncated=operationsSeen>operations.length||fieldsSeen>fields.length||
  report.totals.guiClasses>report.totals.classesReported||report.totals.screenMenuLinks>links.length||
  report.totals.guiResourceFilesSeen>report.totals.resourcesReported||
  report.totals.guiDefinitionJsonFiles>report.guiDefinitions.length;
 if(report.totals.guiClasses||report.totals.guiResourceFilesSeen||report.totals.guiJsonReadErrors||report.totals.guiJsonInvalid)report.status="manual-machine-gui-port-required";
 if(report.totals.screenClasses||report.totals.menuClasses)report.migrationTasks.push({area:"screen-and-menu-layout",status:"unmapped",requiredWork:"Rebuild each machine screen/menu layout in Zeus UI; map sizing, anchors, textures, labels, localization, tabs and responsive behavior."});
 if(report.totals.slotClasses||report.totals.slotRegistrationsObserved||report.totals.dataSlotRegistrationsObserved)report.migrationTasks.push({area:"inventory-slots-and-data",status:"unmapped",requiredWork:"Implement slot indexing, insertion/extraction permissions, quick-move rules, machine/player inventory boundaries and synchronized machine values."});
 if(report.totals.buttonInteractionCandidates||report.totals.keyboardInteractionCandidates||report.totals.widgetClasses)report.migrationTasks.push({area:"widget-input-and-actions",status:"unmapped",requiredWork:"Map button/toggle/slider/text/list callbacks, key and mouse input, focus, validation, close behavior and accessible labels."});
 if(report.totals.guiSyncOperationsObserved||report.totals.packetReferenceSites)report.migrationTasks.push({area:"client-server-gui-synchronization",status:"unmapped",requiredWork:"Rebuild server-authoritative actions, packet payloads, validation, state synchronization, refresh order and stale/invalid interaction handling."});
 if(report.totals.guiJsonReadErrors||report.totals.guiJsonInvalid)report.migrationTasks.push({area:"gui-definition-review",status:"blocked",requiredWork:"Review every unreadable or invalid GUI JSON definition before treating the source UI inventory as complete."});
 if(report.totals.guiTextures||report.totals.guiDefinitionJsonFiles||report.totals.languageResourceFiles)report.migrationTasks.push({area:"gui-assets-and-localization",status:"unmapped",requiredWork:"Map source GUI textures, layout definitions, icons and translated labels to Zeus-supported textures and drawing/layout APIs."});
 if(!report.migrationTasks.length)report.migrationTasks.push({area:"machine-gui-discovery",status:"not-observed",requiredWork:"No screen/menu evidence was identified; inspect custom renderers, generated widgets and loader-specific UI registration before concluding that no GUI exists."});
 return report;
}
root.Jar2ZeusMachineGuiInteraction={analyze,operation,resourceKind};
})(typeof globalThis!=="undefined"?globalThis:this);
