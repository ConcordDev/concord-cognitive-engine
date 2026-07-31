// tests/public-read-write-verb-detector.test.js
//
// Bidirectional pin for public-read-write-verb-detector: a write-shaped
// macro name in publicReadDomains whose handler has no ownership-check idiom
// must be flagged; the SAME macro with a real ctx.actor.userId guard (or a
// read-shaped/"_mine"-suffixed name) must NOT be flagged.
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  runPublicReadWriteVerbDetector,
  parsePublicReadDomains,
  findHandlerBody,
} from "../lib/detectors/public-read-write-verb-detector.js";

async function tmpRepo({ serverJs, domainFiles = {} }) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "prwv-"));
  await mkdir(path.join(dir, "server", "domains"), { recursive: true });
  await writeFile(path.join(dir, "server", "server.js"), serverJs, "utf8");
  for (const [name, content] of Object.entries(domainFiles)) {
    await writeFile(path.join(dir, "server", "domains", name), content, "utf8");
  }
  return dir;
}

const PRELUDE = `
const publicReadDomains = {
  lore: new Set(["list", "get"]),
  demo: new Set(["create", "list_mine"]),
};
`;

describe("public-read-write-verb detector — pure parser", () => {
  it("parses domain->macro pairs out of the publicReadDomains literal", () => {
    const parsed = parsePublicReadDomains(PRELUDE);
    assert.ok(parsed);
    const pairs = parsed.entries.map((e) => `${e.domain}.${e.macro}`).sort();
    assert.deepEqual(pairs, ["demo.create", "demo.list_mine", "lore.get", "lore.list"]);
  });

  it("finds a register()-registered handler body by domain+macro", () => {
    const src = `register("demo", "create", (ctx, artifact, params) => { return ctx.actor.userId; });`;
    const body = findHandlerBody(src, "demo", "create");
    assert.ok(body && body.includes("ctx.actor.userId"));
  });
});

describe("public-read-write-verb detector — end to end", () => {
  let dir;
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("FLAGS a write-verb macro whose handler has no ownership idiom", async () => {
    const serverJs = PRELUDE + `
register("demo", "create", (ctx, artifact, params) => {
  return STATE.things.set(params.id, params.value);
});
`;
    dir = await tmpRepo({ serverJs });
    const r = await runPublicReadWriteVerbDetector({ root: dir });
    assert.equal(r.ok, true);
    const hit = r.findings.find((f) => f.evidence?.domain === "demo" && f.evidence?.macro === "create");
    assert.ok(hit, "demo.create should be flagged");
    assert.equal(hit.id, "public_read_write_verb_no_ownership_idiom");
    assert.equal(hit.severity, "high");
  });

  it("does NOT flag a write-verb macro whose handler checks ctx.actor.userId", async () => {
    const serverJs = PRELUDE + `
register("demo", "create", (ctx, artifact, params) => {
  if (!ctx.actor?.userId) return { ok: false, reason: "no_user" };
  return STATE.things.set(params.id, { ...params.value, owner_id: ctx.actor.userId });
});
`;
    dir = await tmpRepo({ serverJs });
    const r = await runPublicReadWriteVerbDetector({ root: dir });
    const hit = r.findings.find((f) => f.evidence?.domain === "demo" && f.evidence?.macro === "create");
    assert.equal(hit, undefined, "a real ownership-check idiom must not be flagged");
  });

  it("does NOT flag a read-shaped or _mine-suffixed macro (verb heuristic scoped correctly)", async () => {
    const serverJs = PRELUDE + `
register("demo", "list_mine", (ctx) => { return []; });
`;
    dir = await tmpRepo({ serverJs });
    const r = await runPublicReadWriteVerbDetector({ root: dir });
    const flagged = r.findings.filter((f) => f.evidence?.macro === "list_mine");
    assert.equal(flagged.length, 0, "list_mine is read-shaped/self-scoping by naming convention");
  });

  it("FLAGS with handler_not_found (medium — inert, not a live anonymous-write path) when the macro has no locatable registration", async () => {
    const serverJs = PRELUDE; // demo.create is declared public but never registered anywhere
    dir = await tmpRepo({ serverJs });
    const r = await runPublicReadWriteVerbDetector({ root: dir });
    const hit = r.findings.find((f) => f.evidence?.domain === "demo" && f.evidence?.macro === "create");
    assert.ok(hit);
    assert.equal(hit.id, "public_read_write_verb_handler_not_found");
    assert.equal(hit.severity, "medium", "a macro that can't be called at all is confirmed drift, not a live risk");
  });

  it("finds a handler registered in server/domains/*.js, not just server.js", async () => {
    const serverJs = PRELUDE;
    const domainFiles = {
      "demo.js": `register("demo", "create", (ctx) => { if (!ctx.actor?.userId) return {ok:false}; return {}; });`,
    };
    dir = await tmpRepo({ serverJs, domainFiles });
    const r = await runPublicReadWriteVerbDetector({ root: dir });
    const hit = r.findings.find((f) => f.evidence?.domain === "demo" && f.evidence?.macro === "create");
    assert.equal(hit, undefined, "handler found in domains/demo.js with an ownership idiom must not be flagged");
  });

  it("finds a real ctx?.actor?.userId (optional-chained after ctx too, not just after .actor)", async () => {
    // Real false-negative this exact pattern caused against the live tree:
    // dtu.update's handler uses `ctx?.actor?.userId` and was wrongly flagged
    // until OWNERSHIP_IDIOM_RE was widened to allow the `?` after `ctx`.
    const serverJs = PRELUDE + `
register("demo", "create", (ctx, input) => {
  const userId = ctx?.actor?.userId;
  if (!userId) return { ok: false, reason: "no_user" };
  return { ok: true };
});
`;
    dir = await tmpRepo({ serverJs });
    const r = await runPublicReadWriteVerbDetector({ root: dir });
    const hit = r.findings.find((f) => f.evidence?.domain === "demo" && f.evidence?.macro === "create");
    assert.equal(hit, undefined, "ctx?.actor?.userId must be recognized as a real ownership idiom");
  });

  it("gives two DIFFERENT not-found macros distinct, fingerprint-safe locations (regression: shared-location fingerprint collision)", async () => {
    // Real bug found running the pre-fix detector against the live tree:
    // every finding shared one fixed `location` (the publicReadDomains
    // block's start line), so the ratchet's sha256(detector|rule|location|
    // severity) fingerprint collapsed 36 distinct findings down to 2 —
    // silently losing 34 from baseline/ratchet tracking forever. Two
    // different dead macros must never produce the same `location`.
    const serverJs = `
const publicReadDomains = {
  demo: new Set(["create", "delete"]),
};
`; // neither macro is registered anywhere
    dir = await tmpRepo({ serverJs });
    const r = await runPublicReadWriteVerbDetector({ root: dir });
    const create = r.findings.find((f) => f.evidence?.domain === "demo" && f.evidence?.macro === "create");
    const del = r.findings.find((f) => f.evidence?.domain === "demo" && f.evidence?.macro === "delete");
    assert.ok(create && del);
    assert.notEqual(create.location, del.location, "distinct macros must fingerprint distinctly, never share a location");
  });

  it("gives two DIFFERENT resolved (no-ownership-idiom) macros distinct locations pointing at their real registration line", async () => {
    const serverJs = `
const publicReadDomains = {
  demo: new Set(["create", "update"]),
};
register("demo", "create", (ctx, input) => { return STATE.things.set(input.id, input.value); });

register("demo", "update", (ctx, input) => { return STATE.other.set(input.id, input.value); });
`;
    dir = await tmpRepo({ serverJs });
    const r = await runPublicReadWriteVerbDetector({ root: dir });
    const create = r.findings.find((f) => f.evidence?.domain === "demo" && f.evidence?.macro === "create");
    const update = r.findings.find((f) => f.evidence?.domain === "demo" && f.evidence?.macro === "update");
    assert.ok(create && update);
    assert.equal(create.id, "public_read_write_verb_no_ownership_idiom");
    assert.equal(update.id, "public_read_write_verb_no_ownership_idiom");
    assert.notEqual(create.location, update.location, "each resolved handler's location must point at ITS OWN real registration line");
  });

  it("does NOT flag an allowlisted, reviewed-intentional macro (collab.join)", async () => {
    // Mirrors the real live-tree instance: collab.join has no ownership
    // idiom by design (session-link-based join), reviewed and allowlisted
    // in the detector's own ALLOWLIST rather than patched around.
    const serverJs = `
const publicReadDomains = {
  collab: new Set(["join"]),
};
register("collab", "join", (ctx, input) => {
  const userId = ctx?.actor?.userId || "anonymous";
  return { ok: true, userId };
});
`;
    dir = await tmpRepo({ serverJs });
    const r = await runPublicReadWriteVerbDetector({ root: dir });
    const hit = r.findings.find((f) => f.evidence?.domain === "collab" && f.evidence?.macro === "join");
    assert.equal(hit, undefined, "collab.join is allowlisted as a reviewed, intentional design");
    const summary = r.findings.find((f) => f.id === "public_read_write_verb_summary");
    assert.equal(summary.evidence.allowlistedCount, 1);
  });
});
