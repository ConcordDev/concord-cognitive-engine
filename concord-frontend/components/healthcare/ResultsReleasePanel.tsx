'use client';

/**
 * ResultsReleasePanel — clinician releases lab results to the patient
 * portal with plain-language commentary; abnormal results are flagged.
 * Backend: healthcare.labs-list / labs-release / labs-portal-view.
 */

import { useEffect, useState, useCallback } from 'react';
import { FlaskConical, Loader2, Send, Eye, AlertTriangle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Lab {
  id: string; number: string; patientId: string; test: string; value: number;
  unit: string; refLow: number | null; refHigh: number | null;
  flag: 'normal' | 'low' | 'high' | 'critical_low' | 'critical_high' | 'unflagged';
  collectedAt: string; released?: boolean; releasedAt?: string;
  providerCommentary?: string; releasedBy?: string;
}

const FLAG_STYLE: Record<Lab['flag'], string> = {
  normal: 'bg-emerald-500/20 text-emerald-300',
  low: 'bg-amber-500/20 text-amber-300',
  high: 'bg-amber-500/20 text-amber-300',
  critical_low: 'bg-rose-500/20 text-rose-300',
  critical_high: 'bg-rose-500/20 text-rose-300',
  unflagged: 'bg-gray-500/20 text-gray-300',
};

export function ResultsReleasePanel({ patientId }: { patientId: string }) {
  const [labs, setLabs] = useState<Lab[]>([]);
  const [portalLabs, setPortalLabs] = useState<Lab[]>([]);
  const [abnormalCount, setAbnormalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'clinician' | 'portal'>('clinician');
  const [commentary, setCommentary] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [all, portal] = await Promise.all([
        lensRun('healthcare', 'labs-list', { patientId }),
        lensRun('healthcare', 'labs-portal-view', { patientId }),
      ]);
      if (all.data?.ok) setLabs((all.data.result.labs || []) as Lab[]);
      if (portal.data?.ok) {
        setPortalLabs((portal.data.result.labs || []) as Lab[]);
        setAbnormalCount(portal.data.result.abnormalCount || 0);
      }
    } catch (e) { console.error('[ResultsRelease] refresh', e); }
    finally { setLoading(false); }
  }, [patientId]);

  useEffect(() => { refresh(); }, [refresh]);

  async function release(id: string) {
    try {
      const r = await lensRun('healthcare', 'labs-release', {
        id, commentary: (commentary[id] || '').trim(),
      });
      if (r.data?.ok) {
        setCommentary(c => { const n = { ...c }; delete n[id]; return n; });
        await refresh();
      }
    } catch (e) { console.error('[ResultsRelease] release', e); }
  }

  const shown = view === 'clinician' ? labs : portalLabs;

  return (
    <div className="bg-[#0d1117] border border-cyan-500/15 rounded-lg overflow-hidden">
      <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
        <FlaskConical className="w-4 h-4 text-cyan-400" />
        <span className="text-sm font-semibold text-gray-200">Results release</span>
        {abnormalCount > 0 && <span className="text-[10px] text-rose-300 inline-flex items-center gap-0.5"><AlertTriangle className="w-3 h-3" />{abnormalCount} abnormal released</span>}
        <div className="ml-auto flex items-center border border-lattice-border rounded overflow-hidden">
          <button onClick={() => setView('clinician')} className={cn('px-2 py-1 text-[10px]', view === 'clinician' ? 'bg-cyan-500/20 text-cyan-300' : 'text-gray-400 hover:text-white')}>Clinician</button>
          <button onClick={() => setView('portal')} className={cn('px-2 py-1 text-[10px] inline-flex items-center gap-0.5', view === 'portal' ? 'bg-cyan-500/20 text-cyan-300' : 'text-gray-400 hover:text-white')}><Eye className="w-3 h-3" />Patient portal</button>
        </div>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
      ) : shown.length === 0 ? (
        <div className="px-3 py-10 text-center text-xs text-gray-400">
          <FlaskConical className="w-6 h-6 mx-auto mb-2 opacity-30" />
          {view === 'portal' ? 'No results released to the patient yet.' : 'No lab results recorded for this patient.'}
        </div>
      ) : (
        <ul className="max-h-[34rem] overflow-y-auto divide-y divide-white/5">
          {shown.map(l => {
            const abnormal = l.flag !== 'normal' && l.flag !== 'unflagged';
            return (
              <li key={l.id} className="px-4 py-2.5">
                <div className="flex items-center gap-3">
                  <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded font-mono', FLAG_STYLE[l.flag])}>{l.flag.replace('_', ' ')}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white truncate">
                      {l.test} <span className={cn('font-bold', abnormal ? 'text-rose-300' : 'text-emerald-300')}>{l.value} {l.unit}</span>
                      {(l.refLow != null || l.refHigh != null) && <span className="text-[10px] text-gray-400"> ref {l.refLow ?? '–'}–{l.refHigh ?? '–'}</span>}
                    </div>
                    <div className="text-[10px] text-gray-400 truncate">
                      collected {l.collectedAt.slice(0, 10)}
                      {l.released ? ` · released ${(l.releasedAt || '').slice(0, 10)}` : view === 'clinician' ? ' · not released' : ''}
                    </div>
                  </div>
                  {view === 'clinician' && l.released && <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-mono">released</span>}
                </div>
                {l.providerCommentary && (
                  <p className="mt-1.5 text-xs text-cyan-200 bg-cyan-500/5 border border-cyan-500/15 rounded px-2 py-1">{l.providerCommentary}</p>
                )}
                {view === 'clinician' && !l.released && (
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      value={commentary[l.id] || ''}
                      onChange={e => setCommentary(c => ({ ...c, [l.id]: e.target.value }))}
                      placeholder="Plain-language commentary for the patient (optional)"
                      className="flex-1 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
                    />
                    <button onClick={() => release(l.id)} className="px-2.5 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 inline-flex items-center gap-1"><Send className="w-3 h-3" />Release</button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default ResultsReleasePanel;
