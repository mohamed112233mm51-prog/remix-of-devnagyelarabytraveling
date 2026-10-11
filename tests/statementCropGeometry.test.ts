import assert from "node:assert/strict";
import test from "node:test";
import {
  drawCropSelection, moveCropSelection, resizeCropSelection, scaleCropSelection,
  type CropResizeHandle,
} from "../src/lib/statementCropGeometry.ts";

const original = { x: 100, y: 80, w: 220, h: 150 };
const width = 600, height = 400;

test("initial drag supports both directions and leaves a positive rectangle", () => {
  assert.deepEqual(drawCropSelection({ x: 340, y: 260 }, { x: 40, y: 30 }), {
    x: 40, y: 30, w: 300, h: 230,
  });
  assert.deepEqual(drawCropSelection({ x: 40, y: 30 }, { x: 340, y: 260 }), {
    x: 40, y: 30, w: 300, h: 230,
  });
});

test("resize from any one of the four sides, independent of corners", () => {
  assert.deepEqual(resizeCropSelection(original, "w", -60, 0, width, height),
    { x: 40, y: 80, w: 280, h: 150 });
  assert.deepEqual(resizeCropSelection(original, "e", 100, 0, width, height),
    { x: 100, y: 80, w: 320, h: 150 });
  assert.deepEqual(resizeCropSelection(original, "n", 0, -50, width, height),
    { x: 100, y: 30, w: 220, h: 200 });
  assert.deepEqual(resizeCropSelection(original, "s", 0, 80, width, height),
    { x: 100, y: 80, w: 220, h: 230 });
});

test("all four corner handles stretch both axes and never touch the unrelated edges", () => {
  const expected: Record<CropResizeHandle, { x: number; y: number; w: number; h: number }> = {
    n: { x: 100, y: 40, w: 220, h: 190 },
    s: { x: 100, y: 80, w: 220, h: 190 },
    e: { x: 100, y: 80, w: 260, h: 150 },
    w: { x: 60, y: 80, w: 260, h: 150 },
    nw: { x: 60, y: 40, w: 260, h: 190 },
    ne: { x: 100, y: 40, w: 260, h: 190 },
    sw: { x: 60, y: 80, w: 260, h: 190 },
    se: { x: 100, y: 80, w: 260, h: 190 },
  };
  for (const handle of Object.keys(expected) as CropResizeHandle[]) {
    const dx = handle.includes("w") ? -40 : 40;
    const dy = handle.includes("n") ? -40 : 40;
    assert.deepEqual(resizeCropSelection(original, handle, dx, dy, width, height), expected[handle]);
  }
});

test("crop resize clamps to original image and respects minimum size", () => {
  assert.deepEqual(resizeCropSelection(original, "nw", -1000, -1000, width, height),
    { x: 0, y: 0, w: 320, h: 230 });
  assert.deepEqual(resizeCropSelection(original, "se", 1000, 1000, width, height),
    { x: 100, y: 80, w: 500, h: 320 });
  assert.deepEqual(resizeCropSelection(original, "w", 900, 0, width, height),
    { x: 296, y: 80, w: 24, h: 150 });
  assert.deepEqual(resizeCropSelection(original, "n", 0, 900, width, height),
    { x: 100, y: 206, w: 220, h: 24 });
});

test("dragging selection moves it without touching dimensions or escaping image", () => {
  assert.deepEqual(moveCropSelection(original, -1000, 1000, width, height),
    { x: 0, y: 250, w: 220, h: 150 });
  assert.deepEqual(moveCropSelection(original, 37, -15, width, height),
    { x: 137, y: 65, w: 220, h: 150 });
});

test("zoom changes preserve crop contents and survive returning to fit", () => {
  const scaled = scaleCropSelection(original, 600, 1800);
  assert.deepEqual(scaled, { x: 300, y: 240, w: 660, h: 450 });
  assert.deepEqual(scaleCropSelection(scaled, 1800, 600), original);
  assert.deepEqual(scaleCropSelection(original, 0, 600), original);
});
