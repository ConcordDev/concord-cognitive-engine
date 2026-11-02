import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  initIntegrityTable,
  createIntegritySystem,
} from "../lib/dtu-integrity.js";

// H2: the platform signing key is no longer hardcoded in dtu-integrity.js —
// it comes from CONCORD_DTU_SIGNING_KEY. Configure a test-only key so this
// suite exercises the signed path. (Env is read at call time, so setting it
// here, after the import, is effective.)
process.env.CONCORD_DTU_SIGNING_KEY = "dtu-integrity-test-only-key";

describe("dtu-integrity", () => {
  let db;
  let system;

  function makeDTU(overrides = {}) {
    return {
      id: "dtu_test1",
      content: "Hello, integrity check!",
      summary: "A test summary",
      tier: "regular",
      scope: "global",
      createdAt: "2025-01-01T00:00:00Z",
      ...overrides,
    };
  }

  beforeEach(() => {
    db = new Database(":memory:");
    initIntegrityTable(db);
    system = createIntegritySystem(db);
  });

  // ── initIntegrityTable ─────────────────────────────────────────────

  describe("initIntegrityTable", () => {
    it("creates dtu_integrity table", () => {
      const freshDb = new Database(":memory:");
      const result = initIntegrityTable(freshDb);
      assert.equal(result, true);

      const tables = freshDb
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='dtu_integrity'"
        )
        .all();
      assert.equal(tables.length, 1);
    });

    it("returns false when db is null", () => {
      assert.equal(initIntegrityTable(null), false);
    });

    it("is idempotent", () => {
      const freshDb = new Database(":memory:");
      assert.equal(initIntegrityTable(freshDb), true);
      assert.equal(initIntegrityTable(freshDb), true);
    });
  });

  // ── generateIntegrity ──────────────────────────────────────────────

  describe("generateIntegrity", () => {
    it("creates an integrity envelope with all fields", () => {
      const dtu = makeDTU();
      const result = system.generateIntegrity(dtu);

      assert.equal(result.ok, true);
      assert.ok(result.envelope);
      assert.equal(result.envelope.dtuId, "dtu_test1");
      assert.ok(result.envelope.contentHash);
      assert.ok(result.envelope.headerChecksum);
      assert.ok(result.envelope.signature);
      assert.equal(result.envelope.signedBy, "platform");
      assert.ok(result.envelope.signedAt);
      assert.equal(result.envelope.isValid, true);
    });

    it("returns error for missing DTU", () => {
      const result = system.generateIntegrity(null);
      assert.equal(result.ok, false);
      assert.equal(result.error, "missing_dtu_or_id");
    });

    it("returns error for DTU without id", () => {
      const result = system.generateIntegrity({ content: "no id" });
      assert.equal(result.ok, false);
    });

    it("persists the envelope to the database", () => {
      const dtu = makeDTU();
      system.generateIntegrity(dtu);

      const row = db
        .prepare("SELECT * FROM dtu_integrity WHERE dtu_id = ?")
        .get("dtu_test1");
      assert.ok(row);
      assert.equal(row.dtu_id, "dtu_test1");
      assert.ok(row.content_hash);
      assert.ok(row.signature);
    });

    it("computes per-layer checksums", () => {
      const dtu = makeDTU({
        humanLayer: { display: "human" },
        coreLayer: { internal: "core" },
        metadata: { key: "val" },
        tags: ["a", "b"],
      });
      const result = system.generateIntegrity(dtu);
      const checksums = result.envelope.layerChecksums;

      assert.ok(checksums.content);
      assert.ok(checksums.summary);
      assert.ok(checksums.humanLayer);
      assert.ok(checksums.coreLayer);
      assert.ok(checksums.metadata);
      assert.ok(checksums.tags);
    });

    it("handles empty content gracefully", () => {
      const dtu = makeDTU({ content: "" });
      const result = system.generateIntegrity(dtu);
      assert.equal(result.ok, true);
      assert.ok(result.envelope.contentHash);
    });
  });

  // ── verify ─────────────────────────────────────────────────────────

  describe("verify", () => {
    it("returns isValid=true for untampered DTU", () => {
      const dtu = makeDTU();
      system.generateIntegrity(dtu);
      const result = system.verify(dtu);

      assert.equal(result.ok, true);
      assert.equal(result.isValid, true);
      assert.equal(result.contentMatch, true);
      assert.equal(result.headerMatch, true);
      assert.equal(result.allLayersMatch, true);
      assert.equal(result.signatureValid, true);
    });

    it("returns isValid=false for tampered content", () => {
      const dtu = makeDTU();
      system.generateIntegrity(dtu);

      // Tamper with content
      const tampered = { ...dtu, content: "TAMPERED!" };
      const result = system.verify(tampered);

      assert.equal(result.isValid, false);
      assert.equal(result.contentMatch, false);
    });

    it("returns isValid=false for tampered header", () => {
      const dtu = makeDTU();
      system.generateIntegrity(dtu);

      const tampered = { ...dtu, tier: "premium" };
      const result = system.verify(tampered);

      assert.equal(result.isValid, false);
      assert.equal(result.headerMatch, false);
    });

    it("returns error for missing DTU", () => {
      const result = system.verify(null);
      assert.equal(result.ok, false);
      assert.equal(result.isValid, false);
    });

    it("returns not found when no integrity record exists", () => {
      const dtu = makeDTU({ id: "dtu_no_record" });
      const result = system.verify(dtu);

      assert.equal(result.ok, true);
      assert.equal(result.isValid, false);
      assert.equal(result.reason, "no_integrity_record");
    });

    it("updates verification timestamp in DB", () => {
      const dtu = makeDTU();
      system.generateIntegrity(dtu);
      system.verify(dtu);

      const row = db
        .prepare("SELECT * FROM dtu_integrity WHERE dtu_id = ?")
        .get("dtu_test1");
      assert.ok(row.verified_at);
    });
  });

  // ── sign ───────────────────────────────────────────────────────────

  describe("sign", () => {
    it("signs a DTU with a custom key", () => {
      const dtu = makeDTU();
      system.generateIntegrity(dtu);
      const result = system.sign(dtu, "my-secret-key", "user123");

      assert.equal(result.ok, true);
      assert.equal(result.dtuId, "dtu_test1");
      assert.ok(result.signature);
      assert.equal(result.signedBy, "user123");
      assert.ok(result.signedAt);
    });

    it("returns error for missing DTU", () => {
      const result = system.sign(null, "key");
      assert.equal(result.ok, false);
    });

    it("signs even when no prior integrity record exists", () => {
      const dtu = makeDTU({ id: "dtu_fresh_sign" });
      const result = system.sign(dtu, "key-x", "signer1");
      assert.equal(result.ok, true);
      assert.ok(result.signature);
    });

    it("different keys produce different signatures", () => {
      const dtu = makeDTU();
      const r1 = system.sign(dtu, "key-A");
      const r2 = system.sign(dtu, "key-B");
      assert.notEqual(r1.signature, r2.signature);
    });
  });

  // ── verifyChain ────────────────────────────────────────────────────

  describe("verifyChain", () => {
    it("returns error when no dtuStore configured", () => {
      const result = system.verifyChain("dtu_root");
      assert.equal(result.ok, false);
      assert.equal(result.error, "no_dtu_store_configured");
    });

    it("verifies a chain of DTUs", () => {
      const dtuStore = {
        get(id) {
          const dtus = {
            dtu_root: makeDTU({ id: "dtu_root", childIds: ["dtu_child1"] }),
            dtu_child1: makeDTU({
              id: "dtu_child1",
              content: "child content",
              childIds: [],
            }),
          };
          return dtus[id] || null;
        },
      };

      const chainSystem = createIntegritySystem(db, { dtuStore });

      // Generate integrity for both DTUs
      chainSystem.generateIntegrity(
        makeDTU({ id: "dtu_root", childIds: ["dtu_child1"] })
      );
      chainSystem.generateIntegrity(
        makeDTU({
          id: "dtu_child1",
          content: "child content",
          childIds: [],
        })
      );

      const result = chainSystem.verifyChain("dtu_root");
      assert.equal(result.ok, true);
      assert.equal(result.chainValid, true);
      assert.equal(result.nodesChecked, 2);
      assert.equal(result.invalidCount, 0);
    });

    it("reports missing DTUs in chain", () => {
      const dtuStore = {
        get(id) {
          if (id === "dtu_root")
            {return makeDTU({
              id: "dtu_root",
              childIds: ["dtu_missing"],
            });}
          return null;
        },
      };

      const chainSystem = createIntegritySystem(db, { dtuStore });
      chainSystem.generateIntegrity(
        makeDTU({ id: "dtu_root", childIds: ["dtu_missing"] })
      );

      const result = chainSystem.verifyChain("dtu_root");
      assert.equal(result.ok, true);
      assert.equal(result.chainValid, false);
      assert.equal(result.invalidCount, 1);
    });
  });

  // ── batchVerify ────────────────────────────────────────────────────

  describe("batchVerify", () => {
    it("returns error when no dtuStore configured", () => {
      const result = system.batchVerify(["dtu_1"]);
      assert.equal(result.ok, false);
    });

    it("verifies multiple DTUs", () => {
      const dtu1 = makeDTU({ id: "dtu_b1", content: "content 1" });
      const dtu2 = makeDTU({ id: "dtu_b2", content: "content 2" });

      const dtuStore = {
        get(id) {
          if (id === "dtu_b1") return dtu1;
          if (id === "dtu_b2") return dtu2;
          return null;
        },
      };

      const batchSystem = createIntegritySystem(db, { dtuStore });
      batchSystem.generateIntegrity(dtu1);
      batchSystem.generateIntegrity(dtu2);

      const result = batchSystem.batchVerify(["dtu_b1", "dtu_b2", "dtu_missing"]);
      assert.equal(result.ok, true);
      assert.equal(result.total, 3);
      assert.equal(result.validCount, 2);
      assert.equal(result.missingCount, 1);
    });
  });

  // ── getStats / deleteIntegrity ─────────────────────────────────────

  describe("getStats", () => {
    it("returns zeroes initially", () => {
      const stats = system.getStats();
      assert.equal(stats.total, 0);
      assert.equal(stats.invalid, 0);
    });

    it("tracks integrity records", () => {
      system.generateIntegrity(makeDTU({ id: "dtu_s1" }));
      system.generateIntegrity(makeDTU({ id: "dtu_s2" }));
      const stats = system.getStats();
      assert.equal(stats.total, 2);
    });
  });

  describe("deleteIntegrity", () => {
    it("removes an integrity record", () => {
      system.generateIntegrity(makeDTU({ id: "dtu_del" }));
      assert.equal(system.deleteIntegrity("dtu_del"), true);
      assert.equal(system.getStats().total, 0);
    });

    it("returns false for non-existent record", () => {
      assert.equal(system.deleteIntegrity("dtu_nope"), false);
    });
  });

  // ── hashContent utility ────────────────────────────────────────────

  describe("hashContent", () => {
    it("hashes string content", () => {
      const h = system.hashContent("test");
      assert.equal(typeof h, "string");
      assert.equal(h.length, 64);
    });

    it("hashes object content via JSON.stringify", () => {
      const h = system.hashContent({ key: "val" });
      assert.equal(typeof h, "string");
      assert.equal(h.length, 64);
    });
  });
});
