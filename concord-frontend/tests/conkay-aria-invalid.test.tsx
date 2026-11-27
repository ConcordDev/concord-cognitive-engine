/**
 * FIX-conkay-001 — ConKay's parameter fields announced a rejected
 * input with a role="alert" message but never set aria-invalid on
 * the field, so assistive tech could not tell WHICH field was
 * rejected. NumberField (every dimension + the P load field) and the
 * required-SF input now set aria-invalid=true while their rejection
 * shows, and point aria-describedby at the alert, which carries the
 * matching id.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ParameterPanel } from '@/components/conkay/workspace/ParameterPanel';
import type { StudyInputs } from '@/components/conkay/workspace/useConKayWorkspace';

const inputs: StudyInputs = {
  name: 't',
  dims: { length: 1400, height: 200, flangeWidth: 100, flangeThickness: 10, webThickness: 6 },
  loadN: 5000,
  support: 'simply-supported',
  materialId: 'steel-s355',
  requiredSafetyFactor: null,
};

describe('FIX-conkay-001 — aria-invalid on rejected fields', () => {
  it('the L field gains aria-invalid + describedby when its input is rejected', () => {
    const { container } = render(<ParameterPanel inputs={inputs} materials={[]} onChange={vi.fn()} />);
    const field = container.querySelector('#conkay-dim-length') as HTMLInputElement;
    expect(field).toBeTruthy();
    expect(field.getAttribute('aria-invalid')).toBeNull();
    fireEvent.change(field, { target: { value: 'abc' } });
    fireEvent.blur(field);
    expect(field.getAttribute('aria-invalid')).toBe('true');
    const describedby = field.getAttribute('aria-describedby');
    expect(describedby).toBe('conkay-dim-length-error');
    const alert = container.querySelector(`#${describedby}`);
    expect(alert?.getAttribute('role')).toBe('alert');
    expect(alert?.textContent).toContain('is not a positive length');
  });

  it('the L field takes any length unit and shows the conversion', () => {
    const onChange = vi.fn();
    const { container } = render(<ParameterPanel inputs={inputs} materials={[]} onChange={onChange} />);
    const field = container.querySelector('#conkay-dim-length') as HTMLInputElement;
    fireEvent.change(field, { target: { value: '2 ft 3 in' } });
    fireEvent.blur(field);
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls[0][0].dims.length).toBeCloseTo(685.8, 3);
    expect(container.querySelector('[data-testid="conkay-dim-length-converted"]')?.textContent).toBe('2 ft 3 in = 685.8 mm');
  });

  it('the SF field gains aria-invalid when its input is rejected', () => {
    const { container } = render(<ParameterPanel inputs={inputs} materials={[]} onChange={vi.fn()} />);
    const field = container.querySelector('#conkay-required-sf') as HTMLInputElement;
    fireEvent.change(field, { target: { value: '-5' } });
    fireEvent.blur(field);
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(field.getAttribute('aria-describedby')).toBe('conkay-required-sf-error');
  });
});
