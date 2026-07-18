import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerActions from "../domains/retail.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`retail.${name}`);
  if (!fn) throw new Error(`retail.${name} not registered`);
  return fn(ctx, { id: null, data: params, meta: {} }, params);
}

before(() => { registerActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const ctxA = { actor: { userId: "u" }, userId: "u" };
const ctxB = { actor: { userId: "v" }, userId: "v" };

describe("retail — support-ticket queue (tickets-*)", () => {
  describe("tickets-upsert: create", () => {
    it("requires a subject", () => {
      const r = call("tickets-upsert", ctxA, {});
      assert.equal(r.ok, false);
    });

    it("rejects an unknown priority", () => {
      const r = call("tickets-upsert", ctxA, { subject: "Login broken", priority: "urgent" });
      assert.equal(r.ok, false);
      assert.match(r.error, /unknown priority/);
    });

    it("creates a ticket with defaults: status=open, priority=medium, empty replies", () => {
      const r = call("tickets-upsert", ctxA, { subject: "Login broken" });
      assert.equal(r.ok, true);
      assert.equal(r.result.ticket.status, "open");
      assert.equal(r.result.ticket.priority, "medium");
      assert.deepEqual(r.result.ticket.replies, []);
      assert.equal(r.result.ticket.statusHistory.length, 1);
      assert.equal(r.result.ticket.statusHistory[0].to, "open");
      assert.equal(r.result.ticket.statusHistory[0].from, null);
      assert.equal(r.result.ticket.resolvedAt, null);
      assert.equal(r.result.ticket.resolvedWithinSla, null);
      assert.equal(r.result.ticket.closedAt, null);
    });

    it("honors an explicit priority/assignee/requester at create", () => {
      const r = call("tickets-upsert", ctxA, { subject: "Outage", priority: "critical", assignee: "Sam", requester: "Acme Co", contactEmail: "ops@acme.com" });
      assert.equal(r.ok, true);
      assert.equal(r.result.ticket.priority, "critical");
      assert.equal(r.result.ticket.assignee, "Sam");
      assert.equal(r.result.ticket.requester, "Acme Co");
      assert.equal(r.result.ticket.contactEmail, "ops@acme.com");
    });

    it("computes slaDeadline from createdAt + the priority's SLA-minutes target (60/240/1440/2880)", () => {
      const table = { critical: 60, high: 240, medium: 1440, low: 2880 };
      for (const [priority, minutes] of Object.entries(table)) {
        const r = call("tickets-upsert", ctxA, { subject: `${priority} ticket`, priority });
        assert.equal(r.ok, true);
        assert.equal(r.result.ticket.slaTargetMinutes, minutes);
        const created = new Date(r.result.ticket.createdAt).getTime();
        const deadline = new Date(r.result.ticket.slaDeadline).getTime();
        assert.equal(deadline - created, minutes * 60000, `priority ${priority} deadline must be createdAt + ${minutes}m`);
      }
    });
  });

  describe("tickets-upsert: update", () => {
    it("updates non-status fields in place without touching statusHistory", () => {
      const created = call("tickets-upsert", ctxA, { subject: "Original" }).result.ticket;
      const r = call("tickets-upsert", ctxA, { id: created.id, subject: "Renamed", description: "more detail", assignee: "Jo" });
      assert.equal(r.ok, true);
      assert.equal(r.result.ticket.subject, "Renamed");
      assert.equal(r.result.ticket.description, "more detail");
      assert.equal(r.result.ticket.assignee, "Jo");
      assert.equal(r.result.ticket.statusHistory.length, 1);
    });

    it("rejects a status change through tickets-upsert — must go through tickets-status-move", () => {
      const created = call("tickets-upsert", ctxA, { subject: "Original" }).result.ticket;
      const r = call("tickets-upsert", ctxA, { id: created.id, status: "resolved" });
      assert.equal(r.ok, false);
      assert.match(r.error, /tickets-status-move/);
      assert.equal(call("tickets-list", ctxA).result.tickets[0].status, "open");
    });

    it("re-triage: changing priority on update recomputes slaDeadline from the ORIGINAL createdAt", () => {
      const created = call("tickets-upsert", ctxA, { subject: "x", priority: "low" }).result.ticket;
      const r = call("tickets-upsert", ctxA, { id: created.id, priority: "critical" });
      assert.equal(r.ok, true);
      assert.equal(r.result.ticket.priority, "critical");
      assert.equal(r.result.ticket.createdAt, created.createdAt);
      const created_ms = new Date(r.result.ticket.createdAt).getTime();
      const deadline_ms = new Date(r.result.ticket.slaDeadline).getTime();
      assert.equal(deadline_ms - created_ms, 60 * 60000); // critical = 60m
    });

    it("rejects an unknown priority on update", () => {
      const created = call("tickets-upsert", ctxA, { subject: "x" }).result.ticket;
      const r = call("tickets-upsert", ctxA, { id: created.id, priority: "urgent" });
      assert.equal(r.ok, false);
    });

    it("404s on an unknown id", () => {
      const r = call("tickets-upsert", ctxA, { id: "tkt_does_not_exist", subject: "x" });
      assert.equal(r.ok, false);
    });
  });

  describe("tickets-status-move", () => {
    it("moves freely among open statuses and appends an auditable statusHistory entry", () => {
      const created = call("tickets-upsert", ctxA, { subject: "x" }).result.ticket;
      const r = call("tickets-status-move", ctxA, { id: created.id, status: "waiting-on-customer", note: "asked for logs" });
      assert.equal(r.ok, true);
      assert.equal(r.result.ticket.status, "waiting-on-customer");
      assert.equal(r.result.ticket.statusHistory.length, 2);
      assert.equal(r.result.ticket.statusHistory[1].from, "open");
      assert.equal(r.result.ticket.statusHistory[1].to, "waiting-on-customer");
      assert.equal(r.result.ticket.statusHistory[1].note, "asked for logs");
    });

    it("rejects moving to the same status", () => {
      const created = call("tickets-upsert", ctxA, { subject: "x" }).result.ticket;
      const r = call("tickets-status-move", ctxA, { id: created.id, status: "open" });
      assert.equal(r.ok, false);
    });

    it("rejects an unknown status or an unknown ticket id", () => {
      const created = call("tickets-upsert", ctxA, { subject: "x" }).result.ticket;
      assert.equal(call("tickets-status-move", ctxA, { id: created.id, status: "escalated" }).ok, false);
      assert.equal(call("tickets-status-move", ctxA, { id: "tkt_missing", status: "resolved" }).ok, false);
    });

    it("resolving an on-time ticket stamps resolvedWithinSla=true", () => {
      const created = call("tickets-upsert", ctxA, { subject: "x", priority: "low" }).result.ticket; // 2880m window
      const r = call("tickets-status-move", ctxA, { id: created.id, status: "resolved" });
      assert.equal(r.ok, true);
      assert.equal(r.result.ticket.resolvedWithinSla, true);
      assert.ok(r.result.ticket.resolvedAt);
    });

    it("resolving a breached ticket stamps resolvedWithinSla=false — deadline is manually backdated to prove the elapsed-time math", () => {
      const created = call("tickets-upsert", ctxA, { subject: "x", priority: "critical" }).result.ticket; // 60m window
      // Backdate the deadline on the REAL persisted record (tickets-list
      // returns shallow copies) to simulate elapsed time > the SLA window
      // without sleeping the test.
      const real = globalThis._concordSTATE.retailLens.tickets.get("u").find((t) => t.id === created.id);
      real.slaDeadline = new Date(Date.now() - 60000).toISOString(); // deadline already passed
      const r = call("tickets-status-move", ctxA, { id: created.id, status: "resolved" });
      assert.equal(r.ok, true);
      assert.equal(r.result.ticket.resolvedWithinSla, false);
    });

    it("closing directly from an open status (never resolved) leaves resolvedAt/resolvedWithinSla null", () => {
      const created = call("tickets-upsert", ctxA, { subject: "duplicate report" }).result.ticket;
      const r = call("tickets-status-move", ctxA, { id: created.id, status: "closed" });
      assert.equal(r.ok, true);
      assert.equal(r.result.ticket.status, "closed");
      assert.ok(r.result.ticket.closedAt);
      assert.equal(r.result.ticket.resolvedAt, null);
      assert.equal(r.result.ticket.resolvedWithinSla, null);
    });

    it("resolved -> closed is allowed directly (no reopen needed) and preserves the resolution stamp", () => {
      const created = call("tickets-upsert", ctxA, { subject: "x" }).result.ticket;
      call("tickets-status-move", ctxA, { id: created.id, status: "resolved" });
      const resolvedAt = call("tickets-list", ctxA).result.tickets[0].resolvedAt;
      const r = call("tickets-status-move", ctxA, { id: created.id, status: "closed" });
      assert.equal(r.ok, true);
      assert.equal(r.result.ticket.status, "closed");
      assert.equal(r.result.ticket.resolvedAt, resolvedAt);
      assert.equal(r.result.ticket.resolvedWithinSla, true);
    });

    it("a closed ticket cannot move without reopen:true", () => {
      const created = call("tickets-upsert", ctxA, { subject: "x" }).result.ticket;
      call("tickets-status-move", ctxA, { id: created.id, status: "closed" });
      const r = call("tickets-status-move", ctxA, { id: created.id, status: "open" });
      assert.equal(r.ok, false);
      assert.match(r.error, /reopen/);
    });

    it("reopen:true moves a closed ticket back into an OPEN status, clears closure stamps, and marks the history entry reopened", () => {
      const created = call("tickets-upsert", ctxA, { subject: "x" }).result.ticket;
      call("tickets-status-move", ctxA, { id: created.id, status: "resolved" });
      call("tickets-status-move", ctxA, { id: created.id, status: "closed" });
      const r = call("tickets-status-move", ctxA, { id: created.id, status: "in-progress", reopen: true });
      assert.equal(r.ok, true);
      assert.equal(r.result.ticket.status, "in-progress");
      assert.equal(r.result.ticket.closedAt, null);
      assert.equal(r.result.ticket.resolvedAt, null);
      assert.equal(r.result.ticket.resolvedWithinSla, null);
      assert.equal(r.result.ticket.statusHistory.at(-1).reopened, true);
    });

    it("closed cannot reopen directly into resolved — reopen target must be an open status", () => {
      const created = call("tickets-upsert", ctxA, { subject: "x" }).result.ticket;
      call("tickets-status-move", ctxA, { id: created.id, status: "closed" });
      const r = call("tickets-status-move", ctxA, { id: created.id, status: "resolved", reopen: true });
      assert.equal(r.ok, false);
    });
  });

  describe("tickets-reply-add", () => {
    it("appends a reply to the thread and requires author + body", () => {
      const created = call("tickets-upsert", ctxA, { subject: "x" }).result.ticket;
      assert.equal(call("tickets-reply-add", ctxA, { id: created.id, author: "", body: "hi" }).ok, false);
      assert.equal(call("tickets-reply-add", ctxA, { id: created.id, author: "Sam", body: "" }).ok, false);
      const r = call("tickets-reply-add", ctxA, { id: created.id, author: "Sam", body: "Looking into it now." });
      assert.equal(r.ok, true);
      assert.equal(r.result.ticket.replies.length, 1);
      assert.equal(r.result.ticket.replies[0].author, "Sam");
      assert.equal(r.result.ticket.replies[0].body, "Looking into it now.");
      assert.ok(r.result.ticket.replies[0].at);
    });

    it("does not change ticket status as a side effect", () => {
      const created = call("tickets-upsert", ctxA, { subject: "x" }).result.ticket;
      call("tickets-reply-add", ctxA, { id: created.id, author: "Sam", body: "update" });
      assert.equal(call("tickets-list", ctxA).result.tickets[0].status, "open");
    });

    it("404s on an unknown ticket id", () => {
      assert.equal(call("tickets-reply-add", ctxA, { id: "tkt_missing", author: "Sam", body: "hi" }).ok, false);
    });
  });

  describe("tickets-list: rollups", () => {
    it("counts open + breached-open tickets and computes complianceRate from resolved tickets only", () => {
      const critical = call("tickets-upsert", ctxA, { subject: "critical open", priority: "critical" }).result.ticket;
      call("tickets-upsert", ctxA, { subject: "low open", priority: "low" });
      const toResolveOnTime = call("tickets-upsert", ctxA, { subject: "resolve on time", priority: "low" }).result.ticket;
      call("tickets-status-move", ctxA, { id: toResolveOnTime.id, status: "resolved" });

      // Backdate the critical ticket's REAL persisted deadline so it reads as
      // breached-open (tickets-list returns shallow copies, not the record).
      const real = globalThis._concordSTATE.retailLens.tickets.get("u").find((t) => t.id === critical.id);
      real.slaDeadline = new Date(Date.now() - 1000).toISOString();

      const r = call("tickets-list", ctxA);
      assert.equal(r.ok, true);
      assert.equal(r.result.rollup.totalTickets, 3);
      assert.equal(r.result.rollup.openCount, 2);
      assert.equal(r.result.rollup.breachedOpenCount, 1);
      assert.equal(r.result.rollup.resolvedCount, 1);
      assert.equal(r.result.rollup.metCount, 1);
      assert.equal(r.result.rollup.complianceRate, 100); // 1 of 1 resolved met SLA
      assert.equal(r.result.rollup.byPriority.critical.breached, 1);
    });

    it("complianceRate defaults to 100 when nothing has been resolved yet (no false 0%)", () => {
      call("tickets-upsert", ctxA, { subject: "brand new" });
      const r = call("tickets-list", ctxA);
      assert.equal(r.result.rollup.resolvedCount, 0);
      assert.equal(r.result.rollup.complianceRate, 100);
    });

    it("filters by status and priority without changing the (full-book) rollup numbers", () => {
      call("tickets-upsert", ctxA, { subject: "A", priority: "high" });
      call("tickets-upsert", ctxA, { subject: "B", priority: "low" });
      const filtered = call("tickets-list", ctxA, { status: "open", priority: "high" });
      assert.equal(filtered.result.tickets.length, 1);
      assert.equal(filtered.result.tickets[0].subject, "A");
      assert.equal(filtered.result.rollup.totalTickets, 2);
    });

    it("rejects an unknown status or priority filter", () => {
      assert.equal(call("tickets-list", ctxA, { status: "nope" }).ok, false);
      assert.equal(call("tickets-list", ctxA, { priority: "nope" }).ok, false);
    });

    it("stamps a per-ticket slaState (healthy/approaching/breached/resolved-on-time/resolved-late/closed)", () => {
      const healthy = call("tickets-upsert", ctxA, { subject: "fresh", priority: "low" }).result.ticket;
      const resolved = call("tickets-upsert", ctxA, { subject: "fixed", priority: "low" }).result.ticket;
      call("tickets-status-move", ctxA, { id: resolved.id, status: "resolved" });
      const closed = call("tickets-upsert", ctxA, { subject: "closed as dup" }).result.ticket;
      call("tickets-status-move", ctxA, { id: closed.id, status: "closed" });

      const r = call("tickets-list", ctxA);
      const byId = Object.fromEntries(r.result.tickets.map((t) => [t.id, t.slaState]));
      assert.equal(byId[healthy.id], "healthy");
      assert.equal(byId[resolved.id], "resolved-on-time");
      assert.equal(byId[closed.id], "closed");
    });
  });

  describe("tickets-delete", () => {
    it("deletes and 404s a second time", () => {
      const created = call("tickets-upsert", ctxA, { subject: "x" }).result.ticket;
      assert.equal(call("tickets-delete", ctxA, { id: created.id }).ok, true);
      assert.equal(call("tickets-delete", ctxA, { id: created.id }).ok, false);
      assert.equal(call("tickets-list", ctxA).result.tickets.length, 0);
    });
  });

  describe("INVARIANT: per-user isolation", () => {
    it("user B never sees user A's tickets, and cannot move/reply/delete them", () => {
      const created = call("tickets-upsert", ctxA, { subject: "A-only" }).result.ticket;
      assert.equal(call("tickets-list", ctxB).result.tickets.length, 0);
      assert.equal(call("tickets-status-move", ctxB, { id: created.id, status: "resolved" }).ok, false);
      assert.equal(call("tickets-reply-add", ctxB, { id: created.id, author: "x", body: "y" }).ok, false);
      assert.equal(call("tickets-delete", ctxB, { id: created.id }).ok, false);
      // Untouched from A's side.
      assert.equal(call("tickets-list", ctxA).result.tickets[0].status, "open");
    });
  });

  describe("degrade-graceful when STATE is unavailable", () => {
    it("every tickets-* macro fails soft with {ok:false}, never throws", () => {
      const saved = globalThis._concordSTATE;
      globalThis._concordSTATE = undefined;
      assert.equal(call("tickets-list", ctxA).ok, false);
      assert.equal(call("tickets-upsert", ctxA, { subject: "x" }).ok, false);
      assert.equal(call("tickets-status-move", ctxA, { id: "x", status: "resolved" }).ok, false);
      assert.equal(call("tickets-reply-add", ctxA, { id: "x", author: "a", body: "b" }).ok, false);
      assert.equal(call("tickets-delete", ctxA, { id: "x" }).ok, false);
      globalThis._concordSTATE = saved;
    });
  });

  describe("slaStatus relationship: falls back to persisted tickets only when no book is pasted", () => {
    it("no incidents/tickets key at all → reads the real persisted tickets-* book", () => {
      call("tickets-upsert", ctxA, { subject: "Persisted ticket", priority: "critical" });
      const r = call("slaStatus", ctxA, {});
      assert.equal(r.ok, true);
      assert.equal(r.result.ticketSource, "persisted");
      assert.equal(r.result.totalTickets, 1);
    });

    it("an explicit (even garbage/malformed) tickets key is honored as 'pasted' and does NOT read persisted tickets — exact pre-existing contract", () => {
      call("tickets-upsert", ctxA, { subject: "Persisted ticket" });
      const r = call("slaStatus", ctxA, { tickets: "boom" });
      assert.equal(r.ok, true);
      assert.equal(r.result.ticketSource, "pasted");
      assert.equal(r.result.totalTickets, 0);
    });

    it("REGRESSION: the pre-existing 'non-array incidents payload' case still falls through to an empty legacy report", () => {
      // Reproduces server/tests/retail-lens-macros.test.js's exact case: no
      // `tickets` key present at all, only a non-array `incidents`. Because
      // `incidents` fails Array.isArray, execution reaches the legacy
      // branch; because `tickets` truly is NOT a key of the payload, the new
      // persisted-fallback fires — but with nothing persisted for this user,
      // it still reads back empty, so totalTickets stays 0 exactly as the
      // pre-existing test asserts.
      const r = call("slaStatus", ctxA, { incidents: "boom" });
      assert.equal(r.ok, true);
      assert.equal(r.result.totalTickets, 0);
      assert.equal(r.result.ticketSource, "persisted");
    });

    it("a real pasted array (even empty) is honored as 'pasted' and does NOT read persisted tickets", () => {
      call("tickets-upsert", ctxA, { subject: "Persisted ticket" });
      const r = call("slaStatus", ctxA, { tickets: [] });
      assert.equal(r.ok, true);
      assert.equal(r.result.ticketSource, "pasted");
      assert.equal(r.result.totalTickets, 0);
    });
  });
});
