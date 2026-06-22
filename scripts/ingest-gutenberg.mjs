#!/usr/bin/env node
/**
 * Project Gutenberg ingestion — Literary Resonance Lattice (LRL) Phase 1.
 *
 * Resumable mirror: fetches a curated Tier-1 manifest of high-resonance
 * public-domain works, strips the Gutenberg boilerplate, and feeds each through
 * server/lib/literary-ingest.js#ingestWork (structure-aware chunk → DTU mint →
 * BM25 + best-effort embedding). Idempotent: already-ingested works are skipped,
 * so re-running resumes where it stopped (or after a crash).
 *
 * Usage:
 *   node scripts/ingest-gutenberg.mjs              # ingest the full Tier-1 manifest
 *   node scripts/ingest-gutenberg.mjs --max=5      # first N works
 *   node scripts/ingest-gutenberg.mjs --db=/path/concord.db
 *   node scripts/ingest-gutenberg.mjs --self-test  # offline: ingest one bundled passage
 *
 * Sovereignty: reads from the public mirror only; writes locally; no telemetry.
 */

import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { runMigrations } from "../server/migrate.js";
import { ingestWork } from "../server/lib/literary-ingest.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// better-sqlite3 lives in server/node_modules — resolve from there.
const require = createRequire(path.join(__dirname, "..", "server", "package.json"));
const Database = require("better-sqlite3");

// ── CLI ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (k, d) => {
  const a = args.find((x) => x.startsWith(`--${k}=`));
  return a ? a.split("=")[1] : d;
};
const MAX = Number(getArg("max", Infinity));
const SELF_TEST = args.includes("--self-test");
const DB_PATH = getArg("db", process.env.DB_PATH || path.join(__dirname, "..", "server", "data", "concord.db"));

// ── Tier-1 manifest (cross-domain "highest resonance" starter set) ────────────
// gutenbergId is the canonical PG number; metadata is authored here so the
// corpus is tagged even if the work's own front-matter is sparse.
const MANIFEST = [
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
function urlsFor(id) {
  return [
    `https://www.gutenberg.org/files/${id}/${id}-0.txt`,
    `https://www.gutenberg.org/files/${id}/${id}.txt`,
    `https://www.gutenberg.org/cache/epub/${id}/pg${id}.txt`,
  ];
}

async function fetchText(id) {
  for (const url of urlsFor(id)) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 30000);
        const res = await fetch(url, { signal: controller.signal, headers: { "user-agent": "ConcordLRL/0.1 (public-domain ingest)" } });
        clearTimeout(t);
        if (res.ok) {
          const text = await res.text();
          if (text && text.length > 1000) return { text, url };
        }
      } catch {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }
  return null;
}

// Strip the Project Gutenberg legal header/footer so only the work remains.
function stripBoilerplate(text) {
  let t = text.replace(/\r\n/g, "\n");
  const startRe = /\*\*\*\s*START OF (THE|THIS) PROJECT GUTENBERG EBOOK[^*]*\*\*\*/i;
  const endRe = /\*\*\*\s*END OF (THE|THIS) PROJECT GUTENBERG EBOOK[^*]*\*\*\*/i;
  const s = t.match(startRe);
  if (s) t = t.slice(s.index + s[0].length);
  const e = t.match(endRe);
  if (e) t = t.slice(0, e.index);
  return t.trim();
}

const SELF_TEST_TEXT = `
CHAPTER I. The Question

To be, or not to be, that is the question:
Whether 'tis nobler in the mind to suffer
The slings and arrows of outrageous fortune,
Or to take arms against a sea of troubles,
And by opposing end them.
${"Thus conscience does make cowards of us all, and the native hue of resolution is sicklied o'er with the pale cast of thought. ".repeat(30)}
`;

async function main() {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const origLog = console.log;
  console.log = () => {}; // quiet the per-migration chatter
  await runMigrations(db);
  console.log = origLog;

  if (SELF_TEST) {
    const r = await ingestWork(
      db,
      { gutenbergId: "selftest", title: "Self Test", author: "Concord", era: "test", genre: "drama", themes: ["test"], pdVerified: 1 },
      SELF_TEST_TEXT,
      { doEmbed: false },
    );
    console.log(`[self-test] ${JSON.stringify(r)}`);
    db.close();
    return;
  }

  const works = MANIFEST.slice(0, Number.isFinite(MAX) ? MAX : MANIFEST.length);
  console.log(`[gutenberg] ingesting up to ${works.length} works → ${DB_PATH}\n`);
  let ingested = 0, skipped = 0, failed = 0, chunks = 0;

  for (const w of works) {
    const sid = `gut_${w.gutenbergId}`;
    const existing = db.prepare("SELECT chunk_count FROM literary_sources WHERE id = ?").get(sid);
    if (existing && existing.chunk_count > 0) {
      console.log(`  ⤼ skip   ${w.title} (already ingested, ${existing.chunk_count} chunks)`);
      skipped += 1;
      continue;
    }
    process.stdout.write(`  … fetch  ${w.title} (PG ${w.gutenbergId}) `);
    const fetched = await fetchText(w.gutenbergId);
    if (!fetched) {
      console.log("✗ unavailable");
      failed += 1;
      continue;
    }
    const body = stripBoilerplate(fetched.text);
    const res = await ingestWork(db, { ...w, url: fetched.url, license: "public_domain", pdVerified: 1 }, body, {});
    if (res.ok && !res.skipped) {
      console.log(`✓ ${res.chunks} chunks${res.embedded ? `, ${res.embedded} embedded` : ""}`);
      ingested += 1; chunks += res.chunks;
    } else if (res.skipped) {
      console.log("⤼ already ingested"); skipped += 1;
    } else {
      console.log(`✗ ${res.error || "ingest failed"}`); failed += 1;
    }
  }

  console.log(`\n[gutenberg] done — ${ingested} ingested (${chunks} chunks), ${skipped} skipped, ${failed} failed`);
  db.close();
}

main().catch((e) => { console.error("[gutenberg] fatal:", e?.message || e); process.exit(1); });
