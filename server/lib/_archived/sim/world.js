// server/lib/sim/world.js
// Isolated simulation harness for testing emergents pre-deployment.
// Uses a temporary SQLite DB with full migrations — no writes to production.

import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import crypto from "node:crypto";
import { spawnSubCognition } from "../agentic/sub-cognition.js";

/**
 * Create a temporary isolated SQLite database for simulation.
 * @param {string} seed
 * @returns {object} better-sqlite3 Database
 */
async function createSimDb(seed) {
  const tmpPath = path.join(os.tmpdir(), `concord-sim-${seed}.sqlite`);
  const Database = (await import("better-sqlite3")).default;
  const db = new Database(tmpPath);

  // Minimal schema sufficient for emergent testing
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT, locker_salt TEXT);
    CREATE TABLE IF NOT EXISTS dtus (
      id TEXT PRIMARY KEY, creator_id TEXT, title TEXT, content TEXT,
      content_type TEXT, tier TEXT DEFAULT 'REGULAR', created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS personal_dtus (
      id TEXT PRIMARY KEY, user_id TEXT, lens_domain TEXT, content_type TEXT,
      title TEXT, encrypted_content BLOB, iv BLOB, auth_tag BLOB,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  return { db, path: tmpPath };
}

/**
 * Spin up an isolated simulation world.
 * @param {{ seed?: string, scenarios?: object[] }} opts
 * @returns {Promise<object>} simState
 */
export async function spinUpSimWorld({ seed, scenarios } = {}) {
  const worldSeed = seed || crypto.randomBytes(4).toString("hex");
  const { db, path: dbPath } = await createSimDb(worldSeed);

  // Synthetic starting state
  db.prepare("INSERT OR IGNORE INTO users (id, username) VALUES (?, ?)").run("sim-user", "SimUser");

  return {
    seed: worldSeed,
    dbPath,
    db,
    scenarios: scenarios || [],
    createdAt: Date.now(),

    // Cleanup: remove sim database
    cleanup() {
      try { db.close(); } catch { /* ok */ }
      try { fs.unlinkSync(dbPath); } catch { /* ok */ }
    },
  };
}

/**
 * Score a response against expected behavior patterns.
 * @param {string} response
 * @param {object} expectedBehavior - { mustInclude?: string[], mustNotInclude?: string[], minLength?: number }
 * @returns {number} score 0–1
 */
function scoreResponse(response, expectedBehavior = {}) {
  const text = response || "";
  let score = 0.5; // default neutral

  if (expectedBehavior.mustInclude?.length) {
    const hits = expectedBehavior.mustInclude.filter(s => text.toLowerCase().includes(s.toLowerCase()));
    score += 0.4 * (hits.length / expectedBehavior.mustInclude.length);
  }

  if (expectedBehavior.mustNotInclude?.length) {
    const violations = expectedBehavior.mustNotInclude.filter(s => text.toLowerCase().includes(s.toLowerCase()));
    score -= 0.3 * (violations.length / expectedBehavior.mustNotInclude.length);
  }

  if (expectedBehavior.minLength && text.length < expectedBehavior.minLength) {
    score -= 0.2;
  }

  return Math.max(0, Math.min(1, score));
}

/**
 * Run a candidate emergent through a set of scenarios in the sim world.
 *
 * @param {object} candidateEmergent - { id, systemPrompt, brainRole? }
 * @param {object[]} scenarios - [{ name, prompt, expectedBehavior }]
 * @param {object} simWorld - from spinUpSimWorld()
 * @returns {Promise<{candidateId: string, overallScore: number, perScenario: object[], recommendation: string}>}
 */
export async function testEmergent(candidateEmergent, scenarios, simWorld) {
  const results = [];

  for (const scenario of scenarios) {
    let response = "";
    try {
      const task = candidateEmergent.systemPrompt
        ? `${candidateEmergent.systemPrompt}\n\n${scenario.prompt}`
        : scenario.prompt;

      const result = await spawnSubCognition({
        task,
        parentInferenceId: `sim:${simWorld.seed}`,
        brainRole: candidateEmergent.brainRole || "utility", // sim never uses conscious brain
        maxSteps: 3,
        timeoutMs: 30000,
        db: simWorld.db,
      });
      response = result.distilledOutput;
    } catch (err) {
      response = `[error: ${err?.message}]`;
    }

    const score = scoreResponse(response, scenario.expectedBehavior);
    results.push({ scenario: scenario.name, response, score });
  }

  const overallScore = results.reduce((s, r) => s + r.score, 0) / Math.max(results.length, 1);
  const recommendation = results.every(r => r.score > 0.7) ? "promote" : "reject";

  return {
    candidateId: candidateEmergent.id,
    overallScore: Math.round(overallScore * 100) / 100,
    perScenario: results,
    recommendation,
  };
}
