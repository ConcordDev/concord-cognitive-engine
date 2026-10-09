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

export interface DemoCallOptions {
  /** Called when the server answered 503 and the call is about to retry. */
  onWarming?: () => void;
}

const sleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

async function getOnce(path: string): Promise<{ status: number; retryAfterS: number; body: Record<string, unknown> | null }> {
  const res = await fetch(path, { credentials: 'omit', headers: { accept: 'application/json' } });
  let body: Record<string, unknown> | null = null;
  try { body = await res.json(); } catch { body = null; }
  const ra = Number(res.headers?.get?.('retry-after'));
  return { status: res.status, retryAfterS: Number.isFinite(ra) && ra > 0 ? ra : 1, body };
}

// A 503 means the server shed the request while busy (e.g. right after a
// restart). Wait for its Retry-After (at most 3 s) and try once more.
async function getJson(path: string, opts: DemoCallOptions = {}): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const first = await getOnce(path);
  if (first.status !== 503) return first;
  opts.onWarming?.();
  await sleep(Math.min(first.retryAfterS, 3) * 1000);
  return getOnce(path);
}

function failure(status: number, body: Record<string, unknown> | null, fallback: string): { error: string } {
  if (status === 429) return { error: 'Too many solves from this connection. Wait a minute and try again.' };
  if (status === 503) return { error: 'The server is busy warming up. Try again in a moment.' };
  const msg = body && typeof body.error === 'string' ? body.error : '';
  return { error: msg || fallback };
}

export async function fetchDemoMaterials(opts: DemoCallOptions = {}): Promise<Material[] | { error: string }> {
  const { status, body } = await getJson('/api/conkay/demo/materials', opts);
  if (status !== 200 || !body?.ok || !Array.isArray(body.materials)) return failure(status, body, 'Could not load materials.');
  return body.materials as Material[];
}

export async function solveDemoBeam(inputs: StudyInputs, opts: DemoCallOptions = {}): Promise<BeamStudyResult | { error: string }> {
  const { status, body } = await getJson(`/api/conkay/demo/beam?${beamQuery(inputs)}`, opts);
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
  opts: DemoCallOptions = {},
): Promise<DemoSweep | { error: string }> {
  const q = beamQuery(inputs);
  q.set('param', param);
  q.set('values', values.join(','));
  const { status, body } = await getJson(`/api/conkay/demo/sweep?${q}`, opts);
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
