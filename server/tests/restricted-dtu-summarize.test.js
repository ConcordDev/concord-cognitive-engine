// restricted-dtu-summarize — the summary-only migration for stored DTUs
// holding restricted-outlet article text. Plan tests use plain arrays;
// apply/restore tests use a minimal in-memory fake of the dtu_store table
// surface (prepare/transaction) so nothing here touches a real DB or the
// network. The summarizer store is bypassed via the getSummary injection.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { planRestrictedSummaryOnly, applyRestrictedSummaryOnly, restoreRestrictedBackup, dtuTextChars } =
  await import("../lib/restricted-dtu-summarize.js");
const { countRestrictedFullTextDtus } = await import("../lib/news-outlet-policy.js");

const PROSE = "The city council voted on Tuesday to approve the new transit plan after a long and contentious hearing that stretched past midnight. Residents spoke for and against the proposal, which would add three bus routes and rebuild the central station over the next four years. Officials said the first phase would begin in the spring, funded by a mix of state grants and a local bond measure that passed last year. Critics warned the cost estimates were optimistic and the timeline unrealistic, pointing to two earlier projects that ran over budget. The mayor called the vote a turning point for the region.";

function restrictedDtu(over = {}) {
  return {
    id: "dtu_verge_1",
    title: "Council approves transit plan",
    tags: ["news", "transit"],
    ownerId: "system",
    visibility: "public",
    content: `Council approves transit plan\n\n${PROSE}`,
    creti: `Council approves transit plan\n\n${PROSE}`,
    human: { summary: PROSE.slice(0, 300) },
    source: { name: "The Verge", url: "https://www.theverge.com/2026/10/1/transit-plan" },
    meta: {
      sourceUrl: "https://www.theverge.com/2026/10/1/transit-plan",
      sourceName: "The Verge",
      publishedAt: "2026-10-01T12:00:00Z",
      source: { name: "The Verge", url: "https://www.theverge.com/2026/10/1/transit-plan" },
    },
    ...over,
  };
}

function fullDtu() {
  return {
    id: "dtu_nasa_1",
    title: "NASA mission update",
    tags: ["space"],
    content: `NASA mission update\n\n${PROSE}`,
    meta: { sourceUrl: "https://www.nasa.gov/news/mission-update", sourceName: "NASA" },
  };
}

describe("planRestrictedSummaryOnly", () => {
  it("plans a restricted DTU: outlet text gone, title/link/attribution kept", () => {
    const d = restrictedDtu();
    const plans = planRestrictedSummaryOnly([d], { getSummary: () => null });
    assert.equal(plans.length, 1);
    const { after } = plans[0];
    assert.equal(after.id, "dtu_verge_1");
    assert.equal(after.title, "Council approves transit plan");
    assert.deepEqual(after.tags, ["news", "transit"]);
    assert.equal(after.meta.sourceUrl, "https://www.theverge.com/2026/10/1/transit-plan");
    assert.equal(after.meta.sourceName, "The Verge");
    assert.equal(after.meta.publishedAt, "2026-10-01T12:00:00Z");
    assert.deepEqual(after.source, d.source);
    assert.ok(!after.content.includes("contentious hearing"), "outlet prose must not survive");
    assert.ok(after.content.includes("Link: https://www.theverge.com/2026/10/1/transit-plan"));
    assert.ok(after.content.includes("Source: The Verge"));
    assert.equal(after.contentPolicy, "summary-only");
    assert.equal(after.meta.contentPolicy, "summary-only");
    assert.ok(after.meta.summaryOnlyMigratedAt, "migration stamp set");
    assert.equal(plans[0].summaryPending, true);
    assert.equal(after.meta.summaryPending, true);
    // the input is never mutated
    assert.ok(d.content.includes("contentious hearing"));
  });

  it("full-tier hosts and URL-less DTUs are untouched", () => {
    const noUrl = { id: "dtu_plain", title: "Local note", content: PROSE.repeat(2) };
    const arxiv = {
      id: "dtu_arxiv", title: "A paper", content: PROSE.repeat(2),
      meta: { sourceUrl: "https://arxiv.org/abs/2610.0001" },
    };
    const plans = planRestrictedSummaryOnly([fullDtu(), noUrl, arxiv], { getSummary: () => null });
    assert.equal(plans.length, 0);
  });

  it("a stored Concord summary that validates is used", () => {
    const plans = planRestrictedSummaryOnly([restrictedDtu()], {
      getSummary: () => "The council backed a transit expansion adding bus routes and a rebuilt station, with work starting in spring.",
    });
    assert.equal(plans.length, 1);
    assert.equal(plans[0].summaryPending, false);
    assert.ok(plans[0].after.content.includes("Concord summary: The council backed a transit expansion"));
    assert.ok(!plans[0].after.meta.summaryPending);
  });

  it("a copied summary is rejected: no summary line, summaryPending set", () => {
    const copied = PROSE.split(/\s+/).slice(0, 20).join(" "); // verbatim run from the outlet text
    const d = restrictedDtu({
      summaryBy: "concord",
      summary: copied,
      meta: {
        sourceUrl: "https://www.theverge.com/2026/10/1/transit-plan",
        sourceName: "The Verge",
        summaryBy: "concord",
        summary: copied,
      },
    });
    const plans = planRestrictedSummaryOnly([d], { getSummary: () => null });
    assert.equal(plans.length, 1);
    assert.equal(plans[0].summaryPending, true);
    assert.ok(!plans[0].after.content.includes("Concord summary:"));
    assert.equal(plans[0].after.summary, "");
  });

  it("a too-long summary is rejected the same way", () => {
    const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    const plans = planRestrictedSummaryOnly([restrictedDtu()], { getSummary: () => long });
    assert.equal(plans[0].summaryPending, true);
    assert.ok(!plans[0].after.content.includes("Concord summary:"));
  });

  it("idempotent: planning over migrated DTUs finds 0, and the audit count is 0", () => {
    const plans = planRestrictedSummaryOnly([restrictedDtu()], { getSummary: () => null });
    const migrated = plans.map((p) => p.after);
    assert.equal(planRestrictedSummaryOnly(migrated, { getSummary: () => null }).length, 0);
    assert.equal(countRestrictedFullTextDtus(migrated).count, 0);
  });
});

// ── apply / restore over a fake dtu_store ─────────────────────────────────

function fakeDb(dtus) {
  const rows = new Map(dtus.map((d) => [d.id, { id: d.id, data: JSON.stringify(d), tags: JSON.stringify(d.tags || []) }]));
  return {
    rows,
    prepare(sql) {
      if (sql.startsWith("SELECT id, data, tags")) return { all: () => [...rows.values()].map((r) => ({ ...r })) };
      if (sql.startsWith("SELECT id FROM")) return { get: (id) => (rows.has(id) ? { id } : undefined) };
      if (sql.startsWith("UPDATE")) return { run: (data, tags, _ts, id) => { const r = rows.get(id); if (r) { r.data = data; r.tags = tags; } } };
      throw new Error(`unexpected SQL: ${sql}`);
    },
    transaction(fn) { return (items) => fn(items); },
  };
}

describe("applyRestrictedSummaryOnly / restoreRestrictedBackup", () => {
  it("dry run writes nothing", () => {
    const db = fakeDb([restrictedDtu(), fullDtu()]);
    const before = db.rows.get("dtu_verge_1").data;
    const r = applyRestrictedSummaryOnly(db, { getSummary: () => null });
    assert.equal(r.dryRun, true);
    assert.equal(r.count, 1);
    assert.deepEqual(r.byHost, { "theverge.com": 1 });
    assert.equal(r.applied, 0);
    assert.equal(db.rows.get("dtu_verge_1").data, before);
    assert.ok(r.sample[0].beforeChars > r.sample[0].afterChars);
  });

  it("apply writes the backup BEFORE updating, and restore is byte-identical", () => {
    const db = fakeDb([restrictedDtu(), fullDtu()]);
    const originalData = db.rows.get("dtu_verge_1").data;
    const originalTags = db.rows.get("dtu_verge_1").tags;
    let captured = null;
    let dbStateAtBackup = null;
    const r = applyRestrictedSummaryOnly(db, {
      apply: true,
      backupPath: "ignored-by-injected-writer",
      getSummary: () => null,
      writeBackup: (p, backup) => {
        dbStateAtBackup = db.rows.get("dtu_verge_1").data; // must still be the original
        captured = backup;
        return p;
      },
    });
    assert.equal(r.applied, 1);
    assert.equal(dbStateAtBackup, originalData, "backup must be taken before any update");
    assert.equal(captured.rows.length, 1);
    assert.equal(captured.rows[0].data, originalData);
    const afterData = db.rows.get("dtu_verge_1").data;
    assert.notEqual(afterData, originalData);
    assert.ok(!afterData.includes("contentious hearing"));
    // full-tier row untouched
    assert.ok(db.rows.get("dtu_nasa_1").data.includes("contentious hearing"));
    // second run finds nothing
    const again = applyRestrictedSummaryOnly(db, { getSummary: () => null });
    assert.equal(again.count, 0);
    // restore brings back the exact bytes
    const rr = restoreRestrictedBackup(db, captured);
    assert.equal(rr.restored, 1);
    assert.equal(db.rows.get("dtu_verge_1").data, originalData);
    assert.equal(db.rows.get("dtu_verge_1").tags, originalTags);
  });

  it("apply refuses when the backup write fails", () => {
    const db = fakeDb([restrictedDtu()]);
    const before = db.rows.get("dtu_verge_1").data;
    assert.throws(
      () => applyRestrictedSummaryOnly(db, {
        apply: true,
        backupPath: "x",
        getSummary: () => null,
        writeBackup: () => { throw new Error("disk full"); },
      }),
      /disk full/,
    );
    assert.equal(db.rows.get("dtu_verge_1").data, before, "no update may happen when the backup fails");
  });

  it("dtuTextChars shrinks to the summary-only shape after migration", () => {
    const d = restrictedDtu();
    const [plan] = planRestrictedSummaryOnly([d], { getSummary: () => null });
    assert.ok(dtuTextChars(plan.after) < dtuTextChars(d));
  });
});
