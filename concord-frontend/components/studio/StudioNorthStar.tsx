'use client';

/**
 * Studio north star — an arrangement. The full DAW stays under More.
 * Clip bars render only when a saved project actually stored them.
 */

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Play, Square } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthGreeting, QuietMore, northCtaClass } from '@/components/code/CodeFamilyChrome';
import { StudioFamilyPill } from '@/components/studio/StudioFamilyChrome';
import { StudioDawWorkspace } from '@/components/studio/StudioDawWorkspace';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { TransportEngine, resumeAudioContext } from '@/lib/daw/engine';

const STARTER = ['Drums', 'Bass', 'Keys', 'Voice'];
const BARS = 64;

type ClipShape = { startBeat?: number; durationBeats?: number; length?: number; duration?: number };
type TrackShape = { id?: string; name?: string; clips?: ClipShape[] };

function clockFromBeat(beat: number, bpm: number): string {
  const sec = Math.max(0, Math.floor((beat * 60) / Math.max(1, bpm)));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function clipSpan(clip: ClipShape): { start: number; dur: number } | null {
  const start = Number(clip.startBeat);
  const dur = Number(clip.durationBeats ?? clip.length ?? clip.duration);
  if (!Number.isFinite(start) || !Number.isFinite(dur) || dur <= 0) return null;
  return { start, dur };
}

export function StudioNorthStar() {
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const { items, create } = useLensData<Record<string, unknown>>('studio', 'project', { noSeed: true });
  const [desk, setDesk] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [clock, setClock] = useState('00:00');
  const [error, setError] = useState('');
  const transport = useMemo(() => new TransportEngine({ bpm: 120 }), []);

  const saved = items[0];
  const savedTracks = useMemo(() => {
    const raw = saved?.data?.tracks;
    return Array.isArray(raw) ? (raw as TrackShape[]) : null;
  }, [saved]);

  const lanes: TrackShape[] = savedTracks && savedTracks.length > 0
    ? savedTracks
    : STARTER.map((name) => ({ name, clips: [] }));
  const title = saved?.title || (typeof saved?.data?.title === 'string' ? saved.data.title : '') || 'Untitled session';
  const bpm = typeof saved?.data?.bpm === 'number' ? saved.data.bpm : 120;

  useEffect(() => {
    transport.updateConfig({ bpm });
  }, [bpm, transport]);

  useEffect(() => {
    return () => { transport.stop(); };
  }, [transport]);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      setClock(clockFromBeat(transport.currentBeat, bpm));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, bpm, transport]);

  const toggle = async () => {
    setError('');
    if (playing) {
      transport.stop();
      setPlaying(false);
      setClock('00:00');
      return;
    }
    if (!saved) {
      try {
        await create({
          title: 'Untitled session',
          data: {
            title: 'Untitled session',
            bpm: 120,
            tracks: STARTER.map((name) => ({ name, clips: [] })),
          },
          meta: { status: 'active', tags: ['session'] },
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not save the session.');
        return;
      }
    }
    resumeAudioContext();
    transport.play();
    setPlaying(true);
  };

  if (desk) {
    return (
      <div className="min-h-[calc(100vh-4rem)] bg-black px-6 pb-16 pt-4">
        <button
          type="button"
          onClick={() => setDesk(false)}
          className="mb-4 inline-flex items-center gap-1.5 text-[14px] text-zinc-500 hover:text-zinc-200"
        >
          <ArrowLeft className="h-4 w-4" />
          Studio
        </button>
        <StudioDawWorkspace />
      </div>
    );
  }

  return (
    <LensShell lensId="studio" asMain={false} disableAgentFab>
      <div data-lens-theme="studio" className="flex min-h-[calc(100vh-4rem)] flex-col px-8 pb-28 pt-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <NorthGreeting kicker="Studio" title={who ? `What are we making, ${who}` : 'What are we making'} />
            <StudioFamilyPill active="studio" />
          </div>
          <QuietMore items={[{ id: 'daw', label: 'Full DAW' }]} onPick={() => setDesk(true)} />
        </div>

        <div className="mt-8">
          <div className="mb-3 flex items-center gap-3 text-zinc-200">
            {playing
              ? <Square className="h-3.5 w-3.5 fill-teal-400 text-teal-400" aria-hidden />
              : <Play className="h-3.5 w-3.5 fill-teal-400 text-teal-400" aria-hidden />}
            <span className="text-[15px]">{title}</span>
            <span className="font-mono text-[13px] text-zinc-500">{clock}</span>
          </div>
          <div className="space-y-2" aria-label="Arrangement">
            {lanes.map((track, i) => {
              const clips = (track.clips || []).map(clipSpan).filter((c): c is { start: number; dur: number } => !!c);
              return (
                <div key={track.id || `${track.name}-${i}`} className="flex items-center gap-4">
                  <span className="w-16 shrink-0 text-[13px] text-zinc-400">{track.name || 'Track'}</span>
                  <div className="relative h-7 flex-1 overflow-hidden rounded-md bg-white/[0.04]">
                    {clips.map((clip, ci) => (
                      <span
                        key={ci}
                        className="absolute top-1 bottom-1 rounded-sm bg-teal-900/80"
                        style={{
                          left: `${Math.min(100, (clip.start / BARS) * 100)}%`,
                          width: `${Math.min(100, (clip.dur / BARS) * 100)}%`,
                        }}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          {!saved && (
            <p className="mt-3 text-[13px] text-zinc-500">No saved session yet. Play stores this one.</p>
          )}
          {error && <p role="alert" className="mt-3 text-[13px] text-rose-300">{error}</p>}
        </div>

        <button type="button" className={northCtaClass} onClick={() => { void toggle(); }}>
          {playing ? 'Stop' : 'Play'}
        </button>
      </div>
    </LensShell>
  );
}
