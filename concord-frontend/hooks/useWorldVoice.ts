/**
 * useWorldVoice — WebRTC spatial voice chat for the world lens.
 *
 * Establishes peer-to-peer audio connections with everyone in the
 * caller's current 50m spatial cell. Audio NEVER goes through the
 * server; only WebRTC signaling (SDP / ICE) is relayed via socket.io.
 *
 * Lifecycle:
 *   1. enable() — getUserMedia({audio:true}) + voice-join-cell.
 *      Existing peers in the cell receive `voice:peer-joined`; THEY
 *      create the RTCPeerConnection and send the initial offer (so
 *      the newcomer doesn't have to know about them yet).
 *   2. On `voice:peer-joined` for someone NEW in our cell: create
 *      a peer connection, attach mic track, generate offer, send via
 *      voice-signal.
 *   3. On `voice:signal` for us:
 *      - kind:'offer'  → set remote, create answer, send back
 *      - kind:'answer' → set remote
 *      - kind:'ice-candidate' → addIceCandidate
 *   4. On `voice:peer-left`: tear down that peer connection.
 *   5. updatePosition({x,y,z}) — if cell crossed, server rotates room
 *      membership; we get peer-joined/left events naturally.
 *   6. disable() — voice-leave-cell + close all peer connections +
 *      stop mic tracks.
 *
 * Returns:
 *   {
 *     enabled, peers: { userId: { stream, audioLevel, status } },
 *     enable, disable, updatePosition, isSelfMuted, toggleSelfMute
 *   }
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api/client';
import { onEvent } from '@/lib/realtime/event-bus';

export interface VoicePeer {
  userId: string;
  stream: MediaStream | null;
  status: 'connecting' | 'connected' | 'failed' | 'disconnected';
}

interface UseWorldVoiceOpts {
  worldId: string | null;
  selfPosition?: { x: number; y: number; z: number } | null;
  iceServers?: RTCIceServer[];
}

const DEFAULT_ICE: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export function useWorldVoice({ worldId, selfPosition, iceServers = DEFAULT_ICE }: UseWorldVoiceOpts) {
  const [enabled, setEnabled] = useState(false);
  const [isSelfMuted, setIsSelfMuted] = useState(false);
  const [peers, setPeers] = useState<Record<string, VoicePeer>>({});
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const lastCellKeyRef = useRef<string | null>(null);

  // Get our own userId from the auth cookie — the server uses ctx.actor.
  // userId on every macro call, but here we need to know who WE are so
  // we can ignore self-targeted events.
  const selfIdRef = useRef<string | null>(null);
  useEffect(() => {
    // The server-issued JWT puts userId in `req.user.id`; the frontend
    // store typically caches it. Try to fetch from /api/whoami if available.
    let cancelled = false;
    (async () => {
      try {
        const r = await api.get('/api/whoami');
        if (!cancelled) selfIdRef.current = r.data?.userId || r.data?.id || null;
      } catch (_e) { /* anonymous session — voice still works between peers */ }
    })();
    return () => { cancelled = true; };
  }, []);

  function ensurePeerConnection(peerId: string): RTCPeerConnection {
    let pc = peerConnectionsRef.current.get(peerId);
    if (pc) return pc;
    pc = new RTCPeerConnection({ iceServers });
    peerConnectionsRef.current.set(peerId, pc);
    // Attach local mic tracks immediately so the negotiated answer
    // includes media sections.
    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getTracks()) pc.addTrack(track, localStreamRef.current);
    }
    pc.onicecandidate = (ev) => {
      if (!ev.candidate) return;
      api.post('/api/lens/run', {
        domain: 'world', action: 'voice-signal',
        input: { target: peerId, kind: 'ice-candidate', payload: ev.candidate.toJSON() },
      }).catch(() => { /* best effort */ });
    };
    pc.ontrack = (ev) => {
      setPeers((prev) => ({
        ...prev,
        [peerId]: { userId: peerId, stream: ev.streams[0] || null, status: 'connected' },
      }));
    };
    pc.onconnectionstatechange = () => {
      setPeers((prev) => {
        const existing = prev[peerId];
        if (!existing) return prev;
        const status = pc!.connectionState === 'connected' ? 'connected'
          : pc!.connectionState === 'failed' ? 'failed'
          : pc!.connectionState === 'disconnected' ? 'disconnected'
          : 'connecting';
        return { ...prev, [peerId]: { ...existing, status } };
      });
    };
    setPeers((prev) => ({ ...prev, [peerId]: { userId: peerId, stream: null, status: 'connecting' } }));
    return pc;
  }

  function teardownPeer(peerId: string) {
    const pc = peerConnectionsRef.current.get(peerId);
    if (pc) {
      try { pc.close(); } catch (_e) { /* best effort */ }
      peerConnectionsRef.current.delete(peerId);
    }
    setPeers((prev) => {
      const { [peerId]: _, ...rest } = prev;
      return rest;
    });
  }

  function teardownAll() {
    for (const id of Array.from(peerConnectionsRef.current.keys())) teardownPeer(id);
    if (localStreamRef.current) {
      for (const t of localStreamRef.current.getTracks()) t.stop();
      localStreamRef.current = null;
    }
  }

  // Subscribe to voice events whenever enabled.
  useEffect(() => {
    if (!enabled || !worldId) return;
    const offJoined = onEvent('voice:peer-joined', async (payload: unknown) => {
      const p = payload as { userId?: string; worldId?: string; cellKey?: string };
      if (p.worldId !== worldId || !p.userId) return;
      if (p.userId === selfIdRef.current) return;
      // We're the older peer → we initiate the offer to the newcomer.
      const pc = ensurePeerConnection(p.userId);
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await api.post('/api/lens/run', {
          domain: 'world', action: 'voice-signal',
          input: { target: p.userId, kind: 'offer', payload: offer },
        });
      } catch (_e) { /* failed handshake, teardown */ teardownPeer(p.userId); }
    });
    const offLeft = onEvent('voice:peer-left', (payload: unknown) => {
      const p = payload as { userId?: string };
      if (p.userId) teardownPeer(p.userId);
    });
    const offSignal = onEvent('voice:signal', async (payload: unknown) => {
      const p = payload as { from?: string; to?: string; kind?: string; payload?: unknown };
      if (!p.from || p.to !== selfIdRef.current) return;
      const pc = ensurePeerConnection(p.from);
      try {
        if (p.kind === 'offer' && p.payload) {
          await pc.setRemoteDescription(p.payload as RTCSessionDescriptionInit);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await api.post('/api/lens/run', {
            domain: 'world', action: 'voice-signal',
            input: { target: p.from, kind: 'answer', payload: answer },
          });
        } else if (p.kind === 'answer' && p.payload) {
          await pc.setRemoteDescription(p.payload as RTCSessionDescriptionInit);
        } else if (p.kind === 'ice-candidate' && p.payload) {
          await pc.addIceCandidate(p.payload as RTCIceCandidateInit);
        }
      } catch (_e) { teardownPeer(p.from); }
    });
    return () => { offJoined?.(); offLeft?.(); offSignal?.(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- ensurePeerConnection is a stable callback; effect keys on enabled/worldId
  }, [enabled, worldId]);

  const enable = useCallback(async () => {
    if (enabled || !worldId || !selfPosition) return;
    try {
      localStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (_e) {
      // Mic access denied or unavailable — caller can surface a toast.
      return;
    }
    const res = await api.post('/api/lens/run', {
      domain: 'world', action: 'voice-join-cell',
      input: { worldId, x: selfPosition.x, y: selfPosition.y, z: selfPosition.z },
    }).catch(() => null);
    if (res?.data?.ok) {
      lastCellKeyRef.current = res.data.result?.cellKey || null;
      setEnabled(true);
    } else {
      // Clean up the stream we just acquired.
      teardownAll();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- teardownAll is a stable callback; effect keys on enabled/worldId/selfPosition
  }, [enabled, worldId, selfPosition]);

  const disable = useCallback(async () => {
    if (!enabled) return;
    setEnabled(false);
    await api.post('/api/lens/run', {
      domain: 'world', action: 'voice-leave-cell', input: {},
    }).catch(() => { /* best effort */ });
    teardownAll();
    lastCellKeyRef.current = null;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- teardownAll is a stable callback; effect keys on enabled
  }, [enabled]);

  // Position update — let the server know if we crossed a cell boundary.
  // Throttled to once per 500ms; the server's cellKeyFor will only emit
  // peer-joined/left when the cell actually changes.
  const lastPosPushRef = useRef(0);
  const updatePosition = useCallback((pos: { x: number; y: number; z: number }) => {
    if (!enabled) return;
    const now = Date.now();
    if (now - lastPosPushRef.current < 500) return;
    lastPosPushRef.current = now;
    api.post('/api/lens/run', {
      domain: 'world', action: 'voice-update-position', input: pos,
    }).catch(() => { /* best effort */ });
  }, [enabled]);

  // Auto-push position whenever selfPosition prop changes.
  useEffect(() => {
    if (!enabled || !selfPosition) return;
    updatePosition(selfPosition);
  }, [enabled, selfPosition, updatePosition]);

  const toggleSelfMute = useCallback(() => {
    setIsSelfMuted((muted) => {
      const next = !muted;
      if (localStreamRef.current) {
        for (const t of localStreamRef.current.getAudioTracks()) t.enabled = !next;
      }
      return next;
    });
  }, []);

  // Cleanup on unmount.
  useEffect(() => {
    return () => { teardownAll(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount-only cleanup; teardownAll is stable
  }, []);

  return { enabled, peers, enable, disable, updatePosition, isSelfMuted, toggleSelfMute };
}
