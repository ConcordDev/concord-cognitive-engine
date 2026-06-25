// server/tests/license-revocation.test.js
//
// Licensed DTU Vaults — revocation (#37). Additive over creative_usage_licenses
// (mig 014 + 344). Owner-gated revoke/reinstate + an access-check that honours
// revocation/expiry. No royalty math touched. Offline.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import {
  revokeLicense, reinstateLicense, licenseIsActive, listRevocableLicenses,
} from "../lib/license-revocation.js";
import registerLicensingMacros from "../domains/licensing.js";

function seedArtifact(db, id, creatorId) {
  db.prepare(`INSERT INTO creative_artifacts (id, creator_id, type, title, file_path, file_size, file_hash)
              VALUES (?, ?, 'music', 'Track', '/x', 1, 'h')`).run(id, creatorId);
}
function seedLicense(db, id, artifactId, licenseeId, { expiresAt = null, type = "standard" } = {}) {
  db.prepare(`INSERT INTO creative_usage_licenses (id, artifact_id, licensee_id, license_type, status, purchase_price, expires_at)
              VALUES (?, ?, ?, ?, 'active', 10, ?)`).run(id, artifactId, licenseeId, type, expiresAt);
}

describe("License Revocation (#37)", () => {
  let db, macros;
  before(async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    await runMigrations(db);
    seedArtifact(db, "art1", "creator1");
    seedLicense(db, "lic1", "art1", "buyer1");
    macros = new Map();
    registerLicensingMacros((d, n, fn) => macros.set(`${d}.${n}`, fn));
  });

  it("an active license reads as usable", () => {
    assert.equal(licenseIsActive(db, { artifactId: "art1", licenseeId: "buyer1" }), true);
  });

  it("only the artifact owner may revoke", () => {
    const notOwner = revokeLicense(db, { licenseId: "lic1", creatorId: "someone_else", reason: "x" });
    assert.equal(notOwner.ok, false);
    assert.equal(notOwner.reason, "not_artifact_owner");
    assert.equal(licenseIsActive(db, { artifactId: "art1", licenseeId: "buyer1" }), true, "still active");
  });

  it("the owner revokes; the access-check then denies, with an auditable reason", () => {
    const r = revokeLicense(db, { licenseId: "lic1", creatorId: "creator1", reason: "ToS breach" });
    assert.equal(r.ok, true);
    assert.equal(licenseIsActive(db, { artifactId: "art1", licenseeId: "buyer1" }), false, "revoked → not usable");
    const row = db.prepare("SELECT status, revoke_reason, revoked_at FROM creative_usage_licenses WHERE id = 'lic1'").get();
    assert.equal(row.status, "revoked");
    assert.equal(row.revoke_reason, "ToS breach");
    assert.ok(row.revoked_at, "revoked_at stamped");
  });

  it("revocation is idempotent", () => {
    const again = revokeLicense(db, { licenseId: "lic1", creatorId: "creator1" });
    assert.equal(again.ok, true);
    assert.equal(again.alreadyRevoked, true);
  });

  it("the owner can reinstate a revoked, non-expired license", () => {
    const r = reinstateLicense(db, { licenseId: "lic1", creatorId: "creator1" });
    assert.equal(r.ok, true);
    assert.equal(licenseIsActive(db, { artifactId: "art1", licenseeId: "buyer1" }), true, "reinstated → usable");
  });

  it("an expired license never reads as usable, even if active", () => {
    seedArtifact(db, "art2", "creator1");
    seedLicense(db, "lic2", "art2", "buyer2", { expiresAt: "2000-01-01T00:00:00.000Z" });
    assert.equal(licenseIsActive(db, { artifactId: "art2", licenseeId: "buyer2" }), false);
  });

  it("licensing macros round-trip + owner-gated list", async () => {
    const list = await macros.get("licensing.list")({ db, actor: { userId: "creator1" } }, { artifactId: "art1" });
    assert.equal(list.ok, true);
    assert.ok(list.licenses.some((l) => l.id === "lic1"));
    const chk = await macros.get("licensing.check")({ db, actor: { userId: "buyer1" } }, { artifactId: "art1" });
    assert.equal(chk.active, true);
    const rev = await macros.get("licensing.revoke")({ db, actor: { userId: "creator1" } }, { licenseId: "lic1", reason: "macro" });
    assert.equal(rev.ok, true);
    const chk2 = await macros.get("licensing.check")({ db, actor: { userId: "buyer1" } }, { artifactId: "art1" });
    assert.equal(chk2.active, false);
  });
});
