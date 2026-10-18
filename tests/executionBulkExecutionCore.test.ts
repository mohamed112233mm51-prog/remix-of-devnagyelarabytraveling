import test from "node:test";
import assert from "node:assert/strict";
import { executeExistingExecutionCore } from "../src/lib/executionBulkExecutionCore.ts";

test("already executed row is idempotent and causes no writes", async () => {
  const calls: string[] = [];
  const result = await executeExistingExecutionCore("e1", {
    loadExecution: async () => ({ id: "e1", operation_status: "منفذ" }),
    saveWithFinancials: async () => { calls.push("atomic"); return { id: "e1", operation_status: "منفذ" }; },
  });
  assert.equal(result.status, "already_executed");
  assert.deepEqual(calls, []);
});

test("cancelled row is rejected before any financial mutation", async () => {
  const calls: string[] = [];
  await assert.rejects(() => executeExistingExecutionCore("e1", {
    loadExecution: async () => ({ id: "e1", operation_status: "ملغي" }),
    saveWithFinancials: async () => { calls.push("atomic"); return { id: "e1", operation_status: "منفذ" }; },
  }), /ملغية/);
  assert.deepEqual(calls, []);
});

test("normal execution uses one canonical atomic save then FX lock", async () => {
  const calls: string[] = [];
  const result = await executeExistingExecutionCore("e1", {
    loadExecution: async () => ({ id: "e1", operation_status: "قيد التنفيذ" }),
    saveWithFinancials: async (current) => {
      calls.push(`atomic:${current.operation_status}->منفذ`);
      return { id: "e1", operation_status: "منفذ" };
    },
    lockFxBestEffort: async () => { calls.push("fx"); },
  });
  assert.equal(result.status, "executed");
  assert.deepEqual(calls, ["atomic:قيد التنفيذ->منفذ", "fx"]);
});

test("failed atomic save does not attempt a second compensating request", async () => {
  const calls: string[] = [];
  await assert.rejects(() => executeExistingExecutionCore("e1", {
    loadExecution: async () => ({ id: "e1", operation_status: "جاهز للتنفيذ" }),
    saveWithFinancials: async () => { calls.push("atomic"); throw new Error("posting failed"); },
  }), /posting failed/);
  assert.deepEqual(calls, ["atomic"]);
});

test("FX locking failure does not undo a successful execution", async () => {
  const calls: string[] = [];
  const result = await executeExistingExecutionCore("e1", {
    loadExecution: async () => ({ id: "e1", operation_status: "قيد التنفيذ" }),
    saveWithFinancials: async () => { calls.push("atomic"); return { id: "e1", operation_status: "منفذ" }; },
    lockFxBestEffort: async () => { calls.push("fx"); throw new Error("missing rate"); },
  });
  assert.equal(result.status, "executed");
  assert.deepEqual(calls, ["atomic", "fx"]);
});
