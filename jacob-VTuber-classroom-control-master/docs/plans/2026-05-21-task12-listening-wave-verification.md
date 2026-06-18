# Task 12 - Listening Wave Verification

## Scope

- Add a dynamic listening wave to the subtitle area.
- The wave appears only when the app detects user speech and enters `listening` state.
- The wave should not be a fixed static waveform.

## Change

- Updated `frontend-source/src/renderer/src/components/canvas/subtitle.tsx`.
  - Added `ListeningWave`.
  - Bound display to `useAiState().isListening`.
  - Added animated bars with different heights, durations, and phase offsets.
  - Kept the subtitle area mounted during listening even when no subtitle text exists yet.
- Updated `frontend-source/src/renderer/src/components/canvas/canvas-styles.tsx`.
  - Added listening wave pill, dot, bars, and text styles.
  - Positioned the wave at the top-left of the subtitle module without covering subtitle text.

## Verification

- Local frontend build:
  - `npm run build:web`
  - Passed.
- Deployed frontend bundle to Raspberry Pi:
  - `main-i4xMM2IT.js`
- Remote service check:
  - `run_server.py` is running.
  - `http://127.0.0.1:12393/` references `main-i4xMM2IT.js`.
- Remote source check:
  - `subtitle.tsx` contains `isListening && <ListeningWave />`.
  - Empty subtitle guard now allows rendering while `isListening` is true.
  - `canvas-styles.tsx` contains listening wave style definitions.
- Browser check through local SSH tunnel:
  - Opened `http://localhost:12394/`.
  - No new frontend errors from this change.

## User Validation

- Pending Raspberry Pi touch-screen and microphone validation.
- Validation path:
  - Open the app on the Raspberry Pi local browser.
  - Speak to trigger user speech detection.
  - Confirm a dynamic wave appears at the subtitle area's top-left.
  - Stop speaking and confirm the active wave disappears when the state leaves listening.
