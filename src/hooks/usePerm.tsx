import { useAuth } from "@/hooks/useAuth";

export type PermAction = "view" | "create" | "edit" | "delete" | "export";

export const ALL_ACTIONS: PermAction[] = ["view", "create", "edit", "delete", "export"];

export const SECTION_KEYS = [
  "dashboard",
  "agents",
  "flights",
  "approvals",
  "accounts",
  "expenses",
  "reports",
  "companies",
  "merchants",
  "investors",
] as const;

// Map route path -> permission section key (null = always allowed)
export const ROUTE_PERM: Record<string, string | null> = {
  "/": "dashboard",
  "/flights": "flights",
  "/approvals": "approvals",
  "/accounts": "accounts",
  "/companies": "companies",
  "/merchants": "merchants",
  "/investors": "investors",
  "/expenses": "expenses",
  "/reports": "reports",
};

export function checkPerm(
  perms: Record<string, any> | undefined | null,
  isAdmin: boolean,
  section: string | null | undefined,
  action: PermAction = "view",
): boolean {
  if (isAdmin) return true;
  if (!section) return true;
  const v = perms?.[section];
  if (v === true) return true; // legacy boolean = all actions
  if (!v) return false;
  if (typeof v === "object") {
    // If view requested and object lacks explicit view, allow when any action true
    if (action === "view") {
      if (v.view === true) return true;
      if (v.view === false) return false;
      return ALL_ACTIONS.some((a) => v[a] === true);
    }
    return v[action] === true;
  }
  return false;
}

export function usePerm(section: string | null | undefined) {
  const { permissions, isAdmin } = useAuth();
  return {
    view: checkPerm(permissions, isAdmin, section, "view"),
    create: checkPerm(permissions, isAdmin, section, "create"),
    edit: checkPerm(permissions, isAdmin, section, "edit"),
    delete: checkPerm(permissions, isAdmin, section, "delete"),
    export: checkPerm(permissions, isAdmin, section, "export"),
    isAdmin,
  };
}

export function firstAllowedRoute(
  perms: Record<string, any> | undefined | null,
  isAdmin: boolean,
): string | null {
  for (const [route, key] of Object.entries(ROUTE_PERM)) {
    if (checkPerm(perms, isAdmin, key, "view")) return route;
  }
  return null;
}
