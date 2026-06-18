#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
CONF_FILE="${OPEN_LLM_VTUBER_CONF:-${PROJECT_DIR}/conf.yaml}"
LOG_DIR="${PROJECT_DIR}/logs"
SERVER_LOG="${LOG_DIR}/launcher_server.log"
KIOSK_PROFILE_DIR="${PROJECT_DIR}/.kiosk-profile"
CLASSROOM_ENV_FILE="${JACOB_CLASSROOM_ENV_FILE:-${PROJECT_DIR}/.classroom.env}"

if [[ -f "${CLASSROOM_ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${CLASSROOM_ENV_FILE}"
  set +a
fi

mkdir -p "${LOG_DIR}"
mkdir -p "${KIOSK_PROFILE_DIR}"

read_server_host_and_port() {
  python3 - "${CONF_FILE}" <<'PY'
import sys
from pathlib import Path

host = "localhost"
port = "12393"
conf_path = Path(sys.argv[1])

if conf_path.exists():
    try:
        import yaml

        with conf_path.open("r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        system_config = data.get("system_config") or {}
        host = str(system_config.get("host", host))
        port = str(system_config.get("port", port))
    except Exception:
        pass

print(host)
print(port)
PY
}

mapfile -t host_port < <(read_server_host_and_port)
HOST="${OPEN_LLM_VTUBER_HOST:-${host_port[0]:-localhost}}"
PORT="${OPEN_LLM_VTUBER_PORT:-${host_port[1]:-12393}}"

if [[ "${HOST}" == "0.0.0.0" ]]; then
  HOST="localhost"
fi

URL="http://${HOST}:${PORT}/"
LAUNCH_URL="${URL}?v=$(date +%s)"

activate_venv_if_exists() {
  if [[ -f "${PROJECT_DIR}/venv/bin/activate" ]]; then
    # shellcheck disable=SC1091
    source "${PROJECT_DIR}/venv/bin/activate"
    return
  fi

  if [[ -f "${PROJECT_DIR}/.venv/bin/activate" ]]; then
    # shellcheck disable=SC1091
    source "${PROJECT_DIR}/.venv/bin/activate"
  fi
}

is_server_ready() {
  curl -fsS "${URL}" >/dev/null 2>&1
}

stop_existing_server() {
  local server_pids
  server_pids="$(pgrep -f '[r]un_server.py' || true)"
  if [[ -n "${server_pids}" ]]; then
    echo "${server_pids}" | xargs -r kill 2>/dev/null || true
    sleep 1
    server_pids="$(pgrep -f '[r]un_server.py' || true)"
    if [[ -n "${server_pids}" ]]; then
      echo "${server_pids}" | xargs -r kill -9 2>/dev/null || true
    fi
  fi
}

start_server() {
  stop_existing_server
  activate_venv_if_exists
  (
    cd "${PROJECT_DIR}"
    nohup python run_server.py >>"${SERVER_LOG}" 2>&1 &
  )
}

wait_for_server_ready() {
  for _ in $(seq 1 60); do
    if is_server_ready; then
      return 0
    fi
    sleep 1
  done
  return 1
}

prefer_microphone_input_if_available() {
  if ! command -v pactl >/dev/null 2>&1; then
    return
  fi

  local preferred_source=""
  preferred_source="$(
    pactl list short sources 2>/dev/null | awk '
      /monitor/ { next }
      /alsa_input\\.usb-|usb-.*analog/ { print $2; exit }
      /wm8960/ { wm8960=$2 }
      /alsa_input\\./ && fallback=="" { fallback=$2 }
      END {
        if (wm8960 != "") {
          print wm8960
        } else if (fallback != "") {
          print fallback
        }
      }
    '
  )"

  if [[ -n "${preferred_source}" ]]; then
    pactl set-default-source "${preferred_source}" >/dev/null 2>&1 || true
    pactl set-source-mute "${preferred_source}" 0 >/dev/null 2>&1 || true
    pactl set-source-volume "${preferred_source}" 100% >/dev/null 2>&1 || true
    echo "Preferred microphone source: ${preferred_source}"
  fi
}

launch_browser_fullscreen() {
  local browser=""
  for candidate in chromium-browser chromium google-chrome firefox-esr firefox; do
    if command -v "${candidate}" >/dev/null 2>&1; then
      browser="${candidate}"
      break
    fi
  done

  if [[ -z "${browser}" ]]; then
    xdg-open "${URL}" >/dev/null 2>&1 &
    return
  fi

  # Make kiosk browsers inherit Fcitx so Chinese IME switching works in text fields.
  export GTK_IM_MODULE="${GTK_IM_MODULE:-fcitx}"
  export QT_IM_MODULE="${QT_IM_MODULE:-fcitx}"
  export XMODIFIERS="${XMODIFIERS:-@im=fcitx}"
  export SDL_IM_MODULE="${SDL_IM_MODULE:-fcitx}"

  case "${browser}" in
    chromium-browser|chromium|google-chrome)
      # Ensure old kiosk instance is not reused.
      local kiosk_pids
      kiosk_pids="$(pgrep -f "${KIOSK_PROFILE_DIR}" || true)"
      if [[ -n "${kiosk_pids}" ]]; then
        echo "${kiosk_pids}" | xargs -r kill 2>/dev/null || true
        sleep 1
        kiosk_pids="$(pgrep -f "${KIOSK_PROFILE_DIR}" || true)"
        if [[ -n "${kiosk_pids}" ]]; then
          echo "${kiosk_pids}" | xargs -r kill -9 2>/dev/null || true
        fi
      fi

      # Run in kiosk mode so users cannot exit fullscreen with F11.
      "${browser}" \
        --user-data-dir="${KIOSK_PROFILE_DIR}" \
        --new-window \
        --kiosk \
        --lang=zh-CN \
        --password-store=basic \
        --disable-features=LockProfileCookieDatabase \
        --use-fake-ui-for-media-stream \
        --autoplay-policy=no-user-gesture-required \
        --noerrdialogs \
        --no-first-run \
        --disable-session-crashed-bubble \
        --disable-infobars \
        "${LAUNCH_URL}" >/dev/null 2>&1 &
      ;;
    firefox-esr|firefox)
      "${browser}" --new-window --kiosk "${LAUNCH_URL}" >/dev/null 2>&1 &
      ;;
    *)
      "${browser}" --new-window "${LAUNCH_URL}" >/dev/null 2>&1 &
      ;;
  esac
}

prefer_microphone_input_if_available
start_server
if ! wait_for_server_ready; then
  echo "Open-LLM-VTuber server did not become ready within 60 seconds."
  echo "Please check log: ${SERVER_LOG}"
  exit 1
fi

launch_browser_fullscreen
