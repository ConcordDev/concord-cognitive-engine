// Owner-approved snapshot persistence for the five money-adjacent STATE
// stores (predictionMarkets, inheritPacts, insAms, serviceListings,
// serviceOrders). Same restart path as INC-32: serializeLensState, JSON
// round-trip, drop the live STATE, hydrate a fresh one.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

import registerMarkets, { PM_MARKET_CAP, PM_POSITION_CAP, PM_ORDER_CAP } from "../domains/markets.js";
import registerInsurance, {
  PACT_CAP, INSTALLMENT_CAP, AMS_LIST_CAP, STATEMENT_LINE_CAP, FNOL_TIMELINE_CAP,
} from "../domains/insurance.js";
import registerServiceMarket, { SERVICE_LISTING_CAP, SERVICE_ORDER_CAP } from "../domains/service-market.js";
import {
  serializeLensState, hydrateLensState, LENS_STATE_KEYS, SNAPSHOT_EXCLUDED_STATE_KEYS,
  MONEY_SNAPSHOT_KEYS, MONEY_SNAPSHOT_SECRET_FIELDS,
} from "../lib/lens-state-persistence.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  ACTIONS.set(`${domain}.${name}`, fn);
}
function call(domain, name, ctx, input = {}) {
  const fn = ACTIONS.get(`${domain}.${name}`);
  if (!fn) throw new Error(`${domain}.${name} not registered`);
  return fn(ctx, { data: input }, input);
}
function must(r) {
  assert.equal(r.ok, true, JSON.stringify(r));
  return r;
}

function restartFromSnapshot() {
  const persisted = JSON.parse(JSON.stringify(serializeLensState(globalThis._concordSTATE)));
  const next = {};
  hydrateLensState(next, persisted);
  globalThis._concordSTATE = next;
  return persisted;
}

function seqFromId(id) {
  return parseInt(String(id).split("_")[1], 36);
}

function walkKeys(value, visit) {
  if (Array.isArray(value)) {
    for (const item of value) walkKeys(item, visit);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [k, v] of Object.entries(value)) {
    visit(k);
    walkKeys(v, visit);
  }
}

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };
const ctxS = { actor: { userId: "user_s" }, userId: "user_s" };
const ctxC = { actor: { userId: "user_c" }, userId: "user_c" };

before(() => {
  registerMarkets(register);
  registerInsurance(register);
  registerServiceMarket(register);
});

beforeEach(() => {
  globalThis._concordSTATE = {};
});

describe("money-adjacent stores are snapshotted", () => {
  it("lists the five keys and does not also exclude them", () => {
    assert.deepEqual([...MONEY_SNAPSHOT_KEYS], [
      "predictionMarkets", "inheritPacts", "insAms", "serviceListings", "serviceOrders",
    ]);
    for (const key of MONEY_SNAPSHOT_KEYS) {
      assert.equal(LENS_STATE_KEYS.includes(key), true, key);
      assert.equal(Object.hasOwn(SNAPSHOT_EXCLUDED_STATE_KEYS, key), false, key);
    }
  });
});

describe("prediction markets survive a snapshot restart", () => {
  it("restores the market, position, resting order, and seq for the owning account only", () => {
    const created = must(call("markets", "market-create", ctxA, {
      question: "Will the probe resolve yes this year",
      resolutionCriteria: "Published official result",
      category: "science",
      seedSparks: 10,
    }));
    const marketId = created.result.market.id;
    const pos = must(call("markets", "position-open", ctxA, {
      marketId, side: "yes", stakeSparks: 40,
    }));
    const positionId = pos.result.position.id;
    const order = must(call("markets", "order-place", ctxA, {
      marketId, side: "yes", limitPrice: 0.01, stakeSparks: 10,
    }));
    const orderId = order.result.order.id;
    assert.equal(order.result.order.status, "open");
    globalThis._concordSTATE.predictionMarkets.watched = new Set(["user_a"]);
    const seqBefore = globalThis._concordSTATE.predictionMarkets.seq;

    restartFromSnapshot();

    const state = globalThis._concordSTATE;
    assert.ok(state.predictionMarkets.markets instanceof Map);
    assert.ok(state.predictionMarkets.positions instanceof Map);
    assert.ok(state.predictionMarkets.orders instanceof Map);
    assert.ok(state.predictionMarkets.watched instanceof Set);
    assert.equal(state.predictionMarkets.watched.has("user_a"), true);
    assert.equal(state.predictionMarkets.watched.has("user_b"), false);
    assert.equal(state.predictionMarkets.seq, seqBefore);

    const market = must(call("markets", "market-get", ctxA, { marketId }));
    assert.equal(market.result.market.id, marketId);
    assert.equal(market.result.market.question, "Will the probe resolve yes this year");
    assert.equal(market.result.market.poolYes, 45);
    assert.equal(market.result.market.poolNo, 5);
    assert.equal(market.result.market.creatorId, "user_a");

    const mine = must(call("markets", "my-positions", ctxA, {}));
    assert.equal(mine.result.count, 1);
    assert.equal(mine.result.positions[0].id, positionId);
    assert.equal(mine.result.positions[0].userId, "user_a");
    assert.equal(mine.result.positions[0].side, "yes");
    assert.equal(mine.result.positions[0].stakeSparks, 40);
    assert.equal(mine.result.positions[0].status, "open");
    assert.equal(mine.result.positions[0].entryPrice, 0.5);

    const book = must(call("markets", "order-book", ctxA, { marketId }));
    assert.equal(book.result.myOrders.length, 1);
    assert.equal(book.result.myOrders[0].id, orderId);
    assert.equal(book.result.myOrders[0].limitPrice, 0.01);
    assert.equal(book.result.myOrders[0].status, "open");

    const otherPositions = must(call("markets", "my-positions", ctxB, {}));
    assert.equal(otherPositions.result.count, 0);
    const stolen = call("markets", "position-cashout", ctxB, { positionId });
    assert.equal(stolen.ok, false);
    assert.equal(stolen.error, "not your position");
    const cancelled = call("markets", "order-cancel", ctxB, { orderId });
    assert.equal(cancelled.ok, false);
    assert.equal(cancelled.error, "not your order");
    const still = must(call("markets", "my-positions", ctxA, {}));
    assert.equal(still.result.positions[0].status, "open");
    assert.equal(still.result.positions[0].stakeSparks, 40);
    const bookStill = must(call("markets", "order-book", ctxA, { marketId }));
    assert.equal(bookStill.result.myOrders[0].status, "open");

    const seqAtRestart = state.predictionMarkets.seq;
    const next = must(call("markets", "position-open", ctxA, {
      marketId, side: "no", stakeSparks: 5,
    }));
    assert.equal(state.predictionMarkets.seq, seqAtRestart + 1);
    assert.notEqual(next.result.position.id, positionId);
    assert.equal(seqFromId(next.result.position.id), seqFromId(positionId) + 2);
    const otherStill = must(call("markets", "my-positions", ctxB, {}));
    assert.equal(otherStill.result.count, 0);
  });

  it("caps price history at 500 and rejects the next position without moving the pool", () => {
    const created = must(call("markets", "market-create", ctxA, {
      question: "Will the history probe resolve yes",
      resolutionCriteria: "Published official result",
      seedSparks: 10,
    }));
    const marketId = created.result.market.id;
    let lastId = null;
    for (let i = 0; i < PM_POSITION_CAP; i++) {
      const pos = must(call("markets", "position-open", ctxA, {
        marketId, side: "yes", stakeSparks: 1,
      }));
      lastId = pos.result.position.id;
    }
    const history = must(call("markets", "market-history", ctxA, { marketId }));
    assert.equal(history.result.count, 500);
    assert.equal(history.result.points[history.result.points.length - 1].poolYes, 505);
    const poolBefore = globalThis._concordSTATE.predictionMarkets.markets.get(marketId).poolYes;
    const seqBefore = globalThis._concordSTATE.predictionMarkets.seq;
    const rejected = call("markets", "position-open", ctxA, {
      marketId, side: "yes", stakeSparks: 7,
    });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.error, "position_cap");
    assert.equal(globalThis._concordSTATE.predictionMarkets.markets.get(marketId).poolYes, poolBefore);
    assert.equal(globalThis._concordSTATE.predictionMarkets.seq, seqBefore);

    const fullBytes = Buffer.byteLength(JSON.stringify(
      serializeLensState(globalThis._concordSTATE).predictionMarkets,
    ));
    console.log(`MONEY_SNAPSHOT_FULL_HISTORY_MARKET_BYTES ${fullBytes}`);

    restartFromSnapshot();
    const again = must(call("markets", "market-history", ctxA, { marketId }));
    assert.equal(again.result.count, 500);
    assert.equal(again.result.points[again.result.points.length - 1].poolYes, 505);
    const mine = must(call("markets", "my-positions", ctxA, {}));
    assert.equal(mine.result.count, PM_POSITION_CAP);
    assert.equal(mine.result.positions.some((p) => p.id === lastId), true);
    const other = must(call("markets", "my-positions", ctxB, {}));
    assert.equal(other.result.count, 0);
    const rejectedAgain = call("markets", "position-open", ctxA, {
      marketId, side: "yes", stakeSparks: 7,
    });
    assert.equal(rejectedAgain.error, "position_cap");
    assert.equal(must(call("markets", "market-get", ctxA, { marketId })).result.market.poolYes, 505);
  });

  it("rejects a new market and a new order at the snapshot caps", () => {
    for (let i = 0; i < PM_MARKET_CAP; i++) {
      must(call("markets", "market-create", ctxA, {
        question: `Will catalog probe ${i} resolve yes`,
        resolutionCriteria: "Published official result",
      }));
    }
    const rejectedMarket = call("markets", "market-create", ctxA, {
      question: "Will the extra catalog probe resolve yes",
      resolutionCriteria: "Published official result",
    });
    assert.equal(rejectedMarket.ok, false);
    assert.equal(rejectedMarket.error, "market_cap");
    assert.equal(globalThis._concordSTATE.predictionMarkets.markets.size, PM_MARKET_CAP);

    const marketId = [...globalThis._concordSTATE.predictionMarkets.markets.keys()][0];
    for (let i = 0; i < PM_ORDER_CAP; i++) {
      const order = must(call("markets", "order-place", ctxA, {
        marketId, side: "yes", limitPrice: 0.01, stakeSparks: 1,
      }));
      assert.equal(order.result.order.status, "open");
    }
    const rejectedOrder = call("markets", "order-place", ctxA, {
      marketId, side: "yes", limitPrice: 0.01, stakeSparks: 1,
    });
    assert.equal(rejectedOrder.ok, false);
    assert.equal(rejectedOrder.error, "order_cap");
    const book = must(call("markets", "order-book", ctxB, { marketId }));
    assert.equal(book.result.myOrders.length, 0);
  });
});

describe("inheritance pacts survive a snapshot restart", () => {
  it("restores a pact for the writer and not for an unrelated account", () => {
    const written = must(call("insurance", "pact-write", ctxA, {
      beneficiaryUserId: "user_c",
      payoutSparks: 500,
      premiumSparks: 25,
      durationDays: 30,
    }));
    const pactId = written.result.pact.id;
    assert.equal(written.result.pact.insuredUserId, "user_a");
    assert.equal(written.result.pact.beneficiaries[0].userId, "user_c");

    restartFromSnapshot();

    assert.ok(globalThis._concordSTATE.inheritPacts.pacts instanceof Map);
    const mine = must(call("insurance", "pact-list", ctxA, {}));
    assert.equal(mine.result.written.length, 1);
    assert.equal(mine.result.written[0].id, pactId);
    assert.equal(mine.result.written[0].payoutSparks, 500);
    assert.equal(mine.result.written[0].premiumSparks, 25);
    assert.equal(mine.result.written[0].status, "active");
    assert.equal(mine.result.written[0].beneficiaries[0].userId, "user_c");

    const bene = must(call("insurance", "pact-list", ctxC, {}));
    assert.equal(bene.result.written.length, 0);
    assert.equal(bene.result.beneficiaryOf.length, 1);
    assert.equal(bene.result.beneficiaryOf[0].id, pactId);
    assert.equal(bene.result.beneficiaryOf[0].myShare.sharePct, 100);

    const other = must(call("insurance", "pact-list", ctxB, {}));
    assert.equal(other.result.written.length, 0);
    assert.equal(other.result.beneficiaryOf.length, 0);
    const revoked = call("insurance", "pact-revoke", ctxB, { pactId });
    assert.equal(revoked.ok, false);
    assert.equal(revoked.error, "pact not found");
    const still = must(call("insurance", "pact-list", ctxA, {}));
    assert.equal(still.result.written[0].status, "active");

    const second = must(call("insurance", "pact-write", ctxA, {
      beneficiaryUserId: "user_c",
      payoutSparks: 100,
      premiumSparks: 10,
    }));
    assert.notEqual(second.result.pact.id, pactId);
    const both = must(call("insurance", "pact-list", ctxA, {}));
    assert.equal(both.result.written.length, 2);
    const hidden = must(call("insurance", "pact-list", ctxB, {}));
    assert.equal(hidden.result.count, 0);
  });

  it("rejects a pact past the cap and trims installment history without changing the premium total", () => {
    for (let i = 0; i < PACT_CAP; i++) {
      must(call("insurance", "pact-write", ctxA, {
        beneficiaryUserId: "user_c",
        payoutSparks: 100,
        premiumSparks: 10,
      }));
    }
    const rejected = call("insurance", "pact-write", ctxA, {
      beneficiaryUserId: "user_c",
      payoutSparks: 100,
      premiumSparks: 10,
    });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.error, "pact_cap");
    restartFromSnapshot();
    const mine = must(call("insurance", "pact-list", ctxA, {}));
    assert.equal(mine.result.written.length, PACT_CAP);
    const rejectedAgain = call("insurance", "pact-write", ctxA, {
      beneficiaryUserId: "user_c", payoutSparks: 100, premiumSparks: 10,
    });
    assert.equal(rejectedAgain.error, "pact_cap");
    const other = must(call("insurance", "pact-list", ctxB, {}));
    assert.equal(other.result.written.length, 0);

    globalThis._concordSTATE = {};
    const weekly = must(call("insurance", "pact-write", ctxA, {
      beneficiaryUserId: "user_c",
      payoutSparks: 100,
      premiumSparks: 10,
      premiumFrequency: "weekly",
    }));
    const payments = INSTALLMENT_CAP + 1;
    for (let i = 0; i < payments; i++) {
      must(call("insurance", "pact-pay-premium", ctxA, { pactId: weekly.result.pact.id }));
    }
    const schedule = must(call("insurance", "pact-premium-schedule", ctxA, { pactId: weekly.result.pact.id }));
    assert.equal(schedule.result.installments.length, INSTALLMENT_CAP);
    assert.equal(schedule.result.premiumPaidSparks, 10 * payments);
    restartFromSnapshot();
    const after = must(call("insurance", "pact-premium-schedule", ctxA, { pactId: weekly.result.pact.id }));
    assert.equal(after.result.installments.length, INSTALLMENT_CAP);
    assert.equal(after.result.premiumPaidSparks, 10 * payments);
  });
});

describe("agency AMS records survive a snapshot restart", () => {
  it("restores carriers, FNOL, statements, certificates, and envelopes for that account only", () => {
    const carrier = must(call("insurance", "carrier-add", ctxA, {
      name: "Acme Mutual", naicNumber: "12345", lines: ["auto"], baseCommissionPct: 12,
    }));
    const carrierId = carrier.result.carrier.id;
    const fnol = must(call("insurance", "fnol-intake", ctxA, {
      description: "Hail damage on the roof",
      lossType: "weather",
      estimatedLoss: 4000,
      location: "12 Main",
    }));
    const fnolId = fnol.result.fnol.id;
    const statement = must(call("insurance", "statement-import", ctxA, {
      carrier: "Acme Mutual",
      period: "2026-09",
      lines: [{ policyNumber: "PN-1", premium: 500, commission: 50 }],
    }));
    const statementId = statement.result.statement.id;
    const policy = must(call("insurance", "policy-add", ctxA, {
      carrier: "Acme Mutual",
      policyNumber: "PN-1",
      annualPremium: 500,
      kind: "auto",
      renewalDate: new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10),
    }));
    const cert = must(call("insurance", "certificate-issue", ctxA, {
      policyId: policy.result.policy.id,
      certificateHolder: "City Hall",
      insuredName: "Ada",
    }));
    const certId = cert.result.certificate.id;
    const pipeline = must(call("insurance", "renewal-pipeline-build", ctxA, { horizonDays: 30 }));
    assert.equal(pipeline.result.count, 1);
    const renewalId = pipeline.result.pipeline[0].id;
    const envelope = must(call("insurance", "esign-create", ctxA, {
      title: "Binder application",
      signers: [{ name: "Ada", email: "ada@example.com", role: "insured" }],
    }));
    const envelopeId = envelope.result.envelope.id;

    restartFromSnapshot();

    assert.ok(globalThis._concordSTATE.insAms.carriers instanceof Map);
    assert.ok(globalThis._concordSTATE.insAms.envelopes instanceof Map);
    const carriers = must(call("insurance", "carrier-list", ctxA, {}));
    assert.equal(carriers.result.carriers.length, 1);
    assert.equal(carriers.result.carriers[0].id, carrierId);
    assert.equal(carriers.result.carriers[0].name, "Acme Mutual");
    assert.equal(carriers.result.carriers[0].naicNumber, "12345");
    const fnols = must(call("insurance", "fnol-list", ctxA, {}));
    assert.equal(fnols.result.count, 1);
    assert.equal(fnols.result.fnol[0].id, fnolId);
    assert.equal(fnols.result.fnol[0].description, "Hail damage on the roof");
    assert.equal(fnols.result.fnol[0].estimatedLoss, 4000);
    const statements = must(call("insurance", "statement-list", ctxA, {}));
    assert.equal(statements.result.statements[0].id, statementId);
    assert.equal(statements.result.statements[0].lines[0].policyNumber, "PN-1");
    assert.equal(statements.result.statements[0].lines[0].commission, 50);
    const certs = must(call("insurance", "certificate-list", ctxA, {}));
    assert.equal(certs.result.certificates[0].id, certId);
    assert.equal(certs.result.certificates[0].certificateHolder, "City Hall");
    assert.equal(certs.result.certificates[0].policyNumber, "PN-1");
    const renewals = must(call("insurance", "renewal-pipeline-list", ctxA, {}));
    assert.equal(renewals.result.count, 1);
    assert.equal(renewals.result.pipeline[0].id, renewalId);
    const envelopes = must(call("insurance", "esign-list", ctxA, {}));
    assert.equal(envelopes.result.envelopes[0].id, envelopeId);
    assert.equal(envelopes.result.envelopes[0].signers[0].email, "ada@example.com");

    assert.equal(must(call("insurance", "carrier-list", ctxB, {})).result.carriers.length, 0);
    assert.equal(must(call("insurance", "fnol-list", ctxB, {})).result.count, 0);
    assert.equal(must(call("insurance", "statement-list", ctxB, {})).result.statements.length, 0);
    assert.equal(must(call("insurance", "certificate-list", ctxB, {})).result.certificates.length, 0);
    assert.equal(must(call("insurance", "esign-list", ctxB, {})).result.envelopes.length, 0);
    assert.equal(must(call("insurance", "renewal-pipeline-list", ctxB, {})).result.count, 0);
    assert.equal(call("insurance", "carrier-delete", ctxB, { id: carrierId }).error, "carrier not found");
    assert.equal(call("insurance", "certificate-revoke", ctxB, { id: certId }).error, "certificate not found");
    assert.equal(must(call("insurance", "carrier-list", ctxA, {})).result.carriers.length, 1);
    assert.equal(must(call("insurance", "certificate-list", ctxA, {})).result.certificates[0].revoked, false);

    const another = must(call("insurance", "carrier-add", ctxA, { name: "Second Carrier" }));
    assert.notEqual(another.result.carrier.id, carrierId);
    assert.equal(must(call("insurance", "carrier-list", ctxA, {})).result.carriers.length, 2);
    assert.equal(must(call("insurance", "carrier-list", ctxB, {})).result.carriers.length, 0);
  });

  it("caps carrier rows, statement lines, renewal rows, and FNOL timeline", () => {
    for (let i = 0; i < AMS_LIST_CAP; i++) {
      must(call("insurance", "carrier-add", ctxA, { name: `Carrier ${i}` }));
    }
    const rejected = call("insurance", "carrier-add", ctxA, { name: "One more" });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.error, "carrier_cap");
    restartFromSnapshot();
    assert.equal(must(call("insurance", "carrier-list", ctxA, {})).result.carriers.length, AMS_LIST_CAP);
    assert.equal(call("insurance", "carrier-add", ctxA, { name: "Still over" }).error, "carrier_cap");
    assert.equal(must(call("insurance", "carrier-list", ctxB, {})).result.carriers.length, 0);

    globalThis._concordSTATE = {};
    const tooMany = Array.from({ length: STATEMENT_LINE_CAP + 1 }, (_, i) => ({
      policyNumber: `P${i}`, premium: 10, commission: 1,
    }));
    const rejectedLines = call("insurance", "statement-import", ctxA, {
      carrier: "Acme", lines: tooMany,
    });
    assert.equal(rejectedLines.ok, false);
    assert.equal(rejectedLines.error, "statement_line_cap");
    assert.equal(must(call("insurance", "statement-list", ctxA, {})).result.statements.length, 0);

    const soon = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
    for (let i = 0; i < AMS_LIST_CAP + 1; i++) {
      must(call("insurance", "policy-add", ctxA, {
        carrier: "Acme", policyNumber: `PN${i}`, annualPremium: 100, renewalDate: soon,
      }));
    }
    const pipeline = must(call("insurance", "renewal-pipeline-build", ctxA, { horizonDays: 30 }));
    assert.equal(pipeline.result.count, AMS_LIST_CAP);
    assert.equal(pipeline.result.premiumAtRisk, AMS_LIST_CAP * 100);

    globalThis._concordSTATE = {};
    const fnol = must(call("insurance", "fnol-intake", ctxA, {
      description: "Hail damage on the roof",
    }));
    for (let i = 0; i < FNOL_TIMELINE_CAP + 1; i++) {
      must(call("insurance", "fnol-update", ctxA, { id: fnol.result.fnol.id, status: "investigating" }));
    }
    const listed = must(call("insurance", "fnol-list", ctxA, {}));
    assert.equal(listed.result.fnol[0].timeline.length, FNOL_TIMELINE_CAP);
    assert.equal(listed.result.fnol[0].description, "Hail damage on the roof");
    assert.match(listed.result.fnol[0].timeline.at(-1).event, /investigating/);
  });
});

describe("service listings and orders survive a snapshot restart", () => {
  it("keeps listing ownership and order parties, and blocks the other account", () => {
    const listing = must(call("service-market", "listing-create", ctxA, {
      title: "Logo design", price: 80.5, category: "design", description: "studio work",
    }));
    const listingId = listing.result.listing.id;
    const sellerListing = must(call("service-market", "listing-create", ctxS, {
      title: "Site audit", price: 40, category: "design",
    }));
    const order = must(call("service-market", "order-create", ctxA, {
      listingId: sellerListing.result.listing.id, quantity: 2, requirements: "vector files",
    }));
    const orderId = order.result.order.id;
    assert.equal(order.result.order.total, 80);
    assert.equal(order.result.order.buyer, "user_a");
    assert.equal(order.result.order.provider, "user_s");

    restartFromSnapshot();

    assert.ok(globalThis._concordSTATE.serviceListings instanceof Map);
    assert.ok(globalThis._concordSTATE.serviceOrders instanceof Map);
    const mine = must(call("service-market", "listing-list", ctxA, { mine: true }));
    assert.equal(mine.result.count, 1);
    assert.equal(mine.result.listings[0].id, listingId);
    assert.equal(mine.result.listings[0].provider, "user_a");
    assert.equal(mine.result.listings[0].price, 80.5);
    assert.equal(mine.result.listings[0].title, "Logo design");
    const otherMine = must(call("service-market", "listing-list", ctxB, { mine: true }));
    assert.equal(otherMine.result.count, 0);
    const catalog = must(call("service-market", "listing-get", ctxB, { id: listingId }));
    assert.equal(catalog.result.listing.provider, "user_a");
    const deleted = call("service-market", "listing-delete", ctxB, { id: listingId });
    assert.equal(deleted.ok, false);
    assert.equal(deleted.error, "forbidden: not listing owner");
    assert.equal(must(call("service-market", "listing-get", ctxA, { id: listingId })).result.listing.price, 80.5);

    const asBuyer = must(call("service-market", "order-list", ctxA, { role: "buyer" }));
    assert.equal(asBuyer.result.count, 1);
    assert.equal(asBuyer.result.orders[0].id, orderId);
    assert.equal(asBuyer.result.orders[0].total, 80);
    assert.equal(asBuyer.result.orders[0].requirements, "vector files");
    assert.equal(asBuyer.result.orders[0].status, "pending");
    const asSeller = must(call("service-market", "order-list", ctxS, { role: "seller" }));
    assert.equal(asSeller.result.orders[0].id, orderId);
    const strangerBuyer = must(call("service-market", "order-list", ctxB, { role: "buyer" }));
    assert.equal(strangerBuyer.result.count, 0);
    const strangerSeller = must(call("service-market", "order-list", ctxB, { role: "seller" }));
    assert.equal(strangerSeller.result.count, 0);
    const updated = call("service-market", "order-update-status", ctxB, { id: orderId, status: "accepted" });
    assert.equal(updated.ok, false);
    assert.equal(updated.error, "forbidden: not a party to this order");
    assert.equal(must(call("service-market", "order-list", ctxA, { role: "buyer" })).result.orders[0].status, "pending");

    const second = must(call("service-market", "listing-create", ctxA, {
      title: "Second logo", price: 10, category: "design",
    }));
    assert.notEqual(second.result.listing.id, listingId);
    assert.equal(must(call("service-market", "listing-list", ctxA, { mine: true })).result.count, 2);
    assert.equal(must(call("service-market", "listing-list", ctxB, { mine: true })).result.count, 0);
  });

  it("rejects another listing or order once the per-account cap is reached", () => {
    let firstId = null;
    for (let i = 0; i < SERVICE_LISTING_CAP; i++) {
      const row = must(call("service-market", "listing-create", ctxA, {
        title: `Listing ${i}`, price: 5, category: "design",
      }));
      if (i === 0) firstId = row.result.listing.id;
    }
    const rejected = call("service-market", "listing-create", ctxA, {
      title: "Over cap", price: 5, category: "design",
    });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.error, "listing_cap");
    restartFromSnapshot();
    const mine = must(call("service-market", "listing-list", ctxA, { mine: true }));
    assert.equal(mine.result.count, SERVICE_LISTING_CAP);
    assert.equal(mine.result.listings.some((row) => row.id === firstId), true);
    assert.equal(call("service-market", "listing-create", ctxA, {
      title: "Still over", price: 5, category: "design",
    }).error, "listing_cap");
    assert.equal(must(call("service-market", "listing-list", ctxB, { mine: true })).result.count, 0);

    globalThis._concordSTATE = {};
    const seller = must(call("service-market", "listing-create", ctxS, {
      title: "Audit", price: 15, category: "design",
    }));
    let firstOrder = null;
    for (let i = 0; i < SERVICE_ORDER_CAP; i++) {
      const order = must(call("service-market", "order-create", ctxA, {
        listingId: seller.result.listing.id, quantity: 1,
      }));
      if (i === 0) firstOrder = order.result.order.id;
    }
    const rejectedOrder = call("service-market", "order-create", ctxA, {
      listingId: seller.result.listing.id, quantity: 3,
    });
    assert.equal(rejectedOrder.ok, false);
    assert.equal(rejectedOrder.error, "order_cap");
    assert.equal(seller.result.listing.price, 15);
    restartFromSnapshot();
    const orders = must(call("service-market", "order-list", ctxA, { role: "buyer" }));
    assert.equal(orders.result.count, SERVICE_ORDER_CAP);
    assert.equal(orders.result.orders.some((row) => row.id === firstOrder), true);
    assert.equal(orders.result.orders.find((row) => row.id === firstOrder).total, 15);
    assert.equal(call("service-market", "order-create", ctxA, {
      listingId: seller.result.listing.id,
    }).error, "order_cap");
    assert.equal(must(call("service-market", "order-list", ctxB, { role: "buyer" })).result.count, 0);
  });
});

describe("secret fields stay out of the money snapshot", () => {
  it("omits every excluded secret field and keeps the record fields", () => {
    const created = must(call("markets", "market-create", ctxA, {
      question: "Will the secret probe resolve yes",
      resolutionCriteria: "Published official result",
    }));
    const pos = must(call("markets", "position-open", ctxA, {
      marketId: created.result.market.id, side: "yes", stakeSparks: 12,
    }));
    const pact = must(call("insurance", "pact-write", ctxA, {
      beneficiaryUserId: "user_c", payoutSparks: 80, premiumSparks: 8,
    }));
    const carrier = must(call("insurance", "carrier-add", ctxA, { name: "Acme Mutual", naicNumber: "99" }));
    const envelope = must(call("insurance", "esign-create", ctxA, {
      title: "Binder application",
      signers: [{ name: "Ada", email: "ada@example.com", role: "insured" }],
    }));
    const listing = must(call("service-market", "listing-create", ctxA, {
      title: "Logo design",
      price: 80.5,
      category: "design",
      description: "token is a word in this sentence",
    }));
    const seller = must(call("service-market", "listing-create", ctxS, {
      title: "Audit", price: 20, category: "design",
    }));
    const order = must(call("service-market", "order-create", ctxA, {
      listingId: seller.result.listing.id, quantity: 1, requirements: "notes",
    }));

    const state = globalThis._concordSTATE;
    const planted = [
      state.predictionMarkets.positions.get(pos.result.position.id),
      state.inheritPacts.pacts.get("user_a")[0],
      state.inheritPacts.pacts.get("user_a")[0].beneficiaries[0],
      state.insAms.carriers.get("user_a")[0],
      state.insAms.envelopes.get("user_a")[0],
      state.serviceListings.get(listing.result.listing.id),
      state.serviceOrders.get(order.result.order.id),
    ];
    for (const row of planted) {
      for (const name of MONEY_SNAPSHOT_SECRET_FIELDS) row[name] = `SECRET_${name}_VALUE`;
    }

    const persisted = restartFromSnapshot();
    const json = JSON.stringify(persisted);
    for (const name of MONEY_SNAPSHOT_SECRET_FIELDS) {
      assert.equal(json.includes(`SECRET_${name}_VALUE`), false, name);
    }
    const seen = [];
    for (const key of MONEY_SNAPSHOT_KEYS) walkKeys(persisted[key], (k) => seen.push(k));
    for (const name of MONEY_SNAPSHOT_SECRET_FIELDS) {
      assert.equal(seen.includes(name), false, name);
    }

    const mine = must(call("markets", "my-positions", ctxA, {}));
    assert.equal(mine.result.positions[0].id, pos.result.position.id);
    assert.equal(mine.result.positions[0].stakeSparks, 12);
    assert.equal(mine.result.positions[0].token, undefined);
    const pacts = must(call("insurance", "pact-list", ctxA, {}));
    assert.equal(pacts.result.written[0].id, pact.result.pact.id);
    assert.equal(pacts.result.written[0].payoutSparks, 80);
    assert.equal(pacts.result.written[0].password, undefined);
    const carriers = must(call("insurance", "carrier-list", ctxA, {}));
    assert.equal(carriers.result.carriers[0].id, carrier.result.carrier.id);
    assert.equal(carriers.result.carriers[0].naicNumber, "99");
    const envelopes = must(call("insurance", "esign-list", ctxA, {}));
    assert.equal(envelopes.result.envelopes[0].id, envelope.result.envelope.id);
    assert.equal(envelopes.result.envelopes[0].signers[0].email, "ada@example.com");
    assert.equal(envelopes.result.envelopes[0].token, undefined);
    const got = must(call("service-market", "listing-get", ctxA, { id: listing.result.listing.id }));
    assert.equal(got.result.listing.price, 80.5);
    assert.equal(got.result.listing.description, "token is a word in this sentence");
    assert.equal(got.result.listing.paymentRef, undefined);
    const orders = must(call("service-market", "order-list", ctxA, { role: "buyer" }));
    assert.equal(orders.result.orders[0].id, order.result.order.id);
    assert.equal(orders.result.orders[0].total, 20);
    assert.equal(orders.result.orders[0].apiKey, undefined);
  });

  it("logs a one-account sample of the five keys", () => {
    must(call("markets", "market-create", ctxA, {
      question: "Will the sample probe resolve yes",
      resolutionCriteria: "Published official result",
    }));
    const marketId = [...globalThis._concordSTATE.predictionMarkets.markets.keys()][0];
    must(call("markets", "position-open", ctxA, { marketId, side: "yes", stakeSparks: 12 }));
    must(call("insurance", "pact-write", ctxA, {
      beneficiaryUserId: "user_c", payoutSparks: 80, premiumSparks: 8,
    }));
    must(call("insurance", "carrier-add", ctxA, { name: "Acme Mutual" }));
    must(call("service-market", "listing-create", ctxA, {
      title: "Logo design", price: 80.5, category: "design",
    }));
    const blob = serializeLensState(globalThis._concordSTATE);
    let total = 0;
    for (const key of MONEY_SNAPSHOT_KEYS) {
      const bytes = Buffer.byteLength(JSON.stringify(blob[key] ?? null));
      total += bytes;
      console.log(`MONEY_SNAPSHOT_KEY_BYTES ${key} ${bytes}`);
    }
    console.log(`MONEY_SNAPSHOT_SAMPLE_BYTES ${total}`);
    assert.ok(total > 0);
    assert.ok(total < 64_000, total);
  });
});
