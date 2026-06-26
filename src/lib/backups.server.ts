// Server-only backup helpers. Never import in client code.
import { gzipSync, gunzipSync } from "node:zlib";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Tables to include in every backup (full app state).
// Order matters for restore: parents-first ish; but since we wipe & insert per table
// without FK constraints, order is informational only.
export const BACKUP_TABLES = [
  "agents",
  "company_pricing_rules",
  "issuing_companies",
  "merchants",
  "investors",
  "currency_suppliers",
  "currency_supplier_transactions",
  "usd_treasury_transactions",
  "cash_boxes",
  "payment_splits",
  "submissions",
  "executions",
  "transactions",
  "company_transactions",
  "merchant_cash_collections",
  "investor_transactions",
  "expenses",
  "expense_deductions",
  "import_batches",
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
  // Wrap in Blob for Cloudflare Workers compatibility (avoids Node Buffer edge cases).
  const blob = new Blob([new Uint8Array(gz)], { type: "application/gzip" });
  console.log(`[backup] uploading ${path} (${gz.byteLength} bytes)`);
  const { error } = await supabaseAdmin.storage
    .from("system-backups")
    .upload(path, blob, {
      contentType: "application/gzip",
      upsert: false,
    });
  if (error) {
    console.error(`[backup] upload error for ${path}:`, error);
    throw new Error(`upload: ${error.message}`);
  }
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

// Reference/master tables: never wiped during restore. Rows are upserted by id
// so existing records get updated and missing ones get inserted, but related
// operational data (users, companies, agents, boxes, currencies) is preserved.
export const REFERENCE_TABLES_NO_WIPE: ReadonlySet<string> = new Set([
  "issuing_companies",
  "agents",
  "profiles",
  "user_roles",
  "cash_boxes",
  "currency_suppliers",
  "merchants",
  "investors",
  "app_settings",
  "system_dropdown_options",
]);

// Per-table conflict key for upsert. Default is "id" for tables that have it.
// Tables without an "id" column must declare their real PK here.
const UPSERT_CONFLICT_KEY: Record<string, string> = {
  app_settings: "key",
  user_roles: "user_id,role",
};

// Performs full restore. Reference tables are upserted (no wipe). Other tables
// are wiped then re-inserted in chunks. Bypasses RLS via service role.
// Caller MUST be admin (enforced upstream).
export async function restoreFromPayload(payload: BackupPayload) {
  const summary: Record<string, { restored: number; mode: "upsert" | "wipe-insert"; error?: string }> = {};
  for (const t of BACKUP_TABLES) {
    const rows = payload.data[t] ?? [];
    const isReference = REFERENCE_TABLES_NO_WIPE.has(t);
    try {
      if (!isReference) {
        // Wipe table. Using a non-null id filter ensures DELETE has a where.
        const del = await (supabaseAdmin.from as any)(t).delete().not("id", "is", null);
        if (del.error) throw new Error(`wipe: ${del.error.message}`);
      }

      // Insert / upsert in chunks
      const CHUNK = 500;
      let written = 0;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const slice = rows.slice(i, i + CHUNK);
        if (slice.length === 0) continue;
        const onConflict = UPSERT_CONFLICT_KEY[t] ?? "id";
        const res = isReference
          ? await (supabaseAdmin.from as any)(t).upsert(slice, { onConflict })
          : await (supabaseAdmin.from as any)(t).insert(slice);
        if (res.error) throw new Error(`${isReference ? "upsert" : "insert"}: ${res.error.message}`);
        written += slice.length;
      }
      summary[t] = { restored: written, mode: isReference ? "upsert" : "wipe-insert" };
    } catch (e: any) {
      summary[t] = { restored: 0, mode: isReference ? "upsert" : "wipe-insert", error: e?.message ?? String(e) };
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
  backup_name?: string | null;
  file_path?: string | null;
  file_url?: string | null;
  file_size?: number | null;
  status: "success" | "failed" | "running" | "pending" | "processing" | "completed";
  failure_reason?: string | null;
  error_message?: string | null;
  created_by?: string | null;
  restore_date?: string | null;
  restored_by?: string | null;
  completed_at?: string | null;
}) {
  try {
    const { data, error } = await (supabaseAdmin as SupabaseClient)
      .from("backup_logs")
      .insert(row as any)
      .select("id")
      .single();
    if (error) console.error("[backup] log insert error", error);
    return data?.id as string | undefined;
  } catch (e) {
    console.error("[backup] log insert failed", e);
    return undefined;
  }
}

async function updateBackupRow(id: string, patch: Record<string, any>) {
  try {
    const { error } = await (supabaseAdmin as SupabaseClient)
      .from("backup_logs")
      .update(patch)
      .eq("id", id);
    if (error) console.error("[backup] log update error", error);
  } catch (e) {
    console.error("[backup] log update failed", e);
  }
}

export async function runBackupWithRetry(
  type: BackupType,
  createdBy: string | null,
  retries = 1,
  triggerType: "manual" | "automatic" = "manual",
) {
  const startedAt = new Date();
  const backupName = `backup-${type}-${startedAt.toISOString().replace(/[:.]/g, "-")}`;
  console.log(`[backup] start ${backupName} trigger=${triggerType}`);

  // Dedup: if an automatic backup of the same type already ran today (completed),
  // skip to avoid duplicate runs for the same scheduled slot.
  if (triggerType === "automatic") {
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    const { data: existing } = await (supabaseAdmin as SupabaseClient)
      .from("backup_logs")
      .select("id, file_path")
      .eq("backup_type", type)
      .eq("trigger_type", "automatic")
      .eq("status", "completed")
      .gte("created_at", since.toISOString())
      .limit(1);
    if (existing && existing.length > 0) {
      console.log(`[backup] skip duplicate automatic ${type} for today`);
      return { path: existing[0].file_path as string, size: 0, file_url: null, backup_name: backupName, skipped: true };
    }
  }

  // 1) Insert "processing" tracking row
  const rowId = await logBackupRow({
    backup_type: type,
    backup_name: backupName,
    status: "processing",
    created_by: createdBy,
    trigger_type: triggerType,
    started_at: startedAt.toISOString(),
  } as any);

  let lastErr: any = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const payload = await buildBackupPayload(type);
      const { path, size } = await uploadBackup(type, payload);

      // Generate a long-lived signed URL for convenience (7 days).
      let fileUrl: string | null = null;
      try {
        const { data: signed } = await supabaseAdmin.storage
          .from("system-backups")
          .createSignedUrl(path, 60 * 60 * 24 * 7);
        fileUrl = signed?.signedUrl ?? null;
      } catch (e) {
        console.error("[backup] sign url failed", e);
      }

      const completedAt = new Date().toISOString();
      if (rowId) {
        await updateBackupRow(rowId, {
          file_path: path,
          file_url: fileUrl,
          file_size: size,
          status: "completed",
          completed_at: completedAt,
        });
      } else {
        // Fallback insert if processing row couldn't be created
        await logBackupRow({
          backup_type: type,
          backup_name: backupName,
          file_path: path,
          file_url: fileUrl,
          file_size: size,
          status: "completed",
          completed_at: completedAt,
          created_by: createdBy,
        });
      }
      console.log(`[backup] success ${backupName} -> ${path}`);
      return { path, size, file_url: fileUrl, backup_name: backupName };
    } catch (e: any) {
      lastErr = e;
      console.error(`[backup] attempt ${attempt + 1} failed`, e);
    }
  }
  const errMsg = lastErr?.message ?? String(lastErr);
  const completedAt = new Date().toISOString();
  if (rowId) {
    await updateBackupRow(rowId, {
      status: "failed",
      failure_reason: errMsg,
      error_message: errMsg,
      completed_at: completedAt,
    });
  } else {
    await logBackupRow({
      backup_type: type,
      backup_name: backupName,
      status: "failed",
      failure_reason: errMsg,
      error_message: errMsg,
      created_by: createdBy,
      completed_at: completedAt,
    });
  }
  throw lastErr;
}
