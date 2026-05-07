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
  },
  {
    domain: 'code',
    label: 'Code',
    artifacts: ['file', 'snippet', 'project', 'workspace', 'diff', 'review'],
    macros: { list: 'lens.code.list', get: 'lens.code.get', create: 'lens.code.create', update: 'lens.code.update', delete: 'lens.code.delete', run: 'lens.code.run', export: 'lens.code.export' },
    exports: ['json', 'zip', 'tar', 'patch'],
    actions: ['execute', 'lint', 'format', 'refactor', 'diff', 'review', 'test', 'package'],
    category: 'knowledge',
  },
  {
    domain: 'paper',
    label: 'Paper',
    artifacts: ['project', 'claim', 'hypothesis', 'evidence', 'experiment', 'synthesis'],
    macros: { list: 'lens.paper.list', get: 'lens.paper.get', create: 'lens.paper.create', update: 'lens.paper.update', delete: 'lens.paper.delete', run: 'lens.paper.run', export: 'lens.paper.export' },
    exports: ['json', 'md', 'pdf', 'bibtex'],
    actions: ['validate', 'synthesize', 'detect-contradictions', 'trace-lineage', 'claim-evidence-consistency', 'hypothesis-mutation-retest'],
    category: 'knowledge',
  },
  {
    domain: 'reasoning',
    label: 'Reasoning',
    artifacts: ['chain', 'premise', 'inference', 'conclusion', 'counterexample'],
    macros: { list: 'lens.reasoning.list', get: 'lens.reasoning.get', create: 'lens.reasoning.create', update: 'lens.reasoning.update', delete: 'lens.reasoning.delete', run: 'lens.reasoning.run', export: 'lens.reasoning.export' },
    exports: ['json', 'md', 'svg'],
    actions: ['validate', 'trace', 'conclude', 'fork', 'detect-fallacy', 'strength-score', 'visualize-chain'],
    category: 'knowledge',
  },
  {
    domain: 'graph',
    label: 'Graph',
    artifacts: ['entity', 'relation', 'assertion', 'source', 'ontology_node'],
    macros: { list: 'lens.graph.list', get: 'lens.graph.get', create: 'lens.graph.create', update: 'lens.graph.update', delete: 'lens.graph.delete', run: 'lens.graph.run', export: 'lens.graph.export' },
    exports: ['json', 'csv', 'graphml', 'rdf', 'cypher'],
    actions: ['query', 'cluster', 'analyze', 'merge', 'conflict-resolution', 'entity-resolution', 'confidence-scoring', 'shortest-path'],
    category: 'knowledge',
  },
  {
    domain: 'council',
    label: 'Council',
    artifacts: ['proposal', 'vote', 'budget', 'project', 'audit', 'resolution'],
    macros: { list: 'lens.council.list', get: 'lens.council.get', create: 'lens.council.create', update: 'lens.council.update', delete: 'lens.council.delete', run: 'lens.council.run', export: 'lens.council.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['debate', 'vote', 'simulate-budget', 'audit', 'quorum-check', 'impact-analysis', 'generate-minutes'],
    category: 'social',
  },
  {
    domain: 'agents',
    label: 'Agents',
    artifacts: ['agent', 'role', 'task', 'deliberation', 'decision', 'workflow'],
    macros: { list: 'lens.agents.list', get: 'lens.agents.get', create: 'lens.agents.create', update: 'lens.agents.update', delete: 'lens.agents.delete', run: 'lens.agents.run', export: 'lens.agents.export' },
    exports: ['json', 'yaml', 'csv'],
    actions: ['start', 'stop', 'reset', 'configure', 'deliberate', 'arbitrate', 'orchestrate', 'evaluate-performance'],
    category: 'knowledge',
  },
  {
    domain: 'sim',
    label: 'Sim',
    artifacts: ['scenario', 'assumption', 'run', 'outcome', 'model', 'distribution'],
    macros: { list: 'lens.sim.list', get: 'lens.sim.get', create: 'lens.sim.create', update: 'lens.sim.update', delete: 'lens.sim.delete', run: 'lens.sim.run', export: 'lens.sim.export' },
    exports: ['json', 'csv', 'pdf', 'png'],
    actions: ['simulate', 'analyze', 'compare', 'archive', 'monte-carlo', 'sensitivity-analysis', 'regime-detection'],
    category: 'system',
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
  },
  {
    domain: 'studio',
    label: 'Studio',
    artifacts: ['project', 'track', 'effect', 'instrument', 'session', 'mixdown'],
    macros: { list: 'lens.studio.list', get: 'lens.studio.get', create: 'lens.studio.create', update: 'lens.studio.update', delete: 'lens.studio.delete', run: 'lens.studio.run', export: 'lens.studio.export' },
    exports: ['json', 'wav', 'mp3', 'midi', 'pdf'],
    actions: ['mix', 'master', 'bounce', 'render', 'apply_effect', 'normalize', 'session_snapshot'],
    category: 'creative',
  },
  {
    domain: 'voice',
    label: 'Voice',
    artifacts: ['take', 'effect', 'preset', 'transcript', 'voice_note', 'pipeline_run'],
    macros: { list: 'lens.voice.list', get: 'lens.voice.get', create: 'lens.voice.create', update: 'lens.voice.update', delete: 'lens.voice.delete', run: 'lens.voice.run', export: 'lens.voice.export' },
    exports: ['json', 'csv', 'txt', 'srt', 'wav'],
    actions: ['transcribe', 'process', 'analyze', 'summarize', 'extract_tasks', 'detect_speaker', 'generate_subtitles'],
    category: 'creative',
  },
  {
    domain: 'art',
    label: 'Art',
    artifacts: ['artwork', 'collection', 'style', 'gallery', 'exhibition'],
    macros: { list: 'lens.art.list', get: 'lens.art.get', create: 'lens.art.create', update: 'lens.art.update', delete: 'lens.art.delete', run: 'lens.art.run', export: 'lens.art.export' },
    exports: ['json', 'png', 'svg', 'pdf'],
    actions: ['generate', 'remix', 'analyze', 'curate', 'style_transfer', 'publish_gallery'],
    category: 'creative',
  },
  {
    domain: 'ar',
    label: 'AR',
    artifacts: ['scene', 'anchor', 'overlay', 'capture_session', 'asset_3d'],
    macros: { list: 'lens.ar.list', get: 'lens.ar.get', create: 'lens.ar.create', update: 'lens.ar.update', delete: 'lens.ar.delete', run: 'lens.ar.run', export: 'lens.ar.export' },
    exports: ['json', 'gltf', 'usdz', 'png'],
    actions: ['place_anchor', 'render_scene', 'capture', 'export_3d', 'collision_detect', 'lighting_estimate'],
    category: 'creative',
  },
  {
    domain: 'fractal',
    label: 'Fractal',
    artifacts: ['structure', 'parameter_set', 'render', 'animation', 'exploration_session'],
    macros: { list: 'lens.fractal.list', get: 'lens.fractal.get', create: 'lens.fractal.create', update: 'lens.fractal.update', delete: 'lens.fractal.delete', run: 'lens.fractal.run', export: 'lens.fractal.export' },
    exports: ['json', 'png', 'svg', 'mp4'],
    actions: ['generate', 'animate', 'explore', 'export_render', 'parameter_sweep', 'dimension_morph'],
    category: 'creative',
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
  },
  {
    domain: 'daily',
    label: 'Daily',
    artifacts: ['entry', 'session', 'reminder', 'clip', 'insight'],
    macros: { list: 'lens.daily.list', get: 'lens.daily.get', create: 'lens.daily.create', update: 'lens.daily.update', delete: 'lens.daily.delete', run: 'lens.daily.run', export: 'lens.daily.export' },
    exports: ['json', 'csv', 'md', 'pdf'],
    actions: ['summarize', 'analyze', 'detect_patterns', 'generate_insights', 'weekly_review', 'mood_trend'],
    category: 'productivity',
  },
  {
    domain: 'goals',
    label: 'Goals',
    artifacts: ['goal', 'challenge', 'milestone', 'achievement', 'progress_snapshot'],
    macros: { list: 'lens.goals.list', get: 'lens.goals.get', create: 'lens.goals.create', update: 'lens.goals.update', delete: 'lens.goals.delete', run: 'lens.goals.run', export: 'lens.goals.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['evaluate', 'activate', 'complete', 'milestone_check', 'dependency_analysis', 'progress_report'],
    category: 'productivity',
  },
  {
    domain: 'srs',
    label: 'SRS',
    artifacts: ['deck', 'card', 'review_log', 'study_session', 'performance_record'],
    macros: { list: 'lens.srs.list', get: 'lens.srs.get', create: 'lens.srs.create', update: 'lens.srs.update', delete: 'lens.srs.delete', run: 'lens.srs.run', export: 'lens.srs.export' },
    exports: ['json', 'csv', 'anki', 'pdf'],
    actions: ['review', 'schedule', 'optimize_intervals', 'generate_cards_from_dtus', 'retention_report', 'difficulty_calibrate'],
    category: 'productivity',
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
  },
  {
    domain: 'collab',
    label: 'Collab',
    artifacts: ['session', 'participant', 'change', 'decision', 'conflict_resolution'],
    macros: { list: 'lens.collab.list', get: 'lens.collab.get', create: 'lens.collab.create', update: 'lens.collab.update', delete: 'lens.collab.delete', run: 'lens.collab.run', export: 'lens.collab.export' },
    exports: ['json', 'csv', 'md'],
    actions: ['merge', 'lock', 'unlock', 'summarize_thread', 'run_council', 'extract_actions', 'resolve_conflict', 'version_diff'],
    category: 'social',
  },
  {
    domain: 'feed',
    label: 'Feed',
    artifacts: ['post', 'author', 'interaction', 'topic'],
    macros: { list: 'lens.feed.list', get: 'lens.feed.get', create: 'lens.feed.create', update: 'lens.feed.update', delete: 'lens.feed.delete', run: 'lens.feed.run', export: 'lens.feed.export' },
    exports: ['json', 'csv', 'rss'],
    actions: ['like', 'repost', 'bookmark', 'rank', 'personalize', 'cluster_topics'],
    category: 'social',
  },
  {
    domain: 'experience',
    label: 'Experience',
    artifacts: ['portfolio', 'skill', 'history', 'insight', 'credential'],
    macros: { list: 'lens.experience.list', get: 'lens.experience.get', create: 'lens.experience.create', update: 'lens.experience.update', delete: 'lens.experience.delete', run: 'lens.experience.run', export: 'lens.experience.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['endorse', 'analyze', 'generate_resume', 'compare_versions', 'validate_claims'],
    category: 'social',
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
  },
  {
    domain: 'marketplace',
    label: 'Marketplace',
    artifacts: ['listing', 'purchase', 'review', 'license', 'provenance_record'],
    macros: { list: 'lens.marketplace.list', get: 'lens.marketplace.get', create: 'lens.marketplace.create', update: 'lens.marketplace.update', delete: 'lens.marketplace.delete', run: 'lens.marketplace.run', export: 'lens.marketplace.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['buy', 'sell', 'review', 'verify_artifact_hash', 'issue_license', 'distribute_royalties', 'validate_listing', 'provenance_check'],
    category: 'finance',
  },
  {
    domain: 'market',
    label: 'Market',
    artifacts: ['offer', 'bid', 'token_tx', 'settlement', 'order_book'],
    macros: { list: 'lens.market.list', get: 'lens.market.get', create: 'lens.market.create', update: 'lens.market.update', delete: 'lens.market.delete', run: 'lens.market.run', export: 'lens.market.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['place_bid', 'accept_offer', 'settle', 'price_history', 'volume_analysis', 'liquidity_check'],
    category: 'finance',
  },
  {
    domain: 'questmarket',
    label: 'Questmarket',
    artifacts: ['quest', 'bounty', 'submission', 'payout', 'reputation_record'],
    macros: { list: 'lens.questmarket.list', get: 'lens.questmarket.get', create: 'lens.questmarket.create', update: 'lens.questmarket.update', delete: 'lens.questmarket.delete', run: 'lens.questmarket.run', export: 'lens.questmarket.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['post_bounty', 'submit_work', 'verify_submission', 'release_payout', 'reputation_score', 'dispute_resolve'],
    category: 'finance',
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
  },
  {
    domain: 'thread',
    label: 'Thread',
    artifacts: ['thread', 'node', 'decision'],
    macros: { list: 'lens.thread.list', get: 'lens.thread.get', create: 'lens.thread.create', update: 'lens.thread.update', delete: 'lens.thread.delete', run: 'lens.thread.run', export: 'lens.thread.export' },
    exports: ['json', 'csv', 'md'],
    actions: ['branch', 'merge', 'summarize', 'detect_consensus', 'extract_decisions'],
    category: 'knowledge',
  },
  {
    domain: 'law',
    label: 'Law',
    artifacts: ['case', 'clause', 'draft', 'precedent', 'compliance_check'],
    macros: { list: 'lens.law.list', get: 'lens.law.get', create: 'lens.law.create', update: 'lens.law.update', delete: 'lens.law.delete', run: 'lens.law.run', export: 'lens.law.export' },
    exports: ['json', 'md', 'pdf', 'docx'],
    actions: ['check-compliance', 'analyze', 'draft', 'cite', 'clause_compare', 'precedent_search', 'risk_flag'],
    category: 'social',
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
  },
  {
    domain: 'ethics',
    label: 'Ethics',
    artifacts: ['case_file', 'decision_tree', 'policy_check', 'review', 'framework'],
    macros: { list: 'lens.ethics.list', get: 'lens.ethics.get', create: 'lens.ethics.create', update: 'lens.ethics.update', delete: 'lens.ethics.delete', run: 'lens.ethics.run', export: 'lens.ethics.export' },
    exports: ['json', 'md', 'pdf'],
    actions: ['evaluate_case', 'apply_framework', 'check_alignment', 'generate_report', 'stakeholder_analysis', 'risk_assessment'],
    category: 'social',
  },
  {
    domain: 'alliance',
    label: 'Alliance',
    artifacts: ['alliance_proposal', 'coalition_charter', 'agreement', 'member_record', 'governance_rule'],
    macros: { list: 'lens.alliance.list', get: 'lens.alliance.get', create: 'lens.alliance.create', update: 'lens.alliance.update', delete: 'lens.alliance.delete', run: 'lens.alliance.run', export: 'lens.alliance.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['propose_alliance', 'ratify_charter', 'add_member', 'vote_on_governance', 'compliance_check', 'dissolve'],
    category: 'social',
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
  },
  {
    domain: 'board',
    label: 'Board',
    artifacts: ['board', 'card', 'lane', 'workflow', 'label', 'sprint'],
    macros: { list: 'lens.board.list', get: 'lens.board.get', create: 'lens.board.create', update: 'lens.board.update', delete: 'lens.board.delete', run: 'lens.board.run', export: 'lens.board.export' },
    exports: ['json', 'csv', 'pdf'],
    actions: ['move_card', 'assign', 'set_wip_limit', 'burndown', 'velocity_calc', 'sprint_review', 'archive_done'],
    category: 'productivity',
  },
  {
    domain: 'timeline',
    label: 'Timeline',
    artifacts: ['timeline_object', 'event_node', 'span', 'annotation', 'replay_session'],
    macros: { list: 'lens.timeline.list', get: 'lens.timeline.get', create: 'lens.timeline.create', update: 'lens.timeline.update', delete: 'lens.timeline.delete', run: 'lens.timeline.run', export: 'lens.timeline.export' },
    exports: ['json', 'csv', 'svg', 'ics'],
    actions: ['replay', 'diff_timelines', 'annotate', 'cluster_events', 'gap_analysis', 'causality_trace'],
    category: 'productivity',
  },
  {
    domain: 'anon',
    label: 'Anon',
    artifacts: ['anonymous_room', 'message', 'artifact', 'provenance_rule', 'identity_mask'],
    macros: { list: 'lens.anon.list', get: 'lens.anon.get', create: 'lens.anon.create', update: 'lens.anon.update', delete: 'lens.anon.delete', run: 'lens.anon.run', export: 'lens.anon.export' },
    exports: ['json', 'md'],
    actions: ['create_room', 'post_anonymous', 'verify_provenance', 'rotate_identity', 'export_sanitized', 'moderate'],
    category: 'social',
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
  },
  {
    domain: 'game',
    label: 'Game',
    artifacts: ['achievement', 'quest', 'skill', 'profile', 'game_state', 'reward_event'],
    macros: { list: 'lens.game.list', get: 'lens.game.get', create: 'lens.game.create', update: 'lens.game.update', delete: 'lens.game.delete', run: 'lens.game.run', export: 'lens.game.export' },
    exports: ['json', 'csv'],
    actions: ['complete', 'claim', 'levelup', 'simulate', 'resolve_turn', 'balance', 'leaderboard_update'],
    category: 'system',
  },
  {
    domain: 'resonance',
    label: 'Resonance',
    artifacts: ['alert', 'metric'],
    macros: { list: 'lens.resonance.list', get: 'lens.resonance.get', update: 'lens.resonance.update' },
    exports: ['json'],
    actions: ['acknowledge', 'dismiss'],
    category: 'system',
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
  },
  {
    domain: 'lab',
    label: 'Lab',
    artifacts: ['experiment_notebook', 'protocol', 'run', 'result', 'reagent', 'equipment_log'],
    macros: { list: 'lens.lab.list', get: 'lens.lab.get', create: 'lens.lab.create', update: 'lens.lab.update', delete: 'lens.lab.delete', run: 'lens.lab.run', export: 'lens.lab.export' },
    exports: ['json', 'csv', 'pdf', 'xlsx'],
    actions: ['run_protocol', 'record_result', 'compare_runs', 'statistical_analysis', 'equipment_calibrate', 'generate_report'],
    category: 'knowledge',
  },
  {
    domain: 'repos',
    label: 'Repos',
    artifacts: ['repo_snapshot', 'issue_set', 'patchset', 'release', 'branch_record'],
    macros: { list: 'lens.repos.list', get: 'lens.repos.get', create: 'lens.repos.create', update: 'lens.repos.update', delete: 'lens.repos.delete', run: 'lens.repos.run', export: 'lens.repos.export' },
    exports: ['json', 'csv', 'patch', 'tar'],
    actions: ['ingest_metadata', 'diff_view', 'release_package', 'issue_triage', 'contributor_stats', 'dependency_audit'],
    category: 'knowledge',
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
  },
  {
    domain: 'meta',
    label: 'Meta',
    artifacts: ['session_meta_model', 'policy_profile', 'capability_map', 'lens_score'],
    macros: { list: 'lens.meta.list', get: 'lens.meta.get', create: 'lens.meta.create', update: 'lens.meta.update', delete: 'lens.meta.delete', run: 'lens.meta.run', export: 'lens.meta.export' },
    exports: ['json', 'csv', 'md'],
    actions: ['score_lenses', 'policy_check', 'capability_audit', 'generate_status_report', 'cross_lens_analysis'],
    category: 'system',
  },
  {
    domain: 'eco',
    label: 'Eco',
    artifacts: ['ecosystem_graph', 'resource_flow', 'dependency_map', 'health_metric'],
    macros: { list: 'lens.eco.list', get: 'lens.eco.get', create: 'lens.eco.create', update: 'lens.eco.update', delete: 'lens.eco.delete', run: 'lens.eco.run', export: 'lens.eco.export' },
    exports: ['json', 'csv', 'svg', 'graphml'],
    actions: ['map_dependencies', 'flow_analysis', 'health_check', 'bottleneck_detect', 'impact_simulation'],
    category: 'system',
  },
  {
    domain: 'temporal',
    label: 'Temporal',
    artifacts: ['timeline_object', 'temporal_assertion', 'replay_session', 'diff_record', 'causality_chain'],
    macros: { list: 'lens.temporal.list', get: 'lens.temporal.get', create: 'lens.temporal.create', update: 'lens.temporal.update', delete: 'lens.temporal.delete', run: 'lens.temporal.run', export: 'lens.temporal.export' },
    exports: ['json', 'csv', 'svg'],
    actions: ['replay', 'diff', 'causality_trace', 'temporal_query', 'truth_at_time', 'version_compare'],
    category: 'knowledge',
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
  },
  {
    domain: 'podcast',
    label: 'Podcast',
    artifacts: ['episode', 'subscriber', 'analytics', 'feed'],
    macros: { list: 'lens.podcast.list', get: 'lens.podcast.get', create: 'lens.podcast.create', update: 'lens.podcast.update', delete: 'lens.podcast.delete', run: 'lens.podcast.run', export: 'lens.podcast.export' },
    exports: ['json', 'rss', 'mp3'],
    actions: ['publish', 'schedule', 'generateRSS', 'analyzeListeners', 'transcribe', 'distributeFeed'],
    category: 'creative',
  },
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
