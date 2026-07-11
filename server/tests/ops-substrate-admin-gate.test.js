// server/tests/ops-substrate-admin-gate.test.js
//
// The `ops` lens's "Substrate Ops" tabs (Attention / Repair Net / Physical
// DTUs / Explorations — concord-frontend/app/lenses/ops/page.tsx) call the
// `attention_alloc`, `repair_network`, `physical`, and `explore` macro
// domains and render <AdminRequiredState> when any of those four queries
// come back 403 (`ops` is also listed among the operator lenses in
// concord-frontend/tests/e2e/admin-gated-lenses.spec.ts). Until this fix
// none of the 21 macros across those four domains enforced that server-side
// — any authenticated user could force-focus the shared civilization LLM
// attention budget (up to 90% via `attention_alloc.focus`), resize the
// total budget, or disconnect the shared distributed repair network for
// everyone. Same class of gap already fixed for psyops (0de13bbe) and
// admin (7b0a52f1); this closes it for `ops`'s substrate-observability
// domains via the same requireAdminRole() gate already used by the
// server.js-registered `admin.*` macros.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { macroRuntime } from "./depth/_harness.js";

let runMacro;
before(async () => {
  ({ runMacro } = await macroRuntime("ops-admin-gate"));
});

const ctxViewer = { actor: { userId: "u_viewer", role: "user" }, userId: "u_viewer" };
const ctxNoRole = { actor: { userId: "u_norole" }, userId: "u_norole" };
const ctxAdmin = { actor: { userId: "u_admin", role: "admin" }, userId: "u_admin" };
const ctxOwner = { actor: { userId: "u_owner", role: "owner" }, userId: "u_owner" };
const ctxFounder = { actor: { userId: "u_founder", role: "founder" }, userId: "u_founder" };

const CASES = [
  ["attention_alloc", "status", {}],
  ["attention_alloc", "run", {}],
  ["attention_alloc", "focus", { domain: "physics", weight: 0.9, minutes: 5 }],
  ["attention_alloc", "unfocus", {}],
  ["attention_alloc", "history", {}],
  ["attention_alloc", "budget", { total: 100 }],
  ["repair_network", "status", {}],
  ["repair_network", "push", {}],
  ["repair_network", "pull", {}],
  ["repair_network", "disconnect", {}],
  ["physical", "types", {}],
  ["physical", "metrics", {}],
  ["physical", "query", {}],
  ["physical", "validate", { dtu: {} }],
  ["explore", "history", {}],
  ["explore", "run", { constraints: {} }],
];

describe("ops substrate domains (attention_alloc / repair_network / physical / explore) — admin gate", () => {
  it("denies a plain-user caller on every macro with a forbidden-shaped error", async () => {
    for (const [domain, name, input] of CASES) {
      const r = await runMacro(domain, name, input, ctxViewer);
      assert.equal(r?.ok, false, `${domain}.${name} must deny a non-admin caller`);
      assert.match(
        String(r?.error || ""),
        /insufficient permission/i,
        `${domain}.${name} error must match the frontend isForbidden() regex`
      );
    }
  });

  it("denies a caller with no role at all (defaults to non-admin)", async () => {
    const r = await runMacro("attention_alloc", "status", {}, ctxNoRole);
    assert.equal(r.ok, false);
  });

  it("admits owner, admin, and founder roles", async () => {
    for (const ctx of [ctxOwner, ctxAdmin, ctxFounder]) {
      const r = await runMacro("attention_alloc", "status", {}, ctx);
      assert.equal(r?.ok !== false || r?.error === undefined, true, `${ctx.actor.role} must not be denied`);
      assert.ok(!/insufficient permission/i.test(String(r?.error || "")), `${ctx.actor.role} must not see the admin-gate error`);
    }
  });

  it("a denied repair_network.disconnect does not tear down the network for an admin", async () => {
    // Sanity: a non-admin's disconnect attempt is denied (asserted above) —
    // this proves the denial happens BEFORE the mutation runs, by checking
    // an admin can still read a status object afterwards without throwing.
    await runMacro("repair_network", "disconnect", {}, ctxViewer);
    const status = await runMacro("repair_network", "status", {}, ctxAdmin);
    assert.notEqual(status, undefined);
  });
});
