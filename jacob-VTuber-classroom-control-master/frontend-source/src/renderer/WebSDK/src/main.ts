// @ts-nocheck
/* eslint-disable no-underscore-dangle */
/**
 * Copyright(c) Live2D Inc. All rights reserved.
 *
 * Use of this source code is governed by the Live2D Open Software license
 * that can be found at https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html.
 */

import { LAppDelegate } from "./lappdelegate";
import * as LAppDefine from "./lappdefine";
import { LAppGlManager } from "./lappglmanager";
import { LAppLive2DManager } from "./lapplive2dmanager";

/**
 * Initialize the Live2D application
 */
export function initializeLive2D(): void {
  console.log(
    "Initializing Live2D with resourcePath:",
    LAppDefine.ResourcesPath
  );
  console.log("Model directories:", LAppDefine.ModelDir);

  const existingDelegate = (window as any).__live2dDelegateInitialized;
  const currentCanvas = document.getElementById("canvas") as HTMLCanvasElement | null;
  const trackedCanvas = (window as any).__live2dCanvasRef as HTMLCanvasElement | null | undefined;
  const canvasReplaced = !!trackedCanvas && trackedCanvas !== currentCanvas;

  if (existingDelegate && !canvasReplaced) {
    try {
      const manager = LAppLive2DManager.getInstance();
      manager.releaseAllModel();
      manager.changeScene(0);
      LAppDelegate.getInstance().onResize();
      return;
    } catch (error) {
      console.warn("Failed to switch Live2D model, falling back to full initialization:", error);
      LAppLive2DManager.releaseInstance();
    }
  }

  if (canvasReplaced || existingDelegate) {
    console.log(
      "Live2D canvas changed or full re-init requested, releasing previous SDK instances",
    );
    try {
      LAppLive2DManager.releaseInstance();
    } catch (error) {
      console.warn("Failed to release Live2D manager:", error);
    }
    try {
      LAppDelegate.releaseInstance();
    } catch (error) {
      console.warn("Failed to release Live2D delegate:", error);
    }
    try {
      LAppGlManager.releaseInstance();
    } catch (error) {
      console.warn("Failed to release Live2D GL manager:", error);
    }
    (window as any).__live2dDelegateInitialized = false;
  }

  if (
    !LAppGlManager.getInstance() ||
    !LAppDelegate.getInstance().initialize()
  ) {
    console.error("Failed to initialize Live2D");
    return;
  }

  (window as any).__live2dDelegateInitialized = true;
  (window as any).__live2dCanvasRef = currentCanvas;
  LAppDelegate.getInstance().run();

  (window as any).getLive2DManager = () => LAppLive2DManager.getInstance();

  // Make sure LAppAdapter is available globally
  if (!(window as any).getLAppAdapter) {
    console.log('Setting up getLAppAdapter function');
    const { LAppAdapter } = require('./lappadapter');
    (window as any).getLAppAdapter = () => LAppAdapter.getInstance();
  }

  if ((window as any).api?.setIgnoreMouseEvent) {
    const parent = document.getElementById("live2d");

    parent?.addEventListener("pointermove", (e) => {
      const model = LAppLive2DManager.getInstance().getModel(0);
      const view = LAppDelegate.getInstance().getView();

      // Transform screen coordinates to Live2D canvas coordinates
      const x = view?._deviceToScreen.transformX(e.x);
      const y = view?._deviceToScreen.transformY(e.y);

      // Check if mouse is over the Live2D model
      (window as any).api.setIgnoreMouseEvent(!model?.anyhitTest(x, y) && !model?.isHitOnModel(x, y));
    });

    // Add pointerdown event listener
    parent?.addEventListener("pointerdown", (e) => {
      const model = LAppLive2DManager.getInstance().getModel(0);
      const view = LAppDelegate.getInstance().getView();

      // Transform screen coordinates to Live2D canvas coordinates
      const x = view?._deviceToScreen.transformX(e.x);
      const y = view?._deviceToScreen.transformY(e.y);

      // Test hit and log result
      const hitAreaName = model?.anyhitTest(x, y);
      const isHit = hitAreaName !== null || model?.isHitOnModel(x, y);
      console.log("Model clicked:", isHit, hitAreaName ? `in area: ${hitAreaName}` : '');
    });
  }
}

/**
 * Keep the original window.load handler for backwards compatibility
 * (for the standalone HTML file)
 */
/* // Comment out the window.load listener
window.addEventListener(
  "load",
  (): void => {
    initializeLive2D();
  },
  { passive: true }
);
*/

/**
 * 終了時の処理
 * 结束时的处理
 */
window.addEventListener(
  "beforeunload",
  (): void => LAppDelegate.releaseInstance(),
  { passive: true }
);

/**
 * Process when changing screen size.
 */
window.addEventListener(
  "resize",
  () => {
    if (LAppDefine.CanvasSize === "auto") {
      LAppDelegate.getInstance().onResize();
    }
  },
  { passive: true }
);

// Make the initialization function available globally
(window as any).initializeLive2D = initializeLive2D;
