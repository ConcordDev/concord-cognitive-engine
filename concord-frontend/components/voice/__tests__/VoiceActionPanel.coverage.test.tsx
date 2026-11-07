// Behaviour coverage for the voice bench: analyze/diarize/sentiment/keyword, mint (with the
// Transcripts seam), DM with recall, publish with recall, the coaching agent and its
// deterministic fallback, plus validation and failure paths.

import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({
  runDomain: vi.fn(), post: vi.fn(), del: vi.fn(), lensRun: vi.fn(), publish: vi.fn(),
}));
const ANALYZE = { wordCount: 120, sentenceCount: 8, avgWordsPerSentence: 15, avgWordLength: 4.5, speakingRate: '140 wpm', fillerWords: { um: 3, like: 2 }, totalFillers: 5, fillerRate: '4%', complexityRating: 'moderate', vocabularyRichness: 'rich' };
const DIARIZE = { speakerCount: 2, totalSegments: 6, totalWords: 120, speakers: [{ speaker: 'Ada', segmentCount: 3, wordCount: 70, wordShare: 58, talkTimeSeconds: 40, talkTimeShare: 60, avgWordsPerSegment: 23 }, { speaker: 'Bo', segmentCount: 3, wordCount: 50, wordShare: 42, talkTimeSeconds: 30, talkTimeShare: 40, avgWordsPerSegment: 16 }], dominantSpeaker: 'Ada', balanceRatio: 72 };
const SENT = { overallScore: 0.4, overallLabel: 'positive', segmentBreakdown: { positive: 4, negative: 1, neutral: 1, total: 6 }, sentimentArc: 'rising' };
const KW = { keywordsSearched: 2, totalOccurrences: 5, keywordDensity: '4.1%', wordCount: 120, topKeywords: [{ keyword: 'budget', count: 3, occurrences: [{ position: 4, snippet: '...budget...' }] }], notFound: ['launch'] };

vi.mock('@/lib/api/client', () => ({
  api: { post: (...a: unknown[]) => h.post(...a), delete: (...a: unknown[]) => h.del(...a) },
  apiHelpers: { lens: { runDomain: (...a: unknown[]) => h.runDomain(...a) } },
  lensRun: (...a: unknown[]) => h.lensRun(...a),
}));
vi.mock('@/components/dtu/ContentClassLicenseFields', () => ({ withContentLicense: (x: unknown) => x }));
vi.mock('@/components/panel-polish', () => ({
  usePipe: () => ({ publish: h.publish }),
  useRecallableAction: (opts: { onUndo?: (id: string) => Promise<void> }) => ({ run: async (fn: () => Promise<string>) => { const id = await fn(); await opts.onUndo?.(id); return id; } }),
  RecallSlot: () => <span>recall-slot</span>,
}));
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const TRANSCRIPT = '[Ada]: We need to review the budget today. Um, like, the budget is tight.\n[Bo]: Agreed, the budget matters most.';
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
const click = async (name: RegExp) => { await act(async () => { fireEvent.click(screen.getByRole('button', { name })); await new Promise((r) => setTimeout(r, 20)); }); };
const type = async (ph: RegExp | undefined, role: 'textbox', value: string, nth = 0) => {
  const els = screen.getAllByRole(role).filter((e) => !ph || ph.test(e.getAttribute('placeholder') || ''));
  await act(async () => { fireEvent.change(els[nth], { target: { value } }); });
};
const mount = async () => { const { VoiceActionPanel } = await import('../VoiceActionPanel'); const v = render(<VoiceActionPanel />); await settle(); return v; };
afterEach(() => { cleanup(); sessionStorage.clear(); });
beforeEach(() => {
  sessionStorage.clear();
  Object.values(h).forEach((f) => f.mockReset());
  h.runDomain.mockImplementation(async (_d: string, action: string) => ({ data: { ok: true, result: action === 'transcriptAnalyze' ? ANALYZE : action === 'speakerDiarize' ? DIARIZE : action === 'sentimentScore' ? SENT : KW } }));
  h.post.mockImplementation(async (url: string, body?: { domain?: string; name?: string }) => {
    if (body?.domain === 'dtu') return { data: { result: { dtu: { id: 'dtu-123456789' } } } };
    if (body?.domain === 'chat_agent') return { data: { result: { answer: 'Slow down and cut fillers.' } } };
    if (url.includes('/publish')) return { data: { ok: true } };
    return { data: { ok: true, message: { id: 'msg-1' } } };
  });
  h.lensRun.mockResolvedValue({ data: { ok: true } });
});

describe('VoiceActionPanel', () => {
  it('requires a transcript, then runs all four analyses and renders results', async () => {
    const view = await mount();
    for (const n of [/Analyze/, /Diarize/, /Sentiment/, /Keywords/]) await click(n);
    expect(view.container.textContent).toMatch(/Transcript required/);
    await type(undefined, 'textbox', TRANSCRIPT, 0);
    await click(/Analyze/);
    await click(/Diarize/);
    await click(/Sentiment/);
    await click(/Keywords/);
    expect(view.container.textContent).toMatch(/Keywords required/);
    const inputs = screen.getAllByRole('textbox');
    await act(async () => { fireEvent.change(inputs[1], { target: { value: '2.5' } }); });
    await act(async () => { fireEvent.change(inputs[2], { target: { value: 'budget, launch' } }); });
    await click(/Analyze/);
    await click(/Keywords/);
    expect(view.container.textContent).toMatch(/Speech metrics · moderate/);
    expect(view.container.textContent).toMatch(/Diarization · 2 speakers/);
    expect(view.container.textContent).toMatch(/Sentiment · rising/);
    expect(view.container.textContent).toMatch(/density 4.1%/);
    expect(h.publish).toHaveBeenCalled();
  });

  it('mints a transcript DTU and files it into Transcripts (and states a seam failure)', async () => {
    const view = await mount();
    await type(undefined, 'textbox', TRANSCRIPT, 0);
    await click(/Mint/);
    expect(h.lensRun).toHaveBeenCalledWith('voice', 'recording-create', expect.objectContaining({ segments: expect.any(Array) }));
    expect(view.container.textContent).toMatch(/also filed in Transcripts/);
    cleanup(); sessionStorage.clear();
    h.lensRun.mockResolvedValue({ data: { ok: false, error: 'busy' } });
    const v2 = await mount();
    await type(undefined, 'textbox', 'Plain sentence one. Plain sentence two.', 0);
    await click(/Mint/);
    expect(h.lensRun).toHaveBeenLastCalledWith('voice', 'recording-create', expect.objectContaining({ transcript: expect.any(String) }));
    expect(v2.container.textContent).toMatch(/could not file it into Transcripts/);
    cleanup(); sessionStorage.clear();
    h.lensRun.mockRejectedValue(new Error('x'));
    const v3 = await mount();
    await type(undefined, 'textbox', 'Some text here.', 0);
    await click(/Mint/);
    expect(v3.container.textContent).toMatch(/filing into Transcripts failed/);
    cleanup(); sessionStorage.clear();
    h.post.mockResolvedValue({ data: {} });
    const v4 = await mount();
    await click(/Mint/);
    expect(v4.container.textContent).toMatch(/No DTU id/);
  });

  it('sends a DM brief and publishes a report with recall, validating inputs first', async () => {
    const view = await mount();
    await click(/^DM/);
    expect(view.container.textContent).toMatch(/Recipient required/);
    await click(/Publish/);
    expect(view.container.textContent).toMatch(/Run analyze\/sentiment first/);
    await type(undefined, 'textbox', TRANSCRIPT, 0);
    for (const n of [/Analyze/, /Diarize/, /Sentiment/]) await click(n);
    await type(undefined, 'textbox', 'friend-42', 3);
    await click(/^DM/);
    expect(h.post).toHaveBeenCalledWith('/api/social/dm', expect.objectContaining({ toUserId: 'friend-42' }));
    expect(h.del).toHaveBeenCalled();
    await click(/Publish/);
    expect(h.post).toHaveBeenCalledWith(expect.stringContaining('/publish'));
    expect(view.container.textContent).toMatch(/Published|Public speech report/);
  });

  it('coaches via the agent, falls back to computed numbers, and reports failures', async () => {
    const view = await mount();
    h.post.mockImplementation(async (_u: string, b?: { domain?: string }) => b?.domain === 'chat_agent' ? { data: { result: {} } } : { data: {} });
    await click(/Coach/);
    expect(view.container.textContent).toMatch(/Coach unavailable/);
    await type(undefined, 'textbox', TRANSCRIPT, 0);
    for (const n of [/Analyze/, /Diarize/, /Sentiment/]) await click(n);
    await click(/Coach/);
    expect(view.container.textContent).toMatch(/Computed from the bench/);
    h.post.mockImplementation(async (_u: string, b?: { domain?: string }) => b?.domain === 'chat_agent' ? { data: { result: { answer: 'Cut fillers.' } } } : { data: {} });
    await click(/Coach/);
    expect(view.container.textContent).toMatch(/Cut fillers/);
    h.runDomain.mockRejectedValue({ response: { data: { error: 'macro down' } } });
    await click(/Analyze/);
    expect(view.container.textContent).toMatch(/macro down/);
  });

  it('restores the bench from its session snapshot', async () => {
    sessionStorage.setItem('concord.voice.bench.v1', JSON.stringify({ transcript: 'saved words', duration: '3', keywords: 'a,b', analyzeResult: ANALYZE, mintedDtuId: 'dtu-abcdef123', publishedDtuId: 'dtu-pub99999', agentReply: 'earlier tip' }));
    const view = await mount();
    expect((screen.getAllByRole('textbox')[0] as HTMLTextAreaElement).value).toBe('saved words');
    expect(view.container.textContent).toMatch(/Saved|Published|earlier tip/);
  });
});
