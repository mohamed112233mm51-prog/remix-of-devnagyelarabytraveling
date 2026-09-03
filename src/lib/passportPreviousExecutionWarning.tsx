import { createRoot } from "react-dom/client";
import { Modal } from "@/components/Modal";
import { supabase } from "@/integrations/supabase/client";
import { toDisplayDate } from "@/lib/dateFormat";

type PreviousExecutionMatch = {
  id: string;
  passenger_name: string | null;
  passport: string | null;
  national_id: string | null;
  operation_status: string | null;
  status: string | null;
  travel_date: string | null;
  created_at: string | null;
  services: any;
};

type PassportIdentity = {
  passengerName?: string | null;
  passport?: string | null;
  nationalId?: string | null;
};

const checkedKeys = new Set<string>();
let warningQueue: Promise<void> = Promise.resolve();

function normalizePassport(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, "");
}

function normalizeNationalId(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

function warningKey(passport: string, nationalId: string): string {
  return nationalId ? `nid:${nationalId}` : `passport:${passport}`;
}

function isCancelledStatus(value: unknown): boolean {
  const text = String(value ?? "");
  return text.includes("ملغي") || text.includes("ملغاة");
}

async function findPreviousExecutions(passport: string, nationalId: string): Promise<PreviousExecutionMatch[]> {
  const filters: string[] = [];
  if (passport) filters.push(`passport.ilike.${passport}`);
  if (nationalId) filters.push(`national_id.ilike.${nationalId}`);
  if (!filters.length) return [];

  const { data, error } = await supabase
    .from("executions")
    .select("id,passenger_name,passport,national_id,operation_status,status,travel_date,created_at,services")
    .or(filters.join(","));

  if (error) throw error;

  return ((data || []) as PreviousExecutionMatch[]).filter((row) => {
    if (isCancelledStatus(row.operation_status)) return false;
    const passportMatch = Boolean(passport) && normalizePassport(row.passport) === passport;
    const nationalMatch = Boolean(nationalId) && normalizeNationalId(row.national_id) === nationalId;
    return passportMatch || nationalMatch;
  });
}

function showPreviousExecutionModal(matches: PreviousExecutionMatch[], currentPassengerName: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") {
      resolve();
      return;
    }

    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    let closed = false;

    const close = () => {
      if (closed) return;
      closed = true;
      root.unmount();
      host.remove();
      resolve();
    };

    root.render(
      <Modal
        open
        onClose={close}
        title="تنبيه: هذا المسافر له تنفيذ سابق"
        maxWidth={560}
        zIndex={100001}
        footer={<button className="btn" onClick={close}>إغلاق</button>}
      >
        <div style={{ fontSize: 13, color: "#334155", lineHeight: 1.9 }}>
          <div style={{ padding: 10, borderRadius: 8, background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", marginBottom: 12, fontWeight: 700 }}>
            {currentPassengerName ? `المسافر «${currentPassengerName}» ` : "هذا المسافر "}
            تم تسجيل تنفيذ له من قبل بنفس الرقم القومي أو رقم الجواز.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 320, overflowY: "auto" }}>
            {matches.map((match) => {
              const serviceNames = Array.isArray(match.services)
                ? match.services.map((service: any) => service?.service_type).filter(Boolean).join("، ")
                : "";
              return (
                <div key={match.id} style={{ padding: 10, borderRadius: 8, border: "1px solid #e2e8f0", background: "#f8fafc" }}>
                  <div><b>الاسم:</b> {match.passenger_name || "—"}</div>
                  <div><b>رقم الجواز:</b> {match.passport || "—"}</div>
                  <div><b>الرقم القومي:</b> {match.national_id || "—"}</div>
                  <div><b>حالة العملية:</b> {match.operation_status || "—"}</div>
                  <div><b>تاريخ التنفيذ:</b> {toDisplayDate(match.created_at) || "—"}</div>
                  <div><b>تاريخ السفر:</b> {toDisplayDate(match.travel_date) || "—"}</div>
                  {serviceNames && <div><b>الخدمة:</b> {serviceNames}</div>}
                  <div style={{ color: "#64748b", fontSize: 11 }}>رقم العملية: {match.id}</div>
                </div>
              );
            })}
          </div>
        </div>
      </Modal>,
    );
  });
}

export async function warnIfPassportPassengerHasPreviousExecution(identity: PassportIdentity): Promise<void> {
  const passport = normalizePassport(identity.passport);
  const nationalId = normalizeNationalId(identity.nationalId);
  if (!passport && !nationalId) return;

  const key = warningKey(passport, nationalId);
  if (checkedKeys.has(key)) return;
  checkedKeys.add(key);

  try {
    const matches = await findPreviousExecutions(passport, nationalId);
    if (!matches.length) return;

    warningQueue = warningQueue
      .catch(() => undefined)
      .then(() => showPreviousExecutionModal(matches, String(identity.passengerName || "").trim()));
  } catch {
    checkedKeys.delete(key);
    // Duplicate-history lookup is informational only and must never block OCR.
  }
}
