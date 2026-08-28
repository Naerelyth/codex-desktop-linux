#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const {
  corePatchDescriptors,
  featurePatchDescriptors,
  patchExtractedApp,
} = require("./patches/runner.js");

const {
  createPatchReport,
  enabledFeatureFailuresFromReport,
  reportHasPatchChanges,
} = require("./lib/patch-report.js");

const { applyLinuxNewWindowLaunchActionPatch } = require("./patches/impl/new-window.js");
const {
  applyLinuxNotificationBadgePatch,
} = require("./patches/impl/notification-badge.js");

test("best-effort feature drift stays non-fatal without hiding changed outputs", () => {
  const report = createPatchReport();
  report.enabledFeatures = ["best-effort", "strict"];
  report.patches = [
    {
      name: "feature:best-effort:repair",
      status: "skipped-optional",
      ciPolicy: "optional",
      sourceKind: "feature",
      featureId: "best-effort",
      enforceWhenEnabled: false,
    },
  ];
  assert.deepEqual(enabledFeatureFailuresFromReport(report), []);
  assert.equal(reportHasPatchChanges(report), false);

  report.patches[0].status = "applied-with-warnings";
  assert.equal(reportHasPatchChanges(report), true);

  report.patches[0] = {
    ...report.patches[0],
    name: "feature:strict:repair",
    status: "skipped-optional",
    featureId: "strict",
    enforceWhenEnabled: true,
  };
  assert.equal(enabledFeatureFailuresFromReport(report).length, 1);
});

function launchActionBundleFixture() {
  return [
    "let t={y:()=>({setSecondInstanceArgsHandler:e=>globalThis.handler=e}),t:e=>e,g:e=>e};",
    "let z={deepLinks:{queueProcessArgs:e=>false}};",
    "let M={hotkeyWindowLifecycleManager:{hide(){globalThis.calls.hide+=1}},getPrimaryWindow(){return globalThis.primary},createFreshLocalWindow(e){globalThis.calls.create.push(e);return Promise.resolve(globalThis.created)}};",
    "let ae=e=>globalThis.calls.focus.push(e.id),le=()=>{};",
    "function CN(){let{setSecondInstanceArgsHandler:l}=t.y();l(e=>{let n=t.t(t.g(e));if(z.deepLinks.queueProcessArgs(e)){n&&le();return}if(n){le();return}le()});let ue=async(e,t)=>{M.hotkeyWindowLifecycleManager.hide();let n=M.getPrimaryWindow(),r=n??await M.createFreshLocalWindow(e);r!=null&&ae(r)};}",
  ].join("");
}

function modernLaunchActionBundleFixture() {
  return [
    "let P=false,ge=true,Fe={deepLinks:{queueProcessArgs:e=>false}};",
    "let V={hotkeyWindowLifecycleManager:{hide(){globalThis.calls.hide+=1}},getPrimaryWindow(){return globalThis.primary},createFreshWindow(e){globalThis.calls.create.push(e);return Promise.resolve(globalThis.created)}};",
    "let ve=e=>ge?V.createFreshWindow(e):Promise.resolve(null);",
    "let Le=e=>globalThis.calls.focus.push(e.id),pe=()=>{},t={n:e=>e},_d=e=>e,h=e=>globalThis.handler=e,Re=async()=>{};",
    "h(e=>{let n=t.n(_d(e));if(Fe.deepLinks.queueProcessArgs(e)){n&&Re();return}if(n){Re();return}Re({channel:`shortcut`,source:`shortcut`})});",
    "let ze=async(e,t)=>{if(!ge)return null;V.hotkeyWindowLifecycleManager.hide();let n=V.getPrimaryWindow(),r=n??await ve(e);return r==null?null:(Le(r),r)};",
  ].join("");
}

function applyPatchTwice(source) {
  const once = applyLinuxNewWindowLaunchActionPatch(source);
  return applyLinuxNewWindowLaunchActionPatch(once);
}

test("official Linux baseline retains the required core patches", () => {
  assert.deepEqual(corePatchDescriptors().map((patch) => patch.id), [
    "linux-new-window-launch-action",
    "linux-disable-unity-notification-badge",
  ]);
  assert.equal(featurePatchDescriptors({
    featuresConfigPath: path.join(__dirname, "..", "linux-features", "features.example.json"),
  }).length, 0);
});

test("Linux notification badge publishes only a zero Unity count", () => {
  const source =
    "function handle(t){switch(t.type){case`electron-set-badge-count`:l.app.setBadgeCount(t.count);break;default:break}}";
  const patched = applyLinuxNotificationBadgePatch(source);
  assert.notEqual(patched, source);
  assert.equal(applyLinuxNotificationBadgePatch(patched), patched);

  const counts = [];
  const context = {
    l: { app: { setBadgeCount: (count) => counts.push(count) } },
  };
  vm.runInNewContext(`${patched};handle({type:\`electron-set-badge-count\`,count:7})`, context);
  assert.deepEqual(counts, [0]);
});

test("Linux notification badge patch fails closed on an ambiguous upstream handler", () => {
  const handler = "case`electron-set-badge-count`:l.app.setBadgeCount(t.count);break;";
  const sources = [
    `${handler}${handler}`,
    `${handler}l.app.setBadgeCount(1);`,
  ];
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    for (const source of sources) {
      assert.equal(applyLinuxNotificationBadgePatch(source), source);
    }
  } finally {
    console.warn = originalWarn;
  }
  assert.match(warnings.join("\n"), /unique upstream Electron badge-count handler/);
});

test("ambiguous Linux notification badge publishers fail the required core policy", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-ambiguous-notification-badge-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const buildDir = path.join(root, ".vite", "build");
  fs.mkdirSync(buildDir, { recursive: true });
  const handler = "case`electron-set-badge-count`:l.app.setBadgeCount(t.count);break;";
  fs.writeFileSync(
    path.join(buildDir, "main-fixture.js"),
    `${launchActionBundleFixture()}${handler}l.app.setBadgeCount(1);`,
  );
  const report = createPatchReport();
  patchExtractedApp(root, {
    report,
    featuresConfigPath: path.join(__dirname, "..", "linux-features", "features.example.json"),
  });

  const badgePatch = report.patches.find(
    (patch) => patch.name === "linux-disable-unity-notification-badge",
  );
  assert.equal(badgePatch.status, "failed-required");
  assert.match(badgePatch.reason, /unique upstream Electron badge-count handler/);
});

test("empty registry leaves an extracted official-style app unchanged", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-empty-patch-registry-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const buildDir = path.join(root, ".vite", "build");
  const webviewDir = path.join(root, "webview", "assets");
  fs.mkdirSync(buildDir, { recursive: true });
  fs.mkdirSync(webviewDir, { recursive: true });
  const mainPath = path.join(buildDir, "main-fixture.js");
  const assetPath = path.join(webviewDir, "app-initial-fixture.js");
  fs.writeFileSync(mainPath, "const officialMain=true;\n");
  fs.writeFileSync(assetPath, "const officialWebview=true;\n");
  const before = new Map([
    [mainPath, fs.readFileSync(mainPath)],
    [assetPath, fs.readFileSync(assetPath)],
  ]);
  const report = createPatchReport();
  patchExtractedApp(root, {
    corePatchRoot: path.join(root, "empty-core"),
    report,
    featuresConfigPath: path.join(__dirname, "..", "linux-features", "features.example.json"),
  });
  assert.deepEqual(report.patches, []);
  for (const [filePath, bytes] of before) assert.deepEqual(fs.readFileSync(filePath), bytes);
});

test("routes --new-window through the official single-instance callback", async () => {
  const source = launchActionBundleFixture();
  const patched = applyPatchTwice(source);
  assert.notEqual(patched, source);
  assert.equal(applyLinuxNewWindowLaunchActionPatch(patched), patched);
  assert.match(patched, /codexLinuxOpenNewWindow=async\(\)=>/);
  assert.match(patched, /e\.includes\(`--new-window`\)/);

  const context = {
    calls: { create: [], focus: [], hide: 0 },
    created: { id: "created" },
    primary: { id: "primary" },
  };
  context.globalThis = context;
  vm.runInNewContext(`${patched};CN();`, context);
  await vm.runInNewContext("globalThis.handler([`app`, `--new-window`])", context);
  assert.deepEqual(context.calls.create, ["/"]);
  assert.deepEqual(context.calls.focus, ["created"]);
  assert.equal(context.calls.hide, 1);
});

test("routes --new-window through the current upstream launch-action callback", async () => {
  const source = modernLaunchActionBundleFixture();
  const patched = applyPatchTwice(source);
  assert.notEqual(patched, source);
  assert.equal(applyLinuxNewWindowLaunchActionPatch(patched), patched);
  assert.match(patched, /codexLinuxOpenNewWindow=async\(\)=>/);
  assert.match(patched, /e\.includes\(`--new-window`\)/);

  const context = {
    calls: { create: [], focus: [], hide: 0 },
    created: { id: "created" },
    primary: { id: "primary" },
  };
  context.globalThis = context;
  vm.runInNewContext(patched, context);
  await vm.runInNewContext("globalThis.handler([`app`, `--new-window`])", context);
  assert.deepEqual(context.calls.create, ["/"]);
  assert.deepEqual(context.calls.focus, ["created"]);
  assert.equal(context.calls.hide, 1);
});

test("fails closed when the upstream fresh-window contract drifts", () => {
  const source = launchActionBundleFixture().replaceAll(
    "createFreshLocalWindow",
    "createFreshDifferentWindow",
  );
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    assert.equal(applyLinuxNewWindowLaunchActionPatch(source), source);
  } finally {
    console.warn = originalWarn;
  }
  assert.match(warnings.join("\n"), /Could not find the official Linux launch-action callback/);
});

test("CLI rejects drift in an explicitly enabled feature", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-enabled-feature-drift-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, ".vite", "build"), { recursive: true });
  fs.mkdirSync(path.join(root, "webview", "assets"), { recursive: true });
  fs.writeFileSync(path.join(root, ".vite", "build", "main-fixture.js"), `${launchActionBundleFixture()}\n`);
  fs.writeFileSync(path.join(root, "webview", "assets", "app-initial-fixture.js"), "const webview=true;\n");
  const config = path.join(root, "features.json");
  const report = path.join(root, "report.json");
  fs.writeFileSync(config, '{"enabled":["frameless-titlebar"]}\n');

  const result = childProcess.spawnSync(
    process.execPath,
    [path.join(__dirname, "patch-linux-window-ui.js"), "--report-json", report, "--enforce-critical", root],
    {
      encoding: "utf8",
      env: { ...process.env, CODEX_LINUX_FEATURES_CONFIG: config },
    },
  );
  assert.notEqual(result.status, 0);
  const reportData = JSON.parse(fs.readFileSync(report, "utf8"));
  assert.ok(
    reportData.patches.some(
      (patch) => patch.sourceKind === "feature" && patch.featureId === "frameless-titlebar",
    ),
  );
});
