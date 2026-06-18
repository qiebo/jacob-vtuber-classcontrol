# Task 8 Volcengine TTS Setup Verification

Date: 2026-05-21

## Scope

- Test the provided Volcengine TTS credentials on the Raspberry Pi.
- Configure the digital human app to use Volcengine TTS.
- Replace the Volcengine voice cards with ordinary `BV..._streaming` voices that match the enabled package.

## Findings

- The original BigTTS voice IDs such as `zh_female_wanwanxiaohe_moon_bigtts` returned HTTP 403 with `requested resource not granted`.
- The ordinary TTS voice `BV001_streaming` generated a valid MP3 with the provided App ID and Access Token.
- The active runtime config is `/home/yb/Open-LLM-VTuber/conf.yaml`.

## Changes

- Remote `conf.yaml`
  - `tts_model: volcengine_tts`
  - `volcengine_tts.appid`: configured
  - `volcengine_tts.access_token`: configured
  - `volcengine_tts.cluster: volcano_tts`
  - `volcengine_tts.voice: BV001_streaming`
  - `volcengine_tts.speed_ratio: 1.0`
- `frontend-source/src/renderer/src/components/sidebar/setting/tts.tsx`
  - 火山 TTS cards now show ordinary `BV..._streaming` voices.
  - Default Volcengine voice is `BV001_streaming`.
- `src/open_llm_vtuber/config_manager/tts.py`
  - Default Volcengine voice changed to `BV001_streaming`.
- `src/open_llm_vtuber/tts/volcengine_tts.py`
  - Default and fallback voice changed to `BV001_streaming`.

## Verification

- Local checks:
  - `python -m py_compile src/open_llm_vtuber/config_manager/tts.py src/open_llm_vtuber/tts/volcengine_tts.py`
  - `npm run build:web`
- Remote deployment:
  - Uploaded updated frontend source and backend TTS source.
  - Deployed `dist/web`, now serving `main-Dwlq1bZR.js`.
  - Restarted `run_server.py`.
- Remote synthesis tests:
  - Direct credential test generated `cache/volcengine_credential_test_BV001_streaming.mp3`.
  - Config-based test generated `cache/volcengine_config_verify.mp3`, size `71040` bytes.
- Browser check:
  - Settings -> 声音 shows `火山 TTS`.
  - 火山音色 cards include `BV001_streaming`, `BV002_streaming`, `BV003_streaming`, `BV004_streaming`, `BV005_streaming`, `BV006_streaming`, `BV007_streaming`, `BV700_V2_streaming`.

## Notes

- The provided Access Token is not stored in this document.
- BigTTS cards were removed from the user-facing Volcengine list because the current package rejected those voice IDs.
