import { useEffect, useMemo, useRef, useState } from "react";
import { FileImage, FileText, Loader2, RefreshCw, ShieldCheck, Upload, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/Modal";
import { scanPassportFile, type PassportScanData } from "@/components/PassportScanner";
import { usePerm } from "@/hooks/usePerm";
import {
  refetchLiveTables,
  useDropdownOptions,
  useLive,
  withSelected,
  type Agent,
} from "@/lib/db";
import { importExecutionRows } from "@/lib/dataImport/executionImport";

const MAX_BATCH_ITEMS = 50;
const MAX_PDF_BYTES = 50 * 1024 * 1024;
const OCR_CONCURRENCY = 3;
const PDF_RENDER_MAX_DIMENSION = 2400;

type ItemStatus = "waiting" | "reading" | "done" | "review" | "error" | "saving" | "saved" | "save_error";

type EditableExecutionFields = {
  passenger_name: string;
  national_id: string;
  dob: string;
  passenger_type: string;
  passport: string;
  birth_place: string;
  agent_id: string;
  status: string;
  operation_status: string;
  departure_from: string;
  destination: string;
  airline: string;
  travel_date: string;
};

type BulkItem = EditableExecutionFields & {
  id: string;
  label: string;
  statusCode: ItemStatus;
  selected: boolean;
  error: string;
  warnings: string[];
  mrzVerified: boolean;
};

type CommonFields = Pick<
  EditableExecutionFields,
  "agent_id" | "status" | "operation_status" | "departure_from" | "destination" | "airline" | "travel_date"
>;

type SourceRef =
  | { kind: "image"; file: File }
  | { kind: "pdf-page"; file: File; pageNumber: number };

const EMPTY_COMMON: CommonFields = {
  agent_id: "",
  status: "",
  operation_status: "",
  departure_from: "",
  destination: "",
  airline: "",
  travel_date: "",
};

function itemId() {
  try { return crypto.randomUUID(); } catch { return `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
}

function emptyItem(id: string, label: string): BulkItem {
  return {
    id,
    label,
    statusCode: "waiting",
    selected: false,
    error: "",
    warnings: [],
    mrzVerified: false,
    passenger_name: "",
    national_id: "",
    dob: "",
    passenger_type: "",
    passport: "",
    birth_place: "",
    ...EMPTY_COMMON,
  };
}

function fieldsFromScan(data: PassportScanData): Pick<
  BulkItem,
  "passenger_name" | "national_id" | "dob" | "passenger_type" | "passport" | "birth_place" | "warnings" | "mrzVerified"
> {
  return {
    passenger_name: data.full_name_ar || data.full_name_en || "",
    national_id: data.national_id || "",
    dob: data.date_of_birth || "",
    passenger_type: data.passenger_type || "",
    passport: data.passport_number || "",
    birth_place: data.place_of_birth || "",
    warnings: Array.isArray(data.warnings) ? data.warnings : [],
    mrzVerified: !!data.mrz_verified,
  };
}

function isPdf(file: File) {
  return String(file.type || "").toLowerCase() === "application/pdf" || /\.pdf$/i.test(file.name || "");
}

async function runPool<T>(values: T[], worker: (value: T, index: number) => Promise<void>, concurrency = OCR_CONCURRENCY) {
  let cursor = 0;
  const runner = async () => {
    while (true) {
      const index = cursor++;
      if (index >= values.length) return;
      await worker(values[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), values.length) }, () => runner()));
}

async function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return await new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("تعذر تجهيز صفحة PDF كصورة")),
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
      throw new Error("صفحة PDF كبيرة جدًا بعد التجهيز؛ قلّل دقة الملف أو استخدم صور الجوازات مباشرة");
    }
    const safeBase = String(sourceName || "passports.pdf").replace(/\.pdf$/i, "").replace(/[^\p{L}\p{N}_-]+/gu, "-");
    return new File([blob], `${safeBase || "passport"}-page-${pageNumber}.jpg`, { type: "image/jpeg" });
  } finally {
    try { page.cleanup?.(); } catch { /* no-op */ }
    canvas.width = 1;
    canvas.height = 1;
  }
}

async function renderOnePdfSource(source: Extract<SourceRef, { kind: "pdf-page" }>): Promise<File> {
  const pdfjs = await loadPdfJs();
  const bytes = new Uint8Array(await source.file.arrayBuffer());
  const loadingTask = pdfjs.getDocument({ data: bytes });
  const pdf = await loadingTask.promise;
  try {
    return await renderPdfPage(pdf, source.pageNumber, source.file.name);
  } finally {
    await (pdf as any).destroy();
  }
}

function statusLabel(item: BulkItem, duplicate: boolean) {
  if (duplicate && item.statusCode !== "saved") return "مكرر داخل الدفعة";
  switch (item.statusCode) {
    case "waiting": return "في الانتظار";
    case "reading": return "جارِ القراءة";
    case "done": return "تم";
    case "review": return "يحتاج مراجعة";
    case "error": return "فشل القراءة";
    case "saving": return "جارِ الحفظ";
    case "saved": return "تم إنشاء التنفيذ";
    case "save_error": return "فشل الحفظ";
  }
}

function statusStyle(item: BulkItem, duplicate: boolean) {
  if (duplicate && item.statusCode !== "saved") return { background: "#fff7ed", color: "#c2410c", border: "#fed7aa" };
  if (item.statusCode === "done" || item.statusCode === "saved") return { background: "#f0fdf4", color: "#166534", border: "#bbf7d0" };
  if (item.statusCode === "review") return { background: "#fffbeb", color: "#92400e", border: "#fde68a" };
  if (item.statusCode === "error" || item.statusCode === "save_error") return { background: "#fef2f2", color: "#b91c1c", border: "#fecaca" };
  return { background: "#f8fafc", color: "#475569", border: "#e2e8f0" };
}

export function BulkPassportImporter() {
  const perm = usePerm("executions");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const sourceRefs = useRef<Map<string, SourceRef>>(new Map());
  const batchToken = useRef(0);
  const { rows: agents } = useLive<Agent>("agents");
  const approvalStatuses = useDropdownOptions("execution_status");
  const operationStatuses = useDropdownOptions("operation_status");
  const departures = useDropdownOptions("departure_from");
  const destinations = useDropdownOptions("destination");
  const airlines = useDropdownOptions("airline");
  const passengerTypes = useDropdownOptions("passenger_type");

  const [open, setOpen] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [items, setItems] = useState<BulkItem[]>([]);
  const [common, setCommon] = useState<CommonFields>(EMPTY_COMMON);

  const activeAgents = useMemo(
    () => agents.filter((agent) => String(agent.status || "نشط") === "نشط"),
    [agents],
  );

  const updateItem = (id: string, patch: Partial<BulkItem>) => {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  };

  const duplicateIds = useMemo(() => {
    const passportMap = new Map<string, string[]>();
    const nationalMap = new Map<string, string[]>();
    for (const item of items) {
      if (!["done", "review", "save_error", "saving"].includes(item.statusCode)) continue;
      const passport = item.passport.trim().toUpperCase().replace(/\s+/g, "");
      const national = item.national_id.replace(/\D/g, "");
      if (passport) passportMap.set(passport, [...(passportMap.get(passport) || []), item.id]);
      if (national) nationalMap.set(national, [...(nationalMap.get(national) || []), item.id]);
    }
    const duplicate = new Set<string>();
    for (const ids of [...passportMap.values(), ...nationalMap.values()]) {
      if (ids.length > 1) ids.forEach((id) => duplicate.add(id));
    }
    return duplicate;
  }, [items]);

  const completedCount = items.filter((item) => !["waiting", "reading"].includes(item.statusCode)).length;
  const selectedCount = items.filter((item) => item.selected && item.statusCode !== "saved").length;

  const resetBatch = () => {
    batchToken.current += 1;
    sourceRefs.current.clear();
    setItems([]);
    setProcessing(false);
    setSaving(false);
    setCommon(EMPTY_COMMON);
    if (inputRef.current) inputRef.current.value = "";
  };

  const closeModal = () => {
    if ((processing || saving) && !window.confirm("توجد عملية جارية. هل تريد إغلاق النافذة؟ النتائج الجارية لن تُحفظ كملفات.")) return;
    resetBatch();
    setOpen(false);
  };

  useEffect(() => () => {
    batchToken.current += 1;
    sourceRefs.current.clear();
  }, []);

  const applyScan = (id: string, data: PassportScanData, token: number) => {
    if (batchToken.current !== token) return;
    const fields = fieldsFromScan(data);
    updateItem(id, {
      ...fields,
      selected: true,
      error: "",
      statusCode: data.needs_review ? "review" : "done",
    });
    sourceRefs.current.delete(id);
  };

  const failScan = (id: string, error: unknown, token: number) => {
    if (batchToken.current !== token) return;
    updateItem(id, {
      statusCode: "error",
      selected: false,
      error: error instanceof Error ? error.message : "تعذر قراءة الجواز",
    });
  };

  const processImages = async (files: File[]) => {
    const token = ++batchToken.current;
    sourceRefs.current.clear();
    const nextItems = files.map((file, index) => {
      const id = itemId();
      sourceRefs.current.set(id, { kind: "image", file });
      return { ...emptyItem(id, file.name || `صورة ${index + 1}`), statusCode: "waiting" as const };
    });
    setItems(nextItems);
    setProcessing(true);

    await runPool(nextItems, async (item) => {
      if (batchToken.current !== token) return;
      updateItem(item.id, { statusCode: "reading", error: "" });
      const source = sourceRefs.current.get(item.id);
      if (!source || source.kind !== "image") return;
      try {
        const data = await scanPassportFile(source.file);
        applyScan(item.id, data, token);
      } catch (error) {
        failScan(item.id, error, token);
      }
    });

    if (batchToken.current === token) setProcessing(false);
  };

  const processPdf = async (file: File) => {
    if (file.size > MAX_PDF_BYTES) throw new Error("حجم ملف PDF أكبر من 50MB");
    const token = ++batchToken.current;
    sourceRefs.current.clear();
    setItems([]);
    setProcessing(true);

    try {
      const pdfjs = await loadPdfJs();
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (batchToken.current !== token) return;
      const loadingTask = pdfjs.getDocument({ data: bytes });
      const pdf = await loadingTask.promise;
      try {
        if (pdf.numPages > MAX_BATCH_ITEMS) {
          throw new Error(`ملف PDF يحتوي ${pdf.numPages} صفحة. الحد الأقصى للدفعة ${MAX_BATCH_ITEMS} صفحة`);
        }
        const pages = Array.from({ length: pdf.numPages }, (_, index) => {
          const id = itemId();
          const pageNumber = index + 1;
          sourceRefs.current.set(id, { kind: "pdf-page", file, pageNumber });
          return { ...emptyItem(id, `${file.name} — صفحة ${pageNumber}`), pageNumber };
        });
        setItems(pages);

        await runPool(pages, async (item) => {
          if (batchToken.current !== token) return;
          updateItem(item.id, { statusCode: "reading", error: "" });
          try {
            const imageFile = await renderPdfPage(pdf, item.pageNumber, file.name);
            const data = await scanPassportFile(imageFile);
            applyScan(item.id, data, token);
          } catch (error) {
            failScan(item.id, error, token);
          }
        });
      } finally {
        await (pdf as any).destroy();
      }
    } catch (error) {
      if (batchToken.current === token && items.length === 0) {
        sourceRefs.current.clear();
        throw error;
      }
    } finally {
      if (batchToken.current === token) setProcessing(false);
    }
  };

  const handleFiles = async (fileList: FileList | null) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    if (processing || saving) return;

    try {
      const pdfs = files.filter(isPdf);
      const images = files.filter((file) => !isPdf(file));
      if (pdfs.length && images.length) throw new Error("اختر إما ملف PDF واحد أو مجموعة صور، وليس الاثنين معًا");
      if (pdfs.length > 1) throw new Error("يمكن رفع ملف PDF واحد في كل دفعة");
      if (images.length > MAX_BATCH_ITEMS) throw new Error(`الحد الأقصى ${MAX_BATCH_ITEMS} صورة في الدفعة`);
      if (items.length && !window.confirm("سيتم استبدال الدفعة الحالية. هل تريد المتابعة؟")) return;

      if (pdfs.length === 1) await processPdf(pdfs[0]);
      else await processImages(images);
    } catch (error: any) {
      toast.error(error?.message || "تعذر تجهيز الملفات للقراءة");
      setProcessing(false);
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const retryItem = async (id: string) => {
    const source = sourceRefs.current.get(id);
    if (!source || processing || saving) {
      if (!source) toast.error("مصدر الملف لم يعد موجودًا. اختر الملف مرة أخرى");
      return;
    }
    const token = batchToken.current;
    setProcessing(true);
    updateItem(id, { statusCode: "reading", error: "" });
    try {
      const file = source.kind === "image" ? source.file : await renderOnePdfSource(source);
      const data = await scanPassportFile(file);
      applyScan(id, data, token);
    } catch (error) {
      failScan(id, error, token);
    } finally {
      if (batchToken.current === token) setProcessing(false);
    }
  };

  const applyCommonToSelected = () => {
    setItems((current) => current.map((item) => {
      if (!item.selected || item.statusCode === "saved") return item;
      return { ...item, ...common };
    }));
  };

  const saveSelected = async () => {
    if (processing || saving) return;
    if (!perm.create) {
      toast.error("ليس لديك صلاحية إنشاء تنفيذات. يمكن مراجعة قراءة الجوازات فقط.");
      return;
    }
    const selected = items.filter((item) => item.selected && item.statusCode !== "saved");
    if (!selected.length) { toast.error("اختر مسافرًا واحدًا على الأقل"); return; }

    const missingName = selected.find((item) => !item.passenger_name.trim());
    if (missingName) { toast.error(`راجع الاسم في: ${missingName.label}`); return; }

    const executed = selected.find((item) => item.operation_status.trim() === "منفذ");
    if (executed) {
      toast.error("الرفع الجماعي لا يحفظ التنفيذ كـ «منفذ» بدون خدمات وأسعار. اختر حالة أخرى ثم افتح التنفيذ لاحقًا لاستكمال الخدمات والتسعير.");
      return;
    }

    if (selected.some((item) => duplicateIds.has(item.id))) {
      const proceed = window.confirm("يوجد رقم جواز أو رقم قومي مكرر داخل الدفعة المحددة. هل تريد الاستمرار بعد مراجعة الصفوف؟");
      if (!proceed) return;
    }

    setSaving(true);
    let savedCount = 0;
    let failedCount = 0;
    try {
      for (const item of selected) {
        updateItem(item.id, { statusCode: "saving", error: "" });
        const payload = {
          passenger_name: item.passenger_name.trim(),
          national_id: item.national_id.trim() || null,
          dob: item.dob || null,
          passenger_type: item.passenger_type || null,
          passport: item.passport.trim() || null,
          birth_place: item.birth_place.trim() || null,
          agent_id: item.agent_id || null,
          status: item.status || "",
          operation_status: item.operation_status || "",
          departure_from: item.departure_from || null,
          destination: item.destination || null,
          airline: item.airline || null,
          travel_date: item.travel_date || null,
          notes: null,
          approval_company_id: null,
          issue_date: null,
          approval_validity_enabled: false,
          services: [],
        };
        const result = await importExecutionRows([payload], () => {});
        if (result.insertedIds.length === 1 && result.failed === 0) {
          savedCount++;
          updateItem(item.id, { statusCode: "saved", selected: false, error: "" });
        } else {
          failedCount++;
          updateItem(item.id, { statusCode: "save_error", error: "تعذر إنشاء التنفيذ. راجع البيانات والصلاحيات ثم أعد المحاولة" });
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
    minHeight: 36,
    border: "1px solid #dbe3ee",
    borderRadius: 8,
    padding: "6px 8px",
    background: "#fff",
    color: "#0f172a",
    fontSize: 12,
  };

  const renderOptions = (options: readonly string[], current: string) =>
    withSelected(options, current).map((value) => <option key={value} value={value}>{value}</option>);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp"
        multiple
        hidden
        onChange={(event) => void handleFiles(event.currentTarget.files)}
      />

      <button
        type="button"
        onClick={() => setOpen(true)}
        title={perm.create ? "رفع مجموعة جوازات" : "يمكن قراءة الجوازات ومراجعتها، لكن إنشاء التنفيذات يحتاج صلاحية إنشاء"}
        style={{
          minHeight: 40,
          border: "1px solid #d4af37",
          borderRadius: 10,
          padding: "9px 14px",
          background: "#fffaf0",
          color: "#0f1b3d",
          fontWeight: 800,
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          cursor: "pointer",
        }}
      >
        <Upload size={17} />
        رفع جماعي للجوازات
      </button>

      <Modal
        open={open}
        onClose={closeModal}
        title="رفع جماعي للجوازات — صور أو PDF"
        maxWidth={1180}
        footer={(
          <div style={{ display: "flex", gap: 8, justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", width: "100%" }}>
            <span style={{ fontSize: 12, color: "#64748b", fontWeight: 700 }}>
              {items.length ? `تمت معالجة ${completedCount} من ${items.length} — المحدد ${selectedCount}` : "اختر ملفات للبدء"}
            </span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="btn btn-secondary" onClick={closeModal}>إغلاق</button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void saveSelected()}
                disabled={!perm.create || processing || saving || selectedCount === 0}
                title={!perm.create ? "تحتاج صلاحية إنشاء في قسم التنفيذات" : undefined}
              >
                {saving ? "جارِ إنشاء التنفيذات..." : `إنشاء التنفيذات المحددة${selectedCount ? ` (${selectedCount})` : ""}`}
              </button>
            </div>
          </div>
        )}
      >
        <div dir="rtl" style={{ display: "grid", gap: 14 }}>
          {!perm.create && (
            <div style={{ padding: 10, border: "1px solid #fde68a", borderRadius: 10, background: "#fffbeb", color: "#92400e", fontSize: 12, fontWeight: 800 }}>
              يمكنك رفع الجوازات وقراءة البيانات ومراجعتها، لكن إنشاء التنفيذات يحتاج صلاحية «إنشاء» في قسم التنفيذات.
            </div>
          )}

          <div style={{ padding: 12, border: "1px solid #dbe3ee", borderRadius: 12, background: "#f8fafc" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={processing || saving}
                style={{
                  minHeight: 42,
                  border: 0,
                  borderRadius: 10,
                  padding: "9px 14px",
                  background: "#0f1b3d",
                  color: "#fff",
                  fontWeight: 800,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  cursor: processing ? "wait" : "pointer",
                }}
              >
                {processing ? <Loader2 size={17} className="animate-spin" /> : <Upload size={17} />}
                {processing ? "جارِ قراءة الجوازات..." : "اختيار مجموعة صور أو ملف PDF"}
              </button>
              <span style={{ display: "inline-flex", gap: 6, alignItems: "center", color: "#166534", fontSize: 12, fontWeight: 800 }}>
                <ShieldCheck size={15} /> الملفات لا تُحفظ في Supabase
              </span>
              <span style={{ color: "#64748b", fontSize: 11, fontWeight: 700 }}>
                حتى {MAX_BATCH_ITEMS} صورة أو {MAX_BATCH_ITEMS} صفحة PDF — القراءة تتم بحد أقصى {OCR_CONCURRENCY} جوازات معًا
              </span>
            </div>
            {items.length > 0 && (
              <div style={{ marginTop: 10, height: 7, borderRadius: 999, overflow: "hidden", background: "#e2e8f0" }}>
                <div style={{ width: `${Math.round((completedCount / items.length) * 100)}%`, height: "100%", background: "#0f1b3d", transition: "width .2s ease" }} />
              </div>
            )}
          </div>

          {items.length > 0 && (
            <div style={{ padding: 12, border: "1px solid #e2e8f0", borderRadius: 12, background: "#fff" }}>
              <div style={{ fontWeight: 900, color: "#0f1b3d", marginBottom: 9 }}>بيانات مشتركة للصفوف المحددة</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8 }}>
                <label style={{ fontSize: 11, fontWeight: 800 }}>الوكيل
                  <select style={inputStyle} value={common.agent_id} onChange={(e) => setCommon((v) => ({ ...v, agent_id: e.target.value }))}>
                    <option value="">—</option>
                    {activeAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                  </select>
                </label>
                <label style={{ fontSize: 11, fontWeight: 800 }}>حالة الموافقة
                  <select style={inputStyle} value={common.status} onChange={(e) => setCommon((v) => ({ ...v, status: e.target.value }))}>
                    <option value="">—</option>{renderOptions(approvalStatuses, common.status)}
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
                  <input style={inputStyle} type="date" value={common.travel_date} onChange={(e) => setCommon((v) => ({ ...v, travel_date: e.target.value }))} />
                </label>
              </div>
              <div style={{ marginTop: 9, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <button type="button" className="btn btn-secondary" onClick={applyCommonToSelected}>تطبيق على المحدد</button>
                <span style={{ fontSize: 11, color: "#b45309", fontWeight: 700 }}>
                  حالة «منفذ» لا تُحفظ جماعيًا قبل استكمال الخدمات والأسعار، حفاظًا على صحة الحسابات.
                </span>
              </div>
            </div>
          )}

          {items.length > 0 && (
            <div style={{ overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: 12 }}>
              <table style={{ width: "100%", minWidth: 1500, borderCollapse: "collapse", background: "#fff", fontSize: 11 }}>
                <thead>
                  <tr style={{ background: "#f8fafc", color: "#334155" }}>
                    {[
                      "✓", "المصدر", "الاسم", "الرقم القومي", "تاريخ الميلاد", "نوع المسافر", "رقم الجواز", "محل الميلاد",
                      "الوكيل", "حالة الموافقة", "حالة العملية", "جهة المغادرة", "الوجهة", "الطيران", "تاريخ المغادرة", "حالة القراءة",
                    ].map((heading) => <th key={heading} style={{ padding: "8px 6px", borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" }}>{heading}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const duplicate = duplicateIds.has(item.id);
                    const badge = statusStyle(item, duplicate);
                    const editable = ["done", "review", "save_error"].includes(item.statusCode);
                    const warnings = [...item.warnings];
                    if (duplicate) warnings.unshift("رقم الجواز أو الرقم القومي مكرر داخل هذه الدفعة");
                    return (
                      <tr key={item.id} style={{ verticalAlign: "top", opacity: item.statusCode === "saved" ? 0.72 : 1 }}>
                        <td style={{ padding: 6, textAlign: "center" }}>
                          <input
                            type="checkbox"
                            checked={item.selected}
                            disabled={!editable}
                            onChange={(e) => updateItem(item.id, { selected: e.target.checked })}
                          />
                        </td>
                        <td style={{ padding: 6, maxWidth: 160 }} title={item.label}>
                          <div style={{ display: "flex", gap: 5, alignItems: "center", fontWeight: 700 }}>
                            {item.label.toLowerCase().includes("صفحة") ? <FileText size={13} /> : <FileImage size={13} />}
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 130 }}>{item.label}</span>
                          </div>
                        </td>
                        <td style={{ padding: 4 }}><input style={{ ...inputStyle, minWidth: 155 }} disabled={!editable} value={item.passenger_name} onChange={(e) => updateItem(item.id, { passenger_name: e.target.value })} /></td>
                        <td style={{ padding: 4 }}><input style={{ ...inputStyle, minWidth: 125 }} disabled={!editable} value={item.national_id} onChange={(e) => updateItem(item.id, { national_id: e.target.value })} /></td>
                        <td style={{ padding: 4 }}><input style={{ ...inputStyle, minWidth: 125 }} type="date" disabled={!editable} value={item.dob} onChange={(e) => updateItem(item.id, { dob: e.target.value })} /></td>
                        <td style={{ padding: 4 }}>
                          <select style={{ ...inputStyle, minWidth: 120 }} disabled={!editable} value={item.passenger_type} onChange={(e) => updateItem(item.id, { passenger_type: e.target.value })}>
                            <option value="">—</option>{renderOptions(passengerTypes, item.passenger_type)}
                          </select>
                        </td>
                        <td style={{ padding: 4 }}><input style={{ ...inputStyle, minWidth: 105 }} disabled={!editable} value={item.passport} onChange={(e) => updateItem(item.id, { passport: e.target.value })} /></td>
                        <td style={{ padding: 4 }}><input style={{ ...inputStyle, minWidth: 105 }} disabled={!editable} value={item.birth_place} onChange={(e) => updateItem(item.id, { birth_place: e.target.value })} /></td>
                        <td style={{ padding: 4 }}>
                          <select style={{ ...inputStyle, minWidth: 120 }} disabled={!editable} value={item.agent_id} onChange={(e) => updateItem(item.id, { agent_id: e.target.value })}>
                            <option value="">—</option>{activeAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                          </select>
                        </td>
                        <td style={{ padding: 4 }}><select style={{ ...inputStyle, minWidth: 105 }} disabled={!editable} value={item.status} onChange={(e) => updateItem(item.id, { status: e.target.value })}><option value="">—</option>{renderOptions(approvalStatuses, item.status)}</select></td>
                        <td style={{ padding: 4 }}><select style={{ ...inputStyle, minWidth: 115 }} disabled={!editable} value={item.operation_status} onChange={(e) => updateItem(item.id, { operation_status: e.target.value })}><option value="">—</option>{renderOptions(operationStatuses, item.operation_status)}</select></td>
                        <td style={{ padding: 4 }}><select style={{ ...inputStyle, minWidth: 120 }} disabled={!editable} value={item.departure_from} onChange={(e) => updateItem(item.id, { departure_from: e.target.value })}><option value="">—</option>{renderOptions(departures, item.departure_from)}</select></td>
                        <td style={{ padding: 4 }}><select style={{ ...inputStyle, minWidth: 90 }} disabled={!editable} value={item.destination} onChange={(e) => updateItem(item.id, { destination: e.target.value })}><option value="">—</option>{renderOptions(destinations, item.destination)}</select></td>
                        <td style={{ padding: 4 }}><select style={{ ...inputStyle, minWidth: 100 }} disabled={!editable} value={item.airline} onChange={(e) => updateItem(item.id, { airline: e.target.value })}><option value="">—</option>{renderOptions(airlines, item.airline)}</select></td>
                        <td style={{ padding: 4 }}><input style={{ ...inputStyle, minWidth: 125 }} type="date" disabled={!editable} value={item.travel_date} onChange={(e) => updateItem(item.id, { travel_date: e.target.value })} /></td>
                        <td style={{ padding: 6, minWidth: 180 }}>
                          <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap" }}>
                            <span style={{ ...badge, border: `1px solid ${badge.border}`, borderRadius: 999, padding: "3px 7px", fontWeight: 900, whiteSpace: "nowrap" }}>
                              {item.statusCode === "reading" || item.statusCode === "saving" ? <Loader2 size={11} className="animate-spin" style={{ display: "inline", marginLeft: 4 }} /> : null}
                              {statusLabel(item, duplicate)}
                            </span>
                            {item.mrzVerified && <span title="MRZ verified" style={{ color: "#166534", fontWeight: 900 }}>MRZ ✓</span>}
                            {item.statusCode === "error" && sourceRefs.current.has(item.id) && (
                              <button type="button" onClick={() => void retryItem(item.id)} disabled={processing || saving} title="إعادة المحاولة" style={{ border: 0, background: "transparent", cursor: "pointer", color: "#0f1b3d", padding: 2 }}>
                                <RefreshCw size={15} />
                              </button>
                            )}
                          </div>
                          {item.error && <div style={{ marginTop: 4, color: "#b91c1c", fontWeight: 700 }}>{item.error}</div>}
                          {warnings.length > 0 && <div style={{ marginTop: 4, color: "#92400e", lineHeight: 1.45 }}>{warnings.join("، ")}</div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!items.length && (
            <div style={{ minHeight: 180, border: "1px dashed #cbd5e1", borderRadius: 12, display: "grid", placeItems: "center", textAlign: "center", padding: 20, color: "#64748b" }}>
              <div>
                <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 10 }}><FileImage size={26} /><FileText size={26} /></div>
                <div style={{ fontWeight: 900, color: "#334155" }}>مجموعة صور جوازات أو ملف PDF واحد</div>
                <div style={{ fontSize: 12, marginTop: 6 }}>كل صورة أو كل صفحة PDF تُعامل كجواز مستقل، ثم تراجع البيانات قبل إنشاء التنفيذات.</div>
              </div>
            </div>
          )}

          {items.some((item) => item.statusCode === "error") && (
            <div style={{ display: "flex", gap: 7, alignItems: "center", color: "#b91c1c", fontSize: 12, fontWeight: 700 }}>
              <XCircle size={15} /> فشل عنصر واحد لا يوقف باقي الدفعة. يمكنك إعادة محاولة العنصر الفاشل وحده.
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
