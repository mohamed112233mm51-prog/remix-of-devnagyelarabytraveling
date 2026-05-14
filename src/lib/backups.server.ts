// Server-only backup helpers. Never import in client code.
import { gzipSync, gunzipSync } from "node:zlib";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Tables to include in every backup (full app state).
// Order matters for restore: parents-first ish; but since we wipe & insert per table
// without FK constraints, order is informational only.
export const BACKUP_TABLES = [
  "agents",
  "issuing_companies",
  "merchants",
  "investors",
  "flights",
  "approvals",
  "transactions",
  "company_transactions",
  "merchant_cash_collections",
  "investor_transactions",
  "expenses",
  "expense_deductions",
  "system_dropdown_options",
  "app_settings",
  "profiles",
  "user_roles",
  "activity_logs",
] as const;

export type BackupType = "daily" | "weekly" | "monthly" | "manual" | "emergency" | "restore";

const PAGE_SIZE = 1000;

async function fetchAllRows(table: string): Promise<any[]> {
  const out: any[] = [];
  let from = 0;
  // Loop with pagination (range) to avoid 1000-row default cap and memory spikes.
  while (true) {
    const { data, error } = await (supabaseAdmin.from as any)(table)
      .select("*")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`fetch ${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return out;
}

export type BackupPayload = {
  meta: {
    version: 1;
    type: BackupType;
    created_at: string;
    table_counts: Record<string, number>;
  };
  data: Record<string, any[]>;
};

export async function buildBackupPayload(type: BackupType): Promise<BackupPayload> {
  const data: Record<string, any[]> = {};
  const counts: Record<string, number> = {};
  for (const t of BACKUP_TABLES) {
    try {
      const rows = await fetchAllRows(t);
      data[t] = rows;
      counts[t] = rows.length;
    } catch (e: any) {
      // Don't fail the whole backup on one missing table; record empty.
      data[t] = [];
      counts[t] = 0;
      console.error(`[backup] skip ${t}: ${e?.message}`);
    }
  }
  return {
    meta: {
      version: 1,
      type,
      created_at: new Date().toISOString(),
      table_counts: counts,
    },
    data,
  };
}

function pad(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

export function backupFilePath(type: BackupType, now = new Date()) {
  const y = now.getUTCFullYear();
  const m = pad(now.getUTCMonth() + 1);
  const d = pad(now.getUTCDate());
  const hh = pad(now.getUTCHours());
  const mm = pad(now.getUTCMinutes());
  const name = `backup-${y}-${m}-${d}-${hh}-${mm}.json.gz`;
  return `${type}/${y}/${m}/${d}/${name}`;
}

export async function uploadBackup(type: BackupType, payload: BackupPayload) {
  const json = JSON.stringify(payload);
  const gz = gzipSync(Buffer.from(json, "utf8"));
  const path = backupFilePath(type);
  const { error } = await supabaseAdmin.storage
    .from("system-backups")
    .upload(path, gz, {
      contentType: "application/gzip",
      upsert: false,
    });
  if (error) throw new Error(`upload: ${error.message}`);
  return { path, size: gz.byteLength };
}

export async function downloadBackupPayload(path: string): Promise<BackupPayload> {
  const { data, error } = await supabaseAdmin.storage.from("system-backups").download(path);
  if (error || !data) throw new Error(`download: ${error?.message ?? "no data"}`);
  const buf = Buffer.from(await data.arrayBuffer());
  const json = gunzipSync(buf).toString("utf8");
  const parsed = JSON.parse(json) as BackupPayload;
  if (!parsed?.meta || !parsed?.data) throw new Error("invalid backup file");
  return parsed;
}

// Performs full restore by wiping each backed-up table then re-inserting in chunks.
// Bypasses RLS via service role. Caller MUST be admin (enforced upstream).
export async function restoreFromPayload(payload: BackupPayload) {
  const summary: Record<string, { restored: number; error?: string }> = {};
  for (const t of BACKUP_TABLES) {
    const rows = payload.data[t] ?? [];
    try {
      // Wipe table. Using a non-null id filter ensures DELETE has a where.
      const del = await (supabaseAdmin.from as any)(t).delete().not("id", "is", null);
      if (del.error) throw new Error(`wipe: ${del.error.message}`);

      // Insert in chunks
      const CHUNK = 500;
      let inserted = 0;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const slice = rows.slice(i, i + CHUNK);
        if (slice.length === 0) continue;
        const ins = await (supabaseAdmin.from as any)(t).insert(slice);
        if (ins.error) throw new Error(`insert: ${ins.error.message}`);
        inserted += slice.length;
      }
      summary[t] = { restored: inserted };
    } catch (e: any) {
      summary[t] = { restored: 0, error: e?.message ?? String(e) };
    }
  }
  return summary;
}

// Retention policy: daily 30d, weekly 6mo (~183d), monthly 1y (365d), manual/emergency kept.
export async function applyRetention() {
  const now = Date.now();
  const limits: Record<string, number> = {
    daily: 30 * 24 * 3600 * 1000,
    weekly: 183 * 24 * 3600 * 1000,
    monthly: 365 * 24 * 3600 * 1000,
  };
  let deletedCount = 0;
  for (const [type, ms] of Object.entries(limits)) {
    // List all under prefix `${type}/`
    const paths = await listAllUnder(type + "/");
    const cutoff = now - ms;
    const toDelete: string[] = [];
    for (const p of paths) {
      // file path includes year/month/day; use storage object created_at via metadata
      // Fallback to filename parsing.
      const m = p.name.match(/backup-(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})/);
      if (!m) continue;
      const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
      if (t < cutoff) toDelete.push(p.fullPath);
    }
    if (toDelete.length > 0) {
      const { error } = await supabaseAdmin.storage.from("system-backups").remove(toDelete);
      if (!error) deletedCount += toDelete.length;
    }
  }
  return { deleted: deletedCount };
}

type Listed = { name: string; fullPath: string; size: number; created_at?: string };

export async function listAllUnder(prefix: string): Promise<Listed[]> {
  // Recursive list since storage list is non-recursive.
  const out: Listed[] = [];
  async function walk(p: string) {
    const { data, error } = await supabaseAdmin.storage
      .from("system-backups")
      .list(p, { limit: 1000, sortBy: { column: "name", order: "desc" } });
    if (error || !data) return;
    for (const item of data) {
      const isFolder = (item as any).id == null;
      const full = p ? `${p}${item.name}` : item.name;
      if (isFolder) {
        await walk(full + "/");
      } else {
        out.push({
          name: item.name,
          fullPath: full,
          size: (item as any).metadata?.size ?? 0,
          created_at: (item as any).created_at,
        });
      }
    }
  }
  await walk(prefix);
  return out;
}

// ---- Helpers used by both server fns and the cron route ----
import type { SupabaseClient } from "@supabase/supabase-js";

export async function logBackupRow(row: {
  backup_type: BackupType;
  file_path?: string | null;
  file_size?: number | null;
  status: "success" | "failed" | "running";
  failure_reason?: string | null;
  created_by?: string | null;
  restore_date?: string | null;
  restored_by?: string | null;
}) {
  try {
    await (supabaseAdmin as SupabaseClient).from("backup_logs").insert(row as any);
  } catch (e) {
    console.error("[backup] log insert failed", e);
  }
}

export async function runBackupWithRetry(type: BackupType, createdBy: string | null, retries = 1) {
  let lastErr: any = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const payload = await buildBackupPayload(type);
      const { path, size } = await uploadBackup(type, payload);
      await logBackupRow({ backup_type: type, file_path: path, file_size: size, status: "success", created_by: createdBy });
      return { path, size };
    } catch (e: any) {
      lastErr = e;
      console.error(`[backup] attempt ${attempt + 1} failed`, e);
    }
  }
  await logBackupRow({
    backup_type: type,
    status: "failed",
    failure_reason: lastErr?.message ?? String(lastErr),
    created_by: createdBy,
  });
  throw lastErr;
}
