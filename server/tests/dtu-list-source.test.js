import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  noteDtuWrite,
  sidecarListTotal,
  shouldFallbackFromSidecarList,
  dtuMatchesQuery,
  dtuListedOwner,
  dtuMatchesTagFilter,
  tagFilterTerms,
  resolveListLimit,
  shapePaginatedBody,
  SIDECAR_REFRESH_MS,
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
} from "../lib/dtu-list-source.js";

describe("dtu list source", () => {
  it("falls back when a query hits an empty sidecar cache", () => {
    assert.equal(shouldFallbackFromSidecarList({ ok: true, dtus: [], total: 0 }, { q: "helix" }), true);
    assert.equal(shouldFallbackFromSidecarList({ ok: true, dtus: [{ id: "a" }], total: 1 }, { q: "helix" }), false);
  });

  it("falls back when the sidecar index is older than the last write", () => {
    const now = 10_000;
    assert.equal(shouldFallbackFromSidecarList(
      { ok: true, dtus: [{ id: "stale" }], total: 1, indexedThrough: 1000 },
      { q: "helix", lastWriteAt: 2000, now },
    ), true);
  });

  it("falls back during the refresh window when the sidecar did not report freshness", () => {
    const now = 5_000;
    assert.equal(shouldFallbackFromSidecarList(
      { ok: true, dtus: [{ id: "maybe" }], total: 1 },
      { q: "helix", lastWriteAt: now - 1000, now },
    ), true);
    assert.equal(shouldFallbackFromSidecarList(
      { ok: true, dtus: [{ id: "settled" }], total: 1 },
      { q: "helix", lastWriteAt: now - SIDECAR_REFRESH_MS - 1, now },
    ), false);
  });

  it("does not disable the sidecar for an unqueried list", () => {
    noteDtuWrite(1);
    assert.equal(shouldFallbackFromSidecarList({ ok: true, dtus: [], total: 0 }, { q: "", lastWriteAt: Date.now() }), false);
  });

  it("falls back for an empty mine, a tag filter, and a signed-in search", () => {
    assert.equal(shouldFallbackFromSidecarList(
      { ok: true, dtus: [], total: 0 },
      { mine: true, viewer: "owner-1" },
    ), true);
    assert.equal(shouldFallbackFromSidecarList(
      { ok: true, dtus: [{ id: "public" }], total: 1 },
      { tag: "osr770726" },
    ), true);
    assert.equal(shouldFallbackFromSidecarList(
      { ok: true, dtus: [{ id: "other" }], total: 1 },
      { q: "helix", viewer: "owner-1" },
    ), true);
  });

  it("falls back when a mine page is older than a write inside the refresh window", () => {
    const now = 20_000;
    assert.equal(shouldFallbackFromSidecarList(
      { ok: true, dtus: [{ id: "old", createdAt: "1970-01-01T00:00:01.000Z" }], total: 1, indexedThrough: now },
      { mine: true, viewer: "owner-1", lastWriteAt: now - 500, now },
    ), true);
    assert.equal(shouldFallbackFromSidecarList(
      { ok: true, dtus: [{ id: "fresh", createdAt: new Date(now - 100).toISOString() }], total: 1, indexedThrough: now },
      { mine: true, viewer: "owner-1", lastWriteAt: now - 500, now },
    ), false);
  });

  it("caps an omitted list limit and keeps an explicit limit", () => {
    assert.equal(resolveListLimit(undefined), DEFAULT_LIST_LIMIT);
    assert.equal(resolveListLimit(""), DEFAULT_LIST_LIMIT);
    assert.equal(resolveListLimit("200"), 200);
    assert.equal(resolveListLimit(9000), MAX_LIST_LIMIT);
    assert.equal(DEFAULT_LIST_LIMIT, 50);
  });

  it("matches an owner on author or ownerId and a tag case-insensitively", () => {
    assert.equal(dtuListedOwner({ author: "a", ownerId: "b" }), "a");
    assert.equal(dtuListedOwner({ ownerId: "b" }), "b");
    assert.equal(dtuListedOwner({ authorId: "c" }), "c");
    assert.deepEqual(tagFilterTerms("Alpha, beta"), ["alpha", "beta"]);
    assert.equal(dtuMatchesTagFilter({ tags: ["OSR770726"] }, ["osr770726"]), true);
    assert.equal(dtuMatchesTagFilter({ tags: ["other"] }, ["osr770726"]), false);
  });

  it("repairs a zero total when the sidecar returned rows", () => {
    assert.equal(sidecarListTotal({ dtus: [{ id: "a" }, { id: "b" }], total: 0 }), 2);
    assert.equal(sidecarListTotal({ dtus: [], total: 0 }), 0);
    assert.equal(sidecarListTotal({ dtus: [{ id: "a" }], total: 9 }), 9);
  });

  it("matches title, content, and summary", () => {
    const dtu = { title: "Vault note", content: "helix body", human: { summary: "morning" }, tags: ["lattice"] };
    assert.equal(dtuMatchesQuery(dtu, "helix"), true);
    assert.equal(dtuMatchesQuery(dtu, "morning"), true);
    assert.equal(dtuMatchesQuery(dtu, "lattice"), true);
    assert.equal(dtuMatchesQuery(dtu, "absent"), false);
    assert.equal(dtuMatchesQuery(dtu, ""), true);
    assert.equal(dtuMatchesQuery({ creti: { clarity: 0.2 }, title: "scores" }, "clarity"), false);
  });

  it("emits a top-level total and uses the page length when the reported total is 0", () => {
    const shaped = shapePaginatedBody({
      items: [{ id: "a" }],
      pagination: { page: 1, pageSize: 20, total: 0, hasNext: false },
    });
    assert.equal(shaped.total, 1);
    assert.equal(shaped.dtus.length, 1);
    assert.equal(shaped.pagination.total, 1);
    assert.equal(shaped.hasMore, false);

    const counted = shapePaginatedBody({
      items: [{ id: "a" }],
      pagination: { total: 40, hasNext: true },
    });
    assert.equal(counted.total, 40);
    assert.equal(counted.hasMore, true);
  });
});
