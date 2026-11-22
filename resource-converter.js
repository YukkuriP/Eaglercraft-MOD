/* Resource indexer for Jar2Zeus. Produces portable metadata; does not invent Zeus APIs. */
(function(root){
  "use strict";
  const ID=/^[a-z0-9_.-]+:[a-z0-9_./-]+$/;
  function safePath(p){return typeof p==="string"&&!p.startsWith("/")&&!p.includes("\\")&&!p.split("/").some(x=>x===".."||x===".");}
  const PNG_SIGNATURE=[137,80,78,71,13,10,26,10];
  function readU32(bytes,offset){return ((bytes[offset]*0x1000000)+(bytes[offset+1]<<16)+(bytes[offset+2]<<8)+bytes[offset+3])>>>0;}
  function crc32(bytes,start,end){
    let crc=0xffffffff;
    for(let i=start;i<end;i++){
      crc^=bytes[i];
      for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);
    }
    return (crc^0xffffffff)>>>0;
  }
  function inspectPng(input){
    const result={valid:false,width:null,height:null,bitDepth:null,colorType:null,hasAlpha:false,chunks:0,bytes:0,error:null};
    try{
      const bytes=input instanceof Uint8Array?input:new Uint8Array(input||[]);
      result.bytes=bytes.length;
      if(bytes.length<45)throw new Error("PNG is too short");
      for(let i=0;i<8;i++)if(bytes[i]!==PNG_SIGNATURE[i])throw new Error("invalid PNG signature");
      let p=8,seenIHDR=false,seenIDAT=false,seenIEND=false;
      const known=new Set(["IHDR","PLTE","IDAT","IEND","tRNS","gAMA","cHRM","sRGB","iCCP","sBIT","pHYs","eXIf","tEXt","zTXt","iTXt","bKGD","hIST","sPLT"]);
      while(p<bytes.length){
        if(p+12>bytes.length)throw new Error("truncated PNG chunk header");
        const length=readU32(bytes,p);p+=4;
        const type=String.fromCharCode(bytes[p],bytes[p+1],bytes[p+2],bytes[p+3]);p+=4;
        if(length>bytes.length-p-4)throw new Error("PNG chunk exceeds file boundary: "+type);
        const dataStart=p,dataEnd=p+length,storedCrc=readU32(bytes,dataEnd);
        const actualCrc=crc32(bytes,dataStart-4,dataEnd);
        if(storedCrc!==actualCrc)throw new Error("PNG CRC mismatch: "+type);
        if(!seenIHDR&&type!=="IHDR")throw new Error("IHDR must be the first PNG chunk");
        if(type==="IHDR"){
          if(seenIHDR||length!==13)throw new Error("invalid PNG IHDR");
          result.width=readU32(bytes,dataStart);result.height=readU32(bytes,dataStart+4);
          result.bitDepth=bytes[dataStart+8];result.colorType=bytes[dataStart+9];
          const validDepth={
            0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]
          };
          if(!result.width||!result.height||result.width>0x7fffffff||result.height>0x7fffffff)throw new Error("invalid PNG dimensions");
          if(!validDepth[result.colorType]||!validDepth[result.colorType].includes(result.bitDepth))throw new Error("unsupported PNG bit depth or color type");
          if(bytes[dataStart+10]!==0||bytes[dataStart+11]!==0||bytes[dataStart+12]>1)throw new Error("unsupported PNG compression, filter or interlace method");
          result.hasAlpha=result.colorType===4||result.colorType===6;
          seenIHDR=true;
        }else if(type==="IDAT"){
          if(!seenIHDR||seenIEND)throw new Error("PNG IDAT appears in an invalid position");
          if(length>0)seenIDAT=true;
        }else if(type==="tRNS"){
          result.hasAlpha=true;
        }else if(type==="IEND"){
          if(length!==0||!seenIDAT)throw new Error("invalid PNG IEND or missing image data");
          seenIEND=true;p=dataEnd+4;result.chunks++;
          if(p!==bytes.length)throw new Error("data found after PNG IEND");
          break;
        }else if((type.charCodeAt(0)&32)===0&&!known.has(type)){
          throw new Error("unknown critical PNG chunk: "+type);
        }
        p=dataEnd+4;result.chunks++;
      }
      if(!seenIHDR||!seenIDAT||!seenIEND)throw new Error("PNG is missing IHDR, IDAT or IEND");
      result.valid=true;
    }catch(error){result.error=String(error&&error.message||error);}
    return result;
  }
  function idFromPath(path,kind){
    const m=path.match(new RegExp("^data/([a-z0-9_.-]+)/tags/"+kind+"/(.+)\\.json$"));
    return m?m[1]+":"+m[2]:null;
  }
  function parseTag(path,raw){
    const kindMatch=path.match(/^data\/[^/]+\/tags\/(blocks|items|fluids|entity_types)\/.+\.json$/);
    if(!kindMatch||!safePath(path)||BLOCKED.test(path))return {status:"ignored"};
    let obj;try{obj=JSON.parse(raw)}catch(_){return {status:"skipped",reason:"invalid JSON"}}
    if(!obj||!Array.isArray(obj.values))return {status:"skipped",reason:"tag values must be an array"};
    const values=[],invalid=[];
    for(const v of obj.values){
      const entry=typeof v==="string"?v:(v&&typeof v.id==="string"?v.id:null);
      if(!entry){invalid.push(v);continue}
      const tag=entry.startsWith("#"),id=tag?entry.slice(1):entry;
      const normalized=id.includes(":")?id:"minecraft:"+id;
      if(!ID.test(normalized)||normalized.split(":")[1].split("/").some(x=>!x||x===".."||x===".")){invalid.push(v);continue}
      if(BLOCKED.test(normalized))continue;
      values.push((tag?"#":"")+normalized);
    }
    const id=idFromPath(path,kindMatch[1]);
    return {status:"indexed",id,kind:kindMatch[1],replace:obj.replace===true,values:Array.from(new Set(values)),invalid_count:invalid.length};
  }
  function index(entries){
    const result={tags:[],translations:{},models:[],blockstates:[],textures:[],invalidTextures:[],skipped:[],counts:{}};
    for(const e of entries){
      if(!safePath(e.path)){result.skipped.push({path:e.path,reason:"unsafe path"});continue}
      if(/\.png$/i.test(e.path)){
        if(e.pngInfo){
          const record={path:e.path,width:e.pngInfo.width,height:e.pngInfo.height,bitDepth:e.pngInfo.bitDepth,colorType:e.pngInfo.colorType,hasAlpha:e.pngInfo.hasAlpha};
          if(e.pngInfo.valid)result.textures.push(record);
          else result.invalidTextures.push({path:e.path,reason:e.pngInfo.error||"invalid PNG"});
        }else if(e.bytes instanceof Uint8Array){
          const info=inspectPng(e.bytes);
          const record={path:e.path,width:info.width,height:info.height,bitDepth:info.bitDepth,colorType:info.colorType,hasAlpha:info.hasAlpha};
          if(info.valid)result.textures.push(record);
          else result.invalidTextures.push({path:e.path,reason:info.error||"invalid PNG"});
        }else result.invalidTextures.push({path:e.path,reason:"PNG bytes were not supplied to the analyzer"});
      }else if(/^data\/[^/]+\/tags\/(blocks|items|fluids|entity_types)\/.+\.json$/.test(e.path)){
        const t=parseTag(e.path,e.content);
        if(t.status==="indexed")result.tags.push(t);else if(t.status==="skipped")result.skipped.push({path:e.path,reason:t.reason});
      } else if(/^assets\/[^/]+\/lang\/[a-z0-9_-]+\.json$/.test(e.path)){
        try{
          const lang=JSON.parse(e.content);
          if(!lang||typeof lang!=="object"||Array.isArray(lang))throw Error("language file must be an object");
          for(const [k,v] of Object.entries(lang))if(typeof v==="string"&&!BLOCKED.test(k))result.translations[k]=v;
        }catch(_){result.skipped.push({path:e.path,reason:"invalid language JSON"})}
      } else if(/^assets\/[^/]+\/models\/.+\.json$/.test(e.path)) result.models.push(e.path);
      else if(/^assets\/[^/]+\/blockstates\/.+\.json$/.test(e.path)) result.blockstates.push(e.path);
    }
    result.tags.sort((a,b)=>a.id.localeCompare(b.id));
    result.models.sort();result.blockstates.sort();
    result.counts={tags:result.tags.length,translations:Object.keys(result.translations).length,models:result.models.length,blockstates:result.blockstates.length,textures:result.textures.length,invalidTextures:result.invalidTextures.length,skipped:result.skipped.length};
    return result;
  }
  root.Jar2ZeusResources={index,parseTag,inspectPng,crc32};
})(typeof globalThis!=="undefined"?globalThis:this);
