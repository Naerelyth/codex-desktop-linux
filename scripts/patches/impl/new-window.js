"use strict";

const {
  HANDLER_PREFIX_LOOKBACK,
  escapeRegExp,
  findMatchingBrace,
} = require("../lib/minified-js.js");

const LAUNCH_HANDLER_RE =
  /([A-Za-z_$][\w$]*)\(e=>\{let [^;{}]+;if\(([A-Za-z_$][\w$]*)\.deepLinks\.queueProcessArgs\(e\)\)\{([A-Za-z_$][\w$]*)&&([A-Za-z_$][\w$]*)\([^)]*\);return\}if\(\3\)\{\4\([^)]*\);return\}\4\([^)]*\)\}\);let ([A-Za-z_$][\w$]*)=async\(e,t\)=>\{/g;

function findLaunchHandler(source) {
  LAUNCH_HANDLER_RE.lastIndex = 0;
  const candidates = [...source.matchAll(LAUNCH_HANDLER_RE)];
  if (candidates.length !== 1) return null;
  let match;
  while ((match = LAUNCH_HANDLER_RE.exec(source)) != null) {
    const [, setterVar, , , , openerFn] = match;
    const openerBraceIndex = match.index + match[0].length - 1;
    const openerLetIndex = openerBraceIndex - `let ${openerFn}=async(e,t)=>`.length;
    const openerEnd = findMatchingBrace(source, openerBraceIndex);
    if (
      openerEnd === -1 ||
      (source[openerEnd + 1] !== ";" && source[openerEnd + 1] !== ",")
    ) {
      continue;
    }

    const openerText = source.slice(openerLetIndex, openerEnd + 1);
    let openerVars = openerText.match(
      /([A-Za-z_$][\w$]*)\.hotkeyWindowLifecycleManager\.hide\(\);let ([A-Za-z_$][\w$]*)=\1\.getPrimaryWindow(?:\(([^)]*)\))?,([A-Za-z_$][\w$]*)=\2\?\?await \1\.(createFreshLocalWindow|createFreshWindow)\(e\);/,
    );
    let createFreshWindow;
    if (openerVars == null) {
      const wrapperVars = openerText.match(
        /([A-Za-z_$][\w$]*)\.hotkeyWindowLifecycleManager\.hide\(\);let ([A-Za-z_$][\w$]*)=\1\.getPrimaryWindow(?:\(([^)]*)\))?,([A-Za-z_$][\w$]*)=\2\?\?await ([A-Za-z_$][\w$]*)\(e\);/,
      );
      if (wrapperVars != null) {
        const [, windowManagerVar, currentWindowVar, , createdWindowVar, wrapperFn] = wrapperVars;
        const wrapperDefinition = new RegExp(
          `${escapeRegExp(wrapperFn)}=(?:([A-Za-z_$][\\w$]*)|\\(([A-Za-z_$][\\w$]*),([A-Za-z_$][\\w$]*)\\))=>[A-Za-z_$][\\w$]*\\?${escapeRegExp(windowManagerVar)}\\.createFresh(?:Local)?Window\\((?:\\1|\\2,\\3)\\):Promise\\.resolve\\(null\\)`,
        );
        if (wrapperDefinition.test(source.slice(Math.max(0, match.index - HANDLER_PREFIX_LOOKBACK), match.index))) {
          openerVars = [
            wrapperVars[0],
            windowManagerVar,
            currentWindowVar,
            wrapperVars[3],
            createdWindowVar,
            "createFreshWindow",
          ];
          createFreshWindow = (pathExpression) => `${wrapperFn}(${pathExpression})`;
        }
      }
    }
    if (openerVars == null) {
      continue;
    }

    const [, windowManagerVar, , , createdWindowVar, createFreshWindowMethod] = openerVars;
    const focusFn = openerText.match(
      new RegExp(`(?:,|&&|\\(|;|\\?)([A-Za-z_$][\\w$]*)\\(${escapeRegExp(createdWindowVar)}\\)(?:\\)|\\}|,|;)`),
    )?.[1];
    if (focusFn == null) {
      continue;
    }

    return {
      callbackEnd: openerLetIndex,
      callbackStart: `${setterVar}(e=>{`,
      createFreshWindow: createFreshWindow ?? ((pathExpression) =>
        `${windowManagerVar}.${createFreshWindowMethod}(${pathExpression})`),
      focusFn,
      windowManagerVar,
    };
  }
  return null;
}

// October upstream registers the callback after startup and handles Windows
// activations first. Resolve the existing opener in the same startup scope.
function patchCurrentLaunchHandler(source) {
  const callbacks = [...source.matchAll(/([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*)=>\{let ([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)\.windowsActivation==null\?null:([A-Za-z_$][\w$]*)\(\2\);if\(\3!=null\)\{([A-Za-z_$][\w$]*)\(void 0,\3\);return\}let [^;{}]+;if\([A-Za-z_$][\w$]*\.deepLinks\.queueProcessArgs\(\2\)\)/g)];
  if (callbacks.length !== 1) return null;
  const match = callbacks[0];
  const [, setter, arg, , , , show] = match;
  const prefix = source.slice(Math.max(0, match.index - 40000), match.index);
  if (!prefix.includes(`setSecondInstanceArgsHandler:${setter}`)) return null;
  const openers = [...prefix.matchAll(new RegExp(
    `${escapeRegExp(show)}=async\\(e,t\\)=>\\{try\\{([A-Za-z_$][\\w$]*)\\.hotkeyWindowLifecycleManager\\.hide\\(\\);let ([A-Za-z_$][\\w$]*)=\\1\\.getPrimaryWindow\\(\\)\\?\\?await ([A-Za-z_$][\\w$]*)\\(\x60/\x60\\);if\\(\\2==null\\)return;([A-Za-z_$][\\w$]*)\\(\\2\\)`, "g"))];
  if (openers.length !== 1) return null;
  const [, manager, , fresh, focus] = openers[0];
  const wrappers = [...prefix.matchAll(new RegExp(
    `${escapeRegExp(fresh)}=\\(e,t\\)=>[A-Za-z_$][\\w$]*\\?${escapeRegExp(manager)}\\.createFreshWindow\\(e,t\\):Promise\\.resolve\\(null\\)`, "g"))];
  if (wrappers.length !== 1) return null;
  const start = match.index + `${setter}(${arg}=>{`.length;
  const injected = `if(Array.isArray(${arg})&&${arg}.includes(\x60--new-window\x60)){` +
    `let codexLinuxOpenNewWindow=async()=>{${manager}.hotkeyWindowLifecycleManager.hide();` +
    `let e=await ${fresh}(\x60/\x60);e!=null&&${focus}(e)};` +
    `codexLinuxOpenNewWindow().catch(()=>{});return}`;
  return source.slice(0, start) + injected + source.slice(start);
}

function applyLinuxNewWindowLaunchActionPatch(currentSource) {
  if (currentSource.includes("codexLinuxOpenNewWindow=async()=>")) {
    return currentSource;
  }

  const current = patchCurrentLaunchHandler(currentSource);
  if (current != null) return current;

  const handler = findLaunchHandler(currentSource);
  if (handler == null) {
    console.warn(
      "WARN: Could not find the official Linux launch-action callback or fresh-window contract — skipping --new-window patch",
    );
    return currentSource;
  }

  const callback = currentSource.slice(
    currentSource.lastIndexOf(handler.callbackStart, handler.callbackEnd),
    handler.callbackEnd,
  );
  if (!callback.startsWith(handler.callbackStart)) {
    console.warn("WARN: Could not isolate the official Linux launch-action callback — skipping --new-window patch");
    return currentSource;
  }

  const helper =
    `let codexLinuxOpenNewWindow=async()=>{${handler.windowManagerVar}.hotkeyWindowLifecycleManager.hide();` +
    `let e=await ${handler.createFreshWindow("`/`")};e!=null&&${handler.focusFn}(e)};`;
  const patchedCallback =
    `${handler.callbackStart}if(Array.isArray(e)&&e.includes(\`--new-window\`)){codexLinuxOpenNewWindow().catch(()=>{});return}` +
    callback.slice(handler.callbackStart.length);
  const callbackStart = currentSource.lastIndexOf(handler.callbackStart, handler.callbackEnd);

  return currentSource.slice(0, callbackStart) +
    helper +
    patchedCallback +
    currentSource.slice(handler.callbackEnd);
}

module.exports = {
  applyLinuxNewWindowLaunchActionPatch,
};
