/// <reference types="@testing-library/jest-dom/vitest" />
/**
 * INC-SWEEP law F4 — ContractPlaybooks must distinguish loading / error /
 * genuinely-empty. A non-ok playbook-list must never render
 * "No playbooks available."
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();

vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props })
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

import { ContractPlaybooks } from '@/components/law/ContractPlaybooks';

describe('ContractPlaybooks list states (F4)', () => {
  beforeEach(() => {
    lensRun.mockReset();
  });

  it('non-ok list response renders the error state, never the empty copy', async () => {
    lensRun.mockResolvedValue({ data: { ok: false, error: 'busy_retry' } });
    render(<ContractPlaybooks />);
    await waitFor(() => expect(screen.getByTestId('playbooks-error')).toBeInTheDocument());
    expect(screen.getByText(/busy_retry|Could not load playbooks/i)).toBeInTheDocument();
    expect(screen.queryByTestId('playbooks-empty')).not.toBeInTheDocument();
    expect(screen.queryByText('No playbooks available.')).not.toBeInTheDocument();
  });

  it('ok with [] renders the empty copy', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { playbooks: [] } } });
    render(<ContractPlaybooks />);
    await waitFor(() => expect(screen.getByTestId('playbooks-empty')).toBeInTheDocument());
    expect(screen.getByText('No playbooks available.')).toBeInTheDocument();
    expect(screen.queryByTestId('playbooks-error')).not.toBeInTheDocument();
  });

  it('ok with rows renders the playbook rows', async () => {
    lensRun.mockResolvedValue({
      data: {
        ok: true,
        result: {
          playbooks: [
            {
              id: 'nda',
              name: 'Mutual NDA',
              description: 'Two-way confidentiality',
              contractType: 'nda',
              clauseCount: 4,
            },
          ],
        },
      },
    });
    render(<ContractPlaybooks />);
    await waitFor(() => expect(screen.getByText('Mutual NDA')).toBeInTheDocument());
    expect(screen.getByText(/4 pre-approved clauses/)).toBeInTheDocument();
    expect(screen.queryByText('No playbooks available.')).not.toBeInTheDocument();
    expect(screen.queryByTestId('playbooks-error')).not.toBeInTheDocument();
  });

  it('retry on error re-fetches playbook-list', async () => {
    lensRun
      .mockResolvedValueOnce({ data: { ok: false, error: 'service_overloaded' } })
      .mockResolvedValueOnce({
        data: {
          ok: true,
          result: {
            playbooks: [
              { id: 'svc', name: 'Services Agreement', description: 'MSA', contractType: 'services', clauseCount: 6 },
            ],
          },
        },
      });
    render(<ContractPlaybooks />);
    await waitFor(() => expect(screen.getByTestId('playbooks-error')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Retry/i }));
    await waitFor(() => expect(screen.getByText('Services Agreement')).toBeInTheDocument());
    expect(lensRun).toHaveBeenCalledTimes(2);
    expect(lensRun.mock.calls.every(([d, m]) => d === 'law' && m === 'playbook-list')).toBe(true);
  });
});
