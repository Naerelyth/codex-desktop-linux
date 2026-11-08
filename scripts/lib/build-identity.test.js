"use strict";

const assert = require("node:assert/strict");
const cp = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const root = path.resolve(__dirname, "../..");

function run(script, env = {}) {
  const clean = { ...process.env };
  for (const name of ["CODEX_IDENTITY", "CODEX_APP_ID", "CODEX_APP_DISPLAY_NAME", "PACKAGE_NAME",
    "PACKAGE_DISPLAY_NAME", "PACKAGE_COMMENT", "PACKAGE_ICON_SOURCE", "PACKAGE_WITH_UPDATER"]) delete clean[name];
  return cp.spawnSync("bash", ["-eu", "-o", "pipefail", "-c", script], {
    cwd: root, encoding: "utf8", env: { ...clean, CODEX_LINUX_FEATURES_CONFIG: path.join(root, "linux-features/features.example.json"), ...env },
  });
}

const officialDesktop = `[Desktop Entry]
Name=ChatGPT
Comment=ChatGPT by OpenAI
GenericName=AI assistant
Exec=chatgpt %U
Icon=chatgpt
Type=Application
StartupNotify=true
Categories=Utility;Development;
MimeType=x-scheme-handler/codex;x-scheme-handler/http;x-scheme-handler/https;text/csv;application/vnd.openxmlformats-officedocument.wordprocessingml.document;
`;
const personalIcon = fs.readFileSync(path.join(root, "assets/codex-linux.png"));

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "build-identity-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const app = path.join(dir, "app");
  fs.mkdirSync(path.join(app, "resources"), { recursive: true });
  fs.mkdirSync(path.join(app, ".codex-linux/upstream-package"), { recursive: true });
  for (const name of ["ChatGPT", "resources/codex", "resources/rg", "resources/codex-code-mode-host"]) {
    fs.writeFileSync(path.join(app, name), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  }
  fs.writeFileSync(path.join(app, "resources/app.asar"), "fixture asar");
  fs.writeFileSync(path.join(app, ".codex-linux/build-info.json"), JSON.stringify({ linuxFeatures: { enabled: [] } }));
  fs.writeFileSync(path.join(app, ".codex-linux/upstream-package/chatgpt.desktop"), officialDesktop);
  fs.writeFileSync(path.join(app, ".codex-linux/upstream-package/control"),
    `Package: chatgpt\nArchitecture: ${process.arch === "arm64" ? "arm64" : "amd64"}\nMaintainer: OpenAI <support@openai.com>\nDepends: libc6\n`);
  const result = run('source ./install.sh; create_start_script; stage_community_branding', {
    CODEX_IDENTITY: "upstream", CODEX_INSTALLER_SOURCE_ONLY: "1", CODEX_INSTALL_DIR: app,
  });
  assert.equal(result.status, 0, result.stderr);
  return { dir, app };
}

test("identity selection validates mode without changing updater selection", () => {
  const script = 'source scripts/lib/build-identity.sh; printf "%s|%s|%s|%s" "$CODEX_APP_ID" "$CODEX_APP_DISPLAY_NAME" "${PACKAGE_NAME:-}" "${PACKAGE_WITH_UPDATER:-}"';
  assert.equal(run(script).stdout, "codex-desktop|ChatGPT Community||");
  assert.equal(run(script, { CODEX_IDENTITY: "upstream", PACKAGE_WITH_UPDATER: "1" }).stdout,
    "chatgpt|ChatGPT|chatgpt|1");
  for (const env of [
    { CODEX_IDENTITY: "typo" },
    { CODEX_IDENTITY: "upstream", CODEX_APP_ID: "codex-desktop" },
    { CODEX_IDENTITY: "upstream", PACKAGE_NAME: "another-app" },
  ]) assert.notEqual(run(script, env).status, 0);
});

test("upstream identity preserves official metadata while retaining the personal icon", (t) => {
  const { dir, app } = fixture(t);
  const result = run(`
    REPO_DIR="$PWD"; APP_DIR="$TEST_APP"
    source scripts/lib/package-common.sh
    ICON_SOURCE="$(resolve_package_icon_source)"
    DESKTOP_TEMPLATE="$PWD/packaging/linux/codex-desktop.desktop"
    stage_common_package_files "$TEST_DIR/native"
    write_launcher_stub "$TEST_DIR/native"
  `, { CODEX_IDENTITY: "upstream", TEST_APP: app, TEST_DIR: dir, PACKAGE_WITH_UPDATER: "0" });
  assert.equal(result.status, 0, result.stderr);
  const packaged = path.join(dir, "native/opt/chatgpt");
  assert.deepEqual(fs.readFileSync(path.join(packaged, "resources/icon-chatgpt.png")), personalIcon);
  assert.match(fs.readFileSync(path.join(packaged, "start.sh"), "utf8"), /APP_ID:-chatgpt/);
  const desktop = fs.readFileSync(path.join(dir, "native/usr/share/applications/chatgpt.desktop"), "utf8");
  assert.match(desktop, /^Name=ChatGPT$/m);
  assert.match(desktop, /^Icon=chatgpt$/m);
  assert.equal(desktop, officialDesktop);
  assert.doesNotMatch(desktop, /Community|codex-desktop/);
  assert.match(fs.readFileSync(path.join(packaged, ".codex-linux/codex-no-updater-transition-cleanup.sh"), "utf8"), /codex_no_updater_cleanup_update_manager_service/);
  assert.equal(fs.existsSync(path.join(dir, "native/usr/bin/codex-update-manager")), false);
  const identityFile = path.join(dir, "installed-updater-identity");
  const legacyUpdater = path.join(dir, "legacy-updater");
  const cleanup = fs.readFileSync(path.join(packaged, ".codex-linux/codex-no-updater-transition-cleanup.sh"), "utf8")
    .replaceAll("/usr/share/codex-update-manager/identity", identityFile)
    .replaceAll("/usr/bin/codex-update-manager", legacyUpdater);
  const cleanupScript = path.join(dir, "cleanup.sh");
  fs.writeFileSync(cleanupScript, cleanup);
  const checkCleanup = () => run(`
    source "$TEST_CLEANUP"
    codex_no_updater_foreach_user_manager() { printf stopped; }
    codex_no_updater_cleanup_user_enablement_links() { printf unlinked; }
    codex_no_updater_cleanup_update_manager_service
  `, { TEST_CLEANUP: cleanupScript });
  fs.writeFileSync(identityFile, "community\n");
  assert.equal(checkCleanup().stdout, "");
  fs.writeFileSync(identityFile, "upstream\n");
  assert.equal(checkCleanup().stdout, "stoppedunlinked");
  fs.unlinkSync(identityFile);
  assert.equal(checkCleanup().stdout, "stoppedunlinked");
  fs.writeFileSync(legacyUpdater, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  assert.equal(checkCleanup().stdout, "");
  const mismatch = run('REPO_DIR="$PWD"; APP_DIR="$TEST_APP"; source scripts/lib/package-common.sh; ensure_app_layout', {
    TEST_APP: app, CODEX_IDENTITY: "community",
  });
  assert.notEqual(mismatch.status, 0);
  assert.match(mismatch.stderr, /rebuild with CODEX_IDENTITY=community/);
});

test("upstream AppImage retains official metadata and the personal icon", (t) => {
  const { dir, app } = fixture(t);
  const appdir = path.join(dir, "AppDir");
  const result = run('bash scripts/build-appimage.sh', {
    CODEX_IDENTITY: "upstream", APP_DIR_OVERRIDE: app,
    APPIMAGE_APPDIR_OVERRIDE: appdir, APPIMAGE_STAGE_ONLY: "1",
  });
  assert.equal(result.status, 0, result.stderr);
  const desktop = fs.readFileSync(path.join(appdir, "chatgpt.desktop"), "utf8");
  assert.match(desktop, /^Name=ChatGPT$/m);
  assert.equal(desktop, officialDesktop.replace("Exec=chatgpt", "Exec=AppRun") + "X-AppImage-Version=" + /^X-AppImage-Version=(.*)$/m.exec(desktop)[1] + "\n");
  assert.doesNotMatch(desktop, /StartupWMClass=/);
  assert.doesNotMatch(desktop, /Community|codex-desktop/);
  assert.deepEqual(fs.readFileSync(path.join(appdir, "chatgpt.png")), personalIcon);
  assert.equal(fs.existsSync(path.join(appdir, "opt/chatgpt/resources/codex")), false);
  assert.match(fs.readFileSync(path.join(appdir, "AppRun"), "utf8"), /opt\/chatgpt\/start.sh/);
});

test("upstream Debian package has chatgpt metadata and no community updater", (t) => {
  const { dir, app } = fixture(t);
  const result = run('bash scripts/build-deb.sh', {
    CODEX_IDENTITY: "upstream", APP_DIR_OVERRIDE: app, PACKAGE_WITH_UPDATER: "0",
    PKG_ROOT_OVERRIDE: path.join(dir, "deb-root"), DIST_DIR_OVERRIDE: dir, PACKAGE_VERSION: "1.0",
  });
  assert.equal(result.status, 0, result.stderr);
  const control = fs.readFileSync(path.join(dir, "deb-root/DEBIAN/control"), "utf8");
  assert.match(control, /^Package: chatgpt$/m);
  assert.doesNotMatch(control, /Community|codex-desktop/);
  assert.ok(fs.readdirSync(dir).some(name => /^chatgpt_1\.0_.*\.deb$/.test(name)));
});

test("upstream identity keeps the configured updater and enabled desktop actions", (t) => {
  const { dir, app } = fixture(t);
  fs.writeFileSync(path.join(app, ".codex-linux/patch-report.json"), JSON.stringify({
    enabledFeatures: ["desktop-new-window"],
    patches: [{ name: "feature:desktop-new-window:second-instance", status: "applied" }],
  }));
  const updater = path.join(dir, "updater");
  fs.writeFileSync(updater, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const result = run(`
    REPO_DIR="$PWD"; APP_DIR="$TEST_APP"
    source scripts/lib/package-common.sh
    ICON_SOURCE="$(resolve_package_icon_source)"
    DESKTOP_TEMPLATE="$PWD/packaging/linux/codex-desktop.desktop"
    UPDATER_BINARY_SOURCE="$TEST_UPDATER"
    UPDATER_SERVICE_SOURCE="$PWD/packaging/linux/codex-update-manager.service"
    PACKAGED_RUNTIME_SOURCE="$PWD/packaging/linux/codex-packaged-runtime.sh"
    stage_common_package_files "$TEST_DIR/native"
  `, {
    CODEX_IDENTITY: "upstream", TEST_APP: app, TEST_DIR: dir,
    TEST_UPDATER: updater, PACKAGE_WITH_UPDATER: "1",
  });
  assert.equal(result.status, 0, result.stderr);
  const desktop = fs.readFileSync(path.join(dir, "native/usr/share/applications/chatgpt.desktop"), "utf8");
  assert.ok(desktop.startsWith(officialDesktop));
  assert.match(desktop, /^Actions=new-window;CheckForUpdates;InstallReadyUpdate;$/m);
  assert.match(desktop, /--new-window/);
  const action = desktop.split("[Desktop Action new-window]")[1].split("[Desktop Action ")[0];
  assert.match(action, /\/usr\/bin\/chatgpt --new-window/);
  assert.doesNotMatch(action, /codex-desktop/);
  assert.equal(fs.existsSync(path.join(dir, "native/usr/bin/codex-update-manager")), true);
  assert.equal(fs.readFileSync(path.join(dir, "native/usr/share/codex-update-manager/identity"), "utf8"), "upstream\n");
  const packaged = path.join(dir, "native/opt/chatgpt");
  fs.writeFileSync(path.join(packaged, "ChatGPT"),
    '#!/bin/sh\nprintf "%s\\n" "$CODEX_LINUX_APP_ID" "$CHROME_DESKTOP" "$@" > "$TEST_CAPTURE"\n', { mode: 0o755 });
  const capture = path.join(dir, "new-window-arguments");
  const launch = run('"$TEST_LAUNCHER" --new-window', {
    TEST_LAUNCHER: path.join(packaged, "start.sh"), TEST_CAPTURE: capture,
    HOME: dir, CODEX_HOME: path.join(dir, "codex-home"),
    XDG_CONFIG_HOME: path.join(dir, "config"), XDG_STATE_HOME: path.join(dir, "state"),
    XDG_CACHE_HOME: path.join(dir, "cache"), XDG_RUNTIME_DIR: path.join(dir, "runtime"),
    CODEX_LINUX_APP_ID: "chatgpt", CHROME_DESKTOP: "chatgpt.desktop",
    CODEX_LINUX_DISABLE_USAGE_REPORTING: "1", CODEX_OZONE_PLATFORM: "x11",
  });
  assert.equal(launch.status, 0, launch.stderr);
  const forwarded = fs.readFileSync(capture, "utf8").trim().split("\n");
  assert.deepEqual(forwarded.slice(0, 2), ["chatgpt", "chatgpt.desktop"]);
  assert.ok(forwarded.includes("--new-window"));
  assert.equal(forwarded.some(arg => arg.startsWith("--class=")), false);
});
