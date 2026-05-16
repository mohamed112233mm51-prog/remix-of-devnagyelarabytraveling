import { Link, Outlet, useLocation, useRouter } from "@tanstack/react-router";
import { useState, useEffect, type ReactNode, type ComponentType } from "react";
import {
  LayoutDashboard,
  Plane,
  ClipboardCheck,
  Users,
  Building2,
  HandCoins,
  Briefcase,
  Wallet,
  BarChart3,
  Settings,
  Menu,
  LogOut,
  X,
  ChevronDown,
  UserCircle,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { checkPerm } from "@/hooks/usePerm";
import { useBranding } from "@/lib/branding";
import { SearchBox, NotificationsBell } from "@/components/TopbarTools";
import { isDevEnv } from "@/lib/env";

type IconType = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
type Item = { to: string; icon: IconType; label: string; section: string; adminOnly?: boolean; permKey?: string | null };

const NAV: { label: string; items: Item[] }[] = [
  {
    label: "الرئيسية",
    items: [{ to: "/", icon: LayoutDashboard, label: "لوحة التحكم", section: "الرئيسية", permKey: "dashboard" }],
  },
  {
    label: "العمليات",
    items: [
      { to: "/flights", icon: Plane, label: "قوائم الرحلات", section: "العمليات", permKey: "flights" },
      { to: "/approvals", icon: ClipboardCheck, label: "تقديمات الموافقات الأمنية", section: "العمليات", permKey: "approvals" },
    ],
  },
  {
    label: "الحسابات المالية",
    items: [
      { to: "/accounts", icon: Users, label: "حسابات الوكلاء", section: "الحسابات المالية", permKey: "accounts" },
      { to: "/companies", icon: Building2, label: "حسابات الشركات الصادرة", section: "الحسابات المالية", permKey: "companies" },
      { to: "/merchants", icon: HandCoins, label: "حسابات كاش التاجر", section: "الحسابات المالية", permKey: "merchants" },
      { to: "/investors", icon: Briefcase, label: "حسابات المستثمرين", section: "الحسابات المالية", permKey: "investors" },
    ],
  },
  {
    label: "المصروفات",
    items: [
      { to: "/expenses", icon: Wallet, label: "المصروفات", section: "المصروفات", permKey: "expenses" },
    ],
  },
  {
    label: "التقارير",
    items: [{ to: "/reports", icon: BarChart3, label: "التقارير", section: "التقارير", permKey: "reports" }],
  },
  {
    label: "الإعدادات",
    items: [{ to: "/settings", icon: Settings, label: "الإعدادات", section: "الإعدادات", adminOnly: true }],
  },
];

const TITLES: Record<string, ReactNode> = {
  "/": (<>لوحة <span>التحكم</span></>),
  "/flights": (<>قوائم <span>الرحلات</span></>),
  "/approvals": (<>تقديمات <span>الموافقات الأمنية</span></>),
  "/accounts": (<>حسابات <span>الوكلاء</span></>),
  "/companies": (<>حسابات <span>الشركات الصادرة</span></>),
  "/merchants": (<>حسابات <span>كاش التاجر</span></>),
  "/investors": (<>حسابات <span>المستثمرين</span></>),
  "/expenses": (<>إدارة <span>المصروفات</span></>),
  "/reports": (<>التقارير <span>والإحصائيات</span></>),
  "/settings": (<>الإعدادات <span>والصلاحيات</span></>),
};

export default function Layout() {
  const loc = useLocation();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { isAdmin, user, signOut, permissions } = useAuth();
  const branding = useBranding();
  const allowed = (it: Item) => {
    if (it.adminOnly) return isAdmin;
    return checkPerm(permissions, isAdmin, it.permKey ?? null, "view");
  };

  const path = loc.pathname;
  const title: ReactNode = TITLES[path] ?? (<>كشف <span>حساب الوكيل</span></>);

  // Close mobile drawer when route changes
  useEffect(() => { setOpen(false); }, [path]);

  const hasAnyAllowed = NAV.some((sec) => sec.items.some(allowed));
  if (!hasAnyAllowed) {
    return (
      <div dir="rtl" style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "#f5f7fb" }}>
        <div style={{ background: "#fff", padding: 28, borderRadius: 16, maxWidth: 420, width: "100%", textAlign: "center", boxShadow: "0 8px 30px rgba(0,0,0,.08)" }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🔒</div>
          <h2 style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 800 }}>لا توجد أقسام متاحة لهذا المستخدم</h2>
          <p style={{ marginTop: 0, color: "#6b7280", fontSize: 13 }}>يرجى التواصل مع المسؤول لمنح الصلاحيات.</p>
          <button
            onClick={() => signOut()}
            style={{ marginTop: 14, width: "100%", padding: "12px 16px", borderRadius: 10, background: "#2563eb", color: "#fff", border: 0, fontWeight: 700, cursor: "pointer" }}
          >
            تسجيل الخروج
          </button>
        </div>
      </div>
    );
  }

  const bottomItems: { to: string; icon: IconType; label: string; permKey: string | null }[] = [
    { to: "/", icon: LayoutDashboard, label: "الرئيسية", permKey: "dashboard" },
    { to: "/flights", icon: Plane, label: "الرحلات", permKey: "flights" },
    { to: "/approvals", icon: ClipboardCheck, label: "تقديمات", permKey: "approvals" },
    { to: "/accounts", icon: Users, label: "حسابات", permKey: "accounts" },
    { to: "/investors", icon: Briefcase, label: "مستثمرين", permKey: "investors" },
  ];

  return (
    <div dir="rtl" data-screenshot-root>
      <div className={`sidebar-overlay ${open ? "open" : ""}`} onClick={() => setOpen(false)}></div>

      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="logo-area">
          <button
            className="sidebar-close"
            onClick={() => setOpen(false)}
            aria-label="إغلاق"
            type="button"
          >
            <X size={18} strokeWidth={2.2} />
          </button>
          <div className="logo-row">
            <img
              src={branding.logoUrl}
              alt=""
              className="brand-logo brand-logo--sidebar"
              decoding="async"
              loading="eager"
              draggable={false}
            />
            <div className="logo-text">
              <div className="logo-title">{branding.companyName}</div>
              <div className="logo-sub">وساطة • سفر • موافقات • حسابات</div>
            </div>
          </div>
        </div>

        <div className="sidebar-scroll">
          {NAV.map((sec) => {
            const items = sec.items.filter(allowed);
            if (items.length === 0) return null;
            return (
              <div className="nav-section" key={sec.label}>
                <div className="nav-label">{sec.label}</div>
                {items.map((it) => {
                  const active = path === it.to || (it.to === "/agents" && path.startsWith("/agents"));
                  const Icon = it.icon;
                  return (
                    <Link
                      key={it.to}
                      to={it.to}
                      className={`nav-item ${active ? "active" : ""}`}
                    >
                      <span className="nav-icon"><Icon size={17} strokeWidth={1.9} /></span>
                      <span className="nav-text">{it.label}</span>
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </div>

        <div className="sidebar-footer">
          <div className="user-email" title={user?.email ?? ""}>{user?.email}</div>
          <button onClick={() => signOut()} className="logout-btn" type="button">
            <LogOut size={16} strokeWidth={2} />
            <span>تسجيل الخروج</span>
          </button>
        </div>
      </aside>

      <div className={`main ${open ? "with-sidebar" : ""}`}>
        <div className="topbar">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              className="hamburger"
              onClick={() => setOpen((v) => !v)}
              aria-label="القائمة"
              type="button"
            >
              <Menu size={22} strokeWidth={2} />
            </button>
            <img
              src={branding.logoUrl}
              alt=""
              className="brand-logo brand-logo--navbar"
              decoding="async"
              loading="eager"
              draggable={false}
              style={{ flexShrink: 0 }}
            />
            <div className="page-title">{title}</div>
            {isDevEnv() && (
              <span
                title="بيئة التطوير — البيانات منفصلة تمامًا عن قاعدة بيانات الإنتاج"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  fontSize: 11, fontWeight: 900, letterSpacing: 0.6,
                  color: "#78350F", background: "linear-gradient(180deg,#FEF3C7,#FDE68A)",
                  border: "1px solid #F59E0B", boxShadow: "0 1px 2px rgba(180,83,9,.15)",
                  padding: "3px 10px", borderRadius: 999, flexShrink: 0,
                  textTransform: "uppercase",
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: 999, background: "#D97706", boxShadow: "0 0 0 2px #FDE68A" }} />
                DEV ENVIRONMENT
              </span>
            )}
          </div>
          <div className="topbar-actions">
            <SearchBox />
            <NotificationsBell />
            <div className="topbar-divider" />
            <UserMenu email={user?.email ?? ""} onSignOut={() => signOut()} />
          </div>
        </div>

        <div className="content">
          <Outlet />
        </div>
      </div>

      <nav className="bottom-nav">
        <div className="bottom-nav-inner">
          {bottomItems
            .filter((b) => checkPerm(permissions, isAdmin, b.permKey, "view"))
            .map((b) => {
              const Icon = b.icon;
              return (
                <div
                  key={b.to}
                  className={`bottom-nav-item ${path === b.to ? "active" : ""}`}
                  onClick={() => router.navigate({ to: b.to })}
                >
                  <div className="bn-icon"><Icon size={20} strokeWidth={2} /></div>
                  <div>{b.label}</div>
                </div>
              );
            })}
        </div>
      </nav>
    </div>
  );
}

function UserMenu({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const handler = () => setOpen(false);
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, [open]);
  const initial = (email || "?").trim().charAt(0).toUpperCase();
  return (
    <div className="topbar-user" onClick={(e) => e.stopPropagation()}>
      <button className="topbar-user-btn" type="button" onClick={() => setOpen((v) => !v)} aria-label="الحساب">
        <span className="topbar-avatar">{initial}</span>
        <span className="topbar-user-email">{email}</span>
        <ChevronDown size={14} strokeWidth={2} />
      </button>
      {open && (
        <div className="topbar-menu" role="menu">
          <div className="topbar-menu-head">
            <UserCircle size={28} strokeWidth={1.6} />
            <div>
              <div className="topbar-menu-name">المستخدم الحالي</div>
              <div className="topbar-menu-email">{email}</div>
            </div>
          </div>
          <button className="topbar-menu-item danger" type="button" onClick={onSignOut}>
            <LogOut size={14} strokeWidth={2} />
            <span>تسجيل الخروج</span>
          </button>
        </div>
      )}
    </div>
  );
}
