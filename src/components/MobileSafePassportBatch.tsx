import { useMemo, useRef, useState } from "react";
import { Camera, FileText, Loader2, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { scanPassportFile, type PassportScanData } from "@/components/PassportScanner";
import { usePerm } from "@/hooks/usePerm";
import { refetchLiveTables, useDropdownOptions, useLive, withSelected, type Agent } from "@/lib/db";
import { importExecutionRows } from "@/lib/dataImport/executionImport";

const MAX_BATCH_ITEMS = 50;
const MAX_PDF_BYTES = 50 * 1024 * 1024;
const PDF_RENDER_MAX_DIMENSION = 2400;

type RowState = "ready" | "review" | "saving" | "saved" | "save_error";

type BatchRow = {
  id: string;
  sourceLabel: string;
  selected: boolean;
  state: RowState;
  error: string;
  warnings: string[];
  mrzVerified: boolean;
  passenger_name: string;
  national_id: string;
  dob: string;
  passenger_type: string;
  passport: string;
  birth_place: string;
  agent_id: string;
  approval_status: string;
  operation_status: string;
  departure_from: string;
  destination: string;
  airline: string;
  travel_date: string;
};

type CommonFields = Pick<
  BatchRow,
  "agent_id" | "approval_status" | "operation_status" | "departure_from" | "destination" | "airline" | "travel_date"
>;

const EMPTY_COMMON: CommonFields = {
  agent_id: "",
  approval_status: "",
  operation_status: "",
  departure_from: "",
  destination: "",
  airline: "",
  travel_date: "",
};

function rowId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function rowFromScan(data: PassportScanData, sourceLabel: string): BatchRow {
  return {
    id: rowId(),
    sourceLabel,
    selected: true,
    state: data.needs_review ? "review" : "ready",
    error: "",
    warnings: Array.isArray(data.warnings) ? data.warnings : [],
    mrzVerified: !!data.mrz_verified,
    passenger_name: data.full_name_ar || data.full_name_en || "",
    national_id: data.national_id || "",
    dob: data.date_of_birth || "",
    passenger_type: data.passenger_type || "",
    passport: data.passport_number || "",
    birth_place: data.place_of_birth || "",
    ...EMPTY_COMMON,
  };
}

async function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return await new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("تعذر تجهيز صفحة PDF كصورة"))),
      "image/jpeg",
      quality,
    );
  });
}

async function loadPdfJs() {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

async function renderPdfPage(pdf: any, pageNumber: number, sourceName: string): Promise<File> {
  const page = await pdf.getPage(pageNumber);
  const canvas = document.createElement("canvas");
  try {
    const baseViewport = page.getViewport({ scale: 1 });
    const longest = Math.max(Number(baseViewport.width) || 0, Number(baseViewport.height) || 0);
    if (!longest) throw new Error("تعذر تحديد أبعاد صفحة PDF");
    const scale = Math.max(0.6, Math.min(2.6, PDF_RENDER_MAX_DIMENSION / longest));
    const viewport = page.getViewport({ scale });
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("تعذر تجهيز صفحة PDF للقراءة");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport } as any).promise;

    let blob = await canvasToJpeg(canvas, 0.92);
    if (blob.size > 5_800_000) blob = await canvasToJpeg(canvas, 0.82);
    if (blob.size > 5_800_000) blob = await canvasToJpeg(canvas, 0.72);
    if (blob.size > 6_000_000) {
      throw new Error("صفحة PDF كبيرة جدًا بعد التجهيز؛ استخدم صورة أو PDF أوضح وأخف");
    }
    const safeBase = String(sourceName || "passports.pdf")
      .replace(/\.pdf$/i, "")
      .replace(/[^\p{L}\p{N}_-]+/gu, "-");
    return new File([blob], `${safeBase || "passport"}-page-${pageNumber}.jpg`, { type: "image/jpeg" });
  } finally {
    try {
      page.cleanup?.();
    } catch {
      // no-op
    }
    canvas.width = 1;
    canvas.height = 1;
  }
}

function normalizePassport(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

function normalizeNationalId(value: string) {
  return value.replace(/\D/g, "");
}

export function MobileSafePassportBatch() {
  const perm = usePerm("executions");
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const pdfInputRef = useRef<HTMLInputElement | null>(null);

  const { rows: agents } = useLive<Agent>("agents");
  const approvalStatuses = useDropdownOptions("execution_status");
  const operationStatuses = useDropdownOptions("operation_status");
  const departures = useDropdownOptions("departure_from");
  const destinations = useDropdownOptions("destination");
  const airlines = useDropdownOptions("airline");
  const passengerTypes = useDropdownOptions("passenger_type");

  const [rows, setRows] = useState<BatchRow[]>([]);
  const [readingImage, setReadingImage] = useState(false);
  const [readingPdf, setReadingPdf] = useState(false);
  const [pdfProgress, setPdfProgress] = useState("");
  const [saving, setSaving] = useState(false);
  const [common, setCommon] = useState<CommonFields>(EMPTY_COMMON);

  const activeAgents = useMemo(
    () => agents.filter((agent) => String(agent.status || "نشط") === "نشط"),
    [agents],
  );

  const duplicateIds = useMemo(() => {
    const passports = new Map<string, string[]>();
    const nationalIds = new Map<string, string[]>();
    for (const row of rows) {
      if (row.state === "saved") continue;
      const passport = normalizePassport(row.passport);
      const nationalId = normalizeNationalId(row.national_id);
      if (passport) passports.set(passport, [...(passports.get(passport) || []), row.id]);
      if (nationalId) nationalIds.set(nationalId, [...(nationalIds.get(nationalId) || []), row.id]);
    }
    const result = new Set<string>();
    for (const ids of [...passports.values(), ...nationalIds.values()]) {
      if (ids.length > 1) ids.forEach((id) => result.add(id));
    }
    return result;
  }, [rows]);

  const selectedCount = rows.filter((row) => row.selected && row.state !== "saved").length;
  const busy = readingImage || readingPdf || saving;

  const updateRow = (id: string, patch: Partial<BatchRow>) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const appendScan = (data: PassportScanData, sourceLabel: string) => {
    setRows((current) => {
      if (current.length >= MAX_BATCH_ITEMS) return current;
      return [...current, rowFromScan(data, sourceLabel)];
    });
  };

  const addOneImage = async (file: File) => {
    if (rows.length >= MAX_BATCH_ITEMS) {
      toast.error(`الحد الأقصى ${MAX_BATCH_ITEMS} جواز في الدفعة`);
      return;
    }
    setReadingImage(true);
    try {
      const data = await scanPassportFile(file);
      appendScan(data, file.name || `صورة ${rows.length + 1}`);
      if (data.needs_review) toast.warning("تمت إضافة الجواز للدفعة ويحتاج مراجعة");
      else toast.success("تمت إضافة الجواز للدفعة");
    } catch (error: any) {
      toast.error(error?.message || "تعذر قراءة صورة الجواز");
    } finally {
      setReadingImage(false);
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
  };

  const addPdf = async (file: File) => {
    if (file.size <= 0) {
      toast.error("ملف PDF فارغ");
      return;
    }
    if (file.size > MAX_PDF_BYTES) {
      toast.error("حجم ملف PDF أكبر من 50MB");
      return;
    }
    setReadingPdf(true);
    setPdfProgress("جارِ فتح ملف PDF...");
    let success = 0;
    let failed = 0;
    try {
      const pdfjs = await loadPdfJs();
      const bytes = new Uint8Array(await file.arrayBuffer());
      const loadingTask = pdfjs.getDocument({ data: bytes });
      const pdf = await loadingTask.promise;
      try {
        const available = MAX_BATCH_ITEMS - rows.length;
        if (available <= 0) throw new Error(`الدفعة وصلت للحد الأقصى ${MAX_BATCH_ITEMS}`);
        if (pdf.numPages > available) {
          throw new Error(`الملف يحتوي ${pdf.numPages} صفحة والمتاح في الدفعة ${available} فقط`);
        }
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
          setPdfProgress(`جارِ قراءة صفحة ${pageNumber} من ${pdf.numPages}`);
          try {
            const pageFile = await renderPdfPage(pdf, pageNumber, file.name);
            const data = await scanPassportFile(pageFile);
            appendScan(data, `${file.name} — صفحة ${pageNumber}`);
            success++;
          } catch (error) {
            failed++;
            const message = error instanceof Error ? error.message : "تعذر قراءة الصفحة";
            toast.error(`صفحة ${pageNumber}: ${message}`);
          }
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      } finally {
        await pdf.destroy();
      }
      if (success) toast.success(`تمت إضافة ${success} جواز من PDF${failed ? `، وفشل ${failed}` : ""}`);
      else if (failed) toast.error("تعذر قراءة أي صفحة من ملف PDF");
    } catch (error: any) {
      toast.error(error?.message || "تعذر تجهيز ملف PDF");
    } finally {
      setPdfProgress("");
      setReadingPdf(false);
      if (pdfInputRef.current) pdfInputRef.current.value = "";
    }
  };

  const applyCommonToSelected = () => {
    setRows((current) => current.map((row) => {
      if (!row.selected || row.state === "saved") return row;
      return { ...row, ...common };
    }));
  };

  const removeRow = (id: string) => {
    if (busy) return;
    setRows((current) => current.filter((row) => row.id !== id));
  };

  const clearBatch = () => {
    if (busy) return;
    if (rows.length && !window.confirm("مسح كل البيانات المقروءة في الدفعة الحالية؟")) return;
    setRows([]);
    setCommon(EMPTY_COMMON);
  };

  const saveSelected = async () => {
    if (busy) return;
    if (!perm.create) {
      toast.error("ليس لديك صلاحية إنشاء تنفيذات");
      return;
    }
    const selected = rows.filter((row) => row.selected && row.state !== "saved");
    if (!selected.length) {
      toast.error("اختر مسافرًا واحدًا على الأقل");
      return;
    }
    const missingName = selected.find((row) => !row.passenger_name.trim());
    if (missingName) {
      toast.error(`راجع اسم المسافر في ${missingName.sourceLabel}`);
      return;
    }
    if (selected.some((row) => row.operation_status.trim() === "منفذ")) {
      toast.error("لا يمكن الحفظ الجماعي بحالة «منفذ» قبل استكمال الخدمات والأسعار");
      return;
    }
    if (selected.some((row) => duplicateIds.has(row.id))) {
      if (!window.confirm("يوجد رقم جواز أو رقم قومي مكرر داخل الدفعة. هل تريد الاستمرار بعد المراجعة؟")) return;
    }

    setSaving(true);
    let savedCount = 0;
    let failedCount = 0;
    try {
      for (const row of selected) {
        updateRow(row.id, { state: "saving", error: "" });
        const payload = {
          passenger_name: row.passenger_name.trim(),
          national_id: row.national_id.trim() || null,
          dob: row.dob || null,
          passenger_type: row.passenger_type || null,
          passport: row.passport.trim() || null,
          birth_place: row.birth_place.trim() || null,
          agent_id: row.agent_id || null,
          status: row.approval_status || "",
          operation_status: row.operation_status || "",
          departure_from: row.departure_from || null,
          destination: row.destination || null,
          airline: row.airline || null,
          travel_date: row.travel_date || null,
          notes: null,
          approval_company_id: null,
          issue_date: null,
          approval_validity_enabled: false,
          services: [],
        };
        const result = await importExecutionRows([payload], () => {});
        if (result.insertedIds.length === 1 && result.failed === 0) {
          savedCount++;
          updateRow(row.id, { state: "saved", selected: false, error: "" });
        } else {
          failedCount++;
          updateRow(row.id, { state: "save_error", error: "تعذر إنشاء التنفيذ. راجع البيانات ثم أعد المحاولة" });
        }
      }
      if (savedCount) await refetchLiveTables(["executions"]);
      if (savedCount) toast.success(`تم إنشاء ${savedCount} تنفيذ${failedCount ? `، وتعذر حفظ ${failedCount}` : ""}`);
      else toast.error("لم يتم إنشاء أي تنفيذ");
    } finally {
      setSaving(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    minHeight: 38,
    border: "1px solid #dbe3ee",
    borderRadius: 8,
    padding: "7px 8px",
    background: "#fff",
    color: "#0f172a",
    fontSize: 12,
  };

  const renderOptions = (options: readonly string[], current: string) =>
    withSelected(options, current).map((value) => <option key={value} value={value}>{value}</option>);

  return (
    <div dir="rtl" style={{ display: "grid", gap: 14 }}>
      <input
        ref={imageInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
        hidden
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) void addOneImage(file);
        }}
      />
      <input
        ref={pdfInputRef}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) void addPdf(file);
        }}
      />

      <div style={{ padding: 14, borderRadius: 12, border: "1px solid #dbe3ee", background: "#f8fafc" }}>
        <div style={{ display: "flex", gap: 9, flexWrap: "wrap", alignItems: "center" }}>
          <button
            type="button"
            disabled={busy || rows.length >= MAX_BATCH_ITEMS}
            onClick={() => imageInputRef.current?.click()}
            style={{ minHeight: 42, border: 0, borderRadius: 10, padding: "9px 14px", background: "#0f1b3d", color: "#fff", fontWeight: 900, display: "inline-flex", alignItems: "center", gap: 7, cursor: busy ? "wait" : "pointer" }}
          >
            {readingImage ? <Loader2 size={17} className="animate-spin" /> : rows.length ? <Plus size={17} /> : <Camera size={17} />}
            {readingImage ? "جارِ قراءة الصورة..." : rows.length ? "إضافة صورة جواز أخرى" : "إضافة أول صورة جواز"}
          </button>
          <button
            type="button"
            disabled={busy || rows.length >= MAX_BATCH_ITEMS}
            onClick={() => pdfInputRef.current?.click()}
            style={{ minHeight: 42, border: "1px solid #d4af37", borderRadius: 10, padding: "9px 14px", background: "#fffaf0", color: "#0f1b3d", fontWeight: 900, display: "inline-flex", alignItems: "center", gap: 7, cursor: busy ? "wait" : "pointer" }}
          >
            {readingPdf ? <Loader2 size={17} className="animate-spin" /> : <FileText size={17} />}
            {readingPdf ? pdfProgress || "جارِ قراءة PDF..." : "رفع ملف PDF جوازات"}
          </button>
          {rows.length > 0 && (
            <button type="button" disabled={busy} onClick={clearBatch} style={{ minHeight: 40, border: "1px solid #fecaca", borderRadius: 10, padding: "8px 12px", background: "#fff", color: "#b91c1c", fontWeight: 800, cursor: "pointer" }}>
              مسح الدفعة
            </button>
          )}
        </div>
        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", fontSize: 12, lineHeight: 1.7 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#166534", fontWeight: 900 }}>
            <ShieldCheck size={15} /> الصور وPDF لا يتم حفظهم في Supabase
          </span>
          <span style={{ color: "#64748b", fontWeight: 700 }}>
            على الموبايل أضف الصور واحدة وراء الثانية لنفس الدفعة لتجنب مشكلة Android مع اختيار عدة ملفات مرة واحدة.
          </span>
        </div>
      </div>

      {rows.length > 0 && (
        <div style={{ padding: 12, border: "1px solid #e2e8f0", borderRadius: 12, background: "#fff" }}>
          <div style={{ fontWeight: 900, color: "#0f1b3d", marginBottom: 10 }}>بيانات مشتركة للمسافرين المحددين</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8 }}>
            <label style={{ fontSize: 11, fontWeight: 800 }}>الوكيل
              <select style={inputStyle} value={common.agent_id} onChange={(e) => setCommon((v) => ({ ...v, agent_id: e.target.value }))}>
                <option value="">—</option>
                {activeAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
              </select>
            </label>
            <label style={{ fontSize: 11, fontWeight: 800 }}>حالة الموافقة
              <select style={inputStyle} value={common.approval_status} onChange={(e) => setCommon((v) => ({ ...v, approval_status: e.target.value }))}>
                <option value="">—</option>{renderOptions(approvalStatuses, common.approval_status)}
              </select>
            </label>
            <label style={{ fontSize: 11, fontWeight: 800 }}>حالة العملية
              <select style={inputStyle} value={common.operation_status} onChange={(e) => setCommon((v) => ({ ...v, operation_status: e.target.value }))}>
                <option value="">—</option>{renderOptions(operationStatuses, common.operation_status)}
              </select>
            </label>
            <label style={{ fontSize: 11, fontWeight: 800 }}>جهة المغادرة
              <select style={inputStyle} value={common.departure_from} onChange={(e) => setCommon((v) => ({ ...v, departure_from: e.target.value }))}>
                <option value="">—</option>{renderOptions(departures, common.departure_from)}
              </select>
            </label>
            <label style={{ fontSize: 11, fontWeight: 800 }}>الوجهة
              <select style={inputStyle} value={common.destination} onChange={(e) => setCommon((v) => ({ ...v, destination: e.target.value }))}>
                <option value="">—</option>{renderOptions(destinations, common.destination)}
              </select>
            </label>
            <label style={{ fontSize: 11, fontWeight: 800 }}>الطيران
              <select style={inputStyle} value={common.airline} onChange={(e) => setCommon((v) => ({ ...v, airline: e.target.value }))}>
                <option value="">—</option>{renderOptions(airlines, common.airline)}
              </select>
            </label>
            <label style={{ fontSize: 11, fontWeight: 800 }}>تاريخ المغادرة
              <input type="date" style={inputStyle} value={common.travel_date} onChange={(e) => setCommon((v) => ({ ...v, travel_date: e.target.value }))} />
            </label>
          </div>
          <button type="button" onClick={applyCommonToSelected} disabled={busy || selectedCount === 0} style={{ marginTop: 10, minHeight: 38, border: "1px solid #dbe3ee", borderRadius: 9, padding: "7px 12px", background: "#fff", color: "#0f1b3d", fontWeight: 900, cursor: "pointer" }}>
            تطبيق على المحدد ({selectedCount})
          </button>
        </div>
      )}

      {rows.map((row, index) => {
        const duplicate = duplicateIds.has(row.id);
        const editable = row.state !== "saving" && row.state !== "saved";
        const statusText = row.state === "saved" ? "تم إنشاء التنفيذ" : row.state === "saving" ? "جارِ الحفظ" : row.state === "save_error" ? "فشل الحفظ" : row.state === "review" ? "يحتاج مراجعة" : "جاهز";
        const statusBg = row.state === "saved" || row.state === "ready" ? "#f0fdf4" : row.state === "review" ? "#fffbeb" : row.state === "save_error" ? "#fef2f2" : "#f8fafc";
        const statusColor = row.state === "saved" || row.state === "ready" ? "#166534" : row.state === "review" ? "#92400e" : row.state === "save_error" ? "#b91c1c" : "#475569";
        return (
          <div key={row.id} style={{ border: `1px solid ${duplicate ? "#fdba74" : "#e2e8f0"}`, borderRadius: 12, background: "#fff", padding: 12, opacity: row.state === "saved" ? 0.72 : 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input type="checkbox" checked={row.selected} disabled={!editable} onChange={(e) => updateRow(row.id, { selected: e.target.checked })} />
                <strong style={{ color: "#0f1b3d" }}>مسافر {index + 1}</strong>
                <span style={{ color: "#64748b", fontSize: 11 }}>{row.sourceLabel}</span>
                <span style={{ padding: "3px 8px", borderRadius: 999, background: statusBg, color: statusColor, fontSize: 11, fontWeight: 900 }}>{statusText}</span>
                {row.mrzVerified && <span style={{ color: "#166534", fontSize: 11, fontWeight: 900 }}>MRZ ✓</span>}
                {duplicate && <span style={{ color: "#c2410c", fontSize: 11, fontWeight: 900 }}>مكرر داخل الدفعة</span>}
              </div>
              {row.state !== "saved" && (
                <button type="button" disabled={busy} onClick={() => removeRow(row.id)} title="حذف من الدفعة" style={{ border: 0, background: "transparent", color: "#b91c1c", cursor: "pointer", padding: 4 }}>
                  <Trash2 size={17} />
                </button>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(145px,1fr))", gap: 8 }}>
              <label style={{ fontSize: 11, fontWeight: 800 }}>اسم المسافر
                <input style={inputStyle} disabled={!editable} value={row.passenger_name} onChange={(e) => updateRow(row.id, { passenger_name: e.target.value })} />
              </label>
              <label style={{ fontSize: 11, fontWeight: 800 }}>الرقم القومي
                <input style={inputStyle} disabled={!editable} value={row.national_id} onChange={(e) => updateRow(row.id, { national_id: e.target.value })} />
              </label>
              <label style={{ fontSize: 11, fontWeight: 800 }}>تاريخ الميلاد
                <input type="date" style={inputStyle} disabled={!editable} value={row.dob} onChange={(e) => updateRow(row.id, { dob: e.target.value })} />
              </label>
              <label style={{ fontSize: 11, fontWeight: 800 }}>نوع المسافر
                <select style={inputStyle} disabled={!editable} value={row.passenger_type} onChange={(e) => updateRow(row.id, { passenger_type: e.target.value })}>
                  <option value="">—</option>{renderOptions(passengerTypes, row.passenger_type)}
                </select>
              </label>
              <label style={{ fontSize: 11, fontWeight: 800 }}>رقم الجواز
                <input style={inputStyle} disabled={!editable} value={row.passport} onChange={(e) => updateRow(row.id, { passport: e.target.value })} />
              </label>
              <label style={{ fontSize: 11, fontWeight: 800 }}>محل الميلاد
                <input style={inputStyle} disabled={!editable} value={row.birth_place} onChange={(e) => updateRow(row.id, { birth_place: e.target.value })} />
              </label>
              <label style={{ fontSize: 11, fontWeight: 800 }}>الوكيل
                <select style={inputStyle} disabled={!editable} value={row.agent_id} onChange={(e) => updateRow(row.id, { agent_id: e.target.value })}>
                  <option value="">—</option>{activeAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                </select>
              </label>
              <label style={{ fontSize: 11, fontWeight: 800 }}>حالة الموافقة
                <select style={inputStyle} disabled={!editable} value={row.approval_status} onChange={(e) => updateRow(row.id, { approval_status: e.target.value })}>
                  <option value="">—</option>{renderOptions(approvalStatuses, row.approval_status)}
                </select>
              </label>
              <label style={{ fontSize: 11, fontWeight: 800 }}>حالة العملية
                <select style={inputStyle} disabled={!editable} value={row.operation_status} onChange={(e) => updateRow(row.id, { operation_status: e.target.value })}>
                  <option value="">—</option>{renderOptions(operationStatuses, row.operation_status)}
                </select>
              </label>
              <label style={{ fontSize: 11, fontWeight: 800 }}>جهة المغادرة
                <select style={inputStyle} disabled={!editable} value={row.departure_from} onChange={(e) => updateRow(row.id, { departure_from: e.target.value })}>
                  <option value="">—</option>{renderOptions(departures, row.departure_from)}
                </select>
              </label>
              <label style={{ fontSize: 11, fontWeight: 800 }}>الوجهة
                <select style={inputStyle} disabled={!editable} value={row.destination} onChange={(e) => updateRow(row.id, { destination: e.target.value })}>
                  <option value="">—</option>{renderOptions(destinations, row.destination)}
                </select>
              </label>
              <label style={{ fontSize: 11, fontWeight: 800 }}>الطيران
                <select style={inputStyle} disabled={!editable} value={row.airline} onChange={(e) => updateRow(row.id, { airline: e.target.value })}>
                  <option value="">—</option>{renderOptions(airlines, row.airline)}
                </select>
              </label>
              <label style={{ fontSize: 11, fontWeight: 800 }}>تاريخ المغادرة
                <input type="date" style={inputStyle} disabled={!editable} value={row.travel_date} onChange={(e) => updateRow(row.id, { travel_date: e.target.value })} />
              </label>
            </div>
            {row.warnings.length > 0 && <div style={{ marginTop: 9, padding: 8, borderRadius: 8, background: "#fffbeb", color: "#92400e", fontSize: 11, fontWeight: 700 }}>{row.warnings.join("، ")}</div>}
            {row.error && <div style={{ marginTop: 9, padding: 8, borderRadius: 8, background: "#fef2f2", color: "#b91c1c", fontSize: 11, fontWeight: 700 }}>{row.error}</div>}
          </div>
        );
      })}

      {rows.length === 0 && (
        <div style={{ minHeight: 150, border: "1px dashed #cbd5e1", borderRadius: 12, display: "grid", placeItems: "center", padding: 20, textAlign: "center", color: "#64748b" }}>
          <div>
            <div style={{ fontWeight: 900, color: "#334155" }}>ابدأ بصورة جواز واحدة أو ملف PDF</div>
            <div style={{ marginTop: 6, fontSize: 12 }}>كل صورة جديدة تُضاف لنفس الدفعة، وبعد الانتهاء تحفظ كل التنفيذات المحددة مرة واحدة.</div>
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ position: "sticky", bottom: 8, zIndex: 5, padding: 10, borderRadius: 12, background: "rgba(255,255,255,.96)", border: "1px solid #dbe3ee", boxShadow: "0 8px 25px rgba(15,23,42,.10)", display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ color: "#475569", fontSize: 12, fontWeight: 800 }}>الدفعة: {rows.length} — المحدد: {selectedCount}</span>
          <button type="button" disabled={!perm.create || busy || selectedCount === 0} onClick={() => void saveSelected()} style={{ minHeight: 42, border: 0, borderRadius: 10, padding: "9px 16px", background: "#0f1b3d", color: "#fff", fontWeight: 900, cursor: busy ? "wait" : "pointer", opacity: !perm.create || selectedCount === 0 ? 0.55 : 1 }}>
            {saving ? "جارِ إنشاء التنفيذات..." : `إنشاء التنفيذات المحددة (${selectedCount})`}
          </button>
        </div>
      )}
    </div>
  );
}
