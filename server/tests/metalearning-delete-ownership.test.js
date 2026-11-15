// Delete-ownership fix (from desk-CI batch 3, CB-0725): delete_curriculum
// and delete_strategy checked existence only, because no record carried an
// owner to refuse on — B9's exercise deleted another user's curriculum
// live. The fix stamps ownerId at generation (from ctx.actor.userId, via
// the two generation macros — the only creation paths) and enforces it at
// delete: another caller's delete refuses in words, an ownerless record
// (legacy / platform corpus / anonymously generated) is not deletable by
// ordinary callers, and the owner's delete works exactly as before.
//
// Hermetic extraction harness in the batch-3 pattern: the metalearning
// macro block, ensureMetaLearningSystem, defineLearningStrategy and
// generateCurriculum are extracted VERBATIM from server.js and run against
// a scratch STATE; external dependencies are stubbed by name
// (findSimilarDtus -> no matches, the ethos/save/semantic helpers ->
// no-ops, uid/nowISO/clamp -> faithful stubs). A monolith boot is not
// available in every environment; this exercises the real code either way.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compileFunction } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SERVER_JS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "server.js"), "utf8");

function extractFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) return null;
  const rest = src.slice(start + 1);
  const nextFn = rest.indexOf("\nfunction ");
  const nextBanner = rest.indexOf("\n// =====");
  let end = rest.length;
  if (nextFn !== -1) end = Math.min(end, nextFn);
  if (nextBanner !== -1) end = Math.min(end, nextBanner);
  return src.slice(start, start + 1 + end);
}

function extractMacroBlock(src) {
  const a = src.indexOf("// ===== META-LEARNING MACROS =====");
  const b = src.indexOf("// ===== END META-LEARNING MACROS =====");
  assert.ok(a !== -1 && b !== -1 && b > a, "metalearning macro block markers present");
  return src.slice(a, b);
}

function buildMacros() {
  const parts = [
    extractFunction(SERVER_JS, "ensureMetaLearningSystem"),
    extractFunction(SERVER_JS, "metaCallerId"),
    extractFunction(SERVER_JS, "defineLearningStrategy"),
    extractFunction(SERVER_JS, "generateCurriculum"),
    extractMacroBlock(SERVER_JS),
  ];
  assert.ok(parts[0] && parts[2] && parts[3], "generation + ensure functions extractable");
  const STATE = {};
  let n = 0;
  const factory = compileFunction(
    `
    let __n = 0;
    const uid = (p) => p + "_t" + (++__n);
    const nowISO = () => new Date().toISOString();
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const enforceEthosInvariant = () => {};
    const saveStateDebounced = () => {};
    const ensureSemanticEngine = () => {};
    const findSimilarDtus = () => [];
    const META_LEARNING_INVARIANTS = {};
    const recordStrategyOutcome = () => ({ ok: false, error: "stub" });
    const adaptStrategy = () => ({ ok: false, error: "stub" });
    const getBestStrategy = () => ({ ok: true, strategy: null });
    const __macros = new Map();
    const register = (domain, name, fn) => __macros.set(name, fn);
    ${parts.filter(Boolean).join("\n")}
    return __macros;
    `,
    ["STATE"],
  );
  const macros = factory(STATE);
  return { macros, STATE };
}

const ctxFor = (STATE, userId) => ({ state: STATE, actor: userId ? { userId } : { userId: "anon" } });

function freshStore() {
  const { macros, STATE } = buildMacros();
  macros.get("list_curricula")(ctxFor(STATE, "user-a"), {});
  return { macros, STATE };
}

test("strategy: generation stamps the caller; owner deletes; another caller refuses in words", () => {
  const { macros, STATE } = freshStore();
  const a = ctxFor(STATE, "user-a");
  const b = ctxFor(STATE, "user-b");
  const made = macros.get("define_strategy")(a, { name: "Spaced review", domain: "memory" });
  assert.equal(made.ok, true);
  assert.equal(made.strategy.ownerId, "user-a", "the stamp is the generating caller");

  const listed = macros.get("list_strategies")(b, {});
  assert.equal(listed.strategies.find((s) => s.id === made.strategy.id)?.ownerId, "user-a", "the list carries the stamp");

  const refused = macros.get("delete_strategy")(b, { strategyId: made.strategy.id });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /only delete strategies you defined/);
  assert.ok(STATE.metaLearning.strategies.has(made.strategy.id), "the record survives a refused delete");

  const gone = macros.get("delete_strategy")(a, { strategyId: made.strategy.id });
  assert.equal(gone.ok, true);
  assert.ok(!STATE.metaLearning.strategies.has(made.strategy.id));
});

test("strategy: an ownerless legacy record is not deletable by ordinary callers; missing id refuses as before", () => {
  const { macros, STATE } = freshStore();
  const a = ctxFor(STATE, "user-a");
  STATE.metaLearning.strategies.set("strat_legacy", { id: "strat_legacy", name: "Legacy", domain: "general", uses: 0, successes: 0, failures: 0, parameters: {}, createdAt: "2026-01-01T00:00:00Z" });
  const refused = macros.get("delete_strategy")(a, { strategyId: "strat_legacy" });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /predates ownership records/);
  assert.ok(STATE.metaLearning.strategies.has("strat_legacy"));
  const missing = macros.get("delete_strategy")(a, { strategyId: "strat_nope" });
  assert.equal(missing.ok, false);
  assert.equal(missing.error, "Strategy not found");
});

test("curriculum: generation stamps the caller; owner deletes; another caller refuses in words", () => {
  const { macros, STATE } = freshStore();
  const a = ctxFor(STATE, "user-a");
  const b = ctxFor(STATE, "user-b");
  const made = macros.get("curriculum")(a, { topic: "Topology" });
  assert.equal(made.ok, true);
  assert.equal(made.curriculum.ownerId, "user-a");

  const refused = macros.get("delete_curriculum")(b, { curriculumId: made.curriculum.id });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /only delete curricula you generated/);
  assert.ok(STATE.metaLearning.curriculum.some((c) => c.id === made.curriculum.id));

  const gone = macros.get("delete_curriculum")(a, { curriculumId: made.curriculum.id });
  assert.equal(gone.ok, true);
  assert.ok(!STATE.metaLearning.curriculum.some((c) => c.id === made.curriculum.id));
});

test("curriculum: ownerless corpus records refuse every ordinary caller; anonymous generations stay ownerless; missing id refuses as before", () => {
  const { macros, STATE } = freshStore();
  const a = ctxFor(STATE, "user-a");
  const anon = ctxFor(STATE, null);

  const anonMade = macros.get("curriculum")(anon, { topic: "Anonymous topic" });
  assert.equal(anonMade.ok, true);
  assert.ok(!anonMade.curriculum.ownerId, "an anonymous generation has no owner to stamp");

  const refusedAnonMade = macros.get("delete_curriculum")(a, { curriculumId: anonMade.curriculum.id });
  assert.equal(refusedAnonMade.ok, false);
  assert.match(refusedAnonMade.error, /shared platform corpus/);
  assert.ok(STATE.metaLearning.curriculum.some((c) => c.id === anonMade.curriculum.id));

  STATE.metaLearning.curriculum.push({ id: "curr_legacy", topic: "Legacy", source: "corpus", steps: [], createdAt: "2026-01-01T00:00:00Z" });
  const refusedLegacy = macros.get("delete_curriculum")(a, { curriculumId: "curr_legacy" });
  assert.equal(refusedLegacy.ok, false);
  assert.match(refusedLegacy.error, /shared platform corpus/);

  const missing = macros.get("delete_curriculum")(a, { curriculumId: "curr_nope" });
  assert.equal(missing.ok, false);
  assert.equal(missing.error, "Curriculum not found");
});
