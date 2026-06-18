# Task 4 Voice Cards Verification

## Scope

- Reworked the `声音` settings page so common voices are shown as large two-column touch cards.
- Kept the TTS engine selector at the top.
- Kept manual voice input and speed input.
- Collapsed advanced engine JSON behind a touch-sized button.
- Preserved the existing WebSocket `request-tts-config` / `update-tts-config` flow.

## Verification

- Local frontend build: `npm run build:web` passed.
- Remote Raspberry Pi IP: `192.168.100.203`.
- Remote frontend asset in use: `main-Ck_xNAp3.js`.
- Remote service restarted and `http://192.168.100.203:12393/` returned `200`.
- Browser verified `Edge TTS`, `Aliyun TTS`, and `Volcengine TTS` show different voice card lists.
- Browser verified Volcengine cards include category labels and long voice IDs without using the old dropdown list.

## Evidence

- Screenshot: `docs/baseline/task4-voice-cards-volcengine.png`.

## Notes

- Volcengine credentials are still validated before auto-save, so switching to an unconfigured provider does not push an invalid backend config.
- The visible console errors during verification are existing runtime/audio-resource noise and did not block the settings UI.
