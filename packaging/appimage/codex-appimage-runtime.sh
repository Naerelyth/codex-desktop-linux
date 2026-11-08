#!/bin/bash

codex_packaged_runtime_export_env() {
    export CHROME_DESKTOP="__PACKAGE_NAME__.desktop"

    codex_packaged_runtime_resolve_cli || return $?

    if [ -n "${APPDIR:-}" ] && [ -f "$APPDIR/__PACKAGE_NAME__.desktop" ]; then
        export BAMF_DESKTOP_FILE_HINT="$APPDIR/__PACKAGE_NAME__.desktop"
    else
        export BAMF_DESKTOP_FILE_HINT="__PACKAGE_NAME__.desktop"
    fi
}

# Ordinary AppImages omit resources/codex; isolated profiles retain it.
codex_packaged_runtime_resolve_cli() {
    local cli="${CODEX_CLI_PATH:-}"
    if [ -z "$cli" ] && [ -f "${CODEX_LINUX_APP_DIR:-}/.codex-linux/features/community-profile-isolation/codex-cli-wrapper.sh" ]; then
        cli="$CODEX_LINUX_APP_DIR/resources/codex"
    fi
    if [ -z "$cli" ]; then
        cli="$(type -P codex || true)"
    fi
    if [ -z "$cli" ] || [ ! -f "$cli" ] || [ ! -x "$cli" ]; then
        printf '%s\n' 'ChatGPT AppImage requires a host Codex CLI. Install codex on PATH or set CODEX_CLI_PATH to an executable file.' >&2
        return 1
    fi
    export CODEX_CLI_PATH="$cli"
}
