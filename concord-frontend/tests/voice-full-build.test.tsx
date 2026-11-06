/**
 * voice-full-build.test.tsx — B6 F-B build(voice) FE pins.
 *
 * (S3/F3) the bench's state persists across unmount/remount (the page
 * unmounts the panel on every view switch) via its sessionStorage
 * snapshot — transcript, parameters, results, card states.
 * (S2/F2) Mint also files the transcript into the Transcripts workspace
 * via recording-create, segments parsed from the [SPEAKER X] markers.
 * (S4/F4) Coach on an empty agent reply composes a labelled note from
 * the bench's own numbers; with nothing computed it says what to run.
 * (S5/F5) Publish names the report's address, /dtu/<id>.
 * (S6/F6) the recent-sessions list badges ended sessions "ended" and
 * finalized ones "saved"; an open session offers End beside Save, and
 * End calls live-end.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// ── api channel (bench: api.post + apiHelpers.lens.runDomain) ─────────
const runDomainCalls: { action: string; input: Record<string, unknown> }[] = [];
let dtuCounter = 0;
const apiPost = vi.fn(async (url: string, body?: { domain?: string }) => {
  if (url === '/api/lens/run' && body?.domain === 'dtu') {
    dtuCounter += 1;
    return { data: { result: { dtu: { id: dtuCounter === 1 ? 'dtu_bench1' : 'dtu_report9' } } } };
  }
  if (url === '/api/lens/run' && body?.domain === 'chat_agent') {
    return { data: { result: {} } }; // the agent returns empty
  }
  if (url.startsWith('/api/dtus/')) return { data: { ok: true } };
  return { data: { ok: true } };
});
const runDomain = vi.fn(async (_domain: string, action: string, payload: { input: Record<string, unknown> }) => {
  runDomainCalls.push({ action, input: payload.input });
  if (action === 'recording-create') return { data: { ok: true, result: { recording: { id: 'rec_bench1' } } } };
  return { data: { ok: true, result: {} } };
});

// ── lensRun channel (live transcribe) ─────────────────────────────────
interface FakeSession { id: string; title: string; language: string; status: string; words: never[]; recordingId: string | null }
let fakeSessions: FakeSession[] = [];
const lensRunCalls: { action: string; params: Record<string, unknown> }[] = [];
const lensRunMock = vi.fn(async (_domain: string, action: string, params: Record<string, unknown> = {}) => {
  lensRunCalls.push({ action, params });
  if (action === 'live-list') {
    return { data: { ok: true, result: { sessions: fakeSessions.map((s) => ({ id: s.id, title: s.title, language: s.language, status: s.status, wordCount: s.words.length, recordingId: s.recordingId })), count: fakeSessions.length } } };
  }
  if (action === 'live-start') {
    const s: FakeSession = { id: 'live_1', title: (params.title as string) || 'Live session', language: 'en-US', status: 'live', words: [], recordingId: null };
    fakeSessions = [s, ...fakeSessions];
    return { data: { ok: true, result: { session: s } } };
  }
  if (action === 'live-detail') {
    const s = fakeSessions.find((x) => x.id === params.sessionId);
    return { data: { ok: true, result: { session: s } } };
  }
  if (action === 'recording-create') {
    return { data: { ok: true, result: { recording: { id: 'rec_bench1' } } } };
  }
  if (action === 'live-end') {
    const s = fakeSessions.find((x) => x.id === params.sessionId);
    if (s) s.status = 'ended';
    return { data: { ok: true, result: { sessionId: params.sessionId, status: 'ended', wordCount: 0 } } };
  }
  return { data: { ok: true, result: {} } };
});

vi.mock('@/lib/api/client', () => ({
  api: { post: (...args: [string, { domain?: string }?]) => apiPost(...args) },
  apiHelpers: { lens: { runDomain: (...args: [string, string, { input: Record<string, unknown> }]) => runDomain(...args) } },
  lensRun: (...args: [string, string, Record<string, unknown>?]) => lensRunMock(...args),
}));
vi.mock('@/components/panel-polish', () => ({
  usePipe: () => ({ publish: vi.fn() }),
  useRecallableAction: () => ({ run: async (fn: () => Promise<unknown>) => fn() }),
  RecallSlot: () => null,
}));
vi.mock('@/components/dtu/ContentClassLicenseFields', () => ({
  withContentLicense: (x: unknown) => x,
}));

import { VoiceActionPanel } from '@/components/voice/VoiceActionPanel';
import { VoiceLiveTranscribe } from '@/components/voice/VoiceLiveTranscribe';

const BENCH_KEY = 'concord.voice.bench.v1';
const ANALYZE = { wordCount: 120, sentenceCount: 9, avgWordsPerSentence: 13.3, avgWordLength: 4.2, speakingRate: '120 words/min', totalFillers: 3, fillerRate: '2.5%', complexityRating: 'moderate', vocabularyRichness: 'rich', fillerWords: { um: 1 } };

function clickAction(label: string) {
  const el = screen.getByText(label, { selector: 'div' });
  const btn = el.closest('button');
  if (!btn) throw new Error(`no button for ${label}`);
  fireEvent.click(btn);
}

beforeEach(() => {
  sessionStorage.clear();
  runDomainCalls.length = 0;
  lensRunCalls.length = 0;
  fakeSessions = [];
  dtuCounter = 0;
  apiPost.mockClear();
  runDomain.mockClear();
  lensRunMock.mockClear();
});

describe('voice bench — build pins', () => {
  it('S3: bench state survives an unmount/remount (the view switch)', async () => {
    sessionStorage.setItem(BENCH_KEY, JSON.stringify({ transcript: 'KEPT TRANSCRIPT', duration: '3', keywords: '', analyzeResult: ANALYZE }));
    const first = render(<VoiceActionPanel />);
    await waitFor(() => expect((screen.getByDisplayValue('KEPT TRANSCRIPT') as HTMLTextAreaElement)).toBeTruthy());
    expect(screen.getByText('Speech metrics · moderate')).toBeTruthy();
    first.unmount();
    render(<VoiceActionPanel />);
    await waitFor(() => expect(screen.getByDisplayValue('KEPT TRANSCRIPT')).toBeTruthy());
    expect(screen.getByText('Speech metrics · moderate')).toBeTruthy();
  });

  it('S2: Mint files the transcript into Transcripts with marker segments', async () => {
    sessionStorage.setItem(BENCH_KEY, JSON.stringify({ transcript: '[SPEAKER 1]: hello budget world. [SPEAKER 2]: hi there friend.' }));
    render(<VoiceActionPanel />);
    await waitFor(() => expect(screen.getByDisplayValue(/hello budget world/)).toBeTruthy());
    clickAction('Mint');
    await waitFor(() => expect(screen.getByText(/also filed in Transcripts/)).toBeTruthy());
    const rec = lensRunCalls.find((c) => c.action === 'recording-create');
    expect(rec).toBeTruthy();
    const payload = JSON.stringify(rec!.params);
    expect(payload).toContain('SPEAKER 1');
    expect(payload).toContain('hello budget world.');
    expect(payload).toContain('SPEAKER 2');
  });

  it('S4: Coach composes a labelled note from the bench numbers when the agent is empty', async () => {
    sessionStorage.setItem(BENCH_KEY, JSON.stringify({ transcript: 'x', analyzeResult: ANALYZE }));
    render(<VoiceActionPanel />);
    await waitFor(() => expect(screen.getByText('Speech metrics · moderate')).toBeTruthy());
    clickAction('Coach');
    await waitFor(() => expect(screen.getByText(/Computed from the bench's own numbers/)).toBeTruthy());
    expect(screen.queryByText(/Agent returned empty/)).toBeNull();
  });

  it('S4: Coach with nothing computed says what to run first', async () => {
    render(<VoiceActionPanel />);
    clickAction('Coach');
    await waitFor(() => expect(screen.getByText(/Coach unavailable — run Analyze, Diarize or Sentiment first/)).toBeTruthy());
  });

  it('S5: Publish names the report address /dtu/<id>', async () => {
    dtuCounter = 1; // the publish create is the second DTU in this file's counter shape
    sessionStorage.setItem(BENCH_KEY, JSON.stringify({ transcript: 'x', analyzeResult: ANALYZE }));
    render(<VoiceActionPanel />);
    await waitFor(() => expect(screen.getByText('Speech metrics · moderate')).toBeTruthy());
    clickAction('Publish');
    await waitFor(() => expect(screen.getByText(/lives at \/dtu\/dtu_report9/)).toBeTruthy());
    const link = screen.getByRole('link', { name: /\/dtu\/dtu_report9/ });
    expect(link.getAttribute('href')).toBe('/dtu/dtu_report9');
  });
});

describe('voice live — build pins', () => {
  beforeEach(() => {
    class FakeSR {
      lang = 'en-US'; continuous = false; interimResults = false;
      onresult: unknown = null; onerror: unknown = null; onend: unknown = null;
      start() { /* no-op */ }
      stop() { /* no-op */ }
    }
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeSR;
  });

  it('S6: recent sessions badge ended as "ended" and finalized as "saved"', async () => {
    fakeSessions = [
      { id: 's_end', title: 'Ended one', language: 'en-US', status: 'ended', words: [], recordingId: null },
      { id: 's_fin', title: 'Saved one', language: 'en-US', status: 'finalized', words: [], recordingId: 'rec_1' },
    ];
    render(<VoiceLiveTranscribe />);
    await waitFor(() => expect(screen.getByText('Ended one')).toBeTruthy());
    expect(screen.getByText('ended')).toBeTruthy();
    expect(screen.getByText('saved')).toBeTruthy();
  });

  it('S6: an open session offers End beside Save, and End calls live-end', async () => {
    render(<VoiceLiveTranscribe />);
    fireEvent.click(screen.getByText('Go live'));
    await waitFor(() => expect(screen.getByText('End session')).toBeTruthy());
    expect(screen.getByText('Save recording')).toBeTruthy();
    fireEvent.click(screen.getByText('End session'));
    await waitFor(() => expect(lensRunCalls.some((c) => c.action === 'live-end' && c.params.sessionId === 'live_1')).toBe(true));
    await waitFor(() => expect(screen.getByText('ended')).toBeTruthy());
  });
});
