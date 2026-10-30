/**
 * ELNWorkbench ProtocolsTab — validate-protocol wiring (HANDOFF-3
 * batch L15a).
 *
 * The backend `validate-protocol` macro structurally checks a
 * protocol (missing steps, empty step text, critical steps without
 * durations) but no UI called it. This pins the Validate flow: on
 * the Protocols tab, Validate dispatches the real macro and renders
 * its issues inline — here, a warning for a critical step with no
 * duration.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const mocks = vi.hoisted(() => ({ lensRun: vi.fn() }));

vi.mock('@/lib/api/client', () => ({ lensRun: mocks.lensRun }));
vi.mock('@/components/viz', () => ({ ChartKit: () => null }));

import { ELNWorkbench } from '@/components/lab/ELNWorkbench';

const PROTOCOL = {
  id: 'p1', name: 'Western blot', version: 1, category: 'Molecular biology',
  stepCount: 2, totalMinutes: 60, history: [],
  steps: [{ text: 'Prepare gel', order: 1 }, { text: 'Run gel', order: 2 }],
};

describe('ELNWorkbench protocol validation', () => {
  beforeEach(() => {
    mocks.lensRun.mockReset();
    mocks.lensRun.mockImplementation((_domain: string, action: string) => {
      if (action === 'protocol-list') return Promise.resolve({ data: { ok: true, result: { protocols: [PROTOCOL] } } });
      if (action === 'validate-protocol') {
        return Promise.resolve({
          data: {
            ok: true,
            result: {
              valid: true, protocolId: 'p1', issues: [
                { severity: 'warning', code: 'critical_no_duration', message: 'critical step 2 has no duration' },
              ],
            },
          },
        });
      }
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
  });

  it('validates a protocol through the real macro and shows its issues', async () => {
    render(<ELNWorkbench />);
    fireEvent.click(screen.getByRole('button', { name: /Protocols/ }));
    await screen.findByText('Western blot');
    fireEvent.click(screen.getByRole('button', { name: /Validate/ }));
    await waitFor(() => {
      expect(mocks.lensRun).toHaveBeenCalledWith('lab', 'validate-protocol', { id: 'p1' });
    });
    await screen.findByText('critical step 2 has no duration');
  });
});
