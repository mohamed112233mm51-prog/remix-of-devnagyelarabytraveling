import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { makeStandaloneShareUrl, isStandaloneShareReady, isStandaloneSharePayload, IMAGE_SHARE_FILE, IMAGE_SHARE_READY } from "../src/lib/standaloneImageShare.ts";

test("standalone page URL remains same-origin and carries only a random token", () => {
  const url = new URL(makeStandaloneShareUrl("https://preview.example.app", "nonce-123"));
  assert.equal(url.origin, "https://preview.example.app");
  assert.equal(url.pathname, "/share-image.html");
  assert.equal(url.hash, "#token=nonce-123");
  assert.equal(url.search, "");
});

test("handshake rejects unknown or mismatched messages", () => {
  assert.equal(isStandaloneShareReady({ type: IMAGE_SHARE_READY, token: "nonce-123" }, "nonce-123"), true);
  assert.equal(isStandaloneShareReady({ type: IMAGE_SHARE_READY, token: "other" }, "nonce-123"), false);
  assert.equal(isStandaloneShareReady({ type: IMAGE_SHARE_FILE, token: "nonce-123" }, "nonce-123"), false);
  assert.equal(isStandaloneShareReady(null, "nonce-123"), false);
});

test("only an actual PNG File with correct token can be relayed", () => {
  const file = new File([new Uint8Array([137, 80, 78, 71])], "statement.png", { type: "image/png" });
  assert.equal(isStandaloneSharePayload({ type: IMAGE_SHARE_FILE, token: "ok", file }, "ok"), true);
  assert.equal(isStandaloneSharePayload({ type: IMAGE_SHARE_FILE, token: "bad", file }, "ok"), false);
  assert.equal(isStandaloneSharePayload({ type: IMAGE_SHARE_FILE, token: "ok", file: new Blob(["text"]) }, "ok"), false);
  assert.equal(isStandaloneSharePayload({ type: IMAGE_SHARE_FILE, token: "ok", file: new File(["x"], "file.txt", { type: "text/plain" }) }, "ok"), false);
});

test("standalone page shares the actual file, never a text-only WhatsApp link", () => {
  const html = readFileSync(new URL("../public/share-image.html", import.meta.url), "utf8");
  assert.ok(html.includes("navigator.share({ files: [file] })"));
  assert.ok(html.includes("event.origin !== location.origin"));
  assert.ok(html.includes("event.source !== source"));
  assert.ok(html.includes('window.opener = null'));
  assert.equal(html.includes("wa.me"), false);
  assert.equal(html.includes("localStorage"), false);
  assert.equal(html.includes("indexedDB"), false);
});

test("original-quality path keeps original PNG and guides WhatsApp Document attachment", () => {
  const html = readFileSync(new URL("../public/share-image.html", import.meta.url), "utf8");
  assert.ok(html.includes('id="original"'));
  assert.ok(html.includes('original.addEventListener("click"'));
  assert.ok(html.includes("download.click()"));
  assert.ok(html.includes("مستند / Document"));
  assert.ok(html.includes("التنزيلات"));
  assert.equal(html.includes("canvas.toBlob"), false);
  assert.equal(html.includes("image/jpeg"), false);
});
