/* Deep Eaglercraft HTML / EPW / EPK inspector.
 * Reads uploaded bytes only. Never executes the target HTML or its embedded code.
 * The inspector describes binary structure; it does not claim Java MOD code was ported.
 */
(function(root){
 "use strict";

 const EPW_MAGIC = [0x45,0x41,0x47,0x24,0x57,0x41,0x53,0x4d]; // EAG$WASM
 const EPK_MAGIC = "EAGPKG$$";
 const EPK_OLD_MAGIC = "EAGPKG!!";
 const XZ_MAGIC = [0xfd,0x37,0x7a,0x58,0x5a,0x00];
 const EPW_HEADER_MIN = 384;
 const EPW_XZ_RECORDS = [
  {id:"runtime-0",offset:196},{id:"runtime-1",offset:212},
  {id:"runtime-2",offset:228},{id:"runtime-3",offset:244},
  {id:"runtime-4",offset:260},{id:"assets-epk",offset:292},
  {id:"language-epk",offset:324}
 ];
 const MAX_HTML_BYTES = 160 * 1024 * 1024;
 const MAX_EXPANDED_BYTES = 160 * 1024 * 1024;
 const MAX_EPK_FILES = 100000;

 function u32le(v,p){return v.getUint32(p,true)}
 function u32be(v,p){return v.getUint32(p,false)}
 function u16be(v,p){return v.getUint16(p,false)}
 function inRange(total,offset,length){return Number.isSafeInteger(offset)&&Number.isSafeInteger(length)&&offset>=0&&length>=0&&offset<=total&&length<=total-offset}
 function sameBytes(a,b){if(!a||!b||a.length!==b.length)return false;for(let i=0;i<a.length;i++)if(a[i]!==b[i])return false;return true}
 function hasBytes(bytes,offset,pattern){return inRange(bytes.length,offset,pattern.length)&&sameBytes(bytes.subarray(offset,offset+pattern.length),pattern)}
 function text(bytes,start,end){try{return new TextDecoder("utf-8",{fatal:false}).decode(bytes.subarray(start,end))}catch(_){return ""}}
 function ascii(bytes,start,end){let out="";for(let i=start;i<end;i++)out+=String.fromCharCode(bytes[i]);return out}
 function readAsciiRun(bytes,start,max){let p=start;while(p<bytes.length&&p-start<max&&bytes[p]>=32&&bytes[p]<=126)p++;return ascii(bytes,start,p)}
 function crc32(bytes){
  let crc=0xffffffff;
  for(let i=0;i<bytes.length;i++){
   crc^=bytes[i];
   for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);
  }
  return (crc^0xffffffff)>>>0;
 }
 function decodeBase64(raw){
  const cleaned=String(raw||"").replace(/\s+/g,"").replace(/-/g,"+").replace(/_/g,"/");
  if(!cleaned||cleaned.length%4===1)throw new Error("assetsURIのBase64長が不正です");
  if(typeof root.atob==="function"){
   const bin=root.atob(cleaned),out=new Uint8Array(bin.length);
   for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);
   return out;
  }
  if(typeof Buffer!=="undefined")return new Uint8Array(Buffer.from(cleaned,"base64"));
  throw new Error("Base64デコーダーが利用できません");
 }
 function findInlineAssetsUri(html){
  const patterns=[
   /assetsURI\s*=\s*["']data:application\/octet-stream;base64,([^"']+)["']/i,
   /data:application\/octet-stream;base64,([A-Za-z0-9+/_=-]{128,})/i
  ];
  for(const re of patterns){const m=String(html).match(re);if(m)return m[1]}
  return null;
 }
 function findInlineScript(html,id){
  const candidates=['id="'+id+'"',"id='"+id+"'"];
  let idAt=-1;
  for(const token of candidates){idAt=String(html).indexOf(token);if(idAt>=0)break}
  if(idAt<0)return null;
  const start=String(html).lastIndexOf("<script",idAt);
  const tagEnd=String(html).indexOf(">",idAt);
  if(start<0||tagEnd<0||start>=tagEnd)return null;
  const close=String(html).indexOf("</script",tagEnd);
  if(close<0)return null;
  const attrs=String(html).slice(start,tagEnd+1);
  function attr(name){
   const m=attrs.match(new RegExp("\\b"+name+"\\s*=\\s*[\"']([^\"']*)[\"']","i"));
   return m?m[1]:null;
  }
  const body=String(html).slice(tagEnd+1,close).replace(/\s+/g,"");
  return {
   id,type:attr("type"),dataSize:Number(attr("data-size"))||null,
   rawSize:Number(attr("data-raw-size"))||null,
   encodedBytes:body.length,body
  };
 }
 function inspectInlineScriptMetadata(html){
  const ids=[
   "eag-inline-decoder","eag-inline-wasm-br","eag-inline-mesh-wasm-br",
   "eag-inline-server-wasm-br","eag-inline-terrain-wasm-br",
   "eag-inline-assets","eag-inline-sounds"
  ];
  return ids.map(id=>findInlineScript(html,id)).filter(Boolean).map(x=>({
   id:x.id,type:x.type,dataSize:x.dataSize,rawSize:x.rawSize,encodedBytes:x.encodedBytes
  }));
 }
 async function inspectInlineScriptContainer(source,options,result){
  const ids=["eag-inline-wasm-br","eag-inline-mesh-wasm-br","eag-inline-server-wasm-br","eag-inline-terrain-wasm-br","eag-inline-assets","eag-inline-sounds"];
  const found={};
  for(const id of ids)found[id]=findInlineScript(source,id);
  const hasInline=ids.some(id=>!!found[id]);
  if(!hasInline)return null;
  result.format="Eaglercraft inline script bundle";
  result.inlinePayloads=inspectInlineScriptMetadata(source);
  const title=result.visible.title||"";
  const versionMatch=title.match(/Eaglercraft\s+(\d+\.\d+)/i);
  const branchMatch=title.match(/\(([^)]+)\)/);
  result.clientBuild={
   title:title,
   minecraftVersion:versionMatch?versionMatch[1]:null,
   branch:branchMatch?branchMatch[1]:null
  };
  const hasWasm=!!found["eag-inline-wasm-br"];
  result.runtime={
   kind:hasWasm?"Eaglercraft inline WebAssembly client":"Eaglercraft HTML client",
   wasm:hasWasm,
   wasmGc:result.visible.wasmGcHint,
   zeusEvidence:result.visible.visibleZeusMarker,
   apiCompatibility:"unverified-static-only",
   apiPresenceVerified:false,
   inlineWasmCompressed:hasWasm,
   inlineWasmRawBytes:found["eag-inline-wasm-br"]&&found["eag-inline-wasm-br"].rawSize||null
  };
  const includeSounds=!!(options&&options.includeInlineSounds);
  const selected=[
   ["assets","eag-inline-assets"],
   ...(includeSounds?[["sounds","eag-inline-sounds"]]:[])
  ];
  const packages=[];
  let expandedTotal=0;
  for(const [label,id] of selected){
   const blob=found[id];
   if(!blob)continue;
   try{
    if(blob.encodedBytes>96*1024*1024)throw new Error("inline base64 payload exceeds inspection limit");
    const bytes=decodeBase64(blob.body);
    if(bytes.length>64*1024*1024)throw new Error("inline EPK exceeds 64 MiB");
    const epk=await parseEPK(bytes,{maxEPKFiles:MAX_EPK_FILES,maxEPKExpandedBytes:MAX_EXPANDED_BYTES-expandedTotal});
    epk.sourceId=id;
    epk.label=label;
    expandedTotal+=epk.expandedBytes||0;
    packages.push(epk);
    if(!epk.valid)result.errors.push(label+" EPK validation failed: "+epk.errors.join("; "));
   }catch(e){
    result.errors.push(label+" inline payload inspection failed: "+String(e&&e.message||e));
   }
  }
  result.epk=packages;
  result.deepAnalysis={
   status:result.errors.length===0&&packages.length>0?"complete":"partial",
   mode:"inline-script-epk-inventory",
   xzDecoderAvailable:!!(root.xzwasm&&root.xzwasm.XzReadableStream),
   compressedWasmInspected:false,
   wasmApiInspection:"not-performed",
   packagesAttempted:selected.length,
   packagesParsed:packages.length,
   totalExpandedBytes:expandedTotal
  };
  if(found["eag-inline-sounds"]&&!includeSounds){
   result.warnings.push("音声EPKは検出しましたが、メモリ節約のため既定では展開していません。includeInlineSounds=trueで解析できます");
  }
  if(hasWasm){
   result.warnings.push("Brotli圧縮WASMの存在と宣言サイズを確認しましたが、WASMを実行・逆コンパイルしていません");
  }
  result.warnings.push("EPK資産一覧の検証はLua APIの有無やMODのゲーム内動作を証明しません");
  return result;
 }
 function stripBase64ForTextScan(html){
  return String(html)
   .replace(/data:application\/octet-stream;base64,[A-Za-z0-9+/_=\-\s]+/ig,"[embedded binary omitted]")
   .replace(/<script[^>]*>[\s\S]*?<\/script>/ig,function(s){
    return s.replace(/[\s\S]/g,function(ch){return ch==="\n"?"\n":" "});
   });
 }
 function parseWasm(bytes){
  const b=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes||0);
  const out={valid:false,version:null,byteLength:b.length,sections:[],customSections:[],imports:[],exports:[],relevantStrings:[],error:null};
  if(b.length<8||!sameBytes(b.subarray(0,4),[0,0x61,0x73,0x6d])){out.error="WebAssembly magic not found";return out}
  if(b[4]!==1||b[5]!==0||b[6]!==0||b[7]!==0){out.error="unsupported WebAssembly binary version";return out}
  out.valid=true;out.version="1";
  function readLeb(pos,limit=b.length){
   let val=0,shift=0,byte=0,count=0;
   do{
    if(pos>=limit||shift>28||count++>=5)throw new Error("invalid WASM LEB128");
    byte=b[pos++];val+=(byte&127)*Math.pow(2,shift);shift+=7;
   }while(byte&128);
   if(val>0xffffffff)throw new Error("WASM LEB128 exceeds u32");
   return {value:val,next:pos};
  }
  function readName(pos,limit){
   const n=readLeb(pos,limit),end=n.next+n.value;
   if(end>limit)throw new Error("WASM name exceeds section bounds");
   return {value:text(b,n.next,end),next:end};
  }
  function skipLimits(pos,limit){
   const flags=readLeb(pos,limit);pos=flags.next;
   const min=readLeb(pos,limit);pos=min.next;
   if(flags.value&1){const max=readLeb(pos,limit);pos=max.next}
   return pos;
  }
  let p=8;
  try{
   while(p<b.length){
    const id=b[p++],sz=readLeb(p);p=sz.next;
    const size=sz.value,end=p+size;
    if(!inRange(b.length,p,size))throw new Error("WASM section exceeds module bounds");
    const section={id,size};
    if(id===0){
     const n=readName(p,end);section.name=n.value;out.customSections.push(n.value);
    }else if(id===2){
     let q=p;const count=readLeb(q,end);q=count.next;
     if(count.value>100000)throw new Error("WASM import count exceeds inspection limit");
     for(let i=0;i<count.value;i++){
      const mod=readName(q,end);q=mod.next;
      const field=readName(q,end);q=field.next;
      if(q>=end)throw new Error("WASM import kind is truncated");
      const kind=b[q++],item={module:mod.value,name:field.value,kind};
      if(kind===0){const t=readLeb(q,end);q=t.next;item.typeIndex=t.value;item.kindName="function"}
      else if(kind===1){if(q>=end)throw new Error("WASM table type is truncated");item.elementType=b[q++];q=skipLimits(q,end);item.kindName="table"}
      else if(kind===2){q=skipLimits(q,end);item.kindName="memory"}
      else if(kind===3){if(q+2>end)throw new Error("WASM global type is truncated");item.valueType=b[q++];item.mutable=b[q++]!==0;item.kindName="global"}
      else if(kind===4){const attr=readLeb(q,end);q=attr.next;const t=readLeb(q,end);q=t.next;item.attribute=attr.value;item.typeIndex=t.value;item.kindName="tag"}
      else throw new Error("unknown WASM import kind: "+kind);
      out.imports.push(item);
     }
     if(q!==end)throw new Error("WASM import section has trailing bytes");
    }else if(id===7){
     let q=p;const count=readLeb(q,end);q=count.next;
     if(count.value>100000)throw new Error("WASM export count exceeds inspection limit");
     for(let i=0;i<count.value;i++){
      const n=readName(q,end);q=n.next;
      if(q>=end)throw new Error("WASM export kind is truncated");
      const kind=b[q++],index=readLeb(q,end);q=index.next;
      out.exports.push({name:n.value,kind,index:index.value});
     }
     if(q!==end)throw new Error("WASM export section has trailing bytes");
    }
    out.sections.push(section);p=end;
   }
  }catch(e){out.valid=false;out.error=e.message}
  // TeaVM / MOD identifiers in WASM data can be useful hints, never proof of successful porting.
  const candidates=new Set();
  let runStart=-1;
  for(let i=0;i<=b.length;i++){
   const ch=i<b.length?b[i]:0;
   if(ch>=32&&ch<=126){if(runStart<0)runStart=i}
   else if(runStart>=0){
    const len=i-runStart;
    if(len>=5&&len<=240){
     const s=ascii(b,runStart,i);
     if(/(teavm|eagler|immersive|engineering|create|contraption|kinetic|blockentity|tileentity|modloader|zeus|fabric|forge)/i.test(s))candidates.add(s);
    }
    runStart=-1;
   }
  }
  out.relevantStrings=Array.from(candidates).slice(0,160);
  return out;
 }
 async function inflateStream(bytes,format){
  if(typeof root.DecompressionStream==="function"){
   try{
    const stream=new Blob([bytes]).stream().pipeThrough(new root.DecompressionStream(format));
    return new Uint8Array(await new Response(stream).arrayBuffer());
   }catch(e){/* try pako below */}
  }
  if(root.pako){
   if(format==="gzip"&&typeof root.pako.ungzip==="function")return root.pako.ungzip(bytes);
   if(typeof root.pako.inflate==="function")return root.pako.inflate(bytes);
  }
  throw new Error("EPKの圧縮を展開できません。pakoまたはDecompressionStreamが必要です");
 }
 async function inflateXz(bytes,options){
  if(options&&typeof options.decompressXz==="function")return await options.decompressXz(bytes);
  const api=root.xzwasm;
  if(api&&typeof api.XzReadableStream==="function"&&typeof root.Response==="function"&&typeof root.Blob==="function"){
   const stream=new Blob([bytes]).stream();
   const decoded=new Response(new api.XzReadableStream(stream));
   return new Uint8Array(await decoded.arrayBuffer());
  }
  throw new Error("XZ展開ライブラリ xzwasm が読み込まれていません");
 }
 function classifyPath(path){
  const p=String(path||"").toLowerCase();
  if(/\/textures\/.*\.(png|jpg|jpeg|webp)$/i.test(p))return "textures";
  if(/\/models\/.*\.json$/i.test(p)||/\.(obj|mtl|ie)$/i.test(p))return "models";
  if(/\/blockstates\/.*\.json$/i.test(p))return "blockstates";
  if(/\/recipes?\/.*\.json$/i.test(p))return "recipes";
  if(/\/lang\/[^/]+\.(lang|json)$/i.test(p))return "language";
  if(/\/sounds?\/|sounds\.json$|\.ogg$/i.test(p))return "sounds";
  if(/\/shaders?\//i.test(p))return "shaders";
  if(/\/loot_tables?\//i.test(p))return "loot_tables";
  if(/\/tags?\//i.test(p))return "tags";
  if(/\/(block|item|entity|tileentity|models?)\//i.test(p))return "definitions";
  return "other";
 }
 function parseEPKName(bytes,pos){
  if(pos>=bytes.length)throw new Error("EPK entry name length is missing");
  const len=bytes[pos++];if(pos+len>bytes.length)throw new Error("EPK entry name is truncated");
  return {value:text(bytes,pos,pos+len),next:pos+len};
 }
 async function parseEPK(bytes,options){
  const b=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes||0);
  const report={valid:false,format:null,version:null,fileCount:0,parsedFiles:0,compression:null,expandedBytes:0,crcFailures:0,unsafePaths:0,duplicatePaths:0,counts:{},namespaces:[],preview:[],files:[],errors:[],warnings:[]};
  const maxFiles=(options&&options.maxEPKFiles)||MAX_EPK_FILES;
  if(b.length<24){report.errors.push("EPKが短すぎます");return report}
  const head=ascii(b,0,8);
  if(head===EPK_OLD_MAGIC){report.format="legacy";report.errors.push("旧EPK v1形式。今回のv2資産パック解析器では内容展開に未対応");return report}
  if(head!==EPK_MAGIC){report.errors.push("EAGPKG$$ヘッダーがありません");return report}
  report.format="EPK v2";
  const trailer=":::YEE:>";
  if(ascii(b,b.length-8,b.length)!==trailer){report.errors.push("EPKフッター :::YEE:> がありません");return report}
  let p=8;
  try{
   const ver=parseEPKName(b,p);p=ver.next;report.version=ver.value;
   if(!/^ver2\./.test(report.version))throw new Error("未対応EPKバージョン: "+report.version);
   const name=parseEPKName(b,p);p=name.next;report.containerName=name.value;
   if(p+2>b.length)throw new Error("EPKコメント長がありません");
   const commentLength=u16be(new DataView(b.buffer,b.byteOffset+p,2),0);p+=2;
   if(!inRange(b.length-8,p,commentLength+12))throw new Error("EPKヘッダーの範囲が不正です");
   report.comment=text(b,p,p+commentLength);p+=commentLength;
   report.timestampHex=Array.from(b.subarray(p,p+8)).map(x=>x.toString(16).padStart(2,"0")).join("");p+=8;
   const headView=new DataView(b.buffer,b.byteOffset+p,4);report.fileCount=u32be(headView,0);p+=4;
   if(report.fileCount>maxFiles)throw new Error("EPKファイル数が上限を超えています: "+report.fileCount);
   if(p>=b.length-8)throw new Error("EPK圧縮方式がありません");
   report.compression=String.fromCharCode(b[p++]);
   const compressed=b.subarray(p,b.length-8);
   let body;
   if(report.compression==="Z")body=await inflateStream(compressed,"deflate");
   else if(report.compression==="G")body=await inflateStream(compressed,"gzip");
   else if(report.compression==="0")body=compressed;
   else throw new Error("未対応EPK圧縮方式: "+report.compression);
   report.expandedBytes=body.length;
   if(body.length>((options&&options.maxEPKExpandedBytes)||MAX_EXPANDED_BYTES))throw new Error("EPK展開後サイズが安全上限を超えています");
   const v=new DataView(body.buffer,body.byteOffset,body.byteLength),seen=new Set(),counts={};
   let q=0,recordCount=0,endSeen=false;
   while(q<body.length){
    if(q+4>body.length)throw new Error("EPKエントリー種別が途中で切れています");
    const type=ascii(body,q,q+4);q+=4;
    if(type==="END$"){
     endSeen=true;
     if(recordCount!==report.fileCount)report.warnings.push("END$時点の件数がヘッダーと一致しません");
     break;
    }
    if(recordCount>=report.fileCount)throw new Error("EPKにヘッダー記載数を超えるエントリーがあります");
    const nm=parseEPKName(body,q);q=nm.next;
    if(q+4>body.length)throw new Error("EPKファイルサイズが途中で切れています");
    const len=u32be(v,q);q+=4;
    if(len>body.length-q)throw new Error("EPKエントリーのデータ長が範囲外です");
    let size=len,crc=null,validCrc=null;
    if(type==="FILE"){
     if(len<5)throw new Error("FILEエントリー長が短すぎます");
     crc=u32be(v,q);size=len-5;
     const content=body.subarray(q+4,q+4+size);
     validCrc=(crc32(content)===crc);
     if(!validCrc)report.crcFailures++;
     q+=len-1;
     if(q>=body.length||body[q]!==58)throw new Error("FILEエントリーCRC区切り ':' がありません");
     q++;
    }else{
     q+=len;
    }
    if(q>=body.length||body[q]!==62)throw new Error("EPKエントリー終端 '>' がありません");
    q++;
    recordCount++;
    if(type==="FILE"){
     const path=nm.value;
     const safe=!!path&&!path.startsWith("/")&&!path.includes("\\")&&!path.split("/").some(x=>!x||x==="."||x==="..");
     if(!safe)report.unsafePaths++;
     if(seen.has(path))report.duplicatePaths++;
     seen.add(path);
     const category=classifyPath(path);
     counts[category]=(counts[category]||0)+1;
     const entry={path,size,crc32:crc==null?null:crc>>>0,crcValid:validCrc,type,category,safe};
     report.files.push(entry);
     if(safe&&report.preview.length<40)report.preview.push({path,size,type,category,crcValid:validCrc});
     const ns=path.match(/^(?:assets|data)\/([^/]+)\//);
     if(ns&&ns[1]!=="minecraft"&&ns[1]!=="eagler")report.namespaces.push(ns[1]);
    }else if(report.preview.length<40){
     report.preview.push({path:nm.value,size,type,category:"container-metadata"});
    }
   }
   report.parsedFiles=recordCount;report.counts=counts;report.namespaces=Array.from(new Set(report.namespaces)).sort();
   if(!endSeen)report.errors.push("EPK END$終端レコードがありません");
   if(report.unsafePaths)report.warnings.push("安全でないパスを持つEPKエントリーがあります: "+report.unsafePaths);
   if(report.duplicatePaths)report.warnings.push("重複するEPKパスがあります: "+report.duplicatePaths);
   if(report.parsedFiles!==report.fileCount)report.errors.push("EPKエントリー件数不一致: header="+report.fileCount+", parsed="+report.parsedFiles);
   if(report.crcFailures)report.errors.push("CRC32不一致: "+report.crcFailures+" files");
   report.valid=report.errors.length===0;
  }catch(e){report.errors.push(String(e&&e.message||e))}
  return report;
 }
 function sectionInfo(bytes,view,base,id){
  const offset=u32le(view,base),compressedSize=u32le(view,base+4),expandedSize=u32le(view,base+8),flags=u32le(view,base+12);
  if(offset===0&&compressedSize===0&&expandedSize===0)return null;
  const valid=inRange(bytes.length,offset,compressedSize);
  return {id,offset,compressedSize,expandedSize,flags,valid,xz:valid&&hasBytes(bytes,offset,XZ_MAGIC),crc32:valid?crc32(bytes.subarray(offset,offset+compressedSize)):null};
 }
 function readHeaderString(bytes,view,off,len){
  const offset=u32le(view,off),size=u32le(view,len);
  return inRange(bytes.length,offset,size)?text(bytes,offset,offset+size):null;
 }
 function parseEPW(bytes){
  const b=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes||0);
  const r={valid:false,format:"EPW",byteLength:b.length,errors:[],warnings:[],sections:[],strings:{},splash:null,loader:null,loaderWasm:null,versionWord:null,declaredLength:null,headerSize:null};
  if(b.length<EPW_HEADER_MIN){r.errors.push("EPWがヘッダーサイズ384 bytesより短い");return r}
  if(!hasBytes(b,0,EPW_MAGIC)){r.errors.push("EAG$WASMマジックがありません");return r}
  const v=new DataView(b.buffer,b.byteOffset,b.byteLength);
  r.declaredLength=u32le(v,8);r.versionWord=u32le(v,16);r.headerSize=u32le(v,24);
  if(r.declaredLength!==b.length)r.errors.push("EPW宣言サイズと実サイズが一致しません");
  if(r.headerSize<EPW_HEADER_MIN||r.headerSize>b.length)r.errors.push("EPWヘッダー長が不正です");
  const splashOffset=u32le(v,100),splashSize=u32le(v,104),mimeOffset=u32le(v,108),mimeSize=u32le(v,112);
  if(inRange(b.length,splashOffset,splashSize)&&inRange(b.length,mimeOffset,mimeSize)){
   r.splash={offset:splashOffset,size:splashSize,mime:text(b,mimeOffset,mimeOffset+mimeSize),png:hasBytes(b,splashOffset,[137,80,78,71,13,10,26,10])};
  }else r.warnings.push("スプラッシュ画像の範囲を検証できません");
  const jsOffset=u32le(v,164),jsSize=u32le(v,168),wasmOffset=u32le(v,180),wasmSize=u32le(v,184);
  if(inRange(b.length,jsOffset,jsSize))r.loader={offset:jsOffset,size:jsSize,source:text(b,jsOffset,jsOffset+jsSize)};
  else r.errors.push("loader.jsの範囲が不正です");
  if(inRange(b.length,wasmOffset,wasmSize)){
   const loaderWasm=b.subarray(wasmOffset,wasmOffset+wasmSize);
   r.loaderWasm={offset:wasmOffset,size:wasmSize,wasm:parseWasm(loaderWasm)};
  }else r.errors.push("loader.wasmの範囲が不正です");
  r.strings.assetsEpk=readHeaderString(b,v,276,280);
  r.strings.languageName=readHeaderString(b,v,308,312);
  r.strings.languagePrefix=readHeaderString(b,v,316,320);
  for(const entry of EPW_XZ_RECORDS){
   const s=sectionInfo(b,v,entry.offset,entry.id);
   if(!s)continue;
   if(!s.valid)r.errors.push(entry.id+" sectionのoffset/sizeが範囲外です");
   else if(!s.xz)r.warnings.push(entry.id+" sectionにXZマジックがありません");
   r.sections.push(s);
  }
  if(r.loader&&r.loader.source){
   r.loader.bootstrapContext=/__eaglercraftXLoaderContext/.test(r.loader.source);
   r.loader.epkAccess=/getEPKFiles/.test(r.loader.source);
   r.loader.runtimeJSAccess=/getEagRuntimeJSURL/.test(r.loader.source);
   r.loader.wasmAccess=/getClassesWASMURL/.test(r.loader.source);
  }
  r.valid=r.errors.length===0;
  return r;
 }
 function extractVisibleHints(html){
  const visible=stripBase64ForTextScan(html),low=visible.toLowerCase();
  const title=(visible.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||"";
  const description=(visible.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)||[])[1]||"";
  const scriptCount=(visible.match(/<script\b/ig)||[]).length;
  const relays=Array.from(visible.matchAll(/addr\s*:\s*["'](wss?:\/\/[^"']+)["']/ig)).map(x=>x[1]).slice(0,20);
  const hints=[];
  if(/eaglercraft/i.test(low))hints.push("Eaglercraft");
  if(/wasm-gc|webassembly\s*gc/i.test(low))hints.push("WASM-GC");
  if(/__eaglercraftxloadercontext/i.test(low))hints.push("Eaglercraft loader context");
  if(/\bzeus\b/i.test(low))hints.push("Zeus literal marker");
  if(/eaglerlite/i.test(low))hints.push("EaglerLite literal marker");
  return {title:title.trim(),description:description.trim(),scriptCount,relays,hints,visibleZeusMarker:/\bzeus\b/i.test(low),hasEaglercraft:/eaglercraft/i.test(low),wasmGcHint:/wasm-gc|webassembly\s*gc/i.test(low)};
 }
 async function inspect(html,options){
  const opts=options||{},source=String(html||""),sourceBytes=new TextEncoder().encode(source).length;
  const result={schema:"jar2zeus.target-client-analysis.v2",sourceBytes,visible:extractVisibleHints(source),format:"unknown",runtime:{kind:"unknown",wasm:false,wasmGc:false,zeusEvidence:false,apiCompatibility:"unverified-static-only",apiPresenceVerified:false},epw:null,epk:[],wasmModules:[],deepAnalysis:{status:"not-started",xzDecoderAvailable:!!(root.xzwasm&&root.xzwasm.XzReadableStream)},warnings:[],errors:[]};
  if(sourceBytes>MAX_HTML_BYTES){result.errors.push("HTMLサイズが解析上限を超えています");result.deepAnalysis.status="blocked-size";return result}
  if(!result.visible.hasEaglercraft)result.warnings.push("HTML内にEaglercraftの文字列を確認できません");
  const inlineContainer=await inspectInlineScriptContainer(source,opts,result);
  if(inlineContainer)return inlineContainer;
  const payload=findInlineAssetsUri(source);
  if(!payload){result.format="HTML wrapper / external or unknown assets";result.warnings.push("埋め込みBase64 assetsURIが見つかりません。外部assetsURIの可能性があります");result.deepAnalysis.status="no-inline-payload";result.runtime.kind=result.visible.hasEaglercraft?"Eaglercraft HTML":"unknown";return result}
  let binary;
  try{binary=decodeBase64(payload)}catch(e){result.errors.push(e.message);result.deepAnalysis.status="base64-error";return result}
  result.embeddedPayloadBytes=binary.length;
  result.embeddedPayloadPrefix=ascii(binary,0,8);
  if(!hasBytes(binary,0,EPW_MAGIC)){
   result.format="unknown embedded binary";
   result.warnings.push("assetsURIはBase64ですがEAG$WASM/EPWマジックではありません");
   result.deepAnalysis.status="unknown-container";
   return result;
  }
  result.format="Eaglercraft EPW / WASM-GC wrapper";
  result.runtime={kind:"Eaglercraft WASM client",wasm:true,wasmGc:result.visible.wasmGcHint,zeusEvidence:result.visible.visibleZeusMarker,apiCompatibility:"unverified-static-only",apiPresenceVerified:false};
  result.epw=parseEPW(binary);
  result.errors.push.apply(result.errors,result.epw.errors);
  result.warnings.push.apply(result.warnings,result.epw.warnings);
  if(result.epw.loaderWasm&&result.epw.loaderWasm.wasm)result.wasmModules.push({id:"loader.wasm",...result.epw.loaderWasm.wasm});
  const decodable=result.epw.sections.filter(s=>s.valid&&s.xz);
  const xzAvailable=result.deepAnalysis.xzDecoderAvailable||typeof opts.decompressXz==="function";
  if(!xzAvailable){
   result.deepAnalysis.status="header-only";
   result.deepAnalysis.note="XZ圧縮領域の展開にはxzwasmが必要です。EPWヘッダーとloaderは検査済みです";
   return result;
  }
  let totalExpanded=0,epkResults=[];
  result.deepAnalysis.status="decompressing";
  for(const section of decodable){
   try{
    const compressed=binary.subarray(section.offset,section.offset+section.compressedSize);
    const expanded=await inflateXz(compressed,opts);
    totalExpanded+=expanded.length;
    if(totalExpanded>(opts.maxExpandedBytes||MAX_EXPANDED_BYTES))throw new Error("EPW全領域の展開サイズが安全上限を超えています");
    section.decompressedBytes=expanded.length;
    section.decompressedLengthMatches=expanded.length===section.expandedSize;
    section.decompressedMagic=ascii(expanded,0,8);
    if(!section.decompressedLengthMatches)result.warnings.push(section.id+" の展開後サイズがヘッダーと異なります");
    if(section.id==="assets-epk"||section.id==="language-epk"){
     const epk=await parseEPK(expanded,opts);
     epkResults.push({section:section.id,...epk});
    }else{
     const wasm=parseWasm(expanded);
     if(wasm.valid)result.wasmModules.push({id:section.id,...wasm});
     else{
      const sample=readAsciiRun(expanded,0,160);
      section.payloadKind=sample.indexOf("version")===0?"text-or-metadata":"binary-segment";
      section.preview=sample.slice(0,120);
      const markerStrings=wasm.relevantStrings;
      if(markerStrings.length)section.relevantStrings=markerStrings;
     }
    }
   }catch(e){
    section.decompressionError=String(e&&e.message||e);
    result.warnings.push(section.id+" のXZ展開失敗: "+section.decompressionError);
   }
  }
  result.epk=epkResults;
  const partial=decodable.length===0||result.warnings.length>0||epkResults.some(x=>!x.valid);
  result.deepAnalysis={status:partial?"partial":"complete",xzDecoderAvailable:true,sectionsAttempted:decodable.length,sectionsExpanded:decodable.filter(x=>x.decompressedBytes!=null).length,totalExpandedBytes:totalExpanded};
  const allStrings=result.wasmModules.flatMap(x=>x.relevantStrings||[]).concat(result.epw.sections.flatMap(x=>x.relevantStrings||[]));
  const wasmText=allStrings.join("\n").toLowerCase();
  result.runtime.zeusEvidence=result.visible.visibleZeusMarker||/\bzeus\b/.test(wasmText);
  result.runtime.modEvidence={
   create:/create|contraption|kinetic/.test(wasmText),
   immersiveEngineering:/immersiveengineering|immersive_engineering|tileentityimmersive|blusunrize/.test(wasmText)
  };
  if(result.epk.length&&result.epk.some(x=>x.valid)){
   result.runtime.hasEmbeddedAssetPackages=true;
   result.runtime.assetPackageCount=result.epk.length;
  }
  // Do not treat the presence of a marker as proof of the runtime API being compatible.
  if(result.visible.visibleZeusMarker)result.warnings.push("Zeusの文字列を検出しましたが、API互換性や実行可能性は未検証です");
  if(!result.runtime.zeusEvidence)result.warnings.push("Zeusの明示的な識別子は検出できませんでした。文字列検出だけでZeus非搭載と断定はしません");
  return result;
 }
 function compare(a,b){
  function indexAnalysis(value){
   const map=new Map(),duplicates=[],unsafe=[];
   for(const pkg of value&&value.epk||[]){
    for(const f of pkg&&pkg.files||[]){
     if(!f||typeof f.path!=="string")continue;
     const safe=!f.path.startsWith("/")&&!f.path.includes("\\")&&!f.path.split("/").some(x=>!x||x==="."||x==="..");
     if(!safe){unsafe.push(f.path);continue}
     if(!map.has(f.path))map.set(f.path,[]);
     map.get(f.path).push(f);
    }
   }
   for(const [path,entries] of map)if(entries.length>1)duplicates.push({path,count:entries.length});
   return {map,duplicates,unsafe};
  }
  const A=indexAnalysis(a),B=indexAnalysis(b);
  const added=[],removed=[],changed=[],unverified=[],ambiguous=[];
  for(const [path,entriesB] of B.map){
   const entriesA=A.map.get(path);
   if(!entriesA){added.push(path);continue}
   if(entriesA.length!==1||entriesB.length!==1){ambiguous.push({path,aCopies:entriesA.length,bCopies:entriesB.length});continue}
   const fa=entriesA[0],fb=entriesB[0];
   if(fa.size!==fb.size){changed.push({path,a:{size:fa.size,crc32:fa.crc32},b:{size:fb.size,crc32:fb.crc32},reason:"size differs"});continue}
   if(fa.crcValid===true&&fb.crcValid===true&&fa.crc32!==null&&fb.crc32!==null){
    if(fa.crc32!==fb.crc32)changed.push({path,a:{size:fa.size,crc32:fa.crc32},b:{size:fb.size,crc32:fb.crc32},reason:"CRC32 differs"});
   }else unverified.push({path,size:fa.size,aCrcValid:fa.crcValid===true,bCrcValid:fb.crcValid===true});
  }
  for(const path of A.map.keys())if(!B.map.has(path))removed.push(path);
  const shared=Array.from(A.map.keys()).filter(path=>B.map.has(path)).length;
  return {
   aFormat:a&&a.format,bFormat:b&&b.format,
   counts:{shared,addedToB:added.length,removedFromB:removed.length,changed:changed.length,unverified:unverified.length,ambiguous:ambiguous.length,unsafeA:A.unsafe.length,unsafeB:B.unsafe.length,duplicatePathsA:A.duplicates.length,duplicatePathsB:B.duplicates.length},
   sharedFiles:shared,addedToB:added.length,removedFromB:removed.length,changed:changed.length,
   addedPreview:added.slice(0,100),removedPreview:removed.slice(0,100),changedPreview:changed.slice(0,100),
   unverifiedPreview:unverified.slice(0,100),ambiguousPreview:ambiguous.slice(0,100),
   duplicatePathsA:A.duplicates.slice(0,100),duplicatePathsB:B.duplicates.slice(0,100)
  };
 }
 root.Jar2ZeusTargetInspector={inspect,parseEPW,parseEPK,parseWasm,compare,crc32};
})(typeof globalThis!=="undefined"?globalThis:this);
