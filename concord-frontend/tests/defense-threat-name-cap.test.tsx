/**
 * FIX-defense-010 — a 300-character threat name was accepted by the form and
 * then refused server-side (max 100), reading as accepted-but-unsaved. Pin:
 * the ThreatBoard name field carries the server's cap with a live counter.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async () => ({ data: { ok: true, result: { threats: [], total: 0, bySeverity: {}, byStatus: {} } } })),
}));

import { ThreatBoard } from '@/components/defense/ThreatBoard';

describe('FIX-defense-010 — threat name field cap', () => {
  it('caps the name at the server limit of 100 with a counter', async () => {
    render(<ThreatBoard />);
    const input = (await screen.findByPlaceholderText('Threat name')) as HTMLInputElement;
    expect(input.maxLength).toBe(100);
    fireEvent.change(input, { target: { value: 'x'.repeat(40) } });
    expect(screen.getByText((_, el) => el?.tagName === 'SPAN' && el.textContent === '40/100')).toBeTruthy();
  });
});
