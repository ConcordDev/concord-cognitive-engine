'use client';

import { useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Plus, X, Coins, Loader2, Milestone as MilestoneIcon } from 'lucide-react';
import type { PlatformBounty } from './types';

const CATEGORIES = ['security', 'feature', 'bug', 'design', 'docs', 'research', 'infra', 'other'];
const DIFFICULTIES = ['beginner', 'intermediate', 'advanced', 'expert'];

interface DraftMilestone { title: string; rewardCc: number }

export function CreateBountyForm({ onCreated }: { onCreated: (b: PlatformBounty) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('feature');
  const [difficulty, setDifficulty] = useState('intermediate');
  const [tags, setTags] = useState('');
  const [rewardCc, setRewardCc] = useState(100);
  const [deadline, setDeadline] = useState('');
  const [useMilestones, setUseMilestones] = useState(false);
  const [milestones, setMilestones] = useState<DraftMilestone[]>([{ title: '', rewardCc: 50 }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reset = () => {
    setTitle(''); setDescription(''); setTags(''); setRewardCc(100); setDeadline('');
    setUseMilestones(false); setMilestones([{ title: '', rewardCc: 50 }]); setErr(null);
  };

  const submit = async () => {
    setBusy(true); setErr(null);
    const params: Record<string, unknown> = {
      title, description, category, difficulty, tags, deadline: deadline || undefined,
    };
    if (useMilestones) {
      params.milestones = milestones
        .filter((m) => m.title.trim())
        .map((m) => ({ title: m.title, rewardCc: m.rewardCc }));
    } else {
      params.rewardCc = rewardCc;
    }
    const r = await lensRun<{ bounty: PlatformBounty }>('bounties', 'create', params);
    setBusy(false);
    if (r.data?.ok && r.data.result) {
      onCreated(r.data.result.bounty);
      reset();
      setOpen(false);
    } else {
      setErr(r.data?.error || 'Failed to create bounty');
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-center gap-2 rounded-xl border border-dashed border-amber-600/50 bg-amber-950/20 py-3 text-sm font-medium text-amber-300 hover:bg-amber-950/40 focus:ring-2 focus:ring-amber-500 focus:outline-none"
      >
        <Plus className="w-4 h-4" /> Post a custom bounty
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-amber-700/40 bg-zinc-900/80 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-amber-200">New bounty</h3>
        <button aria-label="Close" onClick={() => { setOpen(false); reset(); }} className="text-zinc-400 hover:text-zinc-200">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Bounty title (min 6 chars)"
          className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100 focus:ring-2 focus:ring-amber-500 focus:outline-none"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe the work, acceptance criteria, scope…"
          rows={3}
          className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100 focus:ring-2 focus:ring-amber-500 focus:outline-none resize-none"
        />
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-zinc-400">
            Category
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="mt-1 w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-100 focus:ring-2 focus:ring-amber-500 focus:outline-none"
            >
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="text-xs text-zinc-400">
            Difficulty
            <select
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value)}
              className="mt-1 w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-100 focus:ring-2 focus:ring-amber-500 focus:outline-none"
            >
              {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
        </div>
        <input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="Tags, comma-separated (e.g. react, auth, xss)"
          className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100 focus:ring-2 focus:ring-amber-500 focus:outline-none"
        />
        <input
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
          placeholder="Deadline (optional, free text e.g. 2026-06-30)"
          className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100 focus:ring-2 focus:ring-amber-500 focus:outline-none"
        />

        <label className="flex items-center gap-2 text-xs text-zinc-300">
          <input
            type="checkbox"
            checked={useMilestones}
            onChange={(e) => setUseMilestones(e.target.checked)}
            className="accent-amber-500"
          />
          <MilestoneIcon className="w-3.5 h-3.5 text-amber-400" />
          Milestone-based bounty (partial payouts per milestone)
        </label>

        {!useMilestones ? (
          <label className="flex items-center gap-2 text-xs text-zinc-400">
            <Coins className="w-4 h-4 text-amber-400" /> Total reward CC
            <input
              type="number" min={1} value={rewardCc}
              onChange={(e) => setRewardCc(Math.max(1, Number(e.target.value) || 1))}
              className="w-24 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-100 focus:ring-2 focus:ring-amber-500 focus:outline-none"
            />
          </label>
        ) : (
          <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/50 p-2">
            {milestones.map((m, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-[10px] text-zinc-400 w-4">{i + 1}</span>
                <input
                  value={m.title}
                  onChange={(e) => setMilestones((ms) => ms.map((x, j) => j === i ? { ...x, title: e.target.value } : x))}
                  placeholder={`Milestone ${i + 1} title`}
                  className="flex-1 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                />
                <input
                  type="number" min={1} value={m.rewardCc}
                  onChange={(e) => setMilestones((ms) => ms.map((x, j) => j === i ? { ...x, rewardCc: Math.max(1, Number(e.target.value) || 1) } : x))}
                  className="w-20 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                />
                {milestones.length > 1 && (
                  <button aria-label="Remove milestone" onClick={() => setMilestones((ms) => ms.filter((_, j) => j !== i))} className="text-zinc-600 hover:text-red-400">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
            <button
              onClick={() => setMilestones((ms) => [...ms, { title: '', rewardCc: 50 }])}
              className="text-[11px] text-amber-400 hover:text-amber-300 flex items-center gap-1"
            >
              <Plus className="w-3 h-3" /> Add milestone
            </button>
            <p className="text-[10px] text-zinc-400">
              Total pool: {milestones.reduce((s, m) => s + (m.rewardCc || 0), 0)} CC
            </p>
          </div>
        )}

        {err && <p className="text-xs text-red-400" role="alert">{err}</p>}

        <button
          onClick={submit}
          disabled={busy}
          className="w-full flex items-center justify-center gap-2 rounded-lg bg-amber-600 hover:bg-amber-500 py-2 text-sm font-semibold text-zinc-950 disabled:opacity-50 focus:ring-2 focus:ring-amber-400 focus:outline-none"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Post bounty
        </button>
      </div>
    </div>
  );
}
