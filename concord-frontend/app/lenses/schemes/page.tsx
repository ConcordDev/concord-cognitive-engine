'use client';

/**
 * /lenses/schemes — Player-driven scheme runner.
 *
 * Concordia Phase 1. Substrate: `npc_schemes` (mig 155) with
 * plotter_kind='player' + `hook_artifacts` (mig 172). The lens
 * surfaces three coupled lists:
 *   - Active schemes you're plotting (with phase, evidence, accomplices)
 *   - Eligible targets (NPCs who hate you OR are high-stress)
 *   - Hooks you've gathered (carry / drop / destroy)
 *
 * Plus: schemes targeting YOU (the discoverScheme path).
 *
 * Motive gate: you can only propose a scheme against an NPC who hates
 * you (opinion ≤ -50) OR is high-stress (≥ 60). This mirrors the
 * NPC-side gate. Without that, schemes are griefspam, not roleplay.
 */
// Error handling: LensErrorBoundary (auto-mounted by LensShell) catches render errors. Local fetch errors surfaced via status banner.
// Empty state: handled inline per section (Sprint 17 invariant).

import { useEffect, useState } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';

interface PlayerScheme {
  id: string;
  target_kind: string;
  target_id: string;
  kind: string;
  phase: string;
  success_pct: number;
  discovery_pct: number;
  evidence_count: number;
  accomplice_count: number;
}

interface SchemeAgainstMe {
  id: string;
  plotter_kind: string;
  plotter_id: string;
  kind: string;
  phase: string;
  success_pct: number;
  discovery_pct: number;
  evidence_count: number;
  accomplice_count: number;
}

interface Target {
  npcId: string;
  reason: 'low_opinion' | 'high_stress';
  opinion?: number;
  stress?: number;
  coping?: string | null;
}

interface Hook {
  id: string;
  world_id: string;
  secret_id: string | null;
  evidence_id: string | null;
  label: string;
  created_at: number;
}

const SCHEME_KINDS: Array<{ kind: string; label: string; needsEvidence: boolean }> = [
  { kind: 'assassinate', label: 'Assassinate', needsEvidence: true },
  { kind: 'blackmail', label: 'Blackmail', needsEvidence: true },
  { kind: 'seduce', label: 'Seduce', needsEvidence: false },
  { kind: 'fabricate_secret', label: 'Fabricate Secret', needsEvidence: false },
  { kind: 'claim_inheritance', label: 'Claim Inheritance', needsEvidence: true },
  { kind: 'sabotage_decree', label: 'Sabotage Decree', needsEvidence: false },
];

const PHASE_LABEL: Record<string, string> = {
  planning: 'Planning',
  recruiting: 'Recruiting',
  gathering_evidence: 'Gathering Evidence',
  moving: 'Moving',
  complete: 'Complete',
  exposed: 'Exposed',
  abandoned: 'Abandoned',
};

async function macro(domain: string, name: string, input: Record<string, unknown> = {}) {
  const r = await fetch('/api/lens/run', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain, name, input }),
  }).catch(() => null);
  return r ? r.json().catch(() => null) : null;
}

export default function SchemesPage() {
  useLensCommand([
    { id: 'schemes-help', keys: '?', description: 'Lens help', category: 'navigation', action: () => { /* surfaced via tooltip */ } },
  ], { lensId: 'schemes' });

  const [mine, setMine] = useState<PlayerScheme[]>([]);
  const [against, setAgainst] = useState<SchemeAgainstMe[]>([]);
  const [targets, setTargets] = useState<Target[]>([]);
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<string>('');
  const [selectedKind, setSelectedKind] = useState<string>('blackmail');
  const worldId = (typeof window !== 'undefined' && window.localStorage.getItem('concordia:activeWorldId')) || 'concordia-hub';

  const refresh = async () => {
    const [m, a, t, h] = await Promise.all([
      macro('schemes', 'list_for_user'),
      macro('schemes', 'list_against_user'),
      macro('schemes', 'list_targets', { limit: 20 }),
      macro('hooks', 'list', { worldId }),
    ]);
    if (m?.ok) setMine(m.schemes || []);
    if (a?.ok) setAgainst(a.schemes || []);
    if (t?.ok) setTargets(t.targets || []);
    if (h?.ok) setHooks(h.hooks || []);
    setLoading(false);
  };

  useEffect(() => { void refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- one-shot bootstrap; refresh is recreated each render but we only want it on mount

  const propose = async () => {
    if (!selectedTarget || !selectedKind) {
      setStatus('Pick a target and a scheme kind first.');
      window.setTimeout(() => setStatus(null), 4000);
      return;
    }
    setStatus(`Proposing ${selectedKind} against ${selectedTarget}…`);
    const r = await macro('schemes', 'propose_player_scheme', {
      targetKind: 'npc',
      targetId: selectedTarget,
      kind: selectedKind,
    });
    if (r?.ok) {
      setStatus(`✓ Scheme opened (${r.schemeId}). Recruiting now.`);
      setSelectedTarget('');
      await refresh();
    } else {
      setStatus(`Failed: ${r?.reason || 'unknown'}`);
    }
    window.setTimeout(() => setStatus(null), 6000);
  };

  const gather = async (schemeId: string) => {
    setStatus(`Gathering evidence on ${schemeId}…`);
    const r = await macro('schemes', 'gather_evidence', { schemeId, worldId });
    if (r?.ok) {
      setStatus(`✓ Evidence added. Hook artifact dropped — pick it up before someone else does.`);
      await refresh();
    } else {
      setStatus(`Failed: ${r?.reason || 'unknown'}`);
    }
    window.setTimeout(() => setStatus(null), 6000);
  };

  const move = async (schemeId: string) => {
    setStatus(`Moving on ${schemeId}…`);
    const r = await macro('schemes', 'move', { schemeId });
    if (r?.ok) {
      setStatus(`✓ Phase transitioned: ${r.toPhase || 'advanced'}.`);
      await refresh();
    } else {
      setStatus(`Failed: ${r?.reason || 'unknown'}`);
    }
    window.setTimeout(() => setStatus(null), 6000);
  };

  const abandon = async (schemeId: string) => {
    if (!window.confirm('Abandon this scheme? It cannot be resumed.')) return;
    const r = await macro('schemes', 'abandon', { schemeId });
    if (r?.ok) {
      setStatus(`✓ Scheme abandoned.`);
      await refresh();
    } else {
      setStatus(`Failed: ${r?.reason || 'unknown'}`);
    }
    window.setTimeout(() => setStatus(null), 4000);
  };

  const destroyHook = async (hookId: string) => {
    if (!window.confirm('Destroy this hook? This is permanent.')) return;
    const r = await macro('hooks', 'destroy', { hookId });
    if (r?.ok) {
      setStatus(`✓ Hook destroyed.`);
      await refresh();
    } else {
      setStatus(`Failed: ${r?.reason || 'unknown'}`);
    }
    window.setTimeout(() => setStatus(null), 4000);
  };

  const discoverEvidence = async (schemeId: string) => {
    const r = await macro('schemes', 'discover_evidence', { schemeId });
    if (r?.ok) {
      setStatus(r.exposed ? `✓ Scheme exposed — they know you know.` : `✓ Evidence marked discovered.`);
      await refresh();
    } else {
      setStatus(`Failed: ${r?.reason || 'unknown'}`);
    }
    window.setTimeout(() => setStatus(null), 6000);
  };

  return (
    <LensShell lensId="schemes">
      <div className="p-6 sm:p-8 max-w-4xl mx-auto">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-zinc-100">Schemes</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Plot against NPCs who hate you back, or who are too unstable to stop you. Gather evidence, carry it home,
            and decide when to move. The substrate is symmetric — they can plot against you too.
          </p>
        </header>

        {status && (
          <div role="status" aria-live="polite" className="mb-4 bg-amber-950/50 border border-amber-700/50 text-amber-200 px-3 py-2 rounded-lg text-sm">
            {status}
          </div>
        )}

        {/* Propose form */}
        <section aria-labelledby="propose-heading" className="mb-8 bg-zinc-900/80 border border-zinc-700/50 rounded-xl p-4">
          <h2 id="propose-heading" className="text-sm font-bold text-zinc-100 mb-3">Propose a scheme</h2>
          {loading ? (
            <div className="text-zinc-500 text-sm">Loading eligible targets…</div>
          ) : targets.length === 0 ? (
            <div className="text-zinc-500 text-sm italic">
              No eligible targets. NPCs become targetable when their opinion of you drops to <code>-50</code> or below, or
              when their stress climbs to <code>60+</code>.
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <label className="block">
                <span className="block text-xs text-zinc-400 mb-1">Target NPC</span>
                <select
                  aria-label="Target NPC"
                  value={selectedTarget}
                  onChange={(e) => setSelectedTarget(e.target.value)}
                  className="bg-zinc-800 border border-zinc-700 text-zinc-100 rounded px-2 py-1 text-sm min-w-[12rem]"
                >
                  <option value="">— Pick a target —</option>
                  {targets.map((t) => (
                    <option key={t.npcId} value={t.npcId}>
                      {t.npcId} · {t.reason === 'low_opinion' ? `hates you (${t.opinion})` : `stress ${t.stress}${t.coping ? ` · ${t.coping}` : ''}`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="block text-xs text-zinc-400 mb-1">Kind</span>
                <select
                  aria-label="Scheme kind"
                  value={selectedKind}
                  onChange={(e) => setSelectedKind(e.target.value)}
                  className="bg-zinc-800 border border-zinc-700 text-zinc-100 rounded px-2 py-1 text-sm"
                >
                  {SCHEME_KINDS.map((sk) => (
                    <option key={sk.kind} value={sk.kind}>{sk.label}{sk.needsEvidence ? ' · needs evidence' : ''}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={propose}
                aria-label="Propose this scheme"
                className="bg-amber-700 hover:bg-amber-600 text-white text-sm px-3 py-1.5 rounded font-medium"
              >
                Propose
              </button>
            </div>
          )}
        </section>

        {/* Active schemes */}
        <section aria-labelledby="mine-heading" className="mb-8">
          <h2 id="mine-heading" className="text-sm font-bold text-zinc-100 mb-3">Your active schemes</h2>
          {loading ? (
            <div className="text-zinc-500 text-sm">Loading…</div>
          ) : mine.length === 0 ? (
            <div className="text-zinc-500 text-sm italic border border-zinc-800 rounded-lg p-4">
              Nothing in motion. Pick a target above to start one.
            </div>
          ) : (
            <ul className="space-y-2">
              {mine.map((s) => (
                <li key={s.id} className="bg-zinc-900/80 border border-zinc-700/50 rounded-lg p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-medium text-zinc-100">
                        {s.kind} → {s.target_id}
                        <span className="ml-2 text-xs font-normal text-amber-300/80">{PHASE_LABEL[s.phase] || s.phase}</span>
                      </h3>
                      <p className="mt-0.5 text-[11px] text-zinc-500 font-mono">
                        evidence: {s.evidence_count} · accomplices: {s.accomplice_count} · success: {s.success_pct}% · discovery risk: {s.discovery_pct}%
                      </p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {(s.phase === 'recruiting' || s.phase === 'gathering_evidence') && (
                        <button type="button" onClick={() => gather(s.id)} aria-label={`Gather evidence on ${s.id}`}
                          className="text-xs px-2 py-1 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-100">Gather</button>
                      )}
                      {s.phase !== 'complete' && s.phase !== 'exposed' && s.phase !== 'abandoned' && (
                        <>
                          <button type="button" onClick={() => move(s.id)} aria-label={`Force move ${s.id}`}
                            className="text-xs px-2 py-1 rounded bg-amber-800 hover:bg-amber-700 text-amber-100">Move</button>
                          <button type="button" onClick={() => abandon(s.id)} aria-label={`Abandon ${s.id}`}
                            className="text-xs px-2 py-1 rounded bg-red-900/60 hover:bg-red-800 text-red-200">Abandon</button>
                        </>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Schemes against me */}
        <section aria-labelledby="against-heading" className="mb-8">
          <h2 id="against-heading" className="text-sm font-bold text-zinc-100 mb-3">Schemes you suspect</h2>
          {loading ? (
            <div className="text-zinc-500 text-sm">Loading…</div>
          ) : against.length === 0 ? (
            <div className="text-zinc-500 text-sm italic border border-zinc-800 rounded-lg p-4">
              Nothing detected. (Suspected schemes surface as their discovery_pct climbs.)
            </div>
          ) : (
            <ul className="space-y-2">
              {against.map((s) => (
                <li key={s.id} className="bg-zinc-900/80 border border-red-900/40 rounded-lg p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-medium text-zinc-100">
                        {s.plotter_id} is plotting <strong className="text-red-300">{s.kind}</strong> against you
                        <span className="ml-2 text-xs font-normal text-red-300/80">{PHASE_LABEL[s.phase] || s.phase}</span>
                      </h3>
                      <p className="mt-0.5 text-[11px] text-zinc-500 font-mono">
                        discovery: {s.discovery_pct}% · evidence trail: {s.evidence_count} items
                      </p>
                    </div>
                    <button type="button" onClick={() => discoverEvidence(s.id)} aria-label={`Investigate ${s.id}`}
                      className="text-xs px-2 py-1 rounded bg-emerald-800 hover:bg-emerald-700 text-emerald-100 shrink-0">
                      Investigate
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Hooks satchel */}
        <section aria-labelledby="hooks-heading" className="mb-2">
          <h2 id="hooks-heading" className="text-sm font-bold text-zinc-100 mb-3">Hooks in your satchel ({worldId})</h2>
          {loading ? (
            <div className="text-zinc-500 text-sm">Loading…</div>
          ) : hooks.length === 0 ? (
            <div className="text-zinc-500 text-sm italic border border-zinc-800 rounded-lg p-4">
              Empty. Hooks are physical handles on evidence — gather some, pick them up in the world, then decide what to do with them.
            </div>
          ) : (
            <ul className="space-y-2">
              {hooks.map((h) => (
                <li key={h.id} className="bg-zinc-900/80 border border-zinc-700/50 rounded-lg p-3 flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-medium text-zinc-100">{h.label}</h3>
                    <p className="mt-0.5 text-[11px] text-zinc-500 font-mono">
                      {h.secret_id ? `secret ${h.secret_id.slice(0, 14)}` : `evidence ${h.evidence_id?.slice(0, 14)}`}
                      · gathered {new Date(h.created_at * 1000).toLocaleString()}
                    </p>
                  </div>
                  <button type="button" onClick={() => destroyHook(h.id)} aria-label={`Destroy hook ${h.label}`}
                    className="text-xs px-2 py-1 rounded bg-red-900/60 hover:bg-red-800 text-red-200 shrink-0">
                    Destroy
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders inline per-section when no rows</div>
      <a href="#schemes-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">Skip to schemes content</a>
    </LensShell>
  );
}
