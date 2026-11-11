import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const migration = (name) => read("supabase/migrations/" + name + ".sql");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const uid = id(999);
const day = "2026-11-11";
const tables = [
  "transactions", "company_transactions", "currency_supplier_transactions", "merchant_cash_collections",
  "expenses", "expense_deductions", "payment_splits", "cash_boxes", "merchants",
  "usd_treasury_transactions", "investor_transactions", "financial_operation_requests", "financial_audit_log",
];

before(async () => {
  await db.exec(read("tests/fixtures/financialEditDatabase.sql"));
  await db.exec(`
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    INSERT INTO auth.users VALUES ('${uid}');
    CREATE TABLE public.investor_transactions (
      id uuid PRIMARY KEY, investor_id uuid, transaction_type text,
      date date, amount numeric, note text, statement text
    );
    CREATE TABLE public.transactions (
      id uuid PRIMARY KEY, agent_id uuid, merchant_id uuid, source_service_type text,
      source_service_id text, date date, currency text, paid numeric, total_paid numeric,
      price numeric, note text, statement text, payment_method text, cash_amount numeric,
      instapay_amount numeric, mobile_cash_amount numeric, mobile_cash_net_amount numeric,
      arabic_tourism_cash_amount numeric, arabic_tourism_cash_net_amount numeric,
      merchant_cash_amount numeric, merchant_cash_net_amount numeric, merchant_cash_physical_amount numeric,
      cancelled_at timestamptz,cancelled_by uuid,cancel_reason text
    );
    CREATE TABLE public.company_transactions (LIKE public.transactions INCLUDING ALL);
    ALTER TABLE public.company_transactions DROP COLUMN paid, ADD COLUMN company_id uuid;
    CREATE TABLE public.usd_treasury_transactions (
      id uuid PRIMARY KEY, type text, date date, egp_amount numeric, usd_amount numeric,
      exchange_rate numeric, note text, statement text, cancelled_at timestamptz,
      cancelled_by uuid,cancel_reason text
    );
    ALTER TABLE public.payment_splits ADD transaction_id uuid, ADD merchant_commission_rate numeric,
      ADD cancelled_by uuid,ADD cancel_reason text;
    ALTER TABLE public.currency_supplier_transactions ADD cancelled_by uuid,ADD cancel_reason text;
    ALTER TABLE public.merchant_cash_collections ADD cancelled_by uuid,ADD cancel_reason text;
    ALTER TABLE public.expense_deductions ADD cancelled_by uuid,ADD cancel_reason text;
    ALTER TABLE public.financial_operation_requests ADD created_at timestamptz DEFAULT now();
    GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
    ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
    CREATE POLICY ledger_read ON public.transactions FOR SELECT USING (true);
    CREATE POLICY ledger_insert ON public.transactions FOR INSERT WITH CHECK (true);
    CREATE POLICY ledger_edit ON public.transactions FOR UPDATE USING (
      NOT (current_setting('test.deny_mirror',true)='true' AND agent_id IS NULL)
      OR current_setting('test.deny_mirror',true) IS NULL
    );
    CREATE FUNCTION public.test_fail_mirror_cancel() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF current_setting('test.fail_mirror_cancel',true)='true' AND NEW.cancelled_at IS NOT NULL
        AND NEW.source_service_type='merchant_cash_out_to_agent' THEN RAISE EXCEPTION 'simulated mirror failure'; END IF;
      RETURN NEW;
    END; $$;
    CREATE TRIGGER fixture_fail_mirror_cancel BEFORE UPDATE ON public.transactions
      FOR EACH ROW EXECUTE FUNCTION public.test_fail_mirror_cancel();
    CREATE POLICY fixture_payment_insert ON public.payment_splits FOR INSERT WITH CHECK(true);
    CREATE POLICY fixture_payment_delete ON public.payment_splits FOR DELETE USING(true);
    CREATE POLICY fixture_collection_delete ON public.merchant_cash_collections FOR DELETE USING(true);
    CREATE POLICY fixture_deduction_delete ON public.expense_deductions FOR DELETE USING(true);
    CREATE POLICY fixture_expense_delete ON public.expenses FOR DELETE USING(true);
    ALTER TABLE public.cash_boxes ADD CHECK (balance>=0);
  `);
  await db.exec(migration("20260830006000_financial_mutations_atomic"));
  await db.exec(migration("20260830007200_financial_atomic_validation_hardening"));
  const direct = migration("20260907183000_agent_company_direct_transfer_cancel");
  await db.exec(direct.slice(direct.indexOf("CREATE OR REPLACE FUNCTION")));
  await db.exec(migration("20261017234044_financial_edit_consistency"));
  await db.exec(`CREATE TRIGGER payment_splits_balance_sync
    AFTER INSERT OR UPDATE OR DELETE ON public.payment_splits FOR EACH ROW
    EXECUTE FUNCTION public.apply_payment_split_to_cash_box()`);
  const update = migration("20261111213000_financial_operation_consistency");
  await db.exec(update);
  await db.exec(update);
});
after(() => db.close());
beforeEach(async () => {
  await db.exec("TRUNCATE " + tables.map((name) => "public." + name).join(","));
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('test.can_edit','true',false),set_config('test.deny_mirror','false',false),set_config('test.fail_mirror_cancel','false',false)", [uid]);
});

async function insert(table, payload) {
  const keys = Object.keys(payload);
  await db.query(`INSERT INTO public.${table} (${keys.join(",")}) VALUES (${keys.map((_, index) => "$" + (index + 1)).join(",")})`,
    Object.values(payload));
}
async function get(table, key) {
  return (await db.query(`SELECT to_jsonb(t) AS row FROM public.${table} t WHERE id=$1`, [key])).rows[0]?.row;
}
async function rpc(name, args, casts) {
  await db.exec("SET ROLE authenticated");
  try {
    return (await db.query(`SELECT public.${name}(${casts.map((type, index) => "$" + (index + 1) + "::" + type).join(",")}) AS result`, args)).rows[0].result;
  } finally {
    await db.exec("RESET ROLE");
  }
}
const cancel = (table, key, state = true) => rpc("set_financial_cancel_state_atomic", [table, key, state, "سبب"], ["text", "uuid", "boolean", "text"]);
const edit = (table, key, patch, splits = []) => rpc("update_financial_transaction_atomic", [table, key, JSON.stringify(patch), JSON.stringify(splits)], ["text", "uuid", "jsonb", "jsonb"]);
const save = (key, rows) => rpc("execute_financial_atomic", [key, "fixture", JSON.stringify(rows), "{}"], ["uuid", "text", "jsonb", "jsonb"]);
const record = (table, row) => ({table,row});
const split = (key, table, parent, amount, currency, method = "نقدي", cashBox = null, direction = "out") => ({
  id: id(key), source_table: table, source_id: parent, amount, gross_amount: amount,
  net_amount: amount, currency, method, cash_box_id: cashBox, direction,
  egp_equivalent: currency === "EGP" ? amount : 0,
});

function payout(currency, company = false) {
  const table = company ? "company_transactions" : "transactions";
  const principal = {
    id: id(1), [company ? "company_id" : "agent_id"]: id(900), date: day, currency,
    total_paid: company ? 60 : -60,
    ...(company ? { merchant_id: id(901), cash_amount: 20, merchant_cash_amount: 40, merchant_cash_net_amount: 40 } :
      {paid: -60, source_service_type: "agent_cash_out"}),
  };
  const mirror = (key, merchant) => ({
    id: id(key), merchant_id: id(merchant), date: day, currency, paid: -20, total_paid: -20,
    payment_method: "فودافون كاش", source_service_id: id(1),
    source_service_type: company ? "merchant_cash_out_to_company" : "merchant_cash_out_to_agent",
  });
  return {
    table, principal, rows: [
      record(table, principal),
      record("payment_splits", split(11,table,id(1),20,currency,"فودافون كاش")),
      record("payment_splits", split(12,table,id(1),20,currency,"فودافون كاش")),
      record("payment_splits", split(13,table,id(1),20,currency,"نقدي",id(901))),
      record("transactions",mirror(2,901)),
      record("payment_splits",split(21,"transactions",id(2),20,currency,"فودافون كاش")),
      record("transactions",mirror(3,902)),
      record("payment_splits",split(31,"transactions",id(3),20,currency,"فودافون كاش")),
    ],
  };
}

for (const [currency, company] of [["EGP",false],["USD",true],["LYD",false]]) {
  test(`atomic save, edit, cancel and restore preserve all payout legs in ${currency}`, async () => {
    await insert("cash_boxes", {id:id(901),balance:100,currency});
    const {table, rows} = payout(currency,company);
    await assert.rejects(save(id(100),rows.slice(0,-2)),/تطابق سطور القيد/);
    assert.equal(await get(table,id(1)),undefined);
    assert.equal((await save(id(100),rows)).ok,true);
    assert.equal((await save(id(100),rows)).reused,true);
    assert.equal((await get("cash_boxes",id(901))).balance,80);

    const initial = await get(table,id(1));
    await edit(table,id(1),{_amount:61.01,_expected:initial,date:"2026-11-10",note:"موثق"});
    assert.equal((await get(table,id(1))).total_paid,company ? 61.01 : -61.01);
    assert.equal((await get("transactions",id(2))).date,"2026-11-10");
    const splitAmounts = await Promise.all([11,12,13,21,31].map(async (key) => (await get("payment_splits",id(key))).amount));
    assert.equal(Math.round(splitAmounts.slice(0,3).reduce((a,b)=>a+b,0)*100),6101);
    assert.deepEqual(splitAmounts.slice(0,2).sort(),splitAmounts.slice(3).sort());
    await assert.rejects(edit(table,id(1),{_expected:initial,_amount:62}),/تغي/);
    await assert.rejects(edit("transactions",id(2),{_amount:100}),/السجل|سجل الطرف/);

    await cancel("transactions",id(2));
    assert.equal((await get("cash_boxes",id(901))).balance,100);
    for (const key of [11,12,13,21,31]) assert.ok((await get("payment_splits",id(key))).cancelled_at);
    assert.ok((await get(table,id(1))).cancelled_at);
    assert.ok((await get("transactions",id(3))).cancelled_at);
    assert.equal((await cancel(table,id(1))).reused,true);
    await cancel(table,id(1),false);
    assert.equal((await get("transactions",id(2))).cancelled_at,null);
    assert.equal((await get("payment_splits",id(31))).cancelled_at,null);
    assert.equal((await get("cash_boxes",id(901))).balance,Math.round((100-splitAmounts[2])*100)/100);
  });
}

test("counterpart permission failure rolls back the full payout and retry repairs a previously one-sided cancellation", async () => {
  await insert("cash_boxes",{id:id(901),balance:100,currency:"EGP"});
  const {table,rows}=payout("EGP");
  await save(id(100),rows);
  await db.exec("SELECT set_config('test.deny_mirror','true',false)");
  await db.exec("SELECT set_config('test.fail_mirror_cancel','true',false)");
  await assert.rejects(cancel(table,id(1)),/simulated mirror failure/);
  await assert.rejects(edit(table,id(1),{_amount:75}),/صلاحيات|غير متاح/);
  assert.equal((await get(table,id(1))).cancelled_at,null);
  assert.equal((await get(table,id(1))).total_paid,-60);
  assert.equal((await get("cash_boxes",id(901))).balance,80);
  await db.exec("SELECT set_config('test.deny_mirror','false',false),set_config('test.fail_mirror_cancel','false',false)");
  await db.query("UPDATE public.transactions SET cancelled_at=now() WHERE id=$1",[id(1)]);
  assert.ok((await cancel(table,id(1))).linked_changes.length);
  assert.ok((await get("transactions",id(3))).cancelled_at);
});

test("cash-box transfer requires two balanced legs and changes both together", async () => {
  for (const [key,balance] of [[1,100],[2,0]]) await insert("cash_boxes",{id:id(key),balance,currency:"LYD"});
  const key=id(101);
  const rows=[
    record("payment_splits",split(11,"cash_box_transfer",key,40,"LYD","تحويل",id(1),"out")),
    record("payment_splits",split(12,"cash_box_transfer",key,40,"LYD","تحويل",id(2),"in")),
  ];
  await assert.rejects(save(key,rows.slice(0,1)),/طرفي تحويل الخزائن/);
  await save(key,rows);
  await edit("payment_splits",id(11),{},[{id:id(11),amount:55}]);
  assert.equal((await get("cash_boxes",id(1))).balance,45);
  assert.equal((await get("cash_boxes",id(2))).balance,55);
  await db.query("UPDATE public.cash_boxes SET balance=10 WHERE id=$1",[id(2)]);
  await assert.rejects(cancel("payment_splits",id(12)),/check constraint/);
  assert.equal((await get("cash_boxes",id(1))).balance,45);
  assert.equal((await get("payment_splits",id(11))).cancelled_at,null);
  await db.query("UPDATE public.cash_boxes SET balance=55 WHERE id=$1",[id(2)]);
  await cancel("payment_splits",id(12));
  assert.equal((await get("cash_boxes",id(1))).balance,100);
  assert.equal((await get("cash_boxes",id(2))).balance,0);
  await cancel("payment_splits",id(11),false);
  assert.equal((await get("cash_boxes",id(1))).balance,45);
  assert.equal((await get("cash_boxes",id(2))).balance,55);
});

test("direct agent/company transfer and fine edit both ledger sides", async () => {
  const transfer = [
    record("company_transactions",{id:id(1),company_id:id(900),source_service_type:"agent_direct_to_company",source_service_id:id(2),total_paid:20,cash_amount:20,currency:"USD"}),
    record("transactions",{id:id(2),agent_id:id(901),source_service_type:"agent_direct_to_company",source_service_id:id(1),total_paid:20,paid:20,cash_amount:20,currency:"USD"}),
  ];
  await assert.rejects(save(id(100),transfer.slice(0,1)),/طرفي تحويل الوكيل/);
  await save(id(100),transfer);
  await edit("transactions",id(2),{_amount:34});
  assert.equal((await get("company_transactions",id(1))).total_paid,34);
  assert.equal((await get("transactions",id(2))).paid,34);
  await cancel("company_transactions",id(1));
  assert.ok((await get("transactions",id(2))).cancelled_at);
  const fine = [
    record("transactions",{id:id(3),agent_id:id(901),source_service_type:"execution_fine",source_service_id:id(930),price:15}),
    record("company_transactions",{id:id(4),company_id:id(900),source_service_type:"execution_fine",source_service_id:id(930),total_paid:15,cash_amount:15}),
  ];
  await assert.rejects(save(id(101),fine.slice(0,1)),/طرفي الغرامة/);
  await save(id(101),fine);
  await edit("transactions",id(3),{_amount:21});
  assert.equal((await get("company_transactions",id(4))).cash_amount,21);
  assert.equal((await get("transactions",id(3))).price,21);
  await cancel("transactions",id(3));
  assert.ok((await get("company_transactions",id(4))).cancelled_at);
});

test("currency settlement and both sides of the USD conversion stay consistent", async () => {
  await insert("merchants",{id:id(4)});
  await insert("currency_supplier_transactions",{id:id(3),tx_date:day});
  await insert("merchant_cash_collections",{id:id(5),merchant_id:id(4),source_service_type:"currency_supplier",source_service_id:id(3),date:day,amount:40});
  await cancel("currency_supplier_transactions",id(3));
  assert.ok((await get("merchant_cash_collections",id(5))).cancelled_at);
  await cancel("currency_supplier_transactions",id(3),false);
  assert.equal((await get("merchant_cash_collections",id(5))).cancelled_at,null);
  await insert("usd_treasury_transactions",{id:id(7),type:"conversion",date:day,usd_amount:10,egp_amount:500,exchange_rate:50});
  await edit("usd_treasury_transactions",id(7),{usd_amount:11.5});
  assert.equal((await get("usd_treasury_transactions",id(7))).egp_amount,575);
});

test("deleting the original expense reverses legacy deduction splits and merchant funding", async () => {
  await insert("cash_boxes",{id:id(1),balance:100,currency:"EGP"});
  await insert("merchants",{id:id(4)});
  await insert("expenses",{id:id(2),amount:80,date:day});
  await insert("expense_deductions",{id:id(3),expense_id:id(2),amount:50,deduction_date:day});
  await insert("merchant_cash_collections",{id:id(5),expense_id:id(2),merchant_id:id(4),amount:30,date:day});
  await insert("payment_splits",split(11,"expense_deductions",id(3),50,"EGP","نقدي",id(1)));
  await assert.rejects(cancel("expense_deductions",id(3)),/السجل الأصلي/);
  await rpc("delete_expense_atomic",[id(2)],["uuid"]);
  assert.equal((await get("cash_boxes",id(1))).balance,100);
  assert.equal(await get("payment_splits",id(11)),undefined);
  assert.equal(await get("merchant_cash_collections",id(5)),undefined);
});

test("investor operations synchronize the owner ledger and the funded cash box", async () => {
  await insert("cash_boxes",{id:id(1),balance:100,currency:"USD"});
  const rows = [
    record("investor_transactions",{id:id(2),investor_id:id(900),date:day,amount:25,transaction_type:"صرف نقدية"}),
    record("payment_splits",split(3,"investor_transactions",id(2),25,"USD","نقدي",id(1))),
  ];
  await assert.rejects(save(id(100),rows.slice(0,1)),/طرف الخزينة/);
  await save(id(100),rows);
  await edit("investor_transactions",id(2),{_amount:28.125});
  assert.equal((await get("payment_splits",id(3))).amount,28.125);
  assert.equal((await get("cash_boxes",id(1))).balance,71.875);
  await cancel("investor_transactions",id(2));
  assert.equal((await get("cash_boxes",id(1))).balance,100);
  assert.ok((await get("payment_splits",id(3))).cancelled_at);
  await cancel("investor_transactions",id(2),false);
  assert.equal((await get("cash_boxes",id(1))).balance,71.875);
});

test("a financial cancellation requires the originating section permission", async () => {
  await insert("cash_boxes",{id:id(901),balance:100,currency:"EGP"});
  const {table,rows}=payout("EGP");
  await save(id(100),rows);
  await db.exec("SELECT set_config('test.can_edit','false',false)");
  await assert.rejects(cancel(table,id(1)),/صلاحية/);
  assert.equal((await get("transactions",id(2))).cancelled_at,null);
  assert.equal((await get("cash_boxes",id(901))).balance,80);
});
