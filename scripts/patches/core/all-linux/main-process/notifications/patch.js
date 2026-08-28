"use strict";

const { mainBundlePatch } = require("../../../../descriptor.js");
const {
  applyLinuxNotificationBadgePatch,
} = require("../../../../impl/notification-badge.js");

module.exports = mainBundlePatch({
  id: "linux-disable-unity-notification-badge",
  phase: "main-bundle",
  order: 220,
  ciPolicy: "required-upstream",
  apply: applyLinuxNotificationBadgePatch,
});
