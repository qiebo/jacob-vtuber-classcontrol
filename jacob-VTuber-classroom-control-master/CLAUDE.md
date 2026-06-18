# CLAUDE.md

This file is for Claude Code to deploy and maintain this customized project quickly.

## 1. Goal
Deploy a working classroom-ready system on Raspberry Pi with:
- backend running on `127.0.0.1:12393`
- web UI accessible locally
- desktop shortcut for kiosk fullscreen launch

## 2. Mandatory Rules
- Reuse existing virtual env first (`venv` > `.venv`).
- Do not remove user data directories: `chat_history/`, `knowledge_base/`, `live2d-models/`, `backgrounds/`.
- Preserve existing credentials in `conf.yaml`.

## 3. Standard Deployment Steps
```bash
cd ~/Open-LLM-VTuber
git pull --ff-only

if [ -f venv/bin/activate ]; then
  source venv/bin/activate
elif [ -f .venv/bin/activate ]; then
  source .venv/bin/activate
else
  python3 -m venv .venv
  source .venv/bin/activate
fi

pip install -U pip
pip install -r requirements.txt
python run_server.py
```

## 4. Smoke Tests
Run in another shell:
```bash
curl -fsS http://127.0.0.1:12393/
curl -fsS http://127.0.0.1:12393/knowledge/files
```

## 5. Desktop Launcher Setup
```bash
bash scripts/raspberry_pi/install_desktop_shortcut.sh
```
Expected desktop shortcut: `翼生涯桌面数智人.desktop`.

## 6. Stop
Preferred: click "Exit Project" in web UI.
Fallback:
```bash
bash scripts/raspberry_pi/stop_vtuber.sh
```

## 7. Reference Docs
- `AGENTS.md`
- `DEPLOYMENT.md`
- `README.CN.md`
