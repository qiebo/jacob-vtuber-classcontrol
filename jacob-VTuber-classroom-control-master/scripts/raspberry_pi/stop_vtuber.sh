#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
CONF_FILE="${OPEN_LLM_VTUBER_CONF:-${PROJECT_DIR}/conf.yaml}"
DELAY_SECONDS="${1:-0}"
KIOSK_PROFILE_DIR="${PROJECT_DIR}/.kiosk-profile"

if [[ "${DELAY_SECONDS}" != "0" ]]; then
  sleep "${DELAY_SECONDS}"
fi

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

# Stop backend server
RUN_SERVER_PIDS="$(pgrep -f '[r]un_server.py' || true)"
if [[ -n "${RUN_SERVER_PIDS}" ]]; then
  echo "${RUN_SERVER_PIDS}" | xargs -r kill 2>/dev/null || true
  sleep 1
  RUN_SERVER_PIDS_2="$(pgrep -f '[r]un_server.py' || true)"
  if [[ -n "${RUN_SERVER_PIDS_2}" ]]; then
    echo "${RUN_SERVER_PIDS_2}" | xargs -r kill -9 2>/dev/null || true
  fi
fi

# Stop browser windows opened for this project URL
VTUBER_BROWSER_PIDS="$(
  ps -eo pid=,args= \
    | awk -v port="${PORT}" '/\/usr\/lib\/chromium\/chromium|chromium-browser|google-chrome|firefox/ {if (index($0, ":" port "/") || index($0, ":" port " ")) print $1}'
)"

if [[ -n "${VTUBER_BROWSER_PIDS}" ]]; then
  echo "${VTUBER_BROWSER_PIDS}" | xargs -r kill 2>/dev/null || true
  sleep 1
  VTUBER_BROWSER_PIDS_2="$(
    ps -eo pid=,args= \
      | awk -v port="${PORT}" '/\/usr\/lib\/chromium\/chromium|chromium-browser|google-chrome|firefox/ {if (index($0, ":" port "/") || index($0, ":" port " ")) print $1}'
  )"
  if [[ -n "${VTUBER_BROWSER_PIDS_2}" ]]; then
    echo "${VTUBER_BROWSER_PIDS_2}" | xargs -r kill -9 2>/dev/null || true
  fi
fi

# Also stop kiosk browser instances by profile path (more reliable than URL matching)
KIOSK_BROWSER_PIDS="$(pgrep -f "${KIOSK_PROFILE_DIR}" || true)"
if [[ -n "${KIOSK_BROWSER_PIDS}" ]]; then
  echo "${KIOSK_BROWSER_PIDS}" | xargs -r kill 2>/dev/null || true
  sleep 1
  KIOSK_BROWSER_PIDS_2="$(pgrep -f "${KIOSK_PROFILE_DIR}" || true)"
  if [[ -n "${KIOSK_BROWSER_PIDS_2}" ]]; then
    echo "${KIOSK_BROWSER_PIDS_2}" | xargs -r kill -9 2>/dev/null || true
  fi
fi

echo "Open-LLM-VTuber has been stopped."
