import { useLocation, useRouter } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";
import {
  ROUTE_PERM,
  checkPerm,
  checkSettingsPerm,
  firstAllowedRoute,
} from "@/hooks/usePerm";
import { ShieldAlert } from "lucide-react";

function resolveSectionKey(path: string): string | null | undefined {
  if (path in ROUTE_PERM) return ROUTE_PERM[path];
  if (path.startsWith("/agent-statement")) return "accounts";
  if (path.startsWith("/currency-supplier-statement")) return "currency_suppliers";
  return null;
}

/**
 * Renders an "unauthorized" screen when the current route's permission is
 * denied. Otherwise renders children. Each section's permission only blocks
 * that section's own route — no cross-section coupling.
 */
export default function RouteGuard({ children }: { children: React.ReactNode }) {
  const loc = useLocation();
  const router = useRouter();
  const { permissions, isAdmin, isSuperAdmin, loading, session } = useAuth();

  if (loading || !session) return <>{children}</>;
  const path = loc.pathname;

  let allowed = true;
  if (path === "/settings" || path.startsWith("/settings/")) {
    allowed = checkSettingsPerm(permissions, isSuperAdmin, "view");
  } else {
    const key = resolveSectionKey(path);
    allowed = checkPerm(permissions, isAdmin, key, "view");
  }

  if (allowed) return <>{children}</>;

  const fallback = firstAllowedRoute(permissions, isAdmin, isSuperAdmin);

  return (
    <div
      dir="rtl"
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "var(--surface, #f5f7fb)",
      }}
    >
      <div
        style={{
          background: "#fff",
          padding: 32,
          borderRadius: 16,
          maxWidth: 460,
          width: "100%",
          textAlign: "center",
          boxShadow: "0 8px 30px rgba(0,0,0,.08)",
          border: "1px solid var(--border, #e5e7eb)",
        }}
      >
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: "50%",
            background: "#fef2f2",
            display: "grid",
            placeItems: "center",
            margin: "0 auto 16px",
            color: "#dc2626",
          }}
        >
          <ShieldAlert size={32} strokeWidth={2} />
        </div>
        <h2 style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 800, color: "#0f172a" }}>
          غير مصرح لك بالدخول
        </h2>
        <p style={{ marginTop: 0, color: "#6b7280", fontSize: 14, lineHeight: 1.7 }}>
          لا تملك صلاحية الوصول إلى هذا القسم. يرجى التواصل مع المسؤول لمنحك الصلاحية المناسبة.
        </p>
        {fallback && fallback !== path && (
          <button
            onClick={() => router.navigate({ to: fallback })}
            style={{
              marginTop: 18,
              padding: "12px 20px",
              borderRadius: 10,
              background: "var(--primary, #0F1B3D)",
              color: "#fff",
              border: 0,
              fontWeight: 700,
              cursor: "pointer",
              fontSize: 14,
            }}
            type="button"
          >
            العودة للقسم المتاح
          </button>
        )}
      </div>
    </div>
  );
}
