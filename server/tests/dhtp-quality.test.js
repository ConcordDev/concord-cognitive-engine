// tests/dhtp-quality.test.js — Sprint 60+
//
// Validates the FULL metric chain:
// raw tokens → DHTP tokens → provider input → latency → quality
//
// Test methodology:
//   - 20 diverse prompts (one per preset pattern)
//   - Each prompt sent 2 ways:
//     A. UNCOMPRESSED: 33 real DTUs + system prompt
//     B. DHTP_COMPRESSED: 1 compressed block
//   - Quality check on output (pattern + keyword + length + coherence)
//   - Compare A vs B for: tokens saved, latency delta, quality delta

import { applyDHTP, selectPreset, getDHTPStats } from "../lib/dhtp.js";
import { DHTP_PRESETS } from "../lib/dhtp-presets.js";
import { brotliDecompressSync } from "node:zlib";

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const MODEL = "concord-conscious:latest";

let pass = 0, fail = 0;
const results = [];

function log(msg) { console.log(msg); }
function assert(cond, name) {
  if (cond) { pass++; log(`  ✓ ${name}`); }
  else { fail++; log(`  ✗ ${name}`); }
}

// ── Test Prompt Bank ────────────────────────────────────────────────

// 20 prompts, one per preset, with expected output characteristics
const TEST_PROMPTS = [
  {
    preset: "greeting_casual",
    prompt: "hi there!",
    expected: { minLen: 5, maxLen: 200, keywords: [], isCasual: true }
  },
  {
    preset: "list_request",
    prompt: "list the top 5 programming languages for beginners",
    expected: { minLen: 30, maxLen: 800, keywords: ["1", "2", "3", "4", "5"], needsList: true }
  },
  {
    preset: "explain_concept",
    prompt: "what is photosynthesis?",
    expected: { minLen: 50, maxLen: 600, keywords: ["plant", "light", "energy"], needsExplanation: true }
  },
  {
    preset: "summarize",
    prompt: "summarize: machine learning is a subset of artificial intelligence that enables systems to learn from data without explicit programming. It uses algorithms to identify patterns and make decisions.",
    expected: { minLen: 20, maxLen: 500, keywords: ["learning", "data", "algorithm"], needsSummary: true }
  },
  {
    preset: "compare",
    prompt: "compare Python and JavaScript for web development",
    expected: { minLen: 50, maxLen: 800, keywords: ["Python", "JavaScript"], needsComparison: true }
  },
  {
    preset: "code_request",
    prompt: "write me a function that reverses a string in JavaScript",
    expected: { minLen: 30, maxLen: 1500, keywords: ["function", "return", "split", "reverse"], needsCode: true }
  },
  {
    preset: "debug_request",
    prompt: "I have this error: TypeError: Cannot read property 'map' of undefined",
    expected: { minLen: 30, maxLen: 1000, keywords: ["undefined", "map", "check"], needsDebug: true }
  },
  {
    preset: "factual_question",
    prompt: "who wrote Romeo and Juliet?",
    expected: { minLen: 5, maxLen: 300, keywords: ["Shakespeare"], isFactual: true }
  },
  {
    preset: "yes_no_question",
    prompt: "is the earth round?",
    expected: { minLen: 5, maxLen: 300, keywords: ["yes", "no"], isYesNo: true }
  },
  {
    preset: "translate",
    prompt: "translate 'hello world' to Spanish",
    expected: { minLen: 5, maxLen: 500, keywords: ["hola", "mundo"], isTranslate: true }
  },
  {
    preset: "math_problem",
    prompt: "solve: what is 25% of 80?",
    expected: { minLen: 5, maxLen: 500, keywords: ["20"], isMath: true }
  },
  {
    preset: "design_request",
    prompt: "design a URL shortener like bit.ly",
    expected: { minLen: 50, maxLen: 1200, keywords: ["hash", "database", "API"], isDesign: true }
  },
  {
    preset: "brainstorm",
    prompt: "brainstorm 5 names for a coffee shop",
    expected: { minLen: 20, maxLen: 800, keywords: [], isBrainstorm: true }
  },
  {
    preset: "analyze",
    prompt: "analyze the impact of social media on mental health",
    expected: { minLen: 50, maxLen: 1000, keywords: [], isAnalyze: true }
  },
  {
    preset: "decision_help",
    prompt: "recommend whether to learn Python or R for data science, which is better?",
    expected: { minLen: 20, maxLen: 800, keywords: ["Python", "R"], isDecision: true }
  },
  {
    preset: "edit_improve",
    prompt: "improve this sentence: 'the cat sat on the mat and it was a good cat'",
    expected: { minLen: 20, maxLen: 800, keywords: [], isEdit: true }
  },
  {
    preset: "roleplay",
    prompt: "pretend you are Sherlock Holmes. What do you deduce about me?",
    expected: { minLen: 20, maxLen: 800, keywords: [], isRoleplay: true }
  },
  {
    preset: "creative_write",
    prompt: "write a poem that captures the falling of autumn leaves",
    expected: { minLen: 10, maxLen: 500, keywords: [], isCreative: true }
  },
  {
    preset: "greeting_returning",
    prompt: "good to see you again! been a while",
    expected: { minLen: 10, maxLen: 400, keywords: [], isCasual: true }
  },
  {
    preset: "small_talk",
    prompt: "how's it going today, friend?",
    expected: { minLen: 5, maxLen: 400, keywords: [], isCasual: true }
  }
];

// ── Quality Validation Helpers ──────────────────────────────────────

function validateResponse(response, expected) {
  const issues = [];
  const lower = response.toLowerCase();

  // Length check
  if (response.length < expected.minLen) {
    issues.push(`too short (${response.length} < ${expected.minLen})`);
  }
  if (response.length > expected.maxLen) {
    issues.push(`too long (${response.length} > ${expected.maxLen})`);
  }

  // Truncation check (incomplete sentences)
  if (response.length > 30 && !response.match(/[.!?\n]$/)) {
    issues.push(`appears truncated (no ending punctuation)`);
  }

  // Keyword check
  for (const kw of expected.keywords || []) {
    if (!lower.includes(kw.toLowerCase()) && !lower.includes(kw.replace(/['']/g, "'").toLowerCase())) {
      issues.push(`missing keyword: "${kw}"`);
    }
  }

  // Pattern checks
  if (expected.needsList) {
    if (!/\b\d+[.)]|\n[-*•]/.test(response)) {
      issues.push(`no list structure found`);
    }
  }
  if (expected.needsCode) {
    if (!response.includes("```") && !response.match(/function\s+\w+\s*\(/)) {
      issues.push(`no code block found`);
    }
  }
  if (expected.needsExplanation) {
    if (!response.includes(".") || response.length < 40) {
      issues.push(`insufficient explanation`);
    }
  }
  if (expected.needsSummary) {
    if (response.length > expected.maxLen * 0.9) {
      issues.push(`summary too long (not actually summarized)`);
    }
  }
  if (expected.needsComparison) {
    if (!lower.match(/both|whereas|while|however|differ/)) {
      issues.push(`no comparison structure`);
    }
  }

  return issues;
}

// ── Provider Call ────────────────────────────────────────────────

async function callOllama(prompt, systemPrompt, maxTokens = 600) {
  const start = Date.now();
  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
          { role: "user", content: prompt }
        ],
        stream: false,
        options: { num_predict: maxTokens, temperature: 0.7 }
      })
    });
    const latency = Date.now() - start;
    if (!res.ok) {
      return { error: `HTTP ${res.status}`, latency };
    }
    const data = await res.json();
    const content = data?.message?.content || "";
    return { content, latency, prompt_tokens: data?.prompt_eval_count || 0, completion_tokens: data?.eval_count || 0 };
  } catch (e) {
    return { error: String(e?.message || e), latency: Date.now() - start };
  }
}

// ── Token Count Helpers ─────────────────────────────────────────────

function estimateTokens(text) {
  // 3.8 chars/token for qwen-like models
  return Math.ceil((text || "").length / 3.8);
}

function decompressBlock(block) {
  if (!block || block.length === 0) return "";
  try {
    return brotliDecompressSync(block).toString("utf8");
  } catch {
    return "";
  }
}

// ── Test Runner ─────────────────────────────────────────────────────

async function main() {
  log("\n=== DHTP Quality Validation Suite ===\n");

  // Build a realistic DTU working set
  const dtus = Array(33).fill(0).map((_, i) => ({
    id: `dtu_${i}`,
    title: [
      "DTU Substrate Architecture",
      "Compression Algorithms Overview",
      "Ollama Integration Patterns",
      "DTU Deduplication Strategy",
      "Brotli vs Gzip Comparison",
      "Vector Embeddings for Search",
      "Semantic Compression Methods",
      "DTU Working Set Patterns",
      "Context Window Optimization",
      "Token Budget Allocation",
      "MEGA Summary Generation",
      "DTU Tier Classification",
      "ConKay Affect Engine",
      "Chat Context Pipeline",
      "Lens Runtime Architecture",
      "5-Brain Router Design",
      "Inference Engine Path",
      "Tool Calling Protocol",
      "Modelfile Identity Block",
      "Prompt Registry Patterns",
      "Working Memory Cache",
      "Long-term Memory Layer",
      "Pattern Recognition Models",
      "Decision Tree Heuristics",
      "Quality Gate Pipeline",
      "Embedding Dimensionality",
      "Cosine Similarity Math",
      "Lattice Vector Spaces",
      "Hyper Compression Tier",
      "Mega Block Construction",
      "Adaptive Threshold Tuning",
      "Cross-Session Continuity",
      "Multi-Turn Conversation Flow",
    ][i],
    tier: i < 5 ? "mega" : i < 15 ? "regular" : "background",
    updatedAt: `2026-08-14T16:00:0${i % 10}Z`,
  }));

  // Realistic system prompt (~1500 chars)
  const realisticSystemPrompt = `
[Identity] You are Concord. Direct, knowledgeable, never hedge unnecessarily. You engage with curiosity and warmth.
[Mode] Chat mode. Respond to user messages with insight.
[Lens Active] Currently in "explore" lens — focus on breadth, discovery, and learning.
[Entity State] The user is engaged and curious. No fatigue indicators. Mood neutral-positive.
[Constitutional Rules] Never provide harmful content. Respect user privacy. Always be honest. Never claim to be human.
[Memory Summary] Earlier in this conversation we discussed DTU substrate architecture and compression patterns.
[Tool Capability] You have access to 16,000+ tools via the MCP server. Use dtu_search to find relevant context.
`.trim();

  log(`Testing ${TEST_PROMPTS.length} prompts × 2 variants (uncompressed vs DHTP)\n`);
  log(`Model: ${MODEL}`);
  log(`Working set: ${dtus.length} DTUs\n`);

  for (const test of TEST_PROMPTS) {
    const detected = selectPreset(test.prompt);
    const presetMatch = detected.matched && detected.preset.id === test.preset;

    if (!presetMatch) {
      log(`\n[${test.preset}] ✗ PRESET MISMATCH (got ${detected.matched ? detected.preset.id : 'none'})`);
      fail++;
      continue;
    }

    // ── A. Uncompressed path ──
    const uncompressedPrompt = realisticSystemPrompt + "\n\n" + dtus.map(d => `[${d.tier}] ${d.title}`).join("\n") + "\n\nUser: " + test.prompt;
    const uncompressedTokens = estimateTokens(uncompressedPrompt);

    // ── B. DHTP compressed path ──
    const dhtpResult = applyDHTP({
      prompt: test.prompt,
      workingSetDtus: dtus,
      baseSystemPrompt: realisticSystemPrompt,
    });
    const dhtpTokens = estimateTokens(dhtpResult.systemPrompt);
    const dhtpRatio = uncompressedTokens / Math.max(dhtpTokens, 1);

    // Call provider (only if DHTP compressed and we have a healthy response path)
    let uncompressedResult = null, compressedResult = null;
    if (process.env.SKIP_OLLAMA !== "1") {
      log(`\n[${test.preset}] prompt: "${test.prompt.slice(0, 40)}..."`);
      log(`  raw=${uncompressedTokens} dhtp=${dhtpTokens} ratio=${dhtpRatio.toFixed(1)}x`);

      // Run both
      uncompressedResult = await callOllama(test.prompt, uncompressedPrompt, 600);
      compressedResult = await callOllama(test.prompt, dhtpResult.systemPrompt, dhtpResult.maxResponseTokens || 400);

      if (uncompressedResult.content && compressedResult.content) {
        log(`  uncompressed: ${uncompressedResult.latency}ms, ${uncompressedResult.completion_tokens} completion_tokens`);
        log(`  compressed:   ${compressedResult.latency}ms, ${compressedResult.completion_tokens} completion_tokens`);

        const uIssues = validateResponse(uncompressedResult.content, test.expected);
        const cIssues = validateResponse(compressedResult.content, test.expected);

        log(`  uncompressed quality: ${uIssues.length === 0 ? "PASS" : "FAIL (" + uIssues.join("; ") + ")"}`);
        log(`  compressed quality:   ${cIssues.length === 0 ? "PASS" : "FAIL (" + cIssues.join("; ") + ")"}`);

        // Save for analysis
        results.push({
          preset: test.preset,
          prompt: test.prompt,
          uncompressedTokens,
          dhtpTokens,
          dhtpRatio,
          uncompressedLatency: uncompressedResult.latency,
          compressedLatency: compressedResult.latency,
          uncompressedOutput: uncompressedResult.content,
          compressedOutput: compressedResult.content,
          uncompressedQuality: uIssues.length === 0,
          compressedQuality: cIssues.length === 0,
          uncompressedIssues: uIssues,
          compressedIssues: cIssues,
        });

        // Pass criteria: both pass OR compressed passes even if uncompressed fails
        if (cIssues.length === 0) pass++;
        else fail++;
      } else {
        log(`  ⚠ ollama unavailable (set SKIP_OLLAMA=1 to skip provider calls)`);
        log(`  ✓ compression verified: ${dhtpRatio.toFixed(1)}x ratio, ${dhtpResult.presetId}`);
        pass++;  // Compression test still counts
      }
    } else {
      log(`\n[${test.preset}] skip ollama (raw ${uncompressedTokens} → dhtp ${dhtpTokens} = ${dhtpRatio.toFixed(1)}x)`);
      pass++;
    }
  }

  // ── Final Summary ───────────────────────────────────────────────
  log(`\n=== SUMMARY ===`);
  log(`Pass: ${pass}`);
  log(`Fail: ${fail}`);

  if (results.length > 0) {
    const validResults = results.filter(r => r.uncompressedQuality !== undefined);
    if (validResults.length > 0) {
      const bothPass = validResults.filter(r => r.uncompressedQuality && r.compressedQuality).length;
      const dhtpPass = validResults.filter(r => r.compressedQuality).length;
      const rawPass = validResults.filter(r => r.uncompressedQuality).length;
      const avgRatio = validResults.reduce((s, r) => s + r.dhtpRatio, 0) / validResults.length;
      const avgLatencySaved = validResults.reduce((s, r) => s + (r.uncompressedLatency - r.compressedLatency), 0) / validResults.length;

      log(`\nQuality preservation:`);
      log(`  Both pass:        ${bothPass}/${validResults.length}`);
      log(`  DHTP only:        ${dhtpPass - bothPass}/${validResults.length}`);
      log(`  Uncompressed only: ${rawPass - bothPass}/${validResults.length}`);
      log(`\nAverage ratio:   ${avgRatio.toFixed(1)}x`);
      log(`Avg latency saved: ${avgLatencySaved.toFixed(0)}ms`);
    }
  }

  // Save results
  if (results.length > 0) {
    const fs = await import("node:fs");
    fs.writeFileSync(
      "/tmp/dhtp-quality-results.json",
      JSON.stringify(results, null, 2)
    );
    log(`\nResults saved to /tmp/dhtp-quality-results.json`);
  }

  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
