// Contract tests for the crypto-lens parity macros in server/domains/crypto.js.
//
// Covers: snippets of existing analytical macros remain stable; new IDE-grade
// macros (search-tokens fallback path, token-candles deterministic fallback,
// swap-quote math, price alerts CRUD + check, allowances seeding + revoke,
// address book CRUD).
//
// Tests do NOT hit the network — they exercise the fallback paths so the
// suite is hermetic. The CoinGecko-touching paths are covered separately
// by integration smoke tests when CONCORD_NET_TESTS=true.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

import registerCryptoActions from "../domains/crypto.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`crypto.${name}`);
  assert.ok(fn, `crypto.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => {
  registerCryptoActions(register);
});

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map(), cryptoLens: { priceAlerts: [], allowances: new Map(), addressBook: new Map() } };
  globalThis._concordSaveStateDebounced = () => {};
  // Force `fetch` to throw so every test exercises the deterministic fallback
  // path, keeping the suite hermetic and reproducible offline.
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
});

const userA = "user_a";
const userB = "user_b";
const ctxA = { actor: { userId: userA }, userId: userA };
const ctxB = { actor: { userId: userB }, userId: userB };

describe("crypto.search-tokens (real CoinGecko, no fallback)", () => {
  it("returns error shape when CoinGecko unreachable (no synthetic FALLBACK_TOP_TOKENS)", async () => {
    const r = await call("search-tokens", ctxA, { page: 1, pageSize: 50 });
    assert.equal(r.ok, false);
    assert.match(r.error, /coingecko unreachable/);
  });

  it("parses real CoinGecko markets response when fetch succeeds", async () => {
    globalThis.fetch = async (url) => {
      assert.match(url, /api\.coingecko\.com\/api\/v3\/coins\/markets/);
      return {
        ok: true,
        json: async () => ([
          { id: "bitcoin", symbol: "btc", name: "Bitcoin", image: null, current_price: 65000, price_change_percentage_24h: 0.5, market_cap: 1.3e12, market_cap_rank: 1 },
          { id: "ethereum", symbol: "eth", name: "Ethereum", image: null, current_price: 3200, price_change_percentage_24h: -0.3, market_cap: 380e9, market_cap_rank: 2 },
        ]),
      };
    };
    const r = await call("search-tokens", ctxA, { page: 1, pageSize: 50 });
    assert.equal(r.ok, true);
    assert.equal(r.result.source, "coingecko");
    assert.equal(r.result.tokens[0].symbol, "BTC");
  });
});

describe("crypto.token-candles (real CoinGecko, no fallback)", () => {
  it("returns error shape when CoinGecko unreachable (no synthetic fallback)", async () => {
    const r = await call("token-candles", ctxA, { id: "bitcoin", days: 14 });
    assert.equal(r.ok, false);
    assert.match(r.error, /coingecko unreachable|network/);
  });

  it("parses CoinGecko candle + volume response", async () => {
    globalThis.fetch = async (url) => {
      if (url.includes("/ohlc")) {
        return { ok: true, json: async () => ([
          [1700000000000, 35000, 35500, 34800, 35200],
          [1700086400000, 35200, 35400, 35000, 35300],
        ]) };
      }
      // market_chart for volumes
      return { ok: true, json: async () => ({ total_volumes: [[1700000000000, 1_000_000], [1700086400000, 1_200_000]] }) };
    };
    const r = await call("token-candles", ctxA, { id: "bitcoin", days: 14 });
    assert.equal(r.ok, true);
    assert.equal(r.result.source, "coingecko");
    assert.equal(r.result.candles.length, 2);
    assert.equal(r.result.candles[0].open, 35000);
    assert.equal(r.result.candles[0].volume, 1_000_000);
  });

  it("clamps days to [1, 365] even when network is mocked", async () => {
    globalThis.fetch = async (url) => {
      // Verify days was clamped to 365 in the URL
      assert.match(url, /days=365/);
      return { ok: true, json: async () => [] };
    };
    const r = await call("token-candles", ctxA, { id: "ethereum", days: 99999 });
    assert.equal(r.ok, true);
  });
});

describe("crypto.swap-quote (real CoinGecko, no synthetic fallback)", () => {
  it("rejects same fromId / toId", async () => {
    const r = await call("swap-quote", ctxA, { fromId: "bitcoin", toId: "bitcoin", amountIn: 1 });
    assert.equal(r.ok, false);
  });

  it("rejects zero or negative amountIn", async () => {
    const r = await call("swap-quote", ctxA, { fromId: "bitcoin", toId: "ethereum", amountIn: 0 });
    assert.equal(r.ok, false);
  });

  it("returns error when CoinGecko unreachable (no hash-seeded synthetic price)", async () => {
    const r = await call("swap-quote", ctxA, { fromId: "bitcoin", toId: "ethereum", amountIn: 1 });
    assert.equal(r.ok, false);
    assert.match(r.error, /coingecko unreachable/);
  });

  it("computes amountOut, rate, and minimumReceived from real CoinGecko prices", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ bitcoin: { usd: 65000 }, ethereum: { usd: 3250 } }),
    });
    const r = await call("swap-quote", ctxA, { fromId: "bitcoin", toId: "ethereum", amountIn: 1, slippagePercent: 0.5 });
    assert.equal(r.ok, true);
    assert.ok(r.result.amountOut > 0);
    // 1 BTC × (65000 / 3250) ≈ 20 ETH, minus 0.3% LP fee ≈ 19.94
    assert.ok(r.result.amountOut > 19 && r.result.amountOut < 20);
    assert.equal(r.result.source, "coingecko");
    assert.equal(r.result.slippagePercent, 0.5);
    assert.deepEqual(r.result.route, ["BITCOIN", "ETHEREUM"]);
    // priceImpact + gas are NOT computable from spot prices → null with note
    assert.equal(r.result.priceImpactPercent, null);
    assert.equal(r.result.gasEstimateUsd, null);
    assert.equal(r.result.kind, "indicative");
    assert.match(r.result.notes, /swap-route|aggregator|ZEROX_API_KEY/);
  });

  it("refuses when CoinGecko has no USD price for one of the tokens", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ bitcoin: { usd: 65000 } /* ethereum missing */ }),
    });
    const r = await call("swap-quote", ctxA, { fromId: "bitcoin", toId: "ethereum", amountIn: 1 });
    assert.equal(r.ok, false);
    assert.match(r.error, /no usd price for ethereum/);
  });
});

describe("crypto.price-alerts CRUD + check", () => {
  it("creates, lists scoped to user, deletes", () => {
    const create = call("price-alerts-create", ctxA, { tokenId: "bitcoin", symbol: "BTC", direction: "above", threshold: 70000 });
    assert.equal(create.ok, true);
    const id = create.result.alert.id;

    const listA = call("price-alerts-list", ctxA, {});
    assert.equal(listA.result.alerts.length, 1);
    assert.equal(listA.result.alerts[0].symbol, "BTC");

    // Other user sees nothing
    const listB = call("price-alerts-list", ctxB, {});
    assert.equal(listB.result.alerts.length, 0);

    // Wrong user can't delete
    const deleteWrong = call("price-alerts-delete", ctxB, { id });
    assert.equal(deleteWrong.ok, false);

    const deleteRight = call("price-alerts-delete", ctxA, { id });
    assert.equal(deleteRight.ok, true);
    assert.equal(call("price-alerts-list", ctxA, {}).result.alerts.length, 0);
  });

  it("rejects invalid create payloads", () => {
    assert.equal(call("price-alerts-create", ctxA, { tokenId: "", symbol: "BTC", threshold: 1 }).ok, false);
    assert.equal(call("price-alerts-create", ctxA, { tokenId: "bitcoin", symbol: "", threshold: 1 }).ok, false);
    assert.equal(call("price-alerts-create", ctxA, { tokenId: "bitcoin", symbol: "BTC", threshold: 0 }).ok, false);
  });

  it("check returns empty when no alerts are armed and network unavailable", async () => {
    const r = await call("price-alerts-check", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.triggered.length, 0);
  });
});

describe("crypto.token-allowances + revoke (no auto-seeded demo data)", () => {
  it("returns empty + setup hint when no allowances revealed for the wallet", () => {
    const wallet = "0xabc1234567890abc1234567890abc1234567890a";
    const r = call("token-allowances", ctxA, { walletAddress: wallet });
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.allowances, []);
    assert.equal(r.result.source, "empty");
    assert.match(r.result.notes, /ETHERSCAN_API_KEY|ALCHEMY_API_KEY|WalletConnect/);
  });

  it("rejects missing walletAddress", () => {
    const r = call("token-allowances", ctxA, {});
    assert.equal(r.ok, false);
  });

  it("returns user-revealed allowances + revoke removes one (per (user, wallet) scoping)", () => {
    const wallet = "0xabc1234567890abc1234567890abc1234567890a";
    // Caller (e.g. a WalletConnect bridge) populates the allowance list:
    const state = globalThis._concordSTATE;
    state.cryptoLens = state.cryptoLens || {};
    state.cryptoLens.allowances = state.cryptoLens.allowances || new Map();
    state.cryptoLens.allowances.set(`user_a:${wallet}`, [
      { id: "alw_1", tokenSymbol: "USDC", spenderLabel: "Uniswap V3 Router", allowance: "unlimited", riskLevel: "high" },
      { id: "alw_2", tokenSymbol: "DAI", spenderLabel: "Old Vault", allowance: 500, riskLevel: "moderate" },
    ]);
    const r1 = call("token-allowances", ctxA, { walletAddress: wallet });
    assert.equal(r1.result.allowances.length, 2);
    assert.equal(r1.result.source, "wallet-revealed");
    // Other user's view is empty (per-user scoping)
    const r2 = call("token-allowances", ctxB, { walletAddress: wallet });
    assert.equal(r2.result.allowances.length, 0);
    // Revoke removes one
    const revoke = call("revoke-allowance", ctxA, { id: "alw_1", walletAddress: wallet });
    assert.equal(revoke.ok, true);
    const after = call("token-allowances", ctxA, { walletAddress: wallet });
    assert.equal(after.result.allowances.length, 1);
  });

  it("revoke-allowance rejects unknown id", () => {
    const r = call("revoke-allowance", ctxA, { id: "no-such-id", walletAddress: "0x0" });
    assert.equal(r.ok, false);
  });
});

describe("crypto.address-book CRUD", () => {
  it("save, list, delete scoped per user", () => {
    const save = call("address-book-save", ctxA, { label: "Vitalik", address: "0xab5801a7d398351b8be11c439e05c5b3259aec9b", chain: "ethereum" });
    assert.equal(save.ok, true);
    const id = save.result.id;

    const list = call("address-book-list", ctxA, {});
    assert.equal(list.result.entries.length, 1);
    assert.equal(list.result.entries[0].label, "Vitalik");

    // Other user empty
    const otherList = call("address-book-list", ctxB, {});
    assert.equal(otherList.result.entries.length, 0);

    const del = call("address-book-delete", ctxA, { id });
    assert.equal(del.ok, true);
    assert.equal(call("address-book-list", ctxA, {}).result.entries.length, 0);
  });

  it("rejects save with missing label or address", () => {
    assert.equal(call("address-book-save", ctxA, { label: "", address: "0xabc" }).ok, false);
    assert.equal(call("address-book-save", ctxA, { label: "x", address: "" }).ok, false);
  });
});

describe("regression: pre-existing analytical macros still work", () => {
  it("portfolioAnalysis HHI + concentration risk", () => {
    const r = ACTIONS.get("crypto.portfolioAnalysis")(ctxA, {
      data: { holdings: [
        { token: "BTC", amount: 1, priceUsd: 65000, costBasis: 50000 },
        { token: "USDC", amount: 5000, priceUsd: 1.00 },
      ] },
    }, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.totalValue > 60000);
    assert.ok(r.result.hhi > 0);
    assert.ok(typeof r.result.concentrationRisk === "string");
    assert.ok(r.result.stablecoinExposure > 0);
  });

  it("verifyTransaction flags malformed address + self-send + chain unknowns", () => {
    const r = ACTIONS.get("crypto.verifyTransaction")(ctxA, { data: {} }, {
      transaction: { from: "0xZZZ", to: "0xZZZ", value: 0, gasLimit: 21000, gasPrice: 20, nonce: 1, chainId: 1 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.valid, false);
    assert.equal(r.result.network, "Ethereum");
    assert.ok(r.result.checks.some(c => c.field === "self_send"));
  });

  it("estimateGas computes recommendations from block data + congestion", () => {
    const r = ACTIONS.get("crypto.estimateGas")(ctxA, {
      data: { recentBlocks: Array.from({ length: 8 }, (_, i) => ({ baseFee: 20 + i, gasUsed: 25e6, gasLimit: 30e6 })) },
    }, { txType: "swap" });
    assert.equal(r.ok, true);
    assert.equal(r.result.source, "block_analysis");
    assert.ok(r.result.recommendations.fast.maxFeeGwei >= r.result.recommendations.slow.maxFeeGwei);
    assert.equal(r.result.txType, "swap");
  });

  it("detectPatterns finds wash trading and whale movements", () => {
    const txs = [
      { from: "0xa", to: "0xb", value: 1, timestamp: "2026-05-15T10:00:00Z" },
      { from: "0xb", to: "0xa", value: 1, timestamp: "2026-05-15T10:01:00Z" },
      { from: "0xa", to: "0xb", value: 1, timestamp: "2026-05-15T10:02:00Z" },
      { from: "0xa", to: "0xb", value: 1, timestamp: "2026-05-15T10:03:00Z" },
      { from: "0xa", to: "0xb", value: 1, timestamp: "2026-05-15T10:04:00Z" },
      { from: "0xa", to: "0xb", value: 1, timestamp: "2026-05-15T10:05:00Z" },
      { from: "0xa", to: "0xb", value: 1, timestamp: "2026-05-15T10:06:00Z" },
      { from: "0xa", to: "0xb", value: 1, timestamp: "2026-05-15T10:07:00Z" },
      { from: "0xc", to: "0xd", value: 10_000_000, timestamp: "2026-05-15T11:00:00Z" },
    ];
    const r = ACTIONS.get("crypto.detectPatterns")(ctxA, { data: { transactions: txs } }, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.patterns.some(p => p.type === "wash_trading_suspect"));
    assert.ok(r.result.patterns.some(p => p.type === "whale_movement"));
  });
});

describe("crypto.swap-route (real 0x aggregator, no simulated routing)", () => {
  it("rejects when ZEROX_API_KEY env not set", async () => {
    delete process.env.ZEROX_API_KEY;
    const r = await call("swap-route", ctxA, { sellToken: "ETH", buyToken: "USDC", sellAmount: "1000000000000000000" });
    assert.equal(r.ok, false);
    assert.match(r.error, /ZEROX_API_KEY|0x aggregator/);
  });

  it("rejects missing params", async () => {
    process.env.ZEROX_API_KEY = "key_dummy";
    assert.equal((await call("swap-route", ctxA, {})).ok, false);
    assert.equal((await call("swap-route", ctxA, { sellToken: "ETH", buyToken: "ETH", sellAmount: "1" })).ok, false);
    assert.equal((await call("swap-route", ctxA, { sellToken: "ETH", buyToken: "USDC", sellAmount: "1.5" })).ok, false);
    delete process.env.ZEROX_API_KEY;
  });

  it("rejects unsupported chainId", async () => {
    process.env.ZEROX_API_KEY = "key_dummy";
    const r = await call("swap-route", ctxA, {
      sellToken: "ETH", buyToken: "USDC", sellAmount: "1000000000000000000", chainId: 9999,
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /unsupported chainId/);
    delete process.env.ZEROX_API_KEY;
  });

  it("hits /price endpoint when taker omitted (indicative aggregator quote)", async () => {
    process.env.ZEROX_API_KEY = "key_real";
    let captured;
    globalThis.fetch = async (url, opts) => {
      captured = { url, headers: opts?.headers };
      return {
        ok: true,
        json: async () => ({
          buyAmount: "3250000000", sellAmount: "1000000000000000000",
          price: "3250.0", estimatedPriceImpact: "0.05",
          route: { fills: [{ source: "Uniswap_V3", proportionBps: 7000 }, { source: "Curve", proportionBps: 3000 }] },
        }),
      };
    };
    const r = await call("swap-route", ctxA, {
      sellToken: "ETH", buyToken: "USDC", sellAmount: "1000000000000000000", chainId: 1,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.kind, "indicative-aggregator");
    assert.match(captured.url, /api\.0x\.org\/swap\/permit2\/price/);
    assert.equal(captured.headers["0x-api-key"], "key_real");
    assert.equal(captured.headers["0x-version"], "v2");
    assert.equal(r.result.buyAmount, "3250000000");
    assert.equal(r.result.sources.length, 2);
    assert.equal(r.result.sources[0].source, "Uniswap_V3");
    delete process.env.ZEROX_API_KEY;
  });

  it("hits /quote endpoint when taker supplied (executable, returns signable tx)", async () => {
    process.env.ZEROX_API_KEY = "key_real";
    let captured;
    globalThis.fetch = async (url) => {
      captured = url;
      return {
        ok: true,
        json: async () => ({
          buyAmount: "3250000000", minBuyAmount: "3233750000",
          price: "3250.0", estimatedPriceImpact: "0.05",
          transaction: { to: "0xdef1c0ded9bec7f1a1670819833240f027b25eff", data: "0x12345...", value: "1000000000000000000", gas: "180000", gasPrice: "30000000000" },
          issues: { allowance: { spender: "0xdef1c0ded9bec7f1a1670819833240f027b25eff" } },
          route: { fills: [{ source: "Uniswap_V3", proportionBps: 10000 }] },
        }),
      };
    };
    const r = await call("swap-route", ctxA, {
      sellToken: "ETH", buyToken: "USDC", sellAmount: "1000000000000000000",
      chainId: 1, taker: "0xabc1234567890abc1234567890abc1234567890a",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.kind, "executable");
    assert.match(captured, /\/swap\/permit2\/quote/);
    assert.match(captured, /taker=0xabc/);
    assert.equal(r.result.to, "0xdef1c0ded9bec7f1a1670819833240f027b25eff");
    assert.equal(r.result.gas, "180000");
    assert.equal(r.result.allowanceTarget, "0xdef1c0ded9bec7f1a1670819833240f027b25eff");
    delete process.env.ZEROX_API_KEY;
  });

  it("surfaces 0x error responses verbatim", async () => {
    process.env.ZEROX_API_KEY = "key_bad";
    globalThis.fetch = async () => ({
      ok: false,
      status: 400,
      json: async () => ({ reason: "INSUFFICIENT_LIQUIDITY" }),
    });
    const r = await call("swap-route", ctxA, {
      sellToken: "ETH", buyToken: "USDC", sellAmount: "1000000000000000000",
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /INSUFFICIENT_LIQUIDITY/);
    delete process.env.ZEROX_API_KEY;
  });

  it("supports Base / Arbitrum / Optimism via chain-scoped hosts", async () => {
    process.env.ZEROX_API_KEY = "key_real";
    const hosts = [];
    globalThis.fetch = async (url) => {
      hosts.push(new URL(url).host);
      return { ok: true, json: async () => ({ buyAmount: "1" }) };
    };
    await call("swap-route", ctxA, { sellToken: "ETH", buyToken: "USDC", sellAmount: "1000000000000000000", chainId: 8453 });
    await call("swap-route", ctxA, { sellToken: "ETH", buyToken: "USDC", sellAmount: "1000000000000000000", chainId: 42161 });
    await call("swap-route", ctxA, { sellToken: "ETH", buyToken: "USDC", sellAmount: "1000000000000000000", chainId: 10 });
    assert.equal(hosts[0], "base.api.0x.org");
    assert.equal(hosts[1], "arbitrum.api.0x.org");
    assert.equal(hosts[2], "optimism.api.0x.org");
    delete process.env.ZEROX_API_KEY;
  });
});
