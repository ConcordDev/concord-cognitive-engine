// server/tests/guest-read-privacy.test.js
//
// GB-1536 §6c — the HARD PRIVACY RULE, proven end to end:
//
//   A guest request returns only public or seeded sample content,
//   never another user's data.
//
// Seeds user A and user B, each with a private snippet, a private
// snapshot, a private DTU, and a private artifact in a non-social
// domain AND in every SOCIAL_DOMAINS domain — plus one ownerless row
// and one public row. As a guest (no credentials), every audited GET
// path and every guestRead action is called and the FULL JSON of each
// response is deep-scanned for any A- or B-owned private id or body
// marker. The public row must be present (the gate is a filter, not a
// blackout). As A: A sees A's private rows and never B's.
//
// Named cases: code.snippets-list and code snapshots — the leak this
// ticket's precedent fix closed (the anon "global snippet corpus").
//
// Run (GitHub CI): cd server && node --test tests/guest-read-privacy.test.js
// (NODE_ENV/AUTH_MODE are set below, pre-import, so the production
// gates and the H1 anon gate are live in-process.)

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { registerServerCleanExit } from "./lib/server-clean-exit.js";

process.env.NODE_ENV = "production";
process.env.AUTH_MODE = "jwt";
process.env.EMBEDDINGS_ENABLED = "false";
process.env.CONCORD_NO_LISTEN = "true";
process.env.CONCORD_LOAD_SHED_ENABLED = "0";

const mod = await import("../server.js");
const { __TEST__ } = mod;
const { app, STATE, makeCtx, dispatchLensRun } = __TEST__;
registerServerCleanExit(() => __TEST__);

const R = Math.random().toString(36).slice(2, 8);
const A = "gb1536-user-a";
const B = "gb1536-user-b";
const SOCIAL_DOMAINS = ["forum", "feed", "marketplace", "collab", "thread", "vote", "alliance", "global", "news", "questmarket"];

const marker = (who, what) => `GB1536-PRIV-${who}-${what}-${R}`;
const PUB_MARKER = `GB1536-PUB-post-${R}`;
const OWNERLESS_MARKER = `GB1536-OWNERLESS-${R}`;

const privateMarkers = []; // strings that must NEVER appear in a guest response
const privateIds = [];
let publicArtifactId = null;
const privateArtifactIds = {}; // domain -> id (A-owned)

function ctxFor(userId) {
  return makeCtx({ user: { id: userId, username: userId, role: "member" }, headers: {} });
}

async function seed() {
  const ctxA = ctxFor(A);
  const ctxB = ctxFor(B);

  // Private snippets + snapshots for both users (STATE rows in the exact
  // shapes collectSnippets/collectSnapshots read).
  for (const [who, uid] of [["A", A], ["B", B]]) {
    const snipId = `gb1536-snip-${who.toLowerCase()}-${R}`;
    STATE.dtus.set(snipId, {
      id: snipId,
      title: `Snippet: ${marker(who, "snippet")}`,
      creator_id: uid,
      createdAt: new Date().toISOString(),
      machine: { kind: "code_snippet", title: marker(who, "snippet"), language: "js", code: marker(who, "snippet-body") },
    });
    const snapId = `gb1536-snap-${who.toLowerCase()}-${R}`;
    STATE.dtus.set(snapId, {
      id: snapId,
      title: `Snapshot: ${marker(who, "snapshot")}`,
      creator_id: uid,
      createdAt: new Date().toISOString(),
      machine: {
        kind: "code_snapshot_bundle",
        message: marker(who, "snapshot"),
        files: [{ name: `${marker(who, "snapfile")}.js`, language: "js", scriptId: "x" }],
        committedAt: new Date().toISOString(),
      },
    });
    privateIds.push(snipId, snapId);
    privateMarkers.push(marker(who, "snippet"), marker(who, "snippet-body"), marker(who, "snapshot"), marker(who, "snapfile"));
  }

  // Private DTUs (for /api/dtus/* surfaces).
  for (const [who, uid] of [["A", A], ["B", B]]) {
    const id = `gb1536-dtu-${who.toLowerCase()}-${R}`;
    STATE.dtus.set(id, {
      id,
      title: marker(who, "dtu"),
      author: uid,
      scope: "local",
      createdAt: new Date().toISOString(),
      meta: { visibility: "private" },
      core: { summary: marker(who, "dtu-body") },
    });
    privateIds.push(id);
    privateMarkers.push(marker(who, "dtu"), marker(who, "dtu-body"));
  }

  // Private lens artifacts: one non-social domain + every social domain,
  // for A; one social (feed) for B.
  const mkArtifact = async (ctx, domain, title, visibility) => {
    const res = await dispatchLensRun("lens", "create", {
      domain,
      title,
      data: { body: title },
      meta: { visibility },
    }, ctx);
    assert.ok(res?.ok, `seed create ${domain}/${visibility} failed: ${JSON.stringify(res)?.slice(0, 200)}`);
    return res.result?.id || res.result?.artifact?.id || res.id;
  };

  privateArtifactIds.research = await mkArtifact(ctxA, "research", marker("A", "research"), "private");
  for (const domain of SOCIAL_DOMAINS) {
    privateArtifactIds[domain] = await mkArtifact(ctxA, domain, marker("A", domain), "private");
    privateMarkers.push(marker("A", domain));
    if (privateArtifactIds[domain]) privateIds.push(privateArtifactIds[domain]);
  }
  privateMarkers.push(marker("A", "research"));
  if (privateArtifactIds.research) privateIds.push(privateArtifactIds.research);

  const bFeed = await mkArtifact(ctxB, "feed", marker("B", "feed"), "private");
  privateMarkers.push(marker("B", "feed"));
  if (bFeed) privateIds.push(bFeed);

  // One public row (A, feed) — the guest MUST see this one.
  publicArtifactId = await mkArtifact(ctxA, "feed", PUB_MARKER, "public");

  // One ownerless row (A-created in feed, owner fields stripped after).
  const ownerlessId = await mkArtifact(ctxA, "feed", OWNERLESS_MARKER, "public");
  if (ownerlessId && STATE.dtus?.has?.(ownerlessId)) {
    const row = STATE.dtus.get(ownerlessId);
    for (const k of ["author", "ownerId", "userId", "createdBy", "authorId", "creator_id"]) delete row[k];
    if (row.meta) delete row.meta.ownerId;
  }
  // Ownerless rows fall for guests (CB-0594) even when marked public:
  // with no owner they are not verifiably public content.
  privateMarkers.push(OWNERLESS_MARKER);
}

let base;
let server;
before(async () => {
  await seed();
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.on("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server?.close(); } catch { /* teardown */ } });

async function get(path) {
  const res = await fetch(base + path);
  return { status: res.status, text: await res.text() };
}
async function lensRun(domain, action, input = {}) {
  const res = await fetch(base + "/api/lens/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ domain, action, input }),
  });
  return { status: res.status, text: await res.text() };
}

function assertNoLeak(label, text) {
  for (const m of privateMarkers) {
    assert.ok(!text.includes(m), `${label} leaked private marker ${m}`);
  }
  for (const id of privateIds) {
    assert.ok(!text.includes(id), `${label} leaked private id ${id}`);
  }
}

describe("guest read privacy — the hard rule (GB-1536)", () => {
  it("named case: code.snippets-list as guest returns none of A/B's snippets", async () => {
    const r = await lensRun("code", "snippets-list", {});
    assert.notEqual(r.status, 401, "snippets-list is guestRead — the gates must pass it");
    assertNoLeak("code.snippets-list (guest)", r.text);
  });

  it("named case: code.snapshots-list as guest returns none of A/B's snapshots", async () => {
    const r = await lensRun("code", "snapshots-list", {});
    assert.notEqual(r.status, 401, "snapshots-list is guestRead — the gates must pass it");
    assertNoLeak("code.snapshots-list (guest)", r.text);
  });

  it("guest lens.list in every social domain + research: no private rows, public row present", async () => {
    for (const domain of [...SOCIAL_DOMAINS, "research"]) {
      const r = await lensRun("lens", "list", { domain });
      assertNoLeak(`lens.list ${domain} (guest)`, r.text);
    }
    const feed = await lensRun("lens", "list", { domain: "feed" });
    assert.ok(feed.text.includes(PUB_MARKER), "the public row must reach a guest (filter, not blackout)");
  });

  it("guest GET /api/lens/:domain list route: no private rows, public row present", async () => {
    for (const domain of ["feed", "research", "code"]) {
      const r = await get(`/api/lens/${domain}?limit=200`);
      assertNoLeak(`GET /api/lens/${domain} (guest)`, r.text);
    }
    const feed = await get("/api/lens/feed?limit=200");
    assert.ok(feed.text.includes(PUB_MARKER), "public row present on the GET list route");
  });

  it("guest lens.get + GET /:id + /:id/dtus + /:id/export on a private artifact: nothing leaks", async () => {
    const id = privateArtifactIds.feed;
    assert.ok(id, "seeded private feed artifact id");
    const viaRun = await lensRun("lens", "get", { domain: "feed", id });
    assertNoLeak("lens.get private (guest)", viaRun.text);
    const viaGet = await get(`/api/lens/feed/${id}`);
    assertNoLeak("GET /api/lens/feed/:id private (guest)", viaGet.text);
    const dtus = await get(`/api/lens/feed/${id}/dtus`);
    assert.equal(dtus.status, 404, "a guest who cannot see the artifact gets 404 on its DTU list");
    assertNoLeak("GET /:id/dtus private (guest)", dtus.text);
    const exp = await get(`/api/lens/feed/${id}/export`);
    assertNoLeak("GET /:id/export private (guest)", exp.text);
  });

  it("guest /api/dtus surfaces: private DTUs never appear", async () => {
    for (const path of ["/api/dtus/paginated?scope=global&limit=200", "/api/dtus/paginated?scope=all&limit=200", "/api/dtus/paginated?limit=200"]) {
      const r = await get(path);
      assertNoLeak(`GET ${path} (guest)`, r.text);
    }
  });

  it("guest search never surfaces private rows", async () => {
    const r = await get(`/api/search?q=${encodeURIComponent("GB1536-PRIV")}`);
    assertNoLeak("GET /api/search (guest)", r.text);
  });

  it("guest context endpoints are closed", async () => {
    const user = await get(`/api/context/user/${A}`);
    assert.equal(user.status, 401, `GET /api/context/user/:id as guest -> ${user.status}`);
    const panel = await get(`/api/context/panel/gb1536-any-session`);
    assert.equal(panel.status, 401, `GET /api/context/panel/:id as guest -> ${panel.status}`);
  });

  it("as A: A sees A's private rows — and never B's", async () => {
    const ctxA = ctxFor(A);
    const list = await dispatchLensRun("lens", "list", { domain: "feed" }, ctxA);
    const listText = JSON.stringify(list);
    assert.ok(listText.includes(marker("A", "feed")), "A sees A's own private feed artifact");
    assert.ok(!listText.includes(marker("B", "feed")), "A never sees B's private feed artifact");
    const snips = await dispatchLensRun("code", "snippets-list", {}, ctxA);
    const snipText = JSON.stringify(snips);
    assert.ok(snipText.includes(marker("A", "snippet")), "A sees A's own snippet");
    assert.ok(!snipText.includes(marker("B", "snippet")), "A never sees B's snippet");
  });
});
