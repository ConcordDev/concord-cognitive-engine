'use client';

/**
 * bench-store — ONE store for Construction's four bench tools (F8).
 *
 * The Procore view (ProcorePanel) and the Workbench view
 * (ConstructionActionPanel) run the same four macros — takeoffEstimate,
 * criticalPath, safetyCompliance, progressReport — and historically kept
 * separate local state, so a takeoff computed on one surface did not exist
 * on the other. This context, provided at page level so it survives view
 * switches, holds each tool's last canonical payload (the exact macro
 * input) and its last result; both panels seed their editors from it and
 * write back on compute. The two surfaces are two editors over one store.
 */

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

export interface BenchLineItem { description: string; quantity: number; unit: string; unitCost: number; wastePercent: number }
export interface BenchTakeoffPayload { lineItems: BenchLineItem[]; laborPercent?: number; squareFootage?: number }
export interface BenchTask { name: string; duration: number; dependencies: string[] }
export interface BenchCpmPayload { tasks: BenchTask[] }
export interface BenchChecklistItem { item: string; passed: boolean; critical: boolean }
export interface BenchSafetyPayload { safetyChecklist: BenchChecklistItem[]; incidents: number; workerCount: number; totalHoursWorked: number }
export interface BenchPhase { name: string; plannedPercent: number; actualPercent: number }
export interface BenchProgressPayload { phases: BenchPhase[] }

export interface BenchEntries {
  takeoff: { payload: BenchTakeoffPayload; result: unknown } | null;
  cpm: { payload: BenchCpmPayload; result: unknown } | null;
  safety: { payload: BenchSafetyPayload; result: unknown } | null;
  progress: { payload: BenchProgressPayload; result: unknown } | null;
}

interface BenchStore extends BenchEntries {
  setTool: <K extends keyof BenchEntries>(tool: K, entry: BenchEntries[K]) => void;
}

const BenchContext = createContext<BenchStore>({
  takeoff: null, cpm: null, safety: null, progress: null,
  setTool: () => undefined,
});

export function BenchStoreProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<BenchEntries>({ takeoff: null, cpm: null, safety: null, progress: null });
  const setTool = useCallback(<K extends keyof BenchEntries>(tool: K, entry: BenchEntries[K]) => {
    setEntries((prev) => ({ ...prev, [tool]: entry }));
  }, []);
  return <BenchContext.Provider value={{ ...entries, setTool }}>{children}</BenchContext.Provider>;
}

export function useBenchStore(): BenchStore {
  return useContext(BenchContext);
}
