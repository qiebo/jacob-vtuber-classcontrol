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

prefer_board_audio_devices() {
  # KICKPI-K7 / RK3576 uses PipeWire + WirePlumber and exposes the built-in
  # codec as rockchip-es8388. HDMI can otherwise become the default sink/source
  # after reboot or display hotplug, which makes browser microphone capture fail.
  local board_sink_name="alsa_output.platform-es8388-sound.HiFi__hw_rockchipes8388__sink"
  local board_source_name="alsa_input.platform-es8388-sound.HiFi__hw_rockchipes8388__source"

  if command -v wpctl >/dev/null 2>&1; then
    local board_sink_id=""
    local board_source_id=""
    local audio_device_id=""

    board_sink_id="$(
      wpctl status 2>/dev/null | awk '
        /Built-in Audio Headphones \+ Speaker/ {
          gsub(/[.*]/, "", $1)
          print $1
          exit
        }
      '
    )"
    board_source_id="$(
      wpctl status 2>/dev/null | awk '
        /Built-in Audio Headset Microphone \+ Internal Microphone/ {
          gsub(/[.*]/, "", $1)
          print $1
          exit
        }
      '
    )"

    # Disable display-audio devices so Chromium cannot restore playback to
    # HDMI/DP instead of the board speaker codec.
    while IFS= read -r audio_device_id; do
      if wpctl inspect "${audio_device_id}" 2>/dev/null | grep -Eq 'device.name = "alsa_card\.platform-(hdmi|dp0)-sound"'; then
        wpctl set-profile "${audio_device_id}" 0 >/dev/null 2>&1 || true
      fi
    done < <(
      wpctl status 2>/dev/null | awk '
        /^[[:space:]]*[0-9]+\./ {
          id=$1
          gsub(/[.*]/, "", id)
          print id
        }
      '
    )

    if [[ -n "${board_sink_id}" ]]; then
      wpctl set-default "${board_sink_id}" >/dev/null 2>&1 || true
      wpctl set-volume "${board_sink_id}" 1.00 >/dev/null 2>&1 || true
      echo "Preferred speaker sink: ${board_sink_name}"
    fi

    if [[ -n "${board_source_id}" ]]; then
      wpctl set-default "${board_source_id}" >/dev/null 2>&1 || true
      wpctl set-volume "${board_source_id}" 1.00 >/dev/null 2>&1 || true
      echo "Preferred microphone source: ${board_source_name}"
    fi

    if [[ -n "${board_sink_id}" || -n "${board_source_id}" ]]; then
      return
    fi
  fi

  if command -v pactl >/dev/null 2>&1; then
    pactl set-default-sink "${board_sink_name}" >/dev/null 2>&1 || true
    pactl set-sink-mute "${board_sink_name}" 0 >/dev/null 2>&1 || true
    pactl set-sink-volume "${board_sink_name}" 100% >/dev/null 2>&1 || true
    pactl set-default-source "${board_source_name}" >/dev/null 2>&1 || true
    pactl set-source-mute "${board_source_name}" 0 >/dev/null 2>&1 || true
    pactl set-source-volume "${board_source_name}" 100% >/dev/null 2>&1 || true
    echo "Preferred board audio devices via pactl"
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

prefer_board_audio_devices
start_server
if ! wait_for_server_ready; then
  echo "Open-LLM-VTuber server did not become ready within 60 seconds."
  echo "Please check log: ${SERVER_LOG}"
  exit 1
fi

launch_browser_fullscreen
