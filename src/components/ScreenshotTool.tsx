import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "@tanstack/react-router";
import { toast } from "sonner";
import html2canvas from "html2canvas";
import { supabase } from "@/integrations/supabase/client";

type Point = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };
type StatementAgentContext = { id: string; whatsapp: string | null } | null;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

function makeRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

function normalizeWhatsappNumber(raw: string) {
  let phone = raw.replace(/\s+/g, "").replace(/^\+/, "").replace(/\D/g, "");
  if (phone.startsWith("0020")) phone = phone.slice(2);
  if (phone.startsWith("20")) return `20${phone.slice(2).replace(/^0+/, "")}`;
  if (phone.startsWith("0")) return `20${phone.replace(/^0+/, "")}`;
  return phone;
}

function isMobileDevice() {
  return /Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

function buildWhatsappUrl(phone: string, message: string) {
  const encodedMessage = encodeURIComponent(message);
  if (isMobileDevice()) {
    return `https://wa.me/${phone}?text=${encodedMessage}`;
  }
  return `https://web.whatsapp.com/send?phone=${phone}&text=${encodedMessage}`;
}

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error("Could not create screenshot blob"));
    }, "image/png");
  });
}

/**
 * Wait for fonts and one paint frame so the DOM is fully rendered.
 */
async function waitForRender() {
  try {
    await (document as Document & { fonts?: FontFaceSet }).fonts?.ready;
  } catch {}
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
}

/**
 * Heuristic: returns true if the canvas is empty / fully white / fully one color.
 * Samples a small grid instead of every pixel for speed.
 */
function isCanvasBlank(canvas: HTMLCanvasElement): boolean {
  if (!canvas.width || !canvas.height) return true;
  const ctx = canvas.getContext("2d");
  if (!ctx) return true;
  try {
    const w = canvas.width;
    const h = canvas.height;
    const stepsX = 12;
    const stepsY = 12;
    let firstR = -1, firstG = -1, firstB = -1;
    let varied = false;
    let nonWhite = 0;
    for (let i = 1; i < stepsX; i++) {
      for (let j = 1; j < stepsY; j++) {
        const x = Math.floor((w * i) / stepsX);
        const y = Math.floor((h * j) / stepsY);
        const d = ctx.getImageData(x, y, 1, 1).data;
        const [r, g, b] = [d[0], d[1], d[2]];
        if (firstR < 0) { firstR = r; firstG = g; firstB = b; }
        else if (r !== firstR || g !== firstG || b !== firstB) varied = true;
        if (!(r >= 248 && g >= 248 && b >= 248)) nonWhite++;
      }
    }
    if (!varied) return true; // single solid color
    if (nonWhite < 3) return true; // basically all white
    return false;
  } catch {
    // Tainted canvas — treat as non-blank (we still got something rendered).
    return false;
  }
}

/**
 * Silent DOM capture via html2canvas. No permission prompts.
 * Excludes elements marked with [data-screenshot-ignore="true"].
 */
async function captureWithHtml2Canvas(): Promise<HTMLCanvasElement> {
  await waitForRender();

  // Best-effort: opt cross-origin images into CORS so they render instead of tainting.
  document.querySelectorAll("img").forEach((img) => {
    if (!img.crossOrigin && img.src && !img.src.startsWith(window.location.origin) && !img.src.startsWith("data:") && !img.src.startsWith("blob:")) {
      try { img.crossOrigin = "anonymous"; } catch {}
    }
  });

  const root = document.documentElement;
  const body = document.body;
  const width = Math.max(body.scrollWidth, root.scrollWidth, root.clientWidth, window.innerWidth);
  const height = Math.max(body.scrollHeight, root.scrollHeight, root.clientHeight, window.innerHeight);
  const bg = getComputedStyle(body).backgroundColor || "#ffffff";

  return html2canvas(body, {
    backgroundColor: bg && bg !== "rgba(0, 0, 0, 0)" ? bg : "#ffffff",
    useCORS: true,
    allowTaint: false,
    logging: false,
    removeContainer: true,
    scale: Math.min(window.devicePixelRatio || 1, 2),
    width,
    height,
    windowWidth: width,
    windowHeight: height,
    scrollX: -window.scrollX,
    scrollY: -window.scrollY,
    foreignObjectRendering: false,
    ignoreElements: (el) => {
      if (!(el instanceof HTMLElement)) return false;
      if (el.getAttribute("data-screenshot-ignore") === "true") return true;
      // Skip portal overlays that aren't currently visible
      const cs = el.ownerDocument?.defaultView?.getComputedStyle(el);
      if (cs && cs.visibility === "hidden") return true;
      return false;
    },
  });
}

/**
 * DOM-only capture. Tries once, retries once after 500ms if blank.
 * No browser screen-capture fallback — never triggers permission popups.
 */
async function captureScreenFrame(): Promise<HTMLCanvasElement> {
  let canvas = await captureWithHtml2Canvas();
  if (isCanvasBlank(canvas)) {
    await new Promise((r) => setTimeout(r, 500));
    canvas = await captureWithHtml2Canvas();
  }
  if (isCanvasBlank(canvas)) {
    throw new Error("تعذر التقاط الشاشة داخليًا، استخدم أداة لقطة الشاشة من النظام");
  }
  return canvas;
}

export default function ScreenshotTool() {
  const loc = useLocation();
  const [busy, setBusy] = useState(false);
  // captured-image selection state
  const [captured, setCaptured] = useState<HTMLCanvasElement | null>(null);
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null);
  const [selRect, setSelRect] = useState<Rect | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [routeAgentWhatsapp, setRouteAgentWhatsapp] = useState<string | null>(null);
  const [statementAgent, setStatementAgent] = useState<StatementAgentContext>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const startRef = useRef<Point | null>(null);
  const pointerIdRef = useRef<number | null>(null);

  const isAgentStatementRoute = loc.pathname.startsWith("/agent-statement/");
  const routeAgentId = isAgentStatementRoute
    ? loc.pathname.split("/agent-statement/")[1]?.split("/")[0]
    : null;
  const isAccountsRoute = loc.pathname === "/accounts";
  const activeStatementAgent = isAgentStatementRoute
    ? { id: routeAgentId || "", whatsapp: routeAgentWhatsapp }
    : isAccountsRoute
      ? statementAgent
      : null;
  const isAgentStatement = Boolean(activeStatementAgent?.id);
  const activeWhatsapp = activeStatementAgent?.whatsapp || null;

  useEffect(() => {
    if (!routeAgentId) { setRouteAgentWhatsapp(null); return; }
    supabase.from("agents").select("whatsapp").eq("id", routeAgentId).maybeSingle().then(({ data }) => {
      setRouteAgentWhatsapp((data as any)?.whatsapp || null);
    });
  }, [routeAgentId]);

  useEffect(() => {
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<StatementAgentContext>).detail;
      setStatementAgent(detail || null);
    };
    window.addEventListener("agent-statement-agent-change", onChange);
    return () => window.removeEventListener("agent-statement-agent-change", onChange);
  }, []);

  const resetAll = useCallback(() => {
    if (capturedUrl) URL.revokeObjectURL(capturedUrl);
    if (preview) URL.revokeObjectURL(preview);
    setCaptured(null);
    setCapturedUrl(null);
    setSelRect(null);
    setPreview(null);
    setBlob(null);
    startRef.current = null;
    pointerIdRef.current = null;
  }, [capturedUrl, preview]);

  const startCapture = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const canvas = await captureScreenFrame();
      const capBlob = await canvasToBlob(canvas);
      setCaptured(canvas);
      setCapturedUrl(URL.createObjectURL(capBlob));
      setSelRect(null);
      setPreview(null);
      setBlob(null);
    } catch (err: any) {
      if (err?.name !== "NotAllowedError" && err?.name !== "AbortError") {
        console.error(err);
        toast.error(err?.message || "تعذر بدء التقاط الشاشة");
      }
    } finally {
      setBusy(false);
    }
  }, [busy]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (preview || captured) {
          e.preventDefault();
          resetAll();
        }
        return;
      }
      const isPrintScreen = e.key === "PrintScreen" || e.code === "PrintScreen";
      const isShortcut = (e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "S" || e.key === "s");
      if (isPrintScreen || isShortcut) {
        e.preventDefault();
        e.stopPropagation();
        void startCapture();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [startCapture, resetAll, preview, captured]);

  // ----- selection on captured image -----
  const getImgPoint = (e: React.PointerEvent<HTMLDivElement>): Point => {
    const img = imgRef.current;
    if (!img) return { x: 0, y: 0 };
    const r = img.getBoundingClientRect();
    return {
      x: clamp(e.clientX - r.left, 0, r.width),
      y: clamp(e.clientY - r.top, 0, r.height),
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    pointerIdRef.current = e.pointerId;
    const p = getImgPoint(e);
    startRef.current = p;
    setSelRect({ x: p.x, y: p.y, w: 0, h: 0 });
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== e.pointerId || !startRef.current) return;
    setSelRect(makeRect(startRef.current, getImgPoint(e)));
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== e.pointerId) return;
    pointerIdRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const confirmCrop = async () => {
    if (!captured || !imgRef.current || !selRect || selRect.w < 5 || selRect.h < 5) {
      toast.error("اسحب لتحديد منطقة أولاً");
      return;
    }
    const img = imgRef.current;
    const dispW = img.clientWidth;
    const dispH = img.clientHeight;
    const scaleX = captured.width / dispW;
    const scaleY = captured.height / dispH;
    const sx = Math.round(selRect.x * scaleX);
    const sy = Math.round(selRect.y * scaleY);
    const sw = Math.round(selRect.w * scaleX);
    const sh = Math.round(selRect.h * scaleY);
    const out = document.createElement("canvas");
    out.width = sw;
    out.height = sh;
    const ctx = out.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(captured, sx, sy, sw, sh, 0, 0, sw, sh);
    const cropped = await canvasToBlob(out);
    setBlob(cropped);
    setPreview(URL.createObjectURL(cropped));
    if (capturedUrl) URL.revokeObjectURL(capturedUrl);
    setCaptured(null);
    setCapturedUrl(null);
    setSelRect(null);
  };

  const closePreview = () => {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setBlob(null);
  };

  const downloadBlob = () => {
    if (!blob) return;
    const date = new Date().toISOString().slice(0, 10);
    const name = `screenshot-${date}.png`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    try {
      const ClipItem = (window as any).ClipboardItem;
      if (navigator.clipboard && ClipItem) {
        navigator.clipboard.write([new ClipItem({ "image/png": blob })]).catch(() => {});
      }
    } catch {}
  };

  const sendWhatsapp = async () => {
    if (!activeWhatsapp) {
      toast.error("لا يوجد رقم واتساب لهذا الوكيل");
      return;
    }
    // Make sure the image is available to attach in WhatsApp.
    downloadBlob();
    try {
      const ClipItem = (window as any).ClipboardItem;
      if (blob && navigator.clipboard && ClipItem) {
        await navigator.clipboard.write([new ClipItem({ "image/png": blob })]).catch(() => {});
      }
    } catch {}
    const phone = normalizeWhatsappNumber(activeWhatsapp);
    const url = buildWhatsappUrl(phone, "مرحباً، مرفق لقطة من كشف الحساب الخاص بكم.");
    window.open(url, "_blank", "noopener,noreferrer");
    toast.success("تم فتح واتساب، قم بإرفاق لقطة الشاشة");
    closePreview();
  };

  const justDownload = () => {
    downloadBlob();
    toast.success("تم تنزيل لقطة الشاشة");
    closePreview();
  };

  return (
    <>
      {!captured && !preview && (
        <button
          type="button"
          data-screenshot-ignore="true"
          onClick={startCapture}
          disabled={busy}
          title="اختصار لقطة الشاشة: Print Screen أو Ctrl+Shift+S"
          style={{
            position: "fixed", top: 12, left: 12, zIndex: 10000,
            background: "rgba(15,23,42,0.85)", color: "#fff",
            border: "1px solid rgba(255,255,255,0.15)", borderRadius: 999,
            padding: "8px 12px", fontSize: 13, cursor: busy ? "wait" : "pointer",
            boxShadow: "0 4px 14px rgba(0,0,0,0.25)", backdropFilter: "blur(6px)",
            opacity: busy ? 0.7 : 1,
          }}
        >
          📸 لقطة شاشة
        </button>
      )}

      {captured && capturedUrl && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 10002,
            background: "rgba(0,0,0,0.85)", display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", padding: 16, gap: 12,
          }}
          data-screenshot-ignore="true"
        >
          <div style={{
            background: "rgba(15,23,42,0.95)", color: "#fff", padding: "8px 14px",
            borderRadius: 8, fontSize: 13,
          }}>
            اسحب على الصورة لتحديد المنطقة المطلوبة ثم اضغط "اقتطاع"
          </div>
          <div
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => { pointerIdRef.current = null; }}
            style={{
              position: "relative", maxWidth: "92vw", maxHeight: "75vh",
              cursor: "crosshair", touchAction: "none", userSelect: "none",
              background: "#fff",
            }}
          >
            <img
              ref={imgRef}
              src={capturedUrl}
              alt="captured"
              draggable={false}
              style={{ display: "block", maxWidth: "92vw", maxHeight: "75vh", pointerEvents: "none" }}
            />
            {selRect && (
              <div style={{
                position: "absolute",
                left: selRect.x, top: selRect.y,
                width: selRect.w, height: selRect.h,
                border: "2px dashed #fbbf24",
                background: "rgba(251,191,36,0.15)",
                pointerEvents: "none",
              }} />
            )}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
            <button type="button" className="action-btn" onClick={resetAll}>إلغاء</button>
            <button type="button" className="action-btn" onClick={() => setSelRect(null)}>إعادة التحديد</button>
            <button type="button" className="btn btn-gold" onClick={confirmCrop}>✂ اقتطاع</button>
          </div>
        </div>
      )}

      {preview && (
        <div
          onClick={closePreview}
          data-screenshot-ignore="true"
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 10001, padding: 16,
          }}
        >
          <div onClick={(e) => e.stopPropagation()} className="card" style={{ maxWidth: 720, width: "100%", margin: 0 }}>
            <div className="card-header"><div className="card-title">📸 معاينة لقطة الشاشة</div></div>
            <div style={{ padding: 16, textAlign: "center" }}>
              <img src={preview} alt="preview" style={{ maxWidth: "100%", maxHeight: "60vh", border: "1px solid #ddd", borderRadius: 6 }} />
            </div>
            <div className="form-footer" style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap", padding: 12 }}>
              <button type="button" className="action-btn" onClick={closePreview}>إلغاء</button>
              <button type="button" className="action-btn" onClick={justDownload}>⬇ تنزيل</button>
              {isAgentStatement && activeWhatsapp && (
                <button type="button" className="btn btn-gold" onClick={sendWhatsapp}>📱 إرسال عبر واتساب</button>
              )}
              {isAgentStatement && !activeWhatsapp && (
                <button type="button" className="btn btn-gold" disabled title="لا يوجد واتساب للوكيل">📱 لا يوجد واتساب للوكيل</button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
