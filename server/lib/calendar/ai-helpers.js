// server/lib/calendar/ai-helpers.js
//
// Shared primitives for the Calendar AI macros. Mirrors
// lib/docs/ai-compose.js + lib/tasks/ai-helpers.js shape so the
// pattern stays consistent across all three lenses.

const TIMEOUT_MS_DEFAULT = 18_000;

export function withTimeout(p, ms = TIMEOUT_MS_DEFAULT) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout_${ms}ms`)), ms))]);
}

export function stripFences(s) {
  const m = String(s || "").match(/```(?:\w+)?\n([\s\S]*?)```/);
  return m ? m[1] : s;
}

export function extractJsonObject(raw) {
  const stripped = stripFences(raw).trim();
  try { const v = JSON.parse(stripped); if (v && typeof v === "object") return v; } catch { /* try */ }
  const m = stripped.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { return null; } }
  return null;
}

export function extractJsonArray(raw) {
  const stripped = stripFences(raw).trim();
  try { const v = JSON.parse(stripped); if (Array.isArray(v)) return v; } catch { /* try */ }
  const m = stripped.match(/\[[\s\S]*\]/);
  if (m) { try { const v = JSON.parse(m[0]); if (Array.isArray(v)) return v; } catch { return null; } }
  return null;
}

export function recordAiRun(db, {
  eventId = null, userId, kind, prompt = null, inputText = null,
  outputText, source = "llm", latencyMs = null,
}) {
  if (!db || !userId || !kind) return null;
  try {
    const r = db.prepare(`
      INSERT INTO calendar_ai_runs (event_id, user_id, kind, prompt, input_text, output_text, source, latency_ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
    `).run(eventId, userId, kind,
      prompt ? String(prompt).slice(0, 2000) : null,
      inputText ? String(inputText).slice(0, 6000) : null,
      String(outputText || "").slice(0, 16000),
      source, latencyMs);
    return r.lastInsertRowid;
  } catch { return null; }
}

/**
 * Deterministic natural-language event parser. Used as the fallback
 * when no LLM is available. Recognises a handful of common patterns:
 *   "lunch with Sarah tomorrow 1pm"
 *   "meeting Tuesday 3pm-4pm"
 *   "review on March 15 at 10am for 30 minutes"
 *
 * Returns a partial event object; caller fills in defaults.
 */
export function deterministicParseEvent(text, { now = new Date() } = {}) {
  const s = String(text || "").trim();
  if (!s) return null;
  const out = { title: s, allDay: false };
  const lower = s.toLowerCase();

  // Date hints
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let dayOffset = 0;
  if (/\btoday\b/.test(lower)) dayOffset = 0;
  else if (/\btomorrow\b/.test(lower)) dayOffset = 1;
  else if (/\byesterday\b/.test(lower)) dayOffset = -1;
  else {
    const days = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
    for (let i = 0; i < days.length; i++) {
      if (lower.includes(days[i])) {
        const cur = now.getUTCDay();
        let off = i - cur; if (off <= 0) off += 7;
        dayOffset = off; break;
      }
    }
  }
  const date = new Date(todayUtc.getTime() + dayOffset * 86400_000);

  // Time hint: "1pm", "13:00", "3pm-4pm"
  const timeRe = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i;
  let startHour = 9, startMin = 0, endHour = 10, endMin = 0;
  const ranges = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*[-–to]+\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (ranges) {
    const [_, sH, sM = "0", sA, eH, eM = "0", eA] = ranges;
    startHour = parseHour(sH, sA || eA || ""); startMin = parseInt(sM, 10);
    endHour = parseHour(eH, eA || sA || ""); endMin = parseInt(eM, 10);
  } else {
    const m = lower.match(timeRe);
    if (m) {
      startHour = parseHour(m[1], m[3] || "");
      startMin = parseInt(m[2] || "0", 10);
      endHour = startHour + 1;
      endMin = startMin;
    }
  }

  // "for 30 minutes" / "for 2 hours"
  const dur = lower.match(/for\s+(\d{1,3})\s*(minute|min|hour|hr)/i);
  if (dur) {
    const n = parseInt(dur[1], 10);
    const isHour = /hour|hr/.test(dur[2]);
    const totalMin = isHour ? n * 60 : n;
    endHour = startHour + Math.floor((startMin + totalMin) / 60);
    endMin = (startMin + totalMin) % 60;
  }

  // "with Sarah" → attendee guess
  const withMatch = s.match(/\bwith\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
  if (withMatch) out.attendeeName = withMatch[1];

  out.startAt = Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), startHour, startMin, 0) / 1000);
  out.endAt = Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), endHour, endMin, 0) / 1000);
  if (out.endAt <= out.startAt) out.endAt = out.startAt + 3600;
  out.title = s
    .replace(timeRe, "").replace(/\b(today|tomorrow|yesterday|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i, "")
    .replace(/[-–to]+\s*\d{1,2}(?::\d{2})?\s*(am|pm)?/i, "")
    .replace(/for\s+\d{1,3}\s*(minute|min|hour|hr)s?/i, "")
    .replace(/\s+/g, " ").trim() || s;
  return out;
}

function parseHour(h, ampm) {
  let n = parseInt(h, 10);
  const ap = String(ampm || "").toLowerCase();
  if (ap === "pm" && n < 12) n += 12;
  if (ap === "am" && n === 12) n = 0;
  return Math.max(0, Math.min(23, n));
}
