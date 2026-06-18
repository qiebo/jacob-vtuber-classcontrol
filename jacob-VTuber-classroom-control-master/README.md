# Yuanbo Yishengya Digital Human Desktop

This repository is a deployment-focused customized edition of Open-LLM-VTuber for classroom and kiosk-style use.

It is intended to be understandable by both humans and coding agents:
- humans should be able to deploy a new device from this repo without reverse-engineering machine state
- agents should be able to distinguish between versioned project content and machine-local runtime configuration

Chinese guide: `README.CN.md`

## What This Repo Contains

Tracked in Git:
- backend code and frontend source
- deployment scripts under `scripts/raspberry_pi/`
- tracked character presets under `characters/`
- documentation for humans and agents

Not tracked in Git by default:
- `conf.yaml`
- API keys and credentials
- `.kiosk-profile/`
- downloaded ASR/TTS models under `models/`
- chat history, knowledge base, logs, temporary runtime state
- machine-specific audio, screen rotation, touch mapping, desktop autostart state

This distinction matters: cloning this repository gives you the correct codebase version, but not a fully personalized device state.

## Standard Deployment For A New Device

### 1. Clone the repository

```bash
git clone https://github.com/qiebo/jacob-VTuber.git ~/Open-LLM-VTuber
cd ~/Open-LLM-VTuber
```

### 2. Create or reuse a virtual environment

```bash
if [ -f venv/bin/activate ]; then
  source venv/bin/activate
elif [ -f .venv/bin/activate ]; then
  source .venv/bin/activate
else
  python3 -m venv .venv
  source .venv/bin/activate
fi
```

### 3. Install backend dependencies

```bash
pip install -U pip
pip install -r requirements.txt
```

### 4. Build the frontend

Do not skip this step on a fresh device.

The runtime prefers `frontend-source/dist/web`. If that directory does not exist, the app may fall back to older static frontend content and appear to be on an old UI version.

```bash
cd frontend-source
npm install
npm run build
cd ..
```

### 5. Prepare runtime configuration

Before first real use, check:
- `conf.yaml` exists and matches your target device
- LLM provider and API keys are configured
- ASR provider is configured
- if using local ASR, the required model files exist under `models/`
- browser microphone permission is granted on the target machine

### 6. Start the service

```bash
python run_server.py
```

Open: `http://127.0.0.1:12393`

## One-click Desktop Launcher

For Raspberry Pi or kiosk-style classroom deployment:

```bash
bash scripts/raspberry_pi/install_desktop_shortcut.sh
```

Desktop shortcut name: `翼生涯桌面数智人`

## Character Presets

Built-in and tracked presets are stored in `characters/`.

This repository now also tracks synchronized custom browser-created persona presets as YAML files, so they can be deployed to new devices through Git instead of depending on Chromium local storage only.

If you create a new persona only in the browser UI, it may exist only in browser local storage until you export or formalize it into a tracked YAML file.

## Operational Notes (Field-tested)

- Persona data can come from two layers: tracked YAML files under `characters/` and browser local storage under `.kiosk-profile/`.
- If backend YAML exists but personas are missing in UI, check or restore `.kiosk-profile` first.
- Prefer formalizing custom personas into `characters/custom_browser_persona_*.yaml` and commit them, so new devices do not depend on browser cache migration.
- Rebuild frontend after source updates: `cd frontend-source && npm install && npm run build`.
- Kiosk startup script now prefers USB microphone input automatically; if audio input is still missing, verify with `pactl list short sources` and set default source manually.
- Chromium keyring password popup is suppressed through kiosk launch flags (`--password-store=basic` and related options).
- Before pushing, run `git status -sb` to ensure no accidental submodule deletion (for example `frontend`) or temp files are included.

## Cloud Sync Quick Check

```bash
git fetch origin
git status -sb
git rev-parse HEAD
git rev-parse origin/main
```

When `HEAD` equals `origin/main` and working tree is clean, local and remote are aligned.

## Quick Health Checks

```bash
curl -fsS http://127.0.0.1:12393/
curl -fsS http://127.0.0.1:12393/knowledge/files
```

## Common Operations

Start:

```bash
python run_server.py
```

Stop:

```bash
bash scripts/raspberry_pi/stop_vtuber.sh
```

Fullscreen kiosk start:

```bash
bash scripts/raspberry_pi/start_vtuber_fullscreen.sh
```

## Docs For Agents And Operators

- `AGENTS.md`: general deployment contract for coding agents
- `CLAUDE.md`: Claude Code specific instructions
- `DEPLOYMENT.md`: fuller deployment manual
- `README.CN.md`: primary Chinese operator guide

## License

- Code: `LICENSE`
- Live2D assets: `LICENSE-Live2D.md`
