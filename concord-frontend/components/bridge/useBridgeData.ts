import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import type { BirthCert, BridgeLogEntry, Debate, EmergentRole, Organism } from './types';

async function fetchOrganisms(): Promise<Organism[]> {
  const res = await api.get('/api/bridge/organisms');
  return res?.data?.organisms || [];
}

async function fetchBridgeLog(limit = 50): Promise<BridgeLogEntry[]> {
  const res = await api.get(`/api/bridge/log?limit=${limit}`);
  return res?.data?.log || [];
}

async function fetchDebates(limit = 20): Promise<Debate[]> {
  const res = await api.get(`/api/bridge/debates?limit=${limit}`);
  return res?.data?.debates || [];
}

async function fetchBirths(): Promise<BirthCert[]> {
  const res = await api.get('/api/bridge/births');
  return res?.data?.births || [];
}

async function fetchEmergents(): Promise<EmergentRole[]> {
  const res = await api.get('/api/bridge/emergents');
  return res?.data?.emergents || [];
}

export function useBridgeData() {
  const [organisms, setOrganisms] = useState<Organism[]>([]);
  const [log, setLog] = useState<BridgeLogEntry[]>([]);
  const [debates, setDebates] = useState<Debate[]>([]);
  const [births, setBirths] = useState<BirthCert[]>([]);
  const [emergents, setEmergents] = useState<EmergentRole[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [org, lg, deb, bir, em] = await Promise.all([
        fetchOrganisms(), fetchBridgeLog(), fetchDebates(), fetchBirths(), fetchEmergents(),
      ]);
      setOrganisms(org); setLog(lg); setDebates(deb); setBirths(bir); setEmergents(em);
    } catch (e) { console.error('Bridge data load failed:', e); }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { organisms, log, debates, births, emergents, loading, refresh };
}
