const DEFAULT_TITLE = "العربي للخدمات السياحية";

export const FIXED_FAVICON_VERSION = "2026";
export const FIXED_FAVICON_HREF = `/agent-egypt-icon.png?v=${FIXED_FAVICON_VERSION}`;
export const FIXED_MANIFEST_HREF = `/manifest.json?v=${FIXED_FAVICON_VERSION}`;

const FIXED_LINKS = [
  { rel: "icon", href: FIXED_FAVICON_HREF },
  { rel: "shortcut icon", href: FIXED_FAVICON_HREF },
  { rel: "apple-touch-icon", href: FIXED_FAVICON_HREF },
  { rel: "manifest", href: FIXED_MANIFEST_HREF },
] as const;

export function withFaviconVersion(_iconUrl?: string, _updatedAt?: unknown): string {
  return FIXED_FAVICON_HREF;
}

export function removeExistingFaviconLinks() {
  if (typeof document === "undefined") return;
  document.querySelectorAll<HTMLLinkElement>('link[rel]').forEach((link) => {
    const rel = (link.getAttribute("rel") || "").toLowerCase();
    const tokens = rel.split(/\s+/).filter(Boolean);
    if (tokens.some((t) => t === "icon" || t === "apple-touch-icon" || t === "manifest")) {
      link.remove();
    }
  });
}

function appendFixedFaviconLinks() {
  if (typeof document === "undefined") return;
  const head = document.head;
  if (!head) return;
  FIXED_LINKS.forEach(({ rel, href }) => {
    const link = document.createElement("link");
    link.rel = rel;
    link.href = href;
    link.setAttribute("data-fixed-favicon", "true");
    head.appendChild(link);
  });
}

export function enforceFixedFavicon(companyName?: string) {
  if (typeof document === "undefined") return;
  removeExistingFaviconLinks();
  appendFixedFaviconLinks();
  if (companyName) document.title = companyName || DEFAULT_TITLE;
}

export function getFaviconBootScript() {
  return `(() => {
    const fixedLinks = ${JSON.stringify(FIXED_LINKS)};
    document.querySelectorAll('link[rel]').forEach((link) => {
      const rel = (link.getAttribute('rel') || '').toLowerCase().split(/\\s+/);
      if (rel.includes('icon') || rel.includes('apple-touch-icon') || rel.includes('manifest')) {
        link.remove();
      }
    });
    fixedLinks.forEach(({ rel, href }) => {
      const link = document.createElement('link');
      link.rel = rel;
      link.href = href;
      link.setAttribute('data-fixed-favicon', 'true');
      document.head.appendChild(link);
    });
  })();`;
}

export async function applyFavicon(_iconUrl?: string, _updatedAt?: unknown, companyName?: string): Promise<void> {
  enforceFixedFavicon(companyName);
}
