#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const FEATURE_DIR = __dirname;
const REPO_ROOT = path.resolve(FEATURE_DIR, "../..");
const STAGE = path.join(FEATURE_DIR, "stage.sh");
const CLEANUP = path.join(FEATURE_DIR, "cleanup.sh");
const INSTALL_SESSION_HOOK = path.join(FEATURE_DIR, "install-session-hook.sh");
const COLD_START_HOOK = path.join(FEATURE_DIR, "cold-start-hook.sh");
const LAUNCHER_TEMPLATE = path.join(REPO_ROOT, "launcher", "start.sh.template");

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeExecutable(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, { mode: 0o755 });
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    ...options,
    env: { ...process.env, ...(options.env ?? {}) },
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result;
}

async function waitForFileContent(file, predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) {
      const content = fs.readFileSync(file, "utf8");
      if (predicate(content)) return content;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`timed out waiting for complete content in ${file}`);
}

test("stage hook installs the orphan reaper without wrapping node_repl", () => {
  const tempDir = makeTempDir("codex-mcp-helper-reaper-stage-");
  const appDir = path.join(tempDir, "app");
  const workDir = path.join(tempDir, "work");
  const source = path.join(tempDir, "source", "codex-mcp-helper-reaper");
  const nodeRepl = path.join(appDir, "resources", "node_repl");
  fs.mkdirSync(path.dirname(nodeRepl), { recursive: true });
  fs.mkdirSync(workDir, { recursive: true });
  writeExecutable(source, "#!/usr/bin/env bash\nexit 0\n");
  writeExecutable(nodeRepl, "#!/usr/bin/env bash\necho original node_repl\n");

  const env = {
    SCRIPT_DIR: REPO_ROOT,
    INSTALL_DIR: appDir,
    WORK_DIR: workDir,
    ARCH: process.arch,
    CODEX_MCP_HELPER_REAPER_SOURCE: source,
  };

  run("bash", [STAGE], { env });
  run("bash", [STAGE], { env });

  const installedRoot = path.join(appDir, ".codex-linux");
  const installedReaper = path.join(installedRoot, "mcp-helper-reaper", "codex-mcp-helper-reaper");
  assert.equal(fs.statSync(installedReaper).mode & 0o111, 0o111);
  assert.equal(fs.statSync(path.join(installedRoot, "mcp-helper-reaper", "install-session-hook.sh")).mode & 0o111, 0o111);
  assert.equal(fs.statSync(path.join(installedRoot, "cold-start.d", "mcp-helper-reaper")).mode & 0o111, 0o111);
  assert.equal(fs.statSync(path.join(installedRoot, "after-exit.d", "mcp-helper-reaper")).mode & 0o111, 0o111);
  assert.match(fs.readFileSync(nodeRepl, "utf8"), /original node_repl/);
  assert.equal(fs.existsSync(path.join(appDir, "resources", "node_repl.codex-linux-original")), false);
  assert.equal(fs.existsSync(path.join(installedRoot, "mcp-helper-reaper", "node-repl-wrapper.sh")), false);

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("stage hook restores a node_repl wrapper left by the previous feature version", () => {
  const tempDir = makeTempDir("codex-mcp-helper-reaper-refresh-");
  const appDir = path.join(tempDir, "app");
  const workDir = path.join(tempDir, "work");
  const source = path.join(tempDir, "source", "codex-mcp-helper-reaper");
  const nodeRepl = path.join(appDir, "resources", "node_repl");
  const originalNodeRepl = path.join(appDir, "resources", "node_repl.codex-linux-original");
  fs.mkdirSync(path.dirname(nodeRepl), { recursive: true });
  fs.mkdirSync(workDir, { recursive: true });
  writeExecutable(source, "#!/usr/bin/env bash\nexit 0\n");
  writeExecutable(
    nodeRepl,
    "#!/usr/bin/env bash\n# mcp-helper-reaper-node-repl-wrapper\nexit 0\n",
  );
  writeExecutable(originalNodeRepl, "#!/usr/bin/env bash\necho original node_repl\n");

  const env = {
    SCRIPT_DIR: REPO_ROOT,
    INSTALL_DIR: appDir,
    WORK_DIR: workDir,
    ARCH: process.arch,
    CODEX_MCP_HELPER_REAPER_SOURCE: source,
  };

  run("bash", [STAGE], { env });

  assert.match(fs.readFileSync(nodeRepl, "utf8"), /original node_repl/);
  assert.doesNotMatch(fs.readFileSync(nodeRepl, "utf8"), /mcp-helper-reaper-node-repl-wrapper/);
  assert.equal(fs.existsSync(originalNodeRepl), false);

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("cleanup hook restores node_repl and removes staged hooks", () => {
  const tempDir = makeTempDir("codex-mcp-helper-reaper-cleanup-");
  const appDir = path.join(tempDir, "app");
  const workDir = path.join(tempDir, "work");
  const source = path.join(tempDir, "source", "codex-mcp-helper-reaper");
  const codexHome = path.join(tempDir, "codex-home");
  const nodeRepl = path.join(appDir, "resources", "node_repl");
  fs.mkdirSync(path.dirname(nodeRepl), { recursive: true });
  fs.mkdirSync(workDir, { recursive: true });
  fs.mkdirSync(codexHome, { recursive: true });
  writeExecutable(source, "#!/usr/bin/env bash\nexit 0\n");
  writeExecutable(nodeRepl, "#!/usr/bin/env bash\necho original node_repl\n");
  fs.writeFileSync(
    path.join(codexHome, "hooks.json"),
    JSON.stringify({
      hooks: {
        SessionStart: [
          {
            matcher: "startup|resume",
            hooks: [
              { type: "command", command: "existing mcp report # existing-session-hook", timeout: 15 },
              { type: "command", command: "true # codex-mcp-helper-reaper-session", timeout: 1 },
            ],
          },
        ],
      },
    }) + "\n",
  );

  const env = {
    SCRIPT_DIR: REPO_ROOT,
    INSTALL_DIR: appDir,
    WORK_DIR: workDir,
    ARCH: process.arch,
    CODEX_HOME: codexHome,
    CODEX_MCP_HELPER_REAPER_SOURCE: source,
  };

  run("bash", [STAGE], { env });
  run("bash", [CLEANUP], { env });
  run("bash", [CLEANUP], { env });

  assert.match(fs.readFileSync(nodeRepl, "utf8"), /original node_repl/);
  assert.equal(fs.existsSync(path.join(appDir, "resources", "node_repl.codex-linux-original")), false);
  assert.equal(fs.existsSync(path.join(appDir, ".codex-linux", "mcp-helper-reaper")), false);
  assert.equal(fs.existsSync(path.join(appDir, ".codex-linux", "cold-start.d", "mcp-helper-reaper")), false);
  assert.equal(fs.existsSync(path.join(appDir, ".codex-linux", "after-exit.d", "mcp-helper-reaper")), false);
  const hooks = JSON.parse(fs.readFileSync(path.join(codexHome, "hooks.json"), "utf8"));
  const commands = hooks.hooks.SessionStart.flatMap((entry) => entry.hooks ?? []).map((hook) => hook.command);
  assert.deepEqual(commands, ["existing mcp report # existing-session-hook"]);

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("session hook merge preserves existing SessionStart hook and deduplicates reaper hook", () => {
  const tempDir = makeTempDir("codex-mcp-helper-reaper-hooks-");
  const appDir = path.join(tempDir, "app");
  const codexHome = path.join(tempDir, "codex-home");
  const reaper = path.join(appDir, ".codex-linux", "mcp-helper-reaper", "codex-mcp-helper-reaper");
  fs.mkdirSync(codexHome, { recursive: true });
  writeExecutable(reaper, "#!/usr/bin/env bash\nexit 0\n");
  fs.writeFileSync(
    path.join(codexHome, "hooks.json"),
    JSON.stringify(
      {
        hooks: {
          SessionStart: [
            {
              matcher: "startup|resume",
              hooks: [
                {
                  type: "command",
                  command: "existing mcp report --scope project >/dev/null 2>&1 || true # existing-session-hook",
                  timeout: 15,
                },
              ],
            },
          ],
        },
      },
      null,
      2,
    ) + "\n",
  );

  const env = { CODEX_HOME: codexHome, CODEX_LINUX_APP_DIR: appDir };
  run("bash", [INSTALL_SESSION_HOOK], { env });
  run("bash", [INSTALL_SESSION_HOOK], { env });

  const merged = JSON.parse(fs.readFileSync(path.join(codexHome, "hooks.json"), "utf8"));
  const sessionHooks = merged.hooks.SessionStart.flatMap((entry) => entry.hooks ?? []);
  const commands = sessionHooks.map((hook) => hook.command);
  assert.equal(commands.filter((command) => command.includes("existing-session-hook")).length, 1);
  const reaperHooks = sessionHooks.filter((hook) =>
    hook.command.includes("codex-mcp-helper-reaper-session"),
  );
  assert.equal(reaperHooks.length, 1);
  assert.equal(reaperHooks[0].statusMessage, "MCP Helper Reaper");
  const reaperCommands = reaperHooks.map((hook) => hook.command);
  assert.equal(reaperCommands.length, 1);
  assert.match(reaperCommands[0], /--codex-parent "\$PPID"/);
  assert.match(reaperCommands[0], /--include-orphans/);
  assert.match(reaperCommands[0], /--app-dir /);

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("cold-start hook launches a short all-parent scan", async () => {
  const tempDir = makeTempDir("codex-mcp-helper-reaper-cold-");
  const appDir = path.join(tempDir, "app");
  const callLog = path.join(tempDir, "calls.log");
  const featureDir = path.join(appDir, ".codex-linux", "mcp-helper-reaper");
  const reaper = path.join(featureDir, "codex-mcp-helper-reaper");
  writeExecutable(
    reaper,
    "#!/usr/bin/env bash\nprintf '%s\\n' \"$*\" >> \"$CODEX_MCP_HELPER_REAPER_TEST_LOG\"\n",
  );

  run("bash", [COLD_START_HOOK], {
    env: {
      CODEX_LINUX_APP_DIR: appDir,
      CODEX_MCP_HELPER_REAPER_TEST_LOG: callLog,
      CODEX_MCP_HELPER_REAPER_DELAY: "0",
      CODEX_MCP_HELPER_REAPER_PASSES: "1",
    },
  });

  const calls = await waitForFileContent(
    callLog,
    (content) => content.includes("--all-codex-parents"),
  );
  assert.match(calls, /--all-codex-parents/);
  assert.match(calls, /--include-orphans/);
  assert.match(calls, /--app-dir /);

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("staged lifecycle hooks reach the reaper through the launcher", async () => {
  const tempDir = makeTempDir("codex-mcp-helper-reaper-launcher-");
  const appDir = path.join(tempDir, "app");
  const workDir = path.join(tempDir, "work");
  const source = path.join(tempDir, "source", "codex-mcp-helper-reaper");
  const callLog = path.join(tempDir, "calls.log");
  const appArgs = path.join(tempDir, "app-arguments.log");
  const codexHome = path.join(tempDir, "codex-home");
  const launcher = fs
    .readFileSync(LAUNCHER_TEMPLATE, "utf8")
    .replaceAll("__CODEX_LINUX_APP_ID__", "codex-desktop")
    .replaceAll("__CODEX_LINUX_APP_DISPLAY_NAME__", "ChatGPT Community");

  fs.mkdirSync(workDir, { recursive: true });
  writeExecutable(
    source,
    "#!/usr/bin/env bash\nprintf '%s\\t%s\\n' \"$CODEX_LINUX_FEATURE_HOOK_PHASE\" \"$*\" >> \"$CODEX_MCP_HELPER_REAPER_TEST_LOG\"\n",
  );
  for (const relative of [
    "resources/app.asar",
    "resources/codex",
    "resources/rg",
    "resources/codex-code-mode-host",
    "resources/node_repl",
  ]) {
    writeExecutable(path.join(appDir, relative), "#!/usr/bin/env bash\nexit 0\n");
  }
  writeExecutable(path.join(appDir, "start.sh"), launcher);
  writeExecutable(
    path.join(appDir, "ChatGPT"),
    `#!/usr/bin/env bash
printf '%s\\n' "$@" > "${appArgs}"
exit 7
`,
  );

  run("bash", [STAGE], {
    env: {
      ARCH: process.arch,
      CODEX_MCP_HELPER_REAPER_SOURCE: source,
      INSTALL_DIR: appDir,
      SCRIPT_DIR: REPO_ROOT,
      WORK_DIR: workDir,
    },
  });

  const result = spawnSync(path.join(appDir, "start.sh"), ["codex://thread/123"], {
    encoding: "utf8",
    env: {
      ...process.env,
      CODEX_HOME: codexHome,
      CODEX_LINUX_DISABLE_USAGE_REPORTING: "1",
      CODEX_MCP_HELPER_REAPER_DISABLE: "0",
      CODEX_MCP_HELPER_REAPER_DISABLE_HOOK: "0",
      CODEX_MCP_HELPER_REAPER_DELAY: "0",
      CODEX_MCP_HELPER_REAPER_PASSES: "1",
      CODEX_MCP_HELPER_REAPER_TEST_LOG: callLog,
      XDG_CACHE_HOME: path.join(tempDir, "cache"),
      XDG_CONFIG_HOME: path.join(tempDir, "config"),
      XDG_STATE_HOME: path.join(tempDir, "state"),
    },
  });

  assert.equal(result.status, 7, result.stderr);
  const calls = await waitForFileContent(
    callLog,
    (content) =>
      /^cold-start\t.*--all-codex-parents/m.test(content) &&
      /^after-exit\t.*--all-codex-parents/m.test(content),
  );
  assert.match(calls, /^cold-start\t.*--all-codex-parents/m);
  assert.match(calls, /^after-exit\t.*--all-codex-parents/m);
  assert.deepEqual(fs.readFileSync(appArgs, "utf8").trim().split("\n"), [
    "--class=codex-desktop",
    "codex://thread/123",
  ]);
  assert.match(fs.readFileSync(path.join(codexHome, "hooks.json"), "utf8"), /codex-mcp-helper-reaper-session/);

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("session hook migrates mount paths once and remains byte-identical across restarts", (t) => {
  const tempDir = makeTempDir("codex-reaper-stable-hook-");
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const codexHome = path.join(tempDir, "codex-home");
  const hooksFile = path.join(codexHome, "hooks.json");
  fs.mkdirSync(codexHome);
  const unrelated = { matcher: "startup", hooks: [{ type: "command", command: "echo keep", timeout: 9 }] };
  fs.writeFileSync(hooksFile, JSON.stringify({
    custom: { keep: true },
    hooks: { SessionStart: [unrelated, {
      matcher: "startup|resume",
      hooks: [{ type: "command", command: "/tmp/.mount_old/reaper # codex-mcp-helper-reaper-session", timeout: 1 }],
    }] },
  }));
  const mounts = [path.join(tempDir, ".mount_first"), path.join(tempDir, ".mount_second")];
  for (const appDir of mounts) {
    writeExecutable(path.join(appDir, ".codex-linux/mcp-helper-reaper/codex-mcp-helper-reaper"), "#!/bin/sh\nexit 0\n");
  }
  const install = (appDir) => run("bash", [INSTALL_SESSION_HOOK], {
    env: { CODEX_HOME: codexHome, CODEX_LINUX_APP_DIR: appDir, CODEX_MCP_HELPER_REAPER_DISABLE_HOOK: "0" },
  });
  install(mounts[0]);
  const migrated = JSON.parse(fs.readFileSync(hooksFile, "utf8"));
  assert.deepEqual(migrated.custom, { keep: true });
  assert.deepEqual(migrated.hooks.SessionStart[0], unrelated);
  assert.equal(migrated.hooks.SessionStart.length, 2);
  const hook = migrated.hooks.SessionStart[1];
  assert.equal(hook.matcher, "startup|resume");
  assert.equal(hook.hooks[0].timeout, 1);
  assert.doesNotMatch(hook.hooks[0].command, /\.mount_/);
  assert.match(hook.hooks[0].command, /--app-dir "\$CODEX_LINUX_APP_DIR"/);
  // A semantically identical user-formatted file must not be rewritten either.
  fs.writeFileSync(hooksFile, JSON.stringify(migrated, null, 4));
  fs.utimesSync(hooksFile, 1000000000, 1000000000);
  const before = fs.readFileSync(hooksFile);
  const beforeStat = fs.statSync(hooksFile, { bigint: true });
  install(mounts[1]);
  install(mounts[1]);
  assert.deepEqual(fs.readFileSync(hooksFile), before);
  assert.equal(fs.statSync(hooksFile, { bigint: true }).mtimeNs, beforeStat.mtimeNs);
});

test("stable session command uses the current mount and quotes paths and options", async (t) => {
  const tempDir = makeTempDir("codex-reaper-current-mount-");
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const codexHome = path.join(tempDir, "codex-home");
  const mounts = [path.join(tempDir, ".mount_A"), path.join(tempDir, ".mount_B ' $(not-a-command)")];
  for (const appDir of mounts) {
    writeExecutable(path.join(appDir, ".codex-linux/mcp-helper-reaper/codex-mcp-helper-reaper"),
      '#!/bin/sh\nprintf "%s\\0" "$0" "$@" > "$CODEX_MCP_HELPER_REAPER_TEST_LOG"\n');
  }
  run("bash", [INSTALL_SESSION_HOOK], {
    env: { CODEX_HOME: codexHome, CODEX_LINUX_APP_DIR: mounts[0], CODEX_MCP_HELPER_REAPER_DISABLE_HOOK: "0" },
  });
  const command = JSON.parse(fs.readFileSync(path.join(codexHome, "hooks.json"), "utf8"))
    .hooks.SessionStart[0].hooks[0].command;
  fs.rmSync(mounts[0], { recursive: true });
  const log = path.join(tempDir, "call");
  run("/bin/sh", ["-c", command], { env: {
    CODEX_LINUX_APP_DIR: mounts[1], CODEX_MCP_HELPER_REAPER_DISABLE: "0",
    CODEX_MCP_HELPER_REAPER_TEST_LOG: log,
    CODEX_MCP_HELPER_REAPER_DELAY: "4", CODEX_MCP_HELPER_REAPER_PASSES: "5",
    CODEX_MCP_HELPER_REAPER_INTERVAL: "6", CODEX_MCP_HELPER_REAPER_TERM_TIMEOUT: "7",
  } });
  const output = await waitForFileContent(log, (content) => content.endsWith("--quiet\0"));
  const args = output.split("\0").slice(0, -1);
  assert.equal(args[0], path.join(mounts[1], ".codex-linux/mcp-helper-reaper/codex-mcp-helper-reaper"));
  assert.equal(args[1], "--codex-parent");
  assert.match(args[2], /^\d+$/);
  assert.deepEqual(args.slice(3), ["--include-orphans", "--app-dir", mounts[1],
    "--delay", "4", "--passes", "5", "--interval", "6", "--term-timeout", "7", "--quiet"]);
  fs.unlinkSync(log);
  for (const [appDir, disabled] of [["", "0"], [path.join(tempDir, "missing"), "0"], [mounts[1], "1"]]) {
    run("/bin/sh", ["-c", command], { env: {
      CODEX_LINUX_APP_DIR: appDir, CODEX_MCP_HELPER_REAPER_DISABLE: disabled,
      CODEX_MCP_HELPER_REAPER_TEST_LOG: log,
    } });
    assert.equal(fs.existsSync(log), false);
  }
});
