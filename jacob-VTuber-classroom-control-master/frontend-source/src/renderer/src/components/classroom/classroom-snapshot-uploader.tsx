import { useEffect, useRef } from "react";
import { useWebSocket } from "@/context/websocket-context";

// 低频缩略图（PRD T-5）：30s 间隔、320x180、JPEG 0.5，供教师端监控
const SNAPSHOT_WIDTH = 320;
const SNAPSHOT_HEIGHT = 180;
const SNAPSHOT_INTERVAL_MS = 30000;
const SNAPSHOT_QUALITY = 0.5;

function drawCover(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
) {
  const scale = Math.max(
    SNAPSHOT_WIDTH / sourceWidth,
    SNAPSHOT_HEIGHT / sourceHeight,
  );
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  context.drawImage(
    source,
    (SNAPSHOT_WIDTH - width) / 2,
    (SNAPSHOT_HEIGHT - height) / 2,
    width,
    height,
  );
}

async function buildSnapshot(): Promise<Blob | null> {
  const output = document.createElement("canvas");
  output.width = SNAPSHOT_WIDTH;
  output.height = SNAPSHOT_HEIGHT;
  const context = output.getContext("2d");
  if (!context) {
    return null;
  }

  context.fillStyle = "#0f172a";
  context.fillRect(0, 0, SNAPSHOT_WIDTH, SNAPSHOT_HEIGHT);

  const background = document.querySelector<HTMLImageElement>(
    '[data-classroom-background="image"]',
  );
  if (background?.complete && background.naturalWidth > 0) {
    drawCover(context, background, background.naturalWidth, background.naturalHeight);
  }

  const live2dCanvas = document.querySelector<HTMLCanvasElement>("#canvas");
  if (live2dCanvas?.width && live2dCanvas.height) {
    drawCover(context, live2dCanvas, live2dCanvas.width, live2dCanvas.height);
  } else {
    const avatar = document.querySelector<HTMLImageElement>(
      '[data-classroom-avatar="image"]',
    );
    if (avatar?.complete && avatar.naturalWidth > 0) {
      const maxWidth = SNAPSHOT_WIDTH * 0.72;
      const maxHeight = SNAPSHOT_HEIGHT * 0.94;
      const scale = Math.min(
        maxWidth / avatar.naturalWidth,
        maxHeight / avatar.naturalHeight,
      );
      const width = avatar.naturalWidth * scale;
      const height = avatar.naturalHeight * scale;
      context.drawImage(
        avatar,
        (SNAPSHOT_WIDTH - width) / 2,
        SNAPSHOT_HEIGHT - height,
        width,
        height,
      );
    }
  }

  return new Promise((resolve) => {
    output.toBlob(resolve, "image/jpeg", SNAPSHOT_QUALITY);
  });
}

export default function ClassroomSnapshotUploader(): null {
  const { baseUrl } = useWebSocket();
  const uploadingRef = useRef(false);

  useEffect(() => {
    const upload = async () => {
      if (uploadingRef.current || document.visibilityState !== "visible") {
        return;
      }
      uploadingRef.current = true;
      try {
        const snapshot = await buildSnapshot();
        if (!snapshot || snapshot.size > 1024 * 1024) {
          return;
        }
        const formData = new FormData();
        formData.append("file", snapshot, "snapshot.jpg");
        await fetch(`${baseUrl.replace(/\/+$/, "")}/classroom/snapshot`, {
          method: "POST",
          body: formData,
        });
      } catch (error) {
        console.debug("Classroom snapshot upload skipped:", error);
      } finally {
        uploadingRef.current = false;
      }
    };

    const intervalId = window.setInterval(upload, SNAPSHOT_INTERVAL_MS);
    upload();
    return () => window.clearInterval(intervalId);
  }, [baseUrl]);

  return null;
}
