// Behavioral macro tests for the board (kanban) lens — the PATH-3
// registerLensAction calculator surface in server/domains/board.js the
// /lenses/board page drives through the AI Action Panel:
//   workflowAnalysis · cardPrioritization · burndownForecast
// plus the Trello/Asana STATE-backed substrate the BoardWorkspace / KanbanBoard
// / CardDetailModal / BoardSettingsPanel components reach via boardMacro(...).
//
// THE COMPONENT-EXACT-SHAPE CONTRACT (the dead-calculator class this gate
// targets):
//   The /lenses/board page persists each task as a lens artifact whose .data is
//   a SINGLE TASK ({status,priority,type,assignee,progress,dueDate,...}). The
//   three calculators, however, read board-WIDE arrays
//   (artifact.data.cards / columns / sprints / remainingPoints) — fields a task
//   artifact NEVER carries. So in production handleBoardAction always rendered
//   "No cards provided" while shape-only tests passed: a DEAD SURFACE.
//   FIX (verified here): the page now derives {cards,columns}/{cards}/{sprints,
//   remainingPoints} from the live tasks and passes them as the run-action
//   `params` (3rd handler arg = req.body.params), and each handler reads
//   `params.X ?? artifact.data.X`. These tests drive the EXACT params the page
//   builder emits and assert the EXACT fields the panels render with real values.
//
// Dispatch shape (the run route): POST /api/lens/board/:id/run {action,params}
//   → runMacro("lens","run",{id,action,params})
//   → handler(ctx, persistedArtifact, params)   [3-ARG, params = body.params]
// We invoke the registered handler directly with that exact 3-arg shape.
//
// NOT shape-only: every test feeds KNOWN inputs and asserts the EXACT computed
// value (cycle/lead time, WIP, WSJF ranking + tiers, Monte-Carlo velocity +
// percentile sprints) plus validation-rejection, degrade-graceful, and
// fail-CLOSED poisoned-input (non-finite collapses to FINITE / guidance, never
// blank-null or an infinite loop).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerBoardActions from "../domains/board.js";
import { peelRedundantArtifactWrapper } from "../lib/lens-input-normalize.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "board", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

// Drive a calculator EXACTLY like the live run route: a persisted task artifact
// (its .data has no board-wide arrays) + the page-derived params as 3rd arg.
function callAction(name, ctx, params = {}, artifactData = { status: "todo", priority: "medium" }) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`board.${name} not registered`);
  const artifact = { id: "art_task_1", domain: "board", type: "task", data: artifactData, meta: {} };
  return fn(ctx, artifact, params);
}

// Drive a STATE macro EXACTLY like boardMacro(name, params): lensRun peels a
// redundant {artifact:{data}} wrapper, but boardMacro sends flat params, so the
// peel is a no-op. We assert that idempotency holds and pass params straight.
function callMacro(name, ctx, params = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`board.${name} not registered`);
  const peeled = peelRedundantArtifactWrapper(params);
  const artifact = { id: null, domain: "board", type: "domain_action", data: peeled, meta: {} };
  return fn(ctx, artifact, peeled);
}

before(() => { registerBoardActions(registerLensAction); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const CALCULATORS = ["workflowAnalysis", "cardPrioritization", "burndownForecast"];
const STATE_MACROS = [
  "board-create", "board-list", "board-detail", "board-delete", "board-dashboard",
  "column-add", "column-delete",
  "card-create", "card-move", "card-move-auto", "card-update", "card-checklist-toggle",
  "card-delete", "card-detail", "card-calendar",
  "card-comment-add", "card-comment-delete", "card-attachment-add", "card-attachment-delete",
  "card-set-cover", "automation-add", "automation-list", "automation-delete",
  "label-create", "label-list", "label-delete",
  "collaborator-add", "collaborator-list", "collaborator-remove",
  "custom-field-add", "custom-field-list", "custom-field-delete", "card-set-field",
];

// ─────────────────────────────────────────────────────────────────────────────
describe("board — registration", () => {
  it("registers every calculator the AI Action Panel reaches", () => {
    for (const m of CALCULATORS) assert.ok(ACTIONS.has(m), `board.${m} not registered`);
  });
  it("registers every STATE macro the workspace components reach", () => {
    for (const m of STATE_MACROS) assert.ok(ACTIONS.has(m), `board.${m} not registered`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("board.workflowAnalysis — component-exact shape + flow values", () => {
  // The page builder emits { columns:[{name}], cards:[{id,title,column,
  // createdAt,completedAt?}] } from live tasks; the panel renders
  // cycleTime.mean, leadTime.mean, throughput.weeklyAvg, flowEfficiency,
  // bottleneck, wip.overLimitColumns.
  const params = () => ({
    columns: [{ name: "Backlog" }, { name: "To Do" }, { name: "In Progress" }, { name: "Done" }],
    cards: [
      { id: "c1", title: "A", column: "Done", createdAt: "2026-06-01T00:00:00Z", completedAt: "2026-06-06T00:00:00Z" },
      { id: "c2", title: "B", column: "Done", createdAt: "2026-06-01T00:00:00Z", completedAt: "2026-06-11T00:00:00Z" },
      { id: "c3", title: "C", column: "In Progress", createdAt: "2026-06-02T00:00:00Z" },
      { id: "c4", title: "D", column: "To Do", createdAt: "2026-06-02T00:00:00Z" },
    ],
  });

  it("computes cycle/lead time + WIP the panel renders, from params (NOT artifact.data)", () => {
    const r = callAction("workflowAnalysis", ctxA, params());
    assert.equal(r.ok, true);
    assert.equal(r.result.totalCards, 4);
    assert.equal(r.result.completedCards, 2);
    assert.equal(r.result.inProgressCards, 2);     // 2 not-yet-completed cards
    // c1 took 5d, c2 took 10d → lead/cycle mean = 7.5 (no startedAt → cycle==lead).
    assert.equal(r.result.leadTime.mean, 7.5);
    assert.equal(r.result.cycleTime.mean, 7.5);
    assert.equal(r.result.wip.total, 2);
    // Panel reads cycleTime.mean.toFixed(1) etc — all finite numbers.
    assert.ok(Number.isFinite(r.result.cycleTime.mean));
    assert.ok(Number.isFinite(r.result.leadTime.mean));
    assert.ok(Number.isFinite(r.result.throughput.weeklyAvg));
  });

  it("surfaces a WIP-over-limit column the panel maps {column,wip,limit}", () => {
    const p = {
      columns: [{ name: "In Progress", wipLimit: 1 }, { name: "Done" }],
      cards: [
        { id: "c1", title: "A", column: "In Progress", createdAt: "2026-06-02T00:00:00Z" },
        { id: "c2", title: "B", column: "In Progress", createdAt: "2026-06-02T00:00:00Z" },
      ],
    };
    const r = callAction("workflowAnalysis", ctxA, p);
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.wip.overLimitColumns, [{ column: "In Progress", wip: 2, limit: 1 }]);
  });

  it("validation: empty cards returns a guidance message (no broken render)", () => {
    const r = callAction("workflowAnalysis", ctxA, { columns: [], cards: [] });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalCards, undefined);
    assert.match(r.result.message, /no cards/i);
  });

  it("degrade-graceful: non-array cards / a task artifact's own data does not throw", () => {
    assert.equal(callAction("workflowAnalysis", ctxA, { cards: "nope" }).ok, true);
    // Real production shape: NO params, artifact.data is a single task → message.
    const r = callAction("workflowAnalysis", ctxA, {}, { status: "todo", priority: "high", progress: 30 });
    assert.equal(r.ok, true);
    assert.match(r.result.message, /no cards/i);
  });

  it("fail-CLOSED poison: unparseable dates keep lead/cycle FINITE, no throw", () => {
    const r = callAction("workflowAnalysis", ctxA, {
      columns: [{ name: "Done" }],
      cards: [{ id: "c", title: "X", column: "Done", createdAt: "bad", completedAt: "also-bad" }],
    });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.leadTime.mean));
    assert.ok(Number.isFinite(r.result.cycleTime.mean));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("board.cardPrioritization — component-exact shape + WSJF ranking", () => {
  it("ranks by WSJF descending and tiers the cards the panel renders", () => {
    const r = callAction("cardPrioritization", ctxA, {
      cards: [
        { id: "c1", title: "Hi", businessValue: 10, timeCriticality: 9, riskReduction: 8, effort: 2 },
        { id: "c2", title: "Lo", businessValue: 3, timeCriticality: 2, riskReduction: 2, effort: 8 },
      ],
    });
    assert.equal(r.ok, true);
    // WSJF c1 = (10+9+8)/2 = 13.5, c2 = (3+2+2)/8 = 0.875 → c1 ranks #1.
    assert.equal(r.result.rankedCards[0].id, "c1");
    assert.equal(r.result.rankedCards[0].rank, 1);
    assert.equal(r.result.rankedCards[0].wsjfScore, 13.5);
    // Panel reads card.wsjfScore.toFixed(1) + tiers.{critical,high,medium,low}.length.
    assert.deepEqual(r.result.tiers.critical, ["c1"]);
    assert.deepEqual(r.result.tiers.high, ["c2"]);
    // Panel reads quadrants.{quick-wins,...}.length.
    assert.ok(Array.isArray(r.result.quadrants["quick-wins"]));
  });

  it("deadline proximity overrides timeCriticality (overdue → 10)", () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    const r = callAction("cardPrioritization", ctxA, {
      cards: [{ id: "c1", title: "Late", businessValue: 5, timeCriticality: 2, riskReduction: 5, effort: 5, deadline: yesterday }],
    });
    assert.equal(r.result.rankedCards[0].timeCriticality, 10);
    assert.ok(r.result.rankedCards[0].daysUntilDeadline <= 0);
  });

  it("validation: empty cards returns a guidance message", () => {
    const r = callAction("cardPrioritization", ctxA, { cards: [] });
    assert.equal(r.ok, true);
    assert.equal(r.result.rankedCards, undefined);
    assert.match(r.result.message, /no cards/i);
  });

  it("degrade-graceful: non-array cards does not throw", () => {
    const r = callAction("cardPrioritization", ctxA, { cards: "nope" });
    assert.equal(r.ok, true);
    assert.match(r.result.message, /no cards/i);
  });

  it("fail-CLOSED poison: 1e999/Infinity/NaN inputs + bad deadline stay FINITE/null", () => {
    const r = callAction("cardPrioritization", ctxA, {
      cards: [{ id: "x", title: "X", businessValue: "1e999", timeCriticality: "NaN", riskReduction: "Infinity", effort: "0", deadline: "not-a-date" }],
    });
    assert.equal(r.ok, true);
    const c = r.result.rankedCards[0];
    assert.ok(Number.isFinite(c.wsjfScore), `wsjf not finite: ${c.wsjfScore}`);
    assert.ok(Number.isFinite(c.normalizedScore), `ns not finite: ${c.normalizedScore}`);
    assert.ok(Number.isFinite(c.costOfDelay));
    // bad deadline must NOT serialise NaN (→ null in JSON) into the panel.
    assert.equal(c.daysUntilDeadline, null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("board.burndownForecast — component-exact shape + Monte-Carlo values", () => {
  const params = () => ({
    sprints: [{ id: "s1", completedPoints: 10 }, { id: "s2", completedPoints: 20 }, { id: "s3", completedPoints: 15 }],
    remainingPoints: 60,
  });

  it("forecasts from params with deterministic seeded Monte-Carlo values", () => {
    const r = callAction("burndownForecast", ctxA, params());
    assert.equal(r.ok, true);
    assert.equal(r.result.remainingPoints, 60);
    assert.equal(r.result.velocityStats.mean, 15);   // (10+20+15)/3
    assert.equal(r.result.simulations, 1000);
    // deterministic: 60 / 15 = 4 sprints.
    assert.equal(r.result.forecast.deterministicSprints, 4);
    // Panel reads forecast.mostLikelyDate + confidenceRange.{optimistic..worstCase}.
    assert.ok(typeof r.result.forecast.mostLikelyDate === "string");
    assert.ok(Number.isFinite(r.result.forecast.mostLikelySprints));
    for (const k of ["optimistic", "likely", "conservative", "worstCase"]) {
      assert.equal(typeof r.result.forecast.confidenceRange[k], "string");
    }
    // Panel reads burndownProjection[].{sprint,projectedRemaining}.
    assert.ok(r.result.burndownProjection.length > 0);
    for (const s of r.result.burndownProjection) {
      assert.ok(Number.isFinite(s.projectedRemaining));
    }
  });

  it("validation: no sprint history returns a guidance message", () => {
    const r = callAction("burndownForecast", ctxA, { sprints: [], remainingPoints: 50 });
    assert.equal(r.ok, true);
    assert.equal(r.result.forecast, undefined);
    assert.match(r.result.message, /no sprint history/i);
  });

  it("validation: zero remaining points short-circuits to the done message", () => {
    const r = callAction("burndownForecast", ctxA, { sprints: [{ completedPoints: 10 }], remainingPoints: 0 });
    assert.equal(r.ok, true);
    assert.match(r.result.message, /no remaining points/i);
  });

  it("degrade-graceful: non-array sprints does not throw", () => {
    const r = callAction("burndownForecast", ctxA, { sprints: "nope", remainingPoints: 10 });
    assert.equal(r.ok, true);
    assert.match(r.result.message, /no sprint history/i);
  });

  it("fail-CLOSED poison: 1e999 remainingPoints collapses to the done message (no infinite loop)", () => {
    const r = callAction("burndownForecast", ctxA, {
      sprints: [{ completedPoints: 10 }],
      remainingPoints: "1e999",
    });
    assert.equal(r.ok, true);
    // finNum("1e999") is non-finite → 0 → fails the >0 gate → guidance, never a hang.
    assert.match(r.result.message, /no remaining points/i);
  });

  it("fail-CLOSED poison: poisoned velocities are filtered; outputs stay FINITE", () => {
    const r = callAction("burndownForecast", ctxA, {
      sprints: [{ completedPoints: "1e999" }, { completedPoints: "Infinity" }, { completedPoints: 15 }],
      remainingPoints: 30,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.velocityStats.mean, 15);   // only the finite 15 survives
    assert.ok(Number.isFinite(r.result.forecast.deterministicSprints));
    for (const d of Object.values(r.result.forecast.datePercentiles)) {
      assert.equal(typeof d, "string");
    }
  });

  it("fail-CLOSED poison: huge params.simulations is clamped (no hang)", () => {
    const r = callAction("burndownForecast", ctxA, { sprints: [{ completedPoints: 10 }], remainingPoints: 5, simulations: 1e999 });
    assert.equal(r.ok, true);
    assert.equal(r.result.simulations, 1000);   // non-finite → default 1000
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("board STATE substrate — Trello/Asana macros the workspace reaches", () => {
  it("board-create → board-list → board-detail round-trips (BoardWorkspace/KanbanBoard)", () => {
    const c = callMacro("board-create", ctxA, { name: "Sprint Board" });
    assert.equal(c.ok, true);
    const id = c.result.board.id;
    assert.equal(c.result.board.name, "Sprint Board");
    assert.equal(c.result.board.columns.length, 3);   // To Do / In Progress / Done

    const list = callMacro("board-list", ctxA, {});
    assert.equal(list.ok, true);
    // useBoardList reads result.boards[].{id,name,cardCount}.
    assert.equal(list.result.boards.length, 1);
    assert.equal(list.result.boards[0].id, id);
    assert.equal(list.result.boards[0].cardCount, 0);

    // useBoardDetail / KanbanBoard.open send { id }.
    const detail = callMacro("board-detail", ctxA, { id });
    assert.equal(detail.ok, true);
    assert.equal(detail.result.board.id, id);
  });

  it("card-create + card-move-auto applies an automation rule (BoardWorkspace.onDrop)", () => {
    const id = callMacro("board-create", ctxA, { name: "Auto" }).result.board.id;
    const board = callMacro("board-detail", ctxA, { id }).result.board;
    const todo = board.columns[0].id;
    const done = board.columns[2].id;
    // Settings panel: add a rule "move to Done → check-all-checklist".
    const rule = callMacro("automation-add", ctxA, {
      boardId: id, trigger: "card-moved-to-column", columnId: done, action: "check-all-checklist",
    });
    assert.equal(rule.ok, true);
    // CardDetailModal-shape: create card + a checklist item via card-update.
    const card = callMacro("card-create", ctxA, { boardId: id, columnId: todo, title: "Task" }).result.card;
    callMacro("card-update", ctxA, { boardId: id, cardId: card.id, addChecklistItem: "step 1" });
    // Drop onto Done — automation checks the item.
    const moved = callMacro("card-move-auto", ctxA, { boardId: id, cardId: card.id, toColumnId: done });
    assert.equal(moved.ok, true);
    assert.equal(moved.result.columnId, done);
    assert.equal(moved.result.automationsApplied.length, 1);
    const after = callMacro("card-detail", ctxA, { boardId: id, cardId: card.id }).result.card;
    assert.equal(after.checklist[0].done, true);
  });

  it("card-detail returns the comment/attachment/activity/cover shape CardDetailModal reads", () => {
    const id = callMacro("board-create", ctxA, { name: "Detail" }).result.board.id;
    const col = callMacro("board-detail", ctxA, { id }).result.board.columns[0].id;
    const card = callMacro("card-create", ctxA, { boardId: id, columnId: col, title: "C" }).result.card;
    callMacro("card-comment-add", ctxA, { boardId: id, cardId: card.id, text: "hello" });
    callMacro("card-attachment-add", ctxA, { boardId: id, cardId: card.id, url: "https://x.test/a" });
    const d = callMacro("card-detail", ctxA, { boardId: id, cardId: card.id }).result.card;
    assert.ok(Array.isArray(d.comments) && d.comments[0].text === "hello");
    assert.ok(Array.isArray(d.attachments) && d.attachments[0].url === "https://x.test/a");
    assert.ok(Array.isArray(d.activity));   // pushActivity on each mutation
    assert.equal(d.cover, null);            // CardDetailModal reads card.cover?.type
    assert.equal(typeof d.customFields, "object");
  });

  it("card-calendar groups by due date the BoardWorkspace calendar renders", () => {
    const id = callMacro("board-create", ctxA, { name: "Cal" }).result.board.id;
    const col = callMacro("board-detail", ctxA, { id }).result.board.columns[0].id;
    callMacro("card-create", ctxA, { boardId: id, columnId: col, title: "Due", dueDate: "2030-01-15" });
    callMacro("card-create", ctxA, { boardId: id, columnId: col, title: "Open" });
    const cal = callMacro("card-calendar", ctxA, { boardId: id }).result;
    // BoardWorkspace reads { days:[{date,cards}], scheduled, overdue, unscheduled }.
    assert.equal(cal.scheduled, 1);
    assert.equal(cal.unscheduled, 1);
    assert.equal(cal.days[0].date, "2030-01-15");
    assert.equal(cal.days[0].cards[0].title, "Due");
    assert.equal(cal.days[0].cards[0].overdue, false);
  });

  it("validation-rejection: required-field + not-found macros fail cleanly", () => {
    assert.equal(callMacro("board-create", ctxA, { name: "" }).ok, false);
    assert.equal(callMacro("board-detail", ctxA, { id: "nope" }).ok, false);
    const id = callMacro("board-create", ctxA, { name: "V" }).result.board.id;
    assert.equal(callMacro("card-create", ctxA, { boardId: id, columnId: "x", title: "" }).ok, false);
    assert.equal(callMacro("automation-add", ctxA, { boardId: id, trigger: "bogus", action: "x", columnId: "y" }).ok, false);
    assert.equal(callMacro("label-create", ctxA, { boardId: id, name: "" }).ok, false);
  });

  it("boards are per-user: user_b cannot see user_a's board", () => {
    const id = callMacro("board-create", ctxA, { name: "Private" }).result.board.id;
    const bList = callMacro("board-list", ctxB, {});
    assert.equal(bList.result.boards.length, 0);
    assert.equal(callMacro("board-detail", ctxB, { id }).ok, false);
  });

  it("degrade-graceful: STATE-unavailable returns a clean error, not a throw", () => {
    delete globalThis._concordSTATE;
    const r = callMacro("board-list", ctxA, {});
    assert.equal(r.ok, false);
    assert.match(String(r.error), /STATE/i);
  });
});
