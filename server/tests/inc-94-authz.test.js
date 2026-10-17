// INC-94 (a) authorization regression test.
//
// invoice-webhook-mark-paid was reachable via /api/lens/run and used the
// client-supplied params.userId to select the invoice bucket. A signed-in
// user B could pass A's userId and mark A's invoice paid. This test pins:
//   - owner still works,
//   - anonymous callers are refused,
//   - user B cannot mark A's invoice paid (forbidden + row unchanged).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerAccountingActions from "../domains/accounting.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  ACTIONS.set(`${domain}.${name}`, fn);
}
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`accounting.${name}`);
  if (!fn) throw new Error(`accounting.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => {
  registerAccountingActions(register);
});

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => {
    throw new Error("network disabled");
  };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };
const ctxAnon = { actor: { userId: "anon" } };

function seedInvoice(ctx) {
  call("coa-list", ctx); // initializes the accountingLens bucket for this actor
  const inv = call("invoice-create", ctx, {
    customerName: "Customer",
    total: 100,
    dueAt: "2026-12-31",
  });
  assert.equal(inv.ok, true);

  // Simulate what invoice-create-payment-link would have stored in Stripe.
  const list = globalThis._concordSTATE.accountingLens.invoices.get(ctx.actor.userId);
  const stored = list.find((i) => i.id === inv.result.invoice.id);
  stored.stripeInvoiceId = `in_inc94_${ctx.actor.userId}`;

  return { id: stored.id, stripeInvoiceId: stored.stripeInvoiceId };
}

function findInvoice(userId, id) {
  const list = globalThis._concordSTATE.accountingLens.invoices.get(userId) || [];
  return list.find((i) => i.id === id);
}

describe("accounting.invoice-webhook-mark-paid — INC-94 authz", () => {
  it("owner can mark their own invoice paid", () => {
    const { stripeInvoiceId } = seedInvoice(ctxA);

    const r = call("invoice-webhook-mark-paid", ctxA, {
      stripeInvoiceId,
      userId: "user_a", // params.userId is ignored; identity comes from ctx.actor
    });

    assert.equal(r.ok, true);
    assert.equal(r.result.invoice.status, "paid");
    assert.equal(r.result.invoice.paidVia, "stripe");
  });

  it("anonymous callers are refused and no invoice changes", () => {
    const { id, stripeInvoiceId } = seedInvoice(ctxA);

    const r = call("invoice-webhook-mark-paid", ctxAnon, {
      stripeInvoiceId,
      userId: "user_a",
    });

    assert.equal(r.ok, false);
    assert.equal(r.error, "auth_required");
    const stored = findInvoice("user_a", id);
    assert.equal(stored.status, "open");
    assert.equal(stored.paidVia, undefined);
  });

  it("user B cannot mark user A's invoice paid, even passing A's userId", () => {
    const { id, stripeInvoiceId } = seedInvoice(ctxA);
    assert.ok(stripeInvoiceId);

    // Previously this reached the invoice lookup; now identity comes from
    // ctx.actor and requireOwner refuses the cross-user request.
    const r = call("invoice-webhook-mark-paid", ctxB, {
      stripeInvoiceId,
      userId: "user_a",
    });

    assert.equal(r.ok, false);
    assert.equal(r.error, "forbidden");
    const stored = findInvoice("user_a", id);
    assert.equal(stored.status, "open");
    assert.equal(stored.paidVia, undefined);
  });

  it("user B cannot mark user A's invoice paid without the userId param", () => {
    const { id, stripeInvoiceId } = seedInvoice(ctxA);

    const r = call("invoice-webhook-mark-paid", ctxB, { stripeInvoiceId });

    assert.equal(r.ok, false);
    assert.match(r.error, /stripeInvoiceId \+ userId required/i);
    const stored = findInvoice("user_a", id);
    assert.equal(stored.status, "open");
  });
});
