import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { normalizeDropdownValue, VALID_DROPDOWN_CATEGORIES, type DropdownCategory } from "@/lib/db";
import { invalidateBranding, loadBranding, BRAND_NAVY, BRAND_GOLD, BRAND_TEAL, processLogoFile, applyBrandingCssVars } from "@/lib/branding";
import { withFaviconVersion } from "@/lib/favicon";
import {
  listUsers, inviteUser, deleteUser, setUserRole,
  setUserActive, updateUserProfile, resendInvite, sendPasswordReset,
} from "@/lib/admin.functions";
import {
  createBackup, listBackups, downloadBackup, deleteBackup, restoreBackup, previewBackup, runRetentionNow,
} from "@/lib/backups.functions";
import { checkDemoData, generateDemoData, deleteDemoData, productionCleanup, productionWipe, type WipeCategory } from "@/lib/demo-data.functions";
import { getBackendDiagnostics, isProdEnv } from "@/lib/env";
import { Settings as SettingsIcon, Users, UserPlus, ShieldCheck, SlidersHorizontal, DatabaseBackup, Search, Power, Trash2, KeyRound, Mail, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, UserCheck, UserCog, Clock, Building2, Palette, Image as ImageIcon, ListChecks, Plus, Pencil, Check, X as XIcon, Upload, Save, Inbox, MapPin, Plane, Wrench, Phone, DollarSign, Sparkles, AlertCircle, Trash, Database, HardDrive, Download, RotateCcw, Eye, RefreshCw, Calendar, Activity, FileArchive, XCircle, AlertTriangle, Cloud } from "lucide-react";

export const Route = createFileRoute("/settings")({
  component: () => <AppErrorBoundary><SettingsPage /></AppErrorBoundary>,
  errorComponent: () => <SafePageError />,
});

function SafePageError() {
  return <div className="card" style={{ padding: 24 }}>تعذر تحميل الإعدادات مؤقتًا. <button className="btn btn-gold" onClick={() => window.location.reload()}>إعادة المحاولة</button></div>;
}

type Tab = "users" | "add" | "perms" | "general" | "backups" | "production" | "devtools";

const PERMISSION_KEYS: { key: string; label: string }[] = [
  { key: "dashboard", label: "لوحة التحكم" },
  { key: "agents", label: "الوكلاء" },
  { key: "flights", label: "الرحلات" },
  { key: "approvals", label: "الموافقات" },
  { key: "accounts", label: "الحسابات" },
  { key: "expenses", label: "المصروفات" },
  { key: "reports", label: "التقارير" },
  { key: "companies", label: "الشركات" },
  { key: "merchants", label: "التجار" },
  { key: "investors", label: "المستثمرين" },
];

const ACTIONS: { key: "view" | "create" | "edit" | "delete" | "export"; label: string }[] = [
  { key: "view", label: "عرض" },
  { key: "create", label: "إضافة" },
  { key: "edit", label: "تعديل" },
  { key: "delete", label: "حذف" },
  { key: "export", label: "تصدير" },
];

function normalizePerm(v: any): Record<string, boolean> {
  if (v === true) return { view: true, create: true, edit: true, delete: true, export: true };
  if (v && typeof v === "object") return { view: !!v.view, create: !!v.create, edit: !!v.edit, delete: !!v.delete, export: !!v.export };
  return { view: false, create: false, edit: false, delete: false, export: false };
}

function SettingsPage() {
  const { isAdmin, loading } = useAuth();
  const [tab, setTab] = useState<Tab>("users");

  if (loading) return <div style={{ padding: 24 }}>...</div>;
  if (!isAdmin) return <div className="card" style={{ padding: 24 }}>هذه الصفحة للمسؤول فقط</div>;

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "users", label: "المستخدمين", icon: <Users size={15} strokeWidth={2} /> },
    { id: "add", label: "دعوة مستخدم", icon: <UserPlus size={15} strokeWidth={2} /> },
    { id: "perms", label: "صلاحيات المستخدمين", icon: <ShieldCheck size={15} strokeWidth={2} /> },
    { id: "general", label: "إعدادات عامة", icon: <SlidersHorizontal size={15} strokeWidth={2} /> },
    { id: "backups", label: "النسخ الاحتياطي", icon: <DatabaseBackup size={15} strokeWidth={2} /> },
    { id: "production", label: "تنظيف للإنتاج", icon: <Sparkles size={15} strokeWidth={2} /> },
    ...(!isProdEnv() ? [{ id: "devtools" as Tab, label: "أدوات التطوير", icon: <Wrench size={15} strokeWidth={2} /> }] : []),
  ];

  return (
    <div className="accounts-page" style={{ display: "grid", gap: 16 }}>
      <div className="page-header" style={{ display: "flex", alignItems: "center", gap: 14, padding: "18px 20px", background: "linear-gradient(180deg,#FFFFFF 0%,#F8FAFC 100%)", border: "1px solid #E5E7EB", borderRadius: 14, boxShadow: "0 1px 2px rgba(15,23,42,.04)" }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, display: "grid", placeItems: "center", background: "linear-gradient(135deg,#0F1F44,#1E3A8A)", color: "#F5D27A", boxShadow: "0 4px 12px rgba(15,31,68,.18)" }}>
          <SettingsIcon size={22} strokeWidth={2} />
        </div>
        <div style={{ display: "grid", gap: 2 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#64748B", fontSize: 12, fontWeight: 600 }}>
            <span>النظام</span><ChevronLeft size={12} /><span style={{ color: "#0F172A" }}>الإعدادات والصلاحيات</span>
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#0F1F44" }}>الإعدادات والصلاحيات</div>
          <div style={{ fontSize: 13, color: "#64748B" }}>إدارة المستخدمين والصلاحيات وإعدادات النظام</div>
        </div>
      </div>

      <div className="action-toolbar" style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: 8, background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12 }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`tool-tab ${tab === t.id ? "active" : ""}`}
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            {t.icon}<span>{t.label}</span>
          </button>
        ))}
      </div>

      {tab === "users" && <UsersTab />}
      {tab === "add" && <InviteUserTab />}
      {tab === "perms" && <PermsTab />}
      {tab === "general" && <GeneralTab />}
      {tab === "backups" && <BackupsTab />}
      {tab === "production" && <ProductionCleanupTab />}
      {tab === "devtools" && !isProdEnv() && <DevToolsTab />}
    </div>
  );
}

function useAgents() {
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    supabase.from("agents").select("id, name").order("name").then(({ data }) => setAgents((data ?? []) as any));
  }, []);
  return agents;
}

function UsersTab() {
  const fn = useServerFn(listUsers);
  const delFn = useServerFn(deleteUser);
  const activeFn = useServerFn(setUserActive);
  const resendFn = useServerFn(resendInvite);
  const resetFn = useServerFn(sendPasswordReset);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["admin-users"], queryFn: () => fn() });
  const [confirmAction, setConfirmAction] = useState<null | {
    title: string; message: string; confirmLabel: string; danger?: boolean; onConfirm: () => Promise<void> | void;
  }>(null);

  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | "active" | "inactive" | "pending">("");

  if (isLoading) return <div className="card" style={{ padding: 24 }}>جارٍ التحميل...</div>;

  const allUsers = (data?.users ?? []) as any[];
  const allRoles = Array.from(new Set(allUsers.flatMap((u) => u.roles || []))).filter(Boolean);
  const filteredUsers = allUsers.filter((u) => {
    if (q) {
      const s = q.toLowerCase();
      if (!(u.full_name || "").toLowerCase().includes(s) && !(u.email || "").toLowerCase().includes(s)) return false;
    }
    if (roleFilter && !(u.roles || []).includes(roleFilter)) return false;
    if (statusFilter === "pending" && u.last_sign_in_at) return false;
    if (statusFilter === "active" && (!u.is_active || !u.last_sign_in_at)) return false;
    if (statusFilter === "inactive" && u.is_active) return false;
    return true;
  });

  const pill = (bg: string, color: string, border: string): React.CSSProperties => ({
    display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px",
    borderRadius: 999, fontSize: 12, fontWeight: 700, background: bg, color, border: `1px solid ${border}`,
  });
  const iconBtn: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 10px",
    borderRadius: 8, border: "1px solid #E2E8F0", background: "#fff", color: "#0F172A",
    fontSize: 12, fontWeight: 600, cursor: "pointer",
  };
  const iconBtnDanger: React.CSSProperties = { ...iconBtn, background: "#FEF2F2", color: "#B91C1C", borderColor: "#FECACA" };

  const roleBadge = (r: string) => {
    const k = (r || "").toLowerCase();
    if (k === "admin") return pill("linear-gradient(135deg,#0F1F44,#1E3A8A)", "#F5D27A", "#0F1F44");
    if (k === "manager") return pill("#EEF2FF", "#3730A3", "#C7D2FE");
    return pill("#F1F5F9", "#0F172A", "#E2E8F0");
  };

  return (
    <div className="card enterprise-table" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderBottom: "1px solid #E5E7EB", flexWrap: "wrap" }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: "#0F1F44", display: "flex", alignItems: "center", gap: 8 }}>
          <Users size={18} /> قائمة المستخدمين
          <span style={{ fontSize: 12, fontWeight: 600, color: "#64748B", background: "#F1F5F9", padding: "2px 8px", borderRadius: 999 }}>{filteredUsers.length}</span>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ position: "relative" }}>
          <Search size={14} style={{ position: "absolute", insetInlineStart: 10, top: "50%", transform: "translateY(-50%)", color: "#94A3B8" }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث بالاسم أو البريد..." style={{ ...inp, paddingInlineStart: 30, minWidth: 220, marginBottom: 0 }} />
        </div>
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} style={{ ...inp, marginBottom: 0, minWidth: 130 }}>
          <option value="">كل الأدوار</option>
          {allRoles.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} style={{ ...inp, marginBottom: 0, minWidth: 130 }}>
          <option value="">كل الحالات</option>
          <option value="active">نشط</option>
          <option value="inactive">معطل</option>
          <option value="pending">بانتظار التفعيل</option>
        </select>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 820 }}>
          <thead>
            <tr style={{ background: "#F8FAFC", position: "sticky", top: 0 }}>
              <th style={th}>الاسم</th>
              <th style={th}>البريد</th>
              <th style={th}>الدور</th>
              <th style={th}>الحالة</th>
              <th style={th}>آخر دخول</th>
              <th style={th}>الإجراءات</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.length === 0 && (
              <tr><td colSpan={6} style={{ ...td, textAlign: "center", color: "#94A3B8", padding: 40 }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>👥</div>لا يوجد مستخدمون مطابقون للبحث
              </td></tr>
            )}
            {filteredUsers.map((u: any) => {
              const pending = !u.last_sign_in_at;
              return (
                <tr key={u.id}>
                  <td style={{ ...td, fontWeight: 600, color: "#0F172A" }}>{u.full_name}</td>
                  <td style={{ ...td, color: "#475569" }}>{u.email}</td>
                  <td style={td}>
                    {(u.roles || []).length === 0 ? <span style={{ color: "#94A3B8" }}>—</span> :
                      <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
                        {u.roles.map((r: string) => <span key={r} style={roleBadge(r)}>{r}</span>)}
                      </span>}
                  </td>
                  <td style={td}>
                    {pending ? <span style={pill("#FEF3C7", "#92400E", "#FDE68A")}>بانتظار التفعيل</span>
                      : u.is_active ? <span style={pill("#DCFCE7", "#166534", "#BBF7D0")}>● نشط</span>
                      : <span style={pill("#FEE2E2", "#991B1B", "#FECACA")}>● معطل</span>}
                  </td>
                  <td style={{ ...td, color: "#475569", fontSize: 12 }}>{u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString("ar-EG") : "—"}</td>
                  <td style={{ ...td }}>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {pending && (
                        <button onClick={async () => { await resendFn({ data: { email: u.email, origin: window.location.origin } }); toast.success("تم إعادة إرسال الدعوة"); }} style={iconBtn} title="إعادة الدعوة">
                          <Mail size={13} /> إعادة الدعوة
                        </button>
                      )}
                      {!pending && (
                        <button
                          onClick={() => setConfirmAction({
                            title: "إرسال رابط إعادة تعيين كلمة المرور",
                            message: `سيتم إرسال رابط إعادة تعيين كلمة المرور إلى:\n${u.email}`,
                            confirmLabel: "إرسال الرابط",
                            onConfirm: async () => {
                              await resetFn({ data: { email: u.email, origin: window.location.origin } });
                              toast.success("تم إرسال رابط إعادة تعيين كلمة المرور");
                            },
                          })}
                          style={iconBtn}
                          title="إعادة تعيين كلمة المرور"
                        >
                          <KeyRound size={13} /> كلمة المرور
                        </button>
                      )}
                      <button
                        onClick={async () => {
                          await activeFn({ data: { id: u.id, is_active: !u.is_active } });
                          qc.invalidateQueries({ queryKey: ["admin-users"] });
                        }}
                        style={iconBtn}
                        title={u.is_active ? "تعطيل" : "تفعيل"}
                      >
                        <Power size={13} /> {u.is_active ? "تعطيل" : "تفعيل"}
                      </button>
                      <button
                        onClick={() => setConfirmAction({
                          title: "حذف المستخدم",
                          message: `هل أنت متأكد من حذف المستخدم:\n${u.full_name} (${u.email})؟\nلا يمكن التراجع عن هذا الإجراء.`,
                          confirmLabel: "حذف",
                          danger: true,
                          onConfirm: async () => {
                            await delFn({ data: { id: u.id } });
                            toast.success("تم الحذف");
                            qc.invalidateQueries({ queryKey: ["admin-users"] });
                          },
                        })}
                        style={iconBtnDanger}
                        title="حذف"
                      >
                        <Trash2 size={13} /> حذف
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {confirmAction && (
        <ConfirmModal
          title={confirmAction.title}
          message={confirmAction.message}
          confirmLabel={confirmAction.confirmLabel}
          danger={confirmAction.danger}
          onCancel={() => setConfirmAction(null)}
          onConfirm={async () => {
            const a = confirmAction;
            setConfirmAction(null);
            await a.onConfirm();
          }}
        />
      )}
    </div>
  );
}

function InviteUserTab() {
  const fn = useServerFn(inviteUser);
  const qc = useQueryClient();
  const agents = useAgents();
  const [form, setForm] = useState({
    email: "", full_name: "", role: "user" as "admin" | "manager" | "user",
    agent_id: "" as string,
    permissions: {} as Record<string, Record<string, boolean>>,
  });
  const [busy, setBusy] = useState(false);

  function toggleAction(section: string, action: string, val: boolean) {
    const cur = normalizePerm(form.permissions[section]);
    cur[action] = val;
    if (action !== "view" && val) cur.view = true; // any granted action implies view
    setForm({ ...form, permissions: { ...form.permissions, [section]: cur } });
  }
  function toggleAll(section: string, val: boolean) {
    const cur: Record<string, boolean> = { view: val, create: val, edit: val, delete: val, export: val };
    setForm({ ...form, permissions: { ...form.permissions, [section]: cur } });
  }

  const ROLES: { key: "admin" | "manager" | "user"; label: string; desc: string; bg: string; color: string; border: string }[] = [
    { key: "admin", label: "أدمن", desc: "صلاحيات كاملة لإدارة النظام والمستخدمين", bg: "linear-gradient(135deg,#0F1F44,#1E3A8A)", color: "#F5D27A", border: "#0F1F44" },
    { key: "manager", label: "مدير", desc: "إدارة العمليات والتقارير والاطلاع على المعطيات", bg: "#EEF2FF", color: "#3730A3", border: "#C7D2FE" },
    { key: "user", label: "مستخدم", desc: "صلاحيات تشغيلية محدودة حسب الأقسام المسموح بها", bg: "#F1F5F9", color: "#0F172A", border: "#E2E8F0" },
  ];
  // Map any free-text role label to a safe internal access level (admin/manager/user).
  const roleKey = (form.role || "").trim().toLowerCase();
  const accessLevel: "admin" | "manager" | "user" =
    roleKey === "admin" ? "admin" : roleKey === "manager" ? "manager" : "user";
  // Safe role config with fallback for custom labels (prevents crash on ROLES.find()!).
  const role = ROLES.find((r) => r.key === accessLevel) ?? {
    key: accessLevel, label: (form.role || "").trim() || "مستخدم", desc: "",
    bg: "#F1F5F9", color: "#0F172A", border: "#E2E8F0",
  };
  // If user typed a custom label (not the canonical key), show their text.
  const roleDisplayLabel = roleKey && roleKey !== accessLevel ? (form.role || "").trim() : role.label;
  const agentName = agents.find((a) => a.id === form.agent_id)?.name;
  const canSubmit = !!form.email.trim() && !!form.full_name.trim() && !busy;

  function resetForm() {
    setForm({ email: "", full_name: "", role: "user", agent_id: "", permissions: {} });
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.5fr) minmax(0,1fr)", gap: 16, alignItems: "start" }} className="invite-grid">
      <div className="card" style={{ padding: 0, overflow: "hidden", border: "1px solid #E5E7EB", borderRadius: 14 }}>
        <div style={{ padding: "18px 20px", background: "linear-gradient(180deg,#FFFFFF 0%,#F8FAFC 100%)", borderBottom: "1px solid #E5E7EB", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, display: "grid", placeItems: "center", background: "linear-gradient(135deg,#0F1F44,#1E3A8A)", color: "#F5D27A" }}>
            <UserPlus size={20} />
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#0F1F44" }}>دعوة مستخدم جديد</div>
            <div style={{ fontSize: 12.5, color: "#64748B" }}>أرسل دعوة آمنة للمستخدم لتفعيل حسابه وتحديد صلاحياته</div>
          </div>
        </div>

        <div style={{ padding: 20, display: "grid", gap: 14 }}>
          <Field label="الاسم الكامل">
            <input style={inp} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} placeholder="مثال: أحمد محمد" disabled={busy} />
          </Field>
          <Field label="البريد الإلكتروني">
            <input style={inp} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="user@example.com" disabled={busy} />
            <div style={{ fontSize: 11.5, color: "#94A3B8", marginTop: 4 }}>سيتم إرسال رابط الدعوة إلى هذا البريد</div>
          </Field>
          <Field label="الدور">
            <input
              style={inp}
              type="text"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value.slice(0, 40) as any })}
              onBlur={(e) => setForm({ ...form, role: e.target.value.trim().slice(0, 40) as any })}
              placeholder="مثال: admin / manager / accountant / operator / supervisor"
              maxLength={40}
              disabled={busy}
              dir="auto"
            />
            <div style={{ fontSize: 11.5, color: "#94A3B8", marginTop: 4 }}>
              اكتب الدور يدوياً (يدعم العربية والإنجليزية، حتى 40 حرفاً)
            </div>
          </Field>
          <Field label="ربط بوكيل (اختياري)">
            <select style={inp} value={form.agent_id} onChange={(e) => setForm({ ...form, agent_id: e.target.value })} disabled={busy}>
              <option value="">— بدون —</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>

          <div style={{ marginTop: 6 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A", marginBottom: 8 }}>الصلاحيات لكل قسم</div>
            <div style={{ display: "grid", gap: 8 }}>
              {PERMISSION_KEYS.map((p) => {
                const cur = normalizePerm(form.permissions[p.key]);
                const allOn = ACTIONS.every((a) => cur[a.key]);
                return (
                  <div key={p.key} style={{ background: "#F8FAFC", border: "1px solid #E5E7EB", borderRadius: 10, padding: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <strong style={{ fontSize: 13, color: "#0F172A" }}>{p.label}</strong>
                      <label style={{ fontSize: 12, display: "flex", gap: 4, alignItems: "center", cursor: "pointer", color: "#475569" }}>
                        <input type="checkbox" checked={allOn} onChange={(e) => toggleAll(p.key, e.target.checked)} />
                        الكل
                      </label>
                    </div>
                    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                      {ACTIONS.map((a) => (
                        <label key={a.key} style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 12, cursor: "pointer", color: "#334155" }}>
                          <input type="checkbox" checked={!!cur[a.key]} onChange={(e) => toggleAction(p.key, a.key, e.target.checked)} />
                          {a.label}
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8, flexWrap: "wrap" }} className="invite-actions">
            <button onClick={resetForm} disabled={busy} style={{ padding: "10px 16px", borderRadius: 10, border: "1px solid #E2E8F0", background: "#fff", color: "#0F172A", fontWeight: 600, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? .5 : 1 }}>
              إعادة تعيين
            </button>
            <button
              disabled={!canSubmit}
              onClick={async () => {
                if (!form.email || !form.full_name) return toast.error("أكمل الحقول");
                setBusy(true);
                try {
                  await fn({ data: {
                    email: form.email.trim(), full_name: form.full_name, role: accessLevel,
                    agent_id: form.agent_id || null, permissions: form.permissions as any,
                    origin: window.location.origin,
                  } });
                  toast.success("تم إرسال الدعوة بنجاح");
                  resetForm();
                  qc.invalidateQueries({ queryKey: ["admin-users"] });
                } catch (e: any) {
                  toast.error(e.message || "فشل إرسال الدعوة");
                } finally {
                  setBusy(false);
                }
              }}
              style={{
                padding: "10px 18px", borderRadius: 10, border: 0, cursor: canSubmit ? "pointer" : "not-allowed",
                background: canSubmit ? "linear-gradient(135deg,#0F1F44,#1E3A8A)" : "#94A3B8",
                color: "#F5D27A", fontWeight: 800, display: "inline-flex", alignItems: "center", gap: 8,
                boxShadow: canSubmit ? "0 6px 16px rgba(15,31,68,.22)" : "none",
              }}
            >
              <Mail size={15} /> {busy ? "جارٍ الإرسال..." : "إرسال الدعوة"}
            </button>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gap: 12, position: "sticky", top: 12 }}>
        <div className="card" style={{ padding: 0, overflow: "hidden", border: "1px solid #E5E7EB", borderRadius: 14 }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #E5E7EB", background: "#F8FAFC", display: "flex", alignItems: "center", gap: 8 }}>
            <Mail size={15} color="#0F1F44" />
            <div style={{ fontSize: 13, fontWeight: 800, color: "#0F1F44" }}>معاينة الدعوة</div>
          </div>
          <div style={{ padding: 16, display: "grid", gap: 10, fontSize: 13 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 40, height: 40, borderRadius: "50%", background: "linear-gradient(135deg,#0F1F44,#1E3A8A)", color: "#F5D27A", display: "grid", placeItems: "center", fontWeight: 800 }}>
                {(form.full_name || "?").trim().charAt(0).toUpperCase()}
              </div>
              <div style={{ display: "grid", gap: 2 }}>
                <div style={{ fontWeight: 700, color: "#0F172A" }}>{form.full_name || "اسم المستخدم"}</div>
                <div style={{ color: "#64748B", fontSize: 12 }}>{form.email || "user@example.com"}</div>
              </div>
            </div>
            <div style={{ height: 1, background: "#E5E7EB" }} />
            <Row label="الدور"><span style={{ display: "inline-flex", padding: "2px 10px", borderRadius: 999, fontSize: 11.5, fontWeight: 700, background: role.bg, color: role.color, border: `1px solid ${role.border}` }}>{roleDisplayLabel}</span></Row>
            <Row label="الوكيل المرتبط"><span style={{ color: agentName ? "#0F172A" : "#94A3B8" }}>{agentName || "بدون"}</span></Row>
            <Row label="حالة الدعوة">
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 10px", borderRadius: 999, fontSize: 11.5, fontWeight: 700, background: canSubmit ? "#DCFCE7" : "#FEF3C7", color: canSubmit ? "#166534" : "#92400E", border: `1px solid ${canSubmit ? "#BBF7D0" : "#FDE68A"}` }}>
                ● {canSubmit ? "جاهزة للإرسال" : "أكمل البيانات"}
              </span>
            </Row>
            <Row label="صلاحية رابط الدعوة"><span style={{ color: "#0F172A" }}>24 ساعة</span></Row>
          </div>
        </div>

        <div style={{ background: "linear-gradient(180deg,#F8FAFC 0%,#EFF6FF 100%)", border: "1px solid #BFDBFE", borderRadius: 14, padding: 14, display: "grid", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#0F1F44", fontWeight: 800, fontSize: 13 }}>
            <ShieldCheck size={16} /> ملاحظات أمنية
          </div>
          <ul style={{ margin: 0, paddingInlineStart: 18, color: "#334155", fontSize: 12.5, display: "grid", gap: 4 }}>
            <li>سيتم إرسال رابط دعوة آمن للمستخدم.</li>
            <li>المستخدم سيقوم بتعيين كلمة المرور بنفسه.</li>
            <li>لا يتم مشاركة كلمة المرور مع الإدارة.</li>
          </ul>
        </div>
      </div>

      <style>{`
        @media (max-width: 900px) {
          .invite-grid { grid-template-columns: 1fr !important; }
          .invite-actions button { flex: 1 1 auto; justify-content: center; }
        }
      `}</style>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
      <span style={{ color: "#64748B", fontSize: 12 }}>{label}</span>
      <span>{children}</span>
    </div>
  );
}

function PermsTab() {
  const fn = useServerFn(listUsers);
  const qc = useQueryClient();
  const agents = useAgents();
  const { data, isLoading } = useQuery({ queryKey: ["admin-users"], queryFn: () => fn() });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | "active" | "inactive" | "pending">("");
  const [sort, setSort] = useState<"name" | "recent" | "role">("name");

  const allUsers = (data?.users ?? []) as any[];
  const totalUsers = allUsers.length;
  const adminCount = allUsers.filter((u) => (u.roles || []).includes("admin")).length;
  const activeCount = allUsers.filter((u) => u.is_active && u.last_sign_in_at).length;
  const pendingCount = allUsers.filter((u) => !u.last_sign_in_at).length;

  const allRoles = Array.from(new Set(allUsers.flatMap((u) => u.roles || []))).filter(Boolean);
  let filtered = allUsers.filter((u) => {
    if (q) {
      const s = q.toLowerCase();
      if (!(u.full_name || "").toLowerCase().includes(s) && !(u.email || "").toLowerCase().includes(s)) return false;
    }
    if (roleFilter && !(u.roles || []).includes(roleFilter)) return false;
    if (statusFilter === "pending" && u.last_sign_in_at) return false;
    if (statusFilter === "active" && (!u.is_active || !u.last_sign_in_at)) return false;
    if (statusFilter === "inactive" && u.is_active) return false;
    return true;
  });
  filtered = [...filtered].sort((a, b) => {
    if (sort === "name") return (a.full_name || "").localeCompare(b.full_name || "", "ar");
    if (sort === "role") return ((a.roles || [])[0] || "").localeCompare((b.roles || [])[0] || "");
    return new Date(b.last_sign_in_at || 0).getTime() - new Date(a.last_sign_in_at || 0).getTime();
  });

  const stats = [
    { label: "إجمالي المستخدمين", value: totalUsers, icon: <Users size={18} />, bg: "linear-gradient(135deg,#EFF6FF,#DBEAFE)", color: "#1E3A8A", border: "#BFDBFE" },
    { label: "المدراء", value: adminCount, icon: <ShieldCheck size={18} />, bg: "linear-gradient(135deg,#0F1F44,#1E3A8A)", color: "#F5D27A", border: "#0F1F44" },
    { label: "النشطون", value: activeCount, icon: <UserCheck size={18} />, bg: "linear-gradient(135deg,#ECFDF5,#D1FAE5)", color: "#166534", border: "#A7F3D0" },
    { label: "بانتظار التفعيل", value: pendingCount, icon: <Clock size={18} />, bg: "linear-gradient(135deg,#FFFBEB,#FEF3C7)", color: "#92400E", border: "#FDE68A" },
  ];

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 12 }}>
        {stats.map((s) => (
          <div key={s.label} style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 14, padding: 14, display: "flex", alignItems: "center", gap: 12, boxShadow: "0 1px 2px rgba(15,23,42,.04)" }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, display: "grid", placeItems: "center", background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>{s.icon}</div>
            <div>
              <div style={{ fontSize: 12, color: "#64748B", fontWeight: 600 }}>{s.label}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: "#0F1F44", lineHeight: 1.1 }}>{s.value}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden", border: "1px solid #E5E7EB", borderRadius: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderBottom: "1px solid #E5E7EB", background: "linear-gradient(180deg,#FFFFFF 0%,#F8FAFC 100%)", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, display: "grid", placeItems: "center", background: "linear-gradient(135deg,#0F1F44,#1E3A8A)", color: "#F5D27A" }}>
              <ShieldCheck size={18} />
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#0F1F44" }}>صلاحيات المستخدمين</div>
              <div style={{ fontSize: 12, color: "#64748B" }}>إدارة الأدوار والصلاحيات والتحكم في وصول المستخدمين للنظام</div>
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ position: "relative" }}>
            <Search size={14} style={{ position: "absolute", insetInlineStart: 10, top: "50%", transform: "translateY(-50%)", color: "#94A3B8" }} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث بالاسم أو البريد..." style={{ ...inp, paddingInlineStart: 30, minWidth: 200, marginBottom: 0 }} />
          </div>
          <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} style={{ ...inp, marginBottom: 0, minWidth: 120 }}>
            <option value="">كل الأدوار</option>
            {allRoles.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} style={{ ...inp, marginBottom: 0, minWidth: 120 }}>
            <option value="">كل الحالات</option>
            <option value="active">نشط</option>
            <option value="inactive">معطل</option>
            <option value="pending">بانتظار</option>
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as any)} style={{ ...inp, marginBottom: 0, minWidth: 130 }}>
            <option value="name">ترتيب: الاسم</option>
            <option value="recent">ترتيب: آخر دخول</option>
            <option value="role">ترتيب: الدور</option>
          </select>
        </div>

        <div style={{ display: "grid", gap: 10, padding: 16 }}>
          {isLoading && <div style={{ padding: 20, color: "#64748B" }}>جارٍ التحميل...</div>}
          {!isLoading && filtered.length === 0 && (
            <div style={{ padding: 40, textAlign: "center", color: "#94A3B8" }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🛡️</div>لا يوجد مستخدمون مطابقون
            </div>
          )}
          {filtered.map((u: any) => (
            <PermsUserCard
              key={u.id}
              user={u}
              agents={agents}
              isOpen={expandedId === u.id}
              onToggle={() => setExpandedId(expandedId === u.id ? null : u.id)}
              onChanged={() => qc.invalidateQueries({ queryKey: ["admin-users"] })}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function PermsUserCard({ user: u, agents, isOpen, onToggle, onChanged }: {
  user: any;
  agents: { id: string; name: string }[];
  isOpen: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  const setRoleFn = useServerFn(setUserRole);
  const updFn = useServerFn(updateUserProfile);
  const pending = !u.last_sign_in_at;

  const commit = async (sectionKey: string, next: Record<string, boolean>) => {
    const merged = { ...(u.permissions || {}), [sectionKey]: next };
    await updFn({ data: { id: u.id, permissions: merged } });
    onChanged();
  };

  const roleStyle = (r: string): React.CSSProperties => {
    const k = (r || "").toLowerCase();
    const base: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 999, fontSize: 11.5, fontWeight: 700 };
    if (k === "admin") return { ...base, background: "linear-gradient(135deg,#7F1D1D,#B91C1C)", color: "#FEE2E2", border: "1px solid #7F1D1D" };
    if (k === "manager") return { ...base, background: "#EEF2FF", color: "#3730A3", border: "1px solid #C7D2FE" };
    return { ...base, background: "#ECFDF5", color: "#166534", border: "1px solid #A7F3D0" };
  };
  const statusPill: React.CSSProperties = pending
    ? { background: "#FEF3C7", color: "#92400E", border: "1px solid #FDE68A" }
    : u.is_active
      ? { background: "#DCFCE7", color: "#166534", border: "1px solid #BBF7D0" }
      : { background: "#FEE2E2", color: "#991B1B", border: "1px solid #FECACA" };

  const grantedCount = PERMISSION_KEYS.reduce((sum, p) => {
    const cur = normalizePerm(u.permissions?.[p.key]);
    return sum + ACTIONS.reduce((s, a) => s + (cur[a.key] ? 1 : 0), 0);
  }, 0);
  const totalPerms = PERMISSION_KEYS.length * ACTIONS.length;

  return (
    <div style={{ border: "1px solid #E5E7EB", borderRadius: 12, background: "#fff", transition: "box-shadow .15s ease, border-color .15s ease", boxShadow: isOpen ? "0 6px 18px rgba(15,31,68,.08)" : "0 1px 2px rgba(15,23,42,.03)" }}>
      <div
        onClick={onToggle}
        style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12, cursor: "pointer", alignItems: "center", padding: 14 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ width: 40, height: 40, borderRadius: "50%", background: "linear-gradient(135deg,#0F1F44,#1E3A8A)", color: "#F5D27A", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 15 }}>
            {(u.full_name || u.email || "?").trim().charAt(0).toUpperCase()}
          </div>
          <div style={{ display: "grid", gap: 2 }}>
            <div style={{ fontWeight: 700, color: "#0F172A", fontSize: 14 }}>{u.full_name || "—"}</div>
            <div style={{ color: "#64748B", fontSize: 12 }}>{u.email}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            {(u.roles || []).length === 0 ? <span style={roleStyle("user")}>user</span> :
              (u.roles as string[]).map((r) => <span key={r} style={roleStyle(r)}>{r}</span>)}
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 999, fontSize: 11.5, fontWeight: 700, ...statusPill }}>
              ● {pending ? "بانتظار التفعيل" : u.is_active ? "نشط" : "معطل"}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ textAlign: "end", display: "grid", gap: 2 }}>
            <div style={{ fontSize: 11, color: "#64748B" }}>الصلاحيات الممنوحة</div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: grantedCount > 0 ? "#0F1F44" : "#94A3B8" }}>{grantedCount} / {totalPerms}</div>
          </div>
          <button style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "6px 10px", borderRadius: 8, border: "1px solid #E2E8F0", background: "#F8FAFC", color: "#0F172A", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            <UserCog size={13} /> {isOpen ? "إغلاق" : "تعديل الصلاحيات"} {isOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        </div>
      </div>
      {isOpen ? (
        <div onClick={(e) => e.stopPropagation()} style={{ padding: 14, borderTop: "1px solid #F1F5F9", background: "#F8FAFC" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 8, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#64748B", marginBottom: 4 }}>الدور</div>
              <input
                type="text"
                defaultValue={u.roles[0] ?? "user"}
                placeholder="admin / manager / accountant / operator"
                maxLength={40}
                dir="auto"
                onBlur={async (e) => {
                  const v = e.target.value.trim().slice(0, 40);
                  if (!v) { toast.error("الرجاء إدخال الدور"); e.target.value = u.roles[0] ?? "user"; return; }
                  if (v === (u.roles[0] ?? "user")) return;
                  e.target.value = v;
                  // Map any free-text role to a safe internal access level (DB enum: admin/manager/user).
                  const k = v.toLowerCase();
                  const accessLevel: "admin" | "manager" | "user" =
                    k === "admin" ? "admin" : k === "manager" ? "manager" : "user";
                  try {
                    await setRoleFn({ data: { user_id: u.id, role: accessLevel } });
                    if (accessLevel === k) {
                      toast.success("تم تحديث الدور");
                    } else {
                      toast.success(`تم الحفظ كـ "${accessLevel}" (مستوى الصلاحيات الداخلي)`);
                    }
                    onChanged();
                  } catch (err: any) {
                    toast.error(err?.message || "تعذّر تحديث الدور");
                    e.target.value = u.roles[0] ?? "user";
                  }
                }}
                style={{ ...inp, marginBottom: 0 }}
              />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#64748B", marginBottom: 4 }}>الوكيل المرتبط</div>
              <select defaultValue={u.agent_id ?? ""} onChange={async (e) => { await updFn({ data: { id: u.id, agent_id: e.target.value || null } }); toast.success("تم"); onChanged(); }} style={{ ...inp, marginBottom: 0 }}>
                <option value="">— بدون وكيل —</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {PERMISSION_KEYS.map((p) => {
              const cur = normalizePerm(u.permissions?.[p.key]);
              const allOn = ACTIONS.every((a) => cur[a.key]);
              const anyOn = ACTIONS.some((a) => cur[a.key]);
              return (
                <div key={p.key} style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10, padding: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8, flexWrap: "wrap" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <strong style={{ fontSize: 13, color: "#0F172A" }}>{p.label}</strong>
                      {anyOn && <span style={{ fontSize: 10.5, fontWeight: 700, color: "#1E3A8A", background: "#EEF2FF", padding: "1px 7px", borderRadius: 999, border: "1px solid #C7D2FE" }}>مفعّل</span>}
                    </div>
                    <label style={{ fontSize: 12, display: "inline-flex", gap: 6, alignItems: "center", cursor: "pointer", color: "#475569", fontWeight: 600 }}>
                      <input
                        type="checkbox"
                        checked={allOn}
                        onChange={(e) => {
                          const v = e.target.checked;
                          commit(p.key, { view: v, create: v, edit: v, delete: v, export: v });
                        }}
                      />
                      الكل
                    </label>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {ACTIONS.map((a) => (
                      <label key={a.key} style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 12, cursor: "pointer", color: "#334155", padding: "4px 10px", background: cur[a.key] ? "#EFF6FF" : "transparent", border: `1px solid ${cur[a.key] ? "#BFDBFE" : "#E2E8F0"}`, borderRadius: 8 }}>
                        <input
                          type="checkbox"
                          checked={!!cur[a.key]}
                          onChange={(e) => {
                            const next = { ...cur, [a.key]: e.target.checked };
                            if (a.key !== "view" && e.target.checked) next.view = true;
                            commit(p.key, next);
                          }}
                        />
                        {a.label}
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function GeneralTab() {
  const [settings, setSettings] = useState<Record<string, any>>({
    company_name: "", company_phone: "", currency: "EGP", company_logo: "", company_icon: "", favicon_url: "", favicon_updated_at: "",
    brand_primary: BRAND_NAVY, brand_secondary: BRAND_GOLD, brand_accent: BRAND_TEAL,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from("app_settings").select("*").then(({ data }) => {
      const s: Record<string, any> = {};
      data?.forEach((r: any) => { s[r.key] = r.value?.v ?? ""; });
      setSettings({
        company_name: "", company_phone: "", currency: "EGP", company_logo: "", company_icon: "", favicon_url: "", favicon_updated_at: "",
        brand_primary: BRAND_NAVY, brand_secondary: BRAND_GOLD, brand_accent: BRAND_TEAL,
        ...s,
      });
      setLoading(false);
    });
  }, []);

  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingIcon, setUploadingIcon] = useState(false);

  async function handleAssetUpload(file: File | null, field: "company_logo" | "favicon_url") {
    if (!file) return;
    const allowed = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/svg+xml"];
    if (!allowed.includes(file.type)) {
      toast.error("صيغة غير مدعومة. استخدم PNG / JPG / WEBP / SVG");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("حجم الملف يجب ألا يتجاوز 2MB");
      return;
    }
    const previous = settings[field];
    const previousCompanyIcon = settings.company_icon;
    const previousFaviconUpdatedAt = settings.favicon_updated_at;
    const setBusy = field === "company_logo" ? setUploadingLogo : setUploadingIcon;
    setBusy(true);
    try {
      let uploadBlob: Blob = file;
      let ext = "png";
      const maxDim = field === "favicon_url" ? 512 : 1024;
      if (file.type === "image/svg+xml") {
        ext = "svg";
      } else {
        const dataUrl = await processLogoFile(file, maxDim);
        const res = await fetch(dataUrl);
        uploadBlob = await res.blob();
        ext = "png";
      }
      const folder = field === "favicon_url" ? "icons" : "logos";
      const baseName = field === "favicon_url" ? "company-icon" : "company-logo";
      const path = `${folder}/${baseName}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("company-assets")
        .upload(path, uploadBlob, {
          contentType: file.type === "image/svg+xml" ? "image/svg+xml" : "image/png",
          upsert: true,
          cacheControl: field === "favicon_url" ? "0" : "3600",
        });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("company-assets").getPublicUrl(path);
      const url = pub.publicUrl;
      const faviconUpdatedAt = new Date().toISOString();
      setSettings((s) => ({
        ...s,
        [field]: url,
        ...(field === "favicon_url" ? { company_icon: url, favicon_updated_at: faviconUpdatedAt } : {}),
      }));
      if (field === "favicon_url") {
        const { error: saveIconErr } = await supabase.from("app_settings").upsert([
          { key: "favicon_url", value: { v: url }, updated_at: faviconUpdatedAt },
          { key: "company_icon", value: { v: url }, updated_at: faviconUpdatedAt },
          { key: "favicon_updated_at", value: { v: faviconUpdatedAt }, updated_at: faviconUpdatedAt },
        ], { onConflict: "key" });
        if (saveIconErr) throw saveIconErr;
        invalidateBranding();
        void loadBranding(true);
      }
      toast.success(field === "favicon_url" ? "تم تحديث أيقونة المتصفح بنجاح" : "تم الرفع. اضغط حفظ لاعتماده.");
    } catch (e: any) {
      console.error("Asset upload error:", e);
      setSettings((s) => ({
        ...s,
        [field]: previous,
        ...(field === "favicon_url" ? { company_icon: previousCompanyIcon, favicon_updated_at: previousFaviconUpdatedAt } : {}),
      }));
      toast.error("تعذر الرفع، برجاء المحاولة مرة أخرى");
    } finally {
      setBusy(false);
    }
  }

  const handleLogoFile = (file: File | null) => handleAssetUpload(file, "company_logo");
  const handleIconFile = (file: File | null) => handleAssetUpload(file, "favicon_url");

  async function save() {
    setSaving(true);
    const now = new Date().toISOString();
    const normalizedSettings = {
      ...settings,
      company_icon: settings.favicon_url || settings.company_icon || "",
      favicon_updated_at: settings.favicon_url ? (settings.favicon_updated_at || now) : "",
    };
    const rows = Object.entries(normalizedSettings).map(([key, v]) => ({ key, value: { v }, updated_at: key === "favicon_url" || key === "company_icon" || key === "favicon_updated_at" ? normalizedSettings.favicon_updated_at || now : now }));
    const { error } = await supabase.from("app_settings").upsert(rows, { onConflict: "key" });
    setSaving(false);
    if (error) { console.error("Settings save error:", error); toast.error("فشل الحفظ"); }
    else {
      invalidateBranding();
      const b = await loadBranding(true);
      applyBrandingCssVars(b);
      toast.success("تم الحفظ");
    }
  }

  const [baseline, setBaseline] = useState<string>("");
  useEffect(() => {
    if (!loading) setBaseline(JSON.stringify(settings));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);
  const dirty = !loading && JSON.stringify(settings) !== baseline;

  if (loading) {
    return (
      <div style={{ display: "grid", gap: 12 }}>
        {[0,1,2].map(i => (
          <div key={i} className="card" style={{ padding: 20, height: 140, background: "linear-gradient(90deg,#f8fafc,#f1f5f9,#f8fafc)", backgroundSize: "200% 100%", animation: "shimmer 1.4s infinite" }} />
        ))}
        <style>{`@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>
      </div>
    );
  }

  const currentLogo = settings.company_logo || "";
  const currentIcon = settings.favicon_url || settings.company_icon || "";
  const currentIconPreview = currentIcon ? withFaviconVersion(currentIcon, settings.favicon_updated_at || Date.now()) : "";

  const checker = "linear-gradient(45deg,#f1f5f9 25%,transparent 25%),linear-gradient(-45deg,#f1f5f9 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#f1f5f9 75%),linear-gradient(-45deg,transparent 75%,#f1f5f9 75%)";
  const checkerStyle: React.CSSProperties = { background: `${checker}, #fff`, backgroundSize: "16px 16px", backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px" };

  const SectionHeader = ({ icon, title, desc, accent = BRAND_NAVY }: { icon: React.ReactNode; title: string; desc: string; accent?: string }) => (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 12, paddingBottom: 14, marginBottom: 16, borderBottom: "1px solid #eef2f7" }}>
      <div style={{ width: 40, height: 40, borderRadius: 10, background: `linear-gradient(135deg, ${accent}, ${accent}dd)`, color: BRAND_GOLD, display: "grid", placeItems: "center", flexShrink: 0, boxShadow: `0 6px 16px ${accent}33` }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: BRAND_NAVY }}>{title}</h3>
        <div style={{ fontSize: 12, color: "#64748b", marginTop: 3 }}>{desc}</div>
      </div>
    </div>
  );

  const cardStyle: React.CSSProperties = { padding: 20, borderRadius: 14, border: "1px solid #eef2f7", background: "#fff", boxShadow: "0 1px 2px rgba(15,23,42,.04), 0 4px 14px rgba(15,23,42,.04)" };
  const fieldLabel: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 6 };
  const inpEnt: React.CSSProperties = { width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 14, background: "#fff", outline: "none", transition: "border-color .15s, box-shadow .15s" };

  const UploadCard = ({
    label, hint, current, isIcon, busy, onPick, onRemove, accept = "image/png,image/jpeg,image/webp,image/svg+xml",
  }: {
    label: string; hint: string; current: string; isIcon?: boolean; busy: boolean;
    onPick: (f: File | null) => void; onRemove: () => void; accept?: string;
  }) => {
    const previewSrc = isIcon ? currentIconPreview : current;
    const size = isIcon ? 84 : 110;
    return (
      <div style={{ border: "1px dashed #cbd5e1", borderRadius: 14, padding: 14, background: "#fafbfd", display: "flex", gap: 14, alignItems: "center" }}>
        <div style={{ width: size, height: size, borderRadius: 12, overflow: "hidden", border: "1px solid #e2e8f0", flexShrink: 0, display: "grid", placeItems: "center", ...checkerStyle }}>
          {current ? (
            <img src={previewSrc} alt={label} style={{ width: "100%", height: "100%", objectFit: "contain", padding: 6 }} />
          ) : (
            <ImageIcon size={28} color="#94a3b8" />
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a" }}>{label}</div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 4, lineHeight: 1.5 }}>{hint}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 12px", borderRadius: 9, background: `linear-gradient(135deg, ${BRAND_NAVY}, #1e3a8a)`, color: "#fff", fontSize: 12, fontWeight: 700, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? .6 : 1 }}>
              <Upload size={14} />
              {busy ? "جارِ الرفع..." : (current ? "استبدال" : "رفع ملف")}
              <input type="file" accept={accept} disabled={busy} style={{ display: "none" }} onChange={(e) => onPick(e.target.files?.[0] || null)} />
            </label>
            {current && (
              <button type="button" onClick={onRemove} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 12px", borderRadius: 9, background: "#fff", border: "1px solid #fecaca", color: "#b91c1c", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                <Trash size={14} /> إزالة
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  const ColorBlock = ({ label, k, hint }: { label: string; k: string; hint?: string }) => (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 12, background: "#fff" }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 8 }}>{label}</div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <div style={{ position: "relative", width: 44, height: 36, borderRadius: 9, border: "1px solid #e2e8f0", overflow: "hidden", background: settings[k] || "#000" }}>
          <input type="color" value={settings[k] || "#000000"} onChange={(e) => setSettings({ ...settings, [k]: e.target.value })} style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%", height: "100%" }} />
        </div>
        <input style={{ ...inpEnt, fontFamily: "ui-monospace,monospace", textTransform: "uppercase", padding: "8px 10px" }} value={settings[k] || ""} onChange={(e) => setSettings({ ...settings, [k]: e.target.value })} placeholder="#000000" />
      </div>
      {hint && <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 6 }}>{hint}</div>}
    </div>
  );

  const primary = settings.brand_primary || BRAND_NAVY;
  const secondary = settings.brand_secondary || BRAND_GOLD;
  const accent = settings.brand_accent || BRAND_TEAL;

  return (
    <div style={{ display: "grid", gap: 16, paddingBottom: 80 }}>
      {/* Branding identity */}
      <div style={cardStyle}>
        <SectionHeader icon={<Sparkles size={20} />} title="الهوية البصرية للشركة" desc="ارفع شعار الشركة. الصور تتحسّن تلقائيًا قبل الرفع." />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 12 }}>
          <UploadCard label="شعار الشركة" hint="PNG شفاف يُفضّل (1024×1024). PNG / JPG / WEBP / SVG حتى 2MB." current={currentLogo} busy={uploadingLogo} onPick={handleLogoFile} onRemove={() => setSettings((s) => ({ ...s, company_logo: "" }))} />
        </div>
      </div>

      {/* Company info */}
      <div style={cardStyle}>
        <SectionHeader icon={<Building2 size={20} />} title="بيانات الشركة" desc="المعلومات الأساسية تظهر في الفواتير والتقارير وكشوف الحسابات." />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 14 }}>
          <div>
            <label style={fieldLabel}><Building2 size={12} style={{ display: "inline", marginLeft: 4, verticalAlign: "-1px" }} /> اسم الشركة</label>
            <input style={inpEnt} value={settings.company_name} onChange={(e) => setSettings({ ...settings, company_name: e.target.value })} placeholder="مثال: العربي للسياحة" />
            <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>يظهر في رأس الفواتير والمستندات.</div>
          </div>
          <div>
            <label style={fieldLabel}><Phone size={12} style={{ display: "inline", marginLeft: 4, verticalAlign: "-1px" }} /> هاتف الشركة</label>
            <input style={inpEnt} value={settings.company_phone} onChange={(e) => setSettings({ ...settings, company_phone: e.target.value })} placeholder="+20 ..." />
            <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>يُستخدم في معلومات التواصل بالكشوف.</div>
          </div>
          <div>
            <label style={fieldLabel}><DollarSign size={12} style={{ display: "inline", marginLeft: 4, verticalAlign: "-1px" }} /> العملة</label>
            <input style={inpEnt} value={settings.currency} onChange={(e) => setSettings({ ...settings, currency: e.target.value })} placeholder="EGP" />
            <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>عملة العرض الافتراضية في كل المعاملات.</div>
          </div>
        </div>
      </div>

      {/* Brand colors */}
      <div style={cardStyle}>
        <SectionHeader icon={<Palette size={20} />} title="ألوان الهوية" desc="حدّد ألوان النظام الأساسية وعاين تأثيرها فورًا." />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12 }}>
          <ColorBlock label="اللون الأساسي (Primary)" k="brand_primary" hint="افتراضي: Navy" />
          <ColorBlock label="اللون الثانوي (Secondary)" k="brand_secondary" hint="افتراضي: Gold" />
          <ColorBlock label="اللون المميز (Accent)" k="brand_accent" hint="افتراضي: Teal" />
        </div>
        <div style={{ marginTop: 16, padding: 14, borderRadius: 12, border: "1px solid #eef2f7", background: "#fafbfd" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", marginBottom: 10 }}>معاينة مباشرة</div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ padding: "10px 16px", borderRadius: 10, background: `linear-gradient(135deg, ${primary}, ${primary}dd)`, color: secondary, fontWeight: 800, fontSize: 13, boxShadow: `0 6px 16px ${primary}33` }}>زر أساسي</div>
            <div style={{ padding: "6px 12px", borderRadius: 999, background: `${secondary}22`, color: primary, fontWeight: 700, fontSize: 12, border: `1px solid ${secondary}66` }}>شارة</div>
            <div style={{ padding: "6px 12px", borderRadius: 999, background: `${accent}1a`, color: accent, fontWeight: 700, fontSize: 12, border: `1px solid ${accent}44` }}>مميّز</div>
            <div style={{ flex: 1, minWidth: 200, padding: "10px 14px", borderRadius: 10, background: `linear-gradient(135deg, ${primary}, ${accent})`, color: "#fff", fontWeight: 800, fontSize: 13 }}>عنوان رأسي</div>
          </div>
        </div>
      </div>

      {/* Dropdown management */}
      <div style={cardStyle}>
        <SectionHeader icon={<ListChecks size={20} />} title="إعدادات القوائم المنسدلة" desc="إدارة القيم المتاحة في الحقول المنسدلة عبر النظام." />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 12 }}>
          <DropdownListManager category="authority" title="الجهات" icon={<Building2 size={16} />} />
          <DropdownListManager category="destination" title="الوجهات" icon={<MapPin size={16} />} />
          <DropdownListManager category="airline" title="شركات الطيران" icon={<Plane size={16} />} />
          <DropdownListManager category="service_type" title="أنواع الخدمة" icon={<Wrench size={16} />} />
        </div>
      </div>

      {/* Sticky save bar */}
      <div style={{ position: "sticky", bottom: 12, display: "flex", justifyContent: "flex-end", gap: 10, alignItems: "center", padding: 12, borderRadius: 14, background: "rgba(255,255,255,.92)", backdropFilter: "blur(8px)", border: "1px solid #e2e8f0", boxShadow: "0 8px 24px rgba(15,23,42,.08)" }}>
        {dirty ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "#b45309", background: "#fef3c7", padding: "6px 12px", borderRadius: 999, border: "1px solid #fde68a" }}>
            <AlertCircle size={14} /> هناك تغييرات غير محفوظة
          </span>
        ) : (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "#166534", background: "#dcfce7", padding: "6px 12px", borderRadius: 999, border: "1px solid #bbf7d0" }}>
            <Check size={14} /> كل التغييرات محفوظة
          </span>
        )}
        <button onClick={save} disabled={saving || !dirty} style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 22px", borderRadius: 10, background: (saving || !dirty) ? "#94a3b8" : `linear-gradient(135deg, ${BRAND_NAVY}, #1e3a8a)`, color: BRAND_GOLD, border: 0, fontWeight: 800, fontSize: 14, cursor: (saving || !dirty) ? "not-allowed" : "pointer", boxShadow: (saving || !dirty) ? "none" : `0 8px 20px ${BRAND_NAVY}55` }}>
          <Save size={16} /> {saving ? "جارِ الحفظ..." : "حفظ التغييرات"}
        </button>
      </div>
    </div>
  );
}

function DropdownListManager({ category, title, icon }: { category: DropdownCategory; title: string; icon?: React.ReactNode }) {
  const [items, setItems] = useState<{ id: string; value: string; is_active: boolean }[]>([]);
  const [newValue, setNewValue] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const safeItems = useMemo(() => {
    const seen = new Set<string>();
    return items
      .map((it) => ({ ...it, value: normalizeDropdownValue(it.value) }))
      .filter((it) => {
        if (!it.value || seen.has(it.value)) return false;
        seen.add(it.value);
        return true;
      });
  }, [items]);

  const load = async () => {
    if (!VALID_DROPDOWN_CATEGORIES.includes(category)) return setItems([]);
    const { data, error } = await supabase
      .from("system_dropdown_options")
      .select("id,value,is_active")
      .eq("category", category)
      .order("value", { ascending: true });
    if (error) {
      console.error("[DropdownListManager]", error);
      toast.error("تعذر تحميل القائمة");
      return setItems([]);
    }
    setItems(Array.isArray(data) ? (data as any) : []);
  };

  useEffect(() => {
    load();
    const channelName = `settings-dropdown-${category}-${Math.random().toString(36).slice(2)}`;
    const ch = supabase
      .channel(channelName)
      .on("postgres_changes", { event: "*", schema: "public", table: "system_dropdown_options", filter: `category=eq.${category}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  async function add() {
    const v = normalizeDropdownValue(newValue);
    if (!v) return toast.error("لا يمكن إضافة قيمة فارغة");
    if (safeItems.some((it) => it.value === v)) return toast.error("هذه القيمة موجودة بالفعل");
    const { error } = await supabase.from("system_dropdown_options").insert({ category, value: v, is_active: true });
    if (error) return toast.error(error.message);
    setNewValue("");
    toast.success("تمت الإضافة");
  }

  async function saveEdit(id: string) {
    const v = normalizeDropdownValue(editingValue);
    if (!v) return toast.error("لا يمكن حفظ قيمة فارغة");
    if (safeItems.some((it) => it.id !== id && it.value === v)) return toast.error("هذه القيمة موجودة بالفعل");
    const { error } = await supabase.from("system_dropdown_options").update({ value: v }).eq("id", id);
    if (error) return toast.error(error.message);
    setEditingId(null);
    toast.success("تم التحديث");
  }

  async function toggleActive(id: string, is_active: boolean) {
    const { error } = await supabase.from("system_dropdown_options").update({ is_active: !is_active }).eq("id", id);
    if (error) return toast.error(error.message);
  }

  const [confirmDel, setConfirmDel] = useState<{ id: string; value: string } | null>(null);
  async function del(id: string) {
    const { error } = await supabase.from("system_dropdown_options").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("تم الحذف");
  }

  const activeCount = safeItems.filter(i => i.is_active).length;

  return (
    <div style={{ borderRadius: 12, border: "1px solid #eef2f7", background: "#fff", overflow: "hidden" }}>
      <div style={{ padding: "12px 14px", borderBottom: "1px solid #eef2f7", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, background: "linear-gradient(180deg,#fafbfd,#fff)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: `${BRAND_NAVY}10`, color: BRAND_NAVY, display: "grid", placeItems: "center", flexShrink: 0 }}>{icon}</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a" }}>{title}</div>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>إدارة قيم القائمة المنسدلة</div>
          </div>
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, color: BRAND_NAVY, background: `${BRAND_GOLD}22`, border: `1px solid ${BRAND_GOLD}66`, padding: "3px 9px", borderRadius: 999 }}>
          {activeCount} / {safeItems.length}
        </span>
      </div>
      <div style={{ padding: 12 }}>
        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          <input
            style={{ flex: 1, padding: "9px 11px", borderRadius: 9, border: "1px solid #e2e8f0", fontSize: 13, outline: "none", background: "#fff" }}
            placeholder="إضافة عنصر جديد..."
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") add(); }}
          />
          <button onClick={add} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "9px 14px", borderRadius: 9, background: `linear-gradient(135deg, ${BRAND_NAVY}, #1e3a8a)`, color: "#fff", border: 0, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
            <Plus size={14} /> إضافة
          </button>
        </div>
        <div style={{ display: "grid", gap: 6, maxHeight: 320, overflow: "auto" }}>
          {safeItems.length === 0 && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 28, color: "#94a3b8", background: "#fafbfd", borderRadius: 10, border: "1px dashed #e2e8f0" }}>
              <Inbox size={28} />
              <div style={{ fontSize: 13, marginTop: 8, fontWeight: 600 }}>لا توجد عناصر مضافة بعد</div>
            </div>
          )}
          {safeItems.map((it) => (
            <div key={it.id} style={{ display: "flex", gap: 6, alignItems: "center", background: "#f8fafc", borderRadius: 9, padding: "7px 10px", border: "1px solid #eef2f7" }}>
              {editingId === it.id ? (
                <>
                  <input autoFocus style={{ flex: 1, padding: "7px 9px", borderRadius: 7, border: "1px solid #cbd5e1", fontSize: 13 }} value={editingValue} onChange={(e) => setEditingValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveEdit(it.id); if (e.key === "Escape") setEditingId(null); }} />
                  <button onClick={() => saveEdit(it.id)} title="حفظ" style={{ width: 30, height: 30, borderRadius: 7, background: "#dcfce7", color: "#166534", border: "1px solid #bbf7d0", display: "grid", placeItems: "center", cursor: "pointer" }}><Check size={14} /></button>
                  <button onClick={() => setEditingId(null)} title="إلغاء" style={{ width: 30, height: 30, borderRadius: 7, background: "#fff", color: "#475569", border: "1px solid #e2e8f0", display: "grid", placeItems: "center", cursor: "pointer" }}><XIcon size={14} /></button>
                </>
              ) : (
                <>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: it.is_active ? "#0f172a" : "#94a3b8", textDecoration: it.is_active ? "none" : "line-through" }}>{it.value}</span>
                  <button onClick={() => toggleActive(it.id, it.is_active)} title={it.is_active ? "تعطيل" : "تفعيل"} style={{ position: "relative", width: 36, height: 20, borderRadius: 999, border: 0, cursor: "pointer", background: it.is_active ? BRAND_NAVY : "#cbd5e1", transition: "background .15s" }}>
                    <span style={{ position: "absolute", top: 2, [it.is_active ? "right" : "left"]: 2, width: 16, height: 16, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.2)", transition: "all .15s" } as React.CSSProperties} />
                  </button>
                  <button onClick={() => { setEditingId(it.id); setEditingValue(it.value); }} title="تعديل" style={{ width: 30, height: 30, borderRadius: 7, background: "#fff", color: BRAND_NAVY, border: "1px solid #e2e8f0", display: "grid", placeItems: "center", cursor: "pointer" }}><Pencil size={13} /></button>
                  <button onClick={() => setConfirmDel({ id: it.id, value: it.value })} title="حذف" style={{ width: 30, height: 30, borderRadius: 7, background: "#fff", color: "#b91c1c", border: "1px solid #fecaca", display: "grid", placeItems: "center", cursor: "pointer" }}><Trash2 size={13} /></button>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
      {confirmDel && (
        <ConfirmModal
          title="حذف العنصر"
          message={`هل أنت متأكد من حذف "${confirmDel.value}"؟ لا يمكن التراجع عن هذه العملية.`}
          confirmLabel="حذف"
          danger
          onConfirm={() => { const id = confirmDel.id; setConfirmDel(null); del(id); }}
          onCancel={() => setConfirmDel(null)}
        />
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: "block", fontSize: 13, marginBottom: 4, color: "#374151" }}>{label}</label>
      {children}
    </div>
  );
}

function ConfirmModal({ title, message, confirmLabel, danger, onConfirm, onCancel }: {
  title: string; message: string; confirmLabel: string; danger?: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div dir="rtl" onClick={onCancel} style={{
      position: "fixed", inset: 0, background: "rgba(15,23,42,.5)",
      display: "grid", placeItems: "center", zIndex: 1000, padding: 16,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "#fff", borderRadius: 16, padding: 24, maxWidth: 420, width: "100%",
        boxShadow: "0 20px 60px rgba(0,0,0,.25)",
      }}>
        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{title}</h3>
        <p style={{ marginTop: 10, color: "#374151", fontSize: 14, whiteSpace: "pre-line" }}>{message}</p>
        <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
          <button onClick={onConfirm} style={{
            padding: "10px 18px", borderRadius: 8, border: 0, fontWeight: 700, cursor: "pointer",
            background: danger ? "#dc2626" : "#0F1F44", color: danger ? "#fff" : "#F5D27A",
          }}>{confirmLabel}</button>
          <button onClick={onCancel} style={{
            padding: "10px 18px", borderRadius: 8, border: "1px solid #e5e7eb", fontWeight: 600,
            cursor: "pointer", background: "#fff", color: "#111",
          }}>إلغاء</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function DevToolsTab() {
  const checkFn = useServerFn(checkDemoData);
  const genFn = useServerFn(generateDemoData);
  const delFn = useServerFn(deleteDemoData);
  const qc = useQueryClient();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["demo-data-counts"],
    queryFn: () => checkFn(),
  });
  const [busy, setBusy] = useState<null | "gen" | "del">(null);
  const [confirm, setConfirm] = useState<null | "gen" | "del" | "warn">(null);
  const [summary, setSummary] = useState<Record<string, number> | null>(null);
  const [summaryTitle, setSummaryTitle] = useState("");

  const total = data?.total ?? 0;

  async function doGenerate() {
    setBusy("gen");
    try {
      const res = await genFn();
      setSummary(res.summary);
      setSummaryTitle("تم توليد الداتا التجريبية بنجاح");
      toast.success("تم توليد الداتا التجريبية");
      qc.invalidateQueries();
      refetch();
    } catch (e: any) {
      toast.error(e?.message || "فشل التوليد");
    } finally {
      setBusy(null);
    }
  }
  async function doDelete() {
    setBusy("del");
    try {
      const res = await delFn();
      setSummary(res.summary);
      setSummaryTitle("تم حذف الداتا التجريبية");
      toast.success("تم حذف الداتا التجريبية");
      qc.invalidateQueries();
      refetch();
    } catch (e: any) {
      toast.error(e?.message || "فشل الحذف");
    } finally {
      setBusy(null);
    }
  }

  const labels: Record<string, string> = {
    agents: "الوكلاء",
    issuing_companies: "الشركات المصدرة",
    merchants: "التجار",
    investors: "المستثمرين",
    flights: "الرحلات",
    approvals: "الموافقات الأمنية",
    transactions: "المعاملات/المدفوعات",
    company_transactions: "معاملات الشركات",
    merchant_cash_collections: "تحصيلات التجار",
    investor_transactions: "حركات المستثمرين",
    expenses: "المصروفات",
    expense_deductions: "خصومات المصروفات",
  };

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ padding: "14px 16px", borderBottom: "1px solid #E5E7EB", display: "flex", alignItems: "center", gap: 10 }}>
        <Wrench size={18} color="#0F1F44" />
        <div style={{ fontSize: 16, fontWeight: 800, color: "#0F1F44" }}>أدوات التطوير</div>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#92400E", background: "#FEF3C7", border: "1px solid #FDE68A", padding: "2px 8px", borderRadius: 999 }}>
          DEV ONLY
        </span>
      </div>

      <div style={{ padding: 20, display: "grid", gap: 20 }}>
        <div style={{ display: "flex", gap: 12, padding: 14, background: "#F8FAFC", border: "1px solid #E5E7EB", borderRadius: 12, alignItems: "flex-start" }}>
          <AlertTriangle size={18} color="#D97706" style={{ marginTop: 2, flexShrink: 0 }} />
          <div style={{ fontSize: 13, color: "#475569", lineHeight: 1.7 }}>
            هذه الأداة تنشئ بيانات تجريبية واقعية لاختبار النظام. كل السجلات الناتجة موسومة بـ <code>is_demo = true</code> ولا تمس البيانات الحقيقية. يظهر هذا القسم في وضع التطوير فقط ولن يظهر للمستخدمين في الإنتاج.
          </div>
        </div>

        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#0F1F44", marginBottom: 10 }}>الداتا التجريبية الحالية</div>
          {isLoading ? (
            <div style={{ color: "#94A3B8", fontSize: 13 }}>جارٍ التحميل...</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8 }}>
              {Object.entries(data?.counts ?? {}).map(([k, v]) => (
                <div key={k} style={{ padding: "10px 12px", background: v ? "#FEF3C7" : "#F8FAFC", border: `1px solid ${v ? "#FDE68A" : "#E5E7EB"}`, borderRadius: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "#475569" }}>{labels[k] || k}</span>
                  <span style={{ fontSize: 14, fontWeight: 800, color: v ? "#92400E" : "#94A3B8" }}>{v}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", paddingTop: 8, borderTop: "1px solid #F1F5F9" }}>
          <button
            onClick={() => setConfirm(total > 0 ? "warn" : "gen")}
            disabled={!!busy}
            className="btn btn-gold"
            style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 22px", fontWeight: 800, color: "#1a1a1a" }}
          >
            <Database size={16} color="#fff" />
            <span>{busy === "gen" ? "جارٍ التوليد..." : "توليد داتا جاهزة"}</span>
          </button>
          <button
            onClick={() => setConfirm("del")}
            disabled={!!busy || total === 0}
            style={{
              display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 22px", borderRadius: 10,
              background: total === 0 ? "#F1F5F9" : "#FEE2E2", color: total === 0 ? "#94A3B8" : "#991B1B",
              border: `1px solid ${total === 0 ? "#E5E7EB" : "#FECACA"}`, fontWeight: 700, fontSize: 14,
              cursor: !!busy || total === 0 ? "not-allowed" : "pointer",
            }}
          >
            <Trash2 size={16} />
            <span>{busy === "del" ? "جارٍ الحذف..." : `حذف الداتا التجريبية (${total})`}</span>
          </button>
        </div>
      </div>

      {confirm === "warn" && (
        <ConfirmModal
          title="يوجد داتا تجريبية بالفعل"
          message={`يوجد حاليًا ${total} سجل تجريبي. هل تريد إضافة المزيد فوقها؟`}
          confirmLabel="نعم، أضف المزيد"
          onCancel={() => setConfirm(null)}
          onConfirm={() => { setConfirm("gen"); }}
        />
      )}
      {confirm === "gen" && (
        <ConfirmModal
          title="توليد داتا تجريبية"
          message="⚠️ هذه نسخة تطوير — البيانات تجريبية. سيتم إنشاء بيانات تجريبية واقعية في الجداول التشغيلية لقاعدة بيانات التطوير فقط. لن يتم المساس بقاعدة بيانات الإنتاج. هل تريد المتابعة؟"
          confirmLabel="ابدأ التوليد"
          onCancel={() => setConfirm(null)}
          onConfirm={async () => { setConfirm(null); await doGenerate(); }}
        />
      )}
      {confirm === "del" && (
        <ConfirmModal
          title="حذف الداتا التجريبية"
          message={`سيتم حذف ${total} سجل تجريبي فقط (الموسومة بـ is_demo = true). البيانات الحقيقية لن تتأثر إطلاقًا.`}
          confirmLabel="حذف نهائي"
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={async () => { setConfirm(null); await doDelete(); }}
        />
      )}

      {summary && typeof document !== "undefined" && createPortal(
        <div dir="rtl" onClick={() => setSummary(null)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.5)", display: "grid", placeItems: "center", zIndex: 1000, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 24, maxWidth: 480, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,.25)" }}>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#0F1F44", display: "flex", alignItems: "center", gap: 8 }}>
              <Check size={20} color="#16A34A" /> {summaryTitle}
            </h3>
            <div style={{ marginTop: 14, display: "grid", gap: 6 }}>
              {Object.entries(summary).map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: "#F8FAFC", borderRadius: 8, fontSize: 13 }}>
                  <span style={{ color: "#475569" }}>{labels[k] || k}</span>
                  <span style={{ fontWeight: 800, color: "#0F1F44" }}>{v}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 18, display: "flex", justifyContent: "flex-end" }}>
              <button onClick={() => setSummary(null)} style={{ padding: "10px 22px", borderRadius: 10, background: "#0F1F44", color: "#F5D27A", border: 0, fontWeight: 700, cursor: "pointer" }}>
                تم
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}


const inp: React.CSSProperties = { width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14 };
const th: React.CSSProperties = { padding: 10, textAlign: "right", fontSize: 13, borderBottom: "1px solid #e5e7eb" };
const td: React.CSSProperties = { padding: 10, fontSize: 13, borderBottom: "1px solid #f3f4f6" };
const btnPrimary: React.CSSProperties = { padding: "10px 18px", borderRadius: 8, background: "#2563eb", color: "#fff", border: 0, fontWeight: 700, cursor: "pointer" };
const btnDanger: React.CSSProperties = { padding: "6px 12px", borderRadius: 6, background: "#ef4444", color: "#fff", border: 0, cursor: "pointer", fontSize: 12 };
const btnSm: React.CSSProperties = { padding: "6px 12px", borderRadius: 6, background: "#f3f4f6", color: "#111", border: "1px solid #e5e7eb", cursor: "pointer", fontSize: 12 };

function fmtBytes(n: number) {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${u[i]}`;
}

function relTimeAr(input?: string | Date | null): string {
  if (!input) return "—";
  const d = typeof input === "string" ? new Date(input) : input;
  const diff = Date.now() - d.getTime();
  if (isNaN(diff)) return "—";
  const sec = Math.round(diff / 1000);
  if (sec < 45) return "الآن";
  const min = Math.round(sec / 60);
  if (min < 2) return "منذ دقيقة";
  if (min < 60) return `منذ ${min} دقيقة`;
  const hr = Math.round(min / 60);
  if (hr < 2) return "منذ ساعة";
  if (hr < 24) return `منذ ${hr} ساعات`;
  const day = Math.round(hr / 24);
  if (day === 1) return "أمس";
  if (day < 30) return `منذ ${day} أيام`;
  const mo = Math.round(day / 30);
  if (mo < 12) return `منذ ${mo} شهر`;
  return `منذ ${Math.round(mo / 12)} سنة`;
}

function fullDateAr(input?: string | Date | null): string {
  if (!input) return "—";
  const d = typeof input === "string" ? new Date(input) : input;
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" });
}

function nextSchedules() {
  const now = new Date();
  // Next daily 02:00
  const daily = new Date(now);
  daily.setHours(2, 0, 0, 0);
  if (daily <= now) daily.setDate(daily.getDate() + 1);
  // Next weekly: Sunday 02:00
  const weekly = new Date(now);
  weekly.setHours(2, 0, 0, 0);
  const dow = weekly.getDay(); // 0 = Sunday
  let addDays = (7 - dow) % 7;
  if (addDays === 0 && weekly <= now) addDays = 7;
  weekly.setDate(weekly.getDate() + addDays);
  // Next monthly: first day of next month 02:00
  const monthly = new Date(now.getFullYear(), now.getMonth() + 1, 1, 2, 0, 0, 0);
  return { daily, weekly, monthly };
}

function BackupsTab() {
  const listFn = useServerFn(listBackups);
  const createFn = useServerFn(createBackup);
  const dlFn = useServerFn(downloadBackup);
  const delFn = useServerFn(deleteBackup);
  const restoreFn = useServerFn(restoreBackup);
  const previewFn = useServerFn(previewBackup);
  const retentionFn = useServerFn(runRetentionNow);
  const qc = useQueryClient();
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["backups-list"],
    queryFn: () => listFn(),
  });
  const [busy, setBusy] = useState<string>("");
  const [confirm, setConfirm] = useState<null | { title: string; message: string; danger?: boolean; onOk: () => Promise<void> | void }>(null);
  const [restoreTarget, setRestoreTarget] = useState<null | { path: string; type: string; size: number; created_at?: string }>(null);
  const [preview, setPreview] = useState<null | { meta: any; file: any; log?: any; lastRestore?: any; createdByName?: string }>(null);
  const [archiveQuery, setArchiveQuery] = useState("");
  const [archiveType, setArchiveType] = useState<string>("all");
  const [archiveStatus, setArchiveStatus] = useState<string>("all");
  const [archivePage, setArchivePage] = useState(1);
  const ARCHIVE_PAGE_SIZE = 8;

  // Fetch profile names for created_by IDs (admin can read profiles)
  const userIds = useMemo(() => {
    const set = new Set<string>();
    (data?.logs ?? []).forEach((l: any) => { if (l.created_by) set.add(l.created_by); if (l.restored_by) set.add(l.restored_by); });
    return Array.from(set);
  }, [data?.logs]);

  const { data: nameMap } = useQuery({
    queryKey: ["backup-user-names", userIds.sort().join(",")],
    enabled: userIds.length > 0,
    queryFn: async () => {
      const { data: rows } = await supabase.from("profiles").select("id,full_name,email").in("id", userIds);
      const map: Record<string, string> = {};
      (rows ?? []).forEach((r: any) => { map[r.id] = r.full_name || r.email || r.id.slice(0, 8); });
      return map;
    },
  });

  const userName = (id?: string | null) => {
    if (!id) return "النظام";
    return nameMap?.[id] || (id.slice(0, 8) + "…");
  };

  const refresh = () => qc.invalidateQueries({ queryKey: ["backups-list"] });

  const onCreate = async () => {
    try {
      setBusy("create");
      await createFn({ data: { type: "manual" } });
      toast.success("تم إنشاء النسخة الاحتياطية");
      refresh();
    } catch (e: any) {
      toast.error(e?.message || "فشل إنشاء النسخة");
    } finally { setBusy(""); }
  };

  const onDownload = async (path: string) => {
    try {
      setBusy(path);
      const r = await dlFn({ data: { path } });
      window.open(r.url, "_blank");
    } catch (e: any) {
      toast.error(e?.message || "تعذر التنزيل");
    } finally { setBusy(""); }
  };

  const onDelete = (path: string) => {
    setConfirm({
      title: "حذف النسخة",
      message: "سيتم حذف:\n" + path + "\nهل أنت متأكد؟",
      danger: true,
      onOk: async () => {
        try {
          setBusy(path);
          await delFn({ data: { path } });
          toast.success("تم الحذف");
          refresh();
        } catch (e: any) { toast.error(e?.message || "تعذر الحذف"); }
        finally { setBusy(""); setConfirm(null); }
      },
    });
  };

  const onPreview = async (b: any) => {
    try {
      setBusy(b.path);
      const r = await previewFn({ data: { path: b.path } });
      const logs = (data?.logs ?? []) as any[];
      const matchLog = logs.find((l) => l.file_path === b.path && l.backup_type !== "restore");
      const lastRestore = logs
        .filter((l) => l.backup_type === "restore" && l.file_path === b.path && l.restore_date)
        .sort((a, b) => (b.restore_date ?? "").localeCompare(a.restore_date ?? ""))[0];
      setPreview({ meta: r.meta, file: b, log: matchLog, lastRestore, createdByName: userName(matchLog?.created_by) });
    } catch (e: any) { toast.error(e?.message || "تعذر القراءة"); }
    finally { setBusy(""); }
  };

  const onRestore = (b: { path: string; type: string; size: number; created_at?: string }) => {
    setRestoreTarget(b);
  };

  const doRestore = async () => {
    if (!restoreTarget) return;
    const path = restoreTarget.path;
    try {
      setBusy(path);
      const r = await restoreFn({ data: { path, confirm: true } });
      const failed = Object.entries(r.summary).filter(([, v]: any) => v.error);
      if (failed.length === 0) toast.success("تمت الاستعادة بنجاح");
      else toast.error("اكتملت بأخطاء: " + failed.length + " جدول");
      refresh();
    } catch (e: any) { toast.error(e?.message || "فشلت الاستعادة"); }
    finally { setBusy(""); setRestoreTarget(null); }
  };

  const onRetention = async () => {
    try {
      setBusy("retention");
      const r = await retentionFn();
      toast.success("تم تطبيق سياسة الاحتفاظ — حُذف " + r.deleted);
      refresh();
    } catch (e: any) { toast.error(e?.message || "فشل التنظيف"); }
    finally { setBusy(""); }
  };

  // ---- Aggregates for KPI overview ----
  const allBackups = data?.backups ?? [];
  const allLogs = data?.logs ?? [];
  const totalCount = allBackups.length;
  const totalSize = allBackups.reduce((s: number, b: any) => s + (b.size || 0), 0);
  const latestSuccessLog = allLogs.find((l: any) => l.status === "success" && l.backup_type !== "restore");
  const latestFailLog = allLogs.find((l: any) => l.status === "failed");
  const systemHealthy = !!latestSuccessLog && (!latestFailLog || latestFailLog.created_at <= latestSuccessLog.created_at);

  const NAVY = BRAND_NAVY, GOLD = BRAND_GOLD;

  const cardBase: React.CSSProperties = {
    padding: 18, borderRadius: 14, border: "1px solid #eef2f7", background: "#fff",
    boxShadow: "0 1px 2px rgba(15,23,42,.04), 0 4px 14px rgba(15,23,42,.04)",
  };

  const Kpi = ({ icon, label, value, sub, tone = "neutral" }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "success" | "danger" | "warn" | "info" | "neutral" }) => {
    const tones: Record<string, { bg: string; fg: string; border: string }> = {
      success: { bg: "#ecfdf5", fg: "#047857", border: "#a7f3d0" },
      danger:  { bg: "#fef2f2", fg: "#b91c1c", border: "#fecaca" },
      warn:    { bg: "#fffbeb", fg: "#b45309", border: "#fde68a" },
      info:    { bg: "#eff6ff", fg: "#1d4ed8", border: "#bfdbfe" },
      neutral: { bg: "#f1f5f9", fg: NAVY, border: "#e2e8f0" },
    };
    const t = tones[tone];
    return (
      <div className="bk-card" style={{ ...cardBase, padding: 14, display: "flex", gap: 12, alignItems: "center", minHeight: 88 }}>
        <div style={{ width: 42, height: 42, borderRadius: 10, background: t.bg, color: t.fg, border: `1px solid ${t.border}`, display: "grid", placeItems: "center", flexShrink: 0 }}>{icon}</div>
        <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700, marginBottom: 3, textTransform: "none", letterSpacing: 0 }}>{label}</div>
          <div style={{ fontSize: 16, color: "#0f172a", fontWeight: 800, lineHeight: 1.2, wordBreak: "break-word" }}>{value}</div>
          {sub && <div style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>}
        </div>
      </div>
    );
  };

  const Crumb = () => (
    <nav aria-label="breadcrumb" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "#64748b", marginBottom: 10, flexWrap: "wrap" }}>
      <span>النظام</span>
      <ChevronLeft size={12} />
      <span>الإعدادات</span>
      <ChevronLeft size={12} />
      <span style={{ color: NAVY, fontWeight: 700 }}>النسخ الاحتياطي</span>
    </nav>
  );

  const typeBadge = (t: string) => {
    const c = typeColor(t);
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: c.bg, color: c.fg, border: `1px solid ${c.border}` }}>
        {TYPE_LABELS_AR[t] ?? t}
      </span>
    );
  };
  const statusPill = (s: string) => {
    const ok = s === "success", fail = s === "failed";
    const bg = ok ? "#dcfce7" : fail ? "#fee2e2" : "#fef3c7";
    const fg = ok ? "#166534" : fail ? "#991b1b" : "#92400e";
    const bd = ok ? "#bbf7d0" : fail ? "#fecaca" : "#fde68a";
    const Icon = ok ? Check : fail ? XCircle : Clock;
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: bg, color: fg, border: `1px solid ${bd}` }}>
        <Icon size={11} /> {ok ? "ناجحة" : fail ? "فاشلة" : s}
      </span>
    );
  };

  const iconBtn = (color: string, border: string): React.CSSProperties => ({
    width: 32, height: 32, borderRadius: 8, background: "#fff", color, border: `1px solid ${border}`,
    display: "grid", placeItems: "center", cursor: "pointer", transition: "all .15s",
  });

  return (
    <div className="bk-root" style={{ display: "grid", gap: 12 }}>
      <style>{`
        .bk-card{transition:transform .2s ease, box-shadow .25s ease, border-color .2s ease;}
        .bk-card:hover{transform:translateY(-2px); box-shadow:0 6px 22px rgba(15,23,42,.08), 0 2px 6px rgba(15,23,42,.05); border-color:#dbe3ee;}
        .bk-btn{transition:transform .15s ease, box-shadow .2s ease, background .2s ease, border-color .2s ease;}
        .bk-btn:hover:not(:disabled){transform:translateY(-1px);}
        .bk-btn-primary:hover:not(:disabled){box-shadow:0 10px 26px rgba(212,175,55,.45);}
        .bk-btn-ghost:hover:not(:disabled){background:rgba(255,255,255,.18); border-color:rgba(255,255,255,.35);}
        .bk-icon-btn{transition:transform .15s ease, background .2s ease, border-color .2s ease;}
        .bk-icon-btn:hover:not(:disabled){transform:translateY(-1px);}
        .bk-row:hover{background:#f8fafc !important;}
        .bk-spin{animation:bkspin 1s linear infinite}
        @keyframes bkspin{to{transform:rotate(360deg)}}
        @keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
      `}</style>

      {/* ===== Premium Header (compact) ===== */}
      <div className="bk-fade-in" style={{
        padding: "16px 20px", borderRadius: 14, border: "1px solid #1e3a8a44",
        background: `linear-gradient(135deg, ${NAVY} 0%, #1e3a8a 60%, #1e40af 100%)`,
        boxShadow: `0 10px 30px ${NAVY}2e`, color: "#fff", overflow: "hidden", position: "relative",
      }}>
        <div aria-hidden style={{ position: "absolute", top: -40, left: -40, width: 200, height: 200, borderRadius: "50%", background: `radial-gradient(circle, ${GOLD}30, transparent 65%)` }} />
        <div style={{ position: "relative", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div style={{ minWidth: 0, flex: "1 1 320px" }}>
            <Crumb />
            <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 2 }}>
              <div style={{ width: 42, height: 42, borderRadius: 11, background: `linear-gradient(135deg, ${GOLD}, #e0b65c)`, color: NAVY, display: "grid", placeItems: "center", flexShrink: 0, boxShadow: `0 6px 16px ${GOLD}55` }}>
                <ShieldCheck size={22} strokeWidth={2.4} />
              </div>
              <div style={{ minWidth: 0 }}>
                <h1 style={{ margin: 0, fontSize: 18, fontWeight: 900, letterSpacing: "-0.01em", lineHeight: 1.2 }}>إدارة النسخ الاحتياطية</h1>
                <p style={{ margin: "2px 0 0", fontSize: 12, color: "#cbd5e1", lineHeight: 1.4 }}>إدارة النسخ التلقائية واستعادة بيانات النظام بأمان</p>
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button className="bk-btn bk-btn-primary" onClick={onCreate} disabled={busy === "create"} style={{
              display: "inline-flex", alignItems: "center", gap: 7, height: 38, padding: "0 16px", borderRadius: 10,
              background: busy === "create" ? "#94a3b8" : `linear-gradient(135deg, ${GOLD}, #e0b65c)`,
              color: NAVY, border: 0, fontWeight: 800, fontSize: 12.5, cursor: busy === "create" ? "wait" : "pointer",
              boxShadow: busy === "create" ? "none" : `0 6px 16px ${GOLD}4d`,
            }}>
              {busy === "create" ? <RefreshCw size={14} className="bk-spin" /> : <Plus size={14} />}
              {busy === "create" ? "جارٍ الإنشاء..." : "إنشاء نسخة الآن"}
            </button>
            <button className="bk-btn bk-btn-ghost" onClick={() => refetch()} disabled={isFetching} style={{
              display: "inline-flex", alignItems: "center", gap: 6, height: 38, padding: "0 14px", borderRadius: 10,
              background: "rgba(255,255,255,.08)", color: "#fff", border: "1px solid rgba(255,255,255,.22)",
              fontWeight: 700, fontSize: 12.5, cursor: isFetching ? "wait" : "pointer", backdropFilter: "blur(6px)",
            }}>
              <RefreshCw size={13} className={isFetching ? "bk-spin" : ""} /> تحديث
            </button>
            <button className="bk-btn bk-btn-ghost" onClick={() => setConfirm({
              title: "تنظيف النسخ القديمة",
              message: "سيتم تطبيق سياسة الاحتفاظ وحذف النسخ منتهية الصلاحية. هذه العملية لا يمكن التراجع عنها.",
              danger: true,
              onOk: async () => { setConfirm(null); await onRetention(); },
            })} disabled={busy === "retention"} style={{
              display: "inline-flex", alignItems: "center", gap: 6, height: 38, padding: "0 14px", borderRadius: 10,
              background: "rgba(255,255,255,.08)", color: "#fff", border: "1px solid rgba(255,255,255,.22)",
              fontWeight: 700, fontSize: 12.5, cursor: busy === "retention" ? "wait" : "pointer", backdropFilter: "blur(6px)",
            }}>
              <Trash2 size={13} /> {busy === "retention" ? "جارٍ..." : "تنظيف القديم"}
            </button>
          </div>
        </div>
      </div>

      {/* ===== KPI Overview ===== */}
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
        <Kpi
          icon={<ShieldCheck size={20} />}
          label="حالة النظام"
          value={<span style={{ color: systemHealthy ? "#047857" : latestFailLog ? "#b91c1c" : "#475569" }}>{systemHealthy ? "آمن" : latestFailLog ? "يحتاج انتباه" : "غير مُهيّأ"}</span>}
          sub={systemHealthy ? "آخر نسخة ناجحة" : latestFailLog ? "آخر محاولة فشلت" : "—"}
          tone={systemHealthy ? "success" : latestFailLog ? "danger" : "neutral"}
        />
        <Kpi
          icon={<Check size={20} />}
          label="آخر نسخة ناجحة"
          value={latestSuccessLog ? relTimeAr(latestSuccessLog.created_at) : "—"}
          sub={latestSuccessLog ? fullDateAr(latestSuccessLog.created_at) : "لم تُنفّذ بعد"}
          tone="success"
        />
        <Kpi
          icon={<AlertTriangle size={20} />}
          label="آخر محاولة فاشلة"
          value={latestFailLog ? relTimeAr(latestFailLog.created_at) : "لا يوجد"}
          sub={latestFailLog?.failure_reason ? String(latestFailLog.failure_reason).slice(0, 60) : "كل المحاولات ناجحة"}
          tone={latestFailLog ? "danger" : "neutral"}
        />
        <Kpi
          icon={<FileArchive size={20} />}
          label="عدد النسخ المحفوظة"
          value={totalCount}
          sub={`عبر ${new Set(allBackups.map((b: any) => b.type)).size} أنواع`}
          tone="info"
        />
        <Kpi
          icon={<HardDrive size={20} />}
          label="الحجم الإجمالي"
          value={fmtBytes(totalSize)}
          sub={`متوسط ${totalCount ? fmtBytes(Math.round(totalSize / totalCount)) : "0 B"} / نسخة`}
          tone="info"
        />
      </div>

      <AutoBackupsSummary backups={allBackups} logs={allLogs} />

      {/* ===== Files Table — Enterprise Backup History ===== */}
      {(() => {
        const RETENTION_DAYS: Record<string, number> = { daily: 30, weekly: 183, monthly: 365 };
        const retentionLabel = (b: any) => {
          const days = RETENTION_DAYS[b.type];
          if (!days) return "دائمة";
          if (!b.created_at) return `${days} يوم`;
          const expires = new Date(b.created_at).getTime() + days * 86400000;
          const left = Math.max(0, Math.ceil((expires - Date.now()) / 86400000));
          return `${left} يوم متبقّي`;
        };
        const statusOf = (b: any): "success" | "failed" | "pending" => {
          const log = allLogs.find((l: any) => l.file_path === b.path && l.backup_type !== "restore");
          if (log?.status === "failed") return "failed";
          if (log?.status === "success") return "success";
          return "success";
        };
        const filtered = allBackups.filter((b: any) => {
          if (archiveType !== "all" && b.type !== archiveType) return false;
          if (archiveStatus !== "all" && statusOf(b) !== archiveStatus) return false;
          if (archiveQuery && !b.name.toLowerCase().includes(archiveQuery.toLowerCase())) return false;
          return true;
        });
        const totalPages = Math.max(1, Math.ceil(filtered.length / ARCHIVE_PAGE_SIZE));
        const page = Math.min(archivePage, totalPages);
        const pageRows = filtered.slice((page - 1) * ARCHIVE_PAGE_SIZE, page * ARCHIVE_PAGE_SIZE);
        const inputStyle: React.CSSProperties = {
          height: 34, padding: "0 10px", borderRadius: 8, border: "1px solid #e2e8f0",
          background: "#fff", fontSize: 12.5, color: "#0f172a", outline: "none", minWidth: 0,
        };
        return (
          <div className="bk-card" style={cardBase}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, paddingBottom: 12, marginBottom: 12, borderBottom: "1px solid #eef2f7", flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: 9, background: `${NAVY}10`, color: NAVY, display: "grid", placeItems: "center" }}><Database size={17} /></div>
                <div>
                  <h4 style={{ margin: 0, fontSize: 14.5, fontWeight: 800, color: "#0f172a" }}>سجل النسخ الاحتياطية</h4>
                  <div style={{ fontSize: 11, color: "#94a3b8" }}>كل النسخ المتاحة للاستعادة أو التنزيل</div>
                </div>
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: NAVY, background: `${GOLD}22`, border: `1px solid ${GOLD}66`, padding: "3px 10px", borderRadius: 999 }}>
                {filtered.length} / {totalCount}
              </span>
            </div>

            {/* Toolbar: search + filters */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
              <div style={{ position: "relative", flex: "1 1 220px", minWidth: 0 }}>
                <Search size={14} style={{ position: "absolute", insetInlineStart: 10, top: "50%", transform: "translateY(-50%)", color: "#94a3b8" }} />
                <input
                  value={archiveQuery}
                  onChange={(e) => { setArchiveQuery(e.target.value); setArchivePage(1); }}
                  placeholder="بحث باسم النسخة..."
                  style={{ ...inputStyle, width: "100%", paddingInlineStart: 30 }}
                />
              </div>
              <select value={archiveType} onChange={(e) => { setArchiveType(e.target.value); setArchivePage(1); }} style={{ ...inputStyle, minWidth: 130 }}>
                <option value="all">كل الأنواع</option>
                <option value="manual">يدوية</option>
                <option value="daily">يومية</option>
                <option value="weekly">أسبوعية</option>
                <option value="monthly">شهرية</option>
                <option value="emergency">طوارئ</option>
              </select>
              <select value={archiveStatus} onChange={(e) => { setArchiveStatus(e.target.value); setArchivePage(1); }} style={{ ...inputStyle, minWidth: 130 }}>
                <option value="all">كل الحالات</option>
                <option value="success">ناجحة</option>
                <option value="failed">فاشلة</option>
              </select>
            </div>

            {isLoading ? (
              <div style={{ display: "grid", gap: 8 }}>
                {[0,1,2].map(i => <div key={i} style={{ height: 52, borderRadius: 10, background: "linear-gradient(90deg,#f8fafc,#f1f5f9,#f8fafc)", backgroundSize: "200% 100%", animation: "shimmer 1.4s infinite" }} />)}
              </div>
            ) : allBackups.length === 0 ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "44px 20px", color: "#64748b", background: "linear-gradient(180deg,#fafbfd,#fff)", borderRadius: 12, border: "1px dashed #e2e8f0" }}>
                <div style={{ width: 72, height: 72, borderRadius: "50%", background: `${NAVY}08`, display: "grid", placeItems: "center", marginBottom: 14 }}>
                  <Cloud size={36} color={NAVY} strokeWidth={1.6} />
                </div>
                <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a" }}>لا توجد نسخ احتياطية حالياً</div>
                <div style={{ fontSize: 12.5, color: "#94a3b8", marginTop: 6, textAlign: "center", maxWidth: 360 }}>أنشئ أول نسخة احتياطية لحماية بيانات النظام، أو انتظر التشغيل التلقائي القادم.</div>
                <button onClick={onCreate} disabled={busy === "create"} className="bk-btn" style={{ marginTop: 14, display: "inline-flex", alignItems: "center", gap: 6, padding: "10px 18px", borderRadius: 10, background: `linear-gradient(135deg, ${NAVY}, #1e3a8a)`, color: GOLD, border: 0, fontWeight: 800, fontSize: 13, cursor: "pointer" }}>
                  <Plus size={14} /> إنشاء أول نسخة
                </button>
              </div>
            ) : pageRows.length === 0 ? (
              <div style={{ padding: "32px 20px", textAlign: "center", color: "#94a3b8", border: "1px dashed #e2e8f0", borderRadius: 10, fontSize: 13 }}>
                لا توجد نتائج مطابقة للبحث الحالي
              </div>
            ) : (
              <>
                <div style={{ overflowX: "auto", borderRadius: 10, border: "1px solid #eef2f7" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 920, fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: "linear-gradient(180deg,#f8fafc,#f1f5f9)", position: "sticky", top: 0, zIndex: 1 }}>
                        <th style={{ ...th, fontWeight: 800, color: "#475569", borderBottom: "1px solid #e2e8f0" }}>اسم النسخة</th>
                        <th style={{ ...th, fontWeight: 800, color: "#475569", borderBottom: "1px solid #e2e8f0" }}>النوع</th>
                        <th style={{ ...th, fontWeight: 800, color: "#475569", borderBottom: "1px solid #e2e8f0" }}>تاريخ الإنشاء</th>
                        <th style={{ ...th, fontWeight: 800, color: "#475569", borderBottom: "1px solid #e2e8f0" }}>الحجم</th>
                        <th style={{ ...th, fontWeight: 800, color: "#475569", borderBottom: "1px solid #e2e8f0" }}>الحالة</th>
                        <th style={{ ...th, fontWeight: 800, color: "#475569", borderBottom: "1px solid #e2e8f0" }}>مدة الاحتفاظ</th>
                        <th style={{ ...th, fontWeight: 800, color: "#475569", borderBottom: "1px solid #e2e8f0", textAlign: "left" }}>إجراءات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.map((b: any, idx: number) => (
                        <tr key={b.path} className="bk-row" style={{ background: idx % 2 ? "#fafbfd" : "#fff", transition: "background .15s" }}>
                          <td style={{ ...td, fontWeight: 700, color: "#0f172a" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <FileArchive size={14} color={NAVY} />
                              <span style={{ wordBreak: "break-all" }}>{b.name}</span>
                            </div>
                          </td>
                          <td style={td}>{typeBadge(b.type)}</td>
                          <td style={{ ...td, color: "#475569" }} title={b.created_at ? fullDateAr(b.created_at) : ""}>
                            {b.created_at ? relTimeAr(b.created_at) : "-"}
                          </td>
                          <td style={{ ...td, fontFamily: "ui-monospace,monospace", color: "#475569" }}>{fmtBytes(b.size)}</td>
                          <td style={td}>{statusPill(statusOf(b))}</td>
                          <td style={{ ...td, color: "#475569", fontSize: 12 }}>{retentionLabel(b)}</td>
                          <td style={td}>
                            <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                              <button className="bk-icon-btn" title="معاينة" disabled={busy === b.path} onClick={() => onPreview(b)} style={iconBtn(NAVY, "#e2e8f0")}><Eye size={14} /></button>
                              <button className="bk-icon-btn" title="تنزيل" disabled={busy === b.path} onClick={() => onDownload(b.path)} style={iconBtn("#047857", "#a7f3d0")}><Download size={14} /></button>
                              <button className="bk-icon-btn" title="استعادة" disabled={busy === b.path} onClick={() => onRestore(b)} style={iconBtn("#b45309", "#fde68a")}><RotateCcw size={14} /></button>
                              <button className="bk-icon-btn" title="حذف" disabled={busy === b.path} onClick={() => onDelete(b.path)} style={iconBtn("#b91c1c", "#fecaca")}><Trash2 size={14} /></button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {totalPages > 1 && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12, gap: 8, flexWrap: "wrap" }}>
                    <div style={{ fontSize: 12, color: "#64748b" }}>
                      صفحة {page} من {totalPages} · إجمالي {filtered.length}
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button className="bk-btn" disabled={page === 1} onClick={() => setArchivePage(page - 1)} style={{ height: 32, padding: "0 12px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", color: "#0f172a", fontWeight: 700, fontSize: 12, cursor: page === 1 ? "not-allowed" : "pointer", opacity: page === 1 ? 0.5 : 1 }}>السابق</button>
                      <button className="bk-btn" disabled={page === totalPages} onClick={() => setArchivePage(page + 1)} style={{ height: 32, padding: "0 12px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", color: "#0f172a", fontWeight: 700, fontSize: 12, cursor: page === totalPages ? "not-allowed" : "pointer", opacity: page === totalPages ? 0.5 : 1 }}>التالي</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })()}


      {/* ===== Activity Log ===== */}
      <div className="bk-card" style={cardBase}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, paddingBottom: 12, marginBottom: 12, borderBottom: "1px solid #eef2f7" }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: `${NAVY}10`, color: NAVY, display: "grid", placeItems: "center" }}><Activity size={17} /></div>
          <div>
            <h4 style={{ margin: 0, fontSize: 14.5, fontWeight: 800, color: "#0f172a" }}>سجل العمليات</h4>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>كل عمليات الإنشاء والاستعادة والإخفاقات</div>
          </div>
        </div>
        {allLogs.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 28, color: "#94a3b8" }}>
            <Inbox size={28} />
            <div style={{ fontSize: 13, marginTop: 8, fontWeight: 600 }}>لا توجد سجلات بعد</div>
          </div>
        ) : (
          <div style={{ overflowX: "auto", borderRadius: 10, border: "1px solid #eef2f7" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720, fontSize: 13 }}>
              <thead>
                <tr style={{ background: "linear-gradient(180deg,#f8fafc,#f1f5f9)" }}>
                  <th style={{ ...th, fontWeight: 800, color: "#475569", borderBottom: "1px solid #e2e8f0" }}>التاريخ</th>
                  <th style={{ ...th, fontWeight: 800, color: "#475569", borderBottom: "1px solid #e2e8f0" }}>النوع</th>
                  <th style={{ ...th, fontWeight: 800, color: "#475569", borderBottom: "1px solid #e2e8f0" }}>الحالة</th>
                  <th style={{ ...th, fontWeight: 800, color: "#475569", borderBottom: "1px solid #e2e8f0" }}>المنفذ</th>
                  <th style={{ ...th, fontWeight: 800, color: "#475569", borderBottom: "1px solid #e2e8f0" }}>الحجم</th>
                  <th style={{ ...th, fontWeight: 800, color: "#475569", borderBottom: "1px solid #e2e8f0" }}>تفاصيل</th>
                </tr>
              </thead>
              <tbody>
                {allLogs.map((l: any, idx: number) => (
                  <tr key={l.id} style={{ background: idx % 2 ? "#fafbfd" : "#fff" }}>
                    <td style={{ ...td, color: "#475569" }} title={fullDateAr(l.created_at)}>{relTimeAr(l.created_at)}</td>
                    <td style={td}>{typeBadge(l.backup_type)}</td>
                    <td style={td}>{statusPill(l.status)}</td>
                    <td style={{ ...td, color: "#475569" }}>{userName(l.restored_by || l.created_by)}</td>
                    <td style={{ ...td, fontFamily: "ui-monospace,monospace", color: "#475569" }}>{l.file_size ? fmtBytes(l.file_size) : "—"}</td>
                    <td style={{ ...td, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: l.failure_reason ? "#b91c1c" : "#64748b" }} title={l.failure_reason || l.file_path || ""}>
                      {l.failure_reason || l.file_path || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {confirm && (
        <ConfirmModal
          title={confirm.title}
          message={confirm.message}
          confirmLabel="تأكيد"
          danger={confirm.danger}
          onConfirm={() => confirm.onOk()}
          onCancel={() => setConfirm(null)}
        />
      )}
      {preview && (
        <BackupPreviewModal data={preview} onClose={() => setPreview(null)} />
      )}
      {restoreTarget && (
        <RestoreConfirmModal
          target={restoreTarget}
          busy={busy === restoreTarget.path}
          onCancel={() => setRestoreTarget(null)}
          onConfirm={doRestore}
        />
      )}
    </div>
  );
}

const TABLE_LABELS_AR: Record<string, string> = {
  flights: "الرحلات",
  approvals: "الموافقات",
  transactions: "الحركات",
  agents: "الوكلاء",
  merchants: "التجار",
  investors: "المستثمرين",
  profiles: "المستخدمين",
  user_roles: "الصلاحيات",
  issuing_companies: "شركات الإصدار",
  company_transactions: "حركات الشركات",
  expenses: "المصروفات",
  expense_deductions: "خصومات المصروفات",
  investor_transactions: "حركات المستثمرين",
  merchant_cash_collections: "تحصيلات التجار",
  system_dropdown_options: "إعدادات القوائم",
  app_settings: "إعدادات التطبيق",
  activity_logs: "سجل النشاط",
};

const TYPE_LABELS_AR: Record<string, string> = {
  manual: "يدوية", daily: "يومية", weekly: "أسبوعية", monthly: "شهرية", emergency: "طوارئ",
};

function typeColor(t: string) {
  switch (t) {
    case "manual": return { bg: "#dbeafe", fg: "#1e40af", border: "#93c5fd" };
    case "daily": return { bg: "#ede9fe", fg: "#5b21b6", border: "#c4b5fd" };
    case "weekly": return { bg: "#cffafe", fg: "#155e75", border: "#67e8f9" };
    case "monthly": return { bg: "#fef9c3", fg: "#854d0e", border: "#fde68a" };
    case "emergency": return { bg: "#fee2e2", fg: "#991b1b", border: "#fca5a5" };
    default: return { bg: "#f3f4f6", fg: "#374151", border: "#d1d5db" };
  }
}

const TABLE_ICONS: Record<string, string> = {
  flights: "✈️",
  approvals: "✅",
  transactions: "💰",
  agents: "👤",
  merchants: "🏪",
  investors: "📈",
  profiles: "👥",
  user_roles: "🛡️",
  issuing_companies: "🏢",
  company_transactions: "💼",
  expenses: "🧾",
  expense_deductions: "📉",
  investor_transactions: "💵",
  merchant_cash_collections: "💳",
  system_dropdown_options: "⚙️",
  app_settings: "⚙️",
  activity_logs: "📜",
};

function BackupPreviewModal({ data, onClose }: { data: { meta: any; file: any; log?: any; lastRestore?: any; createdByName?: string }; onClose: () => void }) {
  const { meta, file, log, lastRestore, createdByName } = data;
  const counts: Record<string, number> = meta?.table_counts ?? {};
  const entries = Object.entries(counts).sort((a, b) => (b[1] as number) - (a[1] as number));
  const total = entries.reduce((s, [, n]) => s + (Number(n) || 0), 0);
  const maxCount = entries.reduce((m, [, n]) => Math.max(m, Number(n) || 0), 0);
  const tc = typeColor(meta?.type);
  const status = log?.status ?? "success";
  const statusOk = status !== "failed";
  const typeLabel = TYPE_LABELS_AR[meta?.type] ?? meta?.type ?? "—";
  const created = meta?.created_at ? new Date(meta.created_at) : null;
  const createdBy = createdByName || (log?.created_by ? log.created_by.slice(0, 8) + "…" : "النظام");

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(15,23,42,0.6)", backdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 8,
        animation: "fade-in 0.2s ease-out",
      }}
      dir="rtl"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff", borderRadius: 16, width: "100%", maxWidth: 760, maxHeight: "92vh",
          overflow: "hidden", boxShadow: "0 25px 60px -12px rgba(0,0,0,0.4)",
          display: "flex", flexDirection: "column", animation: "scale-in 0.2s ease-out",
        }}
      >
        {/* Header */}
        <div style={{
          padding: "18px 20px", borderBottom: "1px solid #e2e8f0",
          background: "linear-gradient(135deg,#0f172a,#1e293b)",
          display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            <div style={{
              width: 48, height: 48, borderRadius: 12, background: tc.bg, color: tc.fg,
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24,
              border: `1px solid ${tc.border}`, flexShrink: 0,
            }}>🗄️</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 17, color: "#fff" }}>
                نسخة احتياطية {typeLabel}
              </div>
              <div style={{ fontSize: 12, color: "#cbd5e1", marginTop: 4, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <span>📅</span>
                  <span>{created ? created.toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" }) : "—"}</span>
                </span>
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700,
                  background: "rgba(16,185,129,0.15)", color: "#6ee7b7",
                  border: "1px solid rgba(16,185,129,0.35)",
                }}>
                  <span>🔒</span><span>مشفّرة وآمنة</span>
                </span>
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{
            border: "none", background: "rgba(255,255,255,0.1)", color: "#fff",
            width: 34, height: 34, borderRadius: 8, cursor: "pointer", fontSize: 18,
            transition: "background 0.2s", flexShrink: 0,
          }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.2)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.1)")}
          >✕</button>
        </div>

        {/* Scrollable body */}
        <div style={{ overflowY: "auto", flex: 1 }}>
          {/* Info cards */}
          <div style={{ padding: "16px 14px 4px", display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))" }}>
            <InfoCard
              label="نوع النسخة" value={typeLabel} icon="🏷️"
              badgeBg={tc.bg} badgeFg={tc.fg} badgeBorder={tc.border}
            />
            <InfoCard
              label="الحالة" value={statusOk ? "ناجحة" : "فاشلة"}
              icon={statusOk ? "✅" : "⚠️"}
              badgeBg={statusOk ? "#dcfce7" : "#fee2e2"}
              badgeFg={statusOk ? "#166534" : "#991b1b"}
              badgeBorder={statusOk ? "#86efac" : "#fca5a5"}
            />
            <InfoCard label="الحجم" value={fmtBytes(file?.size ?? 0)} icon="💾" />
            <InfoCard label="إجمالي السجلات" value={total.toLocaleString("ar")} icon="📊" />
            <InfoCard label="تم الإنشاء بواسطة" value={createdBy} icon="👤" />
            <InfoCard
              label="آخر استعادة"
              value={lastRestore?.restore_date ? new Date(lastRestore.restore_date).toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" }) : "لم تُستعد"}
              icon="🔄"
            />
          </div>

          {/* Table counts */}
          <div style={{ padding: "16px 14px 6px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
            <h4 style={{ margin: 0, fontSize: 14, color: "#0f172a", fontWeight: 700 }}>محتوى النسخة حسب الأقسام</h4>
            <span style={{ fontSize: 11, color: "#64748b" }}>{entries.length} قسم</span>
          </div>
          <div style={{ padding: "4px 14px 20px", display: "grid", gap: 8 }}>
            {entries.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: "#94a3b8" }}>لا توجد بيانات</div>
            ) : (
              entries.map(([table, n]) => {
                const num = Number(n) || 0;
                const pct = maxCount > 0 ? Math.round((num / maxCount) * 100) : 0;
                const sharePct = total > 0 ? ((num / total) * 100).toFixed(1) : "0";
                const icon = TABLE_ICONS[table] ?? "📦";
                return (
                  <div key={table}
                    style={{
                      border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px",
                      background: "#fff", transition: "all 0.2s",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "#f8fafc";
                      e.currentTarget.style.borderColor = "#cbd5e1";
                      e.currentTarget.style.transform = "translateY(-1px)";
                      e.currentTarget.style.boxShadow = "0 4px 12px -4px rgba(15,23,42,0.1)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "#fff";
                      e.currentTarget.style.borderColor = "#e2e8f0";
                      e.currentTarget.style.transform = "translateY(0)";
                      e.currentTarget.style.boxShadow = "none";
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                        <span style={{ fontSize: 18 }}>{icon}</span>
                        <span style={{ fontWeight: 600, fontSize: 13, color: "#0f172a" }}>
                          {TABLE_LABELS_AR[table] ?? table}
                        </span>
                      </div>
                      <div style={{ fontSize: 13, color: "#0f172a", fontWeight: 700, whiteSpace: "nowrap" }}>
                        {num.toLocaleString("ar")}
                        <span style={{ color: "#94a3b8", fontWeight: 400, fontSize: 11, marginRight: 4 }}>({sharePct}%)</span>
                      </div>
                    </div>
                    <div style={{ height: 6, background: "#f1f5f9", borderRadius: 999, overflow: "hidden" }}>
                      <div style={{
                        width: pct + "%", height: "100%",
                        background: "linear-gradient(90deg,#0ea5e9,#6366f1,#8b5cf6)",
                        transition: "width 0.4s ease-out",
                      }} />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div style={{
          padding: "12px 16px", borderTop: "1px solid #e2e8f0",
          display: "flex", justifyContent: "flex-start", background: "#f8fafc",
        }}>
          <button onClick={onClose} style={{
            padding: "8px 20px", border: "1px solid #cbd5e1", background: "#fff",
            borderRadius: 8, cursor: "pointer", fontWeight: 600, color: "#334155",
            transition: "all 0.15s",
          }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#0f172a"; e.currentTarget.style.color = "#fff"; e.currentTarget.style.borderColor = "#0f172a"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; e.currentTarget.style.color = "#334155"; e.currentTarget.style.borderColor = "#cbd5e1"; }}
          >إغلاق</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function InfoCard({ label, value, icon, badgeBg, badgeFg, badgeBorder }: { label: string; value: string; icon: string; badgeBg?: string; badgeFg?: string; badgeBorder?: string }) {
  const isBadge = !!badgeBg;
  return (
    <div style={{
      border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px",
      background: "linear-gradient(135deg,#fff,#f8fafc)", transition: "all 0.2s",
    }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#cbd5e1"; e.currentTarget.style.boxShadow = "0 2px 8px -2px rgba(15,23,42,0.08)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#e2e8f0"; e.currentTarget.style.boxShadow = "none"; }}
    >
      <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6, display: "flex", alignItems: "center", gap: 6, fontWeight: 500 }}>
        <span>{icon}</span>{label}
      </div>
      {isBadge ? (
        <span style={{
          display: "inline-block", padding: "3px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700,
          background: badgeBg, color: badgeFg, border: `1px solid ${badgeBorder}`,
        }}>{value}</span>
      ) : (
        <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", wordBreak: "break-word" }}>{value}</div>
      )}
    </div>
  );
}
function AutoBackupsSummary({ backups, logs }: { backups: any[]; logs: any[] }) {
  const latestByType = (t: string) => backups.find((b) => b.type === t);
  const latestSuccess = logs.find((l) => l.status === "success" && l.backup_type !== "restore");
  const latestFail = logs.find((l) => l.status === "failed");
  const lastDaily = latestByType("daily");
  const lastWeekly = latestByType("weekly");
  const lastMonthly = latestByType("monthly");
  const lastAny = backups[0];

  const items = [
    { label: "آخر يومية", icon: "🗓️", b: lastDaily, color: "#ede9fe", fg: "#5b21b6" },
    { label: "آخر أسبوعية", icon: "📆", b: lastWeekly, color: "#cffafe", fg: "#155e75" },
    { label: "آخر شهرية", icon: "🗂️", b: lastMonthly, color: "#fef9c3", fg: "#854d0e" },
  ];

  return (
    <div className="card bk-fade-in bk-summary-wrap" style={{
      padding: 16, border: "1px solid #eef2f7", borderRadius: 14,
      boxShadow: "0 1px 2px rgba(15,23,42,0.04), 0 6px 20px -10px rgba(15,23,42,0.08)",
      background: "#fff",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
        <h4 style={{ margin: 0, fontSize: 15, color: "#0f172a", fontWeight: 800 }}>📊 ملخص النسخ التلقائية</h4>
        {(() => {
          const failed = !!(latestFail && latestSuccess && latestFail.created_at > latestSuccess.created_at);
          const active = !!lastAny && !failed;
          const bg = failed ? "#fef2f2" : active ? "#f0fdf4" : "#f1f5f9";
          const fg = failed ? "#991b1b" : active ? "#15803d" : "#475569";
          const bd = failed ? "#fecaca" : active ? "#bbf7d0" : "#e2e8f0";
          const glow = failed ? "0 0 0 3px rgba(239,68,68,0.08)" : active ? "0 0 0 3px rgba(34,197,94,0.10)" : "none";
          return (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700,
              padding: "4px 12px", borderRadius: 999, lineHeight: 1.4,
              background: bg, color: fg, border: `1px solid ${bd}`, boxShadow: glow,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: 999, background: fg, opacity: .85 }} />
              <span>حالة آخر Backup: {failed ? "فشل" : active ? "نشطة" : "لم تبدأ"}</span>
            </span>
          );
        })()}
      </div>
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
        {items.map((it) => {
          const empty = !it.b?.created_at;
          return (
            <div key={it.label} className="bk-fade-in bk-summary-card" style={{
              border: "1px solid #e2e8f0", borderRadius: 12, padding: "12px 14px",
              background: empty ? "#fafbfc" : "linear-gradient(135deg,#fff,#f8fafc)",
              transition: "all 0.2s", display: "flex", flexDirection: "column", gap: 8, minHeight: 92,
            }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#cbd5e1"; e.currentTarget.style.boxShadow = "0 4px 12px -4px rgba(15,23,42,0.08)"; e.currentTarget.style.transform = "translateY(-1px)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#e2e8f0"; e.currentTarget.style.boxShadow = "none"; e.currentTarget.style.transform = "translateY(0)"; }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <span style={{
                  width: 30, height: 30, borderRadius: 8, background: it.color, color: it.fg, flexShrink: 0,
                  display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 15,
                }}>{it.icon}</span>
                <span style={{ fontSize: 12.5, color: "#475569", fontWeight: 700, letterSpacing: "-0.01em" }}>{it.label}</span>
              </div>
              {it.b?.created_at ? (
                <div>
                  <div style={{ fontSize: 13.5, color: "#0f172a", fontWeight: 700 }} title={fullDateAr(it.b.created_at)}>
                    {relTimeAr(it.b.created_at)}
                  </div>
                  <div style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 2 }}>
                    {fmtBytes(it.b.size)}
                  </div>
                </div>
              ) : (
                <div style={{
                  display: "flex", alignItems: "center", gap: 7,
                  color: "#94a3b8", fontSize: 12, fontWeight: 500, opacity: 0.7,
                }}>
                  <span aria-hidden style={{
                    width: 22, height: 22, borderRadius: 7, background: "#f1f5f9",
                    display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12,
                  }}>📭</span>
                  <span>لا توجد نسخة محفوظة حتى الآن</span>
                </div>
              )}
            </div>
          );
        })}
        <div className="bk-fade-in bk-summary-card" style={{
          border: "1px solid #bbf7d0", borderRadius: 12, padding: "12px 14px",
          background: "linear-gradient(135deg,#f0fdf4,#dcfce7)",
          display: "flex", flexDirection: "column", gap: 8, minHeight: 92,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 15 }}>✅</span>
            <span style={{ fontSize: 12.5, color: "#166534", fontWeight: 700 }}>آخر نجاح</span>
          </div>
          <div>
            <div style={{ fontSize: 14.5, color: "#14532d", fontWeight: 800, opacity: latestSuccess ? 1 : 0.55 }} title={fullDateAr(latestSuccess?.created_at)}>
              {latestSuccess?.created_at ? relTimeAr(latestSuccess.created_at) : "لا توجد نسخة محفوظة حتى الآن"}
            </div>
            {latestSuccess && (
              <div style={{ fontSize: 10.5, color: "#16a34a", marginTop: 2 }}>
                {`${fullDateAr(latestSuccess.created_at)} · ${TYPE_LABELS_AR[latestSuccess.backup_type] ?? latestSuccess.backup_type}`}
              </div>
            )}
          </div>
        </div>
        <div className="bk-fade-in bk-summary-card" style={{
          border: `1px solid ${latestFail ? "#fecaca" : "#e2e8f0"}`, borderRadius: 12, padding: "12px 14px",
          background: latestFail ? "linear-gradient(135deg,#fef2f2,#fee2e2)" : "#fafbfc",
          display: "flex", flexDirection: "column", gap: 8, minHeight: 92,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 15 }}>{latestFail ? "⚠️" : "🛡️"}</span>
            <span style={{ fontSize: 12.5, color: latestFail ? "#991b1b" : "#475569", fontWeight: 700 }}>آخر فشل</span>
          </div>
          <div>
            <div style={{ fontSize: 13.5, color: latestFail ? "#7f1d1d" : "#64748b", fontWeight: 700, opacity: latestFail ? 1 : 0.65 }} title={latestFail ? fullDateAr(latestFail.created_at) : ""}>
              {latestFail?.created_at ? relTimeAr(latestFail.created_at) : "لا توجد إخفاقات"}
            </div>
            {latestFail?.failure_reason && (
              <div style={{ fontSize: 10.5, color: "#b91c1c", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {latestFail.failure_reason}
              </div>
            )}
          </div>
        </div>
      </div>

      <NextSchedulesCard />
    </div>
  );
}

function NextSchedulesCard() {
  const { daily, weekly, monthly } = nextSchedules();
  const fmtTime = (d: Date) => d.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" });
  const fmtDay = (d: Date) => d.toLocaleDateString("ar-EG", { weekday: "long", day: "numeric", month: "long" });
  const items = [
    { icon: "🕑", label: "اليومية القادمة", when: daily, hint: "كل يوم 2:00 صباحاً" },
    { icon: "🗓", label: "الأسبوعية القادمة", when: weekly, hint: "كل أحد 2:00 صباحاً" },
    { icon: "📦", label: "الشهرية القادمة", when: monthly, hint: "أول يوم بالشهر 2:00 صباحاً" },
  ];
  return (
    <div className="bk-fade-in" style={{
      marginTop: 16, border: "1px solid #eef2f7", borderRadius: 14, padding: 16,
      background: "linear-gradient(135deg,#f8fafc,#eef2ff)",
      boxShadow: "0 1px 2px rgba(15,23,42,0.03)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span aria-hidden style={{ fontSize: 18, lineHeight: 1 }}>⏰</span>
        <h5 style={{ margin: 0, fontSize: 14, color: "#0f172a", fontWeight: 800, letterSpacing: "-0.01em" }}>
          النسخة التلقائية القادمة
        </h5>
      </div>
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
        {items.map((it) => (
          <div key={it.label} style={{
            background: "#fff", border: "1px solid #eef2f7", borderRadius: 12, padding: "10px 12px",
            transition: "all .2s", boxShadow: "0 1px 2px rgba(15,23,42,0.03)",
          }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#c7d2fe"; e.currentTarget.style.boxShadow = "0 6px 18px -8px rgba(79,70,229,0.25)"; e.currentTarget.style.transform = "translateY(-1px)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#eef2f7"; e.currentTarget.style.boxShadow = "0 1px 2px rgba(15,23,42,0.03)"; e.currentTarget.style.transform = "translateY(0)"; }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span aria-hidden style={{ fontSize: 16, lineHeight: 1, width: 18, textAlign: "center" }}>{it.icon}</span>
              <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>{it.label}</span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }} title={fullDateAr(it.when)}>
              <span style={{ fontSize: 13, color: "#0f172a", fontWeight: 700 }}>{fmtDay(it.when)}</span>
              <span style={{ fontSize: 13, color: "#2563eb", fontWeight: 800, letterSpacing: "-0.01em" }}>{fmtTime(it.when)}</span>
            </div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>{it.hint}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActionBtn({
  variant, loading, onClick, children,
}: {
  variant: "primary" | "ghost";
  loading?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const isPrimary = variant === "primary";
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="bk-tap"
      style={{
        position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
        minHeight: 40, padding: "8px 16px", borderRadius: 10, fontSize: 13, fontWeight: 700,
        whiteSpace: "nowrap", cursor: loading ? "wait" : "pointer", transition: "all .15s ease",
        background: isPrimary ? "linear-gradient(135deg,#2563eb,#1d4ed8)" : "#fff",
        color: isPrimary ? "#fff" : "#0f172a",
        border: isPrimary ? "1px solid #1d4ed8" : "1px solid #e2e8f0",
        boxShadow: isPrimary
          ? "0 1px 2px rgba(37,99,235,0.25), 0 6px 16px -8px rgba(37,99,235,0.45)"
          : "0 1px 2px rgba(15,23,42,0.04)",
        opacity: loading ? 0.75 : 1,
      }}
      onMouseEnter={(e) => {
        if (loading) return;
        e.currentTarget.style.transform = "translateY(-1px)";
        e.currentTarget.style.boxShadow = isPrimary
          ? "0 2px 4px rgba(37,99,235,0.3), 0 10px 22px -8px rgba(37,99,235,0.55)"
          : "0 4px 12px -4px rgba(15,23,42,0.12)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = isPrimary
          ? "0 1px 2px rgba(37,99,235,0.25), 0 6px 16px -8px rgba(37,99,235,0.45)"
          : "0 1px 2px rgba(15,23,42,0.04)";
      }}
    >
      {loading && (
        <span aria-hidden style={{
          width: 12, height: 12, borderRadius: "50%",
          border: `2px solid ${isPrimary ? "rgba(255,255,255,0.4)" : "rgba(15,23,42,0.15)"}`,
          borderTopColor: isPrimary ? "#fff" : "#0f172a",
          animation: "spin 0.7s linear infinite",
        }} />
      )}
      <span>{children}</span>
    </button>
  );
}

function RestoreConfirmModal({ target, busy, onConfirm, onCancel }: {
  target: { path: string; type: string; size: number; created_at?: string };
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const valid = text.trim() === "RESTORE";
  const tc = typeColor(target.type);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      onClick={onCancel}
      dir="rtl"
      style={{
        position: "fixed", inset: 0, background: "rgba(15,23,42,0.7)", backdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 8,
        animation: "fade-in 0.2s ease-out",
      }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "#fff", borderRadius: 16, width: "100%", maxWidth: 520,
        boxShadow: "0 25px 60px -12px rgba(0,0,0,0.45)", overflow: "hidden",
        animation: "scale-in 0.2s ease-out",
      }}>
        <div style={{
          padding: "16px 18px", background: "linear-gradient(135deg,#7f1d1d,#b91c1c)", color: "#fff",
          display: "flex", alignItems: "center", gap: 12,
        }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12, background: "rgba(255,255,255,0.15)",
            display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 22,
          }}>⚠️</div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16 }}>تحذير: استعادة بيانات</div>
            <div style={{ fontSize: 12, color: "#fecaca", marginTop: 2 }}>عملية لا يمكن التراجع عنها بسهولة</div>
          </div>
        </div>
        <div style={{ padding: "18px 18px 8px" }}>
          <p style={{ margin: 0, fontSize: 13, color: "#334155", lineHeight: 1.7 }}>
            سيتم إنشاء <strong>نسخة طوارئ تلقائيًا</strong>، ثم استبدال جميع البيانات الحالية بمحتوى النسخة المختارة.
            هذه العملية ستؤثر على كل المستخدمين فورًا.
          </p>
          <div style={{
            marginTop: 12, padding: 10, borderRadius: 10, background: "#f8fafc", border: "1px solid #e2e8f0",
            display: "grid", gap: 4, fontSize: 12, color: "#475569",
          }}>
            <div><span style={{ color: "#94a3b8" }}>النوع:</span> <span style={{ fontWeight: 700, color: tc.fg }}>{TYPE_LABELS_AR[target.type] ?? target.type}</span></div>
            <div><span style={{ color: "#94a3b8" }}>الحجم:</span> <span style={{ fontWeight: 700, color: "#0f172a" }}>{fmtBytes(target.size)}</span></div>
            {target.created_at && (
              <div><span style={{ color: "#94a3b8" }}>التاريخ:</span> <span style={{ fontWeight: 700, color: "#0f172a" }}>{new Date(target.created_at).toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" })}</span></div>
            )}
          </div>
          <div style={{ marginTop: 14 }}>
            <label style={{ fontSize: 12, color: "#475569", fontWeight: 600 }}>
              للتأكيد، اكتب <span style={{ color: "#b91c1c", fontFamily: "monospace", fontWeight: 800 }}>RESTORE</span> في الحقل أدناه:
            </label>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              autoFocus
              placeholder="RESTORE"
              dir="ltr"
              style={{
                width: "100%", marginTop: 8, padding: "10px 12px", border: `2px solid ${valid ? "#16a34a" : "#e2e8f0"}`,
                borderRadius: 10, fontSize: 14, fontFamily: "monospace", letterSpacing: 1,
                outline: "none", transition: "border-color 0.2s",
              }}
            />
          </div>
        </div>
        <div style={{
          padding: "12px 18px 16px", display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap",
        }}>
          <button onClick={onCancel} disabled={busy} style={{
            padding: "9px 18px", border: "1px solid #cbd5e1", background: "#fff",
            borderRadius: 8, cursor: "pointer", fontWeight: 600, color: "#334155",
          }}>إلغاء</button>
          <button onClick={onConfirm} disabled={!valid || busy} style={{
            padding: "9px 18px", border: "none",
            background: !valid || busy ? "#fca5a5" : "#dc2626",
            color: "#fff", borderRadius: 8, cursor: !valid || busy ? "not-allowed" : "pointer",
            fontWeight: 700, transition: "background 0.2s",
          }}>{busy ? "جارٍ الاستعادة..." : "تأكيد الاستعادة"}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ============================================================
// Production Cleanup — admin-only pre-release wipe of demo data.
// ============================================================
function ProductionCleanupTab() {
  const prod = isProdEnv();
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <EnvironmentDiagnosticsCard />
      {prod ? (
        <div className="card" style={{ padding: 16, display: "flex", gap: 12, alignItems: "flex-start", background: "#F0FDF4", border: "1px solid #BBF7D0" }}>
          <ShieldCheck size={20} color="#166534" style={{ marginTop: 2 }} />
          <div style={{ fontSize: 13, color: "#14532D", lineHeight: 1.7 }}>
            <b>وضع الإنتاج مُفعّل.</b> تم تعطيل مولّد البيانات التجريبية وأدوات التهيئة الخطرة تلقائيًا لحماية بيانات العميل.
          </div>
        </div>
      ) : (
        <>
          <ProductionWizardCard />
          <DemoDataCleanupCard />
        </>
      )}
    </div>
  );
}

function EnvironmentDiagnosticsCard() {
  const d = getBackendDiagnostics();
  const isProd = d.env === "production";
  const envColor = isProd ? { bg: "#DCFCE7", fg: "#14532D", bd: "#86EFAC" } : { bg: "#FEF3C7", fg: "#78350F", bd: "#FDE68A" };

  const rows: { label: string; value: string; mono?: boolean }[] = [
    { label: "البيئة", value: isProd ? "Production" : "Development" },
    { label: "Hostname", value: d.hostname || "—", mono: true },
    { label: "Supabase URL", value: d.supabaseUrl || "—", mono: true },
    { label: "Database / Project ID", value: d.projectId || "—", mono: true },
    { label: "Auth Namespace", value: d.authNamespace || "—", mono: true },
    { label: "Storage Buckets", value: d.storageBuckets.join("، ") || "—" },
    { label: "PROD Project ID (متوقّع)", value: d.productionProjectId || "غير مُهيّأ" },
  ];

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ padding: "14px 16px", borderBottom: "1px solid #E5E7EB", display: "flex", alignItems: "center", gap: 10 }}>
        <Database size={18} color="#0F1F44" />
        <div style={{ fontSize: 16, fontWeight: 800, color: "#0F1F44" }}>تشخيص البيئة وعزل قاعدة البيانات</div>
        <span style={{ marginInlineStart: "auto", fontSize: 11, fontWeight: 800, color: envColor.fg, background: envColor.bg, border: `1px solid ${envColor.bd}`, padding: "3px 10px", borderRadius: 999 }}>
          {isProd ? "PRODUCTION" : "DEVELOPMENT"}
        </span>
      </div>

      {d.isSharedWithProduction && (
        <div style={{ padding: 14, background: "#FEF2F2", borderBottom: "1px solid #FECACA", display: "flex", gap: 12, alignItems: "flex-start" }}>
          <AlertTriangle size={18} color="#B91C1C" style={{ marginTop: 2, flexShrink: 0 }} />
          <div style={{ fontSize: 13, color: "#7F1D1D", lineHeight: 1.7 }}>
            <b>تحذير حرج:</b> بيئة التطوير الحالية تشير إلى نفس قاعدة بيانات الإنتاج. يجب فصلهما فورًا — أي حذف أو إنشاء هنا سيؤثر على بيانات الإنتاج الفعلية.
          </div>
        </div>
      )}

      <div style={{ padding: 16, display: "grid", gap: 8 }}>
        {rows.map((r) => (
          <div key={r.label} style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 12, fontSize: 13, padding: "8px 0", borderBottom: "1px solid #F3F4F6" }}>
            <div style={{ color: "#6B7280", fontWeight: 600 }}>{r.label}</div>
            <div style={{ color: "#111827", fontFamily: r.mono ? "ui-monospace, SFMono-Regular, Menlo, monospace" : undefined, wordBreak: "break-all" }}>{r.value}</div>
          </div>
        ))}
        <div style={{ marginTop: 6, fontSize: 12, color: "#6B7280", lineHeight: 1.7 }}>
          العزل الكامل يتطلب أن يكون لكل بيئة <b>Project ID</b> مختلف، مما يعني تلقائيًا قواعد بيانات وتخزين ومستخدمين وجلسات منفصلة. لتعريف مشروع الإنتاج المتوقّع للمقارنة، اضبط المتغير <code style={{ background: "#F3F4F6", padding: "1px 6px", borderRadius: 4 }}>VITE_PRODUCTION_PROJECT_ID</code>.
        </div>
      </div>
    </div>
  );
}

function DemoDataCleanupCard() {
  const checkFn = useServerFn(checkDemoData);
  const cleanupFn = useServerFn(productionCleanup);
  const qc = useQueryClient();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["demo-data-counts"],
    queryFn: () => checkFn(),
  });
  const [withBackup, setWithBackup] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<null | Awaited<ReturnType<typeof productionCleanup>>>(null);

  const total = data?.total ?? 0;

  const labels: Record<string, string> = {
    agents: "الوكلاء",
    issuing_companies: "الشركات المصدرة",
    merchants: "التجار",
    investors: "المستثمرين",
    flights: "الرحلات",
    approvals: "الموافقات الأمنية",
    transactions: "المعاملات/المدفوعات",
    company_transactions: "معاملات الشركات",
    merchant_cash_collections: "تحصيلات التجار",
    investor_transactions: "حركات المستثمرين",
    expenses: "المصروفات",
    expense_deductions: "خصومات المصروفات",
  };

  async function doCleanup() {
    setBusy(true);
    try {
      const res = await cleanupFn({ data: { createBackup: withBackup } });
      setResult(res);
      if (res.status === "clean") {
        toast.success(`تم تنظيف النظام • ${res.totalDeleted} سجل محذوف`);
      } else {
        toast.warning(`اكتمل التنظيف مع ${res.remaining} سجلات متبقية`);
      }
      qc.invalidateQueries();
      refetch();
    } catch (e: any) {
      toast.error(e?.message || "فشل التنظيف");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ padding: "14px 16px", borderBottom: "1px solid #E5E7EB", display: "flex", alignItems: "center", gap: 10 }}>
        <Sparkles size={18} color="#0F1F44" />
        <div style={{ fontSize: 16, fontWeight: 800, color: "#0F1F44" }}>تنظيف النظام للإنتاج</div>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#065F46", background: "#D1FAE5", border: "1px solid #A7F3D0", padding: "2px 8px", borderRadius: 999 }}>
          ADMIN
        </span>
      </div>

      <div style={{ padding: 20, display: "grid", gap: 20 }}>
        <div style={{ display: "flex", gap: 12, padding: 14, background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 12, alignItems: "flex-start" }}>
          <AlertTriangle size={18} color="#B91C1C" style={{ marginTop: 2, flexShrink: 0 }} />
          <div style={{ fontSize: 13, color: "#7F1D1D", lineHeight: 1.7 }}>
            تستخدم هذه الأداة قبل تسليم النظام للعميل لإزالة جميع البيانات التجريبية الموسومة بـ <code>is_demo = true</code>.
            <br />
            يتم الحفاظ على: الهوية البصرية، إعدادات النظام، الصلاحيات، الأدوار، إعدادات النسخ الاحتياطي، وحساب المسؤول.
          </div>
        </div>

        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#0F1F44", marginBottom: 10 }}>البيانات التجريبية الحالية</div>
          {isLoading ? (
            <div style={{ color: "#94A3B8", fontSize: 13 }}>جارٍ التحميل...</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8 }}>
              {Object.entries(data?.counts ?? {}).map(([k, v]) => (
                <div key={k} style={{ padding: "10px 12px", background: v ? "#FEF3C7" : "#F8FAFC", border: `1px solid ${v ? "#FDE68A" : "#E5E7EB"}`, borderRadius: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "#475569" }}>{labels[k] || k}</span>
                  <span style={{ fontSize: 14, fontWeight: 800, color: v ? "#92400E" : "#94A3B8" }}>{v}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 10, padding: 12, background: "#F8FAFC", border: "1px solid #E5E7EB", borderRadius: 10, cursor: "pointer", fontSize: 13, color: "#334155" }}>
          <input type="checkbox" checked={withBackup} onChange={(e) => setWithBackup(e.target.checked)} />
          <span>إنشاء نسخة احتياطية طارئة قبل التنظيف (موصى به)</span>
        </label>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", paddingTop: 8, borderTop: "1px solid #F1F5F9" }}>
          <button
            onClick={() => setConfirmOpen(true)}
            disabled={busy || total === 0}
            style={{
              display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 22px", borderRadius: 10,
              background: total === 0 ? "#F1F5F9" : "#dc2626", color: total === 0 ? "#94A3B8" : "#fff",
              border: 0, fontWeight: 800, fontSize: 14,
              cursor: busy || total === 0 ? "not-allowed" : "pointer",
            }}
          >
            <Trash2 size={16} />
            <span>{busy ? "جارٍ التنظيف..." : total === 0 ? "النظام نظيف بالفعل" : `تنظيف النظام للإنتاج (${total})`}</span>
          </button>
        </div>
      </div>

      {confirmOpen && (
        <ConfirmModal
          title="تأكيد تنظيف النظام للإنتاج"
          message="سيتم حذف جميع البيانات التجريبية نهائيًا مع الحفاظ على إعدادات النظام. لا يمكن التراجع عن هذه العملية."
          confirmLabel="نعم، نظّف الآن"
          danger
          onCancel={() => setConfirmOpen(false)}
          onConfirm={async () => { setConfirmOpen(false); await doCleanup(); }}
        />
      )}

      {result && typeof document !== "undefined" && createPortal(
        <div dir="rtl" onClick={() => setResult(null)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.5)", display: "grid", placeItems: "center", zIndex: 1000, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 24, maxWidth: 520, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,.25)" }}>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#0F1F44", display: "flex", alignItems: "center", gap: 8 }}>
              <Check size={20} color="#16A34A" /> اكتمل تنظيف النظام
            </h3>
            <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 12px", background: "#ECFDF5", border: "1px solid #A7F3D0", borderRadius: 8, fontSize: 13 }}>
                <span style={{ color: "#065F46", fontWeight: 700 }}>إجمالي السجلات المحذوفة</span>
                <span style={{ fontWeight: 800, color: "#065F46" }}>{result.totalDeleted}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 12px", background: "#F8FAFC", border: "1px solid #E5E7EB", borderRadius: 8, fontSize: 13 }}>
                <span style={{ color: "#475569" }}>عدد المستخدمين المحذوفين</span>
                <span style={{ fontWeight: 800, color: "#0F1F44" }}>{result.usersDeleted}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 12px", background: "#F8FAFC", border: "1px solid #E5E7EB", borderRadius: 8, fontSize: 13 }}>
                <span style={{ color: "#475569" }}>النسخة الاحتياطية الطارئة</span>
                <span style={{ fontWeight: 800, color: result.backup.ok ? "#065F46" : "#92400E" }}>
                  {result.backup.ok ? "تم إنشاؤها" : withBackup ? "فشل الإنشاء" : "تم تخطيها"}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 12px", background: result.status === "clean" ? "#ECFDF5" : "#FEF3C7", border: `1px solid ${result.status === "clean" ? "#A7F3D0" : "#FDE68A"}`, borderRadius: 8, fontSize: 13 }}>
                <span style={{ color: "#334155", fontWeight: 700 }}>حالة النظام</span>
                <span style={{ fontWeight: 800, color: result.status === "clean" ? "#065F46" : "#92400E" }}>
                  {result.status === "clean" ? "جاهز للإنتاج ✓" : `${result.remaining} سجل متبقٍ`}
                </span>
              </div>
              <details style={{ marginTop: 6, fontSize: 12, color: "#475569" }}>
                <summary style={{ cursor: "pointer", fontWeight: 700 }}>تفاصيل لكل جدول</summary>
                <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
                  {Object.entries(result.summary).map(([k, v]) => (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "6px 10px", background: "#F8FAFC", borderRadius: 6 }}>
                      <span>{labels[k] || k}</span>
                      <span style={{ fontWeight: 700, color: "#0F1F44" }}>{v}</span>
                    </div>
                  ))}
                </div>
              </details>
            </div>
            <button onClick={() => setResult(null)} style={{ marginTop: 16, padding: "10px 18px", borderRadius: 8, border: 0, background: "#0F1F44", color: "#F5D27A", fontWeight: 700, cursor: "pointer" }}>
              تم
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

// ============================================================
// Production Wizard — selective wipe of operational data
// (works regardless of is_demo flag). Strong "CONFIRM" guard.
// ============================================================
const WIZARD_CATEGORIES: { key: WipeCategory; label: string; hint: string }[] = [
  { key: "agents", label: "الوكلاء", hint: "جدول الوكلاء" },
  { key: "companies", label: "الشركات المصدرة", hint: "الشركات + معاملاتها" },
  { key: "merchants", label: "التجار", hint: "التجار + تحصيلاتهم" },
  { key: "investors", label: "المستثمرين", hint: "المستثمرين + حركاتهم" },
  { key: "flights", label: "الرحلات", hint: "كل سجلات الرحلات" },
  { key: "approvals", label: "الموافقات الأمنية", hint: "كل الموافقات" },
  { key: "transactions", label: "المعاملات/المدفوعات", hint: "كل البيع/التحصيل" },
  { key: "collections", label: "التحصيلات", hint: "تحصيلات التجار النقدية" },
  { key: "expenses", label: "المصروفات", hint: "المصروفات + خصوماتها" },
  { key: "notifications", label: "الإشعارات وسجل النشاط", hint: "activity_logs" },
  { key: "test_users", label: "المستخدمين التجريبيين", hint: "كل من ليس admin" },
];

function ProductionWizardCard() {
  const wipeFn = useServerFn(productionWipe);
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<WipeCategory>>(new Set());
  const [withBackup, setWithBackup] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<null | Awaited<ReturnType<typeof productionWipe>>>(null);

  const allKeys = WIZARD_CATEGORIES.map((c) => c.key);
  const allSelected = allKeys.every((k) => selected.has(k));

  function toggle(k: WipeCategory) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(allKeys));
  }

  async function doWipe() {
    setBusy(true);
    try {
      const res = await wipeFn({
        data: { categories: Array.from(selected), confirm: "CONFIRM", createBackup: withBackup },
      });
      setResult(res);
      toast.success(`اكتملت تهيئة الإنتاج • ${res.totalDeleted} سجل محذوف`);
      qc.invalidateQueries();
      setSelected(new Set());
      setConfirmText("");
    } catch (e: any) {
      toast.error(e?.message || "فشلت العملية");
    } finally {
      setBusy(false);
      setConfirmOpen(false);
    }
  }

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ padding: "14px 16px", borderBottom: "1px solid #E5E7EB", display: "flex", alignItems: "center", gap: 10 }}>
        <Sparkles size={18} color="#0F1F44" />
        <div style={{ fontSize: 16, fontWeight: 800, color: "#0F1F44" }}>تهيئة نسخة الإنتاج</div>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#7F1D1D", background: "#FEE2E2", border: "1px solid #FECACA", padding: "2px 8px", borderRadius: 999 }}>
          خطر — لا رجعة
        </span>
      </div>

      <div style={{ padding: 20, display: "grid", gap: 18 }}>
        <div style={{ display: "flex", gap: 12, padding: 14, background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 12, alignItems: "flex-start" }}>
          <AlertTriangle size={18} color="#B45309" style={{ marginTop: 2, flexShrink: 0 }} />
          <div style={{ fontSize: 13, color: "#78350F", lineHeight: 1.7 }}>
            تستخدم لإزالة جميع البيانات التشغيلية المُدخلة يدويًا (حتى لو لم تكن موسومة كتجريبية) قبل تسليم النظام للعميل.
            <br />
            <b>يُحتفظ بـ:</b> حساب المسؤول، الإعدادات، الهوية البصرية، الصلاحيات، الأدوار، إعدادات النسخ الاحتياطي.
          </div>
        </div>

        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#0F1F44" }}>الفئات المراد تنظيفها</div>
            <button
              type="button"
              onClick={toggleAll}
              style={{ fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 8, border: "1px solid #0F1F44", background: allSelected ? "#0F1F44" : "#fff", color: allSelected ? "#F5D27A" : "#0F1F44", cursor: "pointer" }}
            >
              {allSelected ? "إلغاء تحديد الكل" : "حذف جميع بيانات التشغيل الحالية"}
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
            {WIZARD_CATEGORIES.map((c) => {
              const on = selected.has(c.key);
              return (
                <label key={c.key} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px", background: on ? "#EEF2FF" : "#F8FAFC", border: `1px solid ${on ? "#C7D2FE" : "#E5E7EB"}`, borderRadius: 10, cursor: "pointer" }}>
                  <input type="checkbox" checked={on} onChange={() => toggle(c.key)} style={{ marginTop: 3 }} />
                  <div style={{ display: "grid", gap: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#0F1F44" }}>{c.label}</span>
                    <span style={{ fontSize: 11, color: "#64748B" }}>{c.hint}</span>
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 10, padding: 12, background: "#F8FAFC", border: "1px solid #E5E7EB", borderRadius: 10, cursor: "pointer", fontSize: 13, color: "#334155" }}>
          <input type="checkbox" checked={withBackup} onChange={(e) => setWithBackup(e.target.checked)} />
          <span>إنشاء نسخة احتياطية طارئة قبل التنفيذ (موصى به بشدة)</span>
        </label>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", paddingTop: 8, borderTop: "1px solid #F1F5F9" }}>
          <button
            type="button"
            onClick={() => { setConfirmText(""); setConfirmOpen(true); }}
            disabled={busy || selected.size === 0}
            style={{
              display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 22px", borderRadius: 10,
              background: selected.size === 0 ? "#F1F5F9" : "#dc2626", color: selected.size === 0 ? "#94A3B8" : "#fff",
              border: 0, fontWeight: 800, fontSize: 14,
              cursor: busy || selected.size === 0 ? "not-allowed" : "pointer",
            }}
          >
            <Trash2 size={16} />
            <span>{busy ? "جارٍ التنفيذ..." : `تهيئة الإنتاج (${selected.size})`}</span>
          </button>
        </div>
      </div>

      {confirmOpen && typeof document !== "undefined" && createPortal(
        <div dir="rtl" onClick={() => !busy && setConfirmOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", display: "grid", placeItems: "center", zIndex: 1000, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 24, maxWidth: 520, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,.25)" }}>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#7F1D1D", display: "flex", alignItems: "center", gap: 8 }}>
              <AlertTriangle size={20} color="#dc2626" /> تأكيد تهيئة نسخة الإنتاج
            </h3>
            <p style={{ marginTop: 12, fontSize: 13.5, color: "#334155", lineHeight: 1.8 }}>
              سيتم حذف جميع بيانات التشغيل الحالية نهائيًا وتحويل النظام إلى نسخة Production نظيفة.
              لا يمكن التراجع عن هذه العملية.
            </p>
            <div style={{ marginTop: 10, fontSize: 12.5, color: "#475569" }}>
              الفئات المحددة:&nbsp;
              <b style={{ color: "#0F1F44" }}>
                {Array.from(selected).map((k) => WIZARD_CATEGORIES.find((c) => c.key === k)?.label).join(" • ")}
              </b>
            </div>
            <div style={{ marginTop: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}>اكتب <code style={{ background: "#FEE2E2", padding: "2px 6px", borderRadius: 4, color: "#991B1B" }}>CONFIRM</code> للمتابعة</label>
              <input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                autoFocus
                placeholder="CONFIRM"
                style={{ marginTop: 6, width: "100%", padding: "10px 12px", border: "1px solid #E5E7EB", borderRadius: 8, fontSize: 14, fontFamily: "monospace", letterSpacing: 2, textAlign: "center" }}
              />
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 18, justifyContent: "flex-end" }}>
              <button onClick={() => setConfirmOpen(false)} disabled={busy} style={{ padding: "10px 18px", borderRadius: 8, border: "1px solid #e5e7eb", fontWeight: 600, cursor: busy ? "not-allowed" : "pointer", background: "#fff", color: "#111" }}>إلغاء</button>
              <button
                onClick={doWipe}
                disabled={busy || confirmText !== "CONFIRM"}
                style={{
                  padding: "10px 18px", borderRadius: 8, border: 0, fontWeight: 800, cursor: busy || confirmText !== "CONFIRM" ? "not-allowed" : "pointer",
                  background: confirmText !== "CONFIRM" ? "#fca5a5" : "#dc2626", color: "#fff",
                }}
              >
                {busy ? "جارٍ التنفيذ..." : "تنفيذ نهائي"}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {result && typeof document !== "undefined" && createPortal(
        <div dir="rtl" onClick={() => setResult(null)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.5)", display: "grid", placeItems: "center", zIndex: 1000, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 24, maxWidth: 560, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,.25)" }}>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#0F1F44", display: "flex", alignItems: "center", gap: 8 }}>
              <Check size={20} color="#16A34A" /> اكتملت تهيئة نسخة الإنتاج
            </h3>
            <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 12px", background: "#ECFDF5", border: "1px solid #A7F3D0", borderRadius: 8, fontSize: 13 }}>
                <span style={{ color: "#065F46", fontWeight: 700 }}>إجمالي السجلات المحذوفة</span>
                <span style={{ fontWeight: 800, color: "#065F46" }}>{result.totalDeleted}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 12px", background: "#F8FAFC", border: "1px solid #E5E7EB", borderRadius: 8, fontSize: 13 }}>
                <span style={{ color: "#475569" }}>المستخدمون التجريبيون المحذوفون</span>
                <span style={{ fontWeight: 800, color: "#0F1F44" }}>{result.usersDeleted}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 12px", background: "#F8FAFC", border: "1px solid #E5E7EB", borderRadius: 8, fontSize: 13 }}>
                <span style={{ color: "#475569" }}>النسخة الاحتياطية الطارئة</span>
                <span style={{ fontWeight: 800, color: result.backup.ok ? "#065F46" : "#92400E" }}>
                  {result.backup.ok ? "تم إنشاؤها" : (result.backup.error ? "فشل: " + result.backup.error : "تم تخطيها")}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 12px", background: result.status === "clean" ? "#ECFDF5" : "#FEF3C7", border: `1px solid ${result.status === "clean" ? "#A7F3D0" : "#FDE68A"}`, borderRadius: 8, fontSize: 13 }}>
                <span style={{ color: "#334155", fontWeight: 700 }}>حالة النظام بعد التنفيذ</span>
                <span style={{ fontWeight: 800, color: result.status === "clean" ? "#065F46" : "#92400E" }}>
                  {result.status === "clean" ? "نظيف وجاهز للإنتاج ✓" : `${result.remainingTotal} سجل متبقٍ`}
                </span>
              </div>
              <details style={{ marginTop: 6, fontSize: 12, color: "#475569" }}>
                <summary style={{ cursor: "pointer", fontWeight: 700 }}>تفاصيل الحذف لكل جدول</summary>
                <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
                  {Object.entries(result.summary).map(([k, v]) => (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "6px 10px", background: "#F8FAFC", borderRadius: 6 }}>
                      <span>{k}</span>
                      <span style={{ fontWeight: 700, color: "#0F1F44" }}>{v}</span>
                    </div>
                  ))}
                </div>
              </details>
            </div>
            <button onClick={() => { setResult(null); window.location.reload(); }} style={{ marginTop: 16, padding: "10px 18px", borderRadius: 8, border: 0, background: "#0F1F44", color: "#F5D27A", fontWeight: 700, cursor: "pointer" }}>
              تحديث النظام
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
