"use strict";

const CURRENT_BADGE_HANDLER_RE =
  /case`electron-set-badge-count`:([A-Za-z_$][\w$]*)\.app\.setBadgeCount\(([A-Za-z_$][\w$]*)\.count\);break;/g;
const DISABLED_BADGE_HANDLER_RE =
  /case`electron-set-badge-count`:([A-Za-z_$][\w$]*)\.app\.setBadgeCount\(0\);break;/g;
const BADGE_MESSAGE_RE = /electron-set-badge-count/g;
const BADGE_PUBLISHER_RE = /\.setBadgeCount\(/g;

function matches(source, pattern) {
  pattern.lastIndex = 0;
  return [...source.matchAll(pattern)];
}

function notificationBadgeContract(source) {
  const currentCount = matches(source, CURRENT_BADGE_HANDLER_RE).length;
  const disabledCount = matches(source, DISABLED_BADGE_HANDLER_RE).length;
  const messageCount = matches(source, BADGE_MESSAGE_RE).length;
  const publisherCount = matches(source, BADGE_PUBLISHER_RE).length;
  if (messageCount !== 1 || publisherCount !== 1) return "drifted";
  if (currentCount === 1 && disabledCount === 0) return "current";
  if (currentCount === 0 && disabledCount === 1) return "patched";
  return "drifted";
}

function applyLinuxNotificationBadgePatch(source) {
  const contract = notificationBadgeContract(source);
  if (contract === "patched") return source;
  if (contract !== "current") {
    console.warn(
      "WARN: Could not find the unique upstream Electron badge-count handler — skipping Linux notification badge patch",
    );
    return source;
  }

  const [handler] = matches(source, CURRENT_BADGE_HANDLER_RE);
  const replacement = handler[0].replace(`${handler[2]}.count`, "0");
  const patched =
    source.slice(0, handler.index) +
    replacement +
    source.slice(handler.index + handler[0].length);
  if (notificationBadgeContract(patched) !== "patched") {
    console.warn(
      "WARN: Upstream Electron badge-count handler changed while patching — skipping Linux notification badge patch",
    );
    return source;
  }
  return patched;
}

module.exports = {
  applyLinuxNotificationBadgePatch,
  notificationBadgeContract,
};
