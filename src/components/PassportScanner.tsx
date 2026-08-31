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
const MAX_DIMENSION = 2800;
const JPEG_QUALITY = 0.95;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("تعذر قراءة صورة الجواز"));
    reader.readAsDataURL(blob);
  });
}

async function preparePassportImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("اختر صورة للجواز");
  if (file.size > MAX_INPUT_BYTES) throw new Error("حجم الصورة كبير جدًا. الحد الأقصى 20MB");

  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("صيغة الصورة غير مدعومة على هذا الجهاز"));
      image.src = objectUrl;
    });

    const longest = Math.max(image.naturalWidth, image.naturalHeight);
    const scale = longest > MAX_DIMENSION ? MAX_DIMENSION / longest : 1;
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("تعذر تجهيز الصورة للقراءة");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, 0, 0, width, height);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => result ? resolve(result) : reject(new Error("تعذر تجهيز صورة الجواز")),
        "image/jpeg",
        JPEG_QUALITY,
      );
    });

    // Drop pixel buffers immediately after the temporary JPEG is produced.
    canvas.width = 1;
    canvas.height = 1;
    return await blobToDataUrl(blob);
  } finally {
    image.src = "";
    URL.revokeObjectURL(objectUrl);
  }
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
        accept="image/*"
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
