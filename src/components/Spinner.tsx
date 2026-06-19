import React from "react";

/**
 * Global brand Spinner — Navy ring + Gold rotating arc with subtle gold glow.
 * Single source of truth for all loading indicators across the system.
 *
 * Variants:
 *   <Spinner />                            inline 24px
 *   <Spinner size={48} withMark />         shows brand mark (ع) in center
 *   <Spinner size={64} withLogo />         shows company logo in center
 *   <PageLoader label="..." />             full-screen overlay (only one per screen)
 *   <InlineLoader />                       small inline indicator for buttons/cells
 */

type SpinnerProps = {
  size?: number;
  stroke?: number;
  withMark?: boolean;
  withLogo?: boolean;
  className?: string;
  style?: React.CSSProperties;
  "aria-label"?: string;
};

export function Spinner({
  size = 24,
  stroke,
  withMark = false,
  withLogo = false,
  className,
  style,
  "aria-label": ariaLabel = "جارٍ التحميل",
}: SpinnerProps) {
  const computedStroke = stroke ?? Math.max(2, Math.round(size / 14));
  const showCenter = withLogo || withMark;
  const fontSize = Math.max(10, Math.round(size * 0.38));

  return (
    <span
      role="status"
      aria-live="polite"
      aria-label={ariaLabel}
      className={`erp-spinner ${className ?? ""}`}
      style={{
        ["--erp-spinner-size" as any]: `${size}px`,
        ["--erp-spinner-stroke" as any]: `${computedStroke}px`,
        ...style,
      }}
    >
      <span className="erp-spinner__ring" />
      <span className="erp-spinner__arc" />
      {showCenter && (
        <span className="erp-spinner__core" style={{ fontSize }}>
          {withLogo ? (
            <img src="/src/assets/company-logo.png" alt="" draggable={false} />
          ) : (
            "ع"
          )}
        </span>
      )}
    </span>
  );
}

/**
 * Full-screen page overlay loader. Mount at most one at a time per screen.
 * Uses a portal-less fixed overlay with high z-index. Use `show` to control visibility
 * (do NOT mount/unmount conditionally to allow fade transitions).
 */
export function PageLoader({
  show = true,
  label = "جارٍ التحميل…",
}: {
  show?: boolean;
  label?: string;
}) {
  if (!show) return null;
  // Guard: prevent stacking. If another overlay is already rendered, skip this one.
  if (typeof document !== "undefined" && document.querySelector(".erp-loader-overlay")) {
    return null;
  }
  return (
    <div className="erp-loader-overlay" role="alert" aria-busy="true">
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <Spinner size={64} withMark />
        {label && <div className="erp-loader-overlay__label">{label}</div>}
      </div>
    </div>
  );
}

/** Small inline indicator suitable for buttons and table cells. */
export function InlineLoader({ size = 16 }: { size?: number }) {
  return <Spinner size={size} aria-label="جارٍ التنفيذ" />;
}

export default Spinner;
