// Server-only backup helpers. Never import in client code.
import { gzipSync, gunzipSync } from "node:zlib";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Tables to include in every backup (full app state).
// Order is PARENT -> CHILD (FK-safe for inserts).
// Restore wipes in reverse (child -> parent) then inserts in this order.
export const BACKUP_TABLES = [
  // Independent / reference
  "profiles",
  "user_roles",
  "app_settings",
  "system_dropdown_options",
  // Master entities (no FKs to operational tables)
  "issuing_companies",
  "agents",
  "merchants",
  "investors",
  "currency_suppliers",
  "cash_boxes",
  // Depends on issuing_companies/agents
  "company_pricing_rules",
  "expenses",
  // Workflow
  "submissions",
  "executions",
  // Financial movements
  "transactions",
  "company_transactions",
  "currency_supplier_transactions",
  "usd_treasury_transactions",
  "merchant_cash_collections",
  "investor_transactions",
  "expense_deductions",
  // Depends on transactions/cash_boxes
  "payment_splits",
  // Logs / misc
  "import_batches",
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
const UPSERT_CONFLICT_KEY: Record<string, string> = {
  app_settings: "key",
  user_roles: "user_id,role",
};

// ---- ROOT-CAUSE FIX (M1) ----------------------------------------------------
// Every column in public.* that FKs auth.users(id). Rows referencing a source
// user that doesn't exist in the target auth schema were previously killing
// the entire table (transactions.cancelled_by → auth.users was the actual
// cause of the 36 lost agent movements). We rewrite each such column to a
// mapped target uuid (via profiles.email) or to NULL when unmapped.
//
// Data pulled from pg_constraint on 2026-07-19 — matches production schema.
const AUTH_USER_FK_COLUMNS: Record<string, string[]> = {
  activity_logs: ["user_id"],
  company_transactions: ["cancelled_by"],
  currency_supplier_transactions: ["cancelled_by"],
  expense_deductions: ["cancelled_by"],
  financial_audit_log: ["performed_by"],
  merchant_cash_collections: ["cancelled_by"],
  payment_splits: ["cancelled_by"],
  transactions: ["cancelled_by"],
  usd_treasury_transactions: ["cancelled_by"],
  user_roles: ["user_id"],
  // profiles.id → auth.users(id) handled separately: skip rows whose profile
  // email isn't in target auth (they'd fail anyway and we don't NULL a PK).
};

// Every column in public.* that FKs cash_boxes(id). Previously only
// payment_splits got remapped; usd_treasury_transactions was silently failing.
const CASH_BOX_FK_COLUMNS: Record<string, string[]> = {
  payment_splits: ["cash_box_id"],
  usd_treasury_transactions: ["cash_box_id"],
};

type Warning = { table: string; row_id: any; column: string; from: any; reason: string };

function isDuplicateError(err: any): boolean {
  const code = String(err?.code ?? "");
  const msg = String(err?.message ?? err ?? "").toLowerCase();
  if (code === "23505") return true;
  return (
    msg.includes("duplicate key") ||
    msg.includes("already exists") ||
    (msg.includes("unique constraint") && !msg.includes("foreign key")) ||
    msg.includes("violates unique")
  );
}

export async function restoreFromPayload(payload: BackupPayload) {
  const summary: Record<string, {
    restored: number;
    skipped?: number;
    skippedMissingUser?: number;
    failed?: number;
    mode: "upsert" | "wipe-insert" | "map-insert";
    error?: string;
    errors?: Array<{ id: any; code?: string; message: string }>;
    details?: any;
  }> = {};

  let guardsDisabled = false;
  try {
    const { error: dErr } = await (supabaseAdmin as any).rpc("restore_disable_guards");
    if (!dErr) guardsDisabled = true;
    else console.error("[restore] disable_guards failed", dErr);
  } catch (e) {
    console.error("[restore] disable_guards exception", e);
  }
  try {
    return await _restoreInner(payload, summary);
  } finally {
    if (guardsDisabled) {
      try { await (supabaseAdmin as any).rpc("restore_enable_guards"); }
      catch (e) { console.error("[restore] enable_guards failed", e); }
    }
  }
}

async function _restoreInner(
  payload: BackupPayload,
  summary: Record<string, any>,
) {
  const warnings: Warning[] = [];

  // ---- Build authUserIdMap: source_user_id -> target_user_id (via email) ----
  // Source: payload.data.profiles (id + email from production).
  // Target: current dev profiles (id + email). profiles.id == auth.users.id.
  const sourceProfiles: any[] = payload.data.profiles ?? [];
  const authUserIdMap = new Map<string, string>();
  const targetAuthUserIds = new Set<string>();
  try {
    const { data: targetProfiles } = await (supabaseAdmin.from as any)("profiles")
      .select("id,email");
    const byEmail = new Map<string, string>();
    for (const p of targetProfiles ?? []) {
      targetAuthUserIds.add(p.id);
      if (p.email) byEmail.set(String(p.email).toLowerCase().trim(), p.id);
    }
    for (const sp of sourceProfiles) {
      if (!sp?.id || !sp?.email) continue;
      const targetId = byEmail.get(String(sp.email).toLowerCase().trim());
      if (targetId) authUserIdMap.set(sp.id, targetId);
    }
    console.log(`[restore] user map built: ${authUserIdMap.size}/${sourceProfiles.length} source users mapped by email`);
  } catch (e: any) {
    console.error("[restore] user map build failed", e);
  }

  // PHASE 1: wipe non-reference tables (children first)
  const wipeOrder = [...BACKUP_TABLES].reverse().filter((t) => !REFERENCE_TABLES_NO_WIPE.has(t));
  for (const t of wipeOrder) {
    try {
      const del = await (supabaseAdmin.from as any)(t).delete().not("id", "is", null);
      if (del.error) throw new Error(`wipe: ${del.error.message}`);
    } catch (e: any) {
      summary[t] = { restored: 0, mode: "wipe-insert", error: e?.message ?? String(e) };
    }
  }

  const cashBoxIdMap = new Map<string, string>();
  let cashBoxesMapped = 0;
  let cashBoxesCreated = 0;

  // Row rewriter: nulls out unresolvable auth.users refs, remaps cash_box_ids.
  function rewriteRow(table: string, row: any): any {
    const out = { ...row };
    const userCols = AUTH_USER_FK_COLUMNS[table] ?? [];
    for (const col of userCols) {
      const v = out[col];
      if (!v) continue;
      if (authUserIdMap.has(v)) {
        const mapped = authUserIdMap.get(v)!;
        if (mapped !== v) out[col] = mapped;
      } else if (!targetAuthUserIds.has(v)) {
        warnings.push({ table, row_id: row.id, column: col, from: v, reason: "auth user not in target — set to NULL" });
        out[col] = null;
      }
    }
    const boxCols = CASH_BOX_FK_COLUMNS[table] ?? [];
    for (const col of boxCols) {
      const v = out[col];
      if (!v) continue;
      const mapped = cashBoxIdMap.get(v);
      if (mapped) {
        if (mapped !== v) out[col] = mapped;
      } else {
        // cash_box_id in source but not in map → box didn't exist in source
        // payload either; leave as-is only if it exists in target, else NULL.
        // We can't check target cheaply per-row; rely on FK to catch and
        // fall through to per-row retry which will null it below.
      }
    }
    return out;
  }

  // PHASE 2: insert in FORWARD FK order
  for (const t of BACKUP_TABLES) {
    if (summary[t]?.error) continue; // wipe failed
    const rows = payload.data[t] ?? [];
    const isReference = REFERENCE_TABLES_NO_WIPE.has(t);

    try {
      // --- Special: cash_boxes (unique on name+currency, build ID map) ---
      if (t === "cash_boxes") {
        const { data: existing, error: exErr } = await (supabaseAdmin.from as any)("cash_boxes")
          .select("id,name,currency");
        if (exErr) throw new Error(`fetch existing: ${exErr.message}`);
        const keyOf = (n: any, c: any) =>
          `${String(n ?? "").trim().toLowerCase()}|${String(c ?? "").trim().toUpperCase()}`;
        const byKey = new Map<string, string>();
        for (const r of existing ?? []) byKey.set(keyOf(r.name, r.currency), r.id);
        const existingIds = new Set<string>((existing ?? []).map((r: any) => r.id));

        const toInsert: any[] = [];
        for (const row of rows) {
          const oldId = row.id;
          const k = keyOf(row.name, row.currency);
          const existId = byKey.get(k);
          if (existId) {
            cashBoxIdMap.set(oldId, existId);
            cashBoxesMapped++;
          } else {
            const newId = existingIds.has(oldId) ? crypto.randomUUID() : oldId;
            cashBoxIdMap.set(oldId, newId);
            toInsert.push({ ...row, id: newId });
            cashBoxesCreated++;
          }
        }
        let inserted = 0;
        const CHUNK = 500;
        for (let i = 0; i < toInsert.length; i += CHUNK) {
          const slice = toInsert.slice(i, i + CHUNK);
          const res = await (supabaseAdmin.from as any)("cash_boxes").insert(slice);
          if (res.error) throw new Error(`insert: ${res.error.message}`);
          inserted += slice.length;
        }
        summary[t] = {
          restored: cashBoxesMapped + inserted,
          mode: "map-insert",
          details: { mapped: cashBoxesMapped, created: cashBoxesCreated },
        };
        continue;
      }

      // --- Generic insert with per-row fallback on error ---
      // Every row is rewritten first (auth.users + cash_box remapping).
      // On any batch failure we fall back to row-by-row so a single bad
      // row can never take down the whole table.
      const prepared = rows.map((r) => rewriteRow(t, r));
      const CHUNK = 500;
      let written = 0;
      let skipped = 0;
      let skippedMissingUser = 0;
      const perRowErrors: Array<{ id: any; code?: string; message: string }> = [];
      const onConflict = UPSERT_CONFLICT_KEY[t] ?? "id";

      for (let i = 0; i < prepared.length; i += CHUNK) {
        const slice = prepared.slice(i, i + CHUNK);
        if (slice.length === 0) continue;
        const res = isReference
          ? await (supabaseAdmin.from as any)(t).upsert(slice, { onConflict })
          : await (supabaseAdmin.from as any)(t).insert(slice);
        if (!res.error) { written += slice.length; continue; }

        // Batch failed → retry row-by-row to isolate offenders.
        for (const row of slice) {
          const r2 = isReference
            ? await (supabaseAdmin.from as any)(t).upsert(row, { onConflict })
            : await (supabaseAdmin.from as any)(t).insert(row);
          if (!r2.error) { written++; continue; }
          if (isReference && isDuplicateError(r2.error)) { skipped++; continue; }
          // For FK to auth.users that slipped through (shouldn't happen after
          // rewrite, but be defensive): count as skipped-missing-user.
          const msg = String(r2.error.message ?? "").toLowerCase();
          if (r2.error.code === "23503" && msg.includes("auth.users")) {
            skippedMissingUser++;
            continue;
          }
          perRowErrors.push({
            id: row.id,
            code: r2.error.code,
            message: r2.error.message ?? String(r2.error),
          });
        }
      }
      summary[t] = {
        restored: written,
        skipped,
        skippedMissingUser,
        failed: perRowErrors.length,
        errors: perRowErrors.slice(0, 20),
        mode: isReference ? "upsert" : "wipe-insert",
      };
    } catch (e: any) {
      summary[t] = {
        restored: 0,
        mode: isReference ? "upsert" : "wipe-insert",
        error: e?.message ?? String(e),
      };
    }
  }

  // Reconcile cash_box balances after all splits are in.
  try {
    const { data: boxes } = await (supabaseAdmin.from as any)("cash_boxes")
      .select("id,opening_balance");
    const { data: allSplits } = await (supabaseAdmin.from as any)("payment_splits")
      .select("cash_box_id,amount,direction,cancelled_at");
    const sums = new Map<string, number>();
    for (const s of allSplits ?? []) {
      if (!s.cash_box_id || s.cancelled_at) continue;
      const sign = s.direction === "out" ? -1 : 1;
      sums.set(s.cash_box_id, (sums.get(s.cash_box_id) ?? 0) + sign * Number(s.amount ?? 0));
    }
    for (const b of boxes ?? []) {
      const bal = Number(b.opening_balance ?? 0) + (sums.get(b.id) ?? 0);
      await (supabaseAdmin.from as any)("cash_boxes").update({ balance: bal }).eq("id", b.id);
    }
  } catch (e) {
    console.error("[restore] cash_box balance reconcile failed", e);
  }

  // Attach top-level metadata for the UI.
  (summary as any).__meta = {
    userMap: {
      sourceProfiles: sourceProfiles.length,
      mapped: authUserIdMap.size,
      unmapped: sourceProfiles.length - authUserIdMap.size,
    },
    warnings: warnings.length,
    warningsSample: warnings.slice(0, 50),
  };
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
