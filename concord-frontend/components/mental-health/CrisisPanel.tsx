'use client';

import { useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Phone, MessageSquare, Globe2, Loader2, AlertCircle } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Hotline { name: string; phone?: string; text?: string; chat?: string; url?: string; availability?: string }
interface HotlineSet {
  country: string; available: boolean;
  hotlines?: { primary?: Hotline; veterans?: Hotline; spanish?: Hotline; lgbtq?: Hotline; trans?: Hotline; domestic?: Hotline; sa?: Hotline; teen?: Hotline; nhs?: Hotline; kids?: Hotline };
  disclaimer?: string;
  fallback?: string;
}

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('mental-health', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

export function CrisisPanel() {
  const [country, setCountry] = useState<'US' | 'UK' | 'CA' | 'AU'>('US');
  const [set, setSet] = useState<HotlineSet | null>(null);

  const load = useMutation({
    mutationFn: async () => callMacro<HotlineSet>('crisis-hotlines', { country }),
    onSuccess: (env) => { if (env.ok && env.result) setSet(env.result); else setSet(null); },
  });

  useEffect(() => {
    load.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutate stable
  }, [country]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border-2 border-red-500 bg-red-950/40 p-3">
        <div className="flex items-center gap-2 text-red-300">
          <AlertCircle className="h-4 w-4" />
          <span className="text-xs font-bold uppercase tracking-widest">If you are in immediate danger</span>
        </div>
        <p className="mt-1 text-xs text-red-100">
          Call your local emergency number (911 US, 999 UK, 112 EU). This page provides crisis hotlines — not medical advice.
        </p>
      </div>

      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Phone className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Crisis Hotlines</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">988 + national registries</span>
        </div>
        <div className="flex gap-1 rounded-md border border-zinc-800 bg-zinc-950 p-0.5">
          {(['US', 'UK', 'CA', 'AU'] as const).map((c) => (
            <button key={c} type="button" onClick={() => setCountry(c)} className={`rounded px-2.5 py-1 text-[11px] font-mono ${country === c ? 'bg-cyan-500/15 text-cyan-300' : 'text-zinc-400'}`}>{c}</button>
          ))}
        </div>
      </header>

      {load.isPending && <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading hotlines…</div>}

      {set && !set.available && (
        <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200">
          <p>{set.fallback}</p>
        </div>
      )}

      {set?.hotlines && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {Object.entries(set.hotlines).map(([role, h]) => (
            <div key={role} className="rounded-lg border border-cyan-500/20 bg-zinc-950/60 p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-zinc-400">{role}</div>
                  <h3 className="text-sm font-semibold text-white">{h.name}</h3>
                </div>
                <SaveAsDtuButton
                  compact
                  apiSource="concord-988-reference"
                  apiUrl={h.url || h.chat}
                  title={`${set.country} crisis hotline: ${h.name}`}
                  content={`Country: ${set.country}\nName: ${h.name}\nPhone: ${h.phone || ''}\nText: ${h.text || ''}\nChat: ${h.chat || h.url || ''}\nAvailability: ${h.availability || ''}`}
                  extraTags={['mental-health', 'crisis', 'hotline', set.country.toLowerCase(), role]}
                  rawData={{ country: set.country, role, hotline: h }}
                />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                {h.phone && (
                  <a href={`tel:${h.phone.replace(/[^0-9+]/g, '')}`} className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-emerald-200 hover:bg-emerald-500/20">
                    <Phone className="h-3 w-3" /> {h.phone}
                  </a>
                )}
                {h.text && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-amber-200">
                    <MessageSquare className="h-3 w-3" /> {h.text}
                  </span>
                )}
                {h.chat && (
                  <a href={h.chat} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-cyan-200 hover:bg-cyan-500/20">
                    <Globe2 className="h-3 w-3" /> chat
                  </a>
                )}
              </div>
              {h.availability && <p className="mt-1 text-[10px] text-zinc-400">{h.availability}</p>}
            </div>
          ))}
        </motion.div>
      )}

      {set?.disclaimer && (
        <p className="text-[10px] italic text-zinc-400">{set.disclaimer}</p>
      )}
    </div>
  );
}
