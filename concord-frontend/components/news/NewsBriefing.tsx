'use client';

import { useEffect, useState } from 'react';
import { Coffee, Loader2, RefreshCw, Volume2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

export interface BriefingSection {
  heading: string;
  bullets: string[];
}

export interface DailyBriefing {
  greeting: string;
  date: string;
  topStories: BriefingSection;
  business: BriefingSection;
  tech: BriefingSection;
  science: BriefingSection;
  closing: string;
}

export function NewsBriefing() {
  const [briefing, setBriefing] = useState<DailyBriefing | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { refresh(); }, []);
  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'news', action: 'daily-briefing', input: {} });
      setBriefing(res.data?.result as DailyBriefing || null);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  function speak() {
    if (!briefing || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const text = [briefing.greeting,
      ...['topStories', 'business', 'tech', 'science'].flatMap(k => {
        const sec = briefing[k as 'topStories' | 'business' | 'tech' | 'science'];
        return [sec.heading + ':', ...sec.bullets];
      }),
      briefing.closing,
    ].join('. ');
    try {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
    } catch { /* noop */ }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Coffee className="w-4 h-4 text-yellow-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Daily briefing · AI-curated</span>
        <span className="ml-auto flex items-center gap-1">
          <button aria-label="Refresh" onClick={refresh} className="p-1 text-gray-400 hover:text-white"><RefreshCw className={loading ? 'w-3.5 h-3.5 animate-spin' : 'w-3.5 h-3.5'} /></button>
          <button onClick={speak} className="p-1 text-gray-400 hover:text-white" title="Read aloud"><Volume2 className="w-3.5 h-3.5" /></button>
        </span>
      </header>
      {loading || !briefing ? (
        <div className="flex items-center justify-center py-8 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Composing…</div>
      ) : (
        <div className="p-4 space-y-4 max-h-[600px] overflow-y-auto">
          <p className="text-sm text-cyan-300 font-medium">{briefing.greeting}</p>
          <p className="text-[10px] text-gray-400">{briefing.date}</p>
          {(['topStories', 'business', 'tech', 'science'] as const).map(k => {
            const sec = briefing[k];
            return (
              <section key={k}>
                <h3 className="text-xs uppercase tracking-wider text-cyan-300 mb-1">{sec.heading}</h3>
                <ul className="space-y-1">
                  {sec.bullets.map((b, i) => <li key={i} className="text-xs text-gray-200">• {b}</li>)}
                </ul>
              </section>
            );
          })}
          <p className="text-xs text-gray-400 italic pt-2 border-t border-white/10">{briefing.closing}</p>
        </div>
      )}
    </div>
  );
}
export default NewsBriefing;
