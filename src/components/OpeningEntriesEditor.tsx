// ============================================================================
// OpeningEntriesEditor — shared UI for editing the multi-currency Opening
// Balance of any entity (Agent / Company / Merchant / Currency Supplier).
//
// The editor holds a list of OpeningEntry rows; each row is one Ledger Entry.
// It never reads or writes entity.opening_debit / opening_credit / opening_currency.
// ============================================================================
import { useMemo } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { OpeningEntry, OpeningKind } from "@/lib/openingBalance";

type Props = {
  value: OpeningEntry[];
  onChange: (entries: OpeningEntry[]) => void;
  disabled?: boolean;
  title?: string;
};

const CURRENCIES: { value: string; label: string }[] = [
  { value: "EGP", label: "جنيه مصري" },
  { value: "USD", label: "دولار أمريكي" },
  { value: "LYD", label: "دينار ليبي" },
];

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function newUid(): string {
  return `oe_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function OpeningEntriesEditor({ value, onChange, disabled, title }: Props) {
  const rows = useMemo(() => (value || []).map((e) => ({ ...e, uid: e.uid || newUid() })), [value]);

  const update = (uid: string, patch: Partial<OpeningEntry>) => {
    onChange(rows.map((r) => (r.uid === uid ? { ...r, ...patch } : r)));
  };
  const remove = (uid: string) => onChange(rows.filter((r) => r.uid !== uid));
  const add = () => onChange([
    ...rows,
    { uid: newUid(), currency: "EGP", kind: "debit", amount: 0, date: todayISO(), note: null },
  ]);

  return (
    <div className="card" style={{ marginTop: 12, boxShadow: "none", border: "1px solid var(--border)" }}>
      <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div className="card-title">📒 {title || "الأرصدة الافتتاحية"}</div>
        <button
          type="button"
          className="btn btn-outline"
          onClick={add}
          disabled={disabled}
          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          <Plus size={14} strokeWidth={2} /> إضافة رصيد
        </button>
      </div>
      <div className="card-body">
        {rows.length === 0 ? (
          <div style={{ padding: "12px 4px", color: "var(--muted, #64748b)", fontSize: 13 }}>
            لا يوجد رصيد افتتاحي — اضغط "إضافة رصيد" لإضافة صف لكل عملة.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ minWidth: 120 }}>العملة</th>
                  <th style={{ minWidth: 100 }}>النوع</th>
                  <th style={{ minWidth: 140 }}>المبلغ</th>
                  <th style={{ minWidth: 150 }}>التاريخ</th>
                  <th>ملاحظة</th>
                  <th style={{ width: 60, textAlign: "center" }}>حذف</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.uid}>
                    <td>
                      <select
                        value={r.currency}
                        onChange={(e) => update(r.uid!, { currency: e.target.value })}
                        disabled={disabled}
                        style={{ width: "100%" }}
                      >
                        {CURRENCIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </select>
                    </td>
                    <td>
                      <select
                        value={r.kind}
                        onChange={(e) => update(r.uid!, { kind: e.target.value as OpeningKind })}
                        disabled={disabled}
                        style={{ width: "100%" }}
                      >
                        <option value="debit">مدين</option>
                        <option value="credit">دائن</option>
                      </select>
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={r.amount || ""}
                        onChange={(e) => update(r.uid!, { amount: Number(e.target.value) || 0 })}
                        disabled={disabled}
                        style={{ width: "100%" }}
                      />
                    </td>
                    <td>
                      <input
                        type="date"
                        value={r.date || ""}
                        onChange={(e) => update(r.uid!, { date: e.target.value })}
                        disabled={disabled}
                        style={{ width: "100%" }}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        value={r.note || ""}
                        onChange={(e) => update(r.uid!, { note: e.target.value || null })}
                        disabled={disabled}
                        placeholder="اختياري"
                        style={{ width: "100%" }}
                      />
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <button
                        type="button"
                        className="action-btn"
                        onClick={() => remove(r.uid!)}
                        disabled={disabled}
                        title="حذف الصف"
                        style={{ color: "var(--red, #dc2626)" }}
                      >
                        <Trash2 size={14} strokeWidth={2} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--muted, #64748b)" }}>
          • كل صف = حركة داخل كشف الحساب. لا يوجد خلط بين العملات.
          <br />
          • عند تكرار (نفس العملة + نفس النوع) يتم دمجهما تلقائياً.
        </div>
      </div>
    </div>
  );
}

export default OpeningEntriesEditor;
