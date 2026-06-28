const APP_SESSION_KEYS = ["execution:fromSubmission", "executions:openId"];
const APP_LOCAL_KEYS = ["erp-notif-read", "app.branding.v1"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let installed = false;

function isPreviewHost(hostname: string) {
  return hostname.startsWith("id-preview--") || hostname.startsWith("preview--") || hostname.includes("lovableproject");
}

function cleanSessionState() {
  try {
    const rawSubmission = sessionStorage.getItem("execution:fromSubmission");
    if (rawSubmission) {
      const parsed = JSON.parse(rawSubmission);
      const services = (parsed as { services?: unknown })?.services;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || (services != null && !Array.isArray(services))) {
        sessionStorage.removeItem("execution:fromSubmission");
      }
    }
  } catch {
    try { sessionStorage.removeItem("execution:fromSubmission"); } catch {}
  }

  try {
    const openId = sessionStorage.getItem("executions:openId");
    if (openId && !UUID_RE.test(openId)) sessionStorage.removeItem("executions:openId");
  } catch {
    try { sessionStorage.removeItem("executions:openId"); } catch {}
  }

  for (const key of APP_SESSION_KEYS) {
    try {
      const value = sessionStorage.getItem(key);
      if (value === "undefined" || value === "null" || value === "[object Object]") sessionStorage.removeItem(key);
    } catch {}
  }
}

function cleanLocalState() {
  try {
    const rawRead = localStorage.getItem("erp-notif-read");
    if (rawRead) {
      const parsed = JSON.parse(rawRead);
      if (!Array.isArray(parsed) || parsed.some((v) => typeof v !== "string")) localStorage.removeItem("erp-notif-read");
    }
  } catch {
    try { localStorage.removeItem("erp-notif-read"); } catch {}
  }

  try {
    const rawBranding = localStorage.getItem("app.branding.v1");
    if (rawBranding) {
      const parsed = JSON.parse(rawBranding);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) localStorage.removeItem("app.branding.v1");
    }
  } catch {
    try { localStorage.removeItem("app.branding.v1"); } catch {}
  }

  for (const key of APP_LOCAL_KEYS) {
    try {
      const value = localStorage.getItem(key);
      if (value === "undefined" || value === "null" || value === "[object Object]") localStorage.removeItem(key);
    } catch {}
  }
}

function cleanHistoryState() {
  try {
    const state = window.history.state;
    if (state != null && (typeof state !== "object" || Array.isArray(state))) {
      window.history.replaceState({}, "", window.location.href);
    }
  } catch {}
}

async function manageServiceWorker() {
  try {
    if (!("serviceWorker" in navigator)) return;
    if (isPreviewHost(window.location.hostname)) {
      // In Lovable preview iframe, unregister to avoid stale caches during development.
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.allSettled(registrations.map((r) => r.unregister()));
      return;
    }
    // On production / installed app: register the real PWA service worker.
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch {}
}

const RELOAD_FLAG = "__chunk_reload_at__";
function isChunkLoadError(msg: string) {
  return /Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError|error loading dynamically imported module/i.test(msg);
}
function handleChunkError(message: string) {
  if (!isChunkLoadError(message)) return;
  try {
    const last = Number(sessionStorage.getItem(RELOAD_FLAG) || "0");
    if (Date.now() - last < 10000) return;
    sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
  } catch {}
  try {
    if ("caches" in window) {
      caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))).finally(() => window.location.reload());
    } else {
      window.location.reload();
    }
  } catch { window.location.reload(); }
}

export function installStartupSafety() {
  if (typeof window === "undefined") return;
  if (installed) return;
  installed = true;
  cleanSessionState();
  cleanLocalState();
  cleanHistoryState();
  void manageServiceWorker();
  window.addEventListener("vite:preloadError", (e: Event) => {
    e.preventDefault();
    const msg = ((e as unknown as { payload?: { message?: string } }).payload?.message) || "Failed to fetch dynamically imported module";
    handleChunkError(msg);
  });
  window.addEventListener("error", (e) => handleChunkError(e?.message || ""));
  window.addEventListener("unhandledrejection", (e) => handleChunkError(String((e as PromiseRejectionEvent).reason?.message || (e as PromiseRejectionEvent).reason || "")));
}

installStartupSafety();
