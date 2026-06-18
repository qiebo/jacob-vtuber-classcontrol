# Task 9 Volcengine Voice Expansion Verification

Date: 2026-05-21

## Scope

- Test whether children and dialect Volcengine ordinary TTS voices are available with the current package.
- Expand the user-facing Volcengine voice cards while keeping the list curated.
- Keep the visible options balanced across female, male, children, and dialect voices.

## Remote Voice Test

The test called the Volcengine API directly without using the app fallback voice, so unsupported voices were not counted as successful by accident.

Result: 23 of 25 tested voices succeeded.

Failed:

- `BV003_streaming`
- `BV029_streaming`

Selected into UI:

- Female: `BV001_streaming`, `BV005_streaming`, `BV007_streaming`, `BV034_streaming`
- Male: `BV002_streaming`, `BV004_streaming`, `BV006_streaming`, `BV700_V2_streaming`, `BV033_streaming`
- Children: `BV051_streaming`, `BV064_streaming`, `BV061_streaming`
- Dialect: `BV021_streaming`, `BV020_streaming`, `BV210_streaming`, `BV217_streaming`, `BV213_streaming`, `BV025_streaming`, `BV026_streaming`, `BV424_streaming`, `BV019_streaming`, `BV216_streaming`

## Changes

- `frontend-source/src/renderer/src/components/sidebar/setting/tts.tsx`
  - Expanded Volcengine voice cards to include selected female, male, children, and dialect voices.
  - Removed unsupported `BV003_streaming` and `BV029_streaming`.

## Verification

- Local frontend build:
  - `npm run build:web`
  - Passed.
- Remote deployment:
  - Uploaded updated `tts.tsx`.
  - Deployed new `dist/web`.
  - Remote page now references `main-D7JFB1dQ.js`.
- Remote source check:
  - Confirmed children and dialect voice card entries exist.
  - Confirmed unsupported `BV003_streaming` and `BV029_streaming` are not present.

## User Validation Items

- Open `http://192.168.100.203:12393/`.
- Go to Settings -> 声音 -> 火山 TTS.
- Confirm the card list includes 普通女声, 普通男声, 儿童音色, and 方言音色.
- Select a few children/dialect voices and test conversation playback.
