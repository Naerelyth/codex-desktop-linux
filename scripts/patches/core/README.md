# Core patch registry

OpenAI's official Linux package is the compatibility baseline. Core patches
are limited to reproduced failures in mandatory Linux behavior and are guarded
by required regression tests and fail-closed semantic anchors.

The notification badge patch addresses a reproduced GNOME failure: the
upstream app publishes both a Unity LauncherEntry count and a native desktop
notification, while Dash-to-Panel adds the Unity count to its MessageTray
count. One notification is consequently displayed as two. Linux packages keep
the native notification as the single source of truth and publish a zero Unity
count. `scripts/patch-linux-window-ui.test.js` covers the handler behavior,
idempotency, and ambiguous-upstream failure case.

Product extensions and measured workarounds belong in disabled-by-default
`linux-features/<id>/` directories. A new core descriptor is allowed only when
the current signed official package cannot pass a mandatory launch/work smoke
test without it; the descriptor must include reproduction evidence and a
required regression test in the migration tracking record.
