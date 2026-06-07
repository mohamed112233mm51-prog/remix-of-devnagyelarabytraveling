import { createFileRoute } from "@tanstack/react-router";
import { runBackupWithRetry, applyRetention, type BackupType } from "@/lib/backups.server";

const ALLOWED: BackupType[] = ["daily", "weekly", "monthly", "manual"];

const routeOptions = {
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        // Authenticate via Supabase anon key in apikey header (canonical pg_cron pattern).
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
        const provided = request.headers.get("apikey") ?? request.headers.get("Apikey") ?? "";
        if (!expected || provided !== expected) {
          return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
        }

        let body: any = {};
        try {
          body = await request.json();
        } catch {
          body = {};
        }
        const action = (body?.action ?? "backup") as "backup" | "retention";

        try {
          if (action === "retention") {
            const r = await applyRetention();
            return Response.json({ ok: true, ...r });
          }
          const type = (body?.type ?? "daily") as BackupType;
          if (!ALLOWED.includes(type)) {
            return new Response(JSON.stringify({ error: "invalid type" }), { status: 400, headers: { "Content-Type": "application/json" } });
          }
          const r = await runBackupWithRetry(type, null, 1);
          return Response.json({ ok: true, ...r });
        } catch (e: any) {
          return new Response(JSON.stringify({ error: e?.message ?? "backup failed" }), { status: 500, headers: { "Content-Type": "application/json" } });
        }
      },
    },
  },
};

export const Route = createFileRoute("/api/public/hooks/backup")(routeOptions as any);
