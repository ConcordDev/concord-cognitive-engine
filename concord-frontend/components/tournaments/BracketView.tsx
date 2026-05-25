'use client';

/**
 * BracketView — renders the live bracket / match list for any format and
 * lets the organizer report scores inline (auto-advance UI).
 *
 * - single/double elimination → round columns of bout cards
 * - round robin / swiss        → flat round-grouped match list
 */

import { useState } from 'react';
import { Swords, Check } from 'lucide-react';
import type { Tournament, TMatch, TEntrant } from './types';

function nameOf(t: Tournament, id: string | null): string {
  if (!id) return '—';
  return t.entrants.find((e) => e.id === id)?.name ?? id.slice(0, 8);
}

function MatchCard({
  t,
  m,
  canReport,
  onReport,
  busy,
}: {
  t: Tournament;
  m: TMatch;
  canReport: boolean;
  onReport: (matchId: string, a: number, b: number) => void;
  busy: boolean;
}) {
  const [a, setA] = useState(0);
  const [b, setB] = useState(0);
  const [editing, setEditing] = useState(false);
  const aName = nameOf(t, m.aId);
  const bName = nameOf(t, m.bId);
  const aWin = m.winnerId && m.winnerId === m.aId;
  const bWin = m.winnerId && m.winnerId === m.bId;

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/80 p-2.5 text-[12px]">
      <div className={`flex items-center justify-between ${aWin ? 'font-semibold text-emerald-300' : 'text-slate-200'}`}>
        <span className="truncate">{aName}</span>
        <span className="ml-2 tabular-nums text-slate-400">{m.status !== 'pending' ? m.scoreA : ''}</span>
      </div>
      <div className="my-1 text-center text-[10px] uppercase tracking-wider text-slate-400">
        {m.status === 'bye' ? 'bye' : 'vs'}
      </div>
      <div className={`flex items-center justify-between ${bWin ? 'font-semibold text-emerald-300' : 'text-slate-200'}`}>
        <span className="truncate">{m.status === 'bye' ? '— bye —' : bName}</span>
        <span className="ml-2 tabular-nums text-slate-400">{m.status !== 'pending' && m.status !== 'bye' ? m.scoreB : ''}</span>
      </div>

      {canReport && m.status === 'pending' && m.aId && m.bId && (
        editing ? (
          <div className="mt-2 flex items-center gap-1.5">
            <input
              type="number"
              min={0}
              value={a}
              onChange={(e) => setA(Number(e.target.value))}
              aria-label={`${aName} score`}
              className="w-12 rounded bg-slate-900 px-1.5 py-0.5 text-center text-[11px]"
            />
            <span className="text-slate-600">–</span>
            <input
              type="number"
              min={0}
              value={b}
              onChange={(e) => setB(Number(e.target.value))}
              aria-label={`${bName} score`}
              className="w-12 rounded bg-slate-900 px-1.5 py-0.5 text-center text-[11px]"
            />
            <button
              onClick={() => onReport(m.id, a, b)}
              disabled={busy || a === b}
              className="ml-auto flex items-center gap-0.5 rounded bg-emerald-700 px-2 py-0.5 text-[10px] hover:bg-emerald-600 disabled:opacity-40"
            >
              <Check className="h-3 w-3" /> Submit
            </button>
          </div>
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="mt-2 w-full rounded bg-amber-700/80 px-2 py-0.5 text-[10px] hover:bg-amber-600"
          >
            Report result
          </button>
        )
      )}
    </div>
  );
}

export function BracketView({
  t,
  canReport,
  onReport,
  busy,
}: {
  t: Tournament;
  canReport: boolean;
  onReport: (matchId: string, a: number, b: number) => void;
  busy: boolean;
}) {
  if (t.matches.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-700 p-6 text-center text-sm text-slate-400">
        <Swords className="mx-auto mb-2 h-6 w-6 text-slate-700" />
        Bracket generates when the tournament starts.
      </div>
    );
  }

  const rounds = [...new Set(t.matches.map((m) => `${m.bracket}|${m.round}`))]
    .sort((x, y) => {
      const [, rx] = x.split('|');
      const [, ry] = y.split('|');
      return Number(rx) - Number(ry);
    });

  return (
    <div
      className="grid gap-4 overflow-x-auto pb-2"
      style={{ gridTemplateColumns: `repeat(${rounds.length}, minmax(180px, 1fr))` }}
    >
      {rounds.map((rk) => {
        const [bracket, round] = rk.split('|');
        const bouts = t.matches
          .filter((m) => m.bracket === bracket && String(m.round) === round)
          .sort((m1, m2) => m1.slotIndex - m2.slotIndex);
        return (
          <div key={rk}>
            <div className="mb-2 text-[10px] uppercase tracking-wider text-slate-400">
              {bracket === 'grand_final' ? 'Grand Final' : `${bracket} · R${round}`}
            </div>
            <div className="space-y-2">
              {bouts.map((m) => (
                <MatchCard key={m.id} t={t} m={m} canReport={canReport} onReport={onReport} busy={busy} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function entrantById(t: Tournament, id: string | null): TEntrant | null {
  if (!id) return null;
  return t.entrants.find((e) => e.id === id) ?? null;
}
