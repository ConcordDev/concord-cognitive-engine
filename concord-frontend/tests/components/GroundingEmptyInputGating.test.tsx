/**
 * GB-1538 / FIX-grounding-003 (FE legs) — the FactGroundingWorkbench's
 * primary actions stayed enabled on empty input and only errored after
 * the click; the handlers already validated, the buttons now carry the
 * same conditions. Also pins the sensor-name field's visible cap: the
 * server slices names at 100 chars (registerSensor), and the register
 * input now declares maxLength={100} so the cap is the field's own.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { FactGroundingWorkbench } from '@/components/grounding/FactGroundingWorkbench';

describe('FactGroundingWorkbench empty-input gating (FIX-grounding-003)', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
    lensRunMock.mockResolvedValue({ data: { ok: true, result: { entries: [], rebuttals: [] } } });
  });
  afterEach(() => { cleanup(); });

  it('Aggregate stays disabled until a claim AND an evidence item exist', () => {
    render(<FactGroundingWorkbench />);
    const btn = screen.getByText(/Aggregate evidence \+ rate confidence/).closest('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText(/Global renewable energy capacity/), {
      target: { value: 'Capacity doubled.' },
    });
    expect(btn.disabled).toBe(true); // claim alone is not enough
    fireEvent.change(screen.getByPlaceholderText(/Evidence excerpt or finding/), {
      target: { value: 'IEA report excerpt' },
    });
    expect(btn.disabled).toBe(false);
  });

  it('Label bias disables when the source list is emptied and re-enables on input', () => {
    render(<FactGroundingWorkbench />);
    fireEvent.click(screen.getByText('Source bias'));
    const btn = screen.getByText(/Label bias & reliability/).closest('button') as HTMLButtonElement;
    const area = screen.getByPlaceholderText(/reuters\.com/);
    // The field ships pre-filled with sample domains — clearing it must
    // disable the action; typing one URL re-enables it.
    fireEvent.change(area, { target: { value: '' } });
    expect(btn.disabled).toBe(true);
    fireEvent.change(area, { target: { value: 'reuters.com' } });
    expect(btn.disabled).toBe(false);
  });

  it('the sensor register name input declares the server cap (maxLength 100)', () => {
    const src = readFileSync(
      join(process.cwd(), 'components/grounding/SensorGroundingPanel.tsx'),
      'utf8',
    );
    const input = src.match(/<input id="sensor-name"[^\n]*/);
    expect(input).not.toBeNull();
    expect(input![0]).toContain('maxLength={100}');
  });
});
