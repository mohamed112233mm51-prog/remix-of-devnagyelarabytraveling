const MONTH_NAMES = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];

const STYLE_ID = "month-select-readable-styles";
const INSTALLED_KEY = "__monthSelectEnhancerInstalled";

function monthLabel(value: string): string | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) return null;
  return `${MONTH_NAMES[monthIndex]} ${match[1]}`;
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    select.month-select-readable {
      box-sizing: border-box !important;
      min-width: 184px !important;
      max-width: 100% !important;
      height: 40px !important;
      padding: 0 14px 0 36px !important;
      border: 1px solid #d9e0ea !important;
      border-radius: 11px !important;
      background-color: #fff !important;
      color: #172033 !important;
      font-family: inherit !important;
      font-size: 14px !important;
      font-weight: 700 !important;
      line-height: 1.4 !important;
      direction: rtl !important;
      text-align: right !important;
      white-space: nowrap !important;
      text-overflow: clip !important;
      box-shadow: 0 1px 2px rgba(15, 23, 42, .05) !important;
    }
    select.month-select-readable:focus {
      outline: none !important;
      border-color: #c9a227 !important;
      box-shadow: 0 0 0 3px rgba(212, 175, 55, .16) !important;
    }
    @media (max-width: 560px) {
      select.month-select-readable {
        width: min(100%, 220px) !important;
        min-width: 190px !important;
        flex: 1 1 190px !important;
        font-size: 13.5px !important;
      }
    }
  `;
  document.head.appendChild(style);
}

function enhanceSelect(select: HTMLSelectElement): void {
  const monthOptions = Array.from(select.options).filter((option) => monthLabel(option.value));
  if (monthOptions.length === 0) return;

  select.classList.add("month-select-readable");
  select.setAttribute("dir", "rtl");
  select.setAttribute("aria-label", select.getAttribute("aria-label") || "اختيار الشهر");

  for (const option of monthOptions) {
    const label = monthLabel(option.value);
    if (label) option.textContent = label;
  }

  const syncTitle = () => {
    const selected = select.selectedOptions[0];
    if (selected?.textContent) select.title = selected.textContent.trim();
  };
  syncTitle();

  if (select.dataset.monthEnhancerBound !== "1") {
    select.dataset.monthEnhancerBound = "1";
    select.addEventListener("change", syncTitle);
  }
}

function scan(root: ParentNode = document): void {
  if (root instanceof HTMLSelectElement) enhanceSelect(root);
  root.querySelectorAll?.("select").forEach((node) => enhanceSelect(node as HTMLSelectElement));
}

export function installMonthSelectEnhancer(): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const state = window as typeof window & { [INSTALLED_KEY]?: boolean };
  if (state[INSTALLED_KEY]) {
    scan();
    return;
  }
  state[INSTALLED_KEY] = true;

  ensureStyles();
  scan();

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (node instanceof HTMLElement) scan(node);
      });
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
