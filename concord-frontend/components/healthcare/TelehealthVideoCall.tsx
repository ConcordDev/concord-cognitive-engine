'use client';

/**
 * TelehealthVideoCall — in-lens WebRTC video tile for a telehealth visit.
 *
 * Uses `simple-peer` for the WebRTC plumbing and Concord's existing
 * Socket.IO connection for signalling (handlers in
 * `server/lib/webrtc-signalling.js`). Supports multi-party visits
 * (patient + provider + optional consult specialist, family member, or
 * interpreter) via a `Map<peerId, SimplePeer>` — one peer connection per
 * remote participant, each tile rendered separately.
 *
 * Media: local camera + microphone via getUserMedia. The user is asked
 * for permission on mount; until then no media stream is acquired.
 * The local tile shows a self-view; each remote tile fills in once a
 * peer joins + ICE negotiation completes.
 *
 * Tear-down is rigorous: on unmount or `End call` we stop every local
 * track, destroy every peer connection, and emit `webrtc:leave` so the
 * other side tears down cleanly too.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { Video, VideoOff, Mic, MicOff, PhoneOff, Loader2, AlertCircle, Users } from 'lucide-react';
import type { Socket } from 'socket.io-client';
import SimplePeer from 'simple-peer';

interface Props {
  visitId: string;
  initiator?: boolean;  // true for the provider, false for the patient
  onEnd: () => void;
}

interface RemoteTile {
  peerId: string;
  stream: MediaStream | null;
  state: 'connecting' | 'live' | 'closed' | 'error';
}

export function TelehealthVideoCall({ visitId, initiator = false, onEnd }: Props) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  // Map keyed by peerId so re-renders see new tiles arrive/leave.
  const [remotes, setRemotes] = useState<Map<string, RemoteTile>>(new Map());
  const [status, setStatus] = useState<'idle' | 'connecting' | 'live' | 'ended' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [cameraOn, setCameraOn] = useState(true);
  const [micOn, setMicOn] = useState(true);

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  // peerId → SimplePeer; one connection per remote participant.
  const peersRef = useRef<Map<string, SimplePeer.Instance>>(new Map());
  const socketRef = useRef<Socket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  // ── Start the call: acquire media + open socket + signalling ─────────────
  const start = useCallback(async () => {
    if (status !== 'idle') return;
    setStatus('connecting');
    setError(null);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch {
      setStatus('error');
      setError('Camera + microphone permission required for video visits.');
      return;
    }
    setLocalStream(stream);
    localStreamRef.current = stream;
    if (localVideoRef.current) localVideoRef.current.srcObject = stream;

    // Fetch the dynamic ICE-server config from the backend. Includes the
    // STUN baseline always, plus Cloudflare TURN credentials (short-lived)
    // when CF_TURN_KEY_ID is set server-side. TURN is what makes calls
    // succeed for users behind strict NAT / corporate firewalls where
    // direct peer-to-peer can't connect. If the fetch fails for any
    // reason we still build peers with the STUN-only baseline; users
    // behind permissive NAT will still connect.
    type IceServersResponse = { ok: boolean; iceServers?: RTCIceServer[]; source?: string };
    let iceServers: RTCIceServer[] = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ];
    try {
      const r = await fetch('/api/webrtc/ice-servers');
      if (r.ok) {
        const data = (await r.json()) as IceServersResponse;
        if (Array.isArray(data.iceServers) && data.iceServers.length > 0) {
          iceServers = data.iceServers;
        }
      }
    } catch { /* fall back to STUN baseline above */ }

    let socket: Socket;
    try {
      const { io } = await import('socket.io-client');
      socket = io({ path: '/socket.io', transports: ['websocket', 'polling'], reconnection: true });
    } catch {
      setStatus('error');
      setError('Realtime connection unavailable. Try refreshing.');
      return;
    }
    socketRef.current = socket;

    // Build a peer connection for a specific remote participant. Each
    // remote gets its own SimplePeer instance; signalling messages
    // route via the explicit `target` field so a 3-way (or N-way) call
    // doesn't cross-talk.
    const buildPeer = (peerId: string, isInitiator: boolean) => {
      const existing = peersRef.current.get(peerId);
      if (existing) return existing;
      // Seed a tile immediately so the user sees a "connecting" slot
      // even before ICE completes.
      setRemotes(prev => {
        const next = new Map(prev);
        next.set(peerId, { peerId, stream: null, state: 'connecting' });
        return next;
      });
      const peer = new SimplePeer({
        initiator: isInitiator,
        trickle: true,
        stream,
        config: { iceServers: iceServers as unknown as Array<{ urls: string | string[] }> },
      });
      peer.on('signal', (data: SimplePeer.SignalData) => {
        if ('sdp' in data && data.sdp) {
          const event = data.type === 'offer' ? 'webrtc:offer' : 'webrtc:answer';
          socket.emit(event, { visitId, sdp: data, target: peerId });
        } else if ('candidate' in data) {
          socket.emit('webrtc:ice', { visitId, candidate: data, target: peerId });
        }
      });
      peer.on('stream', (remote: MediaStream) => {
        setRemotes(prev => {
          const next = new Map(prev);
          const existing = next.get(peerId);
          next.set(peerId, {
            peerId,
            stream: remote,
            state: 'live',
          });
          void existing;
          return next;
        });
        setStatus('live');
      });
      peer.on('connect', () => {
        setRemotes(prev => {
          const next = new Map(prev);
          const t = next.get(peerId);
          if (t && t.state !== 'live') next.set(peerId, { ...t, state: 'live' });
          return next;
        });
        setStatus('live');
      });
      peer.on('error', (err: Error) => {
        setRemotes(prev => {
          const next = new Map(prev);
          const t = next.get(peerId);
          if (t) next.set(peerId, { ...t, state: 'error' });
          return next;
        });
        // Don't blow up the whole call on a single peer error; just
        // surface the latest error message.
        setError(`Peer ${peerId.slice(0, 6)} error: ${err.message}`);
      });
      peer.on('close', () => {
        setRemotes(prev => {
          const next = new Map(prev);
          next.delete(peerId);
          return next;
        });
        peersRef.current.delete(peerId);
        // If every peer has left, the call is over.
        if (peersRef.current.size === 0) setStatus('ended');
      });
      peersRef.current.set(peerId, peer);
      return peer;
    };

    socket.on('connect', () => {
      socket.emit('webrtc:join', { visitId });
    });

    socket.on('webrtc:peer-list', ({ peers }: { peers: string[] }) => {
      // Open offers to every existing peer in the room. Whichever side
      // joined first is the "initiator" for each pairwise connection;
      // here we initiate to everyone already present.
      for (const peerId of peers) buildPeer(peerId, true);
    });
    socket.on('webrtc:peer-joined', ({ peerId }: { peerId: string }) => {
      // A new peer arrived after us. We are NOT the initiator for them
      // — they will send the offer (their `webrtc:peer-list` includes
      // us). Pre-seed the tile so the UI shows a connecting slot.
      setRemotes(prev => {
        if (prev.has(peerId)) return prev;
        const next = new Map(prev);
        next.set(peerId, { peerId, stream: null, state: 'connecting' });
        return next;
      });
    });
    socket.on('webrtc:offer', ({ sdp, fromPeerId }: { sdp: SimplePeer.SignalData; fromPeerId: string }) => {
      // Build (as non-initiator) the peer entry for whoever sent us the
      // offer, then feed them the SDP.
      const peer = peersRef.current.get(fromPeerId) || buildPeer(fromPeerId, false);
      try { peer.signal(sdp); } catch { /* ignore */ }
    });
    socket.on('webrtc:answer', ({ sdp, fromPeerId }: { sdp: SimplePeer.SignalData; fromPeerId: string }) => {
      const peer = peersRef.current.get(fromPeerId);
      try { peer?.signal(sdp); } catch { /* ignore */ }
    });
    socket.on('webrtc:ice', ({ candidate, fromPeerId }: { candidate: SimplePeer.SignalData; fromPeerId: string }) => {
      const peer = peersRef.current.get(fromPeerId);
      try { peer?.signal(candidate); } catch { /* ignore */ }
    });
    socket.on('webrtc:peer-left', ({ peerId }: { peerId: string }) => {
      const peer = peersRef.current.get(peerId);
      try { peer?.destroy(); } catch { /* ignore */ }
      peersRef.current.delete(peerId);
      setRemotes(prev => {
        const next = new Map(prev);
        next.delete(peerId);
        return next;
      });
      if (peersRef.current.size === 0) setStatus('ended');
    });
  }, [visitId, status]);

  // ── End the call ─────────────────────────────────────────────────────────
  const endCall = useCallback(() => {
    try {
      socketRef.current?.emit('webrtc:leave', { visitId });
      socketRef.current?.disconnect();
    } catch { /* ignore */ }
    for (const peer of peersRef.current.values()) {
      try { peer.destroy(); } catch { /* ignore */ }
    }
    peersRef.current.clear();
    try {
      localStreamRef.current?.getTracks().forEach(t => t.stop());
    } catch { /* ignore */ }
    socketRef.current = null;
    localStreamRef.current = null;
    setLocalStream(null);
    setRemotes(new Map());
    setStatus('ended');
    onEnd();
  }, [visitId, onEnd]);

  // Auto-start once on mount.
  useEffect(() => {
    // Capture the stable peers Map so the cleanup doesn't read a possibly-changed
    // ref.current (the Map identity is fixed for the component's life).
    const peers = peersRef.current;
    void start();
    return () => {
      // Tear down on unmount.
      try { socketRef.current?.emit('webrtc:leave', { visitId }); } catch { /* ignore */ }
      try { socketRef.current?.disconnect(); } catch { /* ignore */ }
      for (const peer of peers.values()) {
        try { peer.destroy(); } catch { /* ignore */ }
      }
      peers.clear();
      try { localStreamRef.current?.getTracks().forEach(t => t.stop()); } catch { /* ignore */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Camera / mic toggles ─────────────────────────────────────────────────
  // Toggle the local track enabled flag — every remote peer is sharing
  // the same MediaStream, so muting once propagates to all of them.
  const toggleCamera = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !cameraOn;
    stream.getVideoTracks().forEach(t => { t.enabled = next; });
    setCameraOn(next);
  }, [cameraOn]);
  const toggleMic = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !micOn;
    stream.getAudioTracks().forEach(t => { t.enabled = next; });
    setMicOn(next);
  }, [micOn]);

  return (
    <div className="rounded-lg border border-zinc-800 bg-black p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Video className="w-4 h-4 text-emerald-400" />
        <h3 className="text-sm font-medium text-zinc-200">Video visit</h3>
        <span className={`ml-auto text-[10px] px-2 py-0.5 rounded-full ${
          status === 'live' ? 'bg-emerald-500/20 text-emerald-300' :
          status === 'connecting' ? 'bg-amber-500/20 text-amber-300' :
          status === 'error' ? 'bg-rose-500/20 text-rose-300' :
          status === 'ended' ? 'bg-zinc-500/20 text-zinc-400' :
          'bg-zinc-600/20 text-zinc-400'
        }`}>
          {status === 'live' ? 'Live' :
           status === 'connecting' ? 'Connecting…' :
           status === 'error' ? 'Error' :
           status === 'ended' ? 'Ended' :
           'Idle'}
        </span>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded border border-rose-500/30 bg-rose-500/10 p-2 text-xs text-rose-300">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Tile grid — local self-view first, then one tile per remote
          participant. Layout adapts from 2-up (1:1 call) to 3+-up (multi-
          party) using a responsive auto-grid. */}
      <div className={`grid gap-3 ${
        remotes.size <= 1 ? 'grid-cols-1 md:grid-cols-2' :
        remotes.size === 2 ? 'grid-cols-1 md:grid-cols-3' :
        'grid-cols-2 md:grid-cols-3 lg:grid-cols-4'
      }`}>
        <div className="relative aspect-video rounded-lg bg-zinc-950 overflow-hidden">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
          {!localStream && (
            <div className="absolute inset-0 flex items-center justify-center text-zinc-400 text-xs">
              {status === 'connecting' ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Requesting camera…</> : '—'}
            </div>
          )}
          <p className="absolute bottom-1 left-2 text-[10px] text-zinc-300 bg-black/40 px-1.5 py-0.5 rounded">You</p>
        </div>
        {Array.from(remotes.values()).map(tile => (
          <RemoteTile key={tile.peerId} tile={tile} />
        ))}
        {remotes.size === 0 && (
          <div className="relative aspect-video rounded-lg bg-zinc-950 overflow-hidden">
            <div className="absolute inset-0 flex items-center justify-center text-zinc-400 text-xs">
              <Loader2 className="w-4 h-4 animate-spin mr-2" /> Waiting for other participants…
            </div>
            <p className="absolute bottom-1 left-2 text-[10px] text-zinc-300 bg-black/40 px-1.5 py-0.5 rounded">
              {initiator ? 'Patient' : 'Provider'}
            </p>
          </div>
        )}
      </div>
      {remotes.size > 1 && (
        <p className="text-[10px] text-zinc-400 flex items-center gap-1.5">
          <Users className="w-3 h-3" /> {remotes.size + 1}-way visit · all peers connected mesh-style (no SFU)
        </p>
      )}

      <div className="flex items-center justify-center gap-3 pt-1">
        <button
          type="button"
          onClick={toggleCamera}
          disabled={!localStream}
          className={`p-2 rounded-full border ${
            cameraOn ? 'border-zinc-700 bg-zinc-900 text-zinc-200' : 'border-rose-500/40 bg-rose-500/20 text-rose-300'
          } disabled:opacity-40`}
          aria-label={cameraOn ? 'Turn camera off' : 'Turn camera on'}
        >
          {cameraOn ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
        </button>
        <button
          type="button"
          onClick={toggleMic}
          disabled={!localStream}
          className={`p-2 rounded-full border ${
            micOn ? 'border-zinc-700 bg-zinc-900 text-zinc-200' : 'border-rose-500/40 bg-rose-500/20 text-rose-300'
          } disabled:opacity-40`}
          aria-label={micOn ? 'Mute' : 'Unmute'}
        >
          {micOn ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
        </button>
        <button
          type="button"
          onClick={endCall}
          className="flex items-center gap-1.5 px-3 py-2 rounded-full border border-rose-500/40 bg-rose-500/20 text-rose-300 hover:bg-rose-500/30"
        >
          <PhoneOff className="w-4 h-4" /> End call
        </button>
      </div>
    </div>
  );
}

// Per-remote-participant tile. Uses a private <video> element so each
// stream binds to its own DOM node — sharing a single ref across N
// streams overwrites srcObject and shows only the last-attached one.
function RemoteTile({ tile }: { tile: RemoteTile }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (videoRef.current && tile.stream) {
      videoRef.current.srcObject = tile.stream;
    }
  }, [tile.stream]);
  return (
    <div className="relative aspect-video rounded-lg bg-zinc-950 overflow-hidden">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="w-full h-full object-cover"
      />
      {!tile.stream && (
        <div className="absolute inset-0 flex items-center justify-center text-zinc-400 text-xs">
          {tile.state === 'error' ? 'Connection error' : (
            <><Loader2 className="w-4 h-4 animate-spin mr-2" />Connecting…</>
          )}
        </div>
      )}
      <p className="absolute bottom-1 left-2 text-[10px] text-zinc-300 bg-black/40 px-1.5 py-0.5 rounded font-mono">
        peer · {tile.peerId.slice(0, 6)}
      </p>
    </div>
  );
}
