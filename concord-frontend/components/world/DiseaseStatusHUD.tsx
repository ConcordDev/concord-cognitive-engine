'use client';

/**
 * DiseaseStatusHUD — Phase W.
 *
 * Compact icon next to the stamina bar. Click → diagnosis modal that
 * shows what your healer (or self-diagnose) revealed.
 *
 * Hidden when the player has no active infections.
 */

import { useCallback, useEffect, useState } from 'react';
import { Skull, Activity, X } from 'lucide-react';

interface Disease {
  id: string;
  diseaseId: string;
  name: string;
  severity: number;
  contagionRadiusM: number;
  symptoms: string[];
  tier?: string;
}

export function DiseaseStatusHUD() {
  const [diseases, setDiseases] = useState<Disease[]>([]);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/diseases/mine', { credentials: 'include' }).then((x) => x.json());
      if (r?.ok) setDiseases(r.diseases || []);
    } catch { /* network blip */ }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [refresh]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = () => refresh();
    window.addEventListener('disease:contracted', handler);
    window.addEventListener('disease:cured', handler);
    return () => {
      window.removeEventListener('disease:contracted', handler);
      window.removeEventListener('disease:cured', handler);
    };
  }, [refresh]);

  if (diseases.length === 0) return null;

  const worstSeverity = Math.max(...diseases.map((d) => d.severity));
  const severityColor = worstSeverity > 0.7 ? 'text-rose-400' : worstSeverity > 0.3 ? 'text-amber-400' : 'text-yellow-300';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Sick: ${diseases.length} active infection${diseases.length === 1 ? '' : 's'}`}
        className={`fixed top-2 right-32 z-30 flex items-center gap-1 rounded-full border border-slate-700 bg-slate-950/80 px-2 py-1 text-[11px] font-medium backdrop-blur ${severityColor}`}
      >
        <Skull className="h-3 w-3" />
        <span>{diseases.length}</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur" onClick={() => setOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-xl border border-rose-500/40 bg-slate-950 p-4">
            <header className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-rose-100">
                <Activity className="h-4 w-4" /> Active infections
              </h2>
              <button onClick={() => setOpen(false)} aria-label="Close" className="rounded p-1 text-slate-400 hover:bg-slate-800"><X className="h-3.5 w-3.5" /></button>
            </header>
            <ul className="space-y-2">
              {diseases.map((d) => (
                <li key={d.id} className="rounded-md border border-rose-500/20 bg-rose-500/5 p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-rose-100">{d.name}</span>
                    <span className="text-[10px] uppercase tracking-wider text-rose-300">{d.tier || 'common'}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded bg-slate-900">
                    <div className="h-full bg-rose-500" style={{ width: `${Math.min(100, Math.round(d.severity * 100))}%` }} />
                  </div>
                  <div className="mt-1 text-[10px] text-rose-200/80">Severity: {Math.round(d.severity * 100)}%</div>
                  {d.symptoms.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {d.symptoms.map((s, i) => (
                        <span key={i} className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] text-rose-200">{s}</span>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
