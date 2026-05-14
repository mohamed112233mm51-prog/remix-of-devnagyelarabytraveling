const DEFAULT_TITLE = "العربي للخدمات السياحية";

type FaviconVersion = string | number | Date | null | undefined;

const FAVICON_CACHE_PATTERNS = [
  "/favicon.ico",
  "/favicon.png",
  "/apple-touch-icon",
  "/icon-192",
  "/icon-512",
  "/manifest.json",
  "/manifest.webmanifest",
  "/site.webmanifest",
  "company-icon",
  "company-assets/icons",
  "favicon",
];

let applyRun = 0;

const STATIC_FAVICON_PATHS = {
  ico: "/favicon.ico",
  png: "/favicon.png",
  apple: "/apple-touch-icon.png",
  icon192: "/icon-192.png",
  icon512: "/icon-512.png",
  manifest: "/manifest.json",
} as const;

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

function staticAssetHref(path: string, updatedAt: FaviconVersion): string {
  return `${path}?v=${encodeURIComponent(versionValue(updatedAt))}`;
}

function detectIconType(iconUrl: string): string {
  if (iconUrl.startsWith("data:image/svg") || /\.svg(?:[?#]|$)/i.test(iconUrl)) return "image/svg+xml";
  if (iconUrl.startsWith("data:image/webp") || /\.webp(?:[?#]|$)/i.test(iconUrl)) return "image/webp";
  return "image/png";
}

function removeExistingFaviconLinks() {
  document.querySelectorAll<HTMLLinkElement>("link").forEach((el) => {
    const rel = (el.getAttribute("rel") || "").toLowerCase();
    const href = (el.getAttribute("href") || "").toLowerCase();
    const isIconRel = rel.split(/\s+/).some((token) => token === "icon" || token === "apple-touch-icon" || token === "apple-touch-icon-precomposed" || token === "mask-icon");
    const isStaleIconHref = FAVICON_CACHE_PATTERNS.some((pattern) => href.includes(pattern.toLowerCase())) || href.includes("lovable");
    if (isIconRel || isStaleIconHref) el.remove();
  });
}

function removeExistingManifestLinks() {
  document.querySelectorAll<HTMLLinkElement>('link[rel="manifest"]').forEach((el) => el.remove());
}

function preloadFreshIcon(iconUrl: string): Promise<void> {
  if (!iconUrl || iconUrl.startsWith("data:")) return Promise.resolve();
  return new Promise((resolve) => {
    const img = new Image();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      img.remove();
      resolve();
    };
    img.onload = finish;
    img.onerror = finish;
    img.style.cssText = "position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;left:-9999px;top:-9999px;";
    img.src = withFaviconVersion(iconUrl, Date.now());
    (document.body || document.documentElement).appendChild(img);
    window.setTimeout(finish, 1500);
  });
}

function updateRuntimeManifest(updatedAt?: FaviconVersion, iconUrl?: string, companyName?: string) {
  removeExistingManifestLinks();
  const link = document.createElement("link");
  link.rel = "manifest";
  link.setAttribute("data-runtime-branding", "true");
  if (iconUrl) {
    const versioned = withFaviconVersion(iconUrl, updatedAt);
    const type = detectIconType(iconUrl);
    const name = companyName || DEFAULT_TITLE;
    const manifest = {
      name,
      short_name: name,
      dir: "rtl",
      lang: "ar",
      start_url: "/",
      scope: "/",
      display: "standalone",
      icons: [
        { src: versioned, sizes: "any", type, purpose: "any" },
        { src: versioned, sizes: "192x192", type },
        { src: versioned, sizes: "512x512", type },
      ],
    };
    link.href = `data:application/manifest+json;charset=utf-8,${encodeURIComponent(JSON.stringify(manifest))}`;
  } else {
    link.href = staticAssetHref(STATIC_FAVICON_PATHS.manifest, updatedAt);
  }
  document.head.appendChild(link);
}

async function clearCachedFaviconEntries(iconUrl: string) {
  if (typeof window === "undefined") return;
  const absoluteIcon = iconUrl && !iconUrl.startsWith("data:") ? stripVersionParam(new URL(iconUrl, window.location.origin).toString()).toLowerCase() : "";
  const shouldDelete = (requestUrl: string) => {
    const clean = stripVersionParam(requestUrl).toLowerCase();
    return Boolean(absoluteIcon && clean === absoluteIcon) || FAVICON_CACHE_PATTERNS.some((pattern) => clean.includes(pattern.toLowerCase())) || clean.includes("lovable");
  };

  try {
    if ("caches" in window) {
      const names = await window.caches.keys();
      await Promise.all(names.map(async (name) => {
        const cache = await window.caches.open(name);
        const requests = await cache.keys();
        await Promise.all(requests.map((request) => shouldDelete(request.url) ? cache.delete(request) : Promise.resolve(false)));
      }));
    }
  } catch {}

  try {
    const registrations = await navigator.serviceWorker?.getRegistrations?.();
    registrations?.forEach((registration) => {
      registration.active?.postMessage({ type: "CLEAR_FAVICON_CACHE" });
      registration.waiting?.postMessage({ type: "CLEAR_FAVICON_CACHE" });
      registration.installing?.postMessage({ type: "CLEAR_FAVICON_CACHE" });
      void registration.unregister?.();
      void registration.update?.();
    });
  } catch {}
}

// Favicon is now a fixed system asset declared in src/routes/__root.tsx.
// This function is intentionally a no-op so legacy callers don't change runtime icons.
export async function applyFavicon(_iconUrl?: string, _updatedAt?: FaviconVersion, companyName?: string): Promise<void> {
  if (typeof document === "undefined") return;
  if (companyName) document.title = companyName || DEFAULT_TITLE;
}
