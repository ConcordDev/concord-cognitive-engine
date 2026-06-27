/**
 * Lens Runtime Contract — Manifest Schema
 *
 * Each lens declares its domain, artifact types, macro mappings, supported exports,
 * and available actions. The generic UI shell can render library/editor/actions/DTU feed
 * panels from this manifest alone.
 *
 * Competitor-Level Standard (7/7 Product Lens Gate):
 *   1. Primary Artifact - durable object that persists without DTUs
 *   2. Persistence - real API (no MOCK or SEED constants)
 *   3. Workspace UI - editor, library, history, versioning
 *   4. Engine - at least one domain-specific server-side action
 *   5. Pipeline - multi-step chain (intake, structure, validate, output, publish)
 *   6. Import/Export - pull in real inputs, export artifacts
 *   7. DTU Exhaust - structured DTUs with lane labels
 *
 * Usage:
 *   import { LENS_MANIFESTS, getLensManifest } from '@/lib/lenses/manifest';
 *   const manifest = getLensManifest('music');
 */

import { buildSubLensManifests } from './sub-lens-manifests';

/**
 * Phase 1 (UX completeness sprint) — data-tier vocabulary.
 *
 *   REAL_LIVE     — real external feed, polled live (Yahoo Finance, NOAA, NASA APOD)
 *   REAL_FREE     — real but static / open-access (Wikipedia, OpenStreetMap, MET Museum)
 *   SIM_GRADE_A   — high-fidelity LLM-grounded against a domain schema, NOT pretending to be real data
 *   DEMO          — synthetic; the lens is a working surface but the domain requires paywalled data we haven't licensed
 */
export type DataTier = 'REAL_LIVE' | 'REAL_FREE' | 'SIM_GRADE_A' | 'DEMO';

/** Phase 1 — copy + handlers for an empty-state CTA the lens mounts via EmptyStateCTA. */
export interface LensEmptyState {
  headline: string;
  caption: string;
  firstActionLabel: string;
  /** Optional macro to fire when the CTA button is clicked. domain defaults to manifest.domain. */
  firstActionMacro?: { domain?: string; name: string; input?: Record<string, unknown> };
}

/** Phase 1 — 30-second guided first-run mounted via FirstRunTour. */
export interface LensFirstRunGuide {
  steps: Array<{
    caption: string;
    /** CSS selector to spotlight (optional; if absent the step is text-only). */
    selector?: string;
    /** Optional macro to demonstrate / pre-fire during the step. */
    macro?: string;
  }>;
}

export interface LensManifest {
  /** Unique domain identifier (e.g. 'music', 'finance', 'studio') */
  domain: string;
  /** Human-readable label */
  label: string;
  /** Artifact types this lens manages */
  artifacts: string[];
  /** Macro name mappings (follows lens.<domain>.* convention) */
  macros: {
    list: string;
    get: string;
    create?: string;
    update?: string;
    delete?: string;
    run?: string;
    export?: string;
  };
  /** Supported export formats */
  exports: string[];
  /** Domain-specific actions available via run */
  actions: string[];
  /** Category for grouping in UI */
  category: 'knowledge' | 'creative' | 'system' | 'social' | 'productivity' | 'finance'
          | 'healthcare' | 'trades' | 'operations' | 'agriculture' | 'government' | 'services' | 'lifestyle';

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 1 (UX completeness sprint) — optional, additive fields.
  // Existing lenses without these still work; the new primitives degrade
  // gracefully when a field is absent.
  // ─────────────────────────────────────────────────────────────────────────

  /** Empty-state CTA copy + first-action handler. EmptyStateCTA reads this. */
  emptyState?: LensEmptyState;

  /** Step list for the 30-second guided tour. FirstRunTour reads this. */
  firstRunGuide?: LensFirstRunGuide;

  /** Data-tier label. DepthBadge renders the corresponding chip. */
  dataTier?: DataTier;

  /** Socket event names this lens listens to for live tile updates. useTilePush key list. */
  realtimeEvents?: string[];

  /** Backend table FK target for multi-step sessions (e.g. 'war_campaigns', 'reasoning_sessions'). */
  sessionTable?: string;
}

// ---- Lens Manifests ----
// Each manifest declares the runtime contract for one lens domain.
// All 61 upgrade-lane lenses (31 product + 22 hybrid + 8 viewer) must have full manifests.

export const LENS_MANIFESTS: LensManifest[] = [

  // ═══════════════════════════════════════════════════════════════
  // UTILITY / ADMIN LENSES — minimal contracts so they mount <LensShell>
  // with a known lensId (no firstRunGuide/emptyState by design).
  // ═══════════════════════════════════════════════════════════════
  { domain: 'careers', label: 'Careers', artifacts: ['contract', 'shift'], macros: { list: 'careers.tracks', get: 'careers.contracts', create: 'careers.work', run: 'careers.offer' }, exports: ['json'], actions: ['browse', 'work', 'offer', 'accept'], category: 'lifestyle' },
  { domain: 'ledger', label: 'Ledger', artifacts: ['anomaly', 'lien'], macros: { list: 'ledger.anomalies', get: 'ledger.faction_economy', run: 'ledger.flow_summary' }, exports: ['json', 'csv'], actions: ['view', 'audit', 'export'], category: 'finance' },
  // The Codex is a READER over the real `lore` domain (server/domains/lore.js —
  // register("lore", "list"|"get"|"facets"|"spine")). There is NO `codex` domain;
  // the page calls lensRun('lore', …) directly. The manifest key stays 'codex'
  // (the lens id, used by getLensManifest('codex')), but the macros now point at
  // the REAL registered lore.* surface — the prior `lens.codex.*` were phantoms
  // that resolved to nothing. Actions are read-only verbs that map onto real
  // lore.* reads (list/facets/spine); the lens persists per-user bookmarks of the
  // canon through the generic /api/lens/codex artifact store (see page.tsx).
  { domain: 'codex', label: 'Codex', artifacts: ['entry', 'lore', 'bookmark'], macros: { list: 'lore.list', get: 'lore.get' }, exports: ['json'], actions: ['list', 'facets', 'spine'], category: 'knowledge' },
  { domain: 'translation', label: 'Translation', artifacts: ['translation'], macros: { list: 'lens.translation.list', get: 'lens.translation.get' }, exports: ['json'], actions: ['translate', 'detect'], category: 'productivity' },
  { domain: 'repair-telemetry', label: 'Repair Telemetry', artifacts: ['report'], macros: { list: 'lens.repair-telemetry.list', get: 'lens.repair-telemetry.get' }, exports: ['json'], actions: ['view'], category: 'system' },
  { domain: 'move-builder', label: 'Move Builder', artifacts: ['move', 'recipe'], macros: { list: 'move-builder.list', get: 'move-builder.get', create: 'move-builder.mint' }, exports: ['json'], actions: ['compose', 'mint'], category: 'creative' },
  { domain: 'civic-bonds', label: 'Civic Bonds', artifacts: ['bond', 'vote'], macros: { list: 'lens.civic-bonds.list', get: 'lens.civic-bonds.get' }, exports: ['json'], actions: ['view', 'vote'], category: 'government' },

  // ═══════════════════════════════════════════════════════════════
  // WORLD LENS (3D City)
  // ═══════════════════════════════════════════════════════════════

  {
    domain: 'world',
    label: 'World',
    artifacts: ['city', 'building', 'character', 'asset', 'stream', 'theme'],
    macros: { list: 'lens.world.list', get: 'lens.world.get', create: 'lens.world.create', update: 'lens.world.update', delete: 'lens.world.delete', run: 'lens.world.run', export: 'lens.world.export' },
    exports: ['json', 'glb', 'gltf'],
    actions: ['explore', 'create_city', 'customize_character', 'stream', 'teleport', 'build', 'browse_assets'],
    category: 'social',
    dataTier: 'REAL_LIVE',
    realtimeEvents: [
      'world:building-state',
      'world:refusal-field',
      'world:season-transition',
      'world:sign-placed',
      'weather:update',
      'combat:hit',
      'combat:stagger',
    ],
    emptyState: {
      headline: 'Concordia awaits.',
      caption: 'Pick your avatar, spawn into the simulator, and meet the NPCs whose dialogue is composed against your DTU substrate.',
      firstActionLabel: 'Enter Concordia',
    },
    firstRunGuide: {
      steps: [
        { caption: 'WASD to move; mouse to look. The Rapier3D collider is authoritative — what your client sees the server agrees with.' },
        { caption: 'Talk to NPCs by clicking. Their dialogue branches against authored content + your DTU citations.' },
        { caption: 'The Goddess Concordia speaks in tones gated by ecosystem score + refusal-field strength. Watch the HUD chips for the live composition.' },
      ],
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // CORE PRODUCT LENSES
  // ═══════════════════════════════════════════════════════════════

  {
    domain: 'saved',
    label: 'Saved',
    artifacts: ['bookmark', 'collection'],
    // Real saved.* macros (registered via registerSavedMacros in server.js).
    // `get` reuses saved.list (the lens has no single-item read); `create` maps
    // to saved.add so DTU-exhaust + the ManifestActionBar "Save" verb resolve.
    macros: { list: 'saved.list', get: 'saved.list', create: 'saved.add', update: 'saved.update', delete: 'saved.remove' },
    exports: ['json', 'csv'],
    actions: ['add', 'remove', 'update', 'folderCreate', 'folderUpdate', 'folderDelete', 'export'],
    category: 'social',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: 'Nothing saved yet.',
      caption: 'Save posts, DTUs, articles, links — anything — into collections, tag them, and flip read-later / archive states. Your saved list is private to you.',
      firstActionLabel: 'Browse Social',
    },
    firstRunGuide: {
      steps: [
        { caption: 'Save anything — posts, DTUs, articles, links — with the Save form, or bookmark a post via its bookmark icon.' },
        { caption: 'Organise saved items into Collections, tag them freely, and search / sort / filter the whole list.' },
        { caption: 'Flip items between unread, read, and archived — then export the full list as JSON or CSV.' },
      ],
    },
  },
  {
    domain: 'chat',
    label: 'Chat',
    artifacts: ['conversation', 'message', 'session', 'branch'],
    macros: { list: 'lens.chat.list', get: 'lens.chat.get', create: 'lens.chat.create', update: 'lens.chat.update', delete: 'lens.chat.delete', run: 'lens.chat.run', export: 'lens.chat.export' },
    exports: ['json', 'md', 'txt', 'pdf'],
    actions: ['send', 'summarize', 'branch', 'export_transcript', 'search_history', 'merge_threads'],
    category: 'knowledge',
    dataTier: 'REAL_LIVE',
    realtimeEvents: ['chat:status', 'chat:token', 'chat:complete', 'message:saved'],
    emptyState: {
      headline: 'No conversations yet.',
      caption: 'Start one — Concord remembers everything you talk about, and the substrate compresses old conversations into searchable MEGA-DTUs.',
      firstActionLabel: 'Start a conversation',
    },
    firstRunGuide: {
      steps: [
        { caption: 'Type any question or task. Concord routes to whichever of the four brains fits — Conscious for reasoning, Subconscious for synthesis, Utility for quick tasks, Repair for fixes.' },
        { caption: 'Every reply that grounds in a DTU gets a citation chip you can click — your knowledge substrate stays linked.' },
        { caption: 'Threads persist server-side. Close the tab; come back tomorrow; the brain still has your context.' },
      ],
    },
  },
  {
    domain: 'code',
    label: 'Code',
    artifacts: ['file', 'snippet', 'project', 'workspace', 'diff', 'review'],
    macros: { list: 'lens.code.list', get: 'lens.code.get', create: 'lens.code.create', update: 'lens.code.update', delete: 'lens.code.delete', run: 'lens.code.run', export: 'lens.code.export' },
    exports: ['json', 'zip', 'tar', 'patch'],
    actions: ['execute', 'lint', 'format', 'refactor', 'diff', 'review', 'test', 'package'],
    category: 'knowledge',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: 'No code yet.',
      caption: 'Paste, type, or import a snippet. The Code lens runs lint, formatter, refactor, diff, and review against the substrate.',
      firstActionLabel: 'Create your first snippet',
    },
    firstRunGuide: {
      steps: [
        { caption: 'Drop code into the editor — a full workbench shell with file tree, tabs, and a status bar.' },
        { caption: 'Use the action bar to lint, format, or run a review pass. Results stream back as DTUs you can cite from chat.' },
        { caption: 'Repos you connect via GitHub appear in the side panel — code-substrate-refresh keeps them current every 5 ticks.' },
      ],
    },
  },
  {
    domain: 'paper',
    label: 'Paper',
    artifacts: ['project', 'claim', 'hypothesis', 'evidence', 'experiment', 'synthesis'],
    macros: { list: 'lens.paper.list', get: 'lens.paper.get', create: 'lens.paper.create', update: 'lens.paper.update', delete: 'lens.paper.delete', run: 'lens.paper.run', export: 'lens.paper.export' },
    exports: ['json', 'md', 'pdf', 'bibtex'],
    actions: ['validate', 'synthesize', 'detect-contradictions', 'trace-lineage', 'claim-evidence-consistency', 'hypothesis-mutation-retest'],
    category: 'knowledge',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: 'No papers yet.',
      caption: 'Start a project, capture claims with evidence, run validate / synthesize over the corpus. Export to bibtex or PDF.',
      firstActionLabel: 'Start a paper project',
    },
    firstRunGuide: {
      steps: [
        { caption: 'Projects hold claims + evidence; detect-contradictions runs the lattice drift scan against your corpus.' },
        { caption: 'trace-lineage walks the DTU citation graph — see exactly which evidence chains your synthesis stands on.' },
        { caption: 'hypothesis-mutation-retest variations and runs the reasoning_session loop to flag weakness.' },
      ],
    },
  },
  {
    domain: 'literary',
    label: 'Literary Lattice',
    // Annotations are the durable, first-class artifact (persist via the generic
    // lens artifact store as kind='annotation'); passages/works are the corpus
    // the lens reads over. Each annotation also mints a derivative DTU citing the
    // source passage (the self-growing-lattice exhaust).
    artifacts: ['annotation', 'passage', 'work'],
    macros: { list: 'lens.literary.list', get: 'lens.literary.get', create: 'lens.literary.create', export: 'lens.literary.export' },
    exports: ['json', 'graphml', 'csv'],
    // The real server-side engine: hybrid BM25+dense (RRF) search, the resonance
    // / citation force-graph, cross-domain resonance bridges, the annotation →
    // DTU crystallization path, and the salience consolidation signal.
    actions: ['search', 'semantic_graph', 'resonance', 'resonance_graph', 'annotate', 'crystallize', 'salience', 'provenance'],
    category: 'knowledge',
    dataTier: 'REAL_FREE',
    emptyState: {
      headline: 'No corpus ingested yet.',
      caption: 'Mirror a public-domain starter set into the lattice, then search returns grounded passages with full provenance and cross-domain resonance.',
      firstActionLabel: 'Search the lattice',
    },
    firstRunGuide: {
      steps: [
        { caption: 'Search themes or passages — the badge shows whether dense (Grounded) or keyword-only (BM25) retrieval ran, never faked.' },
        { caption: 'Select a passage to see its source provenance + license, the cross-domain resonance bridges, and the citation lattice.' },
        { caption: 'Annotate a passage: your reading mints a derivative DTU citing the source, growing the lattice from engagement. Export the resonance graph as GraphML.' },
      ],
    },
  },
  {
    domain: 'reasoning',
    label: 'Reasoning',
    artifacts: ['chain', 'premise', 'inference', 'conclusion', 'counterexample'],
    // Real registered runMacro ids (verified against server.js + server/domains/reasoning.js):
    //   list  -> reasoning.traces      (HLR trace summaries — server/domains/reasoning.js)
    //   get   -> reasoning.trace       (one full HLR trace by id — server/domains/reasoning.js)
    //   run   -> reasoning.run         (execute one HLR pass, records a trace)
    //   create-> reasoning.create_chain (start a reasoning chain — server.js inline)
    // By-design absent (NOT faked): there is no `update`/`delete`/`export` macro.
    // An HLR trace is an immutable record of a reasoning pass — it cannot be edited
    // or deleted, and the engine emits no export artifact. The lens is a reader /
    // dashboard + chain starter, so authoring/teardown bits are honestly omitted
    // rather than pointed at a phantom `lens.reasoning.*` macro.
    macros: { list: 'reasoning.traces', get: 'reasoning.trace', create: 'reasoning.create_chain', run: 'reasoning.run' },
    exports: ['json', 'md', 'svg'],
    actions: ['validate', 'trace', 'conclude', 'fork', 'detect-fallacy', 'strength-score', 'visualize-chain'],
    category: 'knowledge',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Build a chain of reasoning.",
      caption: "Capture premises, draw inferences, and let the lattice detect-fallacy + strength-score the result.",
      firstActionLabel: "Start your first chain",
    },
    firstRunGuide: {
      steps: [
        { caption: "Add premises one at a time. Each becomes a node you can branch from." },
        { caption: "Hit validate to run detect-fallacy and trace \u2014 the lens scores logical strength against the substrate." },
        { caption: "Export as SVG to drop the reasoning graph straight into a paper or post." },
      ],
    },
  },
  {
    domain: 'graph',
    label: 'Graph',
    artifacts: ['entity', 'relation', 'assertion', 'source', 'ontology_node'],
    macros: { list: 'lens.graph.list', get: 'lens.graph.get', create: 'lens.graph.create', update: 'lens.graph.update', delete: 'lens.graph.delete', run: 'lens.graph.run', export: 'lens.graph.export' },
    exports: ['json', 'csv', 'graphml', 'rdf', 'cypher'],
    actions: ['query', 'cluster', 'analyze', 'merge', 'conflict-resolution', 'entity-resolution', 'confidence-scoring', 'shortest-path'],
    category: 'knowledge',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Connect entities into a graph.",
      caption: "Add entities, draw relations, watch the substrate run entity-resolution + conflict-resolution + confidence-scoring.",
      firstActionLabel: "Add your first entity",
    },
    firstRunGuide: {
      steps: [
        { caption: "Drop entities + relations as you find them. The graph view renders live." },
        { caption: "cluster + analyze surfaces communities; shortest-path traces the connection between any two." },
        { caption: "Export to graphml, RDF, or Cypher \u2014 your knowledge graph leaves with you." },
      ],
    },
  },
  {
    domain: 'council',
    label: 'Council',
    artifacts: ['proposal', 'vote', 'budget', 'project', 'audit', 'resolution'],
    macros: { list: 'lens.council.list', get: 'lens.council.get', create: 'lens.council.create', update: 'lens.council.update', delete: 'lens.council.delete', run: 'lens.council.run', export: 'lens.council.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['debate', 'vote', 'simulate-budget', 'audit', 'quorum-check', 'impact-analysis', 'generate-minutes'],
    category: 'social',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Stand up a council.",
      caption: "Author proposals, vote, simulate budgets, audit results \u2014 the social substrate of governance.",
      firstActionLabel: "Create your first proposal",
    },
    firstRunGuide: {
      steps: [
        { caption: "Proposals open for debate; members vote on quorum-gated ballots." },
        { caption: "simulate-budget shows downstream impact before anyone funds anything." },
        { caption: "generate-minutes ships markdown / PDF you can post anywhere." },
      ],
    },
  },
  {
    domain: 'agents',
    label: 'Agents',
    artifacts: ['agent', 'role', 'task', 'deliberation', 'decision', 'workflow'],
    macros: { list: 'lens.agents.list', get: 'lens.agents.get', create: 'lens.agents.create', update: 'lens.agents.update', delete: 'lens.agents.delete', run: 'lens.agents.run', export: 'lens.agents.export' },
    exports: ['json', 'yaml', 'csv'],
    actions: ['start', 'stop', 'reset', 'configure', 'deliberate', 'arbitrate', 'orchestrate', 'evaluate-performance'],
    category: 'knowledge',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: 'No agents configured.',
      caption: 'Build an agent from a role + task + brain assignment. Marathon sessions persist across restarts.',
      firstActionLabel: 'Configure an agent',
    },
    firstRunGuide: {
      steps: [
        { caption: 'Each agent gets a brain (conscious / subconscious / utility / repair) + a role + a tool whitelist.' },
        { caption: 'Marathon sessions checkpoint state every node — close the tab, resume later, agent picks up where it left off.' },
        { caption: 'deliberate spawns a council; arbitrate resolves conflicts between agents working the same problem.' },
      ],
    },
  },
  {
    domain: 'sim',
    label: 'Sim',
    artifacts: ['scenario', 'assumption', 'run', 'outcome', 'model', 'distribution'],
    macros: { list: 'lens.sim.list', get: 'lens.sim.get', create: 'lens.sim.create', update: 'lens.sim.update', delete: 'lens.sim.delete', run: 'lens.sim.run', export: 'lens.sim.export' },
    exports: ['json', 'csv', 'pdf', 'png'],
    actions: ['simulate', 'analyze', 'compare', 'archive', 'monte-carlo', 'sensitivity-analysis', 'regime-detection'],
    category: 'system',
    dataTier: 'SIM_GRADE_A',
    emptyState: {
      headline: "Run a what-if.",
      caption: "Define a scenario + assumptions; sim runs monte-carlo, sensitivity, and regime-detection against the model.",
      firstActionLabel: "Create your first scenario",
    },
    firstRunGuide: {
      steps: [
        { caption: "Pick assumptions. Each becomes a knob you can sweep." },
        { caption: "Hit simulate \u2192 distributions render as histograms and percentile bands." },
        { caption: "compare two runs side-by-side; export as CSV / PDF / PNG." },
      ],
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // CREATIVE LENSES
  // ═══════════════════════════════════════════════════════════════

  {
    domain: 'music',
    label: 'Music',
    artifacts: ['track', 'playlist', 'artist', 'album', 'stem', 'project'],
    macros: { list: 'lens.music.list', get: 'lens.music.get', create: 'lens.music.create', update: 'lens.music.update', delete: 'lens.music.delete', run: 'lens.music.run', export: 'lens.music.export' },
    exports: ['json', 'csv', 'm3u', 'wav', 'midi'],
    actions: ['analyze', 'render', 'publish', 'export_stems', 'generate_arrangement', 'timeline_render', 'stem_split', 'project_package'],
    category: 'creative',
    dataTier: 'REAL_FREE',
    emptyState: {
      headline: 'No tracks yet.',
      caption: 'Upload audio, generate stems, or compose in Studio. Soundscapes you mix here can stream into Concordia districts.',
      firstActionLabel: 'Add your first track',
    },
    firstRunGuide: {
      steps: [
        { caption: 'Tracks list in the main column. Click any to open arrangement / mix.' },
        { caption: 'Render exports stems as WAV; full mixdowns as MP3. Both mint as DTUs.' },
        { caption: 'Published tracks attach to Concordia districts as ambient soundscape — your music becomes the world\'s background.' },
      ],
    },
  },
  {
    domain: 'studio',
    label: 'Studio',
    artifacts: ['project', 'track', 'effect', 'instrument', 'session', 'mixdown'],
    macros: { list: 'lens.studio.list', get: 'lens.studio.get', create: 'lens.studio.create', update: 'lens.studio.update', delete: 'lens.studio.delete', run: 'lens.studio.run', export: 'lens.studio.export' },
    exports: ['json', 'wav', 'mp3', 'midi', 'pdf'],
    actions: ['mix', 'master', 'bounce', 'render', 'apply_effect', 'normalize', 'session_snapshot'],
    category: 'creative',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: 'New session, blank canvas.',
      caption: 'Add tracks, drop in effects, mix, and bounce. Sessions stream to Concordia\'s soundscape per district.',
      firstActionLabel: 'Create your first session',
    },
    firstRunGuide: {
      steps: [
        { caption: 'Tracks list on the left. Hit + to add audio / MIDI / synth tracks.' },
        { caption: 'The Mixer pane shows fader strips with effects chains. Mastering is a separate panel — ship-ready loudness.' },
        { caption: 'Render a mixdown → DTU. Publish to marketplace or attach to Concordia districts as ambient soundscape.' },
      ],
    },
  },
  {
    domain: 'voice',
    label: 'Voice',
    artifacts: ['take', 'effect', 'preset', 'transcript', 'voice_note', 'pipeline_run'],
    macros: { list: 'lens.voice.list', get: 'lens.voice.get', create: 'lens.voice.create', update: 'lens.voice.update', delete: 'lens.voice.delete', run: 'lens.voice.run', export: 'lens.voice.export' },
    exports: ['json', 'csv', 'txt', 'srt', 'wav'],
    actions: ['transcribe', 'process', 'analyze', 'summarize', 'extract_tasks', 'detect_speaker', 'generate_subtitles'],
    category: 'creative',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: 'No voice takes yet.',
      caption: 'Record a take, transcribe with speaker detection, generate subtitles. Pipeline runs persist server-side.',
      firstActionLabel: 'Record a take',
    },
    firstRunGuide: {
      steps: [
        { caption: 'Tap to record; the meter shows live audio. Auto-pauses on silence.' },
        { caption: 'transcribe runs the Subconscious brain; detect_speaker tags by voice fingerprint.' },
        { caption: 'extract_tasks turns a meeting recording into an actionable to-do list, ready to push into goals or calendar.' },
      ],
    },
  },
  {
    domain: 'art',
    label: 'Art',
    artifacts: ['artwork', 'collection', 'style', 'gallery', 'exhibition'],
    macros: { list: 'lens.art.list', get: 'lens.art.get', create: 'lens.art.create', update: 'lens.art.update', delete: 'lens.art.delete', run: 'lens.art.run', export: 'lens.art.export' },
    exports: ['json', 'png', 'svg', 'pdf'],
    actions: ['generate', 'remix', 'analyze', 'curate', 'style_transfer', 'publish_gallery'],
    category: 'creative',
    dataTier: 'REAL_FREE',
    emptyState: {
      headline: "Generate or import art.",
      caption: "Curate collections, remix existing pieces, run style-transfer, and publish galleries.",
      firstActionLabel: "Add your first piece",
    },
    firstRunGuide: {
      steps: [
        { caption: "Drop images or generate from prompt. Each becomes an artwork DTU." },
        { caption: "Group into collections; build a gallery surface that publishes." },
        { caption: "remix + style_transfer fork the lineage so credit follows the piece." },
      ],
    },
  },
  {
    domain: 'ar',
    label: 'AR',
    artifacts: ['scene', 'anchor', 'overlay', 'capture_session', 'asset_3d'],
    macros: { list: 'lens.ar.list', get: 'lens.ar.get', create: 'lens.ar.create', update: 'lens.ar.update', delete: 'lens.ar.delete', run: 'lens.ar.run', export: 'lens.ar.export' },
    exports: ['json', 'gltf', 'usdz', 'png'],
    actions: ['place_anchor', 'render_scene', 'capture', 'export_3d', 'collision_detect', 'lighting_estimate'],
    category: 'creative',
    dataTier: 'REAL_FREE',
    emptyState: {
      headline: "Place an anchor.",
      caption: "Drop AR scenes, render in-place, capture, and export to glTF / GLB.",
      firstActionLabel: "Start an AR scene",
    },
    firstRunGuide: {
      steps: [
        { caption: "place_anchor pins content to a real-world point via geo or marker." },
        { caption: "lighting_estimate + collision_detect ground the scene against real geometry." },
        { caption: "capture sessions export as 3D assets and as DTUs you can re-render anywhere." },
      ],
    },
  },
  {
    domain: 'fractal',
    label: 'Fractal',
    artifacts: ['structure', 'parameter_set', 'render', 'animation', 'exploration_session'],
    macros: { list: 'lens.fractal.list', get: 'lens.fractal.get', create: 'lens.fractal.create', update: 'lens.fractal.update', delete: 'lens.fractal.delete', run: 'lens.fractal.run', export: 'lens.fractal.export' },
    exports: ['json', 'png', 'svg', 'mp4'],
    actions: ['generate', 'animate', 'explore', 'export_render', 'parameter_sweep', 'dimension_morph'],
    category: 'creative',
    dataTier: 'SIM_GRADE_A',
    emptyState: {
      headline: "Generate a fractal.",
      caption: "Tweak parameters, animate, sweep \u2014 the SIM_GRADE_A engine renders against the lens schema.",
      firstActionLabel: "Start your first render",
    },
    firstRunGuide: {
      steps: [
        { caption: "Start with a preset; the parameter pane shows every knob." },
        { caption: "parameter_sweep auto-generates a grid so you can spot a sweet spot." },
        { caption: "Export animations as MP4 or DTUs that stream into other lenses." },
      ],
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // PRODUCTIVITY LENSES
  // ═══════════════════════════════════════════════════════════════

  {
    domain: 'calendar',
    label: 'Calendar',
    artifacts: ['event', 'category', 'project', 'recurrence', 'availability'],
    macros: { list: 'lens.calendar.list', get: 'lens.calendar.get', create: 'lens.calendar.create', update: 'lens.calendar.update', delete: 'lens.calendar.delete', run: 'lens.calendar.run', export: 'lens.calendar.export' },
    exports: ['json', 'ics', 'csv', 'pdf'],
    actions: ['schedule', 'remind', 'plan_day', 'plan_week', 'resolve_conflicts', 'availability_search', 'recurrence_expand', 'block_time'],
    category: 'productivity',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: 'No events scheduled.',
      caption: 'Block time, add reminders, plan day/week. The conflict resolver scans for overlap before commit.',
      firstActionLabel: 'Schedule your first event',
    },
    firstRunGuide: {
      steps: [
        { caption: 'Switch view via tabs (Day / Week / Month). Recurrence expands inline.' },
        { caption: 'The plan_week action drafts a balanced schedule from your goals + recurring blocks.' },
        { caption: 'Export to .ics for any external calendar, or keep it Concord-native to flow into the world simulator timeline.' },
      ],
    },
  },
  {
    domain: 'daily',
    label: 'Daily',
    artifacts: ['entry', 'session', 'reminder', 'clip', 'insight'],
    macros: { list: 'lens.daily.list', get: 'lens.daily.get', create: 'lens.daily.create', update: 'lens.daily.update', delete: 'lens.daily.delete', run: 'lens.daily.run', export: 'lens.daily.export' },
    exports: ['json', 'csv', 'md', 'pdf'],
    actions: ['summarize', 'analyze', 'detect_patterns', 'generate_insights', 'weekly_review', 'mood_trend'],
    category: 'productivity',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Capture today.",
      caption: "Daily entries become a substrate that summarizes weekly, detects patterns, and trends your mood over time.",
      firstActionLabel: "Open today's entry",
    },
    firstRunGuide: {
      steps: [
        { caption: "Type freely \u2014 Daily auto-summarizes and surfaces themes across weeks." },
        { caption: "weekly_review walks you through the last seven days with detected patterns." },
        { caption: "mood_trend renders the long arc \u2014 every entry contributes a DTU." },
      ],
    },
  },
  {
    domain: 'goals',
    label: 'Goals',
    artifacts: ['goal', 'challenge', 'milestone', 'achievement', 'progress_snapshot'],
    macros: { list: 'lens.goals.list', get: 'lens.goals.get', create: 'lens.goals.create', update: 'lens.goals.update', delete: 'lens.goals.delete', run: 'lens.goals.run', export: 'lens.goals.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['evaluate', 'activate', 'complete', 'milestone_check', 'dependency_analysis', 'progress_report'],
    category: 'productivity',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: 'No goals set.',
      caption: 'Add a goal with milestones. The dependency analyzer flags blockers; the progress reporter rolls up activity from other lenses.',
      firstActionLabel: 'Set your first goal',
    },
    firstRunGuide: {
      steps: [
        { caption: 'Goals can have child milestones + dependencies on other goals.' },
        { caption: 'evaluate pulls activity signals from calendar / chat / paper / projects to gauge progress.' },
        { caption: 'Completed goals mint as achievement DTUs you can cite from your profile / personas.' },
      ],
    },
  },
  {
    domain: 'srs',
    label: 'SRS',
    artifacts: ['deck', 'card', 'review_log', 'study_session', 'performance_record'],
    macros: { list: 'lens.srs.list', get: 'lens.srs.get', create: 'lens.srs.create', update: 'lens.srs.update', delete: 'lens.srs.delete', run: 'lens.srs.run', export: 'lens.srs.export' },
    exports: ['json', 'csv', 'anki', 'pdf'],
    actions: ['review', 'schedule', 'optimize_intervals', 'generate_cards_from_dtus', 'retention_report', 'difficulty_calibrate'],
    category: 'productivity',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Spaced-repetition that adapts.",
      caption: "Decks + cards + review-log; the optimizer tunes intervals to your retention.",
      firstActionLabel: "Build your first deck",
    },
    firstRunGuide: {
      steps: [
        { caption: "generate_cards_from_dtus turns any DTU into a SRS deck instantly." },
        { caption: "review schedules cards on the SM-2-style interval the optimizer learned for you." },
        { caption: "retention_report shows the long-term curve; difficulty_calibrate re-weights tough cards." },
      ],
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // SOCIAL LENSES
  // ═══════════════════════════════════════════════════════════════

  {
    domain: 'forum',
    label: 'Forum',
    artifacts: ['post', 'comment', 'community', 'tag'],
    macros: { list: 'lens.forum.list', get: 'lens.forum.get', create: 'lens.forum.create', update: 'lens.forum.update', delete: 'lens.forum.delete', run: 'lens.forum.run', export: 'lens.forum.export' },
    exports: ['json', 'csv', 'rss'],
    actions: ['vote', 'pin', 'moderate', 'rank_posts', 'extract_thesis', 'generate_summary_dtu'],
    category: 'social',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Start a community.",
      caption: "Posts, comments, tags, communities \u2014 vote, pin, moderate, extract-thesis.",
      firstActionLabel: "Create your first post",
    },
    firstRunGuide: {
      steps: [
        { caption: "rank_posts uses a hybrid of votes + recency + engagement." },
        { caption: "extract_thesis pulls the through-line out of a long thread into a DTU." },
        { caption: "generate_summary_dtu ships a moderator's recap any reader can cite." },
      ],
    },
  },
  {
    domain: 'collab',
    label: 'Collab',
    artifacts: ['session', 'participant', 'change', 'decision', 'conflict_resolution'],
    macros: { list: 'lens.collab.list', get: 'lens.collab.get', create: 'lens.collab.create', update: 'lens.collab.update', delete: 'lens.collab.delete', run: 'lens.collab.run', export: 'lens.collab.export' },
    exports: ['json', 'csv', 'md'],
    actions: ['merge', 'lock', 'unlock', 'summarize_thread', 'run_council', 'extract_actions', 'resolve_conflict', 'version_diff'],
    category: 'social',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: 'No collab sessions yet.',
      caption: 'Start a session to co-author with another user. Locks, version diffs, and conflict resolution are first-class.',
      firstActionLabel: 'Start a session',
    },
    firstRunGuide: {
      steps: [
        { caption: 'Sessions list with status (active / closed / archived). Click any to enter the live room.' },
        { caption: 'Lock a section to claim it; unlock to release. Version diffs show every change with author attribution.' },
        { caption: 'run_council escalates a contested decision to formal vote via the council substrate.' },
      ],
    },
  },
  {
    domain: 'feed',
    label: 'Feed',
    artifacts: ['post', 'author', 'interaction', 'topic'],
    macros: { list: 'lens.feed.list', get: 'lens.feed.get', create: 'lens.feed.create', update: 'lens.feed.update', delete: 'lens.feed.delete', run: 'lens.feed.run', export: 'lens.feed.export' },
    exports: ['json', 'csv', 'rss'],
    actions: ['like', 'repost', 'bookmark', 'rank', 'personalize', 'cluster_topics'],
    category: 'social',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: 'Feed empty for now.',
      caption: 'Follow creators, subscribe to topics, or post. The federation bridge surfaces DTUs from peer instances too.',
      firstActionLabel: 'Post or follow',
    },
    firstRunGuide: {
      steps: [
        { caption: 'Posts can cite DTUs you minted in any lens. The Subconscious brain ranks by your past interactions + topic clusters.' },
        { caption: 'personalize toggles personalization on/off; bookmark saves to a per-user cache surfaced in dailyhub.' },
        { caption: 'Cross-lens flow: a marketplace listing appears in your feed when its creator publishes; clicking opens the marketplace lens with the DTU pre-selected.' },
      ],
    },
  },
  {
    domain: 'experience',
    label: 'Experience',
    artifacts: ['portfolio', 'skill', 'history', 'insight', 'credential'],
    macros: { list: 'lens.experience.list', get: 'lens.experience.get', create: 'lens.experience.create', update: 'lens.experience.update', delete: 'lens.experience.delete', run: 'lens.experience.run', export: 'lens.experience.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['endorse', 'analyze', 'generate_resume', 'compare_versions', 'validate_claims'],
    category: 'social',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Build a verifiable portfolio.",
      caption: "Skills, history, credentials \u2014 endorsed and validated against the substrate.",
      firstActionLabel: "Add your first credential",
    },
    firstRunGuide: {
      steps: [
        { caption: "endorsements ride the DTU substrate, so every claim has a provenance chain." },
        { caption: "generate_resume composes a tailored PDF from your profile." },
        { caption: "compare_versions diffs your portfolio over time \u2014 see your trajectory." },
      ],
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // FINANCE LENSES
  // ═══════════════════════════════════════════════════════════════

  {
    domain: 'finance',
    label: 'Finance',
    artifacts: ['asset', 'transaction', 'order', 'alert', 'portfolio', 'report'],
    macros: { list: 'lens.finance.list', get: 'lens.finance.get', create: 'lens.finance.create', update: 'lens.finance.update', delete: 'lens.finance.delete', run: 'lens.finance.run', export: 'lens.finance.export' },
    exports: ['json', 'csv', 'pdf', 'ofx'],
    actions: ['trade', 'analyze', 'alert', 'simulate', 'generate_report', 'portfolio_rebalance', 'risk_assessment'],
    category: 'finance',
    dataTier: 'REAL_LIVE',
    realtimeEvents: ['finance:ticker', 'finance:market_update', 'finance:alert', 'economy:update'],
    emptyState: {
      headline: 'No tracked assets.',
      caption: 'Track stocks (S&P 500 / NASDAQ / DOW), crypto (CoinGecko top 10), or set rate alerts (FRED). Live ticker updates every 60s.',
      firstActionLabel: 'Add an asset',
    },
    firstRunGuide: {
      steps: [
        { caption: 'Tickers stream live from Yahoo Finance + CoinGecko + World Bank — real prices, no synthetic.' },
        { caption: 'Simulate runs a portfolio against historical data via the Subconscious brain.' },
        { caption: 'risk_assessment pulls volatility + drawdown + correlation across your portfolio — also wired to real series.' },
      ],
    },
  },
  {
    domain: 'marketplace',
    label: 'Marketplace',
    artifacts: ['listing', 'purchase', 'review', 'license', 'provenance_record'],
    macros: { list: 'lens.marketplace.list', get: 'lens.marketplace.get', create: 'lens.marketplace.create', update: 'lens.marketplace.update', delete: 'lens.marketplace.delete', run: 'lens.marketplace.run', export: 'lens.marketplace.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['buy', 'sell', 'review', 'verify_artifact_hash', 'issue_license', 'distribute_royalties', 'validate_listing', 'provenance_check'],
    category: 'finance',
    dataTier: 'REAL_LIVE',
    realtimeEvents: ['marketplace:purchase', 'market:listing', 'market:trade', 'creative_registry:update'],
    emptyState: {
      headline: 'No listings yet.',
      caption: 'List a DTU you minted, or browse what creators have published. Royalty cascade pays ancestors automatically.',
      firstActionLabel: 'List your first DTU',
    },
    firstRunGuide: {
      steps: [
        { caption: 'The creator grid puts artwork up front. Click any tile for provenance + price + license terms.' },
        { caption: 'Buying mints a license + cascades royalties up the lineage chain (95% to creators, 30% cap to ancestors, seller keeps ≥64.54%).' },
        { caption: 'Selling: hit the "Mint" action on any DTU you own and set a tier price. Citations from your DTU pay you forever.' },
      ],
    },
  },
  {
    domain: 'market',
    label: 'Market',
    artifacts: ['offer', 'bid', 'token_tx', 'settlement', 'order_book'],
    macros: { list: 'lens.market.list', get: 'lens.market.get', create: 'lens.market.create', update: 'lens.market.update', delete: 'lens.market.delete', run: 'lens.market.run', export: 'lens.market.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['place_bid', 'accept_offer', 'settle', 'price_history', 'volume_analysis', 'liquidity_check'],
    category: 'finance',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Concord token markets.",
      caption: "Place bids, accept offers, settle on-substrate; price-history + volume + liquidity render live.",
      firstActionLabel: "Place your first bid",
    },
    firstRunGuide: {
      steps: [
        { caption: "All orders settle through the on-substrate ledger; no off-platform escrow." },
        { caption: "price_history is real candle data sourced from the macro_call_billing + economy_ledger tables." },
        { caption: "liquidity_check tells you whether your size will move the price before you commit." },
      ],
    },
  },
  {
    domain: 'questmarket',
    label: 'Questmarket',
    artifacts: ['quest', 'bounty', 'submission', 'payout', 'reputation_record'],
    macros: { list: 'lens.questmarket.list', get: 'lens.questmarket.get', create: 'lens.questmarket.create', update: 'lens.questmarket.update', delete: 'lens.questmarket.delete', run: 'lens.questmarket.run', export: 'lens.questmarket.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['post_bounty', 'submit_work', 'verify_submission', 'release_payout', 'reputation_score', 'dispute_resolve'],
    category: 'finance',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Post a bounty.",
      caption: "Quest market: bounties, submissions, payouts, reputation \u2014 verified end-to-end.",
      firstActionLabel: "Post your first bounty",
    },
    firstRunGuide: {
      steps: [
        { caption: "Set a reward; submissions land with proof of work." },
        { caption: "verify_submission runs the agreed acceptance criteria before payout." },
        { caption: "reputation_score follows every participant and shows on profile." },
      ],
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // KNOWLEDGE LENSES
  // ═══════════════════════════════════════════════════════════════

  {
    domain: 'ml',
    label: 'ML',
    artifacts: ['model', 'experiment', 'dataset', 'deployment', 'run_log', 'evaluation'],
    macros: { list: 'lens.ml.list', get: 'lens.ml.get', create: 'lens.ml.create', update: 'lens.ml.update', delete: 'lens.ml.delete', run: 'lens.ml.run', export: 'lens.ml.export' },
    exports: ['json', 'csv', 'onnx', 'pkl'],
    actions: ['train', 'infer', 'deploy', 'evaluate', 'run_experiment', 'compare_runs', 'generate_report', 'hyperparameter_search', 'model_explain'],
    category: 'knowledge',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: 'No experiments yet.',
      caption: 'Start an experiment with a dataset + model class. Live arXiv cs.LG feed at the top surfaces relevant new papers.',
      firstActionLabel: 'Start an experiment',
    },
    firstRunGuide: {
      steps: [
        { caption: 'arXiv cs.LG panel up top streams new papers daily — REAL data from arXiv.' },
        { caption: 'Experiments hold model + dataset + hyperparams + run log. compare_runs surfaces deltas across two experiments.' },
        { caption: 'model_explain runs the Subconscious brain over a model summary to draft a plain-language explanation suitable for the docs lens.' },
      ],
    },
  },
  {
    domain: 'thread',
    label: 'Thread',
    artifacts: ['thread', 'node', 'decision'],
    macros: { list: 'lens.thread.list', get: 'lens.thread.get', create: 'lens.thread.create', update: 'lens.thread.update', delete: 'lens.thread.delete', run: 'lens.thread.run', export: 'lens.thread.export' },
    exports: ['json', 'csv', 'md'],
    actions: ['branch', 'merge', 'summarize', 'detect_consensus', 'extract_decisions'],
    category: 'knowledge',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Branch a conversation.",
      caption: "Threads + nodes + decisions; merge branches, detect consensus, extract decisions.",
      firstActionLabel: "Start a thread",
    },
    firstRunGuide: {
      steps: [
        { caption: "branch any node to fork the discussion into a parallel exploration." },
        { caption: "merge brings two threads back together with conflict-resolution." },
        { caption: "extract_decisions surfaces the actual outcomes as standalone DTUs." },
      ],
    },
  },
  {
    domain: 'law',
    label: 'Law',
    artifacts: ['case', 'clause', 'draft', 'precedent', 'compliance_check'],
    macros: { list: 'lens.law.list', get: 'lens.law.get', create: 'lens.law.create', update: 'lens.law.update', delete: 'lens.law.delete', run: 'lens.law.run', export: 'lens.law.export' },
    exports: ['json', 'md', 'pdf', 'docx'],
    actions: ['check-compliance', 'analyze', 'draft', 'cite', 'clause_compare', 'precedent_search', 'risk_flag'],
    category: 'social',
    dataTier: 'DEMO',
    emptyState: {
      headline: "Draft + check + cite.",
      caption: "Case + clause + precedent \u2014 DEMO data; wire your own corpus when ready.",
      firstActionLabel: "Open the workspace",
    },
    firstRunGuide: {
      steps: [
        { caption: "draft a clause; the lens runs check-compliance against jurisdiction rules." },
        { caption: "precedent_search and clause_compare ride the same substrate as Paper." },
        { caption: "risk_flag highlights language that's caused issues in similar deals." },
      ],
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // GOVERNANCE / HYBRID LENSES (previously missing manifests)
  // ═══════════════════════════════════════════════════════════════

  {
    domain: 'vote',
    label: 'Vote',
    artifacts: ['proposal', 'ballot', 'tally', 'audit_trail', 'voter_record'],
    macros: { list: 'lens.vote.list', get: 'lens.vote.get', create: 'lens.vote.create', update: 'lens.vote.update', delete: 'lens.vote.delete', run: 'lens.vote.run', export: 'lens.vote.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['cast_ballot', 'tally_votes', 'verify_quorum', 'audit_results', 'ranked_choice_resolve', 'generate_report'],
    category: 'social',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Cast a ballot.",
      caption: "Proposals + ballots + tallies + audit-trail; ranked-choice, quorum-gated, verifiable.",
      firstActionLabel: "Open the active vote",
    },
    firstRunGuide: {
      steps: [
        { caption: "cast_ballot records your vote with a hash you can audit later." },
        { caption: "tally_votes uses ranked-choice resolution when the proposal needs it." },
        { caption: "audit_results regenerates the tally deterministically from the audit trail." },
      ],
    },
  },
  {
    domain: 'ethics',
    label: 'Ethics',
    artifacts: ['case_file', 'decision_tree', 'policy_check', 'review', 'framework'],
    macros: { list: 'lens.ethics.list', get: 'lens.ethics.get', create: 'lens.ethics.create', update: 'lens.ethics.update', delete: 'lens.ethics.delete', run: 'lens.ethics.run', export: 'lens.ethics.export' },
    exports: ['json', 'md', 'pdf'],
    actions: ['evaluate_case', 'apply_framework', 'check_alignment', 'generate_report', 'stakeholder_analysis', 'risk_assessment'],
    category: 'social',
    dataTier: 'SIM_GRADE_A',
    emptyState: {
      headline: "Reason through a case.",
      caption: "Case-file + decision-tree + framework: apply ethical frameworks against real stakeholder analysis.",
      firstActionLabel: "Open a case",
    },
    firstRunGuide: {
      steps: [
        { caption: "Pick a framework (deontology / consequentialism / virtue / care)." },
        { caption: "stakeholder_analysis walks who's affected and how." },
        { caption: "generate_report exports a defensible decision with framework citations." },
      ],
    },
  },
  {
    domain: 'alliance',
    label: 'Alliance',
    artifacts: ['alliance_proposal', 'coalition_charter', 'agreement', 'member_record', 'governance_rule'],
    macros: { list: 'lens.alliance.list', get: 'lens.alliance.get', create: 'lens.alliance.create', update: 'lens.alliance.update', delete: 'lens.alliance.delete', run: 'lens.alliance.run', export: 'lens.alliance.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['propose_alliance', 'ratify_charter', 'add_member', 'vote_on_governance', 'compliance_check', 'dissolve'],
    category: 'social',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Form an alliance.",
      caption: "Charter, members, governance, compliance \u2014 propose, ratify, dissolve.",
      firstActionLabel: "Propose an alliance",
    },
    firstRunGuide: {
      steps: [
        { caption: "Set the charter; members vote_on_governance per rule." },
        { caption: "compliance_check flags drift between behavior and charter." },
        { caption: "All ratifications and votes live on the audit trail." },
      ],
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // COLLABORATION / HYBRID LENSES
  // ═══════════════════════════════════════════════════════════════

  {
    domain: 'whiteboard',
    label: 'Whiteboard',
    artifacts: ['board', 'element', 'connection', 'comment', 'template'],
    macros: { list: 'lens.whiteboard.list', get: 'lens.whiteboard.get', create: 'lens.whiteboard.create', update: 'lens.whiteboard.update', delete: 'lens.whiteboard.delete', run: 'lens.whiteboard.run', export: 'lens.whiteboard.export' },
    exports: ['json', 'png', 'svg', 'pdf'],
    actions: ['render', 'layout', 'collaborate', 'snapshot', 'auto_arrange', 'extract_decisions', 'version_diff'],
    category: 'creative',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: 'Blank canvas.',
      caption: 'Drag shapes, connect them, comment. The canvas opens by default. extract_decisions distills any board into a DTU.',
      firstActionLabel: 'Drop a shape',
    },
    firstRunGuide: {
      steps: [
        { caption: 'Toolbar at the bottom (rect / sticky / pen). Click and drag on the canvas to draw.' },
        { caption: 'auto_arrange lays out connections with force-directed graph algorithm; snapshot freezes a version.' },
        { caption: 'extract_decisions runs the Subconscious brain over your board to distill action items — useful after team sessions.' },
      ],
    },
  },
  {
    domain: 'board',
    label: 'Board',
    artifacts: ['board', 'card', 'lane', 'workflow', 'label', 'sprint'],
    macros: { list: 'lens.board.list', get: 'lens.board.get', create: 'lens.board.create', update: 'lens.board.update', delete: 'lens.board.delete', run: 'lens.board.run', export: 'lens.board.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['move_card', 'assign', 'set_wip_limit', 'burndown', 'velocity_calc', 'sprint_review', 'archive_done'],
    category: 'productivity',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Kanban that knows your team.",
      caption: "Boards, lanes, cards, sprints \u2014 WIP limits, burndown, velocity, sprint-review.",
      firstActionLabel: "Create your first board",
    },
    firstRunGuide: {
      steps: [
        { caption: "move_card across lanes; set_wip_limit per lane to enforce flow." },
        { caption: "burndown + velocity_calc compute live from your card history." },
        { caption: "sprint_review packages the sprint as a single DTU for retro." },
      ],
    },
  },
  {
    domain: 'timeline',
    label: 'Timeline',
    artifacts: ['timeline_object', 'event_node', 'span', 'annotation', 'replay_session'],
    macros: { list: 'lens.timeline.list', get: 'lens.timeline.get', create: 'lens.timeline.create', update: 'lens.timeline.update', delete: 'lens.timeline.delete', run: 'lens.timeline.run', export: 'lens.timeline.export' },
    exports: ['json', 'csv', 'svg', 'ics'],
    actions: ['replay', 'diff_timelines', 'annotate', 'cluster_events', 'gap_analysis', 'causality_trace'],
    category: 'productivity',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Replay any timeline.",
      caption: "Timeline objects, event nodes, spans, annotations \u2014 diff, cluster, causality-trace.",
      firstActionLabel: "Open a timeline",
    },
    firstRunGuide: {
      steps: [
        { caption: "replay scrubs through events at any speed." },
        { caption: "diff_timelines surfaces what changed between two versions." },
        { caption: "causality_trace walks the upstream of any event back through DTU lineage." },
      ],
    },
  },
  {
    domain: 'anon',
    label: 'Anon',
    artifacts: ['anonymous_room', 'message', 'artifact', 'provenance_rule', 'identity_mask'],
    macros: { list: 'lens.anon.list', get: 'lens.anon.get', create: 'lens.anon.create', update: 'lens.anon.update', delete: 'lens.anon.delete', run: 'lens.anon.run', export: 'lens.anon.export' },
    exports: ['json', 'md'],
    actions: ['create_room', 'post_anonymous', 'verify_provenance', 'rotate_identity', 'export_sanitized', 'moderate'],
    category: 'social',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Speak without an identity.",
      caption: "Anonymous rooms with provable provenance \u2014 masked identities, no PII in the open.",
      firstActionLabel: "Create a room",
    },
    firstRunGuide: {
      steps: [
        { caption: "post_anonymous strips identifying metadata before persisting." },
        { caption: "verify_provenance lets readers confirm the post came from a real account." },
        { caption: "rotate_identity re-keys your mask on schedule." },
      ],
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // SYSTEM / HYBRID LENSES
  // ═══════════════════════════════════════════════════════════════

  {
    domain: 'database',
    label: 'Database',
    artifacts: ['query', 'snapshot', 'table', 'view', 'migration', 'index'],
    macros: { list: 'lens.database.list', get: 'lens.database.get', create: 'lens.database.create', update: 'lens.database.update', delete: 'lens.database.delete', run: 'lens.database.run', export: 'lens.database.export' },
    exports: ['json', 'csv', 'sql', 'parquet'],
    actions: ['query', 'analyze', 'optimize', 'schema-inspect', 'migration_generate', 'index_suggest', 'explain_plan'],
    category: 'system',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Query, explain, optimize.",
      caption: "Run SQL against the substrate, get explain plans, index suggestions, and migration generation.",
      firstActionLabel: "Open the query workbench",
    },
    firstRunGuide: {
      steps: [
        { caption: "schema-inspect surfaces all 459 tables and their relationships." },
        { caption: "explain_plan tells you what the query is actually going to do." },
        { caption: "migration_generate diffs your changes into a migration file." },
      ],
    },
  },
  {
    domain: 'game',
    label: 'Game',
    artifacts: ['achievement', 'quest', 'skill', 'profile', 'game_state', 'reward_event'],
    macros: { list: 'lens.game.list', get: 'lens.game.get', create: 'lens.game.create', update: 'lens.game.update', delete: 'lens.game.delete', run: 'lens.game.run', export: 'lens.game.export' },
    exports: ['json', 'csv'],
    actions: ['complete', 'claim', 'levelup', 'simulate', 'resolve_turn', 'balance', 'leaderboard_update'],
    category: 'system',
    dataTier: 'SIM_GRADE_A',
    emptyState: {
      headline: "Track your achievements + skills.",
      caption: "Achievements, quests, skills, profile, leaderboards \u2014 Concordia gameplay surfaces here.",
      firstActionLabel: "Open your profile",
    },
    firstRunGuide: {
      steps: [
        { caption: "complete + claim move quests through their state machine." },
        { caption: "levelup applies the actual XP table; simulate previews outcomes." },
        { caption: "leaderboard_update keeps your standing live." },
      ],
    },
  },
  {
    domain: 'resonance',
    label: 'Resonance',
    artifacts: ['alert', 'metric', 'acknowledgement'],
    macros: {
      list:   'lens.resonance.list',
      get:    'lens.resonance.get',
      create: 'lens.resonance.create',
      update: 'lens.resonance.update',
      delete: 'lens.resonance.delete',
      run:    'lens.resonance.run',
      export: 'lens.resonance.export',
    },
    exports: ['json', 'csv'],
    actions: ['acknowledge', 'dismiss', 'snooze', 'escalate'],
    category: 'system',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Alerts that matter.",
      caption: "Real metrics \u2192 triaged alerts; acknowledge, dismiss, snooze, escalate.",
      firstActionLabel: "Open active alerts",
    },
    firstRunGuide: {
      steps: [
        { caption: "Each alert ties to a real metric on the system substrate." },
        { caption: "snooze re-fires when the underlying condition persists." },
        { caption: "escalate hands off to the on-call without losing the trail." },
      ],
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // SPECIALIZED HYBRID LENSES (previously missing manifests)
  // ═══════════════════════════════════════════════════════════════

  {
    domain: 'entity',
    label: 'Entity',
    artifacts: ['entity_profile', 'link', 'evidence', 'relationship', 'resolution_record'],
    macros: { list: 'lens.entity.list', get: 'lens.entity.get', create: 'lens.entity.create', update: 'lens.entity.update', delete: 'lens.entity.delete', run: 'lens.entity.run', export: 'lens.entity.export' },
    exports: ['json', 'csv', 'graphml'],
    actions: ['resolve_entity', 'link_evidence', 'merge_duplicates', 'relationship_map', 'confidence_score', 'provenance_trace'],
    category: 'knowledge',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Resolve entities.",
      caption: "Profiles + links + evidence; the engine merges duplicates with confidence scoring and provenance trace.",
      firstActionLabel: "Open the resolver",
    },
    firstRunGuide: {
      steps: [
        { caption: "resolve_entity uses the entity-resolution engine from the knowledge substrate." },
        { caption: "merge_duplicates merges two entities while preserving lineage." },
        { caption: "provenance_trace shows every source contributing to the resolved entity." },
      ],
    },
  },
  {
    domain: 'lab',
    label: 'Lab',
    artifacts: ['experiment_notebook', 'protocol', 'run', 'result', 'reagent', 'equipment_log'],
    macros: { list: 'lens.lab.list', get: 'lens.lab.get', create: 'lens.lab.create', update: 'lens.lab.update', delete: 'lens.lab.delete', run: 'lens.lab.run', export: 'lens.lab.export' },
    exports: ['json', 'csv', 'pdf', 'xlsx'],
    actions: ['run_protocol', 'record_result', 'compare_runs', 'statistical_analysis', 'equipment_calibrate', 'generate_report'],
    category: 'knowledge',
    dataTier: 'SIM_GRADE_A',
    emptyState: {
      headline: 'Lab notebook empty.',
      caption: 'Author protocols, log runs, attach reagents + equipment calibration. Compare runs to spot drift.',
      firstActionLabel: 'New experiment',
    },
    firstRunGuide: {
      steps: [
        { caption: 'Protocols are templates; runs instantiate them with specific reagent batches + equipment serials.' },
        { caption: 'record_result captures structured outcomes (mean / sd / n); statistical_analysis runs t-test / ANOVA.' },
        { caption: 'generate_report assembles a PDF combining protocol, runs, results, and analysis.' },
      ],
    },
  },
  {
    domain: 'repos',
    label: 'Repos',
    artifacts: ['repo_snapshot', 'issue_set', 'patchset', 'release', 'branch_record'],
    macros: { list: 'lens.repos.list', get: 'lens.repos.get', create: 'lens.repos.create', update: 'lens.repos.update', delete: 'lens.repos.delete', run: 'lens.repos.run', export: 'lens.repos.export' },
    exports: ['json', 'csv', 'patch', 'tar'],
    actions: ['ingest_metadata', 'diff_view', 'release_package', 'issue_triage', 'contributor_stats', 'dependency_audit'],
    category: 'knowledge',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Bring your repos in.",
      caption: "Snapshot, diff, release, triage \u2014 repos.ingest_metadata syncs your real codebase.",
      firstActionLabel: "Connect a repo",
    },
    firstRunGuide: {
      steps: [
        { caption: "ingest_metadata pulls README + structure + open issues." },
        { caption: "contributor_stats + dependency_audit run against the live tree." },
        { caption: "release_package bundles a versioned release as a DTU." },
      ],
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // VIEWER LENSES — upgraded with real artifacts + workflows
  // (previously missing manifests)
  // ═══════════════════════════════════════════════════════════════

  {
    domain: 'invariant',
    label: 'Invariant',
    artifacts: ['invariant_set', 'monitor', 'violation_report', 'rule', 'check_result'],
    macros: { list: 'lens.invariant.list', get: 'lens.invariant.get', create: 'lens.invariant.create', update: 'lens.invariant.update', delete: 'lens.invariant.delete', run: 'lens.invariant.run', export: 'lens.invariant.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['check_all', 'add_invariant', 'monitor_start', 'violation_report', 'trend_analysis', 'auto_repair_suggest'],
    category: 'system',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Enforce what matters.",
      caption: "Invariants + monitors; the substrate checks_all on every tick, reports violations, suggests auto-repair.",
      firstActionLabel: "Add your first invariant",
    },
    firstRunGuide: {
      steps: [
        { caption: "Add a rule; monitor_start wires it into the heartbeat." },
        { caption: "violation_report bundles a triage view per breach." },
        { caption: "auto_repair_suggest proposes fixes the substrate can apply on consent." },
      ],
    },
  },
  {
    domain: 'meta',
    label: 'Meta',
    artifacts: ['session_meta_model', 'policy_profile', 'capability_map', 'lens_score'],
    macros: { list: 'lens.meta.list', get: 'lens.meta.get', create: 'lens.meta.create', update: 'lens.meta.update', delete: 'lens.meta.delete', run: 'lens.meta.run', export: 'lens.meta.export' },
    exports: ['json', 'csv', 'md'],
    actions: ['score_lenses', 'policy_check', 'capability_audit', 'generate_status_report', 'cross_lens_analysis'],
    category: 'system',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Score your lenses.",
      caption: "Session meta-model + policy + capability \u2014 score_lenses + cross_lens_analysis ride the cartograph.",
      firstActionLabel: "Run a score pass",
    },
    firstRunGuide: {
      steps: [
        { caption: "score_lenses runs the same audit as `npm run score-lenses` in CI." },
        { caption: "policy_check verifies your active policy profile is satisfied." },
        { caption: "cross_lens_analysis surfaces drift between lenses that should agree." },
      ],
    },
  },
  {
    domain: 'eco',
    label: 'Eco',
    artifacts: ['ecosystem_graph', 'resource_flow', 'dependency_map', 'health_metric'],
    macros: { list: 'lens.eco.list', get: 'lens.eco.get', create: 'lens.eco.create', update: 'lens.eco.update', delete: 'lens.eco.delete', run: 'lens.eco.run', export: 'lens.eco.export' },
    exports: ['json', 'csv', 'svg', 'graphml'],
    actions: ['map_dependencies', 'flow_analysis', 'health_check', 'bottleneck_detect', 'impact_simulation'],
    category: 'system',
    dataTier: 'REAL_FREE',
    emptyState: {
      headline: "Map the ecosystem.",
      caption: "Ecosystem graph, resource flow, dependency map \u2014 find bottlenecks before they bind.",
      firstActionLabel: "Build your first map",
    },
    firstRunGuide: {
      steps: [
        { caption: "map_dependencies walks the live module graph." },
        { caption: "flow_analysis identifies critical paths and choke points." },
        { caption: "impact_simulation models a change before you ship it." },
      ],
    },
  },
  {
    domain: 'temporal',
    label: 'Temporal',
    artifacts: ['timeline_object', 'temporal_assertion', 'replay_session', 'diff_record', 'causality_chain'],
    macros: { list: 'lens.temporal.list', get: 'lens.temporal.get', create: 'lens.temporal.create', update: 'lens.temporal.update', delete: 'lens.temporal.delete', run: 'lens.temporal.run', export: 'lens.temporal.export' },
    exports: ['json', 'csv', 'svg'],
    actions: ['replay', 'diff', 'causality_trace', 'temporal_query', 'truth_at_time', 'version_compare'],
    category: 'knowledge',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Truth at any point in time.",
      caption: "Replay, diff, causality-trace \u2014 temporal_query gives you the substrate as of any timestamp.",
      firstActionLabel: "Run a temporal query",
    },
    firstRunGuide: {
      steps: [
        { caption: "truth_at_time reconstructs state at any past moment." },
        { caption: "version_compare diffs the same entity across two times." },
        { caption: "causality_trace walks upstream until the original input." },
      ],
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // SUPER-LENSES — Universal coverage across all human work
  // All upgraded with domain-specific macros + 3 engines + import/export
  // ═══════════════════════════════════════════════════════════════

  // === HEALTHCARE ===
  {
    domain: 'healthcare',
    label: 'Healthcare',
    artifacts: ['Patient', 'Encounter', 'CareProtocol', 'Prescription', 'LabResult', 'Treatment', 'ReferralRecord'],
    macros: { list: 'lens.healthcare.list', get: 'lens.healthcare.get', create: 'lens.healthcare.create', update: 'lens.healthcare.update', delete: 'lens.healthcare.delete', run: 'lens.healthcare.run', export: 'lens.healthcare.export' },
    exports: ['json', 'csv', 'pdf', 'hl7', 'fhir'],
    actions: ['checkInteractions', 'protocolMatch', 'generateSummary', 'intakeWorkflow', 'riskFlagging', 'carePlanGenerate', 'labImport', 'dischargePackage'],
    category: 'healthcare',
    dataTier: 'DEMO',
    emptyState: {
      headline: "Healthcare workflow scaffold.",
      caption: "Patient, encounter, prescription, lab \u2014 DEMO data; wire your own EHR via Integrations.",
      firstActionLabel: "Open the EHR shell",
    },
    firstRunGuide: {
      steps: [
        { caption: "checkInteractions runs against the same engine the Pharmacy lens uses." },
        { caption: "intakeWorkflow walks the patient through intake \u2192 encounter \u2192 care plan." },
        { caption: "labImport ingests results; dischargePackage assembles the handoff." },
      ],
    },
  },

  // === TRADES ===
  {
    domain: 'trades',
    label: 'Trades & Construction',
    artifacts: ['Job', 'Estimate', 'MaterialsList', 'Permit', 'Equipment', 'Client', 'Inspection'],
    macros: { list: 'lens.trades.list', get: 'lens.trades.get', create: 'lens.trades.create', update: 'lens.trades.update', delete: 'lens.trades.delete', run: 'lens.trades.run', export: 'lens.trades.export' },
    exports: ['json', 'csv', 'pdf', 'xlsx'],
    actions: ['calculateEstimate', 'scheduleInspection', 'materialsCost', 'codeComplianceCheck', 'changeOrderGenerate', 'progressPhotoLog', 'safetyChecklist'],
    category: 'trades',
    dataTier: 'SIM_GRADE_A',
    emptyState: {
      headline: "Trades & construction.",
      caption: "Jobs, estimates, materials, permits, inspections \u2014 calculate, schedule, comply.",
      firstActionLabel: "Create a job",
    },
    firstRunGuide: {
      steps: [
        { caption: "calculateEstimate uses material cost + labor + permit fee tables." },
        { caption: "scheduleInspection ties to the calendar + permit substrate." },
        { caption: "safetyChecklist + changeOrderGenerate keep the paper trail clean." },
      ],
    },
  },

  // === FOOD ===
  {
    domain: 'food',
    label: 'Food & Hospitality',
    artifacts: ['Recipe', 'Menu', 'InventoryItem', 'Booking', 'Batch', 'Shift', 'Supplier'],
    macros: { list: 'lens.food.list', get: 'lens.food.get', create: 'lens.food.create', update: 'lens.food.update', delete: 'lens.food.delete', run: 'lens.food.run', export: 'lens.food.export' },
    exports: ['json', 'csv', 'pdf', 'xlsx'],
    actions: ['scaleRecipe', 'costPlate', 'spoilageCheck', 'pourCost', 'menuEngineer', 'allergenValidate', 'shiftScheduleOptimize', 'supplierCompare'],
    category: 'operations',
    dataTier: 'REAL_FREE',
    emptyState: {
      headline: "Food & hospitality ops.",
      caption: "Recipes, menus, inventory, bookings \u2014 scale, cost, schedule, allergen-check.",
      firstActionLabel: "Add your first recipe",
    },
    firstRunGuide: {
      steps: [
        { caption: "scaleRecipe + costPlate compute against current supplier prices." },
        { caption: "menuEngineer + pourCost tighten margins per item." },
        { caption: "shiftScheduleOptimize stages staff against forecast bookings." },
      ],
    },
  },

  // === RETAIL ===
  {
    domain: 'retail',
    label: 'Retail & Commerce',
    artifacts: ['Product', 'Order', 'Customer', 'Lead', 'Ticket', 'Display', 'Promotion'],
    macros: { list: 'lens.retail.list', get: 'lens.retail.get', create: 'lens.retail.create', update: 'lens.retail.update', delete: 'lens.retail.delete', run: 'lens.retail.run', export: 'lens.retail.export' },
    exports: ['json', 'csv', 'pdf', 'xlsx'],
    actions: ['reorderCheck', 'pipelineValue', 'customerLTV', 'slaStatus', 'inventoryForecast', 'priceOptimize', 'promotionROI', 'churnPredict'],
    category: 'operations',
    dataTier: 'REAL_FREE',
    emptyState: {
      headline: "Retail & commerce.",
      caption: "Products, orders, customers, leads, tickets \u2014 reorder, forecast, retain.",
      firstActionLabel: "Open your shop",
    },
    firstRunGuide: {
      steps: [
        { caption: "reorderCheck + inventoryForecast keep your shelves stocked." },
        { caption: "customerLTV + churnPredict use the actual purchase substrate." },
        { caption: "promotionROI compares your campaigns side-by-side." },
      ],
    },
  },

  // === HOUSEHOLD ===
  {
    domain: 'household',
    label: 'Home & Family',
    artifacts: ['FamilyMember', 'MealPlan', 'Chore', 'MaintenanceItem', 'Pet', 'MajorEvent', 'Budget'],
    macros: { list: 'lens.household.list', get: 'lens.household.get', create: 'lens.household.create', update: 'lens.household.update', delete: 'lens.household.delete', run: 'lens.household.run', export: 'lens.household.export' },
    exports: ['json', 'csv', 'pdf', 'ics'],
    actions: ['generateGroceryList', 'maintenanceDue', 'choreRotation', 'mealPlanGenerate', 'budgetCheck', 'seasonalChecklist', 'emergencyContacts'],
    category: 'productivity',
    dataTier: 'REAL_FREE',
    emptyState: {
      headline: "Run the household.",
      caption: "Family, meals, chores, maintenance, pets \u2014 plan, rotate, remind, budget.",
      firstActionLabel: "Set up your household",
    },
    firstRunGuide: {
      steps: [
        { caption: "mealPlanGenerate composes a week against pantry + preferences." },
        { caption: "choreRotation distributes work fairly across family members." },
        { caption: "maintenanceDue + seasonalChecklist surface what needs doing." },
      ],
    },
  },

  // === ACCOUNTING ===
  {
    domain: 'accounting',
    label: 'Accounting & Finance',
    artifacts: ['Account', 'Transaction', 'Invoice', 'PayrollEntry', 'Budget', 'Property', 'TaxItem', 'Reconciliation'],
    macros: { list: 'lens.accounting.list', get: 'lens.accounting.get', create: 'lens.accounting.create', update: 'lens.accounting.update', delete: 'lens.accounting.delete', run: 'lens.accounting.run', export: 'lens.accounting.export' },
    exports: ['json', 'csv', 'pdf', 'qbo', 'xlsx'],
    actions: ['trialBalance', 'profitLoss', 'invoiceAging', 'budgetVariance', 'rentRoll', 'reconcile', 'categorize', 'taxEstimate', 'auditReport'],
    category: 'finance',
    dataTier: 'SIM_GRADE_A',
    emptyState: {
      headline: "Books that close themselves.",
      caption: "Accounts, transactions, invoices, payroll, tax \u2014 reconcile, categorize, audit.",
      firstActionLabel: "Add your accounts",
    },
    firstRunGuide: {
      steps: [
        { caption: "trialBalance + profitLoss render live from the ledger." },
        { caption: "categorize uses transaction patterns to auto-tag entries." },
        { caption: "auditReport bundles everything an accountant needs." },
      ],
    },
  },

  // === AGRICULTURE ===
  {
    domain: 'agriculture',
    label: 'Agriculture & Farming',
    artifacts: ['Field', 'Crop', 'Animal', 'FarmEquipment', 'WaterSystem', 'Harvest', 'Certification', 'SoilTest'],
    macros: { list: 'lens.agriculture.list', get: 'lens.agriculture.get', create: 'lens.agriculture.create', update: 'lens.agriculture.update', delete: 'lens.agriculture.delete', run: 'lens.agriculture.run', export: 'lens.agriculture.export' },
    exports: ['json', 'csv', 'pdf', 'geojson'],
    actions: ['rotationPlan', 'yieldAnalysis', 'equipmentDue', 'waterSchedule', 'soilHealthScore', 'pestPressureAlert', 'harvestForecast', 'certificationAudit'],
    category: 'agriculture',
    dataTier: 'REAL_FREE',
    emptyState: {
      headline: "Manage your farm.",
      caption: "Fields, crops, animals, equipment, water \u2014 rotation, yield, soil health, harvest forecast.",
      firstActionLabel: "Add your first field",
    },
    firstRunGuide: {
      steps: [
        { caption: "soilHealthScore runs against test results + historical yield." },
        { caption: "rotationPlan composes a multi-year sequence per field." },
        { caption: "pestPressureAlert pulls real environmental signals from REAL_FREE feeds." },
      ],
    },
  },

  // === LOGISTICS ===
  {
    domain: 'logistics',
    label: 'Transportation & Logistics',
    artifacts: ['Vehicle', 'Driver', 'Shipment', 'WarehouseItem', 'Route', 'ComplianceLog', 'Manifest'],
    macros: { list: 'lens.logistics.list', get: 'lens.logistics.get', create: 'lens.logistics.create', update: 'lens.logistics.update', delete: 'lens.logistics.delete', run: 'lens.logistics.run', export: 'lens.logistics.export' },
    exports: ['json', 'csv', 'pdf', 'edi'],
    actions: ['optimizeRoute', 'hosCheck', 'maintenanceDue', 'inventoryAudit', 'etaCalculate', 'loadOptimize', 'complianceReport', 'warehouseSlotting'],
    category: 'operations',
    dataTier: 'SIM_GRADE_A',
    emptyState: {
      headline: "Logistics ops.",
      caption: "Vehicles, drivers, shipments, routes, compliance \u2014 optimize, audit, ETA, slot warehouse.",
      firstActionLabel: "Set up your fleet",
    },
    firstRunGuide: {
      steps: [
        { caption: "optimizeRoute solves against current traffic + HOS constraints." },
        { caption: "hosCheck enforces driver hours-of-service per regulation." },
        { caption: "warehouseSlotting + loadOptimize tighten throughput." },
      ],
    },
  },

  // === EDUCATION ===
  {
    domain: 'education',
    label: 'Education',
    artifacts: ['Student', 'Course', 'Assignment', 'Grade', 'LessonPlan', 'Certification', 'Rubric'],
    macros: { list: 'lens.education.list', get: 'lens.education.get', create: 'lens.education.create', update: 'lens.education.update', delete: 'lens.education.delete', run: 'lens.education.run', export: 'lens.education.export' },
    exports: ['json', 'csv', 'pdf', 'lti'],
    actions: ['gradeCalculation', 'attendanceReport', 'progressTrack', 'scheduleConflict', 'rubricGenerate', 'differentiate', 'parentReport', 'certificationCheck'],
    category: 'services',
    dataTier: 'REAL_FREE',
    emptyState: {
      headline: 'No courses yet.',
      caption: 'Create a course, add students, author lesson plans + rubrics. Khan Academy + Wikipedia power the resource browser.',
      firstActionLabel: 'Create a course',
    },
    firstRunGuide: {
      steps: [
        { caption: 'Courses hold students, assignments, grades. rubricGenerate produces criterion grids from a learning objective.' },
        { caption: 'differentiate adapts an assignment to multiple difficulty tiers for mixed-level classrooms.' },
        { caption: 'parentReport rolls up a student\'s arc into a one-page sharable PDF — useful for conferences.' },
      ],
    },
  },

  // === LEGAL ===
  {
    domain: 'legal',
    label: 'Legal',
    artifacts: ['Case', 'Contract', 'ComplianceItem', 'Filing', 'IPAsset', 'BriefBundle'],
    macros: { list: 'lens.legal.list', get: 'lens.legal.get', create: 'lens.legal.create', update: 'lens.legal.update', delete: 'lens.legal.delete', run: 'lens.legal.run', export: 'lens.legal.export' },
    exports: ['json', 'csv', 'pdf', 'docx'],
    actions: ['deadlineCheck', 'contractRenewal', 'conflictCheck', 'complianceScore', 'clauseChecker', 'citationPackager', 'caseTimelineBuilder', 'briefExport'],
    category: 'services',
    dataTier: 'DEMO',
    emptyState: {
      headline: 'No matters opened.',
      caption: 'Open a case / contract / compliance item. Note: full Westlaw / LexisNexis data is paywalled — this lens runs against authored content.',
      firstActionLabel: 'Open a matter',
    },
    firstRunGuide: {
      steps: [
        { caption: 'A document surface — the DocsShell opens by default. Bespoke legal workflow lives below.' },
        { caption: 'deadlineCheck + conflictCheck + complianceScore run scheduled passes against your active matters.' },
        { caption: 'Honest tier: this lens is DEMO until we wire a paid case-law feed. The structure works; the data is yours to author.' },
      ],
    },
  },

  // === NONPROFIT ===
  {
    domain: 'nonprofit',
    label: 'Nonprofit & Community',
    artifacts: ['Donor', 'Grant', 'Volunteer', 'Campaign', 'ImpactMetric', 'Member', 'FundraisingEvent'],
    macros: { list: 'lens.nonprofit.list', get: 'lens.nonprofit.get', create: 'lens.nonprofit.create', update: 'lens.nonprofit.update', delete: 'lens.nonprofit.delete', run: 'lens.nonprofit.run', export: 'lens.nonprofit.export' },
    exports: ['json', 'csv', 'pdf', 'xlsx'],
    actions: ['donorRetention', 'grantReporting', 'volunteerMatch', 'campaignProgress', 'impactReport', 'taxReceipt', 'eventROI', 'memberEngagement'],
    category: 'social',
    dataTier: 'REAL_FREE',
    emptyState: {
      headline: "Run your nonprofit.",
      caption: "Donors, grants, volunteers, campaigns, impact \u2014 retain, report, match, measure.",
      firstActionLabel: "Add your first donor",
    },
    firstRunGuide: {
      steps: [
        { caption: "donorRetention surfaces who's slipping and who's growing." },
        { caption: "grantReporting auto-composes the funder-style update." },
        { caption: "impactReport ties every dollar to measurable outcomes." },
      ],
    },
  },

  // === REALESTATE ===
  {
    domain: 'realestate',
    label: 'Real Estate',
    artifacts: ['Listing', 'Showing', 'Transaction', 'RentalUnit', 'Deal', 'Appraisal'],
    macros: { list: 'lens.realestate.list', get: 'lens.realestate.get', create: 'lens.realestate.create', update: 'lens.realestate.update', delete: 'lens.realestate.delete', run: 'lens.realestate.run', export: 'lens.realestate.export' },
    exports: ['json', 'csv', 'pdf', 'xlsx'],
    actions: ['capRate', 'cashFlow', 'closingTimeline', 'vacancyRate', 'comparableAnalysis', 'mortgageCalc', 'inspectionChecklist', 'netOperatingIncome'],
    category: 'finance',
    dataTier: 'DEMO',
    emptyState: {
      headline: "Real estate workflow.",
      caption: "Listings, showings, transactions, rentals, deals \u2014 cap rate, NOI, comparables.",
      firstActionLabel: "Add your first listing",
    },
    firstRunGuide: {
      steps: [
        { caption: "capRate + cashFlow + netOperatingIncome compute against deal inputs." },
        { caption: "comparableAnalysis pulls comps from the substrate." },
        { caption: "closingTimeline + inspectionChecklist drive the deal home." },
      ],
    },
  },

  // === FITNESS ===
  {
    domain: 'fitness',
    label: 'Fitness & Wellness',
    artifacts: ['Client', 'Program', 'Workout', 'Class', 'Team', 'Athlete', 'Assessment'],
    macros: { list: 'lens.fitness.list', get: 'lens.fitness.get', create: 'lens.fitness.create', update: 'lens.fitness.update', delete: 'lens.fitness.delete', run: 'lens.fitness.run', export: 'lens.fitness.export' },
    exports: ['json', 'csv', 'pdf', 'xlsx'],
    actions: ['progressionCalc', 'classUtilization', 'periodization', 'recruitProfile', 'bodyCompAnalysis', 'programGenerate', 'injuryRiskScreen', 'nutritionPlan'],
    category: 'services',
    dataTier: 'REAL_FREE',
    emptyState: {
      headline: 'No clients or programs yet.',
      caption: 'Build a program, track workouts, score assessments. USDA macros + ACSM-style formulas wire up real numbers.',
      firstActionLabel: 'Add a client',
    },
    firstRunGuide: {
      steps: [
        { caption: 'Programs hold workouts; periodization runs the macrocycle planner against the client\'s training age.' },
        { caption: 'injuryRiskScreen scores common red flags from intake; nutritionPlan uses USDA FoodData Central for real macros.' },
        { caption: 'Class utilization rolls up across cohorts — useful for studios + teams managing many athletes.' },
      ],
    },
  },

  // === CREATIVE PRODUCTION ===
  {
    domain: 'creative',
    label: 'Creative Production',
    artifacts: ['Project', 'Shoot', 'Asset', 'Episode', 'Collection', 'ClientProof', 'DeliverablePackage'],
    macros: { list: 'lens.creative.list', get: 'lens.creative.get', create: 'lens.creative.create', update: 'lens.creative.update', delete: 'lens.creative.delete', run: 'lens.creative.run', export: 'lens.creative.export' },
    exports: ['json', 'csv', 'pdf', 'zip'],
    actions: ['shotListGenerate', 'assetOrganize', 'budgetTrack', 'distributionChecklist', 'proofGenerate', 'metadataEmbed', 'deliverablePackage', 'clientReviewFlow'],
    category: 'creative',
    dataTier: 'SIM_GRADE_A',
    emptyState: {
      headline: "Run a creative production.",
      caption: "Projects, shoots, assets, episodes, collections, deliverables.",
      firstActionLabel: "Start a project",
    },
    firstRunGuide: {
      steps: [
        { caption: "shotListGenerate composes against the script + locations." },
        { caption: "metadataEmbed bakes provenance into every export." },
        { caption: "deliverablePackage zips the right files in the right format per client." },
      ],
    },
  },

  // === MANUFACTURING ===
  {
    domain: 'manufacturing',
    label: 'Manufacturing',
    artifacts: ['WorkOrder', 'BOM', 'QCInspection', 'Machine', 'SafetyItem', 'Part', 'ProductionRun'],
    macros: { list: 'lens.manufacturing.list', get: 'lens.manufacturing.get', create: 'lens.manufacturing.create', update: 'lens.manufacturing.update', delete: 'lens.manufacturing.delete', run: 'lens.manufacturing.run', export: 'lens.manufacturing.export' },
    exports: ['json', 'csv', 'pdf', 'xlsx'],
    actions: ['scheduleOptimize', 'bomCost', 'oeeCalculate', 'safetyRate', 'defectTrend', 'maintenancePredict', 'batchTrace', 'capacityPlan'],
    category: 'operations',
    dataTier: 'SIM_GRADE_A',
    emptyState: {
      headline: "Manufacturing ops.",
      caption: "Work orders, BOM, QC, machines, safety \u2014 schedule, cost, OEE, defect trend.",
      firstActionLabel: "Open the shop floor",
    },
    firstRunGuide: {
      steps: [
        { caption: "oeeCalculate runs the standard availability \u00d7 performance \u00d7 quality formula." },
        { caption: "bomCost rolls up against current material prices." },
        { caption: "maintenancePredict surfaces machines drifting toward failure." },
      ],
    },
  },

  // === ENVIRONMENT ===
  {
    domain: 'environment',
    label: 'Environmental & Outdoors',
    artifacts: ['Site', 'Species', 'Survey', 'TrailAsset', 'EnvironmentalSample', 'WasteStream', 'ComplianceRecord'],
    macros: { list: 'lens.environment.list', get: 'lens.environment.get', create: 'lens.environment.create', update: 'lens.environment.update', delete: 'lens.environment.delete', run: 'lens.environment.run', export: 'lens.environment.export' },
    exports: ['json', 'csv', 'pdf', 'geojson', 'kml'],
    actions: ['populationTrend', 'complianceCheck', 'trailCondition', 'diversionRate', 'sampleChainOfCustody', 'emissionsCalc', 'habitatAssess', 'impactForecast'],
    category: 'government',
    dataTier: 'REAL_FREE',
    emptyState: {
      headline: "Environmental monitoring.",
      caption: "Sites, species, surveys, samples \u2014 population trends, compliance, habitat assessment.",
      firstActionLabel: "Add a survey",
    },
    firstRunGuide: {
      steps: [
        { caption: "complianceCheck runs against regulatory rule tables." },
        { caption: "sampleChainOfCustody enforces the audit trail for lab samples." },
        { caption: "habitatAssess composes the standard rapid-assessment template." },
      ],
    },
  },

  // === GOVERNMENT ===
  {
    domain: 'government',
    label: 'Government & Public Service',
    artifacts: ['Permit', 'Project', 'Violation', 'EmergencyPlan', 'Record', 'CourtCase', 'Ordinance'],
    macros: { list: 'lens.government.list', get: 'lens.government.get', create: 'lens.government.create', update: 'lens.government.update', delete: 'lens.government.delete', run: 'lens.government.run', export: 'lens.government.export' },
    exports: ['json', 'csv', 'pdf', 'xml'],
    actions: ['permitTimeline', 'violationEscalation', 'resourceStaging', 'retentionCheck', 'budgetImpact', 'publicNoticeGenerate', 'ordinancePackage', 'foiaProcess'],
    category: 'government',
    dataTier: 'REAL_FREE',
    emptyState: {
      headline: "Government services.",
      caption: "Permits, projects, violations, court cases, ordinances \u2014 process, escalate, generate notices.",
      firstActionLabel: "Open the dashboard",
    },
    firstRunGuide: {
      steps: [
        { caption: "permitTimeline + foiaProcess drive the standard workflows." },
        { caption: "publicNoticeGenerate composes posting-ready notices." },
        { caption: "ordinancePackage bundles the full ordinance with impact statement." },
      ],
    },
  },

  // === AVIATION ===
  {
    domain: 'aviation',
    label: 'Aviation & Maritime',
    artifacts: ['Flight', 'Aircraft', 'Vessel', 'Slip', 'Charter', 'CrewMember', 'LogbookEntry'],
    macros: { list: 'lens.aviation.list', get: 'lens.aviation.get', create: 'lens.aviation.create', update: 'lens.aviation.update', delete: 'lens.aviation.delete', run: 'lens.aviation.run', export: 'lens.aviation.export' },
    exports: ['json', 'csv', 'pdf', 'kml'],
    actions: ['currencyCheck', 'maintenanceDue', 'hobbsLog', 'slipUtilization', 'weightBalance', 'flightPlan', 'crewSchedule', 'regulatoryCompliance'],
    category: 'operations',
    dataTier: 'DEMO',
    emptyState: {
      headline: "Aviation + maritime ops.",
      caption: "Flights, aircraft, vessels, slips, charters, crew \u2014 currency, weight & balance, logbook.",
      firstActionLabel: "Open the operations board",
    },
    firstRunGuide: {
      steps: [
        { caption: "weightBalance enforces aircraft envelope." },
        { caption: "currencyCheck flags pilots / crew approaching expiry." },
        { caption: "regulatoryCompliance composes the standard audit pack." },
      ],
    },
  },

  // === EVENTS ===
  {
    domain: 'events',
    label: 'Events & Entertainment',
    artifacts: ['Event', 'Venue', 'Performer', 'Tour', 'Production', 'Vendor', 'SettlementRecord'],
    macros: { list: 'lens.events.list', get: 'lens.events.get', create: 'lens.events.create', update: 'lens.events.update', delete: 'lens.events.delete', run: 'lens.events.run', export: 'lens.events.export' },
    exports: ['json', 'csv', 'pdf', 'ics'],
    actions: ['budgetReconcile', 'advanceSheet', 'techRiderMatch', 'settlementCalc', 'ticketForecast', 'vendorCompare', 'runOfShow', 'postEventReport'],
    category: 'creative',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Produce events.",
      caption: "Events, venues, performers, tours, vendors \u2014 advance, settle, forecast, report.",
      firstActionLabel: "Create your first event",
    },
    firstRunGuide: {
      steps: [
        { caption: "advanceSheet + techRiderMatch get every detail right before doors." },
        { caption: "settlementCalc closes the show with everyone paid right." },
        { caption: "postEventReport assembles ticketing + bar + payroll in one DTU." },
      ],
    },
  },

  // === SCIENCE ===
  {
    domain: 'science',
    label: 'Science & Field Work',
    artifacts: ['Expedition', 'Observation', 'Sample', 'LabProtocol', 'Analysis', 'Equipment', 'Dataset'],
    macros: { list: 'lens.science.list', get: 'lens.science.get', create: 'lens.science.create', update: 'lens.science.update', delete: 'lens.science.delete', run: 'lens.science.run', export: 'lens.science.export' },
    exports: ['json', 'csv', 'pdf', 'geojson', 'netcdf'],
    actions: ['chainOfCustody', 'calibrationCheck', 'dataExport', 'spatialCluster', 'statisticalTest', 'peerReviewPackage', 'replicationCheck', 'dataQuality'],
    category: 'knowledge',
    dataTier: 'SIM_GRADE_A',
    emptyState: {
      headline: 'No expeditions logged.',
      caption: 'Log expeditions with samples + protocols + equipment. Chain-of-custody + replication checks pin scientific integrity.',
      firstActionLabel: 'Log an expedition',
    },
    firstRunGuide: {
      steps: [
        { caption: 'Expeditions hold samples + lab protocols + equipment. Each sample carries a chain-of-custody trail.' },
        { caption: 'spatialCluster runs DBSCAN over geo-tagged samples; statisticalTest applies t-test / chi-square / ANOVA.' },
        { caption: 'peerReviewPackage exports your expedition as a reviewer-ready bundle (data + protocols + analysis).' },
      ],
    },
  },

  // === SECURITY ===
  {
    domain: 'security',
    label: 'Security',
    artifacts: ['Post', 'Incident', 'Patrol', 'Threat', 'Investigation', 'Asset', 'ComplianceReport'],
    macros: { list: 'lens.security.list', get: 'lens.security.get', create: 'lens.security.create', update: 'lens.security.update', delete: 'lens.security.delete', run: 'lens.security.run', export: 'lens.security.export' },
    exports: ['json', 'csv', 'pdf', 'stix'],
    actions: ['incidentTrend', 'patrolCoverage', 'threatMatrix', 'evidenceChain', 'complianceCheck', 'hardeningChecklist', 'incidentReport', 'vulnerabilityScan'],
    category: 'operations',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Security ops.",
      caption: "Posts, incidents, patrols, threats, investigations \u2014 trend, cover, score, harden.",
      firstActionLabel: "Add a post",
    },
    firstRunGuide: {
      steps: [
        { caption: "patrolCoverage shows real coverage gaps live." },
        { caption: "threatMatrix scores each threat against your posture." },
        { caption: "vulnerabilityScan + hardeningChecklist drive the remediation loop." },
      ],
    },
  },

  // === SERVICES ===
  {
    domain: 'services',
    label: 'Personal Services',
    artifacts: ['Client', 'Appointment', 'ServiceType', 'Provider', 'ChildProfile', 'PortfolioItem', 'Subscription'],
    macros: { list: 'lens.services.list', get: 'lens.services.get', create: 'lens.services.create', update: 'lens.services.update', delete: 'lens.services.delete', run: 'lens.services.run', export: 'lens.services.export' },
    exports: ['json', 'csv', 'pdf', 'ics'],
    actions: ['scheduleOptimize', 'reminderGenerate', 'revenueByProvider', 'supplyCheck', 'clientRetention', 'waitlistManage', 'bookingConfirm', 'feedbackCollect'],
    category: 'services',
    dataTier: 'SIM_GRADE_A',
    emptyState: {
      headline: "Personal services.",
      caption: "Clients, appointments, providers \u2014 schedule, remind, retain, manage.",
      firstActionLabel: "Add a client",
    },
    firstRunGuide: {
      steps: [
        { caption: "scheduleOptimize fits more bookings against provider availability." },
        { caption: "reminderGenerate texts / emails on your preferred cadence." },
        { caption: "feedbackCollect closes the loop after every appointment." },
      ],
    },
  },

  // === INSURANCE ===
  {
    domain: 'insurance',
    label: 'Insurance & Risk',
    artifacts: ['Policy', 'Claim', 'Risk', 'Benefit', 'Renewal', 'Assessment'],
    macros: { list: 'lens.insurance.list', get: 'lens.insurance.get', create: 'lens.insurance.create', update: 'lens.insurance.update', delete: 'lens.insurance.delete', run: 'lens.insurance.run', export: 'lens.insurance.export' },
    exports: ['json', 'csv', 'pdf', 'acord'],
    actions: ['coverageGap', 'premiumHistory', 'claimStatus', 'riskScore', 'renewalForecast', 'benefitComparison', 'fraudIndicator', 'lossRunReport'],
    category: 'finance',
    dataTier: 'DEMO',
    emptyState: {
      headline: "Insurance + risk.",
      caption: "Policies, claims, benefits, renewals \u2014 DEMO data; wire your own carrier feeds.",
      firstActionLabel: "Open the policy book",
    },
    firstRunGuide: {
      steps: [
        { caption: "coverageGap finds policies that don't fully cover the underlying risk." },
        { caption: "renewalForecast surfaces renewals coming due with risk-scored estimates." },
        { caption: "lossRunReport composes the carrier-ready document." },
      ],
    },
  },

  // === TRAVEL (Lens 61) ===
  {
    domain: 'travel',
    label: 'Travel',
    artifacts: ['trip', 'itinerary', 'booking', 'packing_list'],
    macros: { list: 'lens.travel.list', get: 'lens.travel.get', create: 'lens.travel.create', update: 'lens.travel.update', delete: 'lens.travel.delete', run: 'lens.travel.run', export: 'lens.travel.export' },
    exports: ['json', 'csv', 'pdf', 'ical'],
    actions: ['planItinerary', 'budgetEstimate', 'packingChecklist', 'flightSearch', 'hotelCompare', 'travelAdvisory'],
    category: 'lifestyle',
    dataTier: 'REAL_FREE',
    emptyState: {
      headline: 'No trips planned.',
      caption: 'Draft an itinerary; the planner uses OpenStreetMap + Wikipedia for real geo + lore. Pack lists generate from trip context.',
      firstActionLabel: 'Plan a trip',
    },
    firstRunGuide: {
      steps: [
        { caption: 'planItinerary takes destination + dates + interests, produces a multi-day plan with real POIs.' },
        { caption: 'travelAdvisory pulls relevant safety + visa notes; budgetEstimate uses regional cost benchmarks.' },
        { caption: 'Itineraries export as iCal so they slot into any external calendar.' },
      ],
    },
  },

  // === FASHION (Lens 62) ===
  {
    domain: 'fashion',
    label: 'Fashion',
    artifacts: ['garment', 'outfit', 'wardrobe', 'wishlist'],
    macros: { list: 'lens.fashion.list', get: 'lens.fashion.get', create: 'lens.fashion.create', update: 'lens.fashion.update', delete: 'lens.fashion.delete', run: 'lens.fashion.run', export: 'lens.fashion.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['outfitSuggest', 'seasonalRotation', 'donateList', 'styleAnalysis', 'wardrobeValue', 'colorPalette'],
    category: 'lifestyle',
    dataTier: 'REAL_FREE',
    emptyState: {
      headline: "Manage your wardrobe.",
      caption: "Garments, outfits, wardrobe, wishlist \u2014 suggest, rotate, donate, palette.",
      firstActionLabel: "Add your first garment",
    },
    firstRunGuide: {
      steps: [
        { caption: "outfitSuggest composes against weather + your style profile." },
        { caption: "seasonalRotation surfaces what to swap in / out per season." },
        { caption: "colorPalette analyzes your wardrobe for tonal balance." },
      ],
    },
  },

  // === COOKING (Lens 63) ===
  {
    domain: 'cooking',
    label: 'Cooking',
    artifacts: ['recipe', 'mealplan', 'ingredient', 'technique'],
    macros: { list: 'lens.cooking.list', get: 'lens.cooking.get', create: 'lens.cooking.create', update: 'lens.cooking.update', delete: 'lens.cooking.delete', run: 'lens.cooking.run', export: 'lens.cooking.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['scaleRecipe', 'mealPlan', 'shoppingList', 'nutritionCalc', 'substitutions', 'pairings'],
    category: 'lifestyle',
    dataTier: 'REAL_FREE',
    emptyState: {
      headline: 'No recipes saved.',
      caption: 'Author or import a recipe; scale, plan meals, generate shopping lists. Nutrition pulls from USDA FoodData (real numbers).',
      firstActionLabel: 'Add a recipe',
    },
    firstRunGuide: {
      steps: [
        { caption: 'Recipes carry ingredients + techniques; scaleRecipe converts servings while preserving ratios.' },
        { caption: 'nutritionCalc looks up each ingredient in USDA FoodData Central — real macros, not estimates.' },
        { caption: 'mealPlan + shoppingList build week-ahead plans; substitutions and pairings expand by technique signature.' },
      ],
    },
  },

  // === HOME IMPROVEMENT (Lens 64) ===
  {
    domain: 'home-improvement',
    label: 'Home Improvement',
    artifacts: ['project', 'material', 'contractor', 'inspection'],
    macros: { list: 'lens.home-improvement.list', get: 'lens.home-improvement.get', create: 'lens.home-improvement.create', update: 'lens.home-improvement.update', delete: 'lens.home-improvement.delete', run: 'lens.home-improvement.run', export: 'lens.home-improvement.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['costEstimate', 'permitCheck', 'contractorCompare', 'timeline', 'materialsCalc', 'beforeAfter'],
    category: 'lifestyle',
    dataTier: 'SIM_GRADE_A',
    emptyState: {
      headline: "Plan your project.",
      caption: "Projects, materials, contractors, inspections \u2014 cost, permit, timeline.",
      firstActionLabel: "Start a project",
    },
    firstRunGuide: {
      steps: [
        { caption: "costEstimate + materialsCalc give you a real number before you commit." },
        { caption: "permitCheck looks up local requirements." },
        { caption: "beforeAfter pairs photos + DTUs to document the change." },
      ],
    },
  },

  // === PARENTING (Lens 65) ===
  {
    domain: 'parenting',
    label: 'Parenting',
    artifacts: ['milestone', 'schedule', 'health_record', 'activity'],
    macros: { list: 'lens.parenting.list', get: 'lens.parenting.get', create: 'lens.parenting.create', update: 'lens.parenting.update', delete: 'lens.parenting.delete', run: 'lens.parenting.run', export: 'lens.parenting.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['milestoneTracker', 'growthChart', 'vaccineSchedule', 'sleepAnalysis', 'developmentTips', 'schoolReadiness'],
    category: 'lifestyle',
    dataTier: 'REAL_FREE',
    emptyState: {
      headline: 'No child profiles yet.',
      caption: 'Add a child profile; track milestones, schedule, vaccines, sleep. AAP guidelines power the milestone + vaccine timelines.',
      firstActionLabel: 'Add a child',
    },
    firstRunGuide: {
      steps: [
        { caption: 'Per-child profile tracks milestones (motor / cognitive / social) against AAP age-typical ranges.' },
        { caption: 'vaccineSchedule pulls the current CDC recommended schedule; growthChart plots against WHO percentile curves.' },
        { caption: 'sleepAnalysis surfaces nightly pattern + identifies regressions; developmentTips suggests stage-appropriate activities.' },
      ],
    },
  },

  // === PETS (Lens 66) ===
  {
    domain: 'pets',
    label: 'Pets',
    artifacts: ['pet', 'vet_record', 'feeding_schedule', 'medication'],
    macros: { list: 'lens.pets.list', get: 'lens.pets.get', create: 'lens.pets.create', update: 'lens.pets.update', delete: 'lens.pets.delete', run: 'lens.pets.run', export: 'lens.pets.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['vetReminder', 'feedingPlan', 'medicationTracker', 'weightTrend', 'groomingSchedule', 'emergencyInfo'],
    category: 'lifestyle',
    dataTier: 'REAL_FREE',
    emptyState: {
      headline: "Take care of your pets.",
      caption: "Pets, vet records, feeding, medications \u2014 remind, plan, trend.",
      firstActionLabel: "Add your first pet",
    },
    firstRunGuide: {
      steps: [
        { caption: "vetReminder + medicationTracker keep care on schedule." },
        { caption: "feedingPlan composes against age / weight / breed." },
        { caption: "weightTrend renders the long arc of your pet's health." },
      ],
    },
  },

  // === SPORTS (Lens 67) ===
  {
    domain: 'sports',
    label: 'Sports',
    artifacts: ['game', 'team', 'player', 'training_session'],
    macros: { list: 'lens.sports.list', get: 'lens.sports.get', create: 'lens.sports.create', update: 'lens.sports.update', delete: 'lens.sports.delete', run: 'lens.sports.run', export: 'lens.sports.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['seasonStats', 'playerCompare', 'trainingPlan', 'matchPreview', 'standingsCalc', 'injuryTracker'],
    category: 'lifestyle',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Track the season.",
      caption: "Games, teams, players, training \u2014 stats, compare, plan, preview.",
      firstActionLabel: "Pick your team",
    },
    firstRunGuide: {
      steps: [
        { caption: "seasonStats pulls live from REAL_LIVE sports feeds." },
        { caption: "playerCompare diffs two players across the stats you care about." },
        { caption: "matchPreview composes against the standings + recent form." },
      ],
    },
  },

  // === DIY (Lens 68) ===
  {
    domain: 'diy',
    label: 'DIY',
    artifacts: ['project', 'material', 'tool', 'technique'],
    macros: { list: 'lens.diy.list', get: 'lens.diy.get', create: 'lens.diy.create', update: 'lens.diy.update', delete: 'lens.diy.delete', run: 'lens.diy.run', export: 'lens.diy.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['materialsList', 'costEstimate', 'stepByStep', 'toolSuggestion', 'difficultyAssess', 'timeEstimate'],
    category: 'lifestyle',
    dataTier: 'SIM_GRADE_A',
    emptyState: {
      headline: "Plan a build.",
      caption: "Projects, materials, tools, techniques \u2014 assess difficulty, estimate time, step-by-step.",
      firstActionLabel: "Start a project",
    },
    firstRunGuide: {
      steps: [
        { caption: "stepByStep walks the project from cut list to finish." },
        { caption: "toolSuggestion checks what you have vs. what the project needs." },
        { caption: "difficultyAssess flags steps that are above your skill or unsafe." },
      ],
    },
  },

  // === DEBATE (Lens 76) ===
  {
    domain: 'debate',
    label: 'Debate',
    artifacts: ['debate', 'argument', 'rebuttal', 'verdict'],
    macros: { list: 'lens.debate.list', get: 'lens.debate.get', create: 'lens.debate.create', update: 'lens.debate.update', delete: 'lens.debate.delete', run: 'lens.debate.run', export: 'lens.debate.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['factCheck', 'counterArgument', 'logicAnalysis', 'biasDetect', 'summarize', 'moderateDebate'],
    category: 'social',
    dataTier: 'SIM_GRADE_A',
    emptyState: {
      headline: "Sharpen an argument.",
      caption: "Debates, arguments, rebuttals, verdicts \u2014 fact-check, counter, detect bias.",
      firstActionLabel: "Start a debate",
    },
    firstRunGuide: {
      steps: [
        { caption: "factCheck runs claims against the substrate." },
        { caption: "counterArgument composes the strongest opposition position." },
        { caption: "moderateDebate runs the round-robin against a chosen framework." },
      ],
    },
  },

  // === MENTORSHIP (Lens 77) ===
  {
    domain: 'mentorship',
    label: 'Mentorship',
    artifacts: ['relation', 'session_note', 'goal', 'feedback'],
    macros: { list: 'lens.mentorship.list', get: 'lens.mentorship.get', create: 'lens.mentorship.create', update: 'lens.mentorship.update', delete: 'lens.mentorship.delete', run: 'lens.mentorship.run', export: 'lens.mentorship.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['matchMentor', 'progressReport', 'goalSetting', 'sessionPrep', 'feedbackSummary', 'skillGapAnalysis'],
    category: 'social',
    dataTier: 'REAL_FREE',
    emptyState: {
      headline: "Find a mentor or mentee.",
      caption: "Relations, session notes, goals, feedback \u2014 match, prep, report.",
      firstActionLabel: "Open the directory",
    },
    firstRunGuide: {
      steps: [
        { caption: "matchMentor uses the substrate's skill graph to suggest pairings." },
        { caption: "sessionPrep composes a brief from the mentor's recent activity." },
        { caption: "skillGapAnalysis maps what to learn against your trajectory." },
      ],
    },
  },
  {
    domain: 'podcast',
    label: 'Podcast',
    artifacts: ['episode', 'subscriber', 'analytics', 'feed'],
    macros: { list: 'lens.podcast.list', get: 'lens.podcast.get', create: 'lens.podcast.create', update: 'lens.podcast.update', delete: 'lens.podcast.delete', run: 'lens.podcast.run', export: 'lens.podcast.export' },
    exports: ['json', 'rss', 'mp3'],
    actions: ['publish', 'schedule', 'generateRSS', 'analyzeListeners', 'transcribe', 'distributeFeed'],
    category: 'creative',
    dataTier: 'REAL_FREE',
    emptyState: {
      headline: "Publish a podcast.",
      caption: "Episodes, subscribers, analytics, feeds \u2014 publish, schedule, transcribe, distribute.",
      firstActionLabel: "Create your first episode",
    },
    firstRunGuide: {
      steps: [
        { caption: "transcribe ships the show as searchable DTUs the same hour it lands." },
        { caption: "generateRSS + distributeFeed get you on every directory." },
        { caption: "analyzeListeners surfaces who's listening, where, for how long." },
      ],
    },
  },
  {
    domain: 'admin',
    label: 'Admin',
    artifacts: ['user', 'role', 'setting', 'log', 'policy'],
    macros: { list: 'lens.admin.list', get: 'lens.admin.get', create: 'lens.admin.create', update: 'lens.admin.update', delete: 'lens.admin.delete', run: 'lens.admin.run', export: 'lens.admin.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'system',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Admin console.",
      caption: "Users, roles, settings, logs, policies \u2014 read, validate, export, audit.",
      firstActionLabel: "Open the console",
    },
    firstRunGuide: {
      steps: [
        { caption: "analyze surfaces drift in roles vs. policy." },
        { caption: "validate runs the live policy check against actual access patterns." },
        { caption: "export composes a compliance-ready audit pack." },
      ],
    },
  },
  {
    domain: 'affect',
    label: 'Affect',
    artifacts: ['emotion', 'sentiment', 'mood', 'trigger', 'pattern'],
    macros: { list: 'lens.affect.list', get: 'lens.affect.get', create: 'lens.affect.create', update: 'lens.affect.update', delete: 'lens.affect.delete', run: 'lens.affect.run', export: 'lens.affect.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'knowledge',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Track affect over time.",
      caption: "Emotions, sentiment, mood, triggers \u2014 the substrate detects patterns across your DTUs.",
      firstActionLabel: "Capture your current state",
    },
    firstRunGuide: {
      steps: [
        { caption: "analyze surfaces shifts the daily lens hasn't surfaced yet." },
        { caption: "generate composes a check-in prompt tailored to the pattern." },
        { caption: "summarize rolls up your week into a single DTU." },
      ],
    },
  },
  {
    domain: 'all',
    label: 'All Lenses',
    artifacts: ['lens', 'category', 'overview', 'summary'],
    macros: { list: 'lens.all.list', get: 'lens.all.get', create: 'lens.all.create', update: 'lens.all.update', delete: 'lens.all.delete', run: 'lens.all.run', export: 'lens.all.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'system',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Every lens at a glance.",
      caption: "All 232 lenses; analyze, summarize, export the whole surface.",
      firstActionLabel: "Browse all lenses",
    },
    firstRunGuide: {
      steps: [
        { caption: "Type to filter by domain, category, or feature." },
        { caption: "analyze surfaces which lenses you actually use vs. which sit cold." },
        { caption: "summarize exports a per-lens scorecard." },
      ],
    },
  },
  {
    domain: 'analytics',
    label: 'Analytics',
    artifacts: ['dashboard', 'metric', 'report', 'funnel', 'cohort'],
    macros: { list: 'lens.analytics.list', get: 'lens.analytics.get', create: 'lens.analytics.create', update: 'lens.analytics.update', delete: 'lens.analytics.delete', run: 'lens.analytics.run', export: 'lens.analytics.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'productivity',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Build a dashboard.",
      caption: "Dashboards, metrics, reports, funnels, cohorts \u2014 generate, validate, export.",
      firstActionLabel: "Create your first dashboard",
    },
    firstRunGuide: {
      steps: [
        { caption: "Pick metrics from any DTU stream \u2014 the substrate is the source." },
        { caption: "Cohort + funnel surfaces are first-class." },
        { caption: "Export as PDF for stakeholders or JSON for re-import." },
      ],
    },
  },
  {
    domain: 'animation',
    label: 'Animation',
    artifacts: ['keyframe', 'timeline', 'sprite', 'sequence', 'rig'],
    macros: { list: 'lens.animation.list', get: 'lens.animation.get', create: 'lens.animation.create', update: 'lens.animation.update', delete: 'lens.animation.delete', run: 'lens.animation.run', export: 'lens.animation.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'creative',
    dataTier: 'SIM_GRADE_A',
    emptyState: {
      headline: "Animate.",
      caption: "Keyframes, timelines, sprites, sequences, rigs \u2014 SIM_GRADE_A engine renders against the lens schema.",
      firstActionLabel: "Start a sequence",
    },
    firstRunGuide: {
      steps: [
        { caption: "Drop sprites onto the timeline; the rig adapts." },
        { caption: "Preview at every keyframe; generate composes inbetweens." },
        { caption: "Export as MP4 / GIF / sprite-sheet." },
      ],
    },
  },
  {
    domain: 'answers',
    label: 'The Answers',
    artifacts: ['answer', 'problem', 'equation', 'implementation', 'section'],
    macros: { list: 'lens.answers.list', get: 'lens.answers.get', create: 'lens.answers.create', update: 'lens.answers.update', delete: 'lens.answers.delete', run: 'lens.answers.run', export: 'lens.answers.export' },
    exports: ['json', 'md', 'pdf'],
    actions: ['browse', 'ask_oracle', 'expand', 'link_implementation', 'export'],
    category: 'knowledge',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "The Answers.",
      caption: "Browse curated answers; ask the oracle; expand sections; link implementations.",
      firstActionLabel: "Browse the answers",
    },
    firstRunGuide: {
      steps: [
        { caption: "ask_oracle composes a fresh answer against the substrate." },
        { caption: "expand opens the deep dive on any section." },
        { caption: "link_implementation jumps to the code that implements the claim." },
      ],
    },
  },
  {
    domain: 'app-maker',
    label: 'App Maker',
    artifacts: ['app', 'screen', 'widget', 'flow', 'deploy'],
    macros: { list: 'lens.app-maker.list', get: 'lens.app-maker.get', create: 'lens.app-maker.create', update: 'lens.app-maker.update', delete: 'lens.app-maker.delete', run: 'lens.app-maker.run', export: 'lens.app-maker.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'creative',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Build an app.",
      caption: "Apps, screens, widgets, flows \u2014 generate, validate, deploy.",
      firstActionLabel: "Start a new app",
    },
    firstRunGuide: {
      steps: [
        { caption: "Compose screens + widgets visually; the lens emits real DTUs." },
        { caption: "validate runs the contract checks before deploy." },
        { caption: "deploy ships to the platform or exports as a packaged DTU." },
      ],
    },
  },
  {
    domain: 'artistry',
    label: 'Artistry',
    artifacts: ['artwork', 'gallery', 'exhibit', 'collection', 'medium'],
    macros: { list: 'lens.artistry.list', get: 'lens.artistry.get', create: 'lens.artistry.create', update: 'lens.artistry.update', delete: 'lens.artistry.delete', run: 'lens.artistry.run', export: 'lens.artistry.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'creative',
    dataTier: 'SIM_GRADE_A',
    emptyState: {
      headline: "Curate your art.",
      caption: "Artworks, galleries, exhibits, collections \u2014 analyze, generate, validate.",
      firstActionLabel: "Add your first piece",
    },
    firstRunGuide: {
      steps: [
        { caption: "Group pieces into collections + exhibits." },
        { caption: "generate composes an artist statement against the corpus." },
        { caption: "Export a gallery DTU you can publish anywhere." },
      ],
    },
  },
  {
    domain: 'astronomy',
    label: 'Astronomy',
    artifacts: ['star', 'planet', 'constellation', 'observation', 'catalog'],
    macros: { list: 'lens.astronomy.list', get: 'lens.astronomy.get', create: 'lens.astronomy.create', update: 'lens.astronomy.update', delete: 'lens.astronomy.delete', run: 'lens.astronomy.run', export: 'lens.astronomy.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'knowledge',
    dataTier: 'REAL_FREE',
    emptyState: {
      headline: 'Observation log empty.',
      caption: 'Save targets, plan observations, run light-travel calcs. NASA APOD + ISS + Near-Earth Objects load live up top.',
      firstActionLabel: 'Save an observation',
    },
    firstRunGuide: {
      steps: [
        { caption: 'NASA panel up top shows today\'s APOD + ISS live position + Near-Earth Objects — all real data, no synthetic.', selector: '[aria-label*="NASA"]' },
        { caption: 'Use the action panel to compute celestial position (RA/Dec → altitude/azimuth) or plan a night\'s observation with moon-phase awareness.' },
        { caption: 'Saved observations mint as DTUs; reference them from chat or research later.' },
      ],
    },
  },
  {
    domain: 'atlas',
    label: 'Atlas',
    artifacts: ['map', 'region', 'layer', 'annotation', 'poi'],
    macros: { list: 'lens.atlas.list', get: 'lens.atlas.get', create: 'lens.atlas.create', update: 'lens.atlas.update', delete: 'lens.atlas.delete', run: 'lens.atlas.run', export: 'lens.atlas.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'knowledge',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: 'No regions explored yet.',
      caption: 'Search any place via OpenStreetMap; drop annotations; layer real signal data over the map.',
      firstActionLabel: 'Search a location',
    },
    firstRunGuide: {
      steps: [
        { caption: 'Search uses OpenStreetMap Nominatim — real geocoding, free, no key.' },
        { caption: 'Drop annotations and create regions of interest. Each becomes a DTU you can cite.' },
        { caption: 'The graph view shows DTU citation lineage — your atlas becomes a map of your knowledge.' },
      ],
    },
  },
  {
    domain: 'attention',
    label: 'Attention',
    artifacts: ['focus', 'distraction', 'session', 'metric', 'pattern'],
    macros: { list: 'lens.attention.list', get: 'lens.attention.get', create: 'lens.attention.create', update: 'lens.attention.update', delete: 'lens.attention.delete', run: 'lens.attention.run', export: 'lens.attention.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'knowledge',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "See where your attention goes.",
      caption: "Focus, distractions, sessions, metrics, patterns \u2014 the substrate tracks across all lenses.",
      firstActionLabel: "Start a focus session",
    },
    firstRunGuide: {
      steps: [
        { caption: "Sessions auto-classify against your declared intent." },
        { caption: "analyze surfaces patterns you missed." },
        { caption: "summarize rolls weeks into a single DTU." },
      ],
    },
  },
  {
    domain: 'audit',
    label: 'Audit',
    artifacts: ['finding', 'control', 'evidence', 'report', 'risk'],
    macros: { list: 'lens.audit.list', get: 'lens.audit.get', create: 'lens.audit.create', update: 'lens.audit.update', delete: 'lens.audit.delete', run: 'lens.audit.run', export: 'lens.audit.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'system',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Audit findings.",
      caption: "Findings, controls, evidence, reports, risks \u2014 analyze, generate, export.",
      firstActionLabel: "Open an audit",
    },
    firstRunGuide: {
      steps: [
        { caption: "Findings ride the same DTU substrate as paper / law / governance." },
        { caption: "validate runs the control set against live system state." },
        { caption: "Export a compliance-ready PDF." },
      ],
    },
  },
  {
    domain: 'automotive',
    label: 'Automotive',
    artifacts: ['vehicle', 'part', 'service', 'diagnostic', 'recall'],
    macros: { list: 'lens.automotive.list', get: 'lens.automotive.get', create: 'lens.automotive.create', update: 'lens.automotive.update', delete: 'lens.automotive.delete', run: 'lens.automotive.run', export: 'lens.automotive.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'trades',
    dataTier: 'DEMO',
    emptyState: {
      headline: "Automotive workflow.",
      caption: "Vehicles, parts, services, diagnostics, recalls \u2014 DEMO data; wire your VIN feed when ready.",
      firstActionLabel: "Add a vehicle",
    },
    firstRunGuide: {
      steps: [
        { caption: "Run diagnostics; recalls surface against your VIN." },
        { caption: "Service history rides the substrate." },
        { caption: "Export a service binder for sale or trade." },
      ],
    },
  },
  {
    domain: 'billing',
    label: 'Billing',
    artifacts: ['invoice', 'payment', 'subscription', 'plan', 'receipt'],
    macros: { list: 'lens.billing.list', get: 'lens.billing.get', create: 'lens.billing.create', update: 'lens.billing.update', delete: 'lens.billing.delete', run: 'lens.billing.run', export: 'lens.billing.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'finance',
    dataTier: 'SIM_GRADE_A',
    emptyState: {
      headline: "Billing workflow.",
      caption: "Invoices, payments, subscriptions, plans, receipts \u2014 analyze, generate, export.",
      firstActionLabel: "Open billing",
    },
    firstRunGuide: {
      steps: [
        { caption: "Subscriptions + plans live in one substrate." },
        { caption: "generate composes an invoice from a quote / project." },
        { caption: "Export the period's receipts as a single PDF." },
      ],
    },
  },
  {
    domain: 'bio',
    label: 'Bio',
    artifacts: ['organism', 'gene', 'protein', 'sequence', 'pathway'],
    macros: { list: 'lens.bio.list', get: 'lens.bio.get', create: 'lens.bio.create', update: 'lens.bio.update', delete: 'lens.bio.delete', run: 'lens.bio.run', export: 'lens.bio.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'knowledge',
    dataTier: 'REAL_FREE',
    emptyState: {
      headline: 'No organisms tracked.',
      caption: 'Add organisms / genes / proteins; pull arXiv q-bio papers up top. NCBI lookups are honest live data.',
      firstActionLabel: 'Add an organism',
    },
    firstRunGuide: {
      steps: [
        { caption: 'arXiv q-bio panel up top streams new biology papers — REAL data, daily.' },
        { caption: 'Organisms link to genes link to proteins via the substrate; pathway browsing follows the citation chain.' },
        { caption: 'analyze runs sequence-similarity against your tracked corpus; validate flags annotation inconsistencies.' },
      ],
    },
  },
  {
    domain: 'bridge',
    label: 'Bridge',
    artifacts: ['connector', 'mapping', 'transform', 'pipeline', 'adapter'],
    macros: { list: 'lens.bridge.list', get: 'lens.bridge.get', create: 'lens.bridge.create', update: 'lens.bridge.update', delete: 'lens.bridge.delete', run: 'lens.bridge.run', export: 'lens.bridge.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'system',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Bridge two systems.",
      caption: "Connectors, mappings, transforms, pipelines, adapters \u2014 wire any system to the substrate.",
      firstActionLabel: "Add a connector",
    },
    firstRunGuide: {
      steps: [
        { caption: "Map fields visually; the bridge emits a typed adapter." },
        { caption: "validate runs the round-trip test before you go live." },
        { caption: "Pipelines log every transform so you can audit drift." },
      ],
    },
  },
  {
    domain: 'carpentry',
    label: 'Carpentry',
    artifacts: ['joint', 'material', 'plan', 'cut', 'assembly'],
    macros: { list: 'lens.carpentry.list', get: 'lens.carpentry.get', create: 'lens.carpentry.create', update: 'lens.carpentry.update', delete: 'lens.carpentry.delete', run: 'lens.carpentry.run', export: 'lens.carpentry.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'trades',
    dataTier: 'SIM_GRADE_A',
    emptyState: {
      headline: "Carpentry projects.",
      caption: "Joints, materials, plans, cuts, assembly \u2014 calculate, validate, export.",
      firstActionLabel: "Start a project",
    },
    firstRunGuide: {
      steps: [
        { caption: "Plans + cut lists ride the substrate." },
        { caption: "analyze flags joints that are over-stressed for the material." },
        { caption: "Export a cut list ready for the lumber yard." },
      ],
    },
  },
  {
    domain: 'chem',
    label: 'Chemistry',
    artifacts: ['compound', 'reaction', 'molecule', 'element', 'formula'],
    macros: { list: 'lens.chem.list', get: 'lens.chem.get', create: 'lens.chem.create', update: 'lens.chem.update', delete: 'lens.chem.delete', run: 'lens.chem.run', export: 'lens.chem.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'knowledge',
    dataTier: 'REAL_FREE',
    emptyState: {
      headline: 'No compounds tracked.',
      caption: 'Add compounds / reactions / molecules. arXiv chemistry feed up top streams new papers.',
      firstActionLabel: 'Add a compound',
    },
    firstRunGuide: {
      steps: [
        { caption: 'arXiv physics.chem-ph feed up top — REAL daily papers in chemical physics.' },
        { caption: 'Compounds carry formula + properties; reactions reference reactants + products.' },
        { caption: 'validate flags stoichiometric inconsistencies; analyze runs simple equilibrium / kinetic estimates.' },
      ],
    },
  },
  {
    domain: 'command-center',
    label: 'Command Center',
    artifacts: ['alert', 'status', 'dashboard', 'incident', 'response'],
    macros: { list: 'lens.command-center.list', get: 'lens.command-center.get', create: 'lens.command-center.create', update: 'lens.command-center.update', delete: 'lens.command-center.delete', run: 'lens.command-center.run', export: 'lens.command-center.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'system',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Command center.",
      caption: "Alerts, statuses, dashboards, incidents, responses \u2014 analyze, generate, export.",
      firstActionLabel: "Open the panel",
    },
    firstRunGuide: {
      steps: [
        { caption: "Status rolls up from every active heartbeat." },
        { caption: "Incidents trigger response playbooks automatically." },
        { caption: "Export a post-mortem-ready timeline." },
      ],
    },
  },
  {
    domain: 'commonsense',
    label: 'Common Sense',
    artifacts: ['rule', 'heuristic', 'pattern', 'inference', 'context'],
    macros: { list: 'lens.commonsense.list', get: 'lens.commonsense.get', create: 'lens.commonsense.create', update: 'lens.commonsense.update', delete: 'lens.commonsense.delete', run: 'lens.commonsense.run', export: 'lens.commonsense.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'knowledge',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Common-sense rules.",
      caption: "Rules, heuristics, patterns, inferences, context \u2014 the substrate learns from your corrections.",
      firstActionLabel: "Add a rule",
    },
    firstRunGuide: {
      steps: [
        { caption: "Rules apply at the LLM-prompting layer to keep answers grounded." },
        { caption: "analyze surfaces conflicts between rules." },
        { caption: "Export your rule set as JSON for sharing across deployments." },
      ],
    },
  },
  {
    domain: 'construction',
    label: 'Construction',
    artifacts: ['project', 'permit', 'schedule', 'material', 'inspection'],
    macros: { list: 'lens.construction.list', get: 'lens.construction.get', create: 'lens.construction.create', update: 'lens.construction.update', delete: 'lens.construction.delete', run: 'lens.construction.run', export: 'lens.construction.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'trades',
    dataTier: 'SIM_GRADE_A',
    emptyState: {
      headline: "Construction projects.",
      caption: "Projects, permits, schedules, materials, inspections \u2014 analyze, generate, export.",
      firstActionLabel: "Start a project",
    },
    firstRunGuide: {
      steps: [
        { caption: "Schedules + materials ride the same substrate as Trades." },
        { caption: "Permits track through their state machine automatically." },
        { caption: "Inspections file as DTUs the inspector can verify." },
      ],
    },
  },
  {
    domain: 'consulting',
    label: 'Consulting',
    artifacts: ['engagement', 'deliverable', 'proposal', 'client', 'timesheet'],
    macros: { list: 'lens.consulting.list', get: 'lens.consulting.get', create: 'lens.consulting.create', update: 'lens.consulting.update', delete: 'lens.consulting.delete', run: 'lens.consulting.run', export: 'lens.consulting.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'services',
    dataTier: 'SIM_GRADE_A',
    emptyState: {
      headline: "Run a consulting practice.",
      caption: "Engagements, deliverables, proposals, clients, timesheets \u2014 generate, validate, export.",
      firstActionLabel: "Open the practice",
    },
    firstRunGuide: {
      steps: [
        { caption: "Engagements roll up timesheets + deliverables automatically." },
        { caption: "generate composes the standard proposal from a discovery transcript." },
        { caption: "Export client-ready deliverable packages." },
      ],
    },
  },
  {
    domain: 'creative-writing',
    label: 'Creative Writing',
    artifacts: ['story', 'character', 'plot', 'draft', 'revision'],
    macros: { list: 'lens.creative-writing.list', get: 'lens.creative-writing.get', create: 'lens.creative-writing.create', update: 'lens.creative-writing.update', delete: 'lens.creative-writing.delete', run: 'lens.creative-writing.run', export: 'lens.creative-writing.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'creative',
    dataTier: 'SIM_GRADE_A',
    emptyState: {
      headline: "Write a story.",
      caption: "Stories, characters, plots, drafts, revisions \u2014 generate, validate, export.",
      firstActionLabel: "Start a draft",
    },
    firstRunGuide: {
      steps: [
        { caption: "Characters + plot threads ride the substrate so revisions can audit consistency." },
        { caption: "analyze flags pacing + arc issues across the manuscript." },
        { caption: "Export as EPUB / DOCX / Markdown." },
      ],
    },
  },
  {
    domain: 'cri',
    label: 'Criminal Justice',
    artifacts: ['case', 'evidence', 'incident', 'report', 'suspect'],
    macros: { list: 'lens.cri.list', get: 'lens.cri.get', create: 'lens.cri.create', update: 'lens.cri.update', delete: 'lens.cri.delete', run: 'lens.cri.run', export: 'lens.cri.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'government',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Criminal justice workflow.",
      caption: "Cases, evidence, incidents, reports, suspects \u2014 analyze, generate, export.",
      firstActionLabel: "Open the case board",
    },
    firstRunGuide: {
      steps: [
        { caption: "Evidence chains ride the audit-trail substrate." },
        { caption: "Generate reports compose from the underlying DTUs." },
        { caption: "Export a case binder per court / agency standard." },
      ],
    },
  },
  {
    domain: 'crypto',
    label: 'Crypto',
    artifacts: ['wallet', 'token', 'transaction', 'contract', 'chain'],
    macros: { list: 'lens.crypto.list', get: 'lens.crypto.get', create: 'lens.crypto.create', update: 'lens.crypto.update', delete: 'lens.crypto.delete', run: 'lens.crypto.run', export: 'lens.crypto.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'finance',
    dataTier: 'REAL_LIVE',
    realtimeEvents: ['crypto:ticker'],
    emptyState: {
      headline: 'No tracked tokens.',
      caption: 'Add a token to track price + balance via CoinGecko. The wallet view opens by default so you read the lens immediately.',
      firstActionLabel: 'Track a token',
    },
    firstRunGuide: {
      steps: [
        { caption: 'The wallet view at the top gives you balances and transfers without leaving the substrate.' },
        { caption: 'Live prices via CoinGecko (no key). Tokens you track are persisted server-side; the list survives reload.' },
        { caption: 'Send / receive / swap actions remain stubs unless you wire an actual chain integration — the panel is honest about its DEMO status for those flows.' },
      ],
    },
  },
  {
    domain: 'custom',
    label: 'Custom',
    artifacts: ['component', 'template', 'config', 'field', 'schema'],
    macros: { list: 'lens.custom.list', get: 'lens.custom.get', create: 'lens.custom.create', update: 'lens.custom.update', delete: 'lens.custom.delete', run: 'lens.custom.run', export: 'lens.custom.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'system',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Roll your own.",
      caption: "Components, templates, configs, fields, schemas \u2014 build a lens tailored to your work.",
      firstActionLabel: "Compose a component",
    },
    firstRunGuide: {
      steps: [
        { caption: "Schemas validate against the lens-features contract." },
        { caption: "Templates ride the same DTU substrate as every other lens." },
        { caption: "Export as a lens manifest you can ship." },
      ],
    },
  },
  {
    domain: 'debug',
    label: 'Debug',
    artifacts: ['breakpoint', 'stacktrace', 'variable', 'watch', 'log'],
    macros: { list: 'lens.debug.list', get: 'lens.debug.get', create: 'lens.debug.create', update: 'lens.debug.update', delete: 'lens.debug.delete', run: 'lens.debug.run', export: 'lens.debug.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'system',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Debug workspace.",
      caption: "Breakpoints, stacktraces, variables, watches, logs \u2014 analyze, generate, export.",
      firstActionLabel: "Attach to a process",
    },
    firstRunGuide: {
      steps: [
        { caption: "analyze surfaces patterns across logs." },
        { caption: "generate composes a minimal repro from a stacktrace." },
        { caption: "Export the session as a debug DTU you can share." },
      ],
    },
  },
  {
    domain: 'defense',
    label: 'Defense',
    artifacts: ['threat', 'asset', 'strategy', 'operation', 'intel'],
    macros: { list: 'lens.defense.list', get: 'lens.defense.get', create: 'lens.defense.create', update: 'lens.defense.update', delete: 'lens.defense.delete', run: 'lens.defense.run', export: 'lens.defense.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'government',
    dataTier: 'DEMO',
    emptyState: {
      headline: "Defense workflow.",
      caption: "Threats, assets, strategies, operations, intel \u2014 DEMO data; wire your own feeds.",
      firstActionLabel: "Open the panel",
    },
    firstRunGuide: {
      steps: [
        { caption: "Threats + assets ride the audit-trail substrate." },
        { caption: "Strategy composition uses the same engine as Council." },
        { caption: "Intel reports compose as DTUs with full provenance." },
      ],
    },
  },
  {
    domain: 'desert',
    label: 'Desert Ecology',
    artifacts: ['species', 'habitat', 'climate', 'resource', 'adaptation'],
    macros: { list: 'lens.desert.list', get: 'lens.desert.get', create: 'lens.desert.create', update: 'lens.desert.update', delete: 'lens.desert.delete', run: 'lens.desert.run', export: 'lens.desert.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'knowledge',
    dataTier: 'REAL_FREE',
    emptyState: {
      headline: "Desert ecology.",
      caption: "Species, habitats, climate, resources, adaptations \u2014 REAL_FREE data from open ecology feeds.",
      firstActionLabel: "Browse species",
    },
    firstRunGuide: {
      steps: [
        { caption: "Real climate signals come from the environment-sensor heartbeat." },
        { caption: "analyze surfaces habitat overlaps + competition." },
        { caption: "Export species lists for field surveys." },
      ],
    },
  },
  {
    domain: 'disputes',
    label: 'Disputes',
    artifacts: ['case', 'claim', 'resolution', 'mediation', 'ruling'],
    macros: { list: 'lens.disputes.list', get: 'lens.disputes.get', create: 'lens.disputes.create', update: 'lens.disputes.update', delete: 'lens.disputes.delete', run: 'lens.disputes.run', export: 'lens.disputes.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'services',
    dataTier: 'SIM_GRADE_A',
    emptyState: {
      headline: "Resolve a dispute.",
      caption: "Cases, claims, resolutions, mediations, rulings \u2014 analyze, generate, export.",
      firstActionLabel: "Open a case",
    },
    firstRunGuide: {
      steps: [
        { caption: "Mediation flows ride the standard governance substrate." },
        { caption: "Generate composes proposed rulings against precedent." },
        { caption: "Export the full dispute record as one DTU." },
      ],
    },
  },
  {
    domain: 'docs',
    label: 'Docs',
    artifacts: ['document', 'page', 'version', 'template', 'export'],
    macros: { list: 'lens.docs.list', get: 'lens.docs.get', create: 'lens.docs.create', update: 'lens.docs.update', delete: 'lens.docs.delete', run: 'lens.docs.run', export: 'lens.docs.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'productivity',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: 'No docs yet.',
      caption: 'Author a document — sidebar tree + page editor. Every save is a DTU; versions are immutable.',
      firstActionLabel: 'Create a doc',
    },
    firstRunGuide: {
      steps: [
        { caption: 'Sidebar tree on the left; nested docs by drag-and-drop. Templates accelerate common doc shapes.' },
        { caption: 'Each save creates a new version under the doc. Rollback via the history panel.' },
        { caption: 'Export to PDF (paged), JSON (machine), or CSV (tabular sections only).' },
      ],
    },
  },
  {
    domain: 'dtus',
    label: 'DTU Manager',
    artifacts: ['dtu', 'validation', 'citation', 'lineage', 'hash'],
    macros: { list: 'lens.dtus.list', get: 'lens.dtus.get', create: 'lens.dtus.create', update: 'lens.dtus.update', delete: 'lens.dtus.delete', run: 'lens.dtus.run', export: 'lens.dtus.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'system',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Manage your DTUs.",
      caption: "DTUs, validation, citations, lineage, hashes \u2014 the substrate's own audit surface.",
      firstActionLabel: "Browse your corpus",
    },
    firstRunGuide: {
      steps: [
        { caption: "validate runs the DTU protocol hash check on any subset." },
        { caption: "Lineage walks the citation graph live." },
        { caption: "Export the full corpus as a portable envelope (instance-signed)." },
      ],
    },
  },
  {
    domain: 'electrical',
    label: 'Electrical',
    artifacts: ['circuit', 'component', 'load', 'panel', 'wiring'],
    macros: { list: 'lens.electrical.list', get: 'lens.electrical.get', create: 'lens.electrical.create', update: 'lens.electrical.update', delete: 'lens.electrical.delete', run: 'lens.electrical.run', export: 'lens.electrical.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'trades',
    dataTier: 'SIM_GRADE_A',
    emptyState: {
      headline: "Electrical work.",
      caption: "Circuits, components, loads, panels, wiring \u2014 calculate, validate, export.",
      firstActionLabel: "Start a circuit",
    },
    firstRunGuide: {
      steps: [
        { caption: "analyze surfaces overload + code-compliance issues." },
        { caption: "validate runs against NEC / local code tables." },
        { caption: "Export a one-line diagram + schedule." },
      ],
    },
  },
  {
    domain: 'emergency-services',
    label: 'Emergency Services',
    artifacts: ['incident', 'dispatch', 'resource', 'protocol', 'response'],
    macros: { list: 'lens.emergency-services.list', get: 'lens.emergency-services.get', create: 'lens.emergency-services.create', update: 'lens.emergency-services.update', delete: 'lens.emergency-services.delete', run: 'lens.emergency-services.run', export: 'lens.emergency-services.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'government',
    dataTier: 'REAL_FREE',
    emptyState: {
      headline: "Emergency dispatch.",
      caption: "Incidents, dispatches, resources, protocols, responses \u2014 REAL_FREE data from open feeds.",
      firstActionLabel: "Open the dispatch board",
    },
    firstRunGuide: {
      steps: [
        { caption: "Incidents stream in real-time from connected feeds." },
        { caption: "Resource allocation runs against the live availability map." },
        { caption: "Protocols compose response checklists from the playbook substrate." },
      ],
    },
  },
  {
    domain: 'energy',
    label: 'Energy',
    artifacts: ['source', 'grid', 'consumption', 'forecast', 'efficiency'],
    macros: { list: 'lens.energy.list', get: 'lens.energy.get', create: 'lens.energy.create', update: 'lens.energy.update', delete: 'lens.energy.delete', run: 'lens.energy.run', export: 'lens.energy.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'operations',
    dataTier: 'REAL_FREE',
    emptyState: {
      headline: "Energy management.",
      caption: "Sources, grids, consumption, forecasts, efficiency \u2014 REAL_FREE feeds power the analytics.",
      firstActionLabel: "Add a meter",
    },
    firstRunGuide: {
      steps: [
        { caption: "consumption pulls live from connected meters." },
        { caption: "forecast runs against weather + historical patterns." },
        { caption: "Export an efficiency report stakeholders can act on." },
      ],
    },
  },
  {
    domain: 'engineering',
    label: 'Engineering',
    artifacts: ['structure', 'component', 'material', 'simulation', 'specification'],
    macros: { list: 'lens.engineering.list', get: 'lens.engineering.get', create: 'lens.engineering.create', update: 'lens.engineering.update', delete: 'lens.engineering.delete', run: 'lens.engineering.run', export: 'lens.engineering.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'trades',
    dataTier: 'SIM_GRADE_A',
    emptyState: {
      headline: "Engineering workspace.",
      caption: "Structures, components, materials, simulations, specs \u2014 analyze, generate, export.",
      firstActionLabel: "Start a project",
    },
    firstRunGuide: {
      steps: [
        { caption: "simulation runs against the SIM_GRADE_A engine." },
        { caption: "validate enforces material spec + safety factor." },
        { caption: "Export drawings + specs ready for review." },
      ],
    },
  },
  {
    domain: 'export',
    label: 'Export',
    artifacts: ['job', 'format', 'template', 'queue', 'result'],
    macros: { list: 'lens.export.list', get: 'lens.export.get', create: 'lens.export.create', update: 'lens.export.update', delete: 'lens.export.delete', run: 'lens.export.run', export: 'lens.export.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'system',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Export anything.",
      caption: "Jobs, formats, templates, queues, results \u2014 analyze, generate, validate.",
      firstActionLabel: "Start an export",
    },
    firstRunGuide: {
      steps: [
        { caption: "Pick a format; the queue processes asynchronously." },
        { caption: "Templates ride the substrate so exports stay consistent." },
        { caption: "Results surface as downloadable DTUs." },
      ],
    },
  },
  {
    domain: 'film-studios',
    label: 'Film Studios',
    artifacts: ['production', 'scene', 'script', 'cast', 'schedule'],
    macros: { list: 'lens.film-studios.list', get: 'lens.film-studios.get', create: 'lens.film-studios.create', update: 'lens.film-studios.update', delete: 'lens.film-studios.delete', run: 'lens.film-studios.run', export: 'lens.film-studios.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'creative',
    dataTier: 'REAL_FREE',
    emptyState: {
      headline: "Run a film production.",
      caption: "Productions, scenes, scripts, casts, schedules \u2014 analyze, generate, export.",
      firstActionLabel: "Start a production",
    },
    firstRunGuide: {
      steps: [
        { caption: "Scenes + scripts ride the same substrate as Creative." },
        { caption: "Cast + schedule surface conflicts before they bind." },
        { caption: "Export call sheets + sides per day." },
      ],
    },
  },
  {
    domain: 'forestry',
    label: 'Forestry',
    artifacts: ['plot', 'species', 'harvest', 'inventory', 'growth'],
    macros: { list: 'lens.forestry.list', get: 'lens.forestry.get', create: 'lens.forestry.create', update: 'lens.forestry.update', delete: 'lens.forestry.delete', run: 'lens.forestry.run', export: 'lens.forestry.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'agriculture',
    dataTier: 'REAL_FREE',
    emptyState: {
      headline: "Manage your forest.",
      caption: "Plots, species, harvests, inventories, growth \u2014 REAL_FREE data from open forestry sources.",
      firstActionLabel: "Add a plot",
    },
    firstRunGuide: {
      steps: [
        { caption: "Growth + yield surface against real species + climate data." },
        { caption: "Inventory + harvest plans ride the substrate." },
        { caption: "Export field cards for crew." },
      ],
    },
  },
  {
    domain: 'fork',
    label: 'Fork',
    artifacts: ['branch', 'diff', 'merge', 'origin', 'variant'],
    macros: { list: 'lens.fork.list', get: 'lens.fork.get', create: 'lens.fork.create', update: 'lens.fork.update', delete: 'lens.fork.delete', run: 'lens.fork.run', export: 'lens.fork.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'system',
    dataTier: 'SIM_GRADE_A',
    emptyState: {
      headline: "Fork the substrate.",
      caption: "Branches, diffs, merges, origins, variants \u2014 fork a DTU lineage and explore in parallel.",
      firstActionLabel: "Fork a branch",
    },
    firstRunGuide: {
      steps: [
        { caption: "Each fork preserves provenance back to the origin." },
        { caption: "Diff against origin at any point." },
        { caption: "Merge back when the variant matures." },
      ],
    },
  },
  {
    domain: 'game-design',
    label: 'Game Design',
    artifacts: ['mechanic', 'level', 'balance', 'playtest', 'asset'],
    macros: { list: 'lens.game-design.list', get: 'lens.game-design.get', create: 'lens.game-design.create', update: 'lens.game-design.update', delete: 'lens.game-design.delete', run: 'lens.game-design.run', export: 'lens.game-design.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'creative',
    dataTier: 'SIM_GRADE_A',
    emptyState: {
      headline: "Design a game.",
      caption: "Mechanics, levels, balance, playtests, assets \u2014 analyze, generate, validate.",
      firstActionLabel: "Start a design",
    },
    firstRunGuide: {
      steps: [
        { caption: "Mechanics + balance ride the same substrate as Sandbox." },
        { caption: "Playtest results surface against design intent." },
        { caption: "Export a design doc + asset bundle." },
      ],
    },
  },
  {
    domain: 'geology',
    label: 'Geology',
    artifacts: ['sample', 'formation', 'mineral', 'survey', 'map'],
    macros: { list: 'lens.geology.list', get: 'lens.geology.get', create: 'lens.geology.create', update: 'lens.geology.update', delete: 'lens.geology.delete', run: 'lens.geology.run', export: 'lens.geology.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'knowledge',
    dataTier: 'REAL_FREE',
    emptyState: {
      headline: "Geology workspace.",
      caption: "Samples, formations, minerals, surveys, maps \u2014 REAL_FREE data from USGS + open geology sources.",
      firstActionLabel: "Browse samples",
    },
    firstRunGuide: {
      steps: [
        { caption: "USGS quakes feed surfaces in real-time alongside your samples." },
        { caption: "Maps render against open elevation data." },
        { caption: "Export field cards + sample logs." },
      ],
    },
  },
  {
    domain: 'global',
    label: 'Global',
    artifacts: ['region', 'language', 'currency', 'regulation', 'market'],
    macros: { list: 'lens.global.list', get: 'lens.global.get', create: 'lens.global.create', update: 'lens.global.update', delete: 'lens.global.delete', run: 'lens.global.run', export: 'lens.global.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'operations',
    dataTier: 'REAL_FREE',
    emptyState: {
      headline: "Global operations.",
      caption: "Regions, languages, currencies, regulations, markets \u2014 REAL_FREE feeds power the dashboards.",
      firstActionLabel: "Pick a region",
    },
    firstRunGuide: {
      steps: [
        { caption: "Currency + regulation surface against live open data." },
        { caption: "Markets render against open exchange feeds." },
        { caption: "Export a regional brief for stakeholders." },
      ],
    },
  },
  {
    domain: 'grounding',
    label: 'Grounding',
    artifacts: ['fact', 'source', 'verification', 'context', 'claim'],
    macros: { list: 'lens.grounding.list', get: 'lens.grounding.get', create: 'lens.grounding.create', update: 'lens.grounding.update', delete: 'lens.grounding.delete', run: 'lens.grounding.run', export: 'lens.grounding.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'knowledge',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Ground every claim.",
      caption: "Facts, sources, verifications, contexts, claims \u2014 the substrate's claim-checking surface.",
      firstActionLabel: "Open a claim",
    },
    firstRunGuide: {
      steps: [
        { caption: "Every claim ties to a source DTU." },
        { caption: "verify reruns the check against the live substrate." },
        { caption: "Export a verifiable claim bundle." },
      ],
    },
  },
  {
    domain: 'history',
    label: 'History',
    artifacts: ['event', 'era', 'figure', 'source', 'timeline'],
    macros: { list: 'lens.history.list', get: 'lens.history.get', create: 'lens.history.create', update: 'lens.history.update', delete: 'lens.history.delete', run: 'lens.history.run', export: 'lens.history.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'knowledge',
    dataTier: 'REAL_FREE',
    emptyState: {
      headline: "Browse history.",
      caption: "Events, eras, figures, sources, timelines \u2014 REAL_FREE data from Wikipedia + open history sources.",
      firstActionLabel: "Pick an era",
    },
    firstRunGuide: {
      steps: [
        { caption: "Wikipedia On This Day surfaces live." },
        { caption: "Timelines render across eras + figures." },
        { caption: "Export annotated timelines as DTUs." },
      ],
    },
  },
  {
    domain: 'hr',
    label: 'Human Resources',
    artifacts: ['employee', 'position', 'review', 'benefit', 'onboarding'],
    macros: { list: 'lens.hr.list', get: 'lens.hr.get', create: 'lens.hr.create', update: 'lens.hr.update', delete: 'lens.hr.delete', run: 'lens.hr.run', export: 'lens.hr.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'services',
    dataTier: 'SIM_GRADE_A',
    emptyState: {
      headline: "HR workspace.",
      caption: "Employees, positions, reviews, benefits, onboarding \u2014 analyze, generate, export.",
      firstActionLabel: "Open the directory",
    },
    firstRunGuide: {
      steps: [
        { caption: "Reviews + onboarding flows ride the substrate." },
        { caption: "Generate composes review summaries from session notes." },
        { caption: "Export benefits packages + offer letters." },
      ],
    },
  },
  {
    domain: 'hvac',
    label: 'HVAC',
    artifacts: ['system', 'zone', 'sensor', 'schedule', 'maintenance'],
    macros: { list: 'lens.hvac.list', get: 'lens.hvac.get', create: 'lens.hvac.create', update: 'lens.hvac.update', delete: 'lens.hvac.delete', run: 'lens.hvac.run', export: 'lens.hvac.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'trades',
    dataTier: 'SIM_GRADE_A',
    emptyState: {
      headline: "HVAC management.",
      caption: "Systems, zones, sensors, schedules, maintenance \u2014 analyze, generate, validate.",
      firstActionLabel: "Add a system",
    },
    firstRunGuide: {
      steps: [
        { caption: "Zones + sensors stream against real building data." },
        { caption: "Schedule optimization runs against occupancy + weather." },
        { caption: "Export maintenance pack per equipment." },
      ],
    },
  },
  {
    domain: 'hypothesis',
    label: 'Hypothesis',
    artifacts: ['theory', 'experiment', 'evidence', 'variable', 'conclusion'],
    macros: { list: 'lens.hypothesis.list', get: 'lens.hypothesis.get', create: 'lens.hypothesis.create', update: 'lens.hypothesis.update', delete: 'lens.hypothesis.delete', run: 'lens.hypothesis.run', export: 'lens.hypothesis.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'knowledge',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Test a hypothesis.",
      caption: "Theories, experiments, evidence, variables, conclusions \u2014 analyze, generate, validate.",
      firstActionLabel: "Form a hypothesis",
    },
    firstRunGuide: {
      steps: [
        { caption: "Variables + evidence ride the same substrate as Paper." },
        { caption: "analyze runs the standard hypothesis tests." },
        { caption: "Export a methods + results pack." },
      ],
    },
  },
  {
    domain: 'import',
    label: 'Import',
    artifacts: ['source', 'mapping', 'validation', 'queue', 'result'],
    macros: { list: 'lens.import.list', get: 'lens.import.get', create: 'lens.import.create', update: 'lens.import.update', delete: 'lens.import.delete', run: 'lens.import.run', export: 'lens.import.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'system',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Import anything.",
      caption: "Sources, mappings, validations, queues, results \u2014 analyze, generate, export.",
      firstActionLabel: "Start an import",
    },
    firstRunGuide: {
      steps: [
        { caption: "Sources ride the same connector substrate as Bridge." },
        { caption: "validate runs before commit so bad data never lands." },
        { caption: "Results surface as DTU batches." },
      ],
    },
  },
  {
    domain: 'inference',
    label: 'Inference',
    artifacts: ['model', 'prompt', 'response', 'context', 'evaluation'],
    macros: { list: 'lens.inference.list', get: 'lens.inference.get', create: 'lens.inference.create', update: 'lens.inference.update', delete: 'lens.inference.delete', run: 'lens.inference.run', export: 'lens.inference.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'system',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "LLM inference workspace.",
      caption: "Models, prompts, responses, contexts, evaluations \u2014 analyze, generate, validate.",
      firstActionLabel: "Start a session",
    },
    firstRunGuide: {
      steps: [
        { caption: "Models route through the four-brain substrate." },
        { caption: "evaluation surfaces drift between expected + actual." },
        { caption: "Export prompts + responses as a training-ready DTU." },
      ],
    },
  },
  {
    domain: 'ingest',
    label: 'Ingest',
    artifacts: ['source', 'pipeline', 'transform', 'validation', 'batch'],
    macros: { list: 'lens.ingest.list', get: 'lens.ingest.get', create: 'lens.ingest.create', update: 'lens.ingest.update', delete: 'lens.ingest.delete', run: 'lens.ingest.run', export: 'lens.ingest.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'system',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Ingest pipelines.",
      caption: "Sources, pipelines, transforms, validations, batches \u2014 analyze, generate, export.",
      firstActionLabel: "Start a pipeline",
    },
    firstRunGuide: {
      steps: [
        { caption: "Pipelines ride the same substrate as the heartbeat tick." },
        { caption: "validate runs before each batch lands." },
        { caption: "Export pipeline logs + per-batch DTUs." },
      ],
    },
  },
  {
    domain: 'integrations',
    label: 'Integrations',
    artifacts: ['connection', 'webhook', 'mapping', 'sync', 'log'],
    macros: { list: 'lens.integrations.list', get: 'lens.integrations.get', create: 'lens.integrations.create', update: 'lens.integrations.update', delete: 'lens.integrations.delete', run: 'lens.integrations.run', export: 'lens.integrations.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'system',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Wire your integrations.",
      caption: "Connections, webhooks, mappings, syncs, logs \u2014 analyze, generate, export.",
      firstActionLabel: "Add an integration",
    },
    firstRunGuide: {
      steps: [
        { caption: "Connections live in the integration registry." },
        { caption: "Webhooks log every event for audit." },
        { caption: "Export a connection bundle for deployment." },
      ],
    },
  },
  {
    domain: 'landscaping',
    label: 'Landscaping',
    artifacts: ['design', 'plant', 'zone', 'irrigation', 'material'],
    macros: { list: 'lens.landscaping.list', get: 'lens.landscaping.get', create: 'lens.landscaping.create', update: 'lens.landscaping.update', delete: 'lens.landscaping.delete', run: 'lens.landscaping.run', export: 'lens.landscaping.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'trades',
    dataTier: 'SIM_GRADE_A',
    emptyState: {
      headline: "Landscape design.",
      caption: "Designs, plants, zones, irrigation, materials \u2014 analyze, generate, validate.",
      firstActionLabel: "Start a design",
    },
    firstRunGuide: {
      steps: [
        { caption: "Plant data rides REAL_FREE open horticulture sources." },
        { caption: "Zone planning composes against soil + climate signals." },
        { caption: "Export plans + material lists." },
      ],
    },
  },
  {
    domain: 'law-enforcement',
    label: 'Law Enforcement',
    artifacts: ['case', 'officer', 'report', 'evidence', 'warrant'],
    macros: { list: 'lens.law-enforcement.list', get: 'lens.law-enforcement.get', create: 'lens.law-enforcement.create', update: 'lens.law-enforcement.update', delete: 'lens.law-enforcement.delete', run: 'lens.law-enforcement.run', export: 'lens.law-enforcement.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'government',
    dataTier: 'REAL_FREE',
    emptyState: {
      headline: "Law enforcement workspace.",
      caption: "Cases, officers, reports, evidence, warrants \u2014 REAL_FREE data from open justice feeds.",
      firstActionLabel: "Open the case board",
    },
    firstRunGuide: {
      steps: [
        { caption: "Evidence chains ride the audit-trail substrate." },
        { caption: "Reports compose from underlying DTUs." },
        { caption: "Export case binders per agency standard." },
      ],
    },
  },
  {
    domain: 'legacy',
    label: 'Legacy',
    artifacts: ['migration', 'schema', 'adapter', 'compatibility', 'archive'],
    macros: { list: 'lens.legacy.list', get: 'lens.legacy.get', create: 'lens.legacy.create', update: 'lens.legacy.update', delete: 'lens.legacy.delete', run: 'lens.legacy.run', export: 'lens.legacy.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'system',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Manage legacy systems.",
      caption: "Migrations, schemas, adapters, compatibility, archives \u2014 analyze, generate, validate.",
      firstActionLabel: "Open the migrations panel",
    },
    firstRunGuide: {
      steps: [
        { caption: "Migrations ride the same numbered substrate as the server." },
        { caption: "Schemas + adapters surface compatibility issues." },
        { caption: "Export an archive of legacy state per system." },
      ],
    },
  },
  {
    domain: 'linguistics',
    label: 'Linguistics',
    artifacts: ['corpus', 'analysis', 'grammar', 'phoneme', 'translation'],
    macros: { list: 'lens.linguistics.list', get: 'lens.linguistics.get', create: 'lens.linguistics.create', update: 'lens.linguistics.update', delete: 'lens.linguistics.delete', run: 'lens.linguistics.run', export: 'lens.linguistics.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'knowledge',
    dataTier: 'REAL_FREE',
    emptyState: {
      headline: "Linguistics workspace.",
      caption: "Corpora, analyses, grammars, phonemes, translations \u2014 REAL_FREE data from open linguistics sources.",
      firstActionLabel: "Pick a corpus",
    },
    firstRunGuide: {
      steps: [
        { caption: "Corpora ride the same substrate as Paper." },
        { caption: "analyze runs against open NLP toolchains." },
        { caption: "Export annotated corpora as DTUs." },
      ],
    },
  },
  {
    domain: 'lock',
    label: 'Lock',
    artifacts: ['permission', 'access', 'token', 'audit', 'policy'],
    macros: { list: 'lens.lock.list', get: 'lens.lock.get', create: 'lens.lock.create', update: 'lens.lock.update', delete: 'lens.lock.delete', run: 'lens.lock.run', export: 'lens.lock.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'system',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Permissions + locks.",
      caption: "Permissions, access, tokens, audits, policies \u2014 analyze, generate, validate.",
      firstActionLabel: "Open the panel",
    },
    firstRunGuide: {
      steps: [
        { caption: "Permissions ride the three-gate substrate." },
        { caption: "Tokens log every issuance + revoke." },
        { caption: "Export an audit-ready compliance report." },
      ],
    },
  },
  {
    domain: 'marketing',
    label: 'Marketing',
    artifacts: ['campaign', 'audience', 'content', 'channel', 'metric'],
    macros: { list: 'lens.marketing.list', get: 'lens.marketing.get', create: 'lens.marketing.create', update: 'lens.marketing.update', delete: 'lens.marketing.delete', run: 'lens.marketing.run', export: 'lens.marketing.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'services',
    dataTier: 'SIM_GRADE_A',
    emptyState: {
      headline: "Marketing campaigns.",
      caption: "Campaigns, audiences, content, channels, metrics \u2014 analyze, generate, export.",
      firstActionLabel: "Start a campaign",
    },
    firstRunGuide: {
      steps: [
        { caption: "Audiences ride the substrate so retargeting stays consistent." },
        { caption: "Content surfaces against your brand voice DTUs." },
        { caption: "Export campaign briefs + creative bundles." },
      ],
    },
  },
  {
    domain: 'masonry',
    label: 'Masonry',
    artifacts: ['wall', 'block', 'mortar', 'pattern', 'foundation'],
    macros: { list: 'lens.masonry.list', get: 'lens.masonry.get', create: 'lens.masonry.create', update: 'lens.masonry.update', delete: 'lens.masonry.delete', run: 'lens.masonry.run', export: 'lens.masonry.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'trades',
    dataTier: 'SIM_GRADE_A',
    emptyState: {
      headline: "Masonry projects.",
      caption: "Walls, blocks, mortar, patterns, foundations \u2014 analyze, generate, validate.",
      firstActionLabel: "Start a wall",
    },
    firstRunGuide: {
      steps: [
        { caption: "Material calcs ride against real spec tables." },
        { caption: "Patterns compose against structural requirements." },
        { caption: "Export cut lists + foundation specs." },
      ],
    },
  },
  {
    domain: 'materials',
    label: 'Materials',
    artifacts: ['sample', 'property', 'test', 'specification', 'grade'],
    macros: { list: 'lens.materials.list', get: 'lens.materials.get', create: 'lens.materials.create', update: 'lens.materials.update', delete: 'lens.materials.delete', run: 'lens.materials.run', export: 'lens.materials.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'trades',
    dataTier: 'SIM_GRADE_A',
    emptyState: {
      headline: "Materials workspace.",
      caption: "Samples, properties, tests, specifications, grades \u2014 analyze, generate, export.",
      firstActionLabel: "Add a sample",
    },
    firstRunGuide: {
      steps: [
        { caption: "Test results ride the substrate; trends surface live." },
        { caption: "Spec compliance auto-checks against grade." },
        { caption: "Export material data sheets." },
      ],
    },
  },
  {
    domain: 'math',
    label: 'Mathematics',
    artifacts: ['proof', 'equation', 'graph', 'set', 'theorem'],
    macros: { list: 'lens.math.list', get: 'lens.math.get', create: 'lens.math.create', update: 'lens.math.update', delete: 'lens.math.delete', run: 'lens.math.run', export: 'lens.math.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'knowledge',
    dataTier: 'REAL_FREE',
    emptyState: {
      headline: 'Workbench is clean.',
      caption: 'Type an equation, drop a proof outline, or browse the MathOverflow feed. Wolfram Alpha is wired for symbolic ops.',
      firstActionLabel: 'Compose your first equation',
    },
    firstRunGuide: {
      steps: [
        { caption: 'The MathStackFeed shows top MathOverflow questions in real time.' },
        { caption: 'Proofs and equations mint as DTUs with LaTeX preserved. Other lenses can cite them.' },
        { caption: 'analyze / validate actions route through the Subconscious brain for symbolic checking against Wolfram.' },
      ],
    },
  },
  {
    domain: 'mental-health',
    label: 'Mental Health',
    artifacts: ['session', 'assessment', 'plan', 'progress', 'resource'],
    macros: { list: 'lens.mental-health.list', get: 'lens.mental-health.get', create: 'lens.mental-health.create', update: 'lens.mental-health.update', delete: 'lens.mental-health.delete', run: 'lens.mental-health.run', export: 'lens.mental-health.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'healthcare',
    dataTier: 'REAL_FREE',
    emptyState: {
      headline: 'No sessions logged.',
      caption: 'Log a session, run an assessment, draft a plan. NIH MedlinePlus powers the resource browser (free, real federal health info).',
      firstActionLabel: 'Log a session',
    },
    firstRunGuide: {
      steps: [
        { caption: 'Sessions hold notes + tone tags. Assessments use validated instruments (PHQ-9, GAD-7) as templates.' },
        { caption: 'Plans link to resources from MedlinePlus — real government-vetted info, not LLM speculation.' },
        { caption: 'Progress rolls up across sessions to surface trends; export as PDF for clinician sharing.' },
      ],
    },
  },
  {
    domain: 'metacognition',
    label: 'Metacognition',
    artifacts: ['strategy', 'reflection', 'awareness', 'regulation', 'evaluation'],
    macros: { list: 'lens.metacognition.list', get: 'lens.metacognition.get', create: 'lens.metacognition.create', update: 'lens.metacognition.update', delete: 'lens.metacognition.delete', run: 'lens.metacognition.run', export: 'lens.metacognition.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'knowledge',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Think about your thinking.",
      caption: "Strategies, reflections, awareness, regulation, evaluations \u2014 analyze, generate, summarize.",
      firstActionLabel: "Start a reflection",
    },
    firstRunGuide: {
      steps: [
        { caption: "Strategies ride the substrate so patterns surface across weeks." },
        { caption: "Reflections compose against your declared goals." },
        { caption: "Export a metacognitive review as a single DTU." },
      ],
    },
  },
  {
    domain: 'metalearning',
    label: 'Meta-Learning',
    artifacts: ['model', 'task', 'adaptation', 'transfer', 'benchmark'],
    macros: { list: 'lens.metalearning.list', get: 'lens.metalearning.get', create: 'lens.metalearning.create', update: 'lens.metalearning.update', delete: 'lens.metalearning.delete', run: 'lens.metalearning.run', export: 'lens.metalearning.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'knowledge',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Meta-learning workspace.",
      caption: "Models, tasks, adaptations, transfers, benchmarks \u2014 analyze, generate, validate.",
      firstActionLabel: "Start a task",
    },
    firstRunGuide: {
      steps: [
        { caption: "Adaptation rides the substrate so transfer learns from history." },
        { caption: "Benchmarks compose against published baselines." },
        { caption: "Export a methods-ready report." },
      ],
    },
  },
  {
    domain: 'mining',
    label: 'Mining',
    artifacts: ['deposit', 'extraction', 'survey', 'safety', 'yield'],
    macros: { list: 'lens.mining.list', get: 'lens.mining.get', create: 'lens.mining.create', update: 'lens.mining.update', delete: 'lens.mining.delete', run: 'lens.mining.run', export: 'lens.mining.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'trades',
    dataTier: 'SIM_GRADE_A',
    emptyState: {
      headline: "Mining ops.",
      caption: "Deposits, extractions, surveys, safety, yields \u2014 analyze, generate, validate.",
      firstActionLabel: "Add a survey",
    },
    firstRunGuide: {
      steps: [
        { caption: "Deposit data rides REAL_FREE open geology sources." },
        { caption: "Yield + safety stay tied to the same substrate." },
        { caption: "Export survey reports + safety checklists." },
      ],
    },
  },
  {
    domain: 'neuro',
    label: 'Neuroscience',
    artifacts: ['scan', 'region', 'pathway', 'signal', 'study'],
    macros: { list: 'lens.neuro.list', get: 'lens.neuro.get', create: 'lens.neuro.create', update: 'lens.neuro.update', delete: 'lens.neuro.delete', run: 'lens.neuro.run', export: 'lens.neuro.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'knowledge',
    dataTier: 'REAL_FREE',
    emptyState: {
      headline: "Neuroscience workspace.",
      caption: "Scans, regions, pathways, signals, studies \u2014 REAL_FREE data from open neuro sources.",
      firstActionLabel: "Pick a study",
    },
    firstRunGuide: {
      steps: [
        { caption: "Scans + pathways ride the same substrate as Paper." },
        { caption: "PubMed + open neuro datasets surface alongside your work." },
        { caption: "Export annotated study bundles." },
      ],
    },
  },
  {
    domain: 'news',
    label: 'News',
    artifacts: ['article', 'source', 'topic', 'feed', 'alert'],
    macros: { list: 'lens.news.list', get: 'lens.news.get', create: 'lens.news.create', update: 'lens.news.update', delete: 'lens.news.delete', run: 'lens.news.run', export: 'lens.news.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'social',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: 'Inbox is quiet.',
      caption: 'Reuters / BBC / NPR / TechCrunch / Ars Technica / Hacker News all poll live. Pick sources and topics; the feed populates within a minute.',
      firstActionLabel: 'Subscribe to topics',
    },
    firstRunGuide: {
      steps: [
        { caption: 'Sources poll on a 15-minute cadence; new articles surface as cards in the feed.' },
        { caption: 'analyze runs the Subconscious brain over a thread to extract a thesis or summarize a beat.' },
        { caption: 'Subscribe to topics with the action bar — the engine matches incoming articles by tag.' },
      ],
    },
  },
  {
    domain: 'ocean',
    label: 'Oceanography',
    artifacts: ['sample', 'depth', 'current', 'species', 'survey'],
    macros: { list: 'lens.ocean.list', get: 'lens.ocean.get', create: 'lens.ocean.create', update: 'lens.ocean.update', delete: 'lens.ocean.delete', run: 'lens.ocean.run', export: 'lens.ocean.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'knowledge',
    dataTier: 'REAL_FREE',
    emptyState: {
      headline: "Oceanography.",
      caption: "Samples, depths, currents, species, surveys \u2014 REAL_FREE data from NOAA + open ocean sources.",
      firstActionLabel: "Pick a region",
    },
    firstRunGuide: {
      steps: [
        { caption: "NOAA tide feeds surface live." },
        { caption: "Species + survey data ride the substrate." },
        { caption: "Export survey reports per voyage." },
      ],
    },
  },
  {
    domain: 'offline',
    label: 'Offline',
    artifacts: ['cache', 'sync', 'queue', 'conflict', 'storage'],
    macros: { list: 'lens.offline.list', get: 'lens.offline.get', create: 'lens.offline.create', update: 'lens.offline.update', delete: 'lens.offline.delete', run: 'lens.offline.run', export: 'lens.offline.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'system',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Offline-first sync.",
      caption: "Caches, syncs, queues, conflicts, storage \u2014 analyze, generate, validate.",
      firstActionLabel: "Open the panel",
    },
    firstRunGuide: {
      steps: [
        { caption: "Caches mirror the substrate locally." },
        { caption: "Conflicts surface against the audit trail before resolution." },
        { caption: "Export sync logs for compliance." },
      ],
    },
  },
  {
    domain: 'organ',
    label: 'Organ Systems',
    artifacts: ['tissue', 'function', 'pathology', 'diagnostic', 'treatment'],
    macros: { list: 'lens.organ.list', get: 'lens.organ.get', create: 'lens.organ.create', update: 'lens.organ.update', delete: 'lens.organ.delete', run: 'lens.organ.run', export: 'lens.organ.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'healthcare',
    dataTier: 'SIM_GRADE_A',
    emptyState: {
      headline: "Organ systems.",
      caption: "Tissues, functions, pathologies, diagnostics, treatments \u2014 SIM_GRADE_A engine.",
      firstActionLabel: "Browse the atlas",
    },
    firstRunGuide: {
      steps: [
        { caption: "Functions ride the substrate so diagnostics stay anchored." },
        { caption: "Pathology + treatment surface against real medical taxonomies." },
        { caption: "Export an organ-system brief." },
      ],
    },
  },
  {
    domain: 'pharmacy',
    label: 'Pharmacy',
    artifacts: ['drug', 'prescription', 'interaction', 'inventory', 'dosage'],
    macros: { list: 'lens.pharmacy.list', get: 'lens.pharmacy.get', create: 'lens.pharmacy.create', update: 'lens.pharmacy.update', delete: 'lens.pharmacy.delete', run: 'lens.pharmacy.run', export: 'lens.pharmacy.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'healthcare',
    dataTier: 'REAL_FREE',
    emptyState: {
      headline: 'No medications tracked.',
      caption: 'Add a medication to track dose, refills, and interactions. FDA OpenFDA powers the drug reference panel.',
      firstActionLabel: 'Add your first medication',
    },
    firstRunGuide: {
      steps: [
        { caption: 'Add medications via the Medications tab. Each entry stores dose / frequency / route / refills server-side.' },
        { caption: 'The Interactions tab runs your active list against FDA OpenFDA adverse-event data — real federal labels, not synthetic.' },
        { caption: 'FDA Reference (tab F) opens the drug-label browser. The depth badge tells you when data is REAL vs. demo (formulary requires paid feeds we don\'t have).' },
      ],
    },
  },
  {
    domain: 'philosophy',
    label: 'Philosophy',
    artifacts: ['argument', 'concept', 'tradition', 'text', 'debate'],
    macros: { list: 'lens.philosophy.list', get: 'lens.philosophy.get', create: 'lens.philosophy.create', update: 'lens.philosophy.update', delete: 'lens.philosophy.delete', run: 'lens.philosophy.run', export: 'lens.philosophy.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'knowledge',
    dataTier: 'SIM_GRADE_A',
    emptyState: {
      headline: "Philosophy workspace.",
      caption: "Arguments, concepts, traditions, texts, debates \u2014 SIM_GRADE_A engine.",
      firstActionLabel: "Pick a tradition",
    },
    firstRunGuide: {
      steps: [
        { caption: "Arguments ride the same substrate as Debate + Reasoning." },
        { caption: "Concepts surface across traditions." },
        { caption: "Export annotated texts + commentary bundles." },
      ],
    },
  },
  {
    domain: 'photography',
    label: 'Photography',
    artifacts: ['image', 'album', 'edit', 'metadata', 'export'],
    macros: { list: 'lens.photography.list', get: 'lens.photography.get', create: 'lens.photography.create', update: 'lens.photography.update', delete: 'lens.photography.delete', run: 'lens.photography.run', export: 'lens.photography.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'creative',
    dataTier: 'REAL_FREE',
    emptyState: {
      headline: "Manage your photos.",
      caption: "Images, albums, edits, metadata, exports \u2014 analyze, generate, validate.",
      firstActionLabel: "Add an album",
    },
    firstRunGuide: {
      steps: [
        { caption: "Metadata rides the substrate; provenance preserves credit." },
        { caption: "Edits log non-destructively." },
        { caption: "Export albums in any format with embedded credit." },
      ],
    },
  },
  {
    domain: 'physics',
    label: 'Physics',
    artifacts: ['experiment', 'model', 'constant', 'simulation', 'measurement'],
    macros: { list: 'lens.physics.list', get: 'lens.physics.get', create: 'lens.physics.create', update: 'lens.physics.update', delete: 'lens.physics.delete', run: 'lens.physics.run', export: 'lens.physics.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'knowledge',
    emptyState: {
      headline: 'Lab notebook empty.',
      caption: 'Open with an arXiv physics feed; log experiments / models / measurements. Constants ship pre-seeded.',
      firstActionLabel: 'Log an experiment',
    },
    firstRunGuide: {
      steps: [
        { caption: 'arXiv physics panel up top — REAL data; search filters within category.', selector: '[aria-label*="arXiv"]' },
        { caption: 'Experiments hold observation / measurement / units; the analyzer flags dimensional inconsistencies.' },
        { caption: 'Citations chain through the lattice — see which experiments stand on which models.' },
      ],
    },
    dataTier: 'REAL_FREE',
  },
  {
    domain: 'platform',
    label: 'Platform',
    artifacts: ['service', 'config', 'deployment', 'health', 'metric'],
    macros: { list: 'lens.platform.list', get: 'lens.platform.get', create: 'lens.platform.create', update: 'lens.platform.update', delete: 'lens.platform.delete', run: 'lens.platform.run', export: 'lens.platform.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'system',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Platform ops.",
      caption: "Services, configs, deployments, health, metrics \u2014 analyze, generate, export.",
      firstActionLabel: "Open the panel",
    },
    firstRunGuide: {
      steps: [
        { caption: "Services surface live health from the heartbeat substrate." },
        { caption: "Deployments log every release." },
        { caption: "Export an SLA-ready uptime report." },
      ],
    },
  },
  {
    domain: 'plumbing',
    label: 'Plumbing',
    artifacts: ['pipe', 'fixture', 'code', 'inspection', 'material'],
    macros: { list: 'lens.plumbing.list', get: 'lens.plumbing.get', create: 'lens.plumbing.create', update: 'lens.plumbing.update', delete: 'lens.plumbing.delete', run: 'lens.plumbing.run', export: 'lens.plumbing.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'trades',
    dataTier: 'SIM_GRADE_A',
    emptyState: {
      headline: "Plumbing projects.",
      caption: "Pipes, fixtures, codes, inspections, materials \u2014 analyze, generate, validate.",
      firstActionLabel: "Start a project",
    },
    firstRunGuide: {
      steps: [
        { caption: "Material + fixture sizing rides spec tables." },
        { caption: "Code compliance auto-checks against local code." },
        { caption: "Export inspection-ready plans." },
      ],
    },
  },
  {
    domain: 'poetry',
    label: 'Poetry',
    artifacts: ['poem', 'collection', 'form', 'analysis', 'workshop'],
    macros: { list: 'lens.poetry.list', get: 'lens.poetry.get', create: 'lens.poetry.create', update: 'lens.poetry.update', delete: 'lens.poetry.delete', run: 'lens.poetry.run', export: 'lens.poetry.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'creative',
    dataTier: 'REAL_FREE',
    emptyState: {
      headline: "Write poetry.",
      caption: "Poems, collections, forms, analyses, workshops \u2014 analyze, generate, export.",
      firstActionLabel: "Start a poem",
    },
    firstRunGuide: {
      steps: [
        { caption: "Forms + meters analyze against the canon." },
        { caption: "Workshops surface peer DTUs for critique." },
        { caption: "Export collections as EPUB / PDF." },
      ],
    },
  },
  {
    domain: 'privacy',
    label: 'Privacy',
    artifacts: ['policy', 'consent', 'request', 'audit', 'regulation'],
    macros: { list: 'lens.privacy.list', get: 'lens.privacy.get', create: 'lens.privacy.create', update: 'lens.privacy.update', delete: 'lens.privacy.delete', run: 'lens.privacy.run', export: 'lens.privacy.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'system',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Privacy controls.",
      caption: "Policies, consents, requests, audits, regulations \u2014 analyze, generate, validate.",
      firstActionLabel: "Open the panel",
    },
    firstRunGuide: {
      steps: [
        { caption: "Consents ride the citation-consent substrate." },
        { caption: "Requests log every DSR per regulation." },
        { caption: "Export a compliance pack per jurisdiction." },
      ],
    },
  },
  {
    domain: 'projects',
    label: 'Projects',
    artifacts: ['task', 'milestone', 'resource', 'timeline', 'dependency'],
    macros: { list: 'lens.projects.list', get: 'lens.projects.get', create: 'lens.projects.create', update: 'lens.projects.update', delete: 'lens.projects.delete', run: 'lens.projects.run', export: 'lens.projects.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'productivity',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Manage projects.",
      caption: "Tasks, milestones, resources, timelines, dependencies \u2014 analyze, generate, export.",
      firstActionLabel: "Create your first project",
    },
    firstRunGuide: {
      steps: [
        { caption: "Tasks + milestones ride the substrate so progress surfaces live." },
        { caption: "Dependencies enforce the critical path automatically." },
        { caption: "Export a Gantt-ready timeline + status DTU." },
      ],
    },
  },
  {
    domain: 'quantum',
    label: 'Quantum',
    artifacts: ['qubit', 'circuit', 'measurement', 'algorithm', 'simulation'],
    macros: { list: 'lens.quantum.list', get: 'lens.quantum.get', create: 'lens.quantum.create', update: 'lens.quantum.update', delete: 'lens.quantum.delete', run: 'lens.quantum.run', export: 'lens.quantum.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'knowledge',
    dataTier: 'REAL_FREE',
    emptyState: {
      headline: 'Circuit lab clean.',
      caption: 'Compose a quantum circuit; track measurements; the arXiv quant-ph feed up top surfaces the latest papers in real time.',
      firstActionLabel: 'New circuit',
    },
    firstRunGuide: {
      steps: [
        { caption: 'arXiv quant-ph panel up top — daily firehose of papers in your field.' },
        { caption: 'Circuits compose qubit by qubit; measurements record collapse outcomes.' },
        { caption: 'Simulation runs against a deterministic backend — useful for teaching, not for replacing real hardware.' },
      ],
    },
  },
  {
    domain: 'queue',
    label: 'Queue',
    artifacts: ['job', 'worker', 'priority', 'status', 'retry'],
    macros: { list: 'lens.queue.list', get: 'lens.queue.get', create: 'lens.queue.create', update: 'lens.queue.update', delete: 'lens.queue.delete', run: 'lens.queue.run', export: 'lens.queue.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'system',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Job queue.",
      caption: "Jobs, workers, priorities, statuses, retries \u2014 analyze, generate, validate.",
      firstActionLabel: "Open the queue",
    },
    firstRunGuide: {
      steps: [
        { caption: "Jobs run against the platform worker pool." },
        { caption: "Retries follow exponential backoff per the substrate." },
        { caption: "Export queue metrics for observability." },
      ],
    },
  },
  {
    domain: 'reflection',
    label: 'Reflection',
    artifacts: ['journal', 'insight', 'pattern', 'prompt', 'review'],
    macros: { list: 'lens.reflection.list', get: 'lens.reflection.get', create: 'lens.reflection.create', update: 'lens.reflection.update', delete: 'lens.reflection.delete', run: 'lens.reflection.run', export: 'lens.reflection.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'social',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Reflect.",
      caption: "Journals, insights, patterns, prompts, reviews \u2014 analyze, generate, summarize.",
      firstActionLabel: "Start a reflection",
    },
    firstRunGuide: {
      steps: [
        { caption: "Prompts compose against the patterns the substrate has noticed." },
        { caption: "Insights ride the daily / metacognition substrates." },
        { caption: "Export weekly reviews as DTUs." },
      ],
    },
  },
  {
    domain: 'research',
    label: 'Research',
    artifacts: ['paper', 'dataset', 'experiment', 'citation', 'review'],
    macros: { list: 'lens.research.list', get: 'lens.research.get', create: 'lens.research.create', update: 'lens.research.update', delete: 'lens.research.delete', run: 'lens.research.run', export: 'lens.research.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'knowledge',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: 'No research sessions yet.',
      caption: 'Spin up a reasoning_session: claim, evidence, contradiction-check, citation. Backed by the lattice substrate.',
      firstActionLabel: 'Start a session',
    },
    firstRunGuide: {
      steps: [
        { caption: 'Sessions are multi-step. The lattice drift scan flags contradictions across your corpus as you add evidence.' },
        { caption: 'Evidence pulls from any DTU in your substrate — past chats, papers, even Concordia NPC dialogue.' },
        { caption: 'analyze runs ghost-fleet reasoning modes (deductive / abductive / constraint_check / counterfactual). Pick the right mode for the question.' },
      ],
    },
  },
  {
    domain: 'robotics',
    label: 'Robotics',
    artifacts: ['robot', 'sensor', 'actuator', 'program', 'simulation'],
    macros: { list: 'lens.robotics.list', get: 'lens.robotics.get', create: 'lens.robotics.create', update: 'lens.robotics.update', delete: 'lens.robotics.delete', run: 'lens.robotics.run', export: 'lens.robotics.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'knowledge',
    dataTier: 'REAL_FREE',
    emptyState: {
      headline: "Robotics workspace.",
      caption: "Robots, sensors, actuators, programs, simulations \u2014 REAL_FREE open robotics sources.",
      firstActionLabel: "Add a robot",
    },
    firstRunGuide: {
      steps: [
        { caption: "Simulations ride the same substrate as Sim." },
        { caption: "Programs compose against ROS-compatible specs." },
        { caption: "Export deployable program bundles." },
      ],
    },
  },
  {
    domain: 'schema',
    label: 'Schema',
    artifacts: ['entity', 'relation', 'field', 'migration', 'validation'],
    macros: { list: 'lens.schema.list', get: 'lens.schema.get', create: 'lens.schema.create', update: 'lens.schema.update', delete: 'lens.schema.delete', run: 'lens.schema.run', export: 'lens.schema.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'system',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Schema management.",
      caption: "Entities, relations, fields, migrations, validations \u2014 analyze, generate, export.",
      firstActionLabel: "Open the editor",
    },
    firstRunGuide: {
      steps: [
        { caption: "Schemas ride the same substrate as Database + Legacy." },
        { caption: "Migrations generate from schema diffs." },
        { caption: "Export schema bundles per environment." },
      ],
    },
  },
  {
    domain: 'space',
    label: 'Space',
    artifacts: ['mission', 'satellite', 'orbit', 'telemetry', 'launch'],
    macros: { list: 'lens.space.list', get: 'lens.space.get', create: 'lens.space.create', update: 'lens.space.update', delete: 'lens.space.delete', run: 'lens.space.run', export: 'lens.space.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'knowledge',
    dataTier: 'REAL_FREE',
    emptyState: {
      headline: "Space workspace.",
      caption: "Missions, satellites, orbits, telemetry, launches \u2014 REAL_FREE data from open space sources.",
      firstActionLabel: "Pick a mission",
    },
    firstRunGuide: {
      steps: [
        { caption: "ISS + APOD surface live from NASA APIs." },
        { caption: "Telemetry + orbits ride the substrate." },
        { caption: "Export mission briefs." },
      ],
    },
  },
  {
    domain: 'suffering',
    label: 'Suffering and Ethics',
    artifacts: ['case', 'dilemma', 'framework', 'analysis', 'intervention'],
    macros: { list: 'lens.suffering.list', get: 'lens.suffering.get', create: 'lens.suffering.create', update: 'lens.suffering.update', delete: 'lens.suffering.delete', run: 'lens.suffering.run', export: 'lens.suffering.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'knowledge',
    dataTier: 'SIM_GRADE_A',
    emptyState: {
      headline: "Suffering + ethics.",
      caption: "Cases, dilemmas, frameworks, analyses, interventions \u2014 SIM_GRADE_A engine.",
      firstActionLabel: "Open a case",
    },
    firstRunGuide: {
      steps: [
        { caption: "Frameworks ride the same substrate as Ethics." },
        { caption: "Analyses compose against the case-file DTUs." },
        { caption: "Export intervention plans + framework citations." },
      ],
    },
  },
  {
    domain: 'supplychain',
    label: 'Supply Chain',
    artifacts: ['order', 'shipment', 'warehouse', 'route', 'forecast'],
    macros: { list: 'lens.supplychain.list', get: 'lens.supplychain.get', create: 'lens.supplychain.create', update: 'lens.supplychain.update', delete: 'lens.supplychain.delete', run: 'lens.supplychain.run', export: 'lens.supplychain.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'operations',
    dataTier: 'SIM_GRADE_A',
    emptyState: {
      headline: "Supply chain ops.",
      caption: "Orders, shipments, warehouses, routes, forecasts \u2014 SIM_GRADE_A engine.",
      firstActionLabel: "Open the chain",
    },
    firstRunGuide: {
      steps: [
        { caption: "Orders + shipments ride the same substrate as Logistics." },
        { caption: "Forecasts compose against historical + market signals." },
        { caption: "Export route + warehouse plans." },
      ],
    },
  },
  {
    domain: 'telecommunications',
    label: 'Telecom',
    artifacts: ['network', 'device', 'signal', 'plan', 'coverage'],
    macros: { list: 'lens.telecommunications.list', get: 'lens.telecommunications.get', create: 'lens.telecommunications.create', update: 'lens.telecommunications.update', delete: 'lens.telecommunications.delete', run: 'lens.telecommunications.run', export: 'lens.telecommunications.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'operations',
    dataTier: 'DEMO',
    emptyState: {
      headline: "Telecom workspace.",
      caption: "Networks, devices, signals, plans, coverage \u2014 DEMO data; wire your carrier when ready.",
      firstActionLabel: "Open the panel",
    },
    firstRunGuide: {
      steps: [
        { caption: "Networks + devices ride the substrate." },
        { caption: "Coverage maps render against open geo data." },
        { caption: "Export coverage reports." },
      ],
    },
  },
  {
    domain: 'tick',
    label: 'Tick Scheduler',
    artifacts: ['job', 'schedule', 'interval', 'execution', 'log'],
    macros: { list: 'lens.tick.list', get: 'lens.tick.get', create: 'lens.tick.create', update: 'lens.tick.update', delete: 'lens.tick.delete', run: 'lens.tick.run', export: 'lens.tick.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'system',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Tick scheduler.",
      caption: "Jobs, schedules, intervals, executions, logs \u2014 the same substrate as the 15s heartbeat.",
      firstActionLabel: "Open the panel",
    },
    firstRunGuide: {
      steps: [
        { caption: "Schedules ride the heartbeat registry." },
        { caption: "Executions log per tick." },
        { caption: "Export execution traces per heartbeat name." },
      ],
    },
  },
  {
    domain: 'transfer',
    label: 'Transfer',
    artifacts: ['source', 'destination', 'mapping', 'validation', 'log'],
    macros: { list: 'lens.transfer.list', get: 'lens.transfer.get', create: 'lens.transfer.create', update: 'lens.transfer.update', delete: 'lens.transfer.delete', run: 'lens.transfer.run', export: 'lens.transfer.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'system',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Transfer between systems.",
      caption: "Sources, destinations, mappings, validations, logs \u2014 analyze, generate, export.",
      firstActionLabel: "Start a transfer",
    },
    firstRunGuide: {
      steps: [
        { caption: "Mappings ride the same substrate as Bridge." },
        { caption: "validate runs the round-trip before commit." },
        { caption: "Export transfer logs." },
      ],
    },
  },
  {
    domain: 'urban-planning',
    label: 'Urban Planning',
    artifacts: ['zone', 'permit', 'project', 'assessment', 'regulation'],
    macros: { list: 'lens.urban-planning.list', get: 'lens.urban-planning.get', create: 'lens.urban-planning.create', update: 'lens.urban-planning.update', delete: 'lens.urban-planning.delete', run: 'lens.urban-planning.run', export: 'lens.urban-planning.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'government',
    dataTier: 'SIM_GRADE_A',
    emptyState: {
      headline: "Urban planning.",
      caption: "Zones, permits, projects, assessments, regulations \u2014 SIM_GRADE_A engine.",
      firstActionLabel: "Open the planner",
    },
    firstRunGuide: {
      steps: [
        { caption: "Zones + permits ride the same substrate as Government." },
        { caption: "Assessments compose against demographic + traffic signals." },
        { caption: "Export planning packages ready for public hearing." },
      ],
    },
  },
  {
    domain: 'veterinary',
    label: 'Veterinary',
    artifacts: ['patient', 'treatment', 'vaccine', 'record', 'prescription'],
    macros: { list: 'lens.veterinary.list', get: 'lens.veterinary.get', create: 'lens.veterinary.create', update: 'lens.veterinary.update', delete: 'lens.veterinary.delete', run: 'lens.veterinary.run', export: 'lens.veterinary.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'healthcare',
    dataTier: 'REAL_FREE',
    emptyState: {
      headline: "Veterinary workspace.",
      caption: "Patients, treatments, vaccines, records, prescriptions \u2014 REAL_FREE open vet sources.",
      firstActionLabel: "Add a patient",
    },
    firstRunGuide: {
      steps: [
        { caption: "Treatment + vaccine schedules ride the substrate." },
        { caption: "Prescriptions check against the same interaction engine as Pharmacy." },
        { caption: "Export discharge instructions per visit." },
      ],
    },
  },
  {
    domain: 'wallet',
    label: 'Wallet',
    artifacts: ['balance', 'transaction', 'token', 'address', 'history'],
    macros: { list: 'lens.wallet.list', get: 'lens.wallet.get', create: 'lens.wallet.create', update: 'lens.wallet.update', delete: 'lens.wallet.delete', run: 'lens.wallet.run', export: 'lens.wallet.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'finance',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: 'No CC yet.',
      caption: 'Earn Concord Coin by minting DTUs, completing events, or buying CC via Stripe. Every transaction lands here.',
      firstActionLabel: 'View earning paths',
    },
    firstRunGuide: {
      steps: [
        { caption: 'Your balance sits at the top — substrate-real, not a price quote. CC earned from royalties shows up immediately.' },
        { caption: 'The history rail shows every credit / debit with refId — refunds idempotent, withdrawal holds tracked at 48h.' },
        { caption: 'Send and receive use the standard Concord Coin ledger. The 48-hour withdrawal hold is the anti-refund-exploit gate.' },
      ],
    },
  },
  {
    domain: 'welding',
    label: 'Welding',
    artifacts: ['joint', 'procedure', 'inspection', 'material', 'certification'],
    macros: { list: 'lens.welding.list', get: 'lens.welding.get', create: 'lens.welding.create', update: 'lens.welding.update', delete: 'lens.welding.delete', run: 'lens.welding.run', export: 'lens.welding.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'trades',
    dataTier: 'SIM_GRADE_A',
    emptyState: {
      headline: "Welding workspace.",
      caption: "Joints, procedures, inspections, materials, certifications \u2014 SIM_GRADE_A engine.",
      firstActionLabel: "Start a project",
    },
    firstRunGuide: {
      steps: [
        { caption: "Procedures ride spec tables (AWS / ASME)." },
        { caption: "Inspections file as DTUs the inspector can verify." },
        { caption: "Export certification packets." },
      ],
    },
  },

  // ── Manifests added to bring failing lenses to ≥5/7 score ──

  {
    domain: 'crafting',
    label: 'Crafting',
    artifacts: ['recipe', 'fighting_style_recipe', 'spell_recipe', 'blueprint', 'tier_listing', 'craft_session'],
    macros: { list: 'lens.crafting.list', get: 'lens.crafting.get', create: 'lens.crafting.create', update: 'lens.crafting.update', delete: 'lens.crafting.delete', run: 'lens.crafting.run', export: 'lens.crafting.export' },
    exports: ['json', 'pdf'],
    actions: ['cook', 'brew', 'forge', 'list_for_marketplace', 'set_tier_pricing', 'apply_recipe'],
    category: 'creative',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: 'No recipes minted yet.',
      caption: 'Author a recipe — cook, brew, forge, fighting style, or spell. Mint as a recipe DTU; list to your marketplace stall with tier pricing.',
      firstActionLabel: 'Mine / Browse / Author',
    },
    firstRunGuide: {
      steps: [
        { caption: 'Three modes: Mine (your recipes), Browse Marketplace (others\'), Author (compose new).' },
        { caption: 'Recipes are first-class DTUs — fighting styles use the v2.0 recipe substrate; spells fold base-6 glyph algebra.' },
        { caption: 'list_for_marketplace + set_tier_pricing publishes for sale; the royalty cascade pays you on every cite.' },
      ],
    },
  },
  {
    domain: 'understanding',
    label: 'Understanding',
    artifacts: ['understanding', 'evidence', 'lineage', 'consolidation', 'compose-session'],
    macros: {
      list:   'lens.understanding.list',
      get:    'lens.understanding.get',
      create: 'lens.understanding.create',
      update: 'lens.understanding.update',
      delete: 'lens.understanding.delete',
      run:    'lens.understanding.run',
      export: 'lens.understanding.export',
    },
    exports: ['json', 'csv'],
    actions: ['parse', 'compose', 'recompose', 'record_evidence', 'evaluate_promotion', 'apply_promotion', 'consolidate', 'lineage', 'evolution_tick', 'sweep'],
    category: 'knowledge',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Understanding substrate.",
      caption: "Understandings, evidence, lineage, consolidation, compose-sessions \u2014 the substrate's reasoning layer.",
      firstActionLabel: "Open the workspace",
    },
    firstRunGuide: {
      steps: [
        { caption: "compose runs the multi-stage understanding pipeline." },
        { caption: "consolidate folds related understandings together with lineage." },
        { caption: "Export an understanding + its full evidence chain." },
      ],
    },
  },
  {
    domain: 'creator',
    label: 'Creator',
    artifacts: ['profile', 'royalty_stream', 'tier_pricing', 'follower', 'creator_score'],
    macros: { list: 'lens.creator.list', get: 'lens.creator.get', create: 'lens.creator.create', update: 'lens.creator.update', delete: 'lens.creator.delete', run: 'lens.creator.run', export: 'lens.creator.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'social',
    dataTier: 'SIM_GRADE_A',
    emptyState: {
      headline: "Creator profile.",
      caption: "Profile, royalty streams, tier pricing, followers, creator score \u2014 the substrate's economy layer.",
      firstActionLabel: "Open your profile",
    },
    firstRunGuide: {
      steps: [
        { caption: "Royalty streams compute live from the creator-economy substrate." },
        { caption: "Tier pricing applies per-DTU and per-creator overrides." },
        { caption: "Creator score surfaces from substrate metrics \u2014 not a vanity number." },
      ],
    },
  },
  {
    domain: 'federation',
    label: 'Federation',
    artifacts: ['federated_signal', 'shadow_dtu', 'remote_node', 'sync_log', 'federation_token'],
    macros: { list: 'lens.federation.list', get: 'lens.federation.get', create: 'lens.federation.create', update: 'lens.federation.update', delete: 'lens.federation.delete', run: 'lens.federation.run', export: 'lens.federation.export' },
    exports: ['json'],
    actions: ['export_shadows', 'import_shadows', 'verify_token', 'list_remote_nodes', 'sync'],
    category: 'system',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Federate with peers.",
      caption: "Federated signals, shadow DTUs, remote nodes, sync logs, tokens \u2014 the seven-layer mesh.",
      firstActionLabel: "List remote nodes",
    },
    firstRunGuide: {
      steps: [
        { caption: "export_shadows ships your public timeline to federation peers." },
        { caption: "import_shadows ingests their signals into your NPC oracle context." },
        { caption: "verify_token gates federated reads behind the optional bearer." },
      ],
    },
  },
  {
    domain: 'genesis',
    label: 'Genesis',
    artifacts: ['emergent_identity', 'birth_event', 'lineage', 'feed_event', 'legendary_skill'],
    macros: { list: 'lens.genesis.list', get: 'lens.genesis.get', create: 'lens.genesis.create', update: 'lens.genesis.update', delete: 'lens.genesis.delete', run: 'lens.genesis.run', export: 'lens.genesis.export' },
    exports: ['json'],
    actions: ['list_emergents', 'recent_feed', 'legendary_skills', 'subscribe_activity', 'name_emergent'],
    category: 'social',
    dataTier: 'SIM_GRADE_A',
    emptyState: {
      headline: "Watch identities emerge.",
      caption: "Emergent identities, birth events, lineages, legendary skills \u2014 the substrate's social formation layer.",
      firstActionLabel: "List emergents",
    },
    firstRunGuide: {
      steps: [
        { caption: "recent_feed surfaces birth + lineage events live." },
        { caption: "legendary_skills surfaces the rarest patterns substrate-wide." },
        { caption: "name_emergent lets you witness + name a new identity." },
      ],
    },
  },
  {
    domain: 'black-market',
    label: 'Black Market',
    artifacts: ['gray_listing', 'anon_offer', 'reputation_bond', 'escrow', 'audit_trail'],
    macros: { list: 'lens.black-market.list', get: 'lens.black-market.get', create: 'lens.black-market.create', update: 'lens.black-market.update', delete: 'lens.black-market.delete', run: 'lens.black-market.run', export: 'lens.black-market.export' },
    exports: ['json', 'csv'],
    actions: ['list_gray', 'place_anon_offer', 'verify_reputation', 'release_escrow', 'audit'],
    category: 'finance',
    dataTier: 'SIM_GRADE_A',
    emptyState: {
      headline: "Anonymous marketplace.",
      caption: "Gray listings, anon offers, reputation bonds, escrow, audit trail \u2014 privacy-first commerce.",
      firstActionLabel: "Browse the market",
    },
    firstRunGuide: {
      steps: [
        { caption: "Anon offers route through provenance-checked masking." },
        { caption: "Reputation bonds back every listing." },
        { caption: "Escrow + audit trail keep everyone honest." },
      ],
    },
  },
  {
    domain: 'world-creator',
    label: 'World Creator',
    artifacts: ['world_seed', 'lore_template', 'faction_template', 'npc_archetype', 'anomaly'],
    macros: { list: 'lens.world-creator.list', get: 'lens.world-creator.get', create: 'lens.world-creator.create', update: 'lens.world-creator.update', delete: 'lens.world-creator.delete', run: 'lens.world-creator.run', export: 'lens.world-creator.export' },
    exports: ['json'],
    actions: ['scaffold_world', 'seed_lore', 'spawn_faction', 'register_anomaly', 'preview'],
    category: 'creative',
    dataTier: 'SIM_GRADE_A',
    emptyState: {
      headline: "Create a world.",
      caption: "World seeds, lore templates, faction templates, NPC archetypes, anomalies.",
      firstActionLabel: "Scaffold a world",
    },
    firstRunGuide: {
      steps: [
        { caption: "scaffold_world drops a content/world/<name>/ directory the seeder picks up." },
        { caption: "seed_lore + spawn_faction author the world's beats." },
        { caption: "register_anomaly lets the world evolve over time." },
      ],
    },
  },
  {
    domain: 'root',
    label: 'Root (Glyph Algebra)',
    artifacts: ['glyph_expression', 'algebra_session', 'conversion_log'],
    macros: { list: 'lens.root.list', get: 'lens.root.get', create: 'lens.root.create', update: 'lens.root.update', delete: 'lens.root.delete', run: 'lens.root.run', export: 'lens.root.export' },
    exports: ['json'],
    actions: ['convert_to_base6', 'convert_to_decimal', 'glyph_add', 'glyph_multiply', 'compose'],
    category: 'system',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Base-6 glyph algebra.",
      caption: "Glyph expressions, algebra sessions, conversion logs \u2014 the actual algebra under the refusal field.",
      firstActionLabel: "Convert a number",
    },
    firstRunGuide: {
      steps: [
        { caption: "convert_to_base6 + convert_to_decimal round-trip any number." },
        { caption: "glyph_add + glyph_multiply compose expressions the substrate can act on." },
        { caption: "compose stitches a multi-glyph expression with full provenance." },
      ],
    },
  },
  {
    domain: 'settings',
    label: 'Settings',
    artifacts: ['preference', 'theme', 'integration', 'privacy_choice', 'session'],
    macros: { list: 'lens.settings.list', get: 'lens.settings.get', create: 'lens.settings.create', update: 'lens.settings.update', delete: 'lens.settings.delete', run: 'lens.settings.run', export: 'lens.settings.export' },
    exports: ['json'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'system',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "App settings.",
      caption: "Preferences, themes, integrations, privacy choices, sessions \u2014 analyze, generate, export.",
      firstActionLabel: "Open settings",
    },
    firstRunGuide: {
      steps: [
        { caption: "Themes + preferences sync via the substrate." },
        { caption: "Integrations log every connection." },
        { caption: "Privacy choices ride the consent substrate." },
      ],
    },
  },
  {
    domain: 'hub',
    label: 'Hub',
    artifacts: ['lens_card', 'category', 'recent_activity', 'recommendation', 'pinned_lens'],
    macros: { list: 'lens.hub.list', get: 'lens.hub.get', create: 'lens.hub.create', update: 'lens.hub.update', delete: 'lens.hub.delete', run: 'lens.hub.run', export: 'lens.hub.export' },
    exports: ['json'],
    actions: ['browse_lenses', 'pin_lens', 'unpin_lens', 'recent', 'recommend'],
    category: 'system',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Lens hub.",
      caption: "Lens cards, categories, recent activity, recommendations, pinned lenses \u2014 your home for all 232 lenses.",
      firstActionLabel: "Browse the hub",
    },
    firstRunGuide: {
      steps: [
        { caption: "Pin lenses you use often." },
        { caption: "Recent activity surfaces the last places you worked." },
        { caption: "Recommendations compose against your usage patterns." },
      ],
    },
  },
  {
    domain: 'world-creator/anomalies',
    label: 'World Anomalies',
    artifacts: ['anomaly', 'anomaly_kind_count', 'resolution_log', 'public_stats'],
    macros: { list: 'lens.world-creator/anomalies.list', get: 'lens.world-creator/anomalies.get', create: 'lens.world-creator/anomalies.create', update: 'lens.world-creator/anomalies.update', delete: 'lens.world-creator/anomalies.delete', run: 'lens.world-creator/anomalies.run', export: 'lens.world-creator/anomalies.export' },
    exports: ['json', 'csv'],
    actions: ['list_public_stats', 'list_for_creator', 'resolve', 'dismiss', 'audit'],
    category: 'system',
    dataTier: 'SIM_GRADE_A',
    emptyState: {
      headline: "Track world anomalies.",
      caption: "Anomalies, anomaly-kind counts, resolution logs, public stats.",
      firstActionLabel: "List anomalies",
    },
    firstRunGuide: {
      steps: [
        { caption: "list_public_stats surfaces the world's drift live." },
        { caption: "resolve files a resolution attempt that other creators can audit." },
        { caption: "dismiss flags an anomaly as intentional." },
      ],
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // SUBSTRATE-SURFACING LENSES (wire-the-Lost — late additions)
  // ═══════════════════════════════════════════════════════════════

  {
    domain: 'code-quality',
    label: 'Code Quality',
    artifacts: ['detector', 'finding', 'baseline', 'budget', 'history'],
    macros: { list: 'lens.code-quality.list', get: 'lens.code-quality.get', run: 'lens.code-quality.run', export: 'lens.code-quality.export' },
    exports: ['json', 'md'],
    actions: ['list_detectors', 'run_detector', 'run_all', 'baseline_diff', 'load_budget', 'history'],
    category: 'system',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Code quality.",
      caption: "Detectors, findings, baselines, budgets, history \u2014 analyze, run, baseline-diff.",
      firstActionLabel: "Run a detector",
    },
    firstRunGuide: {
      steps: [
        { caption: "list_detectors shows the full detector suite." },
        { caption: "baseline_diff surfaces regressions vs. the last clean run." },
        { caption: "load_budget enforces budgets in CI." },
      ],
    },
  },
  {
    domain: 'cognition',
    label: 'Cognition',
    artifacts: ['hlr_trace', 'hlm_topology', 'cluster', 'drift_alert', 'forgetting_event'],
    macros: { list: 'lens.cognition.list', get: 'lens.cognition.get', run: 'lens.cognition.run', export: 'lens.cognition.export' },
    exports: ['json'],
    actions: ['run_hlr', 'show_hlm', 'list_clusters', 'list_drift_alerts', 'forgetting_status'],
    category: 'system',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Cognition substrate.",
      caption: "HLR traces, HLM topology, clusters, drift alerts, forgetting events.",
      firstActionLabel: "Run HLR",
    },
    firstRunGuide: {
      steps: [
        { caption: "run_hlr executes any of the 7 reasoning modes against the substrate." },
        { caption: "show_hlm renders the topology of the high-level memory." },
        { caption: "list_drift_alerts surfaces what the lattice noticed." },
      ],
    },
  },
  {
    domain: 'forge',
    label: 'Forge',
    artifacts: ['template', 'section', 'generated_app', 'validation_report'],
    macros: { list: 'lens.forge.list', get: 'lens.forge.get', create: 'lens.forge.create', run: 'lens.forge.run', export: 'lens.forge.export' },
    exports: ['ts', 'zip', 'dockerfile'],
    actions: ['list_templates', 'list_sections', 'validate', 'generate', 'export_app', 'check_avoidance', 'repair_log'],
    category: 'creative',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: 'No Forge apps yet.',
      caption: 'Pick a template, fill the sections, and Forge generates a single-file polyglot app. Mint it to your marketplace stall.',
      firstActionLabel: 'Browse templates',
    },
    firstRunGuide: {
      steps: [
        { caption: 'Templates ship with section slots. Fill each slot with prose; Forge generates the matching code.' },
        { caption: 'Validate runs lint + repair before publish — the repair log surfaces any auto-fixes.' },
        { caption: 'Generated apps mint as DTUs and can list on the creative marketplace with royalty cascade.' },
      ],
    },
  },
  {
    domain: 'foundry',
    label: 'Foundry',
    artifacts: ['foundry_world', 'worldspec', 'system_registry'],
    macros: { list: 'lens.foundry.list', get: 'lens.foundry.get', create: 'lens.foundry.create', update: 'lens.foundry.update', delete: 'lens.foundry.delete', run: 'lens.foundry.run' },
    exports: ['json'],
    actions: ['systems', 'system_schema', 'validate_systems', 'create', 'update', 'get', 'list', 'delete', 'validate', 'publish', 'unpublish', 'preview', 'compose_rule', 'templates', 'marketplace', 'rate', 'analytics', 'multiplayer_set', 'asset_import', 'blueprint_save', 'playtest_start', 'collab_add'],
    category: 'creative',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Build a world from scratch.",
      caption: "Foundry worlds, world-specs, system registry \u2014 Phase 6+ world-builder substrate.",
      firstActionLabel: "Create a world",
    },
    firstRunGuide: {
      steps: [
        { caption: "systems surfaces every author-able system in the world." },
        { caption: "validate runs the world-spec checker before publish." },
        { caption: "publish ships the world; unpublish takes it back to draft." },
      ],
    },
  },
  {
    domain: 'kingdoms',
    label: 'Kingdoms',
    artifacts: ['kingdom', 'decree', 'contest', 'region'],
    macros: { list: 'lens.kingdoms.list', get: 'lens.kingdoms.get', create: 'lens.kingdoms.create', update: 'lens.kingdoms.update', delete: 'lens.kingdoms.delete', run: 'lens.kingdoms.run', export: 'lens.kingdoms.export' },
    exports: ['json'],
    actions: ['list_kingdoms', 'view_kingdom', 'compose_decree', 'contest_decree', 'view_minimap'],
    category: 'social',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: 'No kingdoms yet.',
      caption: 'Found a realm, issue decrees, rally war campaigns. The CK3-port substrate runs strategy cycles every ~50 minutes.',
      firstActionLabel: 'Found a kingdom',
    },
    firstRunGuide: {
      steps: [
        { caption: 'Decrees affect loyalty + tax + military across citizens. The kingdom-decree-cycle heartbeat enforces effects every 16 ticks.' },
        { caption: 'War campaigns persist server-side via war_campaigns table — they survive restarts and run their own resolution cycle.' },
        { caption: 'view_minimap renders territory polygons; contest_decree lets rivals challenge through the faction-strategy cycle.' },
      ],
    },
  },
  {
    domain: 'lattice',
    label: 'Lattice',
    artifacts: ['training_session', 'consent_grant', 'pipeline_run', 'drift_scan'],
    macros: { list: 'lens.lattice.list', get: 'lens.lattice.get', run: 'lens.lattice.run', export: 'lens.lattice.export' },
    exports: ['json'],
    actions: ['training_status', 'grant_consent', 'revoke_consent', 'run_pipeline', 'view_drift'],
    category: 'system',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Training + consent.",
      caption: "Training sessions, consent grants, pipeline runs, drift scans \u2014 the lattice substrate.",
      firstActionLabel: "View training status",
    },
    firstRunGuide: {
      steps: [
        { caption: "grant_consent + revoke_consent control your data participation per session." },
        { caption: "run_pipeline kicks off the lattice training run with your consented DTUs." },
        { caption: "view_drift surfaces what the lattice noticed about its own behavior." },
      ],
    },
  },
  {
    domain: 'maker',
    label: 'Maker',
    artifacts: ['app', 'quest', 'creative_asset'],
    macros: { list: 'lens.maker.list', get: 'lens.maker.get', create: 'lens.maker.create', update: 'lens.maker.update', delete: 'lens.maker.delete', run: 'lens.maker.run', export: 'lens.maker.export' },
    exports: ['json', 'zip'],
    actions: ['build_app', 'compose_quest', 'creative_generate'],
    category: 'creative',
    dataTier: 'SIM_GRADE_A',
    emptyState: {
      headline: "Make something.",
      caption: "Apps, quests, creative assets \u2014 build_app, compose_quest, creative_generate.",
      firstActionLabel: "Start making",
    },
    firstRunGuide: {
      steps: [
        { caption: "build_app composes a working app from a prompt + substrate." },
        { caption: "compose_quest authors a quest playable in Concordia." },
        { caption: "creative_generate composes art / music / story bundles." },
      ],
    },
  },
  {
    domain: 'mesh',
    label: 'Mesh',
    artifacts: ['transport', 'route', 'frame', 'peer'],
    macros: { list: 'lens.mesh.list', get: 'lens.mesh.get', run: 'lens.mesh.run', export: 'lens.mesh.export' },
    exports: ['json'],
    actions: ['list_transports', 'route_status', 'send_frame', 'peer_discovery'],
    category: 'system',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Seven-layer mesh.",
      caption: "Transports, routes, frames, peers \u2014 the mesh networking substrate.",
      firstActionLabel: "List transports",
    },
    firstRunGuide: {
      steps: [
        { caption: "list_transports shows BLE / WiFi P2P / NFC / TCP active layers." },
        { caption: "route_status surfaces live routing across peers." },
        { caption: "peer_discovery shows everyone reachable on the mesh." },
      ],
    },
  },
  {
    domain: 'message',
    label: 'Message',
    artifacts: ['conversation', 'message', 'thread', 'attachment'],
    macros: { list: 'lens.message.list', get: 'lens.message.get', create: 'lens.message.create', update: 'lens.message.update', delete: 'lens.message.delete', run: 'lens.message.run', export: 'lens.message.export' },
    exports: ['json', 'md'],
    actions: ['send_dm', 'list_threads', 'mark_read', 'archive', 'search_messages'],
    category: 'social',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: 'Inbox empty.',
      caption: 'DMs, Concord-Link messages, and federation traffic land here. Start a thread or wait for the first ping.',
      firstActionLabel: 'Start a new message',
    },
    firstRunGuide: {
      steps: [
        { caption: 'Threads list in the left rail; the right pane shows the active conversation in the inbox view.' },
        { caption: 'Mark as read, archive, or search — all mutations write to the substrate; offline edits queue and replay.' },
        { caption: 'Channels routed through Concord-Mesh fall back to BLE / WiFi-Direct when offline.' },
      ],
    },
  },
  {
    domain: 'ops',
    label: 'Ops',
    artifacts: ['dtu_op', 'attention_alloc', 'repair_event', 'physical_state', 'explore_run', 'forge_run', 'cortex_run', 'lattice_run'],
    macros: { list: 'lens.ops.list', get: 'lens.ops.get', run: 'lens.ops.run', export: 'lens.ops.export' },
    exports: ['json'],
    actions: ['dtu_metrics', 'attention_status', 'repair_recent', 'physical_status', 'explore_recent', 'forge_recent', 'cortex_recent', 'lattice_recent'],
    category: 'system',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Substrate ops.",
      caption: "DTU ops, attention allocation, repair events, physical state, explore/forge/cortex/lattice runs.",
      firstActionLabel: "Open the dashboard",
    },
    firstRunGuide: {
      steps: [
        { caption: "dtu_metrics surfaces live consolidation + compression rates." },
        { caption: "attention_status shows what the brains are working on right now." },
        { caption: "repair_recent surfaces what the repair brain has fixed in the last hour." },
      ],
    },
  },
  {
    domain: 'productivity',
    label: 'Productivity',
    artifacts: ['notebook', 'spreadsheet', 'diagram', 'mindmap', 'outline', 'slides'],
    macros: { list: 'lens.productivity.list', get: 'lens.productivity.get', create: 'lens.productivity.create', update: 'lens.productivity.update', delete: 'lens.productivity.delete', run: 'lens.productivity.run', export: 'lens.productivity.export' },
    exports: ['json', 'md', 'pdf', 'svg'],
    actions: ['create_notebook', 'create_sheet', 'render_diagram', 'create_mindmap', 'create_outline', 'create_slides'],
    category: 'productivity',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Productivity suite.",
      caption: "Notebooks, spreadsheets, diagrams, mindmaps, outlines, slides.",
      firstActionLabel: "Create your first artifact",
    },
    firstRunGuide: {
      steps: [
        { caption: "create_notebook spins up a Jupyter-shape notebook against the substrate." },
        { caption: "create_sheet + create_slides emit shareable artifacts." },
        { caption: "render_diagram composes Mermaid / Graphviz from natural language." },
      ],
    },
  },
  {
    domain: 'sandbox',
    label: 'Combat Sandbox',
    artifacts: ['arena', 'training_dummy', 'combat_run'],
    macros: { list: 'lens.sandbox.list', get: 'lens.sandbox.get', run: 'lens.sandbox.run', export: 'lens.sandbox.export' },
    exports: ['json'],
    actions: ['spawn_dummies', 'reset_arena', 'record_run', 'replay_run'],
    category: 'creative',
    dataTier: 'SIM_GRADE_A',
    emptyState: {
      headline: "Combat sandbox.",
      caption: "Arenas, training dummies, combat runs \u2014 replay anything.",
      firstActionLabel: "Spawn dummies",
    },
    firstRunGuide: {
      steps: [
        { caption: "spawn_dummies fills the arena with archetypes you can fight." },
        { caption: "reset_arena clears state without losing the recording." },
        { caption: "replay_run scrubs through any past fight." },
      ],
    },
  },
  {
    domain: 'self',
    label: 'Self',
    artifacts: ['fitness_log', 'sleep_log', 'mood_log', 'journal_entry', 'meditation_session'],
    macros: { list: 'lens.self.list', get: 'lens.self.get', create: 'lens.self.create', update: 'lens.self.update', delete: 'lens.self.delete', run: 'lens.self.run', export: 'lens.self.export' },
    exports: ['json', 'md'],
    actions: ['log_fitness', 'log_sleep', 'log_mood', 'add_journal_entry', 'log_meditation', 'view_trends'],
    category: 'lifestyle',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: 'Your self log is empty.',
      caption: 'Log fitness, sleep, mood, journal entries, meditation. The trends view rolls up across all five streams to surface patterns.',
      firstActionLabel: 'Add your first entry',
    },
    firstRunGuide: {
      steps: [
        { caption: 'Five log kinds (fitness / sleep / mood / journal / meditation). Each is a private DTU you own.' },
        { caption: 'view_trends rolls weeks of data into a single mood vs. sleep vs. workout overlay.' },
        { caption: 'Journal entries can cite DTUs from any other lens — your self-reflection lives in the same substrate as your work.' },
      ],
    },
  },
  {
    domain: 'meditation',
    label: 'Meditation',
    artifacts: ['session', 'track', 'course', 'reminder', 'mood_checkin', 'milestone'],
    macros: { list: 'lens.meditation.list', get: 'lens.meditation.get', run: 'lens.meditation.run', export: 'lens.meditation.export' },
    exports: ['json'],
    actions: ['play', 'sessionLog', 'breathwork', 'mood-checkin', 'enrollCourse', 'completeCourseDay', 'setReminder', 'recommendations'],
    category: 'lifestyle',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: 'Begin your practice.',
      caption: 'Pick a track, run a breathwork pattern, log a session. Streaks, courses, and mood check-ins build your practice substrate.',
      firstActionLabel: 'Start a session',
    },
    firstRunGuide: {
      steps: [
        { caption: 'Pick a track or breathwork pattern from the library and play it through.' },
        { caption: 'Log each session — streaks and milestones roll up automatically.' },
        { caption: 'mood-checkin pairs your practice with how you feel; recommendations adapt over time.' },
      ],
    },
  },
  {
    domain: 'sentinel',
    label: 'Sentinel',
    artifacts: ['intel_report', 'shield_event', 'semantic_alert'],
    macros: { list: 'lens.sentinel.list', get: 'lens.sentinel.get', run: 'lens.sentinel.run', export: 'lens.sentinel.export' },
    exports: ['json'],
    actions: ['intel_status', 'shield_status', 'semantic_status', 'list_alerts'],
    category: 'system',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Security sentinel.",
      caption: "Intel reports, shield events, semantic alerts \u2014 the security substrate.",
      firstActionLabel: "View status",
    },
    firstRunGuide: {
      steps: [
        { caption: "intel_status surfaces what sentinel has detected." },
        { caption: "shield_status shows active defenses." },
        { caption: "semantic_status flags semantic attacks (prompt injection, supply chain)." },
      ],
    },
  },
  {
    domain: 'society',
    label: 'Society',
    artifacts: ['culture_signal', 'entity_economy_row', 'autonomy_event', 'conflict', 'teaching_session', 'persona'],
    macros: { list: 'lens.society.list', get: 'lens.society.get', run: 'lens.society.run', export: 'lens.society.export' },
    exports: ['json'],
    actions: ['culture_metrics', 'entity_economy_status', 'autonomy_recent', 'conflict_status', 'teaching_status', 'list_personas'],
    category: 'social',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Society substrate.",
      caption: "Culture signals, entity economy, autonomy, conflicts, teaching sessions, personas.",
      firstActionLabel: "View culture metrics",
    },
    firstRunGuide: {
      steps: [
        { caption: "culture_metrics surfaces drift across the active population." },
        { caption: "autonomy_recent shows agents acting on their own initiative." },
        { caption: "list_personas surfaces every shaped identity in the system." },
      ],
    },
  },
  {
    domain: 'system',
    label: 'System',
    artifacts: ['cartograph', 'system_node', 'cross_ref', 'health_metric'],
    macros: { list: 'lens.system.list', get: 'lens.system.get', run: 'lens.system.run', export: 'lens.system.export' },
    exports: ['json', 'md'],
    actions: ['cartograph', 'list_nodes', 'show_cross_refs', 'health_status'],
    category: 'system',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "System cartograph.",
      caption: "Cartograph, system nodes, cross refs, health metrics \u2014 see the whole monolith at once.",
      firstActionLabel: "Generate the cartograph",
    },
    firstRunGuide: {
      steps: [
        { caption: "cartograph runs the same static analysis as `npm run cartograph:static`." },
        { caption: "show_cross_refs surfaces which routes call which macros." },
        { caption: "health_status surfaces per-subsystem heartbeat health." },
      ],
    },
  },
  {
    domain: 'tools',
    label: 'Tools',
    artifacts: ['research_run', 'build_artifact', 'signature_request'],
    macros: { list: 'lens.tools.list', get: 'lens.tools.get', run: 'lens.tools.run', export: 'lens.tools.export' },
    exports: ['json', 'pdf'],
    actions: ['web_research', 'compile_build', 'request_signature'],
    category: 'productivity',
    dataTier: 'SIM_GRADE_A',
    emptyState: {
      headline: "Power tools.",
      caption: "Research runs, build artifacts, signature requests \u2014 the tool substrate.",
      firstActionLabel: "Open the toolbox",
    },
    firstRunGuide: {
      steps: [
        { caption: "web_research runs the deep research pipeline with citations." },
        { caption: "compile_build kicks a build against your active codebase." },
        { caption: "request_signature gates an action behind a sign-off." },
      ],
    },
  },
  {
    domain: 'tournaments',
    label: 'Tournaments',
    artifacts: ['tournament', 'bracket', 'match', 'roster'],
    macros: { list: 'lens.tournaments.list', get: 'lens.tournaments.get', create: 'lens.tournaments.create', update: 'lens.tournaments.update', delete: 'lens.tournaments.delete', run: 'lens.tournaments.run', export: 'lens.tournaments.export' },
    exports: ['json'],
    actions: ['list_tournaments', 'view_bracket', 'register_player', 'submit_result', 'organize_tournament'],
    category: 'social',
    dataTier: 'SIM_GRADE_A',
    emptyState: {
      headline: "Run tournaments.",
      caption: "Tournaments, brackets, matches, rosters \u2014 list, organize, register, submit.",
      firstActionLabel: "Browse tournaments",
    },
    firstRunGuide: {
      steps: [
        { caption: "register_player ties to your existing profile + skill substrate." },
        { caption: "submit_result auto-advances the bracket." },
        { caption: "organize_tournament authors a tournament from a template." },
      ],
    },
  },
  {
    domain: 'ux-suite',
    label: 'UX Suite',
    artifacts: ['component', 'preset', 'demo', 'tab-visit'],
    macros: {
      list:   'lens.ux-suite.list',
      get:    'lens.ux-suite.get',
      create: 'lens.ux-suite.create',
      update: 'lens.ux-suite.update',
      delete: 'lens.ux-suite.delete',
      run:    'lens.ux-suite.run',
      export: 'lens.ux-suite.export',
    },
    exports: ['json'],
    actions: ['list_components', 'render_demo', 'apply_preset', 'record_visit'],
    category: 'system',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Browse the UX suite.",
      caption: "20 absorbed components \u2014 Settings, Progress, World, Ops, Shell tabs.",
      firstActionLabel: "Browse components",
    },
    firstRunGuide: {
      steps: [
        { caption: "list_components surfaces every absorbed UX component." },
        { caption: "render_demo previews any component with sensible mock props." },
        { caption: "apply_preset re-themes the active demo." },
      ],
    },
  },
  {
    domain: 'worldmodel',
    label: 'Worldmodel',
    artifacts: ['scenario', 'simulation_run', 'forecast', 'counterfactual'],
    macros: { list: 'lens.worldmodel.list', get: 'lens.worldmodel.get', create: 'lens.worldmodel.create', run: 'lens.worldmodel.run', export: 'lens.worldmodel.export' },
    exports: ['json', 'csv'],
    actions: ['create_scenario', 'run_simulation', 'view_forecast', 'compare_counterfactuals'],
    category: 'system',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Run scenarios.",
      caption: "Scenarios, simulation runs, forecasts, counterfactuals \u2014 the world-model engine.",
      firstActionLabel: "Create a scenario",
    },
    firstRunGuide: {
      steps: [
        { caption: "run_simulation drops your scenario through the world-model engine." },
        { caption: "view_forecast renders the probability bands." },
        { caption: "compare_counterfactuals diffs two world-model runs." },
      ],
    },
  },
  {
    domain: 'social',
    label: 'Social',
    artifacts: ['post', 'story', 'reaction', 'notification', 'follow', 'profile'],
    macros: { list: 'lens.social.list', get: 'lens.social.get', create: 'lens.social.create', update: 'lens.social.update', delete: 'lens.social.delete', run: 'lens.social.run', export: 'lens.social.export' },
    exports: ['json'],
    actions: ['follow', 'unfollow', 'react', 'comment', 'share', 'post', 'story_create', 'discover', 'notifications', 'trending'],
    category: 'social',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "Your pan-social hub.",
      caption: "Stories, discovery, notifications, presence, trending — every Concord-native social primitive in one place. Real activity from real follows.",
      firstActionLabel: "Open social hub",
    },
    firstRunGuide: {
      steps: [
        { caption: "The Stories bar at the top shows 24h ephemeral updates from people you follow. Tap to view full-screen." },
        { caption: "For You is your algorithmic discover feed (cross-domain). Following is reverse-chrono activity from your follow graph." },
        { caption: "Right rail surfaces your profile, trending topics + domains, suggested follows, and live presence — all from the same substrate as chat / feed." },
      ],
    },
  },
  {
    domain: 'sessions',
    label: 'Sessions',
    artifacts: ['session', 'session_event'],
    macros: { list: 'lens.sessions.list', get: 'lens.sessions.get', create: 'lens.sessions.create', update: 'lens.sessions.update', delete: 'lens.sessions.delete', run: 'lens.sessions.run', export: 'lens.sessions.export' },
    exports: ['json'],
    actions: ['start', 'advance', 'update_state', 'list_mine', 'get', 'close'],
    category: 'productivity',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "No sessions yet.",
      caption: "Sessions persist multi-step work across visits — open a kingdoms war campaign, a research arc, a podcast season. Real, resumable.",
      firstActionLabel: "Browse session-aware lenses",
    },
    firstRunGuide: {
      steps: [
        { caption: "Every session belongs to a user and a lens. State is opaque JSON the lens owns." },
        { caption: "Filter by status (open / paused / completed / abandoned); each row shows live step + transition count." },
        { caption: "Resume jumps back to the owning lens; Complete or Abandon closes the session and emits a final event." },
      ],
    },
  },
  {
    domain: 'dx-platform',
    label: 'DX Platform',
    artifacts: ['codebase', 'finding', 'repair_proposal', 'usage_row', 'quota'],
    macros: { list: 'lens.dx-platform.list', get: 'lens.dx-platform.get', run: 'lens.dx-platform.run', export: 'lens.dx-platform.export' },
    exports: ['json', 'csv'],
    actions: ['register_codebase', 'run_detectors', 'view_billing', 'top_up_wallet', 'web_editor_demo', 'record_fix_decision'],
    category: 'system',
    dataTier: 'REAL_LIVE',
    emptyState: {
      headline: "DX platform ops.",
      caption: "Codebases, findings, repair proposals, usage rows, quotas \u2014 the DX substrate.",
      firstActionLabel: "Register your codebase",
    },
    firstRunGuide: {
      steps: [
        { caption: "run_detectors runs the full detector suite on your codebase." },
        { caption: "record_fix_decision captures whether you accepted a repair proposal." },
        { caption: "view_billing + top_up_wallet manage your DX quota." },
      ],
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // Sprint 17 / Phase 8 / Phase 9 lenses missing manifest entries.
  // Each is mounted as a frontend route but the lensId was not yet
  // registered for the ESLint lens-manifest validator. Minimal entry
  // = domain + label + artifacts + category, macros default to the
  // standard lens.<domain>.* shape.
  // ═══════════════════════════════════════════════════════════════

  // Macros follow the canonical lens.<domain>.<op> namespace contract.
  // The names are stable namespaces — they don't require a handler at the
  // exact name; the runMacro dispatcher resolves to the actual backend.
  { domain: 'cognitive-replay', label: 'Cognitive Replay', artifacts: ['timeline_event', 'replay_segment'], macros: { list: 'lens.cognitive-replay.list', get: 'lens.cognitive-replay.get', create: 'lens.cognitive-replay.create', update: 'lens.cognitive-replay.update', delete: 'lens.cognitive-replay.delete', run: 'lens.cognitive-replay.run', export: 'lens.cognitive-replay.export' }, exports: ['json'], actions: ['scrub', 'export'], category: 'knowledge' },
  { domain: 'classroom', label: 'Classroom', artifacts: ['homework_submission', 'peer_review', 'academic_transcript'], macros: { list: 'lens.classroom.list', get: 'lens.classroom.get', create: 'lens.classroom.create', update: 'lens.classroom.update', delete: 'lens.classroom.delete', run: 'lens.classroom.run', export: 'lens.classroom.export' }, exports: ['json', 'pdf'], actions: ['enrol', 'submit_homework', 'peer_review', 'transcript'], category: 'knowledge' },
  { domain: 'byo-keys', label: 'BYO API Keys', artifacts: ['api_key_grant'], macros: { list: 'lens.byo-keys.list', get: 'lens.byo-keys.get', create: 'lens.byo-keys.create', update: 'lens.byo-keys.update', delete: 'lens.byo-keys.delete', run: 'lens.byo-keys.run', export: 'lens.byo-keys.export' }, exports: ['json'], actions: ['add_key', 'remove_key', 'test_key'], category: 'system' },
  { domain: 'bounties', label: 'Bounties', artifacts: ['bounty_stake', 'autofix_proposal'], macros: { list: 'lens.bounties.list', get: 'lens.bounties.get', create: 'lens.bounties.create', update: 'lens.bounties.update', delete: 'lens.bounties.delete', run: 'lens.bounties.run', export: 'lens.bounties.export' }, exports: ['json'], actions: ['stake', 'vote', 'resolve'], category: 'social' },
  { domain: 'death-insurance', label: 'Death-Lottery Insurance', artifacts: ['insurance_contract'], macros: { list: 'lens.death-insurance.list', get: 'lens.death-insurance.get', create: 'lens.death-insurance.create', update: 'lens.death-insurance.update', delete: 'lens.death-insurance.delete', run: 'lens.death-insurance.run', export: 'lens.death-insurance.export' }, exports: ['json'], actions: ['write_contract', 'claim'], category: 'social' },
  { domain: 'deities', label: 'Deities', artifacts: ['player_deity', 'pilgrimage'], macros: { list: 'lens.deities.list', get: 'lens.deities.get', create: 'lens.deities.create', update: 'lens.deities.update', delete: 'lens.deities.delete', run: 'lens.deities.run', export: 'lens.deities.export' }, exports: ['json'], actions: ['compose', 'pilgrimage'], category: 'social' },
  { domain: 'dreams', label: 'Dreams', artifacts: ['dream'], macros: { list: 'lens.dreams.list', get: 'lens.dreams.get', create: 'lens.dreams.create', update: 'lens.dreams.update', delete: 'lens.dreams.delete', run: 'lens.dreams.run', export: 'lens.dreams.export' }, exports: ['json'], actions: ['publish', 'browse'], category: 'knowledge' },
  { domain: 'event-timeline', label: 'Event Timeline', artifacts: ['timeline_event'], macros: { list: 'lens.event-timeline.list', get: 'lens.event-timeline.get', create: 'lens.event-timeline.create', update: 'lens.event-timeline.update', delete: 'lens.event-timeline.delete', run: 'lens.event-timeline.run', export: 'lens.event-timeline.export' }, exports: ['json'], actions: ['scrub', 'export'], category: 'social' },
  { domain: 'expert-mode', label: 'Expert Mode', artifacts: ['expert_query', 'research_session'], macros: { list: 'lens.expert-mode.list', get: 'lens.expert-mode.get', create: 'lens.expert-mode.create', update: 'lens.expert-mode.update', delete: 'lens.expert-mode.delete', run: 'lens.expert-mode.run', export: 'lens.expert-mode.export' }, exports: ['json', 'md'], actions: ['query', 'export_session'], category: 'system' },
  { domain: 'forecast', label: 'World Forecast', artifacts: ['world_forecast'], macros: { list: 'lens.forecast.list', get: 'lens.forecast.get', create: 'lens.forecast.create', update: 'lens.forecast.update', delete: 'lens.forecast.delete', run: 'lens.forecast.run', export: 'lens.forecast.export' }, exports: ['json'], actions: ['view', 'share'], category: 'social' },
  { domain: 'gallery', label: 'Compression Art Gallery', artifacts: ['compression_art_sigil', 'mega_dtu'], macros: { list: 'lens.gallery.list', get: 'lens.gallery.get', create: 'lens.gallery.create', update: 'lens.gallery.update', delete: 'lens.gallery.delete', run: 'lens.gallery.run', export: 'lens.gallery.export' }, exports: ['json', 'svg'], actions: ['view', 'mint'], category: 'creative' },
  { domain: 'goddess', label: 'Goddess Broadcast', artifacts: ['goddess_dispatch'], macros: { list: 'lens.goddess.list', get: 'lens.goddess.get', create: 'lens.goddess.create', update: 'lens.goddess.update', delete: 'lens.goddess.delete', run: 'lens.goddess.run', export: 'lens.goddess.export' }, exports: ['json'], actions: ['listen', 'subscribe'], category: 'social' },
  { domain: 'inheritance', label: 'NPC Inheritance Market', artifacts: ['npc_inheritance_link'], macros: { list: 'lens.inheritance.list', get: 'lens.inheritance.get', create: 'lens.inheritance.create', update: 'lens.inheritance.update', delete: 'lens.inheritance.delete', run: 'lens.inheritance.run', export: 'lens.inheritance.export' }, exports: ['json'], actions: ['browse', 'lock_heir'], category: 'social' },
  { domain: 'markets', label: 'Prediction Markets', artifacts: ['prediction_market', 'market_position'], macros: { list: 'lens.markets.list', get: 'lens.markets.get', create: 'lens.markets.create', update: 'lens.markets.update', delete: 'lens.markets.delete', run: 'lens.markets.run', export: 'lens.markets.export' }, exports: ['json'], actions: ['open_market', 'place_bet'], category: 'social' },
  { domain: 'observe', label: 'Observer Mode', artifacts: ['empirical_report'], macros: { list: 'lens.observe.list', get: 'lens.observe.get', create: 'lens.observe.create', update: 'lens.observe.update', delete: 'lens.observe.delete', run: 'lens.observe.run', export: 'lens.observe.export' }, exports: ['json', 'md'], actions: ['compose_report'], category: 'knowledge' },
  { domain: 'personas', label: 'NPC Persona Marketplace', artifacts: ['npc_persona'], macros: { list: 'lens.personas.list', get: 'lens.personas.get', create: 'lens.personas.create', update: 'lens.personas.update', delete: 'lens.personas.delete', run: 'lens.personas.run', export: 'lens.personas.export' }, exports: ['json'], actions: ['package', 'import'], category: 'creative' },
  { domain: 'psyops', label: 'NPC Psyops Detector', artifacts: ['skill_revision_anomaly'], macros: { list: 'lens.psyops.list', get: 'lens.psyops.get', create: 'lens.psyops.create', update: 'lens.psyops.update', delete: 'lens.psyops.delete', run: 'lens.psyops.run', export: 'lens.psyops.export' }, exports: ['json'], actions: ['investigate', 'quarantine'], category: 'system' },
  { domain: 'sponsorship', label: 'NPC Sponsorship', artifacts: ['npc_sponsorship', 'npc_dispatch'], macros: { list: 'lens.sponsorship.list', get: 'lens.sponsorship.get', create: 'lens.sponsorship.create', update: 'lens.sponsorship.update', delete: 'lens.sponsorship.delete', run: 'lens.sponsorship.run', export: 'lens.sponsorship.export' }, exports: ['json'], actions: ['sponsor', 'cancel'], category: 'social' },
  { domain: 'schemes', label: 'Schemes', artifacts: ['npc_scheme', 'hook_artifact'], macros: { list: 'lens.schemes.list', get: 'lens.schemes.get', create: 'lens.schemes.create', update: 'lens.schemes.update', delete: 'lens.schemes.delete', run: 'lens.schemes.run', export: 'lens.schemes.export' }, exports: ['json'], actions: ['propose', 'gather_evidence', 'move', 'abandon', 'discover_evidence'], category: 'social' },
  { domain: 'staking', label: 'CC Staking', artifacts: ['cc_stake'], macros: { list: 'lens.staking.list', get: 'lens.staking.get', create: 'lens.staking.create', update: 'lens.staking.update', delete: 'lens.staking.delete', run: 'lens.staking.run', export: 'lens.staking.export' }, exports: ['json'], actions: ['stake', 'redeem'], category: 'finance' },
  { domain: 'sub-worlds', label: 'Sub-Worlds (Research Zones)', artifacts: ['sub_world'], macros: { list: 'lens.sub-worlds.list', get: 'lens.sub-worlds.get', create: 'lens.sub-worlds.create', update: 'lens.sub-worlds.update', delete: 'lens.sub-worlds.delete', run: 'lens.sub-worlds.run', export: 'lens.sub-worlds.export' }, exports: ['json'], actions: ['spawn', 'travel'], category: 'knowledge' },
  { domain: 'sync', label: 'Cross-Device Sync', artifacts: ['sync_session'], macros: { list: 'lens.sync.list', get: 'lens.sync.get', create: 'lens.sync.create', update: 'lens.sync.update', delete: 'lens.sync.delete', run: 'lens.sync.run', export: 'lens.sync.export' }, exports: ['json'], actions: ['enable', 'sync'], category: 'system' },
  { domain: 'wellness', label: 'Refusal Field Wellness', artifacts: ['active_refusal_field'], macros: { list: 'lens.wellness.list', get: 'lens.wellness.get', create: 'lens.wellness.create', update: 'lens.wellness.update', delete: 'lens.wellness.delete', run: 'lens.wellness.run', export: 'lens.wellness.export' }, exports: ['json'], actions: ['view', 'disable'], category: 'lifestyle' },
  // Phase V — game-mode dispatch targets.
  { domain: 'crisis-ops', label: 'Crisis Ops', artifacts: ['world_crisis', 'skill_recommendation'], macros: { list: 'lens.crisis-ops.list', get: 'lens.crisis-ops.get', run: 'lens.crisis-ops.run' }, exports: ['json'], actions: ['active_for_player', 'resolve'], category: 'social' },
  { domain: 'expedition-journal', label: 'Expedition Journal', artifacts: ['expedition_stage'], macros: { list: 'lens.expedition-journal.list', get: 'lens.expedition-journal.get', run: 'lens.expedition-journal.run' }, exports: ['json'], actions: ['advance_stage', 'mark_visited'], category: 'knowledge' },
  { domain: 'ghost-tracker', label: 'Ghost Tracker', artifacts: ['drift_alert', 'ghost_residue'], macros: { list: 'lens.ghost-tracker.list', get: 'lens.ghost-tracker.get', run: 'lens.ghost-tracker.run' }, exports: ['json'], actions: ['residues', 'confront'], category: 'knowledge' },
  // Phase 5 — cross-lens multi-step workflow session index.
  {
    domain: 'sessions',
    label: 'Sessions',
    artifacts: ['lens_session'],
    macros: { list: 'lens.sessions.list', get: 'lens.sessions.get', run: 'lens.sessions.run' },
    exports: ['json'],
    actions: ['search', 'pause', 'resume', 'rename', 'annotate', 'detail', 'stale', 'bulk_close'],
    category: 'productivity',
    dataTier: 'REAL_LIVE',
    sessionTable: 'lens_sessions',
    emptyState: {
      headline: 'No sessions yet.',
      caption: 'Sessions persist multi-step work across visits — open a war campaign in kingdoms, a research arc in paper. Visit any session-aware lens to start one.',
      firstActionLabel: 'Browse lenses',
    },
    firstRunGuide: {
      steps: [
        { caption: 'Every session-aware lens records its multi-step state here so you can leave and resume across days.' },
        { caption: 'Filter by status, search by lens or title, and open a session to see its full step-transition timeline.' },
        { caption: 'Pause idle work, rename sessions, annotate them, and bulk-close abandoned ones in one sweep.' },
      ],
    },
  },

  {
    domain: 'forecast',
    label: 'Forecast',
    artifacts: ['world_forecast'],
    macros: { list: 'lens.forecast.list', get: 'lens.forecast.get', run: 'lens.forecast.run' },
    exports: ['json'],
    actions: ['compose', 'recent', 'multiDay', 'hourly', 'regional', 'accuracy', 'archive', 'subscribeAlert', 'listAlerts', 'unsubscribeAlert', 'checkAlerts'],
    category: 'knowledge',
    dataTier: 'SIM_GRADE_A',
    emptyState: {
      headline: 'No forecast yet.',
      caption: 'Compose a 24-hour world outlook from forward-sim, drift, faction strategy, and embodied climate baselines. Then extend it to multi-day, hourly, or per-district views.',
      firstActionLabel: 'Compose forecast',
      firstActionMacro: { name: 'compose', input: { worldId: 'concordia-hub', persist: true } },
    },
    firstRunGuide: {
      steps: [
        { caption: 'Compose a forecast — it folds the live simulation state into a 24h weather + ecology + faction + drift outlook.' },
        { caption: 'Switch to the multi-day, hourly, or per-district tabs. Confidence honestly decays the further out you look.' },
        { caption: 'Subscribe to alerts so a high-confidence severe event, drift, or weather kind surfaces the moment it is predicted.' },
      ],
    },
  },

  // ── Living-world + game/utility lens registrations ─────────────────────────
  // Minimal manifest entries so these real lens pages are recognised by the
  // lens-manifest lint rule and the generic shell can resolve their id. Each
  // lens drives its own custom page; macros follow the lens.<domain>.* convention.
  { domain: 'achievements',  label: 'Achievements',       artifacts: ['achievement'], macros: { list: 'lens.achievements.list',  get: 'lens.achievements.get' },  exports: ['json'], actions: [], category: 'lifestyle' },
  { domain: 'announcements', label: 'Announcements',      artifacts: ['announcement'],macros: { list: 'announcements.list',      get: 'announcements.get',     create: 'announcements.post', run: 'announcements.post' }, exports: ['json'], actions: ['post'], category: 'operations' },
  { domain: 'auction',       label: 'Auction House',      artifacts: ['auction'],     macros: { list: 'auctions.active',         get: 'auctions.get',         create: 'auctions.create',  run: 'auctions.bid' },       exports: ['json'], actions: ['create', 'bid'], category: 'finance' },
  { domain: 'detective',     label: 'Detective',          artifacts: ['case'],        macros: { list: 'detective.list',          get: 'detective.get',        create: 'detective.deduce', run: 'detective.deduce' },   exports: ['json'], actions: ['deduce'], category: 'lifestyle' },
  { domain: 'housing',       label: 'Housing',            artifacts: ['house'],       macros: { list: 'housing.mine',            get: 'housing.get',          create: 'housing.claim',    run: 'housing.place_furniture' }, exports: ['json'], actions: ['claim', 'place_furniture', 'remove_furniture', 'set_visibility', 'set_lock', 'visit'], category: 'lifestyle' },
  { domain: 'lfg',           label: 'Looking for Group',  artifacts: ['lfg_post'],    macros: { list: 'lfg.list',                get: 'lfg.list',             create: 'lfg.post',         run: 'lfg.join' },            exports: ['json'], actions: ['post', 'join', 'cancel'], category: 'social' },
  { domain: 'mail',          label: 'Mail',               artifacts: ['mail'],        macros: { list: 'mail.list',               get: 'mail.get',             create: 'mail.send',        run: 'mail.claim' },          exports: ['json'], actions: ['send', 'read', 'claim'], category: 'social' },
  { domain: 'narrative-walk',label: 'Narrative Walk',     artifacts: ['cinematic'],   macros: { list: 'lens.narrative-walk.list',get: 'lens.narrative-walk.get' },exports: ['json'], actions: [], category: 'creative' },
  { domain: 'ops-telemetry', label: 'Ops Telemetry',      artifacts: ['metric'],      macros: { list: 'lens.ops-telemetry.list', get: 'lens.ops-telemetry.get' }, exports: ['json'], actions: [], category: 'operations' },
  { domain: 'photos',        label: 'Photos',             artifacts: ['photo'],       macros: { list: 'photos.list',             get: 'photos.get', create: 'photos.share' }, exports: ['json'], actions: ['share', 'world'], category: 'creative' },
  { domain: 'quests',        label: 'Quests',             artifacts: ['quest'],       macros: { list: 'quests.mine',             get: 'quests.progress' },        exports: ['json'], actions: ['accept', 'record-progress', 'claim-rewards', 'share'], category: 'lifestyle' },
  { domain: 'spectate',      label: 'Spectate',           artifacts: ['spectacle'],   macros: { list: 'spectate.list',           get: 'spectate.get',         create: 'spectate.watch',   run: 'spectate.bet' },           exports: ['json'], actions: ['watch', 'bet', 'my_positions'], category: 'social' },
  { domain: 'training-room', label: 'Training Room',      artifacts: ['frame_data'],  macros: { list: 'lens.training-room.list_skills', get: 'lens.training-room.frame_data' }, exports: ['json'], actions: ['frame_data', 'kind_frame_data', 'list_kinds', 'list_skills'], category: 'lifestyle' },
  { domain: 'courtship',     label: 'Courtship',          artifacts: ['courtship'],   macros: { list: 'lens.courtship.list',     get: 'lens.courtship.get' },     exports: ['json'], actions: ['interact', 'propose', 'wed', 'conceive'], category: 'lifestyle' },
  { domain: 'creatures',     label: 'Creatures',          artifacts: ['creature'],    macros: { list: 'creatures.roster',        get: 'creatures.taxonomy',     create: 'creatures.breed' },     exports: ['json'], actions: ['roster', 'species', 'breed', 'lineage', 'taxonomy', 'for_world'], category: 'lifestyle' },
  { domain: 'fishing',       label: 'Fishing',            artifacts: ['catch'],       macros: { list: 'lens.fishing.list',       get: 'lens.fishing.get',       create: 'lens.fishing.create' },       exports: ['json'], actions: ['cast', 'reel'], category: 'lifestyle' },
  { domain: 'garage',        label: 'Garage',             artifacts: ['vehicle'],     macros: { list: 'garage.list',             get: 'garage.get',           create: 'garage.spawn',     run: 'garage.spawn' },        exports: ['json'], actions: ['spawn', 'mine', 'mount', 'dismount', 'move'], category: 'lifestyle' },
];

// ---- Sub-lens auto-registration ----
// Every parent lens (math, physics, code, ...) fans out into a set of
// sub-lenses whose manifests inherit from the parent (see
// sub-lens-manifests.ts). We append those entries to LENS_MANIFESTS
// here so downstream lookups treat sub-lenses as first-class citizens.
{
  const _subLensEntries = buildSubLensManifests(LENS_MANIFESTS);
  const _seen = new Set(LENS_MANIFESTS.map(m => m.domain));
  for (const entry of _subLensEntries) {
    if (!_seen.has(entry.domain)) {
      LENS_MANIFESTS.push(entry);
      _seen.add(entry.domain);
    }
  }
}

// ---- Lookup helpers ----

const _manifestMap = new Map(LENS_MANIFESTS.map(m => [m.domain, m]));

export function getLensManifest(domain: string): LensManifest | undefined {
  return _manifestMap.get(domain);
}

export function getLensManifests(category?: string): LensManifest[] {
  if (!category) return LENS_MANIFESTS;
  return LENS_MANIFESTS.filter(m => m.category === category);
}

export function getAllLensDomains(): string[] {
  return LENS_MANIFESTS.map(m => m.domain);
}

/** Count of lenses with full manifest contracts */
export function getManifestCount(): number {
  return LENS_MANIFESTS.length;
}

/** Get lenses missing a specific macro (e.g. 'create', 'run', 'export') */
export function getLensesMissingMacro(macro: keyof LensManifest['macros']): string[] {
  return LENS_MANIFESTS
    .filter(m => !m.macros[macro])
    .map(m => m.domain);
}

/**
 * lensId → manifest index. Re-exposes the internal map for tooling
 * (ESLint plugin, cartograph matcher, scripts) that need O(1) lookups
 * without re-importing all the per-domain logic in this file.
 *
 * Read-only: callers must not mutate the returned record.
 */
export const LENS_MANIFEST_INDEX: Readonly<Record<string, LensManifest>> = Object.freeze(
  Object.fromEntries(_manifestMap)
);

/** True if the given id is a registered lens domain. */
export function isKnownLensId(id: string): boolean {
  return _manifestMap.has(id);
}
