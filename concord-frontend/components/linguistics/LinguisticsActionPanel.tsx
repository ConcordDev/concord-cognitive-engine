'use client';

/**
 * LinguisticsActionPanel — text scientist + lexicographer workbench.
 * dictionary-lookup (Free Dictionary API) / datamuse-words / textAnalysis /
 * sentimentAnalysis + mint/DM/publish/agent.
 */

import { useState } from 'react';
import { BookOpen, Volume2, BarChart3, Smile, Search, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('linguistics', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'define' | 'rhyme' | 'analyze' | 'sentiment' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface Phonetic { text?: string; audio?: string }
interface Definition { definition: string; example?: string; synonyms?: string[]; antonyms?: string[] }
interface Meaning { partOfSpeech: string; definitions: Definition[]; synonyms?: string[]; antonyms?: string[] }
interface DictEntry { word: string; phonetic?: string; phonetics?: Phonetic[]; origin?: string; meanings: Meaning[] }
interface DictResult { word: string; entries: DictEntry[]; count: number }
interface DatamuseWord { word: string; score?: number; tags?: string[] }
interface TextResult { wordCount?: number; sentenceCount?: number; vocabularySize?: number; lexicalDiversity?: number; readabilityGrade?: number; readingLevel?: string; avgWordLength?: number; avgSentenceLength?: number }
interface SentimentResult { sentiment?: string; score?: number; positiveWords?: number; negativeWords?: number; confidence?: string }

export function LinguisticsActionPanel() {
  const [word, setWord] = useState('');
  const [text, setText] = useState('');
  const [datamuseMode, setDatamuseMode] = useState<'ml' | 'rel_rhy' | 'rel_syn' | 'rel_ant' | 'topics'>('ml');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [dictResult, setDictResult] = useState<DictResult | null>(null);
  const [datamuseWords, setDatamuseWords] = useState<DatamuseWord[]>([]);
  const [textResult, setTextResult] = useState<TextResult | null>(null);
  const [sentimentResult, setSentimentResult] = useState<SentimentResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (t: string) => setFeedback({ kind: 'ok', text: t });
  const err = (t: string) => setFeedback({ kind: 'err', text: t });

  const pipe = usePipe();
  const dmRecall = useRecallableAction({
    label: 'DM',
    windowMs: 60_000,
    onUndo: async (id) => { await api.delete(`/api/social/dm/${encodeURIComponent(id)}`); },
  });
  const publishRecall = useRecallableAction({
    label: 'publish',
    windowMs: 30_000,
    onUndo: async (id) => {
      await api.delete(`/api/dtus/${encodeURIComponent(id)}/publish`);
      setPublishedDtuId(null);
    },
  });

  async function actDefine() {
    if (!word.trim()) { err('Word required.'); return; }
    setBusy('define'); setFeedback(null);
    try { const r = await callMacro<DictResult>('dictionary-lookup', { word: word.trim(), lang: 'en' }); if (r.ok && r.result) { setDictResult(r.result); pipe.publish('linguistics.dict', r.result, { label: `${r.result.word}: ${r.result.count}` }); ok(`${r.result.count} entries.`); } else err(r.error ?? 'lookup failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actRhyme() {
    if (!word.trim()) { err('Word required.'); return; }
    setBusy('rhyme'); setFeedback(null);
    try { const r = await callMacro<{ words?: DatamuseWord[] }>('datamuse-words', { [datamuseMode]: word.trim(), max: 30 }); if (r.ok && r.result?.words) { setDatamuseWords(r.result.words); pipe.publish('linguistics.datamuse', r.result.words, { label: `${datamuseMode} · ${r.result.words.length}` }); ok(`${r.result.words.length} ${datamuseMode} matches.`); } else err(r.error ?? 'datamuse failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAnalyze() {
    if (!text.trim()) { err('Text required.'); return; }
    setBusy('analyze'); setFeedback(null);
    try { const r = await callMacro<TextResult>('textAnalysis', { artifact: { data: { text } } }); if (r.ok && r.result) { setTextResult(r.result); pipe.publish('linguistics.textStats', r.result, { label: `${r.result.wordCount}w · ${r.result.readingLevel}` }); ok(`${r.result.wordCount}w · ${r.result.readingLevel}.`); } else err(r.error ?? 'analyze failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actSentiment() {
    if (!text.trim()) { err('Text required.'); return; }
    setBusy('sentiment'); setFeedback(null);
    try { const r = await callMacro<SentimentResult>('sentimentAnalysis', { artifact: { data: { text } } }); if (r.ok && r.result) { setSentimentResult(r.result); pipe.publish('linguistics.sentiment', r.result, { label: `${r.result.sentiment} ${r.result.score}` }); ok(`${r.result.sentiment} (${r.result.score}).`); } else err(r.error ?? 'sentiment failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Lexicon — ${word.trim() || 'analysis'}`, tags: ['linguistics', 'lexicon', dictResult ? 'definition' : null].filter((t): t is string => t !== null), source: 'linguistics:lex:mint', meta: { visibility: 'private', consent: { allowCitations: false }, lex: { word, dict: dictResult, datamuse: datamuseWords, textStats: textResult, sentiment: sentimentResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); pipe.publish('linguistics.mintedDtuId', id, { label: `lex ${id.slice(0, 8)}` }); ok(`Lex DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const firstDef = dictResult?.entries?.[0]?.meanings?.[0]?.definitions?.[0]?.definition;
    const body = [`📖 ${word}`, dictResult?.entries?.[0]?.phonetic ? `/${dictResult.entries[0].phonetic}/` : '', firstDef ? `\n${firstDef}` : '', datamuseWords.length ? `\n${datamuseMode}: ${datamuseWords.slice(0, 8).map(w => w.word).join(', ')}` : '', mintedDtuId ? `\n\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
    try {
      const messageId = await dmRecall.run(async () => {
        const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body });
        if (r.data?.ok === false) throw new Error(r.data?.error ?? 'send failed');
        return r.data?.message?.id as string;
      });
      if (messageId) { ok('Sent. 60s to recall.'); setRecipient(''); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPublish() {
    if (!dictResult && !textResult) { err('Run a lookup or analysis first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Lexicon entry — ${word}`, tags: ['linguistics', 'lexicon', 'public'], source: 'linguistics:lex:publish', meta: { visibility: 'public', consent: { allowCitations: true }, dict: dictResult, datamuse: datamuseWords, textStats: textResult } } });
        const newId = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
        if (!newId) throw new Error('No DTU id.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('linguistics.publishedDtuId', id, { label: `entry ${id.slice(0, 8)}` }); ok(`Published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Linguistics review of "${word}". ${dictResult?.entries?.[0]?.meanings?.[0]?.partOfSpeech ? `Part of speech: ${dictResult.entries[0].meanings[0].partOfSpeech}.` : ''} ${textResult ? `Text grade ${textResult.readabilityGrade} (${textResult.readingLevel}).` : ''} ${sentimentResult ? `Sentiment ${sentimentResult.sentiment}.` : ''} Compose one tight etymology-aware mnemonic + one usage example. Plain text, 3 sentences max.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Mnemonic ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'define' as ActionId, label: 'Define', desc: 'Free Dictionary API', icon: BookOpen, accent: '#06b6d4', handler: actDefine },
    { id: 'rhyme' as ActionId, label: datamuseMode === 'rel_rhy' ? 'Rhymes' : datamuseMode === 'ml' ? 'Means-like' : datamuseMode === 'rel_syn' ? 'Synonyms' : datamuseMode === 'rel_ant' ? 'Antonyms' : 'Topics', desc: 'Datamuse association', icon: Search, accent: '#8b5cf6', handler: actRhyme },
    { id: 'analyze' as ActionId, label: 'Text stats', desc: 'Flesch-Kincaid + diversity', icon: BarChart3, accent: '#22c55e', handler: actAnalyze },
    { id: 'sentiment' as ActionId, label: 'Sentiment', desc: 'pos / neg / neutral', icon: Smile, accent: '#f59e0b', handler: actSentiment },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private lex DTU', icon: Sparkles, accent: '#3b82f6', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send definition + word play', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Public lexicon entry', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Mnemonic', desc: 'Agent: etymology + use', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  const firstAudio = dictResult?.entries?.[0]?.phonetics?.find(p => p.audio)?.audio;

  return (
    <div className="rounded-lg border border-cyan-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-cyan-500/10 pb-2">
        <BookOpen className="h-4 w-4 text-cyan-400" />
        <h3 className="text-sm font-semibold text-white">Linguistics workbench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">free dictionary · datamuse</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div className="md:col-span-1 space-y-2">
          <input type="text" value={word} onChange={(e) => setWord(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="Word" />
          <select value={datamuseMode} onChange={(e) => setDatamuseMode(e.target.value as typeof datamuseMode)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white">
            <option value="ml">means-like</option>
            <option value="rel_rhy">rhymes</option>
            <option value="rel_syn">synonyms</option>
            <option value="rel_ant">antonyms</option>
            <option value="topics">topics</option>
          </select>
          <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="DM recipient" />
          <div className="flex items-center gap-2 flex-wrap">
            <RecallSlot ctl={dmRecall} />
            <RecallSlot ctl={publishRecall} />
          </div>
        </div>
        <div className="md:col-span-2">
          <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">Text corpus (for stats + sentiment)</label>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white mt-1" />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
        {actions.map(a => {
          const Icon = a.icon; const isBusy = busy === a.id;
          return (
            <button key={a.id} type="button" disabled={!!busy} onClick={a.handler}
              className={cn('flex flex-col items-start gap-1.5 p-2.5 rounded-lg text-left border transition-all', 'bg-zinc-900/40 border-zinc-800 hover:bg-zinc-800/60 hover:border-zinc-700', 'disabled:opacity-40 disabled:cursor-not-allowed')}>
              <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ backgroundColor: a.accent + '20', color: a.accent }}>
                {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
              </div>
              <div className="text-[11px] font-semibold text-zinc-100 leading-tight">{a.label}</div>
              <div className="text-[10px] text-zinc-400 leading-tight line-clamp-2">{a.desc}</div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {dictResult && dictResult.entries[0] && (
          <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-2.5 max-h-72 overflow-y-auto">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-cyan-300 font-semibold">Definition
              {firstAudio && <button aria-label="Volume" type="button" onClick={() => { const a = new Audio(firstAudio); a.play().catch(() => {}); }} className="text-cyan-300 hover:text-cyan-100"><Volume2 className="h-3 w-3" /></button>}
              {dictResult.entries[0].phonetic && <span className="font-mono text-zinc-400 normal-case">/{dictResult.entries[0].phonetic}/</span>}
            </div>
            {dictResult.entries[0].meanings.slice(0, 3).map((m, mi) => (
              <div key={mi} className="mt-1.5">
                <div className="text-[10px] italic text-cyan-200">{m.partOfSpeech}</div>
                {m.definitions.slice(0, 2).map((d, di) => (
                  <div key={di} className="text-[11px] text-zinc-200 mt-0.5"><span className="text-zinc-400">{di + 1}.</span> {d.definition}{d.example && <div className="text-[10px] text-zinc-400 italic mt-0.5">&ldquo;{d.example}&rdquo;</div>}</div>
                ))}
                {(m.synonyms ?? []).length > 0 && <div className="text-[10px] text-emerald-300 mt-1">syn: {(m.synonyms ?? []).slice(0, 6).join(', ')}</div>}
              </div>
            ))}
            {dictResult.entries[0].origin && <div className="text-[10px] text-zinc-400 italic mt-2">orig: {dictResult.entries[0].origin}</div>}
          </div>
        )}
        {datamuseWords.length > 0 && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5 max-h-72 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">{datamuseMode} for {word} ({datamuseWords.length})</div>
            <div className="flex flex-wrap gap-1 mt-1.5">
              {datamuseWords.slice(0, 30).map((w, i) => <button key={i} type="button" onClick={() => setWord(w.word)} className="text-[11px] text-purple-200 bg-purple-500/10 hover:bg-purple-500/30 px-1.5 py-0.5 rounded font-mono">{w.word}{w.score ? <span className="text-zinc-400 ml-1">{w.score}</span> : ''}</button>)}
            </div>
          </div>
        )}
        {textResult && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-emerald-300 font-semibold">Text stats</div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-1">
              <div className="text-[11px] text-zinc-300">words <span className="text-emerald-200 font-mono">{textResult.wordCount}</span></div>
              <div className="text-[11px] text-zinc-300">sentences <span className="text-emerald-200 font-mono">{textResult.sentenceCount}</span></div>
              <div className="text-[11px] text-zinc-300">vocab <span className="text-emerald-200 font-mono">{textResult.vocabularySize}</span></div>
              <div className="text-[11px] text-zinc-300">diversity <span className="text-emerald-200 font-mono">{textResult.lexicalDiversity}%</span></div>
              <div className="text-[11px] text-zinc-300">grade <span className="text-emerald-200 font-mono">{textResult.readabilityGrade}</span></div>
              <div className="text-[11px] text-zinc-300">level <span className="text-emerald-200 font-mono">{textResult.readingLevel}</span></div>
            </div>
          </div>
        )}
        {sentimentResult && (
          <div className={cn('rounded-md border p-2.5', sentimentResult.sentiment === 'positive' ? 'border-emerald-500/30 bg-emerald-500/5' : sentimentResult.sentiment === 'negative' ? 'border-red-500/30 bg-red-500/5' : 'border-zinc-500/30 bg-zinc-500/5')}>
            <div className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold">Sentiment</div>
            <div className="text-2xl font-bold capitalize" style={{ color: sentimentResult.sentiment === 'positive' ? '#34d399' : sentimentResult.sentiment === 'negative' ? '#f87171' : '#a1a1aa' }}>{sentimentResult.sentiment} <span className="text-sm text-zinc-400">{sentimentResult.score}</span></div>
            <div className="text-[10px] text-zinc-400">+{sentimentResult.positiveWords} · -{sentimentResult.negativeWords} · {sentimentResult.confidence} confidence</div>
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Mnemonic + usage</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
