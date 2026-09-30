// server/tests/macro-stub-detector.test.js
//
// Proves the macro-stub detector fires on registered macros whose handler
// body is a stub disguised as working — hardcoded datasets, no-op successes,
// and incompleteness markers that still return `{ ok: true }` — and that it
// stays quiet on the legitimate shapes this repo is full of: real db/ctx
// handlers, catalog/enum returns, honest `{ ok:false, reason:'roadmap' }`
// stubs, and code-generation templates.
//
// Seeded by ConKay's agent loop (run_lens_action) hitting exactly these
// while trying to build against the macro surface.

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  runMacroStubDetector,
  classifyHandlerBody,
  extractHandlerBody,
  rawBodySlice,
  findRegisterInRaw,
} from "../lib/detectors/macro-stub-detector.js";
import { stripCommentsAndRegex } from "../lib/detectors/dead-macro-call-detector.js";

async function tmpRepo(files) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "macrostub-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content, "utf8");
  }
  return dir;
}
const real = (r) => r.findings.filter((f) => f.severity !== "info");
const ids = (r) => real(r).map((f) => f.id);

// ── pure-helper unit tests ───────────────────────────────────────────────
describe("macro-stub detector — classifyHandlerBody", () => {
  it("flags a hardcoded-dataset no-op success", () => {
    const body = `
      const slots = [ { day: "Tue", score: 96 }, { day: "Wed", score: 93 } ];
      return { ok: true, result: { recommended: slots[0], slots } };
    `;
    const v = classifyHandlerBody(stripCommentsAndRegex(body), body, { macroName: "best-time" });
    assert.equal(v?.id, "macro_noop_success");
  });

  it("flags a TODO-marked handler that still returns success", () => {
    const body = `
      // TODO: wire this to the real scheduler — hardcoded for now
      return { ok: true, result: { scheduled: true } };
    `;
    const v = classifyHandlerBody(stripCommentsAndRegex(body), body, { macroName: "schedule" });
    assert.equal(v?.id, "macro_todo_stub");
  });

  it("does NOT flag a real db/ctx handler", () => {
    const body = `
      const db = ctx?.db;
      if (!db) return { ok: false, reason: "no_db" };
      const rows = db.prepare("SELECT * FROM x WHERE u = ?").all(ctx.actor.id);
      return { ok: true, result: { rows } };
    `;
    assert.equal(classifyHandlerBody(stripCommentsAndRegex(body), body, { macroName: "list_x" }), null);
  });

  it("does NOT flag a catalog/enum return of a module constant", () => {
    const body = `return { ok: true, result: { templates: AGENT_TEMPLATES, total: AGENT_TEMPLATES.length } };`;
    assert.equal(classifyHandlerBody(stripCommentsAndRegex(body), body, { macroName: "listTemplates" }), null);
  });

  it("does NOT flag a status-shaped macro returning a static ok", () => {
    const body = `return { ok: true, status: "ok", layer: "guidance" };`;
    assert.equal(classifyHandlerBody(stripCommentsAndRegex(body), body, { macroName: "status" }), null);
  });

  it("classifies an honest { ok:false, reason:'roadmap' } stub as info-only", () => {
    const body = `return { ok: false, reason: "roadmap", message: "not built yet" };`;
    const v = classifyHandlerBody(stripCommentsAndRegex(body), body, { macroName: "publish" });
    assert.equal(v?.id, "macro_honest_roadmap_stub");
    assert.equal(v.severity, "info");
    assert.equal(v.reason, "roadmap");
  });

  it("does NOT flag a code-generation template body", () => {
    const body = `
      // Action logic here
      return { ok: true, result: { ... } };
    `;
    assert.equal(classifyHandlerBody(stripCommentsAndRegex(body), body, { macroName: "myAction" }), null);
  });

  it("does NOT flag the word 'stub' used as a domain concept", () => {
    const body = `
      const db = ctx.db;
      // Stub systems persist in the spec but don't activate until Phase 7.
      const skippedStubs = spec.systems.filter((s) => s.status === "stub");
      return { ok: true, result: { skippedStubs } };
    `;
    assert.equal(classifyHandlerBody(stripCommentsAndRegex(body), body, { macroName: "publish" }), null);
  });
});

describe("macro-stub detector — extraction helpers", () => {
  it("extractHandlerBody resolves an inline arrow", () => {
    const src = `registerLensAction("d", "n", (ctx, a, p) => { return { ok: true }; });`;
    const stripped = stripCommentsAndRegex(src);
    const afterNameComma = stripped.indexOf('"n"') + '"n"'.length + 1; // just past `"n",`
    const h = extractHandlerBody(stripped, afterNameComma);
    assert.ok(h);
    assert.match(h.body, /ok:\s*true/);
  });

  it("rawBodySlice returns the comment-intact body interior", () => {
    const raw = `registerLensAction("d", "n", (ctx) => {\n  // TODO real impl\n  return { ok: true };\n});`;
    const at = findRegisterInRaw(raw, "d", "n");
    assert.ok(at >= 0);
    const body = rawBodySlice(raw, at);
    assert.match(body, /TODO real impl/);
  });
});

// ── end-to-end ───────────────────────────────────────────────────────────
describe("macro-stub detector — end to end", () => {
  let dir;
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("FIRES on a hardcoded-dataset macro and a TODO stub, quiet on the real one", async () => {
    dir = await tmpRepo({
      "server/domains/thing.js": [
        "export default function register(registerLensAction) {",
        "  registerLensAction('thing', 'best-time', (_ctx, _a, _p) => {",
        "    const slots = [ { day: 'Tue', score: 96 }, { day: 'Wed', score: 93 } ];",
        "    return { ok: true, result: { recommended: slots[0], slots } };",
        "  });",
        "  registerLensAction('thing', 'schedule', (ctx, _a, p) => {",
        "    // TODO: not implemented yet — return canned success",
        "    return { ok: true, result: { scheduled: true } };",
        "  });",
        "  registerLensAction('thing', 'list', (ctx, _a, _p) => {",
        "    const db = ctx.db;",
        "    const rows = db.prepare('SELECT * FROM things WHERE u = ?').all(ctx.actor.id);",
        "    return { ok: true, result: { rows } };",
        "  });",
        "}",
        "",
      ].join("\n"),
    });
    const r = await runMacroStubDetector({ root: dir });
    assert.equal(r.ok, true);
    const got = ids(r);
    assert.ok(got.includes("macro_noop_success"), `expected macro_noop_success, got ${JSON.stringify(got)}`);
    assert.ok(got.includes("macro_todo_stub"), `expected macro_todo_stub, got ${JSON.stringify(got)}`);
    // the real db handler must NOT be flagged
    assert.ok(
      !real(r).some((f) => f.evidence?.macro === "thing.list"),
      "the real db-backed handler must stay quiet",
    );
  });

  it("inventories honest roadmap stubs at info level, never as a real finding", async () => {
    dir = await tmpRepo({
      "server/domains/soon.js": [
        "export default function register(register) {",
        "  register('soon', 'publish', (ctx, input) => {",
        "    return { ok: false, reason: 'roadmap', message: 'coming later' };",
        "  });",
        "}",
        "",
      ].join("\n"),
    });
    const r = await runMacroStubDetector({ root: dir });
    assert.equal(real(r).length, 0, `expected 0 real findings, got ${JSON.stringify(real(r))}`);
    const summary = r.findings.find((f) => f.id === "macro_stub_summary");
    assert.deepEqual(summary.evidence.honestRoadmapStubs, ["soon.publish"]);
  });

  it("respects the // @macro-stub-ok annotation", async () => {
    dir = await tmpRepo({
      "server/domains/ok.js": [
        "export default function register(registerLensAction) {",
        "  registerLensAction('ok', 'best-time', (_ctx) => {",
        "    // @macro-stub-ok: generic heuristic, disclosed to the user as such",
        "    const slots = [ { day: 'Tue', score: 96 }, { day: 'Wed', score: 93 } ];",
        "    return { ok: true, result: { slots } };",
        "  });",
        "}",
        "",
      ].join("\n"),
    });
    const r = await runMacroStubDetector({ root: dir });
    assert.equal(real(r).length, 0, "annotation should suppress the finding");
  });

  it("never throws — ok:true and 0 real findings on an empty tree", async () => {
    dir = await tmpRepo({ "server/x.txt": "no code" });
    const r = await runMacroStubDetector({ root: dir });
    assert.equal(r.ok, true);
    assert.equal(real(r).length, 0);
  });

  it("ignores server/emergent/** (game-mechanic randomness is out of scope)", async () => {
    dir = await tmpRepo({
      "server/emergent/foo-cycle.js": [
        "export function register(register) {",
        "  register('foo', 'roll', () => {",
        "    // TODO tune this",
        "    return { ok: true, result: { roll: Math.random() } };",
        "  });",
        "}",
        "",
      ].join("\n"),
    });
    const r = await runMacroStubDetector({ root: dir });
    assert.equal(real(r).length, 0, "emergent modules are excluded");
  });
});
