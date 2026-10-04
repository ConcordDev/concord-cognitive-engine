// server/lib/social-publish.js
//
// Real publishing for the thread lens on the two platforms whose APIs a
// user can authorize with a personal credential — no platform app review:
//   - Bluesky (AT Protocol): handle + app password → session → one
//     app.bsky.feed.post per part, each replying to the previous (a thread).
//   - Mastodon: instance + personal access token → POST /api/v1/statuses,
//     each status in_reply_to the previous.
// Credentials are verified live before an account counts as connected and
// are stored encrypted per user (connector_oauth_tokens). All egress goes
// through the SSRF guard. Nothing is ever reported as posted unless the
// platform returned the created post.

import { validateSafeFetchUrl, fetchWithPinnedIp } from "./ssrf-guard.js";
import { persistConnectorToken, getConnectorToken, deleteConnectorToken } from "./connector-tokens.js";

// Test-only transport seam (never set in production; not reachable from a request).
let testFetch = null;
export function _setSocialFetchForTest(fn) { testFetch = typeof fn === "function" ? fn : null; }

async function jsonFetch(url, init = {}, opts = {}) {
  try {
    let res;
    const injected = typeof opts.fetchImpl === "function" ? opts.fetchImpl : testFetch;
    if (injected) {
      res = await injected(url, init);
    } else {
      const check = await validateSafeFetchUrl(url, { allowHttp: false });
      if (!check.ok) return { ok: false, reason: "blocked_url", detail: check.error };
      res = await fetchWithPinnedIp(check, init);
    }
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok) return { ok: false, reason: data?.error || data?.message || `http_${res.status}`, status: res.status, data };
    return { ok: true, status: res.status, data };
  } catch (e) {
    return { ok: false, reason: "request_failed", detail: String(e?.message || e) };
  }
}

const json = (method, body, headers = {}) => ({
  method,
  headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
  body: JSON.stringify(body),
});

function normalizeService(raw, fallback) {
  const s = String(raw || fallback || "").trim().replace(/\/+$/, "");
  if (!s) return null;
  return /^https?:\/\//i.test(s) ? s.replace(/^http:/i, "https:") : `https://${s}`;
}

// ── Bluesky ─────────────────────────────────────────────────────────────

export const blueskyConnectorId = (did) => `bluesky:${did}`;

async function blueskySession(service, identifier, password, opts) {
  return jsonFetch(`${service}/xrpc/com.atproto.server.createSession`, json("POST", { identifier, password }), opts);
}

/** Verify a handle + app password; store the password encrypted on success. */
export async function connectBluesky(db, userId, { handle, appPassword, service } = {}, opts = {}) {
  const svc = normalizeService(service, "https://bsky.social");
  const identifier = String(handle || "").trim().replace(/^@/, "");
  const password = String(appPassword || "").trim();
  if (!identifier || !password) return { ok: false, reason: "handle_and_app_password_required" };
  const sess = await blueskySession(svc, identifier, password, opts);
  if (!sess.ok) return { ok: false, reason: sess.status === 401 ? "invalid_credentials" : sess.reason };
  const did = sess.data?.did;
  if (!did) return { ok: false, reason: "no_did_returned" };
  persistConnectorToken(db, userId, blueskyConnectorId(did), { access_token: password, scope: svc });
  return { ok: true, account: { did, handle: sess.data.handle || identifier, service: svc } };
}

export async function publishBluesky(db, userId, { did, service }, parts, opts = {}) {
  const tok = getConnectorToken(db, userId, blueskyConnectorId(did));
  if (!tok) return { ok: false, reason: "not_connected", posted: [] };
  const svc = normalizeService(service || tok.scopes?.[0], "https://bsky.social");
  const sess = await blueskySession(svc, did, tok.access_token, opts);
  if (!sess.ok) return { ok: false, reason: sess.status === 401 ? "credentials_revoked" : sess.reason, posted: [] };
  const auth = { Authorization: `Bearer ${sess.data.accessJwt}` };
  const handle = sess.data.handle || did;
  const posted = [];
  let root = null;
  let parent = null;
  for (const text of parts) {
    const record = { $type: "app.bsky.feed.post", text, createdAt: new Date().toISOString(), ...(parent ? { reply: { root, parent } } : {}) };
    const r = await jsonFetch(`${svc}/xrpc/com.atproto.repo.createRecord`, json("POST", { repo: did, collection: "app.bsky.feed.post", record }, auth), opts);
    if (!r.ok || !r.data?.uri) return { ok: false, reason: r.reason || "create_failed", posted };
    const ref = { uri: r.data.uri, cid: r.data.cid };
    if (!root) root = ref;
    parent = ref;
    const rkey = String(r.data.uri).split("/").pop();
    posted.push({ uri: r.data.uri, cid: r.data.cid, url: `https://bsky.app/profile/${handle}/post/${rkey}` });
  }
  return { ok: true, posted };
}

/** Real like/repost/reply counts for posts this user published (no impressions on Bluesky). */
export async function blueskyEngagement(uris, opts = {}) {
  const params = new URLSearchParams();
  for (const u of uris.slice(0, 25)) params.append("uris", u);
  const r = await jsonFetch(`https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts?${params}`, { method: "GET", headers: { Accept: "application/json" } }, opts);
  if (!r.ok) return { ok: false, reason: r.reason };
  const byUri = new Map((r.data?.posts || []).map((p) => [p.uri, p]));
  return { ok: true, perPost: uris.map((u, i) => {
    const p = byUri.get(u);
    return { postIndex: i + 1, impressions: null, likes: p?.likeCount ?? 0, reposts: p?.repostCount ?? 0, replies: p?.replyCount ?? 0 };
  }) };
}

// ── Mastodon ────────────────────────────────────────────────────────────

export const mastodonConnectorId = (instanceHost, acct) => `mastodon:${instanceHost}:${acct}`;

export async function connectMastodon(db, userId, { instance, accessToken } = {}, opts = {}) {
  const base = normalizeService(instance);
  const token = String(accessToken || "").trim();
  if (!base || !token) return { ok: false, reason: "instance_and_access_token_required" };
  const r = await jsonFetch(`${base}/api/v1/accounts/verify_credentials`, { method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }, opts);
  if (!r.ok) return { ok: false, reason: r.status === 401 ? "invalid_credentials" : r.reason };
  const host = new URL(base).host;
  const acct = r.data?.acct || r.data?.username;
  if (!acct) return { ok: false, reason: "no_account_returned" };
  persistConnectorToken(db, userId, mastodonConnectorId(host, acct), { access_token: token, scope: base });
  return { ok: true, account: { instance: base, acct, url: r.data?.url || null } };
}

export async function publishMastodon(db, userId, { instance, acct }, parts, opts = {}) {
  const base = normalizeService(instance);
  const host = base ? new URL(base).host : "";
  const tok = getConnectorToken(db, userId, mastodonConnectorId(host, acct));
  if (!tok) return { ok: false, reason: "not_connected", posted: [] };
  const posted = [];
  let replyTo = null;
  for (const text of parts) {
    const r = await jsonFetch(`${base}/api/v1/statuses`, json("POST", { status: text, ...(replyTo ? { in_reply_to_id: replyTo } : {}) }, { Authorization: `Bearer ${tok.access_token}` }), opts);
    if (!r.ok || !r.data?.id) return { ok: false, reason: r.status === 401 ? "credentials_revoked" : (r.reason || "post_failed"), posted };
    replyTo = r.data.id;
    posted.push({ id: r.data.id, url: r.data.url || null });
  }
  return { ok: true, posted };
}

export async function mastodonEngagement(db, userId, { instance, acct }, ids, opts = {}) {
  const base = normalizeService(instance);
  const tok = getConnectorToken(db, userId, mastodonConnectorId(new URL(base).host, acct));
  if (!tok) return { ok: false, reason: "not_connected" };
  const perPost = [];
  for (const [i, id] of ids.entries()) {
    const r = await jsonFetch(`${base}/api/v1/statuses/${encodeURIComponent(id)}`, { method: "GET", headers: { Authorization: `Bearer ${tok.access_token}`, Accept: "application/json" } }, opts);
    if (!r.ok) return { ok: false, reason: r.reason };
    perPost.push({ postIndex: i + 1, impressions: null, likes: r.data?.favourites_count ?? 0, reposts: r.data?.reblogs_count ?? 0, replies: r.data?.replies_count ?? 0 });
  }
  return { ok: true, perPost };
}

export function forgetSocialCredential(db, userId, connectorId) {
  try { return deleteConnectorToken(db, userId, connectorId); } catch { return false; }
}
