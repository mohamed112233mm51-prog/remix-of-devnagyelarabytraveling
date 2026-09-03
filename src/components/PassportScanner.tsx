import { useRef, useState } from "react";
import { Camera, Loader2, ShieldCheck, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { warnIfPassportPassengerHasPreviousExecution } from "@/lib/passportPreviousExecutionWarning";

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

const MAX_UPLOAD_BYTES = 6_000_000;
const SUPPORTED_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
const HEIC_MIMES = new Set(["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"]);

function normalizeMime(value: string): string {
  const mime = String(value || "").trim().toLowerCase().split(";", 1)[0];
  if (mime === "image/jpg" || mime === "image/pjpeg") return "image/jpeg";
  if (mime === "image/x-png") return "image/png";
  return mime;
}

function mimeFromFileName(name: string): string | null {
  const lower = String(name || "").trim().toLowerCase();
  if (/\.jpe?g$/.test(lower)) return "image/jpeg";
  if (/\.png$/.test(lower)) return "image/png";
  if (/\.webp$/.test(lower)) return "image/webp";
  if (/\.heic$/.test(lower)) return "image/heic";
  if (/\.heif$/.test(lower)) return "image/heif";
  return null;
}

function resolveFileMime(file: File): string | null {
  const declared = normalizeMime(file.type);
  if (declared) return declared;
  return mimeFromFileName(file.name);
}

function normalizeNationalId(value: unknown): string {
  const arabicDigits: Record<string, string> = {
    "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
    "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  };
  return String(value ?? "")
    .replace(/[٠-٩]/g, (digit) => arabicDigits[digit] || digit)
    .replace(/\D/g, "");
}

function nationalIdMatchesDob(nationalId: string, dob: string | null): boolean {
  if (!/^\d{14}$/.test(nationalId) || !["2", "3"].includes(nationalId[0])) return false;

  const year = (nationalId[0] === "2" ? 1900 : 2000) + Number(nationalId.slice(1, 3));
  const month = Number(nationalId.slice(3, 5));
  const day = Number(nationalId.slice(5, 7));
  const parsedDate = new Date(Date.UTC(year, month - 1, day));
  if (
    parsedDate.getUTCFullYear() !== year
    || parsedDate.getUTCMonth() !== month - 1
    || parsedDate.getUTCDate() !== day
  ) return false;

  if (!dob) return true;
  return dob === `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

async function createNationalIdCrop(file: File): Promise<File | null> {
  let bitmap: ImageBitmap | null = null;
  try {
    if (typeof createImageBitmap !== "function") return null;
    bitmap = await createImageBitmap(file);
    const width = bitmap.width;
    const height = bitmap.height;
    if (!width || !height) return null;

    // Egyptian passport identity text is concentrated on the right/center of the
    // biodata page. This removes the portrait and most MRZ clutter for the retry.
    const sx = Math.floor(width * 0.38);
    const sy = Math.floor(height * 0.27);
    const sw = Math.max(1, width - sx);
    const sh = Math.max(1, Math.floor(height * 0.52));
    const maxWidth = 1400;
    const scale = Math.min(1, maxWidth / sw);

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sw * scale));
    canvas.height = Math.max(1, Math.round(sh * scale));
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return null;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", 0.92);
    });
    canvas.width = 1;
    canvas.height = 1;
    if (!blob || blob.size <= 0 || blob.size > MAX_UPLOAD_BYTES) return null;

    const baseName = String(file.name || "passport").replace(/\.[^.]+$/, "");
    return new File([blob], `${baseName}-national-id.jpg`, { type: "image/jpeg" });
  } catch {
    return null;
  } finally {
    try { bitmap?.close(); } catch { /* no-op */ }
  }
}

async function functionErrorMessage(error: any): Promise<string> {
  try {
    const response = error?.context;
    if (response && typeof response.clone === "function") {
      const payload = await response.clone().json();
      if (payload?.error) return String(payload.error);
    }
  } catch {
    // Fall back to the SDK message below.
  }
  return String(error?.message || "تعذر الاتصال بخدمة قراءة الجواز");
}

async function invokePassportOcr(file: File): Promise<PassportScanData> {
  const formData = new FormData();
  formData.append("image", file, file.name || "passport.jpg");

  const { data, error } = await supabase.functions.invoke("passport-ocr-upload", {
    body: formData,
  });
  if (error) throw new Error(await functionErrorMessage(error));

  const response = (data || {}) as PassportOcrResponse;
  if (!response.ok || !response.data) throw new Error(response.error || "تعذر استخراج بيانات الجواز");
  return response.data;
}

/**
 * Read one passport image through the same transient upload/vision pipeline used
 * by the single-passport UI. The File is streamed directly to the Edge Function;
 * it is never persisted in Storage, DB, localStorage, sessionStorage, or logs.
 */
export async function scanPassportFile(file: File): Promise<PassportScanData> {
  if (!file || file.size <= 0) throw new Error("اختر صورة للجواز");
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error("حجم الصورة أكبر من 6MB. صوّر صفحة الجواز فقط أو اختر صورة أصغر مع الحفاظ على وضوح البيانات");
  }

  const mime = resolveFileMime(file);
  if (!mime) throw new Error("صيغة الصورة غير معروفة. استخدم JPG أو PNG أو WEBP");
  if (HEIC_MIMES.has(mime)) throw new Error("الصورة بصيغة HEIC/HEIF. استخدم JPG أو PNG أو WEBP");
  if (!SUPPORTED_MIMES.has(mime)) throw new Error("صيغة الصورة غير مدعومة. استخدم JPG أو PNG أو WEBP");

  // Important for Android/Lovable preview: do not read or convert the image in
  // the browser for the normal pass. The optional crop below only runs when the
  // first OCR result is missing the national ID, and safely falls back if needed.
  let extracted = await invokePassportOcr(file);

  // Gemini vision can occasionally omit a clearly visible national ID on one pass.
  // Retry only that passport once. Prefer a smaller text-region crop to reduce
  // visual distraction and image-token usage; fall back to the original image if
  // the browser cannot create the crop. Merge only a validated national ID.
  if (!String(extracted.national_id || "").trim()) {
    try {
      const retryFile = await createNationalIdCrop(file) || file;
      const retry = await invokePassportOcr(retryFile);
      const retryNationalId = normalizeNationalId(retry.national_id);
      if (nationalIdMatchesDob(retryNationalId, extracted.date_of_birth)) {
        extracted = {
          ...extracted,
          national_id: retryNationalId,
          warnings: (Array.isArray(extracted.warnings) ? extracted.warnings : []).filter((warning) => {
            const text = String(warning || "");
            return !text.includes("الرقم القومي لم يتم التحقق منه")
              && !text.includes("الرقم القومي المقروء يحتاج مراجعة");
          }),
        };
      }
    } catch {
      // A retry is best-effort only. Keep the successful first-pass result.
    }
  }

  // Review status is derived from the actual required identity fields instead of
  // any advisory warning returned by the OCR runtime. Warnings remain available
  // to the UI, but they do not mark a complete row as requiring review.
  const hasName = Boolean(String(extracted.full_name_ar || extracted.full_name_en || "").trim());
  const needsReview = Boolean(
    !hasName
    || !String(extracted.passport_number || "").trim()
    || !String(extracted.national_id || "").trim()
    || !String(extracted.date_of_birth || "").trim()
    || !String(extracted.place_of_birth || "").trim()
    || !extracted.sex
  );

  const result = { ...extracted, needs_review: needsReview };

  // Bulk passport upload should surface the same previous-execution warning used
  // by the normal execution flow as soon as the passport identity is available.
  // The lookup is informational and runs in the background so it never blocks OCR.
  if (typeof window !== "undefined" && window.location.pathname.startsWith("/passport-bulk-upload")) {
    void warnIfPassportPassengerHasPreviousExecution({
      passengerName: result.full_name_ar || result.full_name_en,
      passport: result.passport_number,
      nationalId: result.national_id,
    });
  }

  return result;
}

export function PassportScanner({ onExtracted }: { onExtracted: (data: PassportScanData) => void | Promise<void> }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [reading, setReading] = useState(false);
  const [lastResult, setLastResult] = useState<PassportScanData | null>(null);

  const handleFile = async (file: File) => {
    setReading(true);
    setLastResult(null);

    try {
      const extracted = await scanPassportFile(file);
      await onExtracted(extracted);
      setLastResult(extracted);
      if (extracted.needs_review) {
        toast.warning("تمت قراءة الجواز، لكن توجد بيانات تحتاج مراجعة");
      } else {
        toast.success("تمت قراءة الجواز وتعبئة البيانات");
      }
    } catch (error: any) {
      toast.error(error?.message || "تعذر قراءة بيانات الجواز");
    } finally {
      setReading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
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
          {reading ? "جارِ رفع وقراءة الجواز..." : "رفع / تصوير الجواز"}
        </button>
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
          {lastResult.needs_review
            ? <TriangleAlert size={15} style={{ marginTop: 1, flex: "0 0 auto" }} />
            : <ShieldCheck size={15} style={{ marginTop: 1, flex: "0 0 auto" }} />}
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
