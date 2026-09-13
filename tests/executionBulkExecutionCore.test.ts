import test from "node:test";
import assert from "node:assert/strict";
import { executeExistingExecutionCore } from "../src/lib/executionBulkExecutionCore.ts";

test("already executed row is idempotent and causes no writes", async () => {
  const calls: string[] = [];
  const result = await executeExistingExecutionCore("e1", {
    loadExecution: async () => ({ id: "e1", operation_status: "منفذ" }),
    setOperationStatus: async () => { calls.push("set"); return { id: "e1", operation_status: "منفذ" }; },
    postFinancials: async () => { calls.push("post"); },
  });
  assert.equal(result.status, "already_executed");
  assert.deepEqual(calls, []);
});

test("cancelled row is rejected before any financial mutation", async () => {
  const calls: string[] = [];
  await assert.rejects(() => executeExistingExecutionCore("e1", {
    loadExecution: async () => ({ id: "e1", operation_status: "ملغي" }),
    setOperationStatus: async () => { calls.push("set"); return { id: "e1", operation_status: "منفذ" }; },
    postFinancials: async () => { calls.push("post"); },
  }), /ملغية/);
  assert.deepEqual(calls, []);
});

test("normal execution sets status then uses canonical posting then FX lock", async () => {
  const calls: string[] = [];
  const result = await executeExistingExecutionCore("e1", {
    loadExecution: async () => ({ id: "e1", operation_status: "قيد التنفيذ" }),
    setOperationStatus: async (_id, next, expected) => {
      calls.push(`set:${expected}->${next}`);
      return { id: "e1", operation_status: next };
    },
    postFinancials: async () => { calls.push("post"); },
    lockFxBestEffort: async () => { calls.push("fx"); },
  });
  assert.equal(result.status, "executed");
  assert.deepEqual(calls, ["set:قيد التنفيذ->منفذ", "post", "fx"]);
});

test("financial posting failure rolls operation status back", async () => {
  const calls: string[] = [];
  await assert.rejects(() => executeExistingExecutionCore("e1", {
    loadExecution: async () => ({ id: "e1", operation_status: "جاهز للتنفيذ" }),
    setOperationStatus: async (_id, next, expected) => {
      calls.push(`set:${expected}->${next}`);
      return { id: "e1", operation_status: next };
    },
    postFinancials: async () => { calls.push("post"); throw new Error("posting failed"); },
  }), /posting failed/);
  assert.deepEqual(calls, ["set:جاهز للتنفيذ->منفذ", "post", "set:منفذ->جاهز للتنفيذ"]);
});

test("FX locking failure does not undo a successful execution", async () => {
  const calls: string[] = [];
  const result = await executeExistingExecutionCore("e1", {
    loadExecution: async () => ({ id: "e1", operation_status: "قيد التنفيذ" }),
    setOperationStatus: async (_id, next) => { calls.push(`set:${next}`); return { id: "e1", operation_status: next }; },
    postFinancials: async () => { calls.push("post"); },
    lockFxBestEffort: async () => { calls.push("fx"); throw new Error("missing rate"); },
  });
  assert.equal(result.status, "executed");
  assert.deepEqual(calls, ["set:منفذ", "post", "fx"]);
});
