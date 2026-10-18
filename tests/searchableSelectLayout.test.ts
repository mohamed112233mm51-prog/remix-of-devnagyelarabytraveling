import assert from "node:assert/strict";
import test from "node:test";
import { searchableSelectLayout } from "../src/components/inputs/searchableSelectLayout.ts";

const anchor = { left: 700, right: 830, top: 100, bottom: 140, width: 130 };

test("RTL table dropdown expands towards the left while keeping its right edge anchored", () => {
  const menu = searchableSelectLayout(anchor, 1280, 800, "rtl", 260);
  assert.equal(menu.width, 260);
  assert.equal(menu.left + menu.width, anchor.right);
  assert.equal(menu.top, anchor.bottom + 4);
});

test("horizontal table scroll cannot push a dropdown past either viewport edge", () => {
  for (const left of [-100, 0, 8, 1100, 1220]) {
    for (const direction of ["rtl", "ltr"] as const) {
      const menu = searchableSelectLayout({ ...anchor, left, right: left + 130 }, 1280, 800, direction, 260);
      assert.ok(menu.left >= 8);
      assert.ok(menu.left + menu.width <= 1272);
    }
  }
});

test("narrow viewports cap menu width rather than cropping its contents", () => {
  const menu = searchableSelectLayout(anchor, 240, 800, "rtl", 260);
  assert.equal(menu.left, 8);
  assert.equal(menu.width, 224);
  assert.equal(menu.left + menu.width, 232);
});

test("dropdown opens above a row near the bottom and keeps all scrolling space on screen", () => {
  const low = { ...anchor, top: 650, bottom: 690 };
  const menu = searchableSelectLayout(low, 1280, 720, "rtl", 260);
  assert.equal(menu.top, low.top - 4);
  assert.equal(menu.transform, "translateY(-100%)");
  assert.equal(menu.maxHeight, 320);
  assert.ok(menu.top - menu.maxHeight >= 8);
});

test("short embedded previews reduce menu height to the available space", () => {
  const menu = searchableSelectLayout({ ...anchor, top: 50, bottom: 90 }, 390, 180, "rtl", 260);
  assert.equal(menu.top, 94);
  assert.equal(menu.maxHeight, 78);
  assert.ok(menu.top + menu.maxHeight <= 172);
});

test("wide form dropdowns retain their natural width; LTR remains left-aligned", () => {
  const wide = { ...anchor, left: 100, right: 700, width: 600 };
  const menu = searchableSelectLayout(wide, 1280, 800, "ltr");
  assert.equal(menu.width, 600);
  assert.equal(menu.left, 100);
});

test("zoomed or resized previews recompute menu bounds from current viewport dimensions", () => {
  for (const width of [320, 375, 768, 1024, 1366]) {
    for (const height of [240, 600, 768]) {
      const row = { left: width - 140.5, right: width - 10.25, width: 130.25, top: height - 70.5, bottom: height - 30.25 };
      const menu = searchableSelectLayout(row, width, height, "rtl", 260);
      assert.ok(menu.left >= 8);
      assert.ok(menu.left + menu.width <= width - 8);
      const top = menu.transform ? menu.top - menu.maxHeight : menu.top;
      assert.ok(top >= 8);
      assert.ok(top + menu.maxHeight <= height - 8);
    }
  }
});
