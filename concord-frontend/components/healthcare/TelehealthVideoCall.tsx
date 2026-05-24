'use client';

/**
 * TelehealthVideoCall — in-lens WebRTC video tile for a telehealth visit.
 *
 * Uses `simple-peer` for the WebRTC plumbing and Concord's existing
 * Socket.IO connection for signalling (handlers in
 * `server/lib/webrtc-signalling.js`). 1:1 calls today (patient ↔
 * provider); multi-party is straightforward to extend by keeping a
 * Map<peerId, SimplePeer> instead of a single peer ref.
 *
 * Media: local camera + microphone via getUserMedia. The user is asked
 * for permission on `Start call`; until then no media stream is acquired.
 * The local tile shows a self-view; the remote tile fills in once the
 * other party joins + ICE negotiation completes.
 *
 * Tear-down is rigorous: on unmount or `End call` we stop every local
 * track, destroy the peer connection, and emit `webrtc:leave` so the
 * other side tears down cleanly too.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { Video, VideoOff, Mic, MicOff, PhoneOff, Loader2, AlertCircle } from 'lucide-react';
import type { Socket } from 'socket.io-client';
import SimplePeer from 'simple-peer';

interface Props {
  visitId: string;
  initiator?: boolean;  // true for the provider, false for the patient
  onEnd: () => void;
}

export function TelehealthVideoCall({ visitId, initiator = false, onEnd }: Props) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'live' | 'ended' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [cameraOn, setCameraOn] = useState(true);
  const [micOn, setMicOn] = useState(true);

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const peerRef = useRef<SimplePeer.Instance | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const targetPeerIdRef = useRef<string | null>(null);

  // ── Start the call: acquire media + open socket + signalling ─────────────
  const start = useCallback(async () => {
    if (status !== 'idle') return;
    setStatus('connecting');
    setError(null);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch (e) {
      setStatus('error');
      setError('Camera + microphone permission required for video visits.');
      return;
    }
    setLocalStream(stream);
    if (localVideoRef.current) localVideoRef.current.srcObject = stream;

    let socket: Socket;
    try {
      const { io } = await import('socket.io-client');
      socket = io({ path: '/socket.io', transports: ['websocket', 'polling'], reconnection: true });
    } catch (e) {
      setStatus('error');
      setError('Realtime connection unavailable. Try refreshing.');
      return;
    }
    socketRef.current = socket;

    const buildPeer = (isInitiator: boolean, targetId: string | null) => {
      if (peerRef.current) return peerRef.current;
      targetPeerIdRef.current = targetId;
      const peer = new SimplePeer({
        initiator: isInitiator,
        trickle: true,
        stream,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
          ],
        },
      });
      peer.on('signal', (data: SimplePeer.SignalData) => {
        if ('sdp' in data && data.sdp) {
          const event = data.type === 'offer' ? 'webrtc:offer' : 'webrtc:answer';
          socket.emit(event, { visitId, sdp: data, target: targetPeerIdRef.current ?? undefined });
        } else if ('candidate' in data) {
          socket.emit('webrtc:ice', { visitId, candidate: data, target: targetPeerIdRef.current ?? undefined });
        }
      });
      peer.on('stream', (remote: MediaStream) => {
        setRemoteStream(remote);
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remote;
        setStatus('live');
      });
      peer.on('connect', () => setStatus('live'));
      peer.on('error', (err: Error) => {
        setError(`Peer error: ${err.message}`);
        setStatus('error');
      });
      peer.on('close', () => {
        setStatus('ended');
      });
      peerRef.current = peer;
      return peer;
    };

    socket.on('connect', () => {
      socket.emit('webrtc:join', { visitId });
    });

    socket.on('webrtc:peer-list', ({ peers }: { peers: string[] }) => {
      // If we're the initiator AND a peer is already here, open an offer.
      // If no peer is here yet, wait for `webrtc:peer-joined`.
      if (initiator && peers.length > 0) {
        buildPeer(true, peers[0]);
      }
    });
    socket.on('webrtc:peer-joined', ({ peerId }: { peerId: string }) => {
      // Non-initiators construct on incoming offer; initiators construct
      // here when the other side arrives after us.
      if (initiator && !peerRef.current) buildPeer(true, peerId);
    });
    socket.on('webrtc:offer', ({ sdp, fromPeerId }: { sdp: SimplePeer.SignalData; fromPeerId: string }) => {
      const peer = peerRef.current || buildPeer(false, fromPeerId);
      try { peer.signal(sdp); } catch { /* ignore */ }
    });
    socket.on('webrtc:answer', ({ sdp }: { sdp: SimplePeer.SignalData }) => {
      try { peerRef.current?.signal(sdp); } catch { /* ignore */ }
    });
    socket.on('webrtc:ice', ({ candidate }: { candidate: SimplePeer.SignalData }) => {
      try { peerRef.current?.signal(candidate); } catch { /* ignore */ }
    });
    socket.on('webrtc:peer-left', () => {
      setStatus('ended');
      setRemoteStream(null);
    });
  }, [visitId, initiator, status]);

  // ── End the call ─────────────────────────────────────────────────────────
  const endCall = useCallback(() => {
    try {
      socketRef.current?.emit('webrtc:leave', { visitId });
      socketRef.current?.disconnect();
    } catch { /* ignore */ }
    try { peerRef.current?.destroy(); } catch { /* ignore */ }
    try {
      localStream?.getTracks().forEach(t => t.stop());
    } catch { /* ignore */ }
    socketRef.current = null;
    peerRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setStatus('ended');
    onEnd();
  }, [visitId, localStream, onEnd]);

  // Auto-start once on mount.
  useEffect(() => {
    void start();
    return () => {
      // Tear down on unmount.
      try { socketRef.current?.emit('webrtc:leave', { visitId }); } catch { /* ignore */ }
      try { socketRef.current?.disconnect(); } catch { /* ignore */ }
      try { peerRef.current?.destroy(); } catch { /* ignore */ }
      try { localStream?.getTracks().forEach(t => t.stop()); } catch { /* ignore */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Camera / mic toggles ─────────────────────────────────────────────────
  const toggleCamera = useCallback(() => {
    if (!localStream) return;
    const next = !cameraOn;
    localStream.getVideoTracks().forEach(t => { t.enabled = next; });
    setCameraOn(next);
  }, [localStream, cameraOn]);
  const toggleMic = useCallback(() => {
    if (!localStream) return;
    const next = !micOn;
    localStream.getAudioTracks().forEach(t => { t.enabled = next; });
    setMicOn(next);
  }, [localStream, micOn]);

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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="relative aspect-video rounded-lg bg-zinc-950 overflow-hidden">
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="w-full h-full object-cover"
          />
          {!remoteStream && (
            <div className="absolute inset-0 flex items-center justify-center text-zinc-400 text-xs">
              <Loader2 className="w-4 h-4 animate-spin mr-2" /> Waiting for other party…
            </div>
          )}
          <p className="absolute bottom-1 left-2 text-[10px] text-zinc-300 bg-black/40 px-1.5 py-0.5 rounded">
            {initiator ? 'Patient' : 'Provider'}
          </p>
        </div>
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
      </div>

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
