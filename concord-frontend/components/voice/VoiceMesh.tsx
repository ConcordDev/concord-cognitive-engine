'use client';

/**
 * VoiceMesh — Phase X multi-party WebRTC voice chat (~8 peer cap).
 *
 * Distinct from VoiceChat.tsx (the 1:1 NPC dialogue panel). This is
 * for player-to-player group voice chat.
 *
 * Architecture:
 *   1. On mount: voice_chat.join(roomId) + voice_chat.room_state to
 *      enumerate current peers; for each existing peer, create an
 *      RTCPeerConnection + send offer via voice_chat.offer macro.
 *   2. Subscribe to voice:offer / voice:answer / voice:ice /
 *      voice:participant-joined / voice:participant-left events.
 *      voice:participant-joined → also create RTCPeerConnection +
 *      offer (so late arrivals get connected automatically).
 *   3. Each remote peer's incoming MediaStream goes through:
 *        AudioContext.createMediaStreamSource → per-peer GainNode
 *        (default 1.0) → master GainNode → audioCtx.destination.
 *   4. AnalyserNode RMS per peer drives the speaking-indicator dot.
 *   5. Spacebar push-to-talk toggles the outbound MediaStreamTrack;
 *      continuous mode toggle in panel settings keeps the track
 *      always-on.
 *   6. On unmount or voice:leave: close every peer connection +
 *      voice_chat.leave_room.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, MicOff, Volume2, PhoneOff, Users } from 'lucide-react';
import { subscribe } from '@/lib/realtime/socket';

interface PeerInfo {
  userId: string;
  pc: RTCPeerConnection;
  /** Per-peer gain (mute toggle + volume slider). */
  gain: GainNode;
  /** RMS analyser for speaking indicator. */
  analyser: AnalyserNode;
  /** Latest RMS sample 0..1. */
  speakingLevel: number;
}

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
];

async function runMacro<T>(domain: string, name: string, input: Record<string, unknown> = {}): Promise<T | null> {
  const r = await fetch('/api/lens/run', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain, name, input }),
  });
  if (!r.ok) return null;
  const json = await r.json();
  return (json?.result ?? json) as T;
}

export function VoiceMesh({ roomId, selfUserId }: { roomId: string; selfUserId: string }) {
  const [joined, setJoined]       = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [peerIds, setPeerIds]     = useState<string[]>([]);
  const [muted, setMuted]         = useState(false);
  const [pttMode, setPttMode]     = useState(true);
  const [pttHeld, setPttHeld]     = useState(false);

  // Refs survive renders; React state drives UI.
  const audioCtxRef    = useRef<AudioContext | null>(null);
  const masterGainRef  = useRef<GainNode | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef       = useRef<Map<string, PeerInfo>>(new Map());
  const speakLevelsRef = useRef<Map<string, number>>(new Map());
  const [, forceTick]  = useState(0);

  const cleanupPeer = useCallback((peerId: string) => {
    const p = peersRef.current.get(peerId);
    if (!p) return;
    try { p.pc.close(); } catch { /* ignore */ }
    try { p.gain.disconnect(); } catch { /* ignore */ }
    try { p.analyser.disconnect(); } catch { /* ignore */ }
    peersRef.current.delete(peerId);
    setPeerIds((prev) => prev.filter((id) => id !== peerId));
  }, []);

  const createPeer = useCallback((peerId: string, isOfferer: boolean) => {
    if (peersRef.current.has(peerId)) return peersRef.current.get(peerId)!;
    const ctx = audioCtxRef.current!;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const gain = ctx.createGain();
    gain.gain.value = 1.0;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    gain.connect(masterGainRef.current!);

    pc.ontrack = (ev) => {
      const stream = ev.streams[0];
      if (!stream) return;
      const src = ctx.createMediaStreamSource(stream);
      src.connect(gain);
      src.connect(analyser);
    };
    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        runMacro('voice_chat', 'ice', { targetUserId: peerId, candidate: ev.candidate.toJSON() });
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        cleanupPeer(peerId);
      }
    };

    // Push our local audio track(s) to the peer.
    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getAudioTracks()) {
        pc.addTrack(track, localStreamRef.current);
      }
    }

    const peer: PeerInfo = { userId: peerId, pc, gain, analyser, speakingLevel: 0 };
    peersRef.current.set(peerId, peer);
    setPeerIds((prev) => [...prev, peerId]);

    if (isOfferer) {
      (async () => {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          await runMacro('voice_chat', 'offer', { targetUserId: peerId, sdp: pc.localDescription });
        } catch (err) {
          console.warn('[VoiceMesh] offer failed', err);
        }
      })();
    }
    return peer;
  }, [cleanupPeer]);

  const handleRemoteOffer = useCallback(async (from: string, sdp: RTCSessionDescriptionInit) => {
    const peer = createPeer(from, false);
    try {
      await peer.pc.setRemoteDescription(sdp);
      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);
      await runMacro('voice_chat', 'answer', { targetUserId: from, sdp: peer.pc.localDescription });
    } catch (err) {
      console.warn('[VoiceMesh] answer failed', err);
    }
  }, [createPeer]);

  const handleRemoteAnswer = useCallback(async (from: string, sdp: RTCSessionDescriptionInit) => {
    const peer = peersRef.current.get(from);
    if (!peer) return;
    try { await peer.pc.setRemoteDescription(sdp); } catch (err) { console.warn('[VoiceMesh] setRemote(answer) failed', err); }
  }, []);

  const handleRemoteIce = useCallback(async (from: string, candidate: RTCIceCandidateInit) => {
    const peer = peersRef.current.get(from);
    if (!peer) return;
    try { await peer.pc.addIceCandidate(candidate); } catch { /* late ICE — ignore */ }
  }, []);

  const join = useCallback(async () => {
    setError(null);
    try {
      const ctx = new (window.AudioContext || (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext!)();
      audioCtxRef.current = ctx;
      const master = ctx.createGain();
      master.connect(ctx.destination);
      masterGainRef.current = master;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      localStreamRef.current = stream;
      // PTT default — start with mic disabled.
      stream.getAudioTracks().forEach((t) => { t.enabled = !pttMode; });

      const room = await runMacro<{ ok: boolean; peers: string[] }>('voice_chat', 'join', { roomId });
      const existing = (room?.peers || []).filter((id) => id !== selfUserId);
      for (const peerId of existing) createPeer(peerId, true);

      setJoined(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Microphone access denied');
    }
  }, [roomId, selfUserId, pttMode, createPeer]);

  const leave = useCallback(async () => {
    for (const id of Array.from(peersRef.current.keys())) cleanupPeer(id);
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (masterGainRef.current) { try { masterGainRef.current.disconnect(); } catch { /* */ } masterGainRef.current = null; }
    if (audioCtxRef.current) { try { await audioCtxRef.current.close(); } catch { /* */ } audioCtxRef.current = null; }
    await runMacro('voice_chat', 'leave_room', { roomId });
    setJoined(false);
  }, [roomId, cleanupPeer]);

  // Subscribe to socket signalling.
  useEffect(() => {
    if (!joined) return;
    const offs: Array<() => void> = [];
    offs.push(subscribe('voice:offer'  as Parameters<typeof subscribe>[0], (p: unknown) => { const { from, sdp } = p as { from: string; sdp: RTCSessionDescriptionInit }; handleRemoteOffer(from, sdp); }));
    offs.push(subscribe('voice:answer' as Parameters<typeof subscribe>[0], (p: unknown) => { const { from, sdp } = p as { from: string; sdp: RTCSessionDescriptionInit }; handleRemoteAnswer(from, sdp); }));
    offs.push(subscribe('voice:ice'    as Parameters<typeof subscribe>[0], (p: unknown) => { const { from, candidate } = p as { from: string; candidate: RTCIceCandidateInit }; handleRemoteIce(from, candidate); }));
    offs.push(subscribe('voice:participant-joined' as Parameters<typeof subscribe>[0], (p: unknown) => {
      const ev = p as { roomId: string; userId: string };
      if (ev.roomId !== roomId || ev.userId === selfUserId) return;
      createPeer(ev.userId, true); // we initiate the offer to the joiner
    }));
    offs.push(subscribe('voice:participant-left' as Parameters<typeof subscribe>[0], (p: unknown) => {
      const ev = p as { roomId: string; userId: string };
      if (ev.roomId !== roomId) return;
      cleanupPeer(ev.userId);
    }));
    return () => { for (const off of offs) off(); };
  }, [joined, roomId, selfUserId, handleRemoteOffer, handleRemoteAnswer, handleRemoteIce, createPeer, cleanupPeer]);

  // RMS sampling loop for the speaking indicator.
  useEffect(() => {
    if (!joined) return;
    const arr = new Uint8Array(128);
    let raf: number;
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
      if (dirty) forceTick((t) => t + 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [joined]);

  // PTT keyboard handler.
  useEffect(() => {
    if (!joined) return;
    function onDown(e: KeyboardEvent) { if (e.code === 'Space') { setPttHeld(true); } }
    function onUp(e: KeyboardEvent)   { if (e.code === 'Space') { setPttHeld(false); } }
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup',   onUp);
    return () => { window.removeEventListener('keydown', onDown); window.removeEventListener('keyup', onUp); };
  }, [joined]);

  // Apply mute / PTT to the outbound track.
  useEffect(() => {
    if (!localStreamRef.current) return;
    const enable = !muted && (pttMode ? pttHeld : true);
    localStreamRef.current.getAudioTracks().forEach((t) => { t.enabled = enable; });
  }, [muted, pttMode, pttHeld]);

  function setPeerVolume(peerId: string, v: number) {
    const p = peersRef.current.get(peerId);
    if (!p) return;
    p.gain.gain.value = Math.max(0, Math.min(2, v));
    forceTick((t) => t + 1);
  }
  function togglePeerMute(peerId: string) {
    const p = peersRef.current.get(peerId);
    if (!p) return;
    p.gain.gain.value = p.gain.gain.value > 0 ? 0 : 1;
    forceTick((t) => t + 1);
  }

  return (
    <div className="flex flex-col gap-3 p-4 bg-black/20 rounded-xl border border-white/10 min-w-[280px]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-white/80">
          <Users className="w-4 h-4 text-cyan-300" />
          Voice mesh · {peerIds.length + (joined ? 1 : 0)} {peerIds.length + (joined ? 1 : 0) === 1 ? 'peer' : 'peers'}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMuted((m) => !m)}
            disabled={!joined}
            className="text-white/40 hover:text-white/70 disabled:opacity-30"
            title={muted ? 'Unmute self' : 'Mute self'}
          >
            {muted ? <MicOff className="w-4 h-4 text-rose-300" /> : <Mic className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={() => setPttMode((m) => !m)}
            disabled={!joined}
            className={`text-xs px-2 py-1 rounded border ${pttMode ? 'border-cyan-500/40 text-cyan-200' : 'border-white/10 text-white/40'} disabled:opacity-30`}
            title="Push-to-talk vs continuous"
          >
            {pttMode ? 'PTT' : 'CONT'}
          </button>
        </div>
      </div>

      {!joined && (
        <button
          type="button"
          onClick={join}
          className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-sm rounded-lg"
        >
          <Mic className="w-4 h-4" />
          Join voice room
        </button>
      )}

      {joined && (
        <>
          <ul className="space-y-1.5">
            {peerIds.map((id) => {
              const lvl = speakLevelsRef.current.get(id) ?? 0;
              return (
                <li key={id} className="flex items-center gap-2 text-xs">
                  <span className={`inline-block w-2 h-2 rounded-full ${lvl > 0.05 ? 'bg-emerald-400' : 'bg-white/20'}`} />
                  <span className="flex-1 truncate text-white/70">{id}</span>
                  <Volume2 className="w-3 h-3 text-white/30" />
                  <input
                    type="range" min={0} max={2} step={0.1}
                    defaultValue={1}
                    onChange={(e) => setPeerVolume(id, parseFloat(e.target.value))}
                    className="w-20 accent-cyan-500"
                  />
                  <button type="button" onClick={() => togglePeerMute(id)} className="text-white/40 hover:text-rose-300" title="Mute peer">
                    <MicOff className="w-3 h-3" />
                  </button>
                </li>
              );
            })}
            {peerIds.length === 0 && <li className="text-xs text-white/30">No other peers yet…</li>}
          </ul>

          {pttMode && (
            <p className="text-[10px] text-white/30">Hold Space to talk · self mic {pttHeld ? 'live' : 'mute'}</p>
          )}

          <button
            type="button"
            onClick={leave}
            className="flex items-center justify-center gap-2 px-3 py-2 bg-rose-600/80 hover:bg-rose-600 text-white text-sm rounded"
          >
            <PhoneOff className="w-4 h-4" />
            Leave room
          </button>
        </>
      )}

      {error && <p className="text-xs text-rose-300">{error}</p>}
    </div>
  );
}

export default VoiceMesh;
