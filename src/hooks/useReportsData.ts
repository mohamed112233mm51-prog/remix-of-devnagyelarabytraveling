import { useEffect, useId } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { readReportData, REPORT_TABLES, type ReportTab } from "@/lib/reportsData";
import { useAuth } from "@/hooks/useAuth";
import { usePerm } from "@/hooks/usePerm";

export const REPORT_QUERY_KEY = ["reports-period"] as const;
const REPORT_STALE_MS = 30_000;

export function useReportsData(tab: ReportTab, from: string, to: string) {
  const { user, profileLoaded } = useAuth();
  const { view: canViewReports } = usePerm("reports");
  const queryClient = useQueryClient();
  const subscriptionId = useId();
  const userId = user?.id;
  const enabled = Boolean(userId) && profileLoaded && canViewReports;
  const result = useQuery({
    queryKey: [...REPORT_QUERY_KEY, userId, tab, from, to],
    queryFn: ({ signal }) => readReportData(supabase, tab, { from, to }, signal),
    enabled,
    staleTime: REPORT_STALE_MS,
    gcTime: 120_000,
  });

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastRefresh = 0;
    let subscribed = false;
    const refresh = () => {
      if (timer) return;
      const queryKey = [...REPORT_QUERY_KEY, userId, tab];
      // Batch related row events and cap automatic report reads during bursts.
      timer = setTimeout(() => {
        timer = undefined;
        lastRefresh = Date.now();
        void queryClient.invalidateQueries({
          queryKey,
          refetchType: document.visibilityState === "hidden" ? "none" : "active",
        });
      }, Math.max(250, lastRefresh + REPORT_STALE_MS - Date.now()));
    };
    const channel = supabase.channel(`reports-${tab}-${subscriptionId}`);
    for (const table of REPORT_TABLES[tab]) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, refresh);
    }
    channel.subscribe((status) => {
      if (status !== "SUBSCRIBED") return;
      if (subscribed) refresh();
      subscribed = true;
    });
    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [enabled, queryClient, subscriptionId, tab, userId]);

  return result;
}
