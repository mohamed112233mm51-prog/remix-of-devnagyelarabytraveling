import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
const db = new PGlite();
const id = n => "00000000-0000-4000-8000-" + String(n).padStart(12,"0");
const uid = id(999999);
let current, previous, next;
before(async () => {
  await db.exec(
    "CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;" +
    "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;" +
    "CREATE FUNCTION public.app_permission_allowed(text,text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT COALESCE(current_setting('test.report_access',true),'true')='true' $$;" +
    "CREATE TABLE cash_boxes(id uuid PRIMARY KEY,name text,currency text,balance numeric);" +
    "CREATE TABLE payment_splits(id uuid PRIMARY KEY,cash_box_id uuid,amount numeric,currency text,direction text,method text,source_table text,source_id uuid,created_at timestamptz,cancelled_at timestamptz);" +
    "CREATE TABLE agents(id uuid PRIMARY KEY,name text); CREATE TABLE transactions(id uuid PRIMARY KEY,agent_id uuid);" +
    "CREATE TABLE issuing_companies(id uuid PRIMARY KEY,company_name text); CREATE TABLE company_transactions(id uuid PRIMARY KEY,company_id uuid);" +
    "CREATE TABLE merchants(id uuid PRIMARY KEY,merchant_name text); CREATE TABLE merchant_cash_collections(id uuid PRIMARY KEY,merchant_id uuid);" +
    "CREATE TABLE currency_suppliers(id uuid PRIMARY KEY,name text); CREATE TABLE currency_supplier_transactions(id uuid PRIMARY KEY,supplier_id uuid);" +
    "CREATE TABLE investors(id uuid PRIMARY KEY,investor_name text); CREATE TABLE investor_transactions(id uuid PRIMARY KEY,investor_id uuid);" +
    "CREATE TABLE usd_treasury_transactions(id uuid PRIMARY KEY,company_id uuid,merchant_id uuid);" +
    "CREATE TABLE expenses(id uuid PRIMARY KEY,expense_name text); CREATE TABLE expense_deductions(id uuid PRIMARY KEY,expense_id uuid);" +
    "ALTER TABLE payment_splits ENABLE ROW LEVEL SECURITY; ALTER TABLE cash_boxes ENABLE ROW LEVEL SECURITY;" +
    "CREATE POLICY report_splits ON payment_splits FOR SELECT TO authenticated USING (cash_box_id::text<>COALESCE(NULLIF(current_setting('test.hidden_box',true),''),'hidden'));" +
    "CREATE POLICY report_boxes ON cash_boxes FOR SELECT TO authenticated USING (id::text<>COALESCE(NULLIF(current_setting('test.hidden_box',true),''),'hidden'));" +
    "GRANT USAGE ON SCHEMA public,auth TO authenticated; GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;"
  );
  const path = readdirSync(new URL("../supabase/migrations/",import.meta.url)).find(p=>p.endsWith("_treasury_ledger_page.sql"));
  assert.ok(path,"Migration generated using Supabase CLI");
  await db.exec(readFileSync(new URL("../supabase/migrations/"+path,import.meta.url),"utf8"));
  const ranges = (await db.query("SELECT to_char(now() AT TIME ZONE 'Africa/Cairo','YYYY-MM') AS current,to_char((now() AT TIME ZONE 'Africa/Cairo')-interval '1 month','YYYY-MM') AS previous,to_char((now() AT TIME ZONE 'Africa/Cairo')+interval '1 month','YYYY-MM') AS next")).rows[0];
  ({current,previous,next}=ranges);
});
beforeEach(async () => {
  await db.exec("RESET ROLE; TRUNCATE payment_splits,cash_boxes,agents,transactions,issuing_companies,company_transactions,merchants,merchant_cash_collections,currency_suppliers,currency_supplier_transactions,investors,investor_transactions,usd_treasury_transactions,expenses,expense_deductions");
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('test.report_access','true',false),set_config('test.hidden_box','',false)",[uid]);
});
after(async()=>db.close());
async function insert(table,row) {
  const keys=Object.keys(row);
  await db.query("INSERT INTO "+table+" ("+keys.join(",")+") VALUES ("+keys.map((_,i)=>"$"+(i+1)).join(",")+")",Object.values(row));
}
const box = (n,balance=0,currency="EGP")=>insert("cash_boxes",{id:id(n),name:n===1?"خزينة إنستا الشركة":"خزينة الدولار",currency,balance});
const split = (n,amount,direction,month,options={})=>insert("payment_splits",{
  id:id(n),cash_box_id:id(1),amount,direction,currency:"EGP",method:"إنستاباي",source_table:"transactions",source_id:id(n),
  created_at:month+"-02T12:00:00Z",...options,
});
async function page(args={}) {
  await db.exec("SET ROLE authenticated");
  try {
    return (await db.query("SELECT public.get_treasury_ledger_page($1::uuid[],$2,$3,$4,$5::uuid,$6,$7,$8,$9) AS result",[
      args.ids||[id(1)],args.scope||"current",args.month||null,args.page||0,args.box||null,
      args.direction||null,args.search||"",args.operations||false,args.kind||null,
    ])).rows[0].result;
  } finally {await db.exec("RESET ROLE");}
}
test("1205 movements stay reachable as 50-row server pages with stable balances",async()=>{
  await box(1,1205);
  await db.query("INSERT INTO payment_splits SELECT ('00000000-0000-4000-8000-'||lpad((n+100)::text,12,'0'))::uuid,$1,1,'EGP','in','إنستاباي','transactions',NULL,$2::timestamptz+(n||' seconds')::interval,NULL FROM generate_series(1,1205) n",[id(1),current+"-01T12:00:00Z"]);
  const first=await page();const second=await page({page:1});const last=await page({page:24});
  assert.equal(first.rows.length,50);assert.equal(second.rows.length,50);assert.equal(last.rows.length,5);
  assert.equal(first.total,1205);assert.equal(first.rows[0].balanceAfter,1205);assert.equal(second.rows[0].balanceAfter,1155);assert.equal(last.rows.at(-1).balanceAfter,1);
  assert.equal(new Set([...first.rows,...second.rows,...last.rows].map(r=>r.id)).size,105);
  assert.equal((await page({page:1000})).page,24);
});
test("archive, direction, future and currency filters never reset historical balances",async()=>{
  await box(1,87);await box(2,15,"USD");
  await split(10,100,"in",previous);
  await split(11,40,"out",current,{created_at:current+"-02T12:00:00Z"});
  await split(12,20,"in",current,{created_at:current+"-03T12:00:00Z"});
  await split(13,7,"in",next);
  await split(14,9,"out",current,{cancelled_at:current+"-03T12:00:00Z"});
  await split(15,15,"in",current,{cash_box_id:id(2),currency:"USD"});
  const all=await page({ids:[id(1),id(2)]});
  assert.equal(all.total,3);assert.equal(all.archivedCount,1);assert.equal(all.upcomingCount,1);
  assert.equal(all.rows.find(r=>r.id===id(12)).balanceAfter,80);
  assert.equal(all.rows.find(r=>r.id===id(15)).balanceAfter,15);
  assert.equal((await page({direction:"out"})).rows[0].balanceAfter,60);
  assert.equal((await page({scope:"archive",month:previous})).rows[0].balanceAfter,100);
  assert.equal((await page({scope:"upcoming"})).rows[0].balanceAfter,87);
});
test("party-name search happens across the selected period before page slicing",async()=>{
  await box(1,60);
  for(let n=1;n<=60;n++)await split(n+100,1,"in",current);
  await insert("agents",{id:id(900),name:"عميل بحث مميز"});
  await insert("transactions",{id:id(101),agent_id:id(900)});
  const result=await page({search:"عميل بحث مميز"});
  assert.equal(result.total,1);assert.equal(result.rows[0].id,id(101));assert.equal(result.rows[0].counterparty,"عميل بحث مميز");
  assert.equal((await page({search:"%_'; DROP TABLE payment_splits; --"})).total,0);
});
test("transfers are two ledger legs but one operation, including destination filter",async()=>{
  await box(1,0);await box(2,10);
  await split(20,10,"out",current,{source_table:"cash_box_transfer",source_id:id(500)});
  await split(21,10,"in",current,{cash_box_id:id(2),source_table:"cash_box_transfer",source_id:id(500)});
  assert.equal((await page({ids:[id(1),id(2)]})).total,2);
  const result=await page({ids:[id(1),id(2)],operations:true,box:id(2)});
  assert.equal(result.total,1);assert.equal(result.rows[0].from,"خزينة إنستا الشركة");assert.equal(result.rows[0].to,"خزينة الدولار");
});
test("Cairo month boundary uses the local date even when UTC is previous month",async()=>{
  await box(1,1);
  await db.query("INSERT INTO payment_splits(id,cash_box_id,amount,currency,direction,created_at) VALUES($1,$2,1,'EGP','in',(($3||'-01 00:15:00')::timestamp AT TIME ZONE 'Africa/Cairo'))",[id(10),id(1),current]);
  assert.equal((await page()).total,1);assert.equal((await page({scope:"archive"})).total,0);
});
test("RPC requires report permission and authentication, and retains table RLS",async()=>{
  await box(1,1);await box(2,2);
  await split(10,1,"in",current);await split(11,2,"in",current,{cash_box_id:id(2)});
  await db.query("SELECT set_config('test.hidden_box',$1,false)",[id(2)]);
  assert.equal((await page({ids:[id(1),id(2)]})).total,1);
  await db.exec("SELECT set_config('test.report_access','false',false)");
  await assert.rejects(page(),/صلاحية/);
  await db.exec("SELECT set_config('test.report_access','true',false),set_config('request.jwt.claim.sub','',false)");
  await assert.rejects(page(),/صلاحية/);
});
test("read-only transactions succeed and never alter cash boxes or splits",async()=>{
  await box(1,10);await split(10,10,"in",current);
  await db.exec("BEGIN READ ONLY");
  await page();await db.exec("ROLLBACK");
  assert.equal((await db.query("SELECT balance::text AS value FROM cash_boxes")).rows[0].value,"10");
  assert.equal(Number((await db.query("SELECT count(*) AS value FROM payment_splits")).rows[0].value),1);
});
