"use strict";

const { mainBundlePatch } = require("../../../../descriptor.js");
const {
  applyLinuxNewWindowLaunchActionPatch,
} = require("../../../../impl/new-window.js");

module.exports = mainBundlePatch({
  id: "linux-new-window-launch-action",
  phase: "main-bundle",
  order: 210,
  ciPolicy: "required-upstream",
  apply: applyLinuxNewWindowLaunchActionPatch,
});
