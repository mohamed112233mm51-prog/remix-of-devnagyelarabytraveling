import type { ImportSpec } from "./specs";

const norm = (s: string) =>
  String(s || "")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

function similarity(a: string, b: string): number {
  const an = norm(a), bn = norm(b);
  if (!an || !bn) return 0;
  if (an === bn) return 1;
  if (an.includes(bn) || bn.includes(an)) return 0.85;
  // Dice coefficient on bigrams
  const bigrams = (s: string) => {
    const out = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
    return out;
  };
  const A = bigrams(an), B = bigrams(bn);
  let inter = 0;
  A.forEach((x) => { if (B.has(x)) inter++; });
  const total = A.size + B.size;
  return total ? (2 * inter) / total : 0;
}

/** Auto-suggest mapping: returns { [fieldKey]: headerName | null } */
export function suggestMapping(spec: ImportSpec, headers: string[]): Record<string, string | null> {
  const used = new Set<string>();
  const out: Record<string, string | null> = {};
  for (const f of spec.fields) {
    let best: { h: string; score: number } | null = null;
    const candidates = [f.label, ...f.synonyms, f.key];
    for (const h of headers) {
      if (used.has(h)) continue;
      let score = 0;
      for (const c of candidates) score = Math.max(score, similarity(c, h));
      if (!best || score > best.score) best = { h, score };
    }
    if (best && best.score >= 0.6) {
      out[f.key] = best.h;
      used.add(best.h);
    } else {
      out[f.key] = null;
    }
  }
  return out;
}
