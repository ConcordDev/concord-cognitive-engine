/**
 * Tier-2 contract tests for the four marquee connectors built on the Track-C
 * connectorFetch chokepoint: Slack, Google Sheets, GitHub, Notion. The provider
 * network is mocked via the opts.fetchImpl seam (no live egress); a valid token
 * is seeded so the helper runs end-to-end through parsing. Macro guards are
 * exercised offline (no token → honest reason, no faked data).
 *
 * Run: node --test server/tests/connector-extra-paths.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as migrate331 } from "../migrations/331_connector_oauth_tokens.js";
import { persistConnectorToken } from "../lib/connector-tokens.js";
import {
  listSlackChannels,
  readSlackMessages,
  postSlackMessage,
  readGoogleSheet,
  appendGoogleSheetRow,
  listGitHubRepos,
  readGitHubIssues,
  createGitHubIssue,
  searchNotion,
  readNotionPage,
  appendNotionBlock,
} from "../lib/connector-client.js";
import registerSlackActions from "../domains/slack.js";
import registerSheetsActions from "../domains/sheets.js";
import registerGithubActions from "../domains/github.js";
import registerNotionActions from "../domains/notion.js";
import { PROVIDERS, CONNECTOR_TOKEN_KEY } from "../routes/connector-oauth.js";

function freshDb() {
  const db = new Database(":memory:");
  migrate331(db);
  return db;
}
function seedToken(db, connectorId) {
  persistConnectorToken(db, "u1", connectorId, { access_token: "at-1", refresh_token: "rt-1", expires_in: 3600, scope: "x" });
}
const resp = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });

function buildMacros(register) {
  const map = new Map();
  register((domain, name, fn) => map.set(`${domain}.${name}`, fn));
  return map;
}
function callMacro(map, key, ctx, params) {
  const fn = map.get(key);
  assert.ok(fn, `${key} registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

// ── Slack ───────────────────────────────────────────────────────────────────
describe("Slack helpers (mocked egress)", () => {
  let db;
  beforeEach(() => { db = freshDb(); seedToken(db, "slack"); });
  afterEach(() => { db.close(); });

  it("channels normalizes the conversations.list shape", async () => {
    const fetchImpl = async () => resp({ ok: true, channels: [{ id: "C1", name: "general", is_member: true, topic: { value: "hi" } }], response_metadata: { next_cursor: "nx" } });
    const r = await listSlackChannels(db, "u1", {}, { fetchImpl });
    assert.equal(r.ok, true);
    assert.equal(r.channels[0].name, "general");
    assert.equal(r.nextCursor, "nx");
  });

  it("history maps messages and exposes ts/user/text", async () => {
    const fetchImpl = async () => resp({ ok: true, messages: [{ ts: "1.1", user: "U1", text: "hello", type: "message" }] });
    const r = await readSlackMessages(db, "u1", "C1", { limit: 10 }, { fetchImpl });
    assert.equal(r.ok, true);
    assert.equal(r.messages[0].text, "hello");
    assert.equal(r.messages[0].user, "U1");
  });

  it("post returns the new message ts", async () => {
    let captured = null;
    const fetchImpl = async (url, init) => { captured = { url, body: JSON.parse(init.body) }; return resp({ ok: true, ts: "9.9", channel: "C1" }); };
    const r = await postSlackMessage(db, "u1", "C1", "yo", { fetchImpl });
    assert.equal(r.ok, true);
    assert.equal(r.ts, "9.9");
    assert.match(captured.url, /chat\.postMessage$/);
    assert.equal(captured.body.text, "yo");
  });

  it("surfaces Slack's body-level ok:false as an honest reason", async () => {
    const fetchImpl = async () => resp({ ok: false, error: "channel_not_found" });
    const r = await readSlackMessages(db, "u1", "C9", {}, { fetchImpl });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "channel_not_found");
  });
});

describe("Slack macros — guards + connect", () => {
  let db, slack;
  beforeEach(() => { db = freshDb(); slack = buildMacros(registerSlackActions); });
  afterEach(() => { db.close(); });
  const ctx = (over = {}) => ({ db, actor: { userId: "u1" }, ...over });

  it("slack.history with no token returns no_token", async () => {
    const out = await callMacro(slack, "slack.history", ctx(), { channel: "C1" });
    assert.equal(out.ok, false);
    assert.equal(out.reason, "no_token");
  });
  it("slack.post requires a channel", async () => {
    const out = await callMacro(slack, "slack.post", ctx(), { text: "x" });
    assert.equal(out.ok, false);
    assert.match(out.error, /channel/);
  });
  it("slack.connect surfaces a real authorize URL", () => {
    const out = callMacro(slack, "slack.connect", ctx(), {});
    assert.equal(out.ok, true);
    assert.match(out.result.authorizeUrl, /\/api\/oauth\/slack\/authorize\?/);
    assert.ok(out.result.scopes.includes("chat:write"));
  });
});

// ── Google Sheets ─────────────────────────────────────────────────────────────
describe("Sheets helpers (mocked egress)", () => {
  let db;
  beforeEach(() => { db = freshDb(); seedToken(db, "google_sheets"); });
  afterEach(() => { db.close(); });

  it("read returns the values grid + rowCount", async () => {
    const fetchImpl = async () => resp({ range: "Sheet1!A1:B2", values: [["a", "b"], ["c", "d"]] });
    const r = await readGoogleSheet(db, "u1", "ss1", "A1:B2", { fetchImpl });
    assert.equal(r.ok, true);
    assert.equal(r.rowCount, 2);
    assert.equal(r.values[1][0], "c");
  });
  it("append posts a single row and returns updatedRows", async () => {
    let captured = null;
    const fetchImpl = async (url, init) => { captured = { url, body: JSON.parse(init.body) }; return resp({ updates: { updatedRange: "Sheet1!A3:B3", updatedRows: 1 } }); };
    const r = await appendGoogleSheetRow(db, "u1", "ss1", "A1", ["x", "y"], { fetchImpl });
    assert.equal(r.ok, true);
    assert.equal(r.updatedRows, 1);
    assert.match(captured.url, /:append\?/);
    assert.deepEqual(captured.body.values, [["x", "y"]]);
  });
});

describe("Sheets macros — guards + connect", () => {
  let db, sheets;
  beforeEach(() => { db = freshDb(); sheets = buildMacros(registerSheetsActions); });
  afterEach(() => { db.close(); });
  const ctx = () => ({ db, actor: { userId: "u1" } });

  it("sheets.read with no token returns no_token", async () => {
    const out = await callMacro(sheets, "sheets.read", ctx(), { spreadsheetId: "ss1" });
    assert.equal(out.ok, false);
    assert.equal(out.reason, "no_token");
  });
  it("sheets.read requires a spreadsheetId", async () => {
    const out = await callMacro(sheets, "sheets.read", ctx(), {});
    assert.equal(out.ok, false);
    assert.match(out.error, /spreadsheetId/);
  });
  it("sheets.connect surfaces the google authorize URL", () => {
    const out = callMacro(sheets, "sheets.connect", ctx(), {});
    assert.equal(out.ok, true);
    assert.match(out.result.authorizeUrl, /\/api\/oauth\/google\/authorize\?/);
    assert.ok(out.result.scopes.some((s) => s.includes("spreadsheets")));
  });
});

// ── GitHub ─────────────────────────────────────────────────────────────────
describe("GitHub helpers (mocked egress)", () => {
  let db;
  beforeEach(() => { db = freshDb(); seedToken(db, "github"); });
  afterEach(() => { db.close(); });

  it("repos normalizes the user-repos shape", async () => {
    const fetchImpl = async (url, init) => {
      assert.match(init.headers["User-Agent"], /concord/); // GitHub requires UA
      return resp([{ id: 1, full_name: "me/repo", name: "repo", private: false, open_issues_count: 2, html_url: "u" }]);
    };
    const r = await listGitHubRepos(db, "u1", {}, { fetchImpl });
    assert.equal(r.ok, true);
    assert.equal(r.repos[0].fullName, "me/repo");
    assert.equal(r.repos[0].openIssues, 2);
  });
  it("issues filters out pull requests", async () => {
    const fetchImpl = async () => resp([
      { number: 1, title: "bug", state: "open", user: { login: "a" }, labels: [{ name: "bug" }] },
      { number: 2, title: "a PR", state: "open", pull_request: { url: "x" } },
    ]);
    const r = await readGitHubIssues(db, "u1", "me/repo", {}, { fetchImpl });
    assert.equal(r.ok, true);
    assert.equal(r.issues.length, 1);
    assert.equal(r.issues[0].title, "bug");
    assert.deepEqual(r.issues[0].labels, ["bug"]);
  });
  it("issue-create posts the title and returns the new number", async () => {
    let captured = null;
    const fetchImpl = async (url, init) => { captured = { url, body: JSON.parse(init.body) }; return resp({ number: 42, html_url: "u/42" }); };
    const r = await createGitHubIssue(db, "u1", "me/repo", { title: "T", body: "B" }, { fetchImpl });
    assert.equal(r.ok, true);
    assert.equal(r.number, 42);
    assert.match(captured.url, /\/repos\/me\/repo\/issues$/);
    assert.equal(captured.body.title, "T");
  });
});

describe("GitHub macros — guards + connect", () => {
  let db, github;
  beforeEach(() => { db = freshDb(); github = buildMacros(registerGithubActions); });
  afterEach(() => { db.close(); });
  const ctx = () => ({ db, actor: { userId: "u1" } });

  it("github.issues with no token returns no_token", async () => {
    const out = await callMacro(github, "github.issues", ctx(), { repo: "me/repo" });
    assert.equal(out.ok, false);
    assert.equal(out.reason, "no_token");
  });
  it("github.issue-create requires repo + title", async () => {
    const out = await callMacro(github, "github.issue-create", ctx(), { repo: "me/repo" });
    assert.equal(out.ok, false);
    assert.match(out.error, /title/);
  });
  it("github.connect surfaces a real authorize URL", () => {
    const out = callMacro(github, "github.connect", ctx(), {});
    assert.equal(out.ok, true);
    assert.match(out.result.authorizeUrl, /\/api\/oauth\/github\/authorize\?/);
    assert.ok(out.result.scopes.includes("repo"));
  });
});

// ── Notion ─────────────────────────────────────────────────────────────────
describe("Notion helpers (mocked egress)", () => {
  let db;
  beforeEach(() => { db = freshDb(); seedToken(db, "notion"); });
  afterEach(() => { db.close(); });

  it("search extracts a human title from properties", async () => {
    const fetchImpl = async (url, init) => {
      assert.ok(init.headers["Notion-Version"]); // required header
      return resp({ results: [{ id: "p1", object: "page", url: "u", properties: { Name: { type: "title", title: [{ plain_text: "My Page" }] } } }], has_more: false });
    };
    const r = await searchNotion(db, "u1", { query: "My" }, { fetchImpl });
    assert.equal(r.ok, true);
    assert.equal(r.results[0].title, "My Page");
  });
  it("get returns flat page metadata", async () => {
    const fetchImpl = async () => resp({ id: "p1", url: "u", archived: false, last_edited_time: "t", properties: {} });
    const r = await readNotionPage(db, "u1", "p1", { fetchImpl });
    assert.equal(r.ok, true);
    assert.equal(r.page.id, "p1");
  });
  it("append PATCHes a paragraph block child", async () => {
    let captured = null;
    const fetchImpl = async (url, init) => { captured = { url, method: init.method, body: JSON.parse(init.body) }; return resp({ results: [{ id: "b1" }] }); };
    const r = await appendNotionBlock(db, "u1", "p1", "a note", { fetchImpl });
    assert.equal(r.ok, true);
    assert.equal(r.appended, 1);
    assert.equal(captured.method, "PATCH");
    assert.equal(captured.body.children[0].paragraph.rich_text[0].text.content, "a note");
  });
});

describe("Notion macros — guards + connect", () => {
  let db, notion;
  beforeEach(() => { db = freshDb(); notion = buildMacros(registerNotionActions); });
  afterEach(() => { db.close(); });
  const ctx = () => ({ db, actor: { userId: "u1" } });

  it("notion.search with no token returns no_token", async () => {
    const out = await callMacro(notion, "notion.search", ctx(), { query: "x" });
    assert.equal(out.ok, false);
    assert.equal(out.reason, "no_token");
  });
  it("notion.append requires text", async () => {
    const out = await callMacro(notion, "notion.append", ctx(), { blockId: "b1" });
    assert.equal(out.ok, false);
    assert.match(out.error, /text/);
  });
  it("notion.connect surfaces a real authorize URL", () => {
    const out = callMacro(notion, "notion.connect", ctx(), {});
    assert.equal(out.ok, true);
    assert.match(out.result.authorizeUrl, /\/api\/oauth\/notion\/authorize\?/);
  });
});

// ── OAuth provider registry (build-time wiring) ──────────────────────────────
describe("connector-oauth provider registry", () => {
  it("registers github + notion providers and token keys", () => {
    assert.ok(PROVIDERS.github, "github provider");
    assert.ok(PROVIDERS.notion, "notion provider");
    assert.equal(CONNECTOR_TOKEN_KEY.notion, "notion");
    // Notion uses the non-standard Basic-auth token exchange.
    assert.equal(typeof PROVIDERS.notion.buildTokenRequest, "function");
    const spec = PROVIDERS.notion.buildTokenRequest({ code: "c", redirectUri: "r", clientId: "id", clientSecret: "sec" });
    assert.match(spec.headers.Authorization, /^Basic /);
  });
});
