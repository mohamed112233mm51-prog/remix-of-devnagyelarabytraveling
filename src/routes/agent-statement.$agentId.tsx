import { createFileRoute } from "@tanstack/react-router";
import { AgentLedger } from "@/components/AgentLedger";

export const Route = createFileRoute("/agent-statement/$agentId")({
  component: AgentStatementRoute,
});

function AgentStatementRoute() {
  const { agentId } = Route.useParams();
  return <AgentLedger lockedAgentId={agentId} showAgentProfile canExport />;
}
