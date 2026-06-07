const APP_SESSION_KEYS = ["execution:fromSubmission", "executions:openId"];
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
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
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

function cleanHistoryState() {
  try {
    const state = window.history.state;
    if (state != null && (typeof state !== "object" || Array.isArray(state))) {
      window.history.replaceState({}, "", window.location.href);
    }
  } catch {}
}

async function unregisterPreviewServiceWorkers() {
  try {
    if (!("serviceWorker" in navigator) || !isPreviewHost(window.location.hostname)) return;
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.allSettled(
      registrations
        .filter((registration) => {
          const url = registration.active?.scriptURL || registration.waiting?.scriptURL || registration.installing?.scriptURL || "";
          return url.includes("/sw.js") || url.includes("/service-worker.js");
        })
        .map((registration) => registration.unregister()),
    );
  } catch {}
}

export function installStartupSafety() {
  if (typeof window === "undefined") return;
  if (installed) return;
  installed = true;
  cleanSessionState();
  cleanHistoryState();
  void unregisterPreviewServiceWorkers();
}

installStartupSafety();
