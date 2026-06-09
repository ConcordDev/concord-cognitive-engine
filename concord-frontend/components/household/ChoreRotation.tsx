'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Users, Loader2, Wand2, Trash2, Plus } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Assignment { member: string; chore: string; week?: number; day?: string }
interface RotationResult { assignments?: Assignment[]; rotation?: Assignment[]; weeks?: number; strategy?: string; error?: string }

const STRATEGIES = ['round-robin', 'fair-share', 'random'] as const;

async function callHousehold<T>(action: string, input: Record<string, unknown>): Promise<T | null> {
  try {
    const r = await apiHelpers.lens.runDomain('household', action, { input });
    const env = (r as { data?: { ok: boolean; result?: T } }).data;
    if (!env?.ok) return null;
    const result = env.result as unknown as { ok?: boolean; result?: T } | T;
    if (result && typeof result === 'object' && 'ok' in result && 'result' in result) {
      return (result as { result: T }).result;
    }
    return env.result as T;
  } catch { return null; }
}

export function ChoreRotation() {
  const [chores, setChores] = useState<string[]>(['Dishes', 'Trash', 'Vacuum', 'Laundry']);
  const [members, setMembers] = useState<string[]>(['Alex', 'Sam', 'Jordan']);
  const [strategy, setStrategy] = useState<typeof STRATEGIES[number]>('round-robin');
  const [weeks, setWeeks] = useState(4);
  const [result, setResult] = useState<RotationResult | null>(null);
  const [newChore, setNewChore] = useState('');
  const [newMember, setNewMember] = useState('');

  const rotate = useMutation({
    mutationFn: async () => {
      const r = await callHousehold<RotationResult>('choreRotation', {
        artifact: { data: { chores: chores.map((c) => ({ name: c })), members } },
        strategy, weeks,
      });
      setResult(r);
      return r;
    },
  });

  const addItem = (val: string, list: string[], setList: (l: string[]) => void, setVal: (v: string) => void) => {
    const v = val.trim();
    if (!v || list.includes(v)) return;
    setList([...list, v]); setVal('');
  };
  const removeItem = (i: number, list: string[], setList: (l: string[]) => void) => setList(list.filter((_, j) => j !== i));

  const assignments = result?.assignments || result?.rotation || [];

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-emerald-400" />
          <h2 className="text-sm font-semibold text-white">Chore rotation</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">household.choreRotation</span>
        </div>
        {assignments.length > 0 && (
          <SaveAsDtuButton
            compact
            apiSource="concord-household-chores"
            title={`Chore rotation — ${members.length} members × ${chores.length} chores (${strategy})`}
            content={`Strategy: ${strategy}\nMembers: ${members.join(', ')}\nChores: ${chores.join(', ')}\n\nAssignments:\n${assignments.map((a) => `  ${a.week ? `W${a.week} ` : ''}${a.member} → ${a.chore}`).join('\n')}`}
            extraTags={['household', 'chores', strategy]}
            rawData={{ chores, members, strategy, weeks, result }}
          />
        )}
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
          <div className="mb-2 text-[10px] uppercase tracking-wider text-zinc-400">Chores ({chores.length})</div>
          <div className="space-y-1">
            {chores.map((c, i) => (
              <div key={`${c}-${i}`} className="flex items-center gap-2 text-xs">
                <span className="flex-1 truncate text-zinc-200">{c}</span>
                <button aria-label="Delete" type="button" onClick={() => removeItem(i, chores, setChores)} className="text-zinc-400 hover:text-rose-400"><Trash2 className="h-3 w-3" /></button>
              </div>
            ))}
            <form onSubmit={(e) => { e.preventDefault(); addItem(newChore, chores, setChores, setNewChore); }} className="flex gap-1">
              <input type="text" value={newChore} onChange={(e) => setNewChore(e.target.value)} placeholder="Add chore" className="flex-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white" />
              <button aria-label="Add" type="submit" className="rounded border border-zinc-800 px-2 text-zinc-400 hover:border-emerald-500/40 hover:text-emerald-300"><Plus className="h-3 w-3" /></button>
            </form>
          </div>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
          <div className="mb-2 text-[10px] uppercase tracking-wider text-zinc-400">Members ({members.length})</div>
          <div className="space-y-1">
            {members.map((m, i) => (
              <div key={`${m}-${i}`} className="flex items-center gap-2 text-xs">
                <span className="flex-1 truncate text-zinc-200">{m}</span>
                <button aria-label="Delete" type="button" onClick={() => removeItem(i, members, setMembers)} className="text-zinc-400 hover:text-rose-400"><Trash2 className="h-3 w-3" /></button>
              </div>
            ))}
            <form onSubmit={(e) => { e.preventDefault(); addItem(newMember, members, setMembers, setNewMember); }} className="flex gap-1">
              <input type="text" value={newMember} onChange={(e) => setNewMember(e.target.value)} placeholder="Add member" className="flex-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white" />
              <button aria-label="Add" type="submit" className="rounded border border-zinc-800 px-2 text-zinc-400 hover:border-emerald-500/40 hover:text-emerald-300"><Plus className="h-3 w-3" /></button>
            </form>
          </div>
        </div>
      </div>

      <div className="flex items-end gap-2">
        <label className="block flex-1">
          <span className="block text-[10px] uppercase tracking-wider text-zinc-400">Strategy</span>
          <select value={strategy} onChange={(e) => setStrategy(e.target.value as typeof STRATEGIES[number])} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white">
            {STRATEGIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="block w-24">
          <span className="block text-[10px] uppercase tracking-wider text-zinc-400">Weeks</span>
          <input type="number" min={1} max={12} value={weeks} onChange={(e) => setWeeks(Math.max(1, Math.min(12, Number(e.target.value) || 4)))} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white" />
        </label>
        <button type="button" onClick={() => rotate.mutate()} disabled={rotate.isPending || chores.length === 0 || members.length === 0} className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-mono text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-50">
          {rotate.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
          Rotate
        </button>
      </div>

      {rotate.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">Rotation failed.</div>}
      {result?.error && <div className="rounded border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">{result.error}</div>}

      {assignments.length > 0 && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
          <div className="mb-2 text-[10px] uppercase tracking-wider text-zinc-400">Rotation ({assignments.length} assignments)</div>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {assignments.map((a, i) => (
              <div key={i} className="flex items-center justify-between rounded border border-emerald-500/15 bg-zinc-950/40 px-2 py-1.5 text-xs">
                <span className="flex items-center gap-2">
                  {a.week && <span className="rounded bg-emerald-500/20 px-1 font-mono text-[10px] text-emerald-200">W{a.week}</span>}
                  <span className="font-mono text-zinc-200">{a.member}</span>
                </span>
                <span className="text-zinc-400">{a.chore}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
