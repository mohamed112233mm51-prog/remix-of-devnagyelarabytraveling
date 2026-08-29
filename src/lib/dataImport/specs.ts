// Smart import specs: target tables, columns, synonyms (Arabic), validation hints.
export type FieldType = "string" | "number" | "integer" | "date" | "lookup" | "boolean";

export type FieldSpec = {
  key: string;            // DB column name (or virtual key for special importers)
  label: string;          // Arabic label shown to user
  type: FieldType;
  required?: boolean;
  synonyms: string[];     // possible Arabic header variants
  lookup?: "agent" | "company" | "merchant" | "investor"; // for type=lookup → resolves to *_id
  dbColumn?: string;      // override the resulting DB column (e.g. agent_id)
  default?: any;
  example?: any;          // value used in the downloadable template example row
  enum?: string[];        // allowed values (for normalisation)
};

export type ImportSpec = {
  id: string;             // import type id
  label: string;          // Arabic title
  table: string;          // target Supabase table
  fields: FieldSpec[];
  // Optional final transformation after mapping/coercion.
  transformRow?: (row: Record<string, any>) => Record<string, any>;
  // Optional custom example rows. Keys are FieldSpec.key values.
  exampleRows?: Record<string, any>[];
  // returns a normalised "dedupe key" string for one row to skip duplicates
  dedupeKey?: (row: Record<string, any>) => string;
};

const S = {
  agentName: ["اسم الوكيل", "الوكيل", "العميل", "اسم العميل", "المندوب", "اسم المندوب"],
  companyName: ["اسم الشركة", "الشركة", "الشركة الصادرة", "شركة الإصدار", "الجهة المصدرة", "جهة الموافقة"],
  merchantName: ["اسم التاجر", "التاجر"],
  investorName: ["اسم المستثمر", "المستثمر"],
  passenger: ["اسم المسافر", "المسافر", "اسم العميل", "العميل", "الراكب", "الاسم"],
  passport: ["رقم الجواز", "الجواز", "جواز السفر", "Passport", "passport"],
  nationalId: ["الرقم القومي", "البطاقة", "رقم البطاقة", "National ID"],
  destination: ["الوجهة", "وجهة السفر", "الدولة", "البلد"],
  authority: ["جهة السفر", "المنفذ", "المطار", "جهة الإصدار", "جهة المغادرة"],
  airline: ["شركة الطيران", "الناقل", "الخط الجوي", "الطيران"],
  travelDate: ["تاريخ السفر", "تاريخ الرحلة", "تاريخ المغادرة"],
  date: ["التاريخ", "تاريخ", "Date"],
  amount: ["المبلغ", "القيمة", "Amount", "amount"],
  price: ["السعر", "Price"],
  count: ["العدد", "الكمية", "العدد المباع"],
  phone: ["الهاتف", "رقم الهاتف", "موبايل", "تليفون", "Phone"],
  whatsapp: ["واتساب", "WhatsApp", "whatsapp", "رقم واتساب"],
  governorate: ["المحافظة", "Governorate"],
  notes: ["ملاحظات", "ملاحظة", "Notes", "البيان", "بيان"],
  statement: ["البيان", "بيان", "Statement"],
  paymentMethod: ["طريقة الدفع", "وسيلة الدفع", "نوع الدفع"],
  serviceType: ["نوع الخدمة", "الخدمة", "Service"],
  status: ["الحالة", "Status"],
  dob: ["تاريخ الميلاد", "ميلاد", "DOB"],
  expenseName: ["اسم المصروف", "البند", "بيان المصروف"],
  expenseType: ["نوع المصروف", "تصنيف المصروف"],
  fundingSource: ["مصدر الدفع", "دفع من", "المصدر"],
  currency: ["العملة", "Currency", "currency"],
};

const baseAgent: FieldSpec = {
  key: "agent", label: "اسم الوكيل", type: "lookup", lookup: "agent", dbColumn: "agent_id",
  synonyms: S.agentName, required: true, example: "اسم الوكيل",
};
const baseCompany: FieldSpec = {
  key: "company", label: "اسم الشركة الصادرة", type: "lookup", lookup: "company", dbColumn: "company_id",
  synonyms: S.companyName, required: true, example: "اسم الشركة",
};
const baseMerchant: FieldSpec = {
  key: "merchant", label: "اسم التاجر", type: "lookup", lookup: "merchant", dbColumn: "merchant_id",
  synonyms: S.merchantName,
};

export const IMPORT_SPECS: ImportSpec[] = [
  {
    id: "agents", label: "الوكلاء", table: "agents",
    fields: [
      { key: "name", label: "اسم الوكيل", type: "string", required: true, synonyms: S.agentName, example: "اسم الوكيل" },
      { key: "national_id", label: "الرقم القومي", type: "string", synonyms: S.nationalId },
      { key: "phone", label: "الهاتف", type: "string", synonyms: S.phone },
      { key: "whatsapp", label: "واتساب", type: "string", synonyms: S.whatsapp },
      { key: "governorate", label: "المحافظة", type: "string", synonyms: S.governorate, example: "القاهرة" },
      { key: "tier", label: "الفئة", type: "string", synonyms: ["الفئة", "تصنيف الوكيل", "Agent Tier", "tier"], default: "C", example: "C" },
      { key: "status", label: "الحالة", type: "string", synonyms: S.status, default: "نشط", example: "نشط" },
    ],
    dedupeKey: (r) => `agent:${String(r.name || "").trim().toLowerCase()}`,
  },
  {
    id: "companies", label: "الشركات الصادرة", table: "issuing_companies",
    fields: [
      { key: "company_name", label: "اسم الشركة", type: "string", required: true, synonyms: S.companyName, example: "اسم الشركة" },
      { key: "service_type", label: "نوع الشركة/الخدمة", type: "string", synonyms: S.serviceType },
      { key: "phone", label: "الهاتف", type: "string", synonyms: S.phone },
      { key: "whatsapp", label: "واتساب", type: "string", synonyms: S.whatsapp },
      { key: "status", label: "الحالة", type: "string", synonyms: S.status, default: "نشط", example: "نشط" },
    ],
    dedupeKey: (r) => `company:${String(r.company_name || "").trim().toLowerCase()}`,
  },
  {
    id: "merchants", label: "التجار", table: "merchants",
    fields: [
      { key: "merchant_name", label: "اسم التاجر", type: "string", required: true, synonyms: S.merchantName, example: "اسم التاجر" },
      { key: "phone", label: "الهاتف", type: "string", synonyms: S.phone },
      { key: "whatsapp", label: "واتساب", type: "string", synonyms: S.whatsapp },
      { key: "supports_instapay", label: "يدعم إنستاباي", type: "boolean", synonyms: ["يدعم إنستاباي", "انستاباي", "supports_instapay"], default: false, example: "نعم" },
      { key: "supports_cash_wallet", label: "يدعم المحفظة", type: "boolean", synonyms: ["يدعم المحفظة", "محفظة", "supports_cash_wallet"], default: false },
      { key: "supports_physical_cash", label: "يدعم النقدي", type: "boolean", synonyms: ["يدعم النقدي", "نقدي", "supports_physical_cash"], default: false, example: "نعم" },
      { key: "status", label: "الحالة", type: "string", synonyms: S.status, default: "نشط", example: "نشط" },
    ],
    dedupeKey: (r) => `merchant:${String(r.merchant_name || "").trim().toLowerCase()}`,
  },
  {
    id: "submissions", label: "التقديمات", table: "submissions",
    fields: [
      { key: "_service_type", label: "نوع الخدمة", type: "string", required: true, synonyms: S.serviceType, example: "موافقة أمنية" },
      { key: "passenger_name", label: "اسم المسافر", type: "string", required: true, synonyms: S.passenger, example: "اسم المسافر" },
      { key: "national_id", label: "الرقم القومي", type: "string", synonyms: S.nationalId },
      { key: "dob", label: "تاريخ الميلاد", type: "date", synonyms: S.dob },
      { key: "passport", label: "رقم الجواز", type: "string", synonyms: S.passport },
      { key: "birth_place", label: "محل الميلاد", type: "string", synonyms: ["محل الميلاد", "مكان الميلاد"] },
      { ...baseAgent, required: false },
      { key: "status", label: "الحالة", type: "string", synonyms: S.status, example: "بطيء" },
      { key: "departure_from", label: "جهة المغادرة", type: "string", synonyms: S.authority, example: "مطار القاهرة" },
      { key: "submit_date", label: "تاريخ التقديم", type: "date", synonyms: ["تاريخ التقديم", ...S.date], example: "2026-08-29" },
      { key: "issue_date", label: "تاريخ الصدور", type: "date", synonyms: ["تاريخ الصدور", "تاريخ الإصدار"] },
      { key: "approval_company", label: "جهة الموافقة (الشركة الصادرة)", type: "lookup", lookup: "company", dbColumn: "approval_company_id", synonyms: S.companyName },
      { key: "passenger_type", label: "نوع المسافر", type: "string", synonyms: ["نوع المسافر", "فئة المسافر"] },
      { key: "approval_validity_enabled", label: "تفعيل صلاحية الموافقة", type: "boolean", synonyms: ["تفعيل صلاحية الموافقة", "صلاحية الموافقة"], default: false },
      { key: "notes", label: "ملاحظات", type: "string", synonyms: S.notes },
    ],
    transformRow: (r) => {
      const { _service_type, ...rest } = r;
      return { ...rest, services: _service_type ? [String(_service_type)] : [] };
    },
    dedupeKey: (r) => `sub:${String(r.passport || r.national_id || r.passenger_name || "").trim().toLowerCase()}|${r.submit_date || ""}|${String((r.services || [])[0] || "")}`,
  },
  {
    // Simplified import: one Excel row = one execution. Service/pricing data
    // is intentionally left empty and can be completed later from execution details.
    id: "executions", label: "التنفيذات", table: "executions",
    fields: [
      { key: "passenger_name", label: "اسم المسافر", type: "string", required: true, synonyms: S.passenger, example: "اسم المسافر" },
      { key: "national_id", label: "الرقم القومي", type: "string", synonyms: S.nationalId },
      { key: "dob", label: "تاريخ الميلاد", type: "date", synonyms: S.dob },
      { key: "passenger_type", label: "نوع المسافر", type: "string", synonyms: ["نوع المسافر", "فئة المسافر"] },
      { key: "passport", label: "رقم الجواز", type: "string", synonyms: S.passport },
      { key: "agent", label: "الوكيل", type: "lookup", lookup: "agent", dbColumn: "agent_id", synonyms: S.agentName, example: "اسم الوكيل" },
      { key: "status", label: "حالة الموافقة", type: "string", synonyms: ["حالة الموافقة", ...S.status], example: "بطيء" },
      { key: "operation_status", label: "حالة العملية", type: "string", synonyms: ["حالة العملية", "حالة التنفيذ"], example: "قيد التنفيذ" },
    ],
  },
  {
    id: "transactions", label: "الحركات المالية للوكلاء", table: "transactions",
    fields: [
      baseAgent,
      { key: "date", label: "التاريخ", type: "date", required: true, synonyms: S.date, example: "2026-08-29" },
      { key: "destination", label: "الوجهة", type: "string", synonyms: S.destination },
      { key: "service_type", label: "نوع الخدمة", type: "string", synonyms: S.serviceType },
      { key: "count", label: "العدد", type: "integer", synonyms: S.count, default: 0 },
      { key: "price", label: "السعر", type: "number", synonyms: S.price, default: 0 },
      { key: "paid", label: "المدفوع", type: "number", synonyms: ["المدفوع", "الدفع", "المبلغ"], default: 0 },
      { key: "instapay_amount", label: "إنستاباي", type: "number", synonyms: ["انستا", "إنستا", "إنستاباي", "instapay"], default: 0 },
      { key: "cash_amount", label: "نقدي", type: "number", synonyms: ["نقدي", "كاش"], default: 0 },
      { key: "payment_method", label: "طريقة الدفع", type: "string", synonyms: S.paymentMethod, default: "نقدي", example: "نقدي" },
      { key: "currency", label: "العملة", type: "string", synonyms: S.currency, default: "EGP", example: "EGP" },
      baseMerchant,
      { key: "statement", label: "البيان", type: "string", synonyms: S.statement },
      { key: "note", label: "ملاحظات", type: "string", synonyms: S.notes },
    ],
    dedupeKey: (r) =>
      `tx:${r.agent_id || ""}|${r.date || ""}|${Number(r.paid || r.price || 0)}|${String(r.note || r.statement || "").trim()}`,
  },
  {
    id: "company_transactions", label: "الحركات المالية للشركات", table: "company_transactions",
    fields: [
      baseCompany,
      { key: "date", label: "التاريخ", type: "date", required: true, synonyms: S.date, example: "2026-08-29" },
      { key: "destination", label: "الوجهة", type: "string", synonyms: S.destination },
      { key: "service_type", label: "نوع الخدمة", type: "string", synonyms: S.serviceType },
      { key: "count", label: "العدد", type: "integer", synonyms: S.count, default: 0 },
      { key: "price", label: "السعر", type: "number", synonyms: S.price, default: 0 },
      { key: "trip_value", label: "قيمة الخدمة", type: "number", synonyms: ["قيمة الخدمة", "قيمة الرحلة", "إجمالي الخدمة"], default: 0 },
      { key: "total_paid", label: "المدفوع", type: "number", synonyms: ["المدفوع", "الدفع", "المبلغ"], default: 0 },
      { key: "instapay_amount", label: "إنستاباي", type: "number", synonyms: ["انستا", "إنستا", "إنستاباي", "instapay"], default: 0 },
      { key: "cash_amount", label: "نقدي", type: "number", synonyms: ["نقدي", "كاش"], default: 0 },
      { key: "currency", label: "العملة", type: "string", synonyms: S.currency, default: "EGP", example: "EGP" },
      { key: "payment_currency", label: "عملة الدفع", type: "string", synonyms: ["عملة الدفع", "Payment Currency"], default: "EGP" },
      { key: "exchange_rate_used", label: "سعر الصرف", type: "number", synonyms: ["سعر الصرف", "Exchange Rate"], default: 1 },
      baseMerchant,
      { key: "statement", label: "البيان", type: "string", synonyms: S.statement },
      { key: "note", label: "ملاحظات", type: "string", synonyms: S.notes },
    ],
    dedupeKey: (r) =>
      `ctx:${r.company_id || ""}|${r.date || ""}|${Number(r.total_paid || r.trip_value || r.price || 0)}|${String(r.note || r.statement || "").trim()}`,
  },
  {
    id: "expenses", label: "المصروفات", table: "expenses",
    fields: [
      { key: "expense_name", label: "اسم المصروف", type: "string", required: true, synonyms: S.expenseName, example: "مصروف تشغيلي" },
      { key: "expense_type", label: "نوع المصروف", type: "string", synonyms: S.expenseType, default: "متغير", example: "متغير" },
      { key: "date", label: "التاريخ", type: "date", required: true, synonyms: S.date, example: "2026-08-29" },
      { key: "amount", label: "المبلغ", type: "number", required: true, synonyms: S.amount, default: 0 },
      { key: "currency", label: "العملة", type: "string", synonyms: S.currency, default: "EGP", example: "EGP" },
      { key: "payment_method", label: "طريقة الدفع", type: "string", synonyms: S.paymentMethod, default: "نقدي", example: "نقدي" },
      { key: "funding_source", label: "مصدر الدفع", type: "string", synonyms: S.fundingSource },
      baseMerchant,
      { key: "statement", label: "البيان", type: "string", synonyms: S.statement },
      { key: "notes", label: "ملاحظات", type: "string", synonyms: S.notes },
    ],
    dedupeKey: (r) =>
      `exp:${String(r.expense_name || "").trim().toLowerCase()}|${r.date || ""}|${Number(r.amount || 0)}`,
  },
];

export function getSpec(id: string): ImportSpec | undefined {
  return IMPORT_SPECS.find((s) => s.id === id);
}