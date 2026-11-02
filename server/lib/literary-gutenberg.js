// server/lib/literary-gutenberg.js
//
// Project Gutenberg ingest (Literary Resonance Lattice, Phase 1) as an
// in-process, admin-triggered job. It replaces running scripts/ingest-gutenberg.mjs
// against a live database: that script opened its own better-sqlite3 handle and
// ran migrations from a second process. This runs the same Tier-1 manifest through
// the same ingestWork() on the running backend's existing db handle — no new
// connection, no migrations at request time.
//
// Semantics:
//   - Idempotent: a work already ingested (literary_sources.chunk_count > 0) is
//     skipped; a second run ingests 0 new works and reports them skipped.
//   - Single-flight: one run at a time; start() while running is refused.
//   - Rate-limited: a new run may not start within minIntervalMs of the last start.
//   - Per-work isolation: a failed fetch/ingest is counted and the run continues.
//   - Network: Gutenberg mirror only, 30 s timeout per attempt.
//   - The event loop is yielded between works (ingestWork is synchronous SQLite).

import { ingestWork } from "./literary-ingest.js";

// Tier-1 manifest (cross-domain "highest resonance" starter set). gutenbergId is
// the canonical PG number; metadata is authored here so the corpus is tagged even
// if a work's own front-matter is sparse.
export const GUTENBERG_MANIFEST = [
  { gutenbergId: "1524", title: "Hamlet", author: "William Shakespeare", era: "renaissance", genre: "drama", themes: ["mortality", "revenge", "madness"] },
  { gutenbergId: "1513", title: "Romeo and Juliet", author: "William Shakespeare", era: "renaissance", genre: "drama", themes: ["love", "fate", "feud"] },
  { gutenbergId: "1727", title: "The Odyssey", author: "Homer", era: "antiquity", genre: "epic", themes: ["journey", "cunning", "homecoming"] },
  { gutenbergId: "1342", title: "Pride and Prejudice", author: "Jane Austen", era: "regency", genre: "novel", themes: ["class", "marriage", "pride"] },
  { gutenbergId: "1400", title: "Great Expectations", author: "Charles Dickens", era: "victorian", genre: "novel", themes: ["ambition", "guilt", "redemption"] },
  { gutenbergId: "2701", title: "Moby Dick", author: "Herman Melville", era: "romantic", genre: "novel", themes: ["obsession", "nature", "fate"] },
  { gutenbergId: "1080", title: "A Modest Proposal", author: "Jonathan Swift", era: "enlightenment", genre: "satire", themes: ["irony", "ethics", "poverty"] },
  { gutenbergId: "1497", title: "The Republic", author: "Plato", era: "antiquity", genre: "philosophy", themes: ["justice", "power", "the-good"] },
  { gutenbergId: "1232", title: "The Prince", author: "Niccolo Machiavelli", era: "renaissance", genre: "philosophy", themes: ["power", "statecraft", "virtue"] },
  { gutenbergId: "844", title: "The Importance of Being Earnest", author: "Oscar Wilde", era: "victorian", genre: "drama", themes: ["identity", "wit", "society"] },
  { gutenbergId: "98", title: "A Tale of Two Cities", author: "Charles Dickens", era: "victorian", genre: "novel", themes: ["sacrifice", "revolution", "resurrection"] },
  { gutenbergId: "11", title: "Alice's Adventures in Wonderland", author: "Lewis Carroll", era: "victorian", genre: "novel", themes: ["nonsense", "growth", "logic"] },
];

// Candidate plain-text URLs for a Gutenberg id (the layout varies by vintage).
export function gutenbergUrlsFor(id) {
  return [
    `https://www.gutenberg.org/files/${id}/${id}-0.txt`,
    `https://www.gutenberg.org/files/${id}/${id}.txt`,
    `https://www.gutenberg.org/cache/epub/${id}/pg${id}.txt`,
  ];
}

// Strip the Project Gutenberg legal header/footer so only the work remains.
export function stripGutenbergBoilerplate(text) {
  let t = String(text).replace(/\r\n/g, "\n");
  const startRe = /\*\*\*\s*START OF (THE|THIS) PROJECT GUTENBERG EBOOK[^*]*\*\*\*/i;
  const endRe = /\*\*\*\s*END OF (THE|THIS) PROJECT GUTENBERG EBOOK[^*]*\*\*\*/i;
  const s = t.match(startRe);
  if (s) t = t.slice(s.index + s[0].length);
  const e = t.match(endRe);
  if (e) t = t.slice(0, e.index);
  return t.trim();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchGutenbergText(id, { fetchImpl = globalThis.fetch, timeoutMs = 30000, attempts = 3, backoffMs = 1000 } = {}) {
  for (const url of gutenbergUrlsFor(id)) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetchImpl(url, { signal: controller.signal, headers: { "user-agent": "ConcordLRL/0.1 (public-domain ingest)" } });
        if (res.ok) {
          const text = await res.text();
          if (text && text.length > 1000) return { text, url };
        }
      } catch {
        await sleep(backoffMs * (attempt + 1));
      } finally {
        clearTimeout(t);
      }
    }
  }
  return null;
}

export function createGutenbergIngest({
  db,
  manifest = GUTENBERG_MANIFEST,
  fetchImpl = globalThis.fetch,
  ingest = ingestWork,
  minIntervalMs = 5 * 60 * 1000,
  now = () => Date.now(),
  fetchOpts = {},
} = {}) {
  if (!db) throw new TypeError("createGutenbergIngest: a db handle is required");
  let running = false;
  let lastStartAt = 0;
  let current = null; // live progress of the active run
  let last = null; // summary of the most recent finished run

  const snapshot = () => ({ running, current: current && { ...current, works: [...current.works] }, last });

  async function run({ max = Infinity, embed = true } = {}) {
    const works = manifest.slice(0, Number.isFinite(max) ? Math.max(0, max) : manifest.length);
    const summary = { startedAt: now(), finishedAt: null, total: works.length, ingested: 0, skipped: 0, failed: 0, chunks: 0, works: [] };
    current = summary;
    try {
      for (const w of works) {
        const sid = `gut_${w.gutenbergId}`;
        try {
          const existing = db.prepare("SELECT chunk_count FROM literary_sources WHERE id = ?").get(sid);
          if (existing && existing.chunk_count > 0) {
            summary.skipped++;
            summary.works.push({ gutenbergId: w.gutenbergId, title: w.title, status: "skipped", chunks: existing.chunk_count });
            continue;
          }
          const fetched = await fetchGutenbergText(w.gutenbergId, { fetchImpl, ...fetchOpts });
          if (!fetched) {
            summary.failed++;
            summary.works.push({ gutenbergId: w.gutenbergId, title: w.title, status: "failed", error: "unavailable" });
            continue;
          }
          const body = stripGutenbergBoilerplate(fetched.text);
          const res = await ingest(db, { ...w, url: fetched.url, license: "public_domain", pdVerified: 1 }, body, embed ? {} : { doEmbed: false });
          if (res.ok && !res.skipped) {
            summary.ingested++;
            summary.chunks += res.chunks;
            summary.works.push({ gutenbergId: w.gutenbergId, title: w.title, status: "ingested", chunks: res.chunks, embedded: res.embedded || 0 });
          } else if (res.skipped) {
            summary.skipped++;
            summary.works.push({ gutenbergId: w.gutenbergId, title: w.title, status: "skipped", chunks: res.chunks });
          } else {
            summary.failed++;
            summary.works.push({ gutenbergId: w.gutenbergId, title: w.title, status: "failed", error: res.error || "ingest_failed" });
          }
        } catch (e) {
          summary.failed++;
          summary.works.push({ gutenbergId: w.gutenbergId, title: w.title, status: "failed", error: String(e?.message || e) });
        }
        await new Promise((r) => setImmediate(r)); // yield between works
      }
    } finally {
      summary.finishedAt = now();
      last = summary;
      current = null;
      running = false;
    }
    return summary;
  }

  /**
   * Begin a run. Returns { started:false, reason } when refused ("already_running"
   * or "rate_limited" with retryAfterMs), else { started:true, done } where `done`
   * resolves to the run summary (the route does not await it).
   */
  function start(opts = {}) {
    if (running) return { started: false, reason: "already_running" };
    const t = now();
    if (lastStartAt && t - lastStartAt < minIntervalMs) {
      return { started: false, reason: "rate_limited", retryAfterMs: minIntervalMs - (t - lastStartAt) };
    }
    running = true;
    lastStartAt = t;
    return { started: true, done: run(opts) };
  }

  return { start, status: snapshot };
}

/**
 * Register the admin routes on `app`:
 *   POST /api/admin/literary-ingest/gutenberg   start a run (202; 409 if one is running; 429 if too soon)
 *   GET  /api/admin/literary-ingest/gutenberg   progress + last summary
 * Both sit behind the caller's requireRole(...). `getDb` is read per request so the
 * route uses the running server's handle (never opens one, never migrates).
 */
export function mountGutenbergIngestRoutes(app, { requireRole, getDb, ingestOpts = {}, log = () => {} }) {
  let svc = null;
  let svcDb = null;
  const get = () => {
    const db = getDb();
    if (!db) return null;
    if (!svc || svcDb !== db) { svc = createGutenbergIngest({ db, ...ingestOpts }); svcDb = db; }
    return svc;
  };
  const gate = requireRole("owner", "admin", "sovereign", "founder");

  app.post("/api/admin/literary-ingest/gutenberg", gate, (req, res) => {
    try {
      const s = get();
      if (!s) return res.status(503).json({ ok: false, error: "db_unavailable" });
      const maxRaw = Number(req.body?.max);
      const max = Number.isFinite(maxRaw) && maxRaw > 0 ? Math.floor(maxRaw) : Infinity;
      const embed = req.body?.embed !== false;
      const r = s.start({ max, embed });
      if (!r.started) {
        if (r.reason === "already_running") return res.status(409).json({ ok: false, error: "already_running", status: s.status() });
        return res.status(429).json({ ok: false, error: "rate_limited", retryAfterMs: r.retryAfterMs });
      }
      r.done.then((sum) => log("info", "literary_gutenberg_ingest_done", { ingested: sum.ingested, skipped: sum.skipped, failed: sum.failed, chunks: sum.chunks }))
        .catch((e) => log("warn", "literary_gutenberg_ingest_failed", { error: e?.message }));
      return res.status(202).json({ ok: true, started: true, status: s.status() });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.get("/api/admin/literary-ingest/gutenberg", gate, (req, res) => {
    try {
      const s = get();
      if (!s) return res.status(503).json({ ok: false, error: "db_unavailable" });
      return res.json({ ok: true, ...s.status() });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
}
