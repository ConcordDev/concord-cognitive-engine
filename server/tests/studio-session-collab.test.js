// Tier-2 contract test — Studio Sprint C #10: session collaboration
// + migration 205 verification.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import registerStudioCollabMacros from "../domains/studio-collab.js";
import { up as up205 } from "../migrations/205_session_deltas.js";

let Database;
try {
  Database = (await import("better-sqlite3")).default;
} catch { /* better-sqlite3 optional */ }

function makeRegistry() {
  const macros = new Map();
  registerStudioCollabMacros((domain, name, handler, opts) => {
    macros.set(`${domain}.${name}`, { handler, opts });
  });
  return macros;
}

if (Database) {
  describe("studio session collab (with real sqlite + migration 205)", () => {
    let db;
    let macros;
    let emittedEvents;

    before(() => {
      db = new Database(":memory:");
      up205(db);
      macros = makeRegistry();
      emittedEvents = [];
      globalThis._concordRealtimeEmit = (event, payload, opts) => {
        emittedEvents.push({ event, payload, opts });
        return { ok: true };
      };
    });

    after(() => {
      delete globalThis._concordRealtimeEmit;
    });

    it("session_join rejects without session id", async () => {
      const out = await macros.get("studio.session_join").handler(
        { db, actor: { userId: "u1" } }, {},
      );
      assert.equal(out.ok, false);
      assert.equal(out.reason, "session_dtu_id_required");
    });

    it("session_join returns the room + empty backlog on first join", async () => {
      const out = await macros.get("studio.session_join").handler(
        { db, actor: { userId: "alice" } },
        { session_dtu_id: "sess_1" },
      );
      assert.equal(out.ok, true);
      assert.equal(out.room, "session:sess_1");
      assert.equal(out.backlog.length, 0);
      const joinEv = emittedEvents.find(e => e.event === "session:joined");
      assert.ok(joinEv);
      assert.equal(joinEv.opts.sessionId, "sess_1");
    });

    it("session_emit_delta rejects unknown delta kinds", async () => {
      const out = await macros.get("studio.session_emit_delta").handler(
        { db, actor: { userId: "alice" } },
        { session_dtu_id: "sess_1", kind: "rage_quit", payload: {} },
      );
      assert.equal(out.ok, false);
      assert.equal(out.reason, "invalid_delta_kind");
    });

    it("session_emit_delta writes a row + fans out a socket event", async () => {
      const before = emittedEvents.length;
      const out = await macros.get("studio.session_emit_delta").handler(
        { db, actor: { userId: "alice" } },
        {
          session_dtu_id: "sess_1",
          delta: { kind: "clip_add", payload: { trackId: "trk_1", clipId: "clp_1", startBeat: 0 } },
        },
      );
      assert.equal(out.ok, true);
      assert.ok(out.deltaId);
      const newEv = emittedEvents.slice(before).find(e => e.event === "session:delta");
      assert.ok(newEv, "expected session:delta socket emit");
      assert.equal(newEv.payload.userId, "alice");
      assert.equal(newEv.payload.kind, "clip_add");
      assert.equal(newEv.opts.sessionId, "sess_1");
    });

    it("session_emit_delta rejects delta payload > 8KB", async () => {
      const huge = { blob: "x".repeat(20 * 1024) };
      const out = await macros.get("studio.session_emit_delta").handler(
        { db, actor: { userId: "alice" } },
        { session_dtu_id: "sess_1", delta: { kind: "clip_update", payload: huge } },
      );
      assert.equal(out.ok, false);
      assert.equal(out.reason, "delta_too_large");
    });

    it("session_list_deltas returns ordered deltas since cutoff", async () => {
      // Emit a second delta from a different user.
      await macros.get("studio.session_emit_delta").handler(
        { db, actor: { userId: "bob" } },
        { session_dtu_id: "sess_1", delta: { kind: "clip_move", payload: { clipId: "clp_1", startBeat: 4 } } },
      );
      const out = await macros.get("studio.session_list_deltas").handler(
        { db }, { session_dtu_id: "sess_1", since: 0, limit: 50 },
      );
      assert.equal(out.ok, true);
      assert.ok(out.deltas.length >= 2);
      assert.ok(out.deltas[0].server_ts <= out.deltas[out.deltas.length - 1].server_ts);
    });

    it("session_join now returns prior deltas in the backlog", async () => {
      const out = await macros.get("studio.session_join").handler(
        { db, actor: { userId: "carol" } },
        { session_dtu_id: "sess_1" },
      );
      assert.equal(out.ok, true);
      assert.ok(out.backlog.length >= 2);
    });

    it("session isolation: edits to sess_1 don't appear in sess_2", async () => {
      const out = await macros.get("studio.session_list_deltas").handler(
        { db }, { session_dtu_id: "sess_2", limit: 50 },
      );
      assert.equal(out.deltas.length, 0);
    });
  });

  describe("migration 205 — session_deltas table shape", () => {
    it("creates expected columns + indexes", () => {
      const db = new Database(":memory:");
      up205(db);
      const cols = db.prepare("PRAGMA table_info(session_deltas)").all().map(r => r.name);
      for (const required of [
        "id", "session_dtu_id", "user_id", "delta_kind",
        "delta_json", "server_ts", "client_ts", "origin_instance",
      ]) {
        assert.ok(cols.includes(required), `missing column ${required}`);
      }
      const idx = db.prepare("PRAGMA index_list(session_deltas)").all().map(r => r.name);
      assert.ok(idx.includes("idx_session_deltas_session"));
      assert.ok(idx.includes("idx_session_deltas_user"));
    });
  });
}
