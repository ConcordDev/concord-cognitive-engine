/**
 * FE-005: API endpoint inventory for drift detection.
 *
 * This file provides a verifiable mapping of every API endpoint the frontend
 * calls. Run `validateEndpoints()` in development to detect:
 *   - Endpoints used in client code but not listed here (frontend drift)
 *   - Endpoints listed here that no longer appear in the backend OpenAPI spec (backend drift)
 *
 * Keep in sync with `lib/api/client.ts` and the backend OpenAPI spec.
 */

export interface EndpointEntry {
  /** HTTP method */
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Path pattern (e.g. /api/dtus/:id) */
  path: string;
  /** Which frontend module or lens consumes this */
  usedBy: string[];
  /** Corresponding apiHelpers key (e.g. 'dtus.list') */
  helperKey?: string;
}

export const ENDPOINT_INVENTORY: EndpointEntry[] = [
  // ── System ────────────────────────────────────────────────────
  { method: 'GET', path: '/api/status', usedBy: ['dashboard'], helperKey: 'status.get' },
  { method: 'GET', path: '/api/jobs/status', usedBy: ['admin'], helperKey: 'jobs.status' },
  { method: 'POST', path: '/api/jobs/toggle', usedBy: ['admin'], helperKey: 'jobs.toggle' },

  // ── DTU ───────────────────────────────────────────────────────
  { method: 'GET', path: '/api/dtus', usedBy: ['dashboard', 'graph', 'board'], helperKey: 'dtus.list' },
  { method: 'POST', path: '/api/dtus', usedBy: ['chat', 'forge'], helperKey: 'dtus.create' },
  { method: 'PATCH', path: '/api/dtus/:id', usedBy: ['editor'], helperKey: 'dtus.update' },

  // ── Ingestion ─────────────────────────────────────────────────
  { method: 'POST', path: '/api/ingest', usedBy: ['import'], helperKey: 'ingest.manual' },
  { method: 'POST', path: '/api/ingest/queue', usedBy: ['import'], helperKey: 'ingest.queue' },
  { method: 'POST', path: '/api/autocrawl', usedBy: ['import'], helperKey: 'autocrawl.manual' },
  { method: 'POST', path: '/api/autocrawl/queue', usedBy: ['import'], helperKey: 'autocrawl.queue' },

  // ── Chat ──────────────────────────────────────────────────────
  { method: 'POST', path: '/api/chat', usedBy: ['chat'], helperKey: 'chat.send' },
  { method: 'POST', path: '/api/ask', usedBy: ['chat'], helperKey: 'chat.ask' },
  { method: 'POST', path: '/api/dream', usedBy: ['chat'], helperKey: 'dream.run' },

  // ── Forge ─────────────────────────────────────────────────────
  { method: 'POST', path: '/api/forge/manual', usedBy: ['forge'], helperKey: 'forge.manual' },
  { method: 'POST', path: '/api/forge/hybrid', usedBy: ['forge'], helperKey: 'forge.hybrid' },
  { method: 'POST', path: '/api/forge/auto', usedBy: ['forge'], helperKey: 'forge.auto' },
  { method: 'POST', path: '/api/forge/fromSource', usedBy: ['forge'], helperKey: 'forge.fromSource' },

  // ── Council / Governance ──────────────────────────────────────
  { method: 'POST', path: '/api/council/review-global', usedBy: ['council'], helperKey: 'council.reviewGlobal' },
  { method: 'POST', path: '/api/council/weekly', usedBy: ['council'], helperKey: 'council.weekly' },
  { method: 'POST', path: '/api/council/vote', usedBy: ['council'], helperKey: 'council.vote' },
  { method: 'GET', path: '/api/council/tally/:dtuId', usedBy: ['council'], helperKey: 'council.tally' },
  { method: 'POST', path: '/api/council/credibility', usedBy: ['council'], helperKey: 'council.credibility' },

  // ── Marketplace ───────────────────────────────────────────────
  { method: 'GET', path: '/api/marketplace/listings', usedBy: ['marketplace'], helperKey: 'marketplace.listings' },
  { method: 'GET', path: '/api/marketplace/browse', usedBy: ['marketplace'], helperKey: 'marketplace.browse' },
  { method: 'POST', path: '/api/marketplace/submit', usedBy: ['marketplace'], helperKey: 'marketplace.submit' },
  { method: 'POST', path: '/api/marketplace/install', usedBy: ['marketplace'], helperKey: 'marketplace.install' },
  { method: 'GET', path: '/api/marketplace/installed', usedBy: ['marketplace'], helperKey: 'marketplace.installed' },
  { method: 'POST', path: '/api/marketplace/review', usedBy: ['marketplace'], helperKey: 'marketplace.review' },

  // ── Graph ─────────────────────────────────────────────────────
  { method: 'POST', path: '/api/graph/query', usedBy: ['graph'], helperKey: 'graph.query' },
  { method: 'GET', path: '/api/graph/visual', usedBy: ['graph'], helperKey: 'graph.visual' },
  { method: 'GET', path: '/api/graph/force', usedBy: ['graph', 'fractal'], helperKey: 'graph.force' },

  // ── Auth ──────────────────────────────────────────────────────
  { method: 'POST', path: '/api/auth/login', usedBy: ['login'], helperKey: 'auth.login' },
  { method: 'POST', path: '/api/auth/register', usedBy: ['register'], helperKey: 'auth.register' },
  { method: 'POST', path: '/api/auth/logout', usedBy: ['shell'], helperKey: 'auth.logout' },
  { method: 'GET', path: '/api/auth/me', usedBy: ['shell'], helperKey: 'auth.me' },
  { method: 'GET', path: '/api/auth/csrf-token', usedBy: ['client'], helperKey: 'auth.csrfToken' },

  // ── Chat Feedback ────────────────────────────────────────────
  { method: 'POST', path: '/api/chat/feedback', usedBy: ['chat'], helperKey: 'chat.feedback' },

  // ── Cognitive / Reseed ──────────────────────────────────────
  { method: 'GET', path: '/api/cognitive/status', usedBy: ['resonance', 'command-center'], helperKey: 'cognitive.status' },
  { method: 'GET', path: '/api/loaf/status', usedBy: ['command-center'], helperKey: 'loaf.status' },
  { method: 'POST', path: '/api/reseed', usedBy: ['admin'], helperKey: 'reseed.run' },

  // ── Simulations ─────────────────────────────────────────────
  { method: 'GET', path: '/api/worldmodel/simulations', usedBy: ['sim'], helperKey: 'simulations.list' },
  { method: 'GET', path: '/api/worldmodel/simulations/:id', usedBy: ['sim'], helperKey: 'simulations.get' },
  { method: 'POST', path: '/api/worldmodel/simulate', usedBy: ['sim'], helperKey: 'simulations.run' },

  // ── Personas ────────────────────────────────────────────────
  { method: 'GET', path: '/api/personas', usedBy: ['chat'], helperKey: 'personas.list' },
  { method: 'POST', path: '/api/personas/:id/speak', usedBy: ['chat'], helperKey: 'personas.speak' },
  { method: 'POST', path: '/api/personas/:id/animate', usedBy: ['chat'], helperKey: 'personas.animate' },

  // ── Swarm ───────────────────────────────────────────────────
  { method: 'POST', path: '/api/swarm', usedBy: ['agents'], helperKey: 'swarm.run' },

  // ── Credits ─────────────────────────────────────────────────
  { method: 'POST', path: '/api/credits/wallet', usedBy: ['billing'], helperKey: 'credits.getWallet' },
  { method: 'POST', path: '/api/credits/earn', usedBy: ['billing'], helperKey: 'credits.earn' },
  { method: 'POST', path: '/api/credits/spend', usedBy: ['billing'], helperKey: 'credits.spend' },

  // ── Global Feed ─────────────────────────────────────────────
  { method: 'GET', path: '/api/global/feed', usedBy: ['feed'], helperKey: 'global.feed' },

  // ── Macros ──────────────────────────────────────────────────
  { method: 'POST', path: '/api/macros/run', usedBy: ['admin'], helperKey: 'macros.run' },

  // ── Schema ──────────────────────────────────────────────────
  { method: 'GET', path: '/api/schema', usedBy: ['schema'], helperKey: 'schema.list' },
  { method: 'POST', path: '/api/schema', usedBy: ['schema'], helperKey: 'schema.create' },
  { method: 'POST', path: '/api/schema/validate', usedBy: ['schema'], helperKey: 'schema.validate' },
  { method: 'POST', path: '/api/schema/apply', usedBy: ['schema'], helperKey: 'schema.apply' },

  // ── Auto-Tagging ────────────────────────────────────────────
  { method: 'POST', path: '/api/autotag/analyze', usedBy: ['editor'], helperKey: 'autotag.analyze' },
  { method: 'POST', path: '/api/autotag/apply', usedBy: ['editor'], helperKey: 'autotag.apply' },
  { method: 'POST', path: '/api/autotag/batch', usedBy: ['admin'], helperKey: 'autotag.batch' },

  // ── Visual ──────────────────────────────────────────────────
  { method: 'GET', path: '/api/visual/moodboard', usedBy: ['graph'], helperKey: 'visual.moodboard' },
  { method: 'GET', path: '/api/visual/sunburst', usedBy: ['graph'], helperKey: 'visual.sunburst' },
  { method: 'GET', path: '/api/visual/timeline', usedBy: ['timeline'], helperKey: 'visual.timeline' },

  // ── Collaboration ───────────────────────────────────────────
  { method: 'GET', path: '/api/collab/sessions', usedBy: ['collab'], helperKey: 'collab.sessions' },
  { method: 'POST', path: '/api/collab/session', usedBy: ['collab'], helperKey: 'collab.createSession' },
  { method: 'POST', path: '/api/collab/join', usedBy: ['collab'], helperKey: 'collab.join' },
  { method: 'POST', path: '/api/collab/edit', usedBy: ['collab'], helperKey: 'collab.edit' },
  { method: 'POST', path: '/api/collab/merge', usedBy: ['collab'], helperKey: 'collab.merge' },

  // ── Whiteboard ──────────────────────────────────────────────
  { method: 'GET', path: '/api/whiteboards', usedBy: ['whiteboard'], helperKey: 'whiteboard.list' },
  { method: 'GET', path: '/api/whiteboard/:id', usedBy: ['whiteboard'], helperKey: 'whiteboard.get' },
  { method: 'POST', path: '/api/whiteboard', usedBy: ['whiteboard'], helperKey: 'whiteboard.create' },
  { method: 'PUT', path: '/api/whiteboard/:id', usedBy: ['whiteboard'], helperKey: 'whiteboard.update' },

  // ── Webhooks & Automations ──────────────────────────────────
  { method: 'GET', path: '/api/webhooks', usedBy: ['integrations'], helperKey: 'webhooks.list' },
  { method: 'POST', path: '/api/webhooks', usedBy: ['integrations'], helperKey: 'webhooks.create' },
  { method: 'DELETE', path: '/api/webhooks/:id', usedBy: ['integrations'], helperKey: 'webhooks.delete' },
  { method: 'POST', path: '/api/webhooks/:id/toggle', usedBy: ['integrations'], helperKey: 'webhooks.toggle' },
  { method: 'GET', path: '/api/automations', usedBy: ['integrations'], helperKey: 'automations.list' },
  { method: 'POST', path: '/api/automations', usedBy: ['integrations'], helperKey: 'automations.create' },
  { method: 'POST', path: '/api/automations/:id/run', usedBy: ['integrations'], helperKey: 'automations.run' },
  { method: 'DELETE', path: '/api/automations/:id', usedBy: ['integrations'], helperKey: 'automations.delete' },

  // ── Integrations ────────────────────────────────────────────
  { method: 'GET', path: '/api/integrations', usedBy: ['integrations'], helperKey: 'integrations.list' },
  { method: 'POST', path: '/api/obsidian/export', usedBy: ['integrations'], helperKey: 'integrations.obsidianExport' },
  { method: 'POST', path: '/api/obsidian/import', usedBy: ['integrations'], helperKey: 'integrations.obsidianImport' },
  { method: 'POST', path: '/api/notion/import', usedBy: ['integrations'], helperKey: 'integrations.notionImport' },

  // ── Database & Sync ─────────────────────────────────────────
  { method: 'POST', path: '/api/db/migrate', usedBy: ['admin'], helperKey: 'db.migrate' },
  { method: 'POST', path: '/api/db/sync', usedBy: ['admin'], helperKey: 'db.sync' },
  { method: 'POST', path: '/api/perf/gc', usedBy: ['admin'], helperKey: 'perf.gc' },

  // ── PWA & Mobile ────────────────────────────────────────────
  { method: 'GET', path: '/api/pwa/sw-config', usedBy: ['pwa'], helperKey: 'pwa.swConfig' },
  { method: 'GET', path: '/api/mobile/shortcuts', usedBy: ['mobile'], helperKey: 'mobile.shortcuts' },
  { method: 'GET', path: '/api/mobile/dtu/:id', usedBy: ['mobile'], helperKey: 'mobile.dtu' },

  // ── AI subsystems ─────────────────────────────────────────────

  // Affect
  { method: 'GET', path: '/api/affect/state', usedBy: ['affect'], helperKey: 'affect.state' },
  { method: 'POST', path: '/api/affect/event', usedBy: ['affect'], helperKey: 'affect.emit' },
  { method: 'GET', path: '/api/affect/policy', usedBy: ['affect'], helperKey: 'affect.policy' },
  { method: 'POST', path: '/api/affect/reset', usedBy: ['affect'], helperKey: 'affect.reset' },
  { method: 'GET', path: '/api/affect/events', usedBy: ['affect'], helperKey: 'affect.events' },
  { method: 'GET', path: '/api/affect/health', usedBy: ['affect'], helperKey: 'affect.health' },

  // Goals
  { method: 'GET', path: '/api/goals', usedBy: ['goals'], helperKey: 'goals.list' },
  { method: 'GET', path: '/api/goals/:id', usedBy: ['goals'], helperKey: 'goals.get' },
  { method: 'POST', path: '/api/goals', usedBy: ['goals'], helperKey: 'goals.create' },
  { method: 'POST', path: '/api/goals/:id/progress', usedBy: ['goals'], helperKey: 'goals.progress' },
  { method: 'POST', path: '/api/goals/:id/complete', usedBy: ['goals'], helperKey: 'goals.complete' },
  { method: 'POST', path: '/api/goals/:id/activate', usedBy: ['goals'], helperKey: 'goals.activate' },
  { method: 'POST', path: '/api/goals/:id/abandon', usedBy: ['goals'], helperKey: 'goals.abandon' },
  { method: 'GET', path: '/api/goals/status', usedBy: ['goals'], helperKey: 'goals.status' },
  { method: 'POST', path: '/api/goals/auto-propose', usedBy: ['goals'], helperKey: 'goals.autoPropose' },
  { method: 'GET', path: '/api/goals/config', usedBy: ['goals'], helperKey: 'goals.config' },

  // Metacognition
  { method: 'GET', path: '/api/metacognition/status', usedBy: ['metacognition'], helperKey: 'metacognition.status' },
  { method: 'GET', path: '/api/metacognition/blindspots', usedBy: ['metacognition'], helperKey: 'metacognition.blindspots' },
  { method: 'GET', path: '/api/metacognition/calibration', usedBy: ['metacognition'], helperKey: 'metacognition.calibration' },
  { method: 'GET', path: '/api/metacognition/introspection-status', usedBy: ['metacognition'], helperKey: 'metacognition.introspection' },
  { method: 'POST', path: '/api/metacognition/predict', usedBy: ['metacognition'], helperKey: 'metacognition.predict' },
  { method: 'POST', path: '/api/metacognition/predictions/:id/resolve', usedBy: ['metacognition'], helperKey: 'metacognition.resolve' },
  { method: 'POST', path: '/api/metacognition/assess', usedBy: ['metacognition'], helperKey: 'metacognition.assess' },
  { method: 'POST', path: '/api/metacognition/introspect', usedBy: ['metacognition'], helperKey: 'metacognition.introspect' },
  { method: 'POST', path: '/api/metacognition/strategy', usedBy: ['metacognition'], helperKey: 'metacognition.strategy' },

  // Meta-learning
  { method: 'GET', path: '/api/metalearning/status', usedBy: ['metalearning'], helperKey: 'metalearning.status' },
  { method: 'GET', path: '/api/metalearning/strategies', usedBy: ['metalearning'], helperKey: 'metalearning.strategies' },
  { method: 'GET', path: '/api/metalearning/strategies/best', usedBy: ['metalearning'], helperKey: 'metalearning.bestStrategy' },
  { method: 'POST', path: '/api/metalearning/strategies', usedBy: ['metalearning'], helperKey: 'metalearning.createStrategy' },
  { method: 'POST', path: '/api/metalearning/strategies/:id/adapt', usedBy: ['metalearning'], helperKey: 'metalearning.adaptStrategy' },
  { method: 'POST', path: '/api/metalearning/strategies/:id/outcome', usedBy: ['metalearning'], helperKey: 'metalearning.recordOutcome' },
  { method: 'POST', path: '/api/metalearning/curriculum', usedBy: ['metalearning'], helperKey: 'metalearning.curriculum' },

  // Reasoning
  { method: 'GET', path: '/api/reasoning/status', usedBy: ['reasoning'], helperKey: 'reasoning.status' },
  { method: 'GET', path: '/api/reasoning/chains', usedBy: ['reasoning'], helperKey: 'reasoning.list' },
  { method: 'POST', path: '/api/reasoning/chains', usedBy: ['reasoning'], helperKey: 'reasoning.create' },
  { method: 'POST', path: '/api/reasoning/chains/:id/steps', usedBy: ['reasoning'], helperKey: 'reasoning.addStep' },
  { method: 'POST', path: '/api/reasoning/chains/:id/conclude', usedBy: ['reasoning'], helperKey: 'reasoning.conclude' },
  { method: 'POST', path: '/api/reasoning/steps/:id/validate', usedBy: ['reasoning'], helperKey: 'reasoning.validate' },
  { method: 'GET', path: '/api/reasoning/chains/:id/trace', usedBy: ['reasoning'], helperKey: 'reasoning.trace' },

  // Hypothesis
  { method: 'GET', path: '/api/hypothesis', usedBy: ['hypothesis'], helperKey: 'hypothesis.list' },
  { method: 'GET', path: '/api/hypothesis/status', usedBy: ['hypothesis'], helperKey: 'hypothesis.status' },
  { method: 'GET', path: '/api/hypothesis/:id', usedBy: ['hypothesis'], helperKey: 'hypothesis.get' },
  { method: 'POST', path: '/api/hypothesis', usedBy: ['hypothesis'], helperKey: 'hypothesis.create' },
  { method: 'POST', path: '/api/hypothesis/:id/evaluate', usedBy: ['hypothesis'], helperKey: 'hypothesis.evaluate' },
  { method: 'POST', path: '/api/hypothesis/:id/evidence', usedBy: ['hypothesis'], helperKey: 'hypothesis.addEvidence' },
  { method: 'POST', path: '/api/hypothesis/:id/experiment', usedBy: ['hypothesis'], helperKey: 'hypothesis.experiment' },

  // Inference
  { method: 'GET', path: '/api/inference/status', usedBy: ['inference'], helperKey: 'inference.status' },
  { method: 'POST', path: '/api/inference/facts', usedBy: ['inference'], helperKey: 'inference.facts' },
  { method: 'POST', path: '/api/inference/rules', usedBy: ['inference'], helperKey: 'inference.rules' },
  { method: 'POST', path: '/api/inference/query', usedBy: ['inference'], helperKey: 'inference.query' },
  { method: 'POST', path: '/api/inference/syllogism', usedBy: ['inference'], helperKey: 'inference.syllogism' },
  { method: 'POST', path: '/api/inference/forward-chain', usedBy: ['inference'], helperKey: 'inference.forwardChain' },

  // Agents
  { method: 'GET', path: '/api/agents', usedBy: ['agents'], helperKey: 'agents.list' },
  { method: 'GET', path: '/api/agents/:id', usedBy: ['agents'], helperKey: 'agents.get' },
  { method: 'POST', path: '/api/agents', usedBy: ['agents'], helperKey: 'agents.create' },
  { method: 'POST', path: '/api/agents/:id/enable', usedBy: ['agents'], helperKey: 'agents.enable' },
  { method: 'POST', path: '/api/agents/:id/tick', usedBy: ['agents'], helperKey: 'agents.tick' },

  // Transfer learning
  { method: 'GET', path: '/api/transfer/history', usedBy: ['transfer'], helperKey: 'transfer.history' },
  { method: 'POST', path: '/api/transfer/analogies', usedBy: ['transfer'], helperKey: 'transfer.analogies' },
  { method: 'POST', path: '/api/transfer/apply', usedBy: ['transfer'], helperKey: 'transfer.apply' },
  { method: 'POST', path: '/api/transfer/classify-domain', usedBy: ['transfer'], helperKey: 'transfer.classifyDomain' },
  { method: 'POST', path: '/api/transfer/extract-pattern', usedBy: ['transfer'], helperKey: 'transfer.extractPattern' },

  // SRS
  { method: 'GET', path: '/api/srs/due', usedBy: ['srs'], helperKey: 'srs.due' },
  { method: 'POST', path: '/api/srs/:id/add', usedBy: ['srs'], helperKey: 'srs.add' },
  { method: 'POST', path: '/api/srs/:id/review', usedBy: ['srs'], helperKey: 'srs.review' },
  { method: 'DELETE', path: '/api/srs/:id', usedBy: ['srs'], helperKey: 'srs.remove' },

  // Commonsense
  { method: 'GET', path: '/api/commonsense/facts', usedBy: ['commonsense'], helperKey: 'commonsense.facts' },
  { method: 'GET', path: '/api/commonsense/status', usedBy: ['commonsense'], helperKey: 'commonsense.status' },
  { method: 'POST', path: '/api/commonsense/facts', usedBy: ['commonsense'], helperKey: 'commonsense.addFact' },
  { method: 'POST', path: '/api/commonsense/query', usedBy: ['commonsense'], helperKey: 'commonsense.query' },
  { method: 'POST', path: '/api/commonsense/surface/:id', usedBy: ['commonsense'], helperKey: 'commonsense.surface' },
  { method: 'GET', path: '/api/commonsense/assumptions/:id', usedBy: ['commonsense'], helperKey: 'commonsense.assumptions' },

  // Explanation
  { method: 'GET', path: '/api/explanation/recent', usedBy: ['reasoning'], helperKey: 'explanation.recent' },
  { method: 'GET', path: '/api/explanation/status', usedBy: ['reasoning'], helperKey: 'explanation.status' },
  { method: 'POST', path: '/api/explanation', usedBy: ['reasoning'], helperKey: 'explanation.generate' },
  { method: 'POST', path: '/api/explanation/dtu/:id', usedBy: ['reasoning'], helperKey: 'explanation.forDtu' },

  // Voice
  { method: 'POST', path: '/api/voice/transcribe', usedBy: ['voice'], helperKey: 'voice.transcribe' },
  { method: 'POST', path: '/api/voice/ingest', usedBy: ['voice'], helperKey: 'voice.ingest' },
  { method: 'POST', path: '/api/voice/tts', usedBy: ['voice'], helperKey: 'voice.tts' },

  // Daily notes & reminders
  { method: 'GET', path: '/api/daily', usedBy: ['daily'], helperKey: 'daily.get' },
  { method: 'GET', path: '/api/daily/list', usedBy: ['daily'], helperKey: 'daily.list' },
  { method: 'POST', path: '/api/digest', usedBy: ['daily'], helperKey: 'daily.digest' },
  { method: 'GET', path: '/api/digest', usedBy: ['daily'], helperKey: 'daily.getDigest' },
  { method: 'POST', path: '/api/reminders', usedBy: ['daily'], helperKey: 'daily.createReminder' },
  { method: 'GET', path: '/api/reminders/due', usedBy: ['daily'], helperKey: 'daily.dueReminders' },
  { method: 'POST', path: '/api/reminders/:id/complete', usedBy: ['daily'], helperKey: 'daily.completeReminder' },

  // Temporal reasoning
  { method: 'POST', path: '/api/temporal/validate', usedBy: ['temporal'], helperKey: 'temporal.validate' },
  { method: 'POST', path: '/api/temporal/recency', usedBy: ['temporal'], helperKey: 'temporal.recency' },
  { method: 'POST', path: '/api/temporal/frame', usedBy: ['temporal'], helperKey: 'temporal.frame' },
  { method: 'GET', path: '/api/temporal/frames', usedBy: ['temporal'], helperKey: 'temporal.frames' },
  { method: 'POST', path: '/api/temporal/sim', usedBy: ['temporal'], helperKey: 'temporal.sim' },

  // Grounding
  { method: 'GET', path: '/api/grounding/sensors', usedBy: ['grounding'], helperKey: 'grounding.sensors' },
  { method: 'GET', path: '/api/grounding/readings', usedBy: ['grounding'], helperKey: 'grounding.readings' },
  { method: 'POST', path: '/api/grounding/readings', usedBy: ['grounding'], helperKey: 'grounding.addReading' },
  { method: 'GET', path: '/api/grounding/context', usedBy: ['grounding'], helperKey: 'grounding.context' },
  { method: 'GET', path: '/api/grounding/status', usedBy: ['grounding'], helperKey: 'grounding.status' },
  { method: 'POST', path: '/api/grounding/ground/:id', usedBy: ['grounding'], helperKey: 'grounding.ground' },
  { method: 'GET', path: '/api/grounding/actions/pending', usedBy: ['grounding'], helperKey: 'grounding.actions.pending' },

  // World model
  { method: 'GET', path: '/api/worldmodel/status', usedBy: ['entity', 'sim'], helperKey: 'worldmodel.status' },
  { method: 'GET', path: '/api/worldmodel/entities', usedBy: ['entity'], helperKey: 'worldmodel.entities' },
  { method: 'POST', path: '/api/worldmodel/entities', usedBy: ['entity'], helperKey: 'worldmodel.createEntity' },
  { method: 'GET', path: '/api/worldmodel/entities/:id', usedBy: ['entity'], helperKey: 'worldmodel.getEntity' },
  { method: 'PUT', path: '/api/worldmodel/entities/:id', usedBy: ['entity'], helperKey: 'worldmodel.updateEntity' },
  { method: 'GET', path: '/api/worldmodel/relations', usedBy: ['entity'], helperKey: 'worldmodel.relations' },
  { method: 'POST', path: '/api/worldmodel/relations', usedBy: ['entity'], helperKey: 'worldmodel.createRelation' },
  { method: 'POST', path: '/api/worldmodel/counterfactual', usedBy: ['sim'], helperKey: 'worldmodel.counterfactual' },

  // Sovereignty
  { method: 'GET', path: '/api/sovereignty/status', usedBy: ['lock'], helperKey: 'sovereignty.status' },
  { method: 'POST', path: '/api/sovereignty/audit', usedBy: ['lock'], helperKey: 'sovereignty.audit' },

  // Experience learning
  { method: 'GET', path: '/api/experience/status', usedBy: ['experience'], helperKey: 'experience.status' },
  { method: 'POST', path: '/api/experience/retrieve', usedBy: ['experience'], helperKey: 'experience.retrieve' },
  { method: 'GET', path: '/api/experience/patterns', usedBy: ['experience'], helperKey: 'experience.patterns' },
  { method: 'POST', path: '/api/experience/consolidate', usedBy: ['experience'], helperKey: 'experience.consolidate' },
  { method: 'GET', path: '/api/experience/strategies', usedBy: ['experience'], helperKey: 'experience.strategies' },
  { method: 'GET', path: '/api/experience/recent', usedBy: ['experience'], helperKey: 'experience.recent' },

  // Attention management
  { method: 'GET', path: '/api/attention/status', usedBy: ['attention'], helperKey: 'attention.status' },
  { method: 'POST', path: '/api/attention/thread', usedBy: ['attention'], helperKey: 'attention.createThread' },
  { method: 'POST', path: '/api/attention/thread/complete', usedBy: ['attention'], helperKey: 'attention.completeThread' },
  { method: 'GET', path: '/api/attention/threads', usedBy: ['attention'], helperKey: 'attention.threads' },
  { method: 'GET', path: '/api/attention/queue', usedBy: ['attention'], helperKey: 'attention.queue' },
  { method: 'POST', path: '/api/attention/background', usedBy: ['attention'], helperKey: 'attention.addBackground' },

  // Reflection
  { method: 'GET', path: '/api/reflection/status', usedBy: ['reflection'], helperKey: 'reflection.status' },
  { method: 'GET', path: '/api/reflection/recent', usedBy: ['reflection'], helperKey: 'reflection.recent' },
  { method: 'GET', path: '/api/reflection/self-model', usedBy: ['reflection'], helperKey: 'reflection.selfModel' },
  { method: 'GET', path: '/api/reflection/insights', usedBy: ['reflection'], helperKey: 'reflection.insights' },
  { method: 'POST', path: '/api/reflection/reflect', usedBy: ['reflection'], helperKey: 'reflection.reflect' },

  // Auth extended
  { method: 'GET', path: '/api/auth/api-keys', usedBy: ['admin'], helperKey: 'auth.apiKeys.list' },
  { method: 'POST', path: '/api/auth/api-keys', usedBy: ['admin'], helperKey: 'auth.apiKeys.create' },
  { method: 'DELETE', path: '/api/auth/api-keys/:id', usedBy: ['admin'], helperKey: 'auth.apiKeys.delete' },
  { method: 'GET', path: '/api/auth/audit-log', usedBy: ['audit'], helperKey: 'auth.auditLog' },

  // ── Artistry Global ─────────────────────────────────────────
  { method: 'GET', path: '/api/artistry/assets', usedBy: ['music'], helperKey: 'artistry.assets.list' },
  { method: 'GET', path: '/api/artistry/assets/:id', usedBy: ['music'], helperKey: 'artistry.assets.get' },
  { method: 'POST', path: '/api/artistry/assets', usedBy: ['music'], helperKey: 'artistry.assets.create' },
  { method: 'PATCH', path: '/api/artistry/assets/:id', usedBy: ['music'], helperKey: 'artistry.assets.update' },
  { method: 'DELETE', path: '/api/artistry/assets/:id', usedBy: ['music'], helperKey: 'artistry.assets.delete' },
  { method: 'POST', path: '/api/artistry/blobs', usedBy: ['music'], helperKey: 'artistry.blobs.upload' },
  { method: 'GET', path: '/api/artistry/blobs/:id', usedBy: ['music'], helperKey: 'artistry.blobs.get' },
  { method: 'GET', path: '/api/artistry/genres', usedBy: ['music'], helperKey: 'artistry.genres' },
  { method: 'GET', path: '/api/artistry/asset-types', usedBy: ['music'], helperKey: 'artistry.assetTypes' },
  { method: 'GET', path: '/api/artistry/stats', usedBy: ['music'], helperKey: 'artistry.stats' },
  { method: 'GET', path: '/api/artistry/studio/projects', usedBy: ['music'], helperKey: 'artistry.studio.projects.list' },
  { method: 'GET', path: '/api/artistry/studio/projects/:id', usedBy: ['music'], helperKey: 'artistry.studio.projects.get' },
  { method: 'POST', path: '/api/artistry/studio/projects', usedBy: ['music'], helperKey: 'artistry.studio.projects.create' },
  { method: 'PATCH', path: '/api/artistry/studio/projects/:id', usedBy: ['music'], helperKey: 'artistry.studio.projects.update' },
  { method: 'POST', path: '/api/artistry/studio/projects/:id/tracks', usedBy: ['music'], helperKey: 'artistry.studio.tracks.add' },
  { method: 'PATCH', path: '/api/artistry/studio/projects/:id/tracks/:id', usedBy: ['music'], helperKey: 'artistry.studio.tracks.update' },
  { method: 'DELETE', path: '/api/artistry/studio/projects/:id/tracks/:id', usedBy: ['music'], helperKey: 'artistry.studio.tracks.delete' },
  { method: 'POST', path: '/api/artistry/studio/projects/:id/tracks/:id/effects', usedBy: ['music'], helperKey: 'artistry.studio.tracks.addEffect' },
  { method: 'POST', path: '/api/artistry/studio/projects/:id/tracks/:id/clips', usedBy: ['music'], helperKey: 'artistry.studio.tracks.addClip' },
  { method: 'GET', path: '/api/artistry/studio/instruments', usedBy: ['music'], helperKey: 'artistry.studio.instruments' },
  { method: 'GET', path: '/api/artistry/studio/effects', usedBy: ['music'], helperKey: 'artistry.studio.effects' },
  { method: 'POST', path: '/api/artistry/studio/vocal/analyze', usedBy: ['music'], helperKey: 'artistry.studio.vocal.analyze' },
  { method: 'POST', path: '/api/artistry/studio/vocal/process', usedBy: ['music'], helperKey: 'artistry.studio.vocal.process' },
  { method: 'POST', path: '/api/artistry/studio/master', usedBy: ['music'], helperKey: 'artistry.studio.master' },
  { method: 'GET', path: '/api/artistry/distribution/releases', usedBy: ['music'], helperKey: 'artistry.distribution.releases.list' },
  { method: 'GET', path: '/api/artistry/distribution/releases/:id', usedBy: ['music'], helperKey: 'artistry.distribution.releases.get' },
  { method: 'POST', path: '/api/artistry/distribution/releases', usedBy: ['music'], helperKey: 'artistry.distribution.releases.create' },
  { method: 'POST', path: '/api/artistry/distribution/stream', usedBy: ['music'], helperKey: 'artistry.distribution.stream' },
  { method: 'GET', path: '/api/artistry/distribution/streams/:id', usedBy: ['music'], helperKey: 'artistry.distribution.streams' },
  { method: 'POST', path: '/api/artistry/distribution/follow', usedBy: ['music'], helperKey: 'artistry.distribution.follow' },
  { method: 'POST', path: '/api/artistry/distribution/unfollow', usedBy: ['music'], helperKey: 'artistry.distribution.unfollow' },
  { method: 'GET', path: '/api/artistry/distribution/followers/:id', usedBy: ['music'], helperKey: 'artistry.distribution.followers' },
  { method: 'GET', path: '/api/artistry/distribution/following/:id', usedBy: ['music'], helperKey: 'artistry.distribution.following' },
  { method: 'GET', path: '/api/artistry/distribution/feed/:id', usedBy: ['music'], helperKey: 'artistry.distribution.feed' },
  { method: 'POST', path: '/api/artistry/distribution/embeds', usedBy: ['music'], helperKey: 'artistry.distribution.embeds.create' },
  { method: 'GET', path: '/api/artistry/distribution/embeds/:id', usedBy: ['music'], helperKey: 'artistry.distribution.embeds.get' },
  { method: 'GET', path: '/api/artistry/marketplace/beats', usedBy: ['music'], helperKey: 'artistry.marketplace.beats.list' },
  { method: 'POST', path: '/api/artistry/marketplace/beats', usedBy: ['music'], helperKey: 'artistry.marketplace.beats.create' },
  { method: 'GET', path: '/api/artistry/marketplace/stems', usedBy: ['music'], helperKey: 'artistry.marketplace.stems.list' },
  { method: 'POST', path: '/api/artistry/marketplace/stems', usedBy: ['music'], helperKey: 'artistry.marketplace.stems.create' },
  { method: 'GET', path: '/api/artistry/marketplace/samples', usedBy: ['music'], helperKey: 'artistry.marketplace.samples.list' },
  { method: 'POST', path: '/api/artistry/marketplace/samples', usedBy: ['music'], helperKey: 'artistry.marketplace.samples.create' },
  { method: 'GET', path: '/api/artistry/marketplace/art', usedBy: ['music'], helperKey: 'artistry.marketplace.art.list' },
  { method: 'POST', path: '/api/artistry/marketplace/art', usedBy: ['music'], helperKey: 'artistry.marketplace.art.create' },
  { method: 'POST', path: '/api/artistry/marketplace/splits', usedBy: ['music'], helperKey: 'artistry.marketplace.splits.create' },
  { method: 'GET', path: '/api/artistry/marketplace/splits/:id', usedBy: ['music'], helperKey: 'artistry.marketplace.splits.get' },
  { method: 'GET', path: '/api/artistry/marketplace/licenses', usedBy: ['music'], helperKey: 'artistry.marketplace.licenses' },
  { method: 'POST', path: '/api/artistry/marketplace/purchase', usedBy: ['music'], helperKey: 'artistry.marketplace.purchase' },
  { method: 'GET', path: '/api/artistry/collab/sessions', usedBy: ['music'], helperKey: 'artistry.collab.sessions.list' },
  { method: 'POST', path: '/api/artistry/collab/sessions', usedBy: ['music'], helperKey: 'artistry.collab.sessions.create' },
  { method: 'POST', path: '/api/artistry/collab/sessions/:id/join', usedBy: ['music'], helperKey: 'artistry.collab.sessions.join' },
  { method: 'POST', path: '/api/artistry/collab/sessions/:id/leave', usedBy: ['music'], helperKey: 'artistry.collab.sessions.leave' },
  { method: 'POST', path: '/api/artistry/collab/sessions/:id/action', usedBy: ['music'], helperKey: 'artistry.collab.sessions.action' },
  { method: 'POST', path: '/api/artistry/collab/sessions/:id/chat', usedBy: ['music'], helperKey: 'artistry.collab.sessions.chat' },
  { method: 'GET', path: '/api/artistry/collab/remixes', usedBy: ['music'], helperKey: 'artistry.collab.remix.list' },
  { method: 'POST', path: '/api/artistry/collab/remix', usedBy: ['music'], helperKey: 'artistry.collab.remix.create' },
  { method: 'GET', path: '/api/artistry/collab/shared', usedBy: ['music'], helperKey: 'artistry.collab.share.list' },
  { method: 'POST', path: '/api/artistry/collab/share', usedBy: ['music'], helperKey: 'artistry.collab.share.create' },
  { method: 'POST', path: '/api/artistry/ai/analyze-project', usedBy: ['music'], helperKey: 'artistry.ai.analyzeProject' },
  { method: 'POST', path: '/api/artistry/ai/suggest-chords', usedBy: ['music'], helperKey: 'artistry.ai.suggestChords' },
  { method: 'POST', path: '/api/artistry/ai/suggest-melody', usedBy: ['music'], helperKey: 'artistry.ai.suggestMelody' },
  { method: 'POST', path: '/api/artistry/ai/suggest-drums', usedBy: ['music'], helperKey: 'artistry.ai.suggestDrums' },
  { method: 'POST', path: '/api/artistry/ai/genre-coach', usedBy: ['music'], helperKey: 'artistry.ai.genreCoach' },
  { method: 'POST', path: '/api/artistry/ai/learning/start', usedBy: ['music'], helperKey: 'artistry.ai.learning.start' },
  { method: 'POST', path: '/api/artistry/ai/learning/complete-lesson', usedBy: ['music'], helperKey: 'artistry.ai.learning.completeLesson' },
  { method: 'GET', path: '/api/artistry/ai/learning/:id', usedBy: ['music'], helperKey: 'artistry.ai.learning.get' },
  { method: 'POST', path: '/api/artistry/ai/session', usedBy: ['music'], helperKey: 'artistry.ai.session' },

  // ── Performance / DB ──────────────────────────────────────────
  { method: 'GET', path: '/api/perf/metrics', usedBy: ['admin', 'debug'], helperKey: 'perf.metrics' },
  { method: 'GET', path: '/api/db/status', usedBy: ['database'], helperKey: 'db.status' },
  { method: 'GET', path: '/api/redis/stats', usedBy: ['admin'], helperKey: 'redis.stats' },
  { method: 'GET', path: '/api/backpressure/status', usedBy: ['admin'], helperKey: 'backpressure.status' },

  // ── Topbar / Shell ────────────────────────────────────────────
  { method: 'GET', path: '/api/resonance/quick', usedBy: ['topbar'], helperKey: undefined },
  { method: 'GET', path: '/api/notifications/count', usedBy: ['topbar'], helperKey: undefined },
  { method: 'GET', path: '/api/events', usedBy: ['dashboard'], helperKey: 'events.list' },

  // ── Generic Lens Artifact Runtime ──────────────────────────────
  { method: 'GET', path: '/api/lens/:domain', usedBy: ['all-lenses'], helperKey: 'lens.list' },
  { method: 'GET', path: '/api/lens/:domain/:id', usedBy: ['all-lenses'], helperKey: 'lens.get' },
  { method: 'POST', path: '/api/lens/:domain', usedBy: ['all-lenses'], helperKey: 'lens.create' },
  { method: 'PUT', path: '/api/lens/:domain/:id', usedBy: ['all-lenses'], helperKey: 'lens.update' },
  { method: 'DELETE', path: '/api/lens/:domain/:id', usedBy: ['all-lenses'], helperKey: 'lens.delete' },
  { method: 'POST', path: '/api/lens/:domain/:id/run', usedBy: ['all-lenses'], helperKey: 'lens.run' },
  { method: 'GET', path: '/api/lens/:domain/:id/export', usedBy: ['all-lenses'], helperKey: 'lens.export' },
  { method: 'POST', path: '/api/lens/:domain/bulk', usedBy: ['all-lenses'], helperKey: 'lens.bulkCreate' },
];

/**
 * Development helper: returns endpoint paths that appear in the inventory
 * but may have been removed or renamed on the backend.
 */
export function getInventoryPaths(): string[] {
  return ENDPOINT_INVENTORY.map((e) => `${e.method} ${e.path}`);
}

/**
 * Check if a given path+method is accounted for in the inventory.
 */
export function isEndpointKnown(method: string, path: string): boolean {
  const normalized = path.replace(/\/[a-f0-9-]{8,}(?=\/|$)/g, '/:id');
  return ENDPOINT_INVENTORY.some(
    (e) => e.method === method.toUpperCase() && e.path === normalized
  );
}
