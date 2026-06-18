# Task 10 Avatar Card Click Fix Verification

Date: 2026-05-21

## Scope

- Fix stage avatar card selection on touch devices.
- Cover both frame-sequence avatar cards and Live2D model cards.

## Root Cause

The settings drawer supports drag-to-scroll. Avatar cards were visually clickable but did not declare themselves as interactive elements. The drag-scroll hook skips pointer capture for interactive elements such as `[role="button"]`, so non-interactive avatar card containers could be intercepted by the parent scroll layer on touch input.

## Change

- `frontend-source/src/renderer/src/components/sidebar/setting/stage.tsx`
  - Added `role="button"` and `tabIndex={0}` to frame-sequence avatar cards.
  - Added keyboard activation for Enter and Space.
  - Added the same interaction attributes to Live2D model cards.

## Verification

- Local build:
  - `npm run build:web`
  - Passed.
- Remote deployment:
  - Uploaded updated `stage.tsx`.
  - Deployed new `dist/web`.
  - Remote page now references `main-BgPuiXcc.js`.
- Browser verification:
  - Opened `http://192.168.100.203:12393/`.
  - Settings -> 舞台 -> Live2D:
    - Clicked `shizuku`; `lastSelectedLive2dModelName` became `shizuku`, and the card showed `使用中`.
  - Settings -> 舞台 -> 帧序列:
    - Clicked `默认形象`; `avatarMode` became `avatarpack`, `avatarPackId` became `default_avatarpack`, and the card showed `使用中`.
    - Clicked `李白`; `avatarMode` stayed `avatarpack`, `avatarPackId` became `pack_2d95a84bc9_3`, and the card showed `使用中`.

## User Validation Items

- On the Raspberry Pi touch screen, open Settings -> 舞台.
- Tap a frame-sequence card and confirm it becomes `使用中`.
- Tap a Live2D card and confirm it becomes `使用中`.
- Confirm the visible character changes on the stage.
