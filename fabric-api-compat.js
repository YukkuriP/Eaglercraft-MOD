/* Conservative Fabric API / Loader compatibility inventory for Jar2Zeus.
 * Reads parsed JVM references and fabric.mod.json only; never loads or executes mod bytecode.
 * Operation candidates are evidence for manual porting, not automatic API replacements.
 */
(function (root) {
  "use strict";

  const BLOCKED_FEATURE = /(?:cannon|artillery|projectile|munition|firearm|weapon|rifle|pistol|musket|sword|bow|crossbow|trident)/i;
  const PREFIXES = ["net/fabricmc/fabric/api/", "net/fabricmc/loader/api/", "net/fabricmc/api/"];
  const DETAIL_LIMIT = 5000;
  const ENTRYPOINT_LIMIT = 1000;

  const AREAS = [
    ["lifecycleEvents", /^net\/fabricmc\/fabric\/api\/event\/lifecycle\//],
    ["playerEntityEvents", /^net\/fabricmc\/fabric\/api\/(?:event\/player|entity\/event)\//],
    ["registriesAndContent", /^net\/fabricmc\/fabric\/api\/(?:registry|event\/registry|object\/builder|itemgroup|block|item)\//],
    ["networking", /^net\/fabricmc\/fabric\/api\/networking\//],
    ["rendering", /^net\/fabricmc\/fabric\/api\/(?:client\/rendering|rendering)\//],
    ["screenAndInput", /^net\/fabricmc\/fabric\/api\/(?:client\/keybinding|client\/screen|client\/event\/input|client\/networking)\//],
    ["commands", /^net\/fabricmc\/fabric\/api\/command\//],
    ["worldGenerationAndBiome", /^net\/fabricmc\/fabric\/api\/(?:biome|worldgen)\//],
    ["dataGeneration", /^net\/fabricmc\/fabric\/api\/datagen\//],
    ["resourceReload", /^net\/fabricmc\/fabric\/api\/resource\//],
    ["transferApi", /^net\/fabricmc\/fabric\/api\/transfer\//],
    ["eventSystem", /^net\/fabricmc\/fabric\/api\/event(?:\/|$)/],
    ["fabricLoader", /^net\/fabricmc\/loader\/api\//],
    ["fabricCommon", /^net\/fabricmc\/api\//]
  ];

  function normalizeName(value) {
    return typeof value === "string" ? value.replace(/\./g, "/").replace(/^L|;$/g, "") : "";
  }
  function isFabricOwner(owner) {
    return PREFIXES.some(prefix => owner.startsWith(prefix));
  }
  function categoryFor(owner) {
    for (const entry of AREAS) if (entry[1].test(owner)) return entry[0];
    return "unknownFabricApi";
  }
  function operationFor(owner, name, descriptor, kind) {
    if (kind === "field") {
      if (owner === "net/fabricmc/fabric/api/event/Event" && name === "invoker")
        return { id: "event_invoker_field", confidence: "high", reason: "Exact Fabric Event.invoker field access" };
      return null;
    }
    if (owner === "net/fabricmc/fabric/api/event/Event" && name === "register")
      return { id: "event_listener_registration", confidence: "high", reason: "Exact Fabric Event.register method owner and name" };
    if (owner === "net/fabricmc/fabric/api/event/Event" && name === "invoker")
      return { id: "event_invoker_lookup", confidence: "high", reason: "Exact Fabric Event.invoker method owner and name" };
    if (owner === "net/fabricmc/fabric/api/networking/v1/PayloadTypeRegistry" &&
        ["playC2S", "playS2C", "configurationC2S", "configurationS2C"].includes(name))
      return { id: "payload_registry_lookup", confidence: "high", reason: "Exact direction-specific Fabric PayloadTypeRegistry method" };
    if (/^net\/fabricmc\/fabric\/api\/networking\/v1\/(?:ServerPlayNetworking|ClientPlayNetworking)$/.test(owner) &&
        /^(?:registerGlobalReceiver|registerReceiver|send|canSend)$/.test(name))
      return { id: "fabric_network_operation", confidence: "high", reason: "Exact Fabric play-networking API owner and operation" };
    if (owner === "net/fabricmc/fabric/api/networking/v1/PlayerLookup" && name === "level")
      return { id: "fabric_player_lookup", confidence: "high", reason: "Exact PlayerLookup.level helper method" };
    if (owner === "net/fabricmc/fabric/api/registry/FuelRegistry" && name === "add")
      return { id: "fuel_registry_add", confidence: "high", reason: "Exact Fabric FuelRegistry.add method" };
    if (owner === "net/fabricmc/fabric/api/event/registry/FabricRegistryBuilder" &&
        ["createSimple", "createDefaulted", "attribute", "buildAndRegister"].includes(name))
      return { id: "custom_registry_builder_operation", confidence: "high", reason: "Exact FabricRegistryBuilder method" };
    if (owner === "net/fabricmc/fabric/api/event/registry/DynamicRegistries" &&
        ["register", "registerSynced"].includes(name))
      return { id: "dynamic_registry_registration", confidence: "high", reason: "Exact Fabric DynamicRegistries registration method" };
    if (owner === "net/fabricmc/fabric/api/itemgroup/v1/FabricItemGroup" && name === "builder")
      return { id: "item_group_builder", confidence: "high", reason: "Exact Fabric item-group builder method" };
    if (owner === "net/fabricmc/fabric/api/object/builder/v1/entity/FabricDefaultAttributeRegistry" && name === "register")
      return { id: "entity_attribute_registration", confidence: "high", reason: "Exact Fabric entity attribute registration method" };
    if (owner === "net/fabricmc/fabric/api/resource/ResourceManagerHelper" && name === "get")
      return { id: "resource_manager_helper_lookup", confidence: "high", reason: "Exact Fabric resource manager helper lookup" };
    if (owner === "net/fabricmc/fabric/api/client/keybinding/v1/KeyBindingHelper" && name === "registerKeyBinding")
      return { id: "keybinding_registration", confidence: "high", reason: "Exact Fabric keybinding registration method" };
    if (owner === "net/fabricmc/fabric/api/client/rendering/v1/HudElementRegistry" &&
        ["attachElementBefore", "attachElementAfter", "replaceElement"].includes(name))
      return { id: "hud_element_registration", confidence: "high", reason: "Exact Fabric HUD element registration method" };
    if (owner === "net/fabricmc/loader/api/FabricLoader" && name === "getInstance")
      return { id: "fabric_loader_singleton", confidence: "high", reason: "Exact FabricLoader singleton accessor" };
    if (owner === "net/fabricmc/loader/api/FabricLoader" &&
        ["isModLoaded", "getModContainer", "getAllMods", "getEntrypointContainers"].includes(name))
      return { id: "fabric_loader_query", confidence: "high", reason: "Exact FabricLoader mod or entrypoint query method" };
    return null;
  }
  function descriptorOwners(descriptor) {
    const owners = [];
    if (typeof descriptor !== "string") return owners;
    const pattern = /L([^;]+);/g;
    let match;
    while ((match = pattern.exec(descriptor))) {
      const owner = normalizeName(match[1]);
      if (isFabricOwner(owner)) owners.push(owner);
    }
    return owners;
  }
  function safeLimit(value, fallback) {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? Math.min(n, fallback) : fallback;
  }
  function entrypointRows(fabric, classNames, limit) {
    const rows = [];
    let total = 0, resolved = 0;
    const entries = fabric && fabric.entrypoints && typeof fabric.entrypoints === "object" ? fabric.entrypoints : {};
    for (const [type, raw] of Object.entries(entries)) {
      for (const item of (Array.isArray(raw) ? raw : [raw])) {
        total++;
        const value = typeof item === "string" ? item : item && typeof item.value === "string" ? item.value : "";
        const adapter = item && typeof item === "object" && typeof item.adapter === "string" ? item.adapter : null;
        const candidate = value.split("::")[0].trim();
        const className = /^[A-Za-z_$][A-Za-z0-9_$]*(?:[./][A-Za-z_$][A-Za-z0-9_$]*)*$/.test(candidate) ? normalizeName(candidate) : null;
        const found = !!(className && classNames.has(className));
        if (found) resolved++;
        if (rows.length < limit) rows.push({
          type: String(type), value: value.slice(0, 512), adapter, className,
          resolution: found ? "class-file-found" : className ? "class-file-not-found" : "non-class-or-custom-reference",
          javaClassResolved: found,
          expectedInitializerInterface: type === "main" ? "net/fabricmc/api/ModInitializer" :
            type === "client" ? "net/fabricmc/api/ClientModInitializer" :
            type === "server" ? "net/fabricmc/api/DedicatedServerModInitializer" :
            type === "preLaunch" ? "net/fabricmc/api/PreLaunchEntrypoint" : null,
          interfaceImplementationVerified: false, autoWired: false
        });
      }
    }
    return { rows, total, resolved, unresolved: total - resolved };
  }

  function analyze(input, options) {
    input = input && typeof input === "object" ? input : {};
    options = options && typeof options === "object" ? options : {};
    const detailLimit = safeLimit(options.detailLimit, DETAIL_LIMIT);
    const entrypointLimit = safeLimit(options.entrypointLimit, ENTRYPOINT_LIMIT);
    const classes = Array.isArray(input.classes) ? input.classes : [];
    const loaderAnalysis = input.loaderAnalysis && typeof input.loaderAnalysis === "object" ? input.loaderAnalysis : {};
    const fabric = loaderAnalysis.metadata && loaderAnalysis.metadata.fabric || input.fabricMetadata || {};
    const report = {
      schema: "jar2zeus.fabric-api-compatibility.v1",
      status: "no-fabric-api-references-observed",
      supportStatus: "analysis-only",
      loaderDetected: Array.isArray(loaderAnalysis.loaders) && loaderAnalysis.loaders.includes("Fabric"),
      apiMappingsApplied: 0,
      detailLimit, entrypointLimit,
      metadata: {
        id: typeof fabric.id === "string" ? fabric.id : null,
        version: typeof fabric.version === "string" ? fabric.version : null,
        environment: typeof fabric.environment === "string" ? fabric.environment : null,
        depends: fabric.depends && typeof fabric.depends === "object" ? fabric.depends : {},
        suggests: fabric.suggests && typeof fabric.suggests === "object" ? fabric.suggests : {},
        breaks: fabric.breaks && typeof fabric.breaks === "object" ? fabric.breaks : {},
        accessWidener: typeof fabric.accessWidener === "string" ? fabric.accessWidener : null,
        mixins: Array.isArray(fabric.mixins) ? fabric.mixins.slice(0, 500) : [],
        nestedJars: Array.isArray(fabric.jars) ? fabric.jars.map(x => x && typeof x.file === "string" ? x.file : null).filter(Boolean).slice(0, 500) : []
      },
      totals: {
        classesSeen: classes.length, classesAnalyzed: 0, restrictedClassesSkipped: 0,
        classesWithFabricReferences: 0, fabricApiClassReferenceSites: 0, loaderApiClassReferenceSites: 0,
        commonApiClassReferenceSites: 0, invocationSites: 0, fieldAccessSites: 0,
        knownCategorySites: 0, unknownCategorySites: 0, candidateOperationSites: 0,
        unmappedSites: 0, uniqueApiClasses: 0, entrypointsDeclared: 0,
        entrypointsResolved: 0, entrypointsUnresolved: 0, detailsObserved: 0,
        detailsReported: 0, detailsTruncated: false, entrypointDetailsTruncated: false
      },
      categories: {}, apiClasses: [], invocations: [], fieldAccesses: [], classReferences: [], entrypoints: [],
      limitations: [
        "Fabric API and Loader references are inventoried, not translated into Zeus API calls.",
        "Operation candidates are exact owner/name matches and are not safe replacements or proof of runtime compatibility.",
        "Entrypoint class presence does not prove constructor execution, initializer-interface implementation or lifecycle order.",
        "Mixin transformations, Access Widener effects, nested-JAR execution, reflection, lambda bootstrap handles and callback behavior are not reconstructed.",
        "Fabric API versions and target Eaglercraft Zeus runtime behavior require separate verification."
      ]
    };
    const apiCounts = new Map(), sourceClasses = new Set(), emittedRefs = new Set(), categoryCounts = Object.create(null);
    const invocationRows = [], fieldRows = [], referenceRows = [];
    let observed = 0;
    function record(owner, sourceClass) {
      owner = normalizeName(owner);
      if (!isFabricOwner(owner)) return null;
      const category = categoryFor(owner);
      apiCounts.set(owner, (apiCounts.get(owner) || 0) + 1);
      if (!categoryCounts[category]) categoryCounts[category] = { classReferences: 0, invocations: 0, fieldAccesses: 0 };
      if (sourceClass) sourceClasses.add(sourceClass);
      return { owner, category };
    }
    function push(target, row) { observed++; if (target.length < detailLimit) target.push(row); }

    for (const item of classes) {
      const info = item && item.classInfo ? item.classInfo : item;
      if (!info || info.valid !== true || typeof info.className !== "string") continue;
      const sourceClass = normalizeName(info.className);
      const sourcePath = item && typeof item.path === "string" ? item.path : sourceClass + ".class";
      if (BLOCKED_FEATURE.test(sourcePath) || BLOCKED_FEATURE.test(sourceClass)) {
        report.totals.restrictedClassesSkipped++;
        continue;
      }
      report.totals.classesAnalyzed++;
      const refs = new Set([].concat(info.references || [], info.superName || [], info.interfaces || []).filter(Boolean));
      for (const field of info.fields || []) for (const owner of descriptorOwners(field && field.descriptor)) refs.add(owner);
      for (const method of info.methods || []) for (const owner of descriptorOwners(method && method.descriptor)) refs.add(owner);
      for (const method of info.methods || []) {
        for (const inv of method && method.code && method.code.invocations || []) {
          const hit = record(inv.owner, sourceClass); if (!hit) continue;
          categoryCounts[hit.category].invocations++;
          report.totals.invocationSites++; report.totals.unmappedSites++;
          const op = operationFor(hit.owner, inv.name, inv.descriptor, "method");
          if (hit.category === "unknownFabricApi") report.totals.unknownCategorySites++;
          else report.totals.knownCategorySites++;
          if (op) report.totals.candidateOperationSites++;
          push(invocationRows, {
            sourcePath, sourceClass, sourceMethod: method.name || null, sourceDescriptor: method.descriptor || null,
            pc: Number.isInteger(inv.pc) ? inv.pc : null, owner: hit.owner, name: inv.name || null,
            descriptor: inv.descriptor || null, memberKind: inv.kind || "method", category: hit.category,
            operationCandidate: op ? op.id : null, confidence: op ? op.confidence : "high",
            evidence: op ? op.reason : "Exact Fabric namespace method reference in parsed bytecode",
            portStatus: "unmapped", autoConverted: false
          });
          refs.add(hit.owner);
        }
        for (const field of method && method.code && method.code.fieldAccesses || []) {
          const hit = record(field.owner, sourceClass); if (!hit) continue;
          categoryCounts[hit.category].fieldAccesses++;
          report.totals.fieldAccessSites++; report.totals.unmappedSites++;
          const op = operationFor(hit.owner, field.name, field.descriptor, "field");
          if (hit.category === "unknownFabricApi") report.totals.unknownCategorySites++;
          else report.totals.knownCategorySites++;
          if (op) report.totals.candidateOperationSites++;
          push(fieldRows, {
            sourcePath, sourceClass, sourceMethod: method.name || null, sourceDescriptor: method.descriptor || null,
            pc: Number.isInteger(field.pc) ? field.pc : null, owner: hit.owner, name: field.name || null,
            descriptor: field.descriptor || null, category: hit.category,
            operationCandidate: op ? op.id : null, confidence: op ? op.confidence : "high",
            evidence: op ? op.reason : "Exact Fabric namespace field reference in parsed bytecode",
            portStatus: "unmapped", autoConverted: false
          });
          refs.add(hit.owner);
        }
      }
      for (const raw of refs) {
        const owner = normalizeName(raw);
        if (!isFabricOwner(owner)) continue;
        const key = sourceClass + "|" + owner;
        if (emittedRefs.has(key)) continue;
        emittedRefs.add(key);
        const category = categoryFor(owner);
        sourceClasses.add(sourceClass);
        if (!apiCounts.has(owner)) apiCounts.set(owner, 1);
        if (!categoryCounts[category]) categoryCounts[category] = { classReferences: 0, invocations: 0, fieldAccesses: 0 };
        categoryCounts[category].classReferences++;
        report.totals.fabricApiClassReferenceSites += owner.startsWith("net/fabricmc/fabric/api/") ? 1 : 0;
        report.totals.loaderApiClassReferenceSites += owner.startsWith("net/fabricmc/loader/api/") ? 1 : 0;
        report.totals.commonApiClassReferenceSites += owner.startsWith("net/fabricmc/api/") ? 1 : 0;
        push(referenceRows, {
          sourcePath, sourceClass, apiClass: owner, category, confidence: "medium",
          evidence: "Fabric namespace appears in parsed class references, field/method descriptors or bytecode member owners",
          usageResolved: false, portStatus: "unverified", autoConverted: false
        });
      }
    }
    const classNames = new Set();
    for (const item of classes) {
      const info = item && item.classInfo ? item.classInfo : item;
      const path = item && typeof item.path === "string" ? item.path : "";
      if (info && info.valid === true && typeof info.className === "string" &&
          !BLOCKED_FEATURE.test(path) && !BLOCKED_FEATURE.test(info.className))
        classNames.add(normalizeName(info.className));
    }
    const ep = entrypointRows(fabric, classNames, entrypointLimit);
    report.entrypoints = ep.rows;
    report.totals.entrypointsDeclared = ep.total;
    report.totals.entrypointsResolved = ep.resolved;
    report.totals.entrypointsUnresolved = ep.unresolved;
    report.totals.entrypointDetailsTruncated = ep.total > ep.rows.length;
    report.invocations = invocationRows;
    report.fieldAccesses = fieldRows;
    report.classReferences = referenceRows;
    report.totals.classesWithFabricReferences = sourceClasses.size;
    report.totals.uniqueApiClasses = apiCounts.size;
    report.totals.detailsObserved = observed;
    report.totals.detailsReported = invocationRows.length + fieldRows.length + referenceRows.length;
    report.totals.detailsTruncated = observed > report.totals.detailsReported;
    report.categories = categoryCounts;
    report.apiClasses = Array.from(apiCounts.entries()).map(([name, references]) => ({
      name, references, category: categoryFor(name)
    })).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 1000);
    if (report.totals.unmappedSites || report.totals.fabricApiClassReferenceSites ||
        report.totals.loaderApiClassReferenceSites || report.totals.commonApiClassReferenceSites ||
        report.totals.entrypointsDeclared || report.metadata.accessWidener ||
        report.metadata.mixins.length || report.metadata.nestedJars.length) report.status = "manual-port-required";
    return report;
  }

  root.Jar2ZeusFabricApiCompatibility = { analyze, categoryFor, operationFor };
})(typeof globalThis !== "undefined" ? globalThis : this);
