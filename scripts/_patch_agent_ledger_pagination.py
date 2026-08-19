from pathlib import Path

path = Path("src/components/AgentLedger.tsx")
s = path.read_text(encoding="utf-8")

replacements = [
(
'''  const flights: any[] = [];\n  const { rows: liveTxns } = useLive<Transaction>("transactions");\n  const { rows: liveMerchants } = useLive<Merchant>("merchants");''',
'''  const flights: any[] = [];\n  const { rows: liveMerchants } = useLive<Merchant>("merchants");'''),
(
'''  const absentLookup = useMemo(() => buildAbsentLookup(Array.isArray(liveExecutions) ? liveExecutions : []), [liveExecutions]);\n  const agents = Array.isArray(liveAgents) ? liveAgents : [];\n  const txns = Array.isArray(liveTxns) ? liveTxns : [];\n  const merchants = Array.isArray(liveMerchants) ? liveMerchants : [];\n  const [selectedAgentId, setSelectedAgentId] = useState(lockedAgentId || initialAgentId || "");''',
'''  const absentLookup = useMemo(() => buildAbsentLookup(Array.isArray(liveExecutions) ? liveExecutions : []), [liveExecutions]);\n  const agents = Array.isArray(liveAgents) ? liveAgents : [];\n  const merchants = Array.isArray(liveMerchants) ? liveMerchants : [];\n  const [selectedAgentId, setSelectedAgentId] = useState(lockedAgentId || initialAgentId || "");\n  const [agentTxns, setAgentTxns] = useState<Transaction[]>([]);'''),
(
'''  useEffect(() => { if (lockedAgentId) setSelectedAgentId(lockedAgentId); }, [lockedAgentId]);\n  useEffect(() => { if (!lockedAgentId) setSelectedAgentId(initialAgentId || ""); }, [initialAgentId, lockedAgentId]);\n\n  const agent = agents.find((a) => a.id === selectedAgentId);''',
'''  useEffect(() => { if (lockedAgentId) setSelectedAgentId(lockedAgentId); }, [lockedAgentId]);\n  useEffect(() => { if (!lockedAgentId) setSelectedAgentId(initialAgentId || ""); }, [initialAgentId, lockedAgentId]);\n\n  const AGENT_TX_PAGE_SIZE = 1000;\n  useEffect(() => {\n    let cancelled = false;\n    let channel: ReturnType<typeof supabase.channel> | null = null;\n\n    const loadAllAgentTransactions = async () => {\n      if (!selectedAgentId) {\n        if (!cancelled) setAgentTxns([]);\n        return;\n      }\n\n      const allRows: Transaction[] = [];\n      let from = 0;\n\n      while (!cancelled) {\n        const { data, error } = await supabase\n          .from("transactions")\n          .select("*")\n          .eq("agent_id", selectedAgentId)\n          .order("created_at", { ascending: true })\n          .order("id", { ascending: true })\n          .range(from, from + AGENT_TX_PAGE_SIZE - 1);\n\n        if (error) {\n          toast.error(error.message || "تعذر تحميل كشف حساب الوكيل");\n          return;\n        }\n\n        const page = Array.isArray(data) ? (data as Transaction[]) : [];\n        allRows.push(...page);\n        if (page.length < AGENT_TX_PAGE_SIZE) break;\n        from += AGENT_TX_PAGE_SIZE;\n      }\n\n      if (!cancelled) setAgentTxns(allRows);\n    };\n\n    loadAllAgentTransactions();\n\n    if (selectedAgentId) {\n      channel = supabase\n        .channel(`agent-ledger-transactions-${selectedAgentId}-${Math.random().toString(36).slice(2)}`)\n        .on(\n          "postgres_changes" as any,\n          { event: "*", schema: "public", table: "transactions", filter: `agent_id=eq.${selectedAgentId}` },\n          () => loadAllAgentTransactions(),\n        )\n        .subscribe();\n    }\n\n    return () => {\n      cancelled = true;\n      if (channel) supabase.removeChannel(channel);\n    };\n  }, [selectedAgentId]);\n\n  const agent = agents.find((a) => a.id === selectedAgentId);'''),
(
'''  const myTxnsAll = useMemo(() => txns.filter((t) => t.agent_id === selectedAgentId), [txns, selectedAgentId]);''',
'''  const myTxnsAll = agentTxns;'''),
]

for old, new in replacements:
    if old not in s:
        raise SystemExit("Expected AgentLedger pattern not found; aborting without changes.")
    s = s.replace(old, new, 1)

path.write_text(s, encoding="utf-8")
print("patched", path)
# trigger workflow
