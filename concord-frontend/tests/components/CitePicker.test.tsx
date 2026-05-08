import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// Capture the picker's onSelect handler so we can simulate a chosen DTU.
let capturedOnSelect: ((dtu: unknown) => void) | null = null;

vi.mock('@/components/dtu/DTUPickerModal', () => ({
  DTUPickerModal: ({ onSelect, onClose }: { onSelect: (dtu: unknown) => void; onClose: () => void }) => {
    capturedOnSelect = onSelect;
    return (
      <div data-testid="dtu-picker">
        <button onClick={onClose}>close-picker</button>
      </div>
    );
  },
}));

vi.mock('@/components/dtu/CitationConsentModal', () => ({
  CitationConsentModal: ({ open, parent, onLicenseGranted }: {
    open: boolean;
    parent: { id: string } | null;
    onLicenseGranted?: (id: string) => void;
  }) =>
    open && parent ? (
      <div data-testid="consent-modal">
        <span>{parent.id}</span>
        <button onClick={() => onLicenseGranted?.(parent.id)}>grant-license</button>
      </div>
    ) : null,
}));

vi.mock('lucide-react', async (importOriginal) => {
  const React = await import('react');
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props })
    );
    Icon.displayName = name;
    return Icon;
  };
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(actual)) {
    if (k[0] >= 'A' && k[0] <= 'Z' && k !== 'createLucideIcon' && k !== 'default') o[k] = make(k);
  }
  return { ...actual, ...o };
});

import { CitePicker } from '@/components/dtu/CitePicker';

const publicDtu = {
  id: 'p1', title: 'Public source',
  ownerId: 'u1',
  visibility: 'public',
  timestamp: new Date().toISOString(),
  meta: {},
};

const privateDtu = {
  id: 'p2', title: 'Locked source',
  ownerId: 'u2',
  visibility: 'private',
  timestamp: new Date().toISOString(),
  meta: { ownerName: 'Mira', licensePriceCc: 25 },
};

describe('CitePicker', () => {
  beforeEach(() => {
    capturedOnSelect = null;
  });

  it('renders nothing when closed', () => {
    const { container } = render(
      <CitePicker open={false} onClose={() => {}} onCite={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('cites immediately when consent is satisfied (public DTU)', () => {
    const onCite = vi.fn();
    const onClose = vi.fn();
    render(<CitePicker open={true} onClose={onClose} onCite={onCite} />);
    expect(capturedOnSelect).toBeTypeOf('function');
    capturedOnSelect!(publicDtu);
    expect(onCite).toHaveBeenCalledWith(publicDtu);
    expect(onClose).toHaveBeenCalled();
  });

  it('opens consent modal when consent is not satisfied (private DTU)', () => {
    const onCite = vi.fn();
    render(<CitePicker open={true} onClose={() => {}} onCite={onCite} />);
    act(() => { capturedOnSelect!(privateDtu); });
    expect(screen.getByTestId('consent-modal')).toBeInTheDocument();
    expect(screen.getByText('p2')).toBeInTheDocument();
    expect(onCite).not.toHaveBeenCalled();
  });

  it('completes the citation after a license is granted', () => {
    const onCite = vi.fn();
    const onClose = vi.fn();
    render(<CitePicker open={true} onClose={onClose} onCite={onCite} />);
    act(() => { capturedOnSelect!(privateDtu); });
    fireEvent.click(screen.getByText('grant-license'));
    expect(onCite).toHaveBeenCalledWith(privateDtu);
    expect(onClose).toHaveBeenCalled();
  });

  it('skips DTUs that fail authority filter', () => {
    const onCite = vi.fn();
    render(<CitePicker open={true} onClose={() => {}} onCite={onCite} initialAuthority="institutional" />);
    // publicDtu has no authority — fails institutional filter
    capturedOnSelect!(publicDtu);
    expect(onCite).not.toHaveBeenCalled();
  });
});
