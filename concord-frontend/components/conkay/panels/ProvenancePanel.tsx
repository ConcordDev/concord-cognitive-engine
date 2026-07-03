'use client';

// concord-frontend/components/conkay/panels/ProvenancePanel.tsx
//
// K3 — DTU Provenance panel. Surfaces the REAL `reason.verify` verdict (Track
// B's "verification IS the product" thesis) as the panel's headline, then the
// DTU refs the verify call actually checked the claim against, laid out as a
// graph via the shared `GraphView` (Obsidian-shape) component.
//
// Honesty notes:
//   - Reads `lastVerify` + `runDtuRefs` from the real `conkayHudStore` (F2)
//     via the zustand hook (not `getState()`) so the panel re-renders live as
//     new verify calls land — a React-rendered panel should track state
//     changes, unlike the per-frame 3D scene code which deliberately reads
//     `getState()` to avoid a store-driven re-render loop.
//   - The graph is an honest hub-and-spoke: one "Claim" hub node fanning out
//     to each cited DTU ref. That's the only relationship the store actually
//     carries — `ConKayOverlay#verifyMessage` mirrors the flat `dtuRefs` array
//     a message already attached (see `conkay-skills.ts#ConKaySkillResult`),
//     not a citation DAG — so we don't invent parent/child or cross-ref edges
//     that aren't real.
//   - `reason.verify`'s deterministic floor (`server/lib/reason-verify.js`)
//     reports only the AGGREGATE verdict to the frontend (`resolved`/
//     `unresolved` citation ids never leave the server) — so when the verdict
//     is `fabricated_citation` we cannot honestly point at a single bad ref.
//     We flag the WHOLE cited set instead (hub + every edge + every ref row),
//     which is the accurate reading of the data actually available. Flagged
//     elements render red and prominent — never hidden or softened.
//   - No live run yet (`lastVerify` is null AND `runDtuRefs` is empty) → an
//     explicit empty state, never a placeholder/fabricated graph.

import { useConkayHudStore } from '../conkayHudStore';
import { GraphView, type GraphNode, type GraphEdge } from '@/components/atlas/GraphView';

const HUB_ID = '__claim__';

const VERDICT_META: Record<string, { label: string; className: string }> = {
  proven: { label: 'Proven ✓', className: 'text-emerald-300 border-emerald-400/30 bg-emerald-400/10' },
  grounded: { label: 'Grounded', className: 'text-emerald-300 border-emerald-400/30 bg-emerald-400/10' },
  citations_resolve: {
    label: 'Citations resolve',
    className: 'text-emerald-300/80 border-emerald-400/20 bg-emerald-400/5',
  },
  unsupported: { label: 'Unsupported', className: 'text-amber-300 border-amber-400/30 bg-amber-400/10' },
  refuted: { label: 'Refuted', className: 'text-rose-300 border-rose-400/30 bg-rose-400/10' },
  fabricated_citation: {
    label: 'Fabricated citation',
    className: 'text-rose-300 border-rose-500/50 bg-rose-500/15',
  },
  unverified: {
    label: 'Unverified — nothing cited',
    className: 'text-cyan-300/70 border-cyan-400/20 bg-cyan-400/5',
  },
};

function verdictMeta(verdict: string) {
  return VERDICT_META[verdict] ?? { label: verdict, className: 'text-white/70 border-white/20 bg-white/5' };
}

export function ProvenancePanel() {
  const lastVerify = useConkayHudStore((s) => s.lastVerify);
  const runDtuRefs = useConkayHudStore((s) => s.runDtuRefs);

  if (!lastVerify && runDtuRefs.length === 0) {
    return (
      <div
        data-testid="ck-provenance-panel"
        className="mx-auto mt-2 max-w-2xl rounded-xl border border-cyan-400/15 bg-black/30 p-3"
      >
        <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-cyan-300/50">dtu provenance</div>
        <div data-testid="ck-provenance-empty" className="px-1 py-2 text-[11px] text-white/40">
          No verification run yet.
        </div>
      </div>
    );
  }

  const verdict = lastVerify?.verdict ?? 'unverified';
  const flagged = verdict === 'fabricated_citation';
  const meta = verdictMeta(verdict);

  const nodes: GraphNode[] = [
    { id: HUB_ID, label: 'Claim', weight: 1, flagged },
    ...runDtuRefs.map((r) => ({
      id: r.id,
      label: r.title || r.id,
      group: r.tier ?? undefined,
      weight: 0.6,
      flagged,
    })),
  ];
  const edges: GraphEdge[] = runDtuRefs.map((r) => ({
    source: HUB_ID,
    target: r.id,
    kind: 'citation',
    flagged,
  }));

  return (
    <div
      data-testid="ck-provenance-panel"
      className="mx-auto mt-2 max-w-2xl rounded-xl border border-cyan-400/15 bg-black/30 p-3"
    >
      <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-cyan-300/50">dtu provenance</div>

      {/* The verdict IS the headline this panel exists to prove — never an
          afterthought below the fold. */}
      <div
        data-testid="ck-provenance-verdict"
        data-verdict={verdict}
        data-flagged={flagged ? 'true' : 'false'}
        className={`mb-2 inline-flex items-center gap-2 rounded-lg border px-2 py-1 text-[11px] font-medium ${meta.className}`}
      >
        <span>{meta.label}</span>
        {lastVerify?.mode && <span className="text-[10px] opacity-60">via {lastVerify.mode}</span>}
        {typeof lastVerify?.confidence === 'number' && (
          <span className="text-[10px] opacity-60">{Math.round(lastVerify.confidence * 100)}%</span>
        )}
      </div>

      {runDtuRefs.length > 0 && (
        <>
          <GraphView nodes={nodes} edges={edges} />
          <ul className="mt-2 space-y-1">
            {runDtuRefs.map((r) => (
              <li
                key={r.id}
                data-testid={`ck-provenance-ref-${r.id}`}
                data-flagged={flagged ? 'true' : 'false'}
                className={`flex items-center justify-between rounded-lg px-2 py-1 text-[11px] ${
                  flagged
                    ? 'border border-rose-500/40 bg-rose-500/10 text-rose-300'
                    : 'text-cyan-100/80'
                }`}
              >
                <span className="truncate">{r.title || r.id}</span>
                {r.tier && <span className="text-[10px] opacity-60">{r.tier}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export default ProvenancePanel;
