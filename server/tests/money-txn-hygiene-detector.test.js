// tests/money-txn-hygiene-detector.test.js
//
// Proves the money-txn-hygiene detector fires on the real bug shape it was
// seeded from (commit c74b60d6: `server/economy/reserves.js#applyBalanceDelta`
// did an UPDATE then an INSERT with no `db.transaction(...)` wrapper) and does
// NOT fire on: the current (post-fix) `reserves.js`, `player-mail.js`'s
// already-transacted `claimAttachments`, a function with only a single money
// write, and an empty tree.
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  runMoneyTxnHygieneDetector,
  analyzeMoneyTxnHygiene,
  extractTopLevelFunctions,
  readBalancedParen,
  isMoneyWriteSql,
  findMoneyWriteCallSites,
} from "../lib/detectors/money-txn-hygiene-detector.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function tmpRepo(files) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "money-txn-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content, "utf8");
  }
  return dir;
}

// The exact pre-fix shape of `server/economy/reserves.js#applyBalanceDelta`
// (see `git show c74b60d6 -- server/economy/reserves.js`): an UPDATE on
// reserves_balance then an INSERT into reserves_ledger, no transaction.
const PRE_FIX_APPLY_BALANCE_DELTA = `
function applyBalanceDelta(db, { reserve, deltaCents, type, sourceTxId, description }) {
  const now = nowISO();

  // Update balance
  db.prepare(\`
    UPDATE reserves_balance
       SET balance_cents = balance_cents + ?,
           updated_at    = ?
     WHERE reserve = ?
  \`).run(deltaCents, now, reserve);

  // Ledger entry (always positive amount; type encodes direction)
  db.prepare(\`
    INSERT INTO reserves_ledger (id, reserve, type, amount_cents, source_tx_id, description, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  \`).run(
    reserveLedgerId(),
    reserve,
    type,
    Math.abs(deltaCents),
    sourceTxId || null,
    description || null,
    now,
  );
}
`;

const sev = (r, id) => r.findings.filter((f) => f.id === id);
const real = (r) => r.findings.filter((f) => f.severity !== "info");

describe("money-txn-hygiene detector — pure helpers", () => {
  it("readBalancedParen skips parens inside string/template content", () => {
    const src = "prepare(`VALUES (?, ?, ?)`).run(1,2,3)";
    const { text, end } = readBalancedParen(src, src.indexOf("("));
    assert.equal(text, "`VALUES (?, ?, ?)`");
    assert.equal(src.slice(end, end + 5), ".run(");
  });

  it("isMoneyWriteSql requires a write verb AND a money-shaped table name", () => {
    assert.equal(isMoneyWriteSql("UPDATE reserves_balance SET x=?", ""), true);
    assert.equal(isMoneyWriteSql("INSERT INTO reward_ledger (...)", ""), true);
    assert.equal(isMoneyWriteSql("SELECT * FROM reserves_balance", ""), false, "SELECT is not a write");
    assert.equal(isMoneyWriteSql("UPDATE dtus SET x=?", ""), false, "dtus is not money-shaped");
    // nearby-variable resolution
    const fileContent = "const t = 'reserves_balance';";
    assert.equal(isMoneyWriteSql("UPDATE ${t} SET x=?", fileContent), true);
  });

  it("extractTopLevelFunctions finds both function declarations and arrow-const functions", () => {
    const src = `
      function foo(a, b) { return a + b; }
      export const bar = async (x) => { return x; };
    `;
    const funcs = extractTopLevelFunctions(src);
    assert.deepEqual(funcs.map((f) => f.name).sort(), ["bar", "foo"]);
  });

  it("findMoneyWriteCallSites detects both direct-chain and split-variable statement patterns", () => {
    const chained = "db.prepare(`UPDATE user_wallets SET x=?`).run(1);";
    assert.equal(findMoneyWriteCallSites(chained, "").length, 1);

    const split = `
      const stmt = db.prepare(\`INSERT INTO reserves_ledger (a) VALUES (?)\`);
      stmt.run(1);
    `;
    assert.equal(findMoneyWriteCallSites(split, "").length, 1);

    const notMoney = "db.prepare(`UPDATE dtus SET x=?`).run(1);";
    assert.equal(findMoneyWriteCallSites(notMoney, "").length, 0);
  });

  it("analyzeMoneyTxnHygiene flags the pre-fix applyBalanceDelta shape", () => {
    const hits = analyzeMoneyTxnHygiene(PRE_FIX_APPLY_BALANCE_DELTA);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].func, "applyBalanceDelta");
    assert.equal(hits[0].totalWrites, 2);
    assert.equal(hits[0].directWrites, 2);
  });

  it("analyzeMoneyTxnHygiene does not flag the same shape once wrapped in db.transaction", () => {
    // The real fix (commit c74b60d6): identical writes, now inside db.transaction(...).
    const fixed = `
function applyBalanceDelta(db, { reserve, deltaCents, type, sourceTxId, description }) {
  const now = nowISO();
  const tx = db.transaction(() => {
    db.prepare(\`
      UPDATE reserves_balance
         SET balance_cents = balance_cents + ?,
             updated_at    = ?
       WHERE reserve = ?
    \`).run(deltaCents, now, reserve);

    db.prepare(\`
      INSERT INTO reserves_ledger (id, reserve, type, amount_cents, source_tx_id, description, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    \`).run(
      reserveLedgerId(),
      reserve,
      type,
      Math.abs(deltaCents),
      sourceTxId || null,
      description || null,
      now,
    );
  });
  tx();
}
`;
    const hits = analyzeMoneyTxnHygiene(fixed);
    assert.equal(hits.length, 0, "wrapping the same two writes in db.transaction clears the finding");
  });

  it("does not flag a single-write function (below the >=2 threshold)", () => {
    const src = `
      function creditWallet(db, userId, amount) {
        db.prepare(\`UPDATE user_wallets SET balance_cents = balance_cents + ? WHERE user_id = ?\`).run(amount, userId);
      }
    `;
    assert.equal(analyzeMoneyTxnHygiene(src).length, 0);
  });

  it("delegation: a single call to an already-transacted write-helper is not double-counted as un-transacted", () => {
    const src = `
      function creditOnce(db, userId, amount) {
        recordLedgerEntry(db, userId, amount);
      }
      function recordLedgerEntry(db, userId, amount) {
        const tx = db.transaction(() => {
          db.prepare(\`UPDATE user_wallets SET balance_cents = balance_cents + ? WHERE user_id = ?\`).run(amount, userId);
          db.prepare(\`INSERT INTO reward_ledger (user_id, amount) VALUES (?, ?)\`).run(userId, amount);
        });
        tx();
      }
    `;
    const hits = analyzeMoneyTxnHygiene(src);
    assert.equal(hits.find((h) => h.func === "creditOnce"), undefined, "one delegated call to a transacted helper is safe");
  });

  it("delegation: calling the same write-helper TWICE without an outer transaction IS flagged (the allocateFromFee shape)", () => {
    const src = `
      function applyBalanceDelta(db, reserve, deltaCents) {
        db.prepare(\`UPDATE reserves_balance SET balance_cents = balance_cents + ? WHERE reserve = ?\`).run(deltaCents, reserve);
        db.prepare(\`INSERT INTO reserves_ledger (reserve, delta) VALUES (?, ?)\`).run(reserve, deltaCents);
      }
      function allocateFromFeeUnwrapped(db, feeCents) {
        applyBalanceDelta(db, 'chargeback', feeCents * 0.5);
        applyBalanceDelta(db, 'operating', feeCents * 0.5);
      }
    `;
    const hits = analyzeMoneyTxnHygiene(src);
    const caller = hits.find((h) => h.func === "allocateFromFeeUnwrapped");
    assert.ok(caller, "composing two delegated write-helper calls with no outer transaction must be flagged");
    assert.equal(caller.delegatedWrites, 2);
  });
});

describe("money-txn-hygiene detector — end to end", () => {
  let dir;
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("FIRES (high) on the real pre-fix reserves.js applyBalanceDelta shape", async () => {
    dir = await tmpRepo({
      "server/economy/reserves.js": `
        function nowISO() { return new Date().toISOString(); }
        function reserveLedgerId() { return "rl_1"; }
        ${PRE_FIX_APPLY_BALANCE_DELTA}
      `,
    });
    const r = await runMoneyTxnHygieneDetector({ root: dir });
    assert.equal(r.ok, true);
    const hi = r.findings.filter((f) => f.severity === "high" && f.id === "money_txn_untransacted_writes");
    assert.equal(hi.length, 1);
    assert.match(hi[0].location, /reserves\.js/);
    assert.equal(hi[0].escalate_only, false, "reserves.js is not on the guard.mjs INVARIANT list");
  });

  it("does NOT flag applyBalanceDelta or allocateFromFee in the CURRENT (post-fix) server/economy/reserves.js", async () => {
    // "No finding for that function" per the fixed shape — not "zero findings
    // in the file": the file separately contains `initReservesSchema`, a
    // boot-time seeder that fires 3 `INSERT OR IGNORE` calls off one prepared
    // statement with no transaction wrap. That's a real (if low-stakes —
    // idempotent, seed-only) structural match for this detector's rule and is
    // legitimately reported; it's just not the historical bug this fixture
    // targets, so it's excluded from this specific assertion.
    const real_reserves = await readFile(path.join(__dirname, "..", "economy", "reserves.js"), "utf8");
    dir = await tmpRepo({ "server/economy/reserves.js": real_reserves });
    const r = await runMoneyTxnHygieneDetector({ root: dir });
    assert.equal(r.ok, true);
    const flaggedFuncs = real(r).map((f) => f.evidence?.func);
    assert.ok(!flaggedFuncs.includes("applyBalanceDelta"), `applyBalanceDelta must not be flagged post-fix, got: ${JSON.stringify(flaggedFuncs)}`);
    assert.ok(!flaggedFuncs.includes("allocateFromFee"), `allocateFromFee must not be flagged post-fix, got: ${JSON.stringify(flaggedFuncs)}`);
  });

  it("does NOT flag server/lib/player-mail.js's already-transacted claimAttachments", async () => {
    const mail = await readFile(path.join(__dirname, "..", "lib", "player-mail.js"), "utf8");
    dir = await tmpRepo({ "server/lib/player-mail.js": mail });
    const r = await runMoneyTxnHygieneDetector({ root: dir });
    assert.equal(r.ok, true);
    const flaggedFuncs = real(r).map((f) => f.evidence?.func);
    assert.ok(!flaggedFuncs.includes("claimAttachments"), `claimAttachments must not be flagged, got: ${JSON.stringify(flaggedFuncs)}`);
  });

  it("a function with a single money write is not flagged", async () => {
    dir = await tmpRepo({
      "server/lib/single-write.js": `
        function creditWallet(db, userId, amount) {
          db.prepare(\`UPDATE user_wallets SET balance_cents = balance_cents + ? WHERE user_id = ?\`).run(amount, userId);
        }
      `,
    });
    const r = await runMoneyTxnHygieneDetector({ root: dir });
    assert.equal(real(r).length, 0);
  });

  it("tags escalate_only:true for a finding inside a guard.mjs INVARIANT file", async () => {
    dir = await tmpRepo({
      "server/economy/withdrawals.js": `
        function payoutUnsafe(db, userId, amountCents) {
          db.prepare(\`UPDATE user_wallets SET balance_cents = balance_cents - ? WHERE user_id = ?\`).run(amountCents, userId);
          db.prepare(\`INSERT INTO withdrawal_ledger (user_id, amount_cents) VALUES (?, ?)\`).run(userId, amountCents);
        }
      `,
    });
    const r = await runMoneyTxnHygieneDetector({ root: dir });
    const hit = real(r).find((f) => f.evidence?.func === "payoutUnsafe");
    assert.ok(hit, "must still report the finding on an invariant file");
    assert.equal(hit.escalate_only, true, "invariant files are escalate-only, never auto-fix");
  });

  it("never throws — returns ok:true on an empty tree", async () => {
    dir = await tmpRepo({ "server/x.txt": "no code here" });
    const r = await runMoneyTxnHygieneDetector({ root: dir });
    assert.equal(r.ok, true);
    assert.equal(real(r).length, 0);
  });
});
