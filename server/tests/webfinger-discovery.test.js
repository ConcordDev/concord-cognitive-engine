// server/tests/webfinger-discovery.test.js
//
// Phase 12 — pin the discoverPeerByWebfinger contract.

import { test } from "node:test";
import assert from "node:assert";

import { discoverPeerByWebfinger } from "../lib/federation-outbox.js";

function mockResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}

test("rejects a malformed handle", async () => {
  const r = await discoverPeerByWebfinger(null, "no-at-sign");
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error, "malformed_handle");
});

test("propagates webfinger HTTP errors", async () => {
  const r = await discoverPeerByWebfinger(null, "missing@example.test", {
    fetcher: async () => mockResponse(404, null),
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error, "webfinger_404");
});

test("returns no_activitypub_link when webfinger has no self+ap link", async () => {
  const r = await discoverPeerByWebfinger(null, "linkless@example.test", {
    fetcher: async () => mockResponse(200, { subject: "acct:linkless@example.test", links: [] }),
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error, "no_activitypub_link");
});

test("happy path resolves actorId + inboxUrl from webfinger + actor JSON-LD", async () => {
  const fetcher = async (url) => {
    if (url.includes("/.well-known/webfinger")) {
      return mockResponse(200, {
        subject: "acct:alice@peer.example",
        links: [
          { rel: "self", type: "application/activity+json", href: "https://peer.example/users/alice" },
        ],
      });
    }
    if (url === "https://peer.example/users/alice") {
      return mockResponse(200, {
        id: "https://peer.example/users/alice",
        inbox: "https://peer.example/users/alice/inbox",
        preferredUsername: "alice",
      });
    }
    return mockResponse(404, null);
  };
  const r = await discoverPeerByWebfinger(null, "alice@peer.example", { fetcher });
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.actorId, "https://peer.example/users/alice");
  assert.strictEqual(r.inboxUrl, "https://peer.example/users/alice/inbox");
});

test("malformed actor (missing inbox) returns malformed_actor", async () => {
  const fetcher = async (url) => {
    if (url.includes("/.well-known/webfinger")) {
      return mockResponse(200, { subject: "acct:bob@peer.example", links: [{ rel: "self", type: "application/activity+json", href: "https://peer.example/users/bob" }] });
    }
    return mockResponse(200, { id: "https://peer.example/users/bob" }); // no inbox
  };
  const r = await discoverPeerByWebfinger(null, "bob@peer.example", { fetcher });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error, "malformed_actor");
});
