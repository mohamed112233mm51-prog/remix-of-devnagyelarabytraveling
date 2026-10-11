/**
 * Web Share can transfer an actual PNG attachment to the OS share sheet.
 * A wa.me URL cannot attach local Blob/File data; it can only prefill text.
 */
export type NativeImageShareResult = "native" | "cancelled" | "unsupported";

export type ImageFileShareNavigator = {
  canShare?: (data: { files: File[] }) => boolean;
  share?: (data: { files: File[] }) => Promise<void>;
};

export async function tryNativeImageShare(
  file: File,
  shareNavigator: ImageFileShareNavigator | null,
): Promise<NativeImageShareResult> {
  if (!shareNavigator || typeof shareNavigator.canShare !== "function" || typeof shareNavigator.share !== "function") {
    return "unsupported";
  }

  // Files only: some WhatsApp targets silently drop attachments if 'text' or
  // 'url' is present in the same share payload.
  const payload = { files: [file] };
  try {
    if (!shareNavigator.canShare(payload)) return "unsupported";
  } catch {
    return "unsupported";
  }

  try {
    await shareNavigator.share(payload);
    return "native";
  } catch (error) {
    if ((error as { name?: string } | null)?.name === "AbortError") {
      return "cancelled"; // User dismissed share sheet; do NOT send text.
    }
    return "unsupported";
  }
}
