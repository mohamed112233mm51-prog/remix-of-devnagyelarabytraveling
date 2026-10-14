/**
 * Minimal security gate for CVE-2026-102989.
 * Reads the actual npm/Bun lockfiles rather than trusting package.json alone.
 * https://tanstack.com/blog/tanstack-start-security-update-cve-2026-102989
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const npmLock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const bunLock = readFileSync("bun.lock", "utf8");

function versionParts(version) {
  assert.match(version, /^\d+\.\d+\.\d+$/, "Expected a stable version: " + version);
  return version.split(".").map(Number);
}

function atLeast(actual, minimum) {
  const a = versionParts(actual), b = versionParts(minimum);
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return true;
}

const patched = [
  ["@tanstack/react-start", "1.168.60"],
  ["@tanstack/start-server-core", "1.169.39"],
];

for (const [name, minimum] of patched) {
  const entries = Object.entries(npmLock.packages ?? {}).filter(([path]) =>
    path === "node_modules/" + name || path.endsWith("/node_modules/" + name)
  );
  assert.ok(entries.length, name + " missing from npm lockfile");
  for (const [path, record] of entries) {
    assert.ok(atLeast(record.version, minimum), "VULNERABLE npm lock entry: " + path + "@" + record.version);
  }

  const bunEscaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = bunLock.match(new RegExp('^\\s{4}"' + bunEscaped + '": \\["' + bunEscaped + '@([0-9.]+)"', "m"));
  assert.ok(match, name + " missing from Bun lockfile");
  assert.ok(atLeast(match[1], minimum), "VULNERABLE bun lock entry: " + name + "@" + match[1]);
  console.log("Patched:", name, "npm:", entries.map(([, p]) => p.version).join(", "), "bun:", match[1]);
}

// Catch stale lockfiles that npm CI or Vercel could install inconsistently.
for (const [name] of patched.slice(0, 1)) {
  assert.equal(npmLock.packages[""].dependencies[name], manifest.dependencies[name], "npm lock root mismatch: " + name);
  assert.ok(atLeast(manifest.dependencies[name], "1.168.60"), "package.json still selects a vulnerable React Start");
}

console.log("TanStack XSS package and lockfile gate passed.");
