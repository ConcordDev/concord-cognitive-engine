// server/lib/podcast-transcript.js
//
// Real transcript timings for podcast episodes. The Transcript Page lights up
// the passage being spoken, so the times it uses must be real: parsed from a
// WebVTT or SRT caption file (what Descript, Riverside, Adobe Podcast and
// Apple export) or from a feed's Podcasting 2.0 JSON transcript. Plain text
// has no timings; it is stored as untimed and never given made-up ones.

const MAX_SEGMENTS = 5000;
const MAX_TEXT = 1000;

/** "01:02:03.450", "02:03,450", "63.45" → seconds (float) or null. */
export function parseTimestamp(raw) {
  const s = String(raw ?? "").trim().replace(",", ".");
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const m = s.match(/^(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?$/);
  if (!m) return null;
  const [, h, mi, se, frac] = m;
  if (Number(mi) > 59 || Number(se) > 59) return null;
  const ms = frac ? Number(frac.padEnd(3, "0")) / 1000 : 0;
  return Number(h || 0) * 3600 + Number(mi) * 60 + Number(se) + ms;
}

const tidy = (text) => String(text)
  .replace(/<\/?[^>]{0,80}>/g, "")           // cue tags: <v Speaker>, <i>, <c.x>
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'")
  .replace(/[\u0000-\u001f\u007f]/g, " ")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, MAX_TEXT);

/** "<v Ada Lovelace>Hello" → "Ada Lovelace" */
const voiceOf = (raw) => {
  const m = String(raw).match(/<v(?:\.[^\s>]+)?\s+([^>]{1,80})>/);
  return m ? m[1].trim() : null;
};

function finish(cues) {
  const out = [];
  for (const c of cues) {
    if (c.startSec == null || !c.text) continue;
    const startSec = Math.round(c.startSec * 100) / 100;
    let endSec = c.endSec == null ? null : Math.round(c.endSec * 100) / 100;
    if (endSec != null && endSec <= startSec) endSec = null;
    out.push({ startSec, endSec, text: c.text, ...(c.speaker ? { speaker: c.speaker } : {}) });
    if (out.length >= MAX_SEGMENTS) break;
  }
  out.sort((a, b) => a.startSec - b.startSec);
  return out;
}

const ARROW = /^\s*(\S+)\s+-->\s+(\S+)/;

/** WebVTT → [{ startSec, endSec, text, speaker? }] */
export function parseVtt(input) {
  const src = String(input ?? "").replace(/\r\n?/g, "\n");
  if (!/^﻿?WEBVTT/.test(src)) return { ok: false, error: "not a WebVTT file (it must start with WEBVTT)" };
  const cues = [];
  for (const block of src.split(/\n{2,}/)) {
    const lines = block.split("\n");
    const at = lines.findIndex((l) => ARROW.test(l));
    if (at < 0) continue;
    const [, a, b] = lines[at].match(ARROW);
    const body = lines.slice(at + 1).join(" ");
    cues.push({ startSec: parseTimestamp(a), endSec: parseTimestamp(b), text: tidy(body), speaker: voiceOf(body) });
  }
  const segments = finish(cues);
  return segments.length ? { ok: true, segments } : { ok: false, error: "the WebVTT file has no timed cues" };
}

/** SRT → [{ startSec, endSec, text }] */
export function parseSrt(input) {
  const src = String(input ?? "").replace(/\r\n?/g, "\n").replace(/^﻿/, "");
  const cues = [];
  for (const block of src.split(/\n{2,}/)) {
    const lines = block.split("\n").filter((l) => l.trim() !== "");
    const at = lines.findIndex((l) => ARROW.test(l));
    if (at < 0) continue;
    const [, a, b] = lines[at].match(ARROW);
    cues.push({ startSec: parseTimestamp(a), endSec: parseTimestamp(b), text: tidy(lines.slice(at + 1).join(" ")) });
  }
  const segments = finish(cues);
  return segments.length ? { ok: true, segments } : { ok: false, error: "the SRT file has no timed cues" };
}

/** Podcasting 2.0 JSON transcript ({ segments:[{ startTime, endTime, body, speaker }] }). */
export function parsePodcastJson(input) {
  let doc = input;
  if (typeof input === "string") { try { doc = JSON.parse(input); } catch { return { ok: false, error: "the JSON transcript could not be read" }; } }
  const list = Array.isArray(doc?.segments) ? doc.segments : null;
  if (!list) return { ok: false, error: "the JSON transcript has no segments" };
  const cues = list.map((x) => ({
    startSec: Number.isFinite(Number(x?.startTime)) && Number(x.startTime) >= 0 ? Number(x.startTime) : null,
    endSec: Number.isFinite(Number(x?.endTime)) ? Number(x.endTime) : null,
    text: tidy(x?.body ?? ""),
    speaker: x?.speaker ? tidy(x.speaker).slice(0, 80) : null,
  }));
  // Podcasting 2.0 JSON is often word-by-word: join words into sentences so
  // the page reads as prose, keeping the first word's start and last word's end.
  const merged = [];
  for (const c of finish(cues)) {
    const last = merged[merged.length - 1];
    const sameVoice = last && (last.speaker || null) === (c.speaker || null);
    if (last && sameVoice && !/[.!?]["')\]]?$/.test(last.text) && last.text.length < 400) {
      last.text = `${last.text} ${c.text}`;
      last.endSec = c.endSec ?? last.endSec;
    } else merged.push({ ...c });
  }
  return merged.length ? { ok: true, segments: merged } : { ok: false, error: "the JSON transcript has no timed segments" };
}

/** Plain text → untimed paragraphs. Never invents times. */
export function parsePlain(input) {
  const text = String(input ?? "").replace(/\r\n?/g, "\n").trim();
  if (!text) return { ok: false, error: "transcript text is empty" };
  const paras = text.split(/\n{2,}|(?<=[.!?])\s+(?=[A-Z0-9“"(])/).map(tidy).filter(Boolean);
  const segments = paras.slice(0, MAX_SEGMENTS).map((t) => ({ startSec: null, endSec: null, text: t }));
  return { ok: true, segments };
}

/** Pick a parser from an explicit format or a feed's MIME type. */
export function parseTranscript(body, format) {
  const f = String(format || "").toLowerCase();
  if (f === "vtt" || f.includes("vtt")) return { ...parseVtt(body), timing: "timed" };
  if (f === "srt" || f.includes("srt") || f.includes("subrip")) return { ...parseSrt(body), timing: "timed" };
  if (f === "json" || f.includes("json")) return { ...parsePodcastJson(body), timing: "timed" };
  if (f === "text" || f === "plain" || f.includes("text/plain")) return { ...parsePlain(body), timing: "none" };
  return { ok: false, error: `transcript format must be vtt, srt, json or text (got ${f || "nothing"})` };
}

/** Segments → a WebVTT file (for the public feed's podcast:transcript). */
export function toVtt(segments) {
  const fmt = (sec) => {
    const t = Math.max(0, sec);
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60), ms = Math.round((t - Math.floor(t)) * 1000);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(Math.min(999, ms)).padStart(3, "0")}`;
  };
  const timed = segments.filter((x) => Number.isFinite(x.startSec));
  const lines = ["WEBVTT", ""];
  timed.forEach((x, i) => {
    const end = Number.isFinite(x.endSec) ? x.endSec : (timed[i + 1]?.startSec ?? x.startSec + 5);
    const text = String(x.text).replace(/-->/g, "→");
    lines.push(`${fmt(x.startSec)} --> ${fmt(Math.max(end, x.startSec + 0.5))}`, x.speaker ? `<v ${x.speaker}>${text}` : text, "");
  });
  return lines.join("\n");
}
