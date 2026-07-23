// server/lib/connector-client.js
//
// SSRF-guarded outbound HTTP for real external connectors (Track C). All
// connector egress flows through here: it resolves a valid per-user access
// token (auto-refreshing), validates the URL against the SSRF guard, attaches
// Bearer auth, and retries once after a forced refresh on a 401. This is the
// single chokepoint the Sci-Fi Feasibility Map's "make the marquee connector
// real" item builds on.
//
// Honest failure: when secrets/tokens are absent it returns
// { ok:false, reason:'connector_not_configured' | 'no_token' } — never a faked
// success.

import { validateSafeFetchUrl, fetchWithPinnedIp } from "./ssrf-guard.js";
import { getValidAccessToken, refreshConnectorToken } from "./connector-tokens.js";

/**
 * Authenticated, SSRF-guarded fetch on behalf of a user's connector.
 *
 * Honest structured-failure shape (R1-3 hardening) — never a fabricated
 * success and never a raw unhandled exception:
 *   - `reauth_required` — refresh was attempted and the provider terminally
 *     rejected the refresh token (revoked/expired/password-changed); the dead
 *     token has already been dropped, so the next connector-status read will
 *     honestly show "not connected" until the user re-authorizes.
 *   - `auth_expired`     — the request came back 401 and either there was no
 *     way to refresh (no refresh_token / provider not configured) or a
 *     refreshed token STILL got 401'd. Distinct from reauth_required: retrying
 *     later (e.g. after an operator fixes client secrets) may succeed.
 *   - `service_unavailable` — the provider responded with a 5xx (their
 *     outage, not an auth problem).
 *   - `provider_error`   — any other non-2xx provider response (4xx business
 *     logic, e.g. 404/422/403).
 *   - `request_failed`   — the network call itself threw (DNS/timeout/reset).
 * @returns {Promise<{ok:true, status:number, data:any} | {ok:false, reason:string, ...}>}
 */
export async function connectorFetch(db, userId, connectorId, url, init = {}, opts = {}) {
  const tok = await getValidAccessToken(db, userId, connectorId, opts);
  if (!tok.ok) return tok; // { ok:false, reason }

  // Test/seam injection: when a fetchImpl is supplied the caller owns the
  // transport, so we skip the SSRF guard + pinned-IP fetch (there is no real
  // egress to guard). Production never sets opts.fetchImpl — the guarded path
  // below is always used live. Mirrors the token-endpoint fetchImpl seam.
  const injected = typeof opts.fetchImpl === "function" ? opts.fetchImpl : null;

  let check = null;
  if (!injected) {
    check = await validateSafeFetchUrl(url);
    if (!check.ok) return { ok: false, reason: "blocked_url", detail: check.error };
  }

  const doFetch = (accessToken) => {
    const reqInit = {
      ...init,
      headers: {
        Authorization: `${tok.tokenType || "Bearer"} ${accessToken}`,
        Accept: "application/json",
        ...(init.headers || {}),
      },
    };
    return injected ? injected(url, reqInit) : fetchWithPinnedIp(check, reqInit);
  };

  let res;
  try {
    res = await doFetch(tok.accessToken);
  } catch (e) {
    return { ok: false, reason: "request_failed", detail: String(e?.message || e) };
  }

  // One forced-refresh retry on auth failure (token revoked / clock skew) —
  // never more than one: a refreshed token that still 401s is reported
  // honestly rather than looped on.
  if (res.status === 401) {
    const refreshed = await refreshConnectorToken(db, userId, connectorId, opts);
    if (!refreshed.ok) {
      // Don't fall through to the stale 401 response below labeled as a
      // generic provider_error — surface the SPECIFIC, actionable reason the
      // refresh attempt returned.
      return {
        ok: false,
        reason: refreshed.reason === "reauth_required" ? "reauth_required" : "auth_expired",
        detail: refreshed.detail || refreshed.reason,
      };
    }
    try {
      res = await doFetch(refreshed.token.access_token);
    } catch (e) {
      return { ok: false, reason: "request_failed", detail: String(e?.message || e) };
    }
    if (res.status === 401) {
      // Refreshed successfully but the provider still rejects the new token —
      // an honest, distinct state from "never had a working token at all".
      return { ok: false, reason: "auth_expired", status: 401, detail: "still unauthorized after token refresh" };
    }
  }

  const data = await safeJson(res);
  if (!res.ok) {
    const reason = res.status >= 500 ? "service_unavailable" : "provider_error";
    return { ok: false, reason, status: res.status, data };
  }
  return { ok: true, status: res.status, data };
}

const GCAL_BASE = "https://www.googleapis.com/calendar/v3";

/**
 * Write (create) an event to a user's Google Calendar. The caller is
 * responsible for the direction gate (pull → don't call this). Maps Concord's
 * event shape to the Google Calendar resource.
 */
export async function writeGoogleCalendarEvent(db, userId, event, opts = {}) {
  const calendarId = encodeURIComponent(event.calendarId || "primary");
  const body = {
    summary: event.title || event.summary || "(untitled)",
    description: event.description || undefined,
    location: event.location || undefined,
    start: toGcalTime(event.start, event.allDay),
    end: toGcalTime(event.end || event.start, event.allDay),
  };
  return connectorFetch(
    db,
    userId,
    "google_calendar",
    `${GCAL_BASE}/calendars/${calendarId}/events`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    opts,
  );
}

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1";

/**
 * Send an email through a user's Gmail (real fan-out, connector_id
 * "google_gmail", scope gmail.send). Builds an RFC-822 message and POSTs the
 * base64url `raw` to the Gmail send endpoint. Honest reasons on missing token.
 */
export async function writeGmailMessage(db, userId, mail = {}, opts = {}) {
  const to = mail.to;
  if (!to) return { ok: false, reason: "missing_recipient" };
  const headers = [
    `To: ${to}`,
    mail.from ? `From: ${mail.from}` : null,
    mail.cc ? `Cc: ${mail.cc}` : null,
    `Subject: ${mail.subject || "(no subject)"}`,
    "MIME-Version: 1.0",
    `Content-Type: ${mail.html ? "text/html" : "text/plain"}; charset=UTF-8`,
  ].filter(Boolean);
  const rfc822 = `${headers.join("\r\n")}\r\n\r\n${mail.body || mail.html || ""}`;
  const raw = Buffer.from(rfc822, "utf8")
    .toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return connectorFetch(
    db,
    userId,
    "google_gmail",
    `${GMAIL_BASE}/users/me/messages/send`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ raw }) },
    opts,
  );
}

/**
 * Read (pull) events from a user's Google Calendar (connector_id
 * "google_calendar", scope calendar.readonly or calendar). Expands recurring
 * events (singleEvents) and orders by start. Returns a normalized event shape.
 */
export async function readGoogleCalendarEvents(db, userId, query = {}, opts = {}) {
  const calendarId = encodeURIComponent(query.calendarId || "primary");
  const params = new URLSearchParams({
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: String(Math.min(Math.max(Number(query.maxResults) || 50, 1), 250)),
  });
  if (query.timeMin) params.set("timeMin", new Date(query.timeMin).toISOString());
  if (query.timeMax) params.set("timeMax", new Date(query.timeMax).toISOString());
  if (query.q) params.set("q", String(query.q));
  const res = await connectorFetch(
    db, userId, "google_calendar",
    `${GCAL_BASE}/calendars/${calendarId}/events?${params.toString()}`,
    { method: "GET" }, opts,
  );
  if (!res.ok) return res;
  const events = (res.data?.items || []).map((e) => ({
    id: e.id,
    summary: e.summary || "(untitled)",
    description: e.description || "",
    location: e.location || "",
    status: e.status || null,
    start: e.start?.dateTime || e.start?.date || null,
    end: e.end?.dateTime || e.end?.date || null,
    allDay: !!(e.start?.date && !e.start?.dateTime),
    htmlLink: e.htmlLink || null,
    organizer: e.organizer?.email || null,
    attendees: (e.attendees || []).map((a) => ({ email: a.email, responseStatus: a.responseStatus })),
  }));
  return { ok: true, events, nextPageToken: res.data?.nextPageToken || null };
}

/**
 * List a page of Gmail messages (connector_id "google_gmail", scope
 * gmail.readonly). Gmail's list endpoint returns only {id, threadId}; we
 * hydrate each with a metadata get (in parallel, bounded) so the inbox has
 * From/Subject/Date/snippet/labels without a second client round-trip.
 */
export async function readGmailMessages(db, userId, query = {}, opts = {}) {
  const params = new URLSearchParams();
  params.set("maxResults", String(Math.min(Math.max(Number(query.maxResults) || 20, 1), 50)));
  if (query.q) params.set("q", String(query.q));
  if (query.pageToken) params.set("pageToken", String(query.pageToken));
  const labels = Array.isArray(query.labelIds) ? query.labelIds : query.labelIds ? [query.labelIds] : [];
  for (const l of labels) params.append("labelIds", String(l));
  const list = await connectorFetch(
    db, userId, "google_gmail",
    `${GMAIL_BASE}/users/me/messages?${params.toString()}`,
    { method: "GET" }, opts,
  );
  if (!list.ok) return list;
  const ids = (list.data?.messages || []).map((m) => m.id);
  const hydrated = await Promise.all(
    ids.map((id) => readGmailMessage(db, userId, id, { format: "metadata" }, opts)),
  );
  const messages = hydrated.filter((m) => m.ok).map((m) => m.message);
  return {
    ok: true,
    messages,
    resultSizeEstimate: list.data?.resultSizeEstimate ?? messages.length,
    nextPageToken: list.data?.nextPageToken || null,
  };
}

/**
 * Read a single Gmail message and parse the MIME tree into a clean shape.
 * format "metadata" (headers only, fast — for list rows) or "full" (with body).
 */
export async function readGmailMessage(db, userId, messageId, query = {}, opts = {}) {
  const format = query.format === "metadata" ? "metadata" : "full";
  const params = new URLSearchParams({ format });
  // Gmail requires metadataHeaders to be enumerated when format=metadata.
  if (format === "metadata") {
    for (const h of ["From", "To", "Cc", "Subject", "Date"]) params.append("metadataHeaders", h);
  }
  const res = await connectorFetch(
    db, userId, "google_gmail",
    `${GMAIL_BASE}/users/me/messages/${encodeURIComponent(messageId)}?${params.toString()}`,
    { method: "GET" }, opts,
  );
  if (!res.ok) return res;
  return { ok: true, message: parseGmailMessage(res.data) };
}

/**
 * Modify a message's labels (mark read = remove UNREAD, star = add STARRED,
 * archive = remove INBOX). Thin wrapper over the Gmail modify endpoint.
 */
export async function modifyGmailMessage(db, userId, messageId, mods = {}, opts = {}) {
  const body = {
    addLabelIds: Array.isArray(mods.addLabelIds) ? mods.addLabelIds : [],
    removeLabelIds: Array.isArray(mods.removeLabelIds) ? mods.removeLabelIds : [],
  };
  return connectorFetch(
    db, userId, "google_gmail",
    `${GMAIL_BASE}/users/me/messages/${encodeURIComponent(messageId)}/modify`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, opts,
  );
}

/** Move a message to Trash. */
export async function trashGmailMessage(db, userId, messageId, opts = {}) {
  return connectorFetch(
    db, userId, "google_gmail",
    `${GMAIL_BASE}/users/me/messages/${encodeURIComponent(messageId)}/trash`,
    { method: "POST" }, opts,
  );
}

/** List the user's Gmail labels (system + user) for inbox filter chips. */
export async function listGmailLabels(db, userId, opts = {}) {
  const res = await connectorFetch(
    db, userId, "google_gmail", `${GMAIL_BASE}/users/me/labels`, { method: "GET" }, opts,
  );
  if (!res.ok) return res;
  return { ok: true, labels: (res.data?.labels || []).map((l) => ({ id: l.id, name: l.name, type: l.type })) };
}

// ── Slack (connector_id "slack", Bearer user/bot token) ─────────────────────
// Slack's Web API returns HTTP 200 even on logical failure, with { ok:false,
// error } in the body. connectorFetch sees HTTP 200 as success, so surface the
// body-level failure as an honest connector error rather than a faked success.
const SLACK_BASE = "https://slack.com/api";
function slackBodyOk(res) {
  if (!res.ok) return res; // transport/HTTP/token failure already shaped
  if (res.data && res.data.ok === false) return { ok: false, reason: res.data.error || "slack_error", data: res.data };
  return { ok: true };
}

/** List the workspace's conversations (channels) the token can see. */
export async function listSlackChannels(db, userId, query = {}, opts = {}) {
  const params = new URLSearchParams({
    limit: String(Math.min(Math.max(Number(query.limit) || 100, 1), 200)),
    exclude_archived: "true",
    types: query.types || "public_channel",
  });
  if (query.cursor) params.set("cursor", String(query.cursor));
  const res = await connectorFetch(db, userId, "slack", `${SLACK_BASE}/conversations.list?${params.toString()}`, { method: "GET" }, opts);
  const norm = slackBodyOk(res); if (!norm.ok) return norm;
  const channels = (res.data?.channels || []).map((c) => ({
    id: c.id, name: c.name, isPrivate: !!c.is_private, isMember: !!c.is_member, topic: c.topic?.value || "",
  }));
  return { ok: true, channels, nextCursor: res.data?.response_metadata?.next_cursor || null };
}

/** Read recent messages from a Slack channel. */
export async function readSlackMessages(db, userId, channel, query = {}, opts = {}) {
  if (!channel) return { ok: false, reason: "missing_channel" };
  const params = new URLSearchParams({
    channel: String(channel),
    limit: String(Math.min(Math.max(Number(query.limit) || 50, 1), 200)),
  });
  if (query.cursor) params.set("cursor", String(query.cursor));
  if (query.oldest) params.set("oldest", String(query.oldest));
  const res = await connectorFetch(db, userId, "slack", `${SLACK_BASE}/conversations.history?${params.toString()}`, { method: "GET" }, opts);
  const norm = slackBodyOk(res); if (!norm.ok) return norm;
  const messages = (res.data?.messages || []).map((m) => ({
    ts: m.ts, user: m.user || m.bot_id || null, text: m.text || "", type: m.type || "message",
    threadTs: m.thread_ts || null, replyCount: m.reply_count || 0,
  }));
  return { ok: true, messages, nextCursor: res.data?.response_metadata?.next_cursor || null };
}

/** Post a message to a Slack channel (real two-way write). */
export async function postSlackMessage(db, userId, channel, text, opts = {}) {
  if (!channel) return { ok: false, reason: "missing_channel" };
  if (!text) return { ok: false, reason: "missing_text" };
  const res = await connectorFetch(
    db, userId, "slack", `${SLACK_BASE}/chat.postMessage`,
    { method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify({ channel, text }) },
    opts,
  );
  const norm = slackBodyOk(res); if (!norm.ok) return norm;
  return { ok: true, ts: res.data?.ts || null, channel: res.data?.channel || channel };
}

// ── Google Sheets (connector_id "google_sheets", scope spreadsheets) ────────
const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

/** Read a range of a spreadsheet (values.get). Returns a 2D values array. */
export async function readGoogleSheet(db, userId, spreadsheetId, range = "A1:Z1000", opts = {}) {
  if (!spreadsheetId) return { ok: false, reason: "missing_spreadsheet" };
  const res = await connectorFetch(
    db, userId, "google_sheets",
    `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`,
    { method: "GET" }, opts,
  );
  if (!res.ok) return res;
  return { ok: true, range: res.data?.range || range, values: res.data?.values || [], rowCount: (res.data?.values || []).length };
}

/** Append a row to a spreadsheet (values.append, real two-way write). */
export async function appendGoogleSheetRow(db, userId, spreadsheetId, range, values, opts = {}) {
  if (!spreadsheetId) return { ok: false, reason: "missing_spreadsheet" };
  const row = Array.isArray(values) ? values : [values];
  const params = new URLSearchParams({ valueInputOption: "USER_ENTERED", insertDataOption: "INSERT_ROWS" });
  const res = await connectorFetch(
    db, userId, "google_sheets",
    `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range || "A1")}:append?${params.toString()}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values: [row] }) }, opts,
  );
  if (!res.ok) return res;
  return { ok: true, updatedRange: res.data?.updates?.updatedRange || null, updatedRows: res.data?.updates?.updatedRows || 0 };
}

// ── GitHub (connector_id "github", Bearer token, no expiry) ─────────────────
const GITHUB_BASE = "https://api.github.com";
// GitHub requires a User-Agent and prefers its versioned vendor Accept type.
const GITHUB_HEADERS = { Accept: "application/vnd.github+json", "User-Agent": "concord-connector", "X-GitHub-Api-Version": "2022-11-28" };

/** List repositories the authenticated user can access. */
export async function listGitHubRepos(db, userId, query = {}, opts = {}) {
  const params = new URLSearchParams({
    per_page: String(Math.min(Math.max(Number(query.perPage) || 30, 1), 100)),
    sort: query.sort || "updated",
  });
  if (query.page) params.set("page", String(query.page));
  const res = await connectorFetch(db, userId, "github", `${GITHUB_BASE}/user/repos?${params.toString()}`, { method: "GET", headers: GITHUB_HEADERS }, opts);
  if (!res.ok) return res;
  const repos = (res.data || []).map((r) => ({
    id: r.id, fullName: r.full_name, name: r.name, private: !!r.private,
    description: r.description || "", openIssues: r.open_issues_count || 0, url: r.html_url,
  }));
  return { ok: true, repos };
}

/** List issues for a repo ("owner/name"). Filters out PRs (issues endpoint includes them). */
export async function readGitHubIssues(db, userId, repo, query = {}, opts = {}) {
  if (!repo) return { ok: false, reason: "missing_repo" };
  const params = new URLSearchParams({
    state: query.state || "open",
    per_page: String(Math.min(Math.max(Number(query.perPage) || 30, 1), 100)),
  });
  if (query.labels) params.set("labels", String(query.labels));
  const res = await connectorFetch(db, userId, "github", `${GITHUB_BASE}/repos/${repo}/issues?${params.toString()}`, { method: "GET", headers: GITHUB_HEADERS }, opts);
  if (!res.ok) return res;
  const issues = (res.data || []).filter((i) => !i.pull_request).map((i) => ({
    number: i.number, title: i.title, state: i.state, body: i.body || "", author: i.user?.login || null,
    labels: (i.labels || []).map((l) => (typeof l === "string" ? l : l.name)), comments: i.comments || 0, url: i.html_url,
  }));
  return { ok: true, issues };
}

/** Create an issue on a repo (real two-way write). */
export async function createGitHubIssue(db, userId, repo, issue = {}, opts = {}) {
  if (!repo) return { ok: false, reason: "missing_repo" };
  if (!issue.title) return { ok: false, reason: "missing_title" };
  const body = { title: issue.title, body: issue.body || "", ...(Array.isArray(issue.labels) ? { labels: issue.labels } : {}) };
  const res = await connectorFetch(
    db, userId, "github", `${GITHUB_BASE}/repos/${repo}/issues`,
    { method: "POST", headers: { ...GITHUB_HEADERS, "Content-Type": "application/json" }, body: JSON.stringify(body) }, opts,
  );
  if (!res.ok) return res;
  return { ok: true, number: res.data?.number || null, url: res.data?.html_url || null };
}

// GitHub paths can contain slashes (nested directories) but each *segment*
// must be percent-encoded individually — encodeURIComponent on the whole
// path would also escape the slashes, corrupting the route.
function encodeGitHubPath(path) {
  return String(path).split("/").map(encodeURIComponent).join("/");
}

/**
 * List the file tree at a ref (recursive). If `query.ref` is omitted, the
 * repo's real default branch is resolved first via GET /repos/{repo} — never
 * guessed as "main"/"master". Uses the real Git Trees API
 * (GET /repos/{repo}/git/trees/{ref}?recursive=1).
 */
export async function getGitHubRepoTree(db, userId, repo, query = {}, opts = {}) {
  if (!repo) return { ok: false, reason: "missing_repo" };
  let ref = query.ref;
  if (!ref) {
    const repoRes = await connectorFetch(db, userId, "github", `${GITHUB_BASE}/repos/${repo}`, { method: "GET", headers: GITHUB_HEADERS }, opts);
    if (!repoRes.ok) return repoRes;
    ref = repoRes.data?.default_branch;
    if (!ref) return { ok: false, reason: "no_default_branch" };
  }
  const params = new URLSearchParams({ recursive: "1" });
  const res = await connectorFetch(
    db, userId, "github",
    `${GITHUB_BASE}/repos/${repo}/git/trees/${encodeURIComponent(ref)}?${params.toString()}`,
    { method: "GET", headers: GITHUB_HEADERS }, opts,
  );
  if (!res.ok) return res;
  const tree = (res.data?.tree || []).map((t) => ({ path: t.path, type: t.type, sha: t.sha, size: t.size ?? null, mode: t.mode }));
  return { ok: true, ref, sha: res.data?.sha || null, truncated: !!res.data?.truncated, tree };
}

/**
 * Get a single file's real decoded content + its blob `sha` (required by
 * commitGitHubFile to update the same file). Real Contents API
 * (GET /repos/{repo}/contents/{path}[?ref=]). Honest not_a_file when the path
 * resolves to a directory (an array response) rather than a blob; 404s pass
 * through connectorFetch's own honest provider_error/status shape.
 */
export async function getGitHubFileContent(db, userId, repo, path, query = {}, opts = {}) {
  if (!repo) return { ok: false, reason: "missing_repo" };
  if (!path) return { ok: false, reason: "missing_path" };
  const params = new URLSearchParams();
  if (query.ref) params.set("ref", String(query.ref));
  const qs = params.toString();
  const res = await connectorFetch(
    db, userId, "github",
    `${GITHUB_BASE}/repos/${repo}/contents/${encodeGitHubPath(path)}${qs ? `?${qs}` : ""}`,
    { method: "GET", headers: GITHUB_HEADERS }, opts,
  );
  if (!res.ok) return res;
  const data = res.data;
  if (Array.isArray(data) || !data || data.type !== "file") {
    return { ok: false, reason: "not_a_file", detail: "path does not resolve to a single file" };
  }
  let content = "";
  try {
    content = data.encoding === "base64" ? Buffer.from(data.content || "", "base64").toString("utf8") : (data.content || "");
  } catch {
    content = "";
  }
  return { ok: true, path: data.path, sha: data.sha, size: data.size || 0, content, encoding: "utf8", htmlUrl: data.html_url || null };
}

/**
 * Create or update a file (real two-way write) — PUT
 * /repos/{repo}/contents/{path}. `sha` is the CALLER's declared intent:
 * present -> update the existing blob at that sha; absent -> create a new
 * file. We never silently invent or fetch a sha on the caller's behalf (that
 * would risk clobbering a file the caller didn't know existed) — GitHub's own
 * 422 ("sha wasn't supplied") surfaces honestly via connectorFetch's
 * provider_error path if the caller omits sha for a path that already exists.
 * Content is UTF-8 -> base64 encoded per the Contents API's real requirement.
 */
export async function commitGitHubFile(db, userId, repo, path, params = {}, opts = {}) {
  if (!repo) return { ok: false, reason: "missing_repo" };
  if (!path) return { ok: false, reason: "missing_path" };
  if (typeof params.content !== "string") return { ok: false, reason: "missing_content" };
  if (!params.message) return { ok: false, reason: "missing_message" };
  const body = {
    message: params.message,
    content: Buffer.from(params.content, "utf8").toString("base64"),
    ...(params.sha ? { sha: params.sha } : {}),
    ...(params.branch ? { branch: params.branch } : {}),
  };
  const res = await connectorFetch(
    db, userId, "github", `${GITHUB_BASE}/repos/${repo}/contents/${encodeGitHubPath(path)}`,
    { method: "PUT", headers: { ...GITHUB_HEADERS, "Content-Type": "application/json" }, body: JSON.stringify(body) },
    opts,
  );
  if (!res.ok) return res;
  return {
    ok: true,
    commitSha: res.data?.commit?.sha || null,
    fileSha: res.data?.content?.sha || null,
    path: res.data?.content?.path || path,
    htmlUrl: res.data?.content?.html_url || null,
  };
}

/**
 * Create a branch (real Git Refs API — POST /repos/{repo}/git/refs) pointing
 * at `fromRef`'s current tip commit. `fromRef` is resolved to a real commit
 * sha first via GET /repos/{repo}/commits/{ref} (accepts a branch name, tag,
 * or sha uniformly — no assumption about ref shape). Never guesses a sha.
 */
export async function createGitHubBranch(db, userId, repo, params = {}, opts = {}) {
  if (!repo) return { ok: false, reason: "missing_repo" };
  if (!params.branchName) return { ok: false, reason: "missing_branch_name" };
  if (!params.fromRef) return { ok: false, reason: "missing_from_ref" };
  const commitRes = await connectorFetch(
    db, userId, "github", `${GITHUB_BASE}/repos/${repo}/commits/${encodeURIComponent(params.fromRef)}`,
    { method: "GET", headers: GITHUB_HEADERS }, opts,
  );
  if (!commitRes.ok) return commitRes;
  const baseSha = commitRes.data?.sha;
  if (!baseSha) return { ok: false, reason: "ref_resolution_failed" };
  const res = await connectorFetch(
    db, userId, "github", `${GITHUB_BASE}/repos/${repo}/git/refs`,
    { method: "POST", headers: { ...GITHUB_HEADERS, "Content-Type": "application/json" }, body: JSON.stringify({ ref: `refs/heads/${params.branchName}`, sha: baseSha }) },
    opts,
  );
  if (!res.ok) return res;
  return { ok: true, ref: res.data?.ref || `refs/heads/${params.branchName}`, sha: res.data?.object?.sha || baseSha };
}

// GitHub's commit-status API only accepts these four literal state values —
// reject anything else BEFORE any network call rather than letting an
// unrecognized value reach GitHub as an ad-hoc string.
const GITHUB_STATUS_STATES = new Set(["success", "failure", "pending", "error"]);

/**
 * Post a commit status (real two-way write) — POST
 * /repos/{repo}/statuses/{sha}. Used by CI-gate style callers (e.g.
 * dx-platform.postCommitStatus) to reflect a genuine pass/fail verdict on a
 * PR's head commit. Same shape as createGitHubIssue above: SSRF-guarded,
 * per-user-OAuth, honest failure reasons — never a faked "posted" success.
 */
export async function writeGitHubCommitStatus(db, userId, repo, sha, state, opts = {}) {
  if (!repo) return { ok: false, reason: "missing_repo" };
  if (!sha) return { ok: false, reason: "missing_sha" };
  if (!GITHUB_STATUS_STATES.has(state)) return { ok: false, reason: "invalid_state" };
  const body = {
    state,
    context: opts.context ? String(opts.context) : "concord/dx-detectors",
    ...(opts.description ? { description: String(opts.description).slice(0, 140) } : {}),
    ...(opts.targetUrl ? { target_url: String(opts.targetUrl) } : {}),
  };
  const res = await connectorFetch(
    db, userId, "github", `${GITHUB_BASE}/repos/${repo}/statuses/${encodeURIComponent(sha)}`,
    { method: "POST", headers: { ...GITHUB_HEADERS, "Content-Type": "application/json" }, body: JSON.stringify(body) },
    opts,
  );
  if (!res.ok) return res;
  return {
    ok: true,
    id: res.data?.id || null,
    state: res.data?.state || state,
    url: res.data?.url || null,
    targetUrl: res.data?.target_url || null,
  };
}

// ── Notion (connector_id "notion", Bearer token, Notion-Version header) ─────
// @env-config-ok — Notion's fixed, vendor-published public API base, not
// deployment-specific config (same shape as the GitHub/Slack API bases
// elsewhere in this file).
const NOTION_BASE = "https://api.notion.com/v1";
const NOTION_HEADERS = { "Notion-Version": "2022-06-28" };

/** Search pages/databases the integration can see. */
export async function searchNotion(db, userId, query = {}, opts = {}) {
  const body = { page_size: Math.min(Math.max(Number(query.pageSize) || 25, 1), 100) };
  if (query.query) body.query = String(query.query);
  if (query.filter) body.filter = query.filter; // e.g. { property:'object', value:'page' }
  const res = await connectorFetch(
    db, userId, "notion", `${NOTION_BASE}/search`,
    { method: "POST", headers: { ...NOTION_HEADERS, "Content-Type": "application/json" }, body: JSON.stringify(body) }, opts,
  );
  if (!res.ok) return res;
  const results = (res.data?.results || []).map((r) => ({
    id: r.id, object: r.object, url: r.url || null, title: notionTitle(r),
    createdTime: r.created_time || null, lastEditedTime: r.last_edited_time || null,
  }));
  return { ok: true, results, nextCursor: res.data?.next_cursor || null, hasMore: !!res.data?.has_more };
}

/** Read a single Notion page's metadata. */
export async function readNotionPage(db, userId, pageId, opts = {}) {
  if (!pageId) return { ok: false, reason: "missing_page" };
  const res = await connectorFetch(db, userId, "notion", `${NOTION_BASE}/pages/${encodeURIComponent(pageId)}`, { method: "GET", headers: NOTION_HEADERS }, opts);
  if (!res.ok) return res;
  return { ok: true, page: { id: res.data?.id, url: res.data?.url || null, title: notionTitle(res.data), archived: !!res.data?.archived, lastEditedTime: res.data?.last_edited_time || null } };
}

/** Append a paragraph block to a page/block (real two-way write). */
export async function appendNotionBlock(db, userId, blockId, text, opts = {}) {
  if (!blockId) return { ok: false, reason: "missing_block" };
  if (!text) return { ok: false, reason: "missing_text" };
  const children = [{ object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: String(text) } }] } }];
  const res = await connectorFetch(
    db, userId, "notion", `${NOTION_BASE}/blocks/${encodeURIComponent(blockId)}/children`,
    { method: "PATCH", headers: { ...NOTION_HEADERS, "Content-Type": "application/json" }, body: JSON.stringify({ children }) }, opts,
  );
  if (!res.ok) return res;
  return { ok: true, appended: (res.data?.results || []).length, blockId };
}

/** Extract a human title from a Notion page/search result (best-effort). */
function notionTitle(r) {
  try {
    const props = r?.properties || {};
    for (const v of Object.values(props)) {
      if (v?.type === "title" && Array.isArray(v.title)) {
        return v.title.map((t) => t.plain_text || t.text?.content || "").join("") || "(untitled)";
      }
    }
    if (Array.isArray(r?.title)) return r.title.map((t) => t.plain_text || "").join("") || "(untitled)";
  } catch { /* ignore */ }
  return "(untitled)";
}

/** Normalize a Gmail API message resource into a flat, render-ready shape. */
export function parseGmailMessage(raw = {}) {
  const headers = {};
  for (const h of raw.payload?.headers || []) {
    if (h?.name) headers[h.name.toLowerCase()] = h.value;
  }
  const { text, html } = extractGmailBody(raw.payload);
  const labelIds = raw.labelIds || [];
  return {
    id: raw.id,
    threadId: raw.threadId,
    snippet: raw.snippet || "",
    labelIds,
    unread: labelIds.includes("UNREAD"),
    starred: labelIds.includes("STARRED"),
    from: headers.from || "",
    to: headers.to || "",
    cc: headers.cc || "",
    subject: headers.subject || "(no subject)",
    date: headers.date || "",
    internalDate: raw.internalDate ? Number(raw.internalDate) : null,
    text,
    html,
  };
}

/** Walk the MIME tree, base64url-decoding the first text/plain + text/html. */
function extractGmailBody(payload) {
  let text = "";
  let html = "";
  const walk = (part) => {
    if (!part) return;
    const mime = part.mimeType || "";
    if (part.body?.data) {
      const decoded = b64urlDecode(part.body.data);
      if (mime === "text/plain" && !text) text = decoded;
      else if (mime === "text/html" && !html) html = decoded;
    }
    for (const p of part.parts || []) walk(p);
  };
  walk(payload);
  return { text, html };
}

function b64urlDecode(data) {
  try {
    return Buffer.from(String(data).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  } catch {
    return "";
  }
}

function toGcalTime(value, allDay) {
  if (!value) return undefined;
  if (allDay) return { date: String(value).slice(0, 10) };
  const d = value instanceof Date ? value : new Date(value);
  return { dateTime: isNaN(d.getTime()) ? String(value) : d.toISOString() };
}

async function safeJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
