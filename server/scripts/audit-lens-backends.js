#!/usr/bin/env node
/**
 * Audit lens backend implementation completeness.
 *
 * Walks server/domains/*.js, counts macro registrations, and flags actions
 * whose handler body is shorter than 200 chars (likely stubs).
 *
 * Usage: node server/scripts/audit-lens-backends.js [--json]
 */

import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here     = dirname(fileURLToPath(import.meta.url));
const domains  = resolve(here, "..", "domains");
const jsonOnly = process.argv.includes("--json");

const summary = {
  totalDomains: 0,
  totalActions: 0,
  stubActions: 0,
  trivialActions: 0,
  domains: [],
};

const STUB_TOKENS = ["TODO", "stub", "not implemented", "placeholder", "// pending"];
const TRIVIAL_BODY_RE = /\{\s*return\s*\{\s*ok:\s*true,\s*result:\s*\{\s*message:[^}]*\}\s*\};\s*\}/;

for (const file of readdirSync(domains)) {
  if (!file.endsWith(".js")) continue;
  const path = resolve(domains, file);
  const src = readFileSync(path, "utf8");

  // Find every registerLensAction("domain", "name", handler) call.
  const matcher = /registerLensAction\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*,\s*([\s\S]*?)\)\s*;/g;
  const actions = [];
  let m;
  while ((m = matcher.exec(src)) !== null) {
    const [, domain, name, handler] = m;
    const handlerLen = handler.length;
    const isStub =
      STUB_TOKENS.some(t => handler.toLowerCase().includes(t.toLowerCase())) ||
      TRIVIAL_BODY_RE.test(handler);
    const isTrivial = handlerLen < 220 && !isStub;
    actions.push({ domain, name, handlerLen, isStub, isTrivial });
    if (isStub) summary.stubActions++;
    if (isTrivial) summary.trivialActions++;
  }

  summary.totalDomains++;
  summary.totalActions += actions.length;
  summary.domains.push({
    file,
    actionCount: actions.length,
    stubCount: actions.filter(a => a.isStub).length,
    trivialCount: actions.filter(a => a.isTrivial).length,
    actions,
  });
}

summary.completeRatio = summary.totalActions === 0
  ? 0
  : Math.round((1 - (summary.stubActions + summary.trivialActions) / summary.totalActions) * 1000) / 1000;

if (jsonOnly) {
  process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
  process.exit(0);
}

console.log(`Lens backend audit`);
console.log(`==================`);
console.log(`Domains:  ${summary.totalDomains}`);
console.log(`Actions:  ${summary.totalActions}`);
console.log(`Stubs:    ${summary.stubActions}`);
console.log(`Trivial:  ${summary.trivialActions}`);
console.log(`Real:     ${summary.totalActions - summary.stubActions - summary.trivialActions}`);
console.log(`Complete: ${(summary.completeRatio * 100).toFixed(1)}%`);
console.log();
console.log(`Top stub domains:`);
summary.domains
  .filter(d => d.stubCount + d.trivialCount > 0)
  .sort((a, b) => (b.stubCount + b.trivialCount) - (a.stubCount + a.trivialCount))
  .slice(0, 15)
  .forEach(d => {
    console.log(
      `  ${d.file.padEnd(30)} ` +
      `actions=${String(d.actionCount).padStart(2)} ` +
      `stubs=${String(d.stubCount).padStart(2)} ` +
      `trivial=${String(d.trivialCount).padStart(2)}`,
    );
  });
