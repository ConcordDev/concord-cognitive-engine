// OpenStax textbook lookup (CC BY 4.0 open textbooks from Rice University).
//
// Chat and ConKay call this through the textbook_lookup tool for textbook,
// science and engineering facts ("Young's modulus of aluminum per OpenStax").
// OpenStax's own search index is not served for current book versions, and
// the keyless web index does not rank openstax.org pages, so this reads the
// public archive (openstax.org/apps/archive) directly: each book's page text
// is fetched once into a local cache (one JSONL file per book version) and
// searched there. No key. Nothing goes into server/data.
//
//   CONCORD_OPENSTAX_CACHE_DIR  cache folder (default ~/.cache/concord/openstax)
//   CONCORD_OPENSTAX=0          turn the tool off

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

const ORIGIN = "https://openstax.org";
const UA = "Mozilla/5.0 (compatible; ConcordTextbookLookup/1.0; +https://concord-os.org)";
const FETCH_TIMEOUT_MS = 15_000;
const BUILD_CONCURRENCY = 4;
const META_TTL_MS = 12 * 60 * 60 * 1000;

// Searched by default: science, engineering and math references.
export const DEFAULT_BOOKS = [
  "college-physics-2e", "university-physics-volume-1", "university-physics-volume-2", "university-physics-volume-3",
  "chemistry-2e", "organic-chemistry", "biology-2e", "anatomy-and-physiology-2e", "microbiology", "astronomy-2e",
  "calculus-volume-1", "calculus-volume-2", "calculus-volume-3", "introductory-statistics-2e",
  "additive-manufacturing-essentials", "introduction-computer-science",
];

const SUBJECT_BOOKS = [
  [/\b(?:physics|mechanic\w*|force|energy|momentum|torque|fluid|bernoulli|pressure|elastic\w*|modulus|stress|strain|thermo\w*|heat|optic\w*|wave|sound|electric\w*|magnet\w*|circuit|quantum|relativity|engineering|beam|material)\b/i,
    ["college-physics-2e", "university-physics-volume-1", "university-physics-volume-2", "university-physics-volume-3"]],
  [/\b(?:chem\w*|molar|mole|reaction|acid|base|ph|bond\w*|element|periodic|organic|stoichiometr\w*|enthalpy|equilibrium)\b/i, ["chemistry-2e", "organic-chemistry"]],
  [/\b(?:bio\w*|cell|gene\w*|dna|protein|evolution|ecolog\w*|enzyme|photosynthesis|anatomy|physiolog\w*|organ|microb\w*|bacteri\w*|virus)\b/i,
    ["biology-2e", "anatomy-and-physiology-2e", "microbiology"]],
  [/\b(?:calculus|derivative|integral|limit|series|vector|differential)\b/i, ["calculus-volume-1", "calculus-volume-2", "calculus-volume-3"]],
  [/\b(?:statistic\w*|probability|regression|variance|hypothesis|distribution)\b/i, ["introductory-statistics-2e"]],
  [/\b(?:astronom\w*|planet|star|galaxy|orbit|solar)\b/i, ["astronomy-2e"]],
  [/\b(?:additive manufacturing|3d print\w*)\b/i, ["additive-manufacturing-essentials"]],
];

const STOP = new Set(`a an the of to in on for and or is are was were be what whats which who how why per according
  openstax open stax textbook textbooks text book books source sources explain describe define definition tell me give
  show find look up lookup with from by about please value values using use cite citation reference chapter section
  do does did can could would should it its this that these those as at`.split(/\s+/).filter(Boolean));

function cacheDir() {
  return process.env.CONCORD_OPENSTAX_CACHE_DIR || path.join(os.homedir(), ".cache", "concord", "openstax");
}

async function getJson(url, { fetchImpl } = {}) {
  const f = fetchImpl || globalThis.fetch;
  const res = await f(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

let _meta = null; // { at, release, books: Map(slug -> {slug,title,uuid}) }
async function catalog(opts = {}) {
  if (_meta && Date.now() - _meta.at < META_TTL_MS) return _meta;
  const [release, cms] = await Promise.all([
    getJson(`${ORIGIN}/rex/release.json`, opts),
    getJson(`${ORIGIN}/apps/cms/api/v2/pages/?type=books.Book&fields=title,cnx_id,book_state&limit=250`, opts),
  ]);
  const books = new Map();
  for (const b of cms?.items || []) {
    const slug = b?.meta?.slug;
    if (!slug || !b.cnx_id || b.book_state !== "live") continue;
    const ver = release?.books?.[b.cnx_id]?.defaultVersion;
    if (!ver) continue;
    books.set(slug, { slug, title: b.title || slug, uuid: b.cnx_id, version: ver });
  }
  _meta = { at: Date.now(), archive: release.archiveUrl, books };
  return _meta;
}
export function _resetOpenStaxCache() { _meta = null; _building.clear(); }

/** Visible text of an OpenStax page: MathML annotations dropped, powers kept as 10^9. */
export function pageText(html) {
  return String(html || "")
    .replace(/<annotation[\s\S]*?<\/annotation(?:-xml)?>/gi, " ")
    .replace(/<msup>\s*<mn>([^<]+)<\/mn>\s*<mn>([^<]+)<\/mn>\s*<\/msup>/gi, "$1^$2")
    .replace(/<msup>\s*<mi>([^<]+)<\/mi>\s*<mn>([^<]+)<\/mn>\s*<\/msup>/gi, "$1^$2")
    .replace(/<(?:script|style)[\s\S]*?<\/(?:script|style)>/gi, " ")
    .replace(/<\/(?:p|li|tr|h\d|div|caption|figcaption)>/gi, ". ")
    .replace(/<\/t[dh]>/gi, " | ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x?[0-9a-f]+;/gi, " ")
    .replace(/\s*\|\s*(?:\|\s*)+/g, " | ")
    .replace(/(?:\.\s*){2,}/g, ". ")
    .replace(/\s+/g, " ")
    .replace(/\b10 ([−-]?\d{1,2}) (?=[A-Za-z(])/g, "10^$1 ")
    .trim();
}

function plainTitle(t) { return pageText(t).replace(/\s*\.\s*$/, ""); }

function flatten(tree) {
  const out = [];
  const walk = (n) => { for (const c of n?.contents || []) (c.contents ? walk(c) : out.push(c)); };
  walk(tree);
  return out;
}

function bookFile(b) { return path.join(cacheDir(), `${b.slug}@${b.version}.jsonl`); }
export function isBookCached(b) { try { return fs.statSync(bookFile(b)).size > 0; } catch { return false; } }

const _building = new Map();
/** Fetch every section of a book into the cache. Returns the cache file path. */
export async function buildBook(slug, opts = {}) {
  const meta = await catalog(opts);
  const b = meta.books.get(slug);
  if (!b) throw new Error(`unknown OpenStax book: ${slug}`);
  if (isBookCached(b)) return bookFile(b);
  if (_building.has(slug)) return _building.get(slug);
  const p = (async () => {
    const base = `${ORIGIN}${meta.archive}/contents/${b.uuid}@${b.version}`;
    const book = await getJson(`${base}.json`, opts);
    const pages = flatten(book.tree).filter((pg) => /^(?:numbered-section|intro|appendix)$/.test(pg.toc_target_type || "") || !pg.toc_target_type);
    const rows = new Array(pages.length);
    let i = 0;
    const worker = async () => {
      while (i < pages.length) {
        const k = i++; const pg = pages[k];
        const id = String(pg.id || "").split("@")[0];
        try {
          const page = await getJson(`${base}:${id}.json`, opts);
          rows[k] = { t: plainTitle(pg.title || page.title), s: pg.slug, x: pageText(page.content).slice(0, 200_000) };
        } catch { rows[k] = null; }
      }
    };
    await Promise.all(Array.from({ length: BUILD_CONCURRENCY }, worker));
    const good = rows.filter((r) => r && r.x);
    if (!good.length) throw new Error(`no pages fetched for ${slug}`);
    fs.mkdirSync(cacheDir(), { recursive: true });
    const tmp = `${bookFile(b)}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, good.map((r) => JSON.stringify(r)).join("\n") + "\n");
    fs.renameSync(tmp, bookFile(b));
    return bookFile(b);
  })().finally(() => _building.delete(slug));
  _building.set(slug, p);
  return p;
}

export function queryTerms(query) {
  return [...new Set(String(query || "").toLowerCase().replace(/[’']s\b/g, "").replace(/[^a-z0-9\s-]/g, " ").split(/\s+/)
    .map((w) => w.replace(/^-+|-+$/g, ""))
    .filter((w) => w.length >= 2 && !STOP.has(w))
    .map((w) => (w.length > 4 && w.endsWith("s") && !/(?:ss|us|is|ics)$/.test(w) ? w.slice(0, -1) : w)))].slice(0, 8);
}

function countOf(hay, term) {
  let n = 0; let i = hay.indexOf(term);
  while (i !== -1 && n < 50) { n++; i = hay.indexOf(term, i + term.length); }
  return n;
}

/** Best ~700-char window of a page for the terms, centred on a term hit. */
export function bestPassage(text, terms, size = 700) {
  const lower = text.toLowerCase();
  // Centre on the rarest term the page has ("aluminum" in a page full of
  // "modulus"): that is where the specific fact sits.
  const present = terms.map((t) => [t, countOf(lower, t)]).filter(([, c]) => c > 0).sort((a, b) => a[1] - b[1]);
  const centres = [];
  for (const [t] of present.slice(0, 1)) {
    let i = lower.indexOf(t); let n = 0;
    while (i !== -1 && n++ < 200) { centres.push(i); i = lower.indexOf(t, i + t.length); }
  }
  let best = { score: -1, at: 0 };
  for (const c of centres.length ? centres : [0]) {
    const at = Math.max(0, c - Math.floor(size / 2));
    const win = lower.slice(at, at + size);
    const distinct = terms.filter((t) => win.includes(t)).length;
    const score = distinct * 100 + terms.reduce((s2, t) => s2 + Math.min(5, countOf(win, t)), 0);
    if (score > best.score) best = { score, at };
  }
  let start = best.at;
  const dot = text.lastIndexOf(". ", start);
  if (dot !== -1 && start - dot < 200) start = dot + 2;
  return text.slice(start, start + size).trim();
}

export function scorePage(row, terms) {
  const title = String(row.t || "").toLowerCase();
  const hay = String(row.x || "").toLowerCase();
  let distinct = 0; let hits = 0; let titleHits = 0;
  for (const t of terms) {
    const c = countOf(hay, t);
    if (c) { distinct++; hits += Math.min(c, 15); }
    if (title.includes(t)) titleHits++;
  }
  if (!distinct) return 0;
  return distinct * distinct * 20 + titleHits * 25 + hits;
}

function booksFor(query, meta) {
  const q = String(query || "");
  const named = [...meta.books.values()].filter((b) => {
    const title = b.title.toLowerCase().replace(/[^a-z0-9 ]/g, "");
    return title.length > 6 && q.toLowerCase().replace(/[^a-z0-9 ]/g, "").includes(title);
  }).map((b) => b.slug);
  if (named.length) return named;
  const picked = new Set();
  for (const [re, slugs] of SUBJECT_BOOKS) if (re.test(q)) slugs.forEach((s) => picked.add(s));
  return picked.size ? [...picked] : DEFAULT_BOOKS;
}

/**
 * Search OpenStax for a textbook fact.
 * @returns {Promise<{ok:boolean, query:string, results:object[], pending?:string[], note?:string, error?:string}>}
 */
export async function textbookLookup(query, opts = {}) {
  if (String(process.env.CONCORD_OPENSTAX || "1") === "0") return { ok: false, error: "textbook lookup is turned off" };
  const terms = queryTerms(query);
  if (!terms.length) return { ok: false, error: "textbook_lookup needs a topic" };
  let meta;
  try { meta = await catalog(opts); } catch (e) { return { ok: false, error: `OpenStax catalog unavailable: ${e.message}` }; }
  const slugs = (opts.books && opts.books.length ? opts.books : booksFor(query, meta)).filter((s) => meta.books.has(s));
  const ready = slugs.filter((s) => isBookCached(meta.books.get(s)));
  const pending = slugs.filter((s) => !ready.includes(s));
  // A book not cached yet is fetched now when it is the only one asked for
  // (bounded), otherwise in the background for the next ask.
  const waitMs = Number(opts.waitMs ?? 45_000);
  if (!ready.length && pending.length) {
    const first = pending.shift();
    try {
      await Promise.race([buildBook(first, opts), new Promise((_, rej) => { setTimeout(() => rej(new Error("still indexing")), waitMs); })]);
      ready.push(first);
    } catch { pending.unshift(first); }
  }
  for (const s of pending) buildBook(s, opts).catch(() => {});
  const top = [];
  for (const slug of ready) {
    const b = meta.books.get(slug);
    const rl = readline.createInterface({ input: fs.createReadStream(bookFile(b), "utf8"), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line) continue;
      let row; try { row = JSON.parse(line); } catch { continue; }
      const score = scorePage(row, terms);
      if (!score) continue;
      if (top.length < 3 || score > top[top.length - 1].score) {
        top.push({ score, row, b });
        top.sort((x, y) => y.score - x.score);
        if (top.length > 3) top.pop();
      }
    }
  }
  const results = top.map(({ row, b, score }) => ({
    book: b.title,
    section: row.t,
    url: `${ORIGIN}/books/${b.slug}/pages/${row.s}`,
    passage: bestPassage(row.x, terms),
    score,
    attribution: `${b.title}, OpenStax (Rice University), CC BY 4.0`,
  }));
  return {
    ok: true, query: String(query), terms, results,
    ...(pending.length ? { pending, note: `Still indexing ${pending.length} OpenStax book(s); they will be searchable on the next ask.` } : {}),
  };
}
