// server/scripts/cartographer/categories.js
//
// Software-universe coverage taxonomy. Each entry maps a category to:
//   - keywords[]: tokens the cartographer intersects against lens manifests,
//     macro specs, route paths, and lens dir names (NEVER raw code — too
//     many comment false-positives).
//   - target_lens: the lens the category lives in (existing or new).
//   - scope: 'in' (concord ships it) | 'out' (we use upstream, never rebuild).
//
// Phase 4 priority ordering matches `priority` field. Categories without
// `priority` are surfaced as "covered or polish-only" in the audit.
//
// Constitutional: Concord runs no advertising, no subscriptions, no paywalls.
// The category list intentionally excludes ad-tech, subscription-billing,
// and paywall-gating. The economy is creator-royalty cascade only.

export const CATEGORIES = [
  // ── Productivity & creativity (in scope) ────────────────────────────────
  { category: "spreadsheet",     scope: "in",  priority: 3,
    keywords: ["spreadsheet", "cell", "formula", "sumif", "vlookup", "csv", "pivot"],
    target_lens: "lenses/spreadsheet" },
  { category: "notebook",        scope: "in",  priority: 2,
    keywords: ["notebook", "jupyter", "kernel", "ipynb"],
    target_lens: "lenses/notebook" },
  { category: "mind-map",        scope: "in",  priority: 4,
    keywords: ["mindmap", "mind-map", "ideation", "brainstorm", "node-tree"],
    target_lens: "lenses/whiteboard" },
  { category: "outliner",        scope: "in",  priority: 4,
    keywords: ["outline", "hierarchy", "bullet", "workflowy", "fold"],
    target_lens: "lenses/outliner" },
  { category: "diagram",         scope: "in",  priority: 5,
    keywords: ["mermaid", "plantuml", "flowchart", "graphviz", "drawio"],
    target_lens: "lenses/whiteboard" },
  { category: "crdt-coedit",     scope: "in",
    keywords: ["crdt", "yjs", "automerge", "co-edit", "collab"],
    target_lens: "lenses/collab" },
  { category: "kanban",          scope: "in",
    keywords: ["kanban", "card", "column", "lane", "swim"],
    target_lens: "lenses/board" },
  { category: "gantt",           scope: "in",
    keywords: ["gantt", "milestone", "timeline", "dependency-chart"],
    target_lens: "lenses/projects" },
  { category: "whiteboard",      scope: "in",
    keywords: ["whiteboard", "infinite-canvas", "draw", "sketch"],
    target_lens: "lenses/whiteboard" },
  { category: "slides",          scope: "in",
    keywords: ["slide", "presentation", "deck", "keynote", "reveal"],
    target_lens: "lenses/slides" },
  { category: "wiki",            scope: "in",
    keywords: ["wiki", "page-tree", "backlink", "transclude"],
    target_lens: "lenses/docs" },
  { category: "formbuilder",     scope: "in",
    keywords: ["form", "survey", "questionnaire", "multi-step"],
    target_lens: "lenses/forms" },

  // ── Communication (in scope) ────────────────────────────────────────────
  { category: "forum",           scope: "in",
    keywords: ["forum", "thread", "sub-thread", "debate", "threadml"],
    target_lens: "lenses/forum" },
  { category: "dm-encrypted",    scope: "in",
    keywords: ["dm", "e2ee", "signal", "double-ratchet", "encrypted-message"],
    target_lens: "lenses/messaging" },
  { category: "voice-vc",        scope: "in",
    keywords: ["voice", "webrtc", "voice-call", "vc", "video-conference", "sfu"],
    target_lens: "lenses/voice" },
  { category: "screen-share",    scope: "in",
    keywords: ["screen-share", "simulcast", "codec"],
    target_lens: "lenses/voice" },
  { category: "podcast",         scope: "in",
    keywords: ["podcast", "rss-feed", "episode", "audiogram"],
    target_lens: "lenses/podcast" },
  { category: "chat",            scope: "in",
    keywords: ["chat", "message", "im"],
    target_lens: "lenses/chat" },
  { category: "comments",        scope: "in",
    keywords: ["comment", "reply", "thread-collapse"],
    target_lens: "lenses/collab" },

  // ── Cognition (in scope, fits substrate) ───────────────────────────────
  { category: "srs",             scope: "in",  priority: 1,
    keywords: ["srs", "anki", "sm-2", "fsrs", "spaced-repetition", "flashcard", "review-queue"],
    target_lens: "lenses/srs" },
  { category: "tts",             scope: "in",  priority: 8,
    keywords: ["tts", "text-to-speech", "kokoro", "piper", "synthesis"],
    target_lens: "lenses/voice" },
  { category: "asr",             scope: "in",  priority: 8,
    keywords: ["asr", "whisper", "speech-to-text", "transcribe"],
    target_lens: "lenses/voice" },
  { category: "image-gen",       scope: "in",
    keywords: ["image-generation", "sd", "flux", "dalle", "t2i", "img2img"],
    target_lens: "lenses/art" },
  { category: "journaling",      scope: "in",
    keywords: ["journal", "gratitude", "daily-log"],
    target_lens: "lenses/mental-health" },
  { category: "meditation",      scope: "in",
    keywords: ["meditation", "mindful", "breath"],
    target_lens: "lenses/mental-health" },
  { category: "note-taking",     scope: "in",
    keywords: ["note", "evernote", "obsidian", "zettelkasten", "atomic-note"],
    target_lens: "lenses/docs" },
  { category: "annotation",      scope: "in",
    keywords: ["highlight", "annotate", "hypothesis", "margin"],
    target_lens: "lenses/paper" },

  // ── Specialised verticals (in scope, polish) ───────────────────────────
  { category: "healthcare",      scope: "in",
    keywords: ["clinical", "patient", "ehr", "fhir", "icd-10", "snomed", "prescription"],
    target_lens: "lenses/healthcare" },
  { category: "legal",           scope: "in",
    keywords: ["legal", "contract", "litigation", "case-law", "citation", "statute", "brief"],
    target_lens: "lenses/legal" },
  { category: "e-signature",     scope: "in",  priority: 7,
    keywords: ["e-sign", "esign", "docusign", "hellosign", "hash-anchor"],
    target_lens: "lenses/legal" },
  { category: "recipe-nutrition",scope: "in",
    keywords: ["recipe", "ingredient", "calorie", "macro", "allergen", "nutrition"],
    target_lens: "lenses/food" },
  { category: "accounting",      scope: "in",
    keywords: ["bookkeeping", "invoice", "ledger", "double-entry", "gaap"],
    target_lens: "lenses/accounting" },
  { category: "inventory",       scope: "in",
    keywords: ["inventory", "sku", "stock", "warehouse", "bin"],
    target_lens: "lenses/inventory" },

  // ── Self-quantification (in scope, unify) ─────────────────────────────
  { category: "fitness-tracker", scope: "in",
    keywords: ["fitness", "workout", "set", "rep", "hr-zone"],
    target_lens: "lenses/fitness" },
  { category: "sleep-tracker",   scope: "in",
    keywords: ["sleep", "rem", "hrv", "snore"],
    target_lens: "lenses/self" },
  { category: "food-log",        scope: "in",
    keywords: ["food-log", "meal", "macro", "intake"],
    target_lens: "lenses/food" },
  { category: "body-comp",       scope: "in",
    keywords: ["bodyweight", "bf", "body-composition", "dexa"],
    target_lens: "lenses/self" },
  { category: "mood-log",        scope: "in",
    keywords: ["mood", "ema", "daily-mood", "emotion-log"],
    target_lens: "lenses/self" },
  { category: "unified-self",    scope: "in",  priority: 6,
    keywords: ["quantified-self", "self-tracking"],
    target_lens: "lenses/self" },

  // ── Knowledge work (in scope) ──────────────────────────────────────────
  { category: "paper-research",  scope: "in",
    keywords: ["paper", "arxiv", "doi", "abstract"],
    target_lens: "lenses/paper" },
  { category: "bibliography",    scope: "in",
    keywords: ["zotero", "mendeley", "bibtex", "bibliography"],
    target_lens: "lenses/paper" },
  { category: "lab-notebook",    scope: "in",
    keywords: ["lab-notebook", "eln", "experiment", "protocol"],
    target_lens: "lenses/lab" },
  { category: "dataset",         scope: "in",
    keywords: ["dataset", "parquet", "arrow", "dvc"],
    target_lens: "lenses/database" },

  // ── Domain-rich verticals (already present, verify) ────────────────────
  { category: "agriculture",     scope: "in", keywords: ["agriculture", "farm", "crop", "soil"],   target_lens: "lenses/agriculture" },
  { category: "aviation",        scope: "in", keywords: ["aviation", "flight", "pilot", "atc"],    target_lens: "lenses/aviation" },
  { category: "space",           scope: "in", keywords: ["space", "orbit", "satellite", "rocket"], target_lens: "lenses/astronomy" },
  { category: "defense",         scope: "in", keywords: ["defense", "military", "tactics"],         target_lens: "lenses/defense" },
  { category: "mining",          scope: "in", keywords: ["mining", "ore", "extraction"],            target_lens: "lenses/construction" },
  { category: "forestry",        scope: "in", keywords: ["forestry", "logging", "timber"],          target_lens: "lenses/agriculture" },
  { category: "veterinary",      scope: "in", keywords: ["veterinary", "vet", "animal-health"],     target_lens: "lenses/bio" },
  { category: "law-enforcement", scope: "in", keywords: ["law-enforcement", "police", "evidence"],  target_lens: "lenses/legal" },
  { category: "emergency-services", scope: "in", keywords: ["emergency", "ems", "dispatch", "fire"], target_lens: "lenses/defense" },
  { category: "ocean",           scope: "in", keywords: ["ocean", "marine", "tide", "current"],     target_lens: "lenses/eco" },
  { category: "urban-planning",  scope: "in", keywords: ["urban", "zoning", "city-plan"],           target_lens: "lenses/construction" },
  { category: "telecommunications", scope: "in", keywords: ["telecom", "telephony", "5g", "spectrum"], target_lens: "lenses/mesh" },
  { category: "chemistry",       scope: "in", keywords: ["chemistry", "molecule", "reaction"],      target_lens: "lenses/chem" },
  { category: "physics",         scope: "in", keywords: ["physics", "mechanics", "thermodynamic"],  target_lens: "lenses/physics" },
  { category: "biology",         scope: "in", keywords: ["biology", "cell", "genome", "protein"],   target_lens: "lenses/bio" },
  { category: "astronomy",       scope: "in", keywords: ["astronomy", "telescope", "stellar"],      target_lens: "lenses/astronomy" },
  { category: "geology",         scope: "in", keywords: ["geology", "rock", "fault"],               target_lens: "lenses/eco" },
  { category: "quantum",         scope: "in", keywords: ["quantum", "qubit", "superposition"],      target_lens: "lenses/quantum" },
  { category: "mathematics",     scope: "in", keywords: ["mathematics", "proof", "algebra"],        target_lens: "lenses/math" },

  // ── Creative production (mostly present) ──────────────────────────────
  { category: "daw",             scope: "in", keywords: ["daw", "beat", "mix", "master", "vst", "midi"], target_lens: "lenses/studio" },
  { category: "video-edit",      scope: "in", keywords: ["video-edit", "ffmpeg", "timeline", "ot-cut", "premiere"], target_lens: "lenses/film-studios" },
  { category: "photo-edit",      scope: "in", keywords: ["photo", "exposure", "lut", "raw", "lightroom"], target_lens: "lenses/photography" },
  { category: "3d-model",        scope: "in", keywords: ["mesh", "blender", "gltf", "fbx"],          target_lens: "lenses/world" },
  { category: "animation",       scope: "in", keywords: ["animation", "rig", "keyframe"],            target_lens: "lenses/animation" },

  // ── Phase 4 expanded scope (the "previously out-of-scope" wires) ──────
  { category: "web-research",    scope: "in",  priority: 9,
    keywords: ["web-search", "fetch-url", "scrape", "crawl", "ingest-url"],
    target_lens: "lenses/web" },
  { category: "system-kernel",   scope: "in",  priority: 10,
    keywords: ["system", "kernel", "scheduler", "process-manager", "heartbeat-status"],
    target_lens: "lenses/system" },
  { category: "compile-build",   scope: "in",  priority: 11,
    keywords: ["compile", "transpile", "esbuild", "tsc", "bundle"],
    target_lens: "lenses/compile" },
  { category: "brain-training",  scope: "in",  priority: 12,
    keywords: ["brain-training", "modelfile", "fine-tune", "consent-corpus"],
    target_lens: "lenses/lattice" },
  { category: "crypto-chain",    scope: "in",  priority: 13,
    keywords: ["wallet", "nft", "on-chain", "address", "ledger-reader"],
    target_lens: "lenses/crypto" },
  { category: "mesh-network",    scope: "in",  priority: 14,
    keywords: ["mesh", "ble", "lora", "rf-ham", "nfc", "transport-layer"],
    target_lens: "lenses/mesh" },

  // ── Substrate exclusions (we use upstream, don't rebuild) ─────────────
  { category: "browser-engine",  scope: "out", keywords: ["chromium", "webkit", "blink-engine", "v8-engine"],
    target_lens: null, rationale: "Next.js IS the browser surface" },
  { category: "ml-framework",    scope: "out", keywords: ["pytorch", "tensorflow", "jax", "ml-train-from-scratch"],
    target_lens: null, rationale: "Ollama is the inference backend" },
  { category: "os-kernel",       scope: "out", keywords: ["linux-kernel", "syscall", "scheduler-process"],
    target_lens: null, rationale: "we surface the cognitive OS, not host OS" },

  // ── Constitutional exclusions ─────────────────────────────────────────
  { category: "advertising",     scope: "out", keywords: ["ad", "banner-ad", "sponsored", "rtb", "boosted-listing"],
    target_lens: null, rationale: "constitutional: no ads in any form" },
  { category: "subscription",    scope: "out", keywords: ["subscription-fee", "monthly-plan", "tier-gate"],
    target_lens: null, rationale: "constitutional: no subscriptions" },
  { category: "paywall",         scope: "out", keywords: ["paywall", "metered-access", "premium-only"],
    target_lens: null, rationale: "constitutional: no paywalls" },
];

/** Categories with priority field, sorted, used by Phase 4 audit. */
export function priorityCategories() {
  return CATEGORIES.filter(c => Number.isFinite(c.priority)).sort((a, b) => a.priority - b.priority);
}

/** All keywords flattened, lower-cased — for fast intersection. */
export function allKeywordIndex() {
  const idx = new Map();
  for (const c of CATEGORIES) {
    for (const k of c.keywords) {
      const norm = String(k).toLowerCase();
      if (!idx.has(norm)) idx.set(norm, []);
      idx.get(norm).push(c.category);
    }
  }
  return idx;
}
