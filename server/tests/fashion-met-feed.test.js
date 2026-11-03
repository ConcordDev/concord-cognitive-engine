// The costume feed's search path. Object detail stays on the collection
// path that is still current. Fetch is stubbed; this file does not
// call the museum.

import { describe, it, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import registerFashionActions from "../domains/fashion.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }

const originalFetch = globalThis.fetch;
before(() => { registerFashionActions(register); });
afterEach(() => { globalThis.fetch = originalFetch; });

function freshState() {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
}

function callFeed(ctx, params = {}) {
  const fn = ACTIONS.get("fashion.feed");
  assert.ok(fn, "fashion.feed not registered");
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

describe("fashion.feed Met search", () => {
  it("asks v1.1 search and keeps object detail on v1", async () => {
    freshState();
    const urls = [];
    const created = [];
    globalThis.fetch = async (url) => {
      const href = String(url);
      urls.push(href);
      if (href.includes("/v1.1/search")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            total: 100,
            objectIDs: Array.from({ length: 100 }, (_, i) => 79776 + i),
          }),
        };
      }
      const oid = href.slice(href.lastIndexOf("/") + 1);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          objectID: Number(oid),
          title: `Piece ${oid}`,
          artistDisplayName: "Maker",
          objectDate: "1890",
          medium: "silk",
          department: "Costume Institute",
          culture: "American",
          primaryImageSmall: null,
        }),
      };
    };
    const ctx = {
      actor: { userId: "user_a" },
      userId: "user_a",
      macro: {
        run: async (domain, name, body) => {
          created.push({ domain, name, title: body.title, source: body.source, objectId: body.meta?.objectId });
          return { ok: true, dtu: { id: `dtu_${created.length}` } };
        },
      },
    };
    const r = await callFeed(ctx, { limit: 2 });
    assert.equal(r.ok, true);
    assert.equal(r.result.source, "metmuseum-fashion");
    assert.equal(r.result.ingested, 2);
    assert.equal(r.result.dtuIds.length, 2);
    assert.equal(urls.length, 3);
    assert.match(urls[0], /\/public\/collection\/v1\.1\/search\?q=(dress|gown|coat|hat|shoes|textile)&hasImages=true$/);
    assert.doesNotMatch(urls[0], /\/public\/collection\/v1\/search/);
    assert.match(urls[1], /\/public\/collection\/v1\/objects\/79776$/);
    assert.match(urls[2], /\/public\/collection\/v1\/objects\/79777$/);
    assert.equal(created.length, 2);
    assert.equal(created[0].domain, "dtu");
    assert.equal(created[0].name, "create");
    assert.equal(created[0].source, "metmuseum-feed");
    assert.equal(created[0].title, "Fashion piece: Piece 79776");
    assert.equal(created[0].objectId, 79776);
  });

  it("reports a refused search and does not invent pieces", async () => {
    freshState();
    let ran = false;
    globalThis.fetch = async () => ({ ok: false, status: 410, json: async () => ({}) });
    const r = await callFeed({
      actor: { userId: "user_a" },
      userId: "user_a",
      macro: { run: async () => { ran = true; return { ok: true, dtu: { id: "x" } }; } },
    });
    assert.equal(r.ok, false);
    assert.equal(r.error, "metmuseum 410");
    assert.equal(ran, false);
  });

  it("names an unreachable search", async () => {
    freshState();
    globalThis.fetch = async () => { throw new Error("connect failed"); };
    const r = await callFeed({
      actor: { userId: "user_a" },
      userId: "user_a",
      macro: { run: async () => ({ ok: true, dtu: { id: "x" } }) },
    });
    assert.equal(r.ok, false);
    assert.equal(r.error, "metmuseum unreachable: connect failed");
  });
});
