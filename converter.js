/* Jar2Zeus converter core. No dependencies; browser-compatible. */
(function (root) {
  "use strict";
  const BLOCKED = /(?:cannon|artillery|projectile|munition|firearm|gunpowder_weapon|weapon|rifle|pistol|musket)/i;
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
  function validIngredient(value) { const item = idOf(value, true); if (!item) return null; return validId(item.startsWith("#") ? item.slice(1) : item) ? item : null; }
  function isBlocked(path, parsed) {
    const s = path + " " + JSON.stringify(parsed);
    return BLOCKED.test(s);
  }
  function convertRecipe(path, raw) {
    const rid = safeRecipeId(path);
    if (!rid) return { status: "ignored", reason: "not a recipe path" };
    let r;
    try { r = JSON.parse(raw); } catch (_) { return { status: "skipped", reason: "invalid JSON" }; }
    if (isBlocked(path, r)) return { status: "excluded", reason: "restricted weapon-related content" };
    const type = String(r.type || "");
    const result = r.result && (r.result.item || r.result.id) || r.result;
    const resultId = idOf(result, false);
    if (!validId(resultId)) return { status: "skipped", reason: "unsupported result format" };
    const count = Number((r.result && r.result.count) || r.count || 1);
    const safeCount = Number.isFinite(count) && count > 0 ? Math.floor(count) : 1;
    const base = { result: resultId };
    if (safeCount !== 1) base.count = safeCount;
    let call, opts;
    if (type === "minecraft:crafting_shaped" || type === "crafting_shaped") {
      if (!Array.isArray(r.pattern) || r.pattern.length < 1 || r.pattern.length > 3 || r.pattern.some(row => typeof row !== "string" || row.length < 1 || row.length > 3) || !r.key || typeof r.key !== "object") return { status: "skipped", reason: "invalid shaped recipe" };
      const key = {};
      for (const [symbol, ingredient] of Object.entries(r.key)) {
        const item = validIngredient(ingredient);
        if (!item) return { status: "skipped", reason: "unsupported shaped ingredient" };
        key[symbol] = item;
      }
      opts = Object.assign({ pattern: r.pattern, key }, base);
      call = "recipes.shaped";
    } else if (type === "minecraft:crafting_shapeless" || type === "crafting_shapeless") {
      if (!Array.isArray(r.ingredients) || r.ingredients.length < 1 || r.ingredients.length > 9) return { status: "skipped", reason: "invalid shapeless recipe" };
      const ingredients = r.ingredients.map(x => validIngredient(x));
      if (ingredients.some(x => !x)) return { status: "skipped", reason: "unsupported shapeless ingredient" };
      opts = Object.assign({ ingredients }, base);
      call = "recipes.shapeless";
    } else if (/^minecraft:(smelting|blasting|smoking|campfire_cooking)$/.test(type) || /^(smelting|blasting|smoking|campfire_cooking)$/.test(type)) {
      const input = validIngredient(r.ingredient);
      if (!input) return { status: "skipped", reason: "unsupported cooking ingredient" };
      const seconds = Number(r.cookingtime || 200) / 20;
      const xp = Number(r.experience || 0);
      if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isFinite(xp) || xp < 0) return { status: "skipped", reason: "invalid cooking time or experience" };
      opts = Object.assign({ input, xp, seconds }, base);
      if (type.endsWith("blasting")) opts.blasting = true;
      if (type.endsWith("smoking")) opts.smoking = true;
      if (type.endsWith("campfire_cooking")) opts.campfire = true;
      call = "recipes.smelting";
    } else if (type === "minecraft:stonecutting" || type === "stonecutting") {
      const input = idOf(r.ingredient, true);
      if (!input) return { status: "skipped", reason: "unsupported stonecutting ingredient" };
      opts = Object.assign({ input }, base);
      call = "recipes.stonecutting";
    } else {
      return { status: "skipped", reason: "unsupported recipe type: " + type };
    }
    return { status: "converted", lua: call + "(" + lua(opts) + ")", id: rid, type };
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
