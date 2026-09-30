// concord-frontend/lib/conkay/verticals/api.ts
// Thin client helpers for ConKay industry verticals APIs.

import { getApiBase } from '@/lib/api/base';

async function postJson(path: string, body: Record<string, unknown> = {}) {
  const base = getApiBase();
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

export async function molecularBuild(text: string) {
  return postJson('/api/conkay/molecular/build', { text });
}

export async function hospitalRun(n = 200) {
  return postJson('/api/conkay/hospital/run', { n });
}

export async function prostheticsRun() {
  return postJson('/api/conkay/prosthetics/run', {});
}

export async function studioShot(text: string) {
  return postJson('/api/conkay/studio/shot', { text });
}

export async function aeroPanel(alphaDeg = 5) {
  return postJson('/api/conkay/aero/panel', { alphaDeg });
}
