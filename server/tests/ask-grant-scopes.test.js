// GB-1538 Ask/authz family — the ask grant (FIX-crisis-ops-001, and the
// shared root under FIX-commonsense-001 · FIX-docs-001 ·
// FIX-suffering-001).
//
// Pristine behaviour: the agent loop presented the signed-in member's
// own session actor to the MCP bridge. A member's scopes are
// ["read","write"] (makeCtx) — a non-empty set, so authorizeBridgeCall
// treated the human session as a restricted service key and demanded
// mcp:lens:read, which no human session carries: scope_denied on the
// Ask's first discovery call (list_lens_actions), on every lens. The
// /api/lens/run mapper turns scope_denied into HTTP 403 — the walked
// "nothing came back" symptom.
//
// The fix: the actor the agent loop presents carries the ask grant
// (withAskGrant — mcp:lens:read/compute/write + mcp:conkay:read/
// compute, never mcp:lens:high).
//
// Pins, failure paths first:
//   (1) the un-granted member actor is scope_denied (the pristine
//       behaviour, kept as the control) and the granted actor passes;
//   (2) listLensActionsMcp end-to-end: granted actor lists the
//       domain's actions; the raw member actor is refused; a
//       cross-tenant params userId is still refused tenant_isolation
//       under the granted actor;
//   (3) a high-risk call under the granted actor is still refused —
//       the grant does not widen to mcp:lens:high;
//   (4) the Hermes guard is unchanged: a scopeless hermes actor is
//       still refused hermes_scopes_required.
// Run: node --test server/tests/ask-grant-scopes.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  authorizeBridgeCall,
  withAskGrant,
  ASK_GRANT_SCOPES,
  BRIDGE_RISK,
  HERMES_USER_ID,
} from "../lib/mcp-hermes-identity.js";
import { listLensActionsMcp } from "../lib/mcp-execution-bridge.js";

// The actor makeCtx builds for a signed-in member (server.js).
const memberActor = { id: "user-1", userId: "user-1", role: "member", scopes: ["read", "write"] };

describe("the ask grant", () => {
  it("(1) the un-granted member actor is scope_denied; the granted actor passes", () => {
    const denied = authorizeBridgeCall({
      actor: memberActor, tool: "list_lens_actions", risk: BRIDGE_RISK.READ, domain: "crisis-ops",
    });
    assert.equal(denied.ok, false);
    assert.equal(denied.reason, "scope_denied");
    assert.equal(denied.required_scope, "mcp:lens:read");

    const granted = withAskGrant(memberActor);
    const allowed = authorizeBridgeCall({
      actor: granted, tool: "list_lens_actions", risk: BRIDGE_RISK.READ, domain: "crisis-ops",
    });
    assert.equal(allowed.ok, true);
    assert.ok(!granted.scopes.includes("mcp:lens:high"), "the grant never carries the high scope");
    assert.deepEqual([...ASK_GRANT_SCOPES].sort(), [
      "mcp:conkay:compute", "mcp:conkay:read", "mcp:lens:compute", "mcp:lens:read", "mcp:lens:write",
    ]);
  });

  it("(2) listLensActionsMcp end-to-end under the granted actor", async () => {
    const lensActions = new Map([
      ["crisis-ops.list_incidents", {}],
      ["crisis-ops.get_incident", {}],
      ["docs.list_pages", {}],
    ]);
    const ok = await listLensActionsMcp(null, { domain: "crisis-ops" }, null, {
      actor: withAskGrant(memberActor), lensActions,
    });
    assert.equal(ok.ok, true);
    assert.deepEqual(ok.actions.map((a) => a.action).sort(), ["get_incident", "list_incidents"]);

    const refused = await listLensActionsMcp(null, { domain: "crisis-ops" }, null, {
      actor: memberActor, lensActions,
    });
    assert.equal(refused.ok, false);
    assert.equal(refused.reason, "scope_denied");

    const crossTenant = await listLensActionsMcp(null, {
      domain: "crisis-ops", params: { userId: "someone-else" },
    }, null, { actor: withAskGrant(memberActor), lensActions });
    assert.equal(crossTenant.ok, false);
    assert.equal(crossTenant.reason, "tenant_isolation");
  });

  it("(3) high-risk stays refused under the granted actor", () => {
    const auth = authorizeBridgeCall({
      actor: withAskGrant(memberActor), tool: "run_lens_action", risk: BRIDGE_RISK.HIGH, domain: "crisis-ops",
    });
    assert.equal(auth.ok, false);
  });

  it("(4) the Hermes scopeless guard is unchanged", () => {
    const auth = authorizeBridgeCall({
      actor: { id: HERMES_USER_ID, userId: HERMES_USER_ID, scopes: [] },
      tool: "list_lens_actions", risk: BRIDGE_RISK.READ, domain: "crisis-ops",
    });
    assert.equal(auth.ok, false);
    assert.equal(auth.reason, "hermes_scopes_required");
    assert.equal(withAskGrant(null), null);
  });
});
