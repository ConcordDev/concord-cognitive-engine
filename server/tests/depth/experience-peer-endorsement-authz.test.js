// tests/depth/experience-peer-endorsement-authz.test.js
//
// Closes docs/WAVE4_INVENTORY.md's "experience" row: "True peer endorsement
// needs a public-portfolio directory that doesn't exist" / "only
// self-endorsement is currently reachable" (see
// docs/lens-specs/experience-capability-map.md).
//
// The generic cross-lens artifact layer (server.js's `LENS_SOCIAL_DOMAINS` +
// `_lensArtifactVisible`, ~server.js:38731-38749) ALREADY let any caller act
// on another user's *published* artifact via `lens.run` for a non-social
// domain like "experience" — that infrastructure needed no changes. What was
// actually missing: (a) a peer-only guard on the `endorse` macro itself
// (visibility alone doesn't stop a caller from endorsing their OWN portfolio
// — nothing distinguished "I can act on this" from "I am a genuine peer"),
// and (b) a frontend directory to discover other users' published
// portfolios (concord-frontend/components/experience/CareerPortfolio.tsx).
// This file pins the backend half: the new self-endorsement guard, and that
// the pre-existing visibility gate genuinely still blocks a non-owner from
// reaching a PRIVATE (unpublished) portfolio at all — confirmed here, not
// assumed.
//
// Uses the lightweight `ctxFor` pattern from tests/lens-artifact-authz.test.js
// (a plain `{ actor: { userId, role } }`, NOT the `depthCtx`/`makeInternalCtx`
// helper) because `makeInternalCtx` hardcodes `role: "owner"` on every actor,
// which trips `_lensIsAdminActor`'s admin bypass and would silently make
// every internal ctx "visible" regardless of real ownership — the wrong tool
// for an authz test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { load } from "./_harness.js";

test("experience — peer endorsement authz (self-endorsement guard + visibility gate)", async (t) => {
  const { runMacro, STATE } = await load();

  function ctxFor(userId, role = "member") {
    return { actor: { userId, role }, userId };
  }

  const OWNER = "exp-peer-owner";
  const PEER = "exp-peer-other";

  function makePortfolio({ visibility = "published" } = {}) {
    const id = `exp-portfolio-${randomUUID()}`;
    STATE.lensArtifacts.set(id, {
      id, domain: "experience", type: "portfolio",
      ownerId: OWNER, createdBy: OWNER,
      title: "Owner's Portfolio",
      data: {
        skills: [{ id: "mixing", name: "Mixing", category: "technical", level: "advanced", yearsExperience: 4, evidence: [] }],
        experience: [], education: [], endorsements: [], snapshots: [],
      },
      meta: { visibility },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
    });
    return id;
  }

  await t.test("self-endorsement is rejected even though the owner can always act on their own artifact", async () => {
    const id = makePortfolio({ visibility: "published" });
    const r = await runMacro("lens", "run", { id, action: "endorse", params: { skillId: "mixing", comment: "nice" } }, ctxFor(OWNER));
    // lens.run itself succeeds (the owner CAN reach the handler) — the
    // rejection is the handler's own business-rule verdict.
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.result.ok, false);
    assert.equal(r.result.error, "cannot_self_endorse");
    // No endorsement was actually appended.
    assert.equal((STATE.lensArtifacts.get(id).data.endorsements || []).length, 0);
  });

  await t.test("a genuine peer endorsement succeeds against a published portfolio", async () => {
    const id = makePortfolio({ visibility: "published" });
    const r = await runMacro("lens", "run", { id, action: "endorse", params: { skillId: "mixing", comment: "Great ears" } }, ctxFor(PEER));
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.result.ok, true);
    assert.equal(r.result.endorsement.skillId, "mixing");
    assert.equal(r.result.endorsement.endorserId, PEER);
    const stored = STATE.lensArtifacts.get(id).data.endorsements;
    assert.equal(stored.length, 1);
    assert.equal(stored[0].endorserId, PEER);
  });

  await t.test("meta.visibility === 'public' also counts as a genuine peer target (same rule as 'published')", async () => {
    const id = makePortfolio({ visibility: "public" });
    const r = await runMacro("lens", "run", { id, action: "endorse", params: { skillId: "mixing" } }, ctxFor(PEER));
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.result.ok, true);
  });

  await t.test("an UNPUBLISHED (private) portfolio stays invisible to another user — the pre-existing visibility gate, not assumed", async () => {
    const id = makePortfolio({ visibility: "private" });

    // lens.get: the read-side gate the whole visibility rule is built on.
    const getR = await runMacro("lens", "get", { id, domain: "experience" }, ctxFor(PEER));
    assert.equal(getR.ok, false, "a private portfolio must not be readable by a non-owner");

    // lens.list: a private portfolio must not appear in another user's list.
    const listR = await runMacro("lens", "list", { domain: "experience", type: "portfolio", limit: 50 }, ctxFor(PEER));
    assert.equal(listR.ok, true);
    assert.ok(!listR.artifacts.some(a => a.id === id), "private portfolio leaked into a non-owner's directory listing");

    // lens.run: the actual endorse attempt must also be blocked (IDOR-style
    // check) — the caller must not even be able to tell the artifact exists.
    const runR = await runMacro("lens", "run", { id, action: "endorse", params: { skillId: "mixing" } }, ctxFor(PEER));
    assert.equal(runR.ok, false, "endorse must not be reachable against a private, unpublished portfolio");
    assert.equal((STATE.lensArtifacts.get(id).data.endorsements || []).length, 0);

    // Sanity: the owner themself can still see/list it (self-endorsement is
    // separately blocked above, but visibility for the owner is unaffected).
    const ownerGetR = await runMacro("lens", "get", { id, domain: "experience" }, ctxFor(OWNER));
    assert.equal(ownerGetR.ok, true);
  });

  await t.test("a default (no meta at all) portfolio is treated as private, not accidentally open", async () => {
    const id = `exp-portfolio-nometa-${randomUUID()}`;
    STATE.lensArtifacts.set(id, {
      id, domain: "experience", type: "portfolio",
      ownerId: OWNER, createdBy: OWNER,
      title: "No meta yet",
      data: { skills: [{ id: "mixing", name: "Mixing" }], experience: [], education: [], endorsements: [], snapshots: [] },
    });
    const r = await runMacro("lens", "run", { id, action: "endorse", params: { skillId: "mixing" } }, ctxFor(PEER));
    assert.equal(r.ok, false, "a portfolio with no meta.visibility must default to private, not public");
  });
});
