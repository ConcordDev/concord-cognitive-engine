// server/tests/code-retrieval.test.js
//
// Contract tests for GH-3a — server/lib/code-retrieval.js (the real ranked
// code-retrieval module) AND its wiring into domains/code.js's
// `code.codebase-chat` (explicit @-mention override → ranked fallback) and
// `code.multi-file-plan` (`useRetrieval` auto-manifest path, local project +
// GitHub source). Pure-Node Tier-2 contract tests; no server boot, no HTTP,
// no live LLM/Ollama — matches the existing `tests/code-domain-parity.test.js`
// pattern (direct import of `registerCodeActions`, in-memory `_concordSTATE`).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  retrieveRelevantFiles,
  candidatesFromLocalFiles,
  candidatesFromGitHubTree,
} from "../lib/code-retrieval.js";
import registerCodeActions from "../domains/code.js";

// ─────────────────────────────────────────────────────────────────────────
// Part 1 — the retrieval module in isolation (no domain wiring involved).
// ─────────────────────────────────────────────────────────────────────────

describe("code-retrieval: ranking picks the right files", () => {
  it("a query about auth/login ranks the auth file above unrelated files", async () => {
    const filesMap = new Map([
      ["src/authLogin.js", {
        content: "function authLogin(user, pass) {\n  return checkPassword(user, pass);\n}\nexport { authLogin };",
        modifiedAt: new Date().toISOString(),
      }],
      ["src/mathUtils.js", {
        content: "export function add(a, b) { return a + b; }\nexport function sub(a, b) { return a - b; }",
        modifiedAt: new Date().toISOString(),
      }],
      ["src/colorPalette.js", {
        content: "export const COLORS = ['red', 'green', 'blue'];",
        modifiedAt: new Date().toISOString(),
      }],
    ]);
    const candidates = candidatesFromLocalFiles(filesMap);
    const r = await retrieveRelevantFiles({
      query: "fix the login authentication password check bug",
      candidates,
      limit: 3,
    });
    assert.equal(r.selected.length, 3);
    // The auth file must rank strictly first — real term overlap, not a coin-flip.
    assert.equal(r.selected[0].path, "src/authLogin.js");
    assert.ok(r.selected[0].score > r.selected[1].score);
    assert.ok(r.selected[0].score > r.selected[2].score);
    assert.equal(r.selected[0].matchedBy, "keyword-tfidf");
    assert.match(r.selected[0].reason, /login/);
    assert.equal(r.rankingMethod, "keyword-tfidf");
  });

  it("identifiers are tokenized across camelCase/snake_case boundaries", async () => {
    // A query using the underscore form must still find the camelCase file,
    // and vice versa — proves tokenize() isn't doing a naive substring match.
    const filesMap = new Map([
      ["billing/computeInvoiceTotal.js", { content: "function computeInvoiceTotal(items) { return items.reduce((a,b)=>a+b.price,0); }" }],
      ["billing/unrelated_stuff.js", { content: "function noop() { return null; }" }],
    ]);
    const candidates = candidatesFromLocalFiles(filesMap);
    const r = await retrieveRelevantFiles({ query: "how do I compute invoice total", candidates, limit: 2 });
    assert.equal(r.selected[0].path, "billing/computeInvoiceTotal.js");
  });

  it("returns real per-file reasons naming the actual matched terms — never a generic label", async () => {
    const candidates = candidatesFromLocalFiles(new Map([
      ["widgets/renderWidget.js", { content: "export function renderWidget(props) { return props.widget; }" }],
    ]));
    const r = await retrieveRelevantFiles({ query: "render a widget on screen", candidates, limit: 1 });
    assert.equal(r.selected.length, 1);
    assert.notEqual(r.selected[0].reason, "AI-ranked");
    assert.match(r.selected[0].reason, /widget/);
  });
});

describe("code-retrieval: explicit-mention override", () => {
  it("an explicit path is always included first, verbatim, ahead of any ranking", async () => {
    const filesMap = new Map([
      ["obscure/lowRelevance.js", { content: "export const NOTHING_RELEVANT = 1;" }],
      ["src/authLogin.js", { content: "function authLogin() { return checkPassword(); }" }],
    ]);
    const candidates = candidatesFromLocalFiles(filesMap);
    const r = await retrieveRelevantFiles({
      query: "fix the login bug",
      candidates,
      explicitPaths: ["obscure/lowRelevance.js"],
      limit: 2,
    });
    assert.equal(r.selected[0].path, "obscure/lowRelevance.js");
    assert.equal(r.selected[0].matchedBy, "explicit-mention");
    assert.equal(r.selected[0].score, null);
    // The ranked fallback still fills the remaining slot.
    assert.equal(r.selected[1].path, "src/authLogin.js");
    assert.equal(r.selected[1].matchedBy, "keyword-tfidf");
  });

  it("resolves a bare filename mention against a nested path (endsWith '/<name>')", async () => {
    const candidates = candidatesFromLocalFiles(new Map([
      ["deeply/nested/dir/target.js", { content: "export const X = 1;" }],
      ["other.js", { content: "export const Y = 2;" }],
    ]));
    const r = await retrieveRelevantFiles({ query: "anything", candidates, explicitPaths: ["target.js"], limit: 2 });
    assert.equal(r.selected[0].path, "deeply/nested/dir/target.js");
    assert.equal(r.selected[0].matchedBy, "explicit-mention");
  });

  it("an unresolvable explicit path is silently dropped, not fabricated into the selection", async () => {
    const candidates = candidatesFromLocalFiles(new Map([["real.js", { content: "x" }]]));
    const r = await retrieveRelevantFiles({ query: "x", candidates, explicitPaths: ["does/not/exist.js"], limit: 2 });
    assert.ok(!r.selected.some((s) => s.path === "does/not/exist.js"));
  });
});

describe("code-retrieval: honest caps and budget", () => {
  it("never returns more files than `limit`, even with many equally relevant candidates", async () => {
    const filesMap = new Map();
    for (let i = 0; i < 10; i++) {
      filesMap.set(`mod${i}.js`, { content: "function widgetHandler() { return renderWidget(); }" });
    }
    const candidates = candidatesFromLocalFiles(filesMap);
    const r = await retrieveRelevantFiles({ query: "widget handler render", candidates, limit: 4 });
    assert.equal(r.selected.length, 4);
    assert.equal(r.budget.limit, 4);
  });

  it("truncates a file over maxCharsPerFile and reports truncated:true", async () => {
    const big = "x".repeat(10000);
    const candidates = candidatesFromLocalFiles(new Map([["big.js", { content: `function widgetTarget() { ${big} }` }]]));
    const r = await retrieveRelevantFiles({ query: "widget target", candidates, limit: 1, maxCharsPerFile: 500 });
    assert.equal(r.selected[0].content.length, 500);
    assert.equal(r.selected[0].truncated, true);
  });

  it("stops filling the selection once maxTotalChars is exhausted, even under the file-count limit", async () => {
    const filesMap = new Map([
      ["a.js", { content: "widgetAlpha ".repeat(200) }], // ~2400 chars, highly relevant
      ["b.js", { content: "widgetBeta ".repeat(200) }],   // ~2200 chars, also relevant
      ["c.js", { content: "widgetGamma ".repeat(200) }],  // ~2400 chars, also relevant
    ]);
    const candidates = candidatesFromLocalFiles(filesMap);
    const r = await retrieveRelevantFiles({
      query: "widget alpha beta gamma",
      candidates,
      limit: 3,
      maxCharsPerFile: 6000,
      maxTotalChars: 3000, // real budget: room for ~1 file, not all 3
    });
    assert.ok(r.selected.length < 3, "budget must cap the count below the file-limit when chars run out");
    assert.ok(r.totalChars <= 3000);
  });

  it("reports the real budget it enforced and how many candidates were actually considered", async () => {
    const candidates = candidatesFromLocalFiles(new Map([["only.js", { content: "widgetOnly()" }]]));
    // 300 is above the module's own honest floor (200) for a per-file cap — an
    // absurdly tiny per-file cap gets clamped up rather than silently accepted.
    const r = await retrieveRelevantFiles({ query: "widget", candidates, limit: 5, maxCharsPerFile: 300 });
    assert.equal(r.budget.limit, 5);
    assert.equal(r.budget.maxCharsPerFile, 300);
    assert.equal(r.candidatesConsidered, 1);
  });

  it("clamps an absurdly tiny maxCharsPerFile up to the module's honest floor (200)", async () => {
    const candidates = candidatesFromLocalFiles(new Map([["only.js", { content: "widgetOnly()" }]]));
    const r = await retrieveRelevantFiles({ query: "widget", candidates, limit: 1, maxCharsPerFile: 5 });
    assert.equal(r.budget.maxCharsPerFile, 200);
  });
});

describe("code-retrieval: source adapters", () => {
  it("candidatesFromLocalFiles reflects an empty/absent map safely", () => {
    assert.deepEqual(candidatesFromLocalFiles(null), []);
    assert.deepEqual(candidatesFromLocalFiles(new Map()), []);
  });

  it("candidatesFromGitHubTree skips non-blob entries (trees/submodules) and fetches lazily", async () => {
    const tree = [
      { path: "src", type: "tree" },
      { path: "src/widget.js", type: "blob", size: 42 },
      { path: "vendor-submodule", type: "commit" },
    ];
    const fetched = [];
    const fetchFile = async (path) => { fetched.push(path); return "export function renderWidget() {}"; };
    const candidates = candidatesFromGitHubTree(tree, fetchFile);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].path, "src/widget.js");
    assert.equal(fetched.length, 0); // getContent() not called yet — truly lazy
    await candidates[0].getContent();
    assert.deepEqual(fetched, ["src/widget.js"]);
  });

  it("retrieval over a GitHub-shaped source only fetches content for the shortlisted (path-prefiltered) subset", async () => {
    const tree = [];
    // 3 clearly relevant files (path carries the query terms) + 45 irrelevant filler.
    for (let i = 0; i < 3; i++) tree.push({ path: `billing/invoiceTotal${i}.js`, type: "blob" });
    for (let i = 0; i < 45; i++) tree.push({ path: `misc/unrelatedFile${i}.js`, type: "blob" });

    let fetchCount = 0;
    const fetchFile = async (path) => { fetchCount++; return path.includes("invoice") ? "function invoiceTotal() { return 1; }" : "export const noop = 1;"; };
    const candidates = candidatesFromGitHubTree(tree, fetchFile);
    assert.equal(candidates.length, 48);

    const r = await retrieveRelevantFiles({ query: "compute invoice total", candidates, limit: 3, prefilterCap: 40 });
    assert.equal(r.selected.length, 3);
    assert.ok(r.selected.every((s) => s.path.includes("invoiceTotal")));
    // Bounded: only the phase-1 shortlist (<=40) had content fetched, never all 48.
    assert.ok(fetchCount <= 40, `expected bounded fetch (<=40), got ${fetchCount}`);
    assert.ok(fetchCount < tree.length, "must not fetch every candidate's content");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Part 2 — wiring: code.codebase-chat and code.multi-file-plan actually call
// through retrieveRelevantFiles (not just "the function exists in isolation").
// ─────────────────────────────────────────────────────────────────────────

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`code.${name}`);
  assert.ok(fn, `code.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => {
  registerCodeActions(register);
});

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

function ctxFor(userId) {
  return { actor: { userId }, userId };
}

describe("wiring: code.codebase-chat uses retrieval when there is no @-mention", () => {
  it("with no @-mention, ranked retrieval picks the on-topic file over unrelated ones", async () => {
    const ctx = ctxFor("chat_user_1");
    const p = call("projects-create", ctx, { name: "ChatProj" }).result.project;
    call("files-write", ctx, { projectId: p.id, path: "authLogin.js", content: "function authLogin(u,p){ return checkPassword(u,p); }" });
    call("files-write", ctx, { projectId: p.id, path: "colorPalette.js", content: "export const COLORS = ['red','blue'];" });

    const ctxBrain = { ...ctx, llm: { chat: async () => ({ text: "It checks the password." }) } };
    const r = await ACTIONS.get("code.codebase-chat")(ctxBrain, { id: null, data: {}, meta: {} }, {
      projectId: p.id, message: "why does login keep failing authentication",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.usedExplicitMentions, false);
    assert.ok(r.result.retrieval, "retrieval info must be surfaced when the ranked path ran");
    assert.equal(r.result.retrieval.rankingMethod, "keyword-tfidf");
    assert.ok(r.result.contextFiles.includes("authLogin.js"));
    // The clearly-unrelated file should NOT have been prioritized ahead of the real match.
    assert.equal(r.result.contextFiles[0], "authLogin.js");
  });

  it("an explicit @-mention is honored exclusively — no retrieval field, no ranked files mixed in", async () => {
    const ctx = ctxFor("chat_user_2");
    const p = call("projects-create", ctx, { name: "ChatProj2" }).result.project;
    call("files-write", ctx, { projectId: p.id, path: "authLogin.js", content: "function authLogin(){}" });
    call("files-write", ctx, { projectId: p.id, path: "colorPalette.js", content: "export const COLORS = [];" });

    const ctxBrain = { ...ctx, llm: { chat: async () => ({ text: "It's about colors." }) } };
    const r = await ACTIONS.get("code.codebase-chat")(ctxBrain, { id: null, data: {}, meta: {} }, {
      projectId: p.id, message: "explain @colorPalette.js",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.usedExplicitMentions, true);
    assert.equal(r.result.retrieval, null);
    assert.deepEqual(r.result.contextFiles, ["colorPalette.js"]);
  });
});

describe("wiring: code.multi-file-plan useRetrieval path", () => {
  it("builds the manifest from the local virtual project when no files[] is supplied", async () => {
    const ctx = ctxFor("plan_user_1");
    const p = call("projects-create", ctx, { name: "PlanProj" }).result.project;
    call("files-write", ctx, { projectId: p.id, path: "authLogin.js", content: "function authLogin(u,p){ return checkPassword(u,p); }" });
    call("files-write", ctx, { projectId: p.id, path: "colorPalette.js", content: "export const COLORS = ['red'];" });

    let seenManifestFilenames = null;
    const ctxBrain = {
      ...ctx,
      llm: {
        chat: async ({ messages }) => {
          const userMsg = messages.find((m) => m.role === "user")?.content || "";
          seenManifestFilenames = /## (\S+)/g.test(userMsg) ? [...userMsg.matchAll(/## (\S+)/g)].map((m) => m[1]) : [];
          return {
            text: JSON.stringify({
              edits: [{ filename: "authLogin.js", before: "function authLogin(u,p){ return checkPassword(u,p); }", after: "function authLogin(u,p){ return checkPassword(u,p) && rateLimit(u); }", reason: "add rate limiting" }],
            }),
          };
        },
      },
    };

    const r = await ACTIONS.get("code.multi-file-plan")(ctxBrain, { id: null, data: {}, meta: {} }, {
      useRetrieval: true,
      taskQuery: "add rate limiting to the login authentication path",
      projectId: p.id,
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.retrieval, "retrieval info must be present on the useRetrieval path");
    assert.equal(r.result.retrieval.source, "local-project");
    assert.equal(r.result.retrieval.rankingMethod, "keyword-tfidf");
    assert.ok(r.result.retrieval.matches.some((m) => m.path === "authLogin.js"));
    // The LLM was actually handed the retrieved file, not a hand-passed list.
    assert.ok(seenManifestFilenames.includes("authLogin.js"));
    assert.equal(r.result.accepted, 1);
    assert.equal(r.result.edits[0].filename, "authLogin.js");
  });

  it("builds the manifest from a connected GitHub repo via github.repo-tree/file-get", async () => {
    const ctx = ctxFor("plan_user_2");
    const fileGetCalls = [];
    const runMacro = async (domain, name, params) => {
      if (domain === "github" && name === "repo-tree") {
        return {
          ok: true,
          result: {
            tree: [
              { path: "src/authLogin.js", type: "blob" },
              { path: "src/colorPalette.js", type: "blob" },
              { path: "src", type: "tree" },
            ],
          },
        };
      }
      if (domain === "github" && name === "file-get") {
        fileGetCalls.push(params.path);
        const content = params.path.includes("authLogin")
          ? "function authLogin(u,p){ return checkPassword(u,p); }"
          : "export const COLORS = ['red'];";
        return { ok: true, result: { content } };
      }
      throw new Error(`unexpected runMacro(${domain}, ${name})`);
    };

    const ctxBrain = {
      ...ctx,
      runMacro,
      llm: {
        chat: async () => ({
          text: JSON.stringify({
            edits: [{ filename: "src/authLogin.js", before: "function authLogin(u,p){ return checkPassword(u,p); }", after: "function authLogin(u,p){ return checkPassword(u,p) && rateLimit(u); }", reason: "rate limit" }],
          }),
        }),
      },
    };

    const r = await ACTIONS.get("code.multi-file-plan")(ctxBrain, { id: null, data: {}, meta: {} }, {
      useRetrieval: true,
      taskQuery: "add rate limiting to login authentication",
      repo: "acme/widgets",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.retrieval.source, "github");
    assert.ok(fileGetCalls.includes("src/authLogin.js"), "the GitHub source must have been queried through GH-1's macros");
    assert.equal(r.result.accepted, 1);
  });

  it("an explicit files[] array always wins — useRetrieval is ignored when files are supplied", async () => {
    const ctx = ctxFor("plan_user_3");
    const ctxBrain = {
      ...ctx,
      llm: { chat: async () => ({ text: JSON.stringify({ edits: [{ filename: "manual.js", before: "1", after: "2", reason: "x" }] }) }) },
    };
    const r = await ACTIONS.get("code.multi-file-plan")(ctxBrain, { id: null, data: {}, meta: {} }, {
      useRetrieval: true,
      taskQuery: "irrelevant to the explicit list",
      prompt: "bump the constant",
      files: [{ name: "manual.js", content: "1", language: "javascript" }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.retrieval, null, "an explicit files[] must bypass retrieval entirely");
    assert.equal(r.result.totalFiles, 1);
  });

  it("useRetrieval without a projectId or repo is rejected honestly, not silently no-op", async () => {
    const ctxBrain = { ...ctxFor("plan_user_4"), llm: { chat: async () => ({ text: "{}" }) } };
    const r = await ACTIONS.get("code.multi-file-plan")(ctxBrain, { id: null, data: {}, meta: {} }, {
      useRetrieval: true, taskQuery: "do something",
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /projectId|repo/);
  });

  it("useRetrieval without any taskQuery or prompt is rejected", async () => {
    const ctxBrain = { ...ctxFor("plan_user_5"), llm: { chat: async () => ({ text: "{}" }) } };
    const r = await ACTIONS.get("code.multi-file-plan")(ctxBrain, { id: null, data: {}, meta: {} }, {
      useRetrieval: true, projectId: "proj-x",
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /taskQuery/);
  });
});
