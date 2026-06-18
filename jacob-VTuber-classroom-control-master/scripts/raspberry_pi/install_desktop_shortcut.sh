#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
LAUNCH_SCRIPT="${PROJECT_DIR}/scripts/raspberry_pi/start_vtuber_fullscreen.sh"
ICON_PATH="${PROJECT_DIR}/frontend-source/resources/icon.png"

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

DESKTOP_FILE="${DESKTOP_DIR}/翼生涯桌面数智人.desktop"

chmod +x "${LAUNCH_SCRIPT}"

cat >"${DESKTOP_FILE}" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=翼生涯桌面数智人
Comment=Launch Open-LLM-VTuber teaching mode
Exec=${LAUNCH_SCRIPT}
Icon=${ICON_PATH}
Terminal=false
Categories=Education;
StartupNotify=true
EOF

chmod +x "${DESKTOP_FILE}"
rm -f "${DESKTOP_DIR}/Stop-Open-LLM-VTuber.desktop"

if command -v gio >/dev/null 2>&1; then
  gio set "${DESKTOP_FILE}" metadata::trusted true >/dev/null 2>&1 || true
fi

echo "Desktop shortcut created:"
echo "${DESKTOP_FILE}"
