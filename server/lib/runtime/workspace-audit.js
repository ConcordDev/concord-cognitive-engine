// server/lib/runtime/workspace-audit.js
//
// Audits workspace for API keys, data sources, connectors, news feeds.
// Reports env var NAMES and source locations — never prints secret values.

import crypto from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const KEY_PATTERNS = [
  /^(?:[A-Z0-9_]*(?:API_KEY|APIKEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY))$/i,
  /^(?:BRAIN_|OLLAMA_|OPENAI_|ANTHROPIC_|GEMINI_|GROQ_|MISTRAL_|NASA_|NEWS_)/i,
];

const DATA_SOURCE_MARKERS = [
  { id: "rss_feeds", pattern: /RSS_FEEDS|addRSSFeed|fetchRSSFeed/i, kind: "news" },
  { id: "nasa_apod", pattern: /NASA_API_KEY|astronomy\.apod/i, kind: "science" },
  { id: "coingecko", pattern: /coingecko|COINGECKO/i, kind: "markets" },
  { id: "usgs_noaa", pattern: /USGS|NOAA|data\.gov/i, kind: "government" },
  { id: "itunes_jamendo", pattern: /itunes|jamendo|audius/i, kind: "music" },
  { id: "connectors", pattern: /connectorFetch|connector-client/i, kind: "connector" },
  { id: "ollama_brains", pattern: /BRAIN_(CONSCIOUS|SUBCONSCIOUS|UTILITY|REPAIR|VISION)/i, kind: "llm" },
  { id: "platform_providers", pattern: /platform-providers|HIGH_POWER/i, kind: "llm" },
  { id: "dila_workers", pattern: /dila-workers|llm-workers/i, kind: "workers" },
  { id: "predict_tickets", pattern: /prediction_tickets|proactive_list_predictions/i, kind: "predict" },
];

function auditId() {
  return `aud_${crypto.randomUUID().slice(0, 12)}`;
}

async function readEnvFileNames(repoRoot) {
  const names = new Set();
  const files = [".env", ".env.runpod", ".env.local", "server/.env"];
  for (const f of files) {
    try {
      const content = await readFile(join(repoRoot, f), "utf8");
      for (const line of content.split("\n")) {
        const m = line.match(/^([A-Z][A-Z0-9_]*)=/);
        if (!m) continue;
        const key = m[1];
        if (KEY_PATTERNS.some((re) => re.test(key))) names.add(key);
      }
    } catch { /* missing file ok */ }
  }
  return [...names].sort();
}

async function grepMarkers(repoRoot, limit = 30) {
  const hits = [];
  const scanFiles = [
    "server/server.js",
    "server/lib/mcp-tools.js",
    "server/lib/brain-config.js",
    "server/lib/connector-client.js",
    "server/domains/music.js",
    "docs/CONNECTORS_GO_LIVE.md",
  ];
  for (const marker of DATA_SOURCE_MARKERS) {
    const matched = [];
    for (const rel of scanFiles) {
      try {
        const content = await readFile(join(repoRoot, rel), "utf8");
        if (marker.pattern.test(content)) matched.push(rel);
      } catch { /* missing */ }
    }
    hits.push({
      id: marker.id,
      kind: marker.kind,
      fileCount: matched.length,
      sampleFiles: matched.slice(0, limit),
    });
  }
  return hits;
}

async function listConnectorDomains(repoRoot) {
  try {
    const domainsDir = join(repoRoot, "server/domains");
    const files = await readdir(domainsDir);
    const connectors = files.filter((f) =>
      ["slack", "sheets", "github", "notion", "gmail", "calendar"].some((c) => f.includes(c)),
    );
    return connectors.map((f) => f.replace(/\.js$/, ""));
  } catch {
    return [];
  }
}

export async function runWorkspaceAudit({ db, repoRoot } = {}) {
  const root = repoRoot || process.cwd().replace(/\/server$/, "") || process.cwd();
  const id = auditId();
  const started = Date.now();

  const envKeyNames = await readEnvFileNames(root);
  const dataSources = await grepMarkers(root);
  const connectors = await listConnectorDomains(root);

  const runtimeEnv = {
    authGateMode: process.env.CONCORD_AUTH_GATE_MODE || "observe",
    enforceAutonomous: process.env.CONCORD_AUTH_GATE_ENFORCE_AUTONOMOUS === "true",
    missionRuntime: process.env.CONCORD_MISSION_RUNTIME !== "0",
    highPowerRouting: process.env.CONCORD_HIGH_POWER_ROUTING === "1",
    brains: {
      conscious: process.env.BRAIN_CONSCIOUS_URL || "default",
      subconscious: process.env.BRAIN_SUBCONSCIOUS_URL || "default",
      utility: process.env.BRAIN_UTILITY_URL || "default",
    },
  };

  const summary = {
    envKeyNames,
    envKeyCount: envKeyNames.length,
    dataSources,
    connectors,
    runtimeEnv,
    durationMs: Date.now() - started,
    auditedAt: Math.floor(Date.now() / 1000),
  };

  if (db) {
    try {
      db.prepare(`
        INSERT INTO runtime_workspace_audits (id, status, summary_json, created_at, completed_at)
        VALUES (?, 'completed', ?, ?, ?)
      `).run(id, JSON.stringify(summary), summary.auditedAt, summary.auditedAt);
    } catch { /* optional */ }
  }

  return { ok: true, auditId: id, summary };
}

export function listWorkspaceAudits(db, limit = 10) {
  if (!db) return [];
  try {
    return db.prepare(`
      SELECT id, status, created_at, completed_at, summary_json
      FROM runtime_workspace_audits
      ORDER BY created_at DESC LIMIT ?
    `).all(Math.min(limit, 50)).map((r) => ({
      ...r,
      summary: r.summary_json ? JSON.parse(r.summary_json) : null,
    }));
  } catch {
    return [];
  }
}
