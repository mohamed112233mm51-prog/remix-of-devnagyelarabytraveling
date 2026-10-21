import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/loadTsModule.mjs";

function setup(search = {}, manage = true) {
  let current = search;
  const navigations = [];
  const jsx = (type, props) => typeof type === "function" ? type(props) : ({ type, props: props ?? {} });
  const { Route } = loadTsModule("src/routes/service-pricing.tsx", {
    "@tanstack/react-router": {
      createFileRoute: () => options => ({
        ...options,
        useSearch: () => current,
        useNavigate: () => options => { navigations.push(options); current = options.search; },
      }),
      useRouterState: () => "manage",
    },
    react: { useState: value => [value, () => {}], useMemo: fn => fn(), useEffect: () => {} },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "@/components/AppErrorBoundary": { AppErrorBoundary: "boundary" },
    "@/components/CompanyPricingTab": { CompanyPricingTab: "pricing-editor" },
    "@/components/PriceLookup": { PriceLookup: "lookup" },
    "@/lib/db": { useLive: () => ({ rows: [{ id: "c1", company_name: "الأولى" }, { id: "c2", company_name: "الثانية" }] }) },
    "@/hooks/useAuth": { useAuth: () => ({ permissions: {}, isAdmin: false }) },
    "@/hooks/usePerm": { checkPerm: (_p, _a, key) => key === "service_price_search" || manage },
    "@/components/inputs/SearchableSelect": { SearchableSelect: "company-select" },
    "lucide-react": { ShieldAlert: "icon", Tag: "icon", Search: "icon", ChevronLeft: "icon" },
  });
  const visit = node => Array.isArray(node) ? node.flatMap(visit) : !node || typeof node !== "object" ? [] : [node, ...visit(node.props.children)];
  return { Route, navigations, nodes: () => visit(Route.component()), get search() { return current; } };
}

test("pricing URL accepts company and tier strings and ignores invalid search values", () => {
  const { Route } = setup();
  assert.deepEqual(Route.validateSearch({ company: "c1", tier: "A" }), { company: "c1", tier: "A" });
  assert.deepEqual(Route.validateSearch({ company: ["c1"], tier: { id: "A" } }), { company: undefined, tier: undefined });
  assert.deepEqual(Route.validateSearch({ company: "", tier: 1 }), { company: undefined, tier: undefined });
});

test("direct pricing links restore company and tier, and tier navigation keeps the company in the URL", () => {
  const h = setup({ company: "c1", tier: "B" });
  const editor = () => h.nodes().find(n => n.type === "pricing-editor");
  assert.equal(editor().props.companyId, "c1"); assert.equal(editor().props.tierPages.tier, "B");
  editor().props.tierPages.onSelectTier("A");
  assert.deepEqual(h.navigations[0], { search: { company: "c1", tier: "A" }, hash: "manage" });
  assert.equal(editor().props.tierPages.tier, "A");
  editor().props.tierPages.onSelectTier(undefined);
  assert.equal(editor().props.tierPages.tier, undefined); assert.equal(h.search.company, "c1");
});

test("changing or clearing company resets the tier URL and editor", () => {
  const h = setup({ company: "c1", tier: "B" });
  h.nodes().find(n => n.type === "company-select").props.onChange("c2");
  assert.deepEqual(h.search, { company: "c2" });
  const editor = h.nodes().find(n => n.type === "pricing-editor");
  assert.equal(editor.props.companyId, "c2"); assert.equal(editor.props.tierPages.tier, undefined);
  h.nodes().find(n => n.type === "company-select").props.onChange("");
  assert.equal(h.nodes().find(n => n.type === "pricing-editor"), undefined);
});

test("search-only users cannot open the pricing editor through a direct tier link", () => {
  const h = setup({ company: "c1", tier: "B" }, false);
  assert.equal(h.nodes().find(n => n.type === "pricing-editor"), undefined);
});
