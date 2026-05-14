/**
 * Tier-2 contract tests for Phase Y — six new mobile macro wrappers.
 *
 * For each wrapper: assert the right (domain, name, input) shape lands
 * at /api/lens/run via the configured fetchImpl mock.
 *
 * Run: npm test -- phase-y-wrappers
 */

import { configureMacroClient, Racing, Basketball, Markers, Messaging, Patterns, VoiceChatSignalling } from '../api/macro-client';

function mockFetch(payload: unknown = { ok: true }) {
  return jest.fn().mockResolvedValue({
    ok: true, status: 200, json: async () => payload,
  });
}

function lastBody(fetchImpl: jest.Mock): { domain: string; name: string; input: Record<string, unknown> } {
  const call = fetchImpl.mock.calls[fetchImpl.mock.calls.length - 1];
  const body = JSON.parse((call[1] as { body: string }).body);
  return body;
}

describe('Phase Y — Racing', () => {
  it('startRace sends racing.start_race with worldId + courtX/Z + durationS', async () => {
    const fetchImpl = mockFetch({ ok: true, raceId: 'rid_1' });
    configureMacroClient({ baseUrl: 'http://test', fetchImpl: fetchImpl as unknown as typeof fetch });
    await Racing.startRace('cyber', 5, -3, 240);
    const body = lastBody(fetchImpl);
    expect(body).toEqual({ domain: 'racing', name: 'start_race', input: { worldId: 'cyber', courtX: 5, courtZ: -3, durationS: 240 } });
  });
  it('submitLap shape', async () => {
    const fetchImpl = mockFetch();
    configureMacroClient({ baseUrl: 'http://test', fetchImpl: fetchImpl as unknown as typeof fetch });
    await Racing.submitLap('rid_1', 53210);
    expect(lastBody(fetchImpl)).toEqual({ domain: 'racing', name: 'submit_lap', input: { raceId: 'rid_1', lapMs: 53210 } });
  });
  it('leaderboard shape', async () => {
    const fetchImpl = mockFetch();
    configureMacroClient({ baseUrl: 'http://test', fetchImpl: fetchImpl as unknown as typeof fetch });
    await Racing.leaderboard('rid_1');
    expect(lastBody(fetchImpl)).toEqual({ domain: 'racing', name: 'leaderboard', input: { raceId: 'rid_1' } });
  });
});

describe('Phase Y — Basketball', () => {
  it('startMatch shape', async () => {
    const fetchImpl = mockFetch({ ok: true, courtId: 'cid_1' });
    configureMacroClient({ baseUrl: 'http://test', fetchImpl: fetchImpl as unknown as typeof fetch });
    await Basketball.startMatch('cyber');
    expect(lastBody(fetchImpl)).toMatchObject({ domain: 'basketball', name: 'start_match', input: { worldId: 'cyber' } });
  });
  it('score defaults to 2 points', async () => {
    const fetchImpl = mockFetch();
    configureMacroClient({ baseUrl: 'http://test', fetchImpl: fetchImpl as unknown as typeof fetch });
    await Basketball.score('cid_1');
    expect(lastBody(fetchImpl)).toEqual({ domain: 'basketball', name: 'score', input: { courtId: 'cid_1', points: 2 } });
  });
});

describe('Phase Y — Markers', () => {
  it('list shape', async () => {
    const fetchImpl = mockFetch();
    configureMacroClient({ baseUrl: 'http://test', fetchImpl: fetchImpl as unknown as typeof fetch });
    await Markers.list('concordia-hub');
    expect(lastBody(fetchImpl)).toEqual({ domain: 'markers', name: 'list', input: { worldId: 'concordia-hub' } });
  });
  it('place includes label when given', async () => {
    const fetchImpl = mockFetch();
    configureMacroClient({ baseUrl: 'http://test', fetchImpl: fetchImpl as unknown as typeof fetch });
    await Markers.place('concordia-hub', 'poi', 10, -5, 'fountain');
    expect(lastBody(fetchImpl)).toMatchObject({ domain: 'markers', name: 'place', input: { worldId: 'concordia-hub', kind: 'poi', x: 10, z: -5, label: 'fountain' } });
  });
});

describe('Phase Y — Messaging', () => {
  it('addBinding shape', async () => {
    const fetchImpl = mockFetch();
    configureMacroClient({ baseUrl: 'http://test', fetchImpl: fetchImpl as unknown as typeof fetch });
    await Messaging.addBinding('whatsapp', '+15555550101');
    expect(lastBody(fetchImpl)).toEqual({ domain: 'messaging', name: 'add_binding', input: { platform: 'whatsapp', handle: '+15555550101' } });
  });
});

describe('Phase Y — Patterns', () => {
  it('discover with query + limit', async () => {
    const fetchImpl = mockFetch();
    configureMacroClient({ baseUrl: 'http://test', fetchImpl: fetchImpl as unknown as typeof fetch });
    await Patterns.discover('lattice drift', 10);
    expect(lastBody(fetchImpl)).toEqual({ domain: 'patterns', name: 'discover', input: { query: 'lattice drift', limit: 10 } });
  });
});

describe('Phase Y — VoiceChatSignalling', () => {
  it('join shape', async () => {
    const fetchImpl = mockFetch({ ok: true, peers: ['u_a', 'u_b'] });
    configureMacroClient({ baseUrl: 'http://test', fetchImpl: fetchImpl as unknown as typeof fetch });
    await VoiceChatSignalling.join('room-concordia');
    expect(lastBody(fetchImpl)).toEqual({ domain: 'voice_chat', name: 'join', input: { roomId: 'room-concordia' } });
  });
  it('offer shape', async () => {
    const fetchImpl = mockFetch();
    configureMacroClient({ baseUrl: 'http://test', fetchImpl: fetchImpl as unknown as typeof fetch });
    const sdp = { type: 'offer', sdp: 'v=0...' };
    await VoiceChatSignalling.offer('peer1', sdp);
    expect(lastBody(fetchImpl)).toEqual({ domain: 'voice_chat', name: 'offer', input: { targetUserId: 'peer1', sdp } });
  });
});
