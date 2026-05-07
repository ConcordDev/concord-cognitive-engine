// server/lib/brain-training/runner.js
//
// Daily brain refresh runner.
//
// Pattern: in-context "training" via Ollama Modelfile rebuild.
// Each daily run pulls top-N positive-outcome interactions per
// eligible brain, formats them as in-context examples, builds a new
// Ollama model from a Modelfile that bakes the examples into the
// SYSTEM prompt, evals against held-out prompts, and atomically
// swaps the active model in brain_active_models if the eval passes.
//
// This is NOT gradient-based fine-tuning. It's curated in-context
// learning. Empirically effective for many use cases and:
//   - Cheap (no GPU training)
//   - Fast (seconds per brain)
//   - Reversible (rollback to any prior model name)
//   - Compatible with existing Ollama infra
//
// Real LoRA/QLoRA can swap in later by replacing _buildAndCreateModel
// with a HuggingFace + peft worker call. The orchestration / eval /
// swap flow stays the same.

import http from "node:http";

import { buildPositiveCorpus } from "./interaction-log.js";

// Daily-eligible brains (small enough to refresh in <30 min).
// Conscious + multimodal are too large for the daily window — they
// get weekly cadence (separate scheduler not yet wired).
const DAILY_ELIGIBLE_BRAINS = ["utility", "repair"];

// Default base models per brain (matches BRAIN_CONFIG from CLAUDE.md).
const BASE_MODELS = {
  utility:      "qwen2.5:3b",
  repair:       "qwen2.5:1.5b",
  subconscious: "qwen2.5:7b-instruct",
  conscious:    "qwen2.5:32b-instruct",
  multimodal:   "llava:13b-v1.6-vicuna",
  lattice:      "qwen2.5:0.5b",
};

const MIN_CORPUS_SIZE  = 50;    // need at least this many positive examples to rebuild
const EXAMPLES_PER_BUILD = 20;  // truncate to this many in the SYSTEM prompt
const EVAL_PASS_THRESHOLD = 0.6; // must score >= this to swap

const OLLAMA_HOST = process.env.OLLAMA_HOST || process.env.BRAIN_UTILITY_URL || "http://localhost:11434";
const OLLAMA_TIMEOUT_MS = Number(process.env.CONCORD_BRAIN_TRAIN_TIMEOUT_MS) || (5 * 60 * 1000); // 5 min per brain

/**
 * Run the daily refresh across all daily-eligible brains.
 * Returns a structured result for each brain.
 */
export async function runDailyRefresh(db, opts = {}) {
  if (!db) return { ok: false, error: "no_db" };
  const force = !!opts.force; // skip the time-window gate when set

  if (!force && !_inWindow(new Date())) {
    return { ok: true, skipped: "out_of_window" };
  }

  const baseTag = _dateTag();
  const results = [];

  for (const brainId of DAILY_ELIGIBLE_BRAINS) {
    try {
      const result = await _refreshOne(db, brainId, baseTag);
      results.push({ brainId, ...result });
    } catch (e) {
      results.push({ brainId, ok: false, error: e?.message || "exception" });
    }
  }
  return { ok: true, results, runAt: Math.floor(Date.now() / 1000) };
}

async function _refreshOne(db, brainId, baseTag) {
  const corpus = buildPositiveCorpus(db, brainId, { max: 500 });
  if (corpus.length < MIN_CORPUS_SIZE) {
    return { ok: true, skipped: "insufficient_corpus", corpusSize: corpus.length };
  }

  const examples = corpus.slice(0, EXAMPLES_PER_BUILD);
  const baseModel = BASE_MODELS[brainId];
  if (!baseModel) return { ok: false, error: "unknown_brain" };

  const newModelName = `concord-${brainId}:${baseTag}`;
  const modelfile = _buildModelfile(baseModel, brainId, examples);

  // Build the model via Ollama HTTP API. Returns when build completes
  // or fails (Ollama streams progress; we just wait for end-of-stream).
  const buildResult = await _ollamaCreate(newModelName, modelfile);
  if (!buildResult.ok) {
    return { ok: false, error: "ollama_create_failed", detail: buildResult.error };
  }

  // Evaluate the new model against a small held-out set.
  const evalScore = await _runEval(brainId, newModelName);
  const passed = evalScore >= EVAL_PASS_THRESHOLD;

  // Record + (maybe) activate.
  const recordId = `bam_${baseTag.replace(/[^a-z0-9]/gi, "")}_${brainId}`;
  db.prepare(
    `INSERT INTO brain_active_models
      (id, brain_id, model_name, base_model, corpus_size, eval_score, active)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(recordId, brainId, newModelName, baseModel, corpus.length, evalScore, passed ? 1 : 0);

  if (passed) {
    // Retire any previously-active model for this brain.
    db.prepare(
      `UPDATE brain_active_models
          SET active = 0, retired_at = unixepoch()
        WHERE brain_id = ? AND id != ? AND active = 1`,
    ).run(brainId, recordId);
  }

  return {
    ok: true,
    swapped: passed,
    modelName: newModelName,
    corpusSize: corpus.length,
    evalScore,
    passThreshold: EVAL_PASS_THRESHOLD,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Modelfile construction
// ─────────────────────────────────────────────────────────────────────

function _buildModelfile(baseModel, brainId, examples) {
  // Pull plain-text snippets from the prompt/response objects. Ollama's
  // Modelfile MESSAGE directive expects role/content pairs. We bake
  // examples into the SYSTEM prompt instead — broadly compatible
  // across model formats and keeps Modelfile size bounded.
  const exampleBlock = examples
    .map((ex, i) => {
      const p = _flattenPromptForExample(ex.prompt);
      const r = _flattenResponseForExample(ex.response);
      if (!p || !r) return null;
      return `# Example ${i + 1}\nUser: ${p.slice(0, 600)}\nAssistant: ${r.slice(0, 600)}`;
    })
    .filter(Boolean)
    .join("\n\n");

  const system = `You are Concord's ${brainId} brain. The following examples
illustrate the kinds of high-quality responses this brain has produced
in production, ranked by positive outcome (cited DTU, repaired error,
or synthesis that survived consolidation). Match this style and
quality of reasoning.

${exampleBlock}

Now respond to the user's actual prompt with the same care.`;

  // Triple-quote SYSTEM so newlines + quotes inside don't break parsing.
  const escapedSystem = system.replace(/"""/g, '\\"\\"\\"');
  return `FROM ${baseModel}\nSYSTEM """${escapedSystem}"""\nPARAMETER temperature 0.7\n`;
}

function _flattenPromptForExample(prompt) {
  if (prompt == null) return "";
  if (typeof prompt === "string") return prompt;
  if (Array.isArray(prompt)) {
    // OpenAI-style messages array
    const lastUser = [...prompt].reverse().find((m) => m?.role === "user");
    if (lastUser) return String(lastUser.content ?? "");
  }
  if (prompt.messages && Array.isArray(prompt.messages)) {
    const lastUser = [...prompt.messages].reverse().find((m) => m?.role === "user");
    if (lastUser) return String(lastUser.content ?? "");
  }
  if (prompt.input) return String(prompt.input);
  return JSON.stringify(prompt).slice(0, 600);
}

function _flattenResponseForExample(response) {
  if (response == null) return "";
  if (typeof response === "string") return response;
  if (response.message?.content) return String(response.message.content);
  if (response.choices?.[0]?.message?.content) return String(response.choices[0].message.content);
  if (response.content) return String(response.content);
  if (response.output) return String(response.output);
  return JSON.stringify(response).slice(0, 600);
}

// ─────────────────────────────────────────────────────────────────────
// Ollama HTTP client (no external dep; uses built-in http).
// ─────────────────────────────────────────────────────────────────────

function _ollamaCreate(name, modelfile) {
  const body = JSON.stringify({ name, modelfile });
  return _ollamaPost("/api/create", body, OLLAMA_TIMEOUT_MS);
}

function _ollamaGenerate(model, prompt) {
  const body = JSON.stringify({ model, prompt, stream: false });
  return _ollamaPost("/api/generate", body, 60_000);
}

function _ollamaPost(path, body, timeoutMs) {
  return new Promise((resolve) => {
    let url;
    try { url = new URL(OLLAMA_HOST + path); }
    catch { return resolve({ ok: false, error: "bad_ollama_url" }); }

    const opts = {
      method: "POST",
      hostname: url.hostname,
      port:     url.port || (url.protocol === "https:" ? 443 : 80),
      path:     url.pathname + url.search,
      headers:  { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    };

    const req = http.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ ok: true, body: data });
        } else {
          resolve({ ok: false, status: res.statusCode, body: data });
        }
      });
    });
    req.on("error", (e) => resolve({ ok: false, error: e.message }));
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ ok: false, error: "timeout" }); });
    req.write(body);
    req.end();
  });
}

// ─────────────────────────────────────────────────────────────────────
// Eval harness — small built-in prompt set per brain. A brain that
// completes responses without erroring scores 1.0; failures score 0.
// Deliberately permissive for v1 — the goal is to catch catastrophic
// regressions, not measure subtle quality. Real eval upgrades later.
// ─────────────────────────────────────────────────────────────────────

const EVAL_PROMPTS = {
  utility: [
    "Summarize this in one sentence: The cat sat on the mat.",
    "Translate to JSON: name=alice, age=30",
    "What is 17 * 23?",
    "Continue the list: red, orange, yellow,",
    "Categorize: apple, banana, screwdriver, hammer",
  ],
  repair: [
    "Fix this JS: const x = ;",
    "What's wrong with: SELECT * FROM",
    "Explain this error: ENOENT",
    "Why does '0' == 0 return true in JavaScript?",
    "What does TypeError mean?",
  ],
};

async function _runEval(brainId, modelName) {
  const prompts = EVAL_PROMPTS[brainId] || [];
  if (prompts.length === 0) return 1.0; // no eval = pass
  let passed = 0;
  for (const p of prompts) {
    const r = await _ollamaGenerate(modelName, p);
    if (r.ok && r.body && r.body.length > 0) passed++;
  }
  return passed / prompts.length;
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function _inWindow(now) {
  // Daily 23:30–23:59 local time. Caller may force via opts.force.
  return now.getHours() === 23 && now.getMinutes() >= 30;
}

function _dateTag() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Look up the currently-active model name for a brain. Falls back to
 * the env-var default when no swap has happened yet.
 */
export function getActiveBrainModel(db, brainId, fallback) {
  if (!db) return fallback;
  try {
    const row = db.prepare(
      `SELECT model_name FROM brain_active_models
        WHERE brain_id = ? AND active = 1
        ORDER BY created_at DESC LIMIT 1`,
    ).get(brainId);
    return row?.model_name || fallback;
  } catch {
    return fallback;
  }
}

export const _internal = {
  DAILY_ELIGIBLE_BRAINS,
  BASE_MODELS,
  MIN_CORPUS_SIZE,
  EXAMPLES_PER_BUILD,
  EVAL_PASS_THRESHOLD,
};
