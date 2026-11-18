const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const html=fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
test("browser application inline JavaScript parses",()=>{
 const scripts=Array.from(html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi));
 assert.ok(scripts.length>0);
 for(const match of scripts){if(match[1].trim())assert.doesNotThrow(()=>new vm.Script(match[1]));}
});
test("browser application loads every migration engine module",()=>{
 for(const file of ["converter.js","resource-converter.js","definition-converter.js","generic-mod-analyzer.js","migration-pipeline.js"])
  assert.ok(html.includes('<script src="'+file+'"></script>'),"missing "+file);
});
