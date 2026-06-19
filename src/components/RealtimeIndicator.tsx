import { Wifi, WifiOff } from "lucide-react";
import { useRealtimeStatus } from "@/hooks/useRealtime";
import { Spinner } from "@/components/Spinner";

export function RealtimeIndicator() {
  const status = useRealtimeStatus();
  const map = {
    connected: { label: "Realtime Connected", color: "var(--green, #10b981)" },
    connecting: { label: "Realtime Connecting", color: "var(--gold, #C9A84C)" },
    disconnected: { label: "Realtime Disconnected", color: "var(--red, #ef4444)" },
  } as const;
  const { label, color } = map[status];
  return (
    <div
      title={label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        color,
        background: "color-mix(in oklab, " + color + " 12%, transparent)",
        border: "1px solid color-mix(in oklab, " + color + " 30%, transparent)",
        whiteSpace: "nowrap",
      }}
    >
      {status === "connecting" ? (
        <Spinner size={14} aria-label="جارٍ الاتصال" />
      ) : status === "connected" ? (
        <Wifi size={13} strokeWidth={2.4} />
      ) : (
        <WifiOff size={13} strokeWidth={2.4} />
      )}
      <span>{status === "connected" ? "متصل" : status === "connecting" ? "جارٍ الاتصال" : "غير متصل"}</span>
    </div>
  );
}

