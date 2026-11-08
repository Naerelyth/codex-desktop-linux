"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { applyNewWindowPatch } = require("./patch.js");

const ARGUMENT = "--new-window";
const fixture = `function startup(activation,windows,bindWindowServices,deepLinks,focus){
  const {setSecondInstanceArgsHandler:register}=activation;
  const fresh=async(route,opener)=>{return await windows.createFreshWindow(route,opener)};
  bindWindowServices({windowServices:windows,createFreshWindow:fresh,ensureWindow:focus,getElectronMessageHandlerForWindow:windows.getElectronMessageHandlerForWindow});
  activation.onInteractiveLaunch=null,register(args=>{
    if(deepLinks.deepLinks.queueProcessArgs(args))return;
    focus();
  });
}`;

test("the queued handler opens one fresh window per explicit request", () => {
  const patched = applyNewWindowPatch(fixture);
  assert.notEqual(patched, fixture);
  assert.equal(applyNewWindowPatch(patched), patched);

  const events = [];
  const run = new Function("process", `${patched};return startup;`)({ platform: "linux", argv: [ARGUMENT] });
  let secondInstance;
  run({
    setSecondInstanceArgsHandler(handler) {
      secondInstance = handler;
      handler(["ChatGPT", ARGUMENT]);
    },
  }, {
    async createFreshWindow(route) { events.push(["new", route]); },
  }, () => {}, {
    deepLinks: {
      queueProcessArgs(args) {
        events.push(args);
        return args.some(arg => arg.startsWith("codex://"));
      },
    },
  }, () => events.push("focus"));

  assert.deepEqual(events, [["new", "/"]]);
  secondInstance(["ChatGPT", ARGUMENT]);
  secondInstance(["ChatGPT", ARGUMENT + "=0"]);
  secondInstance(["ChatGPT", "codex://threads/new"]);
  assert.deepEqual(events, [
    ["new", "/"], ["new", "/"], ["ChatGPT", ARGUMENT + "=0"], "focus",
    ["ChatGPT", "codex://threads/new"],
  ]);
});

test("missing or ambiguous upstream contracts leave the bundle untouched", t => {
  const warn = t.mock.method(console, "warn", () => {});
  for (const source of [
    fixture.replace("setSecondInstanceArgsHandler", "setActivationHandler"),
    fixture.replace("queueProcessArgs", "queueOtherArgs"),
    fixture.replace("createFreshWindow:fresh", "otherCallback:fresh"),
    fixture.replace("createFreshWindow:fresh", "createFreshWindow:focus"),
    fixture + "\n" + fixture,
  ]) {
    assert.equal(applyNewWindowPatch(source), source);
  }
  assert.equal(warn.mock.callCount(), 5);
});


test("new-window patch matches exactly one supplied official main-process chunk", {
  skip: process.env.CODEX_SIGNED_EXTRACTED_APP == null,
}, () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const vm = require("node:vm");
  const { findMainProcessChunks } = require("../../scripts/patches/lib/assets.js");
  const main = findMainProcessChunks(process.env.CODEX_SIGNED_EXTRACTED_APP);
  assert.ok(main);
  let changed = 0;
  const warn = console.warn;
  console.warn = () => {};
  try {
    for (const name of main.chunks) {
      const source = fs.readFileSync(path.join(main.buildDir, name), "utf8");
      const patched = applyNewWindowPatch(source);
      if (patched === source) continue;
      changed++;
      new vm.Script(patched);
      assert.equal(applyNewWindowPatch(patched), patched);
    }
  } finally { console.warn = warn; }
  assert.equal(changed, 1);
});
