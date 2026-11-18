/* Extensible staged migration pipeline for Jar2Zeus adapters. */
(function(root){
  "use strict";
  function create(){
    const adapters=new Map();
    function register(adapter){
      if(!adapter||typeof adapter.id!=="string"||!/^[a-z0-9_.-]+$/i.test(adapter.id)||typeof adapter.run!=="function")
        throw new TypeError("adapter requires a safe id and run(context) function");
      if(adapters.has(adapter.id))throw new Error("duplicate adapter: "+adapter.id);
      adapters.set(adapter.id,adapter);
      return api;
    }
    async function run(context){
      const results={},report={schema:"jar2zeus.pipeline.v1",adapters:[],errors:[],files:[],luaParts:[]};
      for(const adapter of adapters.values()){
        const record={id:adapter.id,status:"pending"};
        try{
          if(typeof adapter.detect==="function"&&!await adapter.detect(context)){
            record.status="not-applicable";report.adapters.push(record);continue;
          }
          const value=await adapter.run(context)||{};
          const files=value.files||{};
          for(const [path,content] of Object.entries(files)){
            if(typeof path!=="string"||!path||path.startsWith("/")||path.includes("\\\\")||path.split("/").some(p=>p===".."||p===".")){
              throw new Error("adapter returned an unsafe output path");
            }
            report.files.push({adapter:adapter.id,path});
          }
          if(typeof value.lua==="string"&&value.lua.trim())report.luaParts.push({adapter:adapter.id,content:value.lua});
          results[adapter.id]=value;record.status="completed";
          record.fileCount=Object.keys(files).length;
        }catch(error){
          record.status="failed";record.error=String(error&&error.message||error);
          report.errors.push({adapter:adapter.id,error:record.error});
        }
        report.adapters.push(record);
      }
      return {results,report,lua:report.luaParts.map(x=>"-- Adapter: "+x.adapter+"\n"+x.content).join("\n\n")};
    }
    const api={register,run,list:()=>Array.from(adapters.keys())};
    return api;
  }
  root.Jar2ZeusPipeline={create};
})(typeof globalThis!=="undefined"?globalThis:this);
