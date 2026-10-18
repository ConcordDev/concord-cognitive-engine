// server/lib/chat/today.js
//
// "Today" for chat is the user's local day (America/New_York by default), not
// the UTC date. After 8 PM ET the UTC date is already tomorrow; the long-chat
// probe (2026-10-17) got "today, October 18" on the evening of the 17th.

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** Local calendar parts for `now` in `timeZone`. */
export function localDay(now = new Date(), timeZone = "America/New_York") {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "long", hour: "numeric", minute: "2-digit", hour12: true,
  }).formatToParts(now).map((p) => [p.type, p.value]));
  const iso = `${parts.year}-${parts.month}-${parts.day}`;
  const long = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(now);
  return { iso, long, weekday: String(parts.weekday).toLowerCase(), time: `${parts.hour}:${parts.minute} ${parts.dayPeriod}`, timeZone };
}

/** One system line the chat models get every turn. */
export function todayLine(now = new Date(), timeZone = "America/New_York") {
  const d = localDay(now, timeZone);
  return `Today is ${d.long} (${timeZone}); local time ${d.time}. Use this date for "today", "tonight", "tomorrow" and weekday names; never the UTC date.`;
}

/** Deterministic reply for "what's today's date / what time is it". */
export function timeReply(now = new Date(), timeZone = "America/New_York") {
  const d = localDay(now, timeZone);
  return `It's ${d.long}, ${d.time} (${timeZone}).`;
}

function addDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** "call mom sunday" → the next Sunday in the user's zone (today if it is Sunday). null when no date is named. */
export function resolveDueDate(text, now = new Date(), timeZone = "America/New_York") {
  const t = String(text || "").toLowerCase();
  const today = localDay(now, timeZone);
  const iso = t.match(/\b(20\d\d)-(\d\d)-(\d\d)\b/);
  if (iso) return iso[0];
  if (/\b(?:today|tonight)\b/.test(t)) return today.iso;
  if (/\btomorrow\b/.test(t)) return addDays(today.iso, 1);
  const wd = t.match(/\b(?:(next)\s+)?(sun|mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?)(?:day)?\b/);
  if (wd) {
    const target = WEEKDAYS.findIndex((w) => w.startsWith(wd[2].slice(0, 3)));
    let delta = (target - WEEKDAYS.indexOf(today.weekday) + 7) % 7;
    if (wd[1] && delta === 0) delta = 7;
    return addDays(today.iso, delta);
  }
  const yr = Number(today.iso.slice(0, 4));
  const pick = (m, d) => {
    if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
    let out = `${yr}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (out < today.iso) out = `${yr + 1}${out.slice(4)}`;
    return out;
  };
  const md = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/);
  if (md) return pick(MONTHS.findIndex((m) => m.startsWith(md[1].slice(0, 3))) + 1, Number(md[2]));
  const sl = t.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (sl) return pick(Number(sl[1]), Number(sl[2]));
  return null;
}
