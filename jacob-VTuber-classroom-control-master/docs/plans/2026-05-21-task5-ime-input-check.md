# Task 5 IME Input Check

## Finding

- Raspberry Pi has `fcitx5` running and locale is `zh_CN.UTF-8`.
- `fcitx5-diagnose` reports missing input method environment variables:
  - `XMODIFIERS`
  - `QT_IM_MODULE`
  - `GTK_IM_MODULE`
- The browser process checked over SSH only exposed `LANG` / `LANGUAGE`, not the Fcitx environment variables.

## Fixes Applied

- Frontend settings panel no longer applies global `user-select: none` to the full panel.
- Non-selectable behavior is scoped to buttons, tabs, and card controls.
- `性格` page text fields explicitly declare Chinese text input metadata.
- Raspberry Pi fullscreen launch script now exports Fcitx environment variables before starting Chromium/Firefox kiosk.

## Verification

- `npm run build:web` passed.
- Deployed frontend bundle `main-6aEy20jl.js` to `192.168.100.203`.
- Synced `scripts/raspberry_pi/start_vtuber_fullscreen.sh` to the Raspberry Pi.
- Remote script passes `bash -n`.

## Note

- Existing browser windows must be closed and relaunched through `scripts/raspberry_pi/start_vtuber_fullscreen.sh` for the new Fcitx environment to take effect.
- Real IME switching still needs Raspberry Pi local touch/keyboard validation because browser automation cannot simulate the Fcitx candidate window.
