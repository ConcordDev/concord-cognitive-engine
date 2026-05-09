/**
 * Local LLM Fallback via llama.cpp
 *
 * Spawns llama-cli as a child process for basic LLM capability
 * when Ollama is unavailable. Completely optional — if binary
 * or model not found, silently returns null (skip to next tier).
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import logger from "../logger.js";

const LLAMA_BIN = process.env.LLAMA_CPP_BIN || _findBinary();
const LLAMA_MODEL = process.env.LLAMA_CPP_MODEL || _findModel();
const TIMEOUT_MS = 15_000;
const MAX_TOKENS = 512;

let _available = null; // null = unchecked, true/false after first probe

function _findBinary() {
  const candidates = ["llama-cli", "llama.cpp/main", "/usr/local/bin/llama-cli", "./bin/llama-cli"];
  for (const c of candidates) {
    // Can't check PATH binaries with existsSync, just return the first candidate
    // execFile will fail gracefully if not found
    if (c.startsWith("/") && existsSync(c)) return c;
  }
  return "llama-cli"; // default, rely on PATH
}

function _findModel() {
  const candidates = [
    process.env.LLAMA_CPP_MODEL,
    "./models/fallback.gguf",
    "/data/models/fallback.gguf",
    path.join(process.cwd(), "models", "fallback.gguf"),
  ].filter(Boolean);
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

/**
 * Check if llama.cpp is available.
 */
function isAvailable() {
  if (_available !== null) return _available;
  if (!LLAMA_MODEL || !existsSync(LLAMA_MODEL)) {
    _available = false;
    return false;
  }
  // Probe by running --version (fast, doesn't load model)
  return new Promise((resolve) => {
    execFile(LLAMA_BIN, ["--version"], { timeout: 5000 }, (err) => {
      _available = !err;
      if (!_available) {
        logger.log("info", "lib", "llama_cpp_not_available", { bin: LLAMA_BIN, model: LLAMA_MODEL, error: err?.message });
      }
      resolve(_available);
    });
  });
}

/**
 * Generate a response using llama.cpp.
 * @param {Array<{role: string, content: string}>} messages
 * @param {object} opts - { temperature, maxTokens }
 * @returns {Promise<{ ok: boolean, text: string } | null>}
 */
export async function generate(messages, opts = {}) {
  if (_available === false) return null;
  if (_available === null) {
    const avail = await isAvailable();
    if (!avail) return null;
  }

  // Build prompt from messages (simple concatenation)
  const prompt = messages.map(m => {
    if (m.role === "system") return `System: ${m.content}`;
    if (m.role === "user") return `User: ${m.content}`;
    if (m.role === "assistant") return `Assistant: ${m.content}`;
    return m.content;
  }).join("\n") + "\nAssistant:";

  const maxTokens = opts.maxTokens || MAX_TOKENS;
  const temperature = opts.temperature ?? 0.3;

  const args = [
    "-m", LLAMA_MODEL,
    "-p", prompt,
    "-n", String(maxTokens),
    "--temp", String(temperature),
    "--no-display-prompt",
    "-e",
  ];

  return new Promise((resolve) => {
    execFile(LLAMA_BIN, args, { timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        logger.log("debug", "lib", "llama_cpp_generate_failed", { error: err?.message });
        if (err.code === "ENOENT") _available = false;
        resolve(null);
        return;
      }
      const text = (stdout || "").trim();
      if (!text) {
        resolve(null);
        return;
      }
      resolve({ ok: true, text });
    });
  });
}
