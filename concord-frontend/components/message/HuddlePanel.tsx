'use client';

/**
 * HuddlePanel — live audio/video huddles in a channel (Slack Huddles parity).
 *
 * Wires message.huddle-{start,join,leave,end,list}. Real WebRTC capture is
 * acquired locally (getUserMedia) so the user sees their own audio/video
 * stream; the macro layer tracks huddle membership + lifecycle state.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Video, VideoOff, PhoneOff, Phone, Loader2, Radio } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface HuddleParticipant { handle: string; joinedAt: string; muted: boolean; video: boolean }
interface Huddle {
  id: string;
  channelId: string;
  channelName: string;
  mode: 'audio' | 'video';
  status: 'live' | 'ended';
  topic: string;
  host: string;
  participants: HuddleParticipant[];
  startedAt: string;
  endedAt: string | null;
  durationMs?: number;
}

export function HuddlePanel({ channelId, channelName }: { channelId: string; channelName: string }) {
  const [huddles, setHuddles] = useState<Huddle[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [topic, setTopic] = useState('');
  const [mode, setMode] = useState<'audio' | 'video'>('audio');
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun('message', 'huddle-list', { channelId });
      if (r.data?.ok) setHuddles((r.data.result?.huddles as Huddle[]) ?? []);
    } finally {
      setLoading(false);
    }
  }, [channelId]);

  useEffect(() => { void load(); }, [load]);

  const stopMedia = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => () => stopMedia(), [stopMedia]);

  async function acquireMedia(wantVideo: boolean) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: wantVideo });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setMicOn(true);
      setCamOn(wantVideo);
      return true;
    } catch {
      setError('Microphone/camera permission denied — joined as listener only.');
      return false;
    }
  }

  async function startHuddle() {
    setBusy(true);
    setError(null);
    try {
      const r = await lensRun('message', 'huddle-start', { channelId, mode, topic: topic.trim() });
      if (!r.data?.ok) { setError(r.data?.error ?? 'could not start huddle'); return; }
      const h = r.data.result?.huddle as Huddle;
      setActiveId(h.id);
      await acquireMedia(mode === 'video');
      setTopic('');
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function joinHuddle(h: Huddle) {
    setBusy(true);
    setError(null);
    try {
      const r = await lensRun('message', 'huddle-join', { huddleId: h.id });
      if (!r.data?.ok) { setError(r.data?.error ?? 'could not join'); return; }
      setActiveId(h.id);
      await acquireMedia(h.mode === 'video');
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function leaveHuddle() {
    if (!activeId) return;
    setBusy(true);
    try {
      await lensRun('message', 'huddle-leave', { huddleId: activeId });
      stopMedia();
      setActiveId(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function endHuddle(id: string) {
    setBusy(true);
    try {
      await lensRun('message', 'huddle-end', { huddleId: id });
      if (activeId === id) { stopMedia(); setActiveId(null); }
      await load();
    } finally {
      setBusy(false);
    }
  }

  function toggleMic() {
    const track = streamRef.current?.getAudioTracks()[0];
    if (track) { track.enabled = !track.enabled; setMicOn(track.enabled); }
  }
  function toggleCam() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (track) { track.enabled = !track.enabled; setCamOn(track.enabled); }
  }

  const live = huddles.filter((h) => h.status === 'live');
  const ended = huddles.filter((h) => h.status === 'ended').slice(0, 8);

  return (
    <div className="p-4 space-y-4 overflow-y-auto">
      <div className="flex items-center gap-2">
        <Radio className="w-4 h-4 text-emerald-400" />
        <h2 className="text-sm font-semibold text-gray-200">Huddles · #{channelName}</h2>
      </div>

      {error && <div className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded px-2 py-1">{error}</div>}

      {activeId ? (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] p-3 space-y-2">
          <div className="text-xs font-semibold text-emerald-200">You are in a huddle</div>
          {camOn && (
            <video ref={videoRef} autoPlay muted playsInline className="w-full max-h-48 rounded bg-black object-cover" />
          )}
          <div className="flex items-center gap-2">
            <button onClick={toggleMic} className="p-2 rounded bg-white/5 hover:bg-white/10 text-gray-200" title={micOn ? 'Mute' : 'Unmute'}>
              {micOn ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4 text-rose-400" />}
            </button>
            <button onClick={toggleCam} className="p-2 rounded bg-white/5 hover:bg-white/10 text-gray-200" title={camOn ? 'Stop video' : 'Start video'}>
              {camOn ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4 text-gray-400" />}
            </button>
            <button onClick={leaveHuddle} disabled={busy} className="ml-auto px-3 py-1.5 text-xs rounded bg-rose-600 hover:bg-rose-500 text-white inline-flex items-center gap-1 disabled:opacity-50">
              <PhoneOff className="w-3 h-3" /> Leave
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 space-y-2">
          <div className="text-xs font-semibold text-gray-300">Start a huddle</div>
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Topic (optional)"
            className="w-full px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-white"
          />
          <div className="flex items-center gap-2">
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as 'audio' | 'video')}
              className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-white"
            >
              <option value="audio">Audio</option>
              <option value="video">Video</option>
            </select>
            <button onClick={startHuddle} disabled={busy} className="ml-auto px-3 py-1.5 text-xs rounded bg-emerald-600 hover:bg-emerald-500 text-white inline-flex items-center gap-1 disabled:opacity-50">
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Phone className="w-3 h-3" />} Start
            </button>
          </div>
        </div>
      )}

      <div>
        <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Live</div>
        {loading ? (
          <p className="text-xs text-gray-400 inline-flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Loading…</p>
        ) : live.length === 0 ? (
          <p className="text-xs text-gray-400">No live huddles yet.</p>
        ) : live.map((h) => (
          <div key={h.id} className="flex items-center gap-2 rounded border border-emerald-500/20 bg-emerald-500/[0.04] px-2 py-1.5 mb-1">
            <Radio className="w-3 h-3 text-emerald-400 animate-pulse" />
            <div className="flex-1 min-w-0">
              <div className="text-xs text-gray-200 truncate">{h.topic || `${h.mode} huddle`}</div>
              <div className="text-[10px] text-gray-400">{h.participants.length} in call · host {h.host}</div>
            </div>
            {activeId !== h.id && (
              <button onClick={() => joinHuddle(h)} disabled={busy} className="px-2 py-1 text-[10px] rounded bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50">Join</button>
            )}
            <button onClick={() => endHuddle(h.id)} disabled={busy} className="px-2 py-1 text-[10px] rounded bg-white/5 hover:bg-white/10 text-rose-300 disabled:opacity-50">End</button>
          </div>
        ))}
      </div>

      {ended.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Recent</div>
          {ended.map((h) => (
            <div key={h.id} className="flex items-center gap-2 px-2 py-1 text-[11px] text-gray-400">
              <span className="flex-1 truncate">{h.topic || `${h.mode} huddle`}</span>
              {typeof h.durationMs === 'number' && <span>{Math.round(h.durationMs / 60000)}m</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default HuddlePanel;
