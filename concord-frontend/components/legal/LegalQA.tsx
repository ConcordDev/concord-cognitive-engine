'use client';

import { useState } from 'react';
import { MessageSquare, Loader2, Send, BookOpen, ShieldAlert } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

export interface LegalAnswer {
  answer: string;
  jurisdiction: string;
  citations: Array<{ title: string; url?: string; section?: string }>;
  caveats: string[];
}

export function LegalQA() {
  const [question, setQuestion] = useState('');
  const [jurisdiction, setJurisdiction] = useState('US-CA');
  const [answer, setAnswer] = useState<LegalAnswer | null>(null);
  const [loading, setLoading] = useState(false);

  async function ask() {
    if (!question.trim()) return;
    setLoading(true); setAnswer(null);
    try {
      const res = await lensRun({
        domain: 'legal', action: 'legal-question',
        input: { question: question.trim(), jurisdiction },
      });
      setAnswer(res.data?.result as LegalAnswer || null);
    } catch (e) { console.error('[Legal QA] failed', e); }
    finally { setLoading(false); }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <MessageSquare className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Legal Q&amp;A</span>
        <span className="ml-auto text-[10px] text-gray-500">Decision-support · not legal advice</span>
      </header>
      <div className="p-4 space-y-3">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-gray-400">Jurisdiction:</span>
          <select value={jurisdiction} onChange={e => setJurisdiction(e.target.value)} className="px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white">
            <option value="US-CA">United States — California</option>
            <option value="US-NY">United States — New York</option>
            <option value="US-TX">United States — Texas</option>
            <option value="US-FL">United States — Florida</option>
            <option value="US-Federal">United States — Federal</option>
            <option value="UK">United Kingdom</option>
            <option value="EU">European Union</option>
            <option value="CA">Canada</option>
          </select>
        </div>
        <textarea
          value={question}
          onChange={e => setQuestion(e.target.value)}
          placeholder="Ask a legal question. The answer will cite statutes/cases and flag jurisdictional limits."
          rows={4}
          className="w-full px-3 py-2 text-sm bg-lattice-deep border border-lattice-border rounded text-white"
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ask(); }}
        />
        <div className="flex items-center gap-2">
          <button onClick={ask} disabled={loading || !question.trim()} className="inline-flex items-center gap-2 px-4 py-2 rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-50">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Ask (⌘⏎)
          </button>
          <span className="text-[10px] text-gray-500">For binding decisions, consult a licensed attorney in your jurisdiction.</span>
        </div>

        {answer && (
          <div className="space-y-2 pt-3 border-t border-white/10">
            <div className="bg-white/[0.02] rounded p-3">
              <p className="text-sm text-gray-200 whitespace-pre-wrap">{answer.answer}</p>
            </div>
            {answer.citations.length > 0 && (
              <div className="bg-white/[0.02] rounded p-3">
                <h4 className="text-[10px] uppercase tracking-wider text-cyan-300 mb-2 inline-flex items-center gap-1"><BookOpen className="w-3 h-3" /> Citations</h4>
                <ul className="space-y-1">
                  {answer.citations.map((c, i) => (
                    <li key={i} className="text-xs text-gray-300">
                      {c.url ? (
                        <a href={c.url} target="_blank" rel="noreferrer noopener" className="text-cyan-300 hover:text-cyan-100">{c.title}</a>
                      ) : (
                        <span className="text-cyan-300">{c.title}</span>
                      )}
                      {c.section && <span className="text-gray-500"> · §{c.section}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {answer.caveats.length > 0 && (
              <div className="bg-yellow-500/[0.05] border border-yellow-500/30 rounded p-3">
                <h4 className="text-[10px] uppercase tracking-wider text-yellow-300 mb-2 inline-flex items-center gap-1"><ShieldAlert className="w-3 h-3" /> Limits of this answer</h4>
                <ul className="space-y-1">
                  {answer.caveats.map((c, i) => (
                    <li key={i} className="text-xs text-gray-300">• {c}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default LegalQA;
