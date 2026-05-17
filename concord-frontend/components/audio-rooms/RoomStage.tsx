'use client';

/**
 * RoomStage — Spaces (live audio room) stage with WebRTC mesh.
 *
 * Phase 12 — owns the in-room experience after the user clicks Join in
 * RoomList. Connects via `audio-room:*` Socket.IO signaling and an
 * RTCPeerConnection per peer (full-mesh up to ~8 peers; UI shows everyone
 * but the mesh degrades gracefully if more join).
 *
 * Distinction from VoiceMesh:
 *   - VoiceMesh is the in-world (Concordia) spatial voice chat keyed
 *     by world cell. Uses `voice_chat.*` macros + the legacy single
 *     "voice" socket room.
 *   - RoomStage is Spaces — per-room signaling, host/speaker/listener
 *     roles, hand raise, host-only promote. Uses `spaces.*` macros +
 *     the per-room `audio-room:${roomId}` socket room.
 *
 * No fake data: speaker grid + listener count come from `spaces.get`;
 * the mic indicator reflects the actual outbound MediaStreamTrack
 * enabled state; peer dots reflect real RTCPeerConnection state.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Mic, MicOff, Hand, PhoneOff, X, Users, Radio, Loader2, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api/client';
import { subscribe, emit, getSocket } from '@/lib/realtime/socket';
import { UserLink } from '@/components/social/UserLink';
import { cn } from '@/lib/utils';

interface Speaker { user_id: string; role: string; joined_at: number; }
interface Room {
  id: string;
  hostUserId: string;
  title: string;
  description?: string | null;
  startedAt: number;
  endedAt: number | null;
  speakers: Speaker[];
  listenerCount: number;
  handsRaised: { user_id: string }[];
  isRecording: boolean;
}

interface PeerInfo {
  peerId: string; // socket.id of remote
  pc: RTCPeerConnection;
  gain: GainNode;
  analyser: AnalyserNode;
}

const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

async function runMacro<T>(domain: string, name: string, input: Record<string, unknown>): Promise<T | null> {
  try { const r = await api.post('/api/lens/run', { domain, name, input }); return r?.data as T; }
  catch { return null; }
}

export interface RoomStageProps {
  roomId: string;
  selfUserId: string;
  onClose: () => void;
}

export function RoomStage({ roomId, selfUserId, onClose }: RoomStageProps) {
  const qc = useQueryClient();
  const [joinedMesh, setJoinedMesh] = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const [muted, setMuted]   = useState(true);
  const [handRaised, setHandRaised] = useState(false);
  const [peerIds, setPeerIds]       = useState<string[]>([]);
  const [, forceTick] = useState(0);

  const audioCtxRef    = useRef<AudioContext | null>(null);
  const masterGainRef  = useRef<GainNode | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef       = useRef<Map<string, PeerInfo>>(new Map());
  const speakLevelsRef = useRef<Map<string, number>>(new Map());

  // ── Server-side room state (speakers, listeners, hands) ─────────────
  const { data: roomData, refetch: refetchRoom } = useQuery<{ ok: boolean; room?: Room } | null>({
    queryKey: ['spaces-room', roomId],
    queryFn: async () => runMacro<{ ok: boolean; room?: Room }>('spaces', 'get', { roomId }),
    staleTime: 5_000,
    refetchInterval: 8_000,
  });
  const room = roomData?.room;
  const isHost = !!room && room.hostUserId === selfUserId;
  const isSpeaker = !!room && (room.speakers || []).some(s => s.user_id === selfUserId);
  const myHandUp  = !!room && (room.handsRaised || []).some(h => h.user_id === selfUserId);

  // Keep local UI in sync with server hand state.
  useEffect(() => { setHandRaised(myHandUp); }, [myHandUp]);

  // ── Mutations ───────────────────────────────────────────────────────
  const raiseMut = useMutation({
    mutationFn: async () => runMacro<{ ok: boolean }>('spaces', 'raise_hand', { roomId }),
    onSuccess: () => { setHandRaised(true); refetchRoom(); },
  });
  const promoteMut = useMutation({
    mutationFn: async (userId: string) => runMacro<{ ok: boolean }>('spaces', 'promote', { roomId, userId, role: 'speaker' }),
    onSuccess: () => refetchRoom(),
  });
  const endMut = useMutation({
    mutationFn: async () => runMacro<{ ok: boolean }>('spaces', 'end', { roomId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['spaces-active'] });
      onClose();
    },
  });
  const leaveServerMut = useMutation({
    mutationFn: async () => runMacro<{ ok: boolean }>('spaces', 'leave', { roomId }),
  });

  // ── WebRTC peer management ─────────────────────────────────────────
  const cleanupPeer = useCallback((peerId: string) => {
    const p = peersRef.current.get(peerId);
    if (!p) return;
    try { p.pc.close(); } catch { /* */ }
    try { p.gain.disconnect(); } catch { /* */ }
    try { p.analyser.disconnect(); } catch { /* */ }
    peersRef.current.delete(peerId);
    setPeerIds(prev => prev.filter(id => id !== peerId));
  }, []);

  const createPeer = useCallback((peerId: string, isOfferer: boolean): PeerInfo | null => {
    const ctx = audioCtxRef.current;
    if (!ctx || !masterGainRef.current) return null;
    if (peersRef.current.has(peerId)) return peersRef.current.get(peerId)!;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const gain = ctx.createGain();
    gain.gain.value = 1.0;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    gain.connect(masterGainRef.current);

    pc.ontrack = (ev) => {
      const stream = ev.streams[0];
      if (!stream) return;
      const src = ctx.createMediaStreamSource(stream);
      src.connect(gain);
      src.connect(analyser);
    };
    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        emit('audio-room:ice-candidate', { to: peerId, candidate: ev.candidate.toJSON(), roomId });
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') cleanupPeer(peerId);
    };

    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getAudioTracks()) {
        pc.addTrack(track, localStreamRef.current);
      }
    }

    const peer: PeerInfo = { peerId, pc, gain, analyser };
    peersRef.current.set(peerId, peer);
    setPeerIds(prev => [...prev, peerId]);

    if (isOfferer) {
      (async () => {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          emit('audio-room:offer', { to: peerId, sdp: pc.localDescription, roomId });
        } catch (err) { console.warn('[RoomStage] offer failed', err); }
      })();
    }
    return peer;
  }, [cleanupPeer, roomId]);

  const handleRemoteOffer = useCallback(async (from: string, sdp: RTCSessionDescriptionInit) => {
    const peer = createPeer(from, false);
    if (!peer) return;
    try {
      await peer.pc.setRemoteDescription(sdp);
      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);
      emit('audio-room:answer', { to: from, sdp: peer.pc.localDescription, roomId });
    } catch (err) { console.warn('[RoomStage] answer failed', err); }
  }, [createPeer, roomId]);

  const handleRemoteAnswer = useCallback(async (from: string, sdp: RTCSessionDescriptionInit) => {
    const peer = peersRef.current.get(from);
    if (!peer) return;
    try { await peer.pc.setRemoteDescription(sdp); } catch { /* */ }
  }, []);

  const handleRemoteIce = useCallback(async (from: string, candidate: RTCIceCandidateInit) => {
    const peer = peersRef.current.get(from);
    if (!peer) return;
    try { await peer.pc.addIceCandidate(candidate); } catch { /* late ICE */ }
  }, []);

  // ── Mount: getUserMedia + audio-room:join ──────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ctx = new (window.AudioContext || (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext!)();
        const master = ctx.createGain();
        master.connect(ctx.destination);
        audioCtxRef.current = ctx;
        masterGainRef.current = master;

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        localStreamRef.current = stream;
        // Default: mic OFF until user unmutes. Listeners stay muted always
        // (server will refuse their audio anyway via the peer mesh).
        stream.getAudioTracks().forEach(t => { t.enabled = false; });

        // Wait for socket connection then join the room-stage.
        const sock = getSocket();
        const joinFn = () => emit('audio-room:join', { roomId });
        if (sock.connected) joinFn(); else sock.once('connect', joinFn);
        setJoinedMesh(true);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Microphone access denied');
      }
    })();

    return () => {
      cancelled = true;
      try { emit('audio-room:leave', { roomId }); } catch { /* */ }
      for (const id of Array.from(peersRef.current.keys())) cleanupPeer(id);
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(t => t.stop());
        localStreamRef.current = null;
      }
      if (masterGainRef.current) { try { masterGainRef.current.disconnect(); } catch { /* */ } masterGainRef.current = null; }
      if (audioCtxRef.current) { try { audioCtxRef.current.close(); } catch { /* */ } audioCtxRef.current = null; }
      // Best-effort backend cleanup. Ignore errors — backend will GC
      // listeners on room end / connection drop anyway.
      try { leaveServerMut.mutate(); } catch { /* */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, cleanupPeer]);

  // ── Subscribe to signaling events ──────────────────────────────────
  useEffect(() => {
    if (!joinedMesh) return;
    const offs: Array<() => void> = [];
    offs.push(subscribe('audio-room:room-state', (p: unknown) => {
      const ev = p as { roomId: string; peers: string[] };
      if (ev.roomId !== roomId) return;
      for (const pid of ev.peers) createPeer(pid, true);
    }));
    offs.push(subscribe('audio-room:peer-joined', (p: unknown) => {
      const ev = p as { roomId: string; peerId: string };
      if (ev.roomId !== roomId) return;
      // The arriving peer is responsible for offering to existing peers
      // via room-state; we wait for their offer to land. No-op here.
    }));
    offs.push(subscribe('audio-room:peer-left', (p: unknown) => {
      const ev = p as { roomId: string; peerId: string };
      if (ev.roomId !== roomId) return;
      cleanupPeer(ev.peerId);
    }));
    offs.push(subscribe('audio-room:offer', (p: unknown) => {
      const ev = p as { roomId: string; from: string; sdp: RTCSessionDescriptionInit };
      if (ev.roomId && ev.roomId !== roomId) return;
      handleRemoteOffer(ev.from, ev.sdp);
    }));
    offs.push(subscribe('audio-room:answer', (p: unknown) => {
      const ev = p as { roomId: string; from: string; sdp: RTCSessionDescriptionInit };
      if (ev.roomId && ev.roomId !== roomId) return;
      handleRemoteAnswer(ev.from, ev.sdp);
    }));
    offs.push(subscribe('audio-room:ice-candidate', (p: unknown) => {
      const ev = p as { roomId: string; from: string; candidate: RTCIceCandidateInit };
      if (ev.roomId && ev.roomId !== roomId) return;
      handleRemoteIce(ev.from, ev.candidate);
    }));
    return () => { for (const off of offs) off(); };
  }, [joinedMesh, roomId, createPeer, cleanupPeer, handleRemoteOffer, handleRemoteAnswer, handleRemoteIce]);

  // RMS sampling for speaking indicators.
  useEffect(() => {
    if (!joinedMesh) return;
    const arr = new Uint8Array(128);
    let raf = 0;
    const loop = () => {
      let dirty = false;
      for (const [id, peer] of peersRef.current) {
        peer.analyser.getByteFrequencyData(arr);
        let sum = 0;
        for (let i = 0; i < arr.length; i++) sum += arr[i];
        const rms = sum / arr.length / 255;
        const next = rms > 0.04 ? rms : 0;
        if (Math.abs((speakLevelsRef.current.get(id) ?? 0) - next) > 0.02) {
          speakLevelsRef.current.set(id, next);
          dirty = true;
        }
      }
      if (dirty) forceTick(t => t + 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [joinedMesh]);

  // Apply mute to outbound track. Non-speakers stay muted always.
  useEffect(() => {
    if (!localStreamRef.current) return;
    const allowed = isSpeaker && !muted;
    localStreamRef.current.getAudioTracks().forEach(t => { t.enabled = allowed; });
  }, [muted, isSpeaker]);

  const close = useCallback(() => { onClose(); }, [onClose]);

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/70 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Audio room">
      <div className="relative w-full sm:max-w-2xl bg-zinc-950 border border-zinc-800 sm:rounded-2xl shadow-2xl overflow-hidden">
        <header className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-zinc-900/60">
          <Radio className="w-4 h-4 text-rose-300 animate-pulse" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-zinc-100 truncate">{room?.title || 'Live room'}</h2>
            {room && (
              <p className="text-[10px] text-zinc-500 flex items-center gap-2">
                <span className="inline-flex items-center gap-0.5"><Mic className="w-2.5 h-2.5" /> {room.speakers?.length || 0}</span>
                <span className="inline-flex items-center gap-0.5"><Users className="w-2.5 h-2.5" /> {room.listenerCount}</span>
                {room.isRecording && <span className="text-rose-300">REC</span>}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={close}
            className="p-1 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {error && (
          <div className="mx-4 mt-3 px-3 py-2 rounded border border-rose-500/40 bg-rose-500/10 text-xs text-rose-200">
            {error}
          </div>
        )}

        {!room && (
          <div className="p-8 flex items-center justify-center text-zinc-500">
            <Loader2 className="w-4 h-4 animate-spin" />
          </div>
        )}

        {room && (
          <>
            {/* Speakers */}
            <section className="px-4 pt-4">
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">Speakers · {room.speakers.length}</h3>
              <ul className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                {room.speakers.map(s => {
                  const isMe = s.user_id === selfUserId;
                  const speaking = !isMe && Array.from(speakLevelsRef.current.values()).some(v => v > 0.05);
                  return (
                    <li key={s.user_id} className="flex flex-col items-center gap-1">
                      <div className={cn(
                        'relative w-14 h-14 rounded-full bg-gradient-to-br from-rose-500/30 to-amber-500/20 ring-2 flex items-center justify-center text-xs font-semibold text-zinc-100',
                        speaking ? 'ring-emerald-400 shadow-[0_0_18px_0px] shadow-emerald-400/50' : 'ring-zinc-700',
                      )}>
                        {(s.user_id || '?').slice(0, 2).toUpperCase()}
                        {s.role === 'host' && <ShieldCheck className="absolute -bottom-1 -right-1 w-4 h-4 text-amber-300 bg-zinc-950 rounded-full" />}
                      </div>
                      <UserLink userId={s.user_id} prefix="@" className="text-[10px] max-w-[80px] truncate" />
                      <span className="text-[9px] uppercase text-zinc-600">{s.role}</span>
                    </li>
                  );
                })}
                {room.speakers.length === 0 && (
                  <li className="col-span-full text-xs text-zinc-500 text-center py-4">No speakers yet</li>
                )}
              </ul>
            </section>

            {/* Hands raised (host can promote) */}
            {room.handsRaised.length > 0 && (
              <section className="px-4 pt-4">
                <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                  ✋ Hands raised · {room.handsRaised.length}
                </h3>
                <ul className="space-y-1.5">
                  {room.handsRaised.map(h => (
                    <li key={h.user_id} className="flex items-center gap-2 text-xs px-2 py-1 bg-amber-500/10 border border-amber-500/30 rounded">
                      <Hand className="w-3 h-3 text-amber-300" />
                      <UserLink userId={h.user_id} prefix="@" className="flex-1 text-xs" />
                      {isHost && (
                        <button
                          type="button"
                          onClick={() => promoteMut.mutate(h.user_id)}
                          disabled={promoteMut.isPending}
                          className="text-[10px] px-2 py-0.5 rounded bg-amber-600/40 hover:bg-amber-600/60 text-amber-100 border border-amber-500/60 disabled:opacity-40"
                        >
                          {promoteMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Promote'}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Listeners count (no avatars — privacy) */}
            <section className="px-4 pt-4 pb-4">
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1">Listeners · {room.listenerCount}</h3>
              <p className="text-[10px] text-zinc-500">{room.listenerCount} silent listener{room.listenerCount === 1 ? '' : 's'}</p>
            </section>

            {/* Footer controls */}
            <footer className="px-4 py-3 border-t border-zinc-800 bg-zinc-900/40 flex items-center gap-3">
              {isSpeaker ? (
                <button
                  type="button"
                  onClick={() => setMuted(m => !m)}
                  className={cn(
                    'inline-flex items-center gap-2 px-3 py-2 rounded-full border font-medium transition-colors',
                    muted
                      ? 'border-zinc-700 text-zinc-300 bg-zinc-900 hover:border-zinc-500'
                      : 'border-emerald-500/60 text-emerald-200 bg-emerald-500/15',
                  )}
                  title={muted ? 'Unmute' : 'Mute'}
                >
                  {muted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                  <span className="text-xs">{muted ? 'Muted' : 'Live'}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => raiseMut.mutate()}
                  disabled={handRaised || raiseMut.isPending}
                  className={cn(
                    'inline-flex items-center gap-2 px-3 py-2 rounded-full border font-medium transition-colors',
                    handRaised
                      ? 'border-amber-500/60 text-amber-200 bg-amber-500/15 cursor-default'
                      : 'border-zinc-700 text-zinc-300 bg-zinc-900 hover:border-amber-500/60',
                    'disabled:opacity-60',
                  )}
                >
                  <Hand className="w-4 h-4" />
                  <span className="text-xs">{handRaised ? 'Hand up' : 'Raise hand'}</span>
                </button>
              )}

              <span className="flex-1 text-[10px] text-zinc-500">
                {peersRef.current.size} peer mesh connection{peersRef.current.size === 1 ? '' : 's'}
              </span>

              {isHost && (
                <button
                  type="button"
                  onClick={() => endMut.mutate()}
                  disabled={endMut.isPending}
                  className="inline-flex items-center gap-1 px-3 py-2 rounded-full bg-rose-700/50 hover:bg-rose-700/70 text-rose-100 border border-rose-500/60 text-xs disabled:opacity-40"
                >
                  {endMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'End room'}
                </button>
              )}

              <button
                type="button"
                onClick={close}
                className="inline-flex items-center gap-1 px-3 py-2 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-xs"
              >
                <PhoneOff className="w-4 h-4" />
                Leave
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}

export default RoomStage;
