'use client';

/**
 * studio-activity — a tiny, honest, session-only activity counter for the
 * Sim lens's Studio tab (System Dynamics / Agent-Based / Discrete-Event /
 * Analysis Toolkit).
 *
 * Why this exists (sim.md F4): the Studio's computations are real
 * (hand-verified exact across nine instruments) but don't persist as lens
 * artifacts — unlike a scenario Run, a Studio "Run Integration" or a
 * toolkit "Evaluate" is a one-off computation the user may repeat dozens
 * of times per session, and recording each one as a `run`-type artifact
 * would misuse the scenario-run artifact type and pollute the Runs/
 * Comparison/Results tabs with unrelated entries. This counter instead
 * tracks real, non-fabricated activity for the current session only, so
 * the Studio's working half is no longer invisible to the lens's
 * headline stats (previously "Simulations / Total Runs / Active Models
 * moved only with scenario creates").
 *
 * It resets on reload, same as any other client-only session indicator —
 * it never fabricates a number, it just doesn't survive a refresh.
 */

import { useSyncExternalStore } from 'react';

let runCount = 0;
let modelSaveCount = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Call once per successful Studio computation (Run Integration, Evaluate, Goal Seek, etc.). */
export function recordStudioRun() {
  runCount += 1;
  emit();
}

/** Call once per successful Studio model save (System Dynamics "Save Model"). */
export function recordStudioModelSave() {
  modelSaveCount += 1;
  emit();
}

export function useStudioRunCount(): number {
  return useSyncExternalStore(subscribe, () => runCount, () => 0);
}

export function useStudioModelSaveCount(): number {
  return useSyncExternalStore(subscribe, () => modelSaveCount, () => 0);
}
