import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const apiPost = vi.fn();

vi.mock('@/lib/api/client', () => ({
  api: { post: (...args: unknown[]) => apiPost(...args) },
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

import { CitationConsentModal } from '@/components/dtu/CitationConsentModal';

const parent = {
  id: 'dtu-parent-1',
  title: 'Source Paper',
  tier: 'core',
  creator: { id: 'u1', displayName: 'Aria' },
  licensePriceCc: 25,
};

describe('CitationConsentModal', () => {
  beforeEach(() => {
    apiPost.mockReset();
  });

  it('renders nothing when closed', () => {
    const { container } = render(
      <CitationConsentModal open={false} parent={parent} onClose={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when parent is null', () => {
    const { container } = render(
      <CitationConsentModal open={true} parent={null} onClose={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders parent title + creator + price when open', () => {
    render(<CitationConsentModal open={true} parent={parent} onClose={() => {}} />);
    expect(screen.getByText('Source Paper')).toBeInTheDocument();
    expect(screen.getByText('Aria')).toBeInTheDocument();
    expect(screen.getByText(/Buy license · 25 CC/)).toBeInTheDocument();
  });

  it('hides the buy button when there is no price', () => {
    render(
      <CitationConsentModal
        open={true}
        parent={{ ...parent, licensePriceCc: 0 }}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByText(/Buy license/)).not.toBeInTheDocument();
  });

  it('routes "Request consent" through autonomy.request_consent and fires onConsentRequested', async () => {
    apiPost.mockResolvedValue({ data: { ok: true } });
    const onClose = vi.fn();
    const onConsentRequested = vi.fn();
    render(
      <CitationConsentModal
        open={true}
        parent={parent}
        onClose={onClose}
        onConsentRequested={onConsentRequested}
      />,
    );
    fireEvent.click(screen.getByText('Request consent'));
    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/api/lens/run',
        expect.objectContaining({
          domain: 'autonomy',
          name: 'request_consent',
          input: expect.objectContaining({ kind: 'citation', parentId: 'dtu-parent-1' }),
        }),
      );
    });
    await waitFor(() => {
      expect(onConsentRequested).toHaveBeenCalledWith('dtu-parent-1');
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('routes "Buy license" through purchaseWithRoyalties and fires onLicenseGranted', async () => {
    apiPost.mockResolvedValue({ data: { ok: true } });
    const onClose = vi.fn();
    const onLicenseGranted = vi.fn();
    render(
      <CitationConsentModal
        open={true}
        parent={parent}
        onClose={onClose}
        onLicenseGranted={onLicenseGranted}
      />,
    );
    fireEvent.click(screen.getByText(/Buy license/));
    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/api/marketplace/purchaseWithRoyalties',
        expect.objectContaining({ dtuId: 'dtu-parent-1', licenseKind: 'citation' }),
      );
    });
    await waitFor(() => {
      expect(onLicenseGranted).toHaveBeenCalledWith('dtu-parent-1');
    });
  });

  it('shows the error banner when the request macro returns ok=false', async () => {
    apiPost.mockResolvedValue({ data: { ok: false, error: 'rate_limited' } });
    render(<CitationConsentModal open={true} parent={parent} onClose={() => {}} />);
    fireEvent.click(screen.getByText('Request consent'));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('rate_limited');
    });
  });
});
