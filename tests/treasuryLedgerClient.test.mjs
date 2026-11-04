import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/loadTsModule.mjs";

const model=loadTsModule("src/lib/treasuryLedger.ts");
const request={boxIds:["b","a"],scope:"current",month:"",page:2,boxId:"",direction:"out",search:" اسم ",operations:false,kind:""};
test("client sends one bounded RPC with server filters and abort signal; no full-table fallback",async()=>{
  const calls=[];const controller=new AbortController();
  const client = {
    rpc(name, args) {
      calls.push({ name, args });
      return {
        abortSignal(signal) {
          assert.equal(signal, controller.signal);
          return Promise.resolve({ data: { ...model.emptyTreasuryPage, total: 1205, page: 2 }, error: null });
        },
      };
    },
  };
  await model.readTreasuryLedgerPage(client,request,controller.signal);
  assert.equal(calls.length,1);assert.equal(calls[0].name,"get_treasury_ledger_page");
  assert.deepEqual(calls[0].args.p_box_ids,["a","b"]);assert.equal(calls[0].args.p_page,2);
  assert.equal(calls[0].args.p_search,"اسم");assert.equal(calls[0].args.p_direction,"out");
  assert.equal("p_page_size" in calls[0].args,false);
  await assert.rejects(model.readTreasuryLedgerPage({rpc:async()=>({data:null,error:{code:"PGRST202",message:"missing"}})},request),/تحديث قراءة سجل/);
});
test("empty boxes never trigger a history read and oversize responses fail closed",async()=>{
  const client={rpc(){throw Error("Must not request all boxes");}};
  assert.deepEqual(await model.readTreasuryLedgerPage(client,{...request,boxIds:[]}),model.emptyTreasuryPage);
  await assert.rejects(model.readTreasuryLedgerPage({rpc:async()=>({data:{rows:Array(51).fill({})},error:null})},request),/تعذر تأكيد/);
});
test("query cache is scoped by user, period, source, filters and page",()=>{
  const options=[];
  const hook=loadTsModule("src/hooks/useTreasuryLedgerPage.ts",{
    react:{useEffect(){}},
    "@tanstack/react-query":{useQueryClient:()=>({}),useQuery:o=>{options.push(o);return {};}},
    "@/integrations/supabase/client":{supabase:{}},
    "@/hooks/useAuth":{useAuth:()=>({user:{id:"user"},profileLoaded:true})},
    "@/hooks/usePerm":{usePerm:()=>({view:true})},
    "@/lib/treasuryLedger":model,
  });
  hook.useTreasuryLedgerPage(request,"2026-11");
  hook.useTreasuryLedgerPage({...request,page:3},"2026-11");
  assert.notDeepEqual(options[0].queryKey,options[1].queryKey);
  assert.equal(options[0].queryKey[1],"user");assert.equal(options[0].enabled,true);
  assert.equal(options[0].retry,false);assert.equal(options[0].placeholderData,undefined);
});
function harness() {
  let cells=[],cursor=0,effects=[],tree,lastRequest;
  let failure=false;
  const same=(a,b)=>a&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
  const react={
    useState(initial){const i=cursor++;cells[i]??={value:typeof initial==="function"?initial():initial};return [cells[i].value,next=>{cells[i].value=typeof next==="function"?next(cells[i].value):next;}];},
    useMemo(fn,deps){const i=cursor++;if(!cells[i]||!same(cells[i].deps,deps))cells[i]={deps,value:fn()};return cells[i].value;},
    useEffect(fn,deps){const i=cursor++;if(!cells[i]||!same(cells[i].deps,deps))effects.push(()=>{cells[i]?.cleanup?.();cells[i]={deps,cleanup:fn()};});},
  };
  const jsx=(type,props,key)=>({type,props:props||{},key});
  const component=loadTsModule("src/components/TreasuryMovementLedger.tsx",{
    react,"react/jsx-runtime":{jsx,jsxs:jsx},
    "@/lib/db":{normalizeCurrency:v=>v,fmtBalance:v=>String(v)},
    "@/lib/approvalFines":{cairoToday:()=>"2026-11-04"},
    "@/components/MonthPeriodPicker":{monthLabel:m=>m},
    "@/lib/treasuryLedger":model,
    "@/hooks/useTreasuryLedgerPage":{useTreasuryLedgerPage:r=>{
      lastRequest=r;
      const total=r.scope==="archive"?61:1205;
      return {isFetching:false,error:failure?Error("فشل الاتصال"):null,refetch(){},
        data:failure?undefined:{...model.emptyTreasuryPage,total,page:r.page,archivedCount:61,currentCount:1205,months:["2026-10"],
          rows:Array.from({length:Math.min(50,total-r.page*50)},(_,i)=>({
            id:"row-"+(r.page*50+i),cashBoxName:"إنستا",performedAt:"2026-11-04T12:00:00Z",direction:"in",
            directionLabel:"وارد",amount:1,currency:"EGP",type:"وارد",counterparty:"عميل",balanceAfter:100,
          }))},
      };
    }},
  },{setInterval:()=>1,clearInterval(){},setTimeout:()=>1,clearTimeout(){}});
  const boxes=[{id:"insta",name:"خزينة إنستا الشركة",method_key:"company_instapay",currency:"EGP",balance:1205}];
  const nodes=node=>Array.isArray(node)?node.flatMap(nodes):node&&typeof node==="object"?[node,...nodes(node.props?.children)]:[];
  const text=node=>Array.isArray(node)?node.map(text).join(""):node==null||typeof node==="boolean"?"":typeof node==="object"?text(node.props.children):String(node);
  function render(){cursor=0;tree=component.TreasuryMovementLedger({boxes});while(effects.length)effects.shift()();}
  function click(label){const button=nodes(tree).find(n=>n.type==="button"&&text(n).startsWith(label));assert.ok(button,label);button.props.onClick();render();}
  render();render();
  return {click,request:()=>lastRequest,rows:()=>nodes(tree).filter(n=>n.type==="tr"&&String(n.key||"").startsWith("row-")),
    changeMonth(value){nodes(tree).find(n=>n.props["aria-label"]==="اختيار شهر أرشيف الخزائن").props.onChange({target:{value}});render();},
    fail(){failure=true;render();},text:()=>text(tree)};
}
test("actual ledger defaults to current month, shows 50 rows and pages on the server",()=>{
  const h=harness();assert.equal(h.request().scope,"current");assert.equal(h.rows().length,50);
  h.click("التالي");assert.equal(h.request().page,1);assert.equal(h.rows()[0].key,"row-50");
  h.click("الأخيرة");assert.equal(h.request().page,24);assert.equal(h.rows().length,5);
});
test("archive and month switching reset page without changing any financial rows",()=>{
  const h=harness();h.click("التالي");h.click("الأرشيف");
  assert.equal(h.request().scope,"archive");assert.equal(h.request().page,0);assert.equal(h.request().month,"");
  h.changeMonth("2026-10");assert.equal(h.request().month,"2026-10");
  h.click("الشهر الحالي");assert.equal(h.request().month,"");assert.equal(h.request().page,0);
});
test("a failed page request does not display old rows as a successful empty archive",()=>{
  const h=harness();h.fail();assert.equal(h.rows().length,0);assert.match(h.text(),/فشل الاتصال/);assert.match(h.text(),/إعادة المحاولة/);
});
