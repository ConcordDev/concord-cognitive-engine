/**
 * Provenance on-write (B4 wiring) — economy/dtu-pipeline.js createDTU now
 * records a dtu_integrity envelope in the same transaction as the DTU.
 *
 * Before this wiring, dtu_integrity had 0 rows in prod: the integrity
 * machinery (lib/dtu-integrity.js) was only reachable through a manual
 * /api/canonical/integrity/generate call.
 *
 * Done-state asserted here, against a real migrated in-memory DB:
 *  - create a DTU        -> exactly 1 dtu_integrity row, signed, and the
 *                           integrity system's verify() reports it valid
 *  - create a derivative -> a 2nd row whose parent_hash equals the parent
 *                           row's content_hash (and parent_dtu_id matches)
 *  - no signing key      -> DTU creation still succeeds, the envelope is
 *                           stored UNSIGNED (signature NULL), and verify()
 *                           refuses to call its signature valid
 *  - H2                  -> the old hardcoded platform key is gone from
 *                           lib/dtu-integrity.js; the key comes from
 *                           CONCORD_DTU_SIGNING_KEY
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { createDTU } from "../economy/dtu-pipeline.js";
import { createIntegritySystem } from "../lib/dtu-integrity.js";

process.env.CONCORD_DTU_SIGNING_KEY = "dtu-provenance-onwrite-test-only-key";

function integrityRow(db, dtuId) {
  return db
    .prepare("SELECT * FROM dtu_integrity WHERE dtu_id = ?")
    .get(dtuId);
}

function integrityCount(db) {
  return db.prepare("SELECT COUNT(*) AS c FROM dtu_integrity").get().c;
}

// Rebuild the DTU view a verifier would load from the stored row, the same
// fields createDTU handed to generateIntegrity.
function dtuViewFromRow(row) {
  return {
    id: row.id,
    content: row.content,
    tier: row.tier,
    createdAt: row.created_at,
    tags: JSON.parse(row.tags_json || "[]"),
    metadata: JSON.parse(row.metadata_json || "{}"),
  };
}

describe("dtu provenance on-write", () => {
  let db;
  let parent;
  let child;

  before(async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    await runMigrations(db);
  });

  it("creating a DTU writes exactly 1 integrity row, and the chain verifies", () => {
    assert.equal(integrityCount(db), 0);

    parent = createDTU(db, {
      creatorId: "user_parent",
      title: "Parent work",
      content: "the original content",
      contentType: "text",
      lensId: "studio",
      tags: ["orig"],
    });
    assert.equal(parent.ok, true);

    assert.equal(integrityCount(db), 1);
    const row = integrityRow(db, parent.dtu.id);
    assert.ok(row, "integrity row exists for the new DTU");
    assert.ok(row.content_hash, "content hash recorded");
    assert.ok(row.signature, "envelope is signed with the configured key");
    assert.equal(row.signed_by, "platform");
    assert.equal(row.parent_dtu_id, null);
    assert.equal(row.parent_hash, null);

    const stored = db
      .prepare("SELECT * FROM dtus WHERE id = ?")
      .get(parent.dtu.id);
    const system = createIntegritySystem(db);
    const verification = system.verify(dtuViewFromRow(stored));
    assert.equal(verification.ok, true);
    assert.equal(verification.isValid, true);
    assert.equal(verification.signatureValid, true);
    assert.equal(verification.contentHash, row.content_hash);
  });

  it("creating a derivative writes a 2nd row with a matching parent hash", () => {
    child = createDTU(db, {
      creatorId: "user_child",
      title: "Derivative work",
      content: "built on the original",
      contentType: "text",
      lensId: "studio",
      citationMode: "derivative",
      citations: [
        {
          parentId: parent.dtu.id,
          parentCreatorId: "user_parent",
          generation: 1,
        },
      ],
    });
    assert.equal(child.ok, true);

    assert.equal(integrityCount(db), 2);
    const parentRow = integrityRow(db, parent.dtu.id);
    const childRow = integrityRow(db, child.dtu.id);
    assert.ok(childRow, "integrity row exists for the derivative");
    assert.equal(childRow.parent_dtu_id, parent.dtu.id);
    assert.equal(childRow.parent_hash, parentRow.content_hash);

    const storedChild = db
      .prepare("SELECT * FROM dtus WHERE id = ?")
      .get(child.dtu.id);
    const system = createIntegritySystem(db);
    const verification = system.verify(dtuViewFromRow(storedChild));
    assert.equal(verification.isValid, true);
    assert.equal(verification.parentLinkValid, true);
    assert.equal(verification.parentHash, parentRow.content_hash);
  });

  it("tampering with the parent's content breaks its own verification", () => {
    const stored = db
      .prepare("SELECT * FROM dtus WHERE id = ?")
      .get(parent.dtu.id);
    const system = createIntegritySystem(db);
    const verification = system.verify({
      ...dtuViewFromRow(stored),
      content: "tampered content",
    });
    assert.equal(verification.isValid, false);
    assert.equal(verification.contentMatch, false);
  });

  it("with no signing key configured, creation succeeds but the envelope is unsigned and does not verify as signed", () => {
    const saved = process.env.CONCORD_DTU_SIGNING_KEY;
    delete process.env.CONCORD_DTU_SIGNING_KEY;
    try {
      const r = createDTU(db, {
        creatorId: "user_unsigned",
        title: "Unsigned work",
        content: "created with no platform key configured",
        contentType: "text",
        lensId: "studio",
      });
      assert.equal(r.ok, true, "DTU creation must not fail for a missing key");

      const row = integrityRow(db, r.dtu.id);
      assert.ok(row, "integrity row is still written");
      assert.equal(row.signature, null);
      assert.equal(row.signed_by, null);

      const stored = db
        .prepare("SELECT * FROM dtus WHERE id = ?")
        .get(r.dtu.id);
      const system = createIntegritySystem(db);
      const verification = system.verify(dtuViewFromRow(stored));
      assert.equal(verification.signatureValid, false);
      assert.equal(verification.isValid, false);
    } finally {
      process.env.CONCORD_DTU_SIGNING_KEY = saved;
    }
  });

  it("H2: the hardcoded platform signing key is gone from dtu-integrity.js", () => {
    const src = readFileSync(
      new URL("../lib/dtu-integrity.js", import.meta.url),
      "utf8",
    );
    assert.ok(
      !src.includes("concord-platform-integrity-key-v1"),
      "hardcoded key value must not appear in source",
    );
    assert.ok(
      src.includes("CONCORD_DTU_SIGNING_KEY"),
      "key is resolved from CONCORD_DTU_SIGNING_KEY",
    );
  });
});
