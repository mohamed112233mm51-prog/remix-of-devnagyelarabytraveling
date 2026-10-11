import assert from "node:assert/strict";
import test from "node:test";
import { tryNativeImageShare } from "../src/lib/imageFileShare.ts";

const image = () => new File([new Uint8Array([137, 80, 78, 71])], "كشف حساب.png", { type: "image/png" });

test("native sharing sends the actual file without a text-only WhatsApp message", async () => {
  const file = image();
  let shares = 0;
  const outcome = await tryNativeImageShare(file, {
    canShare: (payload) => payload.files[0] === file,
    share: async (payload) => {
      shares++;
      assert.deepEqual(Object.keys(payload), ["files"]);
      assert.strictEqual(payload.files[0], file);
      assert.equal(payload.files[0].type, "image/png");
    },
  });
  assert.equal(outcome, "native");
  assert.equal(shares, 1);
});

test("unsupported browser never attempts a text-only share", async () => {
  let shares = 0;
  const outcome = await tryNativeImageShare(image(), {
    canShare: () => false,
    share: async () => { shares++; },
  });
  assert.equal(outcome, "unsupported");
  assert.equal(shares, 0);
});

test("browser without file-sharing support returns unsupported", async () => {
  assert.equal(await tryNativeImageShare(image(), null), "unsupported");
  assert.equal(await tryNativeImageShare(image(), { share: async () => {} }), "unsupported");
  assert.equal(await tryNativeImageShare(image(), { canShare: () => true }), "unsupported");
});

test("a cancelled share does not trigger a fallback message", async () => {
  const outcome = await tryNativeImageShare(image(), {
    canShare: () => true,
    share: async () => { throw Object.assign(new Error("cancelled"), { name: "AbortError" }); },
  });
  assert.equal(outcome, "cancelled");
});

test("other native sharing errors fall back to manual image attachment", async () => {
  const outcome = await tryNativeImageShare(image(), {
    canShare: () => true,
    share: async () => { throw Object.assign(new Error("Not allowed"), { name: "NotAllowedError" }); },
  });
  assert.equal(outcome, "unsupported");
  assert.equal(await tryNativeImageShare(image(), {
    canShare: () => { throw new Error("unsupported"); },
    share: async () => {},
  }), "unsupported");
});
