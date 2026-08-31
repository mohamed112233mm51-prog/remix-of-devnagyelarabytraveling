import { supabase } from "@/integrations/supabase/client";
import { patchLive } from "@/lib/db";
import { voidAllForSource } from "@/lib/financialEngine";
import { deleteExecutionLinkedRows } from "@/lib/executionPosting";
import { importFinancialRows } from "./specialImport";
import { importExecutionRows } from "./executionImport";

const BATCH = 100;

export async function batchInsert(
  table: string,
  rows: Record<string, any>[],
  onProgress: (done: number, total: number) => void,
): Promise<{ insertedIds: string[]; failed: number }> {
  // These tables have application-side accounting/workflow effects and must
  // never use the generic direct insert path.
  if (table === "executions") {
    return importExecutionRows(rows, onProgress);
  }
  if (table === "transactions" || table === "company_transactions") {
    return importFinancialRows(table, rows, onProgress);
  }

  const insertedIds: string[] = [];
  let failed = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const { data, error } = await (supabase.from(table as any) as any).insert(chunk).select("id");
    if (error) {
      for (const r of chunk) {
        const { data: d2, error: e2 } = await (supabase.from(table as any) as any).insert(r).select("id").single();
        if (e2) failed++;
        else if (d2?.id) {
          insertedIds.push(d2.id);
          patchLive(table as any, { type: "insert", row: { ...r, id: d2.id, created_at: new Date().toISOString() } });
        }
      }
    } else if (Array.isArray(data)) {
      for (let j = 0; j < data.length; j++) {
        const id = (data[j] as any).id;
        insertedIds.push(id);
        patchLive(table as any, { type: "insert", row: { ...chunk[j], id, created_at: new Date().toISOString() } });
      }
    }
    onProgress(Math.min(i + chunk.length, rows.length), rows.length);
    await new Promise((r) => setTimeout(r, 0));
  }
  return { insertedIds, failed };
}

export async function recordBatch(opts: {
  importType: string;
  targetTable: string;
  fileName: string;
  userEmail: string | null;
  insertedIds: string[];
}) {
  await supabase.from("import_batches" as any).insert({
    import_type: opts.importType,
    target_table: opts.targetTable,
    file_name: opts.fileName,
    user_email: opts.userEmail,
    rows_inserted: opts.insertedIds.length,
    inserted_ids: opts.insertedIds,
  });
}

export async function undoBatch(batchId: string, table: string, ids: string[]) {
  if (ids.length) {
    // Financial imports must reverse their linked cash movements before the
    // parent rows are removed. Execution imports must remove generated agent/
    // company ledger rows exactly like the normal execution delete flow.
    if (table === "executions") {
      for (const id of ids) {
        await deleteExecutionLinkedRows(id);
        await supabase.from("executions").delete().eq("id", id);
        patchLive("executions", { type: "delete", row: { id } });
      }
    } else if (table === "transactions" || table === "company_transactions") {
      for (const id of ids) {
        const res = await voidAllForSource(table, id);
        if (!res.ok) throw new Error(res.error || "تعذر عكس حركة الخزنة");
        await (supabase.from(table as any) as any).delete().eq("id", id);
        patchLive(table as any, { type: "delete", row: { id } });
      }
    } else {
      for (let i = 0; i < ids.length; i += 200) {
        const chunk = ids.slice(i, i + 200);
        await supabase.from(table as any).delete().in("id", chunk);
        for (const id of chunk) patchLive(table as any, { type: "delete", row: { id } });
      }
    }
  }
  await supabase.from("import_batches" as any).update({ undone_at: new Date().toISOString() }).eq("id", batchId);
}
