/**
 * RoomStage WebRTC wiring (job oc-social-3afix item 6, part c).
 *
 * Real defects:
 *  - RoomStage hardcoded ICE_SERVERS to a single Google STUN server, so
 *    a backend-configured TURN server was never used — strict-NAT clients
 *    could not connect. It now fetches /api/webrtc/ice-servers (same
 *    pattern as TelehealthVideoCall) and falls back to the two Google
 *    STUN servers when the endpoint can't be reached.
 *  - When ICE hit "failed" the peer just vanished silently (or worse, a
 *    strict-NAT user saw operator config text elsewhere). The stage now
 *    shows a plain user-facing message:
 *    "Couldn't connect audio on this network — try another network".
 *
 * Harness: the real RoomStage with only the HTTP layer (@/lib/api/client
 * for the spaces macros), the realtime socket lib, and the WebRTC/audio
 * browser APIs (RTCPeerConnection, AudioContext, getUserMedia — jsdom has
 * none of them) stubbed. The stubs are capture-style: the fake
 * RTCPeerConnection records the config every peer is constructed with, and
 * the fake socket bus exposes the signaling handlers so the test can drive
 * a peer joining the room the same way the server would.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const bus = vi.hoisted(() => ({
  subs: {} as Record<string, Array<(payload: unknown) => void>>,
  emitted: [] as Array<[string, Record<string, unknown>]>,
  fakeSocket: { connected: true, once: vi.fn() },
}));

vi.mock('@/lib/realtime/socket', () => ({
  getSocket: () => bus.fakeSocket,
  subscribe: (event: string, handler: (payload: unknown) => void) => {
    (bus.subs[event] ??= []).push(handler);
    return () => {
      const arr = bus.subs[event];
      const i = arr ? arr.indexOf(handler) : -1;
      if (arr && i >= 0) arr.splice(i, 1);
    };
  },
  emit: (event: string, payload: Record<string, unknown>) => {
    bus.emitted.push([event, payload]);
  },
}));

vi.mock('@/lib/api/client', () => ({
  api: {
    post: vi.fn(async () => ({
      data: {
        ok: true,
        room: {
          id: 'r1',
          hostUserId: 'u1',
          title: 'Afterhours jam',
          description: null,
          startedAt: Date.now(),
          endedAt: null,
          speakers: [{ user_id: 'u1', role: 'host', joined_at: Date.now() }],
          listenerCount: 2,
          handsRaised: [],
          isRecording: false,
        },
      },
    })),
  },
}));

vi.mock('@/components/social/UserLink', () => ({
  UserLink: ({ userId }: { userId: string }) => React.createElement('span', null, `@${userId}`),
}));

import RoomStage from '@/components/audio-rooms/RoomStage';

// ── Browser API stubs ──────────────────────────────────────────────────
class FakeRTCPeerConnection {
  static instances: FakeRTCPeerConnection[] = [];
  connectionState: RTCConnectionState = 'new';
  onconnectionstatechange: (() => void) | null = null;
  ontrack: ((ev: unknown) => void) | null = null;
  onicecandidate: ((ev: unknown) => void) | null = null;
  config: { iceServers?: RTCIceServer[] };
  constructor(config: RTCConfiguration) {
    this.config = config;
    FakeRTCPeerConnection.instances.push(this);
  }
  get localDescription() { return { type: 'offer', sdp: 'test-sdp' }; }
  addTrack = vi.fn();
  createOffer = vi.fn(async () => ({ type: 'offer', sdp: 'test-sdp' }));
  setLocalDescription = vi.fn(async () => {});
  close = vi.fn();
}

class FakeAudioContext {
  destination = {} as unknown as AudioDestinationNode;
  createGain() {
    return { connect: vi.fn(), disconnect: vi.fn(), gain: { value: 1 } } as unknown as GainNode;
  }
  createAnalyser() {
    return { fftSize: 0, connect: vi.fn(), disconnect: vi.fn(), getByteFrequencyData: vi.fn() } as unknown as AnalyserNode;
  }
  createMediaStreamSource() {
    return { connect: vi.fn() } as unknown as MediaStreamAudioSourceNode;
  }
  close = vi.fn(async () => {});
}

const fakeTrack = () => ({ enabled: true, stop: vi.fn() });
const fakeStream = {
  getTracks: () => [fakeTrack()],
  getAudioTracks: () => [fakeTrack()],
} as unknown as MediaStream;

const TURN_CONFIG: RTCIceServer[] = [
  { urls: 'turn:turn.example.com:3478', username: 'short-lived', credential: 'cred' },
];
const STUN_FALLBACK: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

function stubIceFetch(config: RTCIceServer[] | null) {
  const fetchMock = config
    ? vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, iceServers: config }) }))
    : vi.fn(async () => { throw new Error('ice endpoint down'); });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function openStageAndJoinAPeer() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <RoomStage roomId="r1" selfUserId="u1" onClose={vi.fn()} />
    </QueryClientProvider>,
  );
  // Room data + joined mesh: the real title renders and the signaling
  // handlers are live.
  expect(await screen.findByText('Afterhours jam')).toBeInTheDocument();
  await waitFor(() => expect(bus.subs['audio-room:room-state']).toBeDefined());
  expect(bus.emitted.some(([event]) => event === 'audio-room:join')).toBe(true);
  // The server tells the stage a peer is here (same event the room uses).
  await act(async () => {
    bus.subs['audio-room:room-state'][0]({ roomId: 'r1', peers: ['p2'] });
  });
  const pc = FakeRTCPeerConnection.instances[FakeRTCPeerConnection.instances.length - 1];
  expect(pc).toBeDefined();
  return pc;
}

beforeEach(() => {
  vi.clearAllMocks();
  FakeRTCPeerConnection.instances.length = 0;
  bus.subs = {};
  bus.emitted.length = 0;
  vi.stubGlobal('RTCPeerConnection', FakeRTCPeerConnection);
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  Object.defineProperty(window.navigator, 'mediaDevices', {
    value: { getUserMedia: vi.fn(async () => fakeStream) },
    configurable: true,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RoomStage WebRTC wiring', () => {
  it('builds peer connections with the ICE config from /api/webrtc/ice-servers (backend TURN is used automatically)', async () => {
    const fetchMock = stubIceFetch(TURN_CONFIG);
    const pc = await openStageAndJoinAPeer();
    expect(fetchMock).toHaveBeenCalledWith('/api/webrtc/ice-servers');
    expect(pc.config.iceServers).toEqual(TURN_CONFIG);
    // The offer actually went out over the (mocked) socket — the peer is
    // really wired, not just constructed.
    expect(bus.emitted.some(([event]) => event === 'audio-room:offer')).toBe(true);
  });

  it('falls back to the two Google STUN servers when the ICE endpoint fails', async () => {
    const fetchMock = stubIceFetch(null);
    const pc = await openStageAndJoinAPeer();
    expect(fetchMock).toHaveBeenCalledWith('/api/webrtc/ice-servers');
    expect(pc.config.iceServers).toEqual(STUN_FALLBACK);
  });

  it('a failed ICE connection shows a plain network message, never config instructions', async () => {
    stubIceFetch(TURN_CONFIG);
    const pc = await openStageAndJoinAPeer();

    // ICE fails for this peer (strict NAT / blocked UDP).
    await act(async () => {
      pc.connectionState = 'failed';
      pc.onconnectionstatechange?.();
    });

    expect(
      await screen.findByText('Couldn\u2019t connect audio on this network \u2014 try another network')
    ).toBeInTheDocument();
    // No operator/config text leaked into the user-facing stage.
    expect(screen.queryByText(/TURN/i)).toBeNull();
    expect(screen.queryByText(/CONCORD_TURN_URL/i)).toBeNull();
    expect(screen.queryByText(/Strict-NAT/i)).toBeNull();
    // The dead peer is cleaned up honestly.
    expect(pc.close).toHaveBeenCalled();
  });
});