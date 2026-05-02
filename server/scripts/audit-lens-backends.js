#!/usr/bin/env node
/**
 * Audit lens backend implementation completeness.
 *
 * Walks server/domains/*.js, counts macro registrations, and classifies
 * each handler as:
 *   real     — handler body > 400 chars and contains real logic
 *   trivial  — handler body < 400 chars and only does shape massaging
 *   stub     — handler body returns a canned message-only result
 *
 * Stub detection: handler body matches the pattern
 *     return { ok: true, result: { message: "..." } };
 * with no other `return` after it.
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

const STUB_PATTERN = /return\s+\{\s*ok:\s*true,\s*result:\s*\{\s*message:\s*['"][^'"]*['"]\s*\}\s*\}\s*;\s*\}\s*\)\s*;?\s*$/;
const TRIVIAL_BODY_LEN = 400;

for (const file of readdirSync(domains)) {
  if (!file.endsWith(".js")) continue;
  const path = resolve(domains, file);
  const src = readFileSync(path, "utf8");

  // Match each registerLensAction("domain", "name", (params) => { ... }).
  // We capture the handler body up to the matching closing paren of the call.
  const actions = [];
  const re = /registerLensAction\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*,/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const [, domain, name] = m;
    const startIdx = re.lastIndex;
    // Walk forward to find the matching `);` that closes this call.
    let depth = 1;
    let i = startIdx;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === "(") depth++;
      else if (c === ")") depth--;
      i++;
    }
    const handler = src.slice(startIdx, i - 1);
    const handlerLen = handler.length;
    const isStub = STUB_PATTERN.test(handler.replace(/\s+/g, " ")) ||
                   /^\s*\([^)]*\)\s*=>\s*\(?\s*\{\s*ok:\s*true,\s*result:\s*\{\s*message:[^}]+\}\s*\}\s*\)?\s*$/.test(handler.trim());
    const isTrivial = !isStub && handlerLen < TRIVIAL_BODY_LEN;
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
console.log(`Top domains by stub count:`);
summary.domains
  .filter(d => d.stubCount > 0)
  .sort((a, b) => b.stubCount - a.stubCount)
  .slice(0, 15)
  .forEach(d => {
    console.log(
      `  ${d.file.padEnd(30)} ` +
      `actions=${String(d.actionCount).padStart(2)} ` +
      `stubs=${String(d.stubCount).padStart(2)}`,
    );
  });
