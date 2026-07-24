// server/tests/conkay-tool-authoring.test.js
//
// First-buildable slice of docs/CONKAY_TOOL_AUTHORING_SPEC.md §7 — the
// conkay_authored_tools state machine (propose -> approve|reject -> revoke)
// and the invocation dispatcher, against a real in-memory better-sqlite3 DB
// migrated with 385 (+ 383 for org membership). Mirrors the mocking/setup
// style of tests/agent-marathon-governance.test.js (real DB, scripted
// inputs, no live brain/LLM infra needed).
//
// Run: node --test server/tests/conkay-tool-authoring.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as upMig383 } from "../migrations/383_world_organizations.js";
import { up as upMig385 } from "../migrations/385_conkay_authored_tools.js";

import { propose, listPending, getTool, approve, reject, revoke } from "../lib/conkay-tool-authoring.js";
import { invokeAuthoredTool } from "../lib/conkay-tool-invoke.js";

function setup() {
  const db = new Database(":memory:");
  upMig383(db);
  upMig385(db);
  return db;
}

function makeRunMacroSpy(handler) {
  const calls = [];
  const runMacro = async (domain, name, input, ctx) => {
    calls.push({ domain, name, input, ctx });
    return handler(domain, name, input, ctx);
  };
  runMacro.calls = calls;
  return runMacro;
}

describe("propose() — static validation gate runs BEFORE any human review", () => {
  it("dsl kind: a syntactically valid program with a clean manifest is proposed (status='proposed')", async () => {
    const db = setup();
    const r = await propose(db, "alice", {
      name: "greet-craft",
      description: "says hi via crafting.craft",
      kind: "dsl",
      source: `crafting.craft({ "greeting": "hi" })`,
      manifest: ["crafting.craft"],
    });
    assert.equal(r.ok, true);
    assert.equal(r.status, "proposed");
    assert.equal(r.staticValidation.valid, true);

    const row = getTool(db, r.id);
    assert.equal(row.status, "proposed");
    assert.equal(row.kind, "dsl");
    assert.equal(row.owner_type, "user");

    const pending = listPending(db, { ownerId: "alice" });
    assert.equal(pending.length, 1);
    assert.equal(pending[0].id, r.id);
  });

  it("dsl kind: a syntactically INVALID program is rejected at propose() time", async () => {
    const db = setup();
    const r = await propose(db, "alice", {
      name: "broken",
      kind: "dsl",
      source: `let x = ( ( (`, // unbalanced parens — parse() throws
      manifest: [],
    });
    assert.equal(r.ok, false);
    assert.equal(r.status, "rejected");
    assert.ok(r.staticValidation.errors.some((e) => e.includes("dsl_syntax")));

    // Never entered the human-review queue.
    assert.equal(listPending(db, { ownerId: "alice" }).length, 0);
    const row = getTool(db, r.id);
    assert.equal(row.status, "rejected");
    assert.equal(row.rejected_by, "system:static_validation_gate");
  });

  it("a forbidden-domain manifest ('code.*') is rejected at propose() time via the static gate, before any runtime call", async () => {
    const db = setup();
    const r = await propose(db, "alice", {
      name: "sneaky",
      kind: "dsl",
      source: `code.build({})`,
      manifest: ["code.*"],
    });
    assert.equal(r.ok, false);
    assert.equal(r.status, "rejected");
    assert.ok(
      r.staticValidation.errors.some((e) => e.includes("forbidden_domain_grant") && e.includes("code")),
      `expected a forbidden_domain_grant error, got: ${JSON.stringify(r.staticValidation.errors)}`,
    );
    assert.equal(listPending(db).length, 0);

    // Even if somehow approved by mistake, invocation would still refuse —
    // but the point of this gate is that it never gets that far. Confirm no
    // runtime call is ever attempted: invokeAuthoredTool on a rejected tool
    // must refuse purely on status, without calling runMacro at all.
    const runMacro = makeRunMacroSpy(async () => ({ ok: true }));
    const invoked = await invokeAuthoredTool(db, r.id, {}, { runMacro, callerId: "alice" });
    assert.equal(invoked.ok, false);
    assert.equal(invoked.halt, false);
    assert.match(invoked.reason, /tool_not_approved/);
    assert.equal(runMacro.calls.length, 0, "a rejected tool must never reach a runtime macro call");
  });

  it("a forbidden-domain manifest ('admin.*') is likewise rejected at propose() time", async () => {
    const db = setup();
    const r = await propose(db, "alice", {
      name: "sneaky-admin",
      kind: "dsl",
      source: `admin.doStuff({})`,
      manifest: ["admin.*"],
    });
    assert.equal(r.ok, false);
    assert.equal(r.status, "rejected");
    assert.ok(r.staticValidation.errors.some((e) => e.includes("forbidden_domain_grant") || e.includes("never_allow_grant")));
  });
});

describe("propose -> approve -> invoke happy path (dsl kind)", () => {
  it("a clean dsl tool proposed, approved by its own author (Tier 1, self-scoped), and invoked runs the composed macro call with the tool's OWN fixed manifest", async () => {
    const db = setup();
    const proposed = await propose(db, "alice", {
      name: "make-craft",
      description: "wraps crafting.craft",
      kind: "dsl",
      source: `crafting.craft({ "color": "blue" })`,
      manifest: ["crafting.craft"],
      inputSchema: { type: "object", properties: {}, required: [] },
    });
    assert.equal(proposed.ok, true);

    const approved = approve(db, proposed.id, "alice");
    assert.equal(approved.ok, true);
    assert.equal(approved.status, "approved");
    assert.equal(getTool(db, proposed.id).status, "approved");

    const runMacro = makeRunMacroSpy(async (domain, name, input) => {
      assert.equal(domain, "crafting");
      assert.equal(name, "craft");
      assert.deepEqual(input, { color: "blue" });
      return { ok: true, result: { craftedId: "w1" } };
    });

    const invoked = await invokeAuthoredTool(db, proposed.id, {}, { runMacro, callerId: "alice" });
    assert.equal(invoked.ok, true);
    assert.equal(invoked.halt, false);
    assert.equal(invoked.kind, "dsl");
    assert.deepEqual(invoked.result, { craftedId: "w1" });
    assert.equal(runMacro.calls.length, 1, "exactly one composed macro call ran");

    // The confined actor identity is the REAL caller, never a synthetic id.
    assert.equal(runMacro.calls[0].ctx.actor.userId, "alice");
  });

  it("an unapproved (still-proposed) tool cannot be invoked", async () => {
    const db = setup();
    const proposed = await propose(db, "alice", {
      name: "not-yet",
      kind: "dsl",
      source: `crafting.craft({})`,
      manifest: ["crafting.*"],
    });
    const runMacro = makeRunMacroSpy(async () => ({ ok: true }));
    const invoked = await invokeAuthoredTool(db, proposed.id, {}, { runMacro, callerId: "alice" });
    assert.equal(invoked.ok, false);
    assert.match(invoked.reason, /tool_not_approved/);
    assert.equal(runMacro.calls.length, 0);
  });

  it("a manifest grant NOT held by the tool is refused at runtime the same way code.dsl already refuses (capability_denied), proving the fixed manifest is real, not decorative", async () => {
    const db = setup();
    const proposed = await propose(db, "alice", {
      name: "narrow-grant",
      kind: "dsl",
      // "cooking" IS a real agent-readable domain (agent-guardrails.js's
      // AGENT_READ_DOMAINS) — it's just not in THIS tool's manifest below,
      // so this exercises the capability-manifest gate specifically, not
      // the separate (and stricter) agent-domain-whitelist gate.
      source: `cooking.cook({})`, // NOT in the manifest below
      manifest: ["crafting.craft"],
    });
    approve(db, proposed.id, "alice");
    const runMacro = makeRunMacroSpy(async () => ({ ok: true }));
    const invoked = await invokeAuthoredTool(db, proposed.id, {}, { runMacro, callerId: "alice" });
    assert.equal(invoked.ok, false);
    assert.equal(invoked.phase, "runtime");
    assert.match(invoked.error, /capability_denied|not granted/);
    assert.equal(runMacro.calls.length, 0, "the confined runMacro refuses before the real macro ever runs");
  });
});

describe("self-approval conflict of interest — Tier 2 (org-scoped tools)", () => {
  it("the original author CANNOT approve their own proposal once owner_type is 'org'", async () => {
    const db = setup();
    const proposed = await propose(db, "alice", {
      name: "org-tool",
      kind: "dsl",
      source: `crafting.craft({})`,
      manifest: ["crafting.craft"],
      ownerType: "org",
      ownerOrgId: "org1",
    });
    assert.equal(proposed.ok, true);

    const selfApprove = approve(db, proposed.id, "alice");
    assert.equal(selfApprove.ok, false);
    assert.equal(selfApprove.reason, "self_approval_conflict_of_interest");
    assert.equal(getTool(db, proposed.id).status, "proposed", "must remain in the review queue, not silently approved");

    const otherApprove = approve(db, proposed.id, "bob");
    assert.equal(otherApprove.ok, true);
    assert.equal(getTool(db, proposed.id).status, "approved");
  });

  it("self-approval by the author IS allowed for an ordinary owner_type:'user' (private) tool", async () => {
    const db = setup();
    const proposed = await propose(db, "alice", {
      name: "private-tool", kind: "dsl", source: `crafting.craft({})`, manifest: ["crafting.craft"],
    });
    const approved = approve(db, proposed.id, "alice");
    assert.equal(approved.ok, true);
  });

  it("an org member (not the author) can invoke an approved org-scoped tool", async () => {
    const db = setup();
    db.prepare(`INSERT INTO org_members (org_id, user_id, role, joined_at) VALUES (?, ?, 'member', datetime('now'))`)
      .run("org1", "carol");

    const proposed = await propose(db, "alice", {
      name: "org-tool-2", kind: "dsl", source: `crafting.craft({})`, manifest: ["crafting.craft"],
      ownerType: "org", ownerOrgId: "org1",
    });
    approve(db, proposed.id, "bob"); // different-reviewer approval

    const runMacro = makeRunMacroSpy(async () => ({ ok: true, result: {} }));
    const invoked = await invokeAuthoredTool(db, proposed.id, {}, { runMacro, callerId: "carol" });
    assert.equal(invoked.ok, true, "an org member should be authorized to invoke the org-scoped tool");

    const outsider = await invokeAuthoredTool(db, proposed.id, {}, { runMacro, callerId: "mallory" });
    assert.equal(outsider.ok, false);
    assert.match(outsider.reason, /tool_not_authorized/);
  });
});

describe("reject()", () => {
  it("rejects a proposed tool with a reason, and it can never be approved afterward", async () => {
    const db = setup();
    const proposed = await propose(db, "alice", { name: "x", kind: "dsl", source: `crafting.craft({})`, manifest: ["crafting.craft"] });
    const r = reject(db, proposed.id, "bob", "not needed");
    assert.equal(r.ok, true);
    assert.equal(getTool(db, proposed.id).status, "rejected");
    assert.equal(getTool(db, proposed.id).reject_reason, "not needed");

    const lateApprove = approve(db, proposed.id, "alice");
    assert.equal(lateApprove.ok, false);
    assert.equal(lateApprove.reason, "wrong_state");
  });
});

describe("revocation mid-session produces a per-call refusal, not a session-level halt", () => {
  it("an approved tool invokes successfully, then a revoke mid-session makes the VERY NEXT call refuse with halt:false (mirrors createToolGate's two-tier contract)", async () => {
    const db = setup();
    const proposed = await propose(db, "alice", {
      name: "revocable", kind: "dsl", source: `crafting.craft({})`, manifest: ["crafting.craft"],
    });
    approve(db, proposed.id, "alice");

    const runMacro = makeRunMacroSpy(async () => ({ ok: true, result: { done: true } }));

    const first = await invokeAuthoredTool(db, proposed.id, {}, { runMacro, callerId: "alice" });
    assert.equal(first.ok, true);
    assert.equal(runMacro.calls.length, 1);

    const revoked = revoke(db, proposed.id, "alice", "no longer needed");
    assert.equal(revoked.ok, true);
    assert.equal(getTool(db, proposed.id).status, "revoked");

    // The very next dispatch (simulating a mid-session revoke landing
    // between two tool calls in the same conversation/marathon) must see a
    // per-call refusal — NOT a session-level halt. Same shape as
    // agent-marathon.js#createToolGate's { ok:false, halt:false, reason }
    // contract for a domain_not_allowed refusal (never halt:true for a
    // single revoked tool — see spec §4).
    const second = await invokeAuthoredTool(db, proposed.id, {}, { runMacro, callerId: "alice" });
    assert.equal(second.ok, false);
    assert.equal(second.halt, false, "a single revoked tool must never halt the whole session");
    assert.equal(second.reason, `tool_revoked:${proposed.id}`);
    assert.equal(runMacro.calls.length, 1, "the revoked tool's macro call must never run again");
  });

  it("only the owner (or an authorized org actor) can revoke; a stranger cannot", async () => {
    const db = setup();
    const proposed = await propose(db, "alice", { name: "y", kind: "dsl", source: `crafting.craft({})`, manifest: ["crafting.craft"] });
    approve(db, proposed.id, "alice");
    const strangerRevoke = revoke(db, proposed.id, "mallory", "malicious");
    assert.equal(strangerRevoke.ok, false);
    assert.equal(strangerRevoke.reason, "not_authorized");
    assert.equal(getTool(db, proposed.id).status, "approved");
  });
});

describe("input schema validation at invocation time", () => {
  it("rejects an invocation whose input violates the tool's declared inputSchema, before dispatch", async () => {
    const db = setup();
    const proposed = await propose(db, "alice", {
      name: "schema-tool", kind: "dsl", source: `crafting.craft({})`, manifest: ["crafting.craft"],
      inputSchema: { type: "object", required: ["color"], properties: { color: { type: "string" } } },
    });
    approve(db, proposed.id, "alice");
    const runMacro = makeRunMacroSpy(async () => ({ ok: true }));

    const missing = await invokeAuthoredTool(db, proposed.id, {}, { runMacro, callerId: "alice" });
    assert.equal(missing.ok, false);
    assert.match(missing.reason, /input_schema_violation/);
    assert.equal(runMacro.calls.length, 0);

    const wrongType = await invokeAuthoredTool(db, proposed.id, { color: 5 }, { runMacro, callerId: "alice" });
    assert.equal(wrongType.ok, false);
    assert.match(wrongType.reason, /type_mismatch/);

    const ok = await invokeAuthoredTool(db, proposed.id, { color: "red" }, { runMacro, callerId: "alice" });
    assert.equal(ok.ok, true);
    assert.equal(runMacro.calls.length, 1);
  });
});
