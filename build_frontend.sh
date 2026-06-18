#!/usr/bin/env bash
set -euo pipefail
cd ~/Open-LLM-VTuber/frontend-source
npm config set registry https://registry.npmmirror.com
echo "registry=$(npm config get registry)"
if [ -d node_modules ]; then
  echo "node_modules exists, npm ci will refresh it"
else
  echo "no node_modules"
fi
npm ci
npm run build:web
ls -la dist/web/index.html
