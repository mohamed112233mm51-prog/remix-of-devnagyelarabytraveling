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
 * Capture a single frame from the user's chosen screen/tab via
 * getDisplayMedia. Returns the frame as a canvas (native pixel size).
 */
async function captureScreenFrame(): Promise<HTMLCanvasElement> {
  const md = navigator.mediaDevices as MediaDevices & {
    getDisplayMedia?: (c?: MediaStreamConstraints) => Promise<MediaStream>;
  };
  if (!md?.getDisplayMedia) {
    throw new Error("Screen Capture API غير مدعومة في هذا المتصفح");
  }
  const stream = await md.getDisplayMedia({
    video: { frameRate: 30 } as MediaTrackConstraints,
    audio: false,
    preferCurrentTab: true,
    selfBrowserSurface: "include",
  } as MediaStreamConstraints);
  try {
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    (video as HTMLVideoElement).playsInline = true;
    await video.play();
    // wait one frame so dimensions are ready
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) throw new Error("تعذر قراءة إطار الشاشة");
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas context unavailable");
    ctx.drawImage(video, 0, 0, w, h);
    return canvas;
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
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
