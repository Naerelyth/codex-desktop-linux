"use strict";
const assert = require("node:assert/strict");
const cp = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const root = path.resolve(__dirname, "../..");

function bash(source, args = [], env = {}) {
  const result = cp.spawnSync("/bin/bash", ["-c", source, "fixture", ...args], {
    cwd: root, encoding: "utf8", env: { ...process.env, ...env },
  });
  assert.ifError(result.error);
  return result;
}

test("build and rebuild targets schedule enabled helpers before staging", () => {
  for (const target of ["build-app", "build-app-fresh", "rebuild", "rebuild-install", "rebuild-next"]) {
    const result = cp.spawnSync("make", ["-n", target], { cwd: root, encoding: "utf8" });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    const helper = result.stdout.indexOf("cargo build");
    const stage = result.stdout.search(/\.\/scripts\/rebuild-candidate\.sh|\.\/install\.sh/);
    assert.ok(helper >= 0 && stage > helper, result.stdout);
  }
});

test("AppImage requires a host CLI and preserves explicit executable overrides", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "personal-cli-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = 'source packaging/appimage/codex-appimage-runtime.sh; codex_packaged_runtime_export_env || exit $?; printf "%s" "${CODEX_CLI_PATH:-}"';
  let result = bash(source, [], { PATH: dir, CODEX_CLI_PATH: "" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /requires a host Codex CLI/);
  assert.equal(result.stdout, "");
  fs.writeFileSync(path.join(dir, "codex"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  result = bash(source, [], { PATH: dir, CODEX_CLI_PATH: "" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, path.join(dir, "codex"));
  const explicit = path.join(dir, "custom-cli");
  fs.writeFileSync(explicit, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  result = bash(source, [], { PATH: dir, CODEX_CLI_PATH: explicit });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, explicit);
  for (const invalid of [path.join(dir, "missing"), dir]) {
    result = bash(source, [], { PATH: dir, CODEX_CLI_PATH: invalid });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /requires a host Codex CLI/);
  }
  fs.chmodSync(explicit, 0o644);
  result = bash(source, [], { PATH: dir, CODEX_CLI_PATH: explicit });
  assert.equal(result.status, 1);
});

test("installer accepts matching env input and rejects conflicts and duplicate positionals", () => {
  const source = 'source scripts/lib/install-helpers.sh; trap - EXIT ERR; error() { echo "$*" >&2; exit 1; }; parse_args "$@"';
  for (const [envPath, args, success] of [
    ["/tmp/a.deb", ["/tmp/a.deb"], true],
    ["/tmp/a.deb", ["/tmp/b.deb"], false],
    ["", ["/tmp/a.deb", "/tmp/a.deb"], false],
    ["", ["/tmp/a.deb"], true],
  ]) {
    const result = bash(source, args, { UPSTREAM_DEB: envPath });
    assert.equal(result.status === 0, success, result.stderr);
  }
});

test("environment-only upstream input validates its extension", () => {
  const source = 'source scripts/lib/install-helpers.sh; trap - EXIT ERR; error() { echo "$*" >&2; exit 1; }; validate_app_identity';
  for (const [input, success] of [["/tmp/a.deb", true], ["/tmp/a.dmg", false], ["/tmp/a.zip", false]]) {
    const result = bash(source, [], {
      UPSTREAM_DEB: input, CODEX_APP_ID: "codex-desktop", CODEX_APP_DISPLAY_NAME: "ChatGPT",
    });
    assert.equal(result.status === 0, success, result.stderr);
  }
});

test("AppImage staging excludes CLI and diagnoses the host executable", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "host-cli-appimage-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const app = path.join(dir, "app");
  const appdir = path.join(dir, "AppDir");
  fs.mkdirSync(path.join(app, "resources"), { recursive: true });
  fs.mkdirSync(path.join(app, ".codex-linux/upstream-package"), { recursive: true });
  fs.writeFileSync(path.join(app, ".codex-linux/upstream-package/control"),
    `Package: chatgpt\nArchitecture: ${process.arch === "arm64" ? "arm64" : "amd64"}\n`);
  const launcher = fs.readFileSync(path.join(root, "launcher/start.sh.template"), "utf8")
    .replaceAll("__CODEX_LINUX_APP_ID__", "codex-desktop")
    .replaceAll("__CODEX_LINUX_APP_DISPLAY_NAME__", "ChatGPT");
  fs.writeFileSync(path.join(app, "start.sh"), launcher, { mode: 0o755 });
  for (const name of ["ChatGPT", "resources/codex", "resources/rg", "resources/codex-code-mode-host"]) {
    fs.writeFileSync(path.join(app, name), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  }
  fs.writeFileSync(path.join(app, "ChatGPT"), '#!/bin/sh\nprintf "%s\\n" "$CODEX_CLI_PATH"\n', { mode: 0o755 });
  const hooks = path.join(app, ".codex-linux/launcher.d");
  const attached = path.join(app, ".codex-linux/features/shared-app-server-socket");
  fs.mkdirSync(hooks, { recursive: true });
  fs.mkdirSync(attached, { recursive: true });
  fs.copyFileSync(path.join(root, "linux-features/shared-app-server-socket/socket-env.sh"), path.join(hooks, "socket-env.sh"));
  fs.chmodSync(path.join(hooks, "socket-env.sh"), 0o755);
  fs.copyFileSync(path.join(root, "linux-features/shared-app-server-socket/attached-cli.sh"), path.join(attached, "attached-cli.sh"));
  fs.chmodSync(path.join(attached, "attached-cli.sh"), 0o755);
  fs.writeFileSync(path.join(app, "resources/app.asar"), "fixture");
  const result = bash('bash scripts/build-appimage.sh', [], {
    APP_DIR_OVERRIDE: app, APPIMAGE_APPDIR_OVERRIDE: appdir,
    DIST_DIR_OVERRIDE: path.join(dir, "dist"), APPIMAGE_STAGE_ONLY: "1",
    CODEX_LINUX_FEATURES_CONFIG: path.join(root, "linux-features/features.example.json"),
  });
  assert.equal(result.status, 0, result.stderr);
  const packaged = path.join(appdir, "opt/codex-desktop");
  assert.equal(fs.existsSync(path.join(packaged, "resources/codex")), false);
  assert.equal(fs.existsSync(path.join(app, "resources/codex")), true);
  for (const name of ["resources/rg", "resources/codex-code-mode-host"]) {
    assert.equal(fs.existsSync(path.join(packaged, name)), true);
  }
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  const hostCli = path.join(bin, "codex");
  fs.writeFileSync(hostCli, '#!/bin/sh\nprintf "host-cli %s\\n" "$*"\n', { mode: 0o755 });
  const env = {
    ...process.env, APPDIR: appdir, CODEX_CLI_PATH: hostCli, CODEX_LINUX_DISABLE_USAGE_REPORTING: "1",
    HOME: dir, CODEX_HOME: path.join(dir, ".codex"), XDG_CONFIG_HOME: path.join(dir, "config"),
    XDG_STATE_HOME: path.join(dir, "state"), XDG_CACHE_HOME: path.join(dir, "cache"),
    XDG_RUNTIME_DIR: path.join(dir, "runtime"), PATH: `${bin}:${process.env.PATH}`,
  };
  let diagnose = cp.spawnSync(path.join(appdir, "AppRun"), ["--diagnose"], { encoding: "utf8", env });
  assert.ifError(diagnose.error);
  assert.equal(diagnose.status, 0, diagnose.stderr);
  assert.ok(diagnose.stdout.includes(`ok: ${hostCli}`), diagnose.stdout);
  const launched = cp.spawnSync(path.join(appdir, "AppRun"), [], {
    encoding: "utf8", env: { ...env, CODEX_CLI_PATH: "" },
  });
  assert.equal(launched.status, 0, launched.stderr);
  assert.equal(launched.stdout.trim(), hostCli);
  for (const flag of ["--help", "--version", "help"]) {
    const help = cp.spawnSync(path.join(appdir, "AppRun"), ["--cli", flag], {
      encoding: "utf8", env: { ...env, CODEX_CLI_PATH: "" },
    });
    assert.equal(help.status, 0, help.stderr);
    assert.equal(help.stdout.trim(), `host-cli ${flag}`);
  }
  const attachWithShim = cp.spawnSync(path.join(appdir, "AppRun"), ["--cli", "hello"], {
    encoding: "utf8", env: { ...env, CODEX_CLI_PATH: "" },
  });
  assert.equal(attachWithShim.status, 1);
  assert.match(attachWithShim.stderr, /requires the native Codex binary/);
  assert.match(attachWithShim.stderr, /restart Desktop with the same path/);
  diagnose = cp.spawnSync(path.join(appdir, "AppRun"), ["--diagnose"], {
    encoding: "utf8", env: { ...env, CODEX_CLI_PATH: path.join(dir, "missing") },
  });
  assert.equal(diagnose.status, 1);
  assert.match(diagnose.stderr, /requires a host Codex CLI/);

  // The current profile-isolation feature needs its bundled CLI and must
  // remain usable without a host CLI, including after its launcher hook runs.
  const isolation = path.join(app, ".codex-linux/features/community-profile-isolation");
  fs.mkdirSync(isolation, { recursive: true });
  const featureRoot = path.join(root, "linux-features/community-profile-isolation");
  fs.copyFileSync(path.join(featureRoot, "codex-cli-wrapper.sh"), path.join(isolation, "codex-cli-wrapper.sh"));
  fs.copyFileSync(path.join(featureRoot, "launcher-hook.sh"), path.join(hooks, "00-isolation.sh"));
  fs.chmodSync(path.join(hooks, "00-isolation.sh"), 0o755);
  fs.mkdirSync(path.join(app, ".codex-linux/env.d"), { recursive: true });
  fs.copyFileSync(path.join(featureRoot, "env.sh"), path.join(app, ".codex-linux/env.d/isolation.sh"));
  const isolatedStage = bash('bash scripts/build-appimage.sh', [], {
    APP_DIR_OVERRIDE: app, APPIMAGE_APPDIR_OVERRIDE: appdir,
    DIST_DIR_OVERRIDE: path.join(dir, "dist"), APPIMAGE_STAGE_ONLY: "1",
    CODEX_LINUX_FEATURES_CONFIG: path.join(root, "linux-features/features.example.json"),
  });
  assert.equal(isolatedStage.status, 0, isolatedStage.stderr);
  assert.equal(fs.existsSync(path.join(packaged, "resources/codex")), true);
  const isolatedEnv = { ...env, CODEX_CLI_PATH: "", PATH: "/usr/bin:/bin" };
  const isolated = cp.spawnSync(path.join(appdir, "AppRun"), [], { encoding: "utf8", env: isolatedEnv });
  assert.equal(isolated.status, 0, isolated.stderr);
  assert.equal(isolated.stdout.trim(), path.join(packaged, ".codex-linux/features/community-profile-isolation/codex-cli-wrapper.sh"));
  const isolatedDiagnose = cp.spawnSync(path.join(appdir, "AppRun"), ["--diagnose"], { encoding: "utf8", env: isolatedEnv });
  assert.equal(isolatedDiagnose.status, 0, isolatedDiagnose.stderr);
  assert.ok(isolatedDiagnose.stdout.includes(`ok: ${path.join(packaged, "resources/codex")}`));
});
