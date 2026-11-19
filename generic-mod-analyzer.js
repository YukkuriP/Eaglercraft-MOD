/* Generic Minecraft JAR analyzer for Jar2Zeus.
 * Inspects archive structure, loader metadata, class-file references, entrypoints,
 * mixins, services, nested libraries and resource families without executing code.
 */
(function (root) {
  "use strict";

  const BLOCKED_FEATURE = /(?:cannon|artillery|projectile|munition|firearm|weapon|rifle|pistol|musket|sword|bow|crossbow|trident)/i;
  const LOADER_MARKERS = [
    ["Fabric", /net\/fabricmc\/|fabric\.mod\.json/i],
    ["Forge", /net\/minecraftforge\/|META-INF\/mods\.toml/i],
    ["NeoForge", /net\/neoforged\/|META-INF\/neoforge\.mods\.toml/i],
    ["Quilt", /org\/quiltmc\/|quilt\.mod\.json/i]
  ];

  function safePath(path) {
    return typeof path === "string" && path.length > 0 &&
      !path.startsWith("/") && !path.includes("\\") &&
      !path.split("/").some(part => part === "." || part === "..");
  }

  function parseClass(bytes) {
    const result = { valid: false, major: null, minor: null, className: null, references: [], utf8Count: 0, error: null };
    try {
      const view = bytes instanceof DataView ? bytes : new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      let p = 0;
      const u1 = () => { const v = view.getUint8(p); p += 1; return v; };
      const u2 = () => { const v = view.getUint16(p); p += 2; return v; };
      const u4 = () => { const v = view.getUint32(p); p += 4; return v; };
      if (u4() !== 0xCAFEBABE) throw new Error("invalid class magic");
      result.minor = u2(); result.major = u2();
      const count = u2();
      const cp = new Array(count);
      for (let i = 1; i < count; i++) {
        const tag = u1();
        if (tag === 1) {
          const len = u2();
          if (p + len > view.byteLength) throw new Error("truncated UTF-8 constant");
          const arr = new Uint8Array(view.buffer, view.byteOffset + p, len);
          let value;
          try { value = new TextDecoder("utf-8", { fatal: false }).decode(arr); }
          catch (_) { value = ""; }
          cp[i] = { tag, value }; p += len; result.utf8Count++;
        } else if (tag === 3 || tag === 4) { u4(); cp[i] = { tag }; }
        else if (tag === 5 || tag === 6) { u4(); u4(); cp[i] = { tag }; i++; }
        else if (tag === 7 || tag === 8 || tag === 16 || tag === 19 || tag === 20) cp[i] = { tag, index: u2() };
        else if (tag === 9 || tag === 10 || tag === 11 || tag === 12 || tag === 17 || tag === 18) { u2(); u2(); cp[i] = { tag }; }
        else if (tag === 15) { u1(); u2(); cp[i] = { tag }; }
        else throw new Error("unknown constant-pool tag " + tag);
        if (p > view.byteLength) throw new Error("truncated constant pool");
      }
      const refs = [];
      for (let i = 1; i < cp.length; i++) {
        const item = cp[i];
        if (item && item.tag === 7 && cp[item.index] && cp[item.index].tag === 1) {
          const name = cp[item.index].value;
          if (name && /^[A-Za-z0-9_$/]+$/.test(name)) refs.push(name);
        }
      }
      result.className = refs[0] || null;
      result.references = Array.from(new Set(refs)).sort();
      result.valid = true;
    } catch (e) { result.error = e.message; }
    return result;
  }

  function parseLoaderToml(raw, loader) {
    const text = String(raw || "");
    const mods = [];
    const modSections = text.split(/\[\[mods\]\]/i).slice(1);
    for (const section of modSections) {
      const id = (section.match(/\bmodId\s*=\s*"([^"]+)"/i) || [])[1] || null;
      const version = (section.match(/\bversion\s*=\s*"([^"]+)"/i) || [])[1] || null;
      const displayName = (section.match(/\bdisplayName\s*=\s*"([^"]+)"/i) || [])[1] || null;
      if (id) mods.push({ id, version, displayName });
    }
    const dependencies = [];
    const depSections = text.split(/\[\[dependencies\.[^\]]+\]\]/i).slice(1);
    for (const section of depSections) {
      const modId = (section.match(/\bmodId\s*=\s*"([^"]+)"/i) || [])[1] || null;
      const versionRange = (section.match(/\bversionRange\s*=\s*"([^"]+)"/i) || [])[1] || null;
      const mandatory = (section.match(/\bmandatory\s*=\s*(true|false)/i) || [])[1];
      if (modId) dependencies.push({ modId, versionRange, mandatory: mandatory == null ? null : mandatory.toLowerCase() === "true" });
    }
    return {
      loader,
      modLoader: (text.match(/\bmodLoader\s*=\s*"([^"]+)"/i) || [])[1] || null,
      loaderVersion: (text.match(/\bloaderVersion\s*=\s*"([^"]+)"/i) || [])[1] || null,
      mods,
      dependencies
    };
  }

  function analyze(entries) {
    const report = {
      schema: "jar2zeus.generic-analysis.v1",
      archive: { entries: entries.length, totalBytes: 0, unsafePaths: [], duplicatePaths: [] },
      loaders: [], minecraftVersions: [], javaClassVersions: {},
      metadata: { fabric: null, quilt: null, forge: null, neoforge: null, manifest: null, jarjar: null },
      entrypoints: [], mixinConfigs: [], accessTransformers: [], services: [],
      featureFamilies: { blocksItems: [], entities: [], worldGeneration: [], rendering: [], animations: [], networking: [], userInterface: [], audio: [], commands: [], storage: [], configuration: [] },
      migrationAssessment: { resourcePort: "partial", javaLogicPort: "requires a manual rewrite or a compatible runtime", overall: "analysis-only until feature adapters and in-game tests pass" },
      nestedJars: [], libraries: [], classes: { count: 0, invalid: 0, names: [], references: {}, frameworkReferences: [] },
      resources: { assets: 0, data: 0, textures: 0, models: 0, entityGeometries: 0, animations: 0, blockstates: 0, recipes: 0, tags: 0, lang: 0, sounds: 0, shaders: 0, configs: 0, other: 0 },
      featureReview: { restrictedPathCount: 0, restrictedPaths: [] },
      unsupportedIndicators: [], warnings: []
    };
    const seen = new Set();
    const textByPath = new Map();
    const classRefs = new Set();
    const framework = /^(net\/minecraftforge\/|net\/neoforged\/|net\/fabricmc\/|org\/quiltmc\/|org\/spongepowered\/asm\/|org\/objectweb\/asm\/|net\/minecraft\/)/;
    for (const entry of entries) {
      const path = entry.path || "";
      const size = Number(entry.size || (entry.bytes && entry.bytes.byteLength) || (typeof entry.content === "string" ? new TextEncoder().encode(entry.content).length : 0));
      report.archive.totalBytes += Number.isFinite(size) ? size : 0;
      if (!safePath(path)) { report.archive.unsafePaths.push(path); continue; }
      if (seen.has(path)) report.archive.duplicatePaths.push(path);
      seen.add(path);
      if (BLOCKED_FEATURE.test(path)) {
        report.featureReview.restrictedPathCount++;
        if (report.featureReview.restrictedPaths.length < 100) report.featureReview.restrictedPaths.push(path);
      }
      const lower = path.toLowerCase();
      if (lower.startsWith("assets/")) report.resources.assets++;
      else if (lower.startsWith("data/")) report.resources.data++;
      if (/\/textures\/.*\.png$/i.test(path)) report.resources.textures++;
      if (/\/models\/.*\.json$/i.test(path)) report.resources.models++;
      if (/\/geo\/.*\.geo\.json$/i.test(path) || /\/models\/entity\/.*\.json$/i.test(path)) report.resources.entityGeometries++;
      if (/\/animations\/.*\.json$/i.test(path) || /\.animation\.json$/i.test(path)) report.resources.animations++;
      if (/\/blockstates\/.*\.json$/i.test(path)) report.resources.blockstates++;
      if (/\/recipes?\/.*\.json$/i.test(path)) report.resources.recipes++;
      if (/\/tags\/.*\.json$/i.test(path)) report.resources.tags++;
      if (/\/lang\/.*\.json$/i.test(path)) report.resources.lang++;
      if (/\/sounds?\//i.test(path) || /sounds\.json$/i.test(path)) report.resources.sounds++;
      if (/\/shaders?\//i.test(path)) report.resources.shaders++;
      if (/\.cfg$|\.toml$|\.properties$|\/config\//i.test(path)) report.resources.configs++;
      if (/\.class$/i.test(path)) {
        report.classes.count++;
        if (entry.bytes || entry.classInfo) {
          const c = entry.classInfo || parseClass(entry.bytes);
          if (!c.valid) report.classes.invalid++;
          else {
            report.javaClassVersions[c.major] = (report.javaClassVersions[c.major] || 0) + 1;
            if (c.className && report.classes.names.length < 300) report.classes.names.push(c.className);
            for (const ref of c.references) {
              classRefs.add(ref);
              if (framework.test(ref)) report.classes.references[ref] = (report.classes.references[ref] || 0) + 1;
            }
          }
        }
      }
      if (/\.jar$/i.test(path) && !/\.jar$/i.test(entry.name || "")) report.nestedJars.push(path);
      else if (/\.jar$/i.test(path)) report.nestedJars.push(path);
      if (/^META-INF\/services\//i.test(path)) report.services.push(path);
      if (/^META-INF\/.*access.?transformer/i.test(path) || /accesstransformer\.cfg$/i.test(path)) report.accessTransformers.push(path);
      if (/mixins?.*\.json$/i.test(path) || /mixin.*\.json$/i.test(path)) report.mixinConfigs.push(path);
      if (/^META-INF\/MANIFEST\.MF$/i.test(path)) report.metadata.manifest = path;
      if (/^META-INF\/jarjar\/metadata\.json$/i.test(path)) report.metadata.jarjar = path;
      if (entry.content != null && typeof entry.content === "string") textByPath.set(path, entry.content);
      if (/^fabric\.mod\.json$/i.test(path)) {
        try { report.metadata.fabric = JSON.parse(entry.content); } catch (_) { report.warnings.push("fabric.mod.json のJSON解析に失敗"); }
      }
      if (/^quilt\.mod\.json$/i.test(path)) {
        try { report.metadata.quilt = JSON.parse(entry.content); } catch (_) { report.warnings.push("quilt.mod.json のJSON解析に失敗"); }
      }
      if (/^META-INF\/mods\.toml$/i.test(path)) report.metadata.forge = path;
      if (/^META-INF\/neoforge\.mods\.toml$/i.test(path)) report.metadata.neoforge = path;
      if (/^META-INF\/.*\.jar$/i.test(path)) report.libraries.push(path);
    }
    for (const [label, regex] of LOADER_MARKERS) {
      if (entries.some(e => regex.test(e.path || "")) || Array.from(classRefs).some(x => regex.test(x))) report.loaders.push(label);
    }
    const fabric = report.metadata.fabric;
    if (fabric && typeof fabric === "object") {
      report.entrypoints.push(...Object.entries(fabric.entrypoints || {}).flatMap(([key, value]) =>
        (Array.isArray(value) ? value : [value]).map(v => ({ loader: "Fabric", type: key, value: typeof v === "string" ? v : (v && v.value) || "" }))));
      const deps = fabric.depends || {};
      if (typeof deps.minecraft === "string") report.minecraftVersions.push(deps.minecraft);
      else if (Array.isArray(deps.minecraft)) report.minecraftVersions.push(...deps.minecraft);
      report.libraries.push(...(fabric.jars || []).map(x => x && x.file).filter(Boolean));
      if (fabric.accessWidener) report.accessTransformers.push(fabric.accessWidener);
    }
    if (report.metadata.quilt) {
      const q = report.metadata.quilt.quilt_loader || {};
      if (q.metadata && q.metadata.contact) report.metadata.quiltContact = q.metadata.contact;
      report.libraries.push(...(q.jarjars || []).map(x => x && x.file).filter(Boolean));
      report.entrypoints.push(...Object.entries(q.entrypoints || {}).map(([type, value]) => ({ loader: "Quilt", type, value: JSON.stringify(value) })));
    }
    for (const path of report.mixinConfigs) {
      const raw = textByPath.get(path);
      if (raw) try {
        const obj = JSON.parse(raw);
        for (const value of [].concat(obj.plugin || [], obj.mixins || [], obj.client || [], obj.server || []))
          if (typeof value === "string") report.entrypoints.push({ loader: "Mixin", type: "mixin", value });
      } catch (_) {}
    }
    report.classes.frameworkReferences = Array.from(classRefs).filter(x => framework.test(x)).sort().slice(0, 500);
    const families = [
      ["blocksItems", /net\/minecraft\/(?:world\/level\/block|world\/item|world\/item\/crafting|block\/|item\/|recipe)/],
      ["entities", /net\/minecraft\/(?:world\/entity|entity\/)/],
      ["worldGeneration", /net\/minecraft\/(?:world\/level\/levelgen|world\/gen|world\/level\/biome)/],
      ["rendering", /net\/minecraft\/client\/(?:renderer|model|animation|gui\/Font)|net\/minecraftforge\/client\/event\/Render|net\/fabricmc\/fabric\/api\/client\/rendering|software\/bernie\/geckolib|com\/github\/alexthe666\/citadel/],
      ["animations", /(?:AnimationController|AnimationDefinition|AnimationState|Keyframe|software\/bernie\/geckolib\/animation|net\/minecraft\/client\/animation)/],
      ["networking", /net\/minecraft\/(?:network|server\/network)|(?:Packet|Payload|NetworkHandler)/i],
      ["userInterface", /net\/minecraft\/client\/gui|net\/minecraft\/client\/screen|(?:Screen|Menu|Widget)$/],
      ["audio", /net\/minecraft\/(?:sounds|client\/sounds)|(?:SoundEvent|SoundManager)/],
      ["commands", /net\/minecraft\/commands|(?:CommandDispatcher|CommandSource)/],
      ["storage", /net\/minecraft\/(?:world\/level\/storage|nbt|world\/level\/saveddata)/],
      ["configuration", /(?:Config|Configuration|ForgeConfigSpec|ModConfig)/]
    ];
    for (const ref of classRefs) for (const [family, regex] of families) {
      if (regex.test(ref) && report.featureFamilies[family].length < 200) report.featureFamilies[family].push(ref);
    }
    for (const family of Object.keys(report.featureFamilies)) report.featureFamilies[family] = Array.from(new Set(report.featureFamilies[family])).sort();
    report.migrationAssessment.featureCounts = Object.fromEntries(Object.entries(report.featureFamilies).map(([k,v]) => [k,v.length]));
    report.migrationAssessment.detectedFamilies = Object.keys(report.featureFamilies).filter(k => report.featureFamilies[k].length > 0);
    report.classes.names.sort();
    if (report.classes.invalid) report.warnings.push("一部の.classファイルをクラス形式として解析できませんでした");
    if (report.nestedJars.length) report.unsupportedIndicators.push("Nested JAR / Jar-in-Jar dependencies");
    if (report.mixinConfigs.length) report.unsupportedIndicators.push("Mixin transformations");
    if (report.accessTransformers.length) report.unsupportedIndicators.push("Access Transformers");
    if (report.services.length) report.unsupportedIndicators.push("Java ServiceLoader providers");
    if (report.featureFamilies.rendering.length) report.unsupportedIndicators.push("Custom client rendering / model logic");
    if (report.featureFamilies.animations.length || report.resources.animations) report.unsupportedIndicators.push("Custom entity animation / keyframe logic");
    if (report.featureFamilies.networking.length) report.unsupportedIndicators.push("Custom networking / packet logic");
    if (report.featureFamilies.worldGeneration.length) report.unsupportedIndicators.push("Custom world generation");
    if (report.classes.count) report.unsupportedIndicators.push("Java bytecode requires runtime/API porting");
    report.archive.unsafePaths = Array.from(new Set(report.archive.unsafePaths));
    report.archive.duplicatePaths = Array.from(new Set(report.archive.duplicatePaths));
    report.minecraftVersions = Array.from(new Set(report.minecraftVersions));
    report.libraries = Array.from(new Set(report.libraries));
    report.loaders = Array.from(new Set(report.loaders));
    return report;
  }

  root.Jar2ZeusGenericAnalyzer = { analyze, parseClass, safePath };
})(typeof globalThis !== "undefined" ? globalThis : this);
