const DEFAULT_TITLE = "العربي للخدمات السياحية";

type FaviconVersion = string | number | Date | null | undefined;

export const FIXED_FAVICON_VERSION = "999999";
export const FIXED_FAVICON_HREF = `/favicon.png?v=${FIXED_FAVICON_VERSION}`;
export const FIXED_MANIFEST_HREF = `/manifest.json?v=${FIXED_FAVICON_VERSION}`;

const FAVICON_CACHE_PATTERNS = [
  "favicon",
  "apple-touch",
  "icon-",
  "manifest.",
  "company-icon",
  "company-assets/icons",
  "lovable",
];

const FIXED_LINKS = [
  { rel: "icon", href: FIXED_FAVICON_HREF },
  { rel: "shortcut icon", href: FIXED_FAVICON_HREF },
  { rel: "apple-touch-icon", href: FIXED_FAVICON_HREF },
  { rel: "manifest", href: FIXED_MANIFEST_HREF },
] as const;

function versionValue(updatedAt: FaviconVersion): string {
  if (updatedAt instanceof Date) return updatedAt.toISOString();
  const value = String(updatedAt || "").trim();
  return value || String(Date.now());
}

function stripVersionParam(url: string): string {
  if (!url || url.startsWith("data:")) return url;
  try {
    const parsed = new URL(url, window.location.origin);
    parsed.searchParams.delete("v");
    return parsed.toString();
  } catch {
    return url.replace(/([?&])v=[^&#]*/g, "$1").replace(/[?&]$/, "");
  }
}

export function withFaviconVersion(iconUrl: string, updatedAt: FaviconVersion): string {
  if (!iconUrl) return "";
  if (iconUrl.startsWith("data:")) return iconUrl;
  const base = stripVersionParam(iconUrl);
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}v=${encodeURIComponent(versionValue(updatedAt))}`;
}

function shouldRemoveLink(link: HTMLLinkElement): boolean {
  const rel = (link.getAttribute("rel") || "").toLowerCase();
  const href = (link.getAttribute("href") || "").toLowerCase();
  const relTokens = rel.split(/\s+/).filter(Boolean);
  return relTokens.some((token) => token === "icon" || token === "apple-touch-icon" || token === "manifest")
    || FAVICON_CACHE_PATTERNS.some((pattern) => href.includes(pattern.toLowerCase()));
}

export function removeExistingFaviconLinks() {
  if (typeof document === "undefined") return;
  document.querySelectorAll<HTMLLinkElement>('link[rel]').forEach((link) => {
    if (shouldRemoveLink(link)) link.remove();
  });
}

function appendFixedFaviconLinks() {
  if (typeof document === "undefined") return;
  const head = document.head || document.querySelector("head");
  if (!head) return;

  FIXED_LINKS.forEach(({ rel, href }) => {
    const link = document.createElement("link");
    link.rel = rel;
    link.href = href;
    link.setAttribute("data-fixed-favicon", "true");
    head.appendChild(link);
  });
}

async function clearCachedFaviconEntries() {
  if (typeof window === "undefined") return;

  try {
    if ("caches" in window) {
      const names = await window.caches.keys();
      await Promise.all(names.map(async (name) => {
        const cache = await window.caches.open(name);
        const requests = await cache.keys();
        await Promise.all(requests.map((request) => {
          const clean = stripVersionParam(request.url).toLowerCase();
          return FAVICON_CACHE_PATTERNS.some((pattern) => clean.includes(pattern.toLowerCase()))
            ? cache.delete(request)
            : Promise.resolve(false);
        }));
      }));
    }
  } catch {}

  try {
    const registrations = await navigator.serviceWorker?.getRegistrations?.();
    await Promise.all((registrations || []).map(async (registration) => {
      registration.active?.postMessage({ type: "CLEAR_FAVICON_CACHE" });
      registration.waiting?.postMessage({ type: "CLEAR_FAVICON_CACHE" });
      registration.installing?.postMessage({ type: "CLEAR_FAVICON_CACHE" });
      await registration.unregister?.();
    }));
  } catch {}
}

export function enforceFixedFavicon(companyName?: string) {
  if (typeof document === "undefined") return;
  removeExistingFaviconLinks();
  appendFixedFaviconLinks();
  if (companyName) document.title = companyName || DEFAULT_TITLE;
}

export function getFaviconBootScript() {
  return `(() => {
    const patterns = ${JSON.stringify(FAVICON_CACHE_PATTERNS)};
    const fixedLinks = ${JSON.stringify(FIXED_LINKS)};
    const stripVersion = (url) => {
      try {
        const parsed = new URL(url, window.location.origin);
        parsed.searchParams.delete('v');
        return parsed.toString().toLowerCase();
      } catch {
        return String(url || '').replace(/([?&])v=[^&#]*/g, '$1').replace(/[?&]$/, '').toLowerCase();
      }
    };
    const isIconLink = (link) => {
      const rel = (link.getAttribute('rel') || '').toLowerCase().split(/\s+/);
      const href = stripVersion(link.getAttribute('href') || '');
      return rel.includes('icon') || rel.includes('apple-touch-icon') || rel.includes('manifest') || patterns.some((pattern) => href.includes(pattern.toLowerCase()));
    };
    document.querySelectorAll('link[rel]').forEach((link) => {
      if (isIconLink(link)) link.remove();
    });
    fixedLinks.forEach(({ rel, href }) => {
      const link = document.createElement('link');
      link.rel = rel;
      link.href = href;
      link.setAttribute('data-fixed-favicon', 'true');
      document.head.appendChild(link);
    });
    if ('caches' in window) {
      caches.keys().then((names) => Promise.all(names.map(async (name) => {
        const cache = await caches.open(name);
        const requests = await cache.keys();
        await Promise.all(requests.map((request) => {
          const clean = stripVersion(request.url);
          return patterns.some((pattern) => clean.includes(pattern.toLowerCase())) ? cache.delete(request) : Promise.resolve(false);
        }));
      }))).catch(() => {});
    }
    navigator.serviceWorker?.getRegistrations?.().then((registrations) => Promise.all((registrations || []).map((registration) => registration.unregister?.()))).catch(() => {});
    const img = new Image();
    img.src = '${FIXED_FAVICON_HREF}&preload=1';
  })();`;
}

export async function applyFavicon(_iconUrl?: string, _updatedAt?: FaviconVersion, companyName?: string): Promise<void> {
  await clearCachedFaviconEntries();
  enforceFixedFavicon(companyName);
}