import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import { Search, Bell, Loader2, ClipboardCheck, Wallet, Database, UserPlus, Building2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fmtDL } from "@/lib/db";
import { useAuth } from "@/hooks/useAuth";
import { checkPerm } from "@/hooks/usePerm";

type SearchResult = {
  section: string;
  sectionLabel: string;
  title: string;
  description: string;
  to: string;
};

const SECTION_LABELS: Record<string, string> = {
  agents: "وكلاء",
  companies: "شركات صادرة",
  merchants: "تاجر الكاش",
  investors: "مستثمرين",
  expenses: "مصروفات",
};

function useDebounced<T>(value: T, delay: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

function useOutsideClick(ref: React.RefObject<HTMLElement | null>, onOutside: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ref, onOutside, active]);
}

export function SearchBox() {
  const router = useRouter();
  const { isAdmin, permissions } = useAuth();
  const [q, setQ] = useState("");
  const dq = useDebounced(q, 300);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useOutsideClick(wrapRef, () => setOpen(false), open);

  const allowed = useMemo(
    () => ({
      agents: checkPerm(permissions, isAdmin, "accounts", "view"),
      companies: checkPerm(permissions, isAdmin, "companies", "view"),
      merchants: checkPerm(permissions, isAdmin, "merchants", "view"),
      investors: checkPerm(permissions, isAdmin, "investors", "view"),
      expenses: checkPerm(permissions, isAdmin, "expenses", "view"),
    }),
    [permissions, isAdmin],
  );

  useEffect(() => {
    const term = dq.trim();
    if (term.length < 2) {
      setResults([]);
      setError(null);
      return;
    }
    let cancelled = false;
    const like = `%${term}%`;
    setLoading(true);
    setError(null);

    const queries: Promise<SearchResult[]>[] = [];

    if (allowed.agents) {
      queries.push((async (): Promise<SearchResult[]> => {
        const { data, error } = await supabase.from("agents").select("id,name,phone,governorate").or(`name.ilike.${like},phone.ilike.${like},governorate.ilike.${like}`).limit(5);
        if (error) throw error;
        return (Array.isArray(data) ? data : []).map((r: any) => ({
              section: "agents",
              sectionLabel: SECTION_LABELS.agents,
              title: r.name || "وكيل",
              description: [r.phone, r.governorate].filter(Boolean).join(" • "),
              to: `/agent-statement/${r.id}`,
            }));
      })());
    }
    // (flights/approvals search removed — those tables no longer exist)
    if (allowed.companies) {
      queries.push((async (): Promise<SearchResult[]> => {
        const { data, error } = await supabase.from("issuing_companies").select("id,company_name,phone,service_type").or(`company_name.ilike.${like},phone.ilike.${like},service_type.ilike.${like}`).limit(5);
        if (error) throw error;
        return (Array.isArray(data) ? data : []).map((r: any) => ({
              section: "companies",
              sectionLabel: SECTION_LABELS.companies,
              title: r.company_name || "شركة",
              description: [r.service_type, r.phone].filter(Boolean).join(" • "),
              to: `/companies`,
            }));
      })());
    }
    if (allowed.merchants) {
      queries.push((async (): Promise<SearchResult[]> => {
        const { data, error } = await supabase.from("merchants").select("id,merchant_name,phone").or(`merchant_name.ilike.${like},phone.ilike.${like}`).limit(5);
        if (error) throw error;
        return (Array.isArray(data) ? data : []).map((r: any) => ({
              section: "merchants",
              sectionLabel: SECTION_LABELS.merchants,
              title: r.merchant_name || "تاجر",
              description: r.phone || "",
              to: `/merchants`,
            }));
      })());
    }
    if (allowed.investors) {
      queries.push((async (): Promise<SearchResult[]> => {
        const { data, error } = await supabase.from("investors").select("id,investor_name,phone").or(`investor_name.ilike.${like},phone.ilike.${like}`).limit(5);
        if (error) throw error;
        return (Array.isArray(data) ? data : []).map((r: any) => ({
              section: "investors",
              sectionLabel: SECTION_LABELS.investors,
              title: r.investor_name || "مستثمر",
              description: r.phone || "",
              to: `/investors`,
            }));
      })());
    }
    if (allowed.expenses) {
      queries.push((async (): Promise<SearchResult[]> => {
        const { data, error } = await supabase.from("expenses").select("id,expense_name,expense_type,amount").or(`expense_name.ilike.${like},expense_type.ilike.${like}`).limit(5);
        if (error) throw error;
        return (Array.isArray(data) ? data : []).map((r: any) => ({
              section: "expenses",
              sectionLabel: SECTION_LABELS.expenses,
              title: r.expense_name || "مصروف",
              description: `${r.expense_type || ""} • ${fmtDL(Number(r.amount || 0))}`,
              to: `/expenses`,
            }));
      })());
    }

    Promise.all(queries)
      .then((arrs) => {
        if (cancelled) return;
        setResults(arrs.flat().slice(0, 25));
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Global search error:", err);
        setError("تعذر تنفيذ البحث");
        setResults([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [dq, allowed]);

  const showDropdown = open && q.trim().length >= 2;

  const onPick = (r: SearchResult) => {
    setOpen(false);
    setQ("");
    router.navigate({ to: r.to as never });
  };

  return (
    <div className="topbar-search-wrap" ref={wrapRef}>
      <div className="topbar-search">
        <Search size={14} strokeWidth={2} />
        <input
          type="text"
          placeholder="بحث سريع..."
          aria-label="بحث"
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
        />
        {loading && <Loader2 size={14} className="topbar-search-spin" />}
      </div>

      {showDropdown && (
        <div className="topbar-dropdown topbar-search-dropdown" role="listbox">
          {error && <div className="topbar-dd-empty">{error}</div>}
          {!error && !loading && results.length === 0 && (
            <div className="topbar-dd-empty">لا توجد نتائج</div>
          )}
          {!error && results.map((r, i) => (
            <button
              type="button"
              key={`${r.section}-${i}`}
              className="topbar-search-item"
              onClick={() => onPick(r)}
            >
              <span className="topbar-search-section">{r.sectionLabel}</span>
              <span className="topbar-search-title">{r.title}</span>
              {r.description && <span className="topbar-search-desc">{r.description}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type Notif = {
  id: string;
  title: string;
  description: string;
  icon: ReactNode;
  to?: string;
};

export function NotificationsBell() {
  const router = useRouter();
  const { isAdmin, permissions } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notif[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem("erp-notif-read");
      const parsed = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []);
    } catch { return new Set(); }
  });
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useOutsideClick(wrapRef, () => setOpen(false), open);

  const loadNotifs = async () => {
    try {
      setError(null);
      const next: Notif[] = [];

      // (pending approvals notification removed — moved to submissions/executions)

      // Unpaid company balances
      if (checkPerm(permissions, isAdmin, "companies", "view")) {
        const { data, error: e } = await supabase
          .from("company_transactions")
          .select("trip_value,total_paid,company_id");
        if (e) throw e;
          const totalDue = (Array.isArray(data) ? data : []).reduce((s: number, r: any) => {
          const value = Number(r.trip_value || 0);
          const paid = Number(r.total_paid || 0);
          return s + Math.max(0, value - paid);
        }, 0);
        if (totalDue > 0) {
          next.push({
            id: `companies-due-${Math.round(totalDue)}`,
            title: `أرصدة غير مسددة للشركات`,
            description: `الإجمالي: ${fmtDL(totalDue)}`,
            icon: <Building2 size={16} />,
            to: "/companies",
          });
        }
      }

      // Due expenses today (auto-deduct day matches today, not yet deducted this month)
      if (checkPerm(permissions, isAdmin, "expenses", "view")) {
        const today = new Date();
        const day = today.getDate();
        const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
        const { data: dueExp, error: e1 } = await supabase
          .from("expenses")
          .select("id,expense_name,amount,auto_deduct_day,auto_deduct_enabled")
          .eq("auto_deduct_enabled", true)
          .eq("auto_deduct_day", day);
        if (e1) throw e1;
        const safeDueExp = Array.isArray(dueExp) ? dueExp : [];
        if (safeDueExp.length > 0) {
          const ids = safeDueExp.map((r: any) => r.id);
          const { data: dedRows } = await supabase
            .from("expense_deductions")
            .select("expense_id,deduction_date")
            .in("expense_id", ids)
            .gte("deduction_date", monthStart);
          const deducted = new Set((Array.isArray(dedRows) ? dedRows : []).map((r: any) => r.expense_id));
          const pending = safeDueExp.filter((r: any) => !deducted.has(r.id));
          if (pending.length > 0) {
            next.push({
              id: `expenses-due-${day}-${pending.length}`,
              title: `${pending.length} مصروف مستحق اليوم`,
              description: pending.slice(0, 2).map((p: any) => p.expense_name).join("، "),
              icon: <Wallet size={16} />,
              to: "/expenses",
            });
          }
        }
      }

      // Backup failure (admin only)
      if (isAdmin) {
        const { data, error: e } = await supabase
          .from("backup_logs")
          .select("id,status,failure_reason,created_at")
          .order("created_at", { ascending: false })
          .limit(1);
        if (e) throw e;
        const latest = Array.isArray(data) ? data[0] : undefined;
        if (latest && latest.status !== "success") {
          next.push({
            id: `backup-${latest.id}`,
            title: "فشل النسخ الاحتياطي الأخير",
            description: latest.failure_reason || "راجع سجل النسخ الاحتياطي",
            icon: <Database size={16} />,
            to: "/settings",
          });
        }

        // Pending invitations
        const { data: invs, error: e2 } = await supabase
          .from("profiles")
          .select("id,email,invite_accepted")
          .eq("invite_accepted", false)
          .limit(20);
        if (e2) throw e2;
        const safeInvs = Array.isArray(invs) ? invs : [];
        const cnt = safeInvs.length;
        if (cnt > 0) {
          next.push({
            id: `invites-${cnt}`,
            title: `${cnt} دعوة مستخدم لم تُقبل`,
            description: safeInvs.slice(0, 2).map((p: any) => p.email).join("، "),
            icon: <UserPlus size={16} />,
            to: "/settings",
          });
        }
      }

      setItems(next);
    } catch (err) {
      console.error("Notifications error:", err);
      setError("تعذر تحميل الإشعارات");
      setItems([]);
    }
  };

  useEffect(() => {
    loadNotifs();
    const t = setInterval(loadNotifs, 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, permissions]);

  const unread = items.filter((i) => !readIds.has(i.id)).length;

  const markRead = (id: string) => {
    const next = new Set(readIds);
    next.add(id);
    setReadIds(next);
    try { localStorage.setItem("erp-notif-read", JSON.stringify([...next])); } catch { /* ignore */ }
  };

  const onPick = (n: Notif) => {
    markRead(n.id);
    setOpen(false);
    if (n.to) router.navigate({ to: n.to as never });
  };

  const markAll = () => {
    const next = new Set(readIds);
    items.forEach((i) => next.add(i.id));
    setReadIds(next);
    try { localStorage.setItem("erp-notif-read", JSON.stringify([...next])); } catch { /* ignore */ }
  };

  return (
    <div className="topbar-notif-wrap" ref={wrapRef}>
      <button
        className="topbar-icon-btn"
        aria-label="الإشعارات"
        type="button"
        onClick={() => setOpen((v) => !v)}
      >
        <Bell size={17} strokeWidth={1.9} />
        {unread > 0 && <span className="topbar-badge">{unread > 9 ? "9+" : unread}</span>}
      </button>

      {open && (
        <div className="topbar-dropdown topbar-notif-dropdown" role="menu">
          <div className="topbar-notif-head">
            <span>الإشعارات</span>
            {items.length > 0 && (
              <button type="button" className="topbar-notif-mark" onClick={markAll}>
                تحديد الكل كمقروء
              </button>
            )}
          </div>
          <div className="topbar-notif-list">
            {error && <div className="topbar-dd-empty">{error}</div>}
            {!error && items.length === 0 && <div className="topbar-dd-empty">لا توجد إشعارات جديدة</div>}
            {!error && items.map((n) => {
              const read = readIds.has(n.id);
              return (
                <button
                  key={n.id}
                  type="button"
                  className={`topbar-notif-item ${read ? "is-read" : ""}`}
                  onClick={() => onPick(n)}
                >
                  <span className="topbar-notif-icon">{n.icon}</span>
                  <span className="topbar-notif-body">
                    <span className="topbar-notif-title">{n.title}</span>
                    <span className="topbar-notif-desc">{n.description}</span>
                  </span>
                  {!read && <span className="topbar-notif-dot" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
