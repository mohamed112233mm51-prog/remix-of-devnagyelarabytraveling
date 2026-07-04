import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { installStartupSafety } from "@/lib/startupSafety";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  ScriptOnce,
} from "@tanstack/react-router";

import appCss from "../styles.css?url";
import { useEffect, useState } from "react";
import { FIXED_FAVICON_HREF, FIXED_SHORTCUT_HREF, FIXED_MANIFEST_HREF, getFaviconBootScript } from "@/lib/favicon";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "العربى للخدمات السياحيه" },
      { name: "description", content: "نظام إدارة الوكلاء والرحلات والموافقات والحسابات" },
      { name: "author", content: "العربي للخدمات السياحية" },
      { property: "og:title", content: "العربى للخدمات السياحيه" },
      { property: "og:description", content: "نظام إدارة الوكلاء والرحلات والموافقات والحسابات" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "العربى للخدمات السياحيه" },
      { name: "twitter:description", content: "نظام إدارة الوكلاء والرحلات والموافقات والحسابات" },
      { property: "og:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/8eXJTguD3Sfx2iDE2AEFNtqTKZH3/social-images/social-1782164251785-1000480094.webp" },
      { name: "twitter:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/8eXJTguD3Sfx2iDE2AEFNtqTKZH3/social-images/social-1782164251785-1000480094.webp" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: FIXED_MANIFEST_HREF },
      { rel: "icon", type: "image/png", href: FIXED_FAVICON_HREF },
      { rel: "shortcut icon", href: FIXED_SHORTCUT_HREF },
      { rel: "apple-touch-icon", href: FIXED_FAVICON_HREF },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <ScriptOnce children={getFaviconBootScript()} />
        <link
          href="https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;500;600;700;900&family=Tajawal:wght@300;400;500;700;900&display=swap"
          rel="stylesheet"
        />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

import Layout from "../components/Layout";
import ScreenshotTool from "../components/ScreenshotTool";
import RouteGuard from "../components/RouteGuard";
import { AppErrorBoundary } from "../components/AppErrorBoundary";
import Login from "../components/Login";
import SetPassword from "../components/SetPassword";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "../hooks/useAuth";
import { useGlobalKeyboardNav } from "../hooks/useKeyboardNav";
import { ConfirmSaveModalHost } from "../components/ConfirmSaveModal";
import { installServerFnAuthFetch } from "../lib/serverFnAuth";
import { loadBranding, applyBrandingCssVars, useBrandingReady, BRAND_NAVY, BRAND_GOLD } from "../lib/branding";

function SplashScreen(_props: { stage?: string; warning?: string }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    return () => {};
  }, []);
  if (!visible) return null;
  return (
    <div
      dir="rtl"
      style={{
        position: "fixed",
        inset: 0,
        display: "grid",
        placeItems: "center",
        background: "linear-gradient(135deg,#f5f7fb 0%,#e8ecf4 100%)",
        zIndex: 9999,
      }}
    >
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: "50%",
          border: `3px solid rgba(15,27,61,.12)`,
          borderTopColor: BRAND_NAVY,
          animation: "brand-spin 0.7s linear infinite",
        }}
      />
      <style>{`@keyframes brand-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function AuthGate() {
  const { session, loading, profileLoaded, profileError, needsPassword, blocked, setPasswordDone, refreshProfile } = useAuth();
  const brandingReady = useBrandingReady();
  useGlobalKeyboardNav();
  useEffect(() => { installStartupSafety(); installServerFnAuthFetch(); import("@/lib/dragScroll").then(m => m.installDragScroll()).catch(() => {}); }, []);
  useEffect(() => { loadBranding().then(applyBrandingCssVars).catch(() => {}); }, []);
  useEffect(() => { if (!loading) loadBranding().then(applyBrandingCssVars).catch(() => {}); }, [loading, session?.user?.id]);

  // Public route: invite acceptance must work without admin login
  const pathname = typeof window !== "undefined" ? window.location.pathname : "";
  const hash = typeof window !== "undefined" ? window.location.hash : "";
  const search = typeof window !== "undefined" ? window.location.search : "";
  const isRecoveryFlow = pathname === "/reset-password" || hash.includes("type=recovery") || (pathname === "/reset-password" && search.includes("code="));
  const isInviteFlow = pathname === "/accept-invite" || hash.includes("type=invite");
  if (isRecoveryFlow) {
    if (pathname !== "/reset-password" && typeof window !== "undefined") {
      window.history.replaceState(null, "", "/reset-password" + hash);
    }
    return <Outlet />;
  }
  if (isInviteFlow) {
    if (pathname !== "/accept-invite" && typeof window !== "undefined") {
      window.history.replaceState(null, "", "/accept-invite" + hash);
    }
    return <Outlet />;
  }

  if (!brandingReady) return <SplashScreen stage="Branding" />;
  if (loading) return <SplashScreen stage="Auth" />;
  if (!session) return <Login />;
  if (needsPassword) return <SetPassword onDone={setPasswordDone} />;
  if (blocked) return <Login />;
  if (profileError && !profileLoaded) return <ProfileErrorScreen message={profileError} onRetry={refreshProfile} />;
  if (!profileLoaded) return <SplashScreen stage="Profile / Permissions" />;
  return (<RouteGuard><Layout /></RouteGuard>);
}

function ProfileErrorScreen({ message, onRetry }: { message: string; onRetry: () => void | Promise<void> }) {
  return (
    <div dir="rtl" style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "var(--surface, #f5f7fb)" }}>
      <div style={{ background: "#fff", padding: 28, borderRadius: 14, maxWidth: 460, width: "100%", textAlign: "center", border: "1px solid var(--border, #e5e7eb)", boxShadow: "0 8px 30px rgba(0,0,0,.06)" }}>
        <h2 style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 800, color: "#0f172a" }}>تعذر تحميل بياناتك</h2>
        <p style={{ margin: "0 0 16px", color: "#6b7280", fontSize: 13, lineHeight: 1.7 }}>{message}</p>
        <button onClick={() => onRetry()} style={{ padding: "10px 18px", borderRadius: 10, background: "var(--primary, #0F1B3D)", color: "#fff", border: 0, fontWeight: 700, cursor: "pointer", fontSize: 13 }} type="button">
          إعادة المحاولة
        </button>
      </div>
    </div>
  );
}


function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <AppErrorBoundary name="RootApp">
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <AuthGate />
          <ConfirmSaveModalHost />
          <Toaster position="top-center" dir="rtl" richColors />
        </AuthProvider>
      </QueryClientProvider>
    </AppErrorBoundary>
  );
}
