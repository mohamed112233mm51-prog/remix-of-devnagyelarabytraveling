// Global click-and-drag horizontal scrolling (Airtable/Notion/Figma-style).
// Attaches a single set of listeners; auto-detects the nearest horizontally
// scrollable ancestor of the mousedown target, but skips interactive elements.

const INTERACTIVE_SELECTOR = [
  "input",
  "textarea",
  "select",
  "button",
  "a",
  "label",
  "summary",
  "option",
  "[contenteditable=''] ",
  "[contenteditable='true']",
  "[role='button']",
  "[role='link']",
  "[role='checkbox']",
  "[role='radio']",
  "[role='switch']",
  "[role='menuitem']",
  "[role='option']",
  "[role='tab']",
  "[role='combobox']",
  "[role='listbox']",
  "[role='slider']",
  "[data-no-drag-scroll]",
].join(",");

function findHorizontallyScrollable(el: Element | null): HTMLElement | null {
  let node: Element | null = el;
  while (node && node !== document.body) {
    if (node instanceof HTMLElement) {
      const style = window.getComputedStyle(node);
      const overflowX = style.overflowX;
      const canScroll =
        (overflowX === "auto" || overflowX === "scroll" || overflowX === "overlay") &&
        node.scrollWidth > node.clientWidth + 1;
      if (canScroll) return node;
    }
    node = node.parentElement;
  }
  return null;
}

let installed = false;

export function installDragScroll() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  let container: HTMLElement | null = null;
  let startX = 0;
  let startScrollLeft = 0;
  let dragging = false;
  let moved = false;
  const THRESHOLD = 4; // px before we consider it a drag (keeps clicks working)
  let prevCursor = "";
  let prevUserSelect = "";

  const onMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) return; // left button only
    const target = e.target as Element | null;
    if (!target) return;
    // Skip interactive elements — allow their native behavior (clicks, selection, etc.)
    if (target.closest(INTERACTIVE_SELECTOR)) return;
    // Skip if user is selecting text inside a text-bearing element
    const scrollable = findHorizontallyScrollable(target);
    if (!scrollable) return;

    container = scrollable;
    startX = e.clientX;
    startScrollLeft = scrollable.scrollLeft;
    dragging = true;
    moved = false;
    prevCursor = scrollable.style.cursor;
    prevUserSelect = scrollable.style.userSelect;
  };

  const onMouseMove = (e: MouseEvent) => {
    if (!dragging || !container) return;
    const dx = e.clientX - startX;
    if (!moved) {
      if (Math.abs(dx) < THRESHOLD) return;
      moved = true;
      container.style.cursor = "grabbing";
      container.style.userSelect = "none";
    }
    // In RTL, scrollLeft direction is inverted in some browsers, but we mirror
    // exact mouse movement: dragging right shows content to the right.
    container.scrollLeft = startScrollLeft - dx;
  };

  const endDrag = () => {
    if (!dragging) return;
    if (container) {
      container.style.cursor = prevCursor;
      container.style.userSelect = prevUserSelect;
    }
    // Suppress the click that follows a real drag so buttons/rows don't fire
    if (moved) {
      const suppress = (ev: MouseEvent) => {
        ev.stopPropagation();
        ev.preventDefault();
        window.removeEventListener("click", suppress, true);
      };
      window.addEventListener("click", suppress, true);
    }
    dragging = false;
    moved = false;
    container = null;
  };

  window.addEventListener("mousedown", onMouseDown, true);
  window.addEventListener("mousemove", onMouseMove, true);
  window.addEventListener("mouseup", endDrag, true);
  window.addEventListener("mouseleave", endDrag, true);
  window.addEventListener("blur", endDrag);
}
