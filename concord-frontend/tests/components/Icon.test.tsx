import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Icon, ICON_PATHS, EMOJI_TO_ICON, type IconName } from '@/components/icons';

describe('Icon component', () => {
  it('renders the SVG body for a known icon', () => {
    const { container } = render(<Icon name="sword" />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg?.innerHTML).toContain('path');
  });

  it('returns null for unknown icon', () => {
    // @ts-expect-error testing fallback
    const { container } = render(<Icon name="not-real" />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('uses ariaLabel for role="img"', () => {
    render(<Icon name="shield" ariaLabel="Defence rating" />);
    const svg = screen.getByRole('img', { name: 'Defence rating' });
    expect(svg).toBeTruthy();
  });

  it('inlines title element when provided', () => {
    const { container } = render(<Icon name="key" title="Inventory key" />);
    const svg = container.querySelector('svg');
    expect(svg?.innerHTML).toContain('<title>Inventory key</title>');
  });

  it('escapes HTML in title to prevent injection', () => {
    const { container } = render(<Icon name="key" title='<script>alert("x")</script>' />);
    const svg = container.querySelector('svg');
    expect(svg?.innerHTML).not.toContain('<script>');
    expect(svg?.innerHTML).toContain('&lt;script&gt;');
  });

  it('size prop sets width + height', () => {
    const { container } = render(<Icon name="star" size={32} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('32');
    expect(svg?.getAttribute('height')).toBe('32');
  });

  it('className prop is applied', () => {
    const { container } = render(<Icon name="star" className="text-red-500" />);
    expect(container.querySelector('svg')?.getAttribute('class')).toBe('text-red-500');
  });
});

describe('ICON_PATHS registry', () => {
  it('contains at least 50 icons', () => {
    const count = Object.keys(ICON_PATHS).length;
    expect(count).toBeGreaterThanOrEqual(50);
  });

  it('each icon has non-empty body', () => {
    for (const [name, body] of Object.entries(ICON_PATHS)) {
      expect(body.length, `${name} should have non-empty SVG body`).toBeGreaterThan(10);
    }
  });

  it('every entry uses currentColor or a hex literal', () => {
    for (const [name, body] of Object.entries(ICON_PATHS)) {
      const hasColor = body.includes('currentColor') || /fill="#[0-9a-f]{3,6}"/i.test(body) || /stroke="#[0-9a-f]{3,6}"/i.test(body);
      expect(hasColor, `${name} should reference currentColor or a literal hex`).toBe(true);
    }
  });
});

describe('EMOJI_TO_ICON mapping', () => {
  it('maps common emojis to defined icons', () => {
    for (const [emoji, iconName] of Object.entries(EMOJI_TO_ICON)) {
      expect(ICON_PATHS[iconName as IconName], `${emoji} → ${iconName} must exist in registry`).toBeDefined();
    }
  });

  it('has at least 30 emoji mappings', () => {
    expect(Object.keys(EMOJI_TO_ICON).length).toBeGreaterThanOrEqual(30);
  });
});
