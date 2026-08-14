#!/bin/bash

codex_packaged_runtime_export_env() {
    export CHROME_DESKTOP="__PACKAGE_NAME__.desktop"
    
    # 如果未手动指定 CODEX_CLI_PATH，则自动获取系统中全局 codex 的路径
    if [ -z "${CODEX_CLI_PATH:-}" ]; then
        if command -v codex >/dev/null 2>&1; then
            export CODEX_CLI_PATH="$(command -v codex)"
        fi
    fi

    if [ -n "${APPDIR:-}" ] && [ -f "$APPDIR/__PACKAGE_NAME__.desktop" ]; then
        export BAMF_DESKTOP_FILE_HINT="$APPDIR/__PACKAGE_NAME__.desktop"
    else
        export BAMF_DESKTOP_FILE_HINT="__PACKAGE_NAME__.desktop"
    fi
}
