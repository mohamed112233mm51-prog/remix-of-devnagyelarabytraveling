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

// ---- ROOT-CAUSE FIX (M1 + M1.1) --------------------------------------------
// Every column in public.* that FKs auth.users(id). Split by nullability so
// mandatory columns (profiles.id, user_roles.user_id) NEVER get NULLed;
// unmapped identities for those columns halt the restore in preflight.
// Nullability confirmed from information_schema on 2026-07-19.
const AUTH_USER_FK_COLUMNS_OPTIONAL: Record<string, string[]> = {
  activity_logs: ["user_id"],
  company_transactions: ["cancelled_by"],
  currency_supplier_transactions: ["cancelled_by"],
  expense_deductions: ["cancelled_by"],
  financial_audit_log: ["performed_by"],
  merchant_cash_collections: ["cancelled_by"],
  payment_splits: ["cancelled_by"],
  transactions: ["cancelled_by"],
  usd_treasury_transactions: ["cancelled_by"],
};

// NOT NULL columns FKing auth.users(id). MUST be remapped; NULL is illegal.
// Unmapped source ids for these columns block the restore in preflight.
const AUTH_USER_FK_COLUMNS_MANDATORY: Record<string, string[]> = {
  profiles: ["id"],
  user_roles: ["user_id"],
};

// Every column in public.* that FKs cash_boxes(id).
const CASH_BOX_FK_COLUMNS: Record<string, string[]> = {
  payment_splits: ["cash_box_id"],
  usd_treasury_transactions: ["cash_box_id"],
};

type Warning = { table: string; row_id: any; column: string; from: any; reason: string };

function normEmail(e: any): string {
  return String(e ?? "").trim().toLowerCase();
}

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

// ---- Target auth.users loader ----------------------------------------------
// Reads REAL auth.users (not just public.profiles). profiles.id may be missing
// for users that exist in auth but never got a profile row.
async function loadTargetAuthUsers(): Promise<{ users: Array<{ id: string; email: string }>; byEmail: Map<string, string>; duplicateEmails: string[]; ids: Set<string> }> {
  const users: Array<{ id: string; email: string }> = [];
  const perPage = 1000;
  let page = 1;
  // Loop until an empty page or fewer than perPage returned.
  while (true) {
    const { data, error } = await (supabaseAdmin as any).auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const list = data?.users ?? [];
    for (const u of list) users.push({ id: u.id, email: u.email ?? "" });
    if (list.length < perPage) break;
    page++;
    if (page > 50) break; // safety cap: 50k users
  }
  const byEmail = new Map<string, string>();
  const dupSet = new Set<string>();
  for (const u of users) {
    const e = normEmail(u.email);
    if (!e) continue;
    if (byEmail.has(e) && byEmail.get(e) !== u.id) dupSet.add(e);
    else byEmail.set(e, u.id);
  }
  return {
    users,
    byEmail,
    duplicateEmails: [...dupSet],
    ids: new Set(users.map((u) => u.id)),
  };
}

// ---- Identity preflight ----------------------------------------------------
export type IdentityPreflight = {
  sourceProfileCount: number;
  targetAuthUserCount: number;
  matched: Array<{ sourceId: string; targetId: string; email: string }>;
  missingByEmail: Array<{ sourceId: string; email: string }>;
  duplicateSourceEmails: Array<{ email: string; sourceIds: string[] }>;
  emptySourceEmails: Array<{ sourceId: string }>;
  duplicateTargetEmails: string[];
  // Mandatory identities referenced by source data that MUST resolve to a
  // target auth user. If any is unresolved and createMissing is off, restore
  // is blocked BEFORE any wipe.
  mandatoryUnmapped: Array<{ table: string; column: string; sourceUserId: string; email?: string; reason: string }>;
  canProceed: boolean;
};

async function buildIdentityPreflight(payload: BackupPayload) {
  const sourceProfiles: any[] = payload.data.profiles ?? [];
  const target = await loadTargetAuthUsers();

  // Detect source-side duplicate/empty emails.
  const sourceByEmail = new Map<string, string[]>();
  const emptySourceEmails: Array<{ sourceId: string }> = [];
  for (const sp of sourceProfiles) {
    if (!sp?.id) continue;
    const e = normEmail(sp.email);
    if (!e) { emptySourceEmails.push({ sourceId: sp.id }); continue; }
    const arr = sourceByEmail.get(e) ?? [];
    arr.push(sp.id);
    sourceByEmail.set(e, arr);
  }
  const duplicateSourceEmails: Array<{ email: string; sourceIds: string[] }> = [];
  for (const [e, ids] of sourceByEmail) if (ids.length > 1) duplicateSourceEmails.push({ email: e, sourceIds: ids });

  // Build source→target map (only unambiguous matches).
  const authUserIdMap = new Map<string, string>();
  const matched: IdentityPreflight["matched"] = [];
  const missingByEmail: IdentityPreflight["missingByEmail"] = [];
  const emailBySourceId = new Map<string, string>();
  for (const sp of sourceProfiles) {
    if (!sp?.id) continue;
    const e = normEmail(sp.email);
    if (e) emailBySourceId.set(sp.id, e);
    if (!e) continue;
    // Refuse to map if source has duplicate emails — ambiguous.
    if ((sourceByEmail.get(e)?.length ?? 0) > 1) continue;
    // Refuse to map if target has duplicate emails.
    if (target.duplicateEmails.includes(e)) continue;
    const targetId = target.byEmail.get(e);
    if (targetId) {
      authUserIdMap.set(sp.id, targetId);
      matched.push({ sourceId: sp.id, targetId, email: e });
    } else {
      missingByEmail.push({ sourceId: sp.id, email: e });
    }
  }

  // Collect mandatory identity references across data.
  const mandatoryUnmapped: IdentityPreflight["mandatoryUnmapped"] = [];
  for (const [table, cols] of Object.entries(AUTH_USER_FK_COLUMNS_MANDATORY)) {
    const rows: any[] = payload.data[table] ?? [];
    for (const r of rows) {
      for (const col of cols) {
        const v = r?.[col];
        if (!v) {
          mandatoryUnmapped.push({ table, column: col, sourceUserId: String(v ?? ""), reason: "empty value in mandatory NOT NULL column" });
          continue;
        }
        if (authUserIdMap.has(v)) continue;
        // Diagnose why it wasn't mapped.
        const email = emailBySourceId.get(v);
        let reason: string;
        if (!email) reason = "source user has no email in profiles";
        else if (duplicateSourceEmails.some((d) => d.email === email)) reason = `duplicate email in source (${email})`;
        else if (target.duplicateEmails.includes(email)) reason = `duplicate email in target auth (${email})`;
        else if (!target.byEmail.has(email)) reason = `email not present in target auth.users (${email})`;
        else reason = `unmapped (${email})`;
        mandatoryUnmapped.push({ table, column: col, sourceUserId: v, email, reason });
      }
    }
  }

  const preflight: IdentityPreflight = {
    sourceProfileCount: sourceProfiles.length,
    targetAuthUserCount: target.users.length,
    matched,
    missingByEmail,
    duplicateSourceEmails,
    emptySourceEmails,
    duplicateTargetEmails: target.duplicateEmails,
    mandatoryUnmapped,
    canProceed: mandatoryUnmapped.length === 0,
  };
  return { preflight, authUserIdMap, target, sourceProfiles, emailBySourceId };
}

// ---- Create missing dev auth users -----------------------------------------
// Server-side only. Never sends email. Random unrecoverable password. Bans
// the account so it can't sign in with password. Metadata records origin.
async function createMissingDevIdentities(
  missing: Array<{ sourceId: string; email: string }>,
  authUserIdMap: Map<string, string>,
): Promise<{ created: Array<{ sourceId: string; targetId: string; email: string }>; failed: Array<{ sourceId: string; email: string; error: string }> }> {
  const created: Array<{ sourceId: string; targetId: string; email: string }> = [];
  const failed: Array<{ sourceId: string; email: string; error: string }> = [];
  for (const m of missing) {
    try {
      // 32-byte cryptographically random password, never returned to client.
      const pwd = Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map((b) => b.toString(16).padStart(2, "0")).join("");
      const { data, error } = await (supabaseAdmin as any).auth.admin.createUser({
        email: m.email,
        password: pwd,
        email_confirm: true,
        user_metadata: { imported_from_backup: true, source_user_id: m.sourceId },
        // ban_duration is honored by GoTrue; keeps the account from logging in
        // via password while allowing FK references. ~100 years.
        ban_duration: "876000h",
      });
      if (error || !data?.user?.id) throw new Error(error?.message ?? "createUser returned no id");
      authUserIdMap.set(m.sourceId, data.user.id);
      created.push({ sourceId: m.sourceId, targetId: data.user.id, email: m.email });
    } catch (e: any) {
      failed.push({ sourceId: m.sourceId, email: m.email, error: e?.message ?? String(e) });
    }
  }
  return { created, failed };
}

export type RestoreOptions = {
  validateOnly?: boolean;
  createMissingIdentities?: boolean;
};

export type RestoreResult = {
  preflight: IdentityPreflight;
  aborted?: { reason: string };
  createdIdentities?: { created: number; failed: Array<{ sourceId: string; email: string; error: string }> };
  summary?: Record<string, any>;
};

export async function restoreFromPayload(
  payload: BackupPayload,
  opts: RestoreOptions = {},
): Promise<RestoreResult> {
  // Preflight FIRST — never touch data until identities resolve.
  const pre = await buildIdentityPreflight(payload);
  let preflight = pre.preflight;
  const authUserIdMap = pre.authUserIdMap;

  if (opts.validateOnly) {
    return { preflight };
  }

  // If preflight blocked, optionally create missing identities and re-check.
  let createdIdentities: RestoreResult["createdIdentities"];
  if (!preflight.canProceed) {
    if (!opts.createMissingIdentities) {
      return {
        preflight,
        aborted: {
          reason: `Identity preflight failed: ${preflight.mandatoryUnmapped.length} mandatory reference(s) cannot be resolved. Re-run with createMissingIdentities=true to auto-create dev auth users for missing source users.`,
        },
      };
    }
    // Only auto-create for cases where an email exists in source but not in
    // target (missingByEmail). Duplicates and empty-email cases stay blocked.
    const toCreate = preflight.missingByEmail;
    createdIdentities = await createMissingDevIdentities(toCreate, authUserIdMap);
    // Rebuild preflight with updated map (mandatoryUnmapped will drop resolved refs).
    // Cheap recompute in place — we've mutated authUserIdMap already.
    preflight = {
      ...preflight,
      matched: [...preflight.matched, ...createdIdentities.created.map((c) => ({ sourceId: c.sourceId, targetId: c.targetId, email: c.email }))],
      missingByEmail: preflight.missingByEmail.filter((m) => !authUserIdMap.has(m.sourceId)),
      mandatoryUnmapped: preflight.mandatoryUnmapped.filter((m) => !authUserIdMap.has(m.sourceUserId)),
    };
    preflight.canProceed = preflight.mandatoryUnmapped.length === 0;
    if (!preflight.canProceed) {
      return {
        preflight,
        createdIdentities: { created: createdIdentities.created.length, failed: createdIdentities.failed },
        aborted: {
          reason: `Identity preflight still failing after creating missing users. Unresolved mandatory refs: ${preflight.mandatoryUnmapped.length}. Resolve duplicate/empty emails in the source and retry.`,
        },
      };
    }
  }

  // Preflight OK → proceed with actual restore.
  const summary: Record<string, any> = {};
  let guardsDisabled = false;
  try {
    const { error: dErr } = await (supabaseAdmin as any).rpc("restore_disable_guards");
    if (!dErr) guardsDisabled = true;
    else console.error("[restore] disable_guards failed", dErr);
  } catch (e) {
    console.error("[restore] disable_guards exception", e);
  }
  try {
    await _restoreInner(payload, summary, authUserIdMap, pre.target.ids);
  } finally {
    if (guardsDisabled) {
      try { await (supabaseAdmin as any).rpc("restore_enable_guards"); }
      catch (e) { console.error("[restore] enable_guards failed", e); }
    }
  }

  return {
    preflight,
    createdIdentities: createdIdentities
      ? { created: createdIdentities.created.length, failed: createdIdentities.failed }
      : undefined,
    summary,
  };
}

async function _restoreInner(
  payload: BackupPayload,
  summary: Record<string, any>,
  authUserIdMap: Map<string, string>,
  targetAuthUserIds: Set<string>,
) {
  const warnings: Warning[] = [];
  const sourceProfiles: any[] = payload.data.profiles ?? [];

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

  // Row rewriter: mandatory user cols get remapped (preflight guarantees a
  // mapping exists); optional user cols NULL out unresolved refs; cash boxes
  // get remapped.
  function rewriteRow(table: string, row: any): any {
    const out = { ...row };
    const mandatoryCols = AUTH_USER_FK_COLUMNS_MANDATORY[table] ?? [];
    for (const col of mandatoryCols) {
      const v = out[col];
      if (!v) continue;
      const mapped = authUserIdMap.get(v);
      if (mapped) { if (mapped !== v) out[col] = mapped; }
      // If unmapped despite preflight, leave as-is; row will fail cleanly and
      // per-row retry will surface a real error instead of a NULL crash.
    }
    const optionalCols = AUTH_USER_FK_COLUMNS_OPTIONAL[table] ?? [];
    for (const col of optionalCols) {
      const v = out[col];
      if (!v) continue;
      if (authUserIdMap.has(v)) {
        const mapped = authUserIdMap.get(v)!;
        if (mapped !== v) out[col] = mapped;
      } else if (!targetAuthUserIds.has(v)) {
        warnings.push({ table, row_id: row.id, column: col, from: v, reason: "optional auth user ref not in target — set to NULL" });
        out[col] = null;
      }
    }
    const boxCols = CASH_BOX_FK_COLUMNS[table] ?? [];
    for (const col of boxCols) {
      const v = out[col];
      if (!v) continue;
      const mapped = cashBoxIdMap.get(v);
      if (mapped && mapped !== v) out[col] = mapped;
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

        for (const row of slice) {
          const r2 = isReference
            ? await (supabaseAdmin.from as any)(t).upsert(row, { onConflict })
            : await (supabaseAdmin.from as any)(t).insert(row);
          if (!r2.error) { written++; continue; }
          if (isReference && isDuplicateError(r2.error)) { skipped++; continue; }
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

  (summary as any).__meta = {
    userMap: {
      sourceProfiles: sourceProfiles.length,
      mapped: authUserIdMap.size,
      unmapped: sourceProfiles.length - authUserIdMap.size,
    },
    warnings: warnings.length,
    warningsSample: warnings.slice(0, 50),
  };
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
