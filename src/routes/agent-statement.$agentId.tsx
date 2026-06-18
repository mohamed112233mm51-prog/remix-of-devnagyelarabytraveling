import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AgentLedger } from "@/components/AgentLedger";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";

export const Route = createFileRoute("/agent-statement/$agentId")({
  component: AgentStatementRoute,
});

function AgentStatementRoute() {
  const { agentId } = Route.useParams();
  // Run approval-expiry fine scan on open so the ledger reflects fresh penalties.
  useEffect(() => {
    import("@/lib/approvalFines").then((m) => m.processExpiredApprovalPenalties({ silent: true })).catch(() => {});
  }, []);
  return <AppErrorBoundary name="AgentLedger"><AgentLedger lockedAgentId={agentId} showAgentProfile canExport /></AppErrorBoundary>;
}

