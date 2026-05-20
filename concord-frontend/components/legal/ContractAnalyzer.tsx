'use client';

import { useState } from 'react';
import { FileText, Loader2, AlertTriangle, ShieldCheck, Brain, Upload } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface RiskFlag {
  severity: 'high' | 'moderate' | 'low' | 'info';
  category: string;
  clause: string;
  excerpt: string;
  whatItMeans: string;
  recommendation: string;
}

export interface ContractAnalysis {
  documentType: string;
  partyCount: number;
  effectiveDate?: string;
  termLength?: string;
  riskFlags: RiskFlag[];
  obligationsForYou: string[];
  obligationsForCounterparty: string[];
  terminationConditions: string[];
  governing: { law: string; venue?: string };
  summary: string;
}

export function ContractAnalyzer() {
  const [contract, setContract] = useState('');
  const [perspective, setPerspective] = useState<'sign' | 'send' | 'review'>('sign');
  const [analysis, setAnalysis] = useState<ContractAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function analyze() {
    if (!contract.trim() || contract.length < 200) {
      setError('Paste at least 200 characters of contract text.');
      return;
    }
    setError(null); setLoading(true); setAnalysis(null);
    try {
      const res = await lensRun({
        domain: 'legal', action: 'contract-analyze',
        input: { contract, perspective },
      });
      setAnalysis(res.data?.result as ContractAnalysis || null);
      if (!res.data?.result) setError('Could not parse the analysis. Try a different document.');
    } catch (e) { setError(e instanceof Error ? e.message : 'analyze failed'); }
    finally { setLoading(false); }
  }

  function onFile(file: File) {
    if (!file.type.startsWith('text/') && file.type !== 'application/pdf') {
      setError('Plain text or PDF only (PDFs are extracted client-side as text).');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => { setContract(String(reader.result || '')); };
    reader.readAsText(file);
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Brain className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Contract analyzer</span>
        <span className="ml-auto text-[10px] text-gray-500">Conscious brain · constrained-prompt</span>
      </header>
      <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-400">Reading from perspective of:</span>
            <select value={perspective} onChange={e => setPerspective(e.target.value as 'sign' | 'send' | 'review')} className="px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white">
              <option value="sign">I&apos;m about to sign</option>
              <option value="send">I&apos;m sending this</option>
              <option value="review">Neutral third party</option>
            </select>
          </div>
          <textarea
            value={contract}
            onChange={e => setContract(e.target.value)}
            placeholder="Paste contract text… (NDA, MSA, employment agreement, ToS, lease, etc.)"
            rows={16}
            className="w-full px-3 py-2 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono resize-y"
          />
          <div className="flex items-center gap-2">
            <input id="contract-file" type="file" accept=".txt,.md,.pdf,text/plain" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
            <label htmlFor="contract-file" className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10 cursor-pointer">
              <Upload className="w-3.5 h-3.5" /> Upload
            </label>
            <button onClick={analyze} disabled={loading} className="ml-auto inline-flex items-center gap-2 px-4 py-2 rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-50">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Brain className="w-4 h-4" />}
              Analyze
            </button>
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <p className="text-[10px] text-gray-500 leading-relaxed">
            Decision-support tool, not legal advice. Consult a licensed attorney for binding decisions.
          </p>
        </div>

        <div>
          {!analysis ? (
            <div className="flex items-center justify-center h-full text-xs text-gray-500 italic">
              Paste contract text and click Analyze.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="bg-white/[0.02] rounded p-3 text-xs">
                <div className="flex items-center gap-2 mb-1">
                  <FileText className="w-4 h-4 text-cyan-400" />
                  <span className="text-sm font-bold text-white">{analysis.documentType}</span>
                  {analysis.termLength && <span className="text-[10px] text-gray-500">· {analysis.termLength}</span>}
                </div>
                <p className="text-xs text-gray-300">{analysis.summary}</p>
                <div className="mt-2 text-[10px] text-gray-500">
                  {analysis.partyCount} parties · {analysis.governing.law}{analysis.governing.venue ? ` · ${analysis.governing.venue}` : ''}
                </div>
              </div>

              {analysis.riskFlags.length > 0 && (
                <div>
                  <h3 className="text-[10px] uppercase tracking-wider text-red-300 mb-2">Risk flags</h3>
                  <ul className="space-y-2 max-h-96 overflow-y-auto">
                    {analysis.riskFlags.map((f, i) => (
                      <li key={i} className={cn('p-2 rounded border-l-4',
                        f.severity === 'high' ? 'border-red-500 bg-red-500/[0.05]' :
                        f.severity === 'moderate' ? 'border-yellow-500 bg-yellow-500/[0.05]' :
                        f.severity === 'low' ? 'border-blue-500 bg-blue-500/[0.05]' :
                        'border-gray-500 bg-white/[0.02]'
                      )}>
                        <div className="flex items-center gap-2">
                          <AlertTriangle className={cn('w-3.5 h-3.5',
                            f.severity === 'high' ? 'text-red-400' :
                            f.severity === 'moderate' ? 'text-yellow-400' :
                            'text-blue-400'
                          )} />
                          <span className="text-sm font-bold text-white">{f.category}</span>
                          <span className={cn('ml-auto text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded font-bold',
                            f.severity === 'high' ? 'bg-red-500/20 text-red-300' :
                            f.severity === 'moderate' ? 'bg-yellow-500/20 text-yellow-300' :
                            f.severity === 'low' ? 'bg-blue-500/20 text-blue-300' :
                            'bg-gray-500/20 text-gray-300'
                          )}>{f.severity}</span>
                        </div>
                        <div className="text-[11px] text-gray-400 italic mt-1">&ldquo;{f.excerpt}&rdquo;</div>
                        <div className="text-xs text-gray-200 mt-1">{f.whatItMeans}</div>
                        <div className="text-[11px] text-cyan-300 mt-1">→ {f.recommendation}</div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-white/[0.02] rounded p-2">
                  <h4 className="text-[10px] uppercase tracking-wider text-cyan-300 mb-1">Your obligations</h4>
                  <ul className="space-y-0.5">
                    {analysis.obligationsForYou.map((o, i) => <li key={i} className="text-gray-300 text-[11px]">• {o}</li>)}
                  </ul>
                </div>
                <div className="bg-white/[0.02] rounded p-2">
                  <h4 className="text-[10px] uppercase tracking-wider text-purple-300 mb-1">Counterparty obligations</h4>
                  <ul className="space-y-0.5">
                    {analysis.obligationsForCounterparty.map((o, i) => <li key={i} className="text-gray-300 text-[11px]">• {o}</li>)}
                  </ul>
                </div>
              </div>

              {analysis.terminationConditions.length > 0 && (
                <div className="bg-white/[0.02] rounded p-2">
                  <h4 className="text-[10px] uppercase tracking-wider text-orange-300 mb-1 inline-flex items-center gap-1"><ShieldCheck className="w-3 h-3" /> Termination conditions</h4>
                  <ul className="space-y-0.5">
                    {analysis.terminationConditions.map((t, i) => <li key={i} className="text-gray-300 text-[11px]">• {t}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ContractAnalyzer;
