import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import type { StatementExportData } from "@/lib/exportStatement";
import { generateStatementImage } from "@/lib/statementImage";
import { cropRectToPixels, selectStatementRows, type ImageSelectionRect } from "@/lib/statementImageSelection";
import { openWhatsappForManualImageAttachment, shareStatementImageViaWhatsApp } from "@/lib/whatsappShare";
import { openStandaloneImageShare } from "@/lib/standaloneImageShare";
import { drawCropSelection, moveCropSelection, resizeCropSelection, scaleCropSelection, type CropResizeHandle } from "@/lib/statementCropGeometry";

type Mode = "full" | "crop" | "rows";
type Point = { x: number; y: number };
type Drag = { id: number; kind: "new" | "move" | "resize"; start: Point; initial: ImageSelectionRect; handle?: CropResizeHandle };
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const actionStyle: CSSProperties = { border: "1px solid #cbd5e1", background: "#fff", color: "#0f172a", padding: "9px 13px", borderRadius: 8, cursor: "pointer", fontWeight: 600 };
const primaryStyle: CSSProperties = { ...actionStyle, background: "#B8923A", borderColor: "#A8822E", color: "#161100" };

function blobUrl(blob: Blob): string { return URL.createObjectURL(blob); }
function downloadImage(blob: Blob, name: string) {
  const url = blobUrl(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
async function makeBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("تعذر إنشاء ملف الصورة")), "image/png"));
}
async function cropPng(sourceUrl: string, rect: ImageSelectionRect, displayWidth: number, displayHeight: number): Promise<Blob> {
  const img = new Image();
  img.src = sourceUrl;
  await img.decode();
  const pixels = cropRectToPixels(rect, img.naturalWidth, img.naturalHeight, displayWidth, displayHeight);
  if (!pixels || pixels.w < 2 || pixels.h < 2) throw new Error("حدد مساحة واضحة لقص الصورة");
  const canvas = document.createElement("canvas");
  canvas.width = pixels.w; canvas.height = pixels.h;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("تعذر إنشاء الصورة");
  context.drawImage(img, pixels.x, pixels.y, pixels.w, pixels.h, 0, 0, pixels.w, pixels.h);
  return makeBlob(canvas);
}

export function StatementImageExportDialog({ data, phone, onClose }: {
  data: StatementExportData;
  phone?: string | null;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<Mode>("full");
  const [selectedRows, setSelectedRows] = useState<number[]>([]);
  const [sourceBlob, setSourceBlob] = useState<Blob | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [selection, setSelection] = useState<ImageSelectionRect | null>(null);
  const [previewZoom, setPreviewZoom] = useState<"fit" | "actual">("fit");
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [manualWhatsappAttachment, setManualWhatsappAttachment] = useState(false);
  const [busy, setBusy] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const cropWidthRef = useRef<number>(0);
  const selectedSet = useMemo(() => new Set(selectedRows), [selectedRows]);
  const fileName = (data.fileName || data.title || "كشف").replace(/[\\/:*?"<>|]/g, "-") + " - صورة.png";

  useEffect(() => () => { if (sourceUrl) URL.revokeObjectURL(sourceUrl); }, [sourceUrl]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  useEffect(() => {
    const onEscape = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onEscape);
    return () => { document.body.style.overflow = oldOverflow; window.removeEventListener("keydown", onEscape); };
  }, [onClose]);

  useEffect(() => {
    if (mode !== "crop" || sourceBlob) return;
    let cancelled = false;
    setBusy(true);
    generateStatementImage(data).then((image) => {
      if (cancelled) return;
      setSourceBlob(image);
      setSourceUrl(blobUrl(image));
    }).catch((e) => {
      if (!cancelled) toast.error("تعذر تجهيز معاينة الكشف: " + (e as Error).message);
    }).finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [mode, data, sourceBlob]);

  // Preserve the same region when zooming or rotating a mobile device.
  // The stored rectangle is in displayed image pixels, so rescale every
  // coordinate when that image's CSS width changes.
  useEffect(() => {
    const img = imgRef.current;
    if (mode !== "crop" || !sourceUrl || !img) return;
    cropWidthRef.current = img.getBoundingClientRect().width;
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const nextWidth = img.getBoundingClientRect().width;
      const oldWidth = cropWidthRef.current;
      if (oldWidth > 0 && nextWidth > 0 && Math.abs(nextWidth - oldWidth) > 0.5) {
        setSelection((rect) => rect ? scaleCropSelection(rect, oldWidth, nextWidth) : null);
        cropWidthRef.current = nextWidth;
      }
    });
    observer.observe(img);
    return () => observer.disconnect();
  }, [mode, sourceUrl]);

  function setNewMode(next: Mode) {
    if (busy) return;
    setMode(next);
    setPreviewBlob(null); setPreviewUrl(null); setManualWhatsappAttachment(false);
  }

  function pointerPosition(e: PointerEvent<HTMLDivElement>): Point {
    const bounds = imgRef.current!.getBoundingClientRect();
    return { x: clamp(e.clientX - bounds.left, 0, bounds.width), y: clamp(e.clientY - bounds.top, 0, bounds.height) };
  }
  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (!imgRef.current || dragRef.current || (e.pointerType === "mouse" && e.button !== 0)) return;

    const point = pointerPosition(e);
    const handleElement = (e.target as HTMLElement).closest<HTMLElement>("[data-crop-handle]");
    const handle = handleElement?.dataset.cropHandle as CropResizeHandle | undefined;
    const inside = !!selection &&
      point.x >= selection.x && point.x <= selection.x + selection.w &&
      point.y >= selection.y && point.y <= selection.y + selection.h;

    // A stray touch outside an existing selection must never erase it.
    // Start a fresh crop only after pressing "إعادة التحديد".
    if (selection && !handle && !inside) return;
    const kind: Drag["kind"] = !selection ? "new" : handle ? "resize" : "move";
    e.preventDefault();
    dragRef.current = {
      id: e.pointerId, kind, start: point, handle,
      initial: selection ?? { x: point.x, y: point.y, w: 0, h: 0 },
    };
    if (kind === "new") setSelection({ x: point.x, y: point.y, w: 0, h: 0 });
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current, img = imgRef.current;
    if (!drag || drag.id !== e.pointerId || !img) return;
    const point = pointerPosition(e);
    const dx = point.x - drag.start.x, dy = point.y - drag.start.y;
    const width = img.getBoundingClientRect().width;
    const height = img.getBoundingClientRect().height;

    if (drag.kind === "new") {
      setSelection(drawCropSelection(drag.start, point));
    } else if (drag.kind === "move") {
      setSelection(moveCropSelection(drag.initial, dx, dy, width, height));
    } else if (drag.handle) {
      setSelection(resizeCropSelection(drag.initial, drag.handle, dx, dy, width, height));
    }
  }
  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.id !== e.pointerId) return;
    dragRef.current = null;
    if (drag.kind === "new") {
      // A tap without a drag should not leave a 0x0 invisible selection.
      setSelection((rect) => rect && rect.w >= 8 && rect.h >= 8 ? rect : null);
    }
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }

  async function prepareImage() {
    if (busy) return;
    if (mode === "rows" && selectedRows.length === 0) { toast.error("حدد صفًا واحدًا على الأقل"); return; }
    if (mode === "crop" && (!sourceUrl || !selection || selection.w < 5 || selection.h < 5 || !imgRef.current)) {
      toast.error("حدد مساحة من الكشف أولًا"); return;
    }
    setBusy(true);
    try {
      let next: Blob;
      if (mode === "rows") next = await generateStatementImage(selectStatementRows(data, selectedRows));
      else if (mode === "crop") {
        const img = imgRef.current!;
        const bounds = img.getBoundingClientRect();
        next = await cropPng(sourceUrl!, selection!, bounds.width, bounds.height);
      } else next = await generateStatementImage(data);
      const url = blobUrl(next);
      setPreviewBlob(next); setPreviewUrl(url); setManualWhatsappAttachment(false);
    } catch (e) { toast.error("تعذر إنشاء الصورة: " + (e as Error).message); }
    finally { setBusy(false); }
  }
  async function shareImage() {
    if (!previewBlob || busy) return;
    const imageFile = new File([previewBlob], fileName, { type: "image/png" });
    // Lovable Preview runs inside an iframe that may deny web-share.
    // A top-level tab can ask Android to share this exact PNG file.
    let canShareHere = false;
    try {
      canShareHere = typeof navigator.share === "function" &&
        typeof navigator.canShare === "function" &&
        navigator.canShare({ files: [imageFile] });
    } catch { /* Permissions Policy or browser support limitation */ }

    if (!canShareHere && openStandaloneImageShare(imageFile)) {
      setManualWhatsappAttachment(false);
      toast.message("تم فتح صفحة مشاركة الصورة. اضغط مشاركة هناك، ثم اختر واتساب والمحادثة.");
      return;
    }

    setBusy(true);
    try {
      const outcome = await shareStatementImageViaWhatsApp({ blob: previewBlob, fileName, title: data.title, phone });
      if (outcome === "manual") {
        setManualWhatsappAttachment(true);
      } else if (outcome === "native") {
        setManualWhatsappAttachment(false);
        // The system share sheet does not guarantee the user completed sending.
        toast.message("تم فتح مشاركة الصورة. اختر واتساب والمحادثة لإرسال الملف.");
      }
    } catch (e) { toast.error("تعذرت المشاركة: " + (e as Error).message); }
    finally { setBusy(false); }
  }
  function toggleRow(index: number) {
    setSelectedRows((old) => old.includes(index) ? old.filter((i) => i !== index) : [...old, index]);
  }

  return createPortal(
    <div role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 12000, background: "rgba(0,0,0,.7)", display: "flex", alignItems: "center", justifyContent: "center", padding: 10 }}>
      <div role="dialog" aria-modal="true" aria-label="تصدير صورة الكشف" dir="rtl"
        style={{ width: "min(1200px, 98vw)", maxHeight: "96vh", overflow: "auto", background: "#fff", color: "#111827", borderRadius: 12, boxShadow: "0 12px 50px rgba(0,0,0,.4)", padding: 16 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", marginBottom: 12 }}>
          <strong style={{ fontSize: 18 }}>🖼️ تصدير صورة — {data.title}</strong>
          <button type="button" style={actionStyle} disabled={busy} onClick={onClose}>إغلاق ✕</button>
        </div>
        {!previewBlob ? <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
            {([["full", "📄 الكشف كامل"], ["crop", "✂️ تحديد جزء"], ["rows", "☑️ تحديد صفوف"]] as const).map(([key, label]) => (
              <button type="button" key={key} onClick={() => setNewMode(key)} disabled={busy}
                aria-pressed={mode === key} style={mode === key ? primaryStyle : actionStyle}>{label}</button>
            ))}
          </div>
          {mode === "crop" && <>
            {selection && <div style={{ marginBottom: 8 }}>
              <button type="button" style={actionStyle} onClick={() => setSelection(null)}>إعادة التحديد</button>
            </div>}
            {!sourceUrl ? <p role="status">جاري إنشاء معاينة الكشف...</p> : (
              <div style={{ overflow: "auto", maxHeight: "56vh", border: "1px solid #d1d5db", borderRadius: 8, background: "#f1f5f9" }}>
                <div onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
                  style={{ position: "relative", width: "100%", overflow: "hidden", touchAction: "none", cursor: selection ? "default" : "crosshair", userSelect: "none" }}>
                  <img ref={imgRef} src={sourceUrl} alt="معاينة الكشف للتحديد" draggable={false}
                    style={{ display: "block", width: "100%", maxWidth: "none", height: "auto", pointerEvents: "none" }} />
                  {selection && <>
                    {/* Darken only pixels outside the crop, using four small clipped panels. */}
                    <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: 0, height: selection.y, background: "rgba(2,6,23,.32)", pointerEvents: "none" }} />
                    <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: selection.y + selection.h, bottom: 0, background: "rgba(2,6,23,.32)", pointerEvents: "none" }} />
                    <div aria-hidden="true" style={{ position: "absolute", left: 0, top: selection.y, width: selection.x, height: selection.h, background: "rgba(2,6,23,.32)", pointerEvents: "none" }} />
                    <div aria-hidden="true" style={{ position: "absolute", right: 0, top: selection.y, width: `calc(100% - ${selection.x + selection.w}px)`, height: selection.h, background: "rgba(2,6,23,.32)", pointerEvents: "none" }} />
                    <div style={{
                      position: "absolute", left: selection.x, top: selection.y, width: selection.w, height: selection.h,
                      border: "2px solid #fff", borderRadius: 2,
                      boxShadow: "0 0 0 1px #B8923A",
                      cursor: "move", touchAction: "none",
                    }}>
                      {/* Every full-length edge is touchable, not just its midpoint. */}
                      {(["n", "s", "e", "w"] as const).map((edge) => (
                        <span key={edge} data-crop-handle={edge} title={"تغيير التحديد من " + ({ n: "الأعلى", s: "الأسفل", e: "اليمين", w: "اليسار" }[edge])}
                          style={{
                            position: "absolute", zIndex: 2, touchAction: "none",
                            cursor: edge === "n" || edge === "s" ? "ns-resize" : "ew-resize",
                            ...(edge === "n" ? { top: -16, left: 0, right: 0, height: 32 } :
                                edge === "s" ? { bottom: -16, left: 0, right: 0, height: 32 } :
                                edge === "e" ? { right: -16, top: 0, bottom: 0, width: 32 } :
                                               { left: -16, top: 0, bottom: 0, width: 32 }),
                          }}>
                          <span style={{
                            position: "absolute", background: "#fff", border: "1px solid #B8923A",
                            borderRadius: 5, boxShadow: "0 1px 3px rgba(0,0,0,.45)",
                            ...(edge === "n" || edge === "s"
                              ? { width: 32, height: 6, left: "50%", top: "50%", transform: "translate(-50%,-50%)" }
                              : { width: 6, height: 32, left: "50%", top: "50%", transform: "translate(-50%,-50%)" }),
                          }} />
                        </span>
                      ))}
                      {(["nw", "ne", "sw", "se"] as const).map((corner) => (
                        <span key={corner} data-crop-handle={corner} title="تغيير حجم التحديد من الزاوية"
                          style={{
                            position: "absolute", zIndex: 3, width: 36, height: 36,
                            top: corner.includes("n") ? 0 : "100%",
                            left: corner.includes("w") ? 0 : "100%",
                            transform: "translate(-50%,-50%)", display: "grid", placeItems: "center",
                            cursor: corner === "nw" || corner === "se" ? "nwse-resize" : "nesw-resize",
                            touchAction: "none",
                          }}>
                          <span style={{ width: 14, height: 14, background: "#B8923A", border: "2px solid white", borderRadius: 3, boxShadow: "0 1px 4px rgba(0,0,0,.45)" }} />
                        </span>
                      ))}
                    </div>
                  </>}
                </div>
              </div>
            )}
          </>}
          {mode === "rows" && <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 8 }}>
              <strong>تم تحديد {selectedRows.length} من {data.rows.length} صف</strong>
              <button type="button" style={actionStyle} onClick={() => setSelectedRows(data.rows.map((_, i) => i))}>تحديد الكل</button>
              <button type="button" style={actionStyle} onClick={() => setSelectedRows([])}>إلغاء التحديد</button>
            </div>
            <p style={{ margin: "8px 0", fontSize: 13 }}>ستظهر الصفوف المختارة فقط، مع نفس كروت الإجماليات والأرصدة وقيمها في الكشف الأصلي بالكامل.</p>
            <div style={{ maxHeight: "52vh", overflow: "auto", border: "1px solid #d1d5db", borderRadius: 8 }}>
              <table style={{ borderCollapse: "collapse", width: "100%", minWidth: Math.max(540, data.columns.length * 110), fontSize: 13 }}>
                <thead style={{ position: "sticky", top: 0, background: "#e2e8f0", zIndex: 1 }}>
                  <tr><th style={{ padding: 8 }}>اختيار</th>{data.columns.map((col, i) => <th key={i} style={{ padding: 8, border: "1px solid #cbd5e1" }}>{col.header}</th>)}</tr>
                </thead>
                <tbody>{data.rows.map((row, i) => (
                  <tr key={i} onClick={() => toggleRow(i)} style={{ cursor: "pointer", background: selectedSet.has(i) ? "#fef3c7" : (i % 2 ? "#f8fafc" : "#fff") }}>
                    <td style={{ textAlign: "center", padding: 7 }}><input type="checkbox" aria-label={"تحديد الصف " + (i + 1)} checked={selectedSet.has(i)} readOnly /></td>
                    {data.columns.map((col, j) => <td key={j} style={{ padding: 7, textAlign: "center", border: "1px solid #e2e8f0", whiteSpace: "nowrap" }}>{String(row[col.key] ?? "—")}</td>)}
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            <button type="button" style={actionStyle} disabled={busy} onClick={onClose}>إلغاء</button>
            <button type="button" style={primaryStyle} disabled={busy || (mode === "crop" && !sourceUrl)} onClick={() => void prepareImage()}>
              {busy ? "جاري التجهيز..." : "معاينة الصورة"}
            </button>
          </div>
        </> : <>
          <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <button type="button" style={previewZoom === "fit" ? primaryStyle : actionStyle} onClick={() => setPreviewZoom("fit")}>ملاءمة العرض</button>
            <button type="button" style={previewZoom === "actual" ? primaryStyle : actionStyle} onClick={() => setPreviewZoom("actual")}>🔎 الحجم الحقيقي 100%</button>
          </div>
          <div style={{ textAlign: previewZoom === "fit" ? "center" : "right", maxHeight: "62vh", overflow: "auto", background: "#f8fafc" }}>
            <img src={previewUrl!} alt="معاينة الصورة النهائية" style={{ maxWidth: previewZoom === "fit" ? "100%" : "none", width: previewZoom === "fit" ? "auto" : undefined, height: "auto" }} />
          </div>
          {manualWhatsappAttachment && (
            <div role="status" style={{ marginTop: 12, border: "1px solid #d5ad57", borderRadius: 8, background: "#fff9e9", padding: 12, lineHeight: 1.9 }}>
              <strong>الصورة جاهزة وتم تنزيلها، لكنها لم تُرفق في واتساب تلقائيًا.</strong>
              <div>لم يتمكن المتصفح من مشاركة ملف PNG. يمكنك تجربة صفحة مشاركة مستقلة، أو فتح واتساب وإرفاق الصورة من التنزيلات.</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                <button type="button" style={primaryStyle} onClick={() => {
                  const file = new File([previewBlob], fileName, { type: "image/png" });
                  if (!openStandaloneImageShare(file)) toast.error("المتصفح منع فتح صفحة المشاركة. افتح الموقع مباشرة خارج Lovable Preview.");
                }}>
                  مشاركة الصورة من صفحة مستقلة
                </button>
                <button type="button" style={actionStyle} onClick={() => openWhatsappForManualImageAttachment(phone)}>
                  فتح واتساب لإرفاق الصورة يدويًا
                </button>
              </div>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            <button type="button" style={actionStyle} disabled={busy} onClick={() => { setPreviewBlob(null); setPreviewUrl(null); setManualWhatsappAttachment(false); }}>تعديل الاختيار</button>
            <button type="button" style={actionStyle} disabled={busy} onClick={() => downloadImage(previewBlob, fileName)}>⬇️ تحميل PNG</button>
            <button type="button" style={{ ...primaryStyle, background: "#25D366", borderColor: "#16a34a" }} disabled={busy} onClick={() => void shareImage()}>
              🟢 مشاركة على واتساب
            </button>
          </div>
        </>}
      </div>
    </div>, document.body,
  );
}
