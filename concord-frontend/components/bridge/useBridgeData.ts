'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api/client';
import { useAuth, type AuthUser } from '@/hooks/useAuth';
import type {
  BirthCert, BridgeLogAccess, BridgeLogEntry, CatalogStatus, Debate, EmergentRole, Organism,
} from './types';

/**
 * GET /api/bridge/log stays an operator dump. projectBridgeLog calls
 * denyUnlessAdmin (server/lib/log-access.js isLogAdmin): role owner,
 * admin, founder, or sovereign. Scopes do not pass, and AUTH_MODE is
 * not a viewer role, so neither is mirrored here.
 *
 * organisms / debates / births / emergents are member catalogs (public
 * read set in server.js). They load for every signed-in viewer. A member
 * used to request the log on every paint; the 403 rejected the shared
 * Promise.all, the catch logged "Bridge data load failed", and the page
 * drew zeros plus "No bridge activity yet" for a refused read.
 */
export const BRIDGE_LOG_ROLES = ['owner', 'admin', 'founder', 'sovereign'] as const;

export function canReadBridgeLog(user: Pick<AuthUser, 'role'> | null | undefined): boolean {
  return !!user?.role && (BRIDGE_LOG_ROLES as readonly string[]).includes(user.role);
}

async function readRows<T>(path: string, key: string): Promise<T[]> {
  const res = await api.get(path);
  const rows = res?.data?.[key];
  return Array.isArray(rows) ? rows as T[] : [];
}

export function useBridgeData() {
  const { user, isLoading: authLoading } = useAuth();
  const canReadLog = !authLoading && canReadBridgeLog(user);
  const catalogGen = useRef(0);
  const logGen = useRef(0);

  const [organisms, setOrganisms] = useState<Organism[]>([]);
  const [organismStatus, setOrganismStatus] = useState<CatalogStatus>('loading');
  const [log, setLog] = useState<BridgeLogEntry[]>([]);
  const [logAccess, setLogAccess] = useState<BridgeLogAccess>('pending');
  const [debates, setDebates] = useState<Debate[]>([]);
  const [debateStatus, setDebateStatus] = useState<CatalogStatus>('loading');
  const [births, setBirths] = useState<BirthCert[]>([]);
  const [birthStatus, setBirthStatus] = useState<CatalogStatus>('loading');
  const [emergents, setEmergents] = useState<EmergentRole[]>([]);
  const [emergentStatus, setEmergentStatus] = useState<CatalogStatus>('loading');
  const [loading, setLoading] = useState(true);

  const loadCatalogs = useCallback(async () => {
    const gen = ++catalogGen.current;
    const live = () => gen === catalogGen.current;
    setLoading(true);

    const load = async <T,>(
      path: string,
      key: string,
      setRows: (rows: T[]) => void,
      setStatus: (status: CatalogStatus) => void,
    ) => {
      try {
        const rows = await readRows<T>(path, key);
        if (!live()) return;
        setRows(rows);
        setStatus('ready');
      } catch {
        if (!live()) return;
        setRows([]);
        setStatus('unavailable');
      }
    };

    await Promise.all([
      load<Organism>('/api/bridge/organisms', 'organisms', setOrganisms, setOrganismStatus),
      load<Debate>('/api/bridge/debates?limit=20', 'debates', setDebates, setDebateStatus),
      load<BirthCert>('/api/bridge/births', 'births', setBirths, setBirthStatus),
      load<EmergentRole>('/api/bridge/emergents', 'emergents', setEmergents, setEmergentStatus),
    ]);
    if (live()) setLoading(false);
  }, []);

  const loadLog = useCallback(async () => {
    const gen = ++logGen.current;
    const live = () => gen === logGen.current;
    // Role still resolving: do not probe the operator dump.
    if (authLoading) {
      if (live()) setLogAccess('pending');
      return;
    }
    if (!canReadLog) {
      if (!live()) return;
      setLog([]);
      setLogAccess('operator-only');
      return;
    }
    try {
      const rows = await readRows<BridgeLogEntry>('/api/bridge/log?limit=50', 'log');
      if (!live()) return;
      setLog(rows);
      setLogAccess('ready');
    } catch {
      if (!live()) return;
      setLog([]);
      setLogAccess('unavailable');
    }
  }, [authLoading, canReadLog]);

  useEffect(() => {
    // Defer past the effect body so the reads' setState isn't synchronous
    // in the effect (same shape as the psyops operator gate).
    Promise.resolve().then(() => { void loadCatalogs(); });
  }, [loadCatalogs]);
  useEffect(() => {
    Promise.resolve().then(() => { void loadLog(); });
  }, [loadLog]);

  const refresh = useCallback(async () => {
    await Promise.all([loadCatalogs(), loadLog()]);
  }, [loadCatalogs, loadLog]);

  return {
    organisms, organismStatus,
    log, logAccess,
    debates, debateStatus,
    births, birthStatus,
    emergents, emergentStatus,
    loading, refresh,
  };
}
