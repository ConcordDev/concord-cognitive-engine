'use client';

/**
 * Recent-leagues memory for the "Leagues (live)" tab.
 *
 * The backend has no `list leagues for user` route (verified —
 * `server/server.js` only exposes create/add-team/schedule/play/teams,
 * all id-scoped), so there is no honest way to fetch "my leagues" from
 * the server. Every entry stored here is a real `{id, name, sportKind}`
 * the user actually created via a real `POST /api/sports/league` call —
 * this is a client-side bookmark of real ids, not fabricated data, and
 * the UI labels it "this browser" so it never claims server-side
 * persistence it doesn't have.
 */
import { useCallback, useEffect, useState } from 'react';
import type { ActiveLeague } from './LeagueStandings';

const KEY = 'concord:sports:recent-leagues';
const MAX_ENTRIES = 8;

function read(): ActiveLeague[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(list: ActiveLeague[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_ENTRIES)));
  } catch { /* storage unavailable — degrade to in-memory only for this tab */ }
}

export function useRecentLeagues() {
  const [leagues, setLeagues] = useState<ActiveLeague[]>([]);

  useEffect(() => { setLeagues(read()); }, []);

  const remember = useCallback((league: ActiveLeague) => {
    setLeagues((prev) => {
      const next = [league, ...prev.filter((l) => l.id !== league.id)].slice(0, MAX_ENTRIES);
      write(next);
      return next;
    });
  }, []);

  return { leagues, remember };
}
