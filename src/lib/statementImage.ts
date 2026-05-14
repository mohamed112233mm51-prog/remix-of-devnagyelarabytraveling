import html2canvas from "html2canvas";
import type { StatementExportData } from "./exportStatement";
import { loadBranding } from "./branding";

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!),
  );


function buildHtml(data: StatementExportData, branding: { logoDataUrl: string; companyName: string }): string {
  const summary = (data.summary || [])
    .map(
      (s) =>
        `<div class="sum"><div class="lbl">${esc(s.label)}</div><div class="val">${esc(s.value)}</div></div>`,
    )
    .join("");

  const head = data.columns.map((c) => `<th>${esc(c.header)}</th>`).join("");
  const body = data.rows.length
    ? data.rows
        .map(
          (r) =>
            `<tr>${data.columns
              .map((c) => `<td>${esc(r[c.key] ?? "—")}</td>`)
              .join("")}</tr>`,
        )
        .join("")
    : `<tr><td colspan="${data.columns.length}" style="text-align:center;color:#666">لا توجد حركات</td></tr>`;

  const today = new Date().toLocaleDateString("ar-EG");

  return `
    <div class="brand-bar">
      ${branding.logoDataUrl ? `<img class="logo" src="${esc(branding.logoDataUrl)}" alt="" />` : ""}
      <div class="brand-meta">
        <div class="co">${esc(branding.companyName)}</div>
        <div class="title">${esc(data.title)}</div>
        ${data.subtitle ? `<div class="sub">${esc(data.subtitle)}</div>` : ""}
        <div class="date">تاريخ التقرير: ${esc(today)}</div>
      </div>
    </div>
    ${summary ? `<div class="summary">${summary}</div>` : ""}
    <table>
      <thead><tr>${head}</tr></thead>
      <tbody>${body}</tbody>
    </table>
    <div class="foot">${esc(branding.companyName)} • العملة: ج.م</div>
  `;
}

const STYLE = `
  * { box-sizing: border-box; }
  .root {
    direction: rtl;
    font-family: 'Cairo', 'Tajawal', Arial, sans-serif;
    color: #111;
    background: #fff;
    padding: 28px;
    line-height: 1.8;
    font-size: 16px;
    text-rendering: geometricPrecision;
  }
  .brand-bar { display: flex; align-items: center; gap: 16px; background: linear-gradient(135deg,#0F1B3D 0%, #1a2a5e 100%); color: #fff; padding: 16px 18px; border-radius: 12px; margin-bottom: 16px; border-bottom: 4px solid #C9A84C; }
  .brand-bar .logo { width: 64px; height: 64px; object-fit: contain; background: #fff; border-radius: 10px; padding: 5px; flex-shrink: 0; }
  .brand-bar .brand-meta { flex: 1; text-align: right; }
  .brand-bar .co { font-size: 18px; font-weight: 800; letter-spacing: .2px; }
  .brand-bar .title { font-size: 20px; font-weight: 800; color: #C9A84C; margin-top: 4px; }
  .brand-bar .sub { font-size: 14px; color: #e2e8f0; margin-top: 2px; }
  .brand-bar .date { font-size: 12px; color: #cbd5e1; margin-top: 4px; }
  .summary { display: flex; flex-wrap: wrap; gap: 10px; margin: 14px 0 18px; justify-content: center; }
  .summary .sum { border: 1px solid #ddd; border-right: 3px solid #C9A84C; border-radius: 8px; padding: 10px 14px; min-width: 160px; text-align: center; background: #fafafa; }
  .summary .sum .lbl { font-size: 13px; color: #555; margin-bottom: 4px; }
  .summary .sum .val { font-size: 16px; font-weight: 700; color: #0F1B3D; }
  table { width: 100%; border-collapse: collapse; table-layout: auto; margin-top: 6px; }
  th, td { border: 1px solid #ccc; padding: 10px 8px; text-align: center; font-size: 14px; line-height: 1.7; vertical-align: middle; white-space: nowrap; }
  th { background: #0F1B3D; color: #fff; font-weight: 700; font-size: 14px; border-color: #C9A84C; }
  tbody tr:nth-child(even) td { background: #fafafa; }
  .foot { margin-top: 14px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e5e7eb; padding-top: 8px; }
`;

async function waitForFonts() {
  try {
    await (document as Document & { fonts?: FontFaceSet }).fonts?.ready;
  } catch {}
}

export async function generateStatementImage(
  data: StatementExportData,
): Promise<Blob> {
  const wrapper = document.createElement("div");
  wrapper.setAttribute("data-screenshot-ignore", "true");
  wrapper.style.cssText = [
    "position:fixed",
    "left:-100000px",
    "top:0",
    "width:1100px",
    "background:#ffffff",
    "z-index:-1",
    "pointer-events:none",
  ].join(";");

  const style = document.createElement("style");
  style.textContent = STYLE;
  wrapper.appendChild(style);

  const root = document.createElement("div");
  root.className = "root";
  root.dir = "rtl";
  const branding = await loadBranding();
  root.innerHTML = buildHtml(data, { logoDataUrl: branding.logoDataUrl, companyName: branding.companyName });
  wrapper.appendChild(root);

  document.body.appendChild(wrapper);

  try {
    await waitForFonts();
    await new Promise<void>((r) => requestAnimationFrame(() => r()));

    const canvas = await html2canvas(root, {
      scale: 2,
      backgroundColor: "#ffffff",
      useCORS: true,
      logging: false,
      windowWidth: root.scrollWidth,
      windowHeight: root.scrollHeight,
    });

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => {
        if (b) resolve(b);
        else reject(new Error("blob failed"));
      }, "image/png");
    });
  } finally {
    wrapper.remove();
  }
}
