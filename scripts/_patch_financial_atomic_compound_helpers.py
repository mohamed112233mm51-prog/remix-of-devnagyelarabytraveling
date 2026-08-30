from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)

# ---------------------------------------------------------------------------
# Expense hard delete -> one RPC (splits reversal + children + parent).
# ---------------------------------------------------------------------------
path = ROOT / "src/features/expenses/LegacyExpensesRoute.tsx"
text = path.read_text(encoding="utf-8")
old = '''  const del = async (id: string) => {
    if (!(await confirmDialog("حذف هذا المصروف؟ سيتم حذف كل وسائل الدفع المرتبطة به."))) return;
    // Delete linked splits first (no FK cascade)
    await supabase.from("expense_deductions").delete().eq("expense_id", id);
    await supabase.from("merchant_cash_collections").delete().eq("expense_id", id);
    const { error } = await supabase.from("expenses").delete().eq("id", id);
    if (error) toast.error(error.message);
    else toast.success("تم حذف المصروف");
  };
'''
new = '''  const del = async (id: string) => {
    if (!(await confirmDialog("حذف هذا المصروف؟ سيتم حذف كل وسائل الدفع المرتبطة به."))) return;
    const { data, error } = await (supabase as any).rpc("delete_expense_atomic", { p_expense_id: id });
    if (error || data?.ok !== true) {
      const message = String(error?.message || data?.error || "تعذر حذف المصروف");
      const missingRpc = String((error as any)?.code || "") === "PGRST202" || message.toLowerCase().includes("schema cache");
      toast.error(missingRpc ? "تم إيقاف الحذف بدون تغيير أي جزء: تحديث الحذف المالي الذري غير مُطبق على قاعدة البيانات بعد." : message);
    } else {
      toast.success("تم حذف المصروف وكل آثاره المالية بنجاح");
    }
  };
'''
text = replace_once(text, old, new, "expense atomic delete")
path.write_text(text, encoding="utf-8")

# ---------------------------------------------------------------------------
# Opening entries and cash-box opening balance -> one DB tx each.
# ---------------------------------------------------------------------------
path = ROOT / "src/lib/openingBalance.ts"
text = path.read_text(encoding="utf-8")
old = '''  // 3) Full replace
  const del = await supabase
    .from(m.table as any)
    .delete()
    .eq(m.entityCol, entityId)
    .in("source_service_type", ["opening_debit", "opening_credit"] as any);
  if (del.error) throw del.error;

  if (finalEntries.length === 0) return;
  const rows = finalEntries.map((e) => buildRow(kind, entityId, e));
  const ins = await supabase.from(m.table as any).insert(rows as any);
  if (ins.error) throw ins.error;
'''
new = '''  // 3) Full replace inside ONE PostgreSQL transaction. If any new row fails,
  // the DELETE is rolled back and the previous opening balance remains intact.
  const rows = finalEntries.map((e) => buildRow(kind, entityId, e));
  const { data, error } = await (supabase as any).rpc("replace_entity_opening_entries_atomic", {
    p_kind: kind,
    p_entity_id: entityId,
    p_rows: rows,
  });
  if (error || data?.ok !== true) {
    const message = String(error?.message || data?.error || "تعذر حفظ الرصيد الافتتاحي");
    const missingRpc = String((error as any)?.code || "") === "PGRST202" || message.toLowerCase().includes("schema cache");
    throw new Error(missingRpc ? "تم إيقاف العملية بدون تغيير أي جزء: تحديث الأرصدة الافتتاحية الذري غير مُطبق على قاعدة البيانات بعد." : message);
  }
'''
text = replace_once(text, old, new, "entity opening atomic replace")
# Remove now-unused mapping local in sync function.
text = replace_once(text, '  const m = mappingFor(kind);\n\n  // 1) Clean input\n', '  // 1) Clean input\n', "opening unused mapping")

start = text.find('export async function syncCashBoxOpeningBalance(')
if start < 0:
    raise RuntimeError("cash box opening function not found")
brace = text.find('{', start)
depth = 0
end = -1
for i in range(brace, len(text)):
    if text[i] == '{': depth += 1
    elif text[i] == '}':
        depth -= 1
        if depth == 0:
            end = i + 1
            break
if end < 0:
    raise RuntimeError("cash box opening function end not found")
new_func = '''export async function syncCashBoxOpeningBalance(cashBoxId: string, op: CashBoxOpeningInput) {
  if (!cashBoxId) return;
  const amount = Number(op.amount) || 0;
  const date = op.date || todayISO();
  const { data, error } = await (supabase as any).rpc("sync_cash_box_opening_atomic", {
    p_cash_box_id: cashBoxId,
    p_amount: amount,
    p_date: date,
    p_note: op.note || null,
  });
  if (error || data?.ok !== true) {
    const message = String(error?.message || data?.error || "تعذر حفظ رصيد الخزينة الافتتاحي");
    const missingRpc = String((error as any)?.code || "") === "PGRST202" || message.toLowerCase().includes("schema cache");
    throw new Error(missingRpc ? "تم إيقاف العملية بدون تغيير أي جزء: تحديث رصيد الخزينة الذري غير مُطبق على قاعدة البيانات بعد." : message);
  }
}'''
text = text[:start] + new_func + text[end:]
path.write_text(text, encoding="utf-8")

# ---------------------------------------------------------------------------
# Service posting -> agent/company sides synchronized by one RPC.
# ---------------------------------------------------------------------------
path = ROOT / "src/lib/servicePosting.ts"
text = path.read_text(encoding="utf-8")
start = text.find('/** Called after INSERT of a new service record.')
if start < 0:
    raise RuntimeError("service posting functions start not found")
new_tail = '''/**
 * Synchronize both accounting sides of one service in ONE PostgreSQL
 * transaction. Updates preserve existing payment fields; company debt is
 * removed atomically if companyValue becomes zero.
 */
async function syncService(input: ServicePostingInput, deleting = false): Promise<any> {
  const agent = !deleting && input.agentId
    ? agentRow({ ...input, agentId: input.agentId })
    : null;
  const company = !deleting && input.companyId && Number(input.companyValue) > 0
    ? companyRow({ ...input, companyId: input.companyId })
    : null;

  const { data, error } = await (supabase as any).rpc("sync_service_financials_atomic", {
    p_service_id: input.serviceId,
    p_agent_row: agent,
    p_company_row: company,
    p_delete: deleting,
  });
  if (error || data?.ok !== true) {
    const message = String(error?.message || data?.error || "تعذر مزامنة قيود الخدمة المالية");
    const missingRpc = String((error as any)?.code || "") === "PGRST202" || message.toLowerCase().includes("schema cache");
    throw new Error(missingRpc ? "تم إيقاف العملية بدون تسجيل أي طرف: تحديث قيود الخدمات الذري غير مُطبق على قاعدة البيانات بعد." : message);
  }
  return data;
}

/** Called after INSERT of a new service record. Creates both debt rows atomically. */
export async function postServiceFinancials(input: ServicePostingInput): Promise<void> {
  const data = await syncService(input, false);
  try {
    if (data?.agentTransactionId && input.agentId) {
      await logCreate("transactions", data.agentTransactionId, { ...agentRow({ ...input, agentId: input.agentId }), id: data.agentTransactionId }, "توليد من تقديم خدمة");
    }
    if (data?.companyTransactionId && input.companyId && Number(input.companyValue) > 0) {
      await logCreate("company_transactions", data.companyTransactionId, { ...companyRow({ ...input, companyId: input.companyId }), id: data.companyTransactionId }, "توليد من تقديم خدمة");
    }
  } catch { /* audit is non-financial */ }
}

/** Called when a service is edited. Both accounting sides change atomically. */
export async function updateServiceFinancials(input: ServicePostingInput): Promise<void> {
  await syncService(input, false);
}

/** Reverse / remove both financial rows linked to a deleted service atomically. */
export async function deleteServiceLinkedRows(serviceId: string): Promise<void> {
  await syncService({
    serviceId,
    serviceKind: "flight_ticket",
    agentId: null,
    companyId: null,
    date: null,
    destination: null,
    travelStatement: null,
    passengerName: null,
    count: 1,
    price: 0,
    companyValue: 0,
  }, true);
}
'''
text = text[:start] + new_tail
path.write_text(text, encoding="utf-8")

# ---------------------------------------------------------------------------
# Approval expiry fine: agent + company fine rows for each entity are inserted
# together using execute_financial_atomic.
# ---------------------------------------------------------------------------
path = ROOT / "src/lib/approvalFines.ts"
text = path.read_text(encoding="utf-8")
text = replace_once(
    text,
    'import { logCreate } from "@/lib/financialAudit";\n',
    'import { logCreate } from "@/lib/financialAudit";\nimport { atomicRow, executeFinancialAtomic } from "@/lib/financialAtomic";\nimport { deriveFinancialOperationUuid, financialOperationFingerprint } from "@/lib/financialIdempotency";\n',
    "fine atomic imports",
)
start = text.find('  const agentRows = eligible')
end_marker = '\n  if (report) report.created += created;\n  return created;'
end = text.find(end_marker, start)
if start < 0 or end < 0:
    raise RuntimeError("approval fine write block not found")
new_block = '''  let created = 0;
  for (const x of eligible) {
    const rows = [];
    const agentId = deriveFinancialOperationUuid(x.id, `${sourceType}:agent-fine`);
    const companyId = deriveFinancialOperationUuid(x.id, `${sourceType}:company-fine`);
    const agentPayload = {
      agent_id: x.agent_id,
      date: x.expiry,
      destination: "—",
      count: 1,
      price: fineAmount,
      paid: 0,
      total_paid: 0,
      service_type: FINE_LABEL,
      travel_statement: null,
      note: FINE_LABEL,
      source_service_type: sourceType,
      source_service_id: x.id,
    };
    const companyPayload = {
      company_id: x.company_id,
      date: x.expiry,
      destination: "—",
      service_type: FINE_LABEL,
      count: 1,
      price: 0,
      trip_value: 0,
      total_paid: fineAmount,
      cash_amount: fineAmount,
      note: FINE_LABEL,
      source_service_type: sourceType,
      source_service_id: x.id,
    };

    if (!haveAgent.has(x.id)) rows.push(atomicRow("transactions", { ...agentPayload, id: agentId }));
    if (!haveCompany.has(x.id)) rows.push(atomicRow("company_transactions", { ...companyPayload, id: companyId }));
    if (rows.length === 0) {
      bump("already_exists");
      continue;
    }

    const operationId = deriveFinancialOperationUuid(x.id, `${sourceType}:fine-operation`);
    const fingerprint = financialOperationFingerprint({ sourceType, entityId: x.id, fineAmount, agentPayload, companyPayload });
    const saved = await executeFinancialAtomic({
      operationId,
      fingerprint,
      rows,
      result: { agentId, companyId },
    });
    if (!saved.ok) {
      console.error("[approvalFines] atomic insert error:", saved.error);
      continue;
    }

    created += rows.length;
    if (!saved.reused) {
      try {
        if (!haveAgent.has(x.id)) await logCreate("transactions", agentId, { ...agentPayload, id: agentId }, "غرامة انتهاء موافقة");
        if (!haveCompany.has(x.id)) await logCreate("company_transactions", companyId, { ...companyPayload, id: companyId }, "غرامة انتهاء موافقة");
      } catch { /* audit is non-financial */ }
    }
  }
'''
text = text[:start] + new_block + text[end:]
path.write_text(text, encoding="utf-8")

print("remaining compound financial helper paths converted to atomic RPCs")
