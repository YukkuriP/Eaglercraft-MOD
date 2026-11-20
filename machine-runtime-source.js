/* Compressed source for the reusable Jar2Zeus Lua machine simulation runtime. */
(function(root){
 "use strict";
 const DATA=(root.Jar2ZeusMachineRuntimeChunks||[]).join("");
 if(DATA.length!==10676)throw new Error("machine runtime data is incomplete: "+DATA.length+" / 10676");
 async function load(){
  if(typeof DecompressionStream!=="function")throw new Error("gzip decompression is unavailable in this browser");
  const binary=atob(DATA),bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  const lua=await new Response(stream).text();
  if(!lua.startsWith("-- Jar2Zeus reusable local machine simulation runtime."))throw new Error("machine runtime source integrity check failed");
  return lua;
 }
 root.Jar2ZeusMachineRuntimeSource={load};
})(typeof globalThis!=="undefined"?globalThis:this);
