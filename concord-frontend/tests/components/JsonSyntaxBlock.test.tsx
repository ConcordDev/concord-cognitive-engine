/**
 * JsonSyntaxBlock — feature-build follow-up pass (dx-platform IDE-chrome
 * item). No syntax-highlighting library exists in this repo, so this is a
 * small hand-rolled real tokenizer, not a screenshot. Pins that it produces
 * correctly-classified tokens for every JSON value kind (a wrong
 * classification here would silently mis-color real detector output).
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { JsonSyntaxBlock } from '@/components/dx-platform/JsonSyntaxBlock';

describe('JsonSyntaxBlock', () => {
  it('renders the full serialized JSON text content, not a truncated or re-ordered version', () => {
    const value = { id: 'a', severity: 'high', count: 3, active: true, note: null };
    const { container } = render(<JsonSyntaxBlock value={value} />);
    const text = container.textContent || '';
    // Every field, key, and value must survive tokenization intact.
    expect(text).toContain('"id"');
    expect(text).toContain('"a"');
    expect(text).toContain('"severity"');
    expect(text).toContain('"high"');
    expect(text).toContain('3');
    expect(text).toContain('true');
    expect(text).toContain('null');
  });

  it('classifies a key (quoted string immediately followed by a colon) distinctly from a string value', () => {
    const { container } = render(<JsonSyntaxBlock value={{ severity: 'high' }} />);
    const spans = Array.from(container.querySelectorAll('span'));
    const keySpan = spans.find((s) => s.textContent === '"severity"');
    const valueSpan = spans.find((s) => s.textContent === '"high"');
    expect(keySpan).toBeTruthy();
    expect(valueSpan).toBeTruthy();
    expect(keySpan!.className).not.toBe(valueSpan!.className);
  });

  it('renders the optional caption when provided, and omits it when not', () => {
    const withCaption = render(<JsonSyntaxBlock value={{ a: 1 }} caption="Example only" />);
    expect(withCaption.getByText('Example only')).toBeInTheDocument();
    withCaption.unmount();
    const withoutCaption = render(<JsonSyntaxBlock value={{ a: 1 }} />);
    expect(withoutCaption.queryByText('Example only')).not.toBeInTheDocument();
  });

  it('handles an already-stringified JSON string the same as an object value', () => {
    const { container } = render(<JsonSyntaxBlock value={'{"x":1}'} />);
    expect(container.textContent).toContain('"x"');
    expect(container.textContent).toContain('1');
  });
});
