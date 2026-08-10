from pathlib import Path
import re

admin_path = Path('src/lib/admin.functions.ts')
admin = admin_path.read_text(encoding='utf-8')
admin_before = admin

# Remove the unauthenticated bootstrap endpoint and all hardcoded bootstrap credentials.
pattern = re.compile(
    r'\nconst BOOTSTRAP_EMAIL = .*?\nexport const bootstrapAdmin = createServerFn\(\{ method: "POST" \}\)\.handler\(async \(\) => \{.*?\n\}\);\n\n(?=async function ensureAdmin)',
    re.S,
)
admin, count = pattern.subn('\n', admin, count=1)
assert count == 1, f'expected one bootstrap block, got {count}'
for forbidden in ['BOOTSTRAP_EMAIL', 'BOOTSTRAP_PASSWORD', 'bootstrapAdmin']:
    assert forbidden not in admin, f'{forbidden} still present'
assert 'async function ensureAdmin' in admin
assert admin != admin_before
admin_path.write_text(admin, encoding='utf-8')

# Remove the automatic unauthenticated bootstrap call from the login screen.
login_path = Path('src/components/Login.tsx')
login = login_path.read_text(encoding='utf-8')
login_before = login
login = login.replace('import { useEffect, useState } from "react";\n', 'import { useState } from "react";\n', 1)
login = login.replace('import { useServerFn } from "@tanstack/react-start";\n', '', 1)
login = login.replace('import { bootstrapAdmin } from "@/lib/admin.functions";\n', '', 1)
login = login.replace('  const bootstrap = useServerFn(bootstrapAdmin);\n', '', 1)
login = login.replace(
'''\n  useEffect(() => {\n    bootstrap().catch(() => {});\n  }, []);\n''',
'\n',
1,
)
for forbidden in ['bootstrapAdmin', 'useServerFn', 'bootstrap()', 'useEffect(']:
    assert forbidden not in login, f'{forbidden} still present in Login.tsx'
assert 'const { signIn, signInWithGoogle, blocked, signOut } = useAuth();' in login
assert login != login_before
login_path.write_text(login, encoding='utf-8')

backup_path = Path('src/routes/api/public/hooks/backup.ts')
backup = '''import { createFileRoute } from "@tanstack/react-router";

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
  const match = /^Bearer\\s+(.+)$/i.exec(value.trim());
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
'''
backup_path.write_text(backup, encoding='utf-8')

written = backup_path.read_text(encoding='utf-8')
assert 'BACKUP_CRON_SECRET' in written
assert 'SUPABASE_PUBLISHABLE_KEY' not in written
assert 'SUPABASE_ANON_KEY' not in written
