import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => ((m as { default?: ServerEntry }).default ?? (m as unknown as ServerEntry)),
    );
  }
  return serverEntryPromise;
}

function brandedErrorResponse(): Response {
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

const NO_FAVICON_CACHE_HEADERS = {
  "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
  pragma: "no-cache",
  expires: "0",
};

const SW_CLEANUP_SCRIPT = `
const FAVICON_CACHE_PATTERNS = ["/favicon.ico","/favicon.png","/apple-touch-icon","/icon-192","/icon-512","/manifest.json","/manifest.webmanifest","/site.webmanifest","company-icon","company-assets/icons","favicon","lovable"];
async function clearFaviconCacheEntries() {
  const names = await caches.keys();
  await Promise.all(names.map(async (name) => {
    const cache = await caches.open(name);
    const requests = await cache.keys();
    await Promise.all(requests.map((request) => {
      const url = new URL(request.url);
      url.searchParams.delete("v");
      const clean = url.toString().toLowerCase();
      return FAVICON_CACHE_PATTERNS.some((pattern) => clean.includes(pattern.toLowerCase())) ? cache.delete(request) : Promise.resolve(false);
    }));
  }));
}
self.addEventListener("install", (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", (event) => event.waitUntil((async () => {
  await clearFaviconCacheEntries();
  await self.clients.claim();
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  await Promise.all(clients.map((client) => client.postMessage({ type: "FAVICON_CACHE_CLEARED" })));
  await self.registration.unregister();
})()));
self.addEventListener("message", (event) => {
  if (event.data?.type === "CLEAR_FAVICON_CACHE") event.waitUntil(clearFaviconCacheEntries());
});
`;

async function faviconCacheResponse(request: Request): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  if (pathname === "/sw.js" || pathname === "/service-worker.js") {
    return new Response(SW_CLEANUP_SCRIPT, {
      headers: { ...NO_FAVICON_CACHE_HEADERS, "content-type": "application/javascript; charset=utf-8" },
    });
  }
  return null;
}

function isCatastrophicSsrErrorBody(body: string, responseStatus: number): boolean {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return false;
  }

  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    return false;
  }

  const fields = payload as Record<string, unknown>;
  const expectedKeys = new Set(["message", "status", "unhandled"]);
  if (!Object.keys(fields).every((key) => expectedKeys.has(key))) {
    return false;
  }

  return (
    fields.unhandled === true &&
    fields.message === "HTTPError" &&
    (fields.status === undefined || fields.status === responseStatus)
  );
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isCatastrophicSsrErrorBody(body, response.status)) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return brandedErrorResponse();
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const faviconResponse = await faviconCacheResponse(request);
      if (faviconResponse) return faviconResponse;
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return brandedErrorResponse();
    }
  },
};
