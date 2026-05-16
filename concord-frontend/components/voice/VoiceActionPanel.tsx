'use client';

/**
 * VoiceActionPanel — speech/transcript analyst bench.
 * transcriptAnalyze / speakerDiarize / sentimentScore / keywordSpot +
 * mint/DM/publish/agent.
 */

import { useState } from 'react';
import { Mic, Users, Smile, Search, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('voice', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'analyze' | 'diarize' | 'sentiment' | 'keyword' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface AnalyzeResult { wordCount: number; sentenceCount: number; avgWordsPerSentence: number; avgWordLength: number; speakingRate: string; fillerWords?: Record<string, number>; totalFillers: number; fillerRate: string; complexityRating: string; vocabularyRichness: string }
interface SpeakerStat { speaker: string; segmentCount: number; wordCount: number; wordShare: number; talkTimeSeconds: number; talkTimeShare: number; avgWordsPerSegment: number }
interface DiarizeResult { speakerCount: number; totalSegments: number; totalWords: number; speakers: SpeakerStat[]; dominantSpeaker: string; balanceRatio: number }
interface SentSegment { index: number; speaker?: string; text: string; score: number; label: string }
interface SentimentResult { overallScore: number; overallLabel: string; segmentBreakdown: { positive: number; negative: number; neutral: number; total: number }; segments?: SentSegment[]; sentimentArc: string }
interface KeywordHit { keyword: string; count: number; occurrences: { position: number; snippet: string }[] }
interface KeywordResult { keywordsSearched: number; totalOccurrences: number; keywordDensity: string; wordCount: number; topKeywords: KeywordHit[]; notFound: string[] }

const DEMO_TRANSCRIPT = `[Speaker A]: So basically, you know, we wanted to launch the product by Q3, but actually the testing took longer than expected.
[Speaker B]: Right, and the customer feedback was, um, very positive overall.
[Speaker A]: That is fantastic. I think we should accelerate the rollout.
[Speaker B]: I disagree slightly. We need more data, basically.
[Speaker A]: OK fair point. Let us run another two weeks of beta and then ship.
[Speaker B]: Great plan. The team will be delighted.`;

export function VoiceActionPanel() {
  const [transcript, setTranscript] = useState(DEMO_TRANSCRIPT);
  const [duration, setDuration] = useState('5');
  const [keywords, setKeywords] = useState('product, launch, customer, data, ship');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [analyzeResult, setAnalyzeResult] = useState<AnalyzeResult | null>(null);
  const [diarizeResult, setDiarizeResult] = useState<DiarizeResult | null>(null);
  const [sentimentResult, setSentimentResult] = useState<SentimentResult | null>(null);
  const [keywordResult, setKeywordResult] = useState<KeywordResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  async function actAnalyze() {
    if (!transcript.trim()) { err('Transcript required.'); return; }
    setBusy('analyze'); setFeedback(null);
    try { const r = await callMacro<AnalyzeResult>('transcriptAnalyze', { artifact: { data: { transcript, durationMinutes: parseFloat(duration) || null } } }); if (r.ok && r.result) { setAnalyzeResult(r.result); ok(`${r.result.wordCount}w · ${r.result.fillerRate} fillers.`); } else err(r.error ?? 'analyze failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDiarize() {
    if (!transcript.trim()) { err('Transcript required.'); return; }
    setBusy('diarize'); setFeedback(null);
    try { const r = await callMacro<DiarizeResult>('speakerDiarize', { artifact: { data: { transcript } } }); if (r.ok && r.result) { setDiarizeResult(r.result); ok(`${r.result.speakerCount} speakers · dominant: ${r.result.dominantSpeaker}.`); } else err(r.error ?? 'diarize failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actSentiment() {
    if (!transcript.trim()) { err('Transcript required.'); return; }
    setBusy('sentiment'); setFeedback(null);
    try { const r = await callMacro<SentimentResult>('sentimentScore', { artifact: { data: { transcript } } }); if (r.ok && r.result) { setSentimentResult(r.result); ok(`${r.result.overallLabel} (${r.result.overallScore}).`); } else err(r.error ?? 'sentiment failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actKeyword() {
    const kws = keywords.split(',').map(s => s.trim()).filter(Boolean);
    if (kws.length === 0) { err('Keywords required.'); return; }
    setBusy('keyword'); setFeedback(null);
    try { const r = await callMacro<KeywordResult>('keywordSpot', { artifact: { data: { transcript, keywords: kws, contextRadius: 50 } } }); if (r.ok && r.result) { setKeywordResult(r.result); ok(`${r.result.totalOccurrences} hits · density ${r.result.keywordDensity}.`); } else err(r.error ?? 'keyword failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Transcript analysis`, tags: ['voice', 'transcript', sentimentResult?.overallLabel].filter((t): t is string => !!t), source: 'voice:transcript:mint', meta: { visibility: 'private', consent: { allowCitations: false }, voice: { analyze: analyzeResult, diarize: diarizeResult, sentiment: sentimentResult, keyword: keywordResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); ok(`Transcript DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`🎙 Transcript brief`, '', analyzeResult ? `${analyzeResult.wordCount}w / ${analyzeResult.sentenceCount}s · ${analyzeResult.speakingRate} · ${analyzeResult.fillerRate} fillers · ${analyzeResult.complexityRating}` : '', diarizeResult ? `${diarizeResult.speakerCount} speakers · ${diarizeResult.dominantSpeaker} dominant (balance ${diarizeResult.balanceRatio}%)` : '', sentimentResult ? `Sentiment: ${sentimentResult.overallLabel} (${sentimentResult.overallScore}) · arc ${sentimentResult.sentimentArc}` : '', keywordResult ? `Keywords: ${keywordResult.totalOccurrences} hits · top: ${keywordResult.topKeywords.slice(0, 3).map(k => `${k.keyword}(${k.count})`).join(', ')}` : '', mintedDtuId ? `\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
    try { const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body }); if (r.data?.ok !== false) { ok('Sent.'); setRecipient(''); } else err(r.data?.error ?? 'send failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPublish() {
    if (!analyzeResult && !sentimentResult) { err('Run analyze/sentiment first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Speech metrics report`, tags: ['voice', 'speech', 'public'], source: 'voice:report:publish', meta: { visibility: 'public', consent: { allowCitations: true }, analyze: analyzeResult, sentiment: sentimentResult } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (!id) { err('No DTU id.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) { setPublishedDtuId(id); ok(`Published ${id.slice(0, 8)}…`); } else err(pub.data?.error ?? 'publish failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Transcript review. ${analyzeResult ? `${analyzeResult.wordCount} words, ${analyzeResult.speakingRate}, ${analyzeResult.fillerRate} filler rate, ${analyzeResult.complexityRating} complexity.` : ''} ${diarizeResult ? `${diarizeResult.speakerCount} speakers, balance ${diarizeResult.balanceRatio}%.` : ''} ${sentimentResult ? `Sentiment: ${sentimentResult.overallLabel} (${sentimentResult.sentimentArc} arc).` : ''} Identify the single biggest coaching point for the dominant speaker + one positive note. Plain text, 3 sentences max.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Coaching ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'analyze' as ActionId, label: 'Analyze', desc: 'transcriptAnalyze', icon: Mic, accent: '#22c55e', handler: actAnalyze },
    { id: 'diarize' as ActionId, label: 'Diarize', desc: 'speakerDiarize stats', icon: Users, accent: '#06b6d4', handler: actDiarize },
    { id: 'sentiment' as ActionId, label: 'Sentiment', desc: 'sentimentScore arc', icon: Smile, accent: '#f59e0b', handler: actSentiment },
    { id: 'keyword' as ActionId, label: 'Keywords', desc: 'keywordSpot density', icon: Search, accent: '#a855f7', handler: actKeyword },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private transcript DTU', icon: Sparkles, accent: '#3b82f6', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send transcript brief', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Public speech report', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Coach', desc: 'Agent: coaching note', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  const SENT_COLOR: Record<string, string> = { positive: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/5', negative: 'text-red-300 border-red-500/30 bg-red-500/5', neutral: 'text-zinc-300 border-zinc-500/30 bg-zinc-500/5' };

  return (
    <div className="rounded-lg border border-emerald-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-emerald-500/10 pb-2">
        <Mic className="h-4 w-4 text-emerald-400" />
        <h3 className="text-sm font-semibold text-white">Voice bench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">transcript · diarize · sentiment · keywords</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div className="md:col-span-2">
          <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Transcript (use [Speaker X]: for diarization)</label>
          <textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} rows={6} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white font-mono mt-1" />
        </div>
        <div className="space-y-2">
          <input type="text" value={duration} onChange={(e) => setDuration(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="Duration min" />
          <input type="text" value={keywords} onChange={(e) => setKeywords(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="Keywords csv" />
          <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="DM recipient" />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
        {actions.map(act => {
          const Icon = act.icon; const isBusy = busy === act.id;
          return (
            <button key={act.id} type="button" disabled={!!busy} onClick={act.handler}
              className={cn('flex flex-col items-start gap-1.5 p-2.5 rounded-lg text-left border transition-all', 'bg-zinc-900/40 border-zinc-800 hover:bg-zinc-800/60 hover:border-zinc-700', 'disabled:opacity-40 disabled:cursor-not-allowed')}>
              <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ backgroundColor: act.accent + '20', color: act.accent }}>
                {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
              </div>
              <div className="text-[11px] font-semibold text-zinc-100 leading-tight">{act.label}</div>
              <div className="text-[10px] text-zinc-500 leading-tight line-clamp-2">{act.desc}</div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {analyzeResult && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-emerald-300 font-semibold">Speech metrics · {analyzeResult.complexityRating}</div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 mt-1">
              <div className="text-[11px] text-zinc-300">words <span className="font-mono text-emerald-200">{analyzeResult.wordCount}</span></div>
              <div className="text-[11px] text-zinc-300">sentences <span className="font-mono text-emerald-200">{analyzeResult.sentenceCount}</span></div>
              <div className="text-[11px] text-zinc-300">rate <span className="font-mono text-emerald-200">{analyzeResult.speakingRate}</span></div>
              <div className="text-[11px] text-zinc-300">vocab <span className="font-mono text-emerald-200">{analyzeResult.vocabularyRichness}</span></div>
              <div className="text-[11px] text-zinc-300">fillers <span className="font-mono text-amber-300">{analyzeResult.fillerRate}</span></div>
              <div className="text-[11px] text-zinc-300">avg/sentence <span className="font-mono text-emerald-200">{analyzeResult.avgWordsPerSentence}</span></div>
            </div>
            {analyzeResult.fillerWords && Object.entries(analyzeResult.fillerWords).slice(0, 4).map(([k, v]) => <span key={k} className="inline-block text-[10px] bg-amber-500/10 text-amber-200 px-1.5 py-0.5 rounded font-mono mr-1 mt-1">{k} ×{v}</span>)}
          </div>
        )}
        {diarizeResult && (
          <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold">Diarization · {diarizeResult.speakerCount} speakers</div>
            <div className="text-[11px] text-zinc-300">dominant: <strong className="text-cyan-200">{diarizeResult.dominantSpeaker}</strong> · balance {diarizeResult.balanceRatio}%</div>
            {diarizeResult.speakers.slice(0, 5).map((s, i) => <div key={i} className="text-[10px] text-zinc-400 mt-1 flex items-center gap-2"><span className="font-mono w-16 truncate">{s.speaker}</span><div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden"><div className="h-full bg-cyan-400" style={{ width: `${s.wordShare}%` }} /></div><span className="text-cyan-200 font-mono">{s.wordShare}%</span></div>)}
          </div>
        )}
        {sentimentResult && (
          <div className={cn('rounded-md border p-2.5', SENT_COLOR[sentimentResult.overallLabel] ?? SENT_COLOR.neutral)}>
            <div className="text-[10px] uppercase tracking-wider font-semibold">Sentiment · {sentimentResult.sentimentArc}</div>
            <div className="text-2xl font-bold capitalize">{sentimentResult.overallLabel} <span className="text-sm text-zinc-400">{sentimentResult.overallScore}</span></div>
            <div className="text-[10px] text-zinc-500">+{sentimentResult.segmentBreakdown.positive} / -{sentimentResult.segmentBreakdown.negative} / ={sentimentResult.segmentBreakdown.neutral} of {sentimentResult.segmentBreakdown.total}</div>
          </div>
        )}
        {keywordResult && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">Keywords · density {keywordResult.keywordDensity}</div>
            {keywordResult.topKeywords.slice(0, 6).map((k, i) => <div key={i} className="text-[11px] text-zinc-300 mt-0.5"><span className="font-mono text-purple-200">{k.keyword}</span> ×{k.count}</div>)}
            {keywordResult.notFound.length > 0 && <div className="text-[10px] text-zinc-500 italic mt-1">not found: {keywordResult.notFound.join(', ')}</div>}
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Coaching note</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
