// Runtime environment detection and diagnostics for safe DEV/PROD separation.
// Backend identity comes from build-time Vite env vars (the Supabase project
// the bundle is wired to). If two environments share the same project ID,
// they share the same database — we surface that as a critical warning.

export type AppEnv = "production" | "development";

function readHostname(): string {
  if (typeof window === "undefined") return "";
  return window.location.hostname.toLowerCase();
}

// This project is the DEVELOPMENT environment. It has its own Supabase
// project (database / auth / storage) — fully isolated from Production.
// We force-mark it as DEV so badges, demo tools, and cleanup wizards stay on.
const DEV_PROJECT_ID = "lioqalbrhfrbtqgzwnzm";

export function detectAppEnv(): AppEnv {
  const override = (import.meta.env.VITE_APP_ENV as string | undefined)?.toLowerCase();
  if (override === "production" || override === "development") return override;

  // Hard pin: this project's Supabase ref is the DEV backend.
  // Any OTHER Supabase project (i.e. a remixed Production clone with its own
  // Cloud backend) defaults to production unless explicitly overridden.
  const projectId =
    (import.meta.env.VITE_SUPABASE_PROJECT_ID as string | undefined) ?? "";
  if (projectId && projectId === DEV_PROJECT_ID) return "development";
  if (projectId && projectId !== DEV_PROJECT_ID) return "production";

  // No project ID available — fall back to hostname heuristics.
  const host = readHostname();
  if (!host) return "development";
  if (host === "localhost" || host.endsWith(".localhost") || host.startsWith("127.")) {
    return "development";
  }
  if (host.includes("id-preview--") || host.includes("-dev.lovable.app") || host.includes(".lovable.dev")) {
    return "development";
  }
  return "production";
}

export function isDevEnv(): boolean {
  return detectAppEnv() === "development";
}

export function isProdEnv(): boolean {
  return detectAppEnv() === "production";
}

export interface BackendDiagnostics {
  env: AppEnv;
  hostname: string;
  supabaseUrl: string;
  projectId: string;
  authNamespace: string; // Supabase project ref doubles as the auth namespace
  storageBuckets: string[]; // known buckets shipped with the app
  productionProjectId: string | null; // expected PROD project (if configured)
  isSharedWithProduction: boolean; // critical: DEV pointing at PROD backend
}

export function getBackendDiagnostics(): BackendDiagnostics {
  const env = detectAppEnv();
  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
  const projectId =
    (import.meta.env.VITE_SUPABASE_PROJECT_ID as string | undefined) ??
    supabaseUrl.match(/https?:\/\/([^.]+)\./)?.[1] ??
    "";
  const productionProjectId =
    (import.meta.env.VITE_PRODUCTION_PROJECT_ID as string | undefined) ?? null;

  const isSharedWithProduction =
    env === "development" &&
    !!productionProjectId &&
    !!projectId &&
    productionProjectId === projectId;

  return {
    env,
    hostname: readHostname(),
    supabaseUrl,
    projectId,
    authNamespace: projectId,
    storageBuckets: ["system-backups", "company-assets"],
    productionProjectId,
    isSharedWithProduction,
  };
}
