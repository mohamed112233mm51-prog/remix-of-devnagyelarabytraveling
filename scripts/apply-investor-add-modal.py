from pathlib import Path
import re

path = Path('src/routes/investors.tsx')
text = path.read_text(encoding='utf-8')

replacements = [
    (
        'type Tab = "list" | "add" | "history" | "statement" | "withdraw" | "deposit";',
        'type Tab = "list" | "history" | "statement" | "withdraw" | "deposit";',
        'remove add tab',
    ),
    (
        '  const [tab, setTab] = useState<Tab>("history");\n',
        '  const [tab, setTab] = useState<Tab>("history");\n  const [addOpen, setAddOpen] = useState(false);\n',
        'add modal state',
    ),
    (
        '<button className="page-head-cta" onClick={() => setTab("add")}>',
        '<button className="page-head-cta" onClick={() => setAddOpen(true)}>',
        'open modal from header',
    ),
]

for old, new, label in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')
    text = text.replace(old, new, 1)

pattern = re.compile(
    r'\n      \{tab === "add" && perm\.create && \(.*?\n      \)\}\n\n      \{tab === "history"',
    re.S,
)
text, count = pattern.subn('\n\n      {tab === "history"', text, count=1)
if count != 1:
    raise SystemExit(f'remove inline add block: expected 1 match, found {count}')

old_tail = '''      {tab === "withdraw" && perm.create && <TxnForm investors={investors} kind="صرف نقدية" methodLabel="الخزينة" title="⬆️ سحب من تمويل المالك / المستثمر" />}\n      {tab === "deposit" && perm.create && <TxnForm investors={investors} kind="توريد نقدية" methodLabel="الخزينة" title="⬇️ توريد تمويل المالك / المستثمر" />}\n    </div>'''
new_tail = '''      {tab === "withdraw" && perm.create && <TxnForm investors={investors} kind="صرف نقدية" methodLabel="الخزينة" title="⬆️ سحب من تمويل المالك / المستثمر" />}\n      {tab === "deposit" && perm.create && <TxnForm investors={investors} kind="توريد نقدية" methodLabel="الخزينة" title="⬇️ توريد تمويل المالك / المستثمر" />}\n      {addOpen && perm.create && <InvestorForm onClose={() => setAddOpen(false)} />}\n    </div>'''
if text.count(old_tail) != 1:
    raise SystemExit(f'add modal render: expected 1 match, found {text.count(old_tail)}')
text = text.replace(old_tail, new_tail, 1)

form_pattern = re.compile(r'function InvestorForm\(\) \{.*?\n\}\n\nfunction TxnForm', re.S)
new_form = '''function InvestorForm({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ investor_name: "", phone: "", whatsapp: "" });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));
  const save = async () => {
    if (!form.investor_name.trim()) return toast.error("اسم المستثمر مطلوب");
    setSaving(true);
    const { error } = await supabase.from("investors").insert({
      investor_name: form.investor_name.trim(),
      phone: form.phone.trim() || null,
      whatsapp: form.whatsapp.trim() || null,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    setForm({ investor_name: "", phone: "", whatsapp: "" });
    onClose();
  };
  if (typeof document === "undefined") return null;
  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 720, maxHeight: "90vh", overflow: "auto", margin: 0 }}>
        <div className="card-header"><div className="card-title">➕ إضافة مالك / مستثمر جديد</div></div>
        <div className="form-grid">
          <div className="form-group"><label>اسم المستثمر</label><input autoFocus value={form.investor_name} onChange={(e) => set("investor_name", e.target.value)} /></div>
          <div className="form-group"><label>الهاتف</label><input value={form.phone} onChange={(e) => set("phone", e.target.value)} /></div>
          <div className="form-group"><label>الواتساب</label><input value={form.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} /></div>
        </div>
        <div className="form-footer" style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="action-btn" onClick={onClose} disabled={saving}>إلغاء</button>
          <button data-confirm-save="تأكيد حفظ المستثمر" type="button" className="btn btn-gold" onClick={save} disabled={saving}>{saving ? "جارٍ الحفظ..." : "💾 حفظ المستثمر"}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function TxnForm'''
text, count = form_pattern.subn(new_form, text, count=1)
if count != 1:
    raise SystemExit(f'replace InvestorForm: expected 1 match, found {count}')

path.write_text(text, encoding='utf-8')
