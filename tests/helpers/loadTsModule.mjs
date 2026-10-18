import ts from "typescript";
import { readFileSync } from "node:fs";
export function loadTsModule(path, deps = {}, globals = {}) {
  const source = readFileSync(new URL("../../" + path, import.meta.url), "utf8")
    .replaceAll("import.meta.env.DEV", "false");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(globals), code)(
    (name) => {
      if (!(name in deps)) throw Error("Unexpected import: " + name);
      return deps[name];
    }, module, module.exports, ...Object.values(globals),
  );
  return module.exports;
}
export const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
export function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
