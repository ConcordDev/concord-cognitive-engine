/**
 * DX Platform OAuth flow contract.
 *
 * Pins the loopback-redirect (RFC 8252) handshake end-to-end:
 *   GET  /oauth/dx       — consent page (signed-in vs. signed-out)
 *   POST /oauth/dx/grant — mint auth code + redirect to 127.0.0.1
 *   POST /api/dx/exchange — swap code for csk_* token
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";

import { mountDxOAuth, _resetDxOauthState } from "../routes/dx-oauth.js";

function fakeRequireAuth(currentUser) {
  // Returns a factory matching the project convention; the inner
  // middleware injects req.user.
  return () => (req, _res, next) => {
    if (currentUser) req.user = currentUser;
    next();
  };
}

function startApp({ user = null, getUserById = null } = {}) {
  const app = express();
  app.use(express.json());
  mountDxOAuth(app, {
    requireAuth: fakeRequireAuth(user),
    getUserById: getUserById || ((id) => ({ id, email: `${id}@test.local` })),
  });
  // bind on ephemeral port; return { url, close }
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

async function fetchText(url, opts) {
  const r = await fetch(url, { redirect: "manual", ...opts });
  return { status: r.status, location: r.headers.get("location"), body: await r.text() };
}

async function fetchJson(url, opts) {
  const r = await fetch(url, { redirect: "manual", ...opts });
  let body = null;
  try { body = await r.json(); } catch { body = null; }
  return { status: r.status, body };
}

describe("/oauth/dx — consent page", () => {
  let app;
  beforeEach(() => { _resetDxOauthState(); });
  afterEach(async () => { if (app) { await app.close(); app = null; } });

  it("400s on unsupported client", async () => {
    app = await startApp();
    const r = await fetchText(`${app.url}/oauth/dx?client=internet-explorer&state=` + "a".repeat(20));
    assert.equal(r.status, 400);
    assert.match(r.body, /unsupported_client/);
  });

  it("400s on too-short state", async () => {
    app = await startApp();
    const r = await fetchText(`${app.url}/oauth/dx?client=vscode&state=short`);
    assert.equal(r.status, 400);
    assert.match(r.body, /state/);
  });

  it("renders sign-in prompt when user not authenticated", async () => {
    app = await startApp({ user: null });
    const state = "a".repeat(20);
    const r = await fetchText(`${app.url}/oauth/dx?client=vscode&state=${state}`);
    assert.equal(r.status, 200);
    assert.match(r.body, /Sign in/);
    assert.doesNotMatch(r.body, /<button[^>]*class="allow"[^>]*type="submit"/);
  });

  it("renders consent + Allow button when signed in", async () => {
    app = await startApp({ user: { id: "user_1" } });
    const state = "abcd1234abcd1234abcd";
    const r = await fetchText(`${app.url}/oauth/dx?client=vscode&state=${state}`);
    assert.equal(r.status, 200);
    assert.match(r.body, /Authorize vscode/);
    assert.match(r.body, /Permissions requested/);
    assert.match(r.body, /<button type="submit" class="allow">Allow<\/button>/);
    assert.match(r.body, /user_1@test\.local/);
  });
});

describe("/oauth/dx/grant — auth-code mint + redirect", () => {
  let app;
  beforeEach(() => { _resetDxOauthState(); });
  afterEach(async () => { if (app) { await app.close(); app = null; } });

  async function consentThenGrant(user, port) {
    app = await startApp({ user });
    const state = "z".repeat(24);
    const portQuery = port ? `&port=${port}` : "";
    await fetchText(`${app.url}/oauth/dx?client=vscode&state=${state}${portQuery}`);
    const r = await fetchText(`${app.url}/oauth/dx/grant`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `state=${state}`,
    });
    return { state, response: r };
  }

  it("redirects to 127.0.0.1:port with code + state", async () => {
    const { state, response } = await consentThenGrant({ id: "user_42" }, 53117);
    assert.equal(response.status, 302);
    assert.match(response.location, /^http:\/\/127\.0\.0\.1:53117\/callback\?code=dx_/);
    assert.match(response.location, new RegExp(`state=${state}$`));
  });

  it("renders copyable code page when no port supplied", async () => {
    const { response } = await consentThenGrant({ id: "user_43" }, null);
    assert.equal(response.status, 200);
    assert.match(response.body, /Authorization Granted/);
    assert.match(response.body, /dx_[a-f0-9]+/);
  });

  it("400s on unknown state", async () => {
    app = await startApp({ user: { id: "user_44" } });
    const r = await fetchText(`${app.url}/oauth/dx/grant`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `state=neverregistered12345`,
    });
    assert.equal(r.status, 400);
    assert.match(r.body, /state_unknown_or_expired/);
  });

  it("401s when user is not signed in", async () => {
    app = await startApp({ user: null });
    const state = "y".repeat(24);
    await fetchText(`${app.url}/oauth/dx?client=vscode&state=${state}`);
    const r = await fetchText(`${app.url}/oauth/dx/grant`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `state=${state}`,
    });
    assert.equal(r.status, 401);
    assert.match(r.body, /must_be_signed_in/);
  });
});

describe("/api/dx/exchange — code → token", () => {
  let app;
  beforeEach(() => { _resetDxOauthState(); });
  afterEach(async () => { if (app) { await app.close(); app = null; } });

  async function getCode(user) {
    app = await startApp({ user });
    const state = "x".repeat(24);
    await fetchText(`${app.url}/oauth/dx?client=vscode&state=${state}&port=49002`);
    const grant = await fetchText(`${app.url}/oauth/dx/grant`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `state=${state}`,
    });
    const m = grant.location.match(/code=([^&]+)/);
    assert.ok(m, "expected code= in redirect");
    return { state, code: decodeURIComponent(m[1]) };
  }

  it("returns a long-lived csk_* token", async () => {
    const { state, code } = await getCode({ id: "user_55" });
    const r = await fetchJson(`${app.url}/api/dx/exchange`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, state }),
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.match(r.body.token, /^csk_[a-f0-9]+$/);
    assert.equal(r.body.client, "vscode");
  });

  it("rejects a re-used code (one-shot)", async () => {
    const { state, code } = await getCode({ id: "user_56" });
    const ok = await fetchJson(`${app.url}/api/dx/exchange`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, state }),
    });
    assert.equal(ok.status, 200);
    const replay = await fetchJson(`${app.url}/api/dx/exchange`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, state }),
    });
    assert.equal(replay.status, 400);
    assert.match(replay.body.error, /code_unknown_or_expired/);
  });

  it("rejects a state mismatch", async () => {
    const { code } = await getCode({ id: "user_57" });
    const r = await fetchJson(`${app.url}/api/dx/exchange`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, state: "wrong-state" }),
    });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /state_mismatch/);
  });

  it("400s on missing fields", async () => {
    app = await startApp({ user: { id: "user_58" } });
    const r = await fetchJson(`${app.url}/api/dx/exchange`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(r.status, 400);
  });
});
