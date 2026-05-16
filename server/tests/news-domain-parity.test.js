import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import registerNewsActions from "../domains/news.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) { return ACTIONS.get(`news.${name}`)(ctx, { id: null, data: {}, meta: {} }, params); }
before(() => { registerNewsActions(register); });
const ctxA = { actor: { userId: "u" }, userId: "u" };

describe("news parity macros", () => {
  it("headlines returns category-filtered set", () => {
    const r = call("headlines", ctxA, { category: "tech", limit: 10 });
    assert.equal(r.ok, true);
    assert.ok(r.result.headlines.length > 0);
    assert.ok(r.result.headlines.every(h => h.category === 'tech'));
  });

  it("headlines top returns mix", () => {
    const r = call("headlines", ctxA, { category: "top", limit: 50 });
    assert.ok(r.result.headlines.length >= 10);
  });

  it("daily-briefing returns structured sections (without LLM)", async () => {
    const r = await call("daily-briefing", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.greeting);
    assert.ok(r.result.topStories.bullets.length >= 1);
    assert.ok(r.result.tech.bullets.length >= 1);
    assert.ok(r.result.closing);
  });
});
