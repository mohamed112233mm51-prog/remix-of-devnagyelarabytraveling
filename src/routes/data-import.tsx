import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Upload, FileSpreadsheet, Download, Check, AlertTriangle, Undo2, ArrowRight, ArrowLeft, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { usePerm } from "@/hooks/usePerm";
import { useLive, type Agent, type IssuingCompany, type Merchant, type Investor } from "@/lib/db";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { confirmDialog } from "@/lib/confirm";
import { IMPORT_SPECS, getSpec, type ImportSpec } from "@/lib/dataImport/specs";
import { parseFile, type ParsedFile } from "@/lib/dataImport/parse";
import { suggestMapping } from "@/lib/dataImport/mapper";
import { validateRows, type Lookups, type RowError } from "@/lib/dataImport/validate";
import { batchInsert, recordBatch, undoBatch } from "@/lib/dataImport/insert";
import { downloadTemplate } from "@/lib/dataImport/templates";
import { autoCreateMissingLookups } from "@/lib/dataImport/autoCreate";
import { patchLive } from "@/lib/db";

export const Route = createFileRoute("/data-import")({
  component: DataImportPage,
});

const norm = (s: any) =>
  String(s ?? "")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[إأآا]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/\s+/g, " ").trim().toLowerCase();

function DataImportPage() {
  const { isAdmin, user } = useAuth();
  const { view: canView, create: canImport, delete: canUndo } = usePerm("data_import");
  const allowed = isAdmin || canView;
  const { rows: agents } = useLive<Agent>("agents");
  const { rows: companies } = useLive<IssuingCompany>("issuing_companies");
  const { rows: merchants } = useLive<Merchant>("merchants");
  const { rows: investors } = useLive<Investor>("investors");

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [specId, setSpecId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [progress, setProgress] = useState(0);
  const [importing, setImporting] = useState(false);
  const [batches, setBatches] = useState<any[]>([]);

  const spec = useMemo(() => (specId ? getSpec(specId) : undefined), [specId]);

  const lookups: Lookups = useMemo(() => ({
    agent: new Map(agents.map((a) => [norm(a.name), a.id])),
    company: new Map(companies.map((c) => [norm(c.company_name), c.id])),
    merchant: new Map(merchants.map((m) => [norm(m.merchant_name), m.id])),
    investor: new Map(investors.map((i) => [norm(i.investor_name), i.id])),
  }), [agents, companies, merchants, investors]);

  const [existingKeys, setExistingKeys] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!spec) return;
    setExistingKeys(new Set());
    if (!spec.dedupeKey) return;
    (async () => {
      const { data } = await (supabase.from(spec.table as any) as any).select("*").limit(5000);
      if (Array.isArray(data)) {
        const s = new Set<string>();
        for (const r of data) {
          const k = spec.dedupeKey!(r);
          if (k) s.add(k);
        }
        setExistingKeys(s);
      }
    })();
  }, [spec]);

  const loadBatches = async () => {
    const { data } = await (supabase.from("import_batches" as any) as any)
      .select("*").order("created_at", { ascending: false }).limit(10);
    setBatches(Array.isArray(data) ? data : []);
  };
  useEffect(() => { if (allowed) loadBatches(); }, [allowed]);

  const validation = useMemo(() => {
    if (!spec || !parsed) return null;
    return validateRows(spec, parsed.rows, mapping, lookups, existingKeys);
  }, [spec, parsed, mapping, lookups, existingKeys]);

  if (!allowed) {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <h2 style={{ marginBottom: 8 }}>غير مصرح</h2>
        <p style={{ color: "var(--text2)" }}>تحتاج صلاحية "إدارة واستيراد البيانات" للوصول إلى هذه الصفحة.</p>
        <Link to="/" style={{ display: "inline-block", marginTop: 16, color: "var(--primary)" }}>عودة للوحة التحكم</Link>
      </div>
    );
  }

  const onPickType = (id: string) => {
    setSpecId(id);
    setFile(null); setParsed(null); setMapping({});
    setStep(2);
  };

  const onFile = async (f: File) => {
    if (!spec) return;
    setFile(f);
    try {
      const p = await parseFile(f);
      setParsed(p);
      setMapping(suggestMapping(spec, p.headers));
      setStep(3);
    } catch (e: any) {
      toast.error(e?.message || "تعذر قراءة الملف");
    }
  };

  const runImport = async () => {
    if (!spec || !parsed) return;
    if (!(isAdmin || canImport)) {
      toast.error("لا تملك صلاحية تنفيذ الاستيراد");
      return;
    }
    if (!(await confirmDialog(`تأكيد استيراد البيانات إلى "${spec.label}"؟ سيتم إضافتها كسجلات حقيقية داخل النظام.`, { confirmLabel: "استيراد", cancelLabel: "إلغاء" }))) return;
    setImporting(true);
    setProgress(0);
    let insertedIds: string[] = [];
    let failed = 0;
    let createdMsg = "";
    try {
      const { created } = await autoCreateMissingLookups(spec, parsed.rows, mapping, lookups);
      createdMsg = Object.entries(created)
        .map(([k, n]) => `${n} ${k === "agent" ? "وكيل" : k === "company" ? "شركة" : k === "merchant" ? "تاجر" : "مستثمر"}`)
        .join("، ");

      const v2 = validateRows(spec, parsed.rows, mapping, lookups, existingKeys);
      if (!v2.validRows.length) {
        toast.error("لا توجد صفوف صالحة للاستيراد");
        setImporting(false);
        return;
      }

      const res = await batchInsert(spec.table, v2.validRows, (d, t) => {
        setProgress(Math.round((d / t) * 100));
      });
      insertedIds = res.insertedIds;
      failed = res.failed;

      if (spec.id === "expenses" && insertedIds.length) {
        const deductions = v2.validRows.slice(0, insertedIds.length).map((r, i) => ({
          expense_id: insertedIds[i],
          deduction_date: r.date,
          amount: Number(r.amount || 0),
          currency: r.currency || "EGP",
          usd_amount: Number(r.usd_amount || 0),
          exchange_rate: r.exchange_rate ?? null,
          funding_source: r.funding_source ?? null,
          merchant_id: r.merchant_id ?? null,
          status: "مكتمل",
        }));
        const { data: dedData } = await (supabase.from("expense_deductions" as any) as any).insert(deductions).select("*");
        if (Array.isArray(dedData)) {
          for (const row of dedData) patchLive("expense_deductions", { type: "insert", row });
        }
      }

      await recordBatch({
        importType: spec.id,
        targetTable: spec.table,
        fileName: file?.name || "",
        userEmail: user?.email ?? null,
        insertedIds,
      });

      // Full activity log entry: user, date, type, count, errors
      try {
        await supabase.from("activity_logs").insert({
          user_id: user?.id ?? null,
          user_email: user?.email ?? null,
          action: "data_import",
          entity: spec.table,
          details: {
            import_type: spec.id,
            label: spec.label,
            file_name: file?.name || "",
            rows_total: parsed.rows.length,
            rows_inserted: insertedIds.length,
            rows_failed: failed,
            rows_invalid: v2.errors.length,
            duplicates: v2.duplicates,
            auto_created: created,
          },
        });
      } catch { /* logging best-effort */ }

      toast.success(
        `تم استيراد ${insertedIds.length} سجل${failed ? ` — فشل ${failed}` : ""}` +
        (createdMsg ? ` — وأُنشئ تلقائيًا: ${createdMsg}` : ""),
      );
      await loadBatches();
      setStep(1); setSpecId(null); setFile(null); setParsed(null); setMapping({});
    } catch (e: any) {
      toast.error(e?.message || "فشل الاستيراد");
    } finally {
      setImporting(false);
    }
  };

  const handleUndo = async (b: any) => {
    if (!(isAdmin || canUndo)) {
      toast.error("لا تملك صلاحية التراجع عن الاستيراد");
      return;
    }
    if (!(await confirmDialog(`تأكيد التراجع عن استيراد ${b.rows_inserted} سجل؟`, { confirmLabel: "تراجع", cancelLabel: "إلغاء" }))) return;
    try {
      await undoBatch(b.id, b.target_table, Array.isArray(b.inserted_ids) ? b.inserted_ids : []);
      try {
        await supabase.from("activity_logs").insert({
          user_id: user?.id ?? null,
          user_email: user?.email ?? null,
          action: "data_import_undo",
          entity: b.target_table,
          details: { batch_id: b.id, rows: b.rows_inserted, import_type: b.import_type },
        });
      } catch {}
      toast.success("تم التراجع");
      await loadBatches();
    } catch (e: any) {
      toast.error(e?.message || "فشل التراجع");
    }
  };

  return (
    <div style={{ padding: "16px 0", display: "grid", gridTemplateColumns: "1fr 320px", gap: 16 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Stepper step={step} />
        {step === 1 && <TypePicker onPick={onPickType} />}
        {step === 2 && spec && (
          <FileStep spec={spec} file={file} onFile={onFile} onBack={() => setStep(1)} />
        )}
        {step === 3 && spec && parsed && (
          <MappingStep
            spec={spec}
            headers={parsed.headers}
            mapping={mapping}
            setMapping={setMapping}
            onBack={() => setStep(2)}
            onNext={() => setStep(4)}
          />
        )}
        {step === 4 && spec && parsed && validation && (
          <PreviewStep
            spec={spec}
            parsed={parsed}
            validation={validation}
            importing={importing}
            progress={progress}
            onBack={() => setStep(3)}
            onRun={runImport}
          />
        )}
      </div>
      <BatchesPanel batches={batches} onUndo={handleUndo} />
    </div>
  );
}

function Stepper({ step }: { step: number }) {
  const steps = ["نوع البيانات", "رفع الملف", "ربط الأعمدة", "معاينة وحفظ"];
  return (
    <div className="card" style={{ padding: "12px 16px", display: "flex", gap: 8, alignItems: "center" }}>
      {steps.map((s, i) => {
        const n = i + 1;
        const active = step === n, done = step > n;
        return (
          <div key={s} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 14, display: "grid", placeItems: "center",
              background: active ? "var(--primary)" : done ? "var(--green)" : "var(--bg3)",
              color: active || done ? "#fff" : "var(--text2)", fontWeight: 800, fontSize: 13,
            }}>{done ? <Check size={14} /> : n}</div>
            <div style={{ fontSize: 13, fontWeight: active ? 800 : 600, color: active ? "var(--text)" : "var(--text2)" }}>{s}</div>
            {n < steps.length && <ArrowLeft size={14} style={{ color: "var(--text3)", margin: "0 6px" }} />}
          </div>
        );
      })}
    </div>
  );
}

function TypePicker({ onPick }: { onPick: (id: string) => void }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <h3 style={{ marginBottom: 12, fontSize: 16, fontWeight: 800 }}>اختر نوع البيانات</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
        {IMPORT_SPECS.map((s) => (
          <div key={s.id}
            style={{
              border: "1px solid var(--border)", borderRadius: 12, padding: 14,
              background: "var(--bg2)", display: "flex", flexDirection: "column", gap: 10,
              transition: "all .15s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--primary)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <FileSpreadsheet size={20} style={{ color: "var(--primary)" }} />
              <div style={{ fontWeight: 800, fontSize: 14 }}>{s.label}</div>
            </div>
            <div style={{ fontSize: 12, color: "var(--text3)" }}>{s.fields.length} حقل</div>
            <div style={{ display: "flex", gap: 8, marginTop: "auto" }}>
              <button
                onClick={() => onPick(s.id)}
                style={{ flex: 1, padding: "8px 10px", background: "var(--primary)", color: "#fff", border: 0, borderRadius: 8, fontWeight: 700, cursor: "pointer", fontSize: 13 }}
              >
                استيراد
              </button>
              <button
                onClick={() => downloadTemplate(s)}
                title="تحميل النموذج"
                style={{ padding: "8px 10px", background: "var(--bg3)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", display: "grid", placeItems: "center" }}
              >
                <Download size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FileStep({ spec, file, onFile, onBack }: { spec: ImportSpec; file: File | null; onFile: (f: File) => void; onBack: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <h3 style={{ fontSize: 16, fontWeight: 800 }}>رفع ملف — {spec.label}</h3>
        <button onClick={onBack} style={{ padding: "6px 12px", background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <ArrowRight size={14} /> رجوع
        </button>
      </div>
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault(); setDrag(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onFile(f);
        }}
        style={{
          border: `2px dashed ${drag ? "var(--primary)" : "var(--border)"}`,
          background: drag ? "var(--primary3)" : "var(--bg3)",
          borderRadius: 14, padding: 48, textAlign: "center", cursor: "pointer", transition: "all .15s",
        }}
      >
        <Upload size={48} style={{ color: "var(--primary)", margin: "0 auto 12px" }} />
        <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>اسحب الملف هنا أو اضغط للاختيار</div>
        <div style={{ fontSize: 12, color: "var(--text3)" }}>Excel (.xlsx) أو CSV</div>
        {file && <div style={{ marginTop: 12, fontSize: 13, color: "var(--primary)", fontWeight: 700 }}>{file.name}</div>}
        <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => {
          const f = e.target.files?.[0]; if (f) onFile(f);
        }} />
      </div>
    </div>
  );
}

function MappingStep({ spec, headers, mapping, setMapping, onBack, onNext }: {
  spec: ImportSpec; headers: string[];
  mapping: Record<string, string | null>;
  setMapping: (m: Record<string, string | null>) => void;
  onBack: () => void; onNext: () => void;
}) {
  const requiredMissing = spec.fields.filter((f) => f.required && !mapping[f.key]);
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <h3 style={{ fontSize: 16, fontWeight: 800 }}>ربط الأعمدة</h3>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onBack} style={{ padding: "6px 12px", background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <ArrowRight size={14} /> رجوع
          </button>
          <button onClick={onNext} disabled={requiredMissing.length > 0}
            style={{ padding: "6px 14px", background: requiredMissing.length ? "var(--bg3)" : "var(--primary)", color: requiredMissing.length ? "var(--text3)" : "#fff", border: 0, borderRadius: 8, cursor: requiredMissing.length ? "not-allowed" : "pointer", fontWeight: 700, display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            متابعة <ArrowLeft size={14} />
          </button>
        </div>
      </div>
      {requiredMissing.length > 0 && (
        <div style={{ padding: 10, background: "var(--gold-bg)", border: "1px solid var(--gold-bd)", borderRadius: 8, marginBottom: 12, fontSize: 13, color: "var(--gold)" }}>
          الحقول المطلوبة غير مربوطة: {requiredMissing.map((f) => f.label).join("، ")}
        </div>
      )}
      <div style={{ display: "grid", gap: 8 }}>
        {spec.fields.map((f) => (
          <div key={f.key} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "center", padding: 10, background: "var(--bg3)", borderRadius: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>
              {f.label}
              {f.required && <span style={{ color: "var(--red)", marginRight: 4 }}>*</span>}
              <div style={{ fontSize: 11, color: "var(--text3)", fontWeight: 400, marginTop: 2 }}>{f.type}</div>
            </div>
            <select
              value={mapping[f.key] || ""}
              onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value || null })}
              style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "#fff", fontSize: 13 }}
            >
              <option value="">— تجاهل —</option>
              {headers.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}

function PreviewStep({ spec, parsed, validation, importing, progress, onBack, onRun }: {
  spec: ImportSpec; parsed: ParsedFile;
  validation: { validRows: any[]; errors: RowError[]; duplicates: number; totalRows: number };
  importing: boolean; progress: number;
  onBack: () => void; onRun: () => void;
}) {
  const { validRows, errors, duplicates, totalRows } = validation;
  const cols = Object.keys(validRows[0] || {}).slice(0, 6);
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <h3 style={{ fontSize: 16, fontWeight: 800 }}>معاينة وحفظ — {spec.label}</h3>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onBack} disabled={importing} style={{ padding: "6px 12px", background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <ArrowRight size={14} /> رجوع
          </button>
          <button onClick={onRun} disabled={importing || !validRows.length}
            style={{ padding: "6px 14px", background: validRows.length && !importing ? "var(--green)" : "var(--bg3)", color: validRows.length && !importing ? "#fff" : "var(--text3)", border: 0, borderRadius: 8, cursor: importing ? "wait" : "pointer", fontWeight: 700, fontSize: 13 }}>
            {importing ? `جاري الاستيراد… ${progress}%` : `تنفيذ الاستيراد (${validRows.length})`}
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 14 }}>
        <Stat label="إجمالي الصفوف" value={totalRows} color="var(--text)" />
        <Stat label="صالحة" value={validRows.length} color="var(--green)" />
        <Stat label="أخطاء" value={errors.length} color="var(--red)" />
        <Stat label="مكررة" value={duplicates} color="var(--gold)" />
      </div>

      {importing && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ height: 8, background: "var(--bg3)", borderRadius: 4, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${progress}%`, background: "var(--primary)", transition: "width .2s" }} />
          </div>
        </div>
      )}

      {errors.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 6, display: "flex", alignItems: "center", gap: 6, color: "var(--red)" }}>
            <AlertTriangle size={16} /> أخطاء ({errors.length})
          </div>
          <div style={{ maxHeight: 200, overflow: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead style={{ background: "var(--bg3)", position: "sticky", top: 0 }}>
                <tr>
                  <th style={{ padding: 8, textAlign: "right" }}>الصف</th>
                  <th style={{ padding: 8, textAlign: "right" }}>العمود</th>
                  <th style={{ padding: 8, textAlign: "right" }}>السبب</th>
                </tr>
              </thead>
              <tbody>
                {errors.slice(0, 100).map((e, i) => (
                  <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: 8, fontWeight: 700 }}>{e.row}</td>
                    <td style={{ padding: 8 }}>{e.label}</td>
                    <td style={{ padding: 8, color: "var(--red)" }}>{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {errors.length > 100 && <div style={{ padding: 8, textAlign: "center", fontSize: 12, color: "var(--text3)" }}>… و {errors.length - 100} خطأ آخر</div>}
          </div>
        </div>
      )}

      {validRows.length > 0 && (
        <div>
          <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 6, color: "var(--green)" }}>معاينة أول 20 صف صالح</div>
          <div style={{ overflow: "auto", border: "1px solid var(--border)", borderRadius: 8, maxHeight: 320 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead style={{ background: "var(--bg3)", position: "sticky", top: 0 }}>
                <tr>{cols.map((c) => <th key={c} style={{ padding: 8, textAlign: "right" }}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {validRows.slice(0, 20).map((r, i) => (
                  <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                    {cols.map((c) => <td key={c} style={{ padding: 8 }}>{String(r[c] ?? "")}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ padding: 12, background: "var(--bg3)", borderRadius: 8, textAlign: "center" }}>
      <div style={{ fontSize: 22, fontWeight: 900, color }}>{value}</div>
      <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>{label}</div>
    </div>
  );
}

function BatchesPanel({ batches, onUndo }: { batches: any[]; onUndo: (b: any) => void }) {
  return (
    <div className="card" style={{ padding: 14, height: "fit-content", position: "sticky", top: 16 }}>
      <h3 style={{ fontSize: 14, fontWeight: 800, marginBottom: 10 }}>آخر عمليات الاستيراد</h3>
      {batches.length === 0 && <div style={{ fontSize: 12, color: "var(--text3)" }}>لا يوجد سجل بعد</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {batches.map((b) => (
          <div key={b.id} style={{ padding: 10, background: "var(--bg3)", borderRadius: 8, border: "1px solid var(--border)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{b.import_type}</div>
              <div style={{ fontSize: 11, color: "var(--text3)" }}>{new Date(b.created_at).toLocaleString("ar-EG")}</div>
            </div>
            <div style={{ fontSize: 12, color: "var(--text2)", margin: "4px 0" }}>{b.rows_inserted} سجل — {b.file_name || ""}</div>
            {b.undone_at ? (
              <div style={{ fontSize: 11, color: "var(--red)", fontWeight: 700 }}>تم التراجع</div>
            ) : (
              <button onClick={() => onUndo(b)}
                style={{ width: "100%", padding: "6px 10px", background: "#fff", color: "var(--red)", border: "1px solid var(--red-bd)", borderRadius: 6, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 12, fontWeight: 700, marginTop: 4 }}>
                <Undo2 size={12} /> تراجع
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
