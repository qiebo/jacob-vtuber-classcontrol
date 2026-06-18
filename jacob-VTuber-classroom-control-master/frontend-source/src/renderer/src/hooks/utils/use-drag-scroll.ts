import { useCallback, useRef } from 'react';

type DragAxis = 'x' | 'y' | 'both';

interface DragScrollOptions {
  axis?: DragAxis;
  skipInteractiveTargets?: boolean;
  stopPropagation?: boolean;
  threshold?: number;
}

const INTERACTIVE_SELECTOR = [
  'a',
  'button',
  'input',
  'textarea',
  'select',
  '[role="button"]',
  '[role="tab"]',
  '[role="tablist"]',
  '[role="switch"]',
  '[role="slider"]',
  '[contenteditable="true"]',
].join(',');

const shouldSkipTarget = (target: EventTarget | null): boolean => (
  target instanceof Element && Boolean(target.closest(INTERACTIVE_SELECTOR))
);

export function useDragScroll<T extends HTMLElement>({
  axis = 'y',
  skipInteractiveTargets = true,
  stopPropagation = false,
  threshold = 6,
}: DragScrollOptions = {}) {
  const ref = useRef<T | null>(null);
  const clearClickSuppressionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const state = useRef({
    pointerId: null as number | null,
    startX: 0,
    startY: 0,
    scrollLeft: 0,
    scrollTop: 0,
    isDragging: false,
    hasPointerCapture: false,
    suppressClick: false,
  });

  const canScrollX = axis === 'x' || axis === 'both';
  const canScrollY = axis === 'y' || axis === 'both';

  const onPointerDown = useCallback((event: React.PointerEvent<T>) => {
    if (stopPropagation) {
      event.stopPropagation();
    }

    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    if (skipInteractiveTargets && shouldSkipTarget(event.target)) {
      return;
    }

    const element = ref.current;
    if (!element) {
      return;
    }

    if (clearClickSuppressionTimer.current) {
      clearTimeout(clearClickSuppressionTimer.current);
      clearClickSuppressionTimer.current = null;
    }

    state.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: element.scrollLeft,
      scrollTop: element.scrollTop,
      isDragging: false,
      hasPointerCapture: false,
      suppressClick: false,
    };
  }, [skipInteractiveTargets, stopPropagation]);

  const onPointerMove = useCallback((event: React.PointerEvent<T>) => {
    if (stopPropagation) {
      event.stopPropagation();
    }

    const element = ref.current;
    const current = state.current;

    if (!element || current.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - current.startX;
    const deltaY = event.clientY - current.startY;
    const relevantDelta = canScrollY && !canScrollX ? deltaY : deltaX;

    if (!current.isDragging && Math.abs(relevantDelta) < threshold) {
      return;
    }

    if (!current.isDragging) {
      current.isDragging = true;
      element.setPointerCapture?.(event.pointerId);
      current.hasPointerCapture = true;
    }

    current.suppressClick = true;
    event.preventDefault();

    if (canScrollX) {
      element.scrollLeft = current.scrollLeft - deltaX;
    }

    if (canScrollY) {
      element.scrollTop = current.scrollTop - deltaY;
    }
  }, [canScrollX, canScrollY, stopPropagation, threshold]);

  const finishDrag = useCallback((event: React.PointerEvent<T>) => {
    if (stopPropagation) {
      event.stopPropagation();
    }

    const element = ref.current;
    const current = state.current;

    if (
      element
      && current.pointerId === event.pointerId
      && current.hasPointerCapture
    ) {
      element.releasePointerCapture?.(event.pointerId);
    }

    state.current.pointerId = null;
    state.current.isDragging = false;
    state.current.hasPointerCapture = false;

    if (state.current.suppressClick) {
      clearClickSuppressionTimer.current = setTimeout(() => {
        state.current.suppressClick = false;
        clearClickSuppressionTimer.current = null;
      }, 250);
    }
  }, [stopPropagation]);

  const onClickCapture = useCallback((event: React.MouseEvent<T>) => {
    if (!state.current.suppressClick) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    state.current.suppressClick = false;
  }, []);

  return {
    ref,
    onPointerDown,
    onPointerMove,
    onPointerUp: finishDrag,
    onPointerCancel: finishDrag,
    onClickCapture,
  };
}
