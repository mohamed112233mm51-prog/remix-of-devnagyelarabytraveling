import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import type { StatementExportData } from "@/lib/exportStatement";
import { generateStatementImage } from "@/lib/statementImage";
import { cropRectToPixels, selectStatementRows, type ImageSelectionRect } from "@/lib/statementImageSelection";
import { shareStatementImageViaWhatsApp } from "@/lib/whatsappShare";

type Mode = "full" | "crop" | "rows";
type Point = { x: number; y: number };
type Corner = "nw" | "ne" | "sw" | "se";
type Drag = { id: number; kind: "new" | "move" | "resize"; start: Point; initial: ImageSelectionRect; corner?: Corner };
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
  const [cropTool, setCropTool] = useState<"select" | "scroll">("select");
  const [cropZoom, setCropZoom] = useState<"fit" | "actual">("fit");
  const [previewZoom, setPreviewZoom] = useState<"fit" | "actual">("fit");
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<Drag | null>(null);
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

  function setNewMode(next: Mode) {
    if (busy) return;
    setMode(next);
    setPreviewBlob(null); setPreviewUrl(null);
  }

  function pointerPosition(e: PointerEvent<HTMLDivElement>): Point {
    const bounds = imgRef.current!.getBoundingClientRect();
    return { x: clamp(e.clientX - bounds.left, 0, bounds.width), y: clamp(e.clientY - bounds.top, 0, bounds.height) };
  }
  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (!imgRef.current || cropTool === "scroll") return;
    e.preventDefault();
    const point = pointerPosition(e);
    const corner = (e.target as HTMLElement).dataset.cropCorner as Corner | undefined;
    let kind: Drag["kind"] = "new";
    if (corner && selection) kind = "resize";
    else if (selection && point.x >= selection.x && point.x <= selection.x + selection.w && point.y >= selection.y && point.y <= selection.y + selection.h) kind = "move";
    dragRef.current = { id: e.pointerId, kind, start: point, corner, initial: kind === "new" ? { x: point.x, y: point.y, w: 0, h: 0 } : selection! };
    if (kind === "new") setSelection({ x: point.x, y: point.y, w: 0, h: 0 });
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current, img = imgRef.current;
    if (!drag || drag.id !== e.pointerId || !img) return;
    const point = pointerPosition(e), deltaX = point.x - drag.start.x, deltaY = point.y - drag.start.y;
    const r = drag.initial, width = img.getBoundingClientRect().width, height = img.getBoundingClientRect().height;
    if (drag.kind === "new") {
      setSelection({ x: Math.min(r.x, point.x), y: Math.min(r.y, point.y), w: Math.abs(point.x - r.x), h: Math.abs(point.y - r.y) });
    } else if (drag.kind === "move") {
      setSelection({ ...r, x: clamp(r.x + deltaX, 0, width - r.w), y: clamp(r.y + deltaY, 0, height - r.h) });
    } else {
      let left = r.x, top = r.y, right = r.x + r.w, bottom = r.y + r.h;
      if (drag.corner?.includes("w")) left = clamp(r.x + deltaX, 0, right - 2);
      if (drag.corner?.includes("e")) right = clamp(right + deltaX, left + 2, width);
      if (drag.corner?.includes("n")) top = clamp(r.y + deltaY, 0, bottom - 2);
      if (drag.corner?.includes("s")) bottom = clamp(bottom + deltaY, top + 2, height);
      setSelection({ x: left, y: top, w: right - left, h: bottom - top });
    }
  }
  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.id !== e.pointerId) return;
    dragRef.current = null;
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
      setPreviewBlob(next); setPreviewUrl(url);
    } catch (e) { toast.error("تعذر إنشاء الصورة: " + (e as Error).message); }
    finally { setBusy(false); }
  }
  async function shareImage() {
    if (!previewBlob || busy) return;
    setBusy(true);
    try {
      await shareStatementImageViaWhatsApp({ blob: previewBlob, fileName, title: data.title, phone });
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
              <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
              <button type="button" style={cropTool === "select" ? primaryStyle : actionStyle} onClick={() => setCropTool("select")}>✂️ وضع التحديد</button>
              <button type="button" style={cropTool === "scroll" ? primaryStyle : actionStyle} onClick={() => setCropTool("scroll")}>↕️ وضع التمرير</button>
              <button type="button" style={actionStyle} onClick={() => { setCropZoom((prev) => prev === "fit" ? "actual" : "fit"); setSelection(null); }}>
                {cropZoom === "fit" ? "🔎 عرض بالحجم الحقيقي" : "↔️ ملاءمة العرض"}
              </button>
            </div>
            {!sourceUrl ? <p role="status">جاري إنشاء معاينة الكشف...</p> : (
              <div style={{ overflow: "auto", maxHeight: "56vh", border: "1px solid #d1d5db", borderRadius: 8, background: "#f1f5f9" }}>
                <div onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
                  style={{ position: "relative", width: cropZoom === "fit" ? "100%" : "max-content", touchAction: cropTool === "scroll" ? "pan-x pan-y" : "none", cursor: cropTool === "scroll" ? "grab" : "crosshair", userSelect: "none" }}>
                  <img ref={imgRef} src={sourceUrl} alt="معاينة الكشف للتحديد" draggable={false}
                    style={{ display: "block", width: cropZoom === "fit" ? "100%" : "auto", maxWidth: "none", height: "auto", pointerEvents: "none" }} />
                  {selection && <div style={{ position: "absolute", left: selection.x, top: selection.y, width: selection.w, height: selection.h, border: "2px dashed #a16207", background: "rgba(234,179,8,.17)", cursor: "move" }}>
                    {(["nw", "ne", "sw", "se"] as Corner[]).map((corner) => <span data-crop-corner={corner} key={corner} style={{ position: "absolute",
                      left: corner.includes("w") ? -7 : undefined, right: corner.includes("e") ? -7 : undefined,
                      top: corner.includes("n") ? -7 : undefined, bottom: corner.includes("s") ? -7 : undefined,
                      width: 14, height: 14, border: "2px solid white", background: "#a16207", borderRadius: 3, cursor: "nwse-resize" }} />)}
                  </div>}
                </div>
              </div>
            )}
            {selection && <button type="button" style={{ ...actionStyle, marginTop: 8 }} onClick={() => setSelection(null)}>إعادة التحديد</button>}
          </>}
          {mode === "rows" && <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 8 }}>
              <strong>تم تحديد {selectedRows.length} من {data.rows.length} صف</strong>
              <button type="button" style={actionStyle} onClick={() => setSelectedRows(data.rows.map((_, i) => i))}>تحديد الكل</button>
              <button type="button" style={actionStyle} onClick={() => setSelectedRows([])}>إلغاء التحديد</button>
            </div>
            <p style={{ margin: "8px 0", fontSize: 13 }}>الإجماليات ستُحسب للصفوف المختارة فقط (عند توفر قيم رقمية وعملة واحدة). الأرصدة المرحّلة كما هي في الكشف الأصلي.</p>
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
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            <button type="button" style={actionStyle} disabled={busy} onClick={() => { setPreviewBlob(null); setPreviewUrl(null); }}>تعديل الاختيار</button>
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
