'use client';

/**
 * WorldOverview — what the inspector shows when no entity is selected.
 * Whole-world controls, all real worldmodel macros: snapshot / list_snapshots,
 * simulate (whole graph), list_simulations / get_simulation, extract_from_dtu.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, FileInput, Loader2, Play } from 'lucide-react';
import { useUIStore } from '@/store/ui';
import { cn } from '@/lib/utils';
import { wm, type SimulationSummary, type SnapshotSummary, type WorldSimulation } from '@/components/entity/entity-model';

const toast = (type: 'success' | 'error', message: string) => useUIStore.getState().addToast({ type, message });
const fieldCls = 'rounded-lg border border-white/10 bg-transparent px-3 py-2 text-[13px] text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-teal-400/60';
const primaryBtn = 'inline-flex items-center gap-1.5 rounded-full bg-teal-400 px-4 py-1.5 text-[13px] font-medium text-black transition-colors hover:bg-teal-300 disabled:opacity-40';

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5 rounded-xl border border-white/10 p-3.5">
      <div>
        <h3 className="text-[13px] font-medium text-zinc-100">{title}</h3>
        <p className="mt-0.5 text-[12px] leading-relaxed text-zinc-500">{hint}</p>
      </div>
      {children}
    </section>
  );
}

const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : '—');

export function WorldOverview({ entityCount }: { entityCount: number }) {
  const qc = useQueryClient();
  const [label, setLabel] = useState('');
  const [hypothesis, setHypothesis] = useState('');
  const [steps, setSteps] = useState(20);
  const [dtuId, setDtuId] = useState('');
  const [openSim, setOpenSim] = useState<string | null>(null);

  const snapshots = useQuery({ queryKey: ['wm-snapshots'], queryFn: () => wm<{ snapshots: SnapshotSummary[] }>('list_snapshots') });
  const sims = useQuery({ queryKey: ['wm-simulations'], queryFn: () => wm<{ simulations: SimulationSummary[] }>('list_simulations') });
  const simDetail = useQuery({
    queryKey: ['wm-simulation', openSim],
    queryFn: () => wm<{ simulation: WorldSimulation }>('get_simulation', { simId: openSim }),
    enabled: !!openSim,
  });

  const refresh = () => {
    for (const k of ['wm-status', 'wm-snapshots', 'wm-simulations', 'wm-entities']) qc.invalidateQueries({ queryKey: [k] });
  };

  const snap = useMutation({
    mutationFn: () => wm('snapshot', { label: label.trim() || undefined }),
    onSuccess: () => { toast('success', 'Snapshot taken.'); setLabel(''); refresh(); },
    onError: (e: Error) => toast('error', e.message),
  });

  const sim = useMutation({
    mutationFn: () => wm<{ simulation: WorldSimulation }>('simulate', { type: 'evolution', steps, hypothesis: hypothesis.trim() || 'Evolve the whole world model' }),
    onSuccess: (r) => { toast('success', `Simulation finished with ${r.simulation.insights?.length ?? 0} insight(s).`); setOpenSim(r.simulation.id); refresh(); },
    onError: (e: Error) => toast('error', e.message),
  });

  const extract = useMutation({
    mutationFn: () => wm<{ extracted: number; entities: { id: string; name: string }[] }>('extract_from_dtu', { dtuId: dtuId.trim() }),
    onSuccess: (r) => {
      toast(r.extracted ? 'success' : 'error', r.extracted ? `Extracted ${r.extracted} entit${r.extracted === 1 ? 'y' : 'ies'}: ${r.entities.map((e) => e.name).slice(0, 4).join(', ')}.` : 'Nothing could be extracted from that DTU.');
      setDtuId(''); refresh();
    },
    onError: (e: Error) => toast('error', e.message),
  });

  const snapList = snapshots.data?.snapshots ?? [];
  const simList = sims.data?.simulations ?? [];

  return (
    <div className="space-y-3 p-4">
      <p className="text-[13px] leading-relaxed text-zinc-400">
        Pick an entity on the left to edit it, wire it to others and ask what-if questions. Or work on the whole world model from here.
      </p>

      <Section title="Simulate the whole world" hint={entityCount < 2 ? 'Needs at least two entities with relations to produce insights.' : 'Steps every entity forward along its relations and reports what moved.'}>
        <input value={hypothesis} onChange={(e) => setHypothesis(e.target.value)} placeholder="Hypothesis (optional)" aria-label="World hypothesis" className={cn(fieldCls, 'w-full')} />
        <label className="block text-[12px] text-zinc-400">Steps · {steps}
          <input type="range" min={5} max={50} value={steps} onChange={(e) => setSteps(Number(e.target.value))} className="mt-1 w-full accent-teal-400" aria-label="World simulation steps" />
        </label>
        <button type="button" onClick={() => sim.mutate()} disabled={sim.isPending} className={primaryBtn}>
          {sim.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          {sim.isPending ? 'Running…' : 'Run simulation'}
        </button>
      </Section>

      <Section title="Simulation history" hint="Every run is recorded. Open one to read its insights.">
        {sims.isLoading ? <Loader2 className="h-4 w-4 animate-spin text-zinc-500" /> : simList.length === 0 ? (
          <p className="text-[12px] text-zinc-600">No simulations yet.</p>
        ) : (
          <ul className="space-y-1">
            {simList.slice(0, 8).map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => setOpenSim(openSim === s.id ? null : s.id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] hover:bg-white/[0.05]">
                  <span className="min-w-0 flex-1 truncate text-zinc-200">{s.hypothesis || s.type}</span>
                  <span className="shrink-0 text-zinc-500">{s.insightCount} insight{s.insightCount !== 1 ? 's' : ''}</span>
                </button>
                {openSim === s.id && (
                  <div className="mx-2 mb-1 rounded-lg bg-black/30 p-2.5 text-[12px] text-zinc-300">
                    {simDetail.isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : simDetail.data ? (
                      simDetail.data.simulation.insights.length === 0 ? <p className="text-zinc-500">No change large enough to report.</p> : (
                        <ul className="space-y-1">{simDetail.data.simulation.insights.map((i, k) => <li key={k}>· {i.description}</li>)}</ul>
                      )
                    ) : <p className="text-rose-300">Could not load this run.</p>}
                    <p className="mt-1.5 text-[11px] text-zinc-600">{when(s.createdAt)}</p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Snapshots" hint="Freeze the graph's current shape so you can compare it later.">
        <div className="flex gap-1.5">
          <input value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') snap.mutate(); }} placeholder="Label (optional)" aria-label="Snapshot label" className={cn(fieldCls, 'min-w-0 flex-1')} />
          <button type="button" onClick={() => snap.mutate()} disabled={snap.isPending} className={primaryBtn}><Camera className="h-3.5 w-3.5" />{snap.isPending ? 'Saving…' : 'Snapshot'}</button>
        </div>
        {snapList.length > 0 && (
          <ul className="space-y-1 text-[12px]">
            {snapList.slice(0, 6).map((s) => (
              <li key={s.id} className="flex items-center gap-2 text-zinc-400">
                <span className="min-w-0 flex-1 truncate text-zinc-200">{s.label}</span>
                <span className="shrink-0">{s.entityCount} ent · {s.relationCount} rel</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Extract from a DTU" hint="Pull entities and relations out of a knowledge unit already in the substrate. Paste its id.">
        <div className="flex gap-1.5">
          <input value={dtuId} onChange={(e) => setDtuId(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && dtuId.trim()) extract.mutate(); }} placeholder="DTU id" aria-label="DTU id" className={cn(fieldCls, 'min-w-0 flex-1 font-mono')} />
          <button type="button" onClick={() => extract.mutate()} disabled={!dtuId.trim() || extract.isPending} className={primaryBtn}><FileInput className="h-3.5 w-3.5" />{extract.isPending ? 'Extracting…' : 'Extract'}</button>
        </div>
      </Section>
    </div>
  );
}
