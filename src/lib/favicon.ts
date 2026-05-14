const DEFAULT_TITLE = "العربي للخدمات السياحية";

export const FIXED_FAVICON_VERSION = "2026-final";
export const FIXED_FAVICON_HREF = `/agent-egypt-icon.png?v=${FIXED_FAVICON_VERSION}`;
export const FIXED_SHORTCUT_HREF = `/favicon.ico?v=${FIXED_FAVICON_VERSION}`;
export const FIXED_MANIFEST_HREF = `/manifest.json?v=${FIXED_FAVICON_VERSION}`;

export function withFaviconVersion(_iconUrl?: string, _updatedAt?: unknown): string {
  return FIXED_FAVICON_HREF;
}

export function enforceFixedFavicon(companyName?: string) {
  if (typeof document === "undefined") return;
  if (companyName) document.title = companyName || DEFAULT_TITLE;
}

export function getFaviconBootScript() {
  return `console.info('favicon-debug', Array.from(document.querySelectorAll('link[rel*=icon]')).map((link) => ({ rel: link.getAttribute('rel'), href: link.getAttribute('href') })));`;
}

export async function applyFavicon(_iconUrl?: string, _updatedAt?: unknown, companyName?: string): Promise<void> {
  enforceFixedFavicon(companyName);
}
