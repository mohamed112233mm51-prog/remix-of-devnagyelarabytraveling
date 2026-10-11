/**
 * Lovable's embedded preview may deny the web-share Permissions Policy.
 * Pass a PNG in memory to a separate same-origin top-level page, where a
 * fresh user tap can invoke the operating system's real file share sheet.
 * No image bytes are placed in the URL, localStorage, or a remote database.
 */
export const IMAGE_SHARE_READY = "statement-image-share:ready";
export const IMAGE_SHARE_FILE = "statement-image-share:file";

export function makeStandaloneShareUrl(origin: string, token: string): string {
  const url = new URL("/share-image.html", origin);
  url.hash = "token=" + encodeURIComponent(token);
  return url.toString();
}

export function isStandaloneShareReady(data: unknown, token: string): boolean {
  if (!data || typeof data !== "object") return false;
  const message = data as { type?: unknown; token?: unknown };
  return message.type === IMAGE_SHARE_READY && message.token === token;
}

export function isStandaloneSharePayload(
  data: unknown,
  token: string,
): data is { type: typeof IMAGE_SHARE_FILE; token: string; file: File } {
  if (!data || typeof data !== "object") return false;
  const message = data as { type?: unknown; token?: unknown; file?: unknown };
  return (
    message.type === IMAGE_SHARE_FILE &&
    message.token === token &&
    typeof File !== "undefined" &&
    message.file instanceof File &&
    message.file.type === "image/png"
  );
}

/**
 * Call synchronously inside a button click (otherwise popup blockers may
 * prevent the new tab). Returns false if no tab could be opened.
 */
export function openStandaloneImageShare(file: File): boolean {
  if (typeof window === "undefined" || file.type !== "image/png") return false;
  const token = window.crypto?.randomUUID?.();
  if (!token) return false;
  const origin = window.location.origin;
  let popup: Window | null = null;
  let delivered = false;

  const onReady = (event: MessageEvent) => {
    if (
      delivered ||
      event.origin !== origin ||
      event.source !== popup ||
      !isStandaloneShareReady(event.data, token)
    ) return;
    delivered = true;
    // Target origin prevents delivery if the popup was redirected elsewhere.
    popup?.postMessage({ type: IMAGE_SHARE_FILE, token, file }, origin);
    window.removeEventListener("message", onReady);
  };
  window.addEventListener("message", onReady);
  try {
    popup = window.open(makeStandaloneShareUrl(origin, token), "_blank");
  } catch {
    popup = null;
  }
  if (!popup) {
    window.removeEventListener("message", onReady);
    return false;
  }
  // Release the listener if the tab is closed, fails to load, or never replies.
  window.setTimeout(() => window.removeEventListener("message", onReady), 60_000);
  return true;
}
