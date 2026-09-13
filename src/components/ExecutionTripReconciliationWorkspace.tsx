import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ClipboardPaste, FileSpreadsheet, Loader2, RefreshCw } from "lucide-react";
import { Modal } from "@/components/Modal";
import { SearchableSelect } from "@/components/inputs/SearchableSelect";
import { usePerm } from "@/hooks/usePerm";
import { confirmDialog } from "@/lib/confirm";
import type { ParsedFile } from "@/lib/dataImport/parse";
import { parsePastedManifest } from "@/lib/executionTripClipboard";
import { inferSingleTripDate } from "@/lib/executionTripManifestDate";
import {
  buildReconciliationFileRows,
  detectPassengerColumns,
  filterExecutionsForTrip,
  reconcilePassengerRows,
  type PassengerColumnDetection,
  type ReconciliationExecution,
  type ReconciliationMatch,
} from "@/lib/executionTripReconciliation";
import { toast } from "sonner";

type CandidateState = "idle" | "loading" | "ready" | "error";
type Option = { value: string; label: string };
type Failure = { executionId: string; name: string; error: string };
type Props = { onExit?: () => void };

const emptyColumns = (): PassengerColumnDetection => ({ name: "", passport: "", nationalId: "" });
const unique = (values: Array<string | null | undefined>) => Array.from(new Set(values.map((v) => String(v || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "ar"));
const inputStyle: CSSProperties = { width: "100%", height: 38, padding: "0 10px", borderRadius: 9, border: "1px solid #e2e8f0", background: "#fff", color: "#0f172a", fontSize: 12.5 };
const th: CSSProperties = { padding: "9px 10px", textAlign: "right", color: "#475569", fontWeight: 800, whiteSpace: "nowrap" };
const td: CSSProperties = { padding: "9px 10px", color: "#334155", verticalAlign: "middle" };

export function ExecutionTripReconciliationWorkspace({ onExit }: Props = {}) {
  const perm = usePerm("executions");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(true);
  const [travelDate, setTravelDate] = useState("");
  const [departureFrom, setDepartureFrom] = useState("");
  const [destination, setDestination] = useState("");
  const [airline, setAirline] = useState("");
  const [approvalCompanyId, setApprovalCompanyId] = useState("");
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [fileName, setFileName] = useState("");
  const [columns, setColumns] = useState<PassengerColumnDetection>(emptyColumns);
  const [dateExecutions, setDateExecutions] = useState<ReconciliationExecution[]>([]);
  const [candidateState, setCandidateState] = useState<CandidateState>("idle");
  const [candidateError, setCandidateError] = useState("");
  const [candidateRefresh, setCandidateRefresh] = useState(0);
  const [companyOptions, setCompanyOptions] = useState<Option[]>([]);
  const [agentById, setAgentById] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [manualSelections, setManualSelections] = useState<Record<number, string>>({});
  const [parsing, setParsing] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [failures, setFailures] = useState<Failure[]>([]);
  const [fileStatus, setFileStatus] = useState("");
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteText, setPasteText] = useState("");

  const departureOptions = useMemo(() => unique(dateExecutions.map((x) => x.departure_from)), [dateExecutions]);
  const destinationOptions = useMemo(() => unique(dateExecutions.map((x) => x.destination)), [dateExecutions]);
  const airlineOptions = useMemo(() => unique(dateExecutions.map((x) => x.airline)), [dateExecutions]);

  useEffect(() => {
    let active = true;
    if (!parsed || !travelDate) {
      setDateExecutions([]); setCompanyOptions([]); setAgentById(new Map()); setCandidateState("idle"); setCandidateError("");
      return () => { active = false; };
    }
    setCandidateState("loading"); setCandidateError("");
    void (async () => {
      try {
        const { fetchReconciliationExecutionsForDate, fetchReconciliationReferenceLabels } = await import("@/lib/executionTripCandidateQuery");
        const rows = await fetchReconciliationExecutionsForDate(travelDate);
        if (!active) return;
        setDateExecutions(rows);
        const refs = await fetchReconciliationReferenceLabels(rows);
        if (!active) return;
        setCompanyOptions(refs.companies);
        setAgentById(new Map(Object.entries(refs.agents)));
        setCandidateState("ready");
      } catch (error: any) {
        if (!active) return;
        setDateExecutions([]); setCompanyOptions([]); setAgentById(new Map()); setCandidateState("error");
        setCandidateError(error?.message || "تعذر تحميل تنفيذات تاريخ الرحلة");
      }
    })();
    return () => { active = false; };
  }, [parsed, travelDate, candidateRefresh]);

  const tripCandidates = useMemo(() => filterExecutionsForTrip(dateExecutions, { travelDate, departureFrom, destination, airline, approvalCompanyId }), [dateExecutions, travelDate, departureFrom, destination, airline, approvalCompanyId]);
  const fileRows = useMemo(() => parsed ? buildReconciliationFileRows(parsed.rows, columns) : [], [parsed, columns]);
  const matches = useMemo(() => candidateState === "ready" && travelDate && fileRows.length ? reconcilePassengerRows(fileRows, tripCandidates) : [], [candidateState, travelDate, fileRows, tripCandidates]);
  const counts = useMemo(() => {
    const out = { matched: 0, already_executed: 0, review: 0, unmatched: 0, duplicate: 0 };
    matches.forEach((m) => { out[m.status] += 1; }); return out;
  }, [matches]);
  const selectedExecutionIds = useMemo(() => {
    const ids = new Set<string>();
    matches.forEach((m) => {
      if (m.status === "matched" && m.execution) ids.add(m.execution.id);
      if (m.status === "review") {
        const id = manualSelections[m.source.index];
        const candidate = m.candidates.find((x) => x.execution.id === id);
        if (candidate && String(candidate.execution.operation_status || "").trim() !== "منفذ") ids.add(candidate.execution.id);
      }
    });
    return Array.from(ids);
  }, [matches, manualSelections]);

  useEffect(() => {
    if (!parsed || !columns.name || !travelDate || parsing || candidateState !== "ready" || typeof window === "undefined") return;
    const timer = window.setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
    return () => window.clearTimeout(timer);
  }, [parsed, columns.name, travelDate, parsing, candidateState]);

  const reset = () => {
    setParsed(null); setFileName(""); setColumns(emptyColumns()); setDateExecutions([]); setCandidateState("idle"); setCandidateError("");
    setCompanyOptions([]); setAgentById(new Map()); setManualSelections({}); setFailures([]); setFileStatus(""); setProgress({ done: 0, total: 0 });
    setPasteMode(false); setPasteText(""); if (fileInputRef.current) fileInputRef.current.value = "";
  };
  const close = () => { if (executing) return; setOpen(false); reset(); onExit?.(); };

  const acceptParsed = (next: ParsedFile, label: string) => {
    if (!next.headers.length || !next.rows.length) throw new Error("البيانات لا تحتوي على صفوف قابلة للمطابقة");
    const detected = detectPassengerColumns(next.headers);
    const inferred = inferSingleTripDate(next.headers, next.rows, next.rawRows);
    setParsed(next); setFileName(label); setColumns(detected); setManualSelections({}); setFailures([]); setDateExecutions([]); setCompanyOptions([]); setAgentById(new Map()); setCandidateState("idle"); setCandidateError("");
    if (!travelDate && inferred.date) { setTravelDate(inferred.date); setFileStatus(`تمت قراءة ${next.rows.length.toLocaleString("ar")} صف وتحديد تاريخ السفر تلقائيًا: ${inferred.date}`); }
    else if (travelDate && inferred.date && travelDate !== inferred.date) { setFileStatus(`تمت قراءة ${next.rows.length.toLocaleString("ar")} صف. تاريخ الملف ${inferred.date} مختلف عن التاريخ المحدد ${travelDate}.`); toast.warning("تاريخ الرحلة الموجود في الملف مختلف عن تاريخ السفر المحدد"); }
    else if (!travelDate && inferred.dates.length > 1) { setFileStatus(`تمت قراءة ${next.rows.length.toLocaleString("ar")} صف، لكن البيانات تحتوي أكثر من تاريخ؛ اختر تاريخ السفر.`); toast.info("اختر تاريخ السفر المطلوب"); }
    else if (!travelDate) { setFileStatus(`تمت قراءة ${next.rows.length.toLocaleString("ar")} صف. اختر تاريخ السفر لبدء المطابقة.`); }
    else setFileStatus(`تمت قراءة ${next.rows.length.toLocaleString("ar")} صف وبدأ تحميل تنفيذات تاريخ ${travelDate}.`);
    if (!detected.name) toast.info("اختر عمود اسم الراكب قبل المطابقة");
  };

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setParsing(true); setFailures([]); setFileStatus("");
    try {
      const { parseFile } = await import("@/lib/dataImport/parse");
      acceptParsed(await parseFile(file), file.name);
    } catch (error: any) { reset(); toast.error(error?.message || "تعذر قراءة ملف Excel"); }
    finally { setParsing(false); if (fileInputRef.current) fileInputRef.current.value = ""; }
  };

  const handlePaste = () => {
    try { acceptParsed(parsePastedManifest(pasteText), "بيانات ملصقة من Excel"); setPasteMode(false); setPasteText(""); }
    catch (error: any) { toast.error(error?.message || "تعذر قراءة البيانات الملصقة"); }
  };

  const executeMatched = async () => {
    if (!perm.edit || executing || !selectedExecutionIds.length) return;
    const ok = await confirmDialog(`سيتم تحويل ${selectedExecutionIds.length.toLocaleString("ar")} راكب إلى «منفذ» واعتماد الحركات المالية عبر نفس مسار التنفيذ الحالي. هل تريد المتابعة؟`, { confirmLabel: "تنفيذ المطابقين" });
    if (!ok) return;
    setExecuting(true); setFailures([]); setProgress({ done: 0, total: selectedExecutionIds.length });
    let success = 0; const failed: Failure[] = [];
    try {
      const { executeExistingExecution } = await import("@/lib/executionBulkExecution");
      for (let i = 0; i < selectedExecutionIds.length; i += 1) {
        const id = selectedExecutionIds[i]; const source = dateExecutions.find((x) => x.id === id);
        try { const result = await executeExistingExecution(id); if (result.status === "executed" || result.status === "already_executed") success += 1; }
        catch (error: any) { failed.push({ executionId: id, name: source?.passenger_name || id, error: error?.message || "فشل اعتماد التنفيذ" }); }
        setProgress({ done: i + 1, total: selectedExecutionIds.length });
      }
    } catch (error: any) {
      selectedExecutionIds.forEach((id) => failed.push({ executionId: id, name: dateExecutions.find((x) => x.id === id)?.passenger_name || id, error: error?.message || "تعذر تحميل مسار اعتماد التنفيذ" }));
    }
    setFailures(failed); setExecuting(false); setCandidateRefresh((v) => v + 1);
    if (!failed.length) toast.success(`تم تنفيذ واعتماد ${success.toLocaleString("ar")} راكب بنجاح`); else toast.error(`تم ${success.toLocaleString("ar")} وحدث خطأ في ${failed.length.toLocaleString("ar")} تنفيذ`);
  };

  if (!perm.edit) return null;
  return <>
    <input ref={fileInputRef} hidden type="file" accept=".xlsx,.xls,.csv,.txt" onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) void handleFile(f); }} />
    <Modal open={open} onClose={close} maxWidth={1120} zIndex={10030}
      title={<div style={{ display: "flex", alignItems: "center", gap: 8 }}><FileSpreadsheet size={19} /><span>مطابقة كشف الرحلة وتنفيذ المطابقين</span></div>}
      footer={<div style={{ display: "flex", gap: 8, justifyContent: executing ? "space-between" : "flex-end", alignItems: "center", width: "100%", flexWrap: "wrap" }}>
        {executing && <span style={{ fontSize: 12, color: "#64748b" }}>{`جاري التنفيذ ${progress.done.toLocaleString("ar")} / ${progress.total.toLocaleString("ar")}`}</span>}
        <div style={{ display: "flex", gap: 8 }}><button type="button" className="action-btn" onClick={close} disabled={executing}>إغلاق</button><button type="button" onClick={executeMatched} disabled={executing || candidateState !== "ready" || !selectedExecutionIds.length} style={{ minHeight: 36, border: 0, borderRadius: 9, padding: "7px 14px", background: selectedExecutionIds.length && !executing && candidateState === "ready" ? "#047857" : "#cbd5e1", color: "#fff", fontWeight: 800 }}>{executing && <Loader2 size={15} className="animate-spin" />} تنفيذ {selectedExecutionIds.length.toLocaleString("ar")} راكب</button></div>
      </div>}>
      <div dir="rtl" style={{ display: "grid", gap: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}>
          <Field label="تاريخ السفر *"><input type="date" value={travelDate} onChange={(e) => { setTravelDate(e.target.value); setManualSelections({}); }} style={inputStyle} /></Field>
          <Field label="من (اختياري)"><SearchableSelect value={departureFrom} onChange={(v) => { setDepartureFrom(v); setManualSelections({}); }} options={departureOptions} placeholder="كل جهات المغادرة" /></Field>
          <Field label="إلى (اختياري)"><SearchableSelect value={destination} onChange={(v) => { setDestination(v); setManualSelections({}); }} options={destinationOptions} placeholder="كل الوجهات" /></Field>
          <Field label="شركة الطيران (اختياري)"><SearchableSelect value={airline} onChange={(v) => { setAirline(v); setManualSelections({}); }} options={airlineOptions} placeholder="كل شركات الطيران" /></Field>
          <Field label="الشركة الصادرة (اختياري)"><SearchableSelect value={approvalCompanyId} onChange={(v) => { setApprovalCompanyId(v); setManualSelections({}); }} options={companyOptions} placeholder="كل الشركات" /></Field>
        </div>
        <div style={{ padding: 12, border: "1px dashed #94a3b8", borderRadius: 10, background: "#f8fafc" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" disabled={parsing || executing} onClick={() => fileInputRef.current?.click()} style={{ minHeight: 38, padding: "8px 12px", border: 0, borderRadius: 9, background: "#0f1b3d", color: "#fff", fontWeight: 800, display: "inline-flex", gap: 7, alignItems: "center" }}>{parsing ? <Loader2 size={15} className="animate-spin" /> : <FileSpreadsheet size={16} />}{parsing ? "جاري قراءة الملف…" : "اختيار Excel / CSV"}</button>
            <button type="button" disabled={parsing || executing} onClick={() => setPasteMode((v) => !v)} className="action-btn" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><ClipboardPaste size={15} /> لصق من Excel</button>
            <span style={{ fontSize: 12.5, color: "#475569" }}>{fileName || "لم يتم اختيار بيانات"}</span>{parsed && <button type="button" className="action-btn" onClick={reset}>مسح البيانات</button>}
          </div>
          {pasteMode && <div style={{ marginTop: 10, display: "grid", gap: 8 }}><div style={{ fontSize: 11.5, color: "#64748b" }}>انسخ صف العناوين والركاب من Excel ثم الصقهم هنا. النص يظل في ذاكرة الصفحة فقط.</div><textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={6} placeholder={"اسم المسافر\tالرقم القومى\tتاريخ المغادره\nمحمد أحمد\t123456789\t2026-09-01"} style={{ ...inputStyle, height: "auto", minHeight: 120, padding: 10, resize: "vertical" }} /><button type="button" className="action-btn" onClick={handlePaste} disabled={!pasteText.trim()}>استخدام البيانات الملصقة</button></div>}
          {fileStatus && <div style={{ marginTop: 9, padding: "8px 10px", borderRadius: 8, background: "#ecfdf5", border: "1px solid #a7f3d0", color: "#047857", fontSize: 12, fontWeight: 800 }}>{fileStatus}</div>}
        </div>
        {parsed && <div style={{ display: "grid", gap: 10 }}><strong>تحديد أعمدة الملف</strong><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 10 }}><HeaderSelect label="عمود اسم الراكب *" value={columns.name} headers={parsed.headers} onChange={(v) => { setColumns((c) => ({ ...c, name: v })); setManualSelections({}); }} /><HeaderSelect label="عمود رقم الجواز" value={columns.passport} headers={parsed.headers} onChange={(v) => { setColumns((c) => ({ ...c, passport: v })); setManualSelections({}); }} optional /><HeaderSelect label="عمود الرقم القومي" value={columns.nationalId} headers={parsed.headers} onChange={(v) => { setColumns((c) => ({ ...c, nationalId: v })); setManualSelections({}); }} optional /></div></div>}
        {parsed && travelDate && candidateState === "loading" && <Hint text={`جاري تحميل تنفيذات تاريخ ${travelDate} فقط…`} />}
        {parsed && travelDate && candidateState === "error" && <div style={{ padding: 12, border: "1px solid #fecaca", borderRadius: 9, color: "#991b1b", background: "#fef2f2" }}>{candidateError} <button type="button" className="action-btn" onClick={() => setCandidateRefresh((v) => v + 1)}><RefreshCw size={14} /> إعادة المحاولة</button></div>}
        {parsed && columns.name && travelDate && candidateState === "ready" && <div ref={resultsRef} style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(135px,1fr))", gap: 8 }}><Stat label="أسماء الكشف" value={fileRows.length} /><Stat label="مرشحو نفس الرحلة" value={tripCandidates.length} /><Stat label="مطابق مؤكد" value={counts.matched} /><Stat label="منفذ مسبقًا" value={counts.already_executed} /><Stat label="يحتاج مراجعة" value={counts.review} /><Stat label="غير موجود" value={counts.unmatched} /><Stat label="مكرر" value={counts.duplicate} /></div>
          {!!failures.length && <div style={{ padding: 10, color: "#991b1b", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10 }}>{failures.map((f) => <div key={f.executionId}>{f.name}: {f.error}</div>)}</div>}
          <div style={{ overflow: "auto", maxHeight: "48vh", border: "1px solid #e2e8f0", borderRadius: 10 }}><table style={{ width: "100%", minWidth: 980, borderCollapse: "collapse", fontSize: 12 }}><thead><tr style={{ background: "#f8fafc" }}><th style={th}>#</th><th style={th}>اسم ملف الشركة</th><th style={th}>الجواز / الرقم القومي</th><th style={th}>النتيجة</th><th style={th}>المطابق في النظام</th><th style={th}>الوكيل</th><th style={th}>اختيار المراجعة</th></tr></thead><tbody>{matches.map((m) => <ResultRow key={`${m.source.index}:${m.source.name}`} match={m} agentById={agentById} selectedId={manualSelections[m.source.index] || ""} onSelect={(v) => setManualSelections((c) => ({ ...c, [m.source.index]: v }))} />)}</tbody></table></div>
        </div>}
        {parsed && !travelDate && <Hint text="اختر تاريخ السفر لبدء المطابقة." />}{parsed && !columns.name && <Hint text="حدد عمود اسم الراكب." />}
      </div>
    </Modal>
  </>;
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <div><div style={{ fontSize: 11.5, color: "#475569", fontWeight: 800, marginBottom: 5 }}>{label}</div>{children}</div>; }
function HeaderSelect({ label, value, headers, onChange, optional }: { label: string; value: string; headers: string[]; onChange: (v: string) => void; optional?: boolean }) { return <Field label={label}><select value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle}><option value="">{optional ? "— بدون —" : "— اختر العمود —"}</option>{headers.map((h) => <option key={h} value={h}>{h}</option>)}</select></Field>; }
function Stat({ label, value }: { label: string; value: number }) { return <div style={{ padding: 10, borderRadius: 9, background: "#f8fafc", border: "1px solid #e2e8f0" }}><div style={{ fontSize: 10.5, color: "#64748b" }}>{label}</div><strong>{value.toLocaleString("ar")}</strong></div>; }
function Hint({ text }: { text: string }) { return <div style={{ padding: 12, borderRadius: 9, background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1d4ed8", fontSize: 12.5 }}>{text}</div>; }

function ResultRow({ match, agentById, selectedId, onSelect }: { match: ReconciliationMatch; agentById: ReadonlyMap<string, string>; selectedId: string; onSelect: (v: string) => void }) {
  const labels = { matched: "مطابق مؤكد", already_executed: "منفذ مسبقًا", review: "يحتاج مراجعة", unmatched: "غير موجود", duplicate: "مكرر في الكشف" } as const;
  const resolved = match.execution || match.candidates.find((c) => c.execution.id === selectedId)?.execution || null;
  return <tr style={{ borderTop: "1px solid #f1f5f9" }}><td style={td}>{match.source.index + 1}</td><td style={td}>{match.source.name || "—"}</td><td style={td}>{[match.source.passport, match.source.nationalId].filter(Boolean).join(" / ") || "—"}</td><td style={td}>{labels[match.status]}</td><td style={td}>{resolved?.passenger_name || "—"}</td><td style={td}>{resolved?.agent_id ? agentById.get(resolved.agent_id) || "—" : "—"}</td><td style={td}>{match.status === "review" ? <select value={selectedId} onChange={(e) => onSelect(e.target.value)} style={{ ...inputStyle, minWidth: 250 }}><option value="">— راجع واختر —</option>{match.candidates.map((c) => { const done = String(c.execution.operation_status || "").trim() === "منفذ"; return <option key={c.execution.id} value={c.execution.id} disabled={done}>{c.execution.passenger_name}{c.reason === "fuzzy_name" ? ` — ${Math.round(c.score * 100)}%` : ""}{done ? " — منفذ" : ""}</option>; })}</select> : match.status === "matched" ? "سيتم تنفيذه" : "—"}</td></tr>;
}
