import { useEffect, useMemo, useState } from "react";

const NAVY = "#0f1b3d";

export interface UsePaginationResult<T> {
  page: number;
  pageSize: number;
  setPage: (p: number) => void;
  setPageSize: (n: number) => void;
  pageCount: number;
  total: number;
  pageRows: T[];
  /** Inline pagination controls component (Arabic, RTL, enterprise style) */
  Controls: React.FC<{ className?: string; style?: React.CSSProperties }>;
}

/**
 * Smart pagination hook.
 * - Auto-resets to page 0 when source list changes size dramatically.
 * - Provides a ready-to-render `<Controls />` component matching the
 *   enterprise ERP look (Arabic, RTL, navy primary).
 * - Renders nothing when there's only one page (zero visual cost).
 */
export function usePagination<T>(rows: T[], initialPageSize = 50): UsePaginationResult<T> {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const safeRows = Array.isArray(rows) ? rows : [];

  const total = safeRows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  // Clamp page if rows shrink (e.g. after filtering).
  useEffect(() => {
    if (page > pageCount - 1) setPage(Math.max(0, pageCount - 1));
  }, [pageCount, page]);

  const pageRows = useMemo(
    () => safeRows.slice(page * pageSize, (page + 1) * pageSize),
    [safeRows, page, pageSize],
  );

  const Controls: UsePaginationResult<T>["Controls"] = ({ className, style }) => {
    if (pageCount <= 1) return null;
    const from = page * pageSize + 1;
    const to = Math.min(total, (page + 1) * pageSize);

    // Build a compact window of page buttons: first, prev, current ±2, last
    const pages: (number | "…")[] = [];
    const push = (n: number) => { if (!pages.includes(n)) pages.push(n); };
    push(0);
    for (let i = Math.max(1, page - 1); i <= Math.min(pageCount - 2, page + 1); i++) push(i);
    push(pageCount - 1);
    const compact: (number | "…")[] = [];
    let prev = -1;
    for (const p of pages) {
      if (typeof p === "number") {
        if (prev !== -1 && p - prev > 1) compact.push("…");
        compact.push(p);
        prev = p;
      }
    }

    const btn: React.CSSProperties = {
      minWidth: 32,
      height: 32,
      padding: "0 10px",
      borderRadius: 8,
      border: "1px solid #e2e8f0",
      background: "#fff",
      color: NAVY,
      fontSize: 12,
      fontWeight: 700,
      cursor: "pointer",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
    };
    const active: React.CSSProperties = {
      ...btn,
      background: `linear-gradient(135deg, ${NAVY}, #1e3a8a)`,
      color: "#fff",
      border: 0,
    };
    const disabled: React.CSSProperties = { ...btn, opacity: 0.45, cursor: "not-allowed" };

    return (
      <div
        className={className}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          padding: "12px 16px",
          borderTop: "1px solid #eef2f7",
          background: "#fafbfd",
          ...style,
        }}
      >
        <div style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>
          عرض <b style={{ color: "#0f172a" }}>{from.toLocaleString("ar")}</b>
          {" – "}
          <b style={{ color: "#0f172a" }}>{to.toLocaleString("ar")}</b>
          {" من "}
          <b style={{ color: "#0f172a" }}>{total.toLocaleString("ar")}</b>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <button
            style={page === 0 ? disabled : btn}
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
            aria-label="السابق"
          >
            ‹ السابق
          </button>
          {compact.map((p, i) =>
            p === "…" ? (
              <span key={`e${i}`} style={{ color: "#94a3b8", padding: "0 4px" }}>…</span>
            ) : (
              <button
                key={p}
                style={p === page ? active : btn}
                onClick={() => setPage(p)}
                aria-current={p === page ? "page" : undefined}
              >
                {(p + 1).toLocaleString("ar")}
              </button>
            ),
          )}
          <button
            style={page >= pageCount - 1 ? disabled : btn}
            disabled={page >= pageCount - 1}
            onClick={() => setPage(page + 1)}
            aria-label="التالي"
          >
            التالي ›
          </button>
          <select
            value={pageSize}
            onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}
            style={{ ...btn, minWidth: 64, padding: "0 8px" }}
            aria-label="عدد الصفوف"
          >
            {[25, 50, 100, 200].map((n) => (
              <option key={n} value={n}>{n.toLocaleString("ar")} / صفحة</option>
            ))}
          </select>
        </div>
      </div>
    );
  };

  return { page, pageSize, setPage, setPageSize, pageCount, total, pageRows, Controls };
}
