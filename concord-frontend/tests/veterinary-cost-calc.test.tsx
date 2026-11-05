import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRunMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/client', () => ({
  lensRun: lensRunMock,
}));

import { CalculatorsPanel } from '@/components/veterinary/CalculatorsPanel';

describe('veterinary CostCalc', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
  });

  it('names the procedures with no price when the estimate is not_recorded', async () => {
    lensRunMock.mockResolvedValue({
      data: {
        ok: true,
        error: null,
        result: {
          procedures: [],
          totalEstimate: null,
          reason: 'not_recorded',
          unavailable: ['dental', 'procedures[1]'],
          tip: null,
        },
      },
    });

    render(<CalculatorsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'dental' }));
    fireEvent.click(screen.getByRole('button', { name: 'Estimate' }));

    expect(await screen.findByText('Not recorded: dental, an unnamed procedure')).toBeInTheDocument();
    expect(lensRunMock).toHaveBeenCalledWith('veterinary', 'costEstimate', {
      procedures: [{ type: 'dental' }],
    });
  });

  it('falls back to the server message instead of a blank when nothing is unavailable', async () => {
    lensRunMock.mockResolvedValue({
      data: { ok: true, error: null, result: { message: 'Add procedures to estimate costs.' } },
    });

    render(<CalculatorsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Estimate' }));

    await waitFor(() => {
      expect(screen.getByText('Add procedures to estimate costs.')).toBeInTheDocument();
    });
  });
});

/**
 * lens-run hands the input object to the handler as artifact.data, so the
 * handlers read fields at the top level. A `data` wrapper here would be
 * silently ignored server-side, so each calculator's input must be flat.
 */
describe('veterinary calculators send flat lensRun input', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
    lensRunMock.mockResolvedValue({ data: { ok: true, error: null, result: {} } });
  });

  it('triageAssess sends species, age and symptoms without a data wrapper', async () => {
    render(<CalculatorsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'seizure' }));
    fireEvent.click(screen.getByRole('button', { name: 'Assess' }));

    await waitFor(() => {
      expect(lensRunMock).toHaveBeenCalledWith('veterinary', 'triageAssess', {
        species: 'dog',
        age: 3,
        symptoms: ['seizure'],
      });
    });
  });

  it('weightCheck sends species, breed and weight without a data wrapper', async () => {
    render(<CalculatorsPanel />);
    fireEvent.change(screen.getByPlaceholderText('Breed'), { target: { value: 'beagle' } });
    fireEvent.change(screen.getByPlaceholderText('lbs'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));

    await waitFor(() => {
      expect(lensRunMock).toHaveBeenCalledWith('veterinary', 'weightCheck', {
        species: 'dog',
        breed: 'beagle',
        weight: 25,
      });
    });
  });

  it('a blank weight is not sent as 0', async () => {
    render(<CalculatorsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));

    expect(await screen.findByText('Weight not recorded')).toBeInTheDocument();
    expect(lensRunMock.mock.calls.filter((c) => c[1] === 'weightCheck')).toHaveLength(0);
  });

  it('a chosen patient sends only patientId', async () => {
    lensRunMock.mockImplementation(async (_domain: string, name: string) => {
      if (name === 'patient-list') {
        return { data: { ok: true, error: null, result: { patients: [{ id: 'p1', name: 'Rex', species: 'dog' }] } } };
      }
      return { data: { ok: true, error: null, result: { status: 'ADVISORY', scope: 'patient', vaccines: [] } } };
    });
    render(<CalculatorsPanel />);
    const pickers = await screen.findAllByLabelText('Patient');
    fireEvent.change(pickers[1], { target: { value: 'p1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Build schedule' }));

    await waitFor(() => {
      expect(lensRunMock).toHaveBeenCalledWith('veterinary', 'vaccineSchedule', { patientId: 'p1' });
    });
  });

  it('vaccineSchedule sends species and age without a data wrapper', async () => {
    render(<CalculatorsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Build schedule' }));

    await waitFor(() => {
      expect(lensRunMock).toHaveBeenCalledWith('veterinary', 'vaccineSchedule', {
        species: 'dog',
        age: 1,
      });
    });
  });

  it('no calculator call nests its fields under data', async () => {
    render(<CalculatorsPanel />);
    fireEvent.change(screen.getByPlaceholderText('lbs'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Assess' }));
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    fireEvent.click(screen.getByRole('button', { name: 'Build schedule' }));
    fireEvent.click(screen.getByRole('button', { name: 'Estimate' }));

    await waitFor(() => {
      const calcCalls = lensRunMock.mock.calls.filter((c) => c[1] !== 'patient-list');
      expect(calcCalls).toHaveLength(4);
    });
    for (const [, name, input] of lensRunMock.mock.calls) {
      if (name === 'patient-list') continue;
      expect(input).not.toHaveProperty('data');
    }
  });
});
