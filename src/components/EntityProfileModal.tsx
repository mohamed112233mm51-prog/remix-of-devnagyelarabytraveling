import type { ReactNode } from "react";
import { Modal } from "@/components/Modal";

export type ProfileField = { label: string; value: ReactNode };
export type ProfileKpi = { label: string; value: ReactNode; tone?: "gold" | "green" | "red" | "default" };

/**
 * Shared read-only profile modal for entities like agents and companies.
 * Keeps editing logic in the parent — provides only a clear "edit" CTA.
 */
export function EntityProfileModal({
  open,
  onClose,
  titlePrefix,
  name,
  status,
  fields,
  kpis,
  editLabel,
  canEdit,
  onEdit,
  headerActions,
  extraContent,
}: {
  open: boolean;
  onClose: () => void;
  titlePrefix: string;
  name: string;
  status?: { label: string; tone?: string } | null;
  fields: ProfileField[];
  kpis?: ProfileKpi[];
  editLabel: string;
  canEdit?: boolean;
  onEdit?: () => void;
  headerActions?: ReactNode;
  extraContent?: ReactNode;

}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      maxWidth={720}
      title={
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ color: "var(--text2)", fontWeight: 600 }}>{titlePrefix}:</span>
          <span style={{ fontWeight: 800 }}>{name}</span>
          {status?.label && (
            <span className={`badge pill-badge ${status.tone || ""}`}>{status.label}</span>
          )}
        </div>
      }
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", width: "100%" }}>
          <button className="action-btn" onClick={onClose} type="button">إغلاق</button>
          {canEdit && onEdit && (
            <button className="btn btn-gold" onClick={onEdit} type="button">✏️ {editLabel}</button>
          )}
        </div>
      }
    >
      {kpis && kpis.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: 10,
            marginBottom: 14,
          }}
        >
          {kpis.map((k, i) => (
            <div
              key={i}
              className="card"
              style={{
                margin: 0,
                padding: "10px 12px",
                boxShadow: "none",
                border: "1px solid var(--border)",
                borderRadius: 10,
              }}
            >
              <div style={{ fontSize: 12, color: "var(--text2)" }}>{k.label}</div>
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 800,
                  marginTop: 4,
                  color:
                    k.tone === "green" ? "var(--green)" :
                    k.tone === "red" ? "var(--red)" :
                    k.tone === "gold" ? "var(--gold)" :
                    "var(--text)",
                }}
              >
                {k.value}
              </div>
            </div>
          ))}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 10,
        }}
      >
        {fields.map((f, i) => (
          <div
            key={i}
            style={{
              padding: "8px 12px",
              border: "1px solid var(--border)",
              borderRadius: 8,
              background: "var(--card)",
            }}
          >
            <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 2 }}>{f.label}</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
              {f.value ?? "—"}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
