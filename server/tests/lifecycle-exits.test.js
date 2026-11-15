// Audit sweep CB-0475 — absent lifecycle exits. Records that could be
// created but never edited / renamed / deleted / archived / cancelled
// gain the exit their domain's substrate already implies:
//   deity.retire · fork watch-update · history timeline-update ·
//   ocean spot-update · sports game-update · legacy updateCodebase +
//   rescanCodebase · agents updateSchedule · inheritance
//   delete_will_version · insurance esign-void + esign-delete.
// Every verb is owner-scoped like its siblings; refusals are pinned.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerDeitiesActions from "../domains/deities.js";
import registerForkActions from "../domains/fork.js";
import registerHistoryActions from "../domains/history.js";
import registerOceanActions from "../domains/ocean.js";
import registerSportsActions from "../domains/sports.js";
import registerLegacyActions from "../domains/legacy.js";
import registerAgentsActions from "../domains/agents.js";
import registerInheritanceActions from "../domains/inheritance.js";
import registerInsuranceActions from "../domains/insurance.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  ACTIONS.set(`${domain}:${name}`, fn);
}
async function call(domain, name, ctx, input = {}) {
  const fn = ACTIONS.get(`${domain}:${name}`);
  if (!fn) throw new Error(`${domain}.${name} not registered`);
  const virtualArtifact = { id: null, domain, type: "domain_action", data: input || {}, meta: {} };
  return await fn(ctx, virtualArtifact, input || {});
}

before(() => {
  registerDeitiesActions(registerLensAction);
  registerForkActions(registerLensAction);
  registerHistoryActions(registerLensAction);
  registerOceanActions(registerLensAction);
  registerSportsActions(registerLensAction);
  registerLegacyActions(registerLensAction);
  registerAgentsActions(registerLensAction);
  registerInheritanceActions(registerLensAction);
  registerInsuranceActions(registerLensAction);
});
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "user_a" } };
const ctxB = { actor: { userId: "user_b" } };

describe("deity retire (FIX-deities-001)", () => {
  it("author retires; the deity leaves list/search and others' detail", async () => {
    const c = await call("deity", "compose", ctxA, { name: "QA Deity" });
    assert.equal(c.ok, true);
    const id = c.result.deityId;

    const byOther = await call("deity", "retire", ctxB, { deityId: id });
    assert.equal(byOther.ok, false);
    assert.match(byOther.error, /only the author/);

    const r = await call("deity", "retire", ctxA, { deityId: id });
    assert.equal(r.ok, true);
    assert.equal(r.result.deity.retired, true);

    const list = await call("deity", "list", ctxA, {});
    assert.equal(list.result.deities.some((d) => d.id === id), false);
    const search = await call("deity", "search", ctxA, { query: "QA Deity" });
    assert.equal(search.result.deities.some((d) => d.id === id), false);

    const detailOther = await call("deity", "detail", ctxB, { deityId: id });
    assert.equal(detailOther.ok, false);
    const detailAuthor = await call("deity", "detail", ctxA, { deityId: id });
    assert.equal(detailAuthor.ok, true);
    assert.equal(detailAuthor.result.deity.retired, true);

    const again = await call("deity", "retire", ctxA, { deityId: id });
    assert.equal(again.ok, false);
    assert.match(again.error, /already retired/);
  });
});

describe("fork watch-update (FIX-fork-002)", () => {
  it("edits category + note on the owner's entry only", async () => {
    const add = await call("fork", "watch-add", ctxA, { fullName: "octo/repo", reason: "reference", note: "first" });
    assert.equal(add.ok, true);
    const id = add.result.repo.id;

    const bad = await call("fork", "watch-update", ctxA, { id, reason: "bogus" });
    assert.equal(bad.ok, false);

    const upd = await call("fork", "watch-update", ctxA, { id, reason: "competitor", note: "renamed fixture" });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.repo.reason, "competitor");
    assert.equal(upd.result.repo.note, "renamed fixture");

    const byOther = await call("fork", "watch-update", ctxB, { id, note: "hijack" });
    assert.equal(byOther.ok, false);
    const list = await call("fork", "watch-list", ctxA, {});
    assert.equal(list.result.repos[0].note, "renamed fixture");
  });
});

describe("history timeline-update (FIX-history-005)", () => {
  it("renames with create's duplicate rule, excluding self", async () => {
    const t1 = await call("history", "timeline-create", ctxA, { title: "Imported: Rome" });
    const t2 = await call("history", "timeline-create", ctxA, { title: "Imported: Egypt" });
    assert.equal(t1.ok, true); assert.equal(t2.ok, true);

    const dup = await call("history", "timeline-update", ctxA, { id: t2.result.timeline.id, title: "Imported: Rome" });
    assert.equal(dup.ok, false);
    assert.equal(dup.error, "duplicate_title");

    const self = await call("history", "timeline-update", ctxA, { id: t2.result.timeline.id, title: "Imported: Egypt" });
    assert.equal(self.ok, true);

    const ok = await call("history", "timeline-update", ctxA, { id: t2.result.timeline.id, title: "Egypt, annotated" });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.timeline.title, "Egypt, annotated");

    const missing = await call("history", "timeline-update", ctxA, { id: "tl_nope", title: "X" });
    assert.equal(missing.ok, false);
  });
});

describe("ocean spot-update (FIX-ocean-002)", () => {
  it("edits name/notes with spot-add's validation, owner only", async () => {
    const add = await call("ocean", "spot-add", ctxA, { name: "Old Break", notes: "rocky" });
    assert.equal(add.ok, true);
    const id = add.result.spot.id;

    const blank = await call("ocean", "spot-update", ctxA, { id, name: "  " });
    assert.equal(blank.ok, false);

    const upd = await call("ocean", "spot-update", ctxA, { id, name: "New Break", notes: "sandy" });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.spot.name, "New Break");
    assert.equal(upd.result.spot.notes, "sandy");

    const byOther = await call("ocean", "spot-update", ctxB, { id, name: "Theirs" });
    assert.equal(byOther.ok, false);
  });
});

describe("sports game-update (FIX-sports-002)", () => {
  it("edits the fixture; scores stay with game-update-score", async () => {
    const add = await call("sports", "game-add", ctxA, { homeTeam: "Home FC", awayTeam: "Away FC", league: "general", homeScore: 3, awayScore: 1 });
    assert.equal(add.ok, true);
    const id = add.result.game.id;

    const upd = await call("sports", "game-update", ctxA, { id, homeTeam: "Home United", league: "Premier" });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.game.homeTeam, "Home United");
    assert.equal(upd.result.game.league, "premier");
    assert.equal(upd.result.game.homeScore, 3);
    assert.equal(upd.result.game.awayScore, 1);

    const byOther = await call("sports", "game-update", ctxB, { id, homeTeam: "Nope" });
    assert.equal(byOther.ok, false);
  });
});

describe("legacy updateCodebase + rescanCodebase (FIX-legacy-002)", () => {
  it("renames, and rescans in place (same id, recomputed summary)", async () => {
    const scan = await call("legacy", "scanCodebase", ctxA, {
      name: "old-name",
      files: [{ path: "a.cob", content: "IDENTIFICATION DIVISION.\nPROGRAM-ID. X." }],
    });
    assert.equal(scan.ok, true);
    const id = scan.result.codebase.id;
    const before = scan.result.codebase.summary.totalLinesOfCode;

    const ren = await call("legacy", "updateCodebase", ctxA, { id, name: "renamed-codebase" });
    assert.equal(ren.ok, true);
    assert.equal(ren.result.codebase.name, "renamed-codebase");

    const empty = await call("legacy", "rescanCodebase", ctxA, { id, files: [] });
    assert.equal(empty.ok, false);

    const re = await call("legacy", "rescanCodebase", ctxA, {
      id,
      files: [
        { path: "a.cob", content: "IDENTIFICATION DIVISION.\nPROGRAM-ID. X." },
        { path: "b.js", content: "const a = 1;\nconst b = 2;\nconst c = 3;" },
      ],
    });
    assert.equal(re.ok, true);
    assert.equal(re.result.codebase.id, id);
    assert.equal(re.result.codebase.name, "renamed-codebase");
    assert.equal(re.result.codebase.summary.fileCount, 2);
    assert.notEqual(re.result.codebase.summary.totalLinesOfCode, before);

    const list = await call("legacy", "listCodebases", ctxA, {});
    assert.equal(list.result.count, 1);
    assert.equal(list.result.codebases[0].name, "renamed-codebase");
  });
});

describe("agents updateSchedule (FIX-society-002)", () => {
  it("edits goal/spec with createSchedule's validation, owner only", async () => {
    const c = await call("agents", "createSchedule", ctxA, { agentId: "agent-1", kind: "interval", spec: "60000", goal: "old goal" });
    assert.equal(c.ok, true);
    const id = c.result.schedule.id;

    const badSpec = await call("agents", "updateSchedule", ctxA, { id, spec: "not-a-number" });
    assert.equal(badSpec.ok, false);
    assert.equal(badSpec.error, "invalid_input");

    const upd = await call("agents", "updateSchedule", ctxA, { id, spec: "120000", goal: "new goal", agentName: "Renamed Agent" });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.schedule.spec, "120000");
    assert.equal(upd.result.schedule.goal, "new goal");
    assert.equal(upd.result.schedule.agentName, "Renamed Agent");
    assert.equal(upd.result.schedule.fireCount, 0);

    const byOther = await call("agents", "updateSchedule", ctxB, { id, goal: "hijack" });
    assert.equal(byOther.ok, false);
  });
});

describe("inheritance delete_will_version (FIX-inheritance-008)", () => {
  it("refuses the active version; tombstones drafts without reusing numbers", async () => {
    await call("inheritance", "author_will", ctxA, { title: "Will one", body: "body one" });
    await call("inheritance", "author_will", ctxA, { title: "Will two", body: "body two" });

    const active = await call("inheritance", "delete_will_version", ctxA, { version: 2 });
    assert.equal(active.ok, false);
    assert.equal(active.error, "cannot_delete_active_version");

    const del = await call("inheritance", "delete_will_version", ctxA, { version: 1 });
    assert.equal(del.ok, true);

    const list = await call("inheritance", "list_will_versions", ctxA, {});
    assert.deepEqual(list.result.versions.map((w) => w.version), [2]);
    const get = await call("inheritance", "get_will_version", ctxA, { version: 1 });
    assert.equal(get.ok, false);
    assert.equal(get.error, "version_not_found");

    // The tombstone keeps the slot: the next authored will is v3, never
    // a reused v2 colliding with the active will.
    const third = await call("inheritance", "author_will", ctxA, { title: "Will three", body: "body three" });
    assert.equal(third.result.version, 3);
  });
});

describe("insurance esign-void + esign-delete (FIX-insurance-012)", () => {
  it("voids an in-flight envelope; signing then refuses; delete removes the voided row", async () => {
    const c = await call("insurance", "esign-create", ctxA, { title: "Application", signers: [{ name: "Ann" }] });
    assert.equal(c.ok, true, JSON.stringify(c));
    const id = c.result.envelope.id;

    const delEarly = await call("insurance", "esign-delete", ctxA, { id });
    assert.equal(delEarly.ok, false);

    const v = await call("insurance", "esign-void", ctxA, { id });
    assert.equal(v.ok, true);
    assert.equal(v.result.status, "voided");

    const sign = await call("insurance", "esign-sign", ctxA, { id, signerName: "Ann" });
    assert.equal(sign.ok, false);
    assert.match(sign.error, /voided/);

    const del = await call("insurance", "esign-delete", ctxA, { id });
    assert.equal(del.ok, true);
    const list = await call("insurance", "esign-list", ctxA, {});
    assert.equal(list.result.envelopes.some((e) => e.id === id), false);
  });

  it("a completed envelope can be neither voided nor deleted", async () => {
    const c = await call("insurance", "esign-create", ctxA, { title: "Bound", signers: [{ name: "Bo" }] });
    const id = c.result.envelope.id;
    const sign = await call("insurance", "esign-sign", ctxA, { id, signerName: "Bo" });
    assert.equal(sign.ok, true);
    assert.equal(sign.result.status, "completed");

    const v = await call("insurance", "esign-void", ctxA, { id });
    assert.equal(v.ok, false);
    const del = await call("insurance", "esign-delete", ctxA, { id });
    assert.equal(del.ok, false);
  });
});
