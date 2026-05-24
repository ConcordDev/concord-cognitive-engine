'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Video, Loader2, FileText, Save, Play, Pause } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface TranscriptCue { sec: number; text: string }
interface VideoProgress {
  lessonId: string; positionSec: number; watchedSec: number;
  durationSec: number; completed: boolean; watchedPct: number;
}

function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Video lesson player with progress scrubbing + synced transcript.
 * Playback position persists per-user via `video-progress-save`; the
 * transcript is authored via `video-transcript-save` and clicking a
 * cue seeks the simulated player to that second.
 */
export function VideoLessonPlayer() {
  const [lessonId, setLessonId] = useState('');
  const [activeLesson, setActiveLesson] = useState('');
  const [progress, setProgress] = useState<VideoProgress | null>(null);
  const [cues, setCues] = useState<TranscriptCue[]>([]);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(600);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [transcriptDraft, setTranscriptDraft] = useState('');
  const [showEditor, setShowEditor] = useState(false);
  const [saved, setSaved] = useState(false);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSaveRef = useRef(0);

  const load = useCallback(async (id: string) => {
    if (!id.trim()) return;
    setLoading(true);
    try {
      const [p, t] = await Promise.all([
        lensRun('education', 'video-progress-get', { lessonId: id }),
        lensRun('education', 'video-transcript-get', { lessonId: id }),
      ]);
      if (p.data?.ok) {
        const pr = p.data.result as VideoProgress;
        setProgress(pr);
        setPosition(pr.positionSec || 0);
        if (pr.durationSec > 0) setDuration(pr.durationSec);
      }
      if (t.data?.ok) setCues((t.data.result as { cues: TranscriptCue[] }).cues || []);
      setActiveLesson(id);
    } catch (e) { console.error('[VideoLesson] load failed', e); }
    finally { setLoading(false); }
  }, []);

  const persist = useCallback(async (pos: number) => {
    if (!activeLesson) return;
    try {
      const r = await lensRun('education', 'video-progress-save', {
        lessonId: activeLesson, positionSec: Math.round(pos), durationSec: duration,
      });
      if (r.data?.ok) setProgress(r.data.result as VideoProgress);
    } catch (e) { console.error('[VideoLesson] persist failed', e); }
  }, [activeLesson, duration]);

  useEffect(() => {
    if (playing) {
      tickRef.current = setInterval(() => {
        setPosition(p => {
          const next = Math.min(duration, p + 1);
          if (next >= duration) setPlaying(false);
          if (next - lastSaveRef.current >= 5 || next >= duration) {
            lastSaveRef.current = next;
            void persist(next);
          }
          return next;
        });
      }, 1000);
    }
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [playing, duration, persist]);

  function seek(sec: number) {
    setPosition(sec);
    setPlaying(false);
    lastSaveRef.current = sec;
    void persist(sec);
  }

  async function saveTranscript() {
    if (!activeLesson || !transcriptDraft.trim()) return;
    const parsed: TranscriptCue[] = transcriptDraft.split('\n').map(line => {
      const m = line.match(/^\s*(\d+):(\d+)\s+(.+)$/);
      if (m) return { sec: parseInt(m[1]) * 60 + parseInt(m[2]), text: m[3].trim() };
      const m2 = line.match(/^\s*(\d+)\s+(.+)$/);
      if (m2) return { sec: parseInt(m2[1]), text: m2[2].trim() };
      return null;
    }).filter((c): c is TranscriptCue => !!c && !!c.text);
    if (parsed.length === 0) return;
    try {
      const r = await lensRun('education', 'video-transcript-save', { lessonId: activeLesson, cues: parsed });
      if (r.data?.ok) {
        setCues(parsed.sort((a, b) => a.sec - b.sec));
        setShowEditor(false);
        setTranscriptDraft('');
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch (e) { console.error('[VideoLesson] transcript save failed', e); }
  }

  const activeCueIdx = cues.reduce((acc, c, i) => (c.sec <= position ? i : acc), -1);
  const pct = duration > 0 ? (position / duration) * 100 : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[200px]">
          <label className="text-[10px] uppercase tracking-wider text-gray-500">Lesson ID</label>
          <input
            value={lessonId}
            onChange={e => setLessonId(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') load(lessonId); }}
            placeholder="Paste a lesson ID (less_…)"
            className="w-full mt-1 px-3 py-2 bg-lattice-deep border border-lattice-border rounded text-sm text-white"
          />
        </div>
        <button
          onClick={() => load(lessonId)}
          disabled={!lessonId.trim() || loading}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs rounded bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/30 font-bold disabled:opacity-40"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Video className="w-3.5 h-3.5" />}
          Load lesson
        </button>
      </div>

      {!activeLesson && (
        <div className="text-center py-12 text-sm text-gray-500">
          No lesson loaded yet. Enter a lesson ID to play and track video progress.
        </div>
      )}

      {activeLesson && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-3">
            <div className="aspect-video bg-black border border-white/10 rounded-lg flex items-center justify-center relative overflow-hidden">
              <Video className="w-14 h-14 text-white/20" />
              <div className="absolute bottom-2 right-3 text-xs font-mono text-white/60">
                {fmtTime(position)} / {fmtTime(duration)}
              </div>
            </div>
            <div className="space-y-2">
              <div
                className="h-3 bg-white/5 rounded-full overflow-hidden cursor-pointer relative"
                onClick={e => {
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  seek(Math.round(((e.clientX - rect.left) / rect.width) * duration));
                }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
                <div className="h-full bg-neon-cyan rounded-full" style={{ width: `${pct}%` }} />
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setPlaying(p => !p)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-neon-cyan text-black font-bold"
                >
                  {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                  {playing ? 'Pause' : 'Play'}
                </button>
                <label className="text-[10px] text-gray-500 flex items-center gap-1">
                  Duration
                  <input
                    type="number" min={1} value={duration}
                    onChange={e => setDuration(Math.max(1, Number(e.target.value) || 1))}
                    className="w-20 px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white"
                  />
                  sec
                </label>
                {progress && (
                  <span className={cn('ml-auto text-xs font-bold', progress.completed ? 'text-neon-green' : 'text-gray-400')}>
                    {progress.completed ? 'Completed' : `${progress.watchedPct}% watched`}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-purple-400" /> Transcript
              </h3>
              <button
                onClick={() => setShowEditor(s => !s)}
                className="text-[10px] px-2 py-1 rounded border border-white/10 text-gray-400 hover:bg-white/5"
              >
                {showEditor ? 'Cancel' : 'Edit'}
              </button>
            </div>
            {showEditor ? (
              <div className="space-y-2">
                <textarea
                  value={transcriptDraft}
                  onChange={e => setTranscriptDraft(e.target.value)}
                  rows={8}
                  placeholder={'One cue per line:\n0:00 Welcome to the lesson\n0:45 First concept'}
                  className="w-full px-3 py-2 bg-lattice-deep border border-lattice-border rounded text-xs text-white resize-none font-mono"
                />
                <button
                  onClick={saveTranscript}
                  disabled={!transcriptDraft.trim()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-purple-500 text-white font-bold disabled:opacity-40"
                >
                  <Save className="w-3.5 h-3.5" /> Save transcript
                </button>
              </div>
            ) : cues.length === 0 ? (
              <p className="text-xs text-gray-500 py-4">No transcript yet. Click Edit to author timed cues.</p>
            ) : (
              <div className="max-h-[420px] overflow-y-auto space-y-1 pr-1">
                {cues.map((c, i) => (
                  <button
                    key={i}
                    onClick={() => seek(c.sec)}
                    className={cn(
                      'w-full text-left px-2 py-1.5 rounded text-xs flex gap-2 transition-colors',
                      i === activeCueIdx ? 'bg-neon-cyan/15 border border-neon-cyan/30' : 'hover:bg-white/5 border border-transparent',
                    )}
                  >
                    <span className="font-mono text-neon-cyan shrink-0">{fmtTime(c.sec)}</span>
                    <span className="text-gray-300">{c.text}</span>
                  </button>
                ))}
              </div>
            )}
            {saved && <p className="text-[10px] text-neon-green">Transcript saved.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

export default VideoLessonPlayer;
