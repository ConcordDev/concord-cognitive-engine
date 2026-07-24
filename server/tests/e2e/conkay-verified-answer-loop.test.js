/**
 * Tier-3 flagship E2E loop (R8/CL3, loop 1): "Ask ConKay → verified answer/action."
 *
 * Boots the REAL server (server/tests/depth/_harness.js's `macroRuntime`,
 * the established pattern for behavioral macro tests) and drives the actual
 * two-macro verification pipeline ConKayOverlay.tsx really calls on every
 * assistant reply (concord-frontend/components/conkay/ConKayOverlay.tsx,
 * `verifyMessage`, lines ~397 and ~424):
 *
 *   1. `reason.verify`          — deterministic citation-resolution floor
 *      (server/lib/reason-verify.js) + optional council judge.
 *   2. `reason.evaluate_answer` — RAGAS-shaped faithfulness/relevancy/
 *      context-precision scoring (server/lib/research/answer-eval.js),
 *      folding in #1's citation floor for the combined verdict.
 *
 * Both run through the live `runMacro` dispatch against the real SQL `dtus`
 * table (the same substrate `discovery.search`, `reason.verify`, and
 * `reason.evaluate_answer` all read/write) — never a hand-rolled mock of the
 * verification logic itself. No LLM/Ollama is reachable in this sandbox, so
 * every assertion below exercises the DETERMINISTIC floor (same convention
 * as reason-verify.test.js / answer-eval.test.js) — the honest, no-brains
 * behavior a real "brains offline" deploy would show, not a fabricated pass.
 *
 * REAL GAP FOUND (reported, not papered over): ConKayOverlay.tsx's real
 * `verifyMessage` call passes `retrievedDtus: dtuRefs`, where `dtuRefs` is
 * typed `Array<{ id: string; title: string | null; tier: string | null }>`
 * (ConKayOverlay.tsx line ~383) — i.e. ID + TITLE + TIER ONLY, never the
 * DTU's body/content. `answer-eval.js#normalizeContext` builds each context
 * chunk's text as `[title, text, content, data].filter(Boolean).join(" ")`
 * — so for the production shape ConKay actually sends, EVERY context chunk's
 * text is its title alone. `discovery.search`'s own result shape
 * (server/lib/cross-lens-discovery.js) has the identical limitation: it
 * returns `{ id, kind, title, creator_id, snippet, meta_summary }` — no
 * `data`/`text`/`content` field either, so even if ConKay were to retrieve
 * context via discovery.search instead of dtuRefs, the same gap would
 * recur. Net effect: `reason.evaluate_answer`'s faithfulness/context-
 * precision axes can only ever match on DTU TITLES in production, never on
 * DTU BODIES — a well-grounded answer whose supporting detail lives in a
 * DTU's `data`/`core`/`human.summary` rather than its (often short, label-
 * like) title will systematically under-score as "unverified" rather than
 * "grounded", even though the citation itself resolves correctly. This test
 * proves BOTH halves: (a) the real production dtuRefs shape currently
 * produces a real, honestly-computed but under-informative faithfulness
 * score, and (b) the underlying engine is sound — given the DTU's real body
 * content (the shape the engine's own doc comment says it expects), the
 * exact same claim correctly reaches "grounded". The gap is in what's
 * WIRED INTO the call, not in the scoring math itself.
 *
 * Run: node --test tests/e2e/conkay-verified-answer-loop.test.js
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { macroRuntime } from "../depth/_harness.js";
import { toCapabilityVerdict } from "../../lib/research/answer-eval.js";

let runMacro, STATE, ctx;

// A realistic DTU shape: a short, generic-ish TITLE (the kind real users
// actually write) whose real substantive claim lives in the BODY (`data`),
// not the title — the exact split that exposes the gap above.
const PARENT_TITLE = "Plant Biology Notes";
const PARENT_BODY  = "Photosynthesis converts light energy into chemical energy stored in glucose. Chlorophyll absorbs light in the chloroplast, and the process releases oxygen as a byproduct from splitting water molecules.";

let dtuId;

before(async () => {
  ({ runMacro, STATE, ctx } = await macroRuntime("conkay-verified-answer"));
  dtuId = `dtu_e2e_conkay_${randomUUID().slice(0, 8)}`;
  // `dtus.owner_user_id` FK-references `users(id)` — insert a real user row
  // for the internal ctx actor first (same precedent as
  // tests/dtu-props.test.js's alternative of disabling the pragma; here we
  // insert the row instead since STATE.db is the shared live server DB).
  STATE.db.prepare(`
    INSERT OR IGNORE INTO users (id, username, email, password_hash, created_at)
    VALUES (?, ?, ?, 'x', datetime('now'))
  `).run(ctx.actor.userId, ctx.actor.userId, `${ctx.actor.userId}@e2e.test`);
  // Insert directly into the REAL SQL `dtus` table — the same substrate
  // discovery.search / reason.verify / reason.evaluate_answer all query
  // (distinct from the in-memory STATE.dtus Map the `dtu.*` macro family
  // uses — see CLAUDE.md's DTU-substrate notes). `visibility: 'public'` so
  // it resolves for any requester, matching how a real published DTU reads.
  STATE.db.prepare(`
    INSERT INTO dtus (id, owner_user_id, creator_id, title, body_json, data, tags_json, visibility, tier, type, created_at, updated_at)
    VALUES (?, ?, ?, ?, '{}', ?, '[]', 'public', 'regular', 'note', datetime('now'), datetime('now'))
  `).run(dtuId, ctx.actor.userId, ctx.actor.userId, PARENT_TITLE, PARENT_BODY);
});

describe("Ask ConKay E2E loop — Stage 1: reason.verify (citation-resolution floor)", () => {
  it("a real cited DTU resolves via the live macro dispatch — citations_resolve, not fabricated", async () => {
    const r = await runMacro("reason", "verify", {
      claim: "Photosynthesis converts light energy into chemical energy.",
      citations: [dtuId],
      useCouncil: false, // no brains reachable in this sandbox — honest deterministic floor
      useProof: false,
    }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.verdict, "citations_resolve");
    assert.equal(r.allResolved, true);
    assert.equal(r.citationsResolved, 1);
  });

  it("a citation to a DTU that does not exist is caught as fabricated — the real hallucination-detection floor, not a hardcoded pass", async () => {
    const r = await runMacro("reason", "verify", {
      claim: "X",
      citations: [dtuId, "dtu_definitely_does_not_exist_e2e"],
      useCouncil: false,
      useProof: false,
    }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.verdict, "fabricated_citation");
    assert.deepEqual(r.unresolvedIds, ["dtu_definitely_does_not_exist_e2e"]);
  });
});

describe("Ask ConKay E2E loop — Stage 2: reason.evaluate_answer (RAGAS-shaped faithfulness)", () => {
  it("(the REAL production shape) dtuRefs carrying only {id,title,tier} — the answer is honestly under-verified, not fabricated 'grounded'", async () => {
    // Exactly ConKayOverlay.tsx's real `dtuRefs` shape (id/title/tier only —
    // see the `EvalAnswerResult`/dtuRefs typing referenced in the file
    // header above). The claim is TRUE and genuinely grounded by the DTU's
    // real body — but that body never reaches this macro call in production.
    const dtuRefs = [{ id: dtuId, title: PARENT_TITLE, tier: "regular" }];
    const answer = "Photosynthesis converts light energy into chemical energy stored in glucose, releasing oxygen as a byproduct.";

    const r = await runMacro("reason", "evaluate_answer", {
      answer,
      question: "How does photosynthesis work?",
      retrievedDtus: dtuRefs,
      citations: [dtuId],
    }, ctx);

    assert.equal(r.ok, true);
    assert.equal(r.mode, "deterministic");
    // The citation itself DOES resolve — that axis is unaffected by the gap.
    assert.equal(r.citation.verdict, "citations_resolve");
    // But faithfulness — computed against title-only context ("Plant Biology
    // Notes" shares almost no keyword overlap with the answer's real
    // substance) — is honestly LOW, not a fabricated high score. This is the
    // real, currently-true behavior of the wired production call.
    assert.ok(r.faithfulness < 0.9,
      `expected an honestly under-informative faithfulness score with title-only context, got ${r.faithfulness}`);
    assert.notEqual(r.verdict, "grounded");

    const badge = toCapabilityVerdict(r);
    assert.equal(badge.ok, true);
    assert.notEqual(badge.verdict, "grounded",
      "CapabilityBadge would NOT show the green 'proven' tier for this real, well-grounded claim under the current dtuRefs wiring");
  });

  it("(the engine's OWN documented input shape) given the DTU's real body content, the SAME claim correctly reaches 'grounded' — the scoring math itself is sound", async () => {
    // Fetch the DTU's real row back out of the SAME live substrate (proving
    // this isn't fabricated context — it's the actual row Stage 1 verified).
    const row = STATE.db.prepare("SELECT id, title, data FROM dtus WHERE id = ?").get(dtuId);
    assert.ok(row, "the DTU created in `before` must be readable from the real dtus table");

    const retrievedDtus = [{ id: row.id, title: row.title, data: row.data }];
    const answer = "Photosynthesis converts light energy into chemical energy stored in glucose, releasing oxygen as a byproduct.";

    const r = await runMacro("reason", "evaluate_answer", {
      answer,
      question: "How does photosynthesis work?",
      retrievedDtus,
      citations: [dtuId],
    }, ctx);

    assert.equal(r.ok, true);
    assert.ok(r.faithfulness > 0.9, `expected high faithfulness once the DTU body is actually present, got ${r.faithfulness}`);
    assert.equal(r.verdict, "grounded");
    assert.equal(r.faithfulnessBreakdown.contradictedCount, 0);

    const badge = toCapabilityVerdict(r);
    assert.equal(badge.ok, true);
    assert.equal(badge.verdict, "grounded", "CapabilityBadge's green 'proven' tier — a REAL verdict derived from REAL retrieved context, never hardcoded");
  });

  it("a fabricated/contradicted claim against the SAME real DTU is flagged, not waved through", async () => {
    const row = STATE.db.prepare("SELECT id, title, data FROM dtus WHERE id = ?").get(dtuId);
    const retrievedDtus = [{ id: row.id, title: row.title, data: row.data }];
    const wrongAnswer = "Photosynthesis does not convert light energy into chemical energy, and it consumes oxygen rather than releasing it.";

    const r = await runMacro("reason", "evaluate_answer", {
      answer: wrongAnswer,
      question: "How does photosynthesis work?",
      retrievedDtus,
    }, ctx);

    assert.equal(r.ok, true);
    assert.equal(r.verdict, "contradicted");
    const badge = toCapabilityVerdict(r);
    assert.equal(badge.verdict, "refuted", "the red 'flagged' tier — real detected contradiction, not a false pass");
  });

  it("a fabricated citation id overrides even a well-grounded faithfulness score — the strongest honesty signal wins", async () => {
    const row = STATE.db.prepare("SELECT id, title, data FROM dtus WHERE id = ?").get(dtuId);
    const retrievedDtus = [{ id: row.id, title: row.title, data: row.data }];
    const answer = "Photosynthesis converts light energy into chemical energy stored in glucose.";

    const r = await runMacro("reason", "evaluate_answer", {
      answer,
      question: "How does photosynthesis work?",
      retrievedDtus,
      citations: [dtuId, "dtu_also_does_not_exist_e2e"],
    }, ctx);

    assert.equal(r.ok, true);
    assert.equal(r.citation.verdict, "fabricated_citation");
    assert.equal(r.verdict, "fabricated_citation");
    const badge = toCapabilityVerdict(r);
    assert.equal(badge.verdict, "fabricated_citation");
  });
});

describe("Ask ConKay E2E loop — Stage 3 (GAP CLOSED): discovery.search now carries real body content", () => {
  // Exercises the EXACT production call chain ConKay's "search my archive"
  // skill uses (concord-frontend/components/conkay/conkay-skills.ts's
  // `search` skill, the "prefer the semantic discovery macro" branch):
  //   ctx.runMacro('discovery', 'search', { query, mine: true, limit: 12 })
  //   -> items.map(r => ({ id, title, tier: r.kind, content: r.content }))
  //   -> dtuRefs -> verifyMessage's `retrievedDtus`.
  // Before the fix, `discovery.search`'s results carried
  // { id, kind, title, creator_id, snippet, meta_summary } — no body field —
  // so this exact mapping fed reason.evaluate_answer nothing but titles, same
  // as the dtuRefs-shape gap proven in Stage 2 above. The fix
  // (server/lib/cross-lens-discovery.js#searchDtus / extractDtuBodyText) adds
  // a real, bounded `content` field sourced from the DTU's actual `data`
  // column — this test proves that field now reaches evaluate_answer and
  // flips the verdict from under-informative to genuinely "grounded".
  it("discovery.search's real result shape includes a non-empty `content` field for a DTU whose body carries the substance", async () => {
    const r = await runMacro("discovery", "search", {
      query: "Photosynthesis",
      mine: true,
      keyword: true, // deterministic LIKE path — no embeddings reachable in this sandbox
    }, ctx);
    assert.equal(r.ok, true, `discovery.search must succeed: ${JSON.stringify(r)}`);
    const hit = r.results.find((x) => x.id === dtuId);
    assert.ok(hit, "the seeded DTU must be a real search hit");
    assert.equal(typeof hit.content, "string", "the gap-fix `content` field must be present and be real body text");
    assert.ok(hit.content.includes("Chlorophyll"), "content must be the DTU's REAL body, not a re-derivation of the title");
  });

  it("wiring discovery.search's results into reason.evaluate_answer the way ConKay's search skill does now reaches 'grounded' — not just title-only 'unverified'", async () => {
    const search = await runMacro("discovery", "search", {
      query: "Photosynthesis",
      mine: true,
      keyword: true,
    }, ctx);
    assert.equal(search.ok, true);
    const hit = search.results.find((x) => x.id === dtuId);
    assert.ok(hit);

    // The EXACT dtuRefs shape the fixed conkay-skills.ts search skill builds:
    // { id, title, tier, content } — content threaded through, not dropped.
    const dtuRefs = [{ id: hit.id, title: hit.title, tier: hit.kind, content: hit.content }];
    const answer = "Photosynthesis converts light energy into chemical energy stored in glucose, releasing oxygen as a byproduct.";

    const r = await runMacro("reason", "evaluate_answer", {
      answer,
      question: "How does photosynthesis work?",
      retrievedDtus: dtuRefs,
      citations: [dtuId],
    }, ctx);

    assert.equal(r.ok, true);
    assert.ok(r.faithfulness > 0.9, `expected high faithfulness now that discovery.search carries real content, got ${r.faithfulness}`);
    assert.equal(r.verdict, "grounded");

    const badge = toCapabilityVerdict(r);
    assert.equal(badge.verdict, "grounded", "the green 'proven' tier, reached via the real production discovery.search -> dtuRefs -> evaluate_answer chain");
  });
});
