import { useEffect } from "react";
import { useLocation, useRouter } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";
import { ROUTE_PERM, checkPerm, firstAllowedRoute } from "@/hooks/usePerm";

/**
 * Watches current route + permissions; if user lacks `view` for the section
 * mapped to the current path, redirect them to the first allowed route.
 * Admin/settings handled separately.
 */
export default function RouteGuard() {
  const loc = useLocation();
  const router = useRouter();
  const { permissions, isAdmin, loading, session } = useAuth();

  useEffect(() => {
    if (loading || !session) return;
    const path = loc.pathname;

    // Settings is admin-only
    if (path === "/settings" || path.startsWith("/settings/")) {
      if (!isAdmin) {
        const dest = firstAllowedRoute(permissions, isAdmin);
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
      const dest = firstAllowedRoute(permissions, isAdmin);
      if (dest && dest !== path) router.navigate({ to: dest });
    }
  }, [loc.pathname, permissions, isAdmin, loading, session, router]);

  return null;
}
