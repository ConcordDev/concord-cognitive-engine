'use client';

/**
 * VoiceRecordingStudio — the recording detail workspace covering four
 * Otter.ai-parity features: LLM-written meeting summary, timestamped
 * playback synced to the transcript (click a line → seek audio), sharing
 * a recording with collaborators + per-segment comments, and multi-language
 * translation. Wires voice.recording-list / -detail, recording-summary,
 * recording-summary-llm, recording-share / -unshare / share-detail,
 * segment-comment-add / -list / -delete, transcript-translate /
 * transcript-translations-list.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Sparkles, BrainCircuit, Share2, MessageSquare, Languages, Loader2,
  Play, Pause, Send, Trash2, UserPlus, Star,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface RecMeta { id: string; title: string; durationSec: number; segmentCount: number; speakerCount: number }
interface Segment { id: string; speaker: string; text: string; startSec: number; highlighted: boolean }
interface DetSummary {
  composer?: string; tldr?: string; keyPoints: string[];
  decisions?: string[]; openQuestions?: string[]; topics?: string[];
  actionItems: (string | { text?: string; task?: string; speaker?: string; owner?: string })[];
}
interface Recording { id: string; title: string; durationSec: number; segments: Segment[]; summary: DetSummary | null }
interface Comment { id: string; segmentId: string; authorId: string; body: string; createdAt: string }
interface ShareInfo { id: string; collaborators: string[]; comments: Comment[] }
interface TranslationMeta { sourceLang: string; targetLang: string; segmentCount: number; partial: boolean }
interface TranslatedSeg { id: string; speaker: string; startSec: number; text: string; translated: string }

const LANG_OPTIONS = [
  { code: 'es', label: 'Spanish' }, { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' }, { code: 'it', label: 'Italian' },
  { code: 'pt', label: 'Portuguese' }, { code: 'ja', label: 'Japanese' },
  { code: 'zh', label: 'Chinese' }, { code: 'ar', label: 'Arabic' },
];

function ts(sec: number): string {
  const m = Math.floor(sec / 60);
  return `${m}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
}

export function VoiceRecordingStudio({ refreshKey }: { refreshKey?: number }) {
  const [recordings, setRecordings] = useState<RecMeta[]>([]);
  const [active, setActive] = useState<Recording | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Playback (timestamped sync).
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playPos, setPlayPos] = useState(0);
  const [playing, setPlaying] = useState(false);

  // Share + comments.
  const [share, setShare] = useState<ShareInfo | null>(null);
  const [collabInput, setCollabInput] = useState('');
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});

  // Translation.
  const [targetLang, setTargetLang] = useState('es');
  const [translations, setTranslations] = useState<TranslationMeta[]>([]);
  const [translatedSegs, setTranslatedSegs] = useState<TranslatedSeg[] | null>(null);

  const refresh = useCallback(async () => {
    const r = await lensRun('voice', 'recording-list', {});
    setRecordings((r.data?.result?.recordings as RecMeta[]) || []);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh, refreshKey]);

  const loadShare = useCallback(async (id: string) => {
    const r = await lensRun('voice', 'share-detail', { recordingId: id });
    setShare(r.data?.ok && r.data.result?.shared ? (r.data.result.share as ShareInfo) : null);
  }, []);

  const loadTranslations = useCallback(async (id: string) => {
    const r = await lensRun('voice', 'transcript-translations-list', { id });
    setTranslations(r.data?.ok ? ((r.data.result?.translations as TranslationMeta[]) || []) : []);
  }, []);

  const open = useCallback(async (id: string) => {
    setError(null);
    setTranslatedSegs(null);
    const r = await lensRun('voice', 'recording-detail', { id });
    if (r.data?.ok) {
      setActive(r.data.result?.recording as Recording);
      await Promise.all([loadShare(id), loadTranslations(id)]);
    }
  }, [loadShare, loadTranslations]);

  const reload = useCallback(async () => { if (active) await open(active.id); }, [active, open]);

  // ── LLM summary ────────────────────────────────────────────────────
  const summarize = useCallback(async (llm: boolean) => {
    if (!active) return;
    setBusy(llm ? 'llm' : 'det');
    setError(null);
    const r = await lensRun('voice', llm ? 'recording-summary-llm' : 'recording-summary', { id: active.id });
    setBusy(null);
    if (r.data?.ok) await reload();
    else setError(r.data?.error || 'Summary failed');
  }, [active, reload]);

  // ── Timestamped playback ───────────────────────────────────────────
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => setPlayPos(a.currentTime);
    const onEnd = () => setPlaying(false);
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('ended', onEnd);
    return () => { a.removeEventListener('timeupdate', onTime); a.removeEventListener('ended', onEnd); };
  }, [active]);

  const togglePlay = useCallback(() => {
    const a = audioRef.current;
    if (!a || !a.src) { setError('No audio attached to this recording'); return; }
    if (a.paused) { void a.play(); setPlaying(true); } else { a.pause(); setPlaying(false); }
  }, []);

  const seekTo = useCallback((sec: number) => {
    const a = audioRef.current;
    if (a && a.src) { a.currentTime = sec; setPlayPos(sec); }
  }, []);

  const onAudioFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    const a = audioRef.current;
    if (f && a) { a.src = URL.createObjectURL(f); setPlayPos(0); setPlaying(false); }
  }, []);

  // ── Share + comments ───────────────────────────────────────────────
  const addCollaborator = useCallback(async () => {
    if (!active || !collabInput.trim()) return;
    setBusy('share');
    const r = await lensRun('voice', 'recording-share', {
      id: active.id, collaborators: [collabInput.trim()],
    });
    setBusy(null);
    if (r.data?.ok) { setShare(r.data.result?.share as ShareInfo); setCollabInput(''); }
    else setError(r.data?.error || 'Share failed');
  }, [active, collabInput]);

  const removeCollaborator = useCallback(async (cid: string) => {
    if (!active) return;
    const r = await lensRun('voice', 'recording-unshare', { id: active.id, collaborator: cid });
    if (r.data?.ok) setShare((r.data.result?.share as ShareInfo) || null);
  }, [active]);

  const addComment = useCallback(async (segmentId: string) => {
    if (!active) return;
    const body = (commentDrafts[segmentId] || '').trim();
    if (!body) return;
    const r = await lensRun('voice', 'segment-comment-add', {
      recordingId: active.id, segmentId, body,
    });
    if (r.data?.ok) {
      setCommentDrafts(d => ({ ...d, [segmentId]: '' }));
      await loadShare(active.id);
    } else {
      setError(r.data?.error || 'Comment failed');
    }
  }, [active, commentDrafts, loadShare]);

  const deleteComment = useCallback(async (commentId: string) => {
    if (!active) return;
    const r = await lensRun('voice', 'segment-comment-delete', { recordingId: active.id, commentId });
    if (r.data?.ok) await loadShare(active.id);
  }, [active, loadShare]);

  // ── Translation ────────────────────────────────────────────────────
  const translate = useCallback(async () => {
    if (!active) return;
    setBusy('translate');
    setError(null);
    const r = await lensRun('voice', 'transcript-translate', {
      id: active.id, targetLang, persist: true,
    });
    setBusy(null);
    if (r.data?.ok) {
      const t = r.data.result?.translation as { segments: TranslatedSeg[] };
      setTranslatedSegs(t.segments);
      await loadTranslations(active.id);
    } else {
      setError(r.data?.error || 'Translation failed');
    }
  }, [active, targetLang, loadTranslations]);

  if (loading) {
    return <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;
  }

  return (
    <div className="grid sm:grid-cols-[200px_1fr] gap-3">
      <ul className="space-y-1">
        <p className="text-[10px] uppercase tracking-wide text-zinc-400 mb-1">Recordings</p>
        {recordings.length === 0 && <li className="text-[11px] text-zinc-400 italic">No recordings yet.</li>}
        {recordings.map(r => (
          <li key={r.id}>
            <button onClick={() => open(r.id)}
              className={cn('w-full text-left rounded-lg px-2.5 py-2 border',
                active?.id === r.id ? 'bg-sky-600/15 border-sky-700/50' : 'bg-zinc-900/60 border-zinc-800 hover:border-zinc-700')}>
              <p className="text-xs font-semibold text-zinc-100 truncate">{r.title}</p>
              <p className="text-[10px] text-zinc-400">{ts(r.durationSec)} · {r.segmentCount} seg</p>
            </button>
          </li>
        ))}
      </ul>

      {active ? (
        <div className="space-y-3">
          <audio ref={audioRef} className="hidden" />
          {error && <p className="text-xs text-rose-400">{error}</p>}

          {/* Summary controls */}
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <h4 className="text-sm font-bold text-zinc-100 flex-1 truncate">{active.title}</h4>
              <button onClick={() => summarize(false)} disabled={busy !== null}
                className="px-2.5 py-1 text-xs rounded bg-zinc-700/60 text-zinc-200 hover:bg-zinc-700 inline-flex items-center gap-1 disabled:opacity-40">
                {busy === 'det' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}Quick summary
              </button>
              <button onClick={() => summarize(true)} disabled={busy !== null}
                className="px-2.5 py-1 text-xs rounded bg-violet-600/25 text-violet-200 hover:bg-violet-600/40 inline-flex items-center gap-1 disabled:opacity-40">
                {busy === 'llm' ? <Loader2 className="w-3 h-3 animate-spin" /> : <BrainCircuit className="w-3 h-3" />}AI summary
              </button>
            </div>
            {active.summary ? (
              <div className="bg-violet-950/20 border border-violet-900/40 rounded p-2 space-y-1.5">
                {active.summary.composer === 'llm' && (
                  <span className="text-[9px] uppercase tracking-wide text-violet-400">AI-written</span>
                )}
                {active.summary.tldr && <p className="text-[11px] text-violet-100">{active.summary.tldr}</p>}
                {active.summary.keyPoints.length > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-violet-300">Key points</p>
                    {active.summary.keyPoints.map((k, i) => <p key={i} className="text-[11px] text-violet-100">• {k}</p>)}
                  </div>
                )}
                {active.summary.decisions && active.summary.decisions.length > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-amber-300">Decisions</p>
                    {active.summary.decisions.map((d, i) => <p key={i} className="text-[11px] text-amber-100">• {d}</p>)}
                  </div>
                )}
                {active.summary.actionItems.length > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-emerald-300">Action items</p>
                    {active.summary.actionItems.map((a, i) => {
                      const text = typeof a === 'string' ? a : (a.task || a.text || '');
                      const who = typeof a === 'string' ? '' : (a.owner || a.speaker || '');
                      return <p key={i} className="text-[11px] text-emerald-100">☐ {text}{who && <span className="text-emerald-500/70"> — {who}</span>}</p>;
                    })}
                  </div>
                )}
                {active.summary.openQuestions && active.summary.openQuestions.length > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-sky-300">Open questions</p>
                    {active.summary.openQuestions.map((q, i) => <p key={i} className="text-[11px] text-sky-100">? {q}</p>)}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-zinc-400 italic">No summary yet — generate a quick or AI summary.</p>
            )}
          </div>

          {/* Timestamped playback + transcript with comments */}
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <button onClick={togglePlay}
                className="p-1.5 rounded-full bg-sky-600 hover:bg-sky-500 text-white">
                {playing ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
              </button>
              <span className="text-[11px] font-mono text-zinc-400">{ts(playPos)} / {ts(active.durationSec)}</span>
              <label className="text-[10px] text-zinc-400 ml-auto cursor-pointer hover:text-zinc-300">
                attach audio
                <input type="file" accept="audio/*" onChange={onAudioFile} className="hidden" />
              </label>
            </div>
            <p className="text-[10px] text-zinc-400 mb-1.5">Click a line to jump the audio to that timestamp.</p>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {active.segments.map(g => {
                const segComments = share?.comments.filter(c => c.segmentId === g.id) || [];
                const playingThis = playPos >= g.startSec && playPos < g.startSec + 8;
                return (
                  <div key={g.id} className={cn('rounded px-1.5 py-1', playingThis && 'bg-sky-900/25', g.highlighted && 'bg-amber-900/15')}>
                    <button onClick={() => seekTo(g.startSec)} className="w-full text-left flex items-start gap-2">
                      {g.highlighted && <Star className="w-3 h-3 text-amber-400 mt-0.5 shrink-0" fill="currentColor" />}
                      <span className="text-[10px] font-mono text-sky-500 mt-0.5 w-9 shrink-0">{ts(g.startSec)}</span>
                      <span className="text-[10px] font-semibold text-sky-400 mt-0.5 w-16 shrink-0 truncate">{g.speaker}</span>
                      <span className="flex-1 text-xs text-zinc-200">{g.text}</span>
                    </button>
                    {segComments.map(c => (
                      <div key={c.id} className="ml-[100px] mt-1 flex items-start gap-1.5 text-[11px]">
                        <MessageSquare className="w-3 h-3 text-violet-400 mt-0.5 shrink-0" />
                        <span className="text-violet-300 font-medium">{c.authorId}</span>
                        <span className="text-zinc-300 flex-1">{c.body}</span>
                        <button onClick={() => deleteComment(c.id)} className="text-rose-400 hover:text-rose-300" aria-label="Delete comment">
                          <Trash2 className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    ))}
                    <div className="ml-[100px] mt-1 flex items-center gap-1">
                      <input
                        value={commentDrafts[g.id] || ''}
                        onChange={e => setCommentDrafts(d => ({ ...d, [g.id]: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter') void addComment(g.id); }}
                        placeholder="Comment on this segment…"
                        className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-1.5 py-0.5 text-[11px] text-zinc-200"
                      />
                      <button onClick={() => addComment(g.id)} className="p-1 text-violet-400 hover:text-violet-300" aria-label="Send comment">
                        <Send className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Share */}
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3">
            <p className="text-xs font-semibold text-zinc-200 mb-2 inline-flex items-center gap-1.5">
              <Share2 className="w-3.5 h-3.5 text-sky-400" />Collaborators
            </p>
            <div className="flex items-center gap-1.5 mb-2">
              <input value={collabInput} onChange={e => setCollabInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void addCollaborator(); }}
                placeholder="Collaborator user id or email"
                className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
              <button onClick={addCollaborator} disabled={!collabInput.trim() || busy !== null}
                className="px-2.5 py-1 text-xs rounded bg-sky-600 hover:bg-sky-500 text-white inline-flex items-center gap-1 disabled:opacity-40">
                <UserPlus className="w-3 h-3" />Add
              </button>
            </div>
            {share && share.collaborators.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5">
                {share.collaborators.map(c => (
                  <li key={c} className="inline-flex items-center gap-1 bg-zinc-800 rounded px-1.5 py-0.5 text-[11px] text-zinc-200">
                    {c}
                    <button onClick={() => removeCollaborator(c)} className="text-rose-400 hover:text-rose-300" aria-label={`Remove ${c}`}>×</button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[11px] text-zinc-400 italic">Not shared yet.</p>
            )}
          </div>

          {/* Translation */}
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <p className="text-xs font-semibold text-zinc-200 inline-flex items-center gap-1.5">
                <Languages className="w-3.5 h-3.5 text-sky-400" />Translate transcript
              </p>
              <select value={targetLang} onChange={e => setTargetLang(e.target.value)}
                className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200">
                {LANG_OPTIONS.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
              <button onClick={translate} disabled={busy !== null}
                className="px-2.5 py-1 text-xs rounded bg-violet-600/25 text-violet-200 hover:bg-violet-600/40 inline-flex items-center gap-1 disabled:opacity-40">
                {busy === 'translate' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Languages className="w-3 h-3" />}Translate
              </button>
            </div>
            {translations.length > 0 && (
              <p className="text-[10px] text-zinc-400 mb-1.5">
                Saved translations: {translations.map(t => t.targetLang.toUpperCase()).join(', ')}
              </p>
            )}
            {translatedSegs ? (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {translatedSegs.map(s => (
                  <div key={s.id} className="text-[11px]">
                    <span className="font-mono text-sky-500 mr-1.5">{ts(s.startSec)}</span>
                    <span className="font-semibold text-sky-400 mr-1.5">{s.speaker}</span>
                    <span className="text-zinc-200">{s.translated}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-zinc-400 italic">No translation yet — pick a language and translate.</p>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-zinc-900/20 border border-dashed border-zinc-800 rounded-lg flex items-center justify-center text-xs text-zinc-400 min-h-[160px]">
          Select a recording to summarize, play, share, comment, and translate.
        </div>
      )}
    </div>
  );
}
