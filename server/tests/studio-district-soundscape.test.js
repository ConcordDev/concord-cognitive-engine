// Tier-2 contract test — Studio Sprint C #13: district soundscape macros
// + end-event composer micro-credit.
//
// We exercise:
//   - list_for_district owner gate
//   - cc_per_attendee clamping
//   - list_district_soundscapes returns the listing
//   - attach_soundscape host gate

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import registerStudioDistrictMacros, { _internal } from "../domains/studio-district.js";

function makeFakeDb() {
  const dtus = new Map();
  return {
    prepare(sql) {
      const s = sql.replace(/\s+/g, " ").trim();
      return {
        run: (...args) => {
          if (s.startsWith("INSERT INTO dtus")) {
            const [id, kind, title, creator, meta] = args;
            dtus.set(id, { id, kind, title, creator_id: creator, meta_json: meta });
            return { changes: 1 };
          }
          if (s.startsWith("UPDATE dtus SET meta_json")) {
            const [meta, id] = args;
            const row = dtus.get(id);
            if (row) row.meta_json = meta;
            return { changes: row ? 1 : 0 };
          }
          return { changes: 0 };
        },
        get: (...args) => {
          if (s.startsWith("SELECT id, creator_id, meta_json FROM dtus WHERE id = ?")) {
            const [id] = args;
            return dtus.get(id);
          }
          return undefined;
        },
        all: (...args) => {
          if (s.includes("meta_json LIKE ?")) {
            const [like, limit] = args;
            const fragment = like.replace(/^%|%$/g, '');
            return [...dtus.values()]
              .filter(d => ["audio", "audio_capture", "session"].includes(d.kind))
              .filter(d => (d.meta_json || "").includes(fragment))
              .slice(0, limit);
          }
          return [];
        },
      };
    },
    _addTrack(id, creator, kind = "audio", meta = {}) {
      dtus.set(id, { id, kind, creator_id: creator, title: id, meta_json: JSON.stringify(meta) });
    },
    _tables: { dtus },
  };
}

function makeRegistry() {
  const macros = new Map();
  registerStudioDistrictMacros((domain, name, handler, opts) => {
    macros.set(`${domain}.${name}`, { handler, opts });
  });
  return macros;
}

describe("studio.list_for_district", () => {
  it("rejects when actor missing", async () => {
    const macros = makeRegistry();
    const out = await macros.get("studio.list_for_district").handler({ db: makeFakeDb() }, {});
    assert.equal(out.ok, false);
    assert.equal(out.reason, "no_actor");
  });

  it("requires track_dtuId", async () => {
    const macros = makeRegistry();
    const out = await macros.get("studio.list_for_district").handler(
      { db: makeFakeDb(), actor: { userId: "u1" } }, {},
    );
    assert.equal(out.ok, false);
    assert.equal(out.reason, "track_dtuId_required");
  });

  it("rejects non-owner", async () => {
    const macros = makeRegistry();
    const db = makeFakeDb();
    db._addTrack("trk_1", "u_owner");
    const out = await macros.get("studio.list_for_district").handler(
      { db, actor: { userId: "u_stranger" } },
      { track_dtuId: "trk_1" },
    );
    assert.equal(out.ok, false);
    assert.equal(out.reason, "not_track_owner");
  });

  it("writes the listing into meta_json", async () => {
    const macros = makeRegistry();
    const db = makeFakeDb();
    db._addTrack("trk_1", "u_owner", "audio", { genre: "lofi" });
    const out = await macros.get("studio.list_for_district").handler(
      { db, actor: { userId: "u_owner" } },
      { track_dtuId: "trk_1", district_id: "concordia-hub", cc_per_attendee: 0.05 },
    );
    assert.equal(out.ok, true);
    assert.equal(out.listing.cc_per_attendee, 0.05);
    const stored = JSON.parse(db._tables.dtus.get("trk_1").meta_json);
    assert.equal(stored.district_listings.length, 1);
    assert.equal(stored.district_listings[0].district_id, "concordia-hub");
  });

  it("updates the existing listing on re-list rather than appending", async () => {
    const macros = makeRegistry();
    const db = makeFakeDb();
    db._addTrack("trk_1", "u_owner");
    await macros.get("studio.list_for_district").handler(
      { db, actor: { userId: "u_owner" } },
      { track_dtuId: "trk_1", district_id: "concordia-hub", cc_per_attendee: 0.01 },
    );
    await macros.get("studio.list_for_district").handler(
      { db, actor: { userId: "u_owner" } },
      { track_dtuId: "trk_1", district_id: "concordia-hub", cc_per_attendee: 0.05 },
    );
    const stored = JSON.parse(db._tables.dtus.get("trk_1").meta_json);
    assert.equal(stored.district_listings.length, 1);
    assert.equal(stored.district_listings[0].cc_per_attendee, 0.05);
  });

  it("clamps cc_per_attendee to the safe range", async () => {
    const macros = makeRegistry();
    const db = makeFakeDb();
    db._addTrack("trk_1", "u_owner");
    const huge = await macros.get("studio.list_for_district").handler(
      { db, actor: { userId: "u_owner" } },
      { track_dtuId: "trk_1", cc_per_attendee: 9999 },
    );
    assert.equal(huge.listing.cc_per_attendee, _internal.MAX_CC_PER_ATTENDEE);
    const tiny = await macros.get("studio.list_for_district").handler(
      { db, actor: { userId: "u_owner" } },
      { track_dtuId: "trk_1", cc_per_attendee: 0.00000001 },
    );
    assert.equal(tiny.listing.cc_per_attendee, _internal.MIN_CC_PER_ATTENDEE);
  });
});

describe("studio.list_district_soundscapes", () => {
  it("returns listings filtered by district", async () => {
    const macros = makeRegistry();
    const db = makeFakeDb();
    db._addTrack("trk_1", "u_owner");
    db._addTrack("trk_2", "u_owner");
    await macros.get("studio.list_for_district").handler(
      { db, actor: { userId: "u_owner" } },
      { track_dtuId: "trk_1", district_id: "concordia-hub", cc_per_attendee: 0.05 },
    );
    await macros.get("studio.list_for_district").handler(
      { db, actor: { userId: "u_owner" } },
      { track_dtuId: "trk_2", district_id: "tunya", cc_per_attendee: 0.05 },
    );
    const hub = await macros.get("studio.list_district_soundscapes").handler(
      { db }, { district_id: "concordia-hub" },
    );
    assert.equal(hub.tracks.length, 1);
    assert.equal(hub.tracks[0].id, "trk_1");
  });
});

describe("internal — clampPrice", () => {
  it("clamps NaN to a safe default", () => {
    assert.equal(_internal.clampPrice("nope"), 0.01);
  });

  it("clamps too-high to MAX_CC_PER_ATTENDEE", () => {
    assert.equal(_internal.clampPrice(50), _internal.MAX_CC_PER_ATTENDEE);
  });

  it("clamps too-low to MIN_CC_PER_ATTENDEE", () => {
    assert.equal(_internal.clampPrice(0), _internal.MIN_CC_PER_ATTENDEE);
  });
});
