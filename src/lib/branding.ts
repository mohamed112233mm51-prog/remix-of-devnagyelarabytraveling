import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import defaultLogo from "@/assets/company-logo.png";
import { applyFavicon } from "./favicon";

export const DEFAULT_COMPANY_NAME = "العربي للخدمات السياحية";
export const BRAND_NAVY = "#0F1B3D";
export const BRAND_GOLD = "#C9A84C";
export const BRAND_TEAL = "#0D9488";

export type Branding = {
  logoUrl: string;       // suitable for <img src>
  logoDataUrl: string;   // data:URL (also fine for <img src>); for exports
  faviconUrl: string;    // raw uploaded favicon URL, before runtime cache busting
  iconUrl: string;       // square icon for favicon/PWA (data URL)
  iconDataUrl: string;   // alias of iconUrl, kept for clarity
  companyName: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  hasCustomLogo: boolean;
  hasCustomIcon: boolean;
  updatedAt: string;     // ISO-ish timestamp for cache busting
  faviconUpdatedAt: string;
};

const STORAGE_KEY = "app.branding.v1";

let cache: Branding | null = null;
let ready = false;
const listeners = new Set<(b: Branding) => void>();
const readyListeners = new Set<() => void>();

const fallback: Branding = {
  logoUrl: defaultLogo as unknown as string,
  logoDataUrl: defaultLogo as unknown as string,
  faviconUrl: "",
  iconUrl: defaultLogo as unknown as string,
  iconDataUrl: defaultLogo as unknown as string,
  companyName: DEFAULT_COMPANY_NAME,
  primaryColor: BRAND_NAVY,
  secondaryColor: BRAND_GOLD,
  accentColor: BRAND_TEAL,
  hasCustomLogo: false,
  hasCustomIcon: false,
  updatedAt: "0",
  faviconUpdatedAt: "0",
};

// Hydrate synchronously from localStorage on module load to avoid logo flash.
if (typeof window !== "undefined") {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Branding;
      if (parsed && parsed.logoDataUrl) {
        cache = { ...fallback, ...parsed };
        ready = true;
      }
    }
  } catch {}
}

function persist(b: Branding) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(b)); } catch {}
}

export function isBrandingReady(): boolean {
  return ready;
}

export function onBrandingReady(cb: () => void): () => void {
  if (ready) { cb(); return () => {}; }
  readyListeners.add(cb);
  return () => readyListeners.delete(cb);
}

async function fetchAsDataUrl(url: string): Promise<string> {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ""));
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  } catch {
    return url;
  }
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([a-f\d]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function applyBrandingCssVars(b: Branding) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.setProperty("--brand-primary", b.primaryColor);
  root.style.setProperty("--brand-secondary", b.secondaryColor);
  root.style.setProperty("--brand-accent", b.accentColor);
  const p = hexToRgb(b.primaryColor);
  if (p) root.style.setProperty("--brand-primary-rgb", `${p.r}, ${p.g}, ${p.b}`);
  const s = hexToRgb(b.secondaryColor);
  if (s) root.style.setProperty("--brand-secondary-rgb", `${s.r}, ${s.g}, ${s.b}`);

  // Favicon is fixed system-wide; do not override from branding/app_settings.
  void applyFavicon;
}

/**
 * Crop the logo to a centered square so it renders well as a tiny favicon.
 * Returns a data URL (PNG, transparent). Falls back to "" on failure.
 */
async function deriveSquareIcon(logoSrc: string): Promise<string> {
  if (typeof document === "undefined" || !logoSrc) return "";
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.crossOrigin = "anonymous";
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = logoSrc;
    });
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) return "";
    const size = Math.min(w, h);
    const sx = Math.max(0, (w - size) / 2);
    const sy = Math.max(0, (h - size) / 2);
    const out = 256;
    const canvas = document.createElement("canvas");
    canvas.width = out;
    canvas.height = out;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, sx, sy, size, size, 0, 0, out, out);
    return canvas.toDataURL("image/png");
  } catch {
    return "";
  }
}

export async function loadBranding(force = false): Promise<Branding> {
  if (cache && ready && !force) {
    applyBrandingCssVars(cache);
    return cache;
  }
  try {
    const { data } = await supabase
      .from("app_settings")
      .select("key,value,updated_at")
      .in("key", [
        "company_logo",
        "company_icon",
        "favicon_url",
        "favicon_updated_at",
        "company_name",
        "brand_primary",
        "brand_secondary",
        "brand_accent",
      ]);
    const map: Record<string, any> = {};
    const updatedMap: Record<string, string> = {};
    (data || []).forEach((r: any) => {
      map[r.key] = r.value?.v ?? "";
      updatedMap[r.key] = r.updated_at || "";
    });
    const logo = (map.company_logo as string) || "";
    const icon = (map.favicon_url as string) || (map.company_icon as string) || "";
    const faviconUpdatedAt = (map.favicon_updated_at as string) || updatedMap.favicon_url || updatedMap.company_icon || updatedMap.company_logo || new Date().toISOString();
    const name = (map.company_name as string) || DEFAULT_COMPANY_NAME;
    const primary = (map.brand_primary as string) || BRAND_NAVY;
    const secondary = (map.brand_secondary as string) || BRAND_GOLD;
    const accent = (map.brand_accent as string) || BRAND_TEAL;

    let logoData = "";
    let logoUrl = "";
    if (logo && logo.startsWith("data:")) {
      logoData = logo;
      logoUrl = logo;
    } else if (logo) {
      logoUrl = logo;
      logoData = await fetchAsDataUrl(logo);
    } else {
      logoUrl = cache?.logoUrl || fallback.logoUrl;
      logoData = cache?.logoDataUrl || await fetchAsDataUrl(fallback.logoUrl);
    }

    // Resolve icon: dedicated upload > square-cropped logo > logo as-is
    let iconData = "";
    if (icon && icon.startsWith("data:")) iconData = icon;
    else if (icon) iconData = await fetchAsDataUrl(icon);
    else iconData = await deriveSquareIcon(logoData) || logoData;

    cache = {
      logoUrl,
      logoDataUrl: logoData,
      faviconUrl: icon,
      iconUrl: iconData,
      iconDataUrl: iconData,
      companyName: name,
      primaryColor: primary,
      secondaryColor: secondary,
      accentColor: accent,
      hasCustomLogo: !!logo,
      hasCustomIcon: !!icon,
      updatedAt: faviconUpdatedAt,
      faviconUpdatedAt,
    };
  } catch {
    if (!cache) {
      const data = await fetchAsDataUrl(fallback.logoUrl);
      cache = { ...fallback, logoDataUrl: data };
    }
  }
  ready = true;
  const c = cache!;
  persist(c);
  applyBrandingCssVars(c);
  listeners.forEach((l) => l(c));
  readyListeners.forEach((l) => l());
  readyListeners.clear();
  return c;
}

export function getBrandingSync(): Branding {
  return cache || fallback;
}

export function invalidateBranding() {
  ready = false;
  if (typeof window !== "undefined") {
    try { window.localStorage.removeItem(STORAGE_KEY); } catch {}
  }
}

const BRANDING_KEYS = new Set([
  "company_logo", "company_icon", "favicon_url", "favicon_updated_at", "company_name",
  "brand_primary", "brand_secondary", "brand_accent",
]);
let realtimeStarted = false;
export function startBrandingRealtime() {
  if (realtimeStarted || typeof window === "undefined") return;
  realtimeStarted = true;
  try {
    supabase
      .channel("app_settings-branding")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "app_settings" },
        (payload: any) => {
          const key = (payload?.new?.key ?? payload?.old?.key) as string | undefined;
          if (!key || !BRANDING_KEYS.has(key)) return;
          // Force refetch and notify all listeners
          invalidateBranding();
          loadBranding(true);
        }
      )
      .subscribe();
  } catch {
    realtimeStarted = false;
  }
}

export function useBranding(): Branding {
  const [b, setB] = useState<Branding>(cache || fallback);
  useEffect(() => {
    let mounted = true;
    startBrandingRealtime();
    loadBranding().then((v) => { if (mounted) setB(v); });
    const l = (v: Branding) => mounted && setB(v);
    listeners.add(l);
    return () => { mounted = false; listeners.delete(l); };
  }, []);
  return b;
}

export function useBrandingReady(): boolean {
  const [r, setR] = useState<boolean>(ready);
  useEffect(() => {
    if (ready) { setR(true); return; }
    const off = onBrandingReady(() => setR(true));
    loadBranding().catch(() => setR(true));
    return off;
  }, []);
  return r;
}

/**
 * Validate + auto-optimize logo file before saving.
 * - Accepts PNG/JPG/WEBP/SVG
 * - Max 2MB raw upload
 * - Raster images are downscaled to maxDim (default 1024px) and re-encoded as PNG
 * - SVG is passed through unchanged
 * Returns a data URL.
 */
export async function processLogoFile(file: File, maxDim = 1024): Promise<string> {
  const okTypes = /^image\/(png|jpeg|jpg|webp|svg\+xml)$/;
  if (!okTypes.test(file.type)) {
    throw new Error("صيغة غير مدعومة. استخدم PNG / JPG / WEBP / SVG");
  }
  if (file.size > 2 * 1024 * 1024) {
    throw new Error("حجم الملف يتجاوز الحد الأقصى (2MB)");
  }
  const readAsDataUrl = (f: Blob) =>
    new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ""));
      r.onerror = reject;
      r.readAsDataURL(f);
    });

  if (file.type === "image/svg+xml") {
    return readAsDataUrl(file);
  }

  // Decode + resize raster
  const dataUrl = await readAsDataUrl(file);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = dataUrl;
  });
  let { width, height } = img;
  if (width <= 0 || height <= 0) return dataUrl;
  const ratio = Math.min(1, maxDim / Math.max(width, height));
  const w = Math.round(width * ratio);
  const h = Math.round(height * ratio);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, w, h);
  // PNG preserves transparency
  return canvas.toDataURL("image/png");
}
