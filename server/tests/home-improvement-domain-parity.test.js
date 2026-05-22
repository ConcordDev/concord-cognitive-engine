// Contract tests for server/domains/homeimprovement.js — STATE-backed
// per-user substrate for the home-improvement lens (gallery, idea
// boards, contractor directory, shopping list, home inventory, Gantt
// timeline, seasonal maintenance reminders).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerHomeImprovementActions from "../domains/homeimprovement.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`home-improvement.${name}`);
  if (!fn) throw new Error(`home-improvement.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerHomeImprovementActions(register); });

beforeEach(() => {
  // Fresh STATE per test so per-user Maps don't leak between cases.
  globalThis._concordSTATE = {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

describe("home-improvement: photo gallery", () => {
  it("adds and lists before/after gallery entries", () => {
    const add = call("gallery-add", ctxA, {
      room: "kitchen", title: "Kitchen remodel",
      beforeImage: "data:img/before", afterImage: "data:img/after",
    });
    assert.equal(add.ok, true);
    assert.ok(add.result.entry.id);
    const list = call("gallery-list", ctxA);
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);
  });

  it("rejects a gallery entry with no images", () => {
    const r = call("gallery-add", ctxA, { room: "bath" });
    assert.equal(r.ok, false);
  });

  it("deletes a gallery entry", () => {
    const add = call("gallery-add", ctxA, { room: "garage", beforeImage: "x" });
    const del = call("gallery-delete", ctxA, { id: add.result.entry.id });
    assert.equal(del.ok, true);
    assert.equal(call("gallery-list", ctxA).result.count, 0);
  });
});

describe("home-improvement: idea boards", () => {
  it("creates a board, adds ideas, and counts them", () => {
    const board = call("board-add", ctxA, { name: "Modern kitchen ideas" });
    assert.equal(board.ok, true);
    const idea = call("board-idea-add", ctxA, { boardId: board.result.board.id, note: "Quartz counters" });
    assert.equal(idea.ok, true);
    const list = call("board-list", ctxA);
    assert.equal(list.result.boards[0].ideaCount, 1);
  });

  it("rejects an idea with no note or image", () => {
    const board = call("board-add", ctxA, { name: "B" });
    const r = call("board-idea-add", ctxA, { boardId: board.result.board.id });
    assert.equal(r.ok, false);
  });

  it("deletes ideas and boards", () => {
    const board = call("board-add", ctxA, { name: "B" });
    const idea = call("board-idea-add", ctxA, { boardId: board.result.board.id, note: "n" });
    assert.equal(call("board-idea-delete", ctxA, { boardId: board.result.board.id, ideaId: idea.result.idea.id }).ok, true);
    assert.equal(call("board-delete", ctxA, { id: board.result.board.id }).ok, true);
    assert.equal(call("board-list", ctxA).result.count, 0);
  });
});

describe("home-improvement: contractor directory", () => {
  it("adds a pro, quote, and review and computes avg rating", () => {
    const pro = call("pro-add", ctxA, { name: "Acme Builders", trade: "general" });
    assert.equal(pro.ok, true);
    assert.equal(call("pro-quote-add", ctxA, { proId: pro.result.pro.id, project: "deck", amount: 5000 }).ok, true);
    assert.equal(call("pro-review-add", ctxA, { proId: pro.result.pro.id, rating: 4 }).ok, true);
    assert.equal(call("pro-review-add", ctxA, { proId: pro.result.pro.id, rating: 5 }).ok, true);
    const list = call("pro-list", ctxA);
    assert.equal(list.result.pros[0].avgRating, 4.5);
    assert.equal(list.result.pros[0].quoteCount, 1);
    assert.equal(list.result.pros[0].lowestQuote, 5000);
  });

  it("rejects quote on missing contractor", () => {
    assert.equal(call("pro-quote-add", ctxA, { proId: "nope", amount: 1 }).ok, false);
  });

  it("deletes a contractor", () => {
    const pro = call("pro-add", ctxA, { name: "X" });
    assert.equal(call("pro-delete", ctxA, { id: pro.result.pro.id }).ok, true);
  });
});

describe("home-improvement: materials shopping list", () => {
  it("adds items and totals line costs", () => {
    const a = call("shopping-add", ctxA, { name: "Tile", qty: 10, price: 3 });
    assert.equal(a.ok, true);
    const list = call("shopping-list", ctxA);
    assert.equal(list.result.totalCost, 30);
    assert.equal(list.result.items[0].lineTotal, 30);
  });

  it("tracks price drops over time", () => {
    const a = call("shopping-add", ctxA, { name: "Paint", price: 40 });
    const upd = call("shopping-price-update", ctxA, { id: a.result.item.id, price: 32 });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.dropped, true);
    assert.equal(upd.result.delta, -8);
    assert.equal(upd.result.item.priceHistory.length, 2);
  });

  it("toggles purchased state and deletes", () => {
    const a = call("shopping-add", ctxA, { name: "Nails", price: 5 });
    assert.equal(call("shopping-toggle", ctxA, { id: a.result.item.id }).result.item.purchased, true);
    assert.equal(call("shopping-delete", ctxA, { id: a.result.item.id }).ok, true);
  });
});

describe("home-improvement: home inventory / asset register", () => {
  it("adds assets and classifies warranty status", () => {
    const future = new Date(Date.now() + 200 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const past = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    call("inventory-add", ctxA, { name: "Fridge", warrantyExpires: future, purchasePrice: 1200 });
    call("inventory-add", ctxA, { name: "Old Heater", warrantyExpires: past, purchasePrice: 800 });
    const list = call("inventory-list", ctxA);
    assert.equal(list.result.count, 2);
    assert.equal(list.result.totalValue, 2000);
    assert.equal(list.result.warrantiesActive, 1);
    assert.equal(list.result.warrantiesExpired, 1);
  });

  it("rejects asset with no name and deletes assets", () => {
    assert.equal(call("inventory-add", ctxA, {}).ok, false);
    const a = call("inventory-add", ctxA, { name: "Dishwasher" });
    assert.equal(call("inventory-delete", ctxA, { id: a.result.asset.id }).ok, true);
  });
});

describe("home-improvement: project timeline / Gantt", () => {
  it("adds phases with dependencies and computes a schedule", () => {
    const proj = call("project-add", ctxA, { name: "Bathroom reno", budget: 8000 });
    const pid = proj.result.project.id;
    const demo = call("phase-add", ctxA, { projectId: pid, name: "Demolition", startDate: "2026-06-01", durationDays: 3 });
    assert.equal(demo.ok, true);
    const plumb = call("phase-add", ctxA, {
      projectId: pid, name: "Plumbing", durationDays: 5, dependsOn: [demo.result.phase.id],
    });
    assert.equal(plumb.ok, true);
    const gantt = call("gantt", ctxA, { projectId: pid });
    assert.equal(gantt.ok, true);
    assert.equal(gantt.result.bars.length, 2);
    // Plumbing must start after demolition ends.
    const demoBar = gantt.result.bars.find((b) => b.name === "Demolition");
    const plumbBar = gantt.result.bars.find((b) => b.name === "Plumbing");
    assert.ok(Date.parse(plumbBar.start) >= Date.parse(demoBar.end));
  });

  it("updates phase progress and feeds avgProgress", () => {
    const proj = call("project-add", ctxA, { name: "Deck" });
    const pid = proj.result.project.id;
    const ph = call("phase-add", ctxA, { projectId: pid, name: "Framing", durationDays: 4 });
    call("phase-update", ctxA, { projectId: pid, phaseId: ph.result.phase.id, progress: 50 });
    assert.equal(call("gantt", ctxA, { projectId: pid }).result.avgProgress, 50);
    assert.equal(call("phase-delete", ctxA, { projectId: pid, phaseId: ph.result.phase.id }).ok, true);
  });
});

describe("home-improvement: project list backing the timeline UI", () => {
  it("lists projects with spent + budgetRemaining derived fields", () => {
    const proj = call("project-add", ctxA, { name: "Garage cleanup", budget: 1500 });
    assert.equal(proj.ok, true);
    call("expense-log", ctxA, { projectId: proj.result.project.id, label: "Shelving", amount: 200, kind: "materials" });
    const list = call("project-list", ctxA);
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);
    assert.equal(list.result.projects[0].spent, 200);
    assert.equal(list.result.projects[0].budgetRemaining, 1300);
  });

  it("rejects a gantt request for a missing project", () => {
    assert.equal(call("gantt", ctxA, { projectId: "nope" }).ok, false);
  });
});

describe("home-improvement: seasonal maintenance reminders", () => {
  it("returns seasonal task suggestions", () => {
    const r = call("maintenance-seasonal", ctxA, { season: "fall" });
    assert.equal(r.ok, true);
    assert.equal(r.result.season, "fall");
    assert.ok(r.result.suggestedTasks.length > 0);
  });

  it("adds reminders and flags overdue ones", () => {
    const past = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    call("maintenance-add", ctxA, { task: "Clean gutters", dueDate: past, intervalDays: 180 });
    const list = call("maintenance-list", ctxA);
    assert.equal(list.result.count, 1);
    assert.equal(list.result.overdueCount, 1);
  });

  it("completes a reminder and reschedules it forward", () => {
    const r = call("maintenance-add", ctxA, { task: "Test detectors", intervalDays: 365 });
    const done = call("maintenance-complete", ctxA, { id: r.result.reminder.id });
    assert.equal(done.ok, true);
    assert.ok(Date.parse(done.result.reminder.dueDate) > Date.now());
    assert.equal(call("maintenance-delete", ctxA, { id: r.result.reminder.id }).ok, true);
  });
});
