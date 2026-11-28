#!/usr/bin/env node
// scripts/walk/ingest.mjs — turn a walk's results into clean builder tickets.
//
//   node scripts/walk/ingest.mjs <walk files or dirs...> \
//     [--existing audit/fix-list/fix_tickets.jsonl] [--triage docs/LENS_REDESIGN_TRIAGE.md] \
//     [--out audit/walk/ingest-YYYY-MM-DD] [--date YYYY-MM-DD]
//
// Reads every JSONL line the walker writes, in the formats already in audit/fix-list/:
//   - ticket rows     { id?, lens, severity, title, repro_steps, expected, actual, evidence_path(s),
//                       evidence, screenshots, evidence_images, suspected_area, root_cause_group?, tester, account, ts }
//   - result records  { lens (or slug), tester, ts, cases: { <case>: "PASS …" | "FAIL …" | "NEEDS_HUMAN …" | … },
//                       result|verdict, tickets: [ids], evidence…, screenshots }
//   - check results   { type: "check_result", id, lens, verdict, why, expect: [...] }  (scripts/walk/run-check.mjs)
// Lines it cannot read are listed, never dropped silently.
//
// Writes into --out:
//   tickets.jsonl        new tickets in the fix_tickets.jsonl shape (status OPEN), ready to append
//   seen-again.jsonl     findings that match an OPEN ticket already in --existing (an occurrence, not a new ticket)
//   reopen.jsonl         findings that match a ticket marked FIXED_PENDING_VERIFY / VERIFIED (the fix did not hold)
//   needs-human.jsonl    cases the walker could not decide, each with a check-spec draft to complete
//   TICKETS.md           the same, grouped by triage wave → lens → root cause, with evidence
//   unreadable.jsonl     lines that were not JSON or had no lens
//
// Grouping and folding (each decision is recorded on the ticket, so a builder can see why):
//   - duplicates fold when the lens matches and the normalised title + actual are the same, or
//     their word overlap (Jaccard) is ≥ 0.6; the fold keeps every occurrence with its evidence;
//   - root cause: the walker's own root_cause_group, else a named rule from the families the
//     audit already found (escape-focus-trap, mobile clip, export-nothing, contrast, ...), else the
//     nearest already-labelled ticket (Jaccard ≥ 0.45), else "unclassified" — never a guess;
//   - triage wave and family: from docs/LENS_REDESIGN_TRIAGE.md; a lens it does not list is "unassigned".
// Deterministic: the same inputs give the same ids and the same files.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SEVERITY = { high: "high", medium: "medium", low: "low", critical: "high", blocker: "high", major: "medium", minor: "low" };
const DONE_STATES = new Set(["FIXED_PENDING_VERIFY", "VERIFIED", "FIXED"]);
const CLOSED_STATES = new Set(["NOT_REPRODUCED", "RETRACTED", "SUPERSEDED", "REVERIFIED_OK", "WONTFIX", "CLOSED"]);

// Root-cause families the November audit found, by what a tester writes. Order matters: first match wins.
export const RULES = [
  ["RCA-escape-focus-trap", /\b(esc(ape)?\b.*(close|dismiss|leave|focus)|focus (trap|escapes|leaves|lost)|no focus trap|tab(s|bing)? (out|behind|past) (the )?(dialog|modal|drawer))/i],
  ["RCA-form-hotkey-steal", /\b(hotkey|shortcut|key ?binding)s?\b.*\b(typing|input|field|text ?box)|typing .{0,30}(trigger|fires|opens|steals)/i],
  ["RCA-export-nothing", /\b(export|download)\w*\b.{0,40}\b(nothing|no (file|download)|did not download|empty file|0 bytes)/i],
  ["RCA-contrast-theme-tokens", /\bcontrast\b|\b\d(\.\d+)?\s*:\s*1\b|illegible|unreadable|hard to read/i],
  ["RCA-mobile-clip-fab", /\b(390|mobile|phone|narrow)\b.{0,80}\b(clip|cut off|overflow|horizontal scroll|off.?screen|overlap|hidden behind|covers?)\b|\b(fab|floating button)\b.{0,40}\b(covers?|overlap|blocks?)/i],
  ["RCA-missing-delete-confirm", /\bdelet\w*\b.{0,40}\b(no|without) (a )?confirm/i],
  ["RCA-missing-delete-control", /\b(no|missing|cannot|can't|unable to)\b.{0,20}\bdelet/i],
  ["RCA-ask-silent", /\b(ask|agent|assistant|ai|kay|tutor)\b.{0,40}\b(no (output|reply|response|answer)|silent|nothing (happens|came back)|spins? forever)/i],
  ["persistence-corruption", /\b(not (persist|saved)|reload (restores|loses|reverts)|lost (on|after) (reload|refresh)|did not persist)/i],
];

// The walker's own check names → the root-cause families they test for.
export const CHECK_GROUPS = {
  escape: "RCA-escape-focus-trap", fab_overlap: "RCA-mobile-clip-fab", contrast: "RCA-contrast-theme-tokens",
  export: "RCA-export-nothing", export_nothing: "RCA-export-nothing", overflow: "RCA-mobile-clip-fab",
  http: "RCA-server-error-on-load", hotkey: "RCA-form-hotkey-steal",
};

// Reviewed walker false positives: findings that match go to the walker-review list (with every
// lens and its evidence), never to tickets and never dropped. Each entry says why, with the code.
export const KNOWN_WALKER_FALSE_POSITIVES = [
  {
    id: "sidebar-disclosure-escape", check: "escape", element: /^(Expand|Collapse) .+ sub-lenses$/i,
    why: "The control is the shared left bar's inline expand/collapse toggle (components/shell/Sidebar.tsx: a button with aria-expanded that shows a nested list), not an overlay. A disclosure has no Escape behaviour in WAI-ARIA, so Escape leaving it open is correct. Fix the walker's escape check to skip aria-expanded disclosures that do not open a dialog, menu or popover.",
  },
];

const STOP = new Set("a an the is are was were be to of in on at for and or but with without not no it its this that as by from into after before when then than so does did do".split(" "));
export function words(s) {
  return String(s || "").toLowerCase().replace(/https?:\/\/\S+/g, " ").replace(/[0-9]+/g, " ").replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
}
/** How much of the short text a is inside b (a walker's terse case note against a written-up ticket). */
const containment = (a, b) => { const A = new Set(a), B = new Set(b); if (A.size < 2) return { c: 0, n: 0 }; let n = 0; for (const x of A) if (B.has(x)) n++; return { c: n / A.size, n }; };
const jaccard = (a, b) => { const A = new Set(a), B = new Set(b); if (!A.size || !B.size) return 0; let n = 0; for (const x of A) if (B.has(x)) n++; return n / (A.size + B.size - n); };
const sig = (t) => words(`${t.title} ${t.actual}`).join(" ");
const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

export function readJsonl(file) {
  const rows = [], bad = [];
  const text = fs.readFileSync(file, "utf8");
  text.split("\n").forEach((line, i) => {
    if (!line.trim()) return;
    try {
      const v = JSON.parse(line);
      if (!v || typeof v !== "object" || Array.isArray(v)) { bad.push({ src: `${file}:${i + 1}`, reason: "not an object" }); return; }
      // the walker's merged export wraps each line: { _file: "ledger.jsonl", _run, row: {...} }
      if (v.row && typeof v.row === "object" && !Array.isArray(v.row) && typeof v._file === "string") rows.push({ ...v.row, __file: v._file, __run: v._run ?? v.row.run ?? null, __src: `${file}:${i + 1} (${v._file})` });
      else rows.push({ ...v, __src: `${file}:${i + 1}` });
    }
    catch (e) { bad.push({ src: `${file}:${i + 1}`, reason: `not JSON: ${e.message}`, line: line.slice(0, 200) }); }
  });
  return { rows, bad };
}
function filesOf(inputs) {
  const out = [];
  for (const p of inputs) {
    const st = fs.statSync(p);
    if (st.isDirectory()) for (const f of fs.readdirSync(p).sort()) { if (f.endsWith(".jsonl")) out.push(path.join(p, f)); }
    else out.push(p);
  }
  return out;
}

/** Existing ticket log: later lines override earlier fields for the same id (the fix-list rule). */
export function mergeTicketLog(rows) {
  const byId = new Map();
  for (const r of rows) { if (!r.id) continue; byId.set(r.id, { ...(byId.get(r.id) || {}), ...r }); }
  return byId;
}

/** Lens → { wave, order, family } from the triage doc's wave tables and lists. */
export function parseTriage(md) {
  const map = new Map();
  if (!md) return map;
  // two passes: the family tables are the source; prose and lists only fill in lenses no table names
  for (const pass of ["table", "text"]) {
    let wave = null;
    for (const line of md.split("\n")) {
      const w = /^###\s+Wave\s+(\d+)\s*[—-]\s*(.+)$/.exec(line);
      if (w) { wave = { n: Number(w[1]), name: w[2].trim() }; continue; }
      if (/^##\s/.test(line)) { if (!/^##\s+The queue/.test(line)) wave = null; continue; }
      if (!wave) continue;
      const row = /^\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+)\|/.exec(line);
      if (pass === "table") {
        if (row) for (const l of [...row[3].matchAll(/`([a-z0-9-]+)`/g)].map((m) => m[1])) if (!map.has(l)) map.set(l, { wave: wave.n, waveName: wave.name, order: Number(row[1]), family: row[2].replace(/`/g, "").trim() });
        continue;
      }
      if (row || /^\|/.test(line)) continue;
      const lenses = [...line.matchAll(/`([a-z0-9-]+)`/g)].map((m) => m[1]);
      const fam = /^\s*-\s+\*\*([^*]+)\*\*/.exec(line)?.[1] || wave.name;
      for (const l of lenses) if (!map.has(l)) map.set(l, { wave: wave.n, waveName: wave.name, order: null, family: fam.replace(/:$/, "") });
    }
  }
  return map;
}

function evidenceOf(r) {
  const ev = [];
  for (const k of ["evidence_path", "evidence_file", "evidence_md", "evidence_json"]) if (typeof r[k] === "string") ev.push(...r[k].split(/\s*;\s*/).filter(Boolean));
  for (const k of ["evidence_paths", "screenshots", "evidence_images", "evidence_refs"]) if (Array.isArray(r[k])) ev.push(...r[k].filter((x) => typeof x === "string"));
  if (typeof r.evidence === "string") ev.push(r.evidence); else if (Array.isArray(r.evidence)) ev.push(...r.evidence.filter((x) => typeof x === "string"));
  if (r.screenshot) ev.push(r.screenshot);
  ev.push(`record ${r.__src}`);
  return [...new Set(ev)];
}

export function classify(t, labelled) {
  if (t.root_cause_group) return { group: t.root_cause_group, basis: "walker" };
  if (t.check && CHECK_GROUPS[t.check]) return { group: CHECK_GROUPS[t.check], basis: `walker check:${t.check}` };
  const text = `${t.title} ${t.actual} ${t.expected}`;
  for (const [g, re] of RULES) if (re.test(text)) return { group: g, basis: `rule:${g}` };
  let best = null;
  const w = words(`${t.title} ${t.actual}`);
  for (const l of labelled) { const j = jaccard(w, l.words); if (j >= 0.45 && (!best || j > best.j)) best = { j, l }; }
  if (best) return { group: best.l.group, basis: `nearest:${best.l.id} (${best.j.toFixed(2)})` };
  return { group: "unclassified", basis: "none" };
}

const CASE_VERDICT = (v) => {
  const s = typeof v === "string" ? v : v && typeof v === "object" ? String(v.verdict || v.result || v.status || "") + " " + String(v.note || v.detail || "") : "";
  const m = /^\s*(PASS_WITH_ISSUES|PASS-WITH-ISSUES|PASS|FAIL|PARTIAL|NEEDS[_ -]?HUMAN|BLOCKED|NOT[_ -]TESTED|ERROR)\b/i.exec(s);
  return { verdict: m ? m[1].toUpperCase().replace(/[ -]/g, "_") : null, text: s.trim() };
};

/** The whole ingest, pure: inputs → outputs (no files written). */
export function ingest({ walkRows, existingRows = [], triageMd = "", date = new Date().toISOString().slice(0, 10) }) {
  const existing = mergeTicketLog(existingRows);
  const triage = parseTriage(triageMd);
  const labelled = [...existing.values()].filter((t) => t.root_cause_group && t.root_cause_group !== "unclassified").map((t) => ({ id: t.id, group: t.root_cause_group, words: words(`${t.title} ${t.actual}`) }));
  const unreadable = [];
  const findings = []; const needsHuman = []; const skipped = {};
  const ledgerRows = [], dedupRows = [], fixtureRows = [], walkerReview = [];
  const ticketIdsReported = new Set(walkRows.filter((r) => Array.isArray(r.tickets)).flatMap((r) => r.tickets.filter((x) => typeof x === "string")));

  for (const r of walkRows) {
    // older walk records name the lens as `slug` (lens_walk, lens_full_matrix)
    const lensName = typeof r.lens === "string" ? r.lens : typeof r.slug === "string" ? r.slug : null;
    const lens = lensName ? lensName.trim().toLowerCase() : null;
    if (r.type === "check_result") {
      if (!lens) { unreadable.push({ src: r.__src, reason: "check result with no lens" }); continue; }
      if (r.verdict === "FAIL") {
        const failed = (r.expect || []).filter((e) => !e.ok);
        findings.push({ lens, title: `${r.why}`.slice(0, 140), expected: r.why, actual: failed.map((e) => `${e.kind}: ${e.detail}`).join("; ") || r.error || "failed", repro_steps: [`Run check ${r.id} (scripts/walk/run-check.mjs) on ${r.base}${r.path} as ${r.account}, ${r.viewport}`], severity: "medium", evidence: evidenceOf(r), tester: "check-spec", ts: r.startedAt, src: r.__src, checkId: r.id, relatedTicket: r.ticket || null });
      } else if (r.verdict === "ERROR") needsHuman.push({ lens, case: r.id, why: r.error || "the check could not run", evidence: evidenceOf(r), src: r.__src });
      continue;
    }
    // the walker's re-verification ledger: { id, result: FIXED|STILL_FAILING|NEEDS_HUMAN, status, recipe, steps, reason }
    if (typeof r.id === "string" && typeof r.result === "string" && ("recipe" in r || "walker_run_id" in r)) { ledgerRows.push(r); continue; }
    // walker-side dedup: a finding it matched to an existing ticket
    if (typeof r.dup_of === "string") { dedupRows.push(r); continue; }
    // fixtures the walk created
    if (typeof r.label === "string" && typeof r.state === "string") { fixtureRows.push(r); continue; }
    // questions the walker leaves for a tester
    if (r.status === "NEEDS_TESTER" || (typeof r.kind === "string" && typeof r.question === "string")) {
      needsHuman.push({ lens: lens || "unknown", case: r.ticket_id || r.kind || "question", why: String(r.question || r.kind || "a tester must look").replace(/<text>/g, "…"), ticket: r.ticket_id || null, kind: r.kind || null, evidence: evidenceOf(r), src: r.__src });
      continue;
    }
    const isTicketRow = typeof r.title === "string" && (r.actual !== undefined || r.expected !== undefined || r.repro_steps !== undefined);
    if (isTicketRow) {
      if (!lens) { unreadable.push({ src: r.__src, reason: "ticket row with no lens" }); continue; }
      const known = KNOWN_WALKER_FALSE_POSITIVES.find((k) => k.check === r.check && typeof r.element === "string" && k.element.test(r.element));
      if (known) { walkerReview.push({ pattern: known.id, why: known.why, lens, element: r.element, title: r.title, evidence: evidenceOf(r), run: r.run || r.__run || null, src: r.__src }); continue; }
      findings.push({ lens, title: r.title.trim(), expected: r.expected ?? "", actual: r.actual ?? "", repro_steps: Array.isArray(r.repro_steps) ? r.repro_steps : r.repro_steps ? [String(r.repro_steps)] : [], severity: SEVERITY[String(r.severity || "").toLowerCase()] || "unrated", evidence: evidenceOf(r), suspected_area: r.suspected_area, root_cause_group: r.root_cause_group || r.root_cause || null, check: r.check || null, element: r.element || null, tester: r.tester || r.actor || (r.run ? `walker ${r.run}` : null), account: r.account, ts: r.ts, run: r.run || r.__run || null, src: r.__src, walkerId: r.id || null });
      continue;
    }
    if (r.cases && typeof r.cases === "object" && !Array.isArray(r.cases)) {
      if (!lens) { unreadable.push({ src: r.__src, reason: "result record with no lens" }); continue; }
      const linked = new Set((r.tickets || []).filter((x) => typeof x === "string"));
      for (const [name, val] of Object.entries(r.cases)) {
        const { verdict, text } = CASE_VERDICT(val);
        if (verdict === "NEEDS_HUMAN" || verdict === "BLOCKED") {
          needsHuman.push({ lens, case: name, why: text, tester: r.tester, evidence: evidenceOf(r), src: r.__src });
        } else if (verdict === "FAIL" && !linked.size && words(text.replace(/^FAIL\s*/i, "")).length < 2) {
          // failed with no description: nothing a builder can act on yet; a person writes it up
          needsHuman.push({ lens, case: name, why: `FAIL with no detail ("${text}") — describe what happened`, tester: r.tester, evidence: evidenceOf(r), src: r.__src });
        } else if (verdict === "FAIL" && !linked.size) {
          // a failed case the walker did not turn into a ticket itself
          findings.push({ lens, title: `${name.replace(/_/g, " ")}: ${text.replace(/^FAIL\s*/i, "") || "fails"}`.slice(0, 140), expected: `${name.replace(/_/g, " ")} works`, actual: text, repro_steps: [`Walk ${lens}: case "${name}"`], severity: "unrated", evidence: evidenceOf(r), tester: r.tester, account: r.account, ts: r.ts, src: r.__src, fromCase: true });
        }
      }
      continue;
    }
    { const k = r.type || (r.id ? "patch" : lens ? "lens record without cases" : "other"); skipped[k] = (skipped[k] || 0) + 1; } // protocol notes, batch markers, fix patches: not findings
  }

  // fold duplicates within the walk
  const groups = [];
  for (const f of findings.sort((a, b) => (a.lens + (a.ts || "")).localeCompare(b.lens + (b.ts || "")))) {
    const s = sig(f), w = words(`${f.title} ${f.actual}`);
    const g = groups.find((x) => x.lens === f.lens && (x.sig === s || jaccard(x.words, w) >= 0.6));
    if (g) { g.occurrences.push(f); continue; }
    groups.push({ lens: f.lens, sig: s, words: w, occurrences: [f] });
  }

  // the same walker check on the same control across lenses is one bug in shared code: one ticket
  const shared = new Map();
  for (const g of groups) {
    const h = g.occurrences[0];
    // same control (a check on an element), or for a server error the same failing endpoint ("503 /api/…")
    const endpoint = h.check === "http" ? /\b(\d{3})\s+(\/api\/\S+)/.exec(String(h.actual || "")) : null;
    if (!h.check || (!h.element && !endpoint)) continue;
    const k = `${h.check}\u0000${h.element || `${endpoint[1]} ${endpoint[2]}`}`;
    if (!shared.has(k)) shared.set(k, []);
    shared.get(k).push(g);
  }
  for (const gs of shared.values()) {
    if (new Set(gs.map((g) => g.lens)).size < 2) continue;
    const lenses = [...new Set(gs.map((g) => g.lens))].sort();
    const merged = { lens: "shared", lenses, sig: gs[0].sig, words: gs[0].words, occurrences: gs.flatMap((g) => g.occurrences) };
    for (const g of gs) groups.splice(groups.indexOf(g), 1);
    groups.push(merged);
  }

  // match against the existing log, then classify and number what is new
  const nextNum = new Map();
  for (const id of existing.keys()) { const m = /^FIX-([a-z0-9-]+)-(\d+)$/.exec(id); if (m) nextNum.set(m[1], Math.max(nextNum.get(m[1]) || 0, Number(m[2]))); }
  const tickets = [], seenAgain = [], reopen = [];
  const sevRank = { high: 3, medium: 2, low: 1, unrated: 0 };
  for (const g of groups) {
    const head = g.occurrences[0];
    const occ = g.occurrences.map((o) => ({ tester: o.tester, ts: o.ts, evidence: o.evidence, src: o.src, walkerId: o.walkerId || null }));
    let match = null;
    for (const t of existing.values()) {
      if ((t.lens !== g.lens && !(g.lenses || []).includes(t.lens)) || CLOSED_STATES.has(String(t.status || "").toUpperCase())) continue;
      const exact = (head.walkerId && head.walkerId === t.id) || new RegExp(`\\b${t.id}\\b`).test(`${head.title} ${head.actual}`);
      const tw = words(`${t.title} ${t.actual} ${t.expected}`);
      const j = jaccard(g.words, tw);
      const cn = head.fromCase ? containment(g.words, tw) : { c: 0, n: 0 };
      const score = exact ? 1 : Math.max(j >= 0.6 ? j : 0, cn.c >= 0.5 && cn.n >= 2 ? cn.c : 0);
      if (score > 0 && (!match || score > match.j)) match = { t, j: score, how: exact ? (head.walkerId === t.id ? "same id" : "names the ticket") : j >= 0.6 ? `word overlap ${j.toFixed(2)}` : `case note inside the ticket (${Math.round(cn.c * 100)}% of its words)` };
    }
    if (match) {
      const status = String(match.t.status || "OPEN").toUpperCase();
      const rec = { id: match.t.id, lens: g.lens, title: match.t.title, status, match: match.how || "same id", occurrences: occ, walked: date };
      // "the fix did not hold" only when the walk saw it after the fix; an earlier sighting is history
      const fixedAt = Date.parse(match.t.fix_ts || match.t.ts || "");
      const seenAt = Math.max(...g.occurrences.map((o) => Date.parse(o.ts || "") || 0));
      if (DONE_STATES.has(status) && Number.isFinite(fixedAt) && seenAt > fixedAt) reopen.push(rec);
      else seenAgain.push(DONE_STATES.has(status) ? { ...rec, note: Number.isFinite(fixedAt) && seenAt ? "seen before the fix landed" : "no times to compare: check by hand" } : rec);
      continue;
    }
    const cls = classify({ ...head, root_cause_group: g.occurrences.find((o) => o.root_cause_group)?.root_cause_group }, labelled);
    const n = (nextNum.get(g.lens) || 0) + 1; nextNum.set(g.lens, n);
    const tri = g.lenses ? null : triage.get(g.lens) || null;
    const severity = g.occurrences.map((o) => o.severity).sort((a, b) => sevRank[b] - sevRank[a])[0];
    tickets.push({
      id: `FIX-${g.lens}-${String(n).padStart(3, "0")}`, lens: g.lens, severity, title: head.title,
      repro_steps: head.repro_steps, expected: head.expected, actual: head.actual,
      evidence_paths: [...new Set(g.occurrences.flatMap((o) => o.evidence))],
      ...(head.suspected_area ? { suspected_area: head.suspected_area } : {}),
      root_cause_group: cls.group, root_cause_basis: cls.basis,
      triage_wave: tri ? tri.wave : null, triage_family: tri ? tri.family : g.lenses ? "shared code" : null,
      ...(g.lenses ? { affected_lenses: g.lenses } : {}),
      ...(head.check ? { walker_check: head.check } : {}), ...(head.element ? { element: head.element } : {}),
      status: "OPEN", source: `walk-ingest ${date}`, opened_et: date,
      occurrences: occ.length, occurrence_detail: occ,
      ...(head.checkId ? { check_spec: head.checkId } : {}), ...(head.relatedTicket ? { related_ticket: head.relatedTicket } : {}),
      status_flow: "OPEN→FIXED_PENDING_VERIFY→VERIFIED|REOPENED",
      close_rule: "Closes only after live re-run of original repro + nearby smoke on affected lens",
    });
  }

  // the walker's re-verifications of existing tickets
  const verified = [];
  const lensOfId = (id) => existing.get(id)?.lens || /^FIX-([a-z0-9-]+)-\d+$/.exec(id)?.[1] || null;
  for (const r of ledgerRows) {
    const t = existing.get(r.id);
    const lens = lensOfId(r.id);
    const ev = evidenceOf(r);
    const base = { id: r.id, lens, title: t?.title ?? null, status_in_log: t?.status ?? null, walker_status: r.status ?? null, method: r.method || r.recipe || null, run: r.walker_run_id || r.__run || null, live_sha: r.live_sha || null, evidence: ev, src: r.__src };
    if (r.result === "FIXED") {
      // a "fixed" whose only steps opened the lens has not tested the ticket
      const steps = Array.isArray(r.steps) ? r.steps : [];
      if (steps.length && steps.every((x) => x.action === "open")) {
        needsHuman.push({ lens: lens || "unknown", case: r.id, ticket: r.id, why: `the walker says FIXED, but its only step was opening the lens (${steps.map((x) => x.raw).join("; ")}); that does not test "${t?.title ?? r.id}"`, evidence: ev, src: r.__src });
        continue;
      }
      verified.push({ ...base, verdict: "FIXED: the walker re-ran the check and it passes", reason: r.reason || null });
      continue;
    }
    if (r.result === "NEEDS_HUMAN") { needsHuman.push({ lens: lens || "unknown", case: r.id, ticket: r.id, why: String(r.reason || "the walker could not decide").replace(/<text>/g, "…"), evidence: ev, src: r.__src }); continue; }
    if (r.result === "STILL_FAILING") {
      // a verdict its own measurement contradicts goes to a person, not to "the fix did not hold"
      const steps = Array.isArray(r.steps) ? r.steps : [];
      const clean = steps.filter((x) => x.executed && /overflow measured: .*'overflow_px': 0, 'offscreen': 0/.test(String(x.result || "")));
      if (clean.length && steps.every((x) => x.executed)) {
        needsHuman.push({ lens: lens || "unknown", case: r.id, ticket: r.id, why: `the walker says STILL_FAILING, but its own measurement was clean (${clean.map((x) => x.result).join("; ")}); check by hand before reopening`, evidence: ev, src: r.__src });
        continue;
      }
      const rec = { ...base, status: t?.status ?? r.status ?? null, match: "walker re-check (same id)", occurrences: [{ tester: `walker ${base.run || ""}`.trim(), ts: r.ts, evidence: ev, src: r.__src, walkerId: r.id }], walked: date };
      if (t && DONE_STATES.has(String(t.status || "").toUpperCase())) reopen.push(rec);
      else seenAgain.push({ ...rec, status: t?.status ?? r.status ?? null, note: t ? "still failing; already open" : "still failing; not in the ticket log given (--existing)" });
      continue;
    }
    unreadable.push({ src: r.__src, reason: `ledger result "${r.result}" not understood` });
  }
  for (const r of dedupRows) {
    const t = existing.get(r.dup_of);
    seenAgain.push({ id: r.dup_of, lens: r.lens ?? t?.lens ?? null, title: t?.title ?? r.title ?? null, status: t?.status ?? null, match: `walker dedup (${r.check || "check"})`, occurrences: [{ tester: `walker ${r.__run || ""}`.trim(), src: r.__src }], walked: date });
  }
  const fixturesToClean = fixtureRows.filter((f) => f.state !== "deleted").map((f) => ({ lens: f.lens, label: f.label, state: f.state, note: f.note, ts: f.ts, src: f.__src }));
  const fixturesDeleted = fixtureRows.length - fixturesToClean.length;
  // the reviewed false positives, one entry per pattern with every lens it appeared on
  const review = [];
  for (const w of walkerReview) {
    let e = review.find((x) => x.pattern === w.pattern);
    if (!e) { e = { pattern: w.pattern, why: w.why, lenses: [], elements: [], evidence: [], count: 0 }; review.push(e); }
    e.count += 1;
    if (!e.lenses.includes(w.lens)) e.lenses.push(w.lens);
    if (!e.elements.includes(w.element)) e.elements.push(w.element);
    e.evidence.push(...w.evidence);
  }
  for (const e of review) { e.lenses.sort(); e.evidence = [...new Set(e.evidence)]; }

  // one entry per (lens, case): the tester queue and the ledger can both raise the same ticket
  for (let i = needsHuman.length - 1; i >= 0; i--) {
    const k = `${needsHuman[i].lens}\u0000${needsHuman[i].case}`;
    const j = needsHuman.findIndex((x) => `${x.lens}\u0000${x.case}` === k);
    if (j < i) { needsHuman[j].why = `${needsHuman[j].why} | also: ${needsHuman[i].why}`; needsHuman[j].evidence = [...new Set([...(needsHuman[j].evidence || []), ...(needsHuman[i].evidence || [])])]; needsHuman.splice(i, 1); }
  }
  const nh = needsHuman.map((x, i) => ({ ...x, spec_draft: { id: `CS-${x.lens}-${slug(x.case) || `case-${i + 1}`}`, lens: x.lens, why: `TODO: what you expected for "${x.case}" (${x.why.slice(0, 120)})`, path: `/lenses/${x.lens}`, account: "member", viewport: "desktop", steps: [], expect: [] } }));
  return { tickets, seenAgain, reopen, verified, needsHuman: nh, walkerReview: review, fixturesToClean, unreadable, stats: { findings: findings.length, folded: findings.length - groups.length, new: tickets.length, shared: tickets.filter((t) => t.affected_lenses).length, seenAgain: seenAgain.length, reopen: reopen.length, verified: verified.length, needsHuman: nh.length, walkerReview: walkerReview.length, fixturesToClean: fixturesToClean.length, fixturesDeleted, unreadable: unreadable.length, skipped, linkedTicketIds: ticketIdsReported.size } };
}

export function renderMarkdown(res, { date }) {
  const L = [];
  L.push(`# Walk tickets — ${date}`, "");
  const s = res.stats;
  L.push(  `${s.new} new tickets (${s.shared || 0} shared across lenses) from ${s.findings} findings (${s.folded} folded as duplicates). ${s.verified || 0} confirmed fixed by the walker, ${s.reopen} fixes that did not hold, ${s.seenAgain} seen again (already open), ${s.needsHuman} need a person, ${s.walkerReview || 0} walker findings set aside as reviewed false positives, ${s.fixturesToClean || 0} fixtures left to clean, ${s.unreadable} lines unreadable; skipped ${Object.values(s.skipped || {}).reduce((a, b) => a + b, 0)} lines that are not findings (notes, markers, patches).`, "");
  const byWave = new Map();
  for (const t of res.tickets) { const k = t.triage_wave == null ? "unassigned" : `Wave ${t.triage_wave}`; if (!byWave.has(k)) byWave.set(k, []); byWave.get(k).push(t); }
  const waves = [...byWave.keys()].sort((a, b) => (a === "unassigned") - (b === "unassigned") || a.localeCompare(b, undefined, { numeric: true }));
  for (const w of waves) {
    L.push(`## ${w}`, "");
    const byLens = new Map();
    for (const t of byWave.get(w)) { if (!byLens.has(t.lens)) byLens.set(t.lens, []); byLens.get(t.lens).push(t); }
    for (const [lens, ts] of [...byLens].sort((a, b) => a[0].localeCompare(b[0]))) {
      L.push(`### ${lens}${ts[0].triage_family ? ` (${ts[0].triage_family})` : ""}`, "");
      const byRc = new Map();
      for (const t of ts) { if (!byRc.has(t.root_cause_group)) byRc.set(t.root_cause_group, []); byRc.get(t.root_cause_group).push(t); }
      for (const [rc, rts] of byRc) {
        L.push(`**${rc}**`, "");
        for (const t of rts) {
          L.push(`- \`${t.id}\` [${t.severity}] ${t.title}${t.occurrences > 1 ? ` — seen ${t.occurrences}×` : ""}${t.affected_lenses ? ` — on ${t.affected_lenses.length} lenses: ${t.affected_lenses.join(", ")}` : ""}`);
          L.push(`  - expected: ${String(t.expected).slice(0, 200)}`, `  - actual: ${String(t.actual).slice(0, 200)}`);
          L.push(`  - root cause basis: ${t.root_cause_basis}`, `  - evidence: ${t.evidence_paths.slice(0, 4).join(" · ")}${t.evidence_paths.length > 4 ? ` (+${t.evidence_paths.length - 4})` : ""}`);
        }
        L.push("");
      }
    }
  }
  if (res.verified?.length) { L.push("## Confirmed fixed by the walker", "", "Each was re-run on the live site and passes; move it to VERIFIED after a glance at the evidence.", ""); for (const v of res.verified) L.push(`- \`${v.id}\` ${v.title ?? ""} — ${v.method ?? ""}${v.live_sha ? ` @ ${v.live_sha.slice(0, 9)}` : ""}`); L.push(""); }
  if (res.walkerReview?.length) { L.push("## Walker review (reviewed false positives — not tickets)", ""); for (const w of res.walkerReview) { L.push(`- **${w.pattern}**: ${w.count} finding(s) on ${w.lenses.length} lens(es) (${w.lenses.join(", ")}); controls: ${w.elements.join(", ")}`, `  - why: ${w.why}`); } L.push(""); }
  if (res.fixturesToClean?.length) { L.push("## Fixtures left to clean", ""); for (const f of res.fixturesToClean) L.push(`- ${f.lens}: \`${f.label}\` (${f.state}) — ${f.note || ""}`); L.push(""); }
  if (res.reopen.length) { L.push("## The fix did not hold (marked fixed, seen again)", ""); for (const r of res.reopen) L.push(`- \`${r.id}\` ${r.title} — ${r.status}, ${r.match}, ${r.occurrences.length} occurrence(s)`); L.push(""); }
  if (res.seenAgain.length) { L.push("## Seen again (already open)", ""); for (const r of res.seenAgain) L.push(`- \`${r.id}\` ${r.title} — ${r.match}`); L.push(""); }
  if (res.needsHuman.length) { L.push("## Needs a person — write a check spec", "", "Each has a draft in needs-human.jsonl in the check-spec format (scripts/walk/check-spec.mjs); fill in its steps and expectations.", ""); for (const n of res.needsHuman) L.push(`- ${n.lens}: ${n.case} — ${n.why.slice(0, 160)} → \`${n.spec_draft.id}\``); L.push(""); }
  if (res.unreadable.length) { L.push("## Unreadable lines", ""); for (const u of res.unreadable) L.push(`- ${u.src}: ${u.reason}`); L.push(""); }
  return L.join("\n");
}

function arg(name, dflt) { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; }

function main() {
  const flagsWithValue = new Set(["--existing", "--triage", "--out", "--date"]);
  const inputs = []; for (let i = 2; i < process.argv.length; i++) { if (flagsWithValue.has(process.argv[i])) { i++; continue; } inputs.push(process.argv[i]); }
  if (!inputs.length) { console.error("usage: ingest.mjs <walk files or dirs...> [--existing fix_tickets.jsonl] [--triage LENS_REDESIGN_TRIAGE.md] [--out dir] [--date YYYY-MM-DD]"); process.exit(2); }
  const date = arg("--date", new Date().toISOString().slice(0, 10));
  const out = arg("--out", `audit/walk/ingest-${date}`);
  const walkRows = []; const bad = [];
  for (const f of filesOf(inputs)) { const r = readJsonl(f); walkRows.push(...r.rows); bad.push(...r.bad); }
  const ex = arg("--existing", null); const existingRows = ex && fs.existsSync(ex) ? readJsonl(ex).rows : [];
  const tr = arg("--triage", null); const triageMd = tr && fs.existsSync(tr) ? fs.readFileSync(tr, "utf8") : "";
  const res = ingest({ walkRows, existingRows, triageMd, date });
  res.unreadable.push(...bad); res.stats.unreadable = res.unreadable.length;
  fs.mkdirSync(out, { recursive: true });
  const w = (name, rows) => fs.writeFileSync(path.join(out, name), rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
  w("tickets.jsonl", res.tickets); w("seen-again.jsonl", res.seenAgain); w("reopen.jsonl", res.reopen); w("verified.jsonl", res.verified); w("needs-human.jsonl", res.needsHuman); w("walker-review.jsonl", res.walkerReview); w("fixtures-to-clean.jsonl", res.fixturesToClean); w("unreadable.jsonl", res.unreadable);
  fs.writeFileSync(path.join(out, "TICKETS.md"), renderMarkdown(res, { date }));
  console.log(JSON.stringify({ out, ...res.stats, triage: tr ? (triageMd ? "read" : "missing") : "not given" }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
