"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const { applyLinuxNewWindowLaunchActionPatch } = require("./new-window.js");
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
    "let ve=(e,t)=>ge?V.createFreshWindow(e,t):Promise.resolve(null);",
    "let Le=e=>globalThis.calls.focus.push(e.id),pe=()=>{},t={n:e=>e},_d=e=>e,h=e=>globalThis.handler=e,Re=async()=>{};",
    "h(e=>{let t=_d(e),n=t;if(Fe.deepLinks.queueProcessArgs(e)){n&&Re();return}if(n){Re();return}Re({channel:`shortcut`,source:`shortcut`})});",
    "let ze=async(e,t)=>{if(!ge)return null;V.hotkeyWindowLifecycleManager.hide();let n=V.getPrimaryWindow(),r=n??await ve(e);return r==null?null:(Le(r),r)};",
  ].join("");
}

function applyPatchTwice(source) {
  const once = applyLinuxNewWindowLaunchActionPatch(source);
  return applyLinuxNewWindowLaunchActionPatch(once);
}

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


test("applies to the supplied official main bundle", {
  skip: process.env.CODEX_SIGNED_EXTRACTED_APP == null,
}, () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const dir = path.join(process.env.CODEX_SIGNED_EXTRACTED_APP, ".vite", "build");
  const main = fs.readdirSync(dir).filter((name) => /^main-.*\.js$/.test(name));
  assert.equal(main.length, 1);
  const source = fs.readFileSync(path.join(dir, main[0]), "utf8");
  const patched = applyLinuxNewWindowLaunchActionPatch(source);
  assert.notEqual(patched, source);
  assert.equal(applyLinuxNewWindowLaunchActionPatch(patched), patched);
  assert.doesNotThrow(() => new vm.Script(patched));
});

test("ambiguous launch callbacks remain unchanged", () => {
  const source = modernLaunchActionBundleFixture().repeat(2);
  assert.equal(applyLinuxNewWindowLaunchActionPatch(source), source);
});

test("ordinary launches and deep links keep the upstream callback", async () => {
  const source = modernLaunchActionBundleFixture()
    .replace("queueProcessArgs:e=>false", "queueProcessArgs:e=>{globalThis.queued=e;return true}")
    .replace("Re=async()=>{}", "Re=async()=>{globalThis.shown=true}");
  const context = { calls: { create: [], focus: [], hide: 0 } };
  vm.runInNewContext(applyLinuxNewWindowLaunchActionPatch(source), context);
  await context.handler(["app", "codex://thread/123"]);
  assert.equal(context.shown, true);
  assert.deepEqual(context.queued, ["app", "codex://thread/123"]);
  assert.deepEqual(context.calls.create, []);
});

test("October callback preserves activation and deep links while opening a fresh window", async () => {
  const source = `let startup={setSecondInstanceArgsHandler:t=>globalThis.handler=t,windowsActivation:null};
  let {setSecondInstanceArgsHandler:T}=startup,Te=true,H={hotkeyWindowLifecycleManager:{hide(){calls.hide++}},getPrimaryWindow(){return primary},createFreshWindow(e,t){calls.create.push(e);return Promise.resolve(created)}};
  let De=(e,t)=>Te?H.createFreshWindow(e,t):Promise.resolve(null),Xe=e=>calls.focus.push(e.id),D_=()=>({deliver:t=>calls.activations.push(t)}),Se=()=>{},u={reportNonFatal:e=>{throw e}};
  let Ze=async(e,t)=>{try{H.hotkeyWindowLifecycleManager.hide();let n=H.getPrimaryWindow()??await De(\`/\`);if(n==null)return;Xe(n),t!=null&&D_(n.webContents,H.windowManager).deliver(t),e!=null&&Se(e,n.webContents)}catch(e){u.reportNonFatal(e)}};
  let E_=t=>t.includes('activation')?'activation':null,Nf=t=>t,m={r:()=>true},qe={deepLinks:{queueProcessArgs:t=>{calls.links.push(t);return true}}};
  T(t=>{let n=startup.windowsActivation==null?null:E_(t);if(n!=null){Ze(void 0,n);return}let r=Nf(t),i=m.r(r);if(qe.deepLinks.queueProcessArgs(t)){i&&Ze();return}if(i){Ze();return}Ze({channel:\`shortcut\`,source:\`shortcut\`})});`;
  const patched = applyLinuxNewWindowLaunchActionPatch(source);
  assert.notEqual(patched, source);
  assert.equal(applyLinuxNewWindowLaunchActionPatch(patched), patched);
  const ctx={calls:{hide:0,create:[],focus:[],links:[],activations:[]},primary:{id:'primary'},created:{id:'created'}};
  vm.runInNewContext(patched,ctx);
  ctx.handler(['app','--new-window']);
  await new Promise(setImmediate);
  assert.deepEqual(ctx.calls.create,['/']);
  assert.deepEqual(ctx.calls.focus,['created']);
  ctx.handler(['app','codex://thread/123']);
  assert.deepEqual(ctx.calls.focus,['created','primary']);
  vm.runInNewContext('startup.windowsActivation={}',ctx);
  ctx.handler(['app','activation']);
  assert.deepEqual(ctx.calls.activations,['activation']);
  assert.equal(applyLinuxNewWindowLaunchActionPatch(source.repeat(2)),source.repeat(2));
  const drifted=source.replace('createFreshWindow(e,t):','differentWindow(e,t):');
  assert.equal(applyLinuxNewWindowLaunchActionPatch(drifted),drifted);
});
