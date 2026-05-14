import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";

import appCss from "../styles.css?url";
const INITIAL_FAVICON_VERSION = "2";

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
      { title: "نظام إدارة شركة السفر" },
      { name: "description", content: "نظام إدارة الوكلاء والرحلات والموافقات والحسابات" },
      { name: "author", content: "العربي للخدمات السياحية" },
      { property: "og:title", content: "نظام إدارة شركة السفر" },
      { property: "og:description", content: "إدارة الوكلاء والرحلات والموافقات والحسابات" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/x-icon", href: `/favicon.ico?v=${INITIAL_FAVICON_VERSION}` },
      { rel: "icon", type: "image/png", href: `/favicon.png?v=${INITIAL_FAVICON_VERSION}` },
      { rel: "apple-touch-icon", href: `/apple-touch-icon.png?v=${INITIAL_FAVICON_VERSION}` },
      { rel: "shortcut icon", type: "image/x-icon", href: `/favicon.ico?v=${INITIAL_FAVICON_VERSION}` },
      { rel: "manifest", href: `/manifest.json?v=${INITIAL_FAVICON_VERSION}` },
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
import Login from "../components/Login";
import SetPassword from "../components/SetPassword";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "../hooks/useAuth";
import { useEffect } from "react";
import { installServerFnAuthFetch } from "../lib/serverFnAuth";
import { loadBranding, applyBrandingCssVars, useBrandingReady, BRAND_NAVY, BRAND_GOLD } from "../lib/branding";

function SplashScreen() {
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
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: "50%",
            border: `4px solid rgba(15,27,61,.12)`,
            borderTopColor: BRAND_NAVY,
            animation: "brand-spin 0.9s linear infinite",
          }}
        />
        <div style={{ height: 3, width: 56, background: BRAND_GOLD, borderRadius: 2 }} />
      </div>
      <style>{`@keyframes brand-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function AuthGate() {
  const { session, loading, profileLoaded, needsPassword, blocked, setPasswordDone } = useAuth();
  const brandingReady = useBrandingReady();
  useEffect(() => { installServerFnAuthFetch(); }, []);
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

  if (!brandingReady) return <SplashScreen />;
  if (loading) return <SplashScreen />;
  if (!session) return <Login />;
  if (needsPassword) return <SetPassword onDone={setPasswordDone} />;
  if (blocked) return <Login />;
  if (!profileLoaded) return <SplashScreen />;
  return (<><RouteGuard /><Layout /><ScreenshotTool /></>);
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AuthGate />
        <Toaster position="top-center" dir="rtl" richColors />
      </AuthProvider>
    </QueryClientProvider>
  );
}
