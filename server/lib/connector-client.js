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
import { getValidAccessToken, refreshGoogleToken } from "./connector-tokens.js";

/**
 * Authenticated, SSRF-guarded fetch on behalf of a user's connector.
 * @returns {Promise<{ok:true, status:number, data:any} | {ok:false, reason:string, ...}>}
 */
export async function connectorFetch(db, userId, connectorId, url, init = {}, opts = {}) {
  const tok = await getValidAccessToken(db, userId, connectorId, opts);
  if (!tok.ok) return tok; // { ok:false, reason }

  const check = await validateSafeFetchUrl(url);
  if (!check.ok) return { ok: false, reason: "blocked_url", detail: check.error };

  const doFetch = (accessToken) =>
    fetchWithPinnedIp(check, {
      ...init,
      headers: {
        Authorization: `${tok.tokenType || "Bearer"} ${accessToken}`,
        Accept: "application/json",
        ...(init.headers || {}),
      },
    });

  let res;
  try {
    res = await doFetch(tok.accessToken);
  } catch (e) {
    return { ok: false, reason: "request_failed", detail: String(e?.message || e) };
  }

  // One forced-refresh retry on auth failure (token revoked / clock skew).
  if (res.status === 401) {
    const refreshed = await refreshGoogleToken(db, userId, connectorId, opts);
    if (refreshed.ok) {
      try {
        res = await doFetch(refreshed.token.access_token);
      } catch (e) {
        return { ok: false, reason: "request_failed", detail: String(e?.message || e) };
      }
    }
  }

  const data = await safeJson(res);
  if (!res.ok) return { ok: false, reason: "provider_error", status: res.status, data };
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
