#!/bin/sh
# Process-local runtime selection only: no service/configuration/clock changes.
set -eu
export PATH="/home/santi/.nvm/versions/node/v22.22.2/bin:/mnt/wsl/docker-desktop/cli-tools/usr/bin:$PATH"
unset DOCKER_CONTEXT
export DOCKER_HOST=unix:///mnt/wsl/docker-desktop/shared-sockets/host-services/docker.proxy.sock
export PLAYWRIGHT_BROWSERS_PATH=/home/santi/.cache/ms-playwright
# Root is used solely for access to the existing root-owned proxy socket.
# Trust only this invocation's explicitly supplied isolated worktree.
export GIT_CONFIG_COUNT=1
export GIT_CONFIG_KEY_0=safe.directory
export GIT_CONFIG_VALUE_0="$2"
lib_dir="$(dirname "$2")/sync355-browserlibs/runtime/usr/lib/x86_64-linux-gnu"
if [ -d "$lib_dir" ]; then export LD_LIBRARY_PATH="$lib_dir${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"; fi
exec node "$@"
