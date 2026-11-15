// Money-lens slice pins (B11, 2026-11-13) — crypto tickets:
//  FIX-crypto-008  the address book accepted any string as an address
//                  and entries could not be edited. Saves/updates now
//                  validate the address against its chain's shape, and
//                  address-book-update exists.
//  FIX-crypto-007  portfolio-summary valued unpriced holdings at $0,
//                  rendering a price outage as "value $0, PnL -100%".
//                  Totals are now null when nothing is priced (the
//                  holdings-list honesty), with unpricedSymbols named.
// Money OFF throughout: no trading or money movement is enabled.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerCryptoActions from "../domains/crypto.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`crypto.${name}`);
  if (!fn) throw new Error(`crypto.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}
before(() => { registerCryptoActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const EVM = "0x1234567890abcdef1234567890abcdef12345678";

describe("FIX-crypto-008 — address book validation + edit", () => {
  it("a fake EVM address refuses in words; a well-formed one saves", () => {
    const bad = call("address-book-save", ctxA, { label: "Pal", address: "not-an-address", chain: "ethereum" });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /0x/);
    const good = call("address-book-save", ctxA, { label: "Pal", address: EVM, chain: "ethereum" });
    assert.equal(good.ok, true);
    assert.equal(call("address-book-list", ctxA).result.entries.length, 1);
  });

  it("chain shapes are enforced per chain (bitcoin address on ethereum refuses)", () => {
    const btc = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
    assert.equal(call("address-book-save", ctxA, { label: "B", address: btc, chain: "bitcoin" }).ok, true);
    assert.equal(call("address-book-save", ctxA, { label: "B2", address: btc, chain: "ethereum" }).ok, false);
  });

  it("address-book-update edits in place and re-validates", () => {
    const id = call("address-book-save", ctxA, { label: "Pal", address: EVM, chain: "ethereum" }).result.id;
    const upd = call("address-book-update", ctxA, { id, label: "Best pal", address: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.entry.label, "Best pal");
    const bad = call("address-book-update", ctxA, { id, address: "junk" });
    assert.equal(bad.ok, false);
    const entries = call("address-book-list", ctxA).result.entries;
    assert.equal(entries.length, 1);
    assert.equal(entries[0].address, "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd");
  });
});

describe("FIX-crypto-007 — unpriced is not worthless", () => {
  it("with prices unreachable, summary totals are null — never $0 / -100%", async () => {
    // Seed a holding lot directly in the lens state (the no-egress
    // test preload makes fetchLivePrices return {} — the outage case).
    globalThis._concordSTATE = {};
    const add = await call("holdings-add", ctxA, { symbol: "bitcoin", ticker: "BTC", chain: "ethereum", qty: 0.5, costBasisUsd: 50 });
    assert.equal(add.ok, true, JSON.stringify(add));
    const sum = await call("portfolio-summary", ctxA, {});
    assert.equal(sum.ok, true);
    assert.equal(sum.result.totalCostUsd, 50);
    assert.equal(sum.result.totalValueUsd, null);
    assert.equal(sum.result.unrealizedPnlUsd, null);
    assert.equal(sum.result.unrealizedPnlPct, null);
    assert.equal(sum.result.priceSource, "unavailable");
    assert.deepEqual(sum.result.unpricedSymbols, ["bitcoin"]);
  });
});
