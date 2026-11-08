"use strict";

const fs = require("node:fs");
const { renderDesktopActions } = require("./render-desktop-actions.js");

// Keep the signed desktop metadata. Enabled extensions may append actions;
// AppImage needs its own executable entry point, but keeps the argument grammar.
function renderUpstreamDesktop(source, actions, reportPath, format, withUpdater, version) {
  if (!source.startsWith("[Desktop Entry]\n") || !/^Exec=chatgpt(?: |$)/m.test(source)) {
    throw new Error("Official chatgpt.desktop no longer has the expected launch contract");
  }
  let result = source.trimEnd();
  if (format === "appimage") {
    result = result.replace(/^Exec=chatgpt(?= |$)/m, "Exec=AppRun");
    result += `\nX-AppImage-Version=${version}`;
  }
  const extensions = renderDesktopActions(actions, reportPath, withUpdater);
  const actionList = /^Actions=(.*)$/m.exec(extensions)?.[1];
  if (actionList) {
    if (/^Actions=/m.test(result)) throw new Error("Official desktop entry now defines its own actions");
    result += `\nActions=${actionList}\n`;
    const groups = extensions.indexOf("[Desktop Action ");
    if (groups < 0) throw new Error("Enabled desktop action groups are missing");
    result += `\n${extensions.slice(groups).trimEnd()}`;
  }
  return `${result}\n`;
}

if (require.main === module) {
  const [official, report, format, updater, version] = process.argv.slice(2);
  process.stdout.write(renderUpstreamDesktop(
    fs.readFileSync(official, "utf8"), fs.readFileSync(0, "utf8"),
    report, format, updater === "1", version,
  ));
}

module.exports = { renderUpstreamDesktop };
