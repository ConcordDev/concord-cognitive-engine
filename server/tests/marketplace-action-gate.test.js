// Marketplace action gate — security regression tests.
//
// Pins the fix for: `marketplace.buy` / `marketplace.sell` /
// `marketplace.issue_license` lens actions let ANY signed-in member act on
// ANY listing artifact because `marketplace` is a LENS_SOCIAL_DOMAINS domain
// on the generic lens run path:
//   * `buy` appended a "purchase" record with NO payment (fake sales counts
//     feeding `distribute_royalties`);
//   * `sell` set status "listed" on anyone's artifact;
//   * `issue_license` granted a license to params.grantedTo (anyone).
// Product default (safest): only the listing owner (or admin/internal) may
// sell/issue licenses; purchases go through the paid marketplace checkout.
//
// Two layers:
//   1. Unit tests for marketplaceOwnerDenial / marketplaceBuyDenial (owner
//      allowed, admin allowed, internal allowed, other member 403, anon 401,
//      buy member 409, buy admin null).
//   2. Source-order assertions that EACH of the three handlers in server.js
//      calls its gate BEFORE the first `artifact.data =` mutation.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { marketplaceOwnerDenial, marketplaceBuyDenial } from "../lib/marketplace-action-gate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_JS = readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

const OWNER_FORBIDDEN = Object.freeze({ ok: false, status: 403, code: "FORBIDDEN", error: "forbidden: only the listing owner can do this" });
const ANON_DENIED = Object.freeze({ ok: false, status: 401, code: "AUTH_REQUIRED", error: "sign in required" });
const BUY_CHECKOUT = Object.freeze({ ok: false, status: 409, code: "CHECKOUT_REQUIRED", error: "purchases go through the paid marketplace checkout; this action does not record purchases" });

describe("marketplace-action-gate — marketplaceOwnerDenial unit", () => {
  it("the listing owner is allowed", () => {
    assert.equal(marketplaceOwnerDenial({ isOwner: true, isAdmin: false, internal: false, userId: "owner-1" }), null);
  });

  it("an admin-class role is allowed even on someone else's listing", () => {
    assert.equal(marketplaceOwnerDenial({ isOwner: false, isAdmin: true, internal: false, userId: "admin-1" }), null);
  });

  it("internal callers (ctx.internal or actor.internal) are allowed", () => {
    assert.equal(marketplaceOwnerDenial({ internal: true, userId: "member-1" }), null);
    assert.equal(marketplaceOwnerDenial({ isOwner: false, isAdmin: false, internal: true }), null);
  });

  it("a signed-in non-owner member is denied 403", () => {
    assert.deepEqual(marketplaceOwnerDenial({ isOwner: false, isAdmin: false, internal: false, userId: "member-1" }), OWNER_FORBIDDEN);
  });

  it("the anon sentinel is denied 401", () => {
    assert.deepEqual(marketplaceOwnerDenial({ isOwner: false, isAdmin: false, internal: false, userId: "anon" }), ANON_DENIED);
  });

  it("a missing userId is denied 401", () => {
    assert.deepEqual(marketplaceOwnerDenial({ isOwner: false, isAdmin: false, internal: false }), ANON_DENIED);
  });

  it("an empty input is denied 401", () => {
    assert.deepEqual(marketplaceOwnerDenial({}), ANON_DENIED);
    assert.deepEqual(marketplaceOwnerDenial(undefined), ANON_DENIED);
    assert.deepEqual(marketplaceOwnerDenial(null), ANON_DENIED);
  });

  it("internal beats a signed-in non-owner (allow order)", () => {
    assert.equal(marketplaceOwnerDenial({ isOwner: false, isAdmin: false, internal: true, userId: "member-2" }), null);
  });
});

describe("marketplace-action-gate — marketplaceBuyDenial unit", () => {
  it("a signed-in plain member is denied 409 CHECKOUT_REQUIRED", () => {
    assert.deepEqual(marketplaceBuyDenial({ isAdmin: false, internal: false }), BUY_CHECKOUT);
  });

  it("an admin is allowed (legacy behavior preserved)", () => {
    assert.equal(marketplaceBuyDenial({ isAdmin: true, internal: false }), null);
  });

  it("internal callers are allowed (legacy behavior preserved)", () => {
    assert.equal(marketplaceBuyDenial({ isAdmin: false, internal: true }), null);
  });

  it("an empty input is denied 409 (no admin/internal allow by default)", () => {
    assert.deepEqual(marketplaceBuyDenial({}), BUY_CHECKOUT);
    assert.deepEqual(marketplaceBuyDenial(undefined), BUY_CHECKOUT);
    assert.deepEqual(marketplaceBuyDenial(null), BUY_CHECKOUT);
  });
});

describe("marketplace-action-gate — server.js handler wiring (source order)", () => {
  // Delimit each handler's registration block by the next registration after it.
  const buyStart = SERVER_JS.indexOf('registerLensAction("marketplace", "buy"');
  const sellStart = SERVER_JS.indexOf('registerLensAction("marketplace", "sell"');
  const reviewStart = SERVER_JS.indexOf('registerLensAction("marketplace", "review"');
  const licenseStart = SERVER_JS.indexOf('registerLensAction("marketplace", "issue_license"');
  const royaltiesStart = SERVER_JS.indexOf('registerLensAction("marketplace", "distribute_royalties"');

  it("all the marketplace action registrations are found in order", () => {
    assert.ok(buyStart > 0, "marketplace.buy registration found");
    assert.ok(sellStart > buyStart, "marketplace.sell registration found after marketplace.buy");
    assert.ok(reviewStart > sellStart, "marketplace.review registration found after marketplace.sell");
    assert.ok(licenseStart > reviewStart, "marketplace.issue_license registration found after marketplace.review");
    assert.ok(royaltiesStart > licenseStart, "marketplace.distribute_royalties registration found after marketplace.issue_license");
  });

  it("marketplace.buy gates with marketplaceBuyDenial before mutating artifact.data", () => {
    const body = SERVER_JS.slice(buyStart, sellStart);
    const gateAt = body.indexOf("marketplaceBuyDenial");
    const mutateAt = body.indexOf("artifact.data =");
    assert.ok(gateAt > 0, "marketplace.buy calls marketplaceBuyDenial");
    assert.ok(mutateAt > 0, "marketplace.buy mutates artifact.data");
    assert.ok(gateAt < mutateAt, "marketplace.buy: marketplaceBuyDenial precedes the artifact.data mutation");
  });

  it("marketplace.sell gates with marketplaceOwnerDenial before mutating artifact.data", () => {
    const body = SERVER_JS.slice(sellStart, reviewStart);
    const gateAt = body.indexOf("marketplaceOwnerDenial");
    const mutateAt = body.indexOf("artifact.data =");
    assert.ok(gateAt > 0, "marketplace.sell calls marketplaceOwnerDenial");
    assert.ok(mutateAt > 0, "marketplace.sell mutates artifact.data");
    assert.ok(gateAt < mutateAt, "marketplace.sell: marketplaceOwnerDenial precedes the artifact.data mutation");
  });

  it("marketplace.issue_license gates with marketplaceOwnerDenial before mutating artifact.data", () => {
    const body = SERVER_JS.slice(licenseStart, royaltiesStart);
    const gateAt = body.indexOf("marketplaceOwnerDenial");
    const mutateAt = body.indexOf("artifact.data =");
    assert.ok(gateAt > 0, "marketplace.issue_license calls marketplaceOwnerDenial");
    assert.ok(mutateAt > 0, "marketplace.issue_license mutates artifact.data");
    assert.ok(gateAt < mutateAt, "marketplace.issue_license: marketplaceOwnerDenial precedes the artifact.data mutation");
  });

  it("marketplace.issue_license keeps grantedTo from params (owner granting a license is legitimate)", () => {
    const body = SERVER_JS.slice(licenseStart, royaltiesStart);
    assert.ok(body.includes("grantedTo: params.grantedTo"), "grantedTo still honors the explicit params.grantedTo");
  });

  it("server.js imports the gate helpers from lib/marketplace-action-gate.js", () => {
    assert.ok(
      SERVER_JS.includes('import { marketplaceOwnerDenial, marketplaceBuyDenial } from "./lib/marketplace-action-gate.js";'),
      "server.js imports the shared gate helpers"
    );
  });
});