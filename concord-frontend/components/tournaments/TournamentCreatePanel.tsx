'use client';

import { useState, type ReactNode } from 'react';
import { FORMAT_LABELS } from '@/components/tournaments/types';
import type { Tournament, TFormat } from '@/components/tournaments/types';

const FORMATS: TFormat[] = ['single_elimination', 'double_elimination', 'round_robin', 'swiss'];

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] uppercase tracking-wider text-slate-400">{label}</label>
      {children}
    </div>
  );
}

export function TournamentCreatePanel({
  busy,
  run,
  onCreated,
}: {
  busy: boolean;
  run: (action: string, input: Record<string, unknown>) => Promise<Tournament | null>;
  onCreated: (t: Tournament) => void;
}) {
  const [title, setTitle] = useState('Untitled Tournament');
  const [game, setGame] = useState('Concord PvP');
  const [format, setFormat] = useState<TFormat>('single_elimination');
  const [maxEntrants, setMaxEntrants] = useState(8);
  const [prizePoolCc, setPrizePoolCc] = useState(0);
  const [mode, setMode] = useState<'solo' | 'team'>('solo');
  const [teamSize, setTeamSize] = useState(3);
  const [swissRounds, setSwissRounds] = useState(5);
  const [payoutSplit, setPayoutSplit] = useState('60, 25, 15');

  const submit = async () => {
    const split = payoutSplit.split(',').map((x) => Number(x.trim())).filter((n) => Number.isFinite(n) && n >= 0);
    const t = await run('create', {
      title,
      game,
      format,
      maxEntrants,
      prizePoolCc,
      teamSize: mode === 'team' ? teamSize : 1,
      swissRounds,
      payoutSplit: split.length ? split : [60, 25, 15],
    });
    if (t) onCreated(t);
  };

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-6">
      <h2 className="mb-4 text-lg font-semibold text-amber-100">Create Tournament</h2>
      <div className="space-y-4">
        <Field label="Title">
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded bg-slate-800 px-2 py-1 text-sm" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Game / discipline">
            <input value={game} onChange={(e) => setGame(e.target.value)} className="w-full rounded bg-slate-800 px-2 py-1 text-sm" />
          </Field>
          <Field label="Bracket format">
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as TFormat)}
              className="w-full rounded bg-slate-800 px-2 py-1 text-sm"
            >
              {FORMATS.map((f) => <option key={f} value={f}>{FORMAT_LABELS[f]}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Max entrants">
            <input
              type="number" value={maxEntrants} min={2} max={128}
              onChange={(e) => setMaxEntrants(Number(e.target.value))}
              className="w-full rounded bg-slate-800 px-2 py-1 text-sm"
            />
          </Field>
          <Field label="Prize pool (CC)">
            <input
              type="number" value={prizePoolCc} min={0}
              onChange={(e) => setPrizePoolCc(Number(e.target.value))}
              className="w-full rounded bg-slate-800 px-2 py-1 text-sm"
            />
          </Field>
          {format === 'swiss' && (
            <Field label="Swiss rounds">
              <input
                type="number" value={swissRounds} min={1} max={12}
                onChange={(e) => setSwissRounds(Number(e.target.value))}
                className="w-full rounded bg-slate-800 px-2 py-1 text-sm"
              />
            </Field>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Entrant type">
            <div className="flex gap-1.5">
              {(['solo', 'team'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`flex-1 rounded px-2 py-1 text-xs capitalize ${
                    mode === m ? 'bg-amber-600 text-amber-50' : 'bg-slate-700 text-slate-400'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </Field>
          {mode === 'team' && (
            <Field label="Team size">
              <input
                type="number" value={teamSize} min={2} max={10}
                onChange={(e) => setTeamSize(Number(e.target.value))}
                className="w-full rounded bg-slate-800 px-2 py-1 text-sm"
              />
            </Field>
          )}
        </div>
        <Field label="Payout split (% per rank)">
          <input
            value={payoutSplit}
            onChange={(e) => setPayoutSplit(e.target.value)}
            placeholder="60, 25, 15"
            className="w-full rounded bg-slate-800 px-2 py-1 text-sm"
          />
        </Field>
        <button
          onClick={submit}
          disabled={busy || !title.trim()}
          className="rounded bg-emerald-700 px-4 py-2 text-sm font-semibold hover:bg-emerald-600 disabled:opacity-50"
        >
          {busy ? 'Creating…' : 'Create tournament'}
        </button>
      </div>
    </div>
  );
}

