// One-time title cleanup for consolidated DTUs (2026-10-27):
//   nested:    "MEGA — MEGA — X"            → "MEGA — X"
//   artifact:  a non-mega/hyper titled "MEGA — X" / "HYPER — X" → "X"
//   generic:   "MEGA — Cluster" / "Untitled cluster" → "MEGA — <themes>"
//   duplicate: two live consolidated nodes with one title → the later ones get
//              a distinguishing theme (or "(2)", "(3)").
// Pure planning here; server.js applies it through STATE.dtus.set and logs
// every change (id, from, to, reason) so it can be undone.
import path from "node:path";
import { stripTierPrefix, consolidatedTitle } from "./consolidation-dedupe.js";
import { sharedThemes } from "./consolidation-synthesis.js";

const PREFIX_RE = /^\s*(?:mega|hyper)\s*[—–:-]\s*/i;
/** Strip every leading "MEGA —" / "HYPER —" / "MEGA:" prefix. */
function stripAllPrefixes(title) {
  let t = String(title || "");
  for (let i = 0; i < 8 && PREFIX_RE.test(t); i++) t = t.replace(PREFIX_RE, "");
  return stripTierPrefix(t).trim();
}
const GENERIC_RE = /^(cluster|untitled cluster|untitled|dtu|none|null|undefined)$/i;
const isCons = (d) => d?.tier === "mega" || d?.tier === "hyper";

function nodeThemes(d, k = 3) {
  const line = String(d?.cretiHuman || "").match(/\*\*Common themes\*\*:\s*([^\n]+)/);
  if (line) {
    const t = line[1].split(/,\s*/).map((s) => s.trim()).filter(Boolean);
    if (t.length) return t.slice(0, k);
  }
  const tags = (Array.isArray(d?.tags) ? d.tags : []).map(String).filter((t) => /^[a-z][a-z0-9-]{2,}$/i.test(t) && !/^(mega|hyper|consolidated|auto|system)$/i.test(t));
  if (tags.length) return tags.slice(0, k);
  return sharedThemes([d], k);
}

/** Changes to make, in order; never touches a DTU that is already clean. */
export function planTitleCleanup(nodes) {
  const list = (nodes || []).filter((d) => d?.id && typeof d.title === "string");
  const next = new Map(); // id -> { to, reasons[] }
  const want = (d, to, reason) => {
    const cur = next.get(d.id);
    if (cur) { cur.to = to; cur.reasons.push(reason); } else next.set(d.id, { to, reasons: [reason] });
  };
  const titleOf = (d) => next.get(d.id)?.to ?? d.title;

  for (const d of list) {
    const seed = stripAllPrefixes(d.title);
    const hadPrefix = PREFIX_RE.test(d.title);
    if (isCons(d)) {
      if (GENERIC_RE.test(seed) || !seed) {
        const th = nodeThemes(d);
        if (th.length) want(d, consolidatedTitle(d.tier, th.join(" · ")), "generic");
      } else if (hadPrefix && d.title !== consolidatedTitle(d.tier, seed, 200)) {
        // Only titles that carry a prefix; older un-prefixed megas keep theirs.
        // more than one prefix, or the wrong tier's prefix
        want(d, consolidatedTitle(d.tier, seed, 200), "nested");
      }
    } else if (PREFIX_RE.test(d.title) && seed) {
      want(d, seed, "artifact");
    }
  }

  // Duplicates among live consolidated nodes: keep the oldest title as is.
  const groups = new Map();
  for (const d of list.filter(isCons)) {
    const t = titleOf(d);
    if (!groups.has(t)) groups.set(t, []);
    groups.get(t).push(d);
  }
  const taken = new Set(list.map(titleOf));
  for (const [t, ds] of groups) {
    if (ds.length < 2) continue;
    ds.sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")) || a.id.localeCompare(b.id));
    let n = 2;
    for (const d of ds.slice(1)) {
      const lower = t.toLowerCase();
      const theme = nodeThemes(d, 6).find((x) => !lower.includes(String(x).toLowerCase()));
      let to = theme ? `${t} · ${theme}` : `${t} (${n})`;
      while (taken.has(to)) to = `${t} (${n++})`;
      taken.add(to);
      want(d, to, "duplicate");
    }
  }

  const byId = new Map(list.map((d) => [d.id, d]));
  return [...next.entries()]
    .filter(([id, c]) => c.to && c.to !== byId.get(id).title)
    .map(([id, c]) => ({ id, tier: byId.get(id).tier, from: byId.get(id).title, to: c.to, reasons: c.reasons }));
}

export function countByReason(changes) {
  const out = { nested: 0, artifact: 0, generic: 0, duplicate: 0, total: changes.length };
  for (const c of changes) for (const r of new Set(c.reasons)) out[r] = (out[r] || 0) + 1;
  return out;
}

/** Undo from a log: restore `from` only where the title is still `to`. */
export function planUndo(log, getNode) {
  return (log?.changes || [])
    .map((c) => ({ c, d: getNode(c.id) }))
    .filter(({ c, d }) => d && d.title === c.to)
    .map(({ c }) => ({ id: c.id, from: c.to, to: c.from, reasons: ["undo"] }));
}

/**
 * Apply once (or undo) against the live store. Writes the log BEFORE any
 * change so every edit is recoverable; skips when the log already exists.
 *   store:  Map-like (STATE.dtus) — set() is the app's own write-through.
 *   undo:   restore `from` where the title is still `to`, then mark undone.
 */
export function runTitleCleanup({ store, logPath, undo = false, fs, log = () => {}, now = () => new Date().toISOString() }) {
  const exists = fs.existsSync(logPath);
  if (undo) {
    if (!exists) return { skipped: "no_log" };
    const saved = JSON.parse(fs.readFileSync(logPath, "utf8"));
    if (saved.undoneAt) return { skipped: "already_undone" };
    const plan = planUndo(saved, (id) => store.get(id));
    for (const c of plan) { const d = store.get(c.id); if (d) store.set(c.id, { ...d, title: c.to, updatedAt: now() }); }
    saved.undoneAt = now(); saved.undone = plan.length;
    fs.writeFileSync(logPath, JSON.stringify(saved, null, 2));
    log("info", "mega_title_cleanup_undone", { undone: plan.length });
    return { undone: plan.length };
  }
  if (exists) return { skipped: "log_exists" };
  const changes = planTitleCleanup([...store.values()]);
  const counts = countByReason(changes);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, JSON.stringify({ plannedAt: now(), counts, changes, applied: 0 }, null, 2));
  let applied = 0;
  for (const c of changes) {
    const d = store.get(c.id);
    if (!d || d.title !== c.from) continue;
    store.set(c.id, { ...d, title: c.to, updatedAt: now() });
    applied++;
  }
  const saved = JSON.parse(fs.readFileSync(logPath, "utf8"));
  saved.applied = applied; saved.appliedAt = now();
  fs.writeFileSync(logPath, JSON.stringify(saved, null, 2));
  log("info", "mega_title_cleanup_applied", { ...counts, applied });
  return { ...counts, applied };
}
