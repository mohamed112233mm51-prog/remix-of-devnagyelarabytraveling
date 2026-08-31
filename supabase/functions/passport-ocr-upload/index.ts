const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};

const MAX_IMAGE_BYTES = 6_000_000;
const SUPPORTED_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
const HEIC_MIMES = new Set(["image/heic", "image/heif"]);

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function normalizeMime(value: unknown): string {
  const mime = String(value ?? "").trim().toLowerCase().split(";", 1)[0];
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

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return Array.from(bytes.slice(start, start + length))
    .map((value) => String.fromCharCode(value))
    .join("");
}

function sniffImageMime(bytes: Uint8Array): string | null {
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
  }
  return null;
}

function bytesToBase64(bytes: Uint8Array): string {
  const native = (bytes as Uint8Array & { toBase64?: () => string }).toBase64;
  if (typeof native === "function") return native.call(bytes);

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

async function authenticated(req: Request): Promise<boolean> {
  const auth = req.headers.get("Authorization");
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!auth?.startsWith("Bearer ") || !url || !anon) return false;
  try {
    const response = await fetch(`${url}/auth/v1/user`, {
      headers: { Authorization: auth, apikey: anon },
    });
    return response.ok;
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return respond(405, { ok: false, error: "Method not allowed" });
  if (!(await authenticated(req))) return respond(401, { ok: false, error: "غير مصرح باستخدام خدمة قراءة الجواز" });

  const contentType = String(req.headers.get("content-type") || "").toLowerCase();
  if (!contentType.startsWith("multipart/form-data")) {
    return respond(415, { ok: false, error: "يجب إرسال صورة الجواز كملف مباشر" });
  }

  let imageDataUrl = "";
  try {
    const formData = await req.formData();
    const candidate = formData.get("image");
    if (!(candidate instanceof File)) {
      return respond(400, { ok: false, error: "لم يتم استلام ملف صورة الجواز" });
    }
    if (candidate.size <= 0) return respond(400, { ok: false, error: "صورة الجواز فارغة" });
    if (candidate.size > MAX_IMAGE_BYTES) {
      return respond(413, {
        ok: false,
        error: "حجم الصورة أكبر من 6MB. صوّر صفحة الجواز فقط أو اختر صورة أصغر مع الحفاظ على وضوح البيانات",
      });
    }

    const bytes = new Uint8Array(await candidate.arrayBuffer());
    const detectedMime = sniffImageMime(bytes);
    const hintedMime = normalizeMime(candidate.type) || mimeFromFileName(candidate.name) || "";
    const mime = detectedMime || hintedMime;

    if (HEIC_MIMES.has(mime)) {
      return respond(415, { ok: false, error: "الصورة بصيغة HEIC/HEIF. استخدم JPG أو PNG أو WEBP" });
    }
    if (!SUPPORTED_MIMES.has(mime)) {
      return respond(415, { ok: false, error: "صيغة الصورة غير مدعومة. استخدم JPG أو PNG أو WEBP" });
    }
    if (!detectedMime) {
      return respond(400, { ok: false, error: "تعذر التحقق من ملف الصورة. جرّب إعادة تصوير صفحة الجواز" });
    }

    imageDataUrl = `data:${mime};base64,${bytesToBase64(bytes)}`;

    const url = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY");
    const auth = req.headers.get("Authorization");
    if (!url || !anon || !auth) return respond(503, { ok: false, error: "خدمة قراءة الجواز غير متاحة حاليًا" });

    const downstream = await fetch(`${url}/functions/v1/passport-ocr`, {
      method: "POST",
      headers: {
        Authorization: auth,
        apikey: anon,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ image_data_url: imageDataUrl }),
    });

    const responseText = await downstream.text();
    if (!responseText) {
      return respond(502, { ok: false, error: "لم ترجع خدمة قراءة الجواز نتيجة" });
    }

    return new Response(responseText, {
      status: downstream.status,
      headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
    });
  } catch {
    return respond(500, { ok: false, error: "تعذر رفع صورة الجواز للخدمة" });
  } finally {
    // Never persist or log the passport image. Keep it only in request memory.
    imageDataUrl = "";
  }
});
