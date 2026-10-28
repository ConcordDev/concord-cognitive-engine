// SEC-IMPORT-OWNERSHIP: import.json used to let any signed-in member
// overwrite ANY existing DTU by id (no ownership check) and imported DTUs
// landed with no ownerId/visibility (ownerless → normalized to
// system/internal), with tier caller-controlled. lib/dtu-import-guard.js
// is the pure per-DTU decision; these tests exercise it directly and
// lightly assert the wiring in server.js. This file deliberately does NOT
// import server.js (it boots the whole server). No network.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dtuImportDecision, importAuthDenial, stampImportedDtu } from "../lib/dtu-import-guard.js";

const SERVER_PATH = path.resolve(import.meta.dirname, "../server.js");
const source = readFileSync(SERVER_PATH, "utf-8");

const SECURED = "jwt";
const MEMBER_CTX = { actor: { userId: "u-member", role: "member", scopes: ["read", "write"] } };
const ADMIN_CTX = { actor: { userId: "u-admin", role: "admin", scopes: ["*"] } };
const ANON_CTX = { actor: { userId: "anon", role: "guest", scopes: ["read"] } };

function decide(args) {
  return dtuImportDecision({ authMode: SECURED, ...args });
}

describe("SEC-IMPORT-OWNERSHIP guard (unit)", () => {
  it("member overwriting someone else's DTU is DENIED", () => {
    const existing = { id: "dtu_theirs", title: "Theirs", tier: "mega", ownerId: "u-other", visibility: "private", creatorType: "user" };
    const res = decide({ existing, incoming: { id: "dtu_theirs", title: "Hacked" }, ctx: MEMBER_CTX, overwrite: true });
    assert.equal(res.action, "deny");
    assert.equal(res.dtu, null);
    assert.equal(res.denial.status, 403);
  });

  it("member overwriting their OWN DTU writes, keeping owner/tier/visibility", () => {
    const existing = { id: "dtu_mine", title: "Mine", tier: "mega", ownerId: "u-member", visibility: "private", creatorType: "user" };
    const res = decide({ existing, incoming: { id: "dtu_mine", title: "Mine v2", tier: "hyper" }, ctx: MEMBER_CTX, overwrite: true });
    assert.equal(res.action, "write");
    assert.equal(res.dtu.ownerId, "u-member", "owner must be kept from existing");
    assert.equal(res.dtu.tier, "mega", "tier must be kept from existing, not caller input");
    assert.equal(res.dtu.visibility, "private");
    assert.equal(res.dtu.creatorType, "user");
  });

  it("member overwriting own DTU owned via author/createdBy (no ownerId) keeps ownership", () => {
    const existing = { id: "dtu_auth", title: "A", tier: "regular", author: "u-member", createdBy: "u-member", visibility: "private" };
    const res = decide({ existing, incoming: { id: "dtu_auth", title: "A v2", author: "u-other", meta: { ownerId: "u-other" } }, ctx: MEMBER_CTX, overwrite: true });
    assert.equal(res.action, "write");
    assert.equal(res.dtu.author, "u-member");
    assert.equal(res.dtu.createdBy, "u-member");
    assert.equal(res.dtu.ownerId, "u-member", "never ownerless after overwrite");
    assert.equal(res.dtu.meta.ownerId, undefined);
  });

  it("member overwriting own DTU may only set visibility private/public; other input keeps existing", () => {
    const existing = { id: "dtu_mine", title: "Mine", tier: "regular", ownerId: "u-member", visibility: "private", creatorType: "user" };
    const pub = decide({ existing, incoming: { id: "dtu_mine", title: "Mine", visibility: "public" }, ctx: MEMBER_CTX, overwrite: true });
    assert.equal(pub.action, "write");
    assert.equal(pub.dtu.visibility, "public", "input visibility public must be honored");
    const mkt = decide({ existing, incoming: { id: "dtu_mine", title: "Mine", visibility: "marketplace" }, ctx: MEMBER_CTX, overwrite: true });
    assert.equal(mkt.action, "write");
    assert.equal(mkt.dtu.visibility, "private", "non private/public input visibility must fall back to existing");
  });

  it("member NEW DTU is owner-stamped: ownerId, creatorType user, private, tier regular", () => {
    const res = decide({ existing: null, incoming: { id: "dtu_new", title: "New", tier: "hyper" }, ctx: MEMBER_CTX, overwrite: false });
    assert.equal(res.action, "write");
    assert.equal(res.dtu.ownerId, "u-member", "owner must be stamped from the actor");
    assert.equal(res.dtu.creatorType, "user");
    assert.equal(res.dtu.visibility, "private");
    assert.equal(res.dtu.tier, "regular", "tier must be forced to regular, not caller input");
  });

  it("member NEW DTU honors input visibility public; anything else becomes private", () => {
    const pub = decide({ existing: null, incoming: { id: "a", title: "A", visibility: "public" }, ctx: MEMBER_CTX, overwrite: false });
    assert.equal(pub.dtu.visibility, "public");
    const mkt = decide({ existing: null, incoming: { id: "b", title: "B", visibility: "marketplace" }, ctx: MEMBER_CTX, overwrite: false });
    assert.equal(mkt.dtu.visibility, "private", "marketplace must not be accepted from input");
    const none = decide({ existing: null, incoming: { id: "c", title: "C" }, ctx: MEMBER_CTX, overwrite: false });
    assert.equal(none.dtu.visibility, "private");
  });

  it("ownership-spoofing keys in caller meta are stripped (all callers)", () => {
    const incoming = {
      id: "dtu_meta",
      title: "Meta",
      meta: { ownerId: "u-other", author: "spoof", authorId: "spoof", createdBy: "spoof", createdByUser: "spoof", userId: "spoof", note: "keep me" },
    };
    for (const ctx of [MEMBER_CTX, ADMIN_CTX]) {
      const res = decide({ existing: null, incoming, ctx, overwrite: false });
      assert.equal(res.action, "write");
      const meta = res.dtu.meta;
      assert.equal(meta.note, "keep me");
      assert.ok(meta.importedAt, "importedAt must be stamped");
      for (const key of ["ownerId", "author", "authorId", "createdBy", "createdByUser", "userId"]) {
        assert.equal(key in meta, false, `meta.${key} must be stripped`);
      }
    }
    // Member write: the stamped ownerId is the actor's, never meta's.
    const member = decide({ existing: null, incoming, ctx: MEMBER_CTX, overwrite: false });
    assert.equal(member.dtu.ownerId, "u-member");
  });

  it("admin overwriting another user's DTU is ALLOWED (current behavior kept)", () => {
    const existing = { id: "dtu_admin_target", title: "Theirs", tier: "regular", ownerId: "u-other", visibility: "private", creatorType: "user" };
    const res = decide({ existing, incoming: { id: "dtu_admin_target", title: "Admin edit", tier: "mega" }, ctx: ADMIN_CTX, overwrite: true });
    assert.equal(res.action, "write");
    assert.equal(res.dtu.tier, "mega", "admin keeps caller-controlled tier");
  });

  it("ownerless and system-owned existing DTUs are DENIED for a member overwrite", () => {
    const ownerless = decide({ existing: { id: "dtu_bare", title: "Bare", tier: "regular" }, incoming: { id: "dtu_bare", title: "Taken" }, ctx: MEMBER_CTX, overwrite: true });
    assert.equal(ownerless.action, "deny");
    const system = decide({ existing: { id: "dtu_sys", title: "Sys", tier: "regular", ownerId: "system", visibility: "internal", creatorType: "system" }, incoming: { id: "dtu_sys", title: "Taken" }, ctx: MEMBER_CTX, overwrite: true });
    assert.equal(system.action, "deny");
    assert.equal(system.denial.status, 403);
  });

  it("anonymous callers hit the 401 AUTH_REQUIRED path in secured modes", () => {
    assert.deepEqual(importAuthDenial(ANON_CTX, SECURED), { status: 401, code: "AUTH_REQUIRED", error: "Authentication required" });
    assert.deepEqual(importAuthDenial({}, SECURED), { status: 401, code: "AUTH_REQUIRED", error: "Authentication required" });
    assert.equal(importAuthDenial(MEMBER_CTX, SECURED), null, "signed-in member must pass the request gate");
    assert.equal(importAuthDenial(ANON_CTX, "public"), null, "AUTH_MODE=public keeps the local-first exception");
    // Defense in depth: the per-DTU guard also denies anonymous write attempts.
    const res = decide({ existing: null, incoming: { id: "dtu_anon", title: "Anon" }, ctx: ANON_CTX, overwrite: false });
    assert.equal(res.action, "deny");
    assert.deepEqual(res.denial, { status: 401, code: "AUTH_REQUIRED", error: "Authentication required" });
  });

  it("skips are preserved: invalid entries and existing-without-overwrite", () => {
    assert.equal(decide({ existing: null, incoming: { id: "", title: "no id" }, ctx: MEMBER_CTX, overwrite: true }).action, "skip");
    assert.equal(decide({ existing: null, incoming: { id: "x", title: "" }, ctx: MEMBER_CTX, overwrite: true }).action, "skip");
    assert.equal(decide({ existing: null, incoming: null, ctx: MEMBER_CTX, overwrite: true }).action, "skip");
    const existing = { id: "dtu_dup", title: "Dup", ownerId: "u-member" };
    assert.equal(decide({ existing, incoming: { id: "dtu_dup", title: "Dup" }, ctx: MEMBER_CTX, overwrite: false }).action, "skip");
    // overwrite=false for an existing id stays a skip even with spoofing meta.
    assert.equal(decide({ existing, incoming: { id: "dtu_dup", title: "Dup", meta: { ownerId: "u-other" } }, ctx: MEMBER_CTX, overwrite: false }).action, "skip");
  });

  it("AUTH_MODE=public keeps current behavior for members (no stamps, caller tier)", () => {
    const res = dtuImportDecision({
      existing: null,
      incoming: { id: "dtu_pub", title: "Pub", tier: "hyper", visibility: "marketplace" },
      ctx: MEMBER_CTX,
      overwrite: false,
      authMode: "public",
    });
    assert.equal(res.action, "write");
    assert.equal(res.dtu.ownerId, undefined);
    assert.equal(res.dtu.creatorType, undefined);
    assert.equal(res.dtu.visibility, undefined);
    assert.equal(res.dtu.tier, "hyper");
    // Member overwrite of someone else's DTU in public mode is still allowed.
    const over = dtuImportDecision({
      existing: { id: "dtu_pub2", title: "Pub2", tier: "regular", ownerId: "u-other" },
      incoming: { id: "dtu_pub2", title: "Pub2 edited" },
      ctx: MEMBER_CTX,
      overwrite: true,
      authMode: "public",
    });
    assert.equal(over.action, "write");
  });
});

describe("SEC-IMPORT-OWNERSHIP markdown stamping (unit)", () => {
  it("stampImportedDtu stamps ownerId/creatorType/private for a member in a secured mode", () => {
    const dtu = { id: "dtu_md", title: "MD" };
    stampImportedDtu(dtu, MEMBER_CTX, SECURED);
    assert.equal(dtu.ownerId, "u-member");
    assert.equal(dtu.creatorType, "user");
    assert.equal(dtu.visibility, "private");
  });

  it("admins and AUTH_MODE=public keep the historical ownerless behavior", () => {
    const adminDtu = { id: "dtu_md_a", title: "A" };
    stampImportedDtu(adminDtu, ADMIN_CTX, SECURED);
    assert.equal(adminDtu.ownerId, undefined);
    assert.equal(adminDtu.visibility, undefined);
    const pubDtu = { id: "dtu_md_p", title: "P" };
    stampImportedDtu(pubDtu, MEMBER_CTX, "public");
    assert.equal(pubDtu.ownerId, undefined);
    assert.equal(pubDtu.visibility, undefined);
  });
});

describe("SEC-IMPORT-OWNERSHIP wiring (source)", () => {
  const jsonStart = source.indexOf('register("import", "json"');
  const mdStart = source.indexOf('register("import", "markdown"');
  const mdEnd = source.indexOf("// ---- Plugin/Extension System", mdStart);
  assert.ok(jsonStart > 0 && mdStart > jsonStart && mdEnd > mdStart, "import handlers not found in server.js");
  const jsonBody = source.slice(jsonStart, mdStart);
  const mdBody = source.slice(mdStart, mdEnd);

  it("server.js imports the guard helpers from lib/dtu-import-guard.js", () => {
    assert.ok(source.includes('import { dtuImportDecision, importAuthDenial, stampImportedDtu } from "./lib/dtu-import-guard.js";'));
  });

  it("import.json routes every DTU through dtuImportDecision, gates anonymous callers, and reports denied", () => {
    assert.ok(jsonBody.includes("importAuthDenial(ctx, AUTH_MODE)"), "json handler must reject anonymous callers first");
    assert.ok(jsonBody.includes("STATE.dtus.get("), "json handler must look up the existing DTU for the guard");
    assert.ok(jsonBody.includes("dtuImportDecision("), "json handler must use the guard for every DTU");
    assert.ok(jsonBody.includes("decision.action === \"deny\""), "json handler must honor deny decisions");
    assert.ok(/\bdenied\b/.test(jsonBody), "json handler must count denials");
    assert.ok(jsonBody.includes("denied,"), "json response must expose the denied counter");
  });

  it("import.markdown applies the same 401 gate and stamps ownership", () => {
    assert.ok(mdBody.includes("importAuthDenial(ctx, AUTH_MODE)"), "markdown handler must reject anonymous callers first");
    assert.ok(mdBody.includes("stampImportedDtu("), "markdown handler must stamp ownership on every created DTU");
  });
});