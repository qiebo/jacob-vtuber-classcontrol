# Task 7 Stage Card Fixes Verification

Date: 2026-05-21

## Scope

- Fix stage avatar card switching.
- Replace stage background dropdown with touch-friendly background cards.
- Keep background cards partially visible in the current area and vertically scrollable.

## Changes

- `frontend-source/src/renderer/src/components/sidebar/setting/stage.tsx`
  - Live2D card activation now immediately switches frontend avatar mode to `live2d`.
  - Removed the extra `request-init-config` sent after Live2D selection to avoid stale config racing back over the new selection.
  - Background selection now uses thumbnail cards instead of a dropdown.
  - Background card selection immediately updates `selectedBgUrl`, clears custom background URL, disables camera background, and writes the resolved background URL into `BgUrlContext`.
  - Background card area is capped at `424px` and scrolls vertically with `touchAction: pan-y`.

## Verification

- Local build:
  - `npm run build:web`
  - Passed.
- Remote deployment:
  - Uploaded new `dist/web` to `yb@192.168.100.203:/home/yb/Open-LLM-VTuber/frontend-source/dist/web`.
  - Uploaded updated `stage.tsx` source to the same project.
  - Restarted remote server.
- Remote service check:
  - `pgrep -af run_server.py` returned the running server process.
  - `curl -fsS http://127.0.0.1:12393/` now references `main-BfVxdhrd.js`.
- Browser check:
  - Opened `http://192.168.100.203:12393/`.
  - Settings -> 舞台 shows background image cards instead of a dropdown.
  - Background card scroll container measured `clientHeight=424`, `scrollHeight=1122`, `overflowY=auto`.
  - Clicking `cityscape.jpeg` changed the visible canvas background URL to `/bg/cityscape.jpeg`.
  - Clicking `ceiling-window-room-night.jpeg` changed it back to `/bg/ceiling-window-room-night.jpeg`.

## User Validation Items

- Open `http://192.168.100.203:12393/`.
- Settings -> 舞台 -> 舞台角色形象:
  - Tap a frame-sequence card and confirm the character switches.
  - Tap a Live2D card and confirm the app switches into Live2D mode and the selected model is shown.
- Settings -> 舞台 -> 舞台背景:
  - Confirm background images are shown as cards.
  - Confirm only part of the card list is visible and the card area can scroll vertically.
  - Tap a background card and confirm the stage background changes immediately.
