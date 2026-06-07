import { createFileRoute } from "@tanstack/react-router";
import { AgentLedger } from "@/components/AgentLedger";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";

export const Route = createFileRoute("/agent-statement/$agentId")({
  component: AgentStatementRoute,
});

function AgentStatementRoute() {
  const { agentId } = Route.useParams();
  return <AppErrorBoundary name="AgentLedger"><AgentLedger lockedAgentId={agentId} showAgentProfile canExport /></AppErrorBoundary>;
}
