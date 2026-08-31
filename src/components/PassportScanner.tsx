import { useRef, useState } from "react";
import { Camera, Loader2, ShieldCheck, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export type PassportScanData = {
  full_name_ar: string | null;
  full_name_en: string | null;
  national_id: string | null;
  date_of_birth: string | null;
  place_of_birth: string | null;
  sex: "M" | "F" | null;
  passenger_type: string | null;
  passport_number: string | null;
  expiry_date: string | null;
  mrz_verified: boolean;
  needs_review: boolean;
  warnings: string[];
};

type PassportOcrResponse = {
  ok: boolean;
  data?: PassportScanData;
  error?: string;
};

const MAX_INPUT_BYTES = 20 * 1024 * 1024;
const MAX_PREPARED_BYTES = 5_500_000;
const MAX_DIMENSION = 2600;
const DIRECT_VISION_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
const HEIC_MIMES = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);

function normalizeMime(value: string): string {
  const mime = String(value || "").trim().toLowerCase().split(";", 1)[0];
  if (mime === "image/jpg" || mime === "image/pjpeg") return "image/jpeg";
  if (mime === "image/x-png") return "image/png";
  return mime;
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
    let part = "";
    for (let i = 0; i < chunk.length; i++) part += String.fromCharCode(chunk[i]);
    binary += part;
  }
  return btoa(binary);
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const mime = normalizeMime(blob.type) || "image/jpeg";

  // Android/WebView file pickers can fire FileReader.onerror even for a valid JPG.
  // Prefer Blob.arrayBuffer() and encode ourselves; keep FileReader only as a fallback.
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (!bytes.length) throw new Error("empty image");
    return `data:${mime};base64,${bytesToBase64(bytes)}`;
  } catch {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || "");
        if (result.startsWith("data:image/")) resolve(result);
        else reject(new Error("تعذر تحويل صورة الجواز داخل المتصفح"));
      };
      reader.onerror = () => reject(new Error("تعذر تحويل صورة الجواز داخل المتصفح"));
      reader.onabort = () => reject(new Error("تم إلغاء قراءة صورة الجواز"));
      reader.readAsDataURL(blob);
    });
  }
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (result) => result ? resolve(result) : reject(new Error("تعذر تجهيز صورة الجواز")),
      "image/jpeg",
      quality,
    );
  });
}

function mimeFromFileName(name: string): string | null {
  const lower = String(name || "").trim().toLowerCase();
  if (/\.jpe?g$/.test(lower)) return "image/jpeg";
  if (/\.png$/.test(lower)) return "image/png";
  if (/\.webp$/.test(lower)) return "image/webp";
  if (/\.heic$/.test(lower)) return "image/heic";
  if (/\.heif$/.test(lower)) return "image/heif";
  if (/\.avif$/.test(lower)) return "image/avif";
  return null;
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return Array.from(bytes.slice(start, start + length))
    .map((value) => String.fromCharCode(value))
    .join("");
}

async function sniffImageMime(file: File): Promise<string | null> {
  try {
    const bytes = new Uint8Array(await file.slice(0, 32).arrayBuffer());
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
    if (
      bytes.length >= 8
      && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
      && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
    ) return "image/png";
    if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "image/webp";

    if (bytes.length >= 12 && ascii(bytes, 4, 4) === "ftyp") {
      const brand = ascii(bytes, 8, 4).toLowerCase();
      if (["heic", "heix", "hevc", "hevx", "heim", "heis"].includes(brand)) return "image/heic";
      if (["mif1", "msf1"].includes(brand)) return "image/heif";
      if (["avif", "avis"].includes(brand)) return "image/avif";
    }
  } catch {
    // A MIME/extension fallback below is still safe; the Edge Function validates the final data URL too.
  }
  return null;
}

async function resolveImageMime(file: File): Promise<string | null> {
  const sniffed = await sniffImageMime(file);
  if (sniffed) return sniffed;
  const declared = normalizeMime(file.type);
  if (declared.startsWith("image/")) return declared;
  return mimeFromFileName(file.name);
}

async function compressCanvas(canvas: HTMLCanvasElement): Promise<Blob> {
  let blob = await canvasToJpeg(canvas, 0.94);
  if (blob.size > MAX_PREPARED_BYTES) blob = await canvasToJpeg(canvas, 0.86);
  if (blob.size > MAX_PREPARED_BYTES) blob = await canvasToJpeg(canvas, 0.78);
  if (blob.size > MAX_PREPARED_BYTES) {
    throw new Error("الصورة ما زالت كبيرة بعد التجهيز. جرّب تصوير صفحة الجواز فقط وبشكل أقرب");
  }
  return blob;
}

async function drawToPreparedJpeg(source: CanvasImageSource, sourceWidth: number, sourceHeight: number): Promise<Blob> {
  const longest = Math.max(sourceWidth, sourceHeight);
  if (!Number.isFinite(longest) || longest <= 0) throw new Error("أبعاد الصورة غير صالحة");

  const scale = longest > MAX_DIMENSION ? MAX_DIMENSION / longest : 1;
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  try {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("تعذر تجهيز الصورة للقراءة");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, width, height);
    return await compressCanvas(canvas);
  } finally {
    // Release the potentially large pixel buffer as soon as preprocessing finishes.
    canvas.width = 1;
    canvas.height = 1;
  }
}

async function prepareWithImageBitmap(blob: Blob): Promise<Blob | null> {
  if (typeof createImageBitmap !== "function") return null;
  let bitmap: ImageBitmap | null = null;
  try {
    // `from-image` preserves the camera EXIF orientation where the browser supports it.
    bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" } as any);
    return await drawToPreparedJpeg(bitmap, bitmap.width, bitmap.height);
  } catch {
    return null;
  } finally {
    try { bitmap?.close(); } catch { /* no-op */ }
  }
}

async function prepareWithHtmlImage(blob: Blob): Promise<Blob | null> {
  const image = new Image();
  let objectUrl = "";
  try {
    // Avoid FileReader here completely. Object URLs are much more reliable with
    // Android document-provider / gallery files inside embedded previews.
    objectUrl = URL.createObjectURL(blob);
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("decode failed"));
      image.src = objectUrl;
    });
    return await drawToPreparedJpeg(image, image.naturalWidth, image.naturalHeight);
  } catch {
    return null;
  } finally {
    image.src = "";
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

async function preparePassportImage(file: File): Promise<string> {
  if (!file || file.size <= 0) throw new Error("اختر صورة للجواز");
  if (file.size > MAX_INPUT_BYTES) throw new Error("حجم الصورة كبير جدًا. الحد الأقصى 20MB");

  const mime = await resolveImageMime(file);
  if (!mime) throw new Error("صيغة الصورة غير معروفة. استخدم JPG أو PNG أو WEBP");

  // Some Android/Samsung pickers return a blank or generic MIME. Re-wrap the same bytes
  // with the detected MIME so browser decoders have the best chance of opening them.
  const sourceBlob: Blob = normalizeMime(file.type) === mime
    ? file
    : new Blob([file], { type: mime });

  // createImageBitmap is more reliable than <img> for several mobile camera files.
  let prepared = await prepareWithImageBitmap(sourceBlob);
  if (!prepared) prepared = await prepareWithHtmlImage(sourceBlob);
  if (prepared) return await blobToDataUrl(prepared);

  // If the browser preview/decoder is the only thing that failed, standard formats can
  // still be sent directly to Vision. Limit the raw payload so base64 stays under the
  // Edge Function request guard.
  if (DIRECT_VISION_MIMES.has(mime) && sourceBlob.size <= MAX_PREPARED_BYTES) {
    return await blobToDataUrl(sourceBlob);
  }

  if (HEIC_MIMES.has(mime)) {
    throw new Error("الصورة HEIC/HEIF ولم يستطع هذا المتصفح تحويلها. اختر JPG/PNG/WEBP أو صوّر صفحة الجواز بالكاميرا من جديد");
  }

  if (DIRECT_VISION_MIMES.has(mime)) {
    throw new Error("تعذر ضغط الصورة على هذا الجهاز وحجمها كبير. جرّب تصوير صفحة الجواز فقط أو استخدم صورة JPG أصغر");
  }

  throw new Error("تعذر تحويل صيغة الصورة على هذا الجهاز. استخدم JPG أو PNG أو WEBP");
}

export function PassportScanner({ onExtracted }: { onExtracted: (data: PassportScanData) => void | Promise<void> }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [reading, setReading] = useState(false);
  const [lastResult, setLastResult] = useState<PassportScanData | null>(null);

  const handleFile = async (file: File) => {
    setReading(true);
    setLastResult(null);
    let imageDataUrl = "";
    try {
      imageDataUrl = await preparePassportImage(file);
      const { data, error } = await supabase.functions.invoke("passport-ocr", {
        body: { image_data_url: imageDataUrl },
      });
      if (error) throw new Error(error.message || "تعذر الاتصال بخدمة قراءة الجواز");

      const response = (data || {}) as PassportOcrResponse;
      if (!response.ok || !response.data) throw new Error(response.error || "تعذر استخراج بيانات الجواز");

      await onExtracted(response.data);
      setLastResult(response.data);
      if (response.data.needs_review) {
        toast.warning("تمت قراءة الجواز، لكن توجد بيانات تحتاج مراجعة");
      } else {
        toast.success("تمت قراءة الجواز وتعبئة البيانات");
      }
    } catch (error: any) {
      toast.error(error?.message || "تعذر قراءة بيانات الجواز");
    } finally {
      // The image exists only in this function scope; never persisted to storage/session/local DB.
      imageDataUrl = "";
      setReading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,.jpg,.jpeg,.png,.webp,.heic,.heif"
        hidden
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) void handleFile(file);
        }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={reading}
          style={{
            minHeight: 40,
            border: 0,
            borderRadius: 10,
            padding: "9px 14px",
            background: "#0f1b3d",
            color: "#fff",
            fontWeight: 800,
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            cursor: reading ? "wait" : "pointer",
            opacity: reading ? 0.75 : 1,
          }}
        >
          {reading ? <Loader2 size={17} className="animate-spin" /> : <Camera size={17} />}
          {reading ? "جارِ قراءة الجواز..." : "رفع / تصوير الجواز"}
        </button>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "#475569", fontWeight: 700 }}>
          <ShieldCheck size={15} color="#15803d" />
          الصورة لا تُحفظ في Supabase
        </span>
      </div>

      {lastResult && (
        <div style={{
          borderRadius: 10,
          padding: "8px 10px",
          border: `1px solid ${lastResult.needs_review ? "#fbbf24" : "#86efac"}`,
          background: lastResult.needs_review ? "#fffbeb" : "#f0fdf4",
          color: lastResult.needs_review ? "#92400e" : "#166534",
          fontSize: 12,
          fontWeight: 700,
          display: "flex",
          alignItems: "flex-start",
          gap: 7,
        }}>
          {lastResult.needs_review ? <TriangleAlert size={15} style={{ marginTop: 1, flex: "0 0 auto" }} /> : <ShieldCheck size={15} style={{ marginTop: 1, flex: "0 0 auto" }} />}
          <span>
            {lastResult.needs_review
              ? `تمت التعبئة. راجع البيانات قبل الحفظ${lastResult.warnings.length ? ` — ${lastResult.warnings.join("، ")}` : ""}`
              : `تمت مطابقة البيانات${lastResult.mrz_verified ? " مع MRZ" : ""}. راجعها ثم أكمل باقي التنفيذ.`}
          </span>
        </div>
      )}
    </div>
  );
}
