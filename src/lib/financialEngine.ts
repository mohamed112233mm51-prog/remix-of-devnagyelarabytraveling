/**
 * ========================================================================
 * FINANCIAL ENGINE — المحرك المالي الموحد
 * ========================================================================
 *
 * هذا الملف هو **المصدر الوحيد** لكل عملية مالية داخل النظام:
 *   - الكتابة  : postMovement / voidMovement
 *   - القراءة  : getEntityLedger / getEntityBalance / getCashBoxBalance
 *   - الأدوات  : useEntityBalance / useCashBoxBalance / useEntityLedger
 *
 * قاعدة صارمة (Guardrail):
 *   ⛔ ممنوع استدعاء supabase.from("payment_splits").insert(...) خارج هذا الملف.
 *   ⛔ ممنوع حساب أي رصيد يدوياً في شاشة — استخدم دوال هذا الملف.
 *
 * البنية المعتمدة:
 *   - `payment_splits`  : المصدر الوحيد لكل حركة نقدية (in/out) — مع
 *                          `direction`، `cash_box_id`، `source_table`،
 *                          `source_id`، `amount` موجب دائماً.
 *   - `cash_boxes.balance` : يُحدَّث تلقائياً بواسطة التريجر
 *                            `apply_payment_split_to_cash_box`.
 *   - الجداول الأم (transactions / company_transactions / …) :
 *     تُستخدم فقط للـ metadata (تاريخ، وصف، جهة، بيانات الرحلة).
 *     كل الأرقام المالية تُقرأ من `payment_splits`.
 * ========================================================================
 */

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useLive } from "@/lib/db";

/* ============================================================
 *  Types
 * ============================================================ */

export type PartyType =
  | "agent"
  | "company"
  | "currency_supplier"
  | "merchant"
  | "expense"
  | "treasury";

export type MovementKind =
  | "receipt"     // قبض من الجهة (in)
  | "payment"     // صرف للجهة (out)
  | "transfer"    // تحويل بين خزينتين (in + out بنفس transaction_id)
  | "settlement"  // تسوية
  | "refund"      // رد مبلغ
  | "expense";    // مصروف تشغيلي (out)

export type Direction = "in" | "out";

export type MovementSplit = {
  method: string;                 // "نقدي" | "إنستاباي" | "تاجر الكاش تاجر" | ...
  currency: "EGP" | "USD" | "LYD";
  cashBoxId: string | null;       // null للمحافظ (تاجر) — لا يوجد صف في cash_boxes
  amount: number;                 // موجب دائماً
  direction: Direction;
  exchangeRate?: number;
  grossAmount?: number;
  commissionRate?: number;
  commissionAmount?: number;
  netAmount?: number;
  egpEquivalent?: number;
};

export type PostMovementInput = {
  partyType: PartyType;
  partyId: string | null;         // null للتحويل بين خزينتين
  kind: MovementKind;
  date: string;                   // YYYY-MM-DD
  note?: string;
  splits: MovementSplit[];
  sourceTable?: string;           // اختياري — لربطها بعملية أم موجودة
  sourceId?: string;
  transactionId?: string;         // لو الحركة مرتبطة بصف transactions موجود
};

export type PostMovementResult = {
  ok: boolean;
  transactionId?: string;
  splitIds?: string[];
  error?: string;
};

export type LedgerEntry = {
  id: string;
  date: string;
  direction: Direction;
  method: string;
  currency: string;
  amount: number;
  cashBoxId: string | null;
  sourceTable: string | null;
  sourceId: string | null;
  transactionId: string | null;
  note?: string;
};

/* ============================================================
 *  Party → source_table mapping
 * ============================================================ */

const PARTY_TO_SOURCE_TABLE: Record<PartyType, string> = {
  agent: "transactions",
  company: "company_transactions",
  currency_supplier: "currency_supplier_transactions",
  merchant: "merchant_cash_collections",
  expense: "expenses",
  treasury: "cash_transfers",
};

const PARTY_ID_COLUMN: Record<PartyType, string> = {
  agent: "agent_id",
  company: "company_id",
  currency_supplier: "supplier_id",
  merchant: "merchant_id",
  expense: "id",
  treasury: "id",
};

/* ============================================================
 *  WRITE : postMovement
 * ============================================================ */

/**
 * نقطة الكتابة الوحيدة لأي حركة مالية في النظام.
 *
 * المسؤوليات:
 *  1. تكتب صفوف `payment_splits` مع direction/source_table/source_id.
 *  2. تكتب صف أم (transactions/company_transactions/…) عند الحاجة
 *     لتخزين الـ metadata.
 *  3. التريجر يتكفل بتحديث `cash_boxes.balance` تلقائياً.
 *
 * ملاحظة: هذه الدالة **لا** تحسب الأرصدة أو تتحقق منها — استخدم
 * `checkOutflowAllowed()` قبل الاستدعاء لو كانت out.
 */
export async function postMovement(
  input: PostMovementInput,
): Promise<PostMovementResult> {
  try {
    const validSplits = input.splits.filter((s) => Number(s.amount) > 0);
    if (validSplits.length === 0) {
      return { ok: false, error: "لا توجد سطور دفع صالحة" };
    }

    let transactionId = input.transactionId ?? null;
    let sourceTable = input.sourceTable ?? PARTY_TO_SOURCE_TABLE[input.partyType];
    let sourceId = input.sourceId ?? null;

    // إنشاء صف أم في transactions فقط إذا كنا نعمل على وكيل/تاجر بدون parent
    // (للتوافق مع الشاشات القديمة التي تعتمد على transactions للربط بالوكيل).
    if (!sourceId && (input.partyType === "agent" || input.partyType === "merchant")) {
      const totalAmount = validSplits.reduce((s, r) => s + r.amount, 0);
      const isOut = input.kind === "payment" || input.kind === "expense";
      const signed = isOut ? -totalAmount : totalAmount;

      const parentPayload: Record<string, unknown> = {
        agent_id: input.partyType === "agent" ? input.partyId : null,
        merchant_id: input.partyType === "merchant" ? input.partyId : null,
        date: input.date,
        count: 0,
        price: 0,
        paid: signed,
        total_paid: signed,
        payment_method: firstMethodArabic(validSplits[0].method),
        note: input.note?.trim() || defaultNoteFor(input.kind, input.partyType),
        source_service_type: sourceServiceType(input.kind, input.partyType),
      };
      const { data: txn, error: txnErr } = await supabase
        .from("transactions")
        .insert(parentPayload)
        .select("id")
        .single();
      if (txnErr || !txn) {
        return { ok: false, error: txnErr?.message || "تعذر حفظ الصف الأم" };
      }
      transactionId = txn.id;
      sourceTable = "transactions";
      sourceId = txn.id;
    }

    // إدراج payment_splits
    const rows = validSplits.map((s) => ({
      transaction_id: transactionId,
      method: s.method,
      currency: s.currency,
      cash_box_id: s.cashBoxId,
      amount: s.amount,
      direction: s.direction,
      source_table: sourceTable,
      source_id: sourceId,
      gross_amount: s.grossAmount ?? s.amount,
      merchant_commission_rate: s.commissionRate ?? 0,
      merchant_commission_amount: s.commissionAmount ?? 0,
      net_amount: s.netAmount ?? s.amount,
      exchange_rate: s.exchangeRate ?? 1,
      egp_equivalent:
        s.egpEquivalent ??
        (s.currency === "EGP" ? s.amount : s.amount * (s.exchangeRate ?? 1)),
    }));

    const { data: inserted, error } = await supabase
      .from("payment_splits")
      .insert(rows)
      .select("id");
    if (error) return { ok: false, error: error.message };

    return {
      ok: true,
      transactionId: transactionId ?? undefined,
      splitIds: (inserted || []).map((r: any) => r.id),
    };
  } catch (e: any) {
    return { ok: false, error: e?.message || "فشل حفظ الحركة" };
  }
}

/**
 * تحويل بين خزينتين → صفّان في payment_splits (out + in) بنفس transaction_id.
 */
export async function postCashBoxTransfer(args: {
  fromCashBoxId: string;
  toCashBoxId: string;
  amount: number;
  currency: "EGP" | "USD" | "LYD";
  date: string;
  note?: string;
  method?: string;
}): Promise<PostMovementResult> {
  const method = args.method || "تحويل بين الخزائن";
  return postMovement({
    partyType: "treasury",
    partyId: null,
    kind: "transfer",
    date: args.date,
    note: args.note,
    splits: [
      {
        method,
        currency: args.currency,
        cashBoxId: args.fromCashBoxId,
        amount: args.amount,
        direction: "out",
      },
      {
        method,
        currency: args.currency,
        cashBoxId: args.toCashBoxId,
        amount: args.amount,
        direction: "in",
      },
    ],
  });
}

/* ============================================================
 *  DELETE / VOID
 * ============================================================ */

/** حذف حركة كاملة — التريجر يعكس الرصيد تلقائياً. */
export async function voidMovement(splitId: string): Promise<PostMovementResult> {
  const { error } = await supabase.from("payment_splits").delete().eq("id", splitId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** حذف كل الحركات المرتبطة بعملية أم (transaction/execution/…) */
export async function voidAllForSource(
  sourceTable: string,
  sourceId: string,
): Promise<PostMovementResult> {
  const { error } = await supabase
    .from("payment_splits")
    .delete()
    .eq("source_table", sourceTable)
    .eq("source_id", sourceId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/* ============================================================
 *  READ : rich ledger + balance
 * ============================================================ */

type RawSplit = {
  id: string;
  transaction_id: string | null;
  method: string;
  currency: string;
  cash_box_id: string | null;
  amount: number | string;
  direction: Direction;
  source_table: string | null;
  source_id: string | null;
  created_at: string;
};

/**
 * كشف حساب أي جهة — يعتمد كلياً على payment_splits.
 * يستخدم `source_table` + `source_id` لربط الحركة بالجهة الأم.
 */
export async function getEntityLedger(
  partyType: PartyType,
  partyId: string,
  opts: { from?: string; to?: string; currency?: string } = {},
): Promise<LedgerEntry[]> {
  const parentTable = PARTY_TO_SOURCE_TABLE[partyType];
  const idCol = PARTY_ID_COLUMN[partyType];

  // 1) نجيب الصفوف من الجدول الأم اللي تخص هذه الجهة (فقط لجلب IDs).
  const { data: parents, error: pErr } = await supabase
    .from(parentTable as any)
    .select("id")
    .eq(idCol, partyId);
  if (pErr) throw new Error(pErr.message);
  const parentIds = (parents || []).map((p: any) => p.id);
  if (parentIds.length === 0) return [];

  // 2) نجيب payment_splits المربوطة بهذه الصفوف.
  let q = supabase
    .from("payment_splits")
    .select("id,transaction_id,method,currency,cash_box_id,amount,direction,source_table,source_id,created_at")
    .eq("source_table", parentTable)
    .in("source_id", parentIds);
  if (opts.currency) q = q.eq("currency", opts.currency);
  const { data, error } = await q.order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  return (data as RawSplit[]).map((r) => ({
    id: r.id,
    date: (r.created_at || "").slice(0, 10),
    direction: r.direction,
    method: r.method,
    currency: r.currency,
    amount: Number(r.amount) || 0,
    cashBoxId: r.cash_box_id,
    sourceTable: r.source_table,
    sourceId: r.source_id,
    transactionId: r.transaction_id,
  }));
}

/**
 * رصيد الجهة = مجموع (in − out) من payment_splits.
 * موجب → الجهة **مدينة** للنظام (النظام يستحق منها).
 * سالب → الجهة **دائنة** (النظام يستحق لها).
 */
export async function getEntityBalance(
  partyType: PartyType,
  partyId: string,
  currency: string = "EGP",
): Promise<number> {
  const ledger = await getEntityLedger(partyType, partyId, { currency });
  return ledger.reduce(
    (s, e) => s + (e.direction === "out" ? e.amount : -e.amount),
    0,
  );
}

/** رصيد خزينة (المصدر: cash_boxes.balance المُحدَّث بالتريجر). */
export async function getCashBoxBalance(cashBoxId: string): Promise<number> {
  const { data, error } = await supabase
    .from("cash_boxes")
    .select("balance")
    .eq("id", cashBoxId)
    .single();
  if (error) throw new Error(error.message);
  return Number(data?.balance) || 0;
}

/** كشف حركة خزينة معيّنة. */
export async function getCashBoxLedger(
  cashBoxId: string,
  opts: { from?: string; to?: string } = {},
): Promise<LedgerEntry[]> {
  let q = supabase
    .from("payment_splits")
    .select("id,transaction_id,method,currency,cash_box_id,amount,direction,source_table,source_id,created_at")
    .eq("cash_box_id", cashBoxId);
  if (opts.from) q = q.gte("created_at", opts.from);
  if (opts.to) q = q.lte("created_at", opts.to);
  const { data, error } = await q.order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as RawSplit[]).map((r) => ({
    id: r.id,
    date: (r.created_at || "").slice(0, 10),
    direction: r.direction,
    method: r.method,
    currency: r.currency,
    amount: Number(r.amount) || 0,
    cashBoxId: r.cash_box_id,
    sourceTable: r.source_table,
    sourceId: r.source_id,
    transactionId: r.transaction_id,
  }));
}

/* ============================================================
 *  Guardrails : outflow validation
 * ============================================================ */

/**
 * تحقق قبل الصرف — يستخدم نفس مصدر البيانات الذي تستخدمه التقارير.
 * @returns null إذا مسموح، أو رسالة خطأ عربية.
 */
export async function checkOutflowAllowed(
  cashBoxId: string,
  requested: number,
  label: string = "الخزينة",
): Promise<string | null> {
  const available = await getCashBoxBalance(cashBoxId);
  if (requested > available) {
    return `رصيد ${label} غير كافٍ. الرصيد الحالي: ${fmt(available)}، المبلغ المطلوب: ${fmt(requested)}`;
  }
  return null;
}

/* ============================================================
 *  React Hooks : live-updating balances
 * ============================================================ */

type CashBoxRow = { id: string; name: string; currency: string; balance: number | string | null };

/** رصيد خزينة live — يعيد التحديث تلقائياً عند تغيّر cash_boxes. */
export function useCashBoxBalance(cashBoxId: string | null | undefined): number {
  const { rows } = useLive<CashBoxRow>("cash_boxes");
  return useMemo(() => {
    if (!cashBoxId) return 0;
    const box = rows.find((b) => b.id === cashBoxId);
    return Number(box?.balance) || 0;
  }, [rows, cashBoxId]);
}

/** خرائط أرصدة الخزائن مفهرَسة بالاسم — للتوافق مع الشاشات القديمة. */
export function useCashBoxBalancesByName(): Map<string, number> {
  const { rows } = useLive<CashBoxRow>("cash_boxes");
  return useMemo(() => {
    const m = new Map<string, number>();
    for (const b of rows) m.set(`${b.name}|${b.currency}`, Number(b.balance) || 0);
    return m;
  }, [rows]);
}

/** رصيد جهة live (يعيد الحساب عند تغيّر payment_splits). */
export function useEntityBalance(
  partyType: PartyType,
  partyId: string | null | undefined,
  currency: string = "EGP",
): number {
  const { rows: splits } = useLive<RawSplit & { source_table: string | null; source_id: string | null }>(
    "payment_splits",
  );
  const parentTable = PARTY_TO_SOURCE_TABLE[partyType];
  const idCol = PARTY_ID_COLUMN[partyType];
  const { rows: parents } = useLive<any>(parentTable as any);

  return useMemo(() => {
    if (!partyId) return 0;
    const parentIds = new Set(
      parents.filter((p: any) => p[idCol] === partyId).map((p: any) => p.id),
    );
    if (parentIds.size === 0) return 0;
    let bal = 0;
    for (const s of splits) {
      if (s.source_table !== parentTable) continue;
      if (!s.source_id || !parentIds.has(s.source_id)) continue;
      if (s.currency !== currency) continue;
      bal += s.direction === "out" ? Number(s.amount) : -Number(s.amount);
    }
    return bal;
  }, [splits, parents, partyType, partyId, currency, parentTable, idCol]);
}

/** كشف حساب جهة live (بيانات payment_splits الخام فقط — للتقارير الجديدة). */
export function useEntityLedger(
  partyType: PartyType,
  partyId: string | null | undefined,
): LedgerEntry[] {
  const { rows: splits } = useLive<RawSplit>("payment_splits");
  const parentTable = PARTY_TO_SOURCE_TABLE[partyType];
  const idCol = PARTY_ID_COLUMN[partyType];
  const { rows: parents } = useLive<any>(parentTable as any);

  return useMemo(() => {
    if (!partyId) return [];
    const parentIds = new Set(
      parents.filter((p: any) => p[idCol] === partyId).map((p: any) => p.id),
    );
    return splits
      .filter((s) => s.source_table === parentTable && s.source_id && parentIds.has(s.source_id))
      .sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""))
      .map((r) => ({
        id: r.id,
        date: (r.created_at || "").slice(0, 10),
        direction: r.direction,
        method: r.method,
        currency: r.currency,
        amount: Number(r.amount) || 0,
        cashBoxId: r.cash_box_id,
        sourceTable: r.source_table,
        sourceId: r.source_id,
        transactionId: r.transaction_id,
      }));
  }, [splits, parents, partyType, partyId, parentTable, idCol]);
}

/* ============================================================
 *  Async fetchers for server-side / one-shot reads
 * ============================================================ */

export async function fetchCashBoxByName(
  name: string,
  currency: string,
): Promise<{ id: string; balance: number } | null> {
  const { data } = await supabase
    .from("cash_boxes")
    .select("id,balance")
    .eq("name", name)
    .eq("currency", currency)
    .maybeSingle();
  if (!data) return null;
  return { id: (data as any).id, balance: Number((data as any).balance) || 0 };
}

/* ============================================================
 *  Helpers
 * ============================================================ */

function fmt(n: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(n));
}

function firstMethodArabic(method: string): string {
  if (!method) return "نقدي";
  if (method.includes("إنستا")) return "إنستاباي";
  if (method.includes("تاجر")) return "تاجر الكاش";
  return "نقدي";
}

function defaultNoteFor(kind: MovementKind, party: PartyType): string {
  const partyLabel: Record<PartyType, string> = {
    agent: "الوكيل",
    company: "الشركة",
    currency_supplier: "مورد العملة",
    merchant: "التاجر",
    expense: "المصروف",
    treasury: "الخزينة",
  };
  const p = partyLabel[party];
  switch (kind) {
    case "receipt":    return `قبض من ${p}`;
    case "payment":    return `صرف لـ${p}`;
    case "settlement": return `تسوية ${p}`;
    case "refund":     return `رد مبلغ ${p}`;
    case "transfer":   return `تحويل بين الخزائن`;
    case "expense":    return `مصروف تشغيلي`;
  }
}

function sourceServiceType(kind: MovementKind, party: PartyType): string {
  if (kind === "payment" && party === "agent") return "agent_cash_out";
  if (kind === "payment" && party === "merchant") return "merchant_cash_out";
  if (kind === "receipt" && party === "agent") return "payment";
  if (kind === "receipt" && party === "company") return "company_cash_supply";
  if (kind === "expense") return "expense";
  if (kind === "transfer") return "cash_transfer";
  return kind;
}
