/* Jar2Zeus converter core. No dependencies; browser-compatible. */
(function (root) {
  "use strict";
  const BLOCKED = /(?:cannon|artillery|projectile|munition|firearm|gunpowder_weapon|weapon|rifle|pistol|musket|sword|bow|crossbow|trident)/i;
  const ID = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;
  function quote(s) {
    const text = String(s);
    let out = '"';
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i), ch = text[i];
      if (ch === "\\") out += "\\\\";
      else if (ch === '"') out += '\\"';
      else if (ch === "\n") out += "\\n";
      else if (ch === "\r") out += "\\r";
      else if (ch === "\t") out += "\\t";
      else if (code < 32 || code === 127) out += "\\" + String(code).padStart(3, "0");
      else out += ch;
    }
    return out + '"';
  }
  function lua(v) {
    if (v === null) return "nil";
    if (typeof v === "boolean" || typeof v === "number") return String(v);
    if (typeof v === "string") return quote(v);
    if (Array.isArray(v)) return "{ " + v.map(lua).join(", ") + " }";
    if (v && typeof v === "object") {
      return "{ " + Object.keys(v).sort().map(k => "[" + quote(k) + "] = " + lua(v[k])).join(", ") + " }";
    }
    return "nil";
  }
  function idOf(value, allowTag) {
    if (typeof value === "string") {
      if (value.startsWith("#")) { if (!allowTag) return null; const tag = value.slice(1); return "#" + (tag.includes(":") ? tag : "minecraft:" + tag); }
      return value.includes(":") ? value : "minecraft:" + value;
    }
    if (!value || typeof value !== "object") return null;
    if (typeof value.item === "string") return idOf(value.item, false);
    if (typeof value.tag === "string") return allowTag ? "#" + (value.tag.includes(":") ? value.tag : "minecraft:" + value.tag) : null;
    if (typeof value.id === "string") return idOf(value.id, false);
    return null;
  }
  function safeRecipeId(path) {
    const m = path.match(/^data\/([a-z0-9_.-]+)\/recipes?\/([a-z0-9_./-]+)\.json$/);
    if (!m) return null;
    const parts = m[2].split("/");
    if (parts.some(p => !p || p === "." || p === "..")) return null;
    return m[1] + ":" + m[2];
  }
  function validId(value) {
    if (typeof value !== "string" || !ID.test(value)) return false;
    const parts = value.split(":")[1].split("/");
    return parts.every(p => p && p !== "." && p !== "..");
  }
  function validResourceId(value,allowTag){
    if(typeof value!=="string")return false;
    const raw=value.startsWith("#")&&allowTag?value.slice(1):value;
    const normalized=raw.includes(":")?raw:"minecraft:"+raw;
    return validId(normalized);
  }
  function validIngredient(value,depth){
    depth=depth||0;
    if(depth>8)return false;
    if(typeof value==="string")return validResourceId(value,true);
    if(Array.isArray(value))return value.length>0&&value.length<=32&&value.every(item=>validIngredient(item,depth+1));
    if(!value||typeof value!=="object")return false;
    if(typeof value.item==="string")return validResourceId(value.item,false);
    if(typeof value.id==="string")return validResourceId(value.id,false);
    if(typeof value.tag==="string")return validResourceId("#"+value.tag,true);
    if(Array.isArray(value.items))return value.items.length>0&&value.items.length<=32&&value.items.every(item=>typeof item==="string"&&validResourceId(item,false));
    if(Array.isArray(value.terms))return value.terms.length>0&&value.terms.length<=32&&value.terms.every(item=>validIngredient(item,depth+1));
    return false;
  }
  function validResult(value){
    if(typeof value==="string")return validResourceId(value,false);
    if(!value||typeof value!=="object"||Array.isArray(value))return false;
    const item=value.item||value.id;
    if(!validResourceId(item,false))return false;
    if(value.count!==undefined&&(!Number.isInteger(value.count)||value.count<1||value.count>99))return false;
    return true;
  }
  function boundedJson(value,depth,budget){
    if(depth>24)return false;
    budget.count++;
    if(budget.count>12000)return false;
    if(typeof value==="string")return value.length<=16384;
    if(typeof value==="number")return Number.isFinite(value);
    if(value===null||typeof value==="boolean")return true;
    if(Array.isArray(value))return value.length<=2048&&value.every(v=>boundedJson(v,depth+1,budget));
    if(typeof value==="object"){
      const keys=Object.keys(value);
      return keys.length<=2048&&keys.every(k=>k.length<=256&&boundedJson(value[k],depth+1,budget));
    }
    return false;
  }
  const VANILLA_RECIPE_TYPES=new Set([
    "minecraft:crafting_shaped","minecraft:crafting_shapeless",
    "minecraft:smelting","minecraft:blasting","minecraft:smoking",
    "minecraft:campfire_cooking","minecraft:stonecutting",
    "minecraft:smithing_transform","minecraft:smithing_trim",
    "minecraft:crafting_transmute"
  ]);
  function validateRecipe(type,r){
    if(type==="minecraft:crafting_shaped"){
      if(!Array.isArray(r.pattern)||r.pattern.length<1||r.pattern.length>3||
         r.pattern.some(row=>typeof row!=="string"||row.length<1||row.length>3)||!r.key||typeof r.key!=="object"||Array.isArray(r.key))return "invalid shaped recipe pattern or key";
      const symbols=new Set();
      for(const row of r.pattern)for(const symbol of row)if(symbol!==" ")symbols.add(symbol);
      for(const symbol of symbols)if(!Object.prototype.hasOwnProperty.call(r.key,symbol))return "shaped recipe is missing key symbol: "+symbol;
      for(const [symbol,ingredient] of Object.entries(r.key)){
        if(symbol.length!==1||!validIngredient(ingredient))return "unsupported shaped ingredient: "+symbol;
      }
    }else if(type==="minecraft:crafting_shapeless"){
      if(!Array.isArray(r.ingredients)||r.ingredients.length<1||r.ingredients.length>9||!r.ingredients.every(x=>validIngredient(x)))return "invalid shapeless ingredients";
    }else if(["minecraft:smelting","minecraft:blasting","minecraft:smoking","minecraft:campfire_cooking","minecraft:stonecutting"].includes(type)){
      if(!validIngredient(r.ingredient))return "unsupported recipe ingredient";
      if(type!=="minecraft:stonecutting"){
        const time=Number(r.cookingtime===undefined?200:r.cookingtime),xp=Number(r.experience===undefined?0:r.experience);
        if(!Number.isFinite(time)||time<=0||!Number.isFinite(xp)||xp<0)return "invalid cooking time or experience";
      }
    }else if(type==="minecraft:smithing_transform"||type==="minecraft:smithing_trim"){
      if(!validIngredient(r.template)||!validIngredient(r.base)||!validIngredient(r.addition))return "invalid smithing template, base or addition";
    }else if(type==="minecraft:crafting_transmute"){
      if(!validIngredient(r.input)||!validIngredient(r.material))return "invalid transmute input or material";
    }
    if(type!=="minecraft:smithing_trim"&&!validResult(r.result))return "invalid or missing recipe result";
    return null;
  }
  function convertRecipe(path,raw){
    const rid=safeRecipeId(path);
    if(!rid)return {status:"ignored",reason:"not a safe recipe path"};
    if(typeof raw!=="string"||raw.length>1024*1024)return {status:"skipped",reason:"recipe JSON is missing or exceeds 1 MiB"};
    let r;try{r=JSON.parse(raw)}catch(_){return {status:"skipped",reason:"invalid JSON"}}
    if(isBlocked(path,r))return {status:"excluded",reason:"restricted content is not converted"};
    const budget={count:0};
    if(!boundedJson(r,0,budget))return {status:"skipped",reason:"recipe JSON exceeds structural limits"};
    if(!r||typeof r!=="object"||Array.isArray(r))return {status:"skipped",reason:"recipe root must be an object"};
    const type=String(r.type||"");
    if(!VANILLA_RECIPE_TYPES.has(type))return {status:"skipped",reason:"recipe type is not in the verified vanilla set: "+type};
    const reason=validateRecipe(type,r);
    if(reason)return {status:"skipped",reason};
    const luaLine="recipes.add("+lua(rid)+", "+lua(r)+")";
    return {status:"converted",lua:luaLine,id:rid,type};
  }
  function convert(recipeEntries) {
    const lines = [
      "-- Generated by Jar2Zeus. Review before importing.",
      "-- Converts supported vanilla-style crafting and cooking recipes only.",
      ""
    ];
    const report = { total: recipeEntries.length, converted: 0, skipped: [], excluded: [] };
    for (const entry of recipeEntries) {
      const result = convertRecipe(entry.path, entry.content);
      if (result.status === "converted") {
        lines.push("-- " + result.id + " (" + result.type + ")");
        lines.push(result.lua, "");
        report.converted++;
      } else if (result.status === "excluded") report.excluded.push({ path: entry.path, reason: result.reason });
      else if (result.status !== "ignored") report.skipped.push({ path: entry.path, reason: result.reason });
    }
    return { mainLua: lines.join("\n"), report };
  }
  root.Jar2ZeusConverter = { convert, convertRecipe, lua, idOf };
})(typeof globalThis !== "undefined" ? globalThis : this);
