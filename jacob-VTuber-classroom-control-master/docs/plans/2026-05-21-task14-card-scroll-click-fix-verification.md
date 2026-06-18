# Task 14 - Card Scroll and Tap Selection Fix Verification

## Scope

- Fix the regression where background and voice cards could scroll by touch but could no longer be selected by tapping.
- Preserve touch dragging inside fixed-height card lists.

## Root Cause

- Nested scroll containers used `useDragScroll` with `skipInteractiveTargets: false`.
- The hook captured the pointer on `pointerdown`, even for a normal tap.
- On the Raspberry Pi touch screen, that could route the final click to the scroll container instead of the card, so card `onClick` did not run.
- The drag threshold was also too low for finger taps, so small finger jitter could be treated as a drag.

## Change

- Updated `frontend-source/src/renderer/src/hooks/utils/use-drag-scroll.ts`.
  - Pointer capture now starts only after movement exceeds the drag threshold.
  - Normal taps no longer capture the pointer.
  - Pointer capture is released only when it was actually acquired.
- Updated `frontend-source/src/renderer/src/components/sidebar/setting/stage.tsx`.
  - Background card list keeps nested drag scrolling.
  - Inner drag threshold increased to `16px`.
- Updated `frontend-source/src/renderer/src/components/sidebar/setting/tts.tsx`.
  - Voice card list keeps nested drag scrolling.
  - Inner drag threshold increased to `16px`.

## Verification

- Local frontend build:
  - `npm run build:web`
  - Passed.
- Deployed frontend bundle to Raspberry Pi:
  - `main-DSEuoWrL.js`
- Remote service check:
  - `run_server.py` is running.
  - `http://127.0.0.1:12393/` references `main-DSEuoWrL.js`.
- Browser verification:
  - Tapping `cityscape.jpeg` background card changed the visible background URL to `/bg/cityscape.jpeg`.
  - Tapping `活力女声` voice card selected `BV005_streaming`; selected border became cyan and the check icon appeared.
  - Dragging the voice list still changed `scrollTop` from `0` to `260`.

## User Validation

- Pending Raspberry Pi touch-screen validation.
- Validation path:
  - In stage background cards, tap a card and confirm it selects.
  - In stage background cards, drag vertically and confirm it scrolls.
  - In Volcengine voice cards, tap a voice and confirm it selects.
  - In Volcengine voice cards, drag vertically and confirm it scrolls.
