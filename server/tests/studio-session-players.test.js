// Tier-2 contract test — Studio Sprint B #1: Session Players.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  summonPlayer, generatePattern, mentorPlayer, publishPlayer,
  listPlayersForUser, ROLES, _internal,
} from "../lib/studio/session-players.js";

function makeFakeDb() {
  const dtus = new Map();
  let listingId = 0;
  return {
    prepare(sql) {
      const s = sql.replace(/\s+/g, " ").trim();
      return {
        run: (...args) => {
          if (s.startsWith("INSERT INTO dtus")) {
            const [id, title, creator, meta] = args;
            // Kind is hard-coded in the SQL for these inserts.
            const kind = s.includes("'session_player'") ? "session_player"
              : s.includes("'agent_spec'") ? "agent_spec" : "unknown";
            dtus.set(id, { id, kind, title, creator_id: creator, meta_json: meta, created_at: Math.floor(Date.now() / 1000) });
            return { changes: 1 };
          }
          if (s.startsWith("UPDATE dtus SET meta_json")) {
            const [meta, id] = args;
            const row = dtus.get(id);
            if (row) row.meta_json = meta;
            return { changes: row ? 1 : 0 };
          }
          if (s.startsWith("INSERT INTO creative_artifact_listings") || s.startsWith("INSERT INTO marketplace_listings")) {
            listingId += 1;
            return { changes: 1, lastInsertRowid: listingId };
          }
          return { changes: 0 };
        },
        get: (...args) => {
          if (s.startsWith("SELECT id, kind, title, creator_id, meta_json FROM dtus WHERE id = ?")) {
            const [id] = args;
            return dtus.get(id);
          }
          if (s.startsWith("SELECT id, creator_id, meta_json FROM dtus WHERE id = ?")) {
            const [id] = args;
            const row = dtus.get(id);
            if (!row) return undefined;
            return { id: row.id, creator_id: row.creator_id, meta_json: row.meta_json };
          }
          return undefined;
        },
        all: (...args) => {
          if (s.includes("FROM dtus") && s.includes("kind = 'session_player'")) {
            const [creator] = args;
            return [...dtus.values()].filter(d => d.kind === "session_player" && d.creator_id === creator);
          }
          return [];
        },
      };
    },
    _tables: { dtus },
  };
}

describe("summonPlayer", () => {
  it("rejects unknown roles", () => {
    const db = makeFakeDb();
    const r = summonPlayer(db, { userId: "u1", role: "bagpiper" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_role");
    assert.deepEqual(r.roles, ROLES);
  });

  it("creates a kind='session_player' DTU for each role", () => {
    for (const role of ROLES) {
      const db = makeFakeDb();
      const r = summonPlayer(db, { userId: "u1", role });
      assert.equal(r.ok, true, `summon failed for ${role}`);
      assert.equal(r.role, role);
      const stored = db._tables.dtus.get(r.playerId);
      assert.equal(stored.kind, "session_player");
      const meta = JSON.parse(stored.meta_json);
      assert.equal(meta.role, role);
      assert.equal(meta.generation_count, 0);
      assert.deepEqual(meta.mentorship_log, []);
    }
  });

  it("uses provided name or falls back to role title", () => {
    const db = makeFakeDb();
    const r1 = summonPlayer(db, { userId: "u1", role: "drummer", name: "Pocket Pete" });
    assert.equal(r1.title, "Pocket Pete");
    const r2 = summonPlayer(db, { userId: "u1", role: "drummer" });
    assert.equal(r2.title, "Session Drummer");
  });
});

describe("generatePattern (deterministic)", () => {
  it("requires a valid player", async () => {
    const db = makeFakeDb();
    const r = await generatePattern(db, { userId: "u1", playerId: "missing" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "player_not_found");
  });

  it("rejects non-owner generations by default", async () => {
    const db = makeFakeDb();
    const { playerId } = summonPlayer(db, { userId: "alice", role: "drummer" });
    const r = await generatePattern(db, { userId: "bob", playerId });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_owner");
  });

  it("produces drumkit pitches in deterministic drummer fallback", async () => {
    const db = makeFakeDb();
    const { playerId } = summonPlayer(db, { userId: "u1", role: "drummer" });
    const r = await generatePattern(db, { userId: "u1", playerId, bars: 2, deterministic: true });
    assert.equal(r.ok, true);
    assert.equal(r.composer, "deterministic");
    const pitches = new Set(r.notes.map(n => n.pitch));
    assert.ok(pitches.has(36), "kick");
    assert.ok(pitches.has(38), "snare");
    assert.ok(pitches.has(42), "closed hat");
  });

  it("produces bass pitches in the bass range (28..55)", async () => {
    const db = makeFakeDb();
    const { playerId } = summonPlayer(db, { userId: "u1", role: "bass_player" });
    const r = await generatePattern(db, { userId: "u1", playerId, bars: 1, deterministic: true });
    for (const n of r.notes) {
      assert.ok(n.pitch >= 28 && n.pitch <= 55, `bass pitch out of range: ${n.pitch}`);
    }
  });

  it("increments generation_count on each call", async () => {
    const db = makeFakeDb();
    const { playerId } = summonPlayer(db, { userId: "u1", role: "drummer" });
    await generatePattern(db, { userId: "u1", playerId, bars: 1, deterministic: true });
    await generatePattern(db, { userId: "u1", playerId, bars: 1, deterministic: true });
    const stored = db._tables.dtus.get(playerId);
    const meta = JSON.parse(stored.meta_json);
    assert.equal(meta.generation_count, 2);
  });
});

describe("mentorPlayer", () => {
  it("appends feedback to the mentorship_log", () => {
    const db = makeFakeDb();
    const { playerId } = summonPlayer(db, { userId: "u1", role: "drummer" });
    const r = mentorPlayer(db, { userId: "u1", playerId, feedback: "more snare on the and-of-2" });
    assert.equal(r.ok, true);
    assert.equal(r.log_size, 1);
    const meta = JSON.parse(db._tables.dtus.get(playerId).meta_json);
    assert.equal(meta.mentorship_log[0].feedback, "more snare on the and-of-2");
  });

  it("rejects non-owners", () => {
    const db = makeFakeDb();
    const { playerId } = summonPlayer(db, { userId: "alice", role: "drummer" });
    const r = mentorPlayer(db, { userId: "bob", playerId, feedback: "tighter" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_owner");
  });

  it("rejects empty feedback", () => {
    const db = makeFakeDb();
    const { playerId } = summonPlayer(db, { userId: "u1", role: "drummer" });
    const r = mentorPlayer(db, { userId: "u1", playerId, feedback: "   " });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "empty_feedback");
  });

  it("nudges skill_level upward per accepted feedback", () => {
    const db = makeFakeDb();
    const { playerId } = summonPlayer(db, { userId: "u1", role: "drummer" });
    mentorPlayer(db, { userId: "u1", playerId, feedback: "lay back behind the beat" });
    mentorPlayer(db, { userId: "u1", playerId, feedback: "push the hats" });
    const meta = JSON.parse(db._tables.dtus.get(playerId).meta_json);
    assert.ok(meta.skill_level > 1, "skill_level should grow");
  });
});

describe("publishPlayer", () => {
  it("requires the player to exist", async () => {
    const db = makeFakeDb();
    const r = await publishPlayer(db, { userId: "u1", playerId: "missing" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "player_not_found");
  });

  it("rejects non-owner publishes", async () => {
    const db = makeFakeDb();
    const { playerId } = summonPlayer(db, { userId: "alice", role: "drummer" });
    const r = await publishPlayer(db, { userId: "bob", playerId });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_owner");
  });

  it("mints a kind='agent_spec' DTU when publishing", async () => {
    const db = makeFakeDb();
    const { playerId } = summonPlayer(db, { userId: "u1", role: "drummer" });
    const r = await publishPlayer(db, {
      userId: "u1", playerId, priceCents: 0, license: "MIT", summary: "Drum maestro",
    });
    assert.equal(r.ok, true);
    assert.ok(r.agentDtuId);
    const agent = db._tables.dtus.get(r.agentDtuId);
    assert.equal(agent.kind, "agent_spec");
    const agentMeta = JSON.parse(agent.meta_json);
    const caps = agentMeta.capabilities || [];
    assert.ok(caps.includes("_llm") || caps.some(c => c === "_llm" || c.toString().includes("_llm")), "_llm capability must be present");
  });
});

describe("listPlayersForUser", () => {
  it("returns only the caller's players", () => {
    const db = makeFakeDb();
    summonPlayer(db, { userId: "alice", role: "drummer" });
    summonPlayer(db, { userId: "alice", role: "bass_player" });
    summonPlayer(db, { userId: "bob", role: "drummer" });
    assert.equal(listPlayersForUser(db, "alice").length, 2);
    assert.equal(listPlayersForUser(db, "bob").length, 1);
  });
});

describe("internal helpers", () => {
  it("validateNoteArray filters bad entries", () => {
    const out = _internal.validateNoteArray([
      { tick: 0, pitch: 36, velocity: 100, duration: 240 },
      { tick: -1, pitch: 36, velocity: 100, duration: 240 },  // bad tick
      { tick: 0, pitch: 200, velocity: 100, duration: 240 }, // bad pitch
    ]);
    assert.equal(out.length, 1);
  });

  it("composeMentorshipBias includes the last 8 feedback entries", () => {
    const log = Array.from({ length: 12 }, (_, i) => ({ feedback: `entry ${i}` }));
    const bias = _internal.composeMentorshipBias(log);
    // Should contain entries 4..11 (last 8)
    assert.ok(bias.includes("entry 4"));
    assert.ok(bias.includes("entry 11"));
    assert.ok(!bias.includes("entry 3"));
  });

  it("deterministicForRole produces non-empty notes for each role", () => {
    for (const role of ROLES) {
      const notes = _internal.deterministicForRole(role, { bars: 1 });
      assert.ok(notes.length > 0, `${role} deterministic produced 0 notes`);
    }
  });
});
