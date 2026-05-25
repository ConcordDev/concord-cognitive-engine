'use client';

/**
 * EntrantsManager — register solo entrants or team rosters, manual /
 * rating-based seeding, and check-in. Wires:
 *   tournaments.addEntrant · removeEntrant · seed · openCheckin · checkIn
 */

import { useState } from 'react';
import { UserPlus, Trash2, ArrowUp, ArrowDown, Star, ListChecks, CheckCircle2 } from 'lucide-react';
import type { Tournament, TEntrant } from './types';

export function EntrantsManager({
  t,
  busy,
  onAddEntrant,
  onRemoveEntrant,
  onSeedRating,
  onSeedMove,
  onOpenCheckin,
  onCheckIn,
}: {
  t: Tournament;
  busy: boolean;
  onAddEntrant: (name: string, rating: number, roster: string[]) => void;
  onRemoveEntrant: (entrantId: string) => void;
  onSeedRating: () => void;
  onSeedMove: (entrantId: string, seed: number) => void;
  onOpenCheckin: () => void;
  onCheckIn: (entrantId: string) => void;
}) {
  const [name, setName] = useState('');
  const [rating, setRating] = useState(1000);
  const [roster, setRoster] = useState('');
  const isTeam = t.mode === 'team';
  const canEdit = t.status === 'upcoming' && !t.locked;
  const sorted = [...t.entrants].sort((a, b) => a.seed - b.seed);

  const submitAdd = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const rosterArr = isTeam
      ? roster.split(',').map((r) => r.trim()).filter(Boolean)
      : [];
    onAddEntrant(trimmed, rating, rosterArr);
    setName('');
    setRoster('');
    setRating(1000);
  };

  return (
    <div className="space-y-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 font-semibold text-slate-200">
          <UserPlus className="h-4 w-4" /> Entrants ({t.entrants.length}/{t.maxEntrants})
          {isTeam && <span className="rounded bg-indigo-900/40 px-1.5 py-0.5 text-[10px] text-indigo-300">teams · {t.teamSize}</span>}
        </h3>
        {canEdit && t.entrants.length >= 2 && (
          <div className="flex gap-2">
            <button
              onClick={onSeedRating}
              disabled={busy}
              className="flex items-center gap-1 rounded bg-slate-700 px-2 py-1 text-xs hover:bg-slate-600 disabled:opacity-40"
            >
              <Star className="h-3 w-3" /> Seed by rating
            </button>
            <button
              onClick={onOpenCheckin}
              disabled={busy}
              className="flex items-center gap-1 rounded bg-amber-700 px-2 py-1 text-xs hover:bg-amber-600 disabled:opacity-40"
            >
              <ListChecks className="h-3 w-3" /> Open check-in
            </button>
          </div>
        )}
      </div>

      {canEdit && t.entrants.length < t.maxEntrants && (
        <div className="space-y-2 rounded border border-slate-800 bg-slate-950/60 p-3">
          <div className="grid grid-cols-3 gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={isTeam ? 'Team name' : 'Player name'}
              aria-label="Entrant name"
              className="col-span-2 rounded bg-slate-800 px-2 py-1 text-sm"
            />
            <input
              type="number"
              value={rating}
              min={0}
              max={5000}
              onChange={(e) => setRating(Number(e.target.value))}
              aria-label="Entrant rating"
              className="rounded bg-slate-800 px-2 py-1 text-sm"
            />
          </div>
          {isTeam && (
            <input
              value={roster}
              onChange={(e) => setRoster(e.target.value)}
              placeholder={`Roster (comma-separated, up to ${t.teamSize})`}
              aria-label="Team roster"
              className="w-full rounded bg-slate-800 px-2 py-1 text-sm"
            />
          )}
          <button
            onClick={submitAdd}
            disabled={busy || !name.trim()}
            className="rounded bg-emerald-700 px-3 py-1 text-xs font-medium hover:bg-emerald-600 disabled:opacity-40"
          >
            Add entrant
          </button>
        </div>
      )}

      {t.status === 'checkin' && (
        <div className="rounded border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-xs text-amber-200">
          Check-in window open — un-checked entrants are auto-forfeited on start.
        </div>
      )}

      <ul className="space-y-1">
        {sorted.length === 0 && (
          <li className="rounded border border-dashed border-slate-700 p-4 text-center text-xs text-slate-400">
            No entrants yet.
          </li>
        )}
        {sorted.map((e, i) => (
          <EntrantRow
            key={e.id}
            e={e}
            index={i}
            total={sorted.length}
            canEdit={canEdit}
            checkinPhase={t.status === 'checkin'}
            busy={busy}
            onRemove={() => onRemoveEntrant(e.id)}
            onUp={() => onSeedMove(e.id, e.seed - 1)}
            onDown={() => onSeedMove(e.id, e.seed + 1)}
            onCheckIn={() => onCheckIn(e.id)}
          />
        ))}
      </ul>
    </div>
  );
}

function EntrantRow({
  e,
  index,
  total,
  canEdit,
  checkinPhase,
  busy,
  onRemove,
  onUp,
  onDown,
  onCheckIn,
}: {
  e: TEntrant;
  index: number;
  total: number;
  canEdit: boolean;
  checkinPhase: boolean;
  busy: boolean;
  onRemove: () => void;
  onUp: () => void;
  onDown: () => void;
  onCheckIn: () => void;
}) {
  return (
    <li className={`flex items-center gap-2 rounded border px-2 py-1.5 text-xs ${
      e.eliminated ? 'border-rose-900/40 bg-rose-950/20 opacity-60' : 'border-slate-800 bg-slate-950/40'
    }`}>
      <span className="w-6 shrink-0 text-center font-mono text-slate-400">#{e.seed}</span>
      <div className="flex-1 truncate">
        <span className="font-medium text-slate-100">{e.name}</span>
        {e.roster.length > 0 && (
          <span className="ml-1 text-[10px] text-slate-400">[{e.roster.join(', ')}]</span>
        )}
      </div>
      <span className="shrink-0 font-mono text-[10px] text-slate-400">{e.rating} elo</span>
      {checkinPhase && (
        e.checkedIn ? (
          <span className="flex shrink-0 items-center gap-0.5 text-[10px] text-emerald-300">
            <CheckCircle2 className="h-3 w-3" /> in
          </span>
        ) : (
          <button
            onClick={onCheckIn}
            disabled={busy}
            className="shrink-0 rounded bg-amber-700 px-1.5 py-0.5 text-[10px] hover:bg-amber-600 disabled:opacity-40"
          >
            Check in
          </button>
        )
      )}
      {canEdit && (
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            onClick={onUp}
            disabled={busy || index === 0}
            aria-label={`Move ${e.name} up`}
            className="rounded p-0.5 text-slate-400 hover:bg-slate-700 hover:text-slate-200 disabled:opacity-20"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onDown}
            disabled={busy || index === total - 1}
            aria-label={`Move ${e.name} down`}
            className="rounded p-0.5 text-slate-400 hover:bg-slate-700 hover:text-slate-200 disabled:opacity-20"
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onRemove}
            disabled={busy}
            aria-label={`Remove ${e.name}`}
            className="rounded p-0.5 text-rose-400 hover:bg-rose-900/40 disabled:opacity-20"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </li>
  );
}
