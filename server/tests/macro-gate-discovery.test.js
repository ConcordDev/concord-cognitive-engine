// GB-1538 genus leg 4 (FIX-grounding-001, office ruling (i)) — the
// discovery-time gate view (macroGateFor) must agree with the enforcement
// gate (humanMacroAclDenial): an action is annotated gated exactly when
// a member would be denied. Both read the same rule lookup, so this pin
// holds the shared logic, not two copies.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { humanMacroAclDenial, macroGateFor } from "../lib/macro-acl-human-gate.js";

const ADMIN = { roles: ["admin", "owner"], scopes: ["admin", "*"] };
const OWNER = { roles: ["owner"], scopes: ["*"] };
const MEMBER = { roles: ["member", "admin", "owner"], scopes: ["write", "admin", "*"] };
const PUB = { roles: ["viewer", "member", "admin", "owner"], scopes: ["read", "write", "admin", "*"] };

function maps() {
  const macroAcl = new Map([
    ["grounding.approve_action", ADMIN],
    ["goals.approve", OWNER],
    ["llm.local", ADMIN], // admin-tagged but member-usable (allowlist)
    ["open.thing", PUB],
    ["member.thing", MEMBER],
  ]);
  const macroAclDomain = new Map([
    ["admindomain", ADMIN],
    ["memberdomain", MEMBER],
  ]);
  return { macroAcl, macroAclDomain };
}

const memberCtx = { actor: { userId: "u1", role: "member", scopes: ["read", "write"] } };
const adminCtx = { actor: { userId: "u2", role: "admin", scopes: ["read", "write"] } };

describe("macroGateFor — discovery annotation agrees with the human gate", () => {
  it("per-macro admin rule is gated (the grounding.approve_action case)", () => {
    const { macroAcl, macroAclDomain } = maps();
    assert.deepEqual(
      macroGateFor({ domain: "grounding", name: "approve_action", macroAcl, macroAclDomain }),
      { requiresRole: "admin" },
    );
    assert.equal(humanMacroAclDenial({ ctx: memberCtx, domain: "grounding", name: "approve_action", macroAcl, macroAclDomain })?.code, "admin_only");
    assert.equal(humanMacroAclDenial({ ctx: adminCtx, domain: "grounding", name: "approve_action", macroAcl, macroAclDomain }), null);
  });

  it("owner-tier rules report requiresRole admin (admin-satisfiable by design)", () => {
    const { macroAcl, macroAclDomain } = maps();
    assert.deepEqual(
      macroGateFor({ domain: "goals", name: "approve", macroAcl, macroAclDomain }),
      { requiresRole: "admin" },
    );
  });

  it("domain-tier admin rule gates every macro in the domain", () => {
    const { macroAcl, macroAclDomain } = maps();
    assert.deepEqual(
      macroGateFor({ domain: "admindomain", name: "anything", macroAcl, macroAclDomain }),
      { requiresRole: "admin" },
    );
  });

  it("member and public rules are not gated", () => {
    const { macroAcl, macroAclDomain } = maps();
    assert.equal(macroGateFor({ domain: "open", name: "thing", macroAcl, macroAclDomain }), null);
    assert.equal(macroGateFor({ domain: "member", name: "thing", macroAcl, macroAclDomain }), null);
    assert.equal(macroGateFor({ domain: "memberdomain", name: "anything", macroAcl, macroAclDomain }), null);
  });

  it("member-usable allowlist and self-scoped names are not gated", () => {
    const { macroAcl, macroAclDomain } = maps();
    assert.equal(macroGateFor({ domain: "llm", name: "local", macroAcl, macroAclDomain }), null);
    assert.equal(macroGateFor({ domain: "admindomain", name: "list_mine", macroAcl, macroAclDomain }), null);
    assert.equal(macroGateFor({ domain: "admindomain", name: "recent_mine", macroAcl, macroAclDomain }), null);
  });

  it("no rule at all is not gated (default-allow unchanged)", () => {
    const { macroAcl, macroAclDomain } = maps();
    assert.equal(macroGateFor({ domain: "nowhere", name: "nothing", macroAcl, macroAclDomain }), null);
    assert.equal(humanMacroAclDenial({ ctx: memberCtx, domain: "nowhere", name: "nothing", macroAcl, macroAclDomain }), null);
  });
});
