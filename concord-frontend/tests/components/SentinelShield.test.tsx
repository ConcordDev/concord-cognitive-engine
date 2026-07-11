/**
 * SentinelShield — pins the Fortify Suite wiring added to close the
 * "unsurfaced real macro" gap found in the Wave 3 sentinel audit:
 * shield.surgeon / shield.guardian / shield.prophet / shield.sweep /
 * shield.report / shield.firewall / shield.predictions had real depth in
 * server/lib/concord-shield.js (attack-vector analysis, neutralization
 * playbooks, iptables-style rule synthesis, technique-escalation
 * prediction) but zero UI caller before this pass. These tests exercise
 * the panel against the real macro response shapes (verified against
 * server/server.js's shield.* registrations), not fabricated ones.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, fireEvent, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { SentinelShield } from '@/components/sentinel/SentinelShield';

const envelope = (result: unknown) => ({ data: { ok: true, result, error: null } });

const THREAT = {
  id: 'threat-1',
  severity: 'high',
  subtype: 'trojan',
  description: 'Suspicious beacon',
  vector: 'email',
};

// shield.surgeon's real return shape (server/lib/concord-shield.js#runSurgeon).
const SURGEON_RESULT = {
  ok: true,
  analysis: {
    attackVector: 'email',
    techniques: ['persistence'],
    severityAssessment: { level: 'high', score: 7 },
    neutralizationProcedure: {
      immediate: ['Kill suspicious processes'],
      shortTerm: ['Remove persistence mechanisms'],
      longTerm: ['Consider full system reinstall for rootkit infections'],
    },
  },
  neutralization: null,
  engine: 'surgeon',
};

// shield.guardian's real return shape — `rules` is an array of raw rule-text
// STRINGS (not objects), distinct from shield.firewall's DTU-object shape.
const GUARDIAN_RESULT = {
  ok: true,
  rules: ['iptables -A INPUT -j DROP # trojan'],
  suricataRule: 'alert http any any -> any any (msg:"trojan";)',
  snortRule: 'alert tcp any any -> any any (msg:"trojan";)',
  engine: 'guardian',
  threatId: 'threat-1',
};

function baseImpl(overrides: Record<string, (input?: unknown) => unknown> = {}) {
  return (domain: string, action: string, input?: unknown) => {
    const key = `${domain}.${action}`;
    if (overrides[key]) return Promise.resolve(overrides[key](input));
    if (key === 'shield.status') {
      return Promise.resolve(envelope({ securityScore: 82, shieldStatus: { initialized: true, threatIndexSize: 3 } }));
    }
    if (key === 'shield.threats') return Promise.resolve(envelope({ threats: [THREAT], count: 1 }));
    if (key === 'shield.metrics') return Promise.resolve(envelope({ ok: true, version: '1.0.0' }));
    if (key === 'shield.firewall') return Promise.resolve(envelope({ ok: true, rules: [], count: 0 }));
    if (key === 'shield.predictions') return Promise.resolve(envelope({ ok: true, predictions: [], count: 0 }));
    return Promise.resolve(envelope({}));
  };
}

beforeEach(() => {
  lensRunMock.mockReset();
});

async function renderShield(overrides?: Record<string, (input?: unknown) => unknown>) {
  lensRunMock.mockImplementation(baseImpl(overrides));
  let view: ReturnType<typeof render>;
  await act(async () => { view = render(<SentinelShield />); });
  return view!;
}

describe('SentinelShield — Fortify Suite wiring', () => {
  it('loads the threat board from shield.threats', async () => {
    const view = await renderShield();
    await waitFor(() => expect(view.getByText('Suspicious beacon')).toBeInTheDocument());
  });

  it('Investigate runs shield.surgeon + shield.guardian and renders the real analysis shape', async () => {
    const view = await renderShield({
      'shield.surgeon': () => envelope(SURGEON_RESULT),
      'shield.guardian': () => envelope(GUARDIAN_RESULT),
    });
    await waitFor(() => expect(view.getByText('Suspicious beacon')).toBeInTheDocument());

    await act(async () => { fireEvent.click(view.getByText('Investigate')); });

    // Surgeon's neutralization procedure renders.
    await waitFor(() => expect(view.getByText('Kill suspicious processes')).toBeInTheDocument());
    expect(view.getByText('Remove persistence mechanisms')).toBeInTheDocument();

    // Guardian's rule — a raw STRING, not an object with `.rule` — must
    // render as-is via the ruleText() normalizer, not "[object Object]" or
    // a JSON-stringified wrapper.
    expect(view.getByText('iptables -A INPUT -j DROP # trojan')).toBeInTheDocument();

    // shield.surgeon/shield.guardian were called with the threat id.
    const surgeonCall = lensRunMock.mock.calls.find((c) => c[0] === 'shield' && c[1] === 'surgeon');
    expect(surgeonCall?.[2]).toMatchObject({ threatId: 'threat-1' });
    const guardianCall = lensRunMock.mock.calls.find((c) => c[0] === 'shield' && c[1] === 'guardian');
    expect(guardianCall?.[2]).toMatchObject({ threatId: 'threat-1' });
  });

  it('Investigate is idempotent — a second click on the same threat does not re-fetch', async () => {
    const view = await renderShield({
      'shield.surgeon': () => envelope(SURGEON_RESULT),
      'shield.guardian': () => envelope(GUARDIAN_RESULT),
    });
    await waitFor(() => expect(view.getByText('Suspicious beacon')).toBeInTheDocument());

    await act(async () => { fireEvent.click(view.getByText('Investigate')); });
    await waitFor(() => expect(view.getByText('Kill suspicious processes')).toBeInTheDocument());
    const before = lensRunMock.mock.calls.filter((c) => c[1] === 'surgeon').length;

    // Collapse then re-expand — cached, no new fetch.
    await act(async () => { fireEvent.click(view.getByText('Investigate')); });
    await act(async () => { fireEvent.click(view.getByText('Investigate')); });
    const after = lensRunMock.mock.calls.filter((c) => c[1] === 'surgeon').length;
    expect(after).toBe(before);
  });

  it('Full sweep calls shield.sweep and shows the real result summary', async () => {
    const sweepResult = {
      sweep: {
        sweepId: 'sweep-1', status: 'complete', scanCount: 12, cleanCount: 10,
        threatsFound: [{ dtuId: 'd1' }, { dtuId: 'd2' }], durationMs: 340, toolsUsed: ['clamav'],
      },
    };
    const view = await renderShield({ 'shield.sweep': () => envelope(sweepResult) });
    await waitFor(() => expect(view.getByText('Suspicious beacon')).toBeInTheDocument());

    await act(async () => { fireEvent.click(view.getByText('Run full sweep')); });
    await waitFor(() => expect(view.getByText(/Sweep complete: 12 scanned, 2 found, 10 clean/)).toBeInTheDocument());

    expect(lensRunMock.mock.calls.some((c) => c[0] === 'shield' && c[1] === 'sweep')).toBe(true);
  });

  it('Report a threat submits shield.report with the form fields and shows the honest response message', async () => {
    const view = await renderShield({
      'shield.report': (input) => {
        expect(input).toMatchObject({ subtype: 'exploit', description: 'observed a weird macro doc' });
        return envelope({ status: 'new_threat', message: 'Thank you for reporting. This threat has been added to the collective threat lattice.' });
      },
    });
    await waitFor(() => expect(view.getByText('Suspicious beacon')).toBeInTheDocument());

    await act(async () => { fireEvent.click(view.getByText('Report a threat')); });
    const textarea = view.getByPlaceholderText('Describe what you observed…');
    await act(async () => { fireEvent.change(textarea, { target: { value: 'observed a weird macro doc' } }); });
    await act(async () => { fireEvent.click(view.getByText('Submit report')); });

    await waitFor(() => expect(view.getByText(/added to the collective threat lattice/)).toBeInTheDocument());
  });

  it('Prophet with insufficient samples shows an honest message, not a fabricated prediction', async () => {
    const view = await renderShield({
      'shield.prophet': () => envelope({ ok: true, predictions: [], reason: 'insufficient_data' }),
    });
    await waitFor(() => expect(view.getByText('Suspicious beacon')).toBeInTheDocument());

    const familyInput = view.getByLabelText('Threat family');
    await act(async () => { fireEvent.change(familyInput, { target: { value: 'trojan' } }); });
    await act(async () => { fireEvent.click(view.getByText('Run Prophet')); });

    await waitFor(() => expect(view.getByText(/Not enough "trojan" samples yet/)).toBeInTheDocument());
  });

  it('renders the Fortifications feed from shield.firewall + shield.predictions (real DTU-object rule shape)', async () => {
    const view = await renderShield({
      'shield.firewall': () => envelope({ ok: true, rules: [{ id: 'fw_1', rule: '# block ransomware\niptables -A INPUT -j DROP' }], count: 1 }),
      'shield.predictions': () => envelope({ ok: true, predictions: [{ id: 'pred_1', family: 'ransomware', predictedVariant: 'ransomware_predicted_x', confidence: 0.4 }], count: 1 }),
    });
    await waitFor(() => expect(view.getByText(/# block ransomware/)).toBeInTheDocument());
    expect(view.getByText('ransomware_predicted_x')).toBeInTheDocument();
  });
});
