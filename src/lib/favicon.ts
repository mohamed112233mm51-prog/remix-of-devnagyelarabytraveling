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

export async function applyFavicon(iconUrl?: string, updatedAt?: FaviconVersion, companyName?: string): Promise<void> {
  if (typeof document === "undefined") return;
  const runId = ++applyRun;
  document.title = companyName || DEFAULT_TITLE;
  const cleanIconUrl = stripVersionParam(String(iconUrl || "").trim());
  await clearCachedFaviconEntries(cleanIconUrl);
  if (runId !== applyRun) return;

  // Prefer the actual uploaded icon URL (data: URL or storage URL) for link hrefs.
  // Static paths like /favicon.png are served by Vite/Workers from public/ before
  // our request handler runs, which would re-serve the bundled default icon.
  const hasCustom = Boolean(cleanIconUrl);
  const customHref = hasCustom ? withFaviconVersion(cleanIconUrl, updatedAt) : "";
  const customType = hasCustom ? detectIconType(cleanIconUrl) : "image/png";

  const pngHref = hasCustom ? customHref : staticAssetHref(STATIC_FAVICON_PATHS.png, updatedAt);
  const icoHref = hasCustom ? customHref : staticAssetHref(STATIC_FAVICON_PATHS.ico, updatedAt);
  const appleHref = hasCustom ? customHref : staticAssetHref(STATIC_FAVICON_PATHS.apple, updatedAt);
  const icon192Href = hasCustom ? customHref : staticAssetHref(STATIC_FAVICON_PATHS.icon192, updatedAt);
  const icon512Href = hasCustom ? customHref : staticAssetHref(STATIC_FAVICON_PATHS.icon512, updatedAt);
  const pngType = hasCustom ? customType : "image/png";
  const icoType = hasCustom ? customType : "image/x-icon";

  removeExistingFaviconLinks();
  const add = (rel: string, href: string, sizes?: string, type?: string) => {
    const link = document.createElement("link");
    link.rel = rel;
    if (type) link.type = type;
    if (sizes) link.setAttribute("sizes", sizes);
    link.href = href;
    link.setAttribute("data-runtime-branding", "true");
    document.head.appendChild(link);
  };

  add("icon", pngHref, "32x32", pngType);
  add("icon", icoHref, undefined, icoType);
  add("shortcut icon", icoHref, undefined, icoType);
  add("icon", pngHref, "16x16", pngType);
  add("icon", pngHref, "48x48", pngType);
  add("icon", icon192Href, "192x192", pngType);
  add("icon", icon512Href, "512x512", pngType);
  add("apple-touch-icon", appleHref, "180x180", pngType);
  add("apple-touch-icon", icon192Href, "192x192", pngType);
  add("apple-touch-icon", icon512Href, "512x512", pngType);
  updateRuntimeManifest(updatedAt);
  console.log("Active favicon:", document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.href);
}
