/* Builds a self-contained Eaglercraft HTML with an embedded Jar2Zeus uploader.
 * Uploaded JAR bytecode is analyzed, never executed. Generated Zeus packages remain
 * subject to the target game's own install prompt and runtime limits.
 */
(function(root){
 "use strict";
 const MARKER="<!-- JAR2ZEUS_CLIENT_INTEGRATION_V1 -->";

 function encodeBase64Utf8(value){
  if(typeof Buffer!=="undefined")return Buffer.from(value,"utf8").toString("base64");
  const bytes=new TextEncoder().encode(value);
  let binary="";
  for(let i=0;i<bytes.length;i+=0x8000){
   binary+=String.fromCharCode.apply(null,bytes.subarray(i,Math.min(i+0x8000,bytes.length)));
  }
  return btoa(binary);
 }

 function byteLength(value){
  if(typeof Buffer!=="undefined")return Buffer.byteLength(value,"utf8");
  return new TextEncoder().encode(value).length;
 }

 function runtimeMarkup(converterDocument){
  const encoded=encodeBase64Utf8(converterDocument);
  return `
${MARKER}
<script id="jar2zeus-client-integration">
(function(){
 "use strict";
 if(window.__JAR2ZEUS_CLIENT_INTEGRATION__)return;
 window.__JAR2ZEUS_CLIENT_INTEGRATION__=true;

 var converterBase64="${encoded}";
 var converterFrame=null,frameReady=false,pendingJar=null;
 var installableBlob=null,diagnosticsBlob=null,installableName=null;
 var statusNode=null,installButton=null,downloadButton=null,diagnosticsButton=null;
 var panel=null;

 function decodeDocument(encoded){
  var binary=atob(encoded),bytes=new Uint8Array(binary.length);
  for(var i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
 }

 function downloadBlob(blob,name){
  if(!(blob instanceof Blob)||!name)return;
  var url=URL.createObjectURL(blob),anchor=document.createElement("a");
  anchor.href=url;anchor.download=name;anchor.style.display="none";
  document.body.appendChild(anchor);anchor.click();anchor.remove();
  setTimeout(function(){URL.revokeObjectURL(url)},2000);
 }

 function setStatus(message){
  if(statusNode)statusNode.textContent=message;
 }

 function setControlsEnabled(enabled){
  if(downloadButton)downloadButton.disabled=!enabled;
  if(diagnosticsButton)diagnosticsButton.disabled=!enabled||!(diagnosticsBlob instanceof Blob);
  if(installButton)installButton.disabled=!enabled;
 }

 function feedJarToConverter(file){
  if(!file||!converterFrame||!frameReady){pendingJar=file;return;}
  try{
   var child=converterFrame.contentWindow;
   var input=child.document.getElementById("jar");
   if(!input){setStatus("変換画面の読み込みが完了していません。JARを画面内から選択してください。");return;}
   if(typeof DataTransfer!=="function"){
    setStatus("このブラウザではドラッグしたファイルを変換画面へ自動転送できません。変換画面のファイル選択からJARを選んでください。");
    return;
   }
   var transfer=new DataTransfer();
   transfer.items.add(file);
   input.files=transfer.files;
   input.dispatchEvent(new Event("change",{bubbles:true}));
   setStatus("JARを変換画面へ渡しました。「JARを解析して再実装を開始」を押してください。");
  }catch(error){
   setStatus("JARを自動転送できませんでした。変換画面のファイル選択から選んでください。");
  }
 }

 function createConverterFrame(){
  if(converterFrame)return;
  converterFrame=document.createElement("iframe");
  converterFrame.title="Jar2Zeus JAR conversion";
  converterFrame.setAttribute("referrerpolicy","no-referrer");
  converterFrame.style.cssText="display:block;width:100%;height:100%;border:0;background:#0b1020";
  converterFrame.addEventListener("load",function(){
   frameReady=true;
   if(pendingJar){var file=pendingJar;pendingJar=null;feedJarToConverter(file);}
   setStatus("JARを選択し、解析・変換を実行してください。");
  });
  converterFrame.srcdoc=decodeDocument(converterBase64);
  var holder=document.getElementById("jar2zeus-frame-holder");
  holder.appendChild(converterFrame);
 }

 function openPanel(file){
  panel.hidden=false;
  createConverterFrame();
  if(file)feedJarToConverter(file);
 }

 function sendPackageToGame(){
  if(!(installableBlob instanceof Blob)||!installableName)return false;
  try{
   if(typeof DataTransfer!=="function"||typeof DragEvent!=="function"||typeof File!=="function")
    throw new Error("このブラウザは合成ドロップ操作に対応していません");
   var file=new File([installableBlob],installableName,{type:"application/zip"});
   var transfer=new DataTransfer();
   transfer.items.add(file);
   var event=new DragEvent("drop",{
    bubbles:true,cancelable:true,composed:true,dataTransfer:transfer,
    clientX:Math.round(window.innerWidth/2),clientY:Math.round(window.innerHeight/2)
   });
   document.documentElement.dispatchEvent(event);
   setStatus("ゲームへMOD ZIPのドロップ操作を送りました。ゲーム側のインストール確認画面が表示されたら、内容と権限を確認してInstallしてください。表示されない場合は「ゲーム用ZIPを保存」から保存し、Mods → Import modで読み込んでください。");
   return true;
  }catch(error){
   setStatus("自動受け渡しが使えません。下の「ゲーム用ZIPを保存」を押し、ゲームのMods → Import modからZIPを読み込んでください。");
   return false;
  }
 }

 function acceptMessage(event){
  if(!converterFrame||event.source!==converterFrame.contentWindow)return;
  var data=event.data;
  if(!data||data.type!=="JAR2ZEUS_PACKAGE_READY")return;
  if(!(data.modBlob instanceof Blob)||typeof data.fileName!=="string"||
     !/^[a-z0-9_.-]{1,64}-zeus-mod\.zip$/.test(data.fileName)){
   setStatus("変換結果の形式を確認できませんでした。レポートを確認してください。");
   return;
  }
  installableBlob=data.modBlob;
  diagnosticsBlob=data.diagnosticsBlob instanceof Blob?data.diagnosticsBlob:null;
  installableName=data.fileName;
  setControlsEnabled(true);
  sendPackageToGame();
 }

 function findJar(files){
  for(var i=0;i<files.length;i++){
   var file=files[i];
   if(file&&typeof file.name==="string"&&/\.jar$/i.test(file.name))return file;
  }
  return null;
 }

 var style=document.createElement("style");
 style.textContent=
  "#jar2zeus-launch{position:fixed!important;right:16px!important;bottom:16px!important;z-index:2147483000!important;background:#315bd6!important;color:#fff!important;border:2px solid #fff!important;border-radius:12px!important;padding:12px 16px!important;font:700 15px system-ui!important;box-shadow:0 4px 22px #0009!important;cursor:pointer!important}" +
  "#jar2zeus-panel{position:fixed!important;inset:2vh 2vw!important;z-index:2147483001!important;background:#101827!important;border:2px solid #7195ff!important;border-radius:14px!important;box-shadow:0 12px 50px #000b!important;display:flex!important;flex-direction:column!important;overflow:hidden!important}" +
  "#jar2zeus-panel[hidden]{display:none!important}" +
  "#jar2zeus-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:10px;background:#1a2740;color:#fff;font:14px system-ui}" +
  "#jar2zeus-toolbar button{border:0;border-radius:7px;padding:8px 11px;font-weight:700;cursor:pointer}" +
  "#jar2zeus-toolbar button:disabled{opacity:.45;cursor:not-allowed}" +
  "#jar2zeus-status{flex:1;min-width:180px;color:#dce6ff;font:13px system-ui}" +
  "#jar2zeus-frame-holder{flex:1;min-height:0;background:#0b1020}" +
  "@media(max-width:600px){#jar2zeus-panel{inset:0;border-radius:0}#jar2zeus-launch{right:8px!important;bottom:8px!important}}";
 document.head.appendChild(style);

 var launch=document.createElement("button");
 launch.id="jar2zeus-launch";
 launch.type="button";
 launch.textContent="JAR MODを追加";
 launch.title="通常のMOD JARを解析し、対応するZeus MODへ変換します";
 launch.addEventListener("click",function(){openPanel(null);});
 document.body.appendChild(launch);

 panel=document.createElement("section");
 panel.id="jar2zeus-panel";
 panel.hidden=true;
 panel.innerHTML=
  '<div id="jar2zeus-toolbar">' +
   '<strong>JAR → Eaglercraft MOD</strong>' +
   '<span id="jar2zeus-status" role="status">JARを選択し、解析・変換を実行してください。</span>' +
   '<button id="jar2zeus-install" type="button" disabled>ゲームへ追加</button>' +
   '<button id="jar2zeus-download" type="button" disabled>ゲーム用ZIPを保存</button>' +
   '<button id="jar2zeus-diagnostics" type="button" disabled>診断ZIPを保存</button>' +
   '<button id="jar2zeus-close" type="button">閉じる</button>' +
  '</div><div id="jar2zeus-frame-holder"></div>';
 document.body.appendChild(panel);

 statusNode=document.getElementById("jar2zeus-status");
 installButton=document.getElementById("jar2zeus-install");
 downloadButton=document.getElementById("jar2zeus-download");
 diagnosticsButton=document.getElementById("jar2zeus-diagnostics");

 document.getElementById("jar2zeus-close").addEventListener("click",function(){panel.hidden=true;});
 installButton.addEventListener("click",sendPackageToGame);
 downloadButton.addEventListener("click",function(){downloadBlob(installableBlob,installableName);});
 diagnosticsButton.addEventListener("click",function(){
  if(diagnosticsBlob)downloadBlob(diagnosticsBlob,(installableName||"mod").replace(/-zeus-mod\.zip$/,"-migration.zip"));
 });
 window.addEventListener("message",acceptMessage);

 window.addEventListener("dragover",function(event){
  var jar=findJar(event.dataTransfer&&event.dataTransfer.files||[]);
  if(jar){event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect="copy";}
 },true);

 window.addEventListener("drop",function(event){
  var jar=findJar(event.dataTransfer&&event.dataTransfer.files||[]);
  if(!jar)return;
  event.preventDefault();
  event.stopPropagation();
  if(typeof event.stopImmediatePropagation==="function")event.stopImmediatePropagation();
  openPanel(jar);
 },true);

 setControlsEnabled(false);
})();
</script>
`;
 }

 function buildIntegrationHtml(gameHtml,converterDocument){
  if(typeof gameHtml!=="string"||typeof converterDocument!=="string")throw new TypeError("gameHtml and converterDocument must be strings");
  if(!/<html(?:\s|>)/i.test(gameHtml))throw new Error("The selected file does not look like an HTML client");
  if(gameHtml.includes(MARKER))throw new Error("This HTML already contains the Jar2Zeus integration");
  const cspDetected=/<meta\b[^>]*http-equiv\s*=\s*["']?Content-Security-Policy/i.test(gameHtml);
  const markup=runtimeMarkup(converterDocument);
  let output;
  if(/<\/body\s*>/i.test(gameHtml))output=gameHtml.replace(/<\/body\s*>/i,function(close){return markup+"\n"+close;});
  else if(/<\/html\s*>/i.test(gameHtml))output=gameHtml.replace(/<\/html\s*>/i,markup+"\n</html>");
  else output=gameHtml+"\n"+markup;
  return {
   html:output,
   report:{
    schema:"jar2zeus.client-integration.v1",
    marker:MARKER,
    originalHtmlBytes:byteLength(gameHtml),
    converterBytes:byteLength(converterDocument),
    outputHtmlBytes:byteLength(output),
    cspMetaDetected:cspDetected,
    jarUploadOverlayAdded:true,
    dragAndDropJarInterceptAdded:true,
    generatedZipDropBridgeAdded:true,
    syntheticDropMayBeRejectedBySomeClients:true,
    manualZipImportFallback:true,
    javaBytecodeExecuted:false
   }
  };
 }

 root.Jar2ZeusClientIntegration={
  marker:MARKER,
  buildIntegrationHtml:buildIntegrationHtml,
  encodeBase64Utf8:encodeBase64Utf8
 };
})(typeof globalThis!=="undefined"?globalThis:this);
