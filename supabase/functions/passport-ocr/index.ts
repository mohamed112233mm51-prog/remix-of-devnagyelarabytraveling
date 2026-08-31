const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};

type Sex = "M" | "F" | null;

type VisionPayload = {
  printed_name_ar: string | null;
  printed_name_en: string | null;
  printed_passport_number: string | null;
  printed_national_id: string | null;
  printed_date_of_birth: string | null;
  printed_place_of_birth: string | null;
  printed_sex: string | null;
  printed_expiry_date: string | null;
  mrz_lines: string[];
  image_quality: "clear" | "usable" | "poor";
  quality_notes: string[];
};

type ParsedNationalId = {
  value: string;
  dob: string;
  sex: Exclude<Sex, null>;
};

type ParsedMrz = {
  line1: string;
  line2: string;
  passportNumber: string | null;
  passportVerified: boolean;
  dobYYMMDD: string | null;
  dobVerified: boolean;
  sex: Sex;
  expiryYYMMDD: string | null;
  expiryVerified: boolean;
  optionalData: string | null;
  optionalVerified: boolean;
  compositeVerified: boolean;
  nameEn: string | null;
};

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function normalizeDigits(value: unknown): string {
  const arabic: Record<string, string> = {
    "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
    "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  };
  return String(value ?? "")
    .replace(/[٠-٩]/g, (d) => arabic[d] || d)
    .replace(/\D/g, "");
}

function cleanText(value: unknown): string | null {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text || null;
}

function cleanPassportNumber(value: unknown): string | null {
  const text = String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return text || null;
}

function normalizeIsoDate(value: unknown): string | null {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function normalizeSex(value: unknown): Sex {
  const text = String(value ?? "").trim().toUpperCase();
  if (!text) return null;
  if (["M", "MALE", "ذكر", "رجل"].includes(text)) return "M";
  if (["F", "FEMALE", "أنثى", "انثى", "سيدة", "سيدات"].includes(text)) return "F";
  return null;
}

function parseEgyptianNationalId(value: unknown): ParsedNationalId | null {
  const digits = normalizeDigits(value);
  if (digits.length !== 14 || !["2", "3"].includes(digits[0])) return null;
  const year = (digits[0] === "2" ? 1900 : 2000) + Number(digits.slice(1, 3));
  const month = Number(digits.slice(3, 5));
  const day = Number(digits.slice(5, 7));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null;
  const sex: Exclude<Sex, null> = Number(digits[12]) % 2 === 1 ? "M" : "F";
  return {
    value: digits,
    dob: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    sex,
  };
}

function mrzValue(char: string): number {
  if (char >= "0" && char <= "9") return Number(char);
  if (char >= "A" && char <= "Z") return char.charCodeAt(0) - 55;
  return 0;
}

function mrzCheck(data: string, checkDigit: string): boolean {
  if (!/^\d$/.test(checkDigit)) return false;
  const weights = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += mrzValue(data[i]) * weights[i % 3];
  return String(sum % 10) === checkDigit;
}

function normalizeMrzLine(value: unknown): string {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[«‹]/g, "<")
    .replace(/\s/g, "")
    .replace(/[^A-Z0-9<]/g, "");
}

function decodeMrzName(line1: string): string | null {
  if (line1.length < 6) return null;
  const raw = line1.slice(5);
  const [surnameRaw, givenRaw = ""] = raw.split("<<", 2);
  const surname = surnameRaw.replace(/<+/g, " ").trim();
  const given = givenRaw.replace(/<+/g, " ").trim();
  return cleanText([surname, given].filter(Boolean).join(" "));
}

function parseMrz(lines: unknown): ParsedMrz | null {
  if (!Array.isArray(lines)) return null;
  const normalized = lines.map(normalizeMrzLine).filter((line) => line.length >= 40);
  if (normalized.length < 2) return null;

  let line1 = normalized.find((line) => line.startsWith("P<")) || normalized[0];
  let line2 = normalized[normalized.indexOf(line1) + 1] || normalized[1];
  if (line1.length < 44 || line2.length < 44) return null;
  line1 = line1.slice(0, 44);
  line2 = line2.slice(0, 44);

  const passportField = line2.slice(0, 9);
  const passportVerified = mrzCheck(passportField, line2[9]);
  const dobField = line2.slice(13, 19);
  const dobVerified = /^\d{6}$/.test(dobField) && mrzCheck(dobField, line2[19]);
  const expiryField = line2.slice(21, 27);
  const expiryVerified = /^\d{6}$/.test(expiryField) && mrzCheck(expiryField, line2[27]);
  const optionalField = line2.slice(28, 42);
  const optionalCheck = line2[42];
  const optionalVerified = optionalCheck === "<" ? false : mrzCheck(optionalField, optionalCheck);
  const composite = `${line2.slice(0, 10)}${line2.slice(13, 20)}${line2.slice(21, 43)}`;
  const compositeVerified = mrzCheck(composite, line2[43]);

  return {
    line1,
    line2,
    passportNumber: passportVerified ? cleanPassportNumber(passportField.replace(/<+$/g, "")) : null,
    passportVerified,
    dobYYMMDD: dobVerified ? dobField : null,
    dobVerified,
    sex: normalizeSex(line2[20]),
    expiryYYMMDD: expiryVerified ? expiryField : null,
    expiryVerified,
    optionalData: optionalVerified ? optionalField.replace(/<+$/g, "") || null : null,
    optionalVerified,
    compositeVerified,
    nameEn: decodeMrzName(line1),
  };
}

function yymmddFromIso(iso: string | null): string | null {
  if (!iso) return null;
  return `${iso.slice(2, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}`;
}

function expandMrzDate(yymmdd: string | null, hintIso: string | null, isExpiry = false): string | null {
  if (!yymmdd || !/^\d{6}$/.test(yymmdd)) return null;
  if (hintIso && yymmddFromIso(hintIso) === yymmdd) return hintIso;
  const yy = Number(yymmdd.slice(0, 2));
  const mm = Number(yymmdd.slice(2, 4));
  const dd = Number(yymmdd.slice(4, 6));
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentYY = currentYear % 100;
  let year: number;
  if (isExpiry) {
    year = 2000 + yy;
    if (year < currentYear - 20) year += 100;
  } else {
    year = yy <= currentYY ? 2000 + yy : 1900 + yy;
    if (year > currentYear) year -= 100;
  }
  const date = new Date(Date.UTC(year, mm - 1, dd));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== mm - 1 || date.getUTCDate() !== dd) return null;
  return `${year}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

function passengerType(dob: string | null, sex: Sex): string | null {
  if (!dob) return null;
  const [year, month, day] = dob.split("-").map(Number);
  const born = new Date(Date.UTC(year, month - 1, day));
  const now = new Date();
  let age = now.getUTCFullYear() - year;
  const beforeBirthday = now.getUTCMonth() < month - 1 || (now.getUTCMonth() === month - 1 && now.getUTCDate() < day);
  if (beforeBirthday) age--;
  if (age < 0) return null;
  if (age < 2) return "طفل تحت ٢";
  if (age < 8) return "طفل تحت ٨";
  if (age < 18) return "طفل تحت18";
  if (sex === "M") return "ذكر بالغ";
  if (sex === "F") return "سيدات بالغ";
  return null;
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

function outputText(payload: any): string | null {
  if (typeof payload?.output_text === "string") return payload.output_text;
  const items = Array.isArray(payload?.output) ? payload.output : [];
  for (const item of items) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (part?.type === "output_text" && typeof part?.text === "string") return part.text;
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return respond(405, { ok: false, error: "Method not allowed" });
  if (!(await authenticated(req))) return respond(401, { ok: false, error: "غير مصرح باستخدام خدمة قراءة الجواز" });

  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return respond(503, { ok: false, error: "خدمة قراءة الجواز غير مفعلة بعد" });

  let imageDataUrl = "";
  try {
    const body = await req.json();
    imageDataUrl = String(body?.image_data_url || "");
    if (!/^data:image\/(?:jpeg|jpg|png|webp);base64,/i.test(imageDataUrl)) {
      return respond(400, { ok: false, error: "صيغة صورة الجواز غير صالحة" });
    }
    if (imageDataUrl.length > 9_000_000) {
      return respond(413, { ok: false, error: "صورة الجواز أكبر من الحد المسموح بعد التجهيز" });
    }

    const model = Deno.env.get("PASSPORT_OCR_MODEL") || "gpt-5.6-sol";
    const schema = {
      type: "object",
      additionalProperties: false,
      required: [
        "printed_name_ar", "printed_name_en", "printed_passport_number", "printed_national_id",
        "printed_date_of_birth", "printed_place_of_birth", "printed_sex", "printed_expiry_date",
        "mrz_lines", "image_quality", "quality_notes",
      ],
      properties: {
        printed_name_ar: { type: ["string", "null"] },
        printed_name_en: { type: ["string", "null"] },
        printed_passport_number: { type: ["string", "null"] },
        printed_national_id: { type: ["string", "null"] },
        printed_date_of_birth: { type: ["string", "null"], description: "YYYY-MM-DD only when visibly readable" },
        printed_place_of_birth: { type: ["string", "null"] },
        printed_sex: { type: ["string", "null"] },
        printed_expiry_date: { type: ["string", "null"], description: "YYYY-MM-DD only when visibly readable" },
        mrz_lines: { type: "array", items: { type: "string" }, maxItems: 3 },
        image_quality: { type: "string", enum: ["clear", "usable", "poor"] },
        quality_notes: { type: "array", items: { type: "string" }, maxItems: 6 },
      },
    };

    const prompt = [
      "Extract passport identity data from this passport biodata-page image with maximum transcription accuracy.",
      "Read the printed visual zone and the MRZ independently. Never invent a value that is not visible.",
      "For Arabic/English names, preserve the printed spelling. For dates use YYYY-MM-DD only if actually readable.",
      "printed_national_id means the Egyptian national ID/الرقم القومي only if visibly printed; do not derive it yourself.",
      "Copy every MRZ line character-for-character, including < filler characters, with no spaces and no corrections.",
      "If glare, blur, crop, fingers, rotation, or low resolution make any value uncertain, leave that value null when necessary and describe the issue in quality_notes.",
      "Return only JSON matching the requested schema.",
    ].join(" ");

    const aiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        store: false,
        max_output_tokens: 1400,
        input: [{
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_image", image_url: imageDataUrl, detail: "high" },
          ],
        }],
        text: {
          format: {
            type: "json_schema",
            name: "passport_extraction",
            strict: true,
            schema,
          },
        },
      }),
    });

    if (!aiResponse.ok) {
      return respond(502, { ok: false, error: "تعذر تحليل صورة الجواز حاليًا" });
    }
    const aiJson = await aiResponse.json();
    const text = outputText(aiJson);
    if (!text) return respond(502, { ok: false, error: "لم ترجع خدمة القراءة بيانات صالحة" });

    let vision: VisionPayload;
    try {
      vision = JSON.parse(text) as VisionPayload;
    } catch {
      return respond(502, { ok: false, error: "تعذر تفسير نتيجة قراءة الجواز" });
    }

    const warnings: string[] = [];
    if (vision.image_quality === "poor") warnings.push("جودة الصورة ضعيفة؛ يفضل إعادة التصوير");
    for (const note of Array.isArray(vision.quality_notes) ? vision.quality_notes : []) {
      const clean = cleanText(note);
      if (clean) warnings.push(clean);
    }

    const mrz = parseMrz(vision.mrz_lines);
    const printedPassport = cleanPassportNumber(vision.printed_passport_number);
    const passportNumber = mrz?.passportVerified && mrz.passportNumber ? mrz.passportNumber : printedPassport;
    if (mrz?.passportVerified && printedPassport && mrz.passportNumber && printedPassport !== mrz.passportNumber) {
      warnings.push("رقم الجواز المطبوع مختلف عن MRZ؛ تم اعتماد رقم MRZ بعد التحقق");
    }

    const printedNationalDigits = normalizeDigits(vision.printed_national_id);
    const printedNational = printedNationalDigits.length === 14 ? parseEgyptianNationalId(printedNationalDigits) : null;
    if (printedNationalDigits && !printedNational) warnings.push("الرقم القومي المقروء يحتاج مراجعة");

    let optionalNational: ParsedNationalId | null = null;
    if (mrz?.optionalVerified && mrz.optionalData) {
      const optionalDigits = normalizeDigits(mrz.optionalData);
      const parsed = parseEgyptianNationalId(optionalDigits);
      if (parsed && mrz.dobYYMMDD === yymmddFromIso(parsed.dob) && (!mrz.sex || mrz.sex === parsed.sex)) {
        optionalNational = parsed;
      }
    }

    let national = printedNational || optionalNational;
    if (printedNational && optionalNational && printedNational.value !== optionalNational.value) {
      warnings.push("يوجد تعارض بين الرقم القومي المطبوع وبيانات MRZ؛ راجع الرقم القومي يدويًا");
      national = printedNational;
    }

    const printedDob = normalizeIsoDate(vision.printed_date_of_birth);
    const mrzDob = mrz?.dobVerified ? expandMrzDate(mrz.dobYYMMDD, printedDob || national?.dob || null, false) : null;
    let dob = printedDob || national?.dob || mrzDob;
    if (national && mrz?.dobVerified && yymmddFromIso(national.dob) === mrz.dobYYMMDD) dob = national.dob;
    else if (printedDob && mrz?.dobVerified && yymmddFromIso(printedDob) === mrz.dobYYMMDD) dob = printedDob;
    else if (national) dob = national.dob;
    else if (mrzDob) dob = mrzDob;

    if (printedDob && national && printedDob !== national.dob) warnings.push("تاريخ الميلاد المطبوع مختلف عن التاريخ المستخرج من الرقم القومي");
    if (dob && mrz?.dobVerified && yymmddFromIso(dob) !== mrz.dobYYMMDD) warnings.push("تاريخ الميلاد مختلف عن MRZ");

    const printedSex = normalizeSex(vision.printed_sex);
    let sex: Sex = mrz?.sex || national?.sex || printedSex;
    if (national && mrz?.sex && national.sex === mrz.sex) sex = mrz.sex;
    else if (national) sex = national.sex;
    if (printedSex && sex && printedSex !== sex) warnings.push("النوع المطبوع مختلف عن البيانات المرمزة؛ راجع النوع");

    const printedExpiry = normalizeIsoDate(vision.printed_expiry_date);
    const mrzExpiry = mrz?.expiryVerified ? expandMrzDate(mrz.expiryYYMMDD, printedExpiry, true) : null;
    const expiryDate = printedExpiry || mrzExpiry;
    if (printedExpiry && mrz?.expiryVerified && yymmddFromIso(printedExpiry) !== mrz.expiryYYMMDD) warnings.push("تاريخ انتهاء الجواز مختلف عن MRZ");

    const fullNameAr = cleanText(vision.printed_name_ar);
    const fullNameEn = cleanText(vision.printed_name_en) || mrz?.nameEn || null;
    const placeOfBirth = cleanText(vision.printed_place_of_birth);

    if (!fullNameAr && !fullNameEn) warnings.push("الاسم لم يُقرأ بوضوح");
    if (!passportNumber) warnings.push("رقم الجواز لم يُقرأ بوضوح");
    if (!national) warnings.push("الرقم القومي لم يتم التحقق منه");
    if (!dob) warnings.push("تاريخ الميلاد لم يتم التحقق منه");
    if (!placeOfBirth) warnings.push("محل الميلاد لم يُقرأ بوضوح");
    if (!sex) warnings.push("النوع لم يتم التحقق منه");

    const uniqueWarnings = Array.from(new Set(warnings));
    const mrzVerified = Boolean(
      mrz
      && mrz.passportVerified
      && mrz.dobVerified
      && mrz.expiryVerified
      && mrz.compositeVerified,
    );

    return respond(200, {
      ok: true,
      data: {
        full_name_ar: fullNameAr,
        full_name_en: fullNameEn,
        national_id: national?.value || null,
        date_of_birth: dob,
        place_of_birth: placeOfBirth,
        sex,
        passenger_type: passengerType(dob, sex),
        passport_number: passportNumber,
        expiry_date: expiryDate,
        mrz_verified: mrzVerified,
        needs_review: uniqueWarnings.length > 0,
        warnings: uniqueWarnings,
      },
    });
  } catch {
    return respond(500, { ok: false, error: "حدث خطأ أثناء قراءة الجواز" });
  } finally {
    // Do not persist or log the image. Drop the in-memory reference as soon as the request finishes.
    imageDataUrl = "";
  }
});
