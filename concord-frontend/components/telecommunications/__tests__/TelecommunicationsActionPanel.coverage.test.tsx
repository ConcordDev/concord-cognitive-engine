// Behaviour coverage for the telecom NOC bench: capacity / signal / coverage / unit economics,
// mint, DM, publish with recall and the action agent, with validation and failure paths.

import { readAgentReply } from '@/lib/agent-reply';
import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({ runDomain: vi.fn(), post: vi.fn(), del: vi.fn(), publish: vi.fn() }));
const CAP = { totalBandwidth: '10 Gbps', utilization: '72%', activeUsers: 12000, availablePerUser: '0.2 Mbps', usedThroughput: '7.2 Gbps', usedPerUser: '0.6 Mbps', headroom: '28%', status: 'high', upgrade: 'Add a carrier' };
const SIG = { snr: '28 dB', bitErrorRate: 0.0001, latencyMs: 40, jitterMs: 5, mosScore: 4.1, voiceQuality: 'good', videoCapable: true };
const COV = { towers: 5, activeTowers: 4, totalCoverageKm2: 120.5, technologies: ['LTE', '5G'], coverageReason: 'rural gaps' };
const COST = { subscribers: 1000, arpu: 40, costPerSubscriber: 25, margin: 15, marginPercent: 37.5, profitable: true, breakeven: '14 months', breakevenMonths: 14, monthlyRevenue: 40000, infrastructurePerSubscriber: 8, costBasis: 'ops + infra' };
let covOverride: unknown = null;

vi.mock('@/lib/api/client', () => ({
  api: { post: (...a: unknown[]) => h.post(...a), delete: (...a: unknown[]) => h.del(...a) },
  apiHelpers: { lens: { runDomain: (...a: unknown[]) => h.runDomain(...a) } },
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

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
const click = async (name: RegExp) => { await act(async () => { fireEvent.click(screen.getByRole('button', { name })); await new Promise((r) => setTimeout(r, 20)); }); };
const fill = async (ph: RegExp, value: string) => { await act(async () => { fireEvent.change(screen.getByPlaceholderText(ph), { target: { value } }); }); };
const mount = async () => { const { TelecommunicationsActionPanel } = await import('../TelecommunicationsActionPanel'); const v = render(<TelecommunicationsActionPanel />); await settle(); return v; };
afterEach(() => cleanup());
beforeEach(() => {
  covOverride = null;
  Object.values(h).forEach((f) => f.mockReset());
  h.runDomain.mockImplementation(async (_d: string, action: string) => ({ data: { ok: true, result: action === 'networkCapacity' ? CAP : action === 'signalQuality' ? SIG : action === 'coverageMap' ? (covOverride ?? COV) : COST } }));
  h.post.mockImplementation(async (url: string, body?: { domain?: string }) => {
    if (body?.domain === 'dtu') return { data: { result: { dtu: { id: 'dtu-abcdefgh1' } } } };
    if (body?.domain === 'chat_agent') return { data: { result: { summary: { capex: 'add carrier' } } } };
    if (url.includes('/publish')) return { data: { ok: true } };
    return { data: { ok: true, message: { id: 'msg-1' } } };
  });
});

describe('TelecommunicationsActionPanel', () => {
  it('validates each bench, then renders capacity, signal, coverage and unit economics', async () => {
    const v = await mount();
    for (const n of [/^Capacity/, /^Signal/, /^Coverage/, /^Unit econ/]) await click(n);
    expect(v.container.textContent).toMatch(/Infra \+ ops \+ subs \+ ARPU required/);
    await fill(/BW Gbps/i, '10'); await fill(/Util %/i, '72'); await fill(/Active users/i, '12000');
    await click(/^Capacity/);
    await fill(/SNR/i, '28'); await fill(/BER/i, '0.0001'); await fill(/Latency/i, '40'); await fill(/Jitter/i, '5');
    await click(/^Signal/);
    const towers = screen.getAllByRole('textbox').find((e) => e.tagName === 'TEXTAREA') as HTMLElement;
    await act(async () => { fireEvent.change(towers, { target: { value: '{bad json' } }); });
    await click(/^Coverage/);
    expect(v.container.textContent).toMatch(/Invalid towers JSON/);
    await act(async () => { fireEvent.change(towers, { target: { value: '[{"id":"t1"}]' } }); });
    await click(/^Coverage/);
    await fill(/Infra \$/i, '500000'); await fill(/Ops\/mo/i, '20000'); await fill(/^Subs$/i, '1000'); await fill(/ARPU/i, '40');
    await click(/^Unit econ/);
    expect(v.container.textContent).toMatch(/Capacity · high/);
    expect(v.container.textContent).toMatch(/Signal · good/);
    expect(v.container.textContent).toMatch(/120.5/);
    expect(v.container.textContent).toMatch(/37.5% margin/);
    expect(h.publish).toHaveBeenCalled();
  });

  it('renders an unmeasured-coverage message and null ranges honestly', async () => {
    covOverride = { message: 'No tower data' };
    const v = await mount();
    const towers = screen.getAllByRole('textbox').find((e) => e.tagName === 'TEXTAREA') as HTMLElement;
    await act(async () => { fireEvent.change(towers, { target: { value: '[]' } }); });
    await click(/^Coverage/);
    expect(v.container.textContent).toMatch(/No tower data/);
    covOverride = { towers: 3, activeTowers: 3, totalCoverageKm2: null, technologies: [], coverageReason: 'no heights' };
    await click(/^Coverage/);
    expect(v.container.textContent).toMatch(/Not recorded: no heights/);
  });

  it('mints, DMs and publishes with recall, then runs the action agent', async () => {
    const v = await mount();
    await click(/^DM/);
    expect(v.container.textContent).toMatch(/Recipient required/);
    await click(/Publish/);
    expect(v.container.textContent).toMatch(/Run cap\/sig first/);
    await fill(/BW Gbps/i, '10'); await fill(/Util %/i, '72'); await fill(/Active users/i, '12000');
    await click(/^Capacity/);
    await click(/^Mint/);
    expect(v.container.textContent).toMatch(/Network DTU dtu-abcd/);
    await fill(/DM recipient/i, 'friend-1');
    await click(/^DM/);
    expect(h.post).toHaveBeenCalledWith('/api/social/dm', expect.objectContaining({ toUserId: 'friend-1' }));
    await click(/Publish/);
    expect(h.post).toHaveBeenCalledWith(expect.stringContaining('/publish'));
    await click(/^Action/);
    expect(v.container.textContent).toMatch(/Action ready/);
    h.post.mockImplementation(async () => ({ data: {} }));
    await click(/^Action/);
    expect(v.container.textContent).toMatch(/finished without writing anything/);
    await click(/^Mint|Saved/);
    expect(v.container.textContent).toMatch(/No DTU id/);
  });

  it('reports macro failures with the server message', async () => {
    h.runDomain.mockRejectedValue({ response: { data: { error: 'noc offline' } } });
    const v = await mount();
    await fill(/BW Gbps/i, '10'); await fill(/Util %/i, '72'); await fill(/Active users/i, '12000');
    await click(/^Capacity/);
    expect(v.container.textContent).toMatch(/noc offline/);
    h.runDomain.mockResolvedValue({});
    await click(/^Capacity/);
    h.post.mockRejectedValue(new Error('dm failed'));
    await fill(/DM recipient/i, 'x');
    await click(/^DM/);
    expect(v.container.textContent).toMatch(/dm failed/);
  });
});
