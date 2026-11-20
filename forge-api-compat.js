/* Conservative Forge API compatibility inventory for Jar2Zeus.
 * Reads parsed JVM references only; never loads or executes Forge classes.
 * Detection is not a Forge-to-Zeus implementation or compatibility guarantee.
 */
(function (root) {
  "use strict";

  const BLOCKED_FEATURE = /(?:cannon|artillery|projectile|munition|firearm|weapon|rifle|pistol|musket|sword|bow|crossbow|trident)/i;
  const FORGE_PREFIX = "net/minecraftforge/";
  const DEFAULT_DETAIL_LIMIT = 5000;

  const AREAS = [
    ["modEntrypoint", /^net\/minecraftforge\/fml\/(?:common\/Mod(?:$|\$)|javafmlmod\/FMLJavaModLoadingContext$|ModList$|ModContainer$)/],
    ["eventBus", /^net\/minecraftforge\/(?:eventbus\/api\/|common\/MinecraftForge$)/],
    ["lifecycle", /^net\/minecraftforge\/fml\/event\/lifecycle\//],
    ["registries", /^net\/minecraftforge\/registries\//],
    ["capabilities", /^net\/minecraftforge\/common\/capabilities\//],
    ["networking", /^net\/minecraftforge\/network\//],
    ["configuration", /^net\/minecraftforge\/(?:common\/ForgeConfigSpec|fml\/config\/|fml\/ModLoadingContext)/],
    ["blockItemExtensions", /^net\/minecraftforge\/common\/extensions\/IForge(?:Block|Item|Entity|LivingEntity|Level|BlockEntity)/],
    ["recipes", /^net\/minecraftforge\/common\/crafting\//],
    ["rendering", /^net\/minecraftforge\/client\/(?:event|renderer|model)\//],
    ["commands", /^net\/minecraftforge\/event\/(?:RegisterCommandsEvent|CommandEvent)$/],
    ["worldGeneration", /^net\/minecraftforge\/(?:common\/world\/|event\/level\/(?:biome|levelgen)\/)/],
    ["dataGeneration", /^net\/minecraftforge\/data\//],
    ["gameplayEvents", /^net\/minecraftforge\/event\//],
    ["otherForgeApi", /^net\/minecraftforge\//]
  ];

  function normalizeName(value) {
    return typeof value === "string" ? value.replace(/\./g, "/").replace(/^L|;$/g, "") : "";
  }

  function categoryFor(owner) {
    for (const entry of AREAS) if (entry[1].test(owner)) return entry[0];
    return "otherForgeApi";
  }

  function operationFor(owner, name, descriptor, kind) {
    if (kind === "field") {
      if (/^net\/minecraftforge\/registries\/ForgeRegistries$/.test(owner))
        return { id: "forge_registry_field", confidence: "high", reason: "Exact ForgeRegistries field access" };
      if (owner === "net/minecraftforge/common/MinecraftForge" && name === "EVENT_BUS")
        return { id: "global_event_bus_access", confidence: "high", reason: "Exact MinecraftForge.EVENT_BUS field access" };
      return null;
    }
    if (owner === "net/minecraftforge/eventbus/api/IEventBus" && (name === "addListener" || name === "register"))
      return { id: "event_bus_registration", confidence: "high", reason: "Exact IEventBus registration method owner and name" };
    if (owner === "net/minecraftforge/fml/javafmlmod/FMLJavaModLoadingContext" && (name === "get" || name === "getModEventBus"))
      return { id: "mod_event_bus_access", confidence: "high", reason: "Exact Forge mod-loading context method owner and name" };
    if (owner === "net/minecraftforge/registries/DeferredRegister" && (name === "create" || name === "register"))
      return { id: name === "create" ? "deferred_register_create" : "deferred_register_bind", confidence: "high", reason: "Exact DeferredRegister method owner and name" };
    if (owner === "net/minecraftforge/registries/RegistryObject" && name === "get")
      return { id: "registry_object_lookup", confidence: "high", reason: "Exact RegistryObject lookup method owner and name" };
    if (owner === "net/minecraftforge/event/RegisterEvent" && name === "register")
      return { id: "register_event_callback", confidence: "high", reason: "Exact RegisterEvent registration method owner and name" };
    if (owner === "net/minecraftforge/network/NetworkRegistry" && name === "newSimpleChannel")
      return { id: "simple_channel_create", confidence: "high", reason: "Exact NetworkRegistry channel factory owner and name" };
    if (owner === "net/minecraftforge/network/SimpleChannel" && (name === "registerMessage" || name === "sendToServer" || name === "send"))
      return { id: "simple_channel_operation", confidence: "high", reason: "Exact SimpleChannel operation owner and name" };
    if (owner === "net/minecraftforge/common/capabilities/CapabilityManager" && name === "get")
      return { id: "capability_lookup", confidence: "high", reason: "Exact CapabilityManager lookup owner and name" };
    if (/^net\/minecraftforge\/common\/capabilities\/AttachCapabilitiesEvent$/.test(owner) && name === "addCapability")
      return { id: "attach_capability", confidence: "high", reason: "Exact AttachCapabilitiesEvent method owner and name" };
    if (/^net\/minecraftforge\/fml\/ModLoadingContext$/.test(owner) && name === "registerConfig")
      return { id: "config_registration", confidence: "high", reason: "Exact ModLoadingContext config registration owner and name" };
    if (/^net\/minecraftforge\/common\/ForgeConfigSpec(?:\$Builder)?$/.test(owner) && /^define/.test(name))
      return { id: "config_value_definition", confidence: "high", reason: "Exact ForgeConfigSpec definition method owner and name" };
    if (owner === "net/minecraftforge/eventbus/api/Event" && name === "isCanceled")
      return { id: "event_cancellation_query", confidence: "high", reason: "Exact Forge Event cancellation query owner and name" };
    return null;
  }

  function safeLimit(value) {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? Math.min(n, DEFAULT_DETAIL_LIMIT) : DEFAULT_DETAIL_LIMIT;
  }

  function analyze(input, options) {
    input = input && typeof input === "object" ? input : {};
    options = options && typeof options === "object" ? options : {};
    const detailLimit = safeLimit(options.detailLimit);
    const classes = Array.isArray(input.classes) ? input.classes : [];
    const report = {
      schema: "jar2zeus.forge-api-compatibility.v1",
      status: "no-forge-api-references-observed",
      supportStatus: "analysis-only",
      loaderDetected: !!(input.loaderAnalysis && Array.isArray(input.loaderAnalysis.loaders) && input.loaderAnalysis.loaders.includes("Forge")),
      apiMappingsApplied: 0,
      detailLimit,
      totals: {
        classesSeen: classes.length, classesAnalyzed: 0, restrictedClassesSkipped: 0,
        classesWithForgeApi: 0, classReferenceSites: 0, invocationSites: 0, fieldAccessSites: 0,
        knownCategorySites: 0, unknownCategorySites: 0, candidateOperationSites: 0,
        unmappedSites: 0, uniqueApiClasses: 0, detailsObserved: 0, detailsReported: 0,
        detailsTruncated: false
      },
      categories: {},
      apiClasses: [],
      invocations: [],
      fieldAccesses: [],
      classReferences: [],
      limitations: [
        "Forge API references are inventoried, not translated into Zeus API calls.",
        "Class-file annotation attribute payloads, runtime registration order, generic values and callback behavior are not reconstructed.",
        "A detected method signature is only an API operation candidate; it is not proof that the call can be replaced safely.",
        "Forge version mappings, mappings from obfuscated Minecraft symbols, reflection, mixins and runtime behavior require separate analysis."
      ]
    };
    const apiClassCounts = new Map();
    const classSeen = new Set();
    const emittedClassReference = new Set();
    const categoryCounts = Object.create(null);
    const invocationRows = [];
    const fieldRows = [];
    const referenceRows = [];
    let observedDetails = 0;

    function recordOwner(owner, sourceClass, sourcePath) {
      owner = normalizeName(owner);
      if (!owner.startsWith(FORGE_PREFIX)) return null;
      const category = categoryFor(owner);
      apiClassCounts.set(owner, (apiClassCounts.get(owner) || 0) + 1);
      if (!categoryCounts[category]) categoryCounts[category] = { classReferences: 0, invocations: 0, fieldAccesses: 0 };
      if (sourceClass) classSeen.add(sourceClass);
      return { owner, category };
    }

    function pushBounded(target, row) {
      observedDetails++;
      if (target.length < detailLimit) target.push(row);
    }

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

      const localReferences = new Set([].concat(info.references || [], info.superName || [], info.interfaces || []).filter(Boolean));
      for (const method of info.methods || []) {
        for (const inv of method && method.code && method.code.invocations || []) {
          const hit = recordOwner(inv.owner, sourceClass, sourcePath);
          if (!hit) continue;
          categoryCounts[hit.category].invocations++;
          report.totals.invocationSites++;
          report.totals.unmappedSites++;
          const operation = operationFor(hit.owner, inv.name, inv.descriptor, "method");
          if (hit.category === "otherForgeApi") report.totals.unknownCategorySites++;
          else report.totals.knownCategorySites++;
          if (operation) report.totals.candidateOperationSites++;
          pushBounded(invocationRows, {
            sourcePath, sourceClass, sourceMethod: method.name || null,
            sourceDescriptor: method.descriptor || null, pc: Number.isInteger(inv.pc) ? inv.pc : null,
            owner: hit.owner, name: inv.name || null, descriptor: inv.descriptor || null,
            memberKind: inv.kind || "method", category: hit.category,
            operationCandidate: operation ? operation.id : null,
            confidence: operation ? operation.confidence : "high",
            evidence: operation ? operation.reason : "Exact Forge namespace method reference in parsed bytecode",
            portStatus: "unmapped", autoConverted: false
          });
          localReferences.add(hit.owner);
        }
        for (const field of method && method.code && method.code.fieldAccesses || []) {
          const hit = recordOwner(field.owner, sourceClass, sourcePath);
          if (!hit) continue;
          categoryCounts[hit.category].fieldAccesses++;
          report.totals.fieldAccessSites++;
          report.totals.unmappedSites++;
          const operation = operationFor(hit.owner, field.name, field.descriptor, "field");
          if (hit.category === "otherForgeApi") report.totals.unknownCategorySites++;
          else report.totals.knownCategorySites++;
          if (operation) report.totals.candidateOperationSites++;
          pushBounded(fieldRows, {
            sourcePath, sourceClass, sourceMethod: method.name || null,
            sourceDescriptor: method.descriptor || null, pc: Number.isInteger(field.pc) ? field.pc : null,
            owner: hit.owner, name: field.name || null, descriptor: field.descriptor || null,
            category: hit.category, operationCandidate: operation ? operation.id : null,
            confidence: operation ? operation.confidence : "high",
            evidence: operation ? operation.reason : "Exact Forge namespace field reference in parsed bytecode",
            portStatus: "unmapped", autoConverted: false
          });
          localReferences.add(hit.owner);
        }
      }

      for (const rawRef of localReferences) {
        const owner = normalizeName(rawRef);
        if (!owner.startsWith(FORGE_PREFIX)) continue;
        const key = sourceClass + "|" + owner;
        if (emittedClassReference.has(key)) continue;
        emittedClassReference.add(key);
        const category = categoryFor(owner);
        classSeen.add(sourceClass);
        if (!apiClassCounts.has(owner)) apiClassCounts.set(owner, 1);
        if (!categoryCounts[category]) categoryCounts[category] = { classReferences: 0, invocations: 0, fieldAccesses: 0 };
        categoryCounts[category].classReferences++;
        report.totals.classReferenceSites++;
        pushBounded(referenceRows, {
          sourcePath, sourceClass, apiClass: owner, category,
          confidence: "medium", evidence: "Forge class appears in the parsed class-reference set",
          usageResolved: false, portStatus: "unverified", autoConverted: false
        });
      }
    }

    report.invocations = invocationRows;
    report.fieldAccesses = fieldRows;
    report.classReferences = referenceRows;
    report.totals.classesWithForgeApi = classSeen.size;
    report.totals.uniqueApiClasses = apiClassCounts.size;
    report.totals.detailsObserved = observedDetails;
    report.totals.detailsReported = invocationRows.length + fieldRows.length + referenceRows.length;
    report.totals.detailsTruncated = observedDetails > report.totals.detailsReported;
    report.categories = categoryCounts;
    report.apiClasses = Array.from(apiClassCounts.entries())
      .map(([name, references]) => ({ name, references, category: categoryFor(name) }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 1000);
    if (report.totals.unmappedSites || report.totals.classReferenceSites) {
      report.status = "manual-port-required";
    }
    return report;
  }

  root.Jar2ZeusForgeApiCompatibility = { analyze, categoryFor, operationFor };
})(typeof globalThis !== "undefined" ? globalThis : this);
