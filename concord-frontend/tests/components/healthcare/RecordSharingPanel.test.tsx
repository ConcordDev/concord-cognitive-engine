import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));
vi.mock('@/lib/utils', () => ({ cn: (...a: unknown[]) => a.filter(Boolean).join(' ') }));

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props }),
    );
    Icon.displayName = name;
    return Icon;
  };
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(actual)) {
    if (k[0] >= 'A' && k[0] <= 'Z' && k !== 'createLucideIcon' && k !== 'default') o[k] = make(k);
  }
  return { ...actual, ...o };
});

import { RecordSharingPanel } from '@/components/healthcare/RecordSharingPanel';

const grants = [
  { id: 'g1', patientId: 'p1', proxyName: 'Mom', proxyEmail: 'mom@x.com', relationship: 'parent',
    accessLevel: 'full', status: 'active', grantedAt: '2026-05-01T00:00:00Z', revokedAt: null, expiresOn: '2027-01-01' },
  { id: 'g2', patientId: 'p1', proxyName: 'Old Proxy', proxyEmail: '', relationship: 'caregiver',
    accessLevel: 'view', status: 'revoked', grantedAt: '2026-01-01T00:00:00Z', revokedAt: '2026-04-01', expiresOn: '' },
];

beforeEach(() => {
  global.URL.createObjectURL = vi.fn(() => 'blob:url');
  global.URL.revokeObjectURL = vi.fn();
});

describe('RecordSharingPanel', () => {
  beforeEach(() => { lensRun.mockReset(); });

  it('shows the loading then empty state', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { grants: [] } } });
    render(<RecordSharingPanel patientId="p1" />);
    await waitFor(() => expect(screen.getByText(/No proxy access granted/)).toBeInTheDocument());
  });

  it('renders proxy grants with active and revoked statuses', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { grants } } });
    render(<RecordSharingPanel patientId="p1" />);
    await waitFor(() => expect(screen.getByText('Mom')).toBeInTheDocument());
    expect(screen.getByText('Old Proxy')).toBeInTheDocument();
    expect(screen.getByText(/1 active/)).toBeInTheDocument();
  });

  it('exports a full FHIR record and shows the confirmation', async () => {
    lensRun.mockImplementation((d: string, a: string) => {
      if (a === 'fhir-export') {
        return Promise.resolve({ data: { ok: true, result: {
          fhirVersion: 'R4', bundle: { resourceType: 'Bundle', type: 'collection', entry: [{}, {}] },
          resourceCount: 2, scope: 'full',
        } } });
      }
      return Promise.resolve({ data: { ok: true, result: { grants: [] } } });
    });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<RecordSharingPanel patientId="p1" />);
    await waitFor(() => screen.getByText(/No proxy access granted/));
    fireEvent.click(screen.getByRole('button', { name: /Export full record/ }));
    await waitFor(() => expect(screen.getByText(/Exported FHIR R4 Bundle/)).toBeInTheDocument());
    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  it('exports immunizations only', async () => {
    lensRun.mockImplementation((d: string, a: string) => {
      if (a === 'fhir-export') {
        return Promise.resolve({ data: { ok: true, result: {
          fhirVersion: 'R4', bundle: { resourceType: 'Bundle', type: 'collection', entry: [{}] },
          resourceCount: 1, scope: 'immunizations',
        } } });
      }
      return Promise.resolve({ data: { ok: true, result: { grants: [] } } });
    });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<RecordSharingPanel patientId="p1" />);
    await waitFor(() => screen.getByText(/No proxy access granted/));
    fireEvent.click(screen.getByRole('button', { name: /Immunizations only/ }));
    await waitFor(() => expect(screen.getByText(/1 resource/)).toBeInTheDocument());
    clickSpy.mockRestore();
  });

  it('toggles the grant form and does not grant when name is blank', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { grants: [] } } });
    render(<RecordSharingPanel patientId="p1" />);
    await waitFor(() => screen.getByText(/No proxy access granted/));
    fireEvent.click(screen.getByRole('button', { name: /Grant access/ }));
    lensRun.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /^Grant$/ }));
    expect(lensRun).not.toHaveBeenCalled();
  });

  it('grants proxy access when a name is provided', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { grants: [] } } });
    render(<RecordSharingPanel patientId="p1" />);
    await waitFor(() => screen.getByText(/No proxy access granted/));
    fireEvent.click(screen.getByRole('button', { name: /Grant access/ }));
    fireEvent.change(screen.getByPlaceholderText(/Proxy name/), { target: { value: 'Dad' } });
    lensRun.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /^Grant$/ }));
    await waitFor(() => expect(lensRun.mock.calls.some((c) => c[1] === 'proxy-grant')).toBe(true));
  });

  it('revokes an active grant', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { grants } } });
    render(<RecordSharingPanel patientId="p1" />);
    await waitFor(() => screen.getByText('Mom'));
    lensRun.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Revoke/ }));
    await waitFor(() => expect(lensRun.mock.calls.some((c) => c[1] === 'proxy-revoke')).toBe(true));
  });

  it('handles a refresh error gracefully', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    lensRun.mockRejectedValue(new Error('x'));
    render(<RecordSharingPanel patientId="p1" />);
    await waitFor(() => expect(screen.getByText(/No proxy access granted/)).toBeInTheDocument());
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
