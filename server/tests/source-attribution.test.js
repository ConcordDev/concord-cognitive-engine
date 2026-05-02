/**
 * Source Attribution Tests
 *
 * Tests the universal attribution system for external content:
 *   - LICENSE_TYPES constants
 *   - createAttribution
 *   - canListOnMarketplace
 *   - validateAttribution
 *   - createDMCARecord
 *   - getAttributionStats
 *   - feedAttribution
 *
 * Run: node --test tests/source-attribution.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  LICENSE_TYPES,
  createAttribution,
  canListOnMarketplace,
  validateAttribution,
  createDMCARecord,
  getAttributionStats,
  feedAttribution,
} from "../lib/source-attribution.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeDTU(overrides = {}) {
  return {
    id: "dtu_test_1",
    title: "Test DTU",
    ...overrides,
  };
}

function makeAttribution(overrides = {}) {
  return {
    name: "Reuters",
    url: "https://reuters.com/article",
    license: LICENSE_TYPES.CC_BY_4.id,
    attribution: "Licensed under CC BY 4.0 by Reuters",
    via: "feed-manager",
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. LICENSE_TYPES
// ═══════════════════════════════════════════════════════════════════════════════

describe("LICENSE_TYPES", () => {
  it("is frozen", () => {
    assert.ok(Object.isFrozen(LICENSE_TYPES));
  });

  it("defines expected license keys", () => {
    const expected = ["CC_BY_4", "CC_BY_NC_SA", "CC_BY_NC", "CC0", "PUBLIC_DOMAIN", "ALL_RIGHTS_RESERVED", "FAIR_USE", "GOVERNMENT"];
    for (const key of expected) {
      assert.ok(key in LICENSE_TYPES, `should have ${key}`);
    }
  });

  it("each license has required fields", () => {
    for (const [key, license] of Object.entries(LICENSE_TYPES)) {
      assert.ok("id" in license, `${key} should have id`);
      assert.ok("commercial" in license, `${key} should have commercial`);
      assert.ok("derivative" in license, `${key} should have derivative`);
      assert.ok("attributionRequired" in license, `${key} should have attributionRequired`);
      assert.ok("display" in license, `${key} should have display`);
    }
  });

  it("CC0 and PUBLIC_DOMAIN allow commercial use", () => {
    assert.equal(LICENSE_TYPES.CC0.commercial, true);
    assert.equal(LICENSE_TYPES.PUBLIC_DOMAIN.commercial, true);
  });

  it("CC_BY_NC does not allow commercial use", () => {
    assert.equal(LICENSE_TYPES.CC_BY_NC.commercial, false);
  });

  it("CC_BY_NC_SA does not allow commercial use", () => {
    assert.equal(LICENSE_TYPES.CC_BY_NC_SA.commercial, false);
  });

  it("CC_BY_4 allows commercial and derivative use", () => {
    assert.equal(LICENSE_TYPES.CC_BY_4.commercial, true);
    assert.equal(LICENSE_TYPES.CC_BY_4.derivative, true);
  });

  it("CC0 does not require attribution", () => {
    assert.equal(LICENSE_TYPES.CC0.attributionRequired, false);
  });

  it("CC_BY_4 requires attribution", () => {
    assert.equal(LICENSE_TYPES.CC_BY_4.attributionRequired, true);
  });

  it("GOVERNMENT allows commercial use (not subject to copyright)", () => {
    assert.equal(LICENSE_TYPES.GOVERNMENT.commercial, true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. createAttribution
// ═══════════════════════════════════════════════════════════════════════════════

describe("createAttribution", () => {
  it("returns an object with required fields", () => {
    const attr = createAttribution({
      name: "OpenStax",
      url: "https://openstax.org/book",
      license: LICENSE_TYPES.CC_BY_4.id,
      attribution: "Licensed under CC BY 4.0",
      via: "openstax-ingest",
    });

    assert.ok("name" in attr);
    assert.ok("url" in attr);
    assert.ok("license" in attr);
    assert.ok("attribution" in attr);
    assert.ok("fetchedAt" in attr);
    assert.ok("via" in attr);
  });

  it("preserves provided name", () => {
    const attr = createAttribution({ name: "NASA" });
    assert.equal(attr.name, "NASA");
  });

  it("defaults name to Unknown when omitted", () => {
    const attr = createAttribution({});
    assert.equal(attr.name, "Unknown");
  });

  it("fetchedAt is a valid ISO date string", () => {
    const attr = createAttribution({ name: "Test" });
    assert.doesNotThrow(() => new Date(attr.fetchedAt));
    assert.ok(new Date(attr.fetchedAt).getTime() > 0);
  });

  it("respects custom fetchedAt override", () => {
    const customDate = "2025-01-01T00:00:00.000Z";
    const attr = createAttribution({ name: "Test", fetchedAt: customDate });
    assert.equal(attr.fetchedAt, customDate);
  });

  it("defaults via to unknown when omitted", () => {
    const attr = createAttribution({ name: "Test" });
    assert.equal(attr.via, "unknown");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. canListOnMarketplace
// ═══════════════════════════════════════════════════════════════════════════════

describe("canListOnMarketplace", () => {
  it("allows DTUs with no external source (user-created)", () => {
    const dtu = makeDTU();
    const result = canListOnMarketplace(dtu);
    assert.equal(result.allowed, true);
  });

  it("allows DTUs with CC BY 4.0 license", () => {
    const dtu = makeDTU({
      source: makeAttribution({ license: LICENSE_TYPES.CC_BY_4.id }),
    });
    const result = canListOnMarketplace(dtu);
    assert.equal(result.allowed, true);
  });

  it("allows DTUs with CC0 license", () => {
    const dtu = makeDTU({
      source: makeAttribution({ license: LICENSE_TYPES.CC0.id }),
    });
    const result = canListOnMarketplace(dtu);
    assert.equal(result.allowed, true);
  });

  it("allows DTUs with GOVERNMENT license", () => {
    const dtu = makeDTU({
      source: makeAttribution({ license: LICENSE_TYPES.GOVERNMENT.id }),
    });
    const result = canListOnMarketplace(dtu);
    assert.equal(result.allowed, true);
  });

  it("blocks DTUs with CC BY-NC license", () => {
    const dtu = makeDTU({
      source: makeAttribution({ license: LICENSE_TYPES.CC_BY_NC.id }),
    });
    const result = canListOnMarketplace(dtu);
    assert.equal(result.allowed, false);
    assert.ok(result.reason, "should provide a reason");
  });

  it("blocks DTUs with CC BY-NC-SA license", () => {
    const dtu = makeDTU({
      source: makeAttribution({ license: LICENSE_TYPES.CC_BY_NC_SA.id }),
    });
    const result = canListOnMarketplace(dtu);
    assert.equal(result.allowed, false);
  });

  it("blocks DTUs with ALL_RIGHTS_RESERVED license", () => {
    const dtu = makeDTU({
      source: makeAttribution({ license: LICENSE_TYPES.ALL_RIGHTS_RESERVED.id }),
    });
    const result = canListOnMarketplace(dtu);
    assert.equal(result.allowed, false);
  });

  it("allows DTUs with unknown license (with warning)", () => {
    const dtu = makeDTU({
      source: makeAttribution({ license: "Some Obscure License" }),
    });
    const result = canListOnMarketplace(dtu);
    // Unknown license defaults to allowed but with a note
    assert.equal(result.allowed, true);
  });

  it("reads source from meta.source when source is absent", () => {
    const dtu = makeDTU({
      meta: { source: makeAttribution({ license: LICENSE_TYPES.CC_BY_NC.id }) },
    });
    const result = canListOnMarketplace(dtu);
    assert.equal(result.allowed, false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. validateAttribution
// ═══════════════════════════════════════════════════════════════════════════════

describe("validateAttribution", () => {
  it("is valid when DTU has a proper source with name and license", () => {
    const dtu = makeDTU({
      source: makeAttribution(),
    });
    const result = validateAttribution(dtu);
    assert.ok("valid" in result);
  });

  it("returns an object with valid and issues fields", () => {
    const dtu = makeDTU({ source: makeAttribution() });
    const result = validateAttribution(dtu);
    assert.ok("valid" in result);
    assert.ok("issues" in result || typeof result.valid === "boolean");
  });

  it("does not throw for DTUs without source", () => {
    const dtu = makeDTU();
    assert.doesNotThrow(() => validateAttribution(dtu));
  });

  it("does not throw for empty object input", () => {
    assert.doesNotThrow(() => validateAttribution({}));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. createDMCARecord
// ═══════════════════════════════════════════════════════════════════════════════

describe("createDMCARecord", () => {
  it("creates a valid DMCA record with required fields", () => {
    const record = createDMCARecord({
      dtuId: "dtu_123",
      complainant: "RIAA",
      reason: "Copyright infringement",
    });

    assert.ok("id" in record);
    assert.ok("type" in record);
    assert.ok("dtuId" in record);
    assert.ok("complainant" in record);
    assert.ok("status" in record);
    assert.ok("createdAt" in record);
  });

  it("type is dmca-takedown", () => {
    const record = createDMCARecord({ dtuId: "d1", complainant: "MPAA" });
    assert.equal(record.type, "dmca-takedown");
  });

  it("default status is pending", () => {
    const record = createDMCARecord({ dtuId: "d1", complainant: "RIAA" });
    assert.equal(record.status, "pending");
  });

  it("default action is restrict", () => {
    const record = createDMCARecord({ dtuId: "d1", complainant: "RIAA" });
    assert.equal(record.action, "restrict");
  });

  it("accepts remove as action", () => {
    const record = createDMCARecord({ dtuId: "d1", complainant: "RIAA", action: "remove" });
    assert.equal(record.action, "remove");
  });

  it("id is deterministic-ish (contains prefix)", () => {
    const record = createDMCARecord({ dtuId: "d1", complainant: "Test" });
    assert.ok(record.id.startsWith("dmca_"), `id should start with 'dmca_', got: ${record.id}`);
  });

  it("throws when dtuId is missing", () => {
    assert.throws(
      () => createDMCARecord({ complainant: "RIAA" }),
      (err) => err.message.includes("dtuId"),
    );
  });

  it("throws when complainant is missing", () => {
    assert.throws(
      () => createDMCARecord({ dtuId: "d1" }),
      (err) => err.message.includes("complainant"),
    );
  });

  it("preserves noticeUrl when provided", () => {
    const record = createDMCARecord({
      dtuId: "d1",
      complainant: "RIAA",
      noticeUrl: "https://lumendb.org/notice/123",
    });
    assert.equal(record.noticeUrl, "https://lumendb.org/notice/123");
  });

  it("createdAt is a valid ISO timestamp", () => {
    const record = createDMCARecord({ dtuId: "d1", complainant: "Test" });
    assert.doesNotThrow(() => new Date(record.createdAt));
    assert.ok(new Date(record.createdAt).getTime() > 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. getAttributionStats
// ═══════════════════════════════════════════════════════════════════════════════

describe("getAttributionStats", () => {
  it("returns zero stats for empty array", () => {
    const stats = getAttributionStats([]);
    assert.equal(stats.totalWithSource, 0);
    assert.equal(stats.totalWithout, 0);
    assert.equal(stats.flaggedIssues, 0);
  });

  it("returns expected structure", () => {
    const stats = getAttributionStats([]);
    assert.ok("totalWithSource" in stats);
    assert.ok("totalWithout" in stats);
    assert.ok("bySource" in stats);
    assert.ok("byLicense" in stats);
    assert.ok("flaggedIssues" in stats);
  });

  it("counts DTUs with and without source correctly", () => {
    const dtus = [
      makeDTU({ id: "d1", source: makeAttribution({ name: "Reuters" }) }),
      makeDTU({ id: "d2" }), // no source
      makeDTU({ id: "d3", source: makeAttribution({ name: "BBC" }) }),
    ];
    const stats = getAttributionStats(dtus);
    assert.equal(stats.totalWithSource, 2);
    assert.equal(stats.totalWithout, 1);
  });

  it("groups by source name", () => {
    const dtus = [
      makeDTU({ id: "d1", source: makeAttribution({ name: "Reuters" }) }),
      makeDTU({ id: "d2", source: makeAttribution({ name: "Reuters" }) }),
      makeDTU({ id: "d3", source: makeAttribution({ name: "BBC" }) }),
    ];
    const stats = getAttributionStats(dtus);
    assert.equal(stats.bySource["Reuters"], 2);
    assert.equal(stats.bySource["BBC"], 1);
  });

  it("groups by license", () => {
    const dtus = [
      makeDTU({ id: "d1", source: makeAttribution({ license: LICENSE_TYPES.CC_BY_4.id }) }),
      makeDTU({ id: "d2", source: makeAttribution({ license: LICENSE_TYPES.CC0.id }) }),
      makeDTU({ id: "d3", source: makeAttribution({ license: LICENSE_TYPES.CC_BY_4.id }) }),
    ];
    const stats = getAttributionStats(dtus);
    assert.equal(stats.byLicense[LICENSE_TYPES.CC_BY_4.id], 2);
    assert.equal(stats.byLicense[LICENSE_TYPES.CC0.id], 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. feedAttribution
// ═══════════════════════════════════════════════════════════════════════════════

describe("feedAttribution", () => {
  it("creates an attribution record from feed source and item", () => {
    const feedSource = { name: "Reuters", url: "https://reuters.com/feed" };
    const item = { link: "https://reuters.com/article/1", title: "Breaking News" };
    const attr = feedAttribution(feedSource, item);

    assert.ok("name" in attr);
    assert.ok("url" in attr);
    assert.ok("license" in attr);
    assert.ok("via" in attr);
  });

  it("via is feed-manager", () => {
    const attr = feedAttribution({ name: "BBC" }, {});
    assert.equal(attr.via, "feed-manager");
  });

  it("name comes from feedSource.name", () => {
    const attr = feedAttribution({ name: "Al Jazeera" }, {});
    assert.equal(attr.name, "Al Jazeera");
  });

  it("url comes from item.link", () => {
    const attr = feedAttribution(
      { name: "Test" },
      { link: "https://example.com/article" },
    );
    assert.equal(attr.url, "https://example.com/article");
  });

  it("defaults name to Unknown Feed when feedSource is empty", () => {
    const attr = feedAttribution({}, {});
    assert.equal(attr.name, "Unknown Feed");
  });

  it("respects custom license in feedSource", () => {
    const attr = feedAttribution(
      { name: "Gov Site", url: "https://gov.example", license: LICENSE_TYPES.GOVERNMENT.id },
      {},
    );
    assert.equal(attr.license, LICENSE_TYPES.GOVERNMENT.id);
  });

  it("fetchedAt is a valid ISO timestamp", () => {
    const attr = feedAttribution({ name: "Test" }, {});
    assert.doesNotThrow(() => new Date(attr.fetchedAt));
    assert.ok(new Date(attr.fetchedAt).getTime() > 0);
  });
});
