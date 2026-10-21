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
    ? "اختر الشركة أولاً لجلب السعر تلقائيًا"
    : service.kind === "agent" && !agent
      ? "اختر الوكيل أولاً لجلب السعر تلقائيًا"
      : !service.service_type
        ? "اختر نوع الخدمة لجلب السعر تلقائيًا"
        : undefined;
  return {
    context,
    message,
    key: JSON.stringify([service.kind, form.agent_id, context, message]),
    inputKey: JSON.stringify([service.kind, form.agent_id, { ...context, agent_tier: undefined }]),
    agentReady: !form.agent_id || Boolean(agent),
  };
}

type Entry = {
  service: ExecutionServiceItem;
  key: string;
  inputKey: string;
  awaitingAgent: boolean;
  cancelled: boolean;
  status: PriceStatus;
};

/** Form-only price preview. Never writes executions, debts or pricing rules. */
export function useExecutionServicePricing(
  form: PricingForm,
  services: ExecutionServiceItem[],
  agents: Agent[],
  setServices: Dispatch<SetStateAction<ExecutionServiceItem[]>>,
  preserveInitialPrices: boolean | ((service: ExecutionServiceItem, index: number) => boolean),
) {
  const entries = useRef<Entry[]>([]);
  const initialized = useRef(false);
  const latest = useRef({ form, agents });
  latest.current = { form, agents };
  const [, refresh] = useState(0);
  const shouldPreserve = (service: ExecutionServiceItem, index: number) =>
    typeof preserveInitialPrices === "function"
      ? preserveInitialPrices(service, index)
      : preserveInitialPrices;

  useEffect(
    () => () => {
      for (const entry of entries.current) {
        if (entry.status.state === "loading") entry.cancelled = true;
      }
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
      // Retain row state after removals, as well as immutable edits to count,
      // note or manual price. No row IDs are added to the persisted services.
      const atIndex = previous[index];
      const old =
        byService.get(service) ||
        (atIndex && !currentServices.has(atIndex.service) && !claimed.has(atIndex)
          ? atIndex
          : undefined);
      if (old) claimed.add(old);
      // Loading the agent list on an unchanged historical form is hydration,
      // not a request to replace its saved prices with today's price list.
      if (old?.awaitingAgent && old.inputKey === plan.inputKey && !old.cancelled) {
        old.key = plan.key;
        old.awaitingAgent = !plan.agentReady;
      }
      if (old && old.key === plan.key && !old.cancelled) {
        old.service = service;
        return old;
      }
      if (old) old.cancelled = true;
      const preserve = !initialized.current && shouldPreserve(service, index);
      const entry: Entry = {
        service,
        key: plan.key,
        inputKey: plan.inputKey,
        awaitingAgent: preserve && !plan.agentReady,
        cancelled: false,
        status: preserve
          ? { state: "saved" }
          : plan.message
            ? { state: "missing", message: plan.message }
            : { state: "loading" },
      };
      if (!preserve) pending.push({ entry, plan });
      return entry;
    });
    initialized.current = true;
    for (const entry of previous) if (!entries.current.includes(entry)) entry.cancelled = true;
    if (!pending.length) {
      // Reordering/removal can move a settled row's status to a new index.
      // Publish that reconciliation even when it needs no new lookup.
      if (
        previous.length !== entries.current.length ||
        previous.some((entry, index) => entry !== entries.current[index])
      ) {
        refresh((value) => value + 1);
      }
      return;
    }

    const update = (entry: Entry, patch: Partial<ExecutionServiceItem>) => {
      if (entry.cancelled) return;
      setServices((rows) => {
        if (entry.cancelled) return rows;
        // The services updater can run before the reconciliation effect after
        // a row removal. Follow the actual row, never its old array position.
        let index = rows.indexOf(entry.service);
        if (index < 0) {
          index = entries.current.indexOf(entry);
          if (entries.current.some((other) => other !== entry && other.service === rows[index]))
            return rows;
        }
        if (index < 0 || !rows[index]) return rows;
        const { form: currentForm, agents: currentAgents } = latest.current;
        if (planFor(rows[index], currentForm, currentAgents).key !== entry.key) return rows;
        return rows.map((row, i) => (i === index ? { ...row, ...patch } : row));
      });
    };
    // Identical purchase/sale lookups share one in-flight read for this batch.
    const requests = new Map<string, ReturnType<typeof resolveAgentPrice>>();
    for (const { entry, plan } of pending) {
      // Clear the previous context's price and legacy explicit total immediately.
      update(
        entry,
        entry.service.kind === "company"
          ? { company_price: 0, company_value: 0, currency: "EGP" }
          : { agent_price: 0, currency: "EGP" },
      );
      if (plan.message) continue;
      const requestKey = JSON.stringify(plan.context);
      let request = requests.get(requestKey);
      if (!request) {
        request = Promise.resolve().then(() => resolveAgentPrice(plan.context));
        requests.set(requestKey, request);
      }
      void request
        .then((result) => {
          if (entry.cancelled) return;
          const price =
            entry.service.kind === "company"
              ? result.rule
                ? Number(result.rule.company_price)
                : null
              : result.agentPrice;
          if (price == null || !Number.isFinite(price)) {
            entry.status = {
              state: "missing",
              message: result.reason || "لا يوجد سعر مطابق؛ يمكنك إدخال السعر يدويًا",
            };
          } else {
            update(
              entry,
              entry.service.kind === "company"
                ? {
                    company_price: price,
                    company_value: 0,
                    currency: result.rule?.currency || "EGP",
                  }
                : { agent_price: price, currency: result.rule?.currency || "EGP" },
            );
            entry.status = { state: "matched" };
          }
          refresh((value) => value + 1);
        })
        .catch(() => {
          if (entry.cancelled) return;
          entry.status = {
            state: "missing",
            message: "تعذر جلب السعر؛ تحقق من الاتصال أو أدخل السعر يدويًا",
          };
          refresh((value) => value + 1);
        });
    }
    refresh((value) => value + 1);
  }, [services, form, agents, setServices, preserveInitialPrices]);

  const statuses: PriceStatus[] = services.map((service, index) => {
    const plan = planFor(service, form, agents);
    const entry = entries.current[index];
    if (
      entry &&
      !entry.cancelled &&
      (entry.key === plan.key || (entry.awaitingAgent && entry.inputKey === plan.inputKey))
    )
      return entry.status;
    if (!initialized.current && shouldPreserve(service, index)) return { state: "saved" };
    // Also block save until an invalid/incomplete new context has cleared the
    // previous amount, even when no database request will be needed.
    return { state: "loading" };
  });
  return { statuses, pending: statuses.some((status) => status.state === "loading") };
}
