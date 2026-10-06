/** DuctDesigner — sizes through hvac.ductulator and checks hangers through hvac.hangerSpanCheck. */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRunMock(...a) }));

import { DuctDesigner } from '@/components/hvac/DuctDesigner';

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation((_d: string, action: string) => Promise.resolve({ data: { ok: true, result: action === 'ductulator'
    ? { equivalentRoundDiameterIn: 12.77, nearestStandardRoundIn: 14, velocityFpm: 900, velocityAtStandardSizeFpm: 748, frictionRatePer100ft: 0.09, frictionAtStandardSizePer100ft: 0.058, velocityBand: 'branch duct range', recommendation: 'At 900 fpm design velocity, 800 CFM needs a 14" round duct' }
    : { pass: false, maxDeflectionIn: 0.31, allowableDeflectionIn: 0.267, deflectionRatio: 'L/360', actualRatio: 'L/310', selfWeightLbPerFt: 4.12, totalLoadLbPerFt: 4.62, maxUtilization: 0.12, recommendation: '8ft hanger spacing exceeds L/360' } } }));
});

describe('DuctDesigner', () => {
  it('sizes a duct with the engine-known material keys', async () => {
    render(<DuctDesigner />);
    fireEvent.change(screen.getByLabelText('Material'), { target: { value: 'flexible' } });
    fireEvent.click(screen.getByRole('button', { name: /size duct/i }));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('hvac', 'ductulator', expect.objectContaining({ cfm: 800, shape: 'round', method: 'velocity', velocityFpm: 900, material: 'flexible' })));
    await screen.findByText('14"');
  });

  it('checks hanger spacing and shows a failing span honestly', async () => {
    render(<DuctDesigner />);
    fireEvent.change(screen.getByLabelText('Hanger spacing (ft)'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: /check hangers/i }));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('hvac', 'hangerSpanCheck', expect.objectContaining({ spanFt: 10, insulationLbPerFt: 0.5, deflectionLimitRatio: 360 })));
    await screen.findByText(/exceeds L\/360/);
  });
});
