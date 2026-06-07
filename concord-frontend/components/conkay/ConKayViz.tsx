'use client';

// concord-frontend/components/conkay/ConKayViz.tsx
//
// ConKay's dual-mode renderer: given an assistant reply, decide whether it's
// plain conversation or data-bearing, and render data as live graphics instead
// of text. The decision keys off REAL signals the chat backend already returns
// (computed / dtuRefs / refs / sources / toolCalls) plus an optional LLM-emitted
// ```conkay-viz``` block — never a faked marker. The prose always renders too.
//
// "The animation is easy; the semantic mapping is the work." This file IS that
// mapping: structured-output-shape → meaningful visualization, reusing ChartKit.

import { useMemo } from 'react';
import { BarChart3, Database, Globe, Wrench, Network, Cpu, ShieldCheck, AlertTriangle } from 'lucide-react';
import { ChartKit } from '@/components/viz/ChartKit';

export interface ConKayReplyFields {
  content: string;
  computed?: unknown;
  dtuRefs?: unknown;
  refs?: unknown;
  sources?: unknown;
  toolCalls?: unknown;
  webAugmented?: boolean;
  /** Which brain/source produced the reply, if the backend reported it. */
  brain?: string;
  /**
   * The REAL verdict from the reason.verify macro (Track B / Phase 1) when the
   * reply's citations were checked: 'pending' while in flight, then one of
   * grounded | citations_resolve | unsupported | fabricated_citation | unverified.
   * When present it drives the TrustBadge instead of the local heuristic.
   */
  verifyVerdict?: string;
}

// Map a raw backend source/model id to a friendly brain label. Returns null for
// uninformative values (so we never show a meaningless chip).
function brainLabel(raw?: string): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const s = raw.toLowerCase();
  if (s.includes('conscious') && !s.includes('sub')) return 'conscious brain';
  if (s.includes('subconscious')) return 'subconscious brain';
  if (s.includes('utility')) return 'utility brain';
  if (s.includes('repair')) return 'repair brain';
  if (s.includes('vision') || s.includes('multimodal')) return 'vision brain';
  if (s === 'cache' || s.includes('cached')) return 'memory (cached)';
  return null;
}

interface VizSpec {
  type: 'metrics' | 'series' | 'bars' | 'graph';
  title?: string;
  data: unknown;
}

// Pull the first ```conkay-viz {json}``` block out of the prose; return the spec
// and the prose with the block removed (so it renders as graphics, not raw json).
function extractVizBlock(content: string): { spec: VizSpec | null; prose: string } {
  const m = content.match(/```conkay-viz\s*([\s\S]*?)```/i);
  if (!m) return { spec: null, prose: content };
  let spec: VizSpec | null = null;
  try {
    const parsed = JSON.parse(m[1].trim());
    if (parsed && typeof parsed === 'object' && parsed.type && 'data' in parsed) spec = parsed as VizSpec;
  } catch { /* malformed block → ignore, leave prose intact */ }
  const prose = content.replace(m[0], '').trim();
  return { spec, prose: spec ? prose : content };
}

function asArray(x: unknown): Record<string, unknown>[] {
  if (Array.isArray(x)) return x as Record<string, unknown>[];
  if (x && typeof x === 'object') return [x as Record<string, unknown>];
  return [];
}

function Panel({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="mt-2 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.03] p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-cyan-300/80">
        {icon}{title}
      </div>
      {children}
    </div>
  );
}

function MetricsViz({ spec }: { spec: VizSpec }) {
  const rows = asArray(spec.data);
  return (
    <Panel icon={<BarChart3 className="h-3 w-3" />} title={spec.title || 'Metrics'}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {rows.map((r, i) => (
          <div key={i} className="rounded-lg border border-lattice-border bg-lattice-elevated/50 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-zinc-500">{String(r.label ?? r.name ?? '')}</div>
            <div className="text-lg font-semibold text-zinc-100">{String(r.value ?? r.v ?? '')}</div>
            {r.delta != null && <div className="text-[11px] text-emerald-300">{String(r.delta)}</div>}
          </div>
        ))}
      </div>
    </Panel>
  );
}

function SeriesViz({ spec, kind }: { spec: VizSpec; kind: 'area' | 'bar' }) {
  const rows = asArray(spec.data).map((r) => ({
    x: String(r.x ?? r.label ?? r.bucket ?? ''),
    y: Number(r.y ?? r.value ?? r.count ?? 0),
  }));
  if (rows.length === 0) return null;
  return (
    <Panel icon={<BarChart3 className="h-3 w-3" />} title={spec.title || (kind === 'bar' ? 'Comparison' : 'Trend')}>
      <ChartKit kind={kind} data={rows} xKey="x" series={[{ key: 'y', label: spec.title || 'value', color: '#00d4ff' }]} height={200} />
    </Panel>
  );
}

function GraphViz({ spec }: { spec: VizSpec }) {
  const data = (spec.data && typeof spec.data === 'object' ? spec.data : {}) as { nodes?: unknown; edges?: unknown };
  const nodes = asArray(data.nodes);
  const edges = asArray(data.edges);
  if (nodes.length === 0) return null;
  return (
    <Panel icon={<Network className="h-3 w-3" />} title={spec.title || 'Relationships'}>
      <div className="flex flex-wrap gap-1.5">
        {nodes.map((n, i) => (
          <span key={i} className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-1 text-[12px] text-cyan-100">
            {String(n.label ?? n.id ?? '')}
          </span>
        ))}
      </div>
      {edges.length > 0 && (
        <div className="mt-2 space-y-0.5 text-[11px] text-zinc-500">
          {edges.slice(0, 8).map((e, i) => (
            <div key={i}>{String(e.from ?? '')} → {String(e.to ?? '')}{e.label ? ` · ${String(e.label)}` : ''}</div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function Viz({ spec }: { spec: VizSpec }) {
  switch (spec.type) {
    case 'metrics': return <MetricsViz spec={spec} />;
    case 'bars': return <SeriesViz spec={spec} kind="bar" />;
    case 'series': return <SeriesViz spec={spec} kind="area" />;
    case 'graph': return <GraphViz spec={spec} />;
    default: return null;
  }
}

// Archive (DTU) + research (web) citations — "pulling from archives plus research."
function Citations({ fields }: { fields: ConKayReplyFields }) {
  const dtus = useMemo(() => {
    const arr = asArray(fields.dtuRefs).concat(asArray(fields.refs));
    return arr.map((d) => ({
      id: String(d.id ?? d.dtuId ?? ''),
      title: String(d.title ?? d.name ?? d.id ?? d.dtuId ?? 'DTU'),
    })).filter((d) => d.title);
  }, [fields.dtuRefs, fields.refs]);
  const sources = useMemo(() => asArray(fields.sources).map((s) => ({
    title: String(s.title ?? s.name ?? s.url ?? 'source'),
    url: typeof s.url === 'string' ? s.url : undefined,
  })).filter((s) => s.title), [fields.sources]);

  if (dtus.length === 0 && sources.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {dtus.slice(0, 6).map((d, i) => (
        <span key={`d${i}`} title={d.id}
          className="inline-flex items-center gap-1 rounded-md border border-fuchsia-400/25 bg-fuchsia-400/10 px-2 py-0.5 text-[11px] text-fuchsia-200">
          <Database className="h-3 w-3" /> {d.title.length > 32 ? d.title.slice(0, 32) + '…' : d.title}
        </span>
      ))}
      {sources.slice(0, 5).map((s, i) => (
        s.url ? (
          <a key={`s${i}`} href={s.url} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-sky-400/25 bg-sky-400/10 px-2 py-0.5 text-[11px] text-sky-200 hover:bg-sky-400/20">
            <Globe className="h-3 w-3" /> {s.title.length > 28 ? s.title.slice(0, 28) + '…' : s.title}
          </a>
        ) : (
          <span key={`s${i}`} className="inline-flex items-center gap-1 rounded-md border border-sky-400/25 bg-sky-400/10 px-2 py-0.5 text-[11px] text-sky-200">
            <Globe className="h-3 w-3" /> {s.title.length > 28 ? s.title.slice(0, 28) + '…' : s.title}
          </span>
        )
      ))}
    </div>
  );
}

function ToolCalls({ toolCalls }: { toolCalls: unknown }) {
  const calls = asArray(toolCalls);
  if (calls.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {calls.slice(0, 6).map((c, i) => (
        <span key={i} className="inline-flex items-center gap-1 rounded-md border border-amber-400/25 bg-amber-400/10 px-2 py-0.5 text-[11px] text-amber-200">
          <Wrench className="h-3 w-3" /> {String(c.name ?? c.action ?? `${c.domain ?? ''}.${c.macro ?? ''}`).replace(/^\.|\.$/g, '') || 'action'}
        </span>
      ))}
    </div>
  );
}

/**
 * TrustBadge — the verifiability surface. A trustworthy assistant is honest
 * about WHAT it knows vs. what it's guessing. A reply is "grounded" when it's
 * backed by a real artifact — a cited DTU from your archive, a web source, a
 * completed macro/action, or computed data. Those read confidently. A
 * prose-only reply (the model reasoning from context) is labelled honestly:
 * it isn't verified, so check it before relying on it. (ConKay organizes and
 * accelerates — it does not certify; especially not real-world/physics claims.)
 */
// Render one of the REAL reason.verify verdicts. Each maps 1:1 to the macro's
// output — the badge IS the verification result, never a guess.
function VerdictBadge({ verdict }: { verdict: string }) {
  switch (verdict) {
    case "pending":
      return (
        <span className="inline-flex items-center gap-1 text-[10px] text-cyan-300/70 ck-shimmer" title="Checking the cited sources against your archive…">
          <ShieldCheck className="h-3 w-3" /> Verifying…
        </span>
      );
    case "grounded":
      return (
        <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400/90" title="The multi-brain council confirmed the cited sources support this claim.">
          <ShieldCheck className="h-3 w-3" /> Grounded
        </span>
      );
    case "citations_resolve":
      return (
        <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400/75" title="Every cited source resolves to a real DTU in your archive (deterministic check). The council judge was offline, so this isn't fully certified — but the citations are real.">
          <ShieldCheck className="h-3 w-3" /> Citations resolve
        </span>
      );
    case "unsupported":
      return (
        <span className="inline-flex items-center gap-1 text-[10px] text-amber-400/90" title="The cited sources resolve, but the council judged they do NOT back this claim. Verify before relying on it.">
          <AlertTriangle className="h-3 w-3" /> Unsupported
        </span>
      );
    case "fabricated_citation":
      return (
        <span className="inline-flex items-center gap-1 text-[10px] text-rose-400/90" title="A cited source does NOT exist in your archive — a fabricated citation. Do not rely on this claim.">
          <AlertTriangle className="h-3 w-3" /> Unverified — citation not found
        </span>
      );
    default: // "unverified" or anything unexpected
      return (
        <span className="inline-flex items-center gap-1 text-[10px] text-amber-400/80" title="Nothing cited to check against — ConKay reasoned this from context. Verify before relying on it.">
          <AlertTriangle className="h-3 w-3" /> Reasoned — verify
        </span>
      );
  }
}

function TrustBadge({ fields }: { fields: ConKayReplyFields }) {
  // Phase 1: when the reply's citations were run through the reason.verify macro,
  // the badge shows that REAL verdict (the verification IS the product).
  if (fields.verifyVerdict) return <VerdictBadge verdict={fields.verifyVerdict} />;

  // Otherwise fall back to the local heuristic: grounded when backed by a real
  // artifact (cited DTU, web source, completed action, or computed data).
  const grounded =
    asArray(fields.dtuRefs).length > 0 ||
    asArray(fields.refs).length > 0 ||
    asArray(fields.sources).length > 0 ||
    asArray(fields.toolCalls).length > 0 ||
    (Array.isArray(fields.computed) && fields.computed.length > 0);

  if (grounded) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400/80" title="Backed by your archive, a web source, a completed action, or computed data.">
        <ShieldCheck className="h-3 w-3" /> Grounded
      </span>
    );
  }
  // Prose-only → reasoning, not a cited fact. Be honest so a confidently-wrong
  // answer never reads as verified.
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-amber-400/80" title="ConKay reasoned this from context — it isn't backed by a cited source or a completed action. Verify before relying on it (and never as proof of real-world/physics behaviour).">
      <AlertTriangle className="h-3 w-3" /> Reasoned — verify
    </span>
  );
}

/**
 * ConKayMessage — renders an assistant reply in ConKay's dual-mode style:
 * prose (always) + any live visualization + archive/research citations +
 * ambient action chips. `renderProse` lets the host pass its existing markdown
 * renderer so we don't fork message formatting.
 */
export function ConKayMessage({
  fields,
  renderProse,
}: {
  fields: ConKayReplyFields;
  renderProse: (text: string) => React.ReactNode;
}) {
  const { spec, prose } = useMemo(() => extractVizBlock(fields.content || ''), [fields.content]);
  // computed payload from the backend → render as a series/metrics if shaped that way
  const computedSpec = useMemo<VizSpec | null>(() => {
    const c = fields.computed;
    if (!c) return null;
    if (Array.isArray(c) && c.length && typeof c[0] === 'object') {
      const k = Object.keys(c[0] as object);
      if (k.includes('value') && k.includes('label')) return { type: 'metrics', title: 'Computed', data: c };
      return { type: 'series', title: 'Computed', data: c };
    }
    return null;
  }, [fields.computed]);

  const brain = brainLabel(fields.brain);
  return (
    <div className="conkay-message">
      <div className="conkay-prose">{renderProse(prose)}</div>
      {spec && <Viz spec={spec} />}
      {computedSpec && <Viz spec={computedSpec} />}
      <Citations fields={fields} />
      <ToolCalls toolCalls={fields.toolCalls} />
      <div className="mt-2 flex items-center gap-3">
        <TrustBadge fields={fields} />
        {brain && (
          <span className="inline-flex items-center gap-1 text-[10px] text-zinc-500">
            <Cpu className="h-3 w-3" /> via {brain}
          </span>
        )}
      </div>
    </div>
  );
}

export default ConKayMessage;
