// server/tests/game-character-account.test.js
//
// World lens step 1: a player's Concordia character lives on their account
// (any device) instead of only in the browser. Pins appearance.save/load_
// game_character (merged — never clobbers the web avatar's appearance fields)
// and the batched read other players' clients use to render them.

import { describe, test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { load } from "./depth/_harness.js";

describe("Concordia character on the account", () => {
  let runMacro, db, ctxA, ctxB, idA, idB;
  before(async () => {
    const h = await load();
    runMacro = h.runMacro; db = h.STATE.db || globalThis._concordDB;
    idA = `u_char_a_${Date.now()}`; idB = `u_char_b_${Date.now()}`;
    const ins = db.prepare("INSERT INTO users (id, username, email, password_hash, role, created_at) VALUES (?, ?, ?, 'x', 'member', datetime('now'))");
    ins.run(idA, `chara${Date.now()}`, `a${Date.now()}@example.test`);
    ins.run(idB, `charb${Date.now()}`, `b${Date.now()}@example.test`);
    db.prepare("UPDATE users SET appearance_json = ? WHERE id = ?").run(JSON.stringify({ skinTone: "web-avatar-field" }), idA);
    ctxA = h.makeInternalCtx("char-a"); ctxA.actor = { userId: idA, role: "member", scopes: ["read", "write"] }; ctxA.internal = false;
    ctxB = h.makeInternalCtx("char-b"); ctxB.actor = { userId: idB, role: "member", scopes: ["read", "write"] }; ctxB.internal = false;
  });

  test("a new account has no character yet", async () => {
    const r = await runMacro("appearance", "load_game_character", {}, ctxB);
    assert.equal(r.ok, true);
    assert.equal(r.character, null);
  });

  test("save → load round-trips, and the web avatar's fields survive", async () => {
    const character = { displayName: "Ashwyn", outfit: 2, hairVal: 0.3 };
    assert.equal((await runMacro("appearance", "save_game_character", { character }, ctxA)).ok, true);
    const r = await runMacro("appearance", "load_game_character", {}, ctxA);
    assert.equal(r.character.displayName, "Ashwyn");
    assert.equal(r.character.outfit, 2);
    const stored = JSON.parse(db.prepare("SELECT appearance_json FROM users WHERE id = ?").get(idA).appearance_json);
    assert.equal(stored.skinTone, "web-avatar-field", "web avatar appearance must not be clobbered");
  });

  test("other players can read the visible character (for rendering), not the timestamp", async () => {
    const r = await runMacro("appearance", "game_characters_for", { userIds: [idA, idB] }, ctxB);
    assert.equal(r.characters[idA].character.displayName, "Ashwyn");
    assert.equal(r.characters[idA].character.savedAt, undefined);
    assert.equal(r.characters[idB].character, null);
  });

  test("rejects junk and oversized payloads", async () => {
    assert.equal((await runMacro("appearance", "save_game_character", { character: "x" }, ctxA)).reason, "missing_character");
    assert.equal((await runMacro("appearance", "save_game_character", { character: { blob: "y".repeat(20000) } }, ctxA)).reason, "character_too_large");
  });

  test("the Unity gateway echoes requestId and resolves the real role", () => {
    const src = fs.readFileSync(new URL("../lib/godot-gateway.js", import.meta.url), "utf8");
    assert.match(src, /\.\.\.\(requestId \? \{ requestId \} : \{\}\)/);
    assert.match(src, /SELECT role FROM users WHERE id = \?/);
  });
});
