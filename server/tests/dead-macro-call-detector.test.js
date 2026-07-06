// tests/dead-macro-call-detector.test.js
//
// Proves DeadMacroCallDetector catches a call site whose LITERAL
// (domain, macro) pair was never registered on the backend — the
// per-call-site granularity `scripts/verify-lens-backends.mjs` misses
// because it only checks that a lens reaches AT LEAST ONE registered
// macro domain (and only tracks the domain half of the pair at that).
//
// Pinned:
//   - registration-side: literal register()/registerLensAction() pairs,
//     including a per-file `const reg = registerLensAction` alias
//     (the personas.js / settings.js shape)
//   - registration-side: the _recent-mine-bulk.js DOMAIN_TYPE_MAP bulk
//     resolver (honors SKIP_DOMAINS)
//   - call-site side: lensRun/runDomain/runMacro positional AND
//     object-spec forms, plus the raw `/api/lens/run` fetch/api.post body
//     form
//   - a literal call to an unregistered pair is flagged HIGH
//   - a literal call to a REGISTERED pair is not flagged
//   - a call with a dynamic/variable domain or macro is never flagged
//     (can't be resolved statically — flagging it would be a false positive)
//   - a usage example living only in a comment is not flagged (comments are
//     stripped before scanning)
//   - an empty tree produces zero findings
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  runDeadMacroCallDetector,
  buildRegisteredMacroPairs,
  collectBulkRecentMineDomains,
  extractCallSites,
} from "../lib/detectors/dead-macro-call-detector.js";

async function tmpRepo(files) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "deadmacro-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content, "utf8");
  }
  return dir;
}
const findingsOf = (r, id) => r.findings.filter((f) => f.id === id);

describe("dead-macro-call detector — pure helpers", () => {
  it("extractCallSites finds positional lensRun/runDomain/runMacro literal pairs", () => {
    const src = [
      `lensRun('crypto', 'holdings-list', {});`,
      `apiHelpers.lens.runDomain('mesh', 'queueList', {});`,
      `await runMacro<Foo>('voice_chat', 'ice', {});`,
    ].join("\n");
    const sites = extractCallSites(src);
    const pairs = sites.map((s) => `${s.domain}.${s.macro}`).sort();
    assert.deepEqual(pairs, ["crypto.holdings-list", "mesh.queueList", "voice_chat.ice"]);
  });

  it("extractCallSites finds the lensRun object-spec form", () => {
    const src = `await lensRun({ domain: 'aviation', action: 'logbook-list', input: {} });`;
    const sites = extractCallSites(src);
    assert.equal(sites.length, 1);
    assert.equal(sites[0].domain, "aviation");
    assert.equal(sites[0].macro, "logbook-list");
  });

  it("extractCallSites finds the raw /api/lens/run body form (fetch + api.post)", () => {
    const src = [
      `await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: {} });`,
      `fetch('/api/lens/run', { method: 'POST', body: JSON.stringify({ domain: 'seasons', name: 'current', input: { worldId } }) });`,
    ].join("\n");
    const sites = extractCallSites(src);
    const pairs = sites.map((s) => `${s.domain}.${s.macro}`).sort();
    assert.deepEqual(pairs, ["dtu.create", "seasons.current"]);
  });

  it("extractCallSites skips dynamic/variable domain or macro", () => {
    const src = [
      `apiHelpers.lens.runDomain('bio', action, { input });`, // macro is a variable
      `lensRun(domainVar, 'foo', {});`,                        // domain is a variable
      `await api.post('/api/lens/run', { domain, action: act, input: inp });`, // both variables (lensRun's own impl shape)
    ].join("\n");
    assert.equal(extractCallSites(src).length, 0);
  });

  it("buildRegisteredMacroPairs is alias-aware (const reg = registerLensAction shape)", async () => {
    const dir = await tmpRepo({
      "server/domains/personas.js": [
        `export default function registerPersonasActions(registerLensAction) {`,
        `  const reg = registerLensAction;`,
        `  reg("personas", "get", () => ({ ok: true }));`,
        `  reg("personas", "mine", () => ({ ok: true }));`,
        `}`,
      ].join("\n"),
    });
    try {
      const pairs = await buildRegisteredMacroPairs(dir);
      assert.ok(pairs.has("personas get"));
      assert.ok(pairs.has("personas mine"));
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("collectBulkRecentMineDomains parses DOMAIN_TYPE_MAP keys and honors SKIP_DOMAINS", async () => {
    const dir = await tmpRepo({
      "server/domains/_recent-mine-bulk.js": [
        `const DOMAIN_TYPE_MAP = Object.freeze({`,
        `  pharmacy: { type: null },`,
        `  "creative-writing": { type: ["creative_text", "story"] },`,
        `  drafts: { type: null },`,
        `});`,
        `const SKIP_DOMAINS = new Set(["drafts"]);`,
        `export default function registerBulkRecentMine(register) {`,
        `  for (const [domain, opts] of Object.entries(DOMAIN_TYPE_MAP)) {`,
        `    if (SKIP_DOMAINS.has(domain)) continue;`,
        `    register(domain, "recent_mine", () => {});`,
        `  }`,
        `}`,
      ].join("\n"),
    });
    try {
      const domains = await collectBulkRecentMineDomains(dir);
      assert.ok(domains.includes("pharmacy"));
      assert.ok(domains.includes("creative-writing"));
      assert.ok(!domains.includes("drafts"), "SKIP_DOMAINS entry must be excluded");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

describe("dead-macro-call detector — end to end", () => {
  let dir;
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("FIRES (high) on a literal call to a never-registered (domain, macro) pair", async () => {
    dir = await tmpRepo({
      "server/domains/real.js": [
        `export default function registerRealActions(register) {`,
        `  register("real_domain", "real_macro", () => ({ ok: true }));`,
        `}`,
      ].join("\n"),
      "concord-frontend/app/lenses/ghost/page.tsx": [
        `'use client';`,
        `import { lensRun } from '@/lib/api/client';`,
        `export default function Page() {`,
        `  lensRun('nonexistent_domain_xyz', 'nonexistent_macro_xyz', {});`,
        `  return null;`,
        `}`,
      ].join("\n"),
    });
    const r = await runDeadMacroCallDetector({ root: dir });
    assert.equal(r.ok, true);
    const dead = findingsOf(r, "dead_macro_call");
    assert.equal(dead.length, 1);
    assert.equal(dead[0].severity, "high");
    assert.equal(dead[0].evidence.domain, "nonexistent_domain_xyz");
    assert.equal(dead[0].evidence.macro, "nonexistent_macro_xyz");
    assert.match(dead[0].location, /ghost\/page\.tsx/);
  });

  it("does NOT fire on a literal call to a REGISTERED pair", async () => {
    dir = await tmpRepo({
      "server/domains/achievements.js": [
        `export default function registerAchievementsActions(register) {`,
        `  register("achievements", "list", () => ({ ok: true }));`,
        `}`,
      ].join("\n"),
      "concord-frontend/app/lenses/achievements/page.tsx": [
        `import { lensRun } from '@/lib/api/client';`,
        `export default function Page() {`,
        `  lensRun('achievements', 'list', {});`,
        `  return null;`,
        `}`,
      ].join("\n"),
    });
    const r = await runDeadMacroCallDetector({ root: dir });
    assert.equal(findingsOf(r, "dead_macro_call").length, 0);
  });

  it("does NOT fire on a dynamic (non-literal) domain/macro call", async () => {
    dir = await tmpRepo({
      "server/domains/real.js": [
        `export default function registerRealActions(register) {`,
        `  register("bio", "sequence-analyze", () => ({ ok: true }));`,
        `}`,
      ].join("\n"),
      "concord-frontend/components/bio/BioActionPanel.tsx": [
        `async function runDomainAction(action) {`,
        `  const r = await apiHelpers.lens.runDomain('bio', action, { input: {} });`,
        `  return r;`,
        `}`,
      ].join("\n"),
    });
    const r = await runDeadMacroCallDetector({ root: dir });
    assert.equal(findingsOf(r, "dead_macro_call").length, 0);
  });

  it("does NOT fire on a usage example living only in a comment", async () => {
    dir = await tmpRepo({
      "server/domains/real.js": [
        `export default function registerRealActions(register) {`,
        `  register("npc_legacy", "get", () => ({ ok: true }));`,
        `}`,
      ].join("\n"),
      "concord-frontend/components/world/TombMarker.tsx": [
        `// Backed by npc_legacy.tombs_for_world — see`,
        `// \`runMacro('npc_legacy', 'tombs_for_world', { worldId })\`.`,
        `export function TombMarker() { return null; }`,
      ].join("\n"),
    });
    const r = await runDeadMacroCallDetector({ root: dir });
    assert.equal(findingsOf(r, "dead_macro_call").length, 0, "comment-only mention must not be scanned as a call");
  });

  it("never throws — returns ok:true with zero findings on an empty tree", async () => {
    dir = await tmpRepo({ "README.md": "nothing here" });
    const r = await runDeadMacroCallDetector({ root: dir });
    assert.equal(r.ok, true);
    assert.equal(findingsOf(r, "dead_macro_call").length, 0);
  });
});
