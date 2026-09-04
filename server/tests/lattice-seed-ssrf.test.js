// server/tests/lattice-seed-ssrf.test.js
//
// Pins that lattice-seed executeNext uses fetchPublicUrl, so private
// targets are unreachable even when a caller would have passed
// mode=admin in the old backend. Mirrors ingest-engine-ssrf.test.js.
//
// Run: node --test server/tests/lattice-seed-ssrf.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as upLatticeSeed } from "../migrations/416_lattice_seed.js";
import { createSource, queuePage, executeNext } from "../lib/lattice-seed.js";

const PRIVATE_TARGETS = [
  ["cloud metadata", "http://169.254.169.254/latest/meta-data/iam/security-credentials/"],
  ["loopback — local Ollama brains", "http://127.0.0.1:11434/api/tags"],
  ["loopback by name", "http://localhost:5050/api/admin/stats"],
  ["RFC1918 10/8", "http://10.0.0.1/"],
  ["RFC1918 192.168/16", "http://192.168.1.1/"],
];

let db;
beforeEach(() => {
  db = new Database(":memory:");
  upLatticeSeed(db);
});
afterEach(() => { try { db?.close(); } catch { /* intentional */ } });

describe("lattice-seed executeNext — private targets are unreachable", () => {
  for (const [label, url] of PRIVATE_TARGETS) {
    it(`blocks ${label} (no fetchImpl — real SSRF guard)`, async () => {
      const src = createSource(db, "ssrf-user", { label: "probe" });
      queuePage(db, "ssrf-user", { sourceId: src.id, url });
      const r = await executeNext(db, "ssrf-user", { role: "sovereign" });
      assert.equal(r.ok, false, `${url} must not ingest`);
      assert.equal(r.reason, "ssrf_blocked", `${url} reason=${r.reason} error=${r.error}`);
      assert.ok(!r.excerpt && !r.hypotheses, `${url} must not return fetched content`);
    });
  }
});
