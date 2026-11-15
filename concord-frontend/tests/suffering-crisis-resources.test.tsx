// FIX-suffering-002 — the Suffering lens showed only a "Not medical advice"
// disclaimer; a sensitive-topic lens must also show crisis/support resources.
// Pins the strip's real lines (the same verified numbers the Mental Health
// lens's crisis-hotlines registry serves: 988, Crisis Text Line 741741).
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CrisisResources } from '@/components/suffering/CrisisResources';

describe('CrisisResources (suffering lens)', () => {
  it('shows the 988 Suicide and Crisis Lifeline', () => {
    render(<CrisisResources />);
    const note = screen.getByLabelText('Crisis and support resources');
    expect(note.textContent).toContain('988');
    expect(note.textContent).toContain('Suicide and Crisis Lifeline');
    expect(note.textContent).toContain('24/7');
  });

  it('shows the Crisis Text Line and emergency numbers', () => {
    render(<CrisisResources />);
    const note = screen.getByLabelText('Crisis and support resources');
    expect(note.textContent).toContain('HOME');
    expect(note.textContent).toContain('741741');
    expect(note.textContent).toContain('911');
    expect(note.textContent).toContain('112');
  });

  it('points to the Mental Health lens for the full registry', () => {
    render(<CrisisResources />);
    const link = screen.getByRole('link', { name: /Mental Health lens/ });
    expect(link.getAttribute('href')).toBe('/lenses/mental-health');
  });
});
