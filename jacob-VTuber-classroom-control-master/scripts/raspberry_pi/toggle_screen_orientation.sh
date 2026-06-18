#!/usr/bin/env bash

set -euo pipefail

STATE_DIR="${HOME}/.config/open-llm-vtuber"
STATE_FILE="${STATE_DIR}/display-orientation.state"

mkdir -p "${STATE_DIR}"

load_session_env() {
  if [[ -z "${XDG_RUNTIME_DIR:-}" ]]; then
    export XDG_RUNTIME_DIR="/run/user/$(id -u)"
  fi

  local env_dump=""
  env_dump="$(systemctl --user show-environment 2>/dev/null || true)"

  for var_name in DISPLAY WAYLAND_DISPLAY DBUS_SESSION_BUS_ADDRESS XDG_SESSION_TYPE; do
    if [[ -z "${!var_name:-}" ]]; then
      local value=""
      value="$(printf '%s\n' "${env_dump}" | sed -n "s/^${var_name}=//p" | head -n 1)"
      if [[ -n "${value}" ]]; then
        export "${var_name}=${value}"
      fi
    fi
  done
}

notify_result() {
  local message="$1"
  if command -v notify-send >/dev/null 2>&1; then
    notify-send "屏幕方向已切换" "${message}" >/dev/null 2>&1 || true
  fi
  printf '%s\n' "${message}"
}

toggle_with_wlr_randr() {
  local output=""
  output="$(
    wlr-randr 2>/dev/null | awk '
      /^[^[:space:]]/ { current_output=$1 }
      /^[[:space:]]+[0-9]+x[0-9]+/ && selected_output == "" {
        selected_output=current_output
      }
      END {
        if (selected_output != "") {
          print selected_output
        }
      }
    '
  )"

  if [[ -z "${output}" ]]; then
    return 1
  fi

  local current_transform=""
  current_transform="$(
    wlr-randr 2>/dev/null | awk -v target="${output}" '
      /^[^[:space:]]/ { in_block=($1 == target) }
      in_block && /Transform:/ { print $2; exit }
    '
  )"

  local target_transform=""
  local label=""
  case "${current_transform}" in
    90|270)
      target_transform="normal"
      label="横屏"
      ;;
    *)
      target_transform="90"
      label="竖屏"
      ;;
  esac

  wlr-randr --output "${output}" --transform "${target_transform}"
  printf '%s\n' "${target_transform}" > "${STATE_FILE}"
  notify_result "${label}"
}

toggle_with_xrandr() {
  local output=""
  output="$(xrandr --query | awk '/ connected/ { print $1; exit }')"
  if [[ -z "${output}" ]]; then
    return 1
  fi

  local current_rotation=""
  current_rotation="$(
    xrandr --query | awk -v target="${output}" '
      $1 == target && / connected/ {
        for (i = 1; i <= NF; ++i) {
          if ($i == "normal" || $i == "left" || $i == "right" || $i == "inverted") {
            print $i
            exit
          }
        }
      }
    '
  )"

  local target_rotation=""
  local state_value=""
  local label=""
  case "${current_rotation}" in
    left|right)
      target_rotation="normal"
      state_value="normal"
      label="横屏"
      ;;
    *)
      target_rotation="left"
      state_value="90"
      label="竖屏"
      ;;
  esac

  xrandr --output "${output}" --rotate "${target_rotation}"
  printf '%s\n' "${state_value}" > "${STATE_FILE}"
  notify_result "${label}"
}

main() {
  load_session_env

  if command -v wlr-randr >/dev/null 2>&1 && toggle_with_wlr_randr; then
    exit 0
  fi

  if command -v xrandr >/dev/null 2>&1 && toggle_with_xrandr; then
    exit 0
  fi

  notify_result "未检测到可用的显示旋转命令"
  exit 1
}

main "$@"
