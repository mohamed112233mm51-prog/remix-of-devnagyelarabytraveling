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
  // the browser. FormData lets the browser network layer stream the File to the
  // Edge Function, which performs the transient conversion server-side.
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
