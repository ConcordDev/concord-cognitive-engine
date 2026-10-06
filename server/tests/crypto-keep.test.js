// tests/crypto-keep.test.js — REAL end-to-end proof for the Crypto lens
// keep-and-draft workflow. Mirrors the established pattern:
// create a real holding lot via `holdings-add`, read it back via
// `holdings-list`, save it as a private DTU via `dtu.create`, read that
// DTU back via `dtu.get`, then draft it in Thread via
// `thread.thread-draft` citing that exact DTU id.
//
// Every lensRun call below names the macro literally. Nothing is published.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./depth/_harness.js";

describe("crypto keep + thread draft", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("crypto-keep-proof"); });

  it("creates a real holding lot, reads it back, saves a private DTU, reads it back, and drafts it in Thread", async () => {
    // 1. Create a real holding lot via the crypto domain holdings-add macro.
    const holdR = await lensRun("crypto", "holdings-add", {
      params: {
        symbol: "btc",
        ticker: "BTC",
        qty: 0.5,
        costBasisUsd: 30000,
        chain: "bitcoin",
      },
    }, ctx);
    assert.equal(holdR.ok, true, "holdings-add should succeed");
    const lot = holdR.result.lot;
    assert.ok(lot.id, "lot should have an id");
    assert.ok(/H-/.test(lot.number), "lot should have an H- number");
    assert.equal(lot.symbol, "btc");
    assert.equal(lot.ticker, "BTC");
    assert.equal(lot.chain, "bitcoin");
    assert.equal(lot.qty, 0.5);
    assert.equal(lot.costBasisUsd, 30000);
    assert.equal(lot.unitCostUsd, 60000, "unit cost = 30000 / 0.5");
    assert.equal(lot.qtyRemaining, 0.5);
    // A mirrored transaction should also be returned.
    const tx = holdR.result.transaction;
    assert.ok(tx.id, "mirrored transaction should have an id");
    assert.equal(tx.kind, "buy");

    // 2. Read the real holding back via holdings-list (the same macro the UI uses).
    const listR = await lensRun("crypto", "holdings-list", {}, ctx);
    assert.equal(listR.ok, true, "holdings-list should succeed");
    const holdings = listR.result.holdings || [];
    const found = holdings.find((h) => h.symbol === "btc" || h.ticker === "BTC");
    assert.ok(found, "holdings-list should include the created lot's symbol");

    // 3. Save the lot as a private DTU.
    const sentence = `${lot.number} · BTC: 0.5 @ $60000.00 = $30000.00.`;
    const dtuCreated = await lensRun("dtu", "create", {
      params: {
        title: sentence.slice(0, 80),
        tags: ["crypto", "holding", "lot"],
        source: "crypto-lens:holding-report",
        human: { summary: sentence },
        core: { definitions: [sentence], claims: [sentence.slice(0, 240)] },
        machine: {
          kind: "crypto_holding_report",
          lotId: lot.id,
          number: lot.number,
          symbol: lot.symbol,
          ticker: lot.ticker,
          chain: lot.chain,
          qty: lot.qty,
          qtyRemaining: lot.qtyRemaining,
          costBasisUsd: lot.costBasisUsd,
          unitCostUsd: lot.unitCostUsd,
        },
        meta: { visibility: "private", consent: { allowCitations: false }, createdFrom: "crypto" },
      },
    }, ctx);
    assert.equal(dtuCreated.ok, true, "dtu.create should succeed");
    const dtuId = dtuCreated.result.dtu.id;
    assert.ok(dtuId, "DTU should have an id");

    // 4. Read the DTU back and confirm the id matches.
    const dtuBack = await lensRun("dtu", "get", { params: { id: dtuId } }, ctx);
    assert.equal(dtuBack.ok, true, "dtu.get should succeed");
    assert.equal(dtuBack.result.dtu.id, dtuId, "read-back DTU id must match");

    // 5. Draft it in Thread, citing that exact DTU.
    const drafted = await lensRun("thread", "thread-draft", {
      params: {
        title: `Crypto holding — ${lot.number}`,
        content: sentence,
        platform: "x",
        citedDtuId: dtuId,
      },
    }, ctx);
    assert.equal(drafted.ok, true, "thread-draft should succeed");
    const draft = drafted.result.draft;
    assert.equal(draft.status, "draft", "draft must stay draft");
    assert.equal(draft.citedDtuId, dtuId, "draft must cite the exact DTU");
    assert.ok(draft.id, "draft should have an id");

    // 6. Read the draft back and confirm it still cites the DTU.
    const draftBack = await lensRun("thread", "draft-detail", { params: { id: draft.id } }, ctx);
    assert.equal(draftBack.ok, true, "draft-detail should succeed");
    assert.equal(draftBack.result.draft.citedDtuId, dtuId, "draft-detail must cite the same DTU");
    assert.equal(draftBack.result.draft.status, "draft", "draft-detail must still be draft");
  });

  it("refuses to create a lot with no symbol", async () => {
    const r = await lensRun("crypto", "holdings-add", { params: { symbol: "", qty: 1, costBasisUsd: 10 } }, ctx);
    assert.equal(r.result.ok, false);
    assert.ok(/symbol/i.test(r.result.error), "should reject missing symbol");
  });

  it("refuses to create a lot with non-positive qty", async () => {
    const r = await lensRun("crypto", "holdings-add", { params: { symbol: "eth", qty: 0, costBasisUsd: 10 } }, ctx);
    assert.equal(r.result.ok, false);
    assert.ok(/qty/i.test(r.result.error), "should reject non-positive qty");
  });
});