import type { ImageSelectionRect } from "./statementImageSelection";

export type CropResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export type CropPoint = { x: number; y: number };

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(value, max));

/** Dragging anywhere on the image draws the first selection. */
export function drawCropSelection(start: CropPoint, current: CropPoint): ImageSelectionRect {
  return {
    x: Math.min(start.x, current.x),
    y: Math.min(start.y, current.y),
    w: Math.abs(current.x - start.x),
    h: Math.abs(current.y - start.y),
  };
}

/** Moving a crop selection must never allow any part to leave the source image. */
export function moveCropSelection(
  initial: ImageSelectionRect,
  dx: number, dy: number,
  imageWidth: number, imageHeight: number,
): ImageSelectionRect {
  return {
    ...initial,
    x: clamp(initial.x + dx, 0, Math.max(0, imageWidth - initial.w)),
    y: clamp(initial.y + dy, 0, Math.max(0, imageHeight - initial.h)),
  };
}

/** Eight independent mobile-sized edge/corner handles, with no corner-only restriction. */
export function resizeCropSelection(
  initial: ImageSelectionRect,
  handle: CropResizeHandle,
  dx: number, dy: number,
  imageWidth: number, imageHeight: number,
  minimumSize = 24,
): ImageSelectionRect {
  let left = initial.x;
  let top = initial.y;
  let right = initial.x + initial.w;
  let bottom = initial.y + initial.h;
  const minWidth = Math.min(minimumSize, initial.w);
  const minHeight = Math.min(minimumSize, initial.h);

  if (handle.includes("w")) left = clamp(left + dx, 0, right - minWidth);
  if (handle.includes("e")) right = clamp(right + dx, left + minWidth, imageWidth);
  if (handle.includes("n")) top = clamp(top + dy, 0, bottom - minHeight);
  if (handle.includes("s")) bottom = clamp(bottom + dy, top + minHeight, imageHeight);

  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** Preserve the same physical pixels if the user switches preview zoom. */
export function scaleCropSelection(
  initial: ImageSelectionRect,
  oldWidth: number,
  newWidth: number,
): ImageSelectionRect {
  if (oldWidth <= 0 || newWidth <= 0 || !Number.isFinite(oldWidth) || !Number.isFinite(newWidth))
    return initial;
  const scale = newWidth / oldWidth;
  return { x: initial.x * scale, y: initial.y * scale, w: initial.w * scale, h: initial.h * scale };
}
