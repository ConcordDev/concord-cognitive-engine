// server/lib/detectors/env-config-drift-detector.js
//
// Catches category #4 (config / env drift): values that should live in
// env vars or config but are hardcoded in production code paths.
//
// Patterns:
//   - http(s):// URLs in non-test code that aren't already coming from env
//   - localhost / 127.0.0.1 / 0.0.0.0 hardcoded
//   - Magic ports (5050, 11434, 11435, 3000, 5432) hardcoded
//   - Numeric timeout literals > 5000 ms in API paths
//   - Hardcoded service paths like "/var/lib/", "/tmp/concord"
//
// Severities:
//   high   — production URL hardcoded (api.concord-os.org, etc)
//   medium — localhost / 127.0.0.1 hardcoded outside config + dev paths
//   low    — port numbers hardcoded outside CONST exports
//   info   — magic timeout literals

import path from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { makeReport, makeError } from "./_framework.js";

const CATEGORY = "env-config-drift";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../../");

const SCAN_PATHS = ["server/lib", "server/routes", "server/economy", "server/emergent", "concord-frontend/lib", "concord-frontend/components", "concord-frontend/hooks", "concord-frontend/app"];
const SKIP_DIRS = new Set(["node_modules", ".git", "coverage", "dist", "build", ".next", "audit", "tests", "__tests__", "docs", "scripts"]);

function isInteresting(file) {
  return /\.(js|ts|tsx|jsx|mjs)$/.test(file);
}

async function* walk(root, base = root) {
  let entries;
  try { entries = await readdir(base, { withFileTypes: true }); }
  catch { return; }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(base, entry.name);
    if (entry.isDirectory()) yield* walk(root, full);
    else if (entry.isFile() && isInteresting(entry.name)) yield path.relative(root, full);
  }
}

function shouldScan(rel) {
  if (/\b(test|spec|fixtures?)\.(js|ts|tsx|jsx)$/.test(rel)) return false;
  return SCAN_PATHS.some(p => rel.startsWith(p + "/"));
}

const PROD_URL_RE = /['"`](https?:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0|::1)[^'"`]+\.[a-z]{2,}[^'"`]*)['"`]/g;
// RFC 6761 / W3 namespace / template / brand URLs that look prod but aren't.
// Also includes well-known external service URLs that legitimately don't
// belong in an env var (CDN libraries, marketplace listings, public docs).
const PLACEHOLDER_URL_RE = /(?:^|\b)(example\.com|example\.org|example\.net|\.example(?:\b|\/)|\.test(?:\b|\/)|\.invalid(?:\b|\/)|w3\.org|your-[a-z-]+\.com|[a-z][\w-]*\.example|placeholder|concord-os\.org(?:\/|$|"|`|')|github\.com\/|claude\.ai\/|anthropic\.com|mit-license\.org|marketplace\.visualstudio\.com|plugins\.jetbrains\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|unpkg\.com|registry\.npmjs\.org|nodejs\.org|developer\.mozilla\.org|python\.org|openapis\.org|swagger\.io|json-schema\.org|fonts\.googleapis\.com|fonts\.gstatic\.com|stripe\.com\/docs|docs\.stripe\.com|fediverse\.party|activitypub\.rocks|webfinger\.net|gravatar\.com|googleapis\.com|matrix\.org|element\.io|raw\.githubusercontent\.com|api\.github\.com|api\.openai\.com|api\.anthropic\.com|api\.stripe\.com|youtube\.com|youtu\.be|wikipedia\.org|wikimedia\.org|creativecommons\.org)/i;
// Well-known PUBLIC third-party API endpoints. These are stable, public,
// vendor-published base URLs (open data / science / OAuth / WebRTC) that
// correctly do NOT belong in an env var — they're not deployment-specific
// configuration, they're the public contract of the upstream service.
// Conservative: only clearly-public-API hosts go here. Anchored on
// `://[sub.]host` so prefix-shadowing (`evil-arxiv.org`) can't match.
const PUBLIC_API_HOST_RE = new RegExp(
  "^https?:\\/\\/(?:www\\.|[a-z0-9-]+\\.)*(?:" + [
    // Government / science open-data + biomedical
    "ncbi\\.nlm\\.nih\\.gov", "nlm\\.nih\\.gov", "nih\\.gov",
    "nist\\.gov", "nasa\\.gov", "gsfc\\.nasa\\.gov", "usgs\\.gov",
    "fda\\.gov", "fema\\.gov", "data\\.gov", "cms\\.hhs\\.gov",
    "nhtsa\\.dot\\.gov", "nhtsa\\.gov", "bls\\.gov", "usaspending\\.gov",
    "nal\\.usda\\.gov", "aviationweather\\.gov",
    // Academic / reference / open knowledge
    "export\\.arxiv\\.org", "arxiv\\.org", "openstax\\.org",
    "courtlistener\\.com", "wikidata\\.org", "musicbrainz\\.org",
    "openfoodfacts\\.org", "openlibrary\\.org", "gutendex\\.com",
    "gutenberg\\.org", "gbif\\.org", "restcountries\\.com",
    "doi\\.org", "worldbank\\.org", "propublica\\.org",
    "materialsproject\\.org", "trefle\\.io", "zenquotes\\.io",
    "commoncrawl\\.org", "index\\.commoncrawl\\.org",
    // Public data / utility APIs
    "coingecko\\.com", "stackexchange\\.com", "algolia\\.com",
    "ycombinator\\.com", "open-meteo\\.com", "boardgamegeek\\.com",
    "sunrise-sunset\\.org", "wheretheiss\\.at", "spacexdata\\.com",
    "thespacedevs\\.com", "earthquake\\.usgs\\.gov", "imgflip\\.com",
    "torproject\\.org", "sketchfab\\.com", "qrserver\\.com",
    "finance\\.yahoo\\.com", "aviationapi\\.com", "artic\\.edu",
    "eonet\\.gsfc\\.nasa\\.gov", "openrouter\\.ai", "reddit\\.com",
    // OAuth authorize / token + identity discovery hosts
    "accounts\\.google\\.com", "oauth2\\.googleapis\\.com",
    "slack\\.com", "webfinger\\.net",
    // WebRTC / TURN (Cloudflare Realtime)
    "rtc\\.live\\.cloudflare\\.com",
    // Stripe.js public loader CDN (required fixed URL, not config)
    "js\\.stripe\\.com",
  // Boundary after the host: a path/query/fragment/port separator, the
  // end of the string, OR a `${` template-interpolation (e.g.
  // `reddit.com${p.permalink}`) / closing quote — all of which mean the
  // host token ended exactly here and isn't a prefix of a longer host.
  ].join("|") + ")(?:[/:?#$'\"`]|$)",
  "i",
);
// Federation discovery is a protocol path, not a configurable URL — the
// host comes from a runtime variable (`https://${host}/.well-known/...`).
const WELL_KNOWN_PATH_RE = /\/\.well-known\//;

const LOCALHOST_RE = /['"`](https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?[^'"`]*)['"`]/g;
const KNOWN_PORTS = new Set([5050, 11434, 11435, 11436, 11437, 11438, 3000, 3001, 5432, 6379, 9090, 3030]);
const PORT_RE = /\bport\s*[:=]\s*(\d{4,5})\b/gi;
const TIMEOUT_RE = /\b(?:timeout|TIMEOUT|delay|DELAY)\s*[:=]\s*(\d{5,7})\b/g;
const ANNOTATION_OK_RE = /@env-config-ok\b/;
const ENV_GUARD_RE = /process\.env\./;

export async function runEnvConfigDriftDetector({ root, opts = {} } = {}) {
  const t0 = Date.now();
  const repoRoot = root || REPO_ROOT;
  const findings = [];
  const fileCap = Number.isFinite(opts.fileCap) ? opts.fileCap : 5000;
  const findingCap = Number.isFinite(opts.findingCap) ? opts.findingCap : 500;
  let scanned = 0;

  try {
    for await (const rel of walk(repoRoot)) {
      if (scanned >= fileCap) break;
      if (findings.length >= findingCap) break;
      if (!shouldScan(rel)) continue;
      scanned++;

      let content;
      try { content = await readFile(path.join(repoRoot, rel), "utf-8"); } catch { continue; }
      if (ANNOTATION_OK_RE.test(content)) continue;

      const fileHasEnvFallback = ENV_GUARD_RE.test(content);
      const lines = content.split("\n");

      // Check each suspicious URL — but only flag if there's NO env fallback in the file.
      // This avoids flagging `process.env.API_URL || "https://api.concord-os.org"` as a real bug.
      let m;

      const prodRe = new RegExp(PROD_URL_RE.source, "g");
      while ((m = prodRe.exec(content)) !== null) {
        const url = m[1];
        const lineNum = content.slice(0, m.index).split("\n").length;
        const lineText = lines[lineNum - 1] || "";
        if (ANNOTATION_OK_RE.test(lineText)) continue;
        if (/process\.env\.[A-Z_]+\s*(?:\|\||,)/.test(lineText)) continue;
        if (/^\s*(?:\/\/|\/\*|\*|#)/.test(lineText)) continue;
        // Skip placeholder / reserved / standards-namespace / brand URLs.
        if (PLACEHOLDER_URL_RE.test(url)) continue;
        // Skip well-known PUBLIC third-party API endpoints (open data /
        // science / OAuth / WebRTC) — these are the upstream service's
        // public contract, not deployment config, so they correctly stay
        // hardcoded rather than env-driven.
        if (PUBLIC_API_HOST_RE.test(url)) continue;
        // Skip federation discovery (`/.well-known/webfinger`, etc.) — the
        // host is a runtime variable, the path is a fixed protocol path.
        if (WELL_KNOWN_PATH_RE.test(url)) continue;
        // Skip well-known external services that never go in env vars:
        // social share intents, map tiles, OSS docs, CDN frameworks.
        // Patterns anchored on `://hostname` so prefix-shadowing like
        // `evil-twitter.com` can't accidentally match.
        if (/^https?:\/\/(?:www\.)?(?:twitter|linkedin|facebook|reddit|mastodon|threads|t\.me|telegram|wa\.me|whatsapp|bsky\.app|bluesky)\.com\/(?:intent|sharer?|share|home|share-offsite|sharing|tweet|status|messages)(?:[/?#]|$)/i.test(url)) continue;
        if (/^https?:\/\/(?:www\.|[a-z0-9-]+\.)?(?:openstreetmap|osm)\.org(?:[/?#]|$)|^https?:\/\/[a-z0-9-]+\.tile\.openstreetmap\.org(?:[/?#]|$)|^https?:\/\/(?:www\.)?(?:maptiler|cartocdn)\.com(?:[/?#]|$)|^https?:\/\/(?:www\.)?mapbox\.com\/styles(?:[/?#]|$)|^https?:\/\/(?:www\.)?leafletjs\.com(?:[/?#]|$)/i.test(url)) continue;
        if (/^https?:\/\/[a-z]+\.lattice(?:\b|\/)/i.test(url)) continue;   // template federation hosts
        if (/^https?:\/\/[a-z]+:\/\/|^https?:\/\/data:|^https?:\/\/blob:/i.test(url)) continue; // data/blob
        findings.push({
          id: "hardcoded_prod_url",
          severity: "medium",
          kind: "static",
          category: CATEGORY,
          message: `Hardcoded production URL: ${url.slice(0, 80)}`,
          location: `${rel}:${lineNum}`,
          subject: { kind: "url", file: rel, url },
          fixHint: "Move to an env var (process.env.<NAME>) with a sensible default for dev.",
        });
        if (findings.length >= findingCap) break;
      }

      const lhRe = new RegExp(LOCALHOST_RE.source, "g");
      while ((m = lhRe.exec(content)) !== null) {
        const url = m[1];
        const lineNum = content.slice(0, m.index).split("\n").length;
        const lineText = lines[lineNum - 1] || "";
        if (ANNOTATION_OK_RE.test(lineText)) continue;
        if (/process\.env\.[A-Z_]+\s*(?:\|\||,)/.test(lineText)) continue;
        if (/^\s*(?:\/\/|\/\*|\*|#)/.test(lineText)) continue;
        // Localhost URLs are commonly fine in dev defaults — only flag if the
        // file has no env-var pattern at all (likely a forgotten hardcode).
        if (fileHasEnvFallback) continue;
        findings.push({
          id: "hardcoded_localhost",
          severity: "medium",
          kind: "static",
          category: CATEGORY,
          message: `Hardcoded localhost URL with no env-var fallback in this file: ${url}`,
          location: `${rel}:${lineNum}`,
          subject: { kind: "url", file: rel, url },
        });
        if (findings.length >= findingCap) break;
      }

      // Magic ports — flag known service ports outside CONSTANT_DEF
      const portRe = new RegExp(PORT_RE.source, "gi");
      while ((m = portRe.exec(content)) !== null) {
        const port = parseInt(m[1], 10);
        if (!KNOWN_PORTS.has(port)) continue;
        const lineNum = content.slice(0, m.index).split("\n").length;
        const lineText = lines[lineNum - 1] || "";
        if (ANNOTATION_OK_RE.test(lineText)) continue;
        if (/process\.env\./.test(lineText)) continue;
        if (/^\s*(?:const|export const)\s+[A-Z_]+\s*=/.test(lineText)) continue;
        findings.push({
          id: "magic_port",
          severity: "low",
          kind: "static",
          category: CATEGORY,
          message: `Hardcoded service port ${port} — should come from env`,
          location: `${rel}:${lineNum}`,
          subject: { kind: "port", file: rel, port },
        });
        if (findings.length >= findingCap) break;
      }

      // Timeout literals > 10s
      const timeRe = new RegExp(TIMEOUT_RE.source, "g");
      while ((m = timeRe.exec(content)) !== null) {
        const ms = parseInt(m[1], 10);
        if (ms < 10000) continue;
        const lineNum = content.slice(0, m.index).split("\n").length;
        const lineText = lines[lineNum - 1] || "";
        if (ANNOTATION_OK_RE.test(lineText)) continue;
        if (/process\.env\./.test(lineText)) continue;
        findings.push({
          id: "magic_timeout",
          severity: "info",
          kind: "static",
          category: CATEGORY,
          message: `Magic timeout ${ms}ms — consider env-driven`,
          location: `${rel}:${lineNum}`,
          subject: { kind: "timeout", file: rel, ms },
        });
      }
    }
  } catch (err) {
    return makeError(CATEGORY, "detector_threw", err, t0);
  }

  const report = makeReport(CATEGORY, findings, t0);
  report.scanned = scanned;
  return report;
}
