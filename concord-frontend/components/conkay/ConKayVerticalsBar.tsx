// ConKay industry verticals overlay buttons (NEW component — minimizes CAD overlay merge conflicts).
'use client';

import { useCallback, useState } from 'react';
import {
  molecularBuild,
  hospitalRun,
  prostheticsRun,
  studioShot,
  aeroPanel,
} from '@/lib/conkay/verticals/api';
import { applyMesh } from '@/lib/conkay/unity-bridge';
import { mintConkayArtifactDtu } from '@/lib/conkay/mint-artifact-dtu';

type Props = {
  setWorkStatus?: (s: string) => void;
};

function summarizeVerticalJson(label: string, json: Record<string, unknown>) {
  const summary: Record<string, unknown> = {
    channel: 'vertical',
    vertical: label.toLowerCase(),
    action: label.toLowerCase(),
    ok: json?.ok,
    ms: json?.ms ?? (json?.latencyMs as { p50?: number } | undefined)?.p50,
  };
  if (json?.proxy != null) summary.proxy = json.proxy;
  if (json?.coefficients != null) summary.coefficients = json.coefficients;
  if (json?.latencyMs != null) summary.latencyMs = json.latencyMs;
  if (json?.metrologyPass != null) summary.metrologyPass = json.metrologyPass;
  if (json?.shot != null) summary.shot = json.shot;
  if (json?.gcode != null || json?.gcodePath != null || json?.path != null) {
    const gcode = typeof json.gcode === 'string' ? json.gcode : '';
    summary.gcode = {
      bytes: gcode ? gcode.length : json.gcodeBytes ?? null,
      path: json.gcodePath || json.path || null,
    };
  }
  if (json?.mesh && typeof json.mesh === 'object') {
    const mesh = json.mesh as Record<string, unknown>;
    summary.mesh = {
      id: mesh.id,
      color: mesh.color,
      positionsCount: Array.isArray(mesh.positions) ? mesh.positions.length : undefined,
      indicesCount: Array.isArray(mesh.indices) ? mesh.indices.length : undefined,
    };
  }
  // Keep a small generic preview without megabyte bodies.
  // Never JSON.stringify full mesh positions/indices — that freezes the UI
  // thread and delays/skips the subsequent mint POST.
  try {
    const { mesh: _meshOmit, ...rest } = json as Record<string, unknown> & { mesh?: unknown };
    const slim = summary.mesh ? { ...rest, mesh: summary.mesh } : rest;
    const raw = JSON.stringify(slim);
    summary.previewBytes = raw.length;
    if (raw.length <= 2500) summary.result = slim;
    else summary.resultPreview = raw.slice(0, 1500);
  } catch {
    /* ignore */
  }
  return summary;
}

export function ConKayVerticalsBar({ setWorkStatus }: Props) {
  const [busy, setBusy] = useState(false);
  const status = useCallback(
    (s: string) => {
      setWorkStatus?.(s);
    },
    [setWorkStatus],
  );

  const run = useCallback(
    async (label: string, fn: () => Promise<{ status: number; json: any }>) => {
      if (busy) return;
      setBusy(true);
      status(`${label}…`);
      try {
        const { status: st, json } = await fn();
        if (!json?.ok) {
          status(`${label} FAIL ${st}: ${json?.error || json?.code || 'error'}`);
          return;
        }
        if (json.mesh?.positions && json.mesh?.indices) {
          applyMesh({
            positions: json.mesh.positions,
            indices: json.mesh.indices,
            color: json.mesh.color || '#88ccff',
            id: json.mesh.id || `vert-${Date.now()}`,
          });
        }
        const extra =
          json.proxy?.ljEnergy != null
            ? ` LJ=${Number(json.proxy.ljEnergy).toFixed(2)}`
            : json.coefficients
              ? ` Cl=${json.coefficients.Cl} Cd=${json.coefficients.Cd}`
              : json.latencyMs
                ? ` p50=${json.latencyMs.p50}ms`
                : json.metrologyPass != null
                  ? ` metrology=${json.metrologyPass ? 'PASS' : 'FAIL'}`
                  : json.shot
                    ? ` shot=${json.shot.archetype}`
                    : '';
        let line = `${label} OK${extra} (${json.ms ?? json.latencyMs?.p50 ?? '?'}ms) — PROXY/synthetic`;
        status(line);
        const mint = await mintConkayArtifactDtu({
          title: `Vertical · ${label}`,
          work: summarizeVerticalJson(label, json),
          tags: ['conkay', 'vertical', label.toLowerCase(), 'artifact'],
        });
        if (mint.ok && mint.id) {
          status(`${line} · dtu=${mint.id.slice(0, 8)}…`);
        } else if (!mint.ok) {
          status(`${line} · mint failed: ${mint.error || 'error'}`);
        }
      } catch (e: any) {
        status(`${label} error: ${e?.message || e}`);
      } finally {
        setBusy(false);
      }
    },
    [busy, status],
  );

  return (
    <div className="flex items-center gap-1 mr-1" data-testid="ck-verticals-bar">
      <button
        type="button"
        disabled={busy}
        data-testid="ck-molecular-build"
        title="Molecular/polymer CAD PROXY (geometry + LJ/bond/density — NOT full MD / NOT wet-lab)"
        onClick={() => { void run('Molecular', () => molecularBuild('H2O')); }}
        className="rounded-lg px-2 py-1 text-[10px] text-violet-100 hover:bg-violet-400/15 border border-violet-400/30 disabled:opacity-40"
      >
        Mol
      </button>
      <button
        type="button"
        disabled={busy}
        data-testid="ck-hospital-run"
        title="Hospital ops + triage on SYNTHETIC patients only — not clinical advice"
        onClick={() => { void run('Hospital', () => hospitalRun(200)); }}
        className="rounded-lg px-2 py-1 text-[10px] text-rose-100 hover:bg-rose-400/15 border border-rose-400/30 disabled:opacity-40"
      >
        Hosp
      </button>
      <button
        type="button"
        disabled={busy}
        data-testid="ck-prosthetics-run"
        title="Prosthetic socket → digital fit + G-code/extrusion telemetry (synthetic — not FDA)"
        onClick={() => { void run('Prosthetics', () => prostheticsRun()); }}
        className="rounded-lg px-2 py-1 text-[10px] text-teal-100 hover:bg-teal-400/15 border border-teal-400/30 disabled:opacity-40"
      >
        Pros
      </button>
      <button
        type="button"
        disabled={busy}
        data-testid="ck-studio-shot"
        title="Studio shot packet (hooks design-glb / evo load_glb)"
        onClick={() => { void run('Studio', () => studioShot('steel sword hero prop')); }}
        className="rounded-lg px-2 py-1 text-[10px] text-fuchsia-100 hover:bg-fuchsia-400/15 border border-fuchsia-400/30 disabled:opacity-40"
      >
        Studio
      </button>
      <button
        type="button"
        disabled={busy}
        data-testid="ck-aero-panel"
        title="Aerodynamics panel CFD PROXY — not ANSYS/Fluent"
        onClick={() => { void run('Aero', () => aeroPanel(5)); }}
        className="rounded-lg px-2 py-1 text-[10px] text-sky-100 hover:bg-sky-400/15 border border-sky-400/30 disabled:opacity-40"
      >
        Aero
      </button>
    </div>
  );
}

export default ConKayVerticalsBar;
