// server/lib/runtime/provider-env-loader.js
//
// Load provider API keys from env files without overwriting already-set vars.
// Never logs key values.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const PROVIDER_KEY_SPECS = Object.freeze({
  groq: ["GROQ_API_KEY", "CONCORD_PLATFORM_GROQ_API_KEY"],
  google: ["GEMINI_API_KEY", "GOOGLE_API_KEY", "CONCORD_PLATFORM_GOOGLE_API_KEY"],
  mistral: ["MISTRAL_API_KEY", "CONCORD_PLATFORM_MISTRAL_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  cerebras: ["CEREBRAS_API_KEY"],
  xai: ["XAI_API_KEY"],
  cloudflare: ["CLOUDFLARE_API_TOKEN"],
});

const DEFAULT_ENV_PATHS = [
  "workers.env",
  "server/workers.env",
  "../workers.env",
  "../.env",
  "server/.env",
  "server/.env.local",
  ".env",
  ".env.local",
  ".env.runpod",
  join(homedir(), "concord", ".env"),
  join(homedir(), ".concord", "provider-keys.env"),
  join(homedir(), ".config", "concord", "provider-keys.env"),
  join(homedir(), ".config", "concord", "workers.env"),
];

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const eq = trimmed.indexOf("=");
  if (eq <= 0) return null;
  const key = trimmed.slice(0, eq).trim();
  let value = trimmed.slice(eq + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return { key, value };
}

/**
 * Load KEY=VALUE pairs from a dotenv file into process.env (only unset keys).
 */
export function loadEnvFile(filePath, { overwrite = false } = {}) {
  const abs = resolve(filePath);
  if (!existsSync(abs)) return { ok: false, reason: "missing", path: abs, loaded: 0 };

  let loaded = 0;
  const text = readFileSync(abs, "utf8");
  for (const line of text.split("\n")) {
    const parsed = parseEnvLine(line);
    if (!parsed?.key) continue;
    if (!overwrite && process.env[parsed.key]) continue;
    process.env[parsed.key] = parsed.value;
    loaded += 1;
  }
  return { ok: true, path: abs, loaded };
}

/**
 * Load from default search paths relative to repo root.
 */
export function loadProviderEnv({ repoRoot = process.cwd(), extraPaths = [] } = {}) {
  const paths = [...extraPaths, ...DEFAULT_ENV_PATHS.map((p) => join(repoRoot, p))];
  const results = [];
  let total = 0;
  for (const p of paths) {
    const r = loadEnvFile(p);
    if (r.ok && r.loaded > 0) {
      results.push(r);
      total += r.loaded;
    }
  }
  return { ok: true, results, totalLoaded: total, searched: paths };
}

/**
 * Resolve configured providers and their env var source (names only).
 */
export function resolveConfiguredProviders() {
  const configured = [];
  for (const [provider, envNames] of Object.entries(PROVIDER_KEY_SPECS)) {
    const hit = envNames.find((name) => {
      const v = process.env[name];
      return typeof v === "string" && v.length > 8;
    });
    if (hit) configured.push({ provider, envVar: hit, keyLen: process.env[hit].length });
  }
  return configured;
}

export function apiKeyForProvider(provider) {
  const names = PROVIDER_KEY_SPECS[provider];
  if (!names) return null;
  for (const name of names) {
    const v = process.env[name];
    if (v && v.length > 8) return v;
  }
  return null;
}
