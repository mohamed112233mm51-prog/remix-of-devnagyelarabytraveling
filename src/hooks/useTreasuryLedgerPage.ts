import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePerm } from "@/hooks/usePerm";
import { readTreasuryLedgerPage, type TreasuryLedgerRequest } from "@/lib/treasuryLedger";

export function useTreasuryLedgerPage(request: TreasuryLedgerRequest, monthKey: string) {
  const { user, profileLoaded } = useAuth();
  const permission = usePerm("reports");
  const queryClient = useQueryClient();
  const ids = [...request.boxIds].sort().join(",");
  const enabled = !!user?.id && profileLoaded && permission.view && !!ids;
  const result = useQuery({
    queryKey: ["treasury-ledger-page", user?.id, monthKey, ids, request.scope, request.month,
      request.page, request.boxId, request.direction, request.search.trim(), request.operations, request.kind],
    queryFn: ({ signal }) => readTreasuryLedgerPage(supabase, request, signal),
    enabled, staleTime: 30_000, gcTime: 120_000,
    refetchOnWindowFocus: true, retry: false,
  });
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: ["treasury-ledger-page", user?.id] });
      }, 200);
    };
    const channel = supabase.channel("treasury-page-" + user?.id + "-" + String(request.operations))
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_splits", filter: "cash_box_id=in.(" + ids + ")" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_boxes", filter: "id=in.(" + ids + ")" }, refresh)
      .subscribe((status) => { if (status === "SUBSCRIBED") refresh(); });
    return () => { if (timer) clearTimeout(timer); void supabase.removeChannel(channel); };
  }, [enabled, ids, user?.id, request.operations, queryClient]);
  return result;
}
