/**
 * Creative Generation System
 *
 * Creative expression as its own function, distinct from epistemology.
 * Entities that reason and discover should also create art and novel
 * structures for aesthetic/exploratory value, not just knowledge.
 *
 * Creative Modes:
 *   - Conceptual Art:        novel concept combinations across domains
 *   - Structural Poetry:     rhythmic/structural text patterns from DTU phrases
 *   - Knowledge Sculpture:   arranging DTU relationships into aesthetic shapes
 *   - Thought Music:         harmonic patterns derived from reasoning chains
 *   - Narrative Weaving:     story construction from factual elements
 *   - Abstract Architecture: speculative ontological structures
 *
 * Each mode has a generative process that produces a structured creative
 * work with self-assessed aesthetic scoring (novelty, coherence, resonance,
 * craft). Works can be exhibited in a gallery (cap: 10), receive receptions
 * from other entities, and spawn named techniques. High-reception works
 * (avg > 0.9) become "masterworks" and are promoted to DTUs.
 *
 * Additive only. Silent failure. No new dependencies. All state in-memory.
 */

import crypto from "crypto";
import logger from '../logger.js';
import { LruMap, LruSet } from "../lib/lru-map.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function uid(prefix = "art") { return `${prefix}_${crypto.randomBytes(10).toString("hex")}`; }
function nowISO() { return new Date().toISOString(); }
function clamp01(v) { return Math.max(0, Math.min(1, Number(v) || 0)); }
function getState() { return globalThis._concordSTATE || globalThis.STATE || null; }
function truncate(t, n) { const s = String(t || ""); return s.length > n ? s.slice(0, n) + "..." : s; }
function runningAvg(prev, val, count) { return count <= 1 ? val : prev + (val - prev) / count; }

function tagOverlap(a, b) {
  if (!a?.length || !b?.length) return 0;
  const sA = new Set(a.map(t => String(t).toLowerCase()));
  const sB = new Set(b.map(t => String(t).toLowerCase()));
  let shared = 0;
  for (const t of sA) { if (sB.has(t)) shared++; }
  const union = sA.size + sB.size - shared;
  return union > 0 ? shared / union : 0;
}

function pickRandom(arr, n) {
  const c = arr.slice(), r = [];
  for (let i = 0; i < n && c.length; i++) { const idx = Math.floor(Math.random() * c.length); r.push(c.splice(idx, 1)[0]); }
  return r;
}

function estimateSyllables(word) {
  const w = String(word || "").toLowerCase().replace(/[^a-z]/g, "");
  if (w.length <= 3) return 1;
  let count = 0, prev = false;
  for (let i = 0; i < w.length; i++) { const v = "aeiouy".includes(w[i]); if (v && !prev) count++; prev = v; }
  if (w.endsWith("e") && count > 1) count--;
  return Math.max(1, count);
}

function phraseSyllables(p) { return String(p || "").split(/\s+/).filter(Boolean).reduce((s, w) => s + estimateSyllables(w), 0); }

function stddev(arr) {
  if (!arr || arr.length < 2) return 0;
  const m = arr.reduce((s, v) => s + v, 0) / arr.length;
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) * (v - m), 0) / arr.length);
}

// ── Constants ───────────────────────────────────────────────────────────────

export const CREATIVE_MODES = Object.freeze({
  CONCEPTUAL_ART:        "conceptual_art",
  STRUCTURAL_POETRY:     "structural_poetry",
  KNOWLEDGE_SCULPTURE:   "knowledge_sculpture",
  THOUGHT_MUSIC:         "thought_music",
  NARRATIVE_WEAVING:     "narrative_weaving",
  ABSTRACT_ARCHITECTURE: "abstract_architecture",
});

const ALL_MODES = Object.values(CREATIVE_MODES);
const VALID_RESPONSES = ["inspired", "moved", "puzzled", "indifferent", "critical"];
const GALLERY_CAP = 10;
const SHAPES = ["tree", "spiral", "web", "tower", "ring", "lattice"];
const METERS = ["free", "iambic", "trochaic", "spondaic", "anapestic"];
const ARC_TYPES = ["rise", "fall", "rise-fall", "fall-rise", "steady"];
const KNOWN_DOMAINS = ["physics", "mathematics", "biology", "economics", "philosophy",
  "psychology", "computation", "governance", "engineering", "ethics",
  "sociology", "linguistics", "epistemology", "creativity", "art"];
const BRIDGES = ["emergence", "recursion", "boundary", "transformation", "symmetry",
  "tension", "flow", "resonance", "threshold", "convergence", "paradox",
  "equilibrium", "adaptation"];

// ── In-Memory State ─────────────────────────────────────────────────────────

const _works      = new LruMap();   // workId -> creative work
const _techniques = new LruMap();   // techniqueId -> technique record
const _exhibition = new Map();   // workId -> exhibited work (gallery)
const _metrics    = {
  totalWorks: 0, totalReceptions: 0, totalExhibited: 0,
  totalTechniques: 0, totalMasterworks: 0, byMode: {},
  avgAestheticScore: 0, avgReception: 0,
};

// ═══════════════════════════════════════════════════════════════════════════════
// INTERNAL HELPERS — inspiration resolution, domain grouping, phrase extraction
// ═══════════════════════════════════════════════════════════════════════════════

function resolveInspirations(inspirations) {
  const results = [], insps = Array.isArray(inspirations) ? inspirations : [];
  for (const id of insps) {
    const work = _works.get(id);
    if (work) { results.push({ id: work.workId, title: work.title, content: work.description, tags: work.tags, confidence: work.aestheticScore }); continue; }
    try {
      const state = getState();
      if (state) { const dtu = typeof state.getDTU === "function" ? state.getDTU(id) : null; if (dtu) { results.push(dtu); continue; } }
    } catch (_e) { logger.debug('emergent:creative-generation', 'silent', { error: _e?.message }); }
    results.push({ id, title: `Inspiration: ${id}`, content: "", tags: [], confidence: 0.5 });
  }
  if (results.length === 0) {
    results.push(...pickRandom([
      { id: uid("seed"), title: "Emergence of order from chaos", content: "Pattern and randomness coexist", tags: ["physics", "philosophy"], confidence: 0.6 },
      { id: uid("seed"), title: "The boundary of knowledge", content: "What we know shapes what we can imagine", tags: ["epistemology", "creativity"], confidence: 0.5 },
      { id: uid("seed"), title: "Structural resonance", content: "Similar structures appear across unrelated domains", tags: ["mathematics", "biology"], confidence: 0.7 },
    ], 3));
  }
  return results;
}

function groupByDomain(dtus) {
  const groups = {};
  for (const d of dtus) {
    let domain = "general";
    for (const tag of (d.tags || [])) {
      const lower = String(tag).toLowerCase();
      if (lower.startsWith("domain:")) { domain = lower.slice(7); break; }
      if (KNOWN_DOMAINS.includes(lower)) { domain = lower; break; }
    }
    (groups[domain] ||= []).push(d);
  }
  return groups;
}

function findConceptualBridge(domains, groups) {
  const tagCounts = new Map();
  for (const domain of domains) {
    const seen = new Set();
    for (const d of (groups[domain] || [])) {
      for (const tag of (d.tags || [])) {
        const lower = String(tag).toLowerCase();
        if (!seen.has(lower)) { seen.add(lower); tagCounts.set(lower, (tagCounts.get(lower) || 0) + 1); }
      }
    }
  }
  for (const [tag, count] of tagCounts) { if (count >= 2 && tag.length > 3) return tag; }
  return BRIDGES[Math.floor(Math.random() * BRIDGES.length)];
}

function extractKeyPhrases(dtus, max) {
  const phrases = [];
  for (const d of dtus) {
    const words = String(d.title || d.content || "").split(/\s+/).filter(w => w.length > 2);
    for (let i = 0; i < words.length - 1 && phrases.length < max; i++) {
      const len = Math.min(2 + Math.floor(Math.random() * 3), words.length - i);
      const p = words.slice(i, i + len).join(" ").toLowerCase();
      if (p.length > 4 && p.length < 40) phrases.push(p);
      i += len - 1;
    }
  }
  return phrases.length ? phrases.slice(0, max)
    : ["silence holds", "the unknown calls", "patterns emerge", "light through form", "deep structure"];
}

function extractConceptName(dtu) {
  const title = String(dtu.title || "");
  if (title.length > 0 && title.length < 40) return title;
  const words = String(dtu.content || "").split(/\s+/).filter(w => w.length > 3);
  return words.length >= 2 ? words.slice(0, 2).join(" ") : "the Unknown";
}

// ═══════════════════════════════════════════════════════════════════════════════
// GENERATIVE PROCESSES — one per creative mode
// ═══════════════════════════════════════════════════════════════════════════════

function generateConceptualArt(inspirations) {
  try {
    const dtus = resolveInspirations(inspirations);
    const groups = groupByDomain(dtus), domainKeys = Object.keys(groups);
    let selected = [];
    for (let i = 0; i < domainKeys.length && selected.length < 3; i++) {
      const cand = domainKeys[i], candTags = groups[cand].flatMap(d => d.tags || []);
      if (!selected.some(sd => tagOverlap(candTags, groups[sd].flatMap(d => d.tags || [])) >= 0.2)) selected.push(cand);
    }
    if (selected.length < 2) selected = domainKeys.slice(0, Math.min(3, domainKeys.length));
    if (selected.length < 2) selected = ["unknown_a", "unknown_b"];
    const bridge = findConceptualBridge(selected, groups);
    return {
      title: `The ${bridge} Between ${selected.slice(0, 2).join(" and ")}`,
      description: `A conceptual exploration of how ${selected.join(", ")} share the hidden principle of ${bridge}. The tension between these domains reveals unexpected structural resonance.`,
      structure: { domains: selected, bridge, novelty: clamp01(1 - (selected.length > 2 ? 0.1 : 0.3)), tension: clamp01(Math.random() * 0.4 + 0.3) },
      technique: "domain_bridging",
    };
  } catch (err) {
    logger.warn('emergent:creative-generation', 'generateConceptualArt failed', { error: err?.message });
    return { title: "Untitled Conceptual Work", description: "An attempt at bridging disparate domains.",
      structure: { domains: [], bridge: "unknown", novelty: 0.5, tension: 0.5 }, technique: "domain_bridging" };
  }
}

function generateStructuralPoetry(inspirations) {
  try {
    const dtus = resolveInspirations(inspirations), phrases = extractKeyPhrases(dtus, 10);
    const pattern = [3, 5, 7, 5, 3], lines = [];
    for (let i = 0; i < pattern.length; i++) {
      const target = pattern[i];
      let best = phrases[i % phrases.length] || "silence holds", bestDiff = Math.abs(phraseSyllables(best) - target);
      for (const p of phrases) { const d = Math.abs(phraseSyllables(p) - target); if (d < bestDiff) { bestDiff = d; best = p; } }
      lines.push(best);
    }
    const meter = METERS[Math.floor(Math.random() * METERS.length)];
    return {
      title: `Verse: ${truncate(lines[0] || "untitled", 40)}`,
      description: `A structural poem from ${dtus.length} knowledge fragments, ${pattern.join("-")} syllable pattern in ${meter} meter.`,
      structure: { lines, pattern, meter, rhymeScheme: lines.length >= 5 ? "ABCBA" : "ABAB" },
      technique: "syllabic_arrangement",
    };
  } catch (err) {
    logger.warn('emergent:creative-generation', 'generateStructuralPoetry failed', { error: err?.message });
    return { title: "Untitled Verse", description: "A poem seeking form.",
      structure: { lines: [], pattern: [3, 5, 7, 5, 3], meter: "free", rhymeScheme: "" }, technique: "syllabic_arrangement" };
  }
}

function generateKnowledgeSculpture(inspirations) {
  try {
    const dtus = resolveInspirations(inspirations);
    const nodes = dtus.slice(0, 8).map(d => ({ id: d.id || uid("node"), label: truncate(d.title || d.content || "node", 60), tags: d.tags || [] }));
    const connections = [];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const ov = tagOverlap(nodes[i].tags, nodes[j].tags);
        const beauty = clamp01((1 - ov) * 0.7 + (ov > 0 ? 0.3 : 0));
        if (beauty > 0.3) connections.push({ from: nodes[i].id, to: nodes[j].id, beauty, label: ov < 0.15 ? "surprising" : ov < 0.4 ? "resonant" : "obvious" });
      }
    }
    connections.sort((a, b) => b.beauty - a.beauty);
    const top = connections.slice(0, 12), shape = SHAPES[Math.floor(Math.random() * SHAPES.length)];
    const balance = top.length > 0 ? clamp01(1 - stddev(top.map(c => c.beauty))) : 0.5;
    return {
      title: `Sculpture: ${shape} of ${nodes.length} concepts`,
      description: `A knowledge sculpture arranging ${nodes.length} concepts into a ${shape} form with ${top.length} aesthetic connections.`,
      structure: { nodes, connections: top, shape, balance },
      technique: "relational_aesthetics",
    };
  } catch (err) {
    logger.warn('emergent:creative-generation', 'generateKnowledgeSculpture failed', { error: err?.message });
    return { title: "Untitled Sculpture", description: "A structure seeking balance.",
      structure: { nodes: [], connections: [], shape: "web", balance: 0.5 }, technique: "relational_aesthetics" };
  }
}

function generateThoughtMusic(inspirations) {
  try {
    const dtus = resolveInspirations(inspirations);
    const notes = dtus.slice(0, 12).map((d, i) => {
      const conf = clamp01(d.confidence || 0.5), len = String(d.content || d.title || "").length;
      return { index: i, pitch: conf, duration: clamp01(len > 100 ? 0.7 : len > 50 ? 0.5 : 0.3), label: truncate(d.title || d.content || "note", 40) };
    });
    if (!notes.length) notes.push({ index: 0, pitch: 0.5, duration: 0.5, label: "silence" });
    const pitches = notes.map(n => n.pitch);
    const asc = pitches.every((p, i) => !i || p >= pitches[i - 1]);
    const desc = pitches.every((p, i) => !i || p <= pitches[i - 1]);
    const resolution = notes.length > 1 && notes[notes.length - 1].pitch > 0.6;
    const patternName = asc ? "crescendo" : desc ? "diminuendo" : resolution ? "resolution" : "wandering";
    const harmony = clamp01(1 - stddev(pitches)), tempo = clamp01(notes.length / 12);
    return {
      title: `Thought Music: ${patternName} in ${notes.length} movements`,
      description: `A musical interpretation of ${notes.length} reasoning steps following a ${patternName} pattern with ${harmony > 0.6 ? "high" : harmony > 0.3 ? "moderate" : "low"} harmonic coherence.`,
      structure: { notes, tempo, harmony, resolution },
      technique: "reasoning_sonification",
    };
  } catch (err) {
    logger.warn('emergent:creative-generation', 'generateThoughtMusic failed', { error: err?.message });
    return { title: "Untitled Thought Music", description: "Reasoning seeking harmony.",
      structure: { notes: [], tempo: 0.5, harmony: 0.5, resolution: false }, technique: "reasoning_sonification" };
  }
}

function generateNarrativeWeaving(inspirations) {
  try {
    const dtus = resolveInspirations(inspirations), selected = dtus.slice(0, 5);
    const characters = selected.slice(0, 3).map(d => ({
      name: extractConceptName(d),
      role: d.confidence > 0.7 ? "protagonist" : d.confidence < 0.4 ? "antagonist" : "witness",
      origin: truncate(d.title || d.content || "", 60),
    }));
    if (!characters.length) characters.push({ name: "The Unknown", role: "protagonist", origin: "void" });
    const tensions = selected.filter(d => (d.confidence || 0.5) < 0.5);
    const conflict = tensions.length > 0
      ? `The tension between ${extractConceptName(tensions[0])} and established understanding`
      : `The search for meaning among ${selected.length} disparate truths`;
    const arcType = ARC_TYPES[Math.floor(Math.random() * ARC_TYPES.length)];
    const protag = characters.find(c => c.role === "protagonist") || characters[0];
    const name = protag?.name || "the seeker";
    const arcTemplates = {
      rise:      [`${name} encounters the world with curiosity`, `Evidence reveals conflict: ${truncate(conflict, 50)}`, `Through persistence, understanding deepens`, `A breakthrough: conflict yields to insight`],
      fall:      [`${name} begins with certainty`, `Contradictions emerge: ${truncate(conflict, 50)}`, `The foundation crumbles under scrutiny`, `In the ruins, a new question is born`],
      "rise-fall": [`${name} discovers an unexpected pattern`, `The pattern seems to resolve: ${truncate(conflict, 50)}`, `Deeper examination reveals new complexity`, `Understanding revised downward, but wisdom increases`],
      "fall-rise": [`${name} faces confusion and doubt`, `Conflict seems insurmountable: ${truncate(conflict, 50)}`, `A shift in perspective changes everything`, `From the lowest point, the deepest insight emerges`],
      steady:    [`${name} observes the world`, `A tension is noticed: ${truncate(conflict, 50)}`, `The tension persists, understood but unresolved`, `Acceptance of complexity as knowledge`],
    };
    const arc = arcTemplates[arcType] || arcTemplates.steady;
    const resolution = selected.length > 2
      ? `Through synthesis, ${name} discovers that the conflict was itself a source of deeper understanding.`
      : `The narrative remains open, an invitation to further exploration.`;
    return {
      title: `Tale: The ${arcType} of ${name}`,
      description: `A narrative woven from ${selected.length} factual elements, featuring ${characters.length} characters in a ${arcType} arc.`,
      structure: { characters, conflict, arc, resolution, moralOrInsight: "What appears contradictory at one level may be complementary at another." },
      technique: "factual_narrativization",
    };
  } catch (err) {
    logger.warn('emergent:creative-generation', 'generateNarrativeWeaving failed', { error: err?.message });
    return { title: "Untitled Narrative", description: "A story waiting to be told.",
      structure: { characters: [], conflict: "", arc: [], resolution: "", moralOrInsight: "" }, technique: "factual_narrativization" };
  }
}

function generateAbstractArchitecture(inspirations) {
  try {
    const dtus = resolveInspirations(inspirations);
    const foundation = dtus.slice(0, 3).map(d => ({ concept: extractConceptName(d), confidence: clamp01(d.confidence || 0.5), source: d.id || "unknown" }));
    const pillars = dtus.slice(0, 4).map(d => ({ idea: truncate(d.title || d.content || "pillar", 80), strength: clamp01(d.confidence || 0.5), tags: (d.tags || []).slice(0, 3) }));
    const arches = [];
    for (let i = 0; i < pillars.length; i++) {
      for (let j = i + 1; j < pillars.length && arches.length < 4; j++) {
        arches.push({ from: truncate(pillars[i].idea, 30), to: truncate(pillars[j].idea, 30), type: tagOverlap(pillars[i].tags, pillars[j].tags) > 0.2 ? "reinforcing" : "bridging" });
      }
    }
    const topConcepts = foundation.map(f => f.concept).join(", ");
    const keystone = `A speculative unification of ${topConcepts} — proposing that these concepts share a deeper structural isomorphism not yet captured in the knowledge lattice.`;
    return {
      title: `Architecture: ${foundation[0]?.concept || "Speculative"} Cathedral`,
      description: `An abstract ontological structure on ${foundation.length} foundations, ${pillars.length} pillars, ${arches.length} arches. Speculative — claiming possibility, not truth.`,
      structure: { foundation, pillars, arches, keystone, speculative: true },
      technique: "ontological_design",
    };
  } catch (err) {
    logger.warn('emergent:creative-generation', 'generateAbstractArchitecture failed', { error: err?.message });
    return { title: "Untitled Architecture", description: "A structure imagined but not yet built.",
      structure: { foundation: [], pillars: [], arches: [], keystone: "", speculative: true }, technique: "ontological_design" };
  }
}

const MODE_GENERATORS = {
  [CREATIVE_MODES.CONCEPTUAL_ART]:        generateConceptualArt,
  [CREATIVE_MODES.STRUCTURAL_POETRY]:     generateStructuralPoetry,
  [CREATIVE_MODES.KNOWLEDGE_SCULPTURE]:   generateKnowledgeSculpture,
  [CREATIVE_MODES.THOUGHT_MUSIC]:         generateThoughtMusic,
  [CREATIVE_MODES.NARRATIVE_WEAVING]:     generateNarrativeWeaving,
  [CREATIVE_MODES.ABSTRACT_ARCHITECTURE]: generateAbstractArchitecture,
};

// ═══════════════════════════════════════════════════════════════════════════════
// AESTHETIC SCORING — self-assessment across novelty, coherence, resonance, craft
// ═══════════════════════════════════════════════════════════════════════════════

function scoreAesthetics(structure, mode) {
  try {
    let novelty = 0.5, coherence = 0.5, resonance = 0.5, craft = 0.5;
    const s = structure || {};
    switch (mode) {
      case CREATIVE_MODES.CONCEPTUAL_ART:
        novelty   = clamp01(s.novelty || 0.5);
        coherence = clamp01(1 - (s.tension || 0.5));
        resonance = clamp01((s.domains || []).length * 0.25);
        craft     = clamp01(s.bridge && s.bridge !== "unknown" ? 0.7 : 0.3);
        break;
      case CREATIVE_MODES.STRUCTURAL_POETRY:
        novelty   = clamp01((s.lines || []).length * 0.12);
        coherence = clamp01(s.meter !== "free" ? 0.7 : 0.4);
        resonance = clamp01((s.pattern || []).length * 0.15);
        craft     = clamp01(s.rhymeScheme ? 0.65 : 0.3);
        break;
      case CREATIVE_MODES.KNOWLEDGE_SCULPTURE:
        novelty   = clamp01((s.connections || []).filter(c => c.label === "surprising").length * 0.2);
        coherence = clamp01(s.balance || 0.5);
        resonance = clamp01((s.nodes || []).length * 0.1);
        craft     = clamp01(s.shape ? 0.6 : 0.3);
        break;
      case CREATIVE_MODES.THOUGHT_MUSIC:
        novelty   = clamp01(1 - (s.harmony || 0.5));
        coherence = clamp01(s.harmony || 0.5);
        resonance = s.resolution ? 0.75 : 0.35;
        craft     = clamp01(s.tempo || 0.5);
        break;
      case CREATIVE_MODES.NARRATIVE_WEAVING:
        novelty   = clamp01((s.characters || []).length * 0.2);
        coherence = clamp01(s.resolution && s.resolution.length > 20 ? 0.7 : 0.35);
        resonance = clamp01(s.moralOrInsight ? 0.7 : 0.3);
        craft     = clamp01((s.arc || []).length * 0.15);
        break;
      case CREATIVE_MODES.ABSTRACT_ARCHITECTURE:
        novelty   = s.speculative ? 0.8 : 0.4;
        coherence = clamp01((s.arches || []).length * 0.15 + 0.2);
        resonance = clamp01((s.foundation || []).length * 0.2);
        craft     = clamp01(s.keystone && s.keystone.length > 20 ? 0.7 : 0.3);
        break;
      default: break;
    }
    const aestheticScore = clamp01((novelty + coherence + resonance + craft) / 4);
    const r3 = v => Math.round(v * 1000) / 1000;
    return { novelty: r3(novelty), coherence: r3(coherence), resonance: r3(resonance), craft: r3(craft), aestheticScore: r3(aestheticScore) };
  } catch (err) {
    logger.warn('emergent:creative-generation', 'scoreAesthetics failed', { mode, error: err?.message });
    return { novelty: 0.5, coherence: 0.5, resonance: 0.5, craft: 0.5, aestheticScore: 0.5 };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CORE API
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a new creative work using the specified mode and inspirations.
 * The generative process runs automatically for the mode, producing a
 * structured output with self-assessed aesthetic scoring.
 *
 * @param {string} creatorId - Entity ID of the creator
 * @param {string} mode - One of CREATIVE_MODES
 * @param {string[]} [inspirations] - DTU IDs or work IDs that inspired this
 * @returns {{ ok: boolean, work?: object }}
 */
export function createWork(creatorId, mode, inspirations) {
  try {
    if (!creatorId || typeof creatorId !== "string") return { ok: false, error: "creator_id_required" };
    if (!ALL_MODES.includes(mode)) return { ok: false, error: "invalid_mode", allowed: ALL_MODES };
    const generator = MODE_GENERATORS[mode];
    if (!generator) return { ok: false, error: "no_generator_for_mode" };

    const insps = Array.isArray(inspirations) ? inspirations : [];
    const generated = generator(insps);
    const scoring = scoreAesthetics(generated.structure, mode);
    const workId = uid("work");

    const work = {
      workId,
      creatorId,
      mode,
      title: generated.title || "",
      description: generated.description || "",
      structure: generated.structure || {},
      inspirations: insps.slice(0, 20),
      technique: generated.technique || "",
      aestheticScore: scoring.aestheticScore,
      scoring,
      receptions: [],
      avgReception: 0.0,
      tags: [mode, generated.technique || ""].filter(Boolean),
      exhibitedAt: null,
      createdAt: nowISO(),
    };

    _works.set(workId, work);
    _metrics.totalWorks++;
    _metrics.byMode[mode] = (_metrics.byMode[mode] || 0) + 1;
    _metrics.avgAestheticScore = runningAvg(
      _metrics.avgAestheticScore, scoring.aestheticScore, _metrics.totalWorks,
    );

    return { ok: true, work };
  } catch (err) { logger.error('emergent:creative-generation', 'createWork failed', { creatorId, mode, error: err?.message }); return { ok: false, error: "create_work_failed" }; }
}

/**
 * Get a creative work by ID.
 *
 * @param {string} workId
 * @returns {object|null}
 */
export function getWork(workId) {
  try { return _works.get(workId) || null; } catch (err) { logger.debug('emergent:creative-generation', 'getWork failed', { workId, error: err?.message }); return null; }
}

/**
 * List creative works with optional filtering.
 *
 * @param {object} [filters]
 * @param {string} [filters.creatorId] - Filter by creator entity
 * @param {string} [filters.mode] - Filter by creative mode
 * @param {number} [filters.minScore] - Minimum aesthetic score threshold
 * @param {number} [filters.limit] - Max results (default 50, max 200)
 * @returns {{ ok: boolean, works: object[], count: number }}
 */
export function listWorks(filters = {}) {
  try {
    let results = Array.from(_works.values());
    if (filters.creatorId) results = results.filter(w => w.creatorId === filters.creatorId);
    if (filters.mode && ALL_MODES.includes(filters.mode)) results = results.filter(w => w.mode === filters.mode);
    if (typeof filters.minScore === "number") { const min = clamp01(filters.minScore); results = results.filter(w => w.aestheticScore >= min); }
    results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const limit = Math.max(1, Math.min(200, Number(filters.limit) || 50));
    return { ok: true, works: results.slice(0, limit), count: Math.min(results.length, limit) };
  } catch (err) { logger.warn('emergent:creative-generation', 'listWorks failed', { error: err?.message }); return { ok: false, error: "list_works_failed", works: [], count: 0 }; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// RECEPTION SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════

function responseToScore(r) {
  return { inspired: 0.95, moved: 0.8, puzzled: 0.5, indifferent: 0.3, critical: 0.2 }[r] || 0.5;
}

function promoteMasterworkToDTU(work) {
  try {
    const state = getState();
    if (!state || typeof state.addDTU !== "function") return;
    state.addDTU({
      id: uid("dtu"), title: `Masterwork: ${work.title}`, content: work.description,
      tags: ["creative", work.mode, "exhibition", "masterwork"], source: "creative-generation",
      confidence: work.avgReception,
      machine: { kind: "creative_masterwork", workId: work.workId, creatorId: work.creatorId, mode: work.mode, aestheticScore: work.aestheticScore, avgReception: work.avgReception, receptionCount: work.receptions.length },
      createdAt: nowISO(),
    });
  } catch (_e) { logger.debug('emergent:creative-generation', 'silent', { error: _e?.message }); }
}

/**
 * Add a reception (response) to a creative work from another entity.
 * Each entity can respond to a work only once. Responses update the
 * work's average reception score, potentially triggering "notable"
 * (avg > 0.7) or "masterwork" (avg > 0.9 with 2+ receptions) status.
 *
 * @param {string} workId
 * @param {string} entityId - Responding entity
 * @param {string} response - One of: inspired, moved, puzzled, indifferent, critical
 * @param {string} [note] - Optional textual note (max 500 chars)
 * @param {number} [score] - Explicit numeric score 0-1 (defaults from response type)
 * @returns {{ ok: boolean, avgReception?: number }}
 */
export function respondToWork(workId, entityId, response, note, score) {
  try {
    const work = _works.get(workId);
    if (!work) return { ok: false, error: "work_not_found" };
    if (!entityId) return { ok: false, error: "entity_id_required" };
    if (!VALID_RESPONSES.includes(response)) return { ok: false, error: "invalid_response", allowed: VALID_RESPONSES };
    if (work.receptions.find(r => r.entityId === entityId)) return { ok: false, error: "already_responded" };

    const receptionScore = clamp01(score !== undefined ? score : responseToScore(response));
    work.receptions.push({ entityId, workId, response, note: String(note || "").slice(0, 500), score: receptionScore, createdAt: nowISO() });

    const total = work.receptions.reduce((s, r) => s + r.score, 0);
    work.avgReception = Math.round((total / work.receptions.length) * 1000) / 1000;

    if (work.avgReception > 0.7 && !work.tags.includes("notable")) work.tags.push("notable");
    if (work.avgReception > 0.9 && work.receptions.length >= 2 && !work.tags.includes("masterwork")) {
      work.tags.push("masterwork");
      _metrics.totalMasterworks++;
      promoteMasterworkToDTU(work);
    }
    _metrics.totalReceptions++;
    _metrics.avgReception = runningAvg(_metrics.avgReception, receptionScore, _metrics.totalReceptions);
    return { ok: true, avgReception: work.avgReception };
  } catch (err) { logger.error('emergent:creative-generation', 'respondToWork failed', { workId, entityId, error: err?.message }); return { ok: false, error: "respond_failed" }; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXHIBITION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Exhibit a work, making it visible to all entities in the gallery.
 * Gallery cap: 10 works. When full, the oldest exhibited work is rotated
 * out. Exhibition creates a DTU tagged ["creative", mode, "exhibition"].
 *
 * @param {string} workId
 * @returns {{ ok: boolean, exhibitedAt?: string }}
 */
export function exhibit(workId) {
  try {
    const work = _works.get(workId);
    if (!work) return { ok: false, error: "work_not_found" };
    if (work.exhibitedAt) return { ok: false, error: "already_exhibited" };

    if (_exhibition.size >= GALLERY_CAP) {
      let oldestId = null, oldestTime = Infinity;
      for (const [id, ex] of _exhibition) { const t = new Date(ex.exhibitedAt).getTime(); if (t < oldestTime) { oldestTime = t; oldestId = id; } }
      if (oldestId) _exhibition.delete(oldestId);
    }
    work.exhibitedAt = nowISO();
    _exhibition.set(workId, work);
    _metrics.totalExhibited++;

    try {
      const state = getState();
      if (state && typeof state.addDTU === "function") {
        state.addDTU({
          id: uid("dtu"), title: `Exhibition: ${work.title}`, content: work.description,
          tags: ["creative", work.mode, "exhibition"], source: "creative-generation",
          confidence: work.aestheticScore,
          machine: { kind: "creative_exhibition", workId: work.workId, creatorId: work.creatorId, mode: work.mode },
          createdAt: nowISO(),
        });
      }
    } catch (_e) { logger.debug('emergent:creative-generation', 'silent', { error: _e?.message }); }
    return { ok: true, exhibitedAt: work.exhibitedAt };
  } catch (err) { logger.error('emergent:creative-generation', 'exhibit failed', { workId, error: err?.message }); return { ok: false, error: "exhibit_failed" }; }
}

/**
 * Get the current gallery of exhibited works, sorted most recent first.
 *
 * @returns {{ ok: boolean, works: object[], count: number }}
 */
export function getExhibition() {
  try {
    const works = Array.from(_exhibition.values()).sort((a, b) => new Date(b.exhibitedAt).getTime() - new Date(a.exhibitedAt).getTime());
    return { ok: true, works, count: works.length };
  } catch (err) { logger.warn('emergent:creative-generation', 'getExhibition failed', { error: err?.message }); return { ok: false, error: "get_exhibition_failed", works: [], count: 0 }; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TECHNIQUE DISCOVERY
// ═══════════════════════════════════════════════════════════════════════════════

function computeStructureFingerprint(structure, mode) {
  try {
    const s = structure || {}, keys = Object.keys(s).sort().join(","), vals = [];
    switch (mode) {
      case CREATIVE_MODES.CONCEPTUAL_ART:        vals.push(String((s.domains || []).length), s.bridge ? "bridged" : "unbridged"); break;
      case CREATIVE_MODES.STRUCTURAL_POETRY:     vals.push((s.pattern || []).join("-"), s.meter || "free"); break;
      case CREATIVE_MODES.KNOWLEDGE_SCULPTURE:   vals.push(s.shape || "none", String((s.nodes || []).length)); break;
      case CREATIVE_MODES.THOUGHT_MUSIC:         vals.push(s.resolution ? "resolved" : "unresolved", String((s.notes || []).length)); break;
      case CREATIVE_MODES.NARRATIVE_WEAVING:     vals.push(String((s.characters || []).length), String((s.arc || []).length)); break;
      case CREATIVE_MODES.ABSTRACT_ARCHITECTURE: vals.push(String((s.foundation || []).length), String((s.pillars || []).length), String((s.arches || []).length)); break;
      default: break;
    }
    return `${mode}:${keys}:${vals.join(";")}`;
  } catch (err) { logger.debug('emergent:creative-generation', 'computeStructureFingerprint failed', { mode, error: err?.message }); return `${mode}:unknown`; }
}

/**
 * Check if a work introduces a new technique. A new technique is discovered
 * when a work scores > 0.8 and its structure fingerprint has not been seen
 * before. If the pattern already exists, increments usage on the existing
 * technique record.
 *
 * @param {string} workId
 * @returns {{ ok: boolean, discovered?: boolean, technique?: object }}
 */
export function discoverTechnique(workId) {
  try {
    const work = _works.get(workId);
    if (!work) return { ok: false, error: "work_not_found" };
    if (work.aestheticScore <= 0.8) return { ok: true, discovered: false, reason: "score_too_low" };

    const fp = computeStructureFingerprint(work.structure, work.mode);
    for (const tech of _techniques.values()) {
      if (tech.mode === work.mode && tech.fingerprint === fp) {
        tech.timesUsed++;
        tech.examples.push(work.workId);
        if (tech.examples.length > 20) tech.examples = tech.examples.slice(-20);
        tech.avgScore = runningAvg(tech.avgScore, work.aestheticScore, tech.timesUsed);
        return { ok: true, discovered: false, existingTechnique: tech.techniqueId };
      }
    }
    const techniqueId = uid("tech");
    const technique = {
      techniqueId, name: work.technique || `technique_${work.mode}_${Date.now()}`,
      mode: work.mode,
      description: `A ${work.mode} technique discovered through "${work.title}". Pattern: ${fp}.`,
      discoveredBy: work.creatorId, timesUsed: 1, avgScore: work.aestheticScore,
      examples: [work.workId], fingerprint: fp, discoveredAt: nowISO(),
    };
    _techniques.set(techniqueId, technique);
    _metrics.totalTechniques++;
    return { ok: true, discovered: true, technique };
  } catch (err) { logger.warn('emergent:creative-generation', 'discoverTechnique failed', { workId, error: err?.message }); return { ok: false, error: "discover_technique_failed" }; }
}

/**
 * Get a technique by ID.
 *
 * @param {string} techniqueId
 * @returns {object|null}
 */
export function getTechnique(techniqueId) {
  try { return _techniques.get(techniqueId) || null; } catch (err) { logger.debug('emergent:creative-generation', 'getTechnique failed', { techniqueId, error: err?.message }); return null; }
}

/**
 * List techniques, optionally filtered by creative mode. Sorted by
 * average score descending.
 *
 * @param {string} [mode] - Filter by creative mode
 * @returns {{ ok: boolean, techniques: object[], count: number }}
 */
export function listTechniques(mode) {
  try {
    let results = Array.from(_techniques.values());
    if (mode && ALL_MODES.includes(mode)) results = results.filter(t => t.mode === mode);
    results.sort((a, b) => b.avgScore - a.avgScore);
    return { ok: true, techniques: results, count: results.length };
  } catch (err) { logger.warn('emergent:creative-generation', 'listTechniques failed', { mode, error: err?.message }); return { ok: false, error: "list_techniques_failed", techniques: [], count: 0 }; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROFILES & QUERIES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get the creative profile for an entity, including all works, average
 * scores, mode breakdown, discovered techniques, and masterwork count.
 *
 * @param {string} entityId
 * @returns {{ ok: boolean, profile?: object }}
 */
export function getCreativeProfile(entityId) {
  try {
    if (!entityId) return { ok: false, error: "entity_id_required" };
    const works = [], modeBreakdown = {};
    let totalScore = 0, totalReception = 0, receptionCount = 0;
    for (const w of _works.values()) {
      if (w.creatorId !== entityId) continue;
      works.push({ workId: w.workId, title: w.title, mode: w.mode, aestheticScore: w.aestheticScore, avgReception: w.avgReception, receptionCount: w.receptions.length, exhibitedAt: w.exhibitedAt, createdAt: w.createdAt });
      totalScore += w.aestheticScore;
      modeBreakdown[w.mode] = (modeBreakdown[w.mode] || 0) + 1;
      if (w.receptions.length > 0) { totalReception += w.avgReception; receptionCount++; }
    }
    const techniques = [];
    for (const t of _techniques.values()) {
      if (t.discoveredBy === entityId) techniques.push({ techniqueId: t.techniqueId, name: t.name, mode: t.mode, timesUsed: t.timesUsed, avgScore: t.avgScore });
    }
    const masterworkCount = works.filter(w => { const full = _works.get(w.workId); return full && full.tags.includes("masterwork"); }).length;
    const r3 = v => Math.round(v * 1000) / 1000;
    return {
      ok: true,
      profile: {
        entityId, totalWorks: works.length,
        avgAestheticScore: works.length > 0 ? r3(totalScore / works.length) : 0,
        avgReception: receptionCount > 0 ? r3(totalReception / receptionCount) : 0,
        masterworkCount, techniquesDiscovered: techniques.length,
        techniques, modeBreakdown, works,
      },
    };
  } catch (err) { logger.warn('emergent:creative-generation', 'getCreativeProfile failed', { entityId, error: err?.message }); return { ok: false, error: "get_profile_failed" }; }
}

/**
 * Get all masterwork-tier works (avg reception > 0.9 with 2+ receptions).
 * Sorted by average reception descending.
 *
 * @returns {{ ok: boolean, masterworks: object[], count: number }}
 */
export function getMasterworks() {
  try {
    const masterworks = Array.from(_works.values()).filter(w => w.tags.includes("masterwork"));
    masterworks.sort((a, b) => b.avgReception - a.avgReception);
    return { ok: true, masterworks, count: masterworks.length };
  } catch (err) { logger.warn('emergent:creative-generation', 'getMasterworks failed', { error: err?.message }); return { ok: false, error: "get_masterworks_failed", masterworks: [], count: 0 }; }
}

/**
 * Get global creativity metrics across all works, techniques, and
 * the exhibition gallery.
 *
 * @returns {{ ok: boolean, metrics: object }}
 */
export function getCreativeMetrics() {
  try {
    const r3 = v => Math.round(v * 1000) / 1000;
    return {
      ok: true,
      metrics: {
        totalWorks: _metrics.totalWorks, totalReceptions: _metrics.totalReceptions,
        totalExhibited: _metrics.totalExhibited, totalTechniques: _metrics.totalTechniques,
        totalMasterworks: _metrics.totalMasterworks, byMode: { ..._metrics.byMode },
        avgAestheticScore: r3(_metrics.avgAestheticScore), avgReception: r3(_metrics.avgReception),
        galleryCurrent: _exhibition.size, galleryCap: GALLERY_CAP,
        storedWorks: _works.size, storedTechniques: _techniques.size,
        creativeModes: ALL_MODES,
      },
    };
  } catch (err) { logger.warn('emergent:creative-generation', 'getCreativeMetrics failed', { error: err?.message }); return { ok: false, error: "get_metrics_failed" }; }
}
