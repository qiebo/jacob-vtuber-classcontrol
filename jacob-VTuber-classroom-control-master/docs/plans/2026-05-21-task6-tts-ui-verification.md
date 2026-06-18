# Task 6 TTS UI and Provider Scope Verification

Date: 2026-05-21

## Scope

- Keep only Edge TTS and Volcengine TTS in the user-facing voice settings.
- Remove Aliyun TTS from active backend configuration and factory selection.
- Replace manual voice input and engine JSON editor with card-based voice selection.
- Keep TTS credentials and advanced engine parameters outside the touch UI.
- Replace speed text input with a touch-friendly slider.

## Changed Areas

- `frontend-source/src/renderer/src/components/sidebar/setting/tts.tsx`
  - TTS provider cards: Edge TTS, 火山 TTS.
  - Voice cards per selected provider.
  - Speed slider from `0.6x` to `1.5x`.
  - Edge speed is written as `rate`; Volcengine speed is written as `speed_ratio`.
- `src/open_llm_vtuber/config_manager/tts.py`
  - `TTSConfig.tts_model` now accepts only `edge_tts` and `volcengine_tts`.
  - `EdgeTTSConfig` supports `rate`.
- `src/open_llm_vtuber/tts/tts_factory.py`
  - Removed Aliyun TTS factory branch.
- `src/open_llm_vtuber/tts/edge_tts.py`
  - Passes `rate` into `edge_tts.Communicate`.
- `src/open_llm_vtuber/tts/aliyun_tts.py`
  - Removed from active source.

## Verification

- Local syntax check:
  - `python -m py_compile src/open_llm_vtuber/config_manager/tts.py src/open_llm_vtuber/config_manager/__init__.py src/open_llm_vtuber/tts/edge_tts.py src/open_llm_vtuber/tts/tts_factory.py`
- Local frontend build:
  - `npm run build:web`
- Local active-source scan:
  - `rg -n "aliyun_tts|Aliyun|阿里|DashScope|qwen3-tts" src frontend-source`
  - No matches.
- Remote deployment target:
  - `yb@192.168.100.203:/home/yb/Open-LLM-VTuber`
- Remote service check:
  - `pgrep -af run_server.py` returned the running server process.
  - `curl -fsS http://127.0.0.1:12393/` references `main-DcZZrLl9.js`.
- Remote backend validation:
  - `edge_tts` config validates.
  - `volcengine_tts` config validates.
  - `aliyun_tts` is rejected by `TTSConfig`.
- Remote active-code scan:
  - `src/open_llm_vtuber`, `frontend-source/src/renderer/src/components/sidebar/setting/tts.tsx`, and `dist/web` contain no active Aliyun TTS references.

## User Validation Items

- Open `http://192.168.100.203:12393/`.
- Enter settings -> 声音.
- Confirm only `Edge TTS` and `火山 TTS` are shown.
- Confirm 火山 TTS can be selected and its voice cards display.
- Confirm manual voice input and engine JSON editor are not visible.
- Confirm 语速 is adjusted by dragging the slider.
