'use client';

import { useState } from 'react';
import { Loader2, AlertTriangle, ShieldAlert, HeartPulse, Stethoscope } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface SymptomCandidate {
  condition: string;
  confidence: number;
  citations: string[];
}

export interface TriageResult {
  severity: 'self_care' | 'see_doctor' | 'er';
  candidates: SymptomCandidate[];
  reasoning: string;
}

const BODY_REGIONS = [
  { id: 'head', label: 'Head', x: 50, y: 8, r: 6 },
  { id: 'throat', label: 'Throat', x: 50, y: 18, r: 4 },
  { id: 'chest', label: 'Chest', x: 50, y: 30, r: 8 },
  { id: 'abdomen', label: 'Abdomen', x: 50, y: 44, r: 8 },
  { id: 'back', label: 'Back', x: 75, y: 35, r: 6 },
  { id: 'arm-left', label: 'Left arm', x: 30, y: 35, r: 5 },
  { id: 'arm-right', label: 'Right arm', x: 70, y: 35, r: 5 },
  { id: 'leg-left', label: 'Left leg', x: 42, y: 70, r: 5 },
  { id: 'leg-right', label: 'Right leg', x: 58, y: 70, r: 5 },
];

export function SymptomChecker() {
  const [regions, setRegions] = useState<Set<string>>(new Set());
  const [freeText, setFreeText] = useState('');
  const [age, setAge] = useState(35);
  const [sex, setSex] = useState<'M' | 'F' | 'X'>('F');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TriageResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggleRegion(id: string) {
    setRegions(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function triage() {
    if (regions.size === 0 && !freeText.trim()) {
      setError('Tap a body region or describe your symptom.');
      return;
    }
    setError(null); setLoading(true); setResult(null);
    try {
      const res = await lensRun({
        domain: 'healthcare', action: 'symptom-triage',
        input: { regions: [...regions], description: freeText.trim(), age, sex },
      });
      setResult(res.data?.result as TriageResult || null);
    } catch (e) { setError(e instanceof Error ? e.message : 'triage failed'); }
    finally { setLoading(false); }
  }

  const sev = result?.severity;

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Stethoscope className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Symptom checker · AI triage</span>
        <span className="ml-auto text-[10px] text-gray-500">Protocol-constrained, cites guidelines</span>
      </header>
      <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-3">
          <div className="text-[10px] uppercase tracking-wider text-gray-500">Tap a body region (or multiple)</div>
          <svg viewBox="0 0 100 100" className="w-full max-w-[280px] mx-auto">
            {/* Stylized human silhouette */}
            <ellipse cx="50" cy="8" rx="6" ry="6" fill="#1e293b" stroke="#475569" strokeWidth="0.5" />
            <rect x="44" y="14" width="12" height="34" rx="2" fill="#1e293b" stroke="#475569" strokeWidth="0.5" />
            <rect x="32" y="16" width="6" height="28" rx="2" fill="#1e293b" stroke="#475569" strokeWidth="0.5" />
            <rect x="62" y="16" width="6" height="28" rx="2" fill="#1e293b" stroke="#475569" strokeWidth="0.5" />
            <rect x="42" y="48" width="6" height="40" rx="2" fill="#1e293b" stroke="#475569" strokeWidth="0.5" />
            <rect x="52" y="48" width="6" height="40" rx="2" fill="#1e293b" stroke="#475569" strokeWidth="0.5" />
            {BODY_REGIONS.map(r => (
              <circle
                key={r.id}
                cx={r.x} cy={r.y} r={r.r}
                fill={regions.has(r.id) ? '#22d3ee' : 'transparent'}
                stroke={regions.has(r.id) ? '#22d3ee' : '#475569'}
                strokeWidth="0.5"
                fillOpacity={0.4}
                className="cursor-pointer hover:stroke-cyan-300"
                onClick={() => toggleRegion(r.id)}
              >
                <title>{r.label}</title>
              </circle>
            ))}
          </svg>
          {regions.size > 0 && (
            <div className="text-xs text-cyan-300 text-center">
              Selected: {[...regions].map(id => BODY_REGIONS.find(r => r.id === id)?.label).join(', ')}
            </div>
          )}

          <textarea
            value={freeText}
            onChange={e => setFreeText(e.target.value)}
            placeholder="Describe what's happening (e.g. sharp pain when breathing deeply for 2 days)…"
            rows={3}
            className="w-full px-3 py-2 text-sm bg-lattice-deep border border-lattice-border rounded text-white"
          />
          <div className="grid grid-cols-2 gap-3 text-xs">
            <label>
              <span className="block text-[10px] uppercase text-gray-500 mb-0.5">Age</span>
              <input type="number" min={0} max={120} value={age} onChange={e => setAge(Number(e.target.value) || 0)} className="w-full px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white" />
            </label>
            <label>
              <span className="block text-[10px] uppercase text-gray-500 mb-0.5">Sex assigned at birth</span>
              <select value={sex} onChange={e => setSex(e.target.value as 'M' | 'F' | 'X')} className="w-full px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white">
                <option value="F">Female</option>
                <option value="M">Male</option>
                <option value="X">Intersex / other</option>
              </select>
            </label>
          </div>
          <button onClick={triage} disabled={loading} className="w-full py-2 rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-50 inline-flex items-center justify-center gap-2">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <HeartPulse className="w-4 h-4" />}
            Get triage guidance
          </button>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <p className="text-[10px] text-gray-500 leading-relaxed">
            This is decision-support, not a diagnosis. If you have chest pain, difficulty breathing, sudden weakness, or thoughts of self-harm, call 911 or go to the nearest ER.
          </p>
        </div>

        <div>
          {!result ? (
            <div className="flex items-center justify-center h-full text-xs text-gray-500 italic">
              Triage result will appear here.
            </div>
          ) : (
            <div className="space-y-3">
              <div className={cn('p-4 rounded border-2',
                sev === 'er' ? 'bg-red-500/10 border-red-500/40' :
                sev === 'see_doctor' ? 'bg-yellow-500/10 border-yellow-500/40' :
                'bg-green-500/10 border-green-500/40'
              )}>
                <div className={cn('flex items-center gap-2 text-lg font-bold',
                  sev === 'er' ? 'text-red-300' :
                  sev === 'see_doctor' ? 'text-yellow-300' :
                  'text-green-300'
                )}>
                  {sev === 'er' ? <ShieldAlert className="w-6 h-6" /> :
                   sev === 'see_doctor' ? <AlertTriangle className="w-6 h-6" /> :
                   <HeartPulse className="w-6 h-6" />}
                  {sev === 'er' ? 'Seek emergency care now' :
                   sev === 'see_doctor' ? 'See a doctor soon (within days)' :
                   'Self-care appropriate'}
                </div>
                <p className="text-xs text-gray-300 mt-2">{result.reasoning}</p>
              </div>

              <div>
                <h3 className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">Possible conditions (not a diagnosis)</h3>
                <ul className="space-y-2">
                  {result.candidates.map((c, i) => (
                    <li key={i} className="bg-white/[0.02] border border-white/10 rounded p-2.5">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-white">{c.condition}</span>
                        <span className="ml-auto text-[10px] tabular-nums text-cyan-300">{Math.round(c.confidence * 100)}%</span>
                      </div>
                      {c.citations.length > 0 && (
                        <div className="flex items-center gap-1 mt-1 flex-wrap">
                          {c.citations.map((cite, ci) => (
                            <span key={ci} className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300">{cite}</span>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default SymptomChecker;
