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
    domain: 'chat',
    label: 'Chat',
    artifacts: ['conversation', 'message', 'session', 'branch'],
    macros: { list: 'lens.chat.list', get: 'lens.chat.get', create: 'lens.chat.create', update: 'lens.chat.update', delete: 'lens.chat.delete', run: 'lens.chat.run', export: 'lens.chat.export' },
    exports: ['json', 'md', 'txt', 'pdf'],
    actions: ['send', 'summarize', 'branch', 'export_transcript', 'search_history', 'merge_threads'],
    category: 'knowledge',
    dataTier: 'REAL_LIVE',
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
        { caption: 'Drop code into the editor — the VS Code-shape silhouette gives you file tree, tabs, and a status bar so it reads as your IDE.' },
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
  },
  {
    domain: 'reasoning',
    label: 'Reasoning',
    artifacts: ['chain', 'premise', 'inference', 'conclusion', 'counterexample'],
    macros: { list: 'lens.reasoning.list', get: 'lens.reasoning.get', create: 'lens.reasoning.create', update: 'lens.reasoning.update', delete: 'lens.reasoning.delete', run: 'lens.reasoning.run', export: 'lens.reasoning.export' },
    exports: ['json', 'md', 'svg'],
    actions: ['validate', 'trace', 'conclude', 'fork', 'detect-fallacy', 'strength-score', 'visualize-chain'],
    category: 'knowledge',
    dataTier: 'REAL_LIVE',
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
    emptyState: {
      headline: 'No listings yet.',
      caption: 'List a DTU you minted, or browse what creators have published. Royalty cascade pays ancestors automatically.',
      firstActionLabel: 'List your first DTU',
    },
    firstRunGuide: {
      steps: [
        { caption: 'The Bandcamp-shape grid puts creator art up front. Click any tile for provenance + price + license terms.' },
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
  },
  {
    domain: 'physics',
    label: 'Physics',
    artifacts: ['experiment', 'model', 'constant', 'simulation', 'measurement'],
    macros: { list: 'lens.physics.list', get: 'lens.physics.get', create: 'lens.physics.create', update: 'lens.physics.update', delete: 'lens.physics.delete', run: 'lens.physics.run', export: 'lens.physics.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'knowledge',
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
  },
  {
    domain: 'poetry',
    label: 'Poetry',
    artifacts: ['poem', 'collection', 'form', 'analysis', 'workshop'],
    macros: { list: 'lens.poetry.list', get: 'lens.poetry.get', create: 'lens.poetry.create', update: 'lens.poetry.update', delete: 'lens.poetry.delete', run: 'lens.poetry.run', export: 'lens.poetry.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['analyze', 'generate', 'validate', 'export', 'summarize'],
    category: 'creative',
    dataTier: 'SIM_GRADE_A',
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
    exports: [],
    actions: ['systems', 'system_schema', 'validate_systems', 'create', 'update', 'get', 'list', 'delete', 'validate', 'publish', 'unpublish'],
    category: 'creative',
    dataTier: 'REAL_LIVE',
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
        { caption: 'Threads list in the left rail; the right pane shows the active conversation in the Gmail-shape silhouette.' },
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
