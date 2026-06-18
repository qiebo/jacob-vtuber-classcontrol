# Task 13 - Nested Card Scroll Fix Verification

## Scope

- Fix touch dragging inside fixed-height card lists.
- Affected areas:
  - Stage background cards.
  - TTS voice cards.

## Root Cause

- The settings drawer already supports custom drag scrolling.
- Background and voice card lists were native `overflow-y: auto` containers.
- On the Raspberry Pi touch screen, dragging on a card could be intercepted by the outer drawer or treated as a card tap instead of scrolling the inner list.

## Change

- Updated `frontend-source/src/renderer/src/hooks/utils/use-drag-scroll.ts`.
  - Added `stopPropagation` option.
  - Allows nested scroll containers to keep pointer drag events from bubbling to the drawer.
- Updated `frontend-source/src/renderer/src/components/sidebar/setting/stage.tsx`.
  - Applied nested drag scrolling to the background card list.
  - Uses `skipInteractiveTargets: false` so dragging can start from a card surface.
- Updated `frontend-source/src/renderer/src/components/sidebar/setting/tts.tsx`.
  - Applied nested drag scrolling to the voice card list.
  - Uses `skipInteractiveTargets: false` so dragging can start from a voice card surface.

## Verification

- Local frontend build:
  - `npm run build:web`
  - Passed.
- Deployed frontend bundle to Raspberry Pi:
  - `main-GRJKGbkj.js`
- Remote service check:
  - `run_server.py` is running.
  - `http://127.0.0.1:12393/` references `main-GRJKGbkj.js`.
- Browser touch-pointer simulation:
  - Background card list:
    - Container height: `424px`.
    - Content height: `1122px`.
    - Simulated touch drag changed `scrollTop` from `0` to `180`.
  - Voice card list:
    - Container height: `424px`.
    - Content height: `1401px`.
    - Simulated touch drag changed `scrollTop` from `0` to `240`.

## User Validation

- Pending Raspberry Pi touch-screen validation.
- Validation path:
  - Open settings -> stage -> background cards.
  - Drag vertically on a background card surface and confirm the card area scrolls.
  - Open settings -> voice -> Volcengine TTS voice cards.
  - Drag vertically on a voice card surface and confirm the card area scrolls.
  - Tap a card without dragging and confirm selection still works.
