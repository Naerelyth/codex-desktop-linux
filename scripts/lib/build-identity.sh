#!/bin/bash
# Shared installer/package identity selection. Source before choosing defaults.

resolve_build_identity() {
    CODEX_IDENTITY="${CODEX_IDENTITY:-community}"
    case "$CODEX_IDENTITY" in
        community)
            CODEX_APP_ID="${CODEX_APP_ID:-codex-desktop}"
            CODEX_APP_DISPLAY_NAME="${CODEX_APP_DISPLAY_NAME:-ChatGPT Community}"
            ;;
        upstream)
            if [ "${CODEX_APP_ID:-chatgpt}" != chatgpt ] ||
               [ "${CODEX_APP_DISPLAY_NAME:-ChatGPT}" != ChatGPT ] ||
               [ "${PACKAGE_NAME:-chatgpt}" != chatgpt ]; then
                echo 'CODEX_IDENTITY=upstream requires the chatgpt / ChatGPT identity' >&2
                return 1
            fi
            CODEX_APP_ID=chatgpt
            CODEX_APP_DISPLAY_NAME=ChatGPT
            PACKAGE_NAME=chatgpt
            PACKAGE_DISPLAY_NAME=ChatGPT
            PACKAGE_COMMENT='ChatGPT by OpenAI'
            ;;
        *) echo 'CODEX_IDENTITY must be community or upstream' >&2; return 1 ;;
    esac
    export CODEX_IDENTITY CODEX_APP_ID CODEX_APP_DISPLAY_NAME
    export PACKAGE_NAME PACKAGE_DISPLAY_NAME PACKAGE_COMMENT PACKAGE_WITH_UPDATER
}

resolve_build_identity
