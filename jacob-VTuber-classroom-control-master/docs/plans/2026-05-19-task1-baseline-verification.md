# Task 1 Baseline Verification

Date: 2026-05-19

## Local project

- Workspace: `E:\Debian_canvas\jacob-VTuber-ui-redesign`
- Frontend source: `frontend-source`
- Framework: Electron + React + TypeScript + Vite
- Local Node: `v24.13.0`
- Local npm: `11.6.2`

## Frontend commands

Run from `frontend-source`:

```bash
npm ci
npm run build:web
```

Known baseline issue:

```bash
npm run typecheck
```

fails on existing TypeScript errors, mostly in `src/renderer/WebSDK`. This is a baseline condition and not caused by the UI redesign work.

## Raspberry Pi target

- Host: `192.168.100.24`
- SSH user: `yb`
- Hostname: `raspberrypi`
- Project path: `/home/yb/Open-LLM-VTuber`
- Runtime URL: `http://192.168.100.24:12393/`
- Server config: `0.0.0.0:12393`
- Frontend dist on Pi: `/home/yb/Open-LLM-VTuber/frontend-source/dist/web`

## Runtime baseline

Backend startup command used on the Pi:

```bash
cd /home/yb/Open-LLM-VTuber
source venv/bin/activate
nohup python run_server.py > logs/codex_baseline_server.log 2>&1 < /dev/null &
```

Health checks passed:

```bash
curl -fsS http://127.0.0.1:12393/
curl -fsS http://192.168.100.24:12393/
```

Observed server process:

```text
python run_server.py
```

## Baseline screenshots

- `docs/baseline/task1-baseline-stage-192.168.100.24.png`
- `docs/baseline/task1-baseline-stage-waited-192.168.100.24.png`

Observed UI baseline:

- Page loads through LAN and WebSocket connection is established.
- Current screen can show `当前人物形象资源可播放故障` on the stage.
- This should be treated as existing runtime/device data state, not a UI redesign regression.

## Deployment caution

The Pi working tree has many existing local modifications and untracked files. Do not reset or overwrite the Pi repository during UI development. Deploy only the intended frontend build artifacts or apply a controlled patch after each approved task.
