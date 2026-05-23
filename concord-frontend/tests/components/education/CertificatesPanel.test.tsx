import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { CertificatesPanel } from '@/components/education/CertificatesPanel';

const CERTS = [
  {
    id: 'cert1', courseTitle: 'Calculus I', institution: 'MIT', instructor: 'Dr. Strang',
    issuedAt: '2026-01-15T00:00:00Z', verificationCode: 'VC-ABC-123',
  },
  {
    id: 'cert2', courseTitle: 'Physics', institution: '', instructor: '',
    issuedAt: '2026-02-20T00:00:00Z', verificationCode: 'VC-XYZ-789',
  },
];

describe('CertificatesPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: { certificates: [] } } });
  });

  it('shows the empty state when there are no certificates', async () => {
    render(<CertificatesPanel />);
    expect(await screen.findByText(/No certificates yet/)).toBeInTheDocument();
  });

  it('renders certificates including default institution fallback', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { certificates: CERTS } } });
    render(<CertificatesPanel />);
    expect(await screen.findByText('Calculus I')).toBeInTheDocument();
    expect(screen.getByText('MIT · Dr. Strang')).toBeInTheDocument();
    // cert2 has no institution -> falls back to "Concord University"
    expect(screen.getByText('Concord University')).toBeInTheDocument();
    expect(screen.getByText('VC-ABC-123')).toBeInTheDocument();
  });

  it('copies a verification code to clipboard', async () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    lensRun.mockResolvedValue({ data: { ok: true, result: { certificates: CERTS } } });
    render(<CertificatesPanel />);
    await screen.findByText('Calculus I');
    const copyBtns = screen.getAllByRole('button');
    fireEvent.click(copyBtns[0]);
    expect(writeText).toHaveBeenCalledWith('VC-ABC-123');
  });

  it('tolerates a fetch rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<CertificatesPanel />);
    await waitFor(() => expect(screen.getByText(/No certificates yet/)).toBeInTheDocument());
  });
});
