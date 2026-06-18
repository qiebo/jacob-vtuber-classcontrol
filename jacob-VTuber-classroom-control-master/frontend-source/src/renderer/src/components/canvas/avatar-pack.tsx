import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Box, Image, Text } from "@chakra-ui/react";
import { keyframes } from "@emotion/react";
import { useAiState } from "@/context/ai-state-context";
import { useAvatarAppearance } from "@/context/avatar-appearance-context";
import { useLive2DConfig } from "@/context/live2d-config-context";
import { useWebSocket } from "@/context/websocket-context";
import { useMode } from "@/context/mode-context";
import { useForceIgnoreMouse } from "@/hooks/utils/use-force-ignore-mouse";
import {
  STAGE_SAFE_AREA_MAX_HEIGHT,
  STAGE_SAFE_AREA_MAX_WIDTH,
  STAGE_SAFE_AREA_SIDE_PADDING,
  STAGE_SAFE_AREA_TOP_BOTTOM_PADDING,
} from "./stage-safe-area";

type AvatarActionState = "thinking" | "speaking" | "listening" | "idle";

interface AvatarActionManifest {
  fps?: number;
  loop?: boolean;
  frames?: string[];
}

interface AvatarActionGroupManifest extends AvatarActionManifest {
  name?: string;
}

interface AvatarPackManifest {
  pack_id: string;
  name?: string;
  canvas?: {
    width?: number;
    height?: number;
  };
  anchor?: {
    x?: number;
    y?: number;
  };
  actions?: Record<string, AvatarActionManifest>;
  action_groups?: AvatarActionGroupManifest[];
  fallback_map?: Record<string, string>;
  layout?: {
    fit_height_ratio?: number;
    fit_width_ratio?: number;
    default_scale?: number;
  };
}

interface AvatarPackTransformState {
  scale: number;
  offset: {
    x: number;
    y: number;
  };
}

function getAvatarPackTransformStorageKey(packId: string) {
  return `avatarPackTransform:${packId}`;
}

function readAvatarPackTransform(packId: string): AvatarPackTransformState | null {
  if (typeof window === "undefined" || !packId) {
    return null;
  }

  try {
    const rawValue = window.localStorage.getItem(getAvatarPackTransformStorageKey(packId));
    if (!rawValue) {
      return null;
    }
    const parsedValue = JSON.parse(rawValue) as AvatarPackTransformState;
    if (
      typeof parsedValue?.scale !== "number"
      || typeof parsedValue?.offset?.x !== "number"
      || typeof parsedValue?.offset?.y !== "number"
    ) {
      return null;
    }
    return parsedValue;
  } catch (error) {
    console.error("Error reading avatar pack transform:", error);
    return null;
  }
}

function writeAvatarPackTransform(packId: string, transform: AvatarPackTransformState) {
  if (typeof window === "undefined" || !packId) {
    return;
  }

  try {
    window.localStorage.setItem(
      getAvatarPackTransformStorageKey(packId),
      JSON.stringify(transform),
    );
  } catch (error) {
    console.error("Error saving avatar pack transform:", error);
  }
}

const SCALE_MIN = 0.08;
const SCALE_MAX = 4;
const SCALE_STEP = 0.06;
const DEFAULT_SCALE_BUMP = SCALE_STEP * 7;
const DRAG_THRESHOLD = 4;
const DEFAULT_AVATAR_STAGE_HEIGHT_RATIO = 0.42;
const DEFAULT_AVATAR_STAGE_WIDTH_RATIO = 0.32;
const singleFrameFloatAnimation = keyframes`
  0% {
    transform: translate3d(0, 0px, 0) scale(1);
  }
  50% {
    transform: translate3d(0, -10px, 0) scale(1.012);
  }
  100% {
    transform: translate3d(0, 0px, 0) scale(1);
  }
`;

const stateActionCandidates: Record<AvatarActionState, string[]> = {
  thinking: ["thinking", "idle", "waiting"],
  speaking: ["speaking", "talk", "idle", "waiting"],
  listening: ["listening", "idle", "waiting"],
  idle: ["idle", "waiting"],
};

function getActionFrames(manifest: AvatarPackManifest | null, actionName: string): string[] {
  if (!manifest?.actions?.[actionName]?.frames) {
    return [];
  }
  const actionFrames = manifest.actions[actionName].frames;
  if (!Array.isArray(actionFrames)) {
    return [];
  }
  return actionFrames.filter((item) => typeof item === "string" && item.length > 0);
}

function resolveActionName(
  manifest: AvatarPackManifest | null,
  state: AvatarActionState,
): string {
  if (!manifest) {
    return "idle";
  }

  const fallbackMap = manifest.fallback_map || {};
  const queue = [...(stateActionCandidates[state] || ["idle", "waiting"])];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift() || "";
    if (!current || visited.has(current)) {
      continue;
    }
    const frames = getActionFrames(manifest, current);
    if (frames.length > 0) {
      return current;
    }
    visited.add(current);
    const fallback = fallbackMap[current];
    if (fallback && !visited.has(fallback)) {
      queue.push(fallback);
    }
  }

  if (getActionFrames(manifest, "idle").length > 0) {
    return "idle";
  }
  if (getActionFrames(manifest, "waiting").length > 0) {
    return "waiting";
  }

  const firstAvailable = Object.keys(manifest.actions || {}).find(
    (actionName) => getActionFrames(manifest, actionName).length > 0,
  );
  return firstAvailable || "idle";
}

function getActionGroups(manifest: AvatarPackManifest | null): AvatarActionGroupManifest[] {
  if (!manifest) {
    return [];
  }

  const manifestActionGroups = Array.isArray(manifest.action_groups)
    ? manifest.action_groups.filter(
      (group) => Array.isArray(group?.frames) && (group.frames?.length || 0) > 0,
    )
    : [];

  if (manifestActionGroups.length > 0) {
    return manifestActionGroups;
  }

  const legacyActionFrames = getActionFrames(manifest, "action");
  if (!legacyActionFrames.length) {
    return [];
  }

  return [{
    name: "action_01",
    fps: manifest.actions?.action?.fps,
    loop: manifest.actions?.action?.loop,
    frames: legacyActionFrames,
  }];
}

function resolveState(aiState: string, thinkingSpeakingPhase: string | null): AvatarActionState {
  if (aiState === "thinking-speaking") {
    return thinkingSpeakingPhase === "speaking" ? "speaking" : "thinking";
  }
  if (aiState === "listening") {
    return "listening";
  }
  return "idle";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export const AvatarPack = memo((): JSX.Element => {
  const { avatarPackId } = useAvatarAppearance();
  const { modelInfo } = useLive2DConfig();
  const { baseUrl } = useWebSocket();
  const { aiState, thinkingSpeakingPhase } = useAiState();
  const { mode } = useMode();
  const { forceIgnoreMouse } = useForceIgnoreMouse();
  const isPet = mode === "pet";
  const [manifest, setManifest] = useState<AvatarPackManifest | null>(null);
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  const [transientActionGroupName, setTransientActionGroupName] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string>("");
  const [isDragging, setIsDragging] = useState(false);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [stageSize, setStageSize] = useState(() => ({
    width: typeof window === "undefined" ? 1280 : window.innerWidth,
    height: typeof window === "undefined" ? 720 : window.innerHeight,
  }));
  const containerRef = useRef<HTMLDivElement>(null);
  const transformCacheRef = useRef<Record<string, AvatarPackTransformState>>({});
  const didApplyDefaultTransformRef = useRef<Record<string, boolean>>({});

  const dragRef = useRef({
    active: false,
    moved: false,
    pointerId: -1,
    startClientX: 0,
    startClientY: 0,
    startOffsetX: 0,
    startOffsetY: 0,
  });

  const pointerInteractive = modelInfo?.pointerInteractive !== false;
  const scrollToResize = modelInfo?.scrollToResize !== false;

  const normalizedBaseUrl = useMemo(
    () => (baseUrl || window.location.origin).replace(/\/+$/, ""),
    [baseUrl],
  );

  useEffect(() => {
    if (typeof window === "undefined" || !containerRef.current) {
      return undefined;
    }

    const updateStageSize = () => {
      const bounds = containerRef.current?.getBoundingClientRect();
      if (!bounds) {
        return;
      }
      const safeWidth = Math.min(
        Math.max(bounds.width - STAGE_SAFE_AREA_SIDE_PADDING, 240),
        STAGE_SAFE_AREA_MAX_WIDTH,
      );
      const safeHeight = Math.min(
        Math.max(bounds.height - STAGE_SAFE_AREA_TOP_BOTTOM_PADDING, 240),
        STAGE_SAFE_AREA_MAX_HEIGHT,
      );
      setStageSize({
        width: safeWidth,
        height: safeHeight,
      });
    };

    updateStageSize();
    const resizeObserver = new ResizeObserver(updateStageSize);
    resizeObserver.observe(containerRef.current);
    window.addEventListener("resize", updateStageSize);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateStageSize);
    };
  }, []);

  useEffect(() => {
    if (!avatarPackId) {
      setManifest(null);
      setLoadError("未选择帧序列人物形象。");
      return;
    }

    const controller = new AbortController();
    setLoadError("");
    setManifest(null);
    setCurrentFrameIndex(0);
    setTransientActionGroupName(null);

    const manifestUrl = `${normalizedBaseUrl}/avatar-packs/${avatarPackId}/manifest.json?t=${Date.now()}`;
    fetch(manifestUrl, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`manifest 请求失败: ${response.status}`);
        }
        const payload = (await response.json()) as AvatarPackManifest;
        setManifest(payload);
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          return;
        }
        setLoadError(`加载人物形象失败：${String(error)}`);
      });

    return () => {
      controller.abort();
    };
  }, [avatarPackId, normalizedBaseUrl]);

  const runtimeState = resolveState(aiState, thinkingSpeakingPhase);
  const resolvedActionName = resolveActionName(manifest, runtimeState);
  const availableActionGroups = useMemo(() => getActionGroups(manifest), [manifest]);
  const currentActionGroup = useMemo(
    () => availableActionGroups.find((group) => group.name === transientActionGroupName) || null,
    [availableActionGroups, transientActionGroupName],
  );

  const currentFrames = useMemo(() => {
    const rawFrames = currentActionGroup?.frames || getActionFrames(manifest, resolvedActionName);
    if (!rawFrames.length) {
      return [];
    }
    return rawFrames.map((framePath) => {
      if (/^https?:\/\//.test(framePath)) {
        return framePath;
      }
      const normalizedPath = framePath.startsWith("/") ? framePath.slice(1) : framePath;
      return `${normalizedBaseUrl}/avatar-packs/${avatarPackId}/${normalizedPath}`;
    });
  }, [currentActionGroup, manifest, resolvedActionName, normalizedBaseUrl, avatarPackId]);

  const actionMeta = currentActionGroup || manifest?.actions?.[resolvedActionName];
  const fps = Math.max(1, Number(actionMeta?.fps || 8));
  const shouldLoop = actionMeta?.loop !== false;
  const hasLoadedManifest = manifest !== null;
  const canvasWidth = Math.max(1, Number(manifest?.canvas?.width || 512));
  const canvasHeight = Math.max(1, Number(manifest?.canvas?.height || 512));
  const displayAnchorX = 0.5;
  const displayAnchorY = 0.5;
  const fitHeightRatio = clamp(
    Number(manifest?.layout?.fit_height_ratio ?? DEFAULT_AVATAR_STAGE_HEIGHT_RATIO),
    0.2,
    0.85,
  );
  const fitWidthRatio = clamp(
    Number(manifest?.layout?.fit_width_ratio ?? DEFAULT_AVATAR_STAGE_WIDTH_RATIO),
    0.2,
    0.85,
  );
  const scaleTuning = clamp(Number(manifest?.layout?.default_scale ?? 1), 0.3, 2);
  const defaultScale = useMemo(() => {
    if (!canvasHeight) {
      return 1;
    }
    const targetHeight = stageSize.height * fitHeightRatio;
    const targetWidth = stageSize.width * fitWidthRatio;
    const scaleByHeight = targetHeight / canvasHeight;
    const scaleByWidth = targetWidth / canvasWidth;
    return clamp(
      Math.min(scaleByHeight, scaleByWidth) * scaleTuning + DEFAULT_SCALE_BUMP,
      SCALE_MIN,
      SCALE_MAX,
    );
  }, [canvasHeight, canvasWidth, fitHeightRatio, fitWidthRatio, scaleTuning, stageSize.height, stageSize.width]);

  useEffect(() => {
    if (!avatarPackId || !hasLoadedManifest) {
      return;
    }

    const cachedTransform = avatarPackId
      ? (transformCacheRef.current[avatarPackId] || readAvatarPackTransform(avatarPackId))
      : null;
    const shouldApplyDefaultTransform = avatarPackId
      ? !didApplyDefaultTransformRef.current[avatarPackId]
      : true;

    if (shouldApplyDefaultTransform) {
      setScale(defaultScale);
      setOffset({ x: 0, y: 0 });
      if (avatarPackId) {
        didApplyDefaultTransformRef.current[avatarPackId] = true;
      }
    }
    setIsDragging(false);
    dragRef.current = {
      active: false,
      moved: false,
      pointerId: -1,
      startClientX: 0,
      startClientY: 0,
      startOffsetX: 0,
      startOffsetY: 0,
    };
    if (cachedTransform && !shouldApplyDefaultTransform) {
      setScale(cachedTransform.scale);
      setOffset(cachedTransform.offset);
    }
  }, [avatarPackId, defaultScale, hasLoadedManifest]);

  useEffect(() => {
    if (!avatarPackId || !hasLoadedManifest) {
      return;
    }
    const nextTransform = {
      scale,
      offset,
    };
    transformCacheRef.current[avatarPackId] = nextTransform;
    writeAvatarPackTransform(avatarPackId, nextTransform);
  }, [avatarPackId, hasLoadedManifest, offset, scale]);

  useEffect(() => {
    setCurrentFrameIndex(0);
  }, [resolvedActionName, transientActionGroupName]);

  useEffect(() => {
    if (currentFrames.length === 0) {
      setCurrentFrameIndex(0);
      return undefined;
    }

    if (currentFrames.length <= 1) {
      if (currentFrames.length === 0) {
        setCurrentFrameIndex(0);
      }
      if (!shouldLoop && transientActionGroupName) {
        const timeoutId = window.setTimeout(() => {
          setTransientActionGroupName(null);
        }, Math.max(80, Math.round(1000 / fps)));
        return () => {
          window.clearTimeout(timeoutId);
        };
      }
      return undefined;
    }

    const intervalMs = Math.max(40, Math.round(1000 / fps));
    const timerId = window.setInterval(() => {
      setCurrentFrameIndex((prev) => {
        const next = prev + 1;
        if (next < currentFrames.length) {
          return next;
        }
        if (shouldLoop) {
          return 0;
        }
        if (transientActionGroupName) {
          window.setTimeout(() => {
            setTransientActionGroupName(null);
          }, 0);
        }
        return currentFrames.length - 1;
      });
    }, intervalMs);

    return () => {
      window.clearInterval(timerId);
    };
  }, [currentFrames, fps, shouldLoop, transientActionGroupName]);

  const currentFrame = currentFrames[currentFrameIndex] || currentFrames[0] || "";
  const hasActionFrames = availableActionGroups.length > 0;
  const shouldAnimateSingleFrame = currentFrames.length === 1;

  const triggerActionIfAvailable = () => {
    if (!hasActionFrames || !pointerInteractive || runtimeState !== "idle") {
      return;
    }
    const randomIndex = Math.floor(Math.random() * availableActionGroups.length);
    const nextActionGroup = availableActionGroups[randomIndex];
    if (!nextActionGroup?.name) {
      return;
    }
    setTransientActionGroupName(nextActionGroup.name);
    setCurrentFrameIndex(0);
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!scrollToResize) {
      return;
    }
    event.preventDefault();
    const direction = event.deltaY > 0 ? -1 : 1;
    setScale((prev) => clamp(prev + direction * SCALE_STEP, SCALE_MIN, SCALE_MAX));
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = {
      active: true,
      moved: false,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startOffsetX: offset.x,
      startOffsetY: offset.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active || dragRef.current.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - dragRef.current.startClientX;
    const deltaY = event.clientY - dragRef.current.startClientY;

    if (!dragRef.current.moved) {
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      if (distance > DRAG_THRESHOLD) {
        dragRef.current.moved = true;
        setIsDragging(true);
      }
    }

    if (!pointerInteractive || !dragRef.current.moved) {
      return;
    }

    setOffset({
      x: dragRef.current.startOffsetX + deltaX,
      y: dragRef.current.startOffsetY + deltaY,
    });
  };

  const finishPointerTracking = (
    event: React.PointerEvent<HTMLDivElement>,
    cancelled = false,
  ) => {
    if (!dragRef.current.active || dragRef.current.pointerId !== event.pointerId) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const shouldTriggerAction = !cancelled && !dragRef.current.moved;
    dragRef.current.active = false;
    dragRef.current.pointerId = -1;
    setIsDragging(false);

    if (shouldTriggerAction) {
      triggerActionIfAvailable();
    }
  };

  const handleContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!isPet) {
      return;
    }
    event.preventDefault();
    window.api?.showContextMenu?.();
  };

  if (loadError) {
    return (
      <Box
        w="100%"
        h="100%"
        display="flex"
        alignItems="center"
        justifyContent="center"
        bg="rgba(15, 23, 42, 0.42)"
        borderRadius="md"
      >
        <Text fontSize="sm" color="whiteAlpha.800" px={4} textAlign="center">
          {loadError}
        </Text>
      </Box>
    );
  }

  return (
    <Box
      ref={containerRef}
      w="100%"
      h="100%"
      position="relative"
      overflow="hidden"
      cursor={isDragging ? "grabbing" : "grab"}
      pointerEvents={isPet && forceIgnoreMouse ? "none" : "auto"}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(event) => finishPointerTracking(event)}
      onPointerCancel={(event) => finishPointerTracking(event, true)}
      onContextMenu={handleContextMenu}
    >
      {currentFrame ? (
        <Box
          position="absolute"
          left="50%"
          top="50%"
          width={`${canvasWidth}px`}
          height={`${canvasHeight}px`}
          maxW="100%"
          maxH="100%"
          transform={`translate(-50%, -50%) translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`}
          transformOrigin={`${displayAnchorX * 100}% ${displayAnchorY * 100}%`}
          pointerEvents="none"
        >
          <Box
            width="100%"
            height="100%"
            animation={shouldAnimateSingleFrame ? `${singleFrameFloatAnimation} 4.2s ease-in-out infinite` : "none"}
            transformOrigin={`${displayAnchorX * 100}% ${displayAnchorY * 100}%`}
          >
            <Image
              data-classroom-avatar="image"
              src={currentFrame}
              alt={manifest?.name || avatarPackId}
              width="100%"
              height="100%"
              objectFit="contain"
              userSelect="none"
              pointerEvents="none"
            />
          </Box>
        </Box>
      ) : (
        <Box
          w="100%"
          h="100%"
          display="flex"
          alignItems="center"
          justifyContent="center"
        >
          <Text fontSize="sm" color="whiteAlpha.700">
            当前人物形象没有可播放帧。
          </Text>
        </Box>
      )}
    </Box>
  );
});

AvatarPack.displayName = "AvatarPack";
