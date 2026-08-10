import { createFileRoute } from "@tanstack/react-router";

type BackupType = "daily" | "weekly" | "monthly" | "manual" | "emergency" | "restore";

const ALLOWED: BackupType[] = ["daily", "weekly", "monthly", "manual"];
const MIN_SECRET_LENGTH = 32;

function jsonError(error: string, status: number) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function readBearerToken(request: Request): string {
  const value = request.headers.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match?.[1]?.trim() || "";
}

const routeOptions = {
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        // Scheduled backups are privileged server operations. Authenticate them
        // with a dedicated server-only secret; never use Supabase anon/publishable
        // keys here because those keys are intentionally public to client apps.
        const expected = process.env.BACKUP_CRON_SECRET ?? "";
        if (expected.length < MIN_SECRET_LENGTH) {
          console.error("[backup webhook] BACKUP_CRON_SECRET is missing or too short");
          return jsonError("backup webhook is not configured", 503);
        }

        const provided = readBearerToken(request);
        if (!provided || provided.length !== expected.length || provided !== expected) {
          return jsonError("unauthorized", 401);
        }

        let body: any = {};
        try {
          body = await request.json();
        } catch {
          body = {};
        }
        const action = (body?.action ?? "backup") as "backup" | "retention";

        try {
          const serverModPath = "@/lib/backups.server";
          const { runBackupWithRetry, applyRetention } = await import(
            /* @vite-ignore */ serverModPath
          );
          if (action === "retention") {
            const r = await applyRetention();
            return Response.json({ ok: true, ...r }, { headers: { "Cache-Control": "no-store" } });
          }
          const type = (body?.type ?? "daily") as BackupType;
          if (!ALLOWED.includes(type)) {
            return jsonError("invalid type", 400);
          }
          const r = await runBackupWithRetry(type, null, 1, "automatic");
          return Response.json({ ok: true, ...r }, { headers: { "Cache-Control": "no-store" } });
        } catch (e: any) {
          return jsonError(e?.message ?? "backup failed", 500);
        }
      },
    },
  },
};

export const Route = createFileRoute("/api/public/hooks/backup")(routeOptions as any);
