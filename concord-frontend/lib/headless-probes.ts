/**
 * Headless-domain probe registry.
 *
 * Each entry describes how to surface a backend domain that previously
 * had no UI consumer. A probe maps a (domain, macro) pair to a card
 * that calls runDomain on mount and renders a domain-specific summary.
 *
 * Per-probe accent colour + icon are unique-per-entry so cards always
 * look distinct inside the same lens — supporting the rule that no two
 * surfaces feel identical even when they share chrome.
 */

export type ProbeGroup = 'substrate' | 'dtu' | 'integration' | 'productivity';

export interface HeadlessProbe {
  domain: string;
  macro: string;
  /** Optional input payload sent with the runDomain call. */
  input?: Record<string, unknown>;
  title: string;
  description: string;
  /** Lucide icon name as exported from lucide-react (e.g. 'Database'). */
  icon: string;
  /**
   * Tailwind accent token. Drives border, glow, badge tone — each
   * probe gets a different accent to keep the grid visually layered.
   */
  accent:
    | 'cyan'
    | 'violet'
    | 'emerald'
    | 'amber'
    | 'rose'
    | 'sky'
    | 'fuchsia'
    | 'lime'
    | 'orange'
    | 'teal'
    | 'indigo'
    | 'pink';
  /** Where this probe naturally belongs. */
  group: ProbeGroup;
  /** Optional human-readable formatter for the response payload. */
  summarise?: (response: unknown) => string;
}

function summariseList(label: string) {
  return (r: unknown) => {
    if (Array.isArray(r)) return `${r.length} ${label}`;
    if (r && typeof r === 'object' && Array.isArray((r as Record<string, unknown>).items)) {
      return `${(r as { items: unknown[] }).items.length} ${label}`;
    }
    if (r && typeof r === 'object') {
      const keys = Object.keys(r as object);
      return keys.length ? `${keys.length} fields` : 'ok';
    }
    return 'ok';
  };
}

function summariseStatus() {
  return (r: unknown) => {
    if (!r || typeof r !== 'object') return 'ok';
    const o = r as Record<string, unknown>;
    if (typeof o.ok === 'boolean') return o.ok ? 'healthy' : 'attention';
    if (typeof o.status === 'string') return o.status;
    if (typeof o.state === 'string') return o.state;
    return `${Object.keys(o).length} fields`;
  };
}

export const HEADLESS_PROBES: HeadlessProbe[] = [
  // ── Substrate / ops ───────────────────────────────────────────────────────
  { domain: 'cache', macro: 'stats', title: 'Cache', description: 'Layer hit-rate + eviction telemetry.', icon: 'Database', accent: 'cyan', group: 'substrate', summarise: summariseStatus() },
  { domain: 'governor', macro: 'check', title: 'Governor', description: 'Budget gates + admission decisions.', icon: 'Gauge', accent: 'amber', group: 'substrate', summarise: summariseStatus() },
  { domain: 'shard', macro: 'stats', title: 'Shard', description: 'Sharding map + per-shard load.', icon: 'Boxes', accent: 'sky', group: 'substrate', summarise: summariseStatus() },
  { domain: 'harness', macro: 'run', input: { dryRun: true }, title: 'Harness', description: 'Boot + smoke harness state.', icon: 'CircuitBoard', accent: 'violet', group: 'substrate', summarise: summariseStatus() },
  { domain: 'scope', macro: 'promote', input: { dryRun: true }, title: 'Scope', description: 'Personal → public scope promotion.', icon: 'Shield', accent: 'emerald', group: 'substrate', summarise: summariseStatus() },
  { domain: 'sync', macro: 'force', input: { dryRun: true }, title: 'Sync', description: 'Forced reconciliation passes.', icon: 'RefreshCcw', accent: 'sky', group: 'substrate', summarise: summariseStatus() },
  { domain: 'log', macro: 'list', title: 'Log', description: 'Structured event tail.', icon: 'ScrollText', accent: 'orange', group: 'substrate', summarise: summariseList('entries') },
  { domain: 'verify', macro: 'feasibility', input: { target: 'self' }, title: 'Verify', description: 'Feasibility / preflight checks.', icon: 'CheckCircle', accent: 'lime', group: 'substrate', summarise: summariseStatus() },
  { domain: 'layer', macro: 'list', title: 'Layer', description: 'Cognitive layer registry.', icon: 'Layers', accent: 'indigo', group: 'substrate', summarise: summariseList('layers') },
  { domain: 'wrapper', macro: 'list', title: 'Wrapper', description: 'Active wrapper bindings.', icon: 'Wrap', accent: 'teal', group: 'substrate', summarise: summariseList('wrappers') },
  { domain: 'heartbeat', macro: 'tick', input: { dryRun: true }, title: 'Heartbeat', description: 'Tick cadence + skip counter.', icon: 'Activity', accent: 'rose', group: 'substrate', summarise: summariseStatus() },
  { domain: 'evolution', macro: 'dedupe', input: { dryRun: true }, title: 'Evolution', description: 'Substrate-evolution dedupe pass.', icon: 'Dna', accent: 'fuchsia', group: 'substrate', summarise: summariseStatus() },
  { domain: 'experiment', macro: 'log', input: { name: 'inspector' }, title: 'Experiment', description: 'Active experiment ledger.', icon: 'FlaskConical', accent: 'pink', group: 'substrate', summarise: summariseStatus() },
  { domain: 'interface', macro: 'tabs', title: 'Interface', description: 'Surface tab registry.', icon: 'PanelTopOpen', accent: 'cyan', group: 'substrate', summarise: summariseList('tabs') },
  { domain: 'cortex', macro: 'metrics', title: 'Cortex', description: 'Repair-cortex live metrics.', icon: 'Brain', accent: 'violet', group: 'substrate', summarise: summariseStatus() },
  { domain: 'automation', macro: 'list', title: 'Automation', description: 'Scheduled + reactive automations.', icon: 'Bot', accent: 'amber', group: 'substrate', summarise: summariseList('automations') },
  { domain: 'plugin', macro: 'list', title: 'Plugin', description: 'Installed plugin gallery.', icon: 'Puzzle', accent: 'emerald', group: 'substrate', summarise: summariseList('plugins') },
  { domain: 'foundation', macro: 'status', title: 'Foundation', description: 'Foundation invariants snapshot.', icon: 'Anvil', accent: 'sky', group: 'substrate', summarise: summariseStatus() },
  { domain: 'swarm', macro: 'run', input: { dryRun: true }, title: 'Swarm', description: 'Worker swarm status.', icon: 'Bug', accent: 'lime', group: 'substrate', summarise: summariseStatus() },
  { domain: 'agent', macro: 'list', title: 'Agent', description: 'Registered agents.', icon: 'Users', accent: 'rose', group: 'substrate', summarise: summariseList('agents') },
  { domain: 'intent', macro: 'rhythmic_intent', title: 'Intent', description: 'Rhythmic intent detector.', icon: 'Compass', accent: 'fuchsia', group: 'substrate', summarise: summariseStatus() },
  { domain: 'search', macro: 'query', input: { q: '*', limit: 1 }, title: 'Search', description: 'Hybrid search backend.', icon: 'Search', accent: 'pink', group: 'substrate', summarise: summariseStatus() },
  { domain: 'llm', macro: 'embed', input: { text: 'probe' }, title: 'LLM', description: 'Local embedding probe.', icon: 'Cpu', accent: 'indigo', group: 'substrate', summarise: summariseStatus() },

  // ── DTU operations ────────────────────────────────────────────────────────
  { domain: 'dtu', macro: 'stats', title: 'DTU', description: 'Substrate population + tier distribution.', icon: 'Network', accent: 'cyan', group: 'dtu', summarise: summariseStatus() },
  { domain: 'promotion', macro: 'queue', title: 'Promotion', description: 'Promotion queue + history.', icon: 'TrendingUp', accent: 'amber', group: 'dtu', summarise: summariseList('pending') },
  { domain: 'autotag', macro: 'classify', input: { sample: 'probe' }, title: 'Autotag', description: 'Tag classifier round-trip.', icon: 'Tags', accent: 'violet', group: 'dtu', summarise: summariseStatus() },
  { domain: 'dream', macro: 'count', title: 'Dream', description: 'Composed dreams ledger.', icon: 'Moon', accent: 'indigo', group: 'dtu', summarise: summariseStatus() },
  { domain: 'chicken3', macro: 'status', title: 'Chicken3', description: 'Tertiary safe-read posture.', icon: 'ShieldCheck', accent: 'emerald', group: 'dtu', summarise: summariseStatus() },
  { domain: 'explanation', macro: 'recent', title: 'Explanation', description: 'Recent explainable-AI traces.', icon: 'Lightbulb', accent: 'orange', group: 'dtu', summarise: summariseList('traces') },
  { domain: 'multimodal', macro: 'vision_analyze', input: { dryRun: true }, title: 'Multimodal', description: 'Vision + audio routing.', icon: 'Eye', accent: 'fuchsia', group: 'dtu', summarise: summariseStatus() },
  { domain: 'source', macro: 'list', title: 'Source', description: 'Ingest source ledger.', icon: 'Inbox', accent: 'sky', group: 'dtu', summarise: summariseList('sources') },
  { domain: 'crawl', macro: 'fetch', input: { dryRun: true }, title: 'Crawl', description: 'Crawler queue snapshot.', icon: 'Globe', accent: 'teal', group: 'dtu', summarise: summariseStatus() },
  { domain: 'universe', macro: 'status', title: 'Universe', description: 'Universe-coverage telemetry.', icon: 'Sparkles', accent: 'rose', group: 'dtu', summarise: summariseStatus() },
  { domain: 'style', macro: 'get', title: 'Style', description: 'Active style tokens.', icon: 'Brush', accent: 'pink', group: 'dtu', summarise: summariseStatus() },
  { domain: 'visual', macro: 'sunburst', input: { sample: true }, title: 'Visual', description: 'Sunburst / mood visualisations.', icon: 'PieChart', accent: 'lime', group: 'dtu', summarise: summariseStatus() },
  { domain: 'skill', macro: 'create', input: { dryRun: true, name: 'probe' }, title: 'Skill', description: 'Skill registry probe.', icon: 'Award', accent: 'cyan', group: 'dtu', summarise: summariseStatus() },
  { domain: 'synth', macro: 'combine', input: { dryRun: true }, title: 'Synth', description: 'Synthesis orchestrator.', icon: 'GitMerge', accent: 'violet', group: 'dtu', summarise: summariseStatus() },

  // ── Productivity (universe-gap stubs) ─────────────────────────────────────
  { domain: 'spreadsheet', macro: 'eval', input: { expr: '=1+1' }, title: 'Spreadsheet', description: 'Expression evaluator.', icon: 'Grid3x3', accent: 'emerald', group: 'productivity', summarise: summariseStatus() },
  { domain: 'slides', macro: 'compile', input: { slides: [], dryRun: true }, title: 'Slides', description: 'Slide compilation pipeline.', icon: 'Presentation', accent: 'orange', group: 'productivity', summarise: summariseStatus() },

  // ── Integrations ──────────────────────────────────────────────────────────
  { domain: 'notion', macro: 'import', input: { dryRun: true }, title: 'Notion', description: 'Import Notion workspace.', icon: 'FileText', accent: 'amber', group: 'integration', summarise: summariseStatus() },
  { domain: 'obsidian', macro: 'export', input: { dryRun: true }, title: 'Obsidian', description: 'Export an Obsidian vault.', icon: 'BookOpen', accent: 'violet', group: 'integration', summarise: summariseStatus() },
  { domain: 'vscode', macro: 'search', input: { q: 'probe' }, title: 'VS Code', description: 'VS Code workspace probe.', icon: 'TerminalSquare', accent: 'sky', group: 'integration', summarise: summariseStatus() },
  { domain: 'mobile', macro: 'shortcuts', title: 'Mobile', description: 'iOS / Android shortcut catalog.', icon: 'Smartphone', accent: 'rose', group: 'integration', summarise: summariseList('shortcuts') },
  { domain: 'pwa', macro: 'manifest', title: 'PWA', description: 'Generated PWA manifest.', icon: 'AppWindow', accent: 'cyan', group: 'integration', summarise: summariseStatus() },
  { domain: 'integration', macro: 'list', title: 'Integrations', description: 'Configured external integrations.', icon: 'Link2', accent: 'fuchsia', group: 'integration', summarise: summariseList('integrations') },
];

export function probesByGroup(group: ProbeGroup): HeadlessProbe[] {
  return HEADLESS_PROBES.filter((p) => p.group === group);
}

export function probeAccentClasses(accent: HeadlessProbe['accent']) {
  // Static class strings so Tailwind's JIT picks them up.
  const map: Record<HeadlessProbe['accent'], { border: string; glow: string; text: string; dot: string }> = {
    cyan:    { border: 'border-cyan-500/30',    glow: 'hover:border-cyan-400/60',    text: 'text-cyan-300',    dot: 'bg-cyan-400' },
    violet:  { border: 'border-violet-500/30',  glow: 'hover:border-violet-400/60',  text: 'text-violet-300',  dot: 'bg-violet-400' },
    emerald: { border: 'border-emerald-500/30', glow: 'hover:border-emerald-400/60', text: 'text-emerald-300', dot: 'bg-emerald-400' },
    amber:   { border: 'border-amber-500/30',   glow: 'hover:border-amber-400/60',   text: 'text-amber-300',   dot: 'bg-amber-400' },
    rose:    { border: 'border-rose-500/30',    glow: 'hover:border-rose-400/60',    text: 'text-rose-300',    dot: 'bg-rose-400' },
    sky:     { border: 'border-sky-500/30',     glow: 'hover:border-sky-400/60',     text: 'text-sky-300',     dot: 'bg-sky-400' },
    fuchsia: { border: 'border-fuchsia-500/30', glow: 'hover:border-fuchsia-400/60', text: 'text-fuchsia-300', dot: 'bg-fuchsia-400' },
    lime:    { border: 'border-lime-500/30',    glow: 'hover:border-lime-400/60',    text: 'text-lime-300',    dot: 'bg-lime-400' },
    orange:  { border: 'border-orange-500/30',  glow: 'hover:border-orange-400/60',  text: 'text-orange-300',  dot: 'bg-orange-400' },
    teal:    { border: 'border-teal-500/30',    glow: 'hover:border-teal-400/60',    text: 'text-teal-300',    dot: 'bg-teal-400' },
    indigo:  { border: 'border-indigo-500/30',  glow: 'hover:border-indigo-400/60',  text: 'text-indigo-300',  dot: 'bg-indigo-400' },
    pink:    { border: 'border-pink-500/30',    glow: 'hover:border-pink-400/60',    text: 'text-pink-300',    dot: 'bg-pink-400' },
  };
  return map[accent];
}
