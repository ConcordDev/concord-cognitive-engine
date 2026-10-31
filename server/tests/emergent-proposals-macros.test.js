// Q40 review HOLD — the emergent proposal macros through the live runMacro.
//
// lens.emergentAction used to accept emergentId/artifactId/action/params
// from any signed-in caller and (since Q40) persist every mutating call as
// a governance proposal. It is now internal-only, and an emergent actor's
// own id wins over input.emergentId. lens.decideProposal refuses emergent
// and internal actors (emergent execution runs as role "owner"), and says
// plainly that approval does not auto-apply yet.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { macroRuntime } from "./depth/_harness.js";

describe("emergent proposal macros", () => {
  let runMacro, STATE, ctx;

  before(async () => {
    ({ runMacro, STATE, ctx } = await macroRuntime("emergent-proposals"));
    STATE.lensArtifacts.set("art_q40", { id: "art_q40", domain: "whiteboard", type: "board", title: "Q40 board", ownerId: "someone_else" });
  });

  const pendingCount = () => Array.from(STATE.emergentLensProposals.values()).filter((p) => p.status === "pending").length;
  // In-process ctxs (no reqMeta): a ctx carrying reqMeta is dispatched to
  // the macro worker pool, which has no STATE snapshot in this harness.
  const memberCtx = () => ({ actor: { userId: "u_member_q40", role: "member", scopes: ["read", "write"] }, state: STATE });

  it("a signed-in member (non-internal) cannot file a proposal", async () => {
    const before = pendingCount();
    const r = await runMacro("emergent", "lens.emergentAction", { emergentId: "em_victim", artifactId: "art_q40", action: "delete", params: { hard: true } }, memberCtx());
    assert.equal(r?.ok, false, JSON.stringify(r));
    assert.equal(r.error, "internal_only");
    assert.equal(pendingCount(), before, "no proposal persisted");
  });

  it("an owner-role human is not internal either", async () => {
    const r = await runMacro("emergent", "lens.emergentAction", { emergentId: "em_x", artifactId: "art_q40", action: "delete" }, { actor: { userId: "u_owner_q40", role: "owner", scopes: ["*"] }, state: STATE });
    assert.equal(r?.error, "internal_only");
  });

  it("an internal emergent caller files under its OWN id, whatever input.emergentId says", async () => {
    const emCtx = { ...ctx, actor: { ...ctx.actor, userId: "emergent:em_real" } };
    const r = await runMacro("emergent", "lens.emergentAction", { emergentId: "em_spoofed", artifactId: "art_q40", action: "delete", params: { hard: true } }, emCtx);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.requiresGovernance, true);
    const p = STATE.emergentLensProposals.get(r.proposalId);
    assert.equal(p.emergentId, "em_real");
    assert.equal(p.submittedBy, "emergent:em_real");
  });

  it("decide refuses an emergent/internal actor and honestly reports apply is not live for a human", async () => {
    const emCtx = { ...ctx, actor: { ...ctx.actor, userId: "emergent:em_real" } };
    const filed = await runMacro("emergent", "lens.emergentAction", { artifactId: "art_q40", action: "update", params: { title: "x" } }, emCtx);
    assert.equal(filed.ok, true, JSON.stringify(filed));
    const byEmergent = await runMacro("emergent", "lens.decideProposal", { proposalId: filed.proposalId, decision: "approved" }, emCtx);
    assert.equal(byEmergent.error, "emergent_cannot_decide");
    const byInternal = await runMacro("emergent", "lens.decideProposal", { proposalId: filed.proposalId, decision: "approved" }, ctx);
    assert.equal(byInternal.error, "emergent_cannot_decide");
    assert.equal(STATE.emergentLensProposals.get(filed.proposalId).status, "pending");
    const founder = { actor: { userId: "u_founder_q40", role: "founder", scopes: ["*"] }, state: STATE };
    const byHuman = await runMacro("emergent", "lens.decideProposal", { proposalId: filed.proposalId, decision: "approved" }, founder);
    assert.equal(byHuman.ok, true, JSON.stringify(byHuman));
    assert.equal(byHuman.proposal.status, "approved");
    assert.equal(byHuman.apply?.live, false, "approval must not pretend it applied");
  });
});
