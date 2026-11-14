// FIX-meditation-001 + FIX-wellness-001 — the held export pair, built
// under the founder-office lens-export ruling of 2026-11-14: the export
// contract is OWNER-SCOPED. Pins:
//   - a system DTU stamped only via `author` (the narrow owner chain in
//     dtuBelongsInLensExport never read it) no longer rides — the
//     meditation walker's 169 'system' rows, one carrying another
//     tester's goal text;
//   - other users' public DTUs/artifacts no longer ride (wellness:
//     74 of 90 exported records were global public rows);
//   - leg 2: the caller's minted meditation DTU exports WITH its
//     journal text (meta.session.journal) — the export row's data
//     previously dropped meta entirely, so the journal was missing
//     from the user's own export.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { collectLensExport, dtuBelongsInLensExport } from "../lib/lens-export.js";

const CALLER = "qa_user";
const OTHER = "tester_two";

function fakeRunMacroFactory({ artifacts = [], dtus = [] }) {
  return async (domain, action) => {
    if (domain === "lens" && action === "list") return { ok: true, artifacts, total: artifacts.length };
    if (domain === "dtu" && action === "list") return { ok: true, dtus };
    return { ok: false, error: "unexpected_macro" };
  };
}

beforeEach(() => { globalThis._concordSTATE = {}; });

describe("FIX-meditation-001 / FIX-wellness-001 — owner-scoped lens export", () => {
  it("a system DTU stamped only via author does not ride (dtuBelongsInLensExport chain)", () => {
    const systemGoal = {
      id: "dtu_sys_goal", title: "Lens:goals delete goal", domain: "meditation",
      author: "system", content: "delete goal \"morning pages\" in goals lens",
    };
    assert.equal(dtuBelongsInLensExport(systemGoal, "meditation", CALLER), false);
    const otherStamped = { id: "dtu_other", title: "Note", domain: "meditation", createdBy: OTHER };
    assert.equal(dtuBelongsInLensExport(otherStamped, "meditation", CALLER), false);
    const mine = { id: "dtu_mine", title: "My note", domain: "meditation", author: CALLER };
    assert.equal(dtuBelongsInLensExport(mine, "meditation", CALLER), true);
  });

  it("the meditation export holds only the caller's rows — no system rows, no leaked goal text", async () => {
    const runMacro = fakeRunMacroFactory({
      artifacts: [
        { id: "med_own", type: "note", title: "My sit notes", ownerId: CALLER, meta: { visibility: "private" } },
        { id: "med_sys", type: "regular", title: "Lens:goals delete goal", ownerId: "system", meta: { visibility: "public", createdFrom: "dtu-auto-sync" }, data: { summary: "delete goal \"morning pages\"" } },
      ],
      dtus: [
        { id: "dtu_sys2", title: "MEGA analogy pack", domain: "meditation", author: "system", content: "analogy" },
        { id: "dtu_mine_journal", title: "Meditation — Dawn sit (10m, calm)", domain: "meditation", author: CALLER, source: "meditation:session", tags: ["meditation"], meta: { visibility: "private", session: { journal: "felt steady, knees hurt", minutes: 10, goal: "calm" } } },
      ],
    });
    const out = await collectLensExport({ runMacro, domain: "meditation", ctx: { actor: { userId: CALLER } } });
    assert.equal(out.ok, true);
    const ids = out.artifacts.map((r) => r.id);
    assert.ok(ids.includes("med_own"));
    assert.ok(ids.includes("dtu_mine_journal"));
    assert.ok(!ids.includes("med_sys") && !ids.includes("dtu_sys2"), "system rows must not ride");
    const serialized = JSON.stringify(out.artifacts);
    assert.ok(!serialized.includes("morning pages"), "another tester's goal text must not appear");
    // Leg 2: the journal text is IN the user's own export.
    assert.ok(serialized.includes("felt steady, knees hurt"), "the caller's journal text must appear in their export");
  });

  it("the wellness shape: other users' public rows stay out, the caller's own ride", async () => {
    const runMacro = fakeRunMacroFactory({
      artifacts: [
        { id: "wel_mine", type: "entry", title: "My check-in", ownerId: CALLER, meta: { visibility: "private" } },
        { id: "wel_other_public", type: "entry", title: "Global streak post", ownerId: OTHER, meta: { visibility: "public" } },
        { id: "wel_catalog", type: "entry", title: "Program template", ownerId: null, meta: { visibility: "public" } },
      ],
      dtus: [],
    });
    const out = await collectLensExport({ runMacro, domain: "wellness", ctx: { actor: { userId: CALLER } } });
    assert.deepEqual(out.artifacts.map((r) => r.id), ["wel_mine"]);
  });
});

describe("D6 rider — ownerless DTUs fall on the DTU leg too (CB-0594 call)", () => {
  it("an ownerless domain-matching DTU does not ride a personal export", async () => {
    assert.equal(
      dtuBelongsInLensExport({ id: "dtu_ownerless", title: "Feed article", domain: "research" }, "research", CALLER),
      false,
    );
    const runMacro = fakeRunMacroFactory({
      artifacts: [],
      dtus: [
        { id: "dtu_ownerless", title: "Feed article", domain: "research", content: "wire copy" },
        { id: "dtu_owned", title: "My clipping", domain: "research", ownerId: CALLER, content: "mine" },
      ],
    });
    const out = await collectLensExport({ runMacro, domain: "research", ctx: { actor: { userId: CALLER } } });
    assert.deepEqual(out.artifacts.map((r) => r.id), ["dtu_owned"]);
  });
});
