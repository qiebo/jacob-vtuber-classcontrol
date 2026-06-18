# Task 15 - Volcengine TTS Truncation Fix

## Problem

- On the Raspberry Pi, AI response text was complete, but TTS playback often stopped after the first part of the answer.
- The UI still showed later text, which indicated the LLM stream and subtitle display were not the primary failure point.

## Root Cause

- The backend splits AI replies into sentence-level TTS tasks.
- `TTSTaskManager` generated sentence audio tasks in parallel.
- The active Volcengine TTS package has a low request concurrency quota.
- Recent Raspberry Pi logs showed:
  - `Volcengine TTS HTTP 429`
  - `quota exceeded for types: concurrency`
- When one sentence-level synthesis request failed, the frontend still received the display text for that segment but no audio, so playback sounded truncated.

## Change

- Updated `src/open_llm_vtuber/tts/tts_interface.py`.
  - Added `max_concurrent_generations()`.
  - Default remains `4` for backward compatibility.
- Updated `src/open_llm_vtuber/tts/volcengine_tts.py`.
  - Volcengine now reports `max_concurrent_generations() == 1`.
  - Added an internal request lock to serialize calls even across concurrent conversation paths.
  - Added short retries for HTTP `429`.
- Updated `src/open_llm_vtuber/conversations/tts_manager.py`.
  - TTS generation now uses an engine-specific semaphore before calling `async_generate_audio`.
  - Ordered delivery behavior is unchanged.

## Verification

- Local syntax check:
  - `python -m py_compile src/open_llm_vtuber/tts/tts_interface.py src/open_llm_vtuber/tts/volcengine_tts.py src/open_llm_vtuber/conversations/tts_manager.py`
  - Passed.
- Remote syntax check on Raspberry Pi:
  - `venv/bin/python -m py_compile ...`
  - Passed.
- Remote Volcengine TTS serial test:
  - Launched three sentence audio generations through `TTSTaskManager`.
  - Result: `VOLCENGINE_TTS_SERIAL_TEST OK count 3`
  - Generated three audio files successfully.
- Remote service restart:
  - `run_server.py` is running.
  - `http://127.0.0.1:12393/` is reachable.

## User Validation

- Pending Raspberry Pi validation.
- Ask the digital human for an answer with 3 or more short sentences.
- Confirm every displayed sentence is also spoken.
- Watch logs for absence of new `Volcengine TTS HTTP 429` errors during the test.
