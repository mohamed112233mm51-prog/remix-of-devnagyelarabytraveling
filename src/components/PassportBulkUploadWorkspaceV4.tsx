import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Camera, FileText, Images, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { scanPassportFile, type PassportScanData } from "@/components/PassportScanner";
import { usePerm } from "@/hooks/usePerm";
import { refetchLiveTables, useDropdownOptions, useLive, withSelected, type Agent } from "@/lib/db";
import { importExecutionRows } from "@/lib/dataImport/executionImport";

const MAX_BATCH_ITEMS = 50;
const MAX_PDF_BYTES = 50 * 1024 * 1024;
const PDF_RENDER_MAX_DIMENSION = 1500;
const PDF_RENDER_TIMEOUT_MS = 9000;
const PDF_OCR_CONCURRENCY = 2;
const SESSION_KEY = "passport-bulk-upload:text-draft:v4";

type RowState = "waiting" | "rendering" | "reading" | "ready" | "review" | "error" | "saving" | "saved" | "save_error";

type BatchRow = {
  id: string;
  sourceLabel: string;
  pageNumber?: number;
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

type CommonFields = Pick<BatchRow, "agent_id" | "approval_status" | "operation_status" | "departure_from" | "destination" | "airline" | "travel_date">;

const EMPTY_COMMON: CommonFields = {
  agent_id: "",
  approval_status: "",
  operation_status: "",
  departure_from: "",
  destination: "",
  airline: "",
  travel_date: "",
};

const EMPTY_ROWS: BatchRow[] = [];
let pdfJsPromise: Promise<any> | null = null;
let rowStore: BatchRow[] | null = null;
const rowListeners = new Set<() => void>();

function makeId() {
  try { return crypto.randomUUID(); } catch { return `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
}

function emptyRow(sourceLabel: string, pageNumber?: number): BatchRow {
  return {
    id: makeId(), sourceLabel, pageNumber, selected: false, state: "waiting", error: "", warnings: [], mrzVerified: false,
    passenger_name: "", national_id: "", dob: "", passenger_type: "", passport: "", birth_place: "",
    ...EMPTY_COMMON,
  };
}

function normalizeStoredRows(value: unknown): BatchRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item: any) => item && typeof item.id === "string")
    .slice(0, MAX_BATCH_ITEMS)
    .map((item: any) => {
      const state = String(item.state || "error") as RowState;
      const interrupted = ["waiting", "rendering", "reading"].includes(state);
      const savingInterrupted = state === "saving";
      return {
        ...emptyRow(String(item.sourceLabel || "جواز"), Number.isFinite(item.pageNumber) ? Number(item.pageNumber) : undefined),
        ...item,
        selected: interrupted ? false : Boolean(item.selected),
        state: interrupted ? "error" : savingInterrupted ? "save_error" : state,
        error: interrupted
          ? "توقفت معالجة هذا الصف بسبب إعادة تحميل الصفحة؛ أعد رفع المصدر لإكماله"
          : savingInterrupted
            ? "تعذر تأكيد الحفظ بعد إعادة تحميل الصفحة؛ راجع الصف ثم أعد المحاولة"
            : String(item.error || ""),
        warnings: Array.isArray(item.warnings) ? item.warnings.map(String) : [],
      } as BatchRow;
    });
}

function loadRowsFromSession(): BatchRow[] {
  if (typeof window === "undefined") return EMPTY_ROWS;
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return [];
    return normalizeStoredRows(JSON.parse(raw));
  } catch {
    return [];
  }
}

function persistRows(rows: BatchRow[]) {
  if (typeof window === "undefined") return;
  try {
    if (!rows.length) window.sessionStorage.removeItem(SESSION_KEY);
    else window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(rows));
  } catch {
    // Keep the in-memory store working even if sessionStorage is unavailable.
  }
}

function getRowsSnapshot(): BatchRow[] {
  if (rowStore === null) rowStore = loadRowsFromSession();
  return rowStore;
}

function subscribeRows(listener: () => void) {
  rowListeners.add(listener);
  return () => rowListeners.delete(listener);
}

function mutateRows(updater: BatchRow[] | ((current: BatchRow[]) => BatchRow[])) {
  const current = getRowsSnapshot();
  const next = typeof updater === "function" ? updater(current) : updater;
  rowStore = next;
  persistRows(next);
  rowListeners.forEach((listener) => listener());
}

function updateStoredRow(id: string, patch: Partial<BatchRow>) {
  mutateRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
}

function scanPatch(data: PassportScanData): Partial<BatchRow> {
  return {
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
  };
}

function normalizePassport(value: string) { return value.trim().toUpperCase().replace(/\s+/g, ""); }
function normalizeNationalId(value: string) { return value.replace(/\D/g, ""); }

async function loadPdfJs() {
  if (!pdfJsPromise) {
    pdfJsPromise = (async () => {
      const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const worker: any = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url");
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    })();
  }
  return pdfJsPromise;
}

async function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  const make = (quality: number) => new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("تعذر تحويل صفحة PDF إلى صورة")), "image/jpeg", quality);
  });
  let blob = await make(0.84);
  if (blob.size > 5_500_000) blob = await make(0.68);
  if (blob.size > 6_000_000) throw new Error("صفحة PDF كبيرة جدًا بعد التجهيز");
  return blob;
}

async function renderPdfPageFast(pdf: any, pageNumber: number, sourceName: string): Promise<File> {
  const page = await pdf.getPage(pageNumber);
  const canvas = document.createElement("canvas");
  try {
    const base = page.getViewport({ scale: 1 });
    const longest = Math.max(Number(base.width) || 0, Number(base.height) || 0);
    if (!longest) throw new Error("تعذر تحديد أبعاد صفحة PDF");
    const scale = Math.min(2, Math.max(0.5, PDF_RENDER_MAX_DIMENSION / longest));
    const viewport = page.getViewport({ scale });
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("المتصفح لا يستطيع تجهيز صفحة PDF");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const renderTask = page.render({ canvasContext: ctx, viewport, background: "#ffffff", intent: "display" } as any);
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        try { renderTask.cancel(); } catch { /* no-op */ }
        reject(new Error(`صفحة ${pageNumber} ثقيلة على الموبايل ولم يتم تجهيزها في الوقت المحدد`));
      }, PDF_RENDER_TIMEOUT_MS);
    });
    try {
      await Promise.race([renderTask.promise, timeout]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }

    const blob = await canvasToJpeg(canvas);
    const safe = String(sourceName || "passports.pdf").replace(/\.pdf$/i, "").replace(/[^\p{L}\p{N}_-]+/gu, "-");
    return new File([blob], `${safe || "passport"}-page-${pageNumber}.jpg`, { type: "image/jpeg" });
  } finally {
    try { page.cleanup?.(); } catch { /* no-op */ }
    canvas.width = 1;
    canvas.height = 1;
  }
}

function stateLabel(state: RowState) {
  if (state === "waiting") return "في الانتظار";
  if (state === "rendering") return "جارِ تجهيز الصفحة";
  if (state === "reading") return "جارِ قراءة الجواز";
  if (state === "ready") return "جاهز";
  if (state === "review") return "يحتاج مراجعة";
  if (state === "error") return "فشل";
  if (state === "saving") return "جارِ الحفظ";
  if (state === "saved") return "تم إنشاء التنفيذ";
  return "فشل الحفظ";
}

export function PassportBulkUploadWorkspaceV4() {
  const perm = usePerm("executions");
  const oneInput = useRef<HTMLInputElement | null>(null);
  const multiInput = useRef<HTMLInputElement | null>(null);
  const pdfInput = useRef<HTMLInputElement | null>(null);
  const { rows: agents } = useLive<Agent>("agents");
  const approvalStatuses = useDropdownOptions("execution_status");
  const operationStatuses = useDropdownOptions("operation_status");
  const departures = useDropdownOptions("departure_from");
  const destinations = useDropdownOptions("destination");
  const airlines = useDropdownOptions("airline");
  const passengerTypes = useDropdownOptions("passenger_type");

  const rows = useSyncExternalStore(subscribeRows, getRowsSnapshot, () => EMPTY_ROWS);
  const [busyMode, setBusyMode] = useState<"" | "single" | "multi" | "pdf" | "save">("");
  const [progress, setProgress] = useState("");
  const [common, setCommon] = useState<CommonFields>(EMPTY_COMMON);

  const activeAgents = useMemo(() => agents.filter((a) => String(a.status || "نشط") === "نشط"), [agents]);
  const busy = busyMode !== "";
  const selectedRows = rows.filter((r) => r.selected && r.state !== "saved");
  const updateRow = (id: string, patch: Partial<BatchRow>) => updateStoredRow(id, patch);

  const duplicateIds = useMemo(() => {
    const p = new Map<string, string[]>();
    const n = new Map<string, string[]>();
    for (const r of rows) {
      if (r.state === "saved") continue;
      const pp = normalizePassport(r.passport); const nn = normalizeNationalId(r.national_id);
      if (pp) p.set(pp, [...(p.get(pp) || []), r.id]);
      if (nn) n.set(nn, [...(n.get(nn) || []), r.id]);
    }
    const out = new Set<string>();
    for (const ids of [...p.values(), ...n.values()]) if (ids.length > 1) ids.forEach((id) => out.add(id));
    return out;
  }, [rows]);

  const scanIntoExistingRow = async (rowId: string, file: File) => {
    updateRow(rowId, { state: "reading", error: "" });
    try {
      const data = await scanPassportFile(file);
      updateRow(rowId, scanPatch(data));
      return true;
    } catch (error: any) {
      updateRow(rowId, { state: "error", selected: false, error: error?.message || "تعذر قراءة الجواز" });
      return false;
    }
  };

  const addSingleImage = async (file: File) => {
    if (getRowsSnapshot().length >= MAX_BATCH_ITEMS) return toast.error(`الحد الأقصى ${MAX_BATCH_ITEMS} جواز`);
    const row = emptyRow(file.name || `صورة ${getRowsSnapshot().length + 1}`);
    mutateRows((current) => [...current, row]);
    setBusyMode("single"); setProgress("جارِ قراءة الصورة...");
    await scanIntoExistingRow(row.id, file);
    setBusyMode(""); setProgress("");
    if (oneInput.current) oneInput.current.value = "";
  };

  const addManyImages = async (filesList: FileList | null) => {
    const files = Array.from(filesList || []);
    if (!files.length) return;
    const available = MAX_BATCH_ITEMS - getRowsSnapshot().length;
    if (files.length > available) return toast.error(`اختر بحد أقصى ${available} صورة`);
    setBusyMode("multi");
    let ok = 0;
    for (let i = 0; i < files.length; i++) {
      setProgress(`جارِ قراءة الصورة ${i + 1} من ${files.length}`);
      const row = emptyRow(files[i].name || `صورة ${getRowsSnapshot().length + 1}`);
      mutateRows((current) => [...current, row]);
      if (await scanIntoExistingRow(row.id, files[i])) ok++;
    }
    const visibleOk = getRowsSnapshot().filter((r) => ["ready", "review"].includes(r.state)).length;
    if (ok && visibleOk) toast.success(`تمت قراءة ${ok} من ${files.length} صورة`);
    else if (!ok) toast.error("تعذر قراءة الصور المختارة");
    setBusyMode(""); setProgress("");
    if (multiInput.current) multiInput.current.value = "";
  };

  const addPdf = async (file: File) => {
    if (!file || !file.size) return toast.error("ملف PDF فارغ");
    if (file.size > MAX_PDF_BYTES) return toast.error("حجم PDF أكبر من 50MB");
    const available = MAX_BATCH_ITEMS - getRowsSnapshot().length;
    if (available <= 0) return toast.error(`الدفعة وصلت للحد الأقصى ${MAX_BATCH_ITEMS}`);

    setBusyMode("pdf"); setProgress("جارِ فتح ملف PDF...");
    try {
      const pdfjs = await loadPdfJs();
      const bytes = new Uint8Array(await file.arrayBuffer());
      const task = pdfjs.getDocument({ data: bytes, isEvalSupported: false, useWorkerFetch: false, disableAutoFetch: true });
      const pdf = await task.promise;
      try {
        if (!pdf.numPages) throw new Error("ملف PDF لا يحتوي صفحات");
        if (pdf.numPages > available) throw new Error(`الملف يحتوي ${pdf.numPages} صفحة والمتاح في الدفعة ${available}`);

        const pageRows = Array.from({ length: pdf.numPages }, (_, i) => emptyRow(`${file.name} — صفحة ${i + 1}`, i + 1));
        const pageIds = new Set(pageRows.map((r) => r.id));
        mutateRows((current) => [...current, ...pageRows]);
        setProgress(`تم فتح ${pdf.numPages} صفحة — جارِ المعالجة...`);
        await Promise.resolve();

        const inFlight = new Set<Promise<boolean>>();
        const allJobs: Promise<boolean>[] = [];
        let renderFailed = 0;

        for (const row of pageRows) {
          while (inFlight.size >= PDF_OCR_CONCURRENCY) await Promise.race(inFlight);
          updateRow(row.id, { state: "rendering", error: "" });
          setProgress(`جارِ تجهيز صفحة ${row.pageNumber} من ${pdf.numPages}`);
          let pageFile: File;
          try {
            pageFile = await renderPdfPageFast(pdf, row.pageNumber!, file.name);
          } catch (error: any) {
            renderFailed++;
            updateRow(row.id, { state: "error", selected: false, error: error?.message || "تعذر تجهيز الصفحة" });
            continue;
          }

          const job = scanIntoExistingRow(row.id, pageFile);
          inFlight.add(job);
          allJobs.push(job);
          void job.finally(() => inFlight.delete(job));
        }

        setProgress("جارِ إنهاء قراءة الجوازات...");
        const results = await Promise.all(allJobs);
        const currentRows = getRowsSnapshot();
        const visibleSuccess = currentRows.filter((r) => pageIds.has(r.id) && ["ready", "review"].includes(r.state)).length;
        const totalFailed = renderFailed + (results.length - results.filter(Boolean).length);
        if (visibleSuccess) toast.success(`تمت قراءة ${visibleSuccess} جواز من PDF${totalFailed ? `، وفشل ${totalFailed}` : ""}`);
        else toast.error("انتهت المعالجة لكن لم توجد نتائج ظاهرة؛ أعد المحاولة بعد تحديث الصفحة");
      } finally {
        try { await pdf.destroy(); } catch { /* no-op */ }
      }
    } catch (error: any) {
      pdfJsPromise = null;
      toast.error(`تعذر معالجة PDF: ${error?.message || "خطأ غير معروف"}`);
    } finally {
      setBusyMode(""); setProgress("");
      if (pdfInput.current) pdfInput.current.value = "";
    }
  };

  const applyCommon = () => mutateRows((current) => current.map((r) => r.selected && r.state !== "saved" ? { ...r, ...common } : r));
  const removeRow = (id: string) => { if (!busy) mutateRows((current) => current.filter((r) => r.id !== id)); };
  const clearBatch = () => { if (!busy) mutateRows([]); };

  const saveSelected = async () => {
    if (busy) return;
    if (!perm.create) return toast.error("ليس لديك صلاحية إنشاء تنفيذات");
    const selected = getRowsSnapshot().filter((r) => r.selected && ["ready", "review", "save_error"].includes(r.state));
    if (!selected.length) return toast.error("اختر مسافرًا جاهزًا واحدًا على الأقل");
    if (selected.some((r) => !r.passenger_name.trim())) return toast.error("راجع أسماء المسافرين قبل الحفظ");
    if (selected.some((r) => r.operation_status.trim() === "منفذ")) return toast.error("لا يمكن الحفظ الجماعي بحالة «منفذ» قبل استكمال الخدمات والأسعار");
    if (selected.some((r) => duplicateIds.has(r.id)) && !window.confirm("يوجد رقم جواز أو رقم قومي مكرر. هل تريد الاستمرار؟")) return;

    setBusyMode("save"); let ok = 0; let fail = 0;
    try {
      for (const r of selected) {
        updateRow(r.id, { state: "saving", error: "" });
        const payload = {
          passenger_name: r.passenger_name.trim(), national_id: r.national_id.trim() || null, dob: r.dob || null,
          passenger_type: r.passenger_type || null, passport: r.passport.trim() || null, birth_place: r.birth_place.trim() || null,
          agent_id: r.agent_id || null, status: r.approval_status || "", operation_status: r.operation_status || "",
          departure_from: r.departure_from || null, destination: r.destination || null, airline: r.airline || null, travel_date: r.travel_date || null,
          notes: null, approval_company_id: null, issue_date: null, approval_validity_enabled: false, services: [],
        };
        const result = await importExecutionRows([payload], () => {});
        if (result.insertedIds.length === 1 && result.failed === 0) { ok++; updateRow(r.id, { state: "saved", selected: false, error: "" }); }
        else { fail++; updateRow(r.id, { state: "save_error", error: "تعذر إنشاء التنفيذ" }); }
      }
      if (ok) await refetchLiveTables(["executions"]);
      if (ok) toast.success(`تم إنشاء ${ok} تنفيذ${fail ? `، وفشل ${fail}` : ""}`); else toast.error("لم يتم إنشاء أي تنفيذ");
    } finally { setBusyMode(""); }
  };

  const inputStyle: React.CSSProperties = { width: "100%", minHeight: 38, border: "1px solid #dbe3ee", borderRadius: 8, padding: "7px 8px", background: "#fff", color: "#0f172a", fontSize: 12 };
  const opts = (values: readonly string[], current: string) => withSelected(values, current).map((v) => <option key={v} value={v}>{v}</option>);

  return <div dir="rtl" style={{ display: "grid", gap: 14 }}>
    <input ref={oneInput} hidden type="file" accept="image/*" onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) void addSingleImage(f); }} />
    <input ref={multiInput} hidden type="file" accept="image/*" multiple onChange={(e) => void addManyImages(e.currentTarget.files)} />
    <input ref={pdfInput} hidden type="file" accept="application/pdf,.pdf" onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) void addPdf(f); }} />

    <div style={{ padding: 14, borderRadius: 12, border: "1px solid #dbe3ee", background: "#f8fafc" }}>
      <div style={{ display: "flex", gap: 9, flexWrap: "wrap", alignItems: "center" }}>
        <button disabled={busy} type="button" onClick={() => oneInput.current?.click()} className="btn btn-primary"><Camera size={16} /> {rows.length ? "إضافة صورة واحدة" : "إضافة أول صورة"}</button>
        <button disabled={busy} type="button" onClick={() => multiInput.current?.click()} className="btn btn-secondary"><Images size={16} /> اختيار مجموعة صور</button>
        <button disabled={busy} type="button" onClick={() => pdfInput.current?.click()} className="btn btn-secondary"><FileText size={16} /> رفع ملف PDF جوازات</button>
        {rows.length > 0 && <button disabled={busy} type="button" onClick={clearBatch} className="btn btn-secondary"><Trash2 size={15} /> مسح الدفعة</button>}
      </div>
      <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", fontSize: 12 }}>
        <span style={{ color: "#166534", fontWeight: 900 }}><ShieldCheck size={14} style={{ verticalAlign: "middle" }} /> الصور وPDF لا تُحفظ — حفظ مؤقت للنص فقط داخل الجلسة</span>
        {busy && <span style={{ color: "#1d4ed8", fontWeight: 900 }}><Loader2 size={14} className="animate-spin" style={{ verticalAlign: "middle" }} /> {progress}</span>}
      </div>
    </div>

    {rows.length > 0 && <div style={{ padding: 12, border: "1px solid #e2e8f0", borderRadius: 12, background: "#fff" }}>
      <div style={{ fontWeight: 900, marginBottom: 10 }}>بيانات مشتركة للمحدد</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(145px,1fr))", gap: 8 }}>
        <label style={{ fontSize: 11, fontWeight: 800 }}>الوكيل<select style={inputStyle} value={common.agent_id} onChange={(e) => setCommon((v) => ({ ...v, agent_id: e.target.value }))}><option value="">—</option>{activeAgents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <label style={{ fontSize: 11, fontWeight: 800 }}>حالة الموافقة<select style={inputStyle} value={common.approval_status} onChange={(e) => setCommon((v) => ({ ...v, approval_status: e.target.value }))}><option value="">—</option>{opts(approvalStatuses, common.approval_status)}</select></label>
        <label style={{ fontSize: 11, fontWeight: 800 }}>حالة العملية<select style={inputStyle} value={common.operation_status} onChange={(e) => setCommon((v) => ({ ...v, operation_status: e.target.value }))}><option value="">—</option>{opts(operationStatuses, common.operation_status)}</select></label>
        <label style={{ fontSize: 11, fontWeight: 800 }}>جهة المغادرة<select style={inputStyle} value={common.departure_from} onChange={(e) => setCommon((v) => ({ ...v, departure_from: e.target.value }))}><option value="">—</option>{opts(departures, common.departure_from)}</select></label>
        <label style={{ fontSize: 11, fontWeight: 800 }}>الوجهة<select style={inputStyle} value={common.destination} onChange={(e) => setCommon((v) => ({ ...v, destination: e.target.value }))}><option value="">—</option>{opts(destinations, common.destination)}</select></label>
        <label style={{ fontSize: 11, fontWeight: 800 }}>الطيران<select style={inputStyle} value={common.airline} onChange={(e) => setCommon((v) => ({ ...v, airline: e.target.value }))}><option value="">—</option>{opts(airlines, common.airline)}</select></label>
        <label style={{ fontSize: 11, fontWeight: 800 }}>تاريخ المغادرة<input style={inputStyle} type="date" value={common.travel_date} onChange={(e) => setCommon((v) => ({ ...v, travel_date: e.target.value }))} /></label>
      </div>
      <button type="button" className="btn btn-secondary" style={{ marginTop: 10 }} disabled={busy || selectedRows.length === 0} onClick={applyCommon}>تطبيق على المحدد ({selectedRows.length})</button>
    </div>}

    {rows.map((r, index) => {
      const editable = ["ready", "review", "error", "save_error"].includes(r.state);
      const duplicate = duplicateIds.has(r.id);
      return <div key={r.id} style={{ border: `1px solid ${duplicate ? "#fdba74" : "#e2e8f0"}`, borderRadius: 12, background: "#fff", padding: 12 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 9 }}>
          <input type="checkbox" checked={r.selected} disabled={!editable || r.state === "error"} onChange={(e) => updateRow(r.id, { selected: e.target.checked })} />
          <strong>مسافر {index + 1}</strong><span style={{ fontSize: 11, color: "#64748b" }}>{r.sourceLabel}</span>
          <span style={{ padding: "3px 8px", borderRadius: 999, background: r.state === "error" || r.state === "save_error" ? "#fef2f2" : r.state === "review" ? "#fffbeb" : ["waiting", "rendering", "reading"].includes(r.state) ? "#eff6ff" : "#f0fdf4", color: r.state === "error" || r.state === "save_error" ? "#b91c1c" : r.state === "review" ? "#92400e" : ["waiting", "rendering", "reading"].includes(r.state) ? "#1d4ed8" : "#166534", fontSize: 11, fontWeight: 900 }}>{stateLabel(r.state)}</span>
          {duplicate && <span style={{ color: "#c2410c", fontSize: 11, fontWeight: 900 }}>مكرر</span>}
          {!busy && r.state !== "saved" && <button type="button" onClick={() => removeRow(r.id)} style={{ marginInlineStart: "auto", border: 0, background: "transparent", color: "#b91c1c" }}><Trash2 size={16} /></button>}
        </div>
        {r.error && <div style={{ marginBottom: 8, color: "#b91c1c", fontSize: 11, fontWeight: 800 }}>{r.error}</div>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 8 }}>
          <label style={{ fontSize: 11, fontWeight: 800 }}>الاسم<input style={inputStyle} disabled={!editable} value={r.passenger_name} onChange={(e) => updateRow(r.id, { passenger_name: e.target.value })} /></label>
          <label style={{ fontSize: 11, fontWeight: 800 }}>الرقم القومي<input style={inputStyle} disabled={!editable} value={r.national_id} onChange={(e) => updateRow(r.id, { national_id: e.target.value })} /></label>
          <label style={{ fontSize: 11, fontWeight: 800 }}>تاريخ الميلاد<input style={inputStyle} type="date" disabled={!editable} value={r.dob} onChange={(e) => updateRow(r.id, { dob: e.target.value })} /></label>
          <label style={{ fontSize: 11, fontWeight: 800 }}>نوع المسافر<select style={inputStyle} disabled={!editable} value={r.passenger_type} onChange={(e) => updateRow(r.id, { passenger_type: e.target.value })}><option value="">—</option>{opts(passengerTypes, r.passenger_type)}</select></label>
          <label style={{ fontSize: 11, fontWeight: 800 }}>رقم الجواز<input style={inputStyle} disabled={!editable} value={r.passport} onChange={(e) => updateRow(r.id, { passport: e.target.value })} /></label>
          <label style={{ fontSize: 11, fontWeight: 800 }}>محل الميلاد<input style={inputStyle} disabled={!editable} value={r.birth_place} onChange={(e) => updateRow(r.id, { birth_place: e.target.value })} /></label>
        </div>
      </div>;
    })}

    {rows.length === 0 && <div style={{ minHeight: 150, border: "1px dashed #cbd5e1", borderRadius: 12, display: "grid", placeItems: "center", textAlign: "center", color: "#64748b" }}>اختر صورة واحدة أو مجموعة صور أو ملف PDF</div>}

    {rows.length > 0 && <div style={{ position: "sticky", bottom: 8, zIndex: 5, padding: 10, borderRadius: 12, background: "rgba(255,255,255,.97)", border: "1px solid #dbe3ee", display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ fontSize: 12, fontWeight: 800 }}>الدفعة: {rows.length} — المحدد: {selectedRows.length}</span>
      <button type="button" className="btn btn-primary" disabled={!perm.create || busy || selectedRows.length === 0} onClick={() => void saveSelected()}>{busyMode === "save" ? "جارِ إنشاء التنفيذات..." : `إنشاء التنفيذات المحددة (${selectedRows.length})`}</button>
    </div>}
  </div>;
}
