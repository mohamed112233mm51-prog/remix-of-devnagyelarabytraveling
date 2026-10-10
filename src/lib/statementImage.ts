import html2canvas from "html2canvas";
import { buildStatementPdfHtml, type StatementExportData } from "./exportStatement";
import { statementImagePrintHtml, statementImageWidth } from "./statementImageLayout";

async function awaitPdfFonts(doc: Document): Promise<void> {
  const fonts = (doc as Document & { fonts?: FontFaceSet }).fonts;
  if (!fonts) return;
  try {
    await fonts.ready;
    await Promise.all([
      fonts.load('700 14px "Cairo"'),
      fonts.load('400 14px "Cairo"'),
    ]);
  } catch {
    // If external fonts are unavailable, the PDF's local Arabic fallbacks apply.
  }
}

async function waitForDocumentPaint(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

function canvasAsPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("تعذر إنشاء ملف PNG من الكشف"));
    }, "image/png");
  });
}

/**
 * Render the PDF print template itself rather than a separate Excel-like image
 * table. Image-only CSS expands the report without changing the PDF or Excel.
 * All temporary elements and raster data stay in browser memory.
 */
export async function generateStatementImage(data: StatementExportData): Promise<Blob> {
  const { html } = await buildStatementPdfHtml(data);
  const width = statementImageWidth(data.columns.length);
  const iframe = document.createElement("iframe");
  iframe.title = "Temporary PDF-style statement image renderer";
  iframe.setAttribute("aria-hidden", "true");
  iframe.setAttribute("data-screenshot-ignore", "true");
  iframe.style.cssText = [
    "position:fixed",
    "left:-20000px",
    "top:0",
    "height:1px",
    "width:" + width + "px",
    "border:0",
    "pointer-events:none",
    "z-index:-1",
  ].join(";");
  document.body.appendChild(iframe);

  try {
    const doc = iframe.contentDocument;
    if (!doc) throw new Error("تعذر فتح قالب تصدير الصورة");
    doc.open();
    doc.write(statementImagePrintHtml(html));
    doc.close();

    // The same Cairo/Tajawal font setup used by PDF exports must settle before
    // rasterization; otherwise Arabic shaping and cell measurements can differ.
    await Promise.race([
      awaitPdfFonts(doc),
      new Promise<void>((resolve) => setTimeout(resolve, 4500)),
    ]);
    await Promise.all(
      Array.from(doc.images).map((img) => img.decode().catch(() => undefined)),
    );
    await waitForDocumentPaint();

    const page = doc.querySelector<HTMLElement>(".page");
    if (!page) throw new Error("لم يتم العثور على محتوى كشف PDF");
    const captureWidth = Math.ceil(Math.max(page.scrollWidth, page.getBoundingClientRect().width));
    const captureHeight = Math.ceil(Math.max(page.scrollHeight, page.getBoundingClientRect().height));
    if (captureWidth <= 0 || captureHeight <= 0) throw new Error("محتوى الصورة فارغ");

    // Avoid silently reducing text quality or exhausting canvas memory for very
    // long statements; the existing row selector is a safe alternative.
    const scale = Math.min(2, Math.sqrt(32000000 / (captureWidth * captureHeight)));
    if (scale < 1 || captureHeight * scale > 32000 || captureWidth * scale > 32000) {
      throw new Error("الكشف طويل جدًا لصورة واضحة واحدة؛ اختر صفوفًا أقل من خيار تحديد الصفوف");
    }

    iframe.style.height = captureHeight + "px";
    const canvas = await html2canvas(page, {
      scale,
      backgroundColor: "#ffffff",
      useCORS: true,
      allowTaint: false,
      logging: false,
      width: captureWidth,
      height: captureHeight,
      scrollX: 0,
      scrollY: 0,
      windowWidth: captureWidth,
      windowHeight: captureHeight,
    });
    return await canvasAsPng(canvas);
  } finally {
    iframe.remove();
  }
}
