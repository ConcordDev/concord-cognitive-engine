// server/lib/shadow-council.js
//
// Shadow Reasoning Council (#12) — turns the five-voice council (emergent/
// council-voices.js) from a transient VOTE into a persisted, citable
// deliberation. Each voice argues from its bias; the module composes the
// consensus + the DISSENT (the minority report that a plain "accept/reject"
// throws away) and mints a kind='shadow_reasoning' DTU so the reasoning becomes
// a first-class, citable artifact of the substrate. Fully deterministic — the
// council math is pure, so no brains are required; an optional LLM pass can
// enrich each voice's prose but never changes the verdict.

import { runCouncilVoices, COUNCIL_VOICES } from "../emergent/council-voices.js";
import { createDTU } from "../economy/dtu-pipeline.js";
import { TASK_PROMPTS } from "./prompt-registry.js";

/**
 * Run the shadow council on a question/proposal and (optionally) persist the
 * deliberation as a DTU. Never throws. Fully synchronous / deterministic —
 * this is the pure council math and MUST stay that way: `deliberateWithEnrichment`
 * below is the ONLY place an LLM ever touches a deliberation, and it is
 * structurally unable to affect verdict/confidence/unanimous/voices (those are
 * already computed, by this function, before enrichment ever runs).
 *
 * @param {object} db
 * @param {object} opts
 * @param {string}  opts.question       the question/claim under deliberation
 * @param {object}  [opts.proposal]     optional {scores,tags} signals for the voices
 * @param {object}  [opts.qualiaState]  optional channel state to bias voices
 * @param {string}  [opts.requesterId]  author of the minted DTU
 * @param {boolean} [opts.persist=false] mint a shadow_reasoning DTU
 * @param {object}  [opts.action=null]  optional proposed action `{domain,name,input}`
 *                                      this deliberation is judging — carried through
 *                                      to the result untouched so a caller (e.g.
 *                                      shadow-parliament.js#enact) can execute it
 *                                      when the verdict passes. Purely a passthrough
 *                                      field; never read by the council math itself.
 * @returns {{ok, verdict, confidence, unanimous, voices, consensus, dissent, action, dtuId?}}
 */
export function deliberate(db, { question, proposal = null, qualiaState = null, requesterId = null, persist = false, action = null } = {}) {
  const q = String(question || "").trim();
  if (!q) return { ok: false, reason: "no_question" };

  // Derive a minimal proposal shape when the caller passes only a question.
  const prop = proposal || { title: q, tags: [], scores: {} };
  let council;
  try {
    council = runCouncilVoices(prop, qualiaState);
  } catch (e) {
    return { ok: false, reason: "council_failed", error: String(e?.message || e) };
  }

  const entries = Object.entries(council.voices).map(([id, v]) => ({ id, ...v }));
  const consensus = entries.filter((v) => v.vote === council.verdictAction).map((v) => v.id);
  // The minority report: voices that disagree with the verdict — the value the
  // shadow council preserves that a flat vote discards.
  const dissent = entries
    .filter((v) => v.vote !== council.verdictAction)
    .map((v) => ({ voice: v.id, label: v.label, vote: v.vote, score: v.score, concern: v.perspective }));

  const result = {
    ok: true,
    question: q,
    verdict: council.verdictAction,
    confidence: council.confidence,
    unanimous: council.unanimous,
    voices: council.voices,
    consensus,
    dissent,
    action: action || null,
  };

  if (persist && db && requesterId) {
    try {
      const body = composeDeliberationProse(q, council, dissent);
      const r = createDTU(db, {
        creatorId: requesterId,
        title: `Shadow council: ${q.slice(0, 80)}`,
        content: body,
        contentType: "text",
        lensId: "reason",
        citationMode: "original",
        tags: ["shadow_reasoning", "council", council.verdictAction],
        metadata: {
          kind: "shadow_reasoning",
          verdict: council.verdictAction,
          confidence: council.confidence,
          unanimous: council.unanimous,
          dissent: dissent.map((d) => d.voice),
          action: action || null,
        },
      });
      if (r?.ok && r.dtu?.id) result.dtuId = r.dtu.id;
    } catch { /* persistence is best-effort — the deliberation stands without it */ }
  }
  return result;
}

/**
 * Deterministic prose rendering of the deliberation (the DTU body). When
 * `enrichedVoices` is supplied (voiceId -> fully-argued text), it REPLACES the
 * terse canned perspective for display only — the verdict/score/vote printed
 * alongside it always come from `council`, never from the enriched text.
 */
export function composeDeliberationProse(question, council, dissent, enrichedVoices = null) {
  const lines = [`Question: ${question}`, "", `Verdict: ${council.verdictAction} (confidence ${council.confidence})`, ""];
  for (const voice of COUNCIL_VOICES) {
    const v = council.voices[voice.id];
    if (!v) continue;
    const prose = (enrichedVoices && typeof enrichedVoices[voice.id] === "string") ? enrichedVoices[voice.id] : v.perspective;
    lines.push(`— ${v.label} [${v.vote}, ${v.score}]: ${prose}`);
  }
  if (dissent.length) {
    lines.push("", "Minority report:");
    for (const d of dissent) lines.push(`  • ${d.label} (${d.vote}): ${d.concern}`);
  } else {
    lines.push("", "The council was unanimous.");
  }
  return lines.join("\n");
}

// ── Optional LLM enrichment (additive, prose-only) ──────────────────────────
//
// Gate: CONCORD_SHADOW_COUNCIL_LLM=true (default OFF). Even when a caller
// wires an `llm`, nothing fires unless this env var is also on — so flipping
// a caller's behavior requires an explicit, visible ops decision, not just a
// code change. On any failure/timeout for a given voice, that voice's entry
// is simply omitted from the returned map — composeDeliberationProse then
// falls back to the deterministic `perspective` string for that voice. No
// exception from this function ever propagates to the caller.
const LLM_ENRICH_TIMEOUT_MS = 8000;

async function _enrichOneVoice(db, { voiceDef, voiceResult, question, requesterId, llm }) {
  const prompt = TASK_PROMPTS.shadowCouncilVoiceArgument({
    voiceLabel: voiceResult.label,
    voiceRole: voiceDef.role,
    question,
    vote: voiceResult.vote,
    score: voiceResult.score,
  });
  const messages = [{ role: "user", content: prompt }];
  const timeout = () => new Promise((_resolve, reject) => {
    setTimeout(() => reject(new Error("llm_timeout")), LLM_ENRICH_TIMEOUT_MS);
  });

  let text = null;
  try {
    if (llm && typeof llm.chat === "function") {
      const r = await Promise.race([
        llm.chat({ system: null, messages, slot: "subconscious", timeoutMs: LLM_ENRICH_TIMEOUT_MS }),
        timeout(),
      ]);
      text = typeof r === "string" ? r : (r?.text ?? r?.content ?? null);
    } else {
      const { brainChat } = await import("./byo-router.js");
      const r = await Promise.race([
        brainChat({ db, userId: requesterId || null, slot: "subconscious", messages }),
        timeout(),
      ]);
      text = r?.text ?? null;
    }
  } catch {
    text = null; // honest fallback — this voice keeps its deterministic prose
  }
  return (typeof text === "string" && text.trim().length >= 10) ? text.trim().slice(0, 1200) : null;
}

/**
 * Route each voice's terse `perspective` through the subconscious brain to
 * produce a fully-argued case. PROSE ONLY: takes the already-computed
 * `voices` map (vote/score are read-only inputs to the prompt, never
 * reassigned) and returns a NEW `{ voiceId: text }` map — it never mutates
 * its inputs and has no way to influence verdict/confidence/unanimous, which
 * were already finalized by `deliberate()` before this is ever called.
 *
 * No-ops (returns {}) unless CONCORD_SHADOW_COUNCIL_LLM=true.
 */
export async function enrichVoiceProse(db, { voices, question, requesterId = null, llm = null } = {}) {
  if (process.env.CONCORD_SHADOW_COUNCIL_LLM !== "true") return {};
  const out = {};
  for (const voiceDef of COUNCIL_VOICES) {
    const voiceResult = voices?.[voiceDef.id];
    if (!voiceResult) continue;
    const text = await _enrichOneVoice(db, { voiceDef, voiceResult, question, requesterId, llm });
    if (text) out[voiceDef.id] = text;
  }
  return out;
}

/**
 * `deliberate()` + optional LLM prose enrichment, composed as a single async
 * call. The verdict math runs first and is frozen into the result exactly as
 * `deliberate()` produces it; enrichment only ever adds a parallel
 * `enrichedVoices` field and (when persisting) a richer DTU body. Safe to call
 * even when CONCORD_SHADOW_COUNCIL_LLM is off — it degrades to plain
 * `deliberate()` behavior with `enrichedVoices: null`.
 *
 * @param {object} db
 * @param {object} opts  same as `deliberate()`, plus:
 * @param {object} [opts.llm]  optional `{ chat }` — tests inject a stub here.
 * @returns {{...deliberate() result, enrichedVoices, enrichmentUsed}}
 */
export async function deliberateWithEnrichment(db, opts = {}) {
  const { llm = null, persist = false, requesterId = null, ...rest } = opts;
  const base = deliberate(db, { ...rest, requesterId, persist: false });
  if (!base.ok) return base;

  let enrichedVoices = null;
  try {
    const enriched = await enrichVoiceProse(db, { voices: base.voices, question: base.question, requesterId, llm });
    enrichedVoices = enriched && Object.keys(enriched).length ? enriched : null;
  } catch {
    enrichedVoices = null; // honest fallback — identical to enrichment being off
  }
  base.enrichedVoices = enrichedVoices;
  base.enrichmentUsed = !!enrichedVoices;

  if (persist && db && requesterId) {
    try {
      const councilShape = { verdictAction: base.verdict, confidence: base.confidence, voices: base.voices };
      const body = composeDeliberationProse(base.question, councilShape, base.dissent, enrichedVoices);
      const r = createDTU(db, {
        creatorId: requesterId,
        title: `Shadow council: ${base.question.slice(0, 80)}`,
        content: body,
        contentType: "text",
        lensId: "reason",
        citationMode: "original",
        tags: ["shadow_reasoning", "council", base.verdict],
        metadata: {
          kind: "shadow_reasoning",
          verdict: base.verdict,
          confidence: base.confidence,
          unanimous: base.unanimous,
          dissent: base.dissent.map((d) => d.voice),
          enriched: base.enrichmentUsed,
          action: base.action || null,
        },
      });
      if (r?.ok && r.dtu?.id) base.dtuId = r.dtu.id;
    } catch { /* persistence is best-effort — the deliberation stands without it */ }
  }
  return base;
}

export default { deliberate, deliberateWithEnrichment, enrichVoiceProse, composeDeliberationProse };
