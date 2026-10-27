import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import LowConfidenceTag from './LowConfidenceTag';

const REASON = 'GPU brain offline — answered by small local model';

describe('LowConfidenceTag', () => {
  it('renders the label with the server reason as title and aria-label when confidence is low', () => {
    render(<LowConfidenceTag confidence="low" reason={REASON} />);
    const tag = screen.getByText('Low confidence, backup model');
    expect(tag.getAttribute('title')).toBe(REASON);
    expect(screen.getByLabelText(REASON)).toBe(tag);
  });

  it('falls back to the label as its title when no reason is sent', () => {
    render(<LowConfidenceTag confidence="low" />);
    expect(screen.getByText('Low confidence, backup model').getAttribute('title')).toBe('Low confidence, backup model');
  });

  it('renders nothing for an undefined confidence', () => {
    const { container } = render(<LowConfidenceTag confidence={undefined} reason={REASON} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for a high confidence', () => {
    const { container } = render(<LowConfidenceTag confidence="high" reason={REASON} />);
    expect(container.firstChild).toBeNull();
  });
});
