#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
TOGGLE_SCRIPT="${PROJECT_DIR}/scripts/raspberry_pi/toggle_screen_orientation.sh"
ICON_PATH="${PROJECT_DIR}/frontend-source/resources/orientation-toggle-icon.svg"

DESKTOP_DIR=""
for candidate in "${HOME}/Desktop" "${HOME}/桌面"; do
  if [[ -d "${candidate}" ]]; then
    DESKTOP_DIR="${candidate}"
    break
  fi
done

if [[ -z "${DESKTOP_DIR}" ]]; then
  DESKTOP_DIR="${HOME}/Desktop"
  mkdir -p "${DESKTOP_DIR}"
fi

DESKTOP_FILE="${DESKTOP_DIR}/切换横竖屏.desktop"

chmod +x "${TOGGLE_SCRIPT}"

cat >"${DESKTOP_FILE}" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=切换横竖屏
Comment=Toggle display orientation between portrait and landscape
Exec=${TOGGLE_SCRIPT}
Icon=${ICON_PATH}
Terminal=false
Categories=Utility;
StartupNotify=true
EOF

chmod +x "${DESKTOP_FILE}"

if command -v gio >/dev/null 2>&1; then
  gio set "${DESKTOP_FILE}" metadata::trusted true >/dev/null 2>&1 || true
fi

echo "Desktop shortcut created:"
echo "${DESKTOP_FILE}"
