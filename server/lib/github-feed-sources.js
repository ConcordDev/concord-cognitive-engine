// server/lib/github-feed-sources.js
//
// GitHub repository-topic search routed through lib/feed-cache.js. Every lens
// widget that lists "top repos for topic X" used to call api.github.com from
// the visitor's browser, spending a per-IP budget (10/min unauthenticated) per
// visitor. Behind the server there is ONE budget, so the source below is a long
// TTL shared cache: one upstream request per (topic, perPage) per 6 h.
//
// No generic proxy: the topic must be in TOPIC_ALLOWLIST (the literal topics the
// components offer), perPage is clamped to 1..25 and sort=stars&order=desc is
// fixed. The URL is built here from those validated values only; nothing about
// the host or path comes from a client.
//
// Honesty: a failure is never cached as data. Stale data is served with
// stale:true + fetchedAt; when nothing truthful exists the caller gets
// { ok:false, status:"unavailable", reason, lastOkAt }. GITHUB_TOKEN is read from
// the environment at fetch time and only ever placed in the Authorization header:
// it is never part of a cache key, a result or a log line.
//
// Phase 8b adds, on the same pattern: trending-by-creation-date (shares the
// github-search source/budget) and the "github-core" source (repo releases/forks,
// public gists, security advisories). owner/repo are validated against a strict
// charset and every other parameter against an allowlist: still no free-form URL.
//
// Sources register on import (register-once via hasSource) and again on demand
// via ensureGithubFeedSources(), because feed-cache's test reset clears them.

import { registerSource, hasSource, get, _resetFeedCacheForTests } from "./feed-cache.js";
import { fetchPublicUrl } from "./public-fetch.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const GITHUB_SEARCH_SOURCE = "github-search";
export const GITHUB_CORE_SOURCE = "github-core";
const GITHUB_API = "https://api.github.com";
const GITHUB_SEARCH_URL = "https://api.github.com/search/repositories";
const USER_AGENT = "concord-code-lens";

/** Literal topics the lens components offer (grep "topic:" in concord-frontend/components). */
export const TOPIC_ALLOWLIST = new Set([
  "5g", "accessibility", "agent-based-modeling", "agile", "airbyte", "anki", "ansible", "api", "arduino",
  "arrow", "audio-processing", "authentication", "autonomous-driving", "avro", "awesome-list",
  "backend-as-a-service", "bounty", "canvas", "category-theory", "cellular-automata", "chat", "cli",
  "cli-tool", "collaboration", "command-line-tool", "component-library", "computer-vision", "crawler",
  "crdt", "cron", "crowdfunding", "cryptography", "csv", "data-export", "data-import", "data-warehouse",
  "database", "daw", "deep-learning", "dependent-types", "design-system", "developer-tools", "devops",
  "discrete-event-simulation", "docker", "docs-as-code", "documentation", "ecs", "edge-computing",
  "electronics", "embedded-systems", "encryption", "end-to-end-encryption", "etl", "excalidraw", "figma",
  "file-transfer", "firecracker", "flashcards", "formal-verification", "foundry-vtt", "fpga", "fractal",
  "fundraising", "game-ai", "game-engine", "gamedev", "gantt", "generative-art", "gitops", "godot",
  "good-first-issue", "gpu", "graph", "graph-database", "graph-visualization", "graphql", "graphql-schema",
  "gtd", "hacktoberfest", "humanoid", "icon-set", "inference", "ingestion", "ipfs", "jetbrains-plugin",
  "job-queue", "json-schema", "kafka", "kanban", "kicad", "knowledge-graph", "kubernetes", "l-system",
  "language-server", "lattice", "libp2p", "llm", "local-first", "log-aggregation", "logging", "lora", "lte",
  "machine-learning", "mandelbrot", "markdown", "matrix-protocol", "mcp", "memory", "mesh-network",
  "meshtastic", "message-queue", "messaging", "metaverse", "midi", "mlops", "mmorpg", "model-checking",
  "mongodb", "monitoring", "monte-carlo", "motion-planning", "mysql", "nats", "neo4j", "nlp", "noise",
  "nosql", "note-taking", "oauth", "observability", "offline-first", "ontology", "open-hardware",
  "open-source", "openapi", "opentelemetry", "orm", "p2p", "p2p-file-sharing", "paas", "parquet",
  "password-manager", "patreon", "pcb", "physics-simulation", "platform-engineering", "playground",
  "postgresql", "procedural-generation", "productivity", "productivity-tool", "project-management",
  "prometheus", "proof-assistant", "protobuf", "pubsub", "pwa", "pytorch", "rabbitmq", "rdf",
  "react-component", "redis", "reinforcement-learning", "replication", "robotics", "roguelike", "ros",
  "rsync", "sandbox", "scheduler", "scraper", "scrum", "sdk", "sdr", "security", "semantic-web",
  "serialization", "serverless", "service-worker", "shadcn-ui", "shader", "signal-protocol", "simulation",
  "slam", "smt", "spaced-repetition", "sparql", "speech-recognition", "speech-to-text", "sponsorship",
  "sqlite", "sre", "static-site-generator", "storybook", "streaming", "sync", "syncthing", "synthesis",
  "tailwindcss", "task-manager", "technical-writing", "telecommunications", "temporal-workflow", "tensorrt",
  "terraform", "theorem-proving", "three-js", "time-series", "time-tracking", "tldraw", "todo", "tokens",
  "tracing", "transformers", "tts", "ui-components", "unity", "validation", "vector-database",
  "voice-assistant", "voip", "voxel", "vrchat", "vscode-extension", "wasm", "web-audio", "webhook", "webrtc",
  "webxr", "whisper", "whiteboard", "wireguard", "workflow", "world-building", "xmpp", "zapier",
  "zero-trust",
]);

export const TRENDING_DAYS = new Set([1, 7, 30]);
/** Languages the trending widgets offer. */
export const LANG_ALLOWLIST = new Set(["TypeScript", "JavaScript", "Python", "Rust", "Go", "C++", "Java", "Swift", "Ruby"]);
export const ECOSYSTEM_ALLOWLIST = new Set([
  "actions", "composer", "erlang", "go", "maven", "npm", "nuget", "other", "pip", "pub", "rubygems", "rust", "swift",
]);
export const SEVERITY_ALLOWLIST = new Set(["unknown", "low", "medium", "high", "critical"]);
export const REPO_META_KINDS = new Set(["releases", "forks"]);
const NAME_RE = /^[A-Za-z0-9_.-]{1,100}$/;
const TTL_BY_KIND = { releases: HOUR, forks: HOUR, gists: 30 * MIN, advisories: 6 * HOUR };

class UpstreamError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

// Test-only transport; null => the SSRF-guarded fetchPublicUrl.
let _transport = null;
export function setGithubTransportForTests(fn) { _transport = typeof fn === "function" ? fn : null; }

function clampPerPage(v) {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n)) return 25;
  return Math.max(1, Math.min(25, n));
}

/** Canonical cache key, or null when the topic is not allowlisted. */
export function githubSearchKey({ topic, perPage } = {}) {
  const t = typeof topic === "string" ? topic.trim().toLowerCase() : "";
  if (!TOPIC_ALLOWLIST.has(t)) return null;
  return `${t}|${clampPerPage(perPage)}`;
}

function githubHeaders() {
  const token = typeof process.env.GITHUB_TOKEN === "string" ? process.env.GITHUB_TOKEN.trim() : "";
  return {
    "User-Agent": USER_AGENT,
    Accept: "application/vnd.github+json",
    ...(token && { Authorization: `Bearer ${token}` }),
  };
}

const TRIM = (r) => ({
  id: r.id,
  full_name: r.full_name,
  html_url: r.html_url,
  description: r.description ?? null,
  stargazers_count: r.stargazers_count,
  forks_count: r.forks_count,
  open_issues_count: r.open_issues_count,
  language: r.language ?? null,
  license: r.license ? { spdx_id: r.license.spdx_id ?? null } : null,
  topics: Array.isArray(r.topics) ? r.topics : undefined,
  pushed_at: r.pushed_at,
});

// key "topic|perPage" -> { items }. Only validated key parts reach the URL.
async function githubGetJson(url, signal) {
  const init = { headers: githubHeaders(), signal };
  const r = _transport ? await _transport(url, init) : await fetchPublicUrl(url, init);
  if (!r || r.ok !== true) {
    const status = Number(r?.status) || 0;
    // Status only: never the response body or any header (those may echo credentials).
    throw new UpstreamError(status === 403 || status === 429 ? "github_rate_limited" : `github_http_${status || "error"}`, status);
  }
  return r.json();
}

// Keys: "topic|perPage" (topic search) or "trending|days|lang" (created-since search).
async function fetchGithubSearch(key, { signal }) {
  let url;
  if (key.startsWith("trending|")) {
    const [, days, lang] = key.split("|");
    const since = new Date(Date.now() - Number(days) * DAY).toISOString().slice(0, 10);
    const q = `created:>${since}${lang ? ` language:${lang}` : ""}`;
    url = `${GITHUB_SEARCH_URL}?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=25`;
  } else {
    const [topic, perPage] = key.split("|");
    url = `${GITHUB_SEARCH_URL}?q=${encodeURIComponent(`topic:${topic}`)}&sort=stars&order=desc&per_page=${clampPerPage(perPage)}`;
  }
  const body = await githubGetJson(url, signal);
  return { items: (Array.isArray(body?.items) ? body.items : []).map(TRIM) };
}

const str = (v, max) => (typeof v === "string" ? v : "").slice(0, max);
const TRIM_RELEASE = (r) => ({
  id: r.id, tag_name: r.tag_name, name: r.name ?? null, draft: !!r.draft, prerelease: !!r.prerelease,
  published_at: r.published_at, html_url: r.html_url, author: r.author?.login ? { login: r.author.login } : null,
  body: str(r.body, 2000),
});
const TRIM_FORK = (r) => ({
  id: r.id, full_name: r.full_name, html_url: r.html_url, description: r.description ?? null,
  stargazers_count: r.stargazers_count, forks_count: r.forks_count, pushed_at: r.pushed_at,
  owner: r.owner?.login ? { login: r.owner.login } : null,
});
const TRIM_GIST = (g) => ({
  id: g.id, description: g.description ?? null, html_url: g.html_url, public: !!g.public,
  files: Object.fromEntries(Object.entries(g.files || {}).map(([k, f]) => [k, { filename: f.filename, language: f.language ?? null, size: f.size, raw_url: f.raw_url }])),
  owner: g.owner ? { login: g.owner.login, avatar_url: g.owner.avatar_url } : undefined,
  created_at: g.created_at, updated_at: g.updated_at, comments: g.comments,
});
const TRIM_ADVISORY = (a) => ({
  ghsa_id: a.ghsa_id, cve_id: a.cve_id ?? undefined, summary: str(a.summary, 500), severity: a.severity,
  published_at: a.published_at, html_url: a.html_url, type: a.type,
  cvss: a.cvss ? { score: a.cvss.score, vector_string: a.cvss.vector_string } : undefined,
  vulnerabilities: (Array.isArray(a.vulnerabilities) ? a.vulnerabilities : []).slice(0, 10).map((v) => ({
    package: v.package ? { ecosystem: v.package.ecosystem, name: v.package.name } : undefined,
    vulnerable_version_range: v.vulnerable_version_range,
  })),
});

// Keys: "releases|owner|repo", "forks|owner|repo", "gists", "advisories|ecosystem|severity".
// Only parts validated by the public functions below ever reach here.
async function fetchGithubCore(key, { signal }) {
  const [kind, a, b] = key.split("|");
  if (kind === "releases" || kind === "forks") {
    const base = `${GITHUB_API}/repos/${encodeURIComponent(a)}/${encodeURIComponent(b)}`;
    const body = await githubGetJson(kind === "releases" ? `${base}/releases?per_page=30` : `${base}/forks?sort=stargazers&per_page=30`, signal);
    return { items: (Array.isArray(body) ? body : []).map(kind === "releases" ? TRIM_RELEASE : TRIM_FORK) };
  }
  if (kind === "gists") {
    const body = await githubGetJson(`${GITHUB_API}/gists/public?per_page=30`, signal);
    return { items: (Array.isArray(body) ? body : []).map(TRIM_GIST) };
  }
  if (kind === "advisories") {
    const p = new URLSearchParams({ per_page: "30" });
    if (a) p.set("ecosystem", a);
    if (b) p.set("severity", b);
    const body = await githubGetJson(`${GITHUB_API}/advisories?${p}`, signal);
    return { items: (Array.isArray(body) ? body : []).map(TRIM_ADVISORY) };
  }
  throw new UpstreamError("github_bad_key", 0);
}

const sources = () => [
  [GITHUB_SEARCH_SOURCE, {
    ttlMs: 6 * HOUR,
    staleMaxMs: 7 * DAY,
    // Search API: 10/min unauthenticated, 30/min with a token.
    budget: { perMin: process.env.GITHUB_TOKEN ? 25 : 8, perDay: 2000, minSpacingMs: 0 },
    timeoutMs: 10_000,
    license: "public",
    persist: true,
    maxKeys: 500,
    fetcher: fetchGithubSearch,
  }],
  [GITHUB_CORE_SOURCE, {
    ttlMs: HOUR,
    staleMaxMs: 7 * DAY,
    // Core REST: 60/h unauthenticated, 5000/h with a token.
    budget: { perMin: process.env.GITHUB_TOKEN ? 25 : 10, perDay: 1000, minSpacingMs: 0 },
    timeoutMs: 10_000,
    license: "public",
    persist: true,
    maxKeys: 2000,
    fetcher: fetchGithubCore,
  }],
];

/** Register-once; safe to call repeatedly (feed-cache's test reset clears the registry). */
export function ensureGithubFeedSources() {
  for (const [id, cfg] of sources()) {
    if (!hasSource(id)) registerSource(id, cfg);
  }
}
ensureGithubFeedSources();

/**
 * Top repositories for an allowlisted topic, through the shared cache.
 * @returns {Promise<{ok:true,items:object[],stale:boolean,fetchedAt:number}|{ok:false,status:"unavailable"|"invalid_topic",reason:string,lastOkAt?:number|null}>}
 */
export async function githubTopicSearch({ topic, perPage } = {}) {
  const key = githubSearchKey({ topic, perPage });
  if (!key) return { ok: false, status: "invalid_topic", reason: "topic_not_allowed" };
  ensureGithubFeedSources();
  const r = await get(GITHUB_SEARCH_SOURCE, key);
  if (r.status === "unavailable" || r.data == null) {
    return { ok: false, status: "unavailable", reason: String(r.reason || "") || "unavailable", lastOkAt: r.lastOkAt ?? null };
  }
  return { ok: true, items: r.data.items || [], stale: !!r.stale, fetchedAt: r.fetchedAt };
}

async function viaCache(sourceId, key, ttlMs) {
  ensureGithubFeedSources();
  const r = await get(sourceId, key, { ttlMs });
  if (r.status === "unavailable" || r.data == null) {
    return { ok: false, status: "unavailable", reason: String(r.reason || "") || "unavailable", lastOkAt: r.lastOkAt ?? null };
  }
  return { ok: true, items: r.data.items || [], stale: !!r.stale, fetchedAt: r.fetchedAt };
}

/** Repos created in the last sinceDays (1|7|30), optionally one allowlisted language. Shares the github-search budget. */
export async function githubTrending({ sinceDays, lang } = {}) {
  const days = Number(sinceDays);
  if (!TRENDING_DAYS.has(days)) return { ok: false, status: "invalid_params", reason: "sinceDays_not_allowed" };
  const l = lang == null || lang === "" ? "" : lang;
  if (l !== "" && !LANG_ALLOWLIST.has(l)) return { ok: false, status: "invalid_params", reason: "lang_not_allowed" };
  return viaCache(GITHUB_SEARCH_SOURCE, `trending|${days}|${l}`, 6 * HOUR);
}

/** Releases or forks of one repo. owner/repo must match ^[A-Za-z0-9_.-]{1,100}$. */
export async function githubRepoMeta({ owner, repo, kind } = {}) {
  if (!REPO_META_KINDS.has(kind)) return { ok: false, status: "invalid_params", reason: "kind_not_allowed" };
  if (typeof owner !== "string" || typeof repo !== "string" || !NAME_RE.test(owner) || !NAME_RE.test(repo)) {
    return { ok: false, status: "invalid_params", reason: "owner_or_repo_invalid" };
  }
  return viaCache(GITHUB_CORE_SOURCE, `${kind}|${owner}|${repo}`, TTL_BY_KIND[kind]);
}

export async function githubGistsPublic() {
  return viaCache(GITHUB_CORE_SOURCE, "gists", TTL_BY_KIND.gists);
}

/** Global security advisories, optionally narrowed by allowlisted ecosystem / severity. */
export async function githubAdvisories({ ecosystem, severity } = {}) {
  const e = ecosystem == null || ecosystem === "" ? "" : ecosystem;
  const v = severity == null || severity === "" ? "" : severity;
  if (e !== "" && !ECOSYSTEM_ALLOWLIST.has(e)) return { ok: false, status: "invalid_params", reason: "ecosystem_not_allowed" };
  if (v !== "" && !SEVERITY_ALLOWLIST.has(v)) return { ok: false, status: "invalid_params", reason: "severity_not_allowed" };
  return viaCache(GITHUB_CORE_SOURCE, `advisories|${e}|${v}`, TTL_BY_KIND.advisories);
}

/** Test hook: forget every cached entry and any test transport. */
export function _resetGithubFeedForTests() {
  _resetFeedCacheForTests();
  ensureGithubFeedSources();
  setGithubTransportForTests(null);
}
