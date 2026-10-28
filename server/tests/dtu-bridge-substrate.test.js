// server/tests/dtu-bridge-substrate.test.js
//
// Slice 0 (DTU bridge): the substrate registry is the bridge's scope
// gate. These tests pin the registry to the codebase it was derived
// from: every registered table must be created by a CREATE TABLE
// statement under server/ (drift in either direction fails), and
// representative non-substrate tables (identity, economy, lens state,
// federation) must be refused — the bridge may never widen to another
// data class by accident.
//
// The scan root defaults to this repo's server/ directory; set
// CONCORD_SERVER_DIR to scan a different checkout of the same tree.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DTU_SUBSTRATE_TABLES,
  isSubstrateTable,
  assertSubstrateTable,
} from "../lib/dtu-bridge/substrate-registry.js";

const SERVER_DIR =
  process.env.CONCORD_SERVER_DIR ||
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Tables whose definition is query-based rather than a literal
// CREATE TABLE statement (see the registry header for the derivation).
const QUERY_DEFINED = new Set(["dtu_archive_runs"]);

function collectCreatedTables(dir) {
  const names = new Set();
  const createRe = /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?["'`]?([a-z0-9_]+)/gi;
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "data") continue;
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(js|sql)$/.test(entry.name)) {
        const text = fs.readFileSync(p, "utf8");
        for (const m of text.matchAll(createRe)) names.add(m[1].toLowerCase());
      }
    }
  };
  walk(dir);
  return names;
}

test("registry is a non-empty frozen list of unique lowercase names", () => {
  assert.ok(DTU_SUBSTRATE_TABLES.length >= 40);
  assert.equal(new Set(DTU_SUBSTRATE_TABLES).size, DTU_SUBSTRATE_TABLES.length);
  assert.ok(Object.isFrozen(DTU_SUBSTRATE_TABLES));
  for (const t of DTU_SUBSTRATE_TABLES) assert.match(t, /^[a-z0-9_]+$/);
});

test("every registered table is created in the codebase (no phantom scope)", () => {
  const created = collectCreatedTables(SERVER_DIR);
  assert.ok(created.size > 100, `scan looks wrong: only ${created.size} CREATE TABLE names found`);
  for (const t of DTU_SUBSTRATE_TABLES) {
    if (QUERY_DEFINED.has(t)) continue;
    assert.ok(created.has(t), `registry table "${t}" has no CREATE TABLE under server/`);
  }
});

test("every DTU-shaped table created in the codebase is registered (no silent drift)", () => {
  const created = collectCreatedTables(SERVER_DIR);
  for (const name of created) {
    if (name.includes("dtu") || name === "canonical_registry") {
      assert.ok(
        isSubstrateTable(name) || QUERY_DEFINED.has(name),
        `codebase creates DTU-shaped table "${name}" that the bridge registry does not list`
      );
    }
  }
});

test("non-substrate tables are refused, including money and identity", () => {
  for (const t of [
    "users",
    "economy_ledger",
    "federation_outbox",
    "chat_sessions",
    "lens_artifacts",
    "brain_interactions",
    "dtu_bridge_outbox", // bridge infrastructure, not substrate data
  ]) {
    assert.equal(isSubstrateTable(t), false, `${t} must not be substrate`);
    assert.throws(() => assertSubstrateTable(t), (e) => e.code === "DTU_BRIDGE_OUT_OF_SCOPE");
  }
});

test("substrate tables are accepted exactly as named", () => {
  for (const t of ["dtus", "dtu_integrity", "dtu_citations", "dtu_store", "canonical_registry"]) {
    assert.equal(isSubstrateTable(t), true);
    assert.equal(assertSubstrateTable(t), t);
  }
  assert.equal(isSubstrateTable("DTUS"), false); // exact-match, no case folding surprises
  assert.equal(isSubstrateTable(""), false);
  assert.equal(isSubstrateTable(undefined), false);
});
