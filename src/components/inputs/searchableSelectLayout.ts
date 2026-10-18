type Anchor = { left: number; right: number; top: number; bottom: number; width: number };

/** Keep portalled menus inside the viewport even when a table scrolls horizontally. */
export function searchableSelectLayout(
  anchor: Anchor,
  viewportWidth: number,
  viewportHeight: number,
  direction: "rtl" | "ltr",
  minWidth = 0,
) {
  const margin = 8;
  const gap = 4;
  const width = Math.min(Math.max(anchor.width, minWidth), Math.max(0, viewportWidth - margin * 2));
  const preferredLeft = direction === "rtl" ? anchor.right - width : anchor.left;
  const left = Math.max(margin, Math.min(preferredLeft, viewportWidth - margin - width));
  const below = Math.max(0, viewportHeight - margin - anchor.bottom - gap);
  const above = Math.max(0, anchor.top - gap - margin);
  const openAbove = below < 240 && above > below;
  const maxHeight = Math.min(320, openAbove ? above : below);
  // Translate by the actual menu height, so short lists stay next to the field too.
  const top = openAbove ? anchor.top - gap : anchor.bottom + gap;
  const transform = openAbove ? "translateY(-100%)" : undefined;
  return { left, top, width, maxHeight, direction, transform };
}
