// tests/commission-escrow-amount.test.js
//
// GB-1565 / the a59109f4b completion: holdEscrow must refuse any amount
// other than the commission's agreed price, record what it actually held
// (escrow_held), and pay release / refund out of exactly that figure.
//
// The hole this closes: holdEscrow used to escrow the caller-supplied
// `amount` while release and refund paid out a figure recomputed from
// agreed_price — a 1 CC hold on a 1000 CC commission would park the
// request IN_PROGRESS and the payout would draw the other ~984 CC from
// the shared __ESCROW__ account, i.e. from other people's held coin.
//
// Standalone: in-memory database, the real economy ledger schema, the
// real commission service. Run:
//   node --test server/tests/commission-escrow-amount.test.js

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  ensureCommissionTables,
  requestCommission,
  respondToCommission,
  holdEscrow,
  deliverCommission,
  approveDelivery,
  disputeDelivery,
  resolveDispute,
} from "../economy/commission-service.js";
import { calculateFee, PLATFORM_ACCOUNT_ID } from "../economy/fees.js";
import { getBalance } from "../economy/balances.js";
import { setLedgerBalance } from "./lib/ledger-fund.js";

const ESCROW = "__ESCROW__";
const CLIENT = "escrow-client";
const CREATOR = "escrow-creator";
const r2 = (n) => Math.round(n * 100) / 100;

let db;
const bal = (id) => getBalance(db, id).balance;
const totalSupply = () =>
  r2(bal(CLIENT) + bal(CREATOR) + bal(ESCROW) + bal(PLATFORM_ACCOUNT_ID));
const row = (id) => db.prepare("SELECT * FROM commission_requests WHERE id = ?").get(id);

function freshDb() {
  const d = new Database(":memory:");
  d.exec(`
    CREATE TABLE IF NOT EXISTS economy_ledger (
      id            TEXT PRIMARY KEY,
      type          TEXT NOT NULL,
      from_user_id  TEXT,
      to_user_id    TEXT,
      amount        REAL NOT NULL CHECK(amount > 0),
      fee           REAL NOT NULL DEFAULT 0 CHECK(fee >= 0),
      net           REAL NOT NULL CHECK(net > 0),
      status        TEXT NOT NULL DEFAULT 'complete',
      metadata_json TEXT DEFAULT '{}',
      request_id    TEXT,
      ip            TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK(from_user_id IS NOT NULL OR to_user_id IS NOT NULL)
    );
    CREATE INDEX IF NOT EXISTS idx_ledger_from ON economy_ledger(from_user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_ledger_to   ON economy_ledger(to_user_id, created_at);
  `);
  ensureCommissionTables(d);
  return d;
}

function acceptedCommission(price = 1000) {
  const req = requestCommission(db, {
    clientId: CLIENT,
    creatorId: CREATOR,
    brief: "A commissioned DTU",
    proposedPrice: price,
  });
  assert.equal(req.ok, true, JSON.stringify(req));
  const id = req.request.id;
  assert.equal(
    respondToCommission(db, { requestId: id, creatorId: CREATOR, action: "ACCEPT" }).ok,
    true
  );
  return id;
}

beforeEach(() => {
  db = freshDb();
  setLedgerBalance(db, CLIENT, 2000);
});

describe("commission escrow — the hold must equal the agreed price", () => {
  it("refuses a 1 CC hold on a 1000 CC commission and moves nothing", () => {
    const id = acceptedCommission(1000);
    const r = holdEscrow(db, { requestId: id, clientId: CLIENT, amount: 1 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "amount_mismatch");
    // nothing moved, nothing transitioned, nothing stored
    assert.equal(row(id).status, "ACCEPTED");
    assert.equal(row(id).escrow_held, null);
    assert.equal(bal(CLIENT), 2000);
    assert.equal(bal(ESCROW), 0);
    assert.equal(totalSupply(), 2000);
  });

  it("refuses an over-hold too (1001 on an agreed 1000)", () => {
    const id = acceptedCommission(1000);
    const r = holdEscrow(db, { requestId: id, clientId: CLIENT, amount: 1001 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "amount_mismatch");
    assert.equal(bal(CLIENT), 2000);
    assert.equal(bal(ESCROW), 0);
  });

  it("holds at the agreed price, stores escrow_held, and release conserves", () => {
    const id = acceptedCommission(1000);
    const held = calculateFee("TRANSFER", 1000).net;

    const h = holdEscrow(db, { requestId: id, clientId: CLIENT, amount: 1000 });
    assert.equal(h.ok, true, JSON.stringify(h));
    assert.equal(row(id).status, "IN_PROGRESS");
    assert.equal(row(id).escrow_held, held, "the stored figure is what the hold actually put in escrow");
    assert.equal(bal(ESCROW), held);
    assert.equal(bal(CLIENT), 1000);
    assert.equal(totalSupply(), 2000);

    assert.equal(deliverCommission(db, { requestId: id, creatorId: CREATOR, dtuId: "dtu_1" }).ok, true);
    const ap = approveDelivery(db, { requestId: id, clientId: CLIENT });
    assert.equal(ap.ok, true, JSON.stringify(ap));

    const release = calculateFee("MARKETPLACE_PURCHASE", held);
    assert.equal(ap.gross, held);
    assert.equal(ap.released, release.net);
    assert.equal(bal(CREATOR), release.net);
    assert.equal(bal(ESCROW), 0, "release pays out exactly what was held");
    assert.equal(totalSupply(), 2000, "client + creator + escrow + platform still sums to the funded 2000");
  });

  it("refund pays out of the same held figure and conserves", () => {
    const id = acceptedCommission(1000);
    const held = calculateFee("TRANSFER", 1000).net;
    assert.equal(holdEscrow(db, { requestId: id, clientId: CLIENT, amount: 1000 }).ok, true);
    assert.equal(deliverCommission(db, { requestId: id, creatorId: CREATOR, dtuId: "dtu_2" }).ok, true);
    assert.equal(disputeDelivery(db, { requestId: id, clientId: CLIENT, reason: "not as briefed" }).ok, true);

    const res = resolveDispute(db, { requestId: id, resolution: "BUYER", resolvedBy: "admin-test" });
    assert.equal(res.ok, true, JSON.stringify(res));
    // the refund is a TRANSFER of the held figure; the client receives its net
    assert.equal(res.refunded, calculateFee("TRANSFER", held).net);
    assert.equal(bal(CLIENT), r2(1000 + calculateFee("TRANSFER", held).net));
    assert.equal(bal(ESCROW), 0, "refund empties exactly what was held");
    assert.equal(totalSupply(), 2000);
  });

  it("payouts read the stored escrow_held, not a figure recomputed from agreed_price", () => {
    const id = acceptedCommission(1000);
    const held = calculateFee("TRANSFER", 1000).net;
    assert.equal(holdEscrow(db, { requestId: id, clientId: CLIENT, amount: 1000 }).ok, true);

    // Any later drift in the row's price must not change what the payout
    // moves: the payout is bounded by what the hold actually stored.
    db.prepare("UPDATE commission_requests SET agreed_price = 500 WHERE id = ?").run(id);

    assert.equal(deliverCommission(db, { requestId: id, creatorId: CREATOR, dtuId: "dtu_3" }).ok, true);
    const ap = approveDelivery(db, { requestId: id, clientId: CLIENT });
    assert.equal(ap.ok, true, JSON.stringify(ap));
    assert.equal(ap.gross, held, "gross is the stored held figure, not a recomputation from the drifted price");
    assert.equal(bal(CREATOR), calculateFee("MARKETPLACE_PURCHASE", held).net);
    assert.equal(bal(ESCROW), 0);
    assert.equal(totalSupply(), 2000);
  });
});
