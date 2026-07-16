/**
 * useFoodOps — persisted front-of-house data hooks for the food lens.
 *
 * Closes the gap documented in docs/lens-specs/food-capability-map.md
 * (lines 181-198): "Floor Plan & Tables", "Waste Log", and "Prep List"
 * used to be pure useState scratch pads that reset on every page load and
 * never touched a macro. These hooks back them with the real
 * food.waste-log-*, food.floorplan-table-*, food.floorplan-waitlist-*, and
 * food.prep-list-* macros (server/domains/food.js) via the generic
 * lensRun('food', <action>, <input>) domain-action path.
 *
 * Each hook fetches on mount and applies optimistic local updates that
 * reconcile with (or roll back to) the server response — the fluidity
 * pattern used elsewhere in this pass: the UI never shows a state the
 * backend didn't actually confirm or that hasn't yet been requested.
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Waste Log
// ---------------------------------------------------------------------------

export type WasteReason = 'spoilage' | 'overproduction' | 'prep_waste' | 'customer_return' | 'other';

export interface WasteLogEntry {
  id: string;
  itemName: string;
  qty: number;
  unit: string;
  reason: WasteReason;
  estimatedCostImpact: number;
  date: string;
}

export interface AddWasteLogInput {
  itemName: string;
  qty?: number;
  unit?: string;
  reason?: WasteReason;
  estimatedCostImpact?: number;
  // Index signature so this can be passed directly as the lensRun() input
  // (Record<string, unknown>) — unlike an inline object type literal, a
  // named `interface` doesn't get one implicitly.
  [key: string]: unknown;
}

export function useWasteLog() {
  const [entries, setEntries] = useState<WasteLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await lensRun<{ items: WasteLogEntry[] }>('food', 'waste-log-list', {});
      setEntries(res.data?.result?.items || []);
    } catch (e) {
      console.error('[Food] waste-log-list failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const addEntry = useCallback(async (input: AddWasteLogInput): Promise<WasteLogEntry | null> => {
    try {
      const res = await lensRun<{ entry: WasteLogEntry }>('food', 'waste-log-add', input);
      const entry = res.data?.result?.entry;
      if (entry) {
        setEntries(prev => [entry, ...prev]);
        return entry;
      }
      return null;
    } catch (e) {
      console.error('[Food] waste-log-add failed', e);
      return null;
    }
  }, []);

  const removeEntry = useCallback(async (id: string): Promise<boolean> => {
    // Capture the pre-removal list from render scope (NOT from inside the
    // setState updater — that updater may not run until React flushes the
    // batch, which can be after this async function has already moved on
    // to awaiting the network call, leaving a rollback read stale/empty).
    const priorEntries = entries;
    setEntries(prev => prev.filter(e => e.id !== id));
    try {
      const res = await lensRun('food', 'waste-log-delete', { id });
      if (res.data?.ok === false) {
        setEntries(priorEntries);
        return false;
      }
      return true;
    } catch (e) {
      console.error('[Food] waste-log-delete failed', e);
      setEntries(priorEntries);
      return false;
    }
  }, [entries]);

  return { entries, loading, refresh, addEntry, removeEntry };
}

// ---------------------------------------------------------------------------
// Floor Plan & Tables + walk-in waitlist
// ---------------------------------------------------------------------------

export type TableStatus = 'available' | 'occupied' | 'reserved' | 'dirty';

export interface FloorTable {
  id: string;
  label: string;
  seats: number;
  section: string | null;
  status: TableStatus;
}

export interface WalkInEntry {
  id: string;
  partyName: string;
  partySize: number;
  phone: string | null;
  position: number;
  estimatedWaitMin: number;
  status: 'waiting' | 'seated' | 'left';
  addedAt: string;
}

export function useFloorPlan() {
  const [tables, setTables] = useState<FloorTable[]>([]);
  const [waitlist, setWaitlist] = useState<WalkInEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [tRes, wRes] = await Promise.all([
        lensRun<{ tables: FloorTable[] }>('food', 'floorplan-table-list', {}),
        lensRun<{ entries: WalkInEntry[] }>('food', 'floorplan-waitlist-list', {}),
      ]);
      setTables(tRes.data?.result?.tables || []);
      setWaitlist(wRes.data?.result?.entries || []);
    } catch (e) {
      console.error('[Food] floorplan refresh failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const addTable = useCallback(async (input: { label: string; seats: number; section?: string }): Promise<FloorTable | null> => {
    try {
      const res = await lensRun<{ table: FloorTable }>('food', 'floorplan-table-add', input);
      const table = res.data?.result?.table;
      if (table) setTables(prev => [...prev, table]);
      return table ?? null;
    } catch (e) {
      console.error('[Food] floorplan-table-add failed', e);
      return null;
    }
  }, []);

  const updateTableStatus = useCallback(async (id: string, status: TableStatus): Promise<boolean> => {
    // Captured from render scope, not from inside the setState updater — see
    // the removeEntry comment above for why that ordering is unsafe.
    const priorTables = tables;
    setTables(prev => prev.map(t => t.id === id ? { ...t, status } : t));
    try {
      const res = await lensRun('food', 'floorplan-table-update', { id, status });
      if (res.data?.ok === false) { setTables(priorTables); return false; }
      return true;
    } catch (e) {
      console.error('[Food] floorplan-table-update failed', e);
      setTables(priorTables);
      return false;
    }
  }, [tables]);

  const deleteTable = useCallback(async (id: string): Promise<boolean> => {
    const priorTables = tables;
    setTables(prev => prev.filter(t => t.id !== id));
    try {
      const res = await lensRun('food', 'floorplan-table-delete', { id });
      if (res.data?.ok === false) { setTables(priorTables); return false; }
      return true;
    } catch (e) {
      console.error('[Food] floorplan-table-delete failed', e);
      setTables(priorTables);
      return false;
    }
  }, [tables]);

  const addWaitlistEntry = useCallback(async (input: { partyName: string; partySize: number; phone?: string }): Promise<WalkInEntry | null> => {
    try {
      const res = await lensRun<{ entry: WalkInEntry }>('food', 'floorplan-waitlist-add', input);
      const entry = res.data?.result?.entry;
      if (entry) setWaitlist(prev => [...prev, entry]);
      return entry ?? null;
    } catch (e) {
      console.error('[Food] floorplan-waitlist-add failed', e);
      return null;
    }
  }, []);

  const removeWaitlistEntry = useCallback(async (id: string, seated = false): Promise<boolean> => {
    const priorWaitlist = waitlist;
    setWaitlist(prev => prev.filter(w => w.id !== id));
    try {
      const res = await lensRun('food', 'floorplan-waitlist-remove', { id, seated });
      if (res.data?.ok === false) { setWaitlist(priorWaitlist); return false; }
      return true;
    } catch (e) {
      console.error('[Food] floorplan-waitlist-remove failed', e);
      setWaitlist(priorWaitlist);
      return false;
    }
  }, [waitlist]);

  return { tables, waitlist, loading, refresh, addTable, updateTableStatus, deleteTable, addWaitlistEntry, removeWaitlistEntry };
}

// ---------------------------------------------------------------------------
// Prep List
// ---------------------------------------------------------------------------

export interface PrepTask {
  menuItem?: string;
  task?: string;
  quantity?: number;
  unit?: string;
  prepTimeMinutes?: number;
  station?: string;
  done: boolean;
  [key: string]: unknown;
}

export function usePrepList(date: string = todayISO()) {
  const [tasks, setTasks] = useState<PrepTask[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await lensRun<{ list: { tasks: PrepTask[] } | null }>('food', 'prep-list-get', { date });
      setTasks(res.data?.result?.list?.tasks || []);
    } catch (e) {
      console.error('[Food] prep-list-get failed', e);
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => { refresh(); }, [refresh]);

  // Persists a freshly-generated task list (e.g. straight from the real
  // generatePrepList macro's result.tasks) and reflects it in the checklist —
  // this is the fix for the historical bug where that result was discarded
  // into a generic actionResult display instead of landing here.
  const saveTasks = useCallback(async (newTasks: Array<Record<string, unknown>>): Promise<PrepTask[]> => {
    const withDone = newTasks.map(t => ({ ...t, done: typeof t.done === 'boolean' ? t.done : false })) as PrepTask[];
    setTasks(withDone);
    try {
      const res = await lensRun<{ list: { tasks: PrepTask[] } }>('food', 'prep-list-save', { date, tasks: withDone });
      const saved = res.data?.result?.list?.tasks;
      if (saved) { setTasks(saved); return saved; }
      return withDone;
    } catch (e) {
      console.error('[Food] prep-list-save failed', e);
      return withDone;
    }
  }, [date]);

  const toggleTask = useCallback(async (taskIndex: number): Promise<boolean> => {
    // Captured from render scope, not from inside the setState updater — see
    // the removeEntry comment in useWasteLog above for why that ordering is
    // unsafe (the updater may not run before this async function resumes).
    const priorTasks = tasks;
    setTasks(prev => prev.map((t, i) => i === taskIndex ? { ...t, done: !t.done } : t));
    try {
      const res = await lensRun('food', 'prep-list-toggle-task', { date, taskIndex });
      if (res.data?.ok === false) { setTasks(priorTasks); return false; }
      return true;
    } catch (e) {
      console.error('[Food] prep-list-toggle-task failed', e);
      setTasks(priorTasks);
      return false;
    }
  }, [date, tasks]);

  return { tasks, date, loading, refresh, saveTasks, toggleTask };
}
