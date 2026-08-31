import { useMemo, useRef, useState, type FormEvent } from "react";
import { FileText, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { scanPassportFile, type PassportScanData } from "@/components/PassportScanner";
import { usePerm } from "@/hooks/usePerm";
import { refetchLiveTables, useDropdownOptions, useLive, withSelected, type Agent } from "@/lib/db";
import { importExecutionRows } from "@/lib/dataImport/executionImport";

const MAX_PDF_BYTES = 50 * 1024 * 1024;
const MAX_PDF_PAGES = 50;
const PDF_RENDER_MAX_DIMENSION = 2200;

type PdfRow = {
  id: string;
  selected: boolean;
  label: string;
  passenger_name: string;
  national_id: string;
  dob: string;
  passenger_type: string;
  passport: string;
  birth_place: string;
  warnings: string[];
  needs_review: boolean;
  mrz_verified: boolean;
  saving: boolean;
  saved: boolean;
  save_error: string;
};

type CommonFields = {
  agent_id: string;
  status: string;
  operation_status: string;
  departure_from: string;
  destination: string;
  airline: string;
  travel_date: string;
};

const EMPTY_COMMON: CommonFields = {
  agent_id: "",
  status: "",
  operation_status: "",
  departure_from: "",
  destination: "",
  airline: "",
  travel_date: "",
};

function makeId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function rowFromScan(data: PassportScanData, label: string): PdfRow {
  return {
    id: makeId(),
    selected: true,
    label,
    passenger_name: data.full_name_ar || data.full_name_en || "",
    national_id: data.national_id || "",
    dob: data.date_of_birth || "",
    passenger_type: data.passenger_type || "",
    passport: data.passport_number || "",
    birth_place: data.place_of_birth || "",
    warnings: Array.isArray(data.warnings) ? data.warnings : [],
    needs_review: !!data.needs_review,
    mrz_verified: !!data.mrz_verified,
    saving: false,
    saved: false,
    save_error: "",
  };
}

function isPdfFile(file: File) {
  const mime = String(file.type || "").toLowerCase();
  const name = String(file.name || "").toLowerCase();
  return mime === "application/pdf" || name.endsWith(".pdf");
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return await new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("تعذر تحويل صفحة PDF إلى صورة"))),
      "image/jpeg",
      quality,
    );
  });
}

async function loadPdfJs() {
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const worker: any = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

async function renderPdfPage(pdf: any, pageNumber: number, sourceName: string): Promise<File> {
  const page = await pdf.getPage(pageNumber);
  const canvas = document.createElement("canvas");
  try {
    const base = page.getViewport({ scale: 1 });
    const longest = Math.max(Number(base.width) || 0, Number(base.height) || 0);
    if (!longest) throw new Error(`تعذر تحديد أبعاد صفحة ${pageNumber}`);
    const scale = Math.max(0.7, Math.min(2.4, PDF_RENDER_MAX_DIMENSION / longest));
    const viewport = page.getViewport({ scale });
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error(`تعذر تجهيز صفحة ${pageNumber}`);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport, background: "#ffffff" } as any).promise;

    let blob = await canvasToJpeg(canvas, 0.9);
    if (blob.size > 5_700_000) blob = await canvasToJpeg(canvas, 0.8);
    if (blob.size > 5_700_000) blob = await canvasToJpeg(canvas, 0.7);
    if (blob.size > 6_000_000) throw new Error(`صفحة ${pageNumber} كبيرة جدًا بعد التجهيز`);

    const safe = String(sourceName || "passports.pdf")
      .replace(/\.pdf$/i, "")
      .replace(/[^\p{L}\p{N}_-]+/gu, "-");
    return new File([blob], `${safe || "passport"}-page-${pageNumber}.jpg`, { type: "image/jpeg" });
  } finally {
    try { page.cleanup?.(); } catch { /* no-op */ }
    canvas.width = 1;
    canvas.height = 1;
  }
}

export function NativePdfPassportImporter() {
  const perm = usePerm("executions");
  const formRef = useRef<HTMLFormElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const { rows: agents } = useLive<Agent>("agents");
  const approvalStatuses = useDropdownOptions("execution_status");
  const operationStatuses = useDropdownOptions("operation_status");
  const departures = useDropdownOptions("departure_from");
  const destinations = useDropdownOptions("destination");
  const airlines = useDropdownOptions("airline");
  const passengerTypes = useDropdownOptions("passenger_type");

  const [rows, setRows] = useState<PdfRow[]>([]);
  const [common, setCommon] = useState<CommonFields>(EMPTY_COMMON);
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState("");
  const [selectedFileLabel, setSelectedFileLabel] = useState("");

  const activeAgents = useMemo(
    () => agents.filter((agent) => String(agent.status || "نشط") === "نشط"),
    [agents],
  );

  const selectedRows = rows.filter((row) => row.selected && !row.saved);

  const updateRow = (id: string, patch: Partial<PdfRow>) => {
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
  };

  const getNativeSelectedFile = (): File | null => {
    const form = formRef.current;
    if (!form) return null;
    const value = new FormData(form).get("passport_pdf");
    return value instanceof File && value.size > 0 ? value : null;
  };

  const processNativePdf = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (processing || saving) return;

    const file = getNativeSelectedFile();
    if (!file) {
      toast.error("المتصفح لم يحتفظ بملف PDF المختار. اختر الملف من خانة الاختيار الظاهرة ثم اضغط «ابدأ القراءة».");
      return;
    }
    if (!isPdfFile(file)) {
      toast.error("الملف المختار ليس PDF. اختر ملفًا بامتداد .pdf");
      return;
    }
    if (file.size > MAX_PDF_BYTES) {
      toast.error("حجم PDF أكبر من 50MB");
      return;
    }

    setSelectedFileLabel(`${file.name || "ملف PDF"} — ${formatBytes(file.size)}`);
    setRows([]);
    setProcessing(true);
    setProgress("تم استلام الملف من Android — جارِ فتح PDF...");

    let pdf: any = null;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!bytes.length) throw new Error("ملف PDF فارغ بعد القراءة من الهاتف");

      setProgress("جارِ تحميل أداة PDF...");
      const pdfjs = await loadPdfJs();
      const task = pdfjs.getDocument({ data: bytes, isEvalSupported: false, useWorkerFetch: false });
      pdf = await task.promise;

      if (!pdf.numPages) throw new Error("ملف PDF لا يحتوي صفحات قابلة للقراءة");
      if (pdf.numPages > MAX_PDF_PAGES) throw new Error(`الملف يحتوي ${pdf.numPages} صفحة والحد الأقصى ${MAX_PDF_PAGES}`);

      const extracted: PdfRow[] = [];
      let failed = 0;
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        setProgress(`جارِ قراءة صفحة ${pageNumber} من ${pdf.numPages}`);
        try {
          const image = await renderPdfPage(pdf, pageNumber, file.name);
          const data = await scanPassportFile(image);
          extracted.push(rowFromScan(data, `${file.name} — صفحة ${pageNumber}`));
          setRows([...extracted]);
        } catch (error: any) {
          failed++;
          toast.error(`صفحة ${pageNumber}: ${error?.message || "تعذر قراءة الجواز"}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      if (extracted.length) {
        toast.success(`تمت قراءة ${extracted.length} جواز من PDF${failed ? `، وفشل ${failed}` : ""}`);
      } else {
        toast.error("لم تتم قراءة أي جواز من PDF");
      }
    } catch (error: any) {
      toast.error(`تعذر قراءة PDF: ${error?.message || "خطأ غير معروف"}`);
    } finally {
      try { await pdf?.destroy?.(); } catch { /* no-op */ }
      setProgress("");
      setProcessing(false);
    }
  };

  const saveSelected = async () => {
    if (processing || saving) return;
    if (!perm.create) {
      toast.error("ليس لديك صلاحية إنشاء تنفيذات");
      return;
    }
    const selected = rows.filter((row) => row.selected && !row.saved);
    if (!selected.length) {
      toast.error("اختر مسافرًا واحدًا على الأقل");
      return;
    }
    const missingName = selected.find((row) => !row.passenger_name.trim());
    if (missingName) {
      toast.error(`راجع اسم المسافر في ${missingName.label}`);
      return;
    }
    if (common.operation_status.trim() === "منفذ") {
      toast.error("لا يمكن الحفظ الجماعي بحالة «منفذ» قبل استكمال الخدمات والأسعار");
      return;
    }

    setSaving(true);
    let savedCount = 0;
    let failedCount = 0;
    try {
      for (const row of selected) {
        updateRow(row.id, { saving: true, save_error: "" });
        const payload = {
          passenger_name: row.passenger_name.trim(),
          national_id: row.national_id.trim() || null,
          dob: row.dob || null,
          passenger_type: row.passenger_type || null,
          passport: row.passport.trim() || null,
          birth_place: row.birth_place.trim() || null,
          agent_id: common.agent_id || null,
          status: common.status || "",
          operation_status: common.operation_status || "",
          departure_from: common.departure_from || null,
          destination: common.destination || null,
          airline: common.airline || null,
          travel_date: common.travel_date || null,
          notes: null,
          approval_company_id: null,
          issue_date: null,
          approval_validity_enabled: false,
          services: [],
        };
        const result = await importExecutionRows([payload], () => {});
        if (result.insertedIds.length === 1 && result.failed === 0) {
          savedCount++;
          updateRow(row.id, { saving: false, saved: true, selected: false, save_error: "" });
        } else {
          failedCount++;
          updateRow(row.id, { saving: false, save_error: "تعذر إنشاء التنفيذ" });
        }
      }
      if (savedCount) await refetchLiveTables(["executions"]);
      if (savedCount) toast.success(`تم إنشاء ${savedCount} تنفيذ${failedCount ? `، وفشل ${failedCount}` : ""}`);
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
    <div dir="rtl" style={{ display: "grid", gap: 12, padding: 14, borderRadius: 14, border: "2px solid #d4af37", background: "#fffdf7" }}>
      <div>
        <div style={{ fontSize: 15, fontWeight: 950, color: "#0f1b3d", display: "flex", alignItems: "center", gap: 7 }}>
          <FileText size={18} /> PDF — وضع Android المباشر
        </div>
        <div style={{ marginTop: 5, fontSize: 12, color: "#64748b", lineHeight: 1.8 }}>
          هذه الخانة أصلية من المتصفح وليست زرًا مخفيًا. اختر ملف PDF أولًا، ثم اضغط «ابدأ قراءة PDF المختار». لا نعتمد على حدث change حتى لو Android لم يرسله.
        </div>
      </div>

      <form ref={formRef} onSubmit={(event) => void processNativePdf(event)} style={{ display: "grid", gap: 9 }}>
        <input
          ref={inputRef}
          name="passport_pdf"
          type="file"
          style={{ ...inputStyle, padding: 8, minHeight: 48 }}
          disabled={processing || saving}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) setSelectedFileLabel(`${file.name || "ملف"} — ${formatBytes(file.size)}`);
          }}
        />
        <button
          type="submit"
          disabled={processing || saving}
          style={{ minHeight: 43, border: 0, borderRadius: 10, padding: "9px 14px", background: "#0f1b3d", color: "#fff", fontWeight: 900, cursor: processing ? "wait" : "pointer" }}
        >
          {processing ? <><Loader2 size={16} className="animate-spin" style={{ display: "inline", marginLeft: 6 }} />{progress || "جارِ قراءة PDF..."}</> : "ابدأ قراءة PDF المختار"}
        </button>
      </form>

      {selectedFileLabel && (
        <div style={{ padding: 9, borderRadius: 9, background: "#fffbeb", border: "1px solid #fde68a", color: "#854d0e", fontSize: 12, fontWeight: 800 }}>
          الملف المختار: {selectedFileLabel}
        </div>
      )}

      <div style={{ display: "flex", gap: 6, alignItems: "center", color: "#166534", fontSize: 12, fontWeight: 800 }}>
        <ShieldCheck size={15} /> PDF لا يُحفظ في Supabase أو قاعدة البيانات؛ يُستخدم مؤقتًا في المتصفح فقط.
      </div>

      {rows.length > 0 && (
        <>
          <div style={{ padding: 12, border: "1px solid #e2e8f0", borderRadius: 12, background: "#fff" }}>
            <div style={{ fontWeight: 900, color: "#0f1b3d", marginBottom: 9 }}>بيانات مشتركة لكل تنفيذات الـPDF</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(145px,1fr))", gap: 8 }}>
              <label style={{ fontSize: 11, fontWeight: 800 }}>الوكيل<select style={inputStyle} value={common.agent_id} onChange={(e) => setCommon((v) => ({ ...v, agent_id: e.target.value }))}><option value="">—</option>{activeAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
              <label style={{ fontSize: 11, fontWeight: 800 }}>حالة الموافقة<select style={inputStyle} value={common.status} onChange={(e) => setCommon((v) => ({ ...v, status: e.target.value }))}><option value="">—</option>{renderOptions(approvalStatuses, common.status)}</select></label>
              <label style={{ fontSize: 11, fontWeight: 800 }}>حالة العملية<select style={inputStyle} value={common.operation_status} onChange={(e) => setCommon((v) => ({ ...v, operation_status: e.target.value }))}><option value="">—</option>{renderOptions(operationStatuses, common.operation_status)}</select></label>
              <label style={{ fontSize: 11, fontWeight: 800 }}>جهة المغادرة<select style={inputStyle} value={common.departure_from} onChange={(e) => setCommon((v) => ({ ...v, departure_from: e.target.value }))}><option value="">—</option>{renderOptions(departures, common.departure_from)}</select></label>
              <label style={{ fontSize: 11, fontWeight: 800 }}>الوجهة<select style={inputStyle} value={common.destination} onChange={(e) => setCommon((v) => ({ ...v, destination: e.target.value }))}><option value="">—</option>{renderOptions(destinations, common.destination)}</select></label>
              <label style={{ fontSize: 11, fontWeight: 800 }}>الطيران<select style={inputStyle} value={common.airline} onChange={(e) => setCommon((v) => ({ ...v, airline: e.target.value }))}><option value="">—</option>{renderOptions(airlines, common.airline)}</select></label>
              <label style={{ fontSize: 11, fontWeight: 800 }}>تاريخ المغادرة<input type="date" style={inputStyle} value={common.travel_date} onChange={(e) => setCommon((v) => ({ ...v, travel_date: e.target.value }))} /></label>
            </div>
          </div>

          {rows.map((row, index) => {
            const editable = !row.saved && !row.saving;
            return (
              <div key={row.id} style={{ padding: 12, borderRadius: 12, border: `1px solid ${row.needs_review ? "#fde68a" : "#e2e8f0"}`, background: "#fff", opacity: row.saved ? 0.72 : 1 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 9 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                    <input type="checkbox" checked={row.selected} disabled={!editable} onChange={(e) => updateRow(row.id, { selected: e.target.checked })} />
                    <strong style={{ color: "#0f1b3d" }}>مسافر {index + 1}</strong>
                    <span style={{ fontSize: 11, color: "#64748b" }}>{row.label}</span>
                    {row.mrz_verified && <span style={{ fontSize: 11, color: "#166534", fontWeight: 900 }}>MRZ ✓</span>}
                    {row.needs_review && <span style={{ fontSize: 11, color: "#92400e", fontWeight: 900 }}>يحتاج مراجعة</span>}
                    {row.saved && <span style={{ fontSize: 11, color: "#166534", fontWeight: 900 }}>تم إنشاء التنفيذ</span>}
                  </div>
                  {!row.saved && <button type="button" disabled={processing || saving} onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))} style={{ border: 0, background: "transparent", color: "#b91c1c", cursor: "pointer" }}><Trash2 size={17} /></button>}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(145px,1fr))", gap: 8 }}>
                  <label style={{ fontSize: 11, fontWeight: 800 }}>اسم المسافر<input style={inputStyle} disabled={!editable} value={row.passenger_name} onChange={(e) => updateRow(row.id, { passenger_name: e.target.value })} /></label>
                  <label style={{ fontSize: 11, fontWeight: 800 }}>الرقم القومي<input style={inputStyle} disabled={!editable} value={row.national_id} onChange={(e) => updateRow(row.id, { national_id: e.target.value })} /></label>
                  <label style={{ fontSize: 11, fontWeight: 800 }}>تاريخ الميلاد<input type="date" style={inputStyle} disabled={!editable} value={row.dob} onChange={(e) => updateRow(row.id, { dob: e.target.value })} /></label>
                  <label style={{ fontSize: 11, fontWeight: 800 }}>نوع المسافر<select style={inputStyle} disabled={!editable} value={row.passenger_type} onChange={(e) => updateRow(row.id, { passenger_type: e.target.value })}><option value="">—</option>{renderOptions(passengerTypes, row.passenger_type)}</select></label>
                  <label style={{ fontSize: 11, fontWeight: 800 }}>رقم الجواز<input style={inputStyle} disabled={!editable} value={row.passport} onChange={(e) => updateRow(row.id, { passport: e.target.value })} /></label>
                  <label style={{ fontSize: 11, fontWeight: 800 }}>محل الميلاد<input style={inputStyle} disabled={!editable} value={row.birth_place} onChange={(e) => updateRow(row.id, { birth_place: e.target.value })} /></label>
                </div>

                {row.warnings.length > 0 && <div style={{ marginTop: 8, padding: 8, borderRadius: 8, background: "#fffbeb", color: "#92400e", fontSize: 11, fontWeight: 700 }}>{row.warnings.join("، ")}</div>}
                {row.save_error && <div style={{ marginTop: 8, color: "#b91c1c", fontSize: 11, fontWeight: 800 }}>{row.save_error}</div>}
              </div>
            );
          })}

          <button
            type="button"
            disabled={!perm.create || processing || saving || selectedRows.length === 0}
            onClick={() => void saveSelected()}
            style={{ minHeight: 44, border: 0, borderRadius: 10, padding: "10px 16px", background: "#0f1b3d", color: "#fff", fontWeight: 900, cursor: saving ? "wait" : "pointer", opacity: !perm.create || selectedRows.length === 0 ? 0.55 : 1 }}
          >
            {saving ? "جارِ إنشاء التنفيذات..." : `إنشاء التنفيذات المحددة (${selectedRows.length})`}
          </button>
        </>
      )}
    </div>
  );
}
