import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type BackupType = "daily" | "weekly" | "monthly" | "manual" | "emergency" | "restore";

async function ensureAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Response("Forbidden", { status: 403 });
}

// ---- Admin server functions ----

export const createBackup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { type?: BackupType }) => ({ type: (d?.type ?? "manual") as BackupType }))
  .handler(async ({ data, context }) => {
    await ensureAdmin(context.userId);
    const { runBackupWithRetry } = await import("./backups.server");
    const res = await runBackupWithRetry(data.type, context.userId, 1);
    return res;
  });

export const listBackups = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await ensureAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { listAllUnder } = await import("./backups.server");
    const types: (BackupType | "imported")[] = ["manual", "daily", "weekly", "monthly", "emergency", "imported"];

    const all: Array<{ type: string; path: string; name: string; size: number; created_at?: string }> = [];
    for (const t of types) {
      const items = await listAllUnder(t + "/");
      for (const it of items) {
        all.push({ type: t, path: it.fullPath, name: it.name, size: it.size, created_at: it.created_at });
      }
    }
    all.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
    const { data: logs } = await supabaseAdmin
      .from("backup_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    return { backups: all, logs: logs ?? [] };
  });

export const downloadBackup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { path: string }) => d)
  .handler(async ({ data, context }) => {
    await ensureAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed, error } = await supabaseAdmin.storage
      .from("system-backups")
      .createSignedUrl(data.path, 60 * 5);
    if (error || !signed) throw new Error(error?.message ?? "sign failed");
    return { url: signed.signedUrl };
  });

export const deleteBackup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { path: string }) => d)
  .handler(async ({ data, context }) => {
    await ensureAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.storage.from("system-backups").remove([data.path]);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const previewBackup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { path: string }) => d)
  .handler(async ({ data, context }) => {
    await ensureAdmin(context.userId);
    const { downloadBackupPayload } = await import("./backups.server");
    const payload = await downloadBackupPayload(data.path);
    return { meta: payload.meta };
  });

export const restoreBackup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { path: string; confirm: boolean }) => d)
  .handler(async ({ data, context }) => {
    await ensureAdmin(context.userId);
    if (!data.confirm) throw new Error("confirmation required");
    const { buildBackupPayload, uploadBackup, logBackupRow, downloadBackupPayload, restoreFromPayload } = await import("./backups.server");

    // 1) Emergency backup first
    const emergency = await buildBackupPayload("emergency");
    const up = await uploadBackup("emergency", emergency);
    await logBackupRow({
      backup_type: "emergency",
      file_path: up.path,
      file_size: up.size,
      status: "success",
      created_by: context.userId,
    });

    // 2) Validate target
    const payload = await downloadBackupPayload(data.path);

    // 3) Restore
    const summary = await restoreFromPayload(payload);
    const failed = Object.entries(summary).filter(([, v]) => v.error);
    await logBackupRow({
      backup_type: "restore",
      file_path: data.path,
      status: failed.length > 0 ? "failed" : "success",
      failure_reason: failed.length > 0 ? failed.map(([t, v]) => `${t}: ${v.error}`).join("; ") : null,
      restore_date: new Date().toISOString(),
      restored_by: context.userId,
      created_by: context.userId,
    });
    return { summary, emergency_path: up.path };
  });

export const runRetentionNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await ensureAdmin(context.userId);
    const { applyRetention } = await import("./backups.server");
    return await applyRetention();
  });

// Import an externally-supplied backup file (json or json.gz) into the same
// storage bucket used by automatic backups, and register a backup_logs row so
// the existing list / preview / restore UI can act on it unchanged.
export const importBackup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { filename: string; base64: string; isGzipped: boolean }) => d)
  .handler(async ({ data, context }) => {
    await ensureAdmin(context.userId);
    const { gzipSync, gunzipSync } = await import("node:zlib");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { backupFilePath, logBackupRow } = await import("./backups.server");

    // Decode the uploaded file
    const raw = Buffer.from(data.base64, "base64");
    let jsonBuf: Buffer;
    let gzBuf: Buffer;
    try {
      if (data.isGzipped) {
        gzBuf = raw;
        jsonBuf = gunzipSync(raw);
      } else {
        jsonBuf = raw;
        gzBuf = gzipSync(raw);
      }
    } catch (e: any) {
      throw new Error("تعذر قراءة الملف: " + (e?.message ?? "ملف تالف"));
    }

    // Validate JSON structure
    let payload: any;
    try {
      payload = JSON.parse(jsonBuf.toString("utf8"));
    } catch {
      throw new Error("ملف النسخة الاحتياطية غير صالح.");
    }
    const hasShape =
      payload &&
      typeof payload === "object" &&
      payload.meta &&
      typeof payload.meta === "object" &&
      payload.data &&
      typeof payload.data === "object" &&
      payload.meta.version != null &&
      payload.meta.type != null &&
      payload.meta.created_at != null;
    if (!hasShape) throw new Error("ملف النسخة الاحتياطية غير صالح.");

    // Upload to the same bucket under an "imported/" folder (same path scheme
    // as the existing backup files so listBackups picks it up automatically).
    const path = backupFilePath("imported" as any);
    const blob = new Blob([new Uint8Array(gzBuf)], { type: "application/gzip" });
    const up = await supabaseAdmin.storage
      .from("system-backups")
      .upload(path, blob, { contentType: "application/gzip", upsert: false });
    if (up.error) throw new Error("فشل رفع الملف: " + up.error.message);

    // Long-lived signed URL for convenience
    let fileUrl: string | null = null;
    try {
      const { data: signed } = await supabaseAdmin.storage
        .from("system-backups")
        .createSignedUrl(path, 60 * 60 * 24 * 7);
      fileUrl = signed?.signedUrl ?? null;
    } catch {}

    const backupName = `imported-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    await logBackupRow({
      backup_type: "imported" as any,
      backup_name: backupName,
      file_path: path,
      file_url: fileUrl,
      file_size: gzBuf.byteLength,
      status: "completed",
      created_by: context.userId,
      completed_at: new Date().toISOString(),
    } as any);

    const versionMismatch = payload.meta.version !== 1;
    return { path, size: gzBuf.byteLength, versionMismatch, meta: payload.meta };
  });


