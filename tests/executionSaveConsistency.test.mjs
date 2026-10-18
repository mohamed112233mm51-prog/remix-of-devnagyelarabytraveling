import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { buildExecutionFinancialRows } from "../src/lib/executionPostingRows.ts";
const db = new PGlite();
const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const tables = [
  "payment_splits",
  "financial_audit_log",
  "financial_operation_requests",
  "transactions",
  "company_transactions",
  "executions",
  "submissions",
];
const services = (price = 10000, cost = 8000, currency = "EGP") => [
  {
    kind: "agent",
    service_type: "تذكرة طيران",
    count: 1,
    agent_price: price,
    currency,
  },
  {
    kind: "company",
    service_type: "تذكرة طيران",
    company_id: id(20),
    count: 1,
    company_price: cost,
    company_value: cost,
    currency,
  },
];
const payload = (extra = {}) => ({
  passenger_name: "مسافر",
  agent_id: id(10),
  operation_status: "منفذ",
  services: services(),
  travel_date: "2099-12-31",
  ...extra,
});
async function row(table, key) {
  return (
    await db.query(
      `SELECT to_jsonb(t) AS row FROM public.${table} t WHERE ${table === "financial_operation_requests" ? "operation_id" : "id"}=$1`,
      [key],
    )
  ).rows[0]?.row;
}
async function count(table) {
  return Number(
    (await db.query(`SELECT count(*) AS n FROM public.${table}`)).rows[0].n,
  );
}
async function digest() {
  return (
    await db.query(
      `SELECT jsonb_build_object(${tables.map((t) => `'${t}',(SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY ${t === "financial_operation_requests" ? "operation_id" : "id"}),'[]'::jsonb) FROM public.${t} t)`).join(",")}) AS data`,
    )
  ).rows[0].data;
}
function plan({
  key = id(1),
  op = 100,
  action = "create",
  patch = payload(),
  expected = null,
} = {}) {
  const canonical = { ...expected, ...patch };
  const rows =
    action !== "delete" && canonical.operation_status === "منفذ"
      ? buildExecutionFinancialRows(
          {
            executionId: key,
            operationStatus: canonical.operation_status,
            agentId: canonical.agent_id,
            date: null,
            destination: canonical.destination,
            airline: canonical.airline,
            passengerName: canonical.passenger_name,
            executionNotes: canonical.notes,
            services: canonical.services,
          },
          (k) =>
            id(
              op * 100 +
                (k.startsWith("agent:") ? 10 : 20) +
                Number(k.split(":")[1]),
            ),
        )
      : [];
  return { key, op, body: { action, execution_patch: patch, expected, rows } };
}
async function rpc(request, permissions = {}) {
  for (const action of ["create", "edit", "delete"])
    await db.query("SELECT set_config($1,$2,false)", [
      "test.execution_" + action,
      String(permissions[action] ?? true),
    ]);
  await db.query(
    "SELECT set_config('test.can_audit',$1,false),set_config('request.jwt.claim.sub',$2,false)",
    [
      String(permissions.audit ?? true),
      permissions.auth === false ? "" : id(999),
    ],
  );
  await db.exec("SET ROLE authenticated");
  try {
    return (
      await db.query(
        "SELECT public.replace_execution_financials_atomic($1,$2,$3,$4,$5::jsonb) AS result",
        [
          id(request.op),
          "fingerprint:" + request.op,
          request.key,
          null,
          JSON.stringify(request.body),
        ],
      )
    ).rows[0].result;
  } finally {
    await db.exec("RESET ROLE");
  }
}
async function create(extra = {}, permissions = {}) {
  const req = plan({ patch: payload(extra) });
  await rpc(req, permissions);
  return row("executions", req.key);
}
async function update(patch, options = {}) {
  const expected = options.expected || (await row("executions", id(1)));
  return rpc(
    plan({ op: options.op || 101, action: "update", patch, expected }),
    options.permissions,
  );
}
async function remove(options = {}) {
  return rpc(
    plan({
      op: options.op || 102,
      action: "delete",
      patch: {},
      expected: options.expected || (await row("executions", id(1))),
    }),
    options.permissions,
  );
}
async function fail(table, operation) {
  await db.exec(
    `CREATE FUNCTION fail_${table}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced ${table} failure'; END $$; CREATE TRIGGER test_failure BEFORE ${operation} ON public.${table} FOR EACH ROW EXECUTE FUNCTION fail_${table}();`,
  );
}
async function seedSubmission(extra = {}) {
  await db.query(
    "INSERT INTO public.submissions(id,passenger_name,execution_id,operation_status) VALUES($1,$2,$3,$4)",
    [
      id(50),
      "مسافر",
      extra.execution_id || null,
      extra.operation_status || "قيد المتابعة",
    ],
  );
}
before(async () => {
  await db.exec(read("tests/fixtures/executionSaveDatabase.sql"));
  await db.exec(
    read(
      "supabase/migrations/20260830005000_execution_financial_atomic_replace.sql",
    ),
  );
  await db.exec(
    read(
      "supabase/migrations/20261018020243_execution_save_financial_atomic.sql",
    ),
  );
});
beforeEach(async () => {
  await db.exec("RESET ROLE");
  for (const t of tables)
    await db.exec(
      `DROP TRIGGER IF EXISTS test_failure ON public.${t}; DROP FUNCTION IF EXISTS public.fail_${t}(); DROP POLICY IF EXISTS test_restrict ON public.${t};`,
    );
  await db.exec("TRUNCATE " + tables.join(","));
});
after(async () => {
  await db.close();
});

test("create saves canonical services and both ledgers, using Cairo posting day instead of future travel date", async () => {
  const ex = await create();
  const today = (
    await db.query(
      "SELECT (now() AT TIME ZONE 'Africa/Cairo')::date::text AS d",
    )
  ).rows[0].d;
  assert.equal(ex.financial_posting_date, today);
  assert.equal(ex.travel_date, "2099-12-31");
  assert.equal(await count("transactions"), 1);
  assert.equal(await count("company_transactions"), 1);
  const tx = (
    await db.query("SELECT price,date::text FROM public.transactions")
  ).rows[0];
  assert.equal(Number(tx.price), 10000);
  assert.equal(tx.date, today);
  assert.equal(await count("financial_operation_requests"), 1);
  assert.equal(await count("financial_audit_log"), 3);
});
test("pending execution saves without financial rows or a posting date", async () => {
  const ex = await create({ operation_status: "قيد التنفيذ" });
  assert.equal(ex.financial_posting_date, null);
  assert.equal(await count("transactions"), 0);
  assert.equal(await count("company_transactions"), 0);
});
test("price, agent, company and currency edits replace both legs and keep first accounting date", async () => {
  await create();
  await db.exec(
    "UPDATE public.executions SET financial_posting_date='2024-01-02'",
  );
  const next = services(12000, 9000, "USD");
  next[1].company_id = id(21);
  await update({ services: next, agent_id: id(11), travel_date: "2098-01-01" });
  const tx = (
    await db.query(
      "SELECT agent_id,price,currency,date::text FROM public.transactions",
    )
  ).rows[0];
  const ct = (
    await db.query(
      "SELECT company_id,trip_value,currency,date::text FROM public.company_transactions",
    )
  ).rows[0];
  assert.deepEqual(
    [tx.agent_id, Number(tx.price), tx.currency, tx.date],
    [id(11), 12000, "USD", "2024-01-02"],
  );
  assert.deepEqual(
    [ct.company_id, Number(ct.trip_value), ct.currency, ct.date],
    [id(21), 9000, "USD", "2024-01-02"],
  );
});
test("failed company insertion rolls back a new execution, first ledger, submission link and audit", async () => {
  await seedSubmission();
  const initial = await digest();
  await fail("company_transactions", "INSERT");
  await assert.rejects(
    rpc(plan({ patch: payload({ submission_id: id(50) }) })),
    /forced company/,
  );
  assert.deepEqual(await digest(), initial);
});
test("failed replacement restores the old execution prices and BOTH old ledgers exactly", async () => {
  await create();
  const initial = await digest();
  await fail("company_transactions", "INSERT");
  await assert.rejects(
    update({ services: services(12000, 9000) }),
    /forced company/,
  );
  assert.deepEqual(await digest(), initial);
});
test("failed first approval leaves the execution pending with no posting date", async () => {
  await create({ operation_status: "قيد التنفيذ" });
  const initial = await digest();
  await fail("company_transactions", "INSERT");
  await assert.rejects(update({ operation_status: "منفذ" }), /forced company/);
  assert.deepEqual(await digest(), initial);
});
test("unposting changes status and removes generated debts while preserving the original posting date", async () => {
  const ex = await create();
  await update({ operation_status: "ملغي" });
  assert.equal((await row("executions", id(1))).operation_status, "ملغي");
  assert.equal(
    (await row("executions", id(1))).financial_posting_date,
    ex.financial_posting_date,
  );
  assert.equal(await count("transactions"), 0);
  assert.equal(await count("company_transactions"), 0);
});
test("failed unposting rolls back the cancelled status and deleted agent rows", async () => {
  await create();
  const initial = await digest();
  await fail("company_transactions", "DELETE");
  await assert.rejects(update({ operation_status: "ملغي" }), /forced company/);
  assert.deepEqual(await digest(), initial);
});
test("delete removes the execution and its own debts together and releases its submission link", async () => {
  await seedSubmission();
  await create({ submission_id: id(50) });
  await db.query(
    "INSERT INTO public.transactions(id,agent_id,price,source_service_type,source_service_id) VALUES($1,$2,77,$3,$4)",
    [id(88), id(10), "execution", id(2) + "::0"],
  );
  await remove();
  assert.equal(await count("executions"), 0);
  assert.equal(await count("company_transactions"), 0);
  assert.equal(await count("transactions"), 1);
  assert.ok(await row("transactions", id(88)));
  const sub = await row("submissions", id(50));
  assert.equal(sub.execution_id, null);
  assert.equal(sub.executed_at, null);
  assert.equal(sub.operation_status, "قيد المتابعة");
});
test("failure deleting the parent restores debts, submission link and audit", async () => {
  await seedSubmission();
  await create({ submission_id: id(50) });
  const initial = await digest();
  await fail("executions", "DELETE");
  await assert.rejects(remove(), /forced executions/);
  assert.deepEqual(await digest(), initial);
});
test("zero-row parent delete is detected instead of claiming success after deleting debts", async () => {
  await create();
  const initial = await digest();
  await db.exec(
    "CREATE FUNCTION fail_executions() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$; CREATE TRIGGER test_failure BEFORE DELETE ON public.executions FOR EACH ROW EXECUTE FUNCTION fail_executions();",
  );
  await assert.rejects(remove(), /تعذر حذف التنفيذ/);
  assert.deepEqual(await digest(), initial);
});
test("RLS silently denying a ledger deletion aborts the whole replacement", async () => {
  await create();
  const initial = await digest();
  await db.exec(
    "CREATE POLICY test_restrict ON public.transactions AS RESTRICTIVE FOR DELETE TO authenticated USING(false)",
  );
  await assert.rejects(
    update({ services: services(12000, 9000) }),
    /تعذر حذف كل قيود/,
  );
  assert.deepEqual(await digest(), initial);
});
test("RLS denying company insertion rolls back parent and agent insertion", async () => {
  const initial = await digest();
  await db.exec(
    "CREATE POLICY test_restrict ON public.company_transactions AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(false)",
  );
  await assert.rejects(rpc(plan()), /row-level security/);
  assert.deepEqual(await digest(), initial);
});
test("submission update permission failure rolls back creation and ledgers", async () => {
  await seedSubmission();
  const initial = await digest();
  await db.exec(
    "CREATE POLICY test_restrict ON public.submissions AS RESTRICTIVE FOR UPDATE TO authenticated USING(false) WITH CHECK(false)",
  );
  await assert.rejects(
    rpc(plan({ patch: payload({ submission_id: id(50) }) })),
    /التقديم|ربط/,
  );
  assert.deepEqual(await digest(), initial);
});
test("a submission already converted elsewhere cannot create a second execution", async () => {
  await seedSubmission({ execution_id: id(2) });
  const initial = await digest();
  await assert.rejects(
    rpc(plan({ patch: payload({ submission_id: id(50) }) })),
    /تنفيذ آخر/,
  );
  assert.deepEqual(await digest(), initial);
});
test("stale edit and stale delete cannot overwrite a newer execution snapshot", async () => {
  const old = await create();
  await update({ services: services(12000, 9000) });
  const initial = await digest();
  await assert.rejects(
    update({ services: services(14000, 10000) }, { expected: old, op: 103 }),
    /مستخدم آخر/,
  );
  await assert.rejects(remove({ expected: old }), /مستخدم آخر/);
  assert.deepEqual(await digest(), initial);
});
test("lost-response retry reuses the SAME execution and rows without new audit entries", async () => {
  const request = plan();
  await rpc(request);
  const initial = await digest();
  const retry = await rpc(request);
  assert.equal(retry.reused, true);
  assert.deepEqual(await digest(), initial);
});
test("delete retry is confirmed from the journal even after the execution is gone", async () => {
  const expected = await create();
  const request = plan({ action: "delete", op: 102, patch: {}, expected });
  await rpc(request);
  const initial = await digest();
  assert.equal((await rpc(request)).reused, true);
  assert.deepEqual(await digest(), initial);
});
test("reusing an operation ID with changed request data fails even with the same client fingerprint", async () => {
  const request = plan();
  await rpc(request);
  const initial = await digest();
  request.body.execution_patch.passenger_name = "آخر";
  await assert.rejects(rpc(request), /بيانات مختلفة/);
  assert.deepEqual(await digest(), initial);
});
test("anonymous calls and missing edit permission cannot mutate financial data", async () => {
  await assert.rejects(rpc(plan(), { auth: false }), /تسجيل الدخول/);
  await create();
  const initial = await digest();
  await assert.rejects(
    update({ notes: "مرفوض" }, { permissions: { edit: false } }),
    /صلاحية/,
  );
  assert.deepEqual(await digest(), initial);
});
test("create-only permission can create complete execution debts without requiring edit permission", async () => {
  const ex = await create({}, { create: true, edit: false, delete: false });
  assert.ok(ex.financial_posting_date);
  assert.equal(await count("transactions"), 1);
  assert.equal(await count("company_transactions"), 1);
});
test("delete-only permission can remove generated debts with their execution", async () => {
  await create();
  await remove({ permissions: { create: false, edit: false, delete: true } });
  assert.equal(await count("executions"), 0);
  assert.equal(await count("transactions"), 0);
});
test("old array posting payload cannot perform a separate financial-only rewrite", async () => {
  await create();
  const initial = await digest();
  await assert.rejects(rpc({ key: id(1), op: 103, body: [] }), /طلب واحد/);
  assert.deepEqual(await digest(), initial);
});
test("a foreign execution reference cannot be smuggled into the posting plan", async () => {
  const request = plan();
  request.body.rows[0].row.source_service_id = id(2) + "::0";
  const initial = await digest();
  await assert.rejects(rpc(request), /لا يخص التنفيذ/);
  assert.deepEqual(await digest(), initial);
});
test("wrong service currency and unrelated agent are rejected with full rollback", async () => {
  const request = plan();
  const initial = await digest();
  request.body.rows[0].row.currency = "USD";
  await assert.rejects(rpc(request), /لا يطابق خدمة/);
  request.body.rows[0].row.currency = "EGP";
  request.body.rows[0].row.agent_id = id(11);
  await assert.rejects(rpc(request), /طرف القيد/);
  assert.deepEqual(await digest(), initial);
});
test("editing execution debt with attached treasury payment fails closed instead of orphaning payments", async () => {
  await create();
  const tx = (await db.query("SELECT id FROM public.transactions")).rows[0];
  await db.query(
    "INSERT INTO public.payment_splits VALUES($1,'transactions',$2,50)",
    [id(80), tx.id],
  );
  const initial = await digest();
  await assert.rejects(
    update({ services: services(12000, 9000) }),
    /سداد خزينة/,
  );
  assert.deepEqual(await digest(), initial);
});
test("audit failure rolls back execution, both debts and idempotency journal", async () => {
  const initial = await digest();
  await assert.rejects(rpc(plan(), { audit: false }), /row-level security/);
  assert.deepEqual(await digest(), initial);
});
test("late idempotency journal failure rolls back all earlier successful writes", async () => {
  const initial = await digest();
  await fail("financial_operation_requests", "INSERT");
  await assert.rejects(rpc(plan()), /forced financial_operation_requests/);
  assert.deepEqual(await digest(), initial);
});
test("independent FX locking does not invalidate a form snapshot or get overwritten by save", async () => {
  const old = await create();
  await db.exec(
    `UPDATE public.executions SET fx_locks='{"USD":50}',fx_locked_at=now(),updated_at=now()`,
  );
  await update({ notes: "تصحيح" }, { expected: old });
  assert.deepEqual((await row("executions", id(1))).fx_locks, { USD: 50 });
});
test("two competing snapshots cannot both rewrite the same execution", async () => {
  const expected = await create();
  const first = plan({
    op: 101,
    action: "update",
    patch: { services: services(12000, 9000) },
    expected,
  });
  const second = plan({
    op: 102,
    action: "update",
    patch: { services: services(14000, 11000) },
    expected,
  });
  // PGlite queues one connection; this checks stale-request ordering, not a multi-session load test.
  await rpc(first);
  await assert.rejects(rpc(second), /مستخدم آخر/);
  assert.equal((await row("executions", id(1))).services[0].agent_price, 12000);
});
test("unpriced compact import services save without inventing financial debt", async () => {
  await create({
    services: [
      { kind: "agent", service_type: "تذكرة", count: 1, agent_price: 0 },
      {
        kind: "company",
        service_type: "تذكرة",
        company_id: null,
        count: 1,
        company_price: 0,
      },
    ],
  });
  assert.equal(await count("transactions"), 0);
  assert.equal(await count("company_transactions"), 0);
});
test("legacy combined service retains paid buckets and company value using the same builder", async () => {
  await create({
    services: [
      {
        service_type: "تذكرة",
        company_id: id(20),
        count: 2,
        agent_price: 100,
        company_price: 80,
        paid_amount: 50,
        payment_method: "نقدي",
        currency: "LYD",
      },
    ],
  });
  const t = (
    await db.query(
      "SELECT count,price,total_paid,currency FROM public.transactions",
    )
  ).rows[0];
  const c = (
    await db.query("SELECT trip_value FROM public.company_transactions")
  ).rows[0];
  assert.deepEqual(
    [t.count, Number(t.price), Number(t.total_paid), t.currency],
    [2, 100, 50, "LYD"],
  );
  assert.equal(Number(c.trip_value), 160);
});
test("caller cannot change creation timestamp, FX locks or first financial date through the save patch", async () => {
  await create();
  const initial = await digest();
  for (const patch of [
    { created_at: "2020-01-01" },
    { fx_locks: { USD: 99 } },
    { financial_posting_date: "2020-01-01" },
  ])
    await assert.rejects(update(patch), /حقول تعديل/);
  assert.deepEqual(await digest(), initial);
});

test("service order and multiplicity changes invalidate stale snapshots exactly", async () => {
  const old = await create();
  for (const changed of [
    [...old.services].reverse(),
    [...old.services, old.services[1]],
  ]) {
    await db.query("UPDATE public.executions SET services=$1::jsonb", [
      JSON.stringify(changed),
    ]);
    const initial = await digest();
    await assert.rejects(
      update({ notes: "stale" }, { expected: old }),
      /مستخدم آخر/,
    );
    assert.deepEqual(await digest(), initial);
  }
});

test("RLS denying the execution update cannot leave replacement financial rows", async () => {
  await create();
  const initial = await digest();
  await db.exec(
    "CREATE POLICY test_restrict ON public.executions AS RESTRICTIVE FOR UPDATE TO authenticated USING(false) WITH CHECK(false)",
  );
  await assert.rejects(
    update({ services: services(12000, 9000) }),
    /التنفيذ غير موجود|حفظ التنفيذ/,
  );
  assert.deepEqual(await digest(), initial);
});
test("a non-executed status rejects a financial posting plan from stale client state", async () => {
  const request = plan();
  request.body.execution_patch.operation_status = "قيد التنفيذ";
  const initial = await digest();
  await assert.rejects(rpc(request), /غير المعتمد/);
  assert.deepEqual(await digest(), initial);
});

test("execution split guard sees linked payments but exposes no unrelated treasury splits", async () => {
  await create();
  const tx = (await db.query("SELECT id FROM public.transactions")).rows[0];
  await db.query(
    "INSERT INTO public.payment_splits VALUES($1,'transactions',$2,50),($3,'transactions',$4,90)",
    [id(80), tx.id, id(81), id(800)],
  );
  await db.exec("SET ROLE authenticated");
  try {
    assert.deepEqual(
      (await db.query("SELECT id FROM public.payment_splits")).rows.map(
        (x) => x.id,
      ),
      [id(80)],
    );
  } finally {
    await db.exec("RESET ROLE");
  }
  const initial = await digest();
  await assert.rejects(remove(), /سداد خزينة/);
  assert.deepEqual(await digest(), initial);
});
