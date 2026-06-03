// Smart import specs: target tables, columns, synonyms (Arabic), validation hints.
export type FieldType = "string" | "number" | "integer" | "date" | "lookup" | "boolean";

export type FieldSpec = {
  key: string;            // DB column name (or virtual key for lookups)
  label: string;          // Arabic label shown to user
  type: FieldType;
  required?: boolean;
  synonyms: string[];     // possible Arabic header variants
  lookup?: "agent" | "company" | "merchant" | "investor"; // for type=lookup → resolves to *_id
  dbColumn?: string;      // override the resulting DB column (e.g. agent_id)
  default?: any;
  enum?: string[];        // allowed values (for normalisation)
};

export type ImportSpec = {
  id: string;             // import type id
  label: string;          // Arabic title
  table: string;          // target Supabase table
  fields: FieldSpec[];
  // returns a normalised "dedupe key" string for one row to skip duplicates
  dedupeKey?: (row: Record<string, any>) => string;
};

const S = {
  agentName: ["اسم الوكيل", "الوكيل", "العميل", "اسم العميل", "المندوب", "اسم المندوب"],
  companyName: ["اسم الشركة", "الشركة", "الشركة الصادرة", "شركة الإصدار", "الجهة المصدرة"],
  merchantName: ["اسم التاجر", "التاجر"],
  investorName: ["اسم المستثمر", "المستثمر"],
  passenger: ["اسم المسافر", "المسافر", "اسم العميل", "العميل", "الراكب"],
  passport: ["رقم الجواز", "الجواز", "جواز السفر", "Passport", "passport"],
  nationalId: ["الرقم القومي", "البطاقة", "رقم البطاقة", "National ID"],
  destination: ["الوجهة", "وجهة السفر", "الدولة", "البلد"],
  authority: ["جهة السفر", "المنفذ", "المطار", "جهة الإصدار"],
  airline: ["شركة الطيران", "الناقل", "الخط الجوي"],
  travelDate: ["تاريخ السفر", "تاريخ الرحلة", "تاريخ المغادرة"],
  date: ["التاريخ", "تاريخ", "Date"],
  amount: ["المبلغ", "القيمة", "Amount", "amount"],
  agentPrice: ["سعر الوكيل", "سعر العميل", "سعر البيع للوكيل"],
  companyPrice: ["سعر الشركة", "سعر التكلفة", "سعر الشركة الصادرة"],
  price: ["السعر", "Price"],
  count: ["العدد", "الكمية", "العدد المباع"],
  phone: ["الهاتف", "رقم الهاتف", "موبايل", "تليفون", "Phone"],
  whatsapp: ["واتساب", "WhatsApp", "whatsapp", "رقم واتساب"],
  governorate: ["المحافظة", "Governorate"],
  notes: ["ملاحظات", "ملاحظة", "Notes", "البيان", "بيان"],
  paymentMethod: ["طريقة الدفع", "وسيلة الدفع", "نوع الدفع"],
  serviceType: ["نوع الخدمة", "الخدمة", "Service"],
  status: ["الحالة", "Status"],
  dob: ["تاريخ الميلاد", "ميلاد", "DOB"],
  expenseName: ["اسم المصروف", "البند", "بيان المصروف"],
  expenseType: ["نوع المصروف", "تصنيف المصروف"],
  fundingSource: ["مصدر الدفع", "دفع من", "المصدر"],
  txnType: ["نوع الحركة", "نوع المعاملة", "نوع العملية"],
};

const baseAgent: FieldSpec = {
  key: "agent", label: "اسم الوكيل", type: "lookup", lookup: "agent", dbColumn: "agent_id",
  synonyms: S.agentName, required: true,
};
const baseCompany: FieldSpec = {
  key: "company", label: "اسم الشركة الصادرة", type: "lookup", lookup: "company", dbColumn: "issuing_company_id",
  synonyms: S.companyName,
};
const baseMerchant: FieldSpec = {
  key: "merchant", label: "اسم التاجر", type: "lookup", lookup: "merchant", dbColumn: "merchant_id",
  synonyms: S.merchantName,
};

export const IMPORT_SPECS: ImportSpec[] = [
  {
    id: "agents", label: "الوكلاء", table: "agents",
    fields: [
      { key: "name", label: "اسم الوكيل", type: "string", required: true, synonyms: S.agentName },
      { key: "phone", label: "الهاتف", type: "string", synonyms: S.phone },
      { key: "whatsapp", label: "واتساب", type: "string", synonyms: S.whatsapp },
      { key: "national_id", label: "الرقم القومي", type: "string", synonyms: S.nationalId },
      { key: "governorate", label: "المحافظة", type: "string", synonyms: S.governorate },
      { key: "status", label: "الحالة", type: "string", synonyms: S.status, default: "نشط" },
    ],
    dedupeKey: (r) => `agent:${String(r.name || "").trim().toLowerCase()}`,
  },
  {
    id: "companies", label: "الشركات الصادرة", table: "issuing_companies",
    fields: [
      { key: "company_name", label: "اسم الشركة", type: "string", required: true, synonyms: S.companyName },
      { key: "service_type", label: "نوع الشركة/الخدمة", type: "string", synonyms: S.serviceType },
      { key: "phone", label: "الهاتف", type: "string", synonyms: S.phone },
      { key: "whatsapp", label: "واتساب", type: "string", synonyms: S.whatsapp },
      { key: "status", label: "الحالة", type: "string", synonyms: S.status, default: "نشط" },
    ],
    dedupeKey: (r) => `company:${String(r.company_name || "").trim().toLowerCase()}`,
  },
  {
    id: "merchants", label: "التجار", table: "merchants",
    fields: [
      { key: "merchant_name", label: "اسم التاجر", type: "string", required: true, synonyms: S.merchantName },
      { key: "phone", label: "الهاتف", type: "string", synonyms: S.phone },
      { key: "whatsapp", label: "واتساب", type: "string", synonyms: S.whatsapp },
      { key: "status", label: "الحالة", type: "string", synonyms: S.status, default: "نشط" },
    ],
    dedupeKey: (r) => `merchant:${String(r.merchant_name || "").trim().toLowerCase()}`,
  },
  // flights/approvals/libyan-investment specs removed — those tables no longer exist.
  {
    id: "transactions", label: "الحركات المالية للوكلاء", table: "transactions",
    fields: [
      baseAgent,
      { key: "date", label: "التاريخ", type: "date", required: true, synonyms: S.date },
      { key: "destination", label: "الوجهة", type: "string", synonyms: S.destination },
      { key: "count", label: "العدد", type: "integer", synonyms: S.count, default: 1 },
      { key: "price", label: "السعر", type: "number", synonyms: S.price, default: 0 },
      { key: "paid", label: "المدفوع", type: "number", synonyms: ["المدفوع", "الدفع"], default: 0 },
      { key: "instapay_amount", label: "إنستا باي", type: "number", synonyms: ["انستا", "إنستا", "instapay"], default: 0 },
      { key: "cash_amount", label: "نقدي", type: "number", synonyms: ["نقدي", "كاش"], default: 0 },
      { key: "payment_method", label: "طريقة الدفع", type: "string", synonyms: S.paymentMethod, default: "نقدي" },
      { key: "service_type", label: "نوع الخدمة", type: "string", synonyms: S.serviceType },
      { key: "note", label: "ملاحظات", type: "string", synonyms: S.notes },
    ],
    dedupeKey: (r) =>
      `tx:${r.agent_id || ""}|${r.date || ""}|${Number(r.paid || r.price || 0)}|${String(r.note || "").trim()}`,
  },
  {
    id: "expenses", label: "المصروفات", table: "expenses",
    fields: [
      { key: "expense_name", label: "اسم المصروف", type: "string", required: true, synonyms: S.expenseName },
      { key: "expense_type", label: "نوع المصروف", type: "string", synonyms: S.expenseType, default: "متغير" },
      { key: "date", label: "التاريخ", type: "date", required: true, synonyms: S.date },
      { key: "amount", label: "المبلغ", type: "number", required: true, synonyms: S.amount, default: 0 },
      { key: "payment_method", label: "طريقة الدفع", type: "string", synonyms: S.paymentMethod, default: "نقدي" },
      { key: "funding_source", label: "مصدر الدفع", type: "string", synonyms: S.fundingSource },
      { key: "notes", label: "ملاحظات", type: "string", synonyms: S.notes },
    ],
    dedupeKey: (r) =>
      `exp:${String(r.expense_name || "").trim().toLowerCase()}|${r.date || ""}|${Number(r.amount || 0)}`,
  },
  {
    id: "agent_pricing", label: "تسعير خدمات الوكلاء", table: "agent_service_pricing",
    fields: [
      baseAgent,
      { key: "service_type", label: "نوع الخدمة", type: "string", required: true, synonyms: S.serviceType },
      { key: "agent_price", label: "سعر الوكيل", type: "number", required: true, synonyms: S.agentPrice, default: 0 },
      { key: "company_price", label: "سعر الشركة", type: "number", required: true, synonyms: S.companyPrice, default: 0 },
      { key: "company_percentage", label: "نسبة الشركة %", type: "number", synonyms: ["النسبة", "نسبة الشركة"], default: 0 },
    ],
    dedupeKey: (r) => `price:${r.agent_id || ""}|${String(r.service_type || "").trim()}`,
  },
];

export function getSpec(id: string): ImportSpec | undefined {
  return IMPORT_SPECS.find((s) => s.id === id);
}
