// Contract tests for server/domains/ml.js — pure-math evaluation macros
// plus the Hugging Face hub integrations and the per-user ML substrate
// (experiments, datasets, comparison, AutoML, deployments, spaces).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerMlActions from "../domains/ml.js";
import { clearExternalFetchCache } from "../lib/external-fetch.js";


// external-fetch.js routes through the SSRF guard (lib/public-fetch.js), so
// stubbing globalThis.fetch alone no longer intercepts anything -- the guard
// does a real DNS lookup first and fails on a fake hostname. Install
// public-fetch's documented module-scope test transport and delegate to
// whatever globalThis.fetch currently is, so each test's existing stub and
// restore lifecycle keeps working unchanged. Production never calls this.
import { __setPublicFetchTestTransport } from "../lib/public-fetch.js";
__setPublicFetchTestTransport((url, init) => globalThis.fetch(url, init));

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`ml.${name}`);
  if (!fn) throw new Error(`ml.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => { registerMlActions(register); });

beforeEach(() => {
  clearExternalFetchCache();
  globalThis._concordSTATE = {};
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

// ─── pure-compute evaluation macros ──────────────────────────────────────
describe("ml.modelEvaluate", () => {
  it("computes classification accuracy + per-class F1", () => {
    const r = call("modelEvaluate", ctxA, {
      data: { predictions: ["a", "b", "a", "b"], actuals: ["a", "b", "b", "b"] },
    }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.type, "classification");
    assert.equal(r.result.samples, 4);
    assert.equal(r.result.accuracy, 75);
  });

  it("computes regression R²", () => {
    const r = call("modelEvaluate", ctxA, {
      data: { predictions: [1.1, 2.2, 3.3, 4.4], actuals: [1.1, 2.2, 3.3, 4.4] },
    }, {});
    assert.equal(r.result.type, "regression");
    assert.equal(r.result.r2, 1);
  });
});

describe("ml.featureImportance", () => {
  it("ranks numeric features by correlation", () => {
    const rows = [
      { x: 1, y: 1, t: 1 }, { x: 2, y: 5, t: 2 }, { x: 3, y: 2, t: 3 }, { x: 4, y: 9, t: 4 },
    ];
    const r = call("featureImportance", ctxA, { data: { features: rows, target: "t" } }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.topFeatures[0], "x");
  });
});

describe("ml.datasetProfile", () => {
  it("profiles columns and a quality score", () => {
    const r = call("datasetProfile", ctxA, {
      data: { dataset: [{ a: 1, b: "x" }, { a: 2, b: "y" }, { a: 3, b: "x" }] },
    }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.rows, 3);
    assert.equal(r.result.columns, 2);
  });
});

describe("ml.hyperparameterSuggest", () => {
  it("suggests neural-network architecture", () => {
    const r = call("hyperparameterSuggest", ctxA, {
      data: { model: "neural-network", task: "classification", datasetSize: 20000, features: 50 },
    }, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.suggestions.architecture);
    assert.ok(r.result.suggestions.optimizer);
  });
});

// ─── Hugging Face hub integrations ───────────────────────────────────────
describe("ml.model-hub", () => {
  it("shapes the HF model listing", async () => {
    let url = "";
    globalThis.fetch = async (u) => {
      url = u;
      return { ok: true, json: async () => ([
        { id: "openai/gpt2", pipeline_tag: "text-generation", downloads: 100, likes: 5, tags: ["pytorch"] },
      ]) };
    };
    const r = await call("model-hub", ctxA, { query: "gpt", task: "text-generation" });
    assert.equal(r.ok, true);
    assert.match(url, /huggingface\.co\/api\/models/);
    assert.equal(r.result.models[0].name, "gpt2");
    assert.equal(r.result.models[0].author, "openai");
  });

  it("surfaces network failure", async () => {
    const r = await call("model-hub", ctxA, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /unreachable/);
  });
});

describe("ml.model-card", () => {
  it("requires modelId", async () => {
    const r = await call("model-card", ctxA, {});
    assert.equal(r.ok, false);
  });

  it("shapes a model card", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        id: "bert-base-uncased", pipeline_tag: "fill-mask", downloads: 9, likes: 1,
        tags: ["license:apache-2.0", "pytorch"], siblings: [{ rfilename: "config.json" }],
      }),
    });
    const r = await call("model-card", ctxA, { modelId: "bert-base-uncased" });
    assert.equal(r.ok, true);
    assert.equal(r.result.card.license, "apache-2.0");
    assert.deepEqual(r.result.card.siblings, ["config.json"]);
  });
});

describe("ml bench integrity (S-ML-3)", () => {
  it("Evaluate refuses a length mismatch with BOTH counts named — no silent truncation (F4)", () => {
    const r = call("modelEvaluate", ctxA, {
      data: { predictions: ["a", "b", "a"], actuals: ["a", "b"] },
    }, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /length_mismatch/);
    assert.match(r.error, /predictions has 3/);
    assert.match(r.error, /actuals has 2/);
  });

  it("Evaluate results carry both input counts beside the figures (D1)", () => {
    const r = call("modelEvaluate", ctxA, {
      data: { predictions: ["a", "b"], actuals: ["a", "b"] },
    }, {});
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.counts, { predictions: 2, actuals: 2 });
    assert.equal(r.result.accuracy, 100);
  });

  it("experiment-log refuses an out-of-range accuracy and stores nothing (F6)", async () => {
    const start = call("experiment-start", ctxA, { name: "range-check" });
    const id = start.result.experiment.id;
    const bad = call("experiment-log", ctxA, { experimentId: id, accuracy: 2 });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /accuracy out of range/);
    const list = call("experiment-list", ctxA, {});
    const exp = list.result.experiments.find((e) => e.id === id);
    assert.equal(exp.metrics.length, 0);
    const good = call("experiment-log", ctxA, { experimentId: id, accuracy: 0.87 });
    assert.equal(good.ok, true);
  });

  it("dataset-register refuses splits that do not sum to 1 (F6)", () => {
    const r = call("dataset-register", ctxA, { name: "split-check", train: 0.9, val: 0.9, test: 0.9 });
    assert.equal(r.ok, false);
    assert.match(r.error, /splits must sum to 1/);
  });

  it("re-register updates the splits and a blank features field keeps the prior count (F6/F7)", () => {
    const v1 = call("dataset-register", ctxA, { name: "keep-features", samples: 100, features: 12 });
    assert.equal(v1.ok, true);
    const v2 = call("dataset-register", ctxA, { name: "keep-features", train: 0.6, val: 0.2, test: 0.2 });
    assert.equal(v2.ok, true);
    assert.deepEqual(v2.result.dataset.splits, { train: 0.6, val: 0.2, test: 0.2 });
    assert.equal(v2.result.dataset.versions[0].features, 12);
    assert.equal(v2.result.dataset.versions[0].samples, 100);
  });
});

describe("ml lifecycle completion (S-ML-4)", () => {
  it("dataset-delete removes the caller's dataset and no one else's (F7)", () => {
    const a = call("dataset-register", ctxA, { name: "to-delete" });
    const id = a.result.dataset.id;
    call("dataset-register", ctxB, { name: "to-delete" });
    const wrong = call("dataset-delete", ctxB, { datasetId: id });
    assert.equal(wrong.ok, false);
    const r = call("dataset-delete", ctxA, { datasetId: id });
    assert.equal(r.ok, true);
    const list = call("dataset-list", ctxA, {});
    assert.equal(list.result.datasets.some((d) => d.id === id), false);
    const again = call("dataset-delete", ctxA, { datasetId: id });
    assert.equal(again.ok, false);
  });

  it("deploy-delete removes the caller's deployment (F7)", async () => {
    const c = call("deploy-create", ctxA, { modelId: "gpt2", name: "doomed" });
    const id = c.result.deployment.id;
    const r = call("deploy-delete", ctxA, { deploymentId: id });
    assert.equal(r.ok, true);
    const list = call("deploy-list", ctxA, {});
    assert.equal(list.result.deployments.some((d) => d.id === id), false);
  });
});

describe("ml.model-card (S-ML-5)", () => {
  it("fetches the card with the RAW namespaced id (no %2F) and maps the files list (F9)", async () => {
    let seenUrl;
    globalThis.fetch = async (url) => {
      seenUrl = url;
      return { ok: true, status: 200, json: async () => ({ id: "openai-community/gpt2", pipeline_tag: "text-generation", library_name: "transformers", downloads: 10, likes: 2, tags: ["license:apache-2.0"], siblings: [{ rfilename: "config.json" }, { rfilename: "model.safetensors" }] }) };
    };
    const r = await call("model-card", ctxA, { modelId: "openai-community/gpt2" });
    assert.equal(r.ok, true);
    assert.ok(seenUrl.includes("api/models/openai-community/gpt2"), seenUrl);
    assert.ok(!seenUrl.includes("%2F"), seenUrl);
    assert.deepEqual(r.result.card.siblings, ["config.json", "model.safetensors"]);
    assert.equal(r.result.card.license, "apache-2.0");
  });

  it("a missing model is named not found — not conflated with an unreachable hub (F9)", async () => {
    globalThis.fetch = async () => { throw new Error("HTTP 404"); };
    const r = await call("model-card", ctxA, { modelId: "nope/missing" });
    assert.equal(r.ok, false);
    assert.match(r.error, /model not found/);
  });
});

describe("ml AutoML wiring (S-ML-9)", () => {
  it("only tabular-classification is marked wired; the rest are guidance", () => {
    const r = call("automl-templates", ctxA, {});
    const byId = Object.fromEntries(r.result.templates.map((t) => [t.id, t.wired]));
    assert.equal(byId["tabular-classification"], true);
    assert.equal(byId["tabular-regression"], false);
    assert.equal(byId["clustering"], false);
  });

  it("automl-run executes the configuration run over a registered dataset and tracks the experiment", () => {
    const reg = call("dataset-register", ctxA, { name: "automl-data", samples: 2000, features: 20 });
    const dsId = reg.result.dataset.id;
    const r = call("automl-run", ctxA, { templateId: "tabular-classification", datasetId: dsId });
    assert.equal(r.ok, true);
    assert.equal(r.result.run.profile.samples, 2000);
    assert.equal(r.result.run.suggestion.nEstimators, 200);
    assert.equal(r.result.run.steps.length, 3);
    const list = call("experiment-list", ctxA, {});
    const exp = list.result.experiments.find((e) => e.id === r.result.run.experimentId);
    assert.ok(exp, "the tracked experiment exists");
    assert.equal(exp.status, "completed");
    assert.match(r.result.run.note, /does not train in-browser/);
  });

  it("automl-run refuses guidance templates and shapeless datasets honestly", () => {
    const guidance = call("automl-run", ctxA, { templateId: "clustering", datasetId: "whatever" });
    assert.equal(guidance.ok, false);
    assert.match(guidance.error, /guidance only/);
    const reg = call("dataset-register", ctxA, { name: "shapeless" });
    const noShape = call("automl-run", ctxA, { templateId: "tabular-classification", datasetId: reg.result.dataset.id });
    assert.equal(noShape.ok, false);
    assert.match(noShape.error, /no recorded shape/);
  });
});

describe("ml.playground-infer", () => {
  it("requires modelId + input", async () => {
    assert.equal((await call("playground-infer", ctxA, {})).ok, false);
    assert.equal((await call("playground-infer", ctxA, { modelId: "m" })).ok, false);
  });

  it("runs inference through the HF router with the server token and reports latency", async () => {
    let seen;
    globalThis.fetch = async (url, init) => { seen = { url, init }; return { ok: true, json: async () => ([{ label: "POSITIVE", score: 0.99 }]) }; };
    const r = await call("playground-infer", { ...ctxA, hfToken: "hf_test" }, { modelId: "distilbert", input: "great movie" });
    assert.equal(r.ok, true);
    assert.equal(seen.url, "https://router.huggingface.co/hf-inference/models/distilbert");
    assert.equal(seen.init.headers.Authorization, "Bearer hf_test");
    assert.equal(typeof r.result.latencyMs, "number");
    assert.ok(Array.isArray(r.result.output));
  });

  it("S-ML-1: routes across providers — a refusing provider falls through, the receipt names the server", async () => {
    const calls = [];
    globalThis.fetch = async (url) => {
      calls.push(url);
      if (url.includes("huggingface.co/api/models/")) {
        return { ok: true, status: 200, json: async () => ({ inferenceProviderMapping: { "hf-inference": {}, together: {} } }) };
      }
      if (url.includes("/hf-inference/")) return { ok: false, status: 400, json: async () => ({ error: "Model not supported by provider hf-inference" }) };
      return { ok: true, status: 200, json: async () => ([{ generated_text: "hi" }]) };
    };
    const r = await call("playground-infer", { ...ctxA, hfToken: "hf_test" }, { modelId: "some/model", input: "hello" });
    assert.equal(r.ok, true);
    assert.equal(r.result.servedBy, "together");
    assert.equal(r.result.attempts.length, 2);
    assert.equal(r.result.attempts[0].provider, "hf-inference");
    assert.equal(r.result.attempts[0].ok, false);
    assert.match(r.result.attempts[0].error, /not supported/i);
    assert.equal(r.result.attempts[1].ok, true);
    assert.ok(calls.some((u) => u.includes("router.huggingface.co/together/models/some/model")));
  });

  it("S-ML-1: a model no provider serves is refused BEFORE the run, in plain language", async () => {
    let routerCalled = false;
    globalThis.fetch = async (url) => {
      if (url.includes("router.huggingface.co")) routerCalled = true;
      return { ok: true, status: 200, json: async () => ({ inferenceProviderMapping: {} }) };
    };
    const r = await call("playground-infer", { ...ctxA, hfToken: "hf_test" }, { modelId: "some/model", input: "hello" });
    assert.equal(r.ok, false);
    assert.match(r.error, /not servable: no hosted-inference provider serves/);
    assert.equal(routerCalled, false);
  });

  it("S-ML-1: an unknown model id is named as not found before any run", async () => {
    let routerCalled = false;
    globalThis.fetch = async (url) => {
      if (url.includes("router.huggingface.co")) routerCalled = true;
      return { ok: false, status: 404, json: async () => ({}) };
    };
    const r = await call("playground-infer", { ...ctxA, hfToken: "hf_test" }, { modelId: "nope/missing", input: "hello" });
    assert.equal(r.ok, false);
    assert.match(r.error, /model not found/);
    assert.equal(routerCalled, false);
  });

  it("S-ML-1: when every provider fails, the error shows its work (providers tried + attempts recorded)", async () => {
    globalThis.fetch = async (url) => {
      if (url.includes("huggingface.co/api/models/")) {
        return { ok: true, status: 200, json: async () => ({ inferenceProviderMapping: { "hf-inference": {}, together: {} } }) };
      }
      return { ok: false, status: 503, json: async () => ({ error: "provider down" }) };
    };
    const r = await call("playground-infer", { ...ctxA, hfToken: "hf_test" }, { modelId: "some/model", input: "hello" });
    assert.equal(r.ok, false);
    assert.match(r.error, /no provider could serve/);
    assert.match(r.error, /hf-inference, together/);
    assert.equal(r.attempts.length, 2);
  });

  it("without a Hugging Face token, inference is reported unavailable (no request made)", async () => {
    let called = false;
    globalThis.fetch = async () => { called = true; return { ok: true, json: async () => ({}) }; };
    const r = await call("playground-infer", { ...ctxA, hfToken: "" }, { modelId: "distilbert", input: "x" });
    assert.equal(r.ok, false);
    assert.match(r.error, /inference_unavailable/);
    assert.equal(called, false);
  });
});

describe("ml.dataset-hub", () => {
  it("shapes HF dataset listing", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ([{ id: "squad", downloads: 50, likes: 3, tags: ["nlp"] }]),
    });
    const r = await call("dataset-hub", ctxA, { query: "squad" });
    assert.equal(r.ok, true);
    assert.equal(r.result.datasets[0].name, "squad");
  });
});

// ─── experiment tracking ─────────────────────────────────────────────────
describe("ml experiment tracking", () => {
  it("starts, logs, finishes and lists experiments", () => {
    const start = call("experiment-start", ctxA, {}, { name: "run-1", epochs: 10 });
    assert.equal(start.ok, true);
    const id = start.result.experiment.id;

    const log = call("experiment-log", ctxA, {}, { experimentId: id, trainLoss: 0.5, valLoss: 0.6, accuracy: 0.8 });
    assert.equal(log.ok, true);
    assert.equal(log.result.experiment.metrics.length, 1);

    const fin = call("experiment-finish", ctxA, {}, { experimentId: id });
    assert.equal(fin.ok, true);
    assert.equal(fin.result.experiment.status, "completed");

    const list = call("experiment-list", ctxA, {}, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);
  });

  it("rejects a missing name", () => {
    const r = call("experiment-start", ctxA, {}, {});
    assert.equal(r.ok, false);
  });

  it("deletes an experiment", () => {
    const start = call("experiment-start", ctxA, {}, { name: "del-me" });
    const del = call("experiment-delete", ctxA, {}, { experimentId: start.result.experiment.id });
    assert.equal(del.ok, true);
    assert.equal(del.result.remaining, 0);
  });

  it("isolates experiments per user", () => {
    call("experiment-start", ctxA, {}, { name: "a-run" });
    const bList = call("experiment-list", ctxB, {}, {});
    assert.equal(bList.result.count, 0);
  });
});

// ─── dataset registry ────────────────────────────────────────────────────
describe("ml dataset registry", () => {
  it("registers and versions a dataset", () => {
    const v1 = call("dataset-register", ctxA, {}, { name: "ds-x", samples: 100, features: 8 });
    assert.equal(v1.ok, true);
    assert.equal(v1.result.newVersion, 1);

    const v2 = call("dataset-register", ctxA, {}, { name: "ds-x", samples: 200 });
    assert.equal(v2.result.newVersion, 2);

    const list = call("dataset-list", ctxA, {}, {});
    assert.equal(list.result.count, 1);
    assert.equal(list.result.datasets[0].versions.length, 2);
  });

  it("rejects a missing name", () => {
    assert.equal(call("dataset-register", ctxA, {}, {}).ok, false);
  });
});

// ─── model comparison ────────────────────────────────────────────────────
describe("ml.model-compare", () => {
  it("ranks supplied models into a leaderboard", () => {
    const r = call("model-compare", ctxA, {}, {
      models: [
        { name: "A", accuracy: 0.9, f1: 0.88 },
        { name: "B", accuracy: 0.7, f1: 0.6 },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.winner, "A");
    assert.equal(r.result.leaderboard[0].rank, 1);
  });

  it("falls back to comparing experiments", () => {
    const e1 = call("experiment-start", ctxA, {}, { name: "cmp-1" });
    call("experiment-log", ctxA, {}, { experimentId: e1.result.experiment.id, accuracy: 0.95, valLoss: 0.1 });
    const e2 = call("experiment-start", ctxA, {}, { name: "cmp-2" });
    call("experiment-log", ctxA, {}, { experimentId: e2.result.experiment.id, accuracy: 0.6, valLoss: 0.4 });
    const r = call("model-compare", ctxA, {}, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.winner, "cmp-1");
  });

  it("rejects when too few candidates", () => {
    const r = call("model-compare", ctxB, {}, { models: [{ name: "only" }] });
    assert.equal(r.ok, false);
  });
});

// ─── AutoML templates ────────────────────────────────────────────────────
describe("ml.automl-templates", () => {
  it("returns all templates by default", () => {
    const r = call("automl-templates", ctxA, {}, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.count >= 5);
  });

  it("filters by task", () => {
    const r = call("automl-templates", ctxA, {}, { task: "regression" });
    assert.equal(r.ok, true);
    assert.ok(r.result.templates.every((t) => t.task === "regression" || t.id.includes("regression")));
  });
});

// ─── deployments ─────────────────────────────────────────────────────────
describe("ml deployments", () => {
  it("creates a deployment with no fabricated endpoint, invokes it for real, records real stats, stops it", async () => {
    const create = call("deploy-create", ctxA, {}, { modelId: "gpt2", name: "GPT-2" });
    assert.equal(create.ok, true);
    const dep = create.result.deployment;
    assert.equal(dep.endpoint, undefined);
    assert.deepEqual(dep.invoke, { domain: "ml", name: "deploy-invoke", input: { deploymentId: dep.id } });
    assert.equal(dep.totalRequests, 0);
    assert.equal(dep.avgLatency, null);

    assert.equal(call("deploy-scale", ctxA, {}, { deploymentId: dep.id, replicas: 4 }).ok, false);

    let calledUrl = null;
    const okCtx = { ...ctxA, hfToken: "hf_test", mlFetch: async (url) => { calledUrl = url; return { ok: true, status: 200, json: async () => [{ generated_text: "hi there" }] }; } };
    const inv = await call("deploy-invoke", okCtx, {}, { deploymentId: dep.id, input: "hi" });
    assert.equal(inv.ok, true);
    assert.match(calledUrl, /models\/gpt2$/);
    assert.deepEqual(inv.result.output, [{ generated_text: "hi there" }]);

    const badCtx = { ...ctxA, hfToken: "hf_test", mlFetch: async () => ({ ok: false, status: 503, json: async () => ({ error: "loading" }) }) };
    const fail = await call("deploy-invoke", badCtx, {}, { deploymentId: dep.id, input: "hi" });
    assert.equal(fail.ok, false);

    let listed = call("deploy-list", ctxA, {}, {}).result.deployments[0];
    assert.equal(listed.totalRequests, 2);
    assert.equal(listed.errorCount, 1);
    assert.equal(typeof listed.avgLatency, "number");

    assert.equal((await call("deploy-invoke", okCtx, {}, { deploymentId: dep.id })).ok, false);
    const stop = call("deploy-stop", ctxA, {}, { deploymentId: dep.id });
    assert.equal(stop.result.deployment.status, "inactive");
    assert.equal((await call("deploy-invoke", okCtx, {}, { deploymentId: dep.id, input: "hi" })).ok, false);
    assert.equal(call("deploy-stop", ctxA, {}, { deploymentId: dep.id, resume: true }).result.deployment.status, "active");
    listed = call("deploy-list", ctxA, {}, {});
    assert.equal(listed.result.count, 1);
  });

  it("rejects a missing modelId", () => {
    assert.equal(call("deploy-create", ctxA, {}, {}).ok, false);
  });
});

// ─── demo spaces ─────────────────────────────────────────────────────────
describe("ml demo spaces", () => {
  it("creates, lists and deletes a space", () => {
    const create = call("space-create", ctxA, {}, { title: "Sentiment Demo", modelId: "distilbert" });
    assert.equal(create.ok, true);
    const id = create.result.space.id;

    const list = call("space-list", ctxA, {}, {});
    assert.equal(list.result.count, 1);

    const del = call("space-delete", ctxA, {}, { spaceId: id });
    assert.equal(del.ok, true);
    assert.equal(del.result.remaining, 0);
  });

  it("requires title and modelId", () => {
    assert.equal(call("space-create", ctxA, {}, { title: "x" }).ok, false);
    assert.equal(call("space-create", ctxA, {}, { modelId: "m" }).ok, false);
  });
});

describe("ml spaces — openable by slug", () => {
  it("space-get resolves public spaces for anyone, private only for the owner, and counts views", () => {
    const pub = call("space-create", ctxA, {}, { title: "Sentiment Demo", modelId: "distilbert" }).result.space;
    const dup = call("space-create", ctxA, {}, { title: "Sentiment Demo", modelId: "distilbert" }).result.space;
    assert.notEqual(pub.url, dup.url, "slugs are unique");
    const slug = pub.url.split("/").pop();
    const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };
    const viewed = call("space-get", ctxB, {}, { slug });
    assert.equal(viewed.ok, true);
    assert.equal(viewed.result.space.modelId, "distilbert");
    assert.equal(viewed.result.isOwner, false);
    assert.equal(viewed.result.space.views, 1);

    const priv = call("space-create", ctxA, {}, { title: "Secret", modelId: "gpt2", private: true }).result.space;
    const pslug = priv.url.split("/").pop();
    assert.equal(call("space-get", ctxB, {}, { slug: pslug }).ok, false);
    assert.equal(call("space-get", ctxA, {}, { slug: pslug }).ok, true);
  });
});
