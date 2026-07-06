// tests/realtime-emit-signature-detector.test.js
//
// Proves the realtime-emit-signature detector FIRES on the two real
// argument-misuse shapes found in the 2026-07-05 audit of `realtimeEmit`
// call sites, and stays SILENT on the ~30 correctly-shaped call sites
// already in the tree (a detector that can't tell these apart is noise).
//
// Fixture provenance:
//   - "wrong argument order" fixtures are pulled verbatim from the PRE-FIX
//     source at `git show 310e8e3a^:server/server.js` (the
//     `/api/combat/brawl/invite` route) and
//     `310e8e3a^:server/emergent/brawl-queue-cycle.js` (the matchmaking
//     heartbeat) — both fixed by commit 310e8e3a.
//   - "wrong key name" fixtures reproduce the shape of the 3 call sites the
//     same audit flagged but left unfixed (out of scope for that commit):
//     `server.js:52447` (party:invite-received), `server.js:52613`
//     (mail:received), `server.js:52679` (friend:request-received) — all
//     pass `{ targetUserId: ... }` where realtimeEmit only reads `userId`.
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  runRealtimeEmitSignatureDetector,
  classifyFirstArg,
  classifyOptionsArg,
  objectLiteralKeys,
  splitTopLevelArgs,
  stripComments,
} from "../lib/detectors/realtime-emit-signature-detector.js";

async function tmpRepo(files) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "rtemit-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content, "utf8");
  }
  return dir;
}
const byId = (r, id) => r.findings.filter((f) => f.id === id);

describe("realtime-emit-signature detector — pure helpers", () => {
  it("classifyFirstArg: plain string literals are always safe, regardless of content", () => {
    assert.equal(classifyFirstArg('"brawl-invited"').flag, false);
    assert.equal(classifyFirstArg('"world:weather"').flag, false);
    assert.equal(classifyFirstArg("`ping`").flag, false, "no-interpolation backtick literal is a plain literal");
  });

  it("classifyFirstArg: template literal with a user:/session:/org:/room:/channel: prefix is flagged", () => {
    assert.equal(classifyFirstArg("`user:${toUserId}:brawl-invited`").flag, true);
    assert.equal(classifyFirstArg("`user:${r.paired.a}`").flag, true);
    assert.equal(classifyFirstArg("`session:${sid}`").flag, true);
  });

  it("classifyFirstArg: a dynamic template with a NON-scope prefix is left alone (avoid false positive)", () => {
    // Real call site in the tree: server.js ambient-chat uses the event
    // NAME itself as the per-district scoping mechanism — `world:` is not
    // one of realtimeEmit's own destructured option keys (user/session/org),
    // so this is a deliberate dynamic-event-name pattern, not the
    // (room, event, payload) misordering bug.
    assert.equal(classifyFirstArg("`world:${worldId}:district:${districtId}:ambient`").flag, false);
  });

  it("classifyFirstArg: bare room/channel/userId-shaped identifiers are flagged", () => {
    assert.equal(classifyFirstArg("room").flag, true);
    assert.equal(classifyFirstArg("channel").flag, true);
    assert.equal(classifyFirstArg("toUserId").flag, true);
    assert.equal(classifyFirstArg("req.body?.toUserId").flag, true);
    assert.equal(classifyFirstArg("targetSessionId").flag, true);
  });

  it("classifyFirstArg: an unrelated bare identifier (e.g. an EVENT_NAME constant) is left alone", () => {
    assert.equal(classifyFirstArg("EVENT_NAME").flag, false);
    assert.equal(classifyFirstArg("event").flag, false);
    assert.equal(classifyFirstArg("payload").flag, false);
  });

  it("splitTopLevelArgs respects nested braces/brackets/strings", () => {
    const args = splitTopLevelArgs(`"a:b", { x: 1, y: [1,2,3] }, { userId: fn(a, b) }`);
    assert.equal(args.length, 3);
    assert.equal(args[0], '"a:b"');
  });

  it("objectLiteralKeys extracts named + shorthand keys, ignores non-objects", () => {
    assert.deepEqual(objectLiteralKeys("{ targetUserId: req.body?.toUserId }"), ["targetUserId"]);
    assert.deepEqual(objectLiteralKeys("{ userId }"), ["userId"]);
    assert.equal(objectLiteralKeys("wager.proposer_id"), null);
  });

  it("classifyOptionsArg: targetUserId without userId is flagged; userId alone is not", () => {
    assert.equal(classifyOptionsArg("{ targetUserId: x }").flag, true);
    assert.equal(classifyOptionsArg("{ userId: x }").flag, false);
    assert.equal(classifyOptionsArg("{ userId: x, targetUserId: y }").flag, false, "both present -> not flagged, conservative");
    assert.equal(classifyOptionsArg("wager.proposer_id"), null, "non-object 3rd arg is out of scope for this rule");
  });

  it("stripComments removes call sites living only in comments/docs", () => {
    const src = "a\n// realtimeEmit(`user:${x}`, y)\n/* realtimeEmit(`user:${x}`, y) */\nb";
    const out = stripComments(src);
    assert.ok(!out.includes("realtimeEmit"));
    assert.equal(out.split("\n").length, src.split("\n").length);
  });
});

describe("realtime-emit-signature detector — end to end", () => {
  let dir;
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("FIRES on the real pre-fix brawl/invite shape (commit 310e8e3a^, server.js)", async () => {
    dir = await tmpRepo({
      "server.js": [
        `app.post("/api/combat/brawl/invite", requireAuth(), asyncHandler(async (req, res) => {`,
        `  const { inviteBrawl } = await import("./lib/brawl.js");`,
        `  const fromUserId = req.user?.id || req.user?.userId;`,
        `  const r = inviteBrawl(fromUserId, req.body?.toUserId);`,
        `  if (r.ok && !r.alreadyOpen) {`,
        `    try {`,
        "      realtimeEmit?.(`user:${req.body?.toUserId}:brawl-invited`, {",
        `        inviteId: r.inviteId, from: fromUserId,`,
        `      });`,
        `    } catch { /* emit best-effort */ }`,
        `  }`,
        `  res.status(r.ok ? 200 : 400).json(r);`,
        `}));`,
      ].join("\n"),
    });
    const r = await runRealtimeEmitSignatureDetector({ root: dir });
    assert.equal(r.ok, true);
    const findings = byId(r, "realtime_emit_wrong_argument_order");
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, "high");
    assert.match(findings[0].location, /server\.js:7/);
  });

  it("FIRES on the real pre-fix brawl-queue-cycle shape (commit 310e8e3a^, (room, event, payload) order)", async () => {
    dir = await tmpRepo({
      "emergent/brawl-queue-cycle.js": [
        `import { popPair } from "../lib/brawl.js";`,
        `export async function runBrawlQueueCycle({ realtimeEmit } = {}) {`,
        `  try {`,
        `    let paired = 0;`,
        `    for (let i = 0; i < 16; i++) {`,
        `      const r = popPair();`,
        `      if (!r.ok || !r.paired) break;`,
        `      paired++;`,
        `      try {`,
        `        if (typeof realtimeEmit === "function") {`,
        "          realtimeEmit(`user:${r.paired.a}`, \"brawl-invited\", {",
        `            inviteId: r.paired.inviteId,`,
        `            from: r.paired.b,`,
        `            via: "matchmaking",`,
        `          });`,
        "          realtimeEmit(`user:${r.paired.b}`, \"brawl-invited\", {",
        `            inviteId: r.paired.inviteId,`,
        `            from: r.paired.a,`,
        `            via: "matchmaking",`,
        `          });`,
        `        }`,
        `      } catch { /* best-effort emit */ }`,
        `    }`,
        `    return { ok: true, paired };`,
        `  } catch (err) { return { ok: false, error: err?.message }; }`,
        `}`,
      ].join("\n"),
    });
    const r = await runRealtimeEmitSignatureDetector({ root: dir });
    const findings = byId(r, "realtime_emit_wrong_argument_order");
    assert.equal(findings.length, 2, "both matchmaking-pair emits use the broken (room, event, payload) shape");
  });

  it("FIRES on the wrong-key-name shape ({ targetUserId } instead of { userId })", async () => {
    dir = await tmpRepo({
      "server.js": [
        `app.post("/api/mail/send", requireAuth(), asyncHandler(async (req, res) => {`,
        `  const r = sendMail(db, fromUserId, req.body);`,
        `  if (r.ok) {`,
        `    try {`,
        `      realtimeEmit?.("mail:received", { id: r.id, fromUserId, subject: req.body?.subject }, { targetUserId: req.body?.toUserId });`,
        `    } catch { /* emit best-effort */ }`,
        `  }`,
        `  res.json(r);`,
        `}));`,
      ].join("\n"),
    });
    const r = await runRealtimeEmitSignatureDetector({ root: dir });
    const findings = byId(r, "realtime_emit_wrong_key_name");
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, "high");
    assert.equal(findings[0].evidence.badKey, "targetUserId");
    assert.equal(findings[0].evidence.goodKey, "userId");
    // Correct-shape rule should NOT also fire — the event-name arg is fine.
    assert.equal(byId(r, "realtime_emit_wrong_argument_order").length, 0);
  });

  it("does NOT flag the ~30-callsite correct-shape population (calibration sample)", async () => {
    dir = await tmpRepo({
      "server.js": [
        `realtimeEmit?.("wardrobe:outfit-equipped", { userId, outfitId: req.params.outfitId, slots: r.slots });`,
        `realtimeEmit?.("auction:bid-placed", { auctionId: req.params.auctionId, bidderUserId: userId, amountCc: r.bid, endsAt: r.endsAt });`,
        `realtimeEmit?.("brawl-started", { opponent: userId }, { userId: r.opponent });`,
        `realtimeEmit?.("brawl-started", { opponent: r.opponent }, { userId });`,
        `realtimeEmit?.("climbing:route-completed", { userId, routeId: r.id });`,
        `realtimeEmit?.("world:marker-placed", { id: r.id, worldId: r.worldId, kind: r.kind, label: r.label, x: r.x, z: r.z, placedBy: userId });`,
        `realtimeEmit?.("party:member-joined", { partyId: r.partyId, userId });`,
        `realtimeEmit?.("world:drift-alert", { kind, severity, summary, worldId, ts: Date.now() });`,
        "realtimeEmit?.(`world:${worldId}:district:${districtId}:ambient`, { id: r.id, userId, body: r.body });",
        `realtimeEmit("quest:completed", payload);`,
        `globalThis.realtimeEmit(event, data);`,
        `_config?.realtimeEmit?.(msg.event, { ...msg.payload, worldId });`,
      ].join("\n"),
      "lib/faction-war.js": [
        `realtimeEmit?.("faction-war:kill", { warId: war.warId, npcId: npc.id, faction: side === "a" ? war.sideA : war.sideB });`,
      ].join("\n"),
    });
    const r = await runRealtimeEmitSignatureDetector({ root: dir });
    const real = r.findings.filter((f) => f.severity !== "info");
    assert.equal(real.length, 0, `calibration sample must not be flagged, got: ${JSON.stringify(real.map((f) => ({ id: f.id, loc: f.location })))}`);
  });

  it("never throws — returns ok:true on an empty tree / non-matching files", async () => {
    dir = await tmpRepo({ "x.txt": "no code here" });
    const r = await runRealtimeEmitSignatureDetector({ root: dir });
    assert.equal(r.ok, true);
    assert.equal(r.summary.total, 1, "only the info summary finding");
  });

  it("ignores call sites living inside test/spec files", async () => {
    dir = await tmpRepo({
      "tests/foo.test.js": [
        "realtimeEmit?.(`user:${x}`, { targetUserId: y });",
      ].join("\n"),
    });
    const r = await runRealtimeEmitSignatureDetector({ root: dir });
    const real = r.findings.filter((f) => f.severity !== "info");
    assert.equal(real.length, 0);
  });
});
