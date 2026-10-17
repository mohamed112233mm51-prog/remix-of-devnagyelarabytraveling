import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const uid = id(999);
const day = "2026-10-17";
const tables = [
  "financial_audit_log",
  "payment_splits",
  "expense_deductions",
  "merchant_cash_collections",
  "expenses",
  "currency_supplier_transactions",
  "financial_operation_requests",
  "merchants",
  "cash_boxes",
];
async function insert(table, row) {
  const columns = Object.keys(row);
  await db.query(
    `INSERT INTO public.${table} (${columns.join(",")}) VALUES (${columns.map((_, i) => "$" + (i + 1)).join(",")})`,
    Object.values(row),
  );
}
async function row(table, key) {
  return (await db.query(`SELECT to_jsonb(t) AS row FROM public.${table} t WHERE id=$1`, [key]))
    .rows[0]?.row;
}
async function balance(key) {
  return Number((await row("cash_boxes", key)).balance);
}
async function edit(table, key, patch = {}, options = {}) {
  const expected = options.expected || (await row(table, key));
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [uid]);
  await db.query(
    "SELECT set_config('test.can_edit',$1,false),set_config('test.can_audit',$2,false)",
    [String(options.canEdit ?? true), String(options.canAudit ?? true)],
  );
  await db.exec("SET ROLE authenticated");
  try {
    return (
      await db.query(
        "SELECT public.update_financial_transaction_atomic($1,$2,$3::jsonb,$4::jsonb) AS result",
        [
          table,
          key,
          JSON.stringify({
            _expected: expected,
            _reason: "تصحيح موثق",
            ...patch,
          }),
          "[]",
        ],
      )
    ).rows[0].result;
  } finally {
    await db.exec("RESET ROLE");
  }
}
async function expense({
  amount = 1000,
  cash = 600,
  merchant = 400,
  cashInitial = 5000,
  merchantInitial = 5000,
} = {}) {
  await insert("cash_boxes", {
    id: id(1),
    name: "نقدي الشركة",
    currency: "EGP",
    balance: cashInitial,
  });
  await insert("merchants", {
    id: id(2),
    merchant_name: "تاجر",
    initial_balance: merchantInitial,
  });
  await insert("expenses", {
    id: id(3),
    expense_name: "إيجار",
    expense_type: "متغير",
    amount,
    date: day,
  });
  if (cash) {
    await insert("expense_deductions", {
      id: id(4),
      expense_id: id(3),
      deduction_date: day,
      amount: cash,
      funding_source: "cash_company",
      currency: "EGP",
    });
    await insert("payment_splits", {
      id: id(5),
      source_table: "expenses",
      source_id: id(3),
      cash_box_id: id(1),
      method: "نقدي",
      currency: "EGP",
      direction: "out",
      amount: cash,
      gross_amount: cash,
      net_amount: cash,
      egp_equivalent: cash,
    });
  }
  if (merchant)
    await insert("merchant_cash_collections", {
      id: id(6),
      merchant_id: id(2),
      expense_id: id(3),
      date: day,
      amount: merchant,
    });
}
async function trade({
  kind = "شراء عملة",
  paid = 5000,
  commission = 0,
  merchant = false,
  linked = true,
  foreignInitial = 5000,
} = {}) {
  const buy = kind === "شراء عملة";
  await insert("cash_boxes", {
    id: id(1),
    name: "EGP",
    currency: "EGP",
    balance: 50000,
  });
  await insert("cash_boxes", {
    id: id(2),
    name: "USD",
    currency: "USD",
    balance: foreignInitial,
  });
  await insert("merchants", {
    id: id(8),
    merchant_name: "تاجر",
    initial_balance: 50000,
  });
  const payments = paid
    ? [
        {
          source: merchant ? "merchant" : "company",
          merchant_id: merchant ? id(8) : null,
          method: merchant ? "merchant_wallet" : "company_cash",
          currency: "EGP",
          amount: paid,
        },
      ]
    : [];
  await insert("currency_supplier_transactions", {
    id: id(3),
    tx_type: kind,
    tx_date: day,
    bought_currency: buy ? "USD" : "EGP",
    bought_amount: buy ? 100 : 5000,
    sold_currency: buy ? "EGP" : "USD",
    sold_amount: buy ? 5000 + commission : 100,
    exchange_rate: 50,
    commission_amount: commission,
    payment_splits: JSON.stringify(payments),
  });
  await insert("payment_splits", {
    id: id(4),
    source_table: "currency_supplier_transactions",
    source_id: id(3),
    cash_box_id: id(2),
    currency: "USD",
    direction: buy ? "in" : "out",
    amount: 100,
    gross_amount: 100,
    net_amount: 100,
  });
  if (paid)
    await insert("payment_splits", {
      id: id(5),
      source_table: "currency_supplier_transactions",
      source_id: id(3),
      cash_box_id: merchant ? null : id(1),
      currency: "EGP",
      direction: buy ? "out" : "in",
      amount: paid,
      gross_amount: paid,
      net_amount: paid,
      egp_equivalent: paid,
    });
  if (merchant && paid)
    await insert("merchant_cash_collections", {
      id: id(6),
      merchant_id: id(8),
      date: day,
      amount: buy ? paid : -paid,
      source_service_type: linked ? "currency_supplier" : null,
      source_service_id: linked ? id(3) : null,
    });
}
before(async () => {
  await db.exec(read("tests/fixtures/financialEditDatabase.sql"));
  // Use the production cash-box guard, not a test reimplementation.
  const all = read("supabase/all_migrations.sql");
  const start = all.lastIndexOf(
    "CREATE OR REPLACE FUNCTION public.enforce_cash_box_non_negative_balance()",
  );
  const end = all.indexOf("$$;", start) + 3;
  await db.exec(all.slice(start, end));
  await db.exec(
    "CREATE TRIGGER cash_nonnegative BEFORE UPDATE OF balance ON public.cash_boxes FOR EACH ROW EXECUTE FUNCTION public.enforce_cash_box_non_negative_balance()",
  );
  await db.exec(read("supabase/migrations/20261017234044_financial_edit_consistency.sql"));

  await db.exec(
    "CREATE TRIGGER payment_splits_balance_sync AFTER INSERT OR UPDATE OR DELETE ON public.payment_splits FOR EACH ROW EXECUTE FUNCTION public.apply_payment_split_to_cash_box()",
  );
});
beforeEach(async () => {
  await db.exec(
    "RESET ROLE; TRUNCATE " +
      tables.map((t) => "public." + t).join(",") +
      " RESTART IDENTITY CASCADE",
  );
});
after(async () => {
  await db.close();
});

test("paid expense increase updates parent, cash, deduction and merchant once", async () => {
  await expense();
  const snapshot = await row("expenses", id(3));
  await edit("expenses", id(3), { _amount: 1500 });
  assert.equal(Number((await row("expenses", id(3))).amount), 1500);
  assert.equal(Number((await row("expense_deductions", id(4))).amount), 900);
  assert.equal(Number((await row("merchant_cash_collections", id(6))).amount), 600);
  assert.equal(await balance(id(1)), 4100);
  await assert.rejects(
    edit("expenses", id(3), { _amount: 1500 }, { expected: snapshot }),
    /مستخدم آخر/,
  );
  assert.equal(await balance(id(1)), 4100);
});
test("paid expense decrease returns exact cash/merchant difference and date stays linked", async () => {
  await expense();
  await edit("expenses", id(3), { _amount: 800, date: "2026-10-15" });
  assert.equal(await balance(id(1)), 4520);
  assert.equal(Number((await row("expense_deductions", id(4))).amount), 480);
  assert.equal((await row("expense_deductions", id(4))).deduction_date, "2026-10-15");
  assert.equal(Number((await row("merchant_cash_collections", id(6))).amount), 320);
  assert.equal((await row("merchant_cash_collections", id(6))).date, "2026-10-15");
});
test("insufficient cash rolls back EVERY expense side and audit", async () => {
  await expense({ cashInitial: 700 });
  const old = await row("expenses", id(3));
  await assert.rejects(edit("expenses", id(3), { _amount: 1500 }), /INSUFFICIENT/);
  assert.deepEqual(await row("expenses", id(3)), old);
  assert.equal(await balance(id(1)), 100);
  assert.equal(Number((await row("merchant_cash_collections", id(6))).amount), 400);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM financial_audit_log")).rows[0].n, 0);
});
test("merchant debt is allowed while the paid expense and cash update remain consistent", async () => {
  await expense({ merchantInitial: 500 });
  await edit("expenses", id(3), { _amount: 1500 });
  assert.equal(await balance(id(1)), 4100);
  assert.equal(Number((await row("expense_deductions", id(4))).amount), 900);
  assert.equal(Number((await row("merchant_cash_collections", id(6))).amount), 600);
  assert.equal(Number((await row("expenses", id(3))).amount), 1500);
});
test("RLS/audit failure cannot leave cash or expense changes committed", async () => {
  await expense();
  await assert.rejects(
    edit("expenses", id(3), { _amount: 1500 }, { canAudit: false }),
    /row-level security/,
  );
  assert.equal(await balance(id(1)), 4400);
  assert.equal(Number((await row("expenses", id(3))).amount), 1000);
  await assert.rejects(edit("expenses", id(3), { _amount: 1500 }, { canEdit: false }));
  assert.equal(await balance(id(1)), 4400);
});
test("metadata edit keeps amounts and cash unchanged", async () => {
  await expense();
  await edit("expenses", id(3), {
    expense_name: "إيجار المكتب",
    notes: "تصحيح البيان",
  });
  assert.equal(await balance(id(1)), 4400);
  assert.equal((await row("expenses", id(3))).expense_name, "إيجار المكتب");
});
test("unreconciled or recurring historical expense is rejected rather than guessed", async () => {
  await expense();
  await db.query("UPDATE expense_deductions SET deduction_date=$1 WHERE id=$2", [
    "2026-09-17",
    id(4),
  ]);
  await assert.rejects(edit("expenses", id(3), { _amount: 1500 }), /دوري/);
  assert.equal(await balance(id(1)), 4400);
});
test("currency purchase preserves rate, scales commission and updates both sides/payment JSON", async () => {
  await trade({ commission: 10, paid: 5010 });
  await edit("currency_supplier_transactions", id(3), { _amount: 200 });
  const t = await row("currency_supplier_transactions", id(3));
  assert.equal(Number(t.bought_amount), 200);
  assert.equal(Number(t.sold_amount), 10020);
  assert.equal(Number(t.commission_amount), 20);
  assert.equal(Number(t.exchange_rate), 50);
  assert.equal(t.payment_splits[0].amount, 10020);
  assert.equal(await balance(id(1)), 39980);
  assert.equal(await balance(id(2)), 5200);
});
test("partial currency payment keeps the original paid fraction", async () => {
  await trade({ paid: 2000 });
  await edit("currency_supplier_transactions", id(3), { _amount: 150 });
  const t = await row("currency_supplier_transactions", id(3));
  assert.equal(Number(t.sold_amount), 7500);
  assert.equal(t.payment_splits[0].amount, 3000);
  assert.equal(Number((await row("payment_splits", id(5))).amount), 3000);
});
test("unpaid currency purchase remains unpaid and creates no imaginary cash payment", async () => {
  await trade({ paid: 0 });
  await edit("currency_supplier_transactions", id(3), { _amount: 200 });
  assert.equal(await balance(id(1)), 50000);
  assert.equal(await balance(id(2)), 5200);
  assert.equal((await row("currency_supplier_transactions", id(3))).payment_splits.length, 0);
});
test("currency sale amount means foreign quantity and updates the EGP receipt", async () => {
  await trade({ kind: "بيع عملة" });
  await edit("currency_supplier_transactions", id(3), { _amount: 200 });
  const t = await row("currency_supplier_transactions", id(3));
  assert.equal(Number(t.sold_amount), 200);
  assert.equal(Number(t.bought_amount), 10000);
  assert.equal(await balance(id(2)), 4800);
  assert.equal(await balance(id(1)), 60000);
});
test("linked currency merchant payment updates the same counterparty record", async () => {
  await trade({ merchant: true });
  await edit("currency_supplier_transactions", id(3), { _amount: 200 });
  assert.equal(Number((await row("merchant_cash_collections", id(6))).amount), 10000);
  assert.equal(
    (await db.query("SELECT count(*)::int AS n FROM merchant_cash_collections")).rows[0].n,
    1,
  );
});
test("unlinked old merchant settlement blocks monetary edit without touching cash", async () => {
  await trade({ merchant: true, linked: false });
  await assert.rejects(
    edit("currency_supplier_transactions", id(3), { _amount: 200 }),
    /غير مربوط/,
  );
  assert.equal(await balance(id(2)), 5100);
  assert.equal(Number((await row("currency_supplier_transactions", id(3))).bought_amount), 100);
});
test("net-delta trigger allows increasing a receipt after part of it was spent", async () => {
  await trade({ foreignInitial: 0 });
  await db.query("UPDATE cash_boxes SET balance=20 WHERE id=$1", [id(2)]);
  await edit("currency_supplier_transactions", id(3), { _amount: 200 });
  assert.equal(await balance(id(2)), 120);
});
test("net-delta trigger still rejects decreasing a receipt below already-spent funds", async () => {
  await trade({ foreignInitial: 0 });
  await db.query("UPDATE cash_boxes SET balance=20 WHERE id=$1", [id(2)]);
  await assert.rejects(
    edit("currency_supplier_transactions", id(3), { _amount: 50 }),
    /INSUFFICIENT/,
  );
  assert.equal(await balance(id(2)), 20);
  assert.equal(await balance(id(1)), 45000);
});
test("invalid amount and arbitrary client split patches are rejected", async () => {
  await expense();
  await assert.rejects(edit("expenses", id(3), { _amount: 0 }), /أكبر من صفر/);
  await assert.rejects(edit("expenses", id(3), { _amount: "NaN" }), /رقمًا صالحًا/);
  await assert.rejects(edit("expenses", id(3), { made_up_field: 3 }), /حقول تعديل/);
});

test("rounding across three expense funding rows preserves the exact expense total", async () => {
  await expense({ amount: 100, cash: 33.33, merchant: 33.34 });
  await insert("expense_deductions", {
    id: id(14),
    expense_id: id(3),
    deduction_date: day,
    amount: 33.33,
    funding_source: "cash_company",
    currency: "EGP",
  });
  await insert("payment_splits", {
    id: id(15),
    source_table: "expenses",
    source_id: id(3),
    cash_box_id: id(1),
    method: "نقدي",
    currency: "EGP",
    direction: "out",
    amount: 33.33,
  });
  await edit("expenses", id(3), { _amount: 100.01 });
  const paid = await db.query(
    "SELECT (SELECT sum(amount) FROM expense_deductions)+(SELECT sum(amount) FROM merchant_cash_collections) AS n",
  );
  assert.equal(Number(paid.rows[0].n), 100.01);
  const cashPaid = Number(
    (await db.query("SELECT sum(amount) AS n FROM expense_deductions")).rows[0].n,
  );
  assert.equal(
    Number((await db.query("SELECT sum(amount) AS n FROM payment_splits")).rows[0].n),
    cashPaid,
  );
});
test("old expense splits linked through a deduction remain supported", async () => {
  await expense({ merchant: 0, cash: 1000 });
  await db.query(
    "UPDATE payment_splits SET source_table='expense_deductions',source_id=$1 WHERE id=$2",
    [id(4), id(5)],
  );
  await edit("expenses", id(3), { _amount: 1200 });
  assert.equal(await balance(id(1)), 3800);
  assert.equal(Number((await row("expense_deductions", id(4))).amount), 1200);
});
test("generic child editor cannot bypass the expense parent transaction", async () => {
  await expense();
  await assert.rejects(edit("expense_deductions", id(4), { amount: 900 }), /السجل الأصلي/);
  await assert.rejects(edit("payment_splits", id(5), {}), /السجل الأصلي/);
  await assert.rejects(edit("merchant_cash_collections", id(6), { amount: 900 }), /السجل الأصلي/);
  assert.equal(await balance(id(1)), 4400);
});
test("cash payment to supplier keeps merchant and stored JSON aligned in USD", async () => {
  await insert("merchants", {
    id: id(8),
    merchant_name: "تاجر",
    initial_balance: 1000,
  });
  const p = [
    {
      source: "merchant",
      merchant_id: id(8),
      currency: "USD",
      method: "merchant_physical",
      amount: 100,
    },
  ];
  await insert("currency_supplier_transactions", {
    id: id(3),
    tx_type: "دفع نقدية",
    tx_date: day,
    bought_currency: "USD",
    bought_amount: 0,
    sold_currency: "USD",
    sold_amount: 100,
    payment_splits: JSON.stringify(p),
  });
  await insert("payment_splits", {
    id: id(5),
    source_table: "currency_supplier_transactions",
    source_id: id(3),
    currency: "USD",
    direction: "out",
    amount: 100,
  });
  await insert("merchant_cash_collections", {
    id: id(6),
    merchant_id: id(8),
    date: day,
    amount: 100,
    opening_currency: "USD",
    source_service_type: "currency_supplier",
    source_service_id: id(3),
  });
  await edit("currency_supplier_transactions", id(3), { _amount: 150 });
  const t = await row("currency_supplier_transactions", id(3));
  assert.equal(Number(t.sold_amount), 150);
  assert.equal(Number(t.bought_amount), 0);
  assert.equal(t.payment_splits[0].amount, 150);
  assert.equal(Number((await row("merchant_cash_collections", id(6))).amount), 150);
});
test("legacy scalar client payload is rejected before any coupled write", async () => {
  await expense();
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [uid]);
  await assert.rejects(
    db.query("SELECT update_financial_transaction_atomic('expenses',$1,$2,'[]')", [
      id(3),
      JSON.stringify({ amount: 1500 }),
    ]),
    /تأكيد التعديل/,
  );
  assert.equal(await balance(id(1)), 4400);
});
test("SQL rejects a foreign split ID on a generic unrelated parent", async () => {
  await expense();
  // The generic editor is still present, but cannot accept another source's split.
  await insert("currency_supplier_transactions", {
    id: id(13),
    tx_type: "شراء عملة",
    tx_date: day,
    bought_amount: 1,
    sold_amount: 50,
  });
  await assert.rejects(
    db.query(
      "SELECT update_financial_transaction_atomic('currency_supplier_transactions',$1,$2,$3)",
      [
        id(13),
        JSON.stringify({
          _expected: await row("currency_supplier_transactions", id(13)),
          _reason: "test",
        }),
        JSON.stringify([{ id: id(5), amount: 99 }]),
      ],
    ),
    /تعديلات منفصلة/,
  );
  assert.equal(await balance(id(1)), 4400);
});

test("migration recovers only exact recorded merchant references without changing amounts", async () => {
  const upgrade = new PGlite();
  try {
    await upgrade.exec(read("tests/fixtures/financialEditDatabase.sql"));
    const created = "2026-10-17T10:00:00Z";
    await upgrade.query("INSERT INTO merchants(id,merchant_name) VALUES($1,'merchant')", [id(8)]);
    await upgrade.query(
      "INSERT INTO currency_supplier_transactions(id,tx_type,tx_date,bought_amount,sold_amount,payment_splits,created_at) VALUES($1,'شراء عملة',$2,100,5000,$3,$4)",
      [
        id(3),
        day,
        JSON.stringify([
          {
            source: "merchant",
            merchant_id: id(8),
            currency: "EGP",
            amount: 5000,
          },
        ]),
        created,
      ],
    );
    for (const n of [6, 16])
      await upgrade.query(
        "INSERT INTO merchant_cash_collections(id,merchant_id,date,amount,created_at) VALUES($1,$2,$3,5000,$4)",
        [id(n), id(8), day, created],
      );
    await upgrade.query(
      "INSERT INTO financial_operation_requests(operation_id,result) VALUES($1,$2)",
      [id(3), JSON.stringify({ transactionId: id(3), merchantIds: [id(6)] })],
    );
    await upgrade.exec(read("supabase/migrations/20261017234044_financial_edit_consistency.sql"));
    const found = (
      await upgrade.query(
        "SELECT id,source_service_id,amount FROM merchant_cash_collections ORDER BY id",
      )
    ).rows;
    assert.equal(found[0].source_service_id, id(3));
    assert.equal(found[1].source_service_id, null);
    assert.equal(Number(found[0].amount), 5000);
    assert.equal(Number(found[1].amount), 5000);
  } finally {
    await upgrade.close();
  }
});
