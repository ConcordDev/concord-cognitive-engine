// Tier-2 contract test — Studio Sprint A #3: chord progression mint.
//
// We mock better-sqlite3 since the macro only does a single
// INSERT INTO dtus; the cite path also exercises royalty-cascade
// registration which we stub via dependency injection (the macro
// `await import`s the cascade module — when it can't be loaded
// it returns ok:false with reason:cascade_unavailable, which is
// the contract we assert in CI).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import registerStudioChordMacros from "../domains/studio-chord.js";

function makeFakeDb() {
  const dtus = new Map();
  function prepare(sql) {
    const s = sql.replace(/\s+/g, " ").trim();
    return {
      run: (...args) => {
        if (s.startsWith("INSERT INTO dtus")) {
          const [id, title, creator, meta] = args;
          dtus.set(id, { id, kind: "chord_progression", title, creator_id: creator, meta_json: meta, created_at: Math.floor(Date.now() / 1000) });
          return { changes: 1 };
        }
        return { changes: 0 };
      },
      get: () => null,
      all: (...args) => {
        if (s.includes("FROM dtus WHERE kind = 'chord_progression'")) {
          const [creator] = args;
          return [...dtus.values()].filter(d => d.creator_id === creator);
        }
        return [];
      },
    };
  }
  return { prepare, _tables: { dtus } };
}

function makeRegistry() {
  const macros = new Map();
  const register = (domain, name, handler, opts) => {
    macros.set(`${domain}.${name}`, { handler, opts });
  };
  registerStudioChordMacros(register);
  return macros;
}

describe("studio.mint_progression", () => {
  it("requires a db", async () => {
    const macros = makeRegistry();
    const out = await macros.get("studio.mint_progression").handler({ actor: { userId: "u1" } }, {});
    assert.equal(out.ok, false);
    assert.equal(out.reason, "no_db");
  });

  it("requires an actor", async () => {
    const macros = makeRegistry();
    const out = await macros.get("studio.mint_progression").handler({ db: makeFakeDb() }, {});
    assert.equal(out.ok, false);
    assert.equal(out.reason, "no_actor");
  });

  it("rejects an empty progression", async () => {
    const macros = makeRegistry();
    const ctx = { db: makeFakeDb(), actor: { userId: "u1" } };
    const out = await macros.get("studio.mint_progression").handler(ctx, { progression: [] });
    assert.equal(out.ok, false);
    assert.equal(out.reason, "invalid_progression");
  });

  it("rejects unknown chord qualities", async () => {
    const macros = makeRegistry();
    const ctx = { db: makeFakeDb(), actor: { userId: "u1" } };
    const out = await macros.get("studio.mint_progression").handler(ctx, {
      progression: [{ root: 60, quality: "nonsense", label: "Cnope" }],
    });
    assert.equal(out.ok, false);
  });

  it("mints a valid 4-chord progression with all metadata captured", async () => {
    const macros = makeRegistry();
    const db = makeFakeDb();
    const ctx = { db, actor: { userId: "user_123" } };
    const out = await macros.get("studio.mint_progression").handler(ctx, {
      title: "Test ii-V-I",
      keyRoot: 60,
      mode: "major",
      voiceLeading: "smooth",
      bpm: 110,
      beatsPerChord: 2,
      progression: [
        { root: 62, quality: "min7", label: "Dm7", notes: [62, 65, 69, 72], inversion: 0, variant: "root" },
        { root: 67, quality: "7", label: "G7", notes: [67, 71, 74, 77], inversion: 0, variant: "root" },
        { root: 60, quality: "maj7", label: "Cmaj7", notes: [60, 64, 67, 71], inversion: 0, variant: "root" },
      ],
    });
    assert.equal(out.ok, true);
    assert.equal(out.kind, "chord_progression");
    assert.equal(out.title, "Test ii-V-I");
    assert.ok(out.dtuId);
    assert.equal(out.meta.bpm, 110);
    assert.equal(out.meta.beatsPerChord, 2);
    assert.equal(out.meta.progression.length, 3);
    assert.equal(out.meta.progression[0].label, "Dm7");
    const stored = db._tables.dtus.get(out.dtuId);
    assert.ok(stored, "DTU should be persisted in the fake db");
    assert.equal(stored.kind, "chord_progression");
    assert.equal(stored.creator_id, "user_123");
  });

  it("clamps bpm to [20, 400]", async () => {
    const macros = makeRegistry();
    const ctx = { db: makeFakeDb(), actor: { userId: "u1" } };
    const out = await macros.get("studio.mint_progression").handler(ctx, {
      bpm: 9999,
      progression: [{ root: 60, quality: "maj", label: "C", notes: [60, 64, 67], inversion: 0, variant: "root" }],
    });
    assert.equal(out.ok, true);
    assert.equal(out.meta.bpm, 400);
  });

  it("clamps title to 120 chars", async () => {
    const macros = makeRegistry();
    const ctx = { db: makeFakeDb(), actor: { userId: "u1" } };
    const longTitle = "x".repeat(500);
    const out = await macros.get("studio.mint_progression").handler(ctx, {
      title: longTitle,
      progression: [{ root: 60, quality: "maj", label: "C", notes: [60, 64, 67], inversion: 0, variant: "root" }],
    });
    assert.equal(out.ok, true);
    assert.equal(out.title.length, 120);
  });

  it("caps progression at 64 chords", async () => {
    const macros = makeRegistry();
    const ctx = { db: makeFakeDb(), actor: { userId: "u1" } };
    const progression = Array.from({ length: 100 }, () => ({
      root: 60, quality: "maj", label: "C", notes: [60, 64, 67], inversion: 0, variant: "root",
    }));
    const out = await macros.get("studio.mint_progression").handler(ctx, { progression });
    assert.equal(out.ok, false);
    assert.equal(out.reason, "invalid_progression");
  });
});

describe("studio.list_progressions", () => {
  it("returns minted progressions for the user", async () => {
    const macros = makeRegistry();
    const db = makeFakeDb();
    const ctx = { db, actor: { userId: "user_x" } };
    await macros.get("studio.mint_progression").handler(ctx, {
      title: "P1",
      progression: [{ root: 60, quality: "maj", label: "C", notes: [60, 64, 67], inversion: 0, variant: "root" }],
    });
    const list = await macros.get("studio.list_progressions").handler(ctx, {});
    assert.equal(list.ok, true);
    assert.equal(list.progressions.length, 1);
    assert.equal(list.progressions[0].title, "P1");
  });

  it("only shows the caller's progressions", async () => {
    const macros = makeRegistry();
    const db = makeFakeDb();
    await macros.get("studio.mint_progression").handler(
      { db, actor: { userId: "alice" } },
      { title: "alice-one", progression: [{ root: 60, quality: "maj", label: "C", notes: [60, 64, 67], inversion: 0, variant: "root" }] },
    );
    const bobList = await macros.get("studio.list_progressions").handler({ db, actor: { userId: "bob" } }, {});
    assert.equal(bobList.ok, true);
    assert.equal(bobList.progressions.length, 0);
  });
});
