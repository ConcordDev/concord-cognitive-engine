'use client';

/**
 * ReplantingPanel — replanting / silviculture scheduler with seedling
 * orders and survival surveys. Wires forestry.replant-project-create /
 * replant-list / replant-update-status / replant-survival-survey.
 */

import { useCallback, useEffect, useState } from 'react';
import { Sprout, Loader2, Plus, ClipboardCheck } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Survey { id: string; date: string; survivalPercent: number; recommendation: string }
interface Project {
  id: string;
  name: string;
  species: string;
  acres: number;
  seedlingsPerAcre: number;
  seedlingsOrdered: number;
  plannedDate: string;
  method: string;
  status: string;
  surveys: Survey[];
  latestSurvival: number | null;
}
interface ProjectList { projects: Project[]; count: number; totalAcres: number; totalSeedlings: number }

const SPECIES = ['douglas_fir', 'ponderosa_pine', 'loblolly_pine', 'oak', 'maple', 'spruce', 'mixed', 'other'];
const METHODS = ['containerized', 'bare_root', 'direct_seed', 'natural'];
const STATUSES = ['planned', 'ordered', 'planted', 'established', 'failed'];

export function ReplantingPanel() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [totals, setTotals] = useState({ acres: 0, seedlings: 0 });
  const [name, setName] = useState('');
  const [species, setSpecies] = useState('douglas_fir');
  const [acres, setAcres] = useState('');
  const [spa, setSpa] = useState('435');
  const [method, setMethod] = useState('containerized');
  const [plannedDate, setPlannedDate] = useState('');
  const [standId, setStandId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [svySampled, setSvySampled] = useState<Record<string, string>>({});
  const [svyAlive, setSvyAlive] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const r = await lensRun<ProjectList>('forestry', 'replant-list', {});
    if (r.data?.ok && r.data.result) {
      setProjects(r.data.result.projects);
      setTotals({ acres: r.data.result.totalAcres, seedlings: r.data.result.totalSeedlings });
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const create = useCallback(async () => {
    if (!name.trim()) { setErr('Project name required.'); return; }
    const a = Number(acres);
    if (!Number.isFinite(a) || a <= 0) { setErr('Acres must be greater than 0.'); return; }
    setBusy(true); setErr(null);
    const r = await lensRun('forestry', 'replant-project-create', {
      name: name.trim(), species, acres: a,
      seedlingsPerAcre: Number(spa) || 435, method,
      plannedDate: plannedDate || undefined, standId: standId.trim() || undefined,
    });
    if (r.data?.ok) { setName(''); setAcres(''); setPlannedDate(''); setStandId(''); await load(); }
    else setErr(r.data?.error || 'Create failed.');
    setBusy(false);
  }, [name, species, acres, spa, method, plannedDate, standId, load]);

  const setStatus = useCallback(async (id: string, status: string) => {
    const r = await lensRun('forestry', 'replant-update-status', { id, status });
    if (r.data?.ok) await load();
  }, [load]);

  const survey = useCallback(async (id: string) => {
    const sampled = Number(svySampled[id]);
    const alive = Number(svyAlive[id]);
    if (!Number.isFinite(sampled) || sampled <= 0) { setErr('Enter sampled seedling count.'); return; }
    setErr(null);
    const r = await lensRun('forestry', 'replant-survival-survey', {
      id, sampledSeedlings: sampled, aliveSeedlings: alive || 0,
    });
    if (r.data?.ok) {
      setSvySampled((m) => ({ ...m, [id]: '' }));
      setSvyAlive((m) => ({ ...m, [id]: '' }));
      await load();
    } else setErr(r.data?.error || 'Survey failed.');
  }, [svySampled, svyAlive, load]);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Sprout className="w-4 h-4 text-lime-400" />
        <h3 className="text-sm font-bold text-zinc-100">Replanting &amp; Silviculture</h3>
        <span className="ml-auto text-[10px] text-zinc-400">
          {projects.length} project{projects.length === 1 ? '' : 's'} · {totals.acres.toLocaleString()} ac · {totals.seedlings.toLocaleString()} seedlings
        </span>
      </div>

      <div className="grid md:grid-cols-2 gap-1.5 mb-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Project name"
          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
        <div className="flex gap-1.5">
          <select value={species} onChange={(e) => setSpecies(e.target.value)}
            className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1.5 text-xs text-zinc-200">
            {SPECIES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
          <input value={acres} onChange={(e) => setAcres(e.target.value.replace(/[^\d.]/g, ''))} placeholder="acres"
            className="w-16 bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
          <input value={spa} onChange={(e) => setSpa(e.target.value.replace(/\D/g, ''))} placeholder="seedlings/ac"
            className="w-24 bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
        </div>
        <div className="flex gap-1.5">
          <select value={method} onChange={(e) => setMethod(e.target.value)}
            className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1.5 text-xs text-zinc-200">
            {METHODS.map((m) => <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>)}
          </select>
          <input type="date" value={plannedDate} onChange={(e) => setPlannedDate(e.target.value)}
            className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
          <input value={standId} onChange={(e) => setStandId(e.target.value)} placeholder="stand id"
            className="w-20 bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
        </div>
      </div>
      <button onClick={create} disabled={busy}
        className="px-3 py-1.5 text-xs rounded bg-lime-600 hover:bg-lime-500 text-white font-semibold disabled:opacity-40 inline-flex items-center gap-1.5">
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Create project
      </button>
      {err && <p className="text-xs text-rose-400 mt-2">{err}</p>}

      <div className="mt-3 space-y-2">
        {projects.map((p) => (
          <div key={p.id} className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-2.5 py-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-zinc-100">{p.name}</span>
              <span className="text-[10px] text-zinc-400">{p.species.replace(/_/g, ' ')}</span>
              <span className="text-[10px] text-zinc-400">{p.acres} ac · {p.seedlingsOrdered.toLocaleString()} seedlings</span>
              {p.latestSurvival != null && (
                <span className={`text-[10px] font-semibold ${p.latestSurvival < 60 ? 'text-rose-400' : p.latestSurvival < 80 ? 'text-yellow-400' : 'text-emerald-400'}`}>
                  {p.latestSurvival}% survival
                </span>
              )}
              <select value={p.status} onChange={(e) => setStatus(p.id, e.target.value)}
                className="ml-auto bg-zinc-950 border border-zinc-800 rounded px-1.5 py-0.5 text-[10px] text-zinc-200">
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            {p.surveys.length > 0 && (
              <p className="text-[10px] text-zinc-400 mt-1">
                Latest survey: {p.surveys[p.surveys.length - 1].recommendation}
              </p>
            )}
            <div className="flex flex-wrap gap-1 mt-1.5">
              <input value={svySampled[p.id] || ''} onChange={(e) => setSvySampled((m) => ({ ...m, [p.id]: e.target.value.replace(/\D/g, '') }))}
                placeholder="sampled" className="w-20 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-200" />
              <input value={svyAlive[p.id] || ''} onChange={(e) => setSvyAlive((m) => ({ ...m, [p.id]: e.target.value.replace(/\D/g, '') }))}
                placeholder="alive" className="w-20 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-200" />
              <button onClick={() => survey(p.id)}
                className="px-2 py-1 text-[11px] rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 inline-flex items-center gap-1">
                <ClipboardCheck className="w-3 h-3" /> Survival survey
              </button>
            </div>
          </div>
        ))}
        {projects.length === 0 && <p className="text-xs text-zinc-400 italic">No replanting projects yet.</p>}
      </div>
    </div>
  );
}
