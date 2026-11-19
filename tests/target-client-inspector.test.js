const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");
require("../target-client-inspector.js");

const api = globalThis.Jar2ZeusTargetInspector;
const u32be = n => Buffer.from([n>>>24&255,n>>>16&255,n>>>8&255,n&255]);
const u16be = n => Buffer.from([n>>>8&255,n&255]);
const u8str = s => { const b=Buffer.from(s,"utf8"); return Buffer.concat([Buffer.from([b.length]),b]); };

function makeEPK(path="assets/demo/textures/amber.png", data=Buffer.from([1,2,3,4]), compression="Z") {
  const headData=Buffer.from("epk/resources");
  const head=Buffer.concat([
    Buffer.from("HEAD"),u8str("file-type"),u32be(headData.length),headData,Buffer.from(">","ascii")
  ]);
  const crc=api.crc32(new Uint8Array(data));
  const file=Buffer.concat([
    Buffer.from("FILE"),u8str(path),u32be(data.length+5),u32be(crc),data,Buffer.from(":>","ascii")
  ]);
  const records=Buffer.concat([head,file,Buffer.from("END$")]);
  const comment=Buffer.from("\nTest EPK fixture\n");
  const compressed=compression==="G"?zlib.gzipSync(records):(compression==="0"?records:zlib.deflateSync(records));
  return new Uint8Array(Buffer.concat([
    Buffer.from("EAGPKG$$"),u8str("ver2.0"),u8str("assets.epk"),u16be(comment.length),
    comment,Buffer.alloc(8),u32be(2),Buffer.from(compression),compressed,Buffer.from(":::YEE:>")
  ]));
}
function makeEPWWithEPK(epk) {
  const a=Buffer.from([0xfd,0x37,0x7a,0x58,0x5a,0]);
  const b=Buffer.from([0xfd,0x37,0x7a,0x58,0x5a,0]);
  const total=384+a.length+b.length;
  const bytes=new Uint8Array(total),v=new DataView(bytes.buffer);
  bytes.set([0x45,0x41,0x47,0x24,0x57,0x41,0x53,0x4d],0);
  v.setUint32(8,total,true);v.setUint32(16,0x00010001,true);v.setUint32(24,384,true);
  v.setUint32(292,384,true);v.setUint32(296,a.length,true);v.setUint32(300,epk.length,true);
  v.setUint32(324,390,true);v.setUint32(328,b.length,true);v.setUint32(332,epk.length,true);
  bytes.set(a,384);bytes.set(b,390);
  return bytes;
}

test("CRC32 uses the standard IEEE value", () => {
  assert.equal(api.crc32(new TextEncoder().encode("123456789")),0xcbf43926);
});

test("EPK v2 parser validates file records and CRC", async () => {
  const epk=makeEPK();
  const report=await api.parseEPK(epk);
  assert.equal(report.format,"EPK v2");
  assert.equal(report.version,"ver2.0");
  assert.equal(report.fileCount,2);
  assert.equal(report.parsedFiles,2);
  assert.equal(report.valid,true,report.errors.join("; "));
  const file=report.files.find(x=>x.path==="assets/demo/textures/amber.png");
  assert.ok(file);
  assert.equal(file.size,4);
  assert.equal(file.category,"textures");
  assert.equal(file.crcValid,true);
});

test("EPK v2 accepts the gzip and uncompressed formats used by reference clients", async () => {
  const gzip=await api.parseEPK(makeEPK("assets/demo/sounds/example.ogg",Buffer.from([5,6,7]),"G"));
  assert.equal(gzip.valid,true,gzip.errors.join("; "));
  assert.equal(gzip.compression,"G");
  assert.equal(gzip.counts.sounds,1);
  const plain=await api.parseEPK(makeEPK("assets/demo/models/block/column.obj",Buffer.from("o column\n"),"0"));
  assert.equal(plain.valid,true,plain.errors.join("; "));
  assert.equal(plain.compression,"0");
  assert.equal(plain.counts.models,1);
});

test("EPW parser reads declared size and XZ block descriptors", () => {
  const epk=makeEPK();
  const bytes=makeEPWWithEPK(epk);
  const report=api.parseEPW(bytes);
  assert.equal(report.valid,true,report.errors.join("; "));
  assert.equal(report.declaredLength,bytes.length);
  assert.equal(report.headerSize,384);
  assert.equal(report.sections.length,2);
  assert.equal(report.sections[0].id,"assets-epk");
  assert.equal(report.sections[1].id,"language-epk");
  assert.equal(report.sections[0].xz,true);
});

test("HTML inspection expands EPW sections and reports EPK inventory", async () => {
  const epk=makeEPK("assets/demo/models/block/amber.json",Buffer.from("{}"));
  const epw=makeEPWWithEPK(epk);
  const b64=Buffer.from(epw).toString("base64");
  const html='<!doctype html><title>Eaglercraft 1.12.2 WASM-GC</title><script>window.eaglercraftXOpts.assetsURI="data:application/octet-stream;base64,'+b64+'";</script>';
  const report=await api.inspect(html,{decompressXz:async()=>epk});
  assert.equal(report.format,"Eaglercraft EPW / WASM-GC wrapper");
  assert.equal(report.epw.valid,true);
  assert.equal(report.epk.length,2);
  assert.equal(report.epk[0].valid,true);
  assert.equal(report.epk[0].counts.models,1);
  assert.equal(report.deepAnalysis.status,"complete");
});

test("HTML scan does not mistake text hidden in base64 for a Zeus marker", async () => {
  const payload=Buffer.from("this contains zeus but is only binary payload").toString("base64");
  const html='<title>Eaglercraft 1.12</title><script>assetsURI="data:application/octet-stream;base64,'+payload+'";</script>';
  const report=await api.inspect(html);
  assert.equal(report.visible.visibleZeusMarker,false);
  assert.equal(report.visible.hasEaglercraft,true);
});

test("EPK comparison reports added, removed and changed paths", async () => {
  const first=await api.parseEPK(makeEPK("assets/demo/textures/a.png",Buffer.from([1])));
  const second=await api.parseEPK(makeEPK("assets/demo/textures/a.png",Buffer.from([2])));
  const diff=api.compare({format:"A",epk:[first]},{format:"B",epk:[second]});
  assert.equal(diff.sharedFiles,1);
  assert.equal(diff.addedToB,0);
  assert.equal(diff.removedFromB,0);
  assert.equal(diff.changed,1);
});

test("WASM parser extracts import and export symbols", () => {
  const bytes = new Uint8Array([
    0, 97, 115, 109, 1, 0, 0, 0,
    2, 11, 1, 3, 101, 110, 118, 3, 108, 111, 103, 0, 0,
    7, 7, 1, 3, 114, 117, 110, 0, 0
  ]);
  const parsed = api.parseWasm(bytes);
  assert.equal(parsed.valid, true, parsed.error);
  assert.deepEqual(parsed.imports, [{module:"env",name:"log",kind:0,typeIndex:0,kindName:"function"}]);
  assert.deepEqual(parsed.exports, [{name:"run",kind:0,index:0}]);
});

test("EPK comparison reports added, removed and changed paths", async () => {
  const first=await api.parseEPK(makeEPK("assets/demo/textures/a.png",Buffer.from([1])));
  const second=await api.parseEPK(makeEPK("assets/demo/textures/a.png",Buffer.from([2])));
  const diff=api.compare({format:"a",epk:[first]},{format:"b",epk:[second]});
  assert.equal(diff.sharedFiles,1);
  assert.equal(diff.addedToB,0);
  assert.equal(diff.removedFromB,0);
  assert.equal(diff.changed,1);
});

test("EPK comparison never treats unchecked CRC values as identical", () => {
  const a={format:"a",epk:[{files:[{path:"assets/demo/a.bin",size:4,crc32:null,crcValid:null}]}]};
  const b={format:"b",epk:[{files:[{path:"assets/demo/a.bin",size:4,crc32:null,crcValid:null}]}]};
  const diff=api.compare(a,b);
  assert.equal(diff.changed,0);
  assert.equal(diff.counts.unverified,1);
  assert.equal(diff.unverifiedPreview[0].path,"assets/demo/a.bin");
});

test("EPK comparison flags duplicate and unsafe paths instead of silently overwriting them", () => {
  const a={epk:[{files:[
    {path:"assets/demo/a.bin",size:1,crc32:1,crcValid:true},
    {path:"assets/demo/a.bin",size:1,crc32:1,crcValid:true},
    {path:"../escape.bin",size:1,crc32:1,crcValid:true}
  ]}]};
  const b={epk:[{files:[{path:"assets/demo/a.bin",size:1,crc32:1,crcValid:true}]}]};
  const diff=api.compare(a,b);
  assert.equal(diff.counts.duplicatePathsA,1);
  assert.equal(diff.counts.unsafeA,1);
  assert.equal(diff.counts.ambiguous,1);
});


test("inspects inline-script EPK and WASM containers used by 26.2 zeus/master builds",async()=>{
 const assets=makeEPK("assets/demo/textures/amber.png",Buffer.from([1,2,3]),"G");
 const assetsB64=Buffer.from(assets).toString("base64");
 const wasmB64=Buffer.from([0xcf,0xff,0x7f,0x79,0xff]).toString("base64");
 const html=[
  '<!doctype html><title>Eaglercraft 26.2 (zeus/master)</title>',
  '<script type="application/octet-stream" id="eag-inline-wasm-br" data-size="5" data-raw-size="106797927">'+wasmB64+'</script>',
  '<script type="application/octet-stream" id="eag-inline-assets" data-size="'+assets.length+'">'+assetsB64+'</script>',
  '<script type="application/octet-stream" id="eag-inline-sounds" data-size="0"></script>'
 ].join("");
 const report=await api.inspect(html);
 assert.equal(report.format,"Eaglercraft inline script bundle");
 assert.equal(report.clientBuild.minecraftVersion,"26.2");
 assert.equal(report.clientBuild.branch,"zeus/master");
 assert.equal(report.runtime.wasm,true);
 assert.equal(report.runtime.zeusEvidence,true);
 assert.equal(report.runtime.apiPresenceVerified,false);
 assert.equal(report.inlinePayloads.find(x=>x.id==="eag-inline-wasm-br").rawSize,106797927);
 assert.equal(report.epk.length,1);
 assert.equal(report.epk[0].label,"assets");
 assert.equal(report.epk[0].valid,true,report.epk[0].errors.join("; "));
 assert.equal(report.epk[0].fileCount,2);
 assert.equal(report.deepAnalysis.mode,"inline-script-epk-inventory");
 assert.equal(report.deepAnalysis.compressedWasmInspected,false);
});

test("inline-script inspection does not claim API support from a Zeus title alone",async()=>{
 const html='<title>Eaglercraft 26.2 (zeus/master)</title>'+
  '<script type="application/octet-stream" id="eag-inline-wasm-br" data-size="4" data-raw-size="20">AAAAAA==</script>';
 const report=await api.inspect(html);
 assert.equal(report.runtime.zeusEvidence,true);
 assert.equal(report.runtime.apiCompatibility,"unverified-static-only");
 assert.equal(report.runtime.apiPresenceVerified,false);
 assert.equal(report.deepAnalysis.wasmApiInspection,"not-performed");
});
