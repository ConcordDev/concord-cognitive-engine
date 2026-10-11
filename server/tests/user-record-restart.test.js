// INC-32 — user-authored records that lived only on globalThis._concordSTATE
// Maps outside LENS_STATE_KEYS must survive the same snapshot a clean
// shutdown writes. One describe per migrated domain: write through the
// real macros, JSON-round-trip serializeLensState, drop the live STATE,
// hydrate a fresh one, and check the records and the other account.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

import registerSettings from "../domains/settings.js";
import registerPersonas from "../domains/personas.js";
import registerLawEnforcement from "../domains/lawenforcement.js";
import registerProfile from "../domains/profile.js";
import registerGame from "../domains/game.js";
import registerEntity from "../domains/entity.js";
import registerChem from "../domains/chem.js";
import registerMath from "../domains/math.js";
import registerGenesis from "../domains/genesis.js";
import registerDigitalTwin from "../domains/digital-twin.js";
import registerCompanion from "../domains/companion.js";
import { serializeLensState, hydrateLensState, LENS_STATE_KEYS } from "../lib/lens-state-persistence.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  ACTIONS.set(`${domain}.${name}`, fn);
}
function call(domain, name, ctx, input = {}) {
  const fn = ACTIONS.get(`${domain}.${name}`);
  if (!fn) throw new Error(`${domain}.${name} not registered`);
  return fn(ctx, { data: input }, input);
}

function restartFromSnapshot() {
  const persisted = JSON.parse(JSON.stringify(serializeLensState(globalThis._concordSTATE)));
  const next = {};
  hydrateLensState(next, persisted);
  globalThis._concordSTATE = next;
  return persisted;
}

const ctxA = { actor: { userId: "user_a" }, userId: "user_a", userAgent: "ConcordTest/1", ip: "203.0.113.10" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b", userAgent: "Other/2", ip: "203.0.113.20" };

before(() => {
  registerSettings(register);
  registerPersonas(register);
  registerLawEnforcement(register);
  registerProfile(register);
  registerGame(register);
  registerEntity(register);
  registerChem(register);
  registerMath(register);
  registerGenesis(register);
  registerDigitalTwin(register);
  registerCompanion(register);
});

beforeEach(() => {
  globalThis._concordSTATE = {};
});

describe("settings survive a snapshot restart", () => {
  it("registers _settings on the snapshot key list", () => {
    assert.ok(LENS_STATE_KEYS.includes("_settings"));
  });

  it("restores preferences and the device label, and does not store the password", () => {
    const set = call("settings", "set", ctxA, { key: "locale", value: "fr-FR" });
    assert.equal(set.ok, true, JSON.stringify(set));
    const pw = call("settings", "changePassword", ctxA, {
      currentPassword: "OldPassword1x",
      newPassword: "RestartHorse99",
    });
    assert.equal(pw.ok, true, JSON.stringify(pw));
    const sessions = call("settings", "sessions", ctxA, {});
    assert.equal(sessions.ok, true, JSON.stringify(sessions));
    assert.equal(sessions.result.sessions[0].userAgent, "ConcordTest/1");

    const blob = restartFromSnapshot();
    const json = JSON.stringify(blob);
    assert.equal(json.includes("OldPassword1x"), false);
    assert.equal(json.includes("RestartHorse99"), false);

    const got = call("settings", "get", ctxA, {});
    assert.equal(got.result.prefs.locale, "fr-FR");
    const other = call("settings", "get", ctxB, {});
    assert.equal(other.result.prefs.locale, "en-US");
    const again = call("settings", "sessions", ctxA, {});
    assert.equal(again.result.sessions[0].userAgent, "ConcordTest/1");
    assert.ok(again.result.sessions[0].lastSeen);
  });
});

describe("personas survive a snapshot restart", () => {
  it("restores an authored persona and its chat, and hides them from another account", () => {
    const created = call("personas", "create", ctxA, { name: "Ada", personality: "precise" });
    assert.equal(created.ok, true, JSON.stringify(created));
    const personaId = created.result.persona.id;
    const opened = call("personas", "chat_open", ctxA, { personaId });
    assert.equal(opened.ok, true, JSON.stringify(opened));
    const chatId = opened.result.chatId;

    restartFromSnapshot();

    const mine = call("personas", "mine", ctxA, {});
    assert.equal(mine.result.personas.length, 1);
    assert.equal(mine.result.personas[0].name, "Ada");
    const history = call("personas", "chat_history", ctxA, { chatId });
    assert.equal(history.ok, true, JSON.stringify(history));
    assert.equal(history.result.turns[0].role, "persona");
    const otherMine = call("personas", "mine", ctxB, {});
    assert.equal(otherMine.result.personas.length, 0);
    const hidden = call("personas", "get", ctxB, { personaId });
    assert.equal(hidden.ok, false);
    assert.equal(hidden.error, "not_visible");
    const notOwner = call("personas", "chat_history", ctxB, { chatId });
    assert.equal(notOwner.error, "not_chat_owner");
  });
});

describe("law enforcement non-case buckets survive a snapshot restart", () => {
  it("restores a CAD call, evidence, and a warrant for the owning account only", () => {
    const callRec = call("law-enforcement", "cadCreateCall", ctxA, {
      callType: "disturbance", location: "4th and Main", priority: "P2",
    });
    assert.equal(callRec.ok, true, JSON.stringify(callRec));
    const ev = call("law-enforcement", "evidenceIntake", ctxA, { description: "bloody glove" });
    assert.equal(ev.ok, true, JSON.stringify(ev));
    const wr = call("law-enforcement", "warrantIssue", ctxA, { subject: "Jane Roe" });
    assert.equal(wr.ok, true, JSON.stringify(wr));
    const cse = call("law-enforcement", "caseCreate", ctxA, { title: "Glove case" });
    assert.equal(cse.ok, true, JSON.stringify(cse));

    restartFromSnapshot();

    const queue = call("law-enforcement", "cadCallQueue", ctxA, {});
    assert.equal(queue.result.totalCalls, 1);
    assert.equal(queue.result.queue[0].location, "4th and Main");
    const evidence = call("law-enforcement", "evidenceList", ctxA, {});
    assert.equal(evidence.result.total, 1);
    assert.equal(evidence.result.evidence[0].description, "bloody glove");
    assert.equal(evidence.result.evidence[0].custody.length, 1);
    const warrants = call("law-enforcement", "warrantList", ctxA, {});
    assert.equal(warrants.result.total, 1);
    assert.equal(warrants.result.warrants[0].subject, "Jane Roe");
    const caseGot = call("law-enforcement", "caseGet", ctxA, { id: cse.result.case.id });
    assert.equal(caseGot.ok, true, JSON.stringify(caseGot));
    assert.equal(caseGot.result.case.title, "Glove case");

    const otherQueue = call("law-enforcement", "cadCallQueue", ctxB, {});
    assert.equal(otherQueue.result.totalCalls, 0);
    const otherEv = call("law-enforcement", "evidenceList", ctxB, {});
    assert.equal(otherEv.result.total, 0);
    const still = call("law-enforcement", "cadCallQueue", ctxA, {});
    assert.equal(still.result.totalCalls, 1);
  });
});

describe("profile survives a snapshot restart", () => {
  it("restores the editable profile, the visitor log, and the visitor sequence", () => {
    const updated = call("profile", "profile-update", ctxA, { displayName: "Ada Lovelace", bio: "analyst" });
    assert.equal(updated.ok, true, JSON.stringify(updated));
    const visit = call("profile", "visitor-record", ctxB, { profileUserId: "user_a", visitorName: "Grace" });
    assert.equal(visit.ok, true, JSON.stringify(visit));
    const firstSeq = visit.result.visitor.seq;

    restartFromSnapshot();

    const mine = call("profile", "profile-get", ctxA, {});
    assert.equal(mine.result.profile.displayName, "Ada Lovelace");
    assert.equal(mine.result.profile.bio, "analyst");
    const other = call("profile", "profile-get", ctxB, {});
    assert.equal(other.result.profile.displayName, "");
    const visitors = call("profile", "visitors-list", ctxA, {});
    assert.equal(visitors.result.count, 1);
    assert.equal(visitors.result.visitors[0].visitorId, "user_b");
    const otherLog = call("profile", "visitors-list", ctxB, {});
    assert.equal(otherLog.result.count, 0);
    const second = call("profile", "visitor-record", ctxA, { visitorName: "self" });
    assert.equal(second.result.visitor.seq, firstSeq + 1);
  });
});

describe("game survives a snapshot restart", () => {
  it("restores tasks, virtual gold, and the XP log, isolated per account", () => {
    const task = call("game", "taskCreate", ctxA, { title: "Morning pages", kind: "habit" });
    assert.equal(task.ok, true, JSON.stringify(task));
    const done = call("game", "taskComplete", ctxA, { id: task.result.task.id });
    assert.equal(done.ok, true, JSON.stringify(done));
    const gold = done.result.progress.gold;
    assert.ok(gold > 0);
    call("game", "taskCreate", ctxB, { title: "Other task", kind: "todo" });

    restartFromSnapshot();

    const list = call("game", "taskList", ctxA, {});
    assert.equal(list.result.tasks.some((t) => t.title === "Morning pages"), true);
    assert.equal(list.result.tasks.some((t) => t.title === "Other task"), false);
    const prog = call("game", "playerProgress", ctxA, {});
    assert.equal(prog.result.gold, gold);
    const log = call("game", "xpLogList", ctxA, {});
    assert.equal(log.result.count, 1);
    const other = call("game", "playerProgress", ctxB, {});
    assert.equal(other.result.gold, 0);
    assert.equal(other.result.totalTasks, 1);
  });

  it("keeps the XP log bounded at 500 entries", () => {
    const task = call("game", "taskCreate", ctxA, { title: "Reps", kind: "habit" });
    assert.equal(task.ok, true, JSON.stringify(task));
    for (let i = 0; i < 501; i++) {
      const done = call("game", "taskComplete", ctxA, { id: task.result.task.id });
      assert.equal(done.ok, true, JSON.stringify(done));
    }
    const log = call("game", "xpLogList", ctxA, { limit: 200 });
    assert.equal(log.result.count, 500);
  });
});

describe("entity graph survives a snapshot restart", () => {
  it("restores nodes and edges for the owning account only", () => {
    const a = call("entity", "node-create", ctxA, { name: "Paris", entityType: "city" });
    const b = call("entity", "node-create", ctxA, { name: "France", entityType: "country" });
    assert.equal(a.ok, true, JSON.stringify(a));
    assert.equal(b.ok, true, JSON.stringify(b));
    const edge = call("entity", "edge-create", ctxA, {
      from: a.result.node.id, to: b.result.node.id, relType: "capital_of",
    });
    assert.equal(edge.ok, true, JSON.stringify(edge));
    call("entity", "node-create", ctxB, { name: "Lyon" });

    restartFromSnapshot();

    const graph = call("entity", "graph-get", ctxA, {});
    assert.equal(graph.result.nodes.length, 2);
    assert.equal(graph.result.edges.length, 1);
    assert.equal(graph.result.edges[0].relType, "capital_of");
    const other = call("entity", "graph-get", ctxB, {});
    assert.equal(other.result.nodes.length, 1);
    assert.equal(other.result.nodes[0].name, "Lyon");
    assert.equal(other.result.edges.length, 0);
  });
});

describe("chem structures and lab notebook survive a snapshot restart", () => {
  it("restores a saved structure and a notebook entry per account", () => {
    const saved = call("chem", "save-structure", ctxA, { smiles: "CCO", name: "ethanol" });
    assert.equal(saved.ok, true, JSON.stringify(saved));
    const note = call("chem", "notebook-add", ctxA, { title: "esterification", observations: "clear" });
    assert.equal(note.ok, true, JSON.stringify(note));
    call("chem", "save-structure", ctxB, { smiles: "O", name: "water" });

    restartFromSnapshot();

    const list = call("chem", "list-structures", ctxA, {});
    assert.equal(list.result.count, 1);
    assert.equal(list.result.structures[0].name, "ethanol");
    assert.equal(list.result.structures[0].smiles, "CCO");
    const notes = call("chem", "notebook-list", ctxA, {});
    assert.equal(notes.result.entries.length, 1);
    assert.equal(notes.result.entries[0].title, "esterification");
    const other = call("chem", "list-structures", ctxB, {});
    assert.equal(other.result.count, 1);
    assert.equal(other.result.structures[0].name, "water");
  });
});

describe("math CAS history survives a snapshot restart", () => {
  it("restores one account's history and not the other's", () => {
    const rec = call("math", "casHistory", ctxA, { action: "record", entry: { expr: "2+2", result: "4" } });
    assert.equal(rec.ok, true, JSON.stringify(rec));
    call("math", "casHistory", ctxB, { action: "record", entry: { expr: "3*3", result: "9" } });

    restartFromSnapshot();

    const list = call("math", "casHistory", ctxA, { action: "list" });
    assert.equal(list.result.total, 1);
    assert.equal(list.result.history[0].expr, "2+2");
    const other = call("math", "casHistory", ctxB, { action: "list" });
    assert.equal(other.result.total, 1);
    assert.equal(other.result.history[0].expr, "3*3");
  });
});

describe("genesis saved searches survive a snapshot restart", () => {
  it("restores a saved search for the owning account only", () => {
    const saved = call("genesis", "search-save", ctxA, { label: "active writers", role: "writer", state: "active" });
    assert.equal(saved.ok, true, JSON.stringify(saved));
    call("genesis", "search-save", ctxB, { label: "other" });

    restartFromSnapshot();

    const list = call("genesis", "search-list", ctxA, {});
    assert.equal(list.result.searches.length, 1);
    assert.equal(list.result.searches[0].label, "active writers");
    assert.equal(list.result.searches[0].filters.role, "writer");
    const other = call("genesis", "search-list", ctxB, {});
    assert.equal(other.result.searches.length, 1);
    assert.equal(other.result.searches[0].label, "other");
  });
});

describe("digital twins survive a snapshot restart", () => {
  it("restores a twin for the owning account only", () => {
    const created = call("digital-twin", "twin-create", ctxA, { name: "Boiler 2", sourceId: "asset-2", state: { tempC: 80 } });
    assert.equal(created.ok, true, JSON.stringify(created));
    call("digital-twin", "twin-create", ctxB, { name: "Other", sourceId: "asset-9" });

    restartFromSnapshot();

    const list = call("digital-twin", "twin-list", ctxA, {});
    assert.equal(list.result.count, 1);
    assert.equal(list.result.twins[0].name, "Boiler 2");
    assert.equal(list.result.twins[0].state.tempC, 80);
    const other = call("digital-twin", "twin-list", ctxB, {});
    assert.equal(other.result.count, 1);
    assert.equal(other.result.twins[0].name, "Other");
  });
});

describe("companion notifications survive a snapshot restart", () => {
  it("restores the inbox, push prefs, and the notification sequence", () => {
    const added = call("companion", "notification-add", ctxA, { title: "Build finished", category: "build" });
    assert.equal(added.ok, true, JSON.stringify(added));
    const prefs = call("companion", "push-prefs-set", ctxA, { friendOnline: true });
    assert.equal(prefs.ok, true, JSON.stringify(prefs));
    const otherAdded = call("companion", "notification-add", ctxB, { title: "Other note" });
    assert.equal(otherAdded.ok, true, JSON.stringify(otherAdded));
    const seqBeforeRestart = otherAdded.result.notification.seq;

    restartFromSnapshot();

    const list = call("companion", "notifications-list", ctxA, {});
    assert.equal(list.result.notifications.length, 1);
    assert.equal(list.result.notifications[0].title, "Build finished");
    const got = call("companion", "push-prefs-get", ctxA, {});
    assert.equal(got.result.prefs.friendOnline, true);
    const other = call("companion", "notifications-list", ctxB, {});
    assert.equal(other.result.notifications.length, 1);
    assert.equal(other.result.notifications[0].title, "Other note");
    const otherPrefs = call("companion", "push-prefs-get", ctxB, {});
    assert.equal(otherPrefs.result.prefs.friendOnline, false);
    const second = call("companion", "notification-add", ctxA, { title: "Next" });
    assert.equal(second.result.notification.seq, seqBeforeRestart + 1);
  });
});
