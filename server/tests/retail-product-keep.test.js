// tests/retail-product-keep.test.js — REAL end-to-end proof for the Retail
// lens keep-and-draft workflow. Mirrors the established pattern: create a
// real product via `product-upsert`, read it back via `product-list`, save
// it as a private DTU via `dtu.create`, read that DTU back via `dtu.get`,
// then draft it in Thread via `thread.thread-draft` citing that exact DTU.
//
// Every lensRun call below names the macro literally. Nothing is published.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./depth/_harness.js";

describe("retail product keep + thread draft", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("retail-keep-proof"); });

  it("creates a real product, lists it, saves a private DTU, reads it back, and drafts it in Thread", async () => {
    // 1. Create a real product via the retail domain macro.
    const sku = `PROOF-${Date.now().toString(36)}`;
    const created = await lensRun("retail", "product-upsert", {
      params: {
        sku,
        name: "Proof Widget",
        price: 29.99,
        stock: 150,
        category: "Electronics",
        supplier: "Acme Corp",
        leadTimeDays: 14,
        dailySalesRate: 2.5,
      },
    }, ctx);
    assert.equal(created.ok, true, "product-upsert should succeed");
    assert.equal(created.result.product.sku, sku);

    // 2. Read the real product list (the same macro the UI uses).
    const listed = await lensRun("retail", "product-list", {}, ctx);
    assert.equal(listed.ok, true, "product-list should succeed");
    const product = listed.result.products.find((p) => p.sku === sku);
    assert.ok(product, "product-list should contain the created product");
    assert.equal(product.name, "Proof Widget");
    assert.equal(product.price, 29.99);
    assert.equal(product.stock, 150);
    assert.equal(product.supplier, "Acme Corp");
    assert.equal(product.leadTimeDays, 14);

    // 3. Save the product as a private DTU.
    const sentence = `Proof Widget · ${sku}: $29.99, 150 in stock, Electronics, Acme Corp, 14d lead.`;
    const dtuCreated = await lensRun("dtu", "create", {
      params: {
        title: sentence.slice(0, 80),
        tags: ["retail", "product", "electronics"],
        source: "retail-lens:product-report",
        human: { summary: sentence },
        core: { definitions: [sentence], claims: [sentence.slice(0, 240)] },
        machine: {
          kind: "retail_product_report",
          sku,
          name: "Proof Widget",
          price: 29.99,
          stock: 150,
          category: "Electronics",
          supplier: "Acme Corp",
          leadTimeDays: 14,
        },
        meta: { visibility: "private", consent: { allowCitations: false }, createdFrom: "retail" },
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
        title: "Retail product — Proof Widget",
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

  it("refuses to upsert a product without a sku", async () => {
    const r = await lensRun("retail", "product-upsert", { params: { sku: "", name: "X", price: 10, stock: 5 } }, ctx);
    assert.equal(r.result.ok, false);
    assert.equal(r.result.error, "sku required");
  });
});