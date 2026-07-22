#!/usr/bin/env bash

set -euo pipefail

display_server="${1:-}"
case "$display_server" in
  x11 | wayland) ;;
  *)
    echo "用法：$0 <x11|wayland>" >&2
    exit 2
    ;;
esac

artifact_dir="${RUNNER_TEMP:-/tmp}/omp-ci"
screenshot_path="$PWD/tests/artifacts/${display_server}-smoke.png"
weston_pid=""

mkdir -p "$artifact_dir" tests/artifacts

cleanup() {
  local exit_code=$?

  if [[ -n "$weston_pid" ]]; then
    kill "$weston_pid" 2>/dev/null || true
    wait "$weston_pid" 2>/dev/null || true
  fi

  local app_log="$HOME/.config/OMP Desktop/logs/main.log"
  if [[ -f "$app_log" ]]; then
    cp "$app_log" "$artifact_dir/main.log"
  fi

  pgrep -a -f '/electron/dist/electron' >"$artifact_dir/electron-processes-after.txt" || true
  exit "$exit_code"
}
trap cleanup EXIT

{
  uname -a
  cat /etc/os-release
  printf 'node=%s\n' "$(node --version)"
  printf 'pnpm=%s\n' "$(pnpm --version)"
  printf 'electron=%s\n' "$(node -p "require('./node_modules/electron/package.json').version")"
  printf 'display=%s\n' "$display_server"
} >"$artifact_dir/environment.txt"

export ELECTRON_DISABLE_SECURITY_WARNINGS=true
export OMP_DISPLAY_SERVER="$display_server"
export OMP_SMOKE_SCREENSHOT="$screenshot_path"

if [[ "$display_server" == "x11" ]]; then
  xvfb-run \
    -a \
    --server-args='-screen 0 1440x900x24 -nolisten tcp' \
    pnpm smoke
else
  unset DISPLAY
  export XDG_SESSION_TYPE=wayland
  export XDG_RUNTIME_DIR="$artifact_dir/xdg-runtime"
  export WAYLAND_DISPLAY=wayland-ci
  export OMP_SMOKE_SOFTWARE_RENDERING=true
  mkdir -p "$XDG_RUNTIME_DIR"
  chmod 700 "$XDG_RUNTIME_DIR"

  weston \
    --backend=headless-backend.so \
    --socket="$WAYLAND_DISPLAY" \
    --idle-time=0 \
    --log="$artifact_dir/weston.log" &
  weston_pid=$!

  for _ in {1..100}; do
    if [[ -S "$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY" ]]; then
      break
    fi
    if ! kill -0 "$weston_pid" 2>/dev/null; then
      echo 'Weston 在 Wayland socket 就绪前退出' >&2
      exit 1
    fi
    sleep 0.1
  done

  if [[ ! -S "$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY" ]]; then
    echo '等待 Weston Wayland socket 超时' >&2
    exit 1
  fi

  pnpm smoke
fi

if [[ ! -s "$screenshot_path" ]]; then
  echo "Smoke 未生成截图：$screenshot_path" >&2
  exit 1
fi

if pgrep -f '/electron/dist/electron' >/dev/null; then
  echo 'Smoke 结束后仍有 Electron 进程残留' >&2
  pgrep -a -f '/electron/dist/electron' >&2 || true
  exit 1
fi

echo "${display_server} smoke 通过"
