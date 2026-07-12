import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock scrollIntoView which jsdom doesn't implement
Element.prototype.scrollIntoView = vi.fn();

// Mock next/navigation
const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

// Mock lens-registry — provides two lenses across two categories so the
// tests can exercise both a stand-alone (Resonance/core) and an
// absorbed-child lens (Marketplace under Board/governance).
vi.mock('@/lib/lens-registry', () => {
  return {
    getCommandPaletteLenses: () => [
      {
        id: 'resonance',
        name: 'Resonance',
        description: 'View system resonance',
        path: '/lenses/resonance',
        icon: ({ className }: { className?: string }) => <span data-testid="mock-icon" className={className}>I</span>,
        category: 'core',
        keywords: ['vibe', 'pulse'],
      },
      {
        id: 'marketplace',
        name: 'Marketplace',
        description: 'Browse the marketplace',
        path: '/lenses/marketplace',
        icon: ({ className }: { className?: string }) => <span data-testid="mock-icon" className={className}>I</span>,
        category: 'governance',
        keywords: ['shop', 'buy'],
      },
    ],
    getParentCoreLens: (id: string) => {
      if (id === 'marketplace') return 'board';
      return null;
    },
    getCoreLensConfig: (id: string) => {
      if (id === 'board') return { name: 'Board' };
      return null;
    },
    LENS_CATEGORIES: {
      core: { label: 'Core' },
      governance: { label: 'Governance' },
      system: { label: 'System' },
      // Fix 7 (verification audit) — the palette's 7 hardcoded `mode:*`
      // run-mode pseudo-entries (DA4 + Wave 4's `mode:dungeon`) use category
      // 'world' regardless of the mocked lens-registry, so the mock must
      // cover it too or the component's category-grouping useMemo throws on
      // `config.label`.
      world: { label: 'World' },
    },
  };
});

// CommandPalette also surfaces every cross-lens panel as a `panel:<id>` entry
// (panel-registry). These tests exercise the lens-driven rendering, so stub the
// panel modules to an empty set — keeps the option count deterministic (conkay +
// the two mocked lenses) instead of pulling in the real 13-panel registry.
vi.mock('@/lib/panel-registry', () => ({
  allPanels: () => [],
}));
vi.mock('@/lib/panel-dispatcher', () => ({
  openPanel: vi.fn(),
}));

// Mock lucide-react — use importOriginal to handle all icons
vi.mock('lucide-react', async (importOriginal) => {
  const React = await import('react');
  const actual = await importOriginal<Record<string, unknown>>();
  const makeMockIcon = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props })
    );
    Icon.displayName = name;
    return Icon;
  };
  const overrides: Record<string, unknown> = {};
  for (const key of Object.keys(actual)) {
    if (key[0] >= 'A' && key[0] <= 'Z' && key !== 'createLucideIcon' && key !== 'default') {
      overrides[key] = makeMockIcon(key);
    }
  }
  return { ...actual, ...overrides };
});

import { CommandPalette } from '@/components/shell/CommandPalette';

/**
 * Suite for the lens-driven CommandPalette
 * (concord-frontend/components/common/CommandPalette.tsx).
 *
 * The earlier generation of this suite asserted hardcoded commands
 * ("Go to Dashboard", "Create New DTU"), a `{N} results` footer, and
 * a longer placeholder. The component has since been refactored to be
 * purely LENS_MANIFESTS-driven with category groups + an empty-state
 * "No lenses matching {q}" string + an icon-only nav-hint footer.
 *
 * These assertions match the current shape end-to-end against the
 * lens-registry mock above (2 lenses: Resonance + Marketplace).
 */

describe('CommandPalette', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
  };

  beforeEach(() => {
    mockPush.mockClear();
    defaultProps.onClose = vi.fn();
  });

  it('renders nothing when not open', () => {
    const { container } = render(<CommandPalette isOpen={false} onClose={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders dialog + combobox + listbox when open', () => {
    render(<CommandPalette {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('renders search input with the lens-driven placeholder', () => {
    render(<CommandPalette {...defaultProps} />);
    expect(screen.getByPlaceholderText('Search lenses...')).toBeInTheDocument();
  });

  it('renders a button for each registered lens (lens-driven)', () => {
    render(<CommandPalette {...defaultProps} />);
    expect(screen.getByText('Resonance')).toBeInTheDocument();
    expect(screen.getByText('Marketplace')).toBeInTheDocument();
  });

  it('renders the lens description as secondary text', () => {
    render(<CommandPalette {...defaultProps} />);
    expect(screen.getByText('View system resonance')).toBeInTheDocument();
    expect(screen.getByText('Browse the marketplace')).toBeInTheDocument();
  });

  it('renders a category header for each represented category', () => {
    render(<CommandPalette {...defaultProps} />);
    expect(screen.getByText('Core')).toBeInTheDocument();
    expect(screen.getByText('Governance')).toBeInTheDocument();
  });

  it('filters lenses based on a fuzzy query match on the name', () => {
    render(<CommandPalette {...defaultProps} />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'reso' } });
    expect(screen.getByText('Resonance')).toBeInTheDocument();
    expect(screen.queryByText('Marketplace')).not.toBeInTheDocument();
  });

  it('filters lenses based on a fuzzy query match on a keyword', () => {
    render(<CommandPalette {...defaultProps} />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'shop' } });
    expect(screen.getByText('Marketplace')).toBeInTheDocument();
    expect(screen.queryByText('Resonance')).not.toBeInTheDocument();
  });

  it('shows the empty-state message when no lens matches the query', () => {
    render(<CommandPalette {...defaultProps} />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'xyznonexistent' } });
    expect(screen.getByText(/No lenses matching/)).toBeInTheDocument();
  });

  it('calls onClose on Escape key', () => {
    const onClose = vi.fn();
    render(<CommandPalette isOpen={true} onClose={onClose} />);
    const input = screen.getByRole('combobox');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('navigates to the first registry lens on Enter and closes', () => {
    const onClose = vi.fn();
    render(<CommandPalette isOpen={true} onClose={onClose} />);
    const input = screen.getByRole('combobox');
    // Index 0 is the ConKay summon staple (dispatches an event, no nav);
    // ArrowDown once reaches the first registry lens (Resonance).
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockPush).toHaveBeenCalledWith('/lenses/resonance');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('navigates with ArrowDown then Enter to the second registry lens', () => {
    const onClose = vi.fn();
    render(<CommandPalette isOpen={true} onClose={onClose} />);
    const input = screen.getByRole('combobox');
    // Indices: 0 ConKay staple, 1 Resonance, 2 Marketplace.
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockPush).toHaveBeenCalledWith('/lenses/marketplace');
  });

  it('wraps the selection when ArrowDown is held past the last item', () => {
    const onClose = vi.fn();
    render(<CommandPalette isOpen={true} onClose={onClose} />);
    const input = screen.getByRole('combobox');
    // Ten items: ConKay staple + two mock lenses + the 7 hardcoded `mode:*`
    // run-mode entries (Fix 7 + Wave 4's `mode:dungeon` — always present
    // regardless of the mocked lens-registry, since they're baked into the
    // component itself). Indices 0-9. ArrowDown wraps via
    // (prev < length - 1 ? prev + 1 : 0); 22 presses from index 0 land at
    // index 2 (22 mod 10 = 2) → Marketplace.
    for (let i = 0; i < 22; i++) {
      fireEvent.keyDown(input, { key: 'ArrowDown' });
    }
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockPush).toHaveBeenCalledWith('/lenses/marketplace');
  });

  it('wraps the selection when ArrowUp is held past the first item', () => {
    const onClose = vi.fn();
    render(<CommandPalette isOpen={true} onClose={onClose} />);
    const input = screen.getByRole('combobox');
    // 10 total items (see above). ArrowUp wraps via
    // (prev > 0 ? prev - 1 : length - 1); starting at index 0, 9 ArrowUps
    // land back at index 1 (Resonance) — (10 - 9) mod 10 = 1.
    for (let i = 0; i < 9; i++) {
      fireEvent.keyDown(input, { key: 'ArrowUp' });
    }
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockPush).toHaveBeenCalledWith('/lenses/resonance');
  });

  it('navigates when a lens button is clicked', () => {
    const onClose = vi.fn();
    render(<CommandPalette isOpen={true} onClose={onClose} />);
    const button = screen.getByText('Marketplace').closest('button')!;
    fireEvent.click(button);
    expect(mockPush).toHaveBeenCalledWith('/lenses/marketplace');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('exposes role=option on each lens entry with stable ids', () => {
    render(<CommandPalette {...defaultProps} />);
    const options = screen.getAllByRole('option');
    // ConKay summon staple + two mock lenses + 7 hardcoded run-mode entries
    // (Fix 7 + Wave 4's `mode:dungeon` — see above).
    expect(options).toHaveLength(10);
    expect(options[0]).toHaveAttribute('id', 'palette-item-conkay');
    expect(options[1]).toHaveAttribute('id', 'palette-item-resonance');
    expect(options[2]).toHaveAttribute('id', 'palette-item-marketplace');
    expect(options[3]).toHaveAttribute('id', 'palette-item-mode:roguelite');
    expect(options[8]).toHaveAttribute('id', 'palette-item-mode:brawl');
    expect(options[9]).toHaveAttribute('id', 'palette-item-mode:dungeon');
  });

  it('marks the selected option with aria-selected=true', () => {
    render(<CommandPalette {...defaultProps} />);
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(options[1]).toHaveAttribute('aria-selected', 'false');
  });

  it('updates aria-activedescendant as the selection moves', () => {
    render(<CommandPalette {...defaultProps} />);
    const input = screen.getByRole('combobox');
    // Default selection is the ConKay staple at index 0.
    expect(input).toHaveAttribute('aria-activedescendant', 'palette-item-conkay');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', 'palette-item-resonance');
  });
});
