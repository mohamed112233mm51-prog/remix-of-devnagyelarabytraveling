import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { Agent, ExecutionServiceItem } from "@/lib/db";
import { resolveAgentPrice, type ResolveContext } from "@/lib/pricingMatch";

type PricingForm = {
  agent_id: string;
  approval_company_id: string;
  departure_from: string;
  destination: string;
  airline: string;
  status: string;
  passenger_type: string;
};
type PriceStatus = { state: "saved" | "loading" | "matched" | "missing"; message?: string };

/** Session draft metadata only; never persisted to execution/financial records. */
export type ExecutionServiceDraft = ExecutionServiceItem & { _priceSource?: "manual" | "auto" };

function samePrice(a: ExecutionServiceDraft, b: ExecutionServiceDraft) {
  return Number((a.kind === "company" ? a.company_price : a.agent_price) || 0) === Number((b.kind === "company" ? b.company_price : b.agent_price) || 0) &&
    Number(a.company_value || 0) === Number(b.company_value || 0) &&
    (a.currency || "EGP") === (b.currency || "EGP") && a._priceSource === b._priceSource;
}

export function executionServicesForSave(services: readonly ExecutionServiceDraft[]): ExecutionServiceItem[] {
  return services.map(({ _priceSource, ...service }) => service);
}

/** Mirrors the existing buy/sell lookup contexts; matching stays in pricingMatch. */
function planFor(service: ExecutionServiceItem, form: PricingForm, agents: Agent[]) {
  const agent = agents.find((item) => item.id === form.agent_id);
  const companyId =
    service.kind === "company"
      ? service.company_id || form.approval_company_id
      : form.approval_company_id;
  const context: ResolveContext = {
    company_id: companyId,
    service_type: service.service_type,
    agent_tier: (agent as Agent & { tier?: string })?.tier || "A",
    departure_from: form.departure_from || null,
    destination: form.destination || null,
    airline: form.airline || null,
    approval_company_id: form.approval_company_id || null,
    status: form.status || null,
    passenger_type: form.passenger_type || null,
  };
  const message = !companyId
    ? "اختر الشركة أولاً لجلب السعر"
    : service.kind === "agent" && !agent
      ? "اختر الوكيل أولاً لجلب السعر"
      : !service.service_type
        ? "اختر نوع الخدمة لجلب السعر"
        : undefined;
  return { context, message, key: JSON.stringify([service.kind, form.agent_id, context, message]) };
}

type Entry = {
  service: ExecutionServiceDraft;
  key: string;
  cancelled: boolean;
  status: PriceStatus;
};

/** Button-driven, form-only lookup. Never writes executions, debts or pricing rules. */
export function useExecutionServicePricing(
  form: PricingForm,
  services: ExecutionServiceDraft[],
  agents: Agent[],
  setServices: Dispatch<SetStateAction<ExecutionServiceDraft[]>>,
) {
  const entries = useRef<Entry[]>([]);
  const latest = useRef({ form, agents });
  const requested = useRef(new Set<ExecutionServiceDraft>());
  latest.current = { form, agents };
  const [revision, refresh] = useState(0);

  useEffect(
    () => () => {
      for (const entry of entries.current) entry.cancelled = true;
      requested.current.clear();
    },
    [],
  );

  useEffect(() => {
    const previous = entries.current;
    const currentServices = new Set(services);
    const byService = new Map(previous.map((entry) => [entry.service, entry]));
    const claimed = new Set<Entry>();
    const pending: { entry: Entry; plan: ReturnType<typeof planFor> }[] = [];
    entries.current = services.map((service, index) => {
      const plan = planFor(service, form, agents);
      const forced = requested.current.delete(service);
      // Retain row state after removals and immutable count/note edits. No row
      // IDs are added to the persisted services; changed prices cancel a lookup.
      const atIndex = previous[index];
      const old = byService.get(service) ||
        (atIndex && !currentServices.has(atIndex.service) && !claimed.has(atIndex) ? atIndex : undefined);
      if (old) claimed.add(old);
      if (old && old.key === plan.key && !old.cancelled && !forced && samePrice(old.service, service)) {
        old.service = service;
        return old;
      }
      if (old) old.cancelled = true;
      const entry: Entry = {
        service, key: plan.key, cancelled: false,
        status: !forced ? { state: "saved" }
          : plan.message ? { state: "missing", message: plan.message } : { state: "loading" },
      };
      // This is the only path that starts a read. Form edits only reconcile and
      // cancel obsolete responses; they never clear, replace or request prices.
      if (forced && !plan.message) pending.push({ entry, plan });
      return entry;
    });
    requested.current.clear();
    for (const entry of previous) if (!entries.current.includes(entry)) entry.cancelled = true;
    if (!pending.length) {
      if (previous.length !== entries.current.length || previous.some((entry, index) => entry !== entries.current[index])) {
        refresh((value) => value + 1);
      }
      return;
    }

    const update = (entry: Entry, patch: Partial<ExecutionServiceDraft>) => {
      if (entry.cancelled) return;
      setServices((rows) => {
        if (entry.cancelled) return rows;
        let index = rows.indexOf(entry.service);
        if (index < 0) {
          index = entries.current.indexOf(entry);
          if (entries.current.some((other) => other !== entry && other.service === rows[index])) return rows;
        }
        if (index < 0 || !rows[index] || !samePrice(entry.service, rows[index])) return rows;
        const { form: currentForm, agents: currentAgents } = latest.current;
        if (planFor(rows[index], currentForm, currentAgents).key !== entry.key) return rows;
        return rows.map((row, i) => (i === index ? { ...row, ...patch } : row));
      });
    };
    // Explicit requests with identical contexts can share an in-flight read.
    const requests = new Map<string, ReturnType<typeof resolveAgentPrice>>();
    for (const { entry, plan } of pending) {
      const requestKey = JSON.stringify(plan.context);
      let request = requests.get(requestKey);
      if (!request) {
        request = Promise.resolve().then(() => resolveAgentPrice(plan.context));
        requests.set(requestKey, request);
      }
      void request.then((result) => {
        if (entry.cancelled) return;
        const price = entry.service.kind === "company"
          ? result.rule ? Number(result.rule.company_price) : null
          : result.agentPrice;
        if (price == null || !Number.isFinite(price)) {
          entry.status = { state: "missing", message: result.reason || "لا يوجد سعر مطابق؛ يمكنك إدخال السعر يدويًا" };
        } else {
          update(entry, entry.service.kind === "company"
            ? { company_price: price, company_value: 0, currency: result.rule?.currency || "EGP", _priceSource: "auto" }
            : { agent_price: price, currency: result.rule?.currency || "EGP", _priceSource: "auto" });
          entry.status = { state: "matched" };
        }
        refresh((value) => value + 1);
      }).catch(() => {
        if (entry.cancelled) return;
        entry.status = { state: "missing", message: "تعذر جلب السعر؛ تحقق من الاتصال أو أدخل السعر يدويًا" };
        refresh((value) => value + 1);
      });
    }
    refresh((value) => value + 1);
  }, [services, form, agents, setServices, revision]);

  const setManualPrice = (index: number, price: number) => {
    if (entries.current[index]) entries.current[index].cancelled = true;
    setServices(rows => rows.map((row, i) => i !== index ? row : {
      ...row, ...(row.kind === "company" ? { company_price: price, company_value: 0 } : { agent_price: price }),
      _priceSource: "manual",
    }));
  };
  const changeService = (index: number, patch: Partial<Pick<ExecutionServiceItem, "service_type" | "company_id">>) => {
    const service = services[index];
    if (!service || ((patch.service_type === undefined || patch.service_type === service.service_type) &&
        (!("company_id" in patch) || (patch.company_id || "") === (service.company_id || "")))) return;
    if (entries.current[index]) entries.current[index].cancelled = true;
    setServices(rows => rows.map((row, i) => i === index ? { ...row, ...patch } : row));
  };
  const fetchPrice = (index: number) => {
    if (!services[index]) return;
    if (entries.current[index]) entries.current[index].cancelled = true;
    requested.current.add(services[index]);
    refresh(value => value + 1);
  };

  const statuses: PriceStatus[] = services.map((service, index) => {
    if (requested.current.has(service)) return { state: "loading" };
    const atIndex = entries.current[index];
    const entry = entries.current.find(item => item.service === service) ||
      (atIndex && !services.includes(atIndex.service) ? atIndex : undefined);
    const plan = planFor(service, form, agents);
    return entry && !entry.cancelled && samePrice(entry.service, service) && entry.key === plan.key
      ? entry.status : { state: "saved" };
  });
  return { statuses, pending: statuses.some((status) => status.state === "loading"), setManualPrice, changeService, fetchPrice };
}
