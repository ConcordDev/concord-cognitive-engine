#!/usr/bin/env node
/**
 * Phase 3b proof — wallet balance + auth session lookup on the DTU read sidecar.
 *
 * Boots a temp SQLite DB with economy_ledger + sessions schema, seeds a small
 * matrix, starts the Rust binary against it, and diffs Rust output against the
 * JS getBalance / direct session SELECT. Writes proof JSON under
 * ~/.zuko/remaining-work/concord-wallet-session-sidecar-proof.json.
 *
 *   node engines/concord-dtu-sidecar/proof/run-wallet-session-proof.mjs
 */
import { spawn } from "node:child_process";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const require = createRequire(path.join(REPO, "server", "package.json"));
const Database = require("better-sqlite3");
const BIN = path.join(REPO, "engines/concord-dtu-sidecar/bin/concord-dtu-sidecar");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "wallet-sess-proof-"));
const DBP = path.join(TMP, "concord.db");
const SOCK = path.join(TMP, "s.sock");
const OUT = path.join(os.homedir(), ".zuko/remaining-work/concord-wallet-session-sidecar-proof.json");

// CREDIT_ROW_PREDICATE — keep in sync with server/economy/balances.js
const CREDIT_ROW_PREDICATE =
  "NOT (from_user_id IS NOT NULL AND type IN ('TRANSFER','MARKETPLACE_PURCHASE','BOUNTY_ESCROW','BOUNTY_CLAIM'))";

function jsGetBalance(db, userId) {
  const credits = db
    .prepare(
      `SELECT COALESCE(SUM(CAST(ROUND(net * 100) AS INTEGER)), 0) as total_cents
       FROM economy_ledger
       WHERE to_user_id = ? AND status = 'complete' AND ${CREDIT_ROW_PREDICATE}`
    )
    .get(userId);
  const debits = db
    .prepare(
      `SELECT COALESCE(SUM(CAST(ROUND(amount * 100) AS INTEGER)), 0) as total_cents
       FROM economy_ledger
       WHERE from_user_id = ? AND status = 'complete'`
    )
    .get(userId);
  const totalCreditsCents = credits?.total_cents || 0;
  const totalDebitsCents = debits?.total_cents || 0;
  return {
    balance: (totalCreditsCents - totalDebitsCents) / 100,
    totalCredits: totalCreditsCents / 100,
    totalDebits: totalDebitsCents / 100,
  };
}

function seed(db) {
  db.exec(`
    CREATE TABLE economy_ledger (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      from_user_id TEXT,
      to_user_id TEXT,
      amount REAL NOT NULL,
      fee REAL NOT NULL DEFAULT 0,
      net REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'complete',
      metadata_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      is_revoked INTEGER NOT NULL DEFAULT 0
    );
    -- empty dtu_store so sidecar boot cache is happy
    CREATE TABLE dtu_store (
      id TEXT PRIMARY KEY,
      data TEXT,
      updated_at TEXT,
      owner_user_id TEXT,
      visibility TEXT,
      privacy TEXT,
      federation_tier TEXT,
      location_regional TEXT,
      location_national TEXT,
      kind TEXT
    );
  `);

  const ins = db.prepare(
    `INSERT INTO economy_ledger (id, type, from_user_id, to_user_id, amount, fee, net, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'complete')`
  );
  // Mint 100 to alice
  ins.run("m1", "TOKEN_PURCHASE", null, "alice", 100, 0, 100);
  // Transfer 25 alice→bob (split debit+credit pattern)
  ins.run("t1d", "TRANSFER", "alice", "bob", 25, 0, 25); // debit half (excluded from bob credits)
  ins.run("t1c", "TRANSFER", null, "bob", 25, 0, 25); // real credit to bob
  // Fee row from alice
  ins.run("f1", "FEE", "alice", "platform", 1, 0, 1);
  // Pending ignored
  db.prepare(
    `INSERT INTO economy_ledger (id, type, from_user_id, to_user_id, amount, fee, net, status)
     VALUES ('p1','TOKEN_PURCHASE',NULL,'alice',999,0,999,'pending')`
  ).run();

  const sess = db.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, ip_address, user_agent, is_revoked)
     VALUES (?, ?, ?, datetime('now'), datetime('now','+7 days'), '127.0.0.1', 'proof', ?)`
  );
  sess.run("s_live", "alice", "jti_live", 0);
  sess.run("s_rev", "bob", "jti_revoked", 1);
}

function sidecarGet(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath: SOCK, path: pathname, method: "GET", timeout: 5000 }, (res) => {
      const c = [];
      res.on("data", (d) => c.push(d));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(c).toString("utf8") || "{}") });
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.end();
  });
}

function nearlyEq(a, b) {
  return Math.abs(Number(a) - Number(b)) < 1e-9;
}

async function main() {
  if (!fs.existsSync(BIN)) {
    console.error("missing binary:", BIN);
    process.exit(2);
  }
  const db = new Database(DBP);
  seed(db);

  const child = spawn(BIN, [], {
    env: {
      ...process.env,
      CONCORD_DB_PATH: DBP,
      CONCORD_DTU_SIDECAR_SOCK: SOCK,
      CONCORD_DTU_SIDECAR_WORKERS: "2",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let bootLog = "";
  child.stderr.on("data", (d) => (bootLog += d.toString()));
  child.stdout.on("data", (d) => (bootLog += d.toString()));

  // wait for sock
  for (let i = 0; i < 50; i++) {
    if (fs.existsSync(SOCK)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!fs.existsSync(SOCK)) {
    console.error("sidecar sock not created\n", bootLog);
    child.kill();
    process.exit(2);
  }

  const users = ["alice", "bob", "platform", "nobody"];
  const balanceCases = [];
  let balOk = 0;
  for (const u of users) {
    const js = jsGetBalance(db, u);
    const rust = await sidecarGet(`/v1/wallet/balance?user=${encodeURIComponent(u)}`);
    const match =
      rust.status === 200 &&
      rust.body?.ok === true &&
      nearlyEq(rust.body.balance, js.balance) &&
      nearlyEq(rust.body.totalCredits, js.totalCredits) &&
      nearlyEq(rust.body.totalDebits, js.totalDebits);
    if (match) balOk++;
    balanceCases.push({ user: u, js, rust: rust.body, match });
  }

  const sessionCases = [];
  let sessOk = 0;
  for (const [th, expect] of [
    ["jti_live", { found: true, isRevoked: false, userId: "alice" }],
    ["jti_revoked", { found: true, isRevoked: true, userId: "bob" }],
    ["jti_missing", { found: false }],
  ]) {
    const rust = await sidecarGet(`/v1/session?tokenHash=${encodeURIComponent(th)}`);
    const row = db.prepare("SELECT * FROM sessions WHERE token_hash = ?").get(th);
    let match = false;
    if (!expect.found) {
      match = rust.status === 404 && rust.body?.ok === false;
    } else {
      match =
        rust.status === 200 &&
        rust.body?.ok === true &&
        rust.body.session?.userId === expect.userId &&
        rust.body.session?.isRevoked === expect.isRevoked &&
        row?.user_id === expect.userId;
    }
    if (match) sessOk++;
    sessionCases.push({ tokenHash: th, expect, rust: { status: rust.status, body: rust.body }, match });
  }

  const proof = {
    at: new Date().toISOString(),
    binary: BIN,
    db: DBP,
    balance: { ok: balOk, total: balanceCases.length, cases: balanceCases },
    session: { ok: sessOk, total: sessionCases.length, cases: sessionCases },
    pass: balOk === balanceCases.length && sessOk === sessionCases.length,
    note: "Fail-soft Node wire: CONCORD_WALLET_SIDECAR=1 / CONCORD_SESSION_SIDECAR=1 (sidecar process required).",
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(proof, null, 2));
  console.log(JSON.stringify({ pass: proof.pass, balance: proof.balance.ok + "/" + proof.balance.total, session: proof.session.ok + "/" + proof.session.total, out: OUT }, null, 2));

  child.kill("SIGTERM");
  db.close();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(proof.pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
