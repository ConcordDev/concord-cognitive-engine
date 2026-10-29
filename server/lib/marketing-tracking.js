// server/lib/marketing-tracking.js
//
// Real email engagement tracking for the marketing lens (Q47/A#8).
//
// How it works: when CONCORD_BASE_URL is configured, marketing's
// email-send builds an HTML body per recipient whose links route
// through this deployment's own /api/marketing/track/click/:sendId
// (302 to the original URL) and which carries a 1×1 open pixel at
// /api/marketing/track/open/:sendId. The beacon handlers (routes/
// marketing-track.js) record first-open / first-click timestamps on
// the per-recipient send record in STATE.marketingLens.emailSends —
// the same records email-list already aggregates into open/click
// rates. Nothing is synthesized: without a base URL there is nowhere
// for beacons to point, tracking stays off, and engagement remains
// null (unknown) exactly as the honest-delivery contract requires.
//
// Click safety: a click beacon redirects ONLY to a URL recorded in
// that send's own link set at send time, so the endpoint cannot be
// used as an open redirector for arbitrary URLs.

const URL_RE = /https?:\/\/[^\s<>"')\]]+/g;

export function trackingBaseUrl(env = process.env) {
  const raw = String(env.CONCORD_BASE_URL || "").trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(raw) ? raw : "";
}

export function extractEmailLinks(blocks) {
  const links = [];
  const seen = new Set();
  for (const b of Array.isArray(blocks) ? blocks : []) {
    const content = String(b?.content || "");
    for (const m of content.matchAll(URL_RE)) {
      const url = m[0].replace(/[.,;:]+$/, "");
      if (!seen.has(url)) { seen.add(url); links.push(url); }
    }
    if (links.length >= 50) break;
  }
  return links;
}

export function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function trackClickUrl(baseUrl, sendId, url) {
  return `${baseUrl}/api/marketing/track/click/${encodeURIComponent(sendId)}?u=${encodeURIComponent(url)}`;
}

function linkify(escapedText, baseUrl, sendId) {
  // The text is already HTML-escaped; URLs survive escaping intact
  // (& in a URL became &amp; — decode for the href match, re-escape).
  return escapedText.replace(URL_RE, (raw) => {
    const url = raw.replace(/&amp;/g, "&");
    const href = baseUrl ? trackClickUrl(baseUrl, sendId, url) : url;
    return `<a href="${escapeHtml(href)}">${raw}</a>`;
  });
}

/**
 * Render an email's blocks to a tracked HTML body. Returns
 * { html, links } — links is the send's redirect allowlist.
 */
export function buildTrackedEmailHtml({ blocks, sendId, baseUrl }) {
  const links = extractEmailLinks(blocks);
  const parts = ['<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;">'];
  for (const b of Array.isArray(blocks) ? blocks : []) {
    const content = String(b?.content || "");
    if (!content && b?.type !== "divider" && b?.type !== "spacer") continue;
    switch (b?.type) {
      case "heading":
        parts.push(`<h2 style="margin:16px 0 8px;">${linkify(escapeHtml(content), baseUrl, sendId)}</h2>`);
        break;
      case "image":
        if (/^https?:\/\//i.test(content.trim())) {
          parts.push(`<img src="${escapeHtml(content.trim())}" alt="" style="max-width:100%;display:block;" />`);
        } else {
          parts.push(`<p style="margin:8px 0;">${linkify(escapeHtml(content), baseUrl, sendId)}</p>`);
        }
        break;
      case "button":
        if (/^https?:\/\/\S+$/i.test(content.trim())) {
          const url = content.trim();
          const href = baseUrl ? trackClickUrl(baseUrl, sendId, url) : url;
          parts.push(`<p style="margin:16px 0;"><a href="${escapeHtml(href)}" style="background:#2563eb;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;">${escapeHtml(url)}</a></p>`);
        } else {
          parts.push(`<p style="margin:16px 0;"><span style="background:#2563eb;color:#fff;padding:10px 18px;border-radius:6px;">${escapeHtml(content)}</span></p>`);
        }
        break;
      case "divider":
        parts.push('<hr style="border:none;border-top:1px solid #ddd;margin:16px 0;" />');
        break;
      case "spacer":
        parts.push('<div style="height:24px;"></div>');
        break;
      default: // text and anything else
        parts.push(`<p style="margin:8px 0;">${linkify(escapeHtml(content), baseUrl, sendId)}</p>`);
    }
  }
  if (baseUrl && sendId) {
    parts.push(`<img src="${escapeHtml(`${baseUrl}/api/marketing/track/open/${encodeURIComponent(sendId)}`)}" width="1" height="1" alt="" style="display:none;" />`);
  }
  parts.push("</div>");
  return { html: parts.join("\n"), links };
}

/** Find a send record by id across all emails in the marketing state. */
export function findSendRecord(state, sendId) {
  const sendsMap = state?.marketingLens?.emailSends;
  if (!(sendsMap instanceof Map) || !sendId) return null;
  for (const sends of sendsMap.values()) {
    if (!Array.isArray(sends)) continue;
    const rec = sends.find((x) => x && x.id === sendId);
    if (rec) return rec;
  }
  return null;
}

/** Record a first open. Returns the record, or null if unknown. */
export function recordEmailOpen(state, sendId, nowIso) {
  const rec = findSendRecord(state, sendId);
  if (!rec) return null;
  if (!rec.opened) { rec.opened = nowIso; rec.openedAt = nowIso; }
  return rec;
}

/**
 * Record a first click and return the URL to redirect to — only when
 * `url` is in the send's recorded link set. Returns null otherwise
 * (unknown send or non-member URL): never an open redirect.
 */
export function recordEmailClick(state, sendId, url, nowIso) {
  const rec = findSendRecord(state, sendId);
  if (!rec) return null;
  const target = String(url || "");
  if (!Array.isArray(rec.links) || !rec.links.includes(target)) return null;
  if (!rec.clicked) { rec.clicked = nowIso; rec.clickedAt = nowIso; }
  return target;
}

/** Aggregate engagement counts over an email's send records. */
export function engagementCounts(sends) {
  const list = Array.isArray(sends) ? sends : [];
  return {
    sent: list.length,
    opened: list.filter((x) => x.opened).length,
    clicked: list.filter((x) => x.clicked).length,
  };
}
