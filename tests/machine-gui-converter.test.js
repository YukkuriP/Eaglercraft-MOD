const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

require(path.join(__dirname, "..", "machine-gui-converter.js"));
require(path.join(__dirname, "..", "package-validator.js"));
const converter = globalThis.Jar2ZeusMachineGuiConverter;
const validator = globalThis.Jar2ZeusPackageValidator;

function sampleGuiReport() {
  return {
    schema: "jar2zeus.machine-gui-interaction.v1",
    totals: { screenClasses: 1, menuClasses: 1, slotRegistrationsObserved: 9, guiTextures: 1, operationsObserved: 2, guiSyncOperationsObserved: 1, packetReferenceSites: 1 },
    screens: [{ className: "sample/machine/CrusherScreen", sourcePath: "sample/machine/CrusherScreen.class", menuReferences: ["sample/machine/CrusherMenu"] }],
    menus: [{ className: "sample/machine/CrusherMenu", sourcePath: "sample/machine/CrusherMenu.class", uiMethodCandidates: ["menu_slot_register"] }],
    widgets: [
      { className: "sample/machine/PowerSlider", sourcePath: "sample/machine/PowerSlider.class" },
      { className: "sample/machine/StartButton", sourcePath: "sample/machine/StartButton.class" },
      { className: "sample/machine/StatusLabel", sourcePath: "sample/machine/StatusLabel.class" }
    ],
    slots: [{ className: "sample/machine/MachineSlot", sourcePath: "sample/machine/MachineSlot.class" }],
    screenMenuLinks: [{ screenClass: "sample/machine/CrusherScreen", menuReference: "sample/machine/CrusherMenu", knownClass: true }],
    fields: [{ sourceClass: "sample/machine/CrusherScreen", sourcePath: "sample/machine/CrusherScreen.class", name: "progress", category: "progress" }],
    operations: [{ sourceClass: "sample/machine/CrusherScreen", sourceMethod: "onPress", name: "onPress", operationCandidate: "widget_button_press" }],
    resources: [
      { sourcePath: "assets/sample/textures/gui/crusher.png", kind: "gui-texture", bytes: 512 },
      { sourcePath: "assets/sample/lang/en_us.json", kind: "language-labels" }
    ],
    guiDefinitions: [{ sourcePath: "assets/sample/gui/crusher.json", status: "structure-inspected", truncated: false, widgetKinds: { button: 1, slider: 1, progressbar: 1, text_field: 1, slot: 1 } }]
  };
}

test("maps harmless machine GUI controls to documented Zeus widget scaffolds", () => {
  const result = converter.convert(sampleGuiReport(), { targetVersion: "26.2" });
  assert.equal(result.report.schema, "jar2zeus.machine-gui-conversion-plan.v1");
  assert.equal(result.report.target.minecraft, "26.2");
  assert.equal(result.report.sourceBehaviorPorted, false);
  assert.equal(result.report.executableMachineGui, false);
  assert.equal(result.report.screens.length, 1);
  assert.ok(result.report.controls.some(c => c.zeusWidget === "slider"));
  assert.ok(result.report.controls.some(c => c.zeusWidget === "button"));
  assert.ok(result.report.controls.some(c => c.renderMode === "static progress-bar preview"));
  assert.ok(result.report.controls.some(c => c.renderMode === "slot-grid visual preview"));
  assert.equal(result.report.assets[0].targetPath, "assets/gui/gui-texture-0001.png");
  assert.equal(result.report.assets[0].status, "pending-copy");
  assert.match(result.luaScaffold, /ui\.screen/);
  assert.match(result.luaScaffold, /s:slider/);
  assert.match(result.luaScaffold, /s:canvas/);
  assert.match(result.luaScaffold, /on\("screen_init"/);
  assert.match(result.luaScaffold, /not connected/i);
});

test("filters blocked source class names and resource paths", () => {
  const result = converter.convert({
    schema: "jar2zeus.machine-gui-interaction.v1",
    totals: { screenClasses: 1 },
    screens: [{ className: "sample/weapon/WeaponScreen", sourcePath: "sample/weapon/WeaponScreen.class" }],
    widgets: [{ className: "sample/machine/PowerButton", sourcePath: "sample/machine/PowerButton.class" }],
    resources: [{ sourcePath: "assets/weapon/textures/gui/weapon.png", kind: "gui-texture" }],
    guiDefinitions: []
  }, { targetVersion: "26.3" });
  assert.equal(result.report.screens.length, 0);
  assert.equal(result.report.assets.length, 0);
  assert.ok(!result.luaScaffold.includes("WeaponScreen"));
  assert.ok(!result.luaScaffold.includes("weapon.png"));
});

test("bounds controls and GUI texture assets", () => {
  const widgets = Array.from({ length: 150 }, (_, i) => ({
    className: "sample/machine/PowerButton" + i,
    sourcePath: "sample/machine/PowerButton" + i + ".class"
  }));
  const resources = Array.from({ length: 220 }, (_, i) => ({
    sourcePath: "assets/sample/textures/gui/gui" + i + ".png",
    kind: "gui-texture",
    bytes: 128
  }));
  const result = converter.convert({
    schema: "jar2zeus.machine-gui-interaction.v1",
    totals: { widgetClasses: 150, guiTextures: 220 },
    widgets,
    resources
  }, {});
  assert.equal(result.report.controls.length, 120);
  assert.equal(result.report.totals.controlsOmitted, 30);
  assert.equal(result.report.assets.length, 200);
  assert.equal(result.report.totals.detailsTruncated, true);
});

test("handles empty GUI reports without claiming a successful port", () => {
  const result = converter.convert({ schema: "jar2zeus.machine-gui-interaction.v1", totals: {} }, {});
  assert.equal(result.report.status, "no-gui-candidates");
  assert.equal(result.report.sourceBehaviorPorted, false);
  assert.equal(result.report.executableMachineGui, false);
});

test("classifies standard controls without executing source callbacks", () => {
  assert.equal(converter.classify("MachineSlider"), "slider");
  assert.equal(converter.classify("MachineTextField"), "textField");
  assert.equal(converter.classify("MachineProgressBar"), "progress");
  assert.equal(converter.classify("MachineSlot"), "slot-grid");
  assert.equal(converter.classify("CustomPanel"), "unknown");
});

function validBaseInput() {
  return {
    metadata: { id: "test_mod", name: "Test Mod", version: "1.0.0", main: "main.lua", api: 1, minecraft: ["26.3"], permissions: [] },
    mainLua: "-- test\n",
    analysis: { schema: "jar2zeus.generic-analysis.v1", classes: { count: 0 }, loaders: [], unsupportedIndicators: [] },
    adapterReport: { schema: "jar2zeus.pipeline.v1", adapters: [] },
    apiValidation: { schema: "jar2zeus.zeus-api-validation.v1", valid: true, requiredApis: [] },
    packageFiles: [{ path: "metadata.json", size: 0 }, { path: "main.lua", size: 0 }],
    packageLimits: { files: 2, bytes: 0, maxFiles: 4096, maxBytes: 64 * 1024 * 1024 },
    packageSkipped: [],
    runtimeTested: true,
    gameplayVerified: true,
    targetRuntimeEvidence: { apiPresenceVerified: true, versionVerified: true },
    eventLifecycle: { schema: "jar2zeus.java-event-lifecycle.v1", totals: {} },
    javaTypeCompatibility: { totals: { classesRegistered: 0 }, limitations: [] },
    machineProcessAnalysis: { schema: "jar2zeus.machine-process-analysis.v1", totals: {} },
    machineProcessFileCount: 0,
    machineGuiInteraction: { schema: "jar2zeus.machine-gui-interaction.v1", totals: { guiClasses: 1, screenMenuLinks: 0, operationsObserved: 0, fieldsObserved: 0, guiSyncOperationsObserved: 0, packetReferenceSites: 0, guiResourceFilesSeen: 0, guiJsonReadErrors: 0, guiJsonInvalid: 0 } },
    machineGuiResourceFileCount: 0,
    reimplementation: { schema: "jar2zeus.reimplementation.v1", methodsPending: 0, methodsSkipped: 0, utilityMethodsTranslated: 0 },
    recipeReport: {},
    definitionReport: {},
    configReport: {}
  };
}

test("validator warns when the GUI conversion plan is missing", () => {
  const result = validator.validate(validBaseInput());
  assert.equal(result.valid, true);
  assert.equal(result.conversionComplete, false);
  assert.ok(result.warnings.some(w => w.includes("Machine GUI Zeus conversion plan is missing")));
});

test("validator accepts only a clearly scaffold-only GUI plan", () => {
  const input = validBaseInput();
  input.machineGuiConversionFileCount = 1;
  input.machineGuiConversion = {
    schema: "jar2zeus.machine-gui-conversion-plan.v1",
    sourceBehaviorPorted: false,
    executableMachineGui: false,
    status: "scaffold-generated"
  };
  const result = validator.validate(input);
  assert.equal(result.valid, true);
  assert.equal(result.conversionComplete, false);
  assert.ok(!result.errors.some(e => e.includes("GUI conversion plan incorrectly claims")));
});

test("validator rejects a GUI plan that claims the source behavior is already ported", () => {
  const input = validBaseInput();
  input.machineGuiConversionFileCount = 1;
  input.machineGuiConversion = {
    schema: "jar2zeus.machine-gui-conversion-plan.v1",
    sourceBehaviorPorted: true,
    executableMachineGui: true
  };
  const result = validator.validate(input);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes("GUI conversion plan incorrectly claims")));
});
