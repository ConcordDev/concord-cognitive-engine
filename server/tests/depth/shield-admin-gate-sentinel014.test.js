// sentinel-014 — the five platform-wide shield macros (firewall · metrics ·
// predictions · threats · sweep) are admin-gated (founder ruling "Restrict
// to admins", 2026-11-19). Behavioral proof through the booted server's
// runMacro — the same dispatch POST /api/lens/run uses.
//
// Gate of record (BUILDER-RULES-V1 §4): this suite is FIXER-AUTHORED
// (muse-b6) and flagged as such under §6. On the pre-fix build every denial
// leg FAILS (member/user/role-less callers receive ok:true, sweep included);
// on the fixed build the whole suite passes.
//
// The gate idiom is the platform's own: roles owner/admin/founder pass, any
// other caller gets { ok:false, error:"Insufficient permissions: admin role
// required" } — the denial text the frontend's isForbidden() regex and the
// walker's NO_ACCESS_TEXT vocabulary both recognize. The member-facing
// shield macros (status · scan · report) stay member-facing by the ruling.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { macroRuntime } from "./_harness.js";

const GATED = ["threats", "firewall", "predictions", "metrics", "sweep"];
const DENIAL = "Insufficient permissions: admin role required";

let runMacro, baseCtx;
before(async () => {
  ({ runMacro, ctx: baseCtx } = await macroRuntime("sentinel014-gate"));
});

const as = (actor) => ({ ...baseCtx, actor });
const member = () => as({ userId: "s014-member", role: "member" });

describe("sentinel-014 — members are blocked from the shield actions", () => {
  it("member is denied on all five, with the platform denial envelope", async () => {
    for (const action of GATED) {
      const r = await runMacro("shield", action, {}, member());
      assert.equal(r.ok, false, `shield.${action} must deny a member`);
      assert.equal(r.error, DENIAL, `shield.${action} denial text`);
    }
  });

  it("the denial carries no shield data and no sweep execution", async () => {
    const t = await runMacro("shield", "threats", {}, member());
    assert.equal(t.threats, undefined);
    const s = await runMacro("shield", "sweep", {}, member());
    assert.equal(s.sweep, undefined, "a denied sweep must not execute");
  });

  it("user / guest / role-less / anonymous callers are denied too", async () => {
    const callers = [
      { userId: "s014-user", role: "user" },
      { userId: "s014-guest", role: "guest" },
      { userId: "s014-roleless" },
      {},
    ];
    for (const actor of callers) {
      for (const action of GATED) {
        const r = await runMacro("shield", action, {}, as(actor));
        assert.equal(r.ok, false, `shield.${action} must deny actor ${JSON.stringify(actor)}`);
        assert.equal(r.error, DENIAL);
      }
    }
  });

  it("input spoofing does not unlock the gate (role is read from ctx.actor only)", async () => {
    for (const action of GATED) {
      const r = await runMacro("shield", action,
        { role: "admin", userId: "admin", actor: { role: "admin" } }, member());
      assert.equal(r.ok, false, `shield.${action} must ignore input-carried role claims`);
      assert.equal(r.error, DENIAL);
    }
  });
});

describe("sentinel-014 — admin-class roles keep the shield actions", () => {
  it("admin and founder read the feeds and metrics", async () => {
    for (const role of ["admin", "founder"]) {
      const ctx = as({ userId: `s014-${role}`, role });
      for (const action of ["threats", "firewall", "predictions"]) {
        const r = await runMacro("shield", action, {}, ctx);
        assert.equal(r.ok, true, `shield.${action} must allow ${role}`);
        assert.ok(Array.isArray(r.threats ?? r.rules ?? r.predictions));
      }
      const m = await runMacro("shield", "metrics", {}, ctx);
      assert.equal(m.ok, true, `shield.metrics must allow ${role}`);
    }
  });

  it("owner runs a sweep end to end", async () => {
    const r = await runMacro("shield", "sweep", {}, as({ userId: "s014-owner", role: "owner" }));
    assert.equal(r.ok, true);
    assert.equal(r.sweep?.status, "complete");
  });
});

describe("sentinel-014 — the member-facing shield surface stays member-facing", () => {
  it("member still gets shield.status and shield.scan (hash lookup)", async () => {
    const st = await runMacro("shield", "status", {}, member());
    assert.equal(st.ok, true);
    assert.equal(typeof st.securityScore, "number");
    const sc = await runMacro("shield", "scan", { hash: "0".repeat(64) }, member());
    assert.equal(sc.ok, true);
    assert.equal(sc.mode, "hash_lookup");
  });

  it("member shield.report is NOT met by the admin gate", async () => {
    const r = await runMacro("shield", "report",
      { subtype: "exploit", severity: "low", description: "s014 gate probe" }, member());
    assert.notEqual(r.error, DENIAL, "report stays member-facing (its own validation may still refuse)");
  });

  it("the denial text matches the frontend/walker no-access vocabulary", async () => {
    const r = await runMacro("shield", "metrics", {}, member());
    assert.match(r.error, /insufficient permission/i);
  });
});
