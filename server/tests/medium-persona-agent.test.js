import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerPersonas from "../domains/personas.js";
import registerAgents from "../domains/agents.js";

const actions = new Map();
function register(domain, name, fn) { actions.set(`${domain}.${name}`, fn); }
const ctx = { actor: { userId: "ada" }, userId: "ada" };
function call(domain, name, params) {
  return actions.get(`${domain}.${name}`)(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => {
  registerPersonas(register);
  registerAgents(register);
});
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

describe("persona delete and greeting, and agent budget removal", () => {
  it("drops the persona's chats and ratings when the persona is deleted", () => {
    const created = call("personas", "create", { name: "Ada", greeting: "Hello" });
    const id = created.result.persona.id;
    const opened = call("personas", "chat_open", { personaId: id });
    assert.equal(opened.ok, true);
    call("personas", "rate", { personaId: id, rating: 5 });
    const removed = call("personas", "delete", { personaId: id });
    assert.equal(removed.ok, true);
    assert.equal(removed.result.removedChats, 1);
    assert.equal(call("personas", "chat_history", { chatId: opened.result.chatId }).ok, false);
  });

  it("rewrites an open greeting when the greeting is edited", () => {
    const created = call("personas", "create", { name: "Ada", greeting: "Hello" });
    const id = created.result.persona.id;
    const opened = call("personas", "chat_open", { personaId: id });
    const updated = call("personas", "update", { personaId: id, greeting: "Welcome back" });
    assert.equal(updated.ok, true);
    const history = call("personas", "chat_history", { chatId: opened.result.chatId });
    assert.equal(history.result.turns[0].text, "Welcome back");
  });

  it("removes a token budget without touching usage reset", () => {
    assert.equal(call("agents", "setBudget", { agentId: "ag", tokenLimit: 100 }).ok, true);
    const cleared = call("agents", "clearBudget", { agentId: "ag" });
    assert.equal(cleared.ok, true);
    const again = call("agents", "getBudget", { agentId: "ag" });
    assert.equal(again.result.budget, null);
  });
});
