/**
 * Client for the no-login ConKay demo routes (server/routes/conkay-demo.js).
 * They run the same beam-frame FEA as the signed-in workspace and save
 * nothing, so every call is a plain GET with no credentials.
 */

import type { BeamStudyResult } from '@/lib/conkay/workspace-commands';
import type { Material, StudyInputs, SweepRow } from '@/components/conkay/workspace/useConKayWorkspace';

export const DEMO_SIGNUP_HREF = '/register?from=%2Flenses%2Fconkay';
export const DEMO_SIGNIN_HREF = '/login?from=%2Flenses%2Fconkay';

export function beamQuery(inputs: StudyInputs): URLSearchParams {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(inputs.dims)) q.set(k, String(v));
  q.set('loadN', String(inputs.loadN));
  q.set('support', inputs.support);
  q.set('material', inputs.materialId);
  return q;
}

/**
 * The server sheds load with a real 503 + Retry-After (lib/request-admission.js),
 * most often right after a restart (`code: 'service_warming'`). The demo waits
 * the time the server asked for and tries again, a bounded number of times.
 * Only an actual 503 triggers a retry; nothing is shown that the server did not say.
 */
export const DEMO_MAX_ATTEMPTS = 4;
const MAX_WAIT_MS = 5000;

export interface DemoRetry {
  attempt: number; // the attempt about to be made (2..DEMO_MAX_ATTEMPTS)
  of: number;
  waitMs: number;
  warming: boolean; // server said it restarted recently
}
export type OnDemoRetry = (r: DemoRetry) => void;

/** Wait in ms for a 503: the server's Retry-After, clamped to 0–5 s; 1 s if it sent none. */
export function retryWaitMs(res: { headers?: { get?: (k: string) => string | null } }, body: Record<string, unknown> | null): number {
  const fromBody = body && typeof body.retryAfterS === 'number' ? body.retryAfterS : NaN;
  const fromHeader = Number(res.headers?.get?.('retry-after'));
  const s = Number.isFinite(fromBody) ? fromBody : Number.isFinite(fromHeader) ? fromHeader : 1;
  return Math.min(MAX_WAIT_MS, Math.max(0, s * 1000));
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function getJson(path: string, onRetry?: OnDemoRetry): Promise<{ status: number; body: Record<string, unknown> | null }> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(path, { credentials: 'omit', headers: { accept: 'application/json' } });
    let body: Record<string, unknown> | null = null;
    try { body = await res.json(); } catch { body = null; }
    if (res.status !== 503 || attempt >= DEMO_MAX_ATTEMPTS) return { status: res.status, body };
    const waitMs = retryWaitMs(res, body);
    onRetry?.({ attempt: attempt + 1, of: DEMO_MAX_ATTEMPTS, waitMs, warming: body?.code === 'service_warming' });
    await sleep(waitMs);
  }
}

function failure(status: number, body: Record<string, unknown> | null, fallback: string): { error: string } {
  if (status === 429) return { error: 'Too many solves from this connection. Wait a minute and try again.' };
  if (status === 503) {
    return { error: body?.code === 'service_warming'
      ? 'ConKay is still warming up after a restart. Try again in a few seconds.'
      : 'ConKay is busy right now. Try again in a few seconds.' };
  }
  const msg = body && typeof body.error === 'string' ? body.error : '';
  return { error: msg || fallback };
}

/** One line for the UI while a retry is pending. */
export function retryNotice(r: DemoRetry): string {
  const why = r.warming ? 'ConKay is warming up after a restart' : 'ConKay is busy';
  return `${why}. Retrying (${r.attempt} of ${r.of})…`;
}

export async function fetchDemoMaterials(onRetry?: OnDemoRetry): Promise<Material[] | { error: string }> {
  const { status, body } = await getJson('/api/conkay/demo/materials', onRetry);
  if (status !== 200 || !body?.ok || !Array.isArray(body.materials)) return failure(status, body, 'Could not load materials.');
  return body.materials as Material[];
}

export async function solveDemoBeam(inputs: StudyInputs, onRetry?: OnDemoRetry): Promise<BeamStudyResult | { error: string }> {
  const { status, body } = await getJson(`/api/conkay/demo/beam?${beamQuery(inputs)}`, onRetry);
  const r = body?.result as Record<string, unknown> | undefined;
  if (status !== 200 || !body?.ok || !r || !Number.isFinite(r.maxStressMPa)) return failure(status, body, 'The solver returned no result.');
  return {
    ...(r as unknown as BeamStudyResult),
    jobId: null,
    name: inputs.name,
    updatedAt: new Date().toISOString(),
    dtuId: null,
  };
}

export interface DemoSweep {
  param: string;
  rows: SweepRow[];
  lightestPassing: number | null;
  elapsedMs: number;
}

export async function sweepDemoBeam(
  inputs: StudyInputs,
  param: string,
  values: number[],
  onRetry?: OnDemoRetry,
): Promise<DemoSweep | { error: string }> {
  const q = beamQuery(inputs);
  q.set('param', param);
  q.set('values', values.join(','));
  const { status, body } = await getJson(`/api/conkay/demo/sweep?${q}`, onRetry);
  const r = body?.result as DemoSweep | undefined;
  if (status !== 200 || !body?.ok || !r || !Array.isArray(r.rows)) return failure(status, body, 'The sweep returned nothing.');
  return r;
}

/**
 * Up to five depths around the current one, whole millimetres, all positive.
 * Always at least two distinct values, since the sweep route needs two.
 */
export function depthSweepValues(height: number): number[] {
  const steps = [0.6, 0.8, 1, 1.2, 1.4];
  const values = [...new Set(steps.map((f) => Math.max(1, Math.round(height * f))))];
  if (values.length < 2) values.push(values[0] + 1);
  return values;
}
