"use strict";

const {
  HANDLER_PREFIX_LOOKBACK,
  escapeRegExp,
  findMatchingBrace,
} = require("../lib/minified-js.js");

const LAUNCH_HANDLER_RE =
  /([A-Za-z_$][\w$]*)\(e=>\{let ([A-Za-z_$][\w$]*)=[^;{}]+;if\(([A-Za-z_$][\w$]*)\.deepLinks\.queueProcessArgs\(e\)\)\{\2&&([A-Za-z_$][\w$]*)\([^)]*\);return\}if\(\2\)\{\4\([^)]*\);return\}\4\([^)]*\)\}\);let ([A-Za-z_$][\w$]*)=async\(e,t\)=>\{/g;

function findLaunchHandler(source) {
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
          `${escapeRegExp(wrapperFn)}=([A-Za-z_$][\\w$]*)=>[A-Za-z_$][\\w$]*\\?${escapeRegExp(windowManagerVar)}\\.createFresh(?:Local)?Window\\(\\1\\):Promise\\.resolve\\(null\\)`,
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

function applyLinuxNewWindowLaunchActionPatch(currentSource) {
  if (currentSource.includes("codexLinuxOpenNewWindow=async()=>")) {
    return currentSource;
  }

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
