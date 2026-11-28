// scripts/walk/ingest.mjs — walk results → builder tickets. Fixtures use the walker's real
// record shapes (audit/fix-list/findings.jsonl, fix_tickets.jsonl, run-check results).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ingest, parseTriage, classify, mergeTicketLog, readJsonl, renderMarkdown } from "../../scripts/walk/ingest.mjs";
import { validateSpec } from "../../scripts/walk/check-spec.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TRIAGE = `## The queue
### Wave 1 — money and identity
| Order | Family | Lenses | Why here |
|---|---|---|---|
| 1 | Property | \`housing\`, \`realestate\` | first |
| 2 | Finance | \`finance\`, \`wallet\` | coin |
### Wave 4 — Concordia
\`world\` first, then \`sandbox\`, \`fishing\`.
### Wave 5 — the platform
- **Cognition:** \`cognition\`, \`attention\`.
## Before the build
\`genesis\` 0.244
`;
const existing = [
  { id: "FIX-board-001", lens: "board", severity: "high", title: "Task title edit not persisted", actual: "Drawer shows new title; card unchanged; reload restores original", expected: "Edited title persists", status: "OPEN", ts: "2026-11-08T23:05:00-05:00" },
  { id: "FIX-board-002", lens: "board", severity: "medium", title: "Escape does not close the task drawer; focus stays behind", actual: "Escape ignored, focus escapes to the board", status: "OPEN", root_cause_group: "RCA-escape-focus-trap", ts: "2026-11-08T23:06:00-05:00" },
  { id: "FIX-finance-004", lens: "finance", severity: "high", title: "Export CSV downloads nothing", actual: "Clicking Export CSV produced no file", status: "OPEN", ts: "2026-11-09T10:00:00-05:00" },
  { id: "FIX-finance-004", status: "FIXED_PENDING_VERIFY", fixed_commit: "abc123", ts: "2026-11-20T12:00:00-05:00" }, // a later patch line
  { id: "FIX-aviation-005", lens: "aviation", title: "Airport lookup in EFB Brief for KJFK returns 'airport lookup failed: fetch failed'", actual: "lookup failed: fetch failed", status: "OPEN", ts: "2026-11-09T03:00:00-05:00" },
];
const T = "2026-11-28T22:00:00-05:00";

test("the ticket log merges by id, later lines winning (the fix-list rule)", () => {
  const m = mergeTicketLog(existing);
  assert.equal(m.get("FIX-finance-004").status, "FIXED_PENDING_VERIFY");
  assert.equal(m.get("FIX-finance-004").title, "Export CSV downloads nothing", "earlier fields survive");
});

test("triage: tables give wave and family; prose and lists fill in the rest", () => {
  const m = parseTriage(TRIAGE);
  assert.deepEqual(m.get("housing"), { wave: 1, waveName: "money and identity", order: 1, family: "Property" });
  assert.equal(m.get("wallet").family, "Finance");
  assert.equal(m.get("sandbox").wave, 4);
  assert.deepEqual([m.get("cognition").wave, m.get("cognition").family], [5, "Cognition"]);
  assert.equal(m.get("genesis"), undefined, "a lens named outside the queue is not given a wave");
});

test("root cause: the walker's label, else a named rule, else the nearest labelled ticket, else unclassified", () => {
  const labelled = [{ id: "FIX-x-1", group: "grid-input-intrinsic-width-clip", words: ["release", "field", "grid", "column", "overflows", "input"] }];
  assert.deepEqual(classify({ title: "x", actual: "y", root_cause_group: "persistence-corruption" }, labelled), { group: "persistence-corruption", basis: "walker" });
  assert.equal(classify({ title: "Dialog: Escape does not close it", actual: "" }, labelled).group, "RCA-escape-focus-trap");
  assert.equal(classify({ title: "Sidebar names", actual: "contrast 1.3:1 on the sidebar" }, labelled).group, "RCA-contrast-theme-tokens");
  assert.equal(classify({ title: "At 390 px the toolbar is cut off", actual: "clipped" }, labelled).group, "RCA-mobile-clip-fab");
  const near = classify({ title: "Release field grid column overflows", actual: "input" }, labelled);
  assert.equal(near.group, "grid-input-intrinsic-width-clip"); assert.match(near.basis, /^nearest:FIX-x-1 \(/);
  assert.deepEqual(classify({ title: "Weather card shows yesterday", actual: "stale" }, labelled), { group: "unclassified", basis: "none" });
});

test("a walk: new tickets numbered after the log, duplicates folded with every occurrence, matches routed", () => {
  const walkRows = [
    // two testers report the same bug in different words → one ticket, two occurrences
    { lens: "finance", tester: "Tester 1", ts: T, severity: "Medium", title: "Budget chart labels unreadable on dark theme", expected: "labels legible", actual: "labels grey on near black", evidence_path: "/ev/finance/1.png", __src: "w.jsonl:1" },
    { lens: "finance", tester: "Tester 2", ts: T, severity: "high", title: "Budget chart labels unreadable on the dark theme", expected: "legible", actual: "labels grey on near-black background", screenshots: ["/ev/finance/2.png"], __src: "w.jsonl:2" },
    // the same as an open ticket → seen again, not new
    { lens: "board", tester: "Tester 1", ts: T, title: "Task title edit is not persisted", actual: "card unchanged; reload restores original title", __src: "w.jsonl:3" },
    // the same as a ticket marked fixed on 11-20, seen tonight → the fix did not hold
    { lens: "finance", tester: "Tester 3", ts: T, title: "Export CSV downloads nothing", actual: "no file after clicking Export CSV", __src: "w.jsonl:4" },
    // a terse case note that is a written-up ticket → matched by containment
    { lens: "aviation", tester: "Tester 2", ts: T, cases: { lookup: "FAIL KJFK airport lookup failed: fetch failed" }, __src: "w.jsonl:5" },
    // a case with detail and no linked ticket → a ticket; a bare FAIL → a person writes it up; NEEDS_HUMAN → a spec draft
    { slug: "wallet", tester: "Tester 4", ts: T, cases: { send_confirm: "FAIL Send has no confirm step; 50 CC left at once", receipts: "FAIL", audio_export: "NEEDS_HUMAN needs a real headset to judge" }, screenshots: ["/ev/wallet/a.png"], __src: "w.jsonl:6" },
    // a check-spec run
    { type: "check_result", id: "CS-housing-rename", lens: "housing", verdict: "FAIL", why: "Renaming a house shows the new name", base: "https://concord-os.org", path: "/lenses/housing", account: "member", viewport: "mobile", startedAt: T, expect: [{ kind: "visible", ok: false, detail: "text \"Lakeside\" not visible" }], screenshot: "shots/CS-housing-rename.png", __src: "c.jsonl:1" },
    { type: "check_result", id: "CS-world-map", lens: "world", verdict: "ERROR", error: "no credentials for account \"member\"", __src: "c.jsonl:2" },
    { type: "protocol_change", note: "testers must not script pages", __src: "w.jsonl:7" },
  ];
  const r = ingest({ walkRows, existingRows: existing, triageMd: TRIAGE, date: "2026-11-28" });
  const byLens = (l) => r.tickets.filter((t) => t.lens === l);

  const fin = byLens("finance");
  assert.equal(fin.length, 1, "the two budget reports fold into one");
  assert.equal(fin[0].id, "FIX-finance-005", "numbered after the log's FIX-finance-004");
  assert.equal(fin[0].occurrences, 2);
  assert.equal(fin[0].severity, "high", "the folded ticket takes the worst severity reported");
  assert.deepEqual(fin[0].evidence_paths.filter((e) => e.startsWith("/ev")), ["/ev/finance/1.png", "/ev/finance/2.png"]);
  assert.equal(fin[0].root_cause_group, "RCA-contrast-theme-tokens");
  assert.equal(fin[0].root_cause_basis, "rule:RCA-contrast-theme-tokens");
  assert.deepEqual([fin[0].triage_wave, fin[0].triage_family], [1, "Finance"]);
  assert.equal(fin[0].status, "OPEN");

  assert.deepEqual(r.seenAgain.map((x) => x.id).sort(), ["FIX-aviation-005", "FIX-board-001"]);
  assert.match(r.seenAgain.find((x) => x.id === "FIX-aviation-005").match, /case note inside the ticket/);
  assert.deepEqual(r.reopen.map((x) => x.id), ["FIX-finance-004"], "seen after its fix landed");

  const wal = byLens("wallet");
  assert.equal(wal.length, 1, "the described FAIL became a ticket; the bare one did not");
  assert.equal(wal[0].title.startsWith("send confirm: Send has no confirm step"), true);
  // no rule names a missing send confirmation and no labelled ticket is near it: said plainly, not guessed
  assert.deepEqual([wal[0].root_cause_group, wal[0].root_cause_basis], ["unclassified", "none"]);
  assert.ok(wal[0].evidence_paths.includes("/ev/wallet/a.png"));

  const hou = byLens("housing");
  assert.equal(hou[0].check_spec, "CS-housing-rename");
  assert.match(hou[0].actual, /visible: text "Lakeside" not visible/);
  assert.ok(hou[0].evidence_paths.includes("shots/CS-housing-rename.png"));

  const nh = Object.fromEntries(r.needsHuman.map((n) => [`${n.lens}:${n.case}`, n]));
  assert.match(nh["wallet:receipts"].why, /FAIL with no detail/);
  assert.match(nh["wallet:audio_export"].why, /real headset/);
  assert.match(nh["world:CS-world-map"].why, /no credentials/);
  // a draft is the fixed format with the parts only a person can write left empty
  const v = validateSpec(nh["wallet:audio_export"].spec_draft);
  assert.deepEqual(v.errors.filter((e) => !/expect: at least one/.test(e)), [], "the draft is valid apart from the expectation a person adds");

  assert.equal(r.stats.skipped.protocol_change, 1, "notes are skipped, not counted unreadable");
  assert.equal(r.stats.unreadable, 0);
});

test("deterministic: the same walk gives the same tickets; ingesting twice adds nothing new", () => {
  const walkRows = [{ lens: "housing", ts: T, title: "Rename does not save", actual: "old name after reload", __src: "w:1" }];
  const a = ingest({ walkRows, existingRows: existing, date: "2026-11-28" });
  const b = ingest({ walkRows, existingRows: existing, date: "2026-11-28" });
  assert.deepEqual(a.tickets, b.tickets);
  const again = ingest({ walkRows, existingRows: [...existing, ...a.tickets], date: "2026-11-29" });
  assert.equal(again.tickets.length, 0);
  assert.equal(again.seenAgain[0].id, a.tickets[0].id);
});

test("lines that are not JSON are listed, never dropped", () => {
  const f = path.join(fs.mkdtempSync(path.join(ROOT, "server", ".walk-ingest-")), "w.jsonl");
  fs.writeFileSync(f, '{"lens":"board","title":"x","actual":"y"}\nnot json at all\n[1,2]\n');
  const { rows, bad } = readJsonl(f);
  assert.equal(rows.length, 1);
  assert.deepEqual(bad.map((b) => b.reason.split(":")[0]), ["not JSON", "not an object"]);
  fs.rmSync(path.dirname(f), { recursive: true, force: true });
});

test("the markdown groups by wave, lens and root cause, with the evidence and the basis", () => {
  const r = ingest({ walkRows: [{ lens: "finance", ts: T, title: "Totals contrast 2.1:1", actual: "grey on grey", evidence_path: "/ev/f.png", __src: "w:1" }], existingRows: existing, triageMd: TRIAGE, date: "2026-11-28" });
  const md = renderMarkdown(r, { date: "2026-11-28" });
  assert.match(md, /## Wave 1[\s\S]*### finance \(Finance\)[\s\S]*\*\*RCA-contrast-theme-tokens\*\*[\s\S]*FIX-finance-005[\s\S]*root cause basis: rule:RCA-contrast-theme-tokens[\s\S]*\/ev\/f\.png/);
});

test("real data: the November ticket log ingested against itself mints nothing new", () => {
  const log = path.join(ROOT, "audit/fix-list/fix_tickets.jsonl");
  if (!fs.existsSync(log)) return; // the audit log is optional in a checkout
  const { rows } = readJsonl(log);
  const r = ingest({ walkRows: rows, existingRows: rows, date: "2026-11-28" });
  assert.equal(r.tickets.length, 0, "every row matches its own ticket");
  assert.ok(r.seenAgain.length + r.reopen.length > 1000);
});

// ── tonight's walker (v3): the merged export { _file, _run, row } ─────────────
test("walker v3 export: every file kind is read and routed (real lines from the 2026-11-27 walk)", () => {
  const f = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "walk-v3-sample.jsonl");
  const { rows, bad } = readJsonl(f);
  assert.equal(bad.length, 0);
  assert.ok(rows.every((r) => r.__file), "each line unwrapped from its envelope");
  const log = [
    { id: "FIX-chat-013", lens: "chat", title: "Mobile chat clipped", status: "REOPENED" },
    { id: "FIX-literary-002", lens: "literary", title: "Search query limit (200) only enforced after submit", status: "FIXED_PENDING_VERIFY", ts: "2026-11-20T00:00:00Z" },
    { id: "FIX-goals-002", lens: "goals", title: "Past due date accepted", status: "FIXED_PENDING_VERIFY", ts: "2026-11-20T00:00:00Z" },
    { id: "FIX-studio-007", lens: "studio", title: "Time readout contrast 4.09:1", status: "OPEN" },
  ];
  const r = ingest({ walkRows: rows, existingRows: log, date: "2026-11-28" });
  // the shared sidebar toggle: set aside as a reviewed false positive, not a ticket
  assert.equal(r.walkerReview.length, 1);
  assert.equal(r.walkerReview[0].pattern, "sidebar-disclosure-escape");
  assert.ok(!r.tickets.some((t) => /sub-lenses/.test(t.title)));
  // real findings become tickets, classified by the walker's check
  const byTitle = Object.fromEntries(r.tickets.map((t) => [t.lens, t]));
  assert.deepEqual([byTitle.suffering.root_cause_group, byTitle.suffering.root_cause_basis], ["RCA-server-error-on-load", "walker check:http"]);
  assert.deepEqual([byTitle.entity.root_cause_group, byTitle.entity.walker_check], ["RCA-mobile-clip-fab", "fab_overlap"]);
  // the ledger: a fix that did not hold; a "fixed" that only opened the lens goes to a person; a contradiction too
  assert.deepEqual(r.reopen.map((x) => x.id), ["FIX-goals-002"]);
  const nh = Object.fromEntries(r.needsHuman.map((n) => [n.case, n]));
  assert.match(nh["FIX-literary-002"].why, /only step was opening the lens/);
  assert.match(nh["FIX-chat-013"].why, /its own measurement was clean/);
  assert.match(nh["FIX-global-001"].why, /rewrite_disagrees/, "the tester queue and the ledger raise it once");
  assert.equal(r.needsHuman.filter((n) => n.case === "FIX-global-001").length, 1);
  assert.match(nh["export_nothing"].why, /Export/);
  // walker dedup → a sighting of the ticket it names
  assert.ok(r.seenAgain.some((x) => x.id === "FIX-studio-007" && /walker dedup/.test(x.match)));
  // fixtures: what is left to clean, not what was deleted
  assert.deepEqual(r.fixturesToClean.map((x) => x.state), ["leftover"]);
  assert.equal(r.stats.fixturesDeleted, 1);
});

test("the same walker check on the same control across lenses is one shared ticket", () => {
  const row = (lens) => ({ check: "fab_overlap", lens, severity: "low", title: `FAB overlaps the bottom nav on ${lens}`, expected: "clear", actual: "boxes intersect", element: "Ask the agent", evidence: [`ev/${lens}.png`], __src: `w:${lens}` });
  const r = ingest({ walkRows: [row("entity"), row("tick"), row("food")], existingRows: [], date: "2026-11-28" });
  assert.equal(r.tickets.length, 1);
  assert.deepEqual(r.tickets[0].affected_lenses, ["entity", "food", "tick"]);
  assert.equal(r.tickets[0].lens, "shared");
  assert.equal(r.tickets[0].occurrences, 3);
  assert.equal(r.tickets[0].triage_family, "shared code");
});

test("a walker 'fixed' with a real check is confirmed; one that only opened the lens is not", () => {
  const led = (id, steps) => ({ id, result: "FIXED", status: "VERIFIED", recipe: "repro-steps", walker_run_id: "run1", steps, __src: `l:${id}` });
  const r = ingest({ walkRows: [
    led("FIX-board-009", [{ action: "check_ax", executed: true, raw: "Open the a11y tree", result: "0 unnamed of 55" }]),
    led("FIX-x-001", [{ action: "open", executed: true, raw: "open the X lens", result: "opened" }]),
  ], existingRows: [], date: "2026-11-28" });
  assert.deepEqual(r.verified.map((v) => v.id), ["FIX-board-009"]);
  assert.deepEqual(r.needsHuman.map((n) => n.case), ["FIX-x-001"]);
});

test("a server error on the same endpoint across lenses is one shared ticket (it is the server, not the lens)", () => {
  const row = (lens) => ({ check: "http", lens, severity: "medium", title: "API returns 5xx while loading the lens", expected: "No server errors on lens load", actual: "503 /api/metrics/vitals", evidence: [`ev/${lens}.png`], __src: `w:${lens}` });
  const r = ingest({ walkRows: [row("suffering"), row("goals"), { ...row("pets"), actual: "500 /api/lens/run" }], existingRows: [], date: "2026-11-28" });
  const shared = r.tickets.find((t) => t.lens === "shared");
  assert.deepEqual(shared.affected_lenses, ["goals", "suffering"]);
  assert.ok(r.tickets.some((t) => t.lens === "pets"), "a different endpoint stays its own ticket");
});
