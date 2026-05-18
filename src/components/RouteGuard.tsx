import { useEffect } from "react";
import { useLocation, useRouter } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";
import { ROUTE_PERM, checkPerm, checkSettingsPerm, firstAllowedRoute } from "@/hooks/usePerm";

export default function RouteGuard() {
  const loc = useLocation();
  const router = useRouter();
  const { permissions, isAdmin, isSuperAdmin, loading, session } = useAuth();

  useEffect(() => {
    if (loading || !session) return;
    const path = loc.pathname;

    // Settings is gated by settings.view (NOT admin role)
    if (path === "/settings" || path.startsWith("/settings/")) {
      if (!checkSettingsPerm(permissions, isSuperAdmin, "view")) {
        const dest = firstAllowedRoute(permissions, isAdmin, isSuperAdmin);
        if (dest && dest !== path) router.navigate({ to: dest });
      }
      return;
    }

    // Resolve which section this path belongs to
    let key: string | null | undefined = ROUTE_PERM[path];
    if (key === undefined) {
      if (path.startsWith("/agent-statement")) key = "accounts";
      else key = null;
    }

    if (!checkPerm(permissions, isAdmin, key, "view")) {
      const dest = firstAllowedRoute(permissions, isAdmin, isSuperAdmin);
      if (dest && dest !== path) router.navigate({ to: dest });
    }
  }, [loc.pathname, permissions, isAdmin, isSuperAdmin, loading, session, router]);

  return null;
}
