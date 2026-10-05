// tests/accounting-entry-keep.test.js — REAL end-to-end proof for the
// Accounting lens keep-and-draft workflow. Mirrors the established pattern:
// post a real journal entry via `je-post`, read it back via `ledger-list`,
// save it as a private DTU via `dtu.create`, read that DTU back via
// `dtu.get`, then draft it in Thread via `thread.thread-draft` citing that
// exact DTU id.
//
// Every lensRun call below names the macro literally. Nothing is published.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./depth/_harness.js";

describe("accounting journal entry keep + thread draft", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("accounting-keep-proof"); });

  it("posts a real journal entry, lists it, saves a private DTU, reads it back, and drafts it in Thread", async () => {
    // 0. Get the chart of accounts to find real account IDs.
    const coa = await lensRun("accounting", "coa-list", {}, ctx);
    assert.equal(coa.ok, true, "coa-list should succeed");
    const accounts = coa.result.accounts.filter((a) => !a.archived);
    assert.ok(accounts.length >= 2, "should have at least 2 accounts");
    const cash = accounts.find((a) => /cash/i.test(a.name)) || accounts.find((a) => a.category === "asset") || accounts[0];
    const revenue = accounts.find((a) => /revenue|sales|income/i.test(a.name)) || accounts.find((a) => a.category === "revenue") || accounts[1];
    assert.ok(cash && revenue, "need a cash and a revenue account");

    // 1. Post a real balanced journal entry via the accounting domain macro.
    const posted = await lensRun("accounting", "je-post", {
      params: {
        date: "2026-10-05",
        memo: "Proof revenue entry",
        lines: [
          { accountId: cash.id, debit: 500, credit: 0, memo: "Cash sale" },
          { accountId: revenue.id, debit: 0, credit: 500, memo: "Recognized revenue" },
        ],
      },
    }, ctx);
    assert.equal(posted.ok, true, "je-post should succeed");
    const entry = posted.result.entry;
    assert.ok(entry.id, "entry should have an id");
    assert.ok(entry.number, "entry should have a number (JE-xxxxx)");
    assert.equal(entry.totalDebit, 500);
    assert.equal(entry.totalCredit, 500);

    // 2. Read the real ledger (the same macro the UI uses).
    const ledger = await lensRun("accounting", "ledger-list", { params: { limit: 10 } }, ctx);
    assert.equal(ledger.ok, true, "ledger-list should succeed");
    const ledgerRow = (ledger.result.rows || []).find((r) => r.entryId === entry.id);
    assert.ok(ledgerRow, "ledger-list should contain the posted entry");

    // 3. Save the entry as a private DTU.
    const sentence = `${entry.number} · 2026-10-05: 2 lines, 500.00 balanced.`;
    const dtuCreated = await lensRun("dtu", "create", {
      params: {
        title: sentence.slice(0, 80),
        tags: ["accounting", "journal-entry", "books"],
        source: "accounting-lens:journal-entry-report",
        human: { summary: sentence },
        core: { definitions: [sentence], claims: [sentence.slice(0, 240)] },
        machine: {
          kind: "accounting_journal_entry_report",
          entryId: entry.id,
          number: entry.number,
          date: "2026-10-05",
          memo: "Proof revenue entry",
          totalDebit: 500,
          totalCredit: 500,
          lineCount: 2,
        },
        meta: { visibility: "private", consent: { allowCitations: false }, createdFrom: "accounting" },
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
        title: "Accounting entry — " + entry.number,
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

  it("refuses to post an unbalanced journal entry", async () => {
    const coa = await lensRun("accounting", "coa-list", {}, ctx);
    const accounts = coa.result.accounts.filter((a) => !a.archived);
    const r = await lensRun("accounting", "je-post", {
      params: {
        lines: [
          { accountId: accounts[0].id, debit: 100, credit: 0 },
          { accountId: accounts[1].id, debit: 0, credit: 90 },
        ],
      },
    }, ctx);
    assert.equal(r.result.ok, false);
    assert.ok(/unbalanced/.test(r.result.error), "should reject unbalanced entry");
  });
});