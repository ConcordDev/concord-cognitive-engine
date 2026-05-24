'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Languages, Loader2, Volume2 } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Definition { definition: string; example?: string; synonyms?: string[]; antonyms?: string[] }
interface Meaning { partOfSpeech: string; definitions: Definition[]; synonyms?: string[]; antonyms?: string[] }
interface DictEntry {
  word: string; phonetic?: string;
  phonetics?: Array<{ text?: string; audio?: string }>;
  origin?: string; meanings: Meaning[];
}
interface DatamuseWord { word: string; score?: number }

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('linguistics', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

export function WordLookup() {
  const [word, setWord] = useState('');
  const [entries, setEntries] = useState<DictEntry[]>([]);
  const [related, setRelated] = useState<{ syn: DatamuseWord[]; ant: DatamuseWord[]; rhy: DatamuseWord[] }>({ syn: [], ant: [], rhy: [] });
  const [error, setError] = useState<string | null>(null);

  const lookup = useMutation({
    mutationFn: async () => {
      const dict = await callMacro<{ entries: DictEntry[] }>('dictionary-lookup', { word: word.trim() });
      if (dict.ok && dict.result) {
        setEntries(dict.result.entries);
        setError(null);
        const [syn, ant, rhy] = await Promise.all([
          callMacro<{ words: DatamuseWord[] }>('datamuse-words', { rel_syn: word.trim(), max: 12 }),
          callMacro<{ words: DatamuseWord[] }>('datamuse-words', { rel_ant: word.trim(), max: 12 }),
          callMacro<{ words: DatamuseWord[] }>('datamuse-words', { rel_rhy: word.trim(), max: 12 }),
        ]);
        setRelated({
          syn: syn.ok ? syn.result?.words || [] : [],
          ant: ant.ok ? ant.result?.words || [] : [],
          rhy: rhy.ok ? rhy.result?.words || [] : [],
        });
      } else {
        setEntries([]); setError(dict.error || 'lookup failed');
      }
    },
  });

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Languages className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Word Lookup</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">free-dictionary · datamuse</span>
        </div>
      </header>
      <form onSubmit={(e) => { e.preventDefault(); if (word.trim()) lookup.mutate(); }} className="flex items-center gap-2">
        <input type="text" value={word} onChange={(e) => setWord(e.target.value)} placeholder="word — serendipity, ephemeral, gestalt…" className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-white placeholder-zinc-600 focus:border-cyan-500/40 focus:outline-none" />
        <button type="submit" disabled={!word.trim() || lookup.isPending} className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
          {lookup.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Languages className="h-3.5 w-3.5" />}
          Look up
        </button>
      </form>
      {error && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</div>}
      {entries.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
          {entries.map((e, i) => (
            <div key={i} className="rounded-lg border border-cyan-500/20 bg-zinc-950/60 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-baseline gap-2">
                    <h3 className="text-xl font-semibold text-white">{e.word}</h3>
                    {e.phonetic && <span className="font-mono text-sm text-cyan-300">{e.phonetic}</span>}
                  </div>
                  {e.phonetics?.[0]?.audio && (
                    <a href={e.phonetics[0].audio} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-[10px] text-cyan-400 hover:underline"><Volume2 className="h-3 w-3" />Pronunciation</a>
                  )}
                </div>
                <SaveAsDtuButton
                  compact
                  apiSource="free-dictionary-api"
                  title={`${e.word} — definition`}
                  content={`Word: ${e.word}\nPhonetic: ${e.phonetic || ''}\n${e.origin ? `Origin: ${e.origin}\n` : ''}\n${e.meanings.map((m) => `${m.partOfSpeech}:\n${m.definitions.map((d) => `  - ${d.definition}${d.example ? `\n    e.g. "${d.example}"` : ''}`).join('\n')}`).join('\n\n')}`}
                  extraTags={['linguistics', 'definition', e.word.toLowerCase()]}
                  rawData={{ entry: e, related }}
                />
              </div>
              {e.meanings.map((m, j) => (
                <div key={j} className="mt-2 space-y-1">
                  <div className="text-[10px] uppercase tracking-wider text-zinc-400">{m.partOfSpeech}</div>
                  {m.definitions.slice(0, 4).map((d, k) => (
                    <div key={k} className="rounded border border-zinc-800 bg-zinc-950 p-2 text-xs">
                      <p className="text-zinc-200">{d.definition}</p>
                      {d.example && <p className="mt-1 text-[11px] italic text-zinc-400">e.g. "{d.example}"</p>}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}

          {/* Related words */}
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            <RelatedCard label="Synonyms" words={related.syn} />
            <RelatedCard label="Antonyms" words={related.ant} />
            <RelatedCard label="Rhymes" words={related.rhy} />
          </div>
        </motion.div>
      )}
    </div>
  );
}

function RelatedCard({ label, words }: { label: string; words: DatamuseWord[] }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950 p-2">
      <div className="text-[10px] uppercase tracking-wider text-zinc-400">{label}</div>
      <div className="mt-1 flex flex-wrap gap-1">
        {words.length === 0 ? <span className="text-[10px] text-zinc-400">—</span> : words.map((w) => (
          <span key={w.word} className="rounded-full bg-cyan-500/10 px-2 py-0.5 text-[10px] text-cyan-200">{w.word}</span>
        ))}
      </div>
    </div>
  );
}
