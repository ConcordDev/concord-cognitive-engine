// server/domains/licensing.js
//
// Licensed DTU Vaults — revocation (#37). Macros over the additive revocation
// layer (lib/license-revocation.js, mig 344). A creator revokes/reinstates a
// usage license they granted, with an auditable reason; `licensing.check` is the
// access-check callers consult. No royalty math touched — revocation withdraws a
// usage right, not a payment.
//
// Registered from server.js: registerLicensingMacros(register).

import {
  revokeLicense, reinstateLicense, licenseIsActive, listRevocableLicenses,
} from "../lib/license-revocation.js";

export default function registerLicensingMacros(register) {
  register("licensing", "revoke", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    const creatorId = input.creatorId || ctx?.actor?.userId;
    if (!creatorId) return { ok: false, reason: "no_user" };
    return revokeLicense(db, { licenseId: input.licenseId, creatorId, reason: input.reason });
  }, { note: "revoke a usage license you granted (owner-gated, auditable) (#37)" });

  register("licensing", "reinstate", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    const creatorId = input.creatorId || ctx?.actor?.userId;
    if (!creatorId) return { ok: false, reason: "no_user" };
    return reinstateLicense(db, { licenseId: input.licenseId, creatorId });
  }, { note: "reinstate a previously-revoked license (owner-gated) (#37)" });

  register("licensing", "check", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    const licenseeId = input.licenseeId || ctx?.actor?.userId;
    return { ok: true, active: licenseIsActive(db, { artifactId: input.artifactId, licenseeId, licenseType: input.licenseType }) };
  }, { note: "does this licensee currently hold a usable license? (honours revocation/expiry) (#37)" });

  register("licensing", "list", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    const creatorId = input.creatorId || ctx?.actor?.userId;
    if (!creatorId) return { ok: false, reason: "no_user" };
    return { ok: true, licenses: listRevocableLicenses(db, { artifactId: input.artifactId, creatorId }) };
  }, { note: "list the licenses you could revoke for one of your artifacts (#37)" });
}
