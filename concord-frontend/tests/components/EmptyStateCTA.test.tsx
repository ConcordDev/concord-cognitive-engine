import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const runDomain = vi.fn();
const addToast = vi.fn();
const getLensManifest = vi.fn();

vi.mock('@/lib/api/client', () => ({
  apiHelpers: { lens: { runDomain: (...args: unknown[]) => runDomain(...args) } },
}));

vi.mock('@/store/ui', () => ({
  useUIStore: (sel: (s: unknown) => unknown) => sel({ addToast }),
}));

vi.mock('@/lib/lenses/manifest', () => ({
  getLensManifest: (id: string) => getLensManifest(id),
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

import { EmptyStateCTA } from '@/components/lens/EmptyStateCTA';

describe('EmptyStateCTA', () => {
  beforeEach(() => {
    runDomain.mockReset();
    addToast.mockReset();
    getLensManifest.mockReset();
  });

  it('uses the manifest artifact in the default button label', () => {
    getLensManifest.mockReturnValue({
      domain: 'docs',
      label: 'Docs',
      artifacts: ['document'],
      macros: { list: 'list', get: 'get', create: 'create' },
    });
    render(<EmptyStateCTA lensId="docs" />);
    expect(screen.getByText('Create your first document')).toBeInTheDocument();
  });

  it('falls back to a generic label when no artifact in manifest', () => {
    getLensManifest.mockReturnValue({
      domain: 'misc',
      label: 'Misc',
      artifacts: [],
      macros: { list: 'list', get: 'get' },
    });
    render(<EmptyStateCTA lensId="misc" />);
    expect(screen.getByText('Get started')).toBeInTheDocument();
  });

  it('respects the buttonLabel + headline + caption overrides', () => {
    getLensManifest.mockReturnValue({
      domain: 'art',
      label: 'Art',
      artifacts: ['piece'],
      macros: { list: 'list', get: 'get', create: 'create' },
    });
    render(
      <EmptyStateCTA
        lensId="art"
        headline="Make something"
        caption="Your studio is empty."
        buttonLabel="Begin"
      />,
    );
    expect(screen.getByText('Make something')).toBeInTheDocument();
    expect(screen.getByText('Your studio is empty.')).toBeInTheDocument();
    expect(screen.getByText('Begin')).toBeInTheDocument();
  });

  it('routes click through runDomain and calls onCreated with the result', async () => {
    getLensManifest.mockReturnValue({
      domain: 'docs',
      label: 'Docs',
      artifacts: ['document'],
      macros: { list: 'list', get: 'get', create: 'create' },
    });
    runDomain.mockResolvedValue({ data: { ok: true, result: { id: 'doc-1' } } });
    const onCreated = vi.fn();
    render(<EmptyStateCTA lensId="docs" onCreated={onCreated} />);
    fireEvent.click(screen.getByText('Create your first document'));
    await waitFor(() => {
      expect(runDomain).toHaveBeenCalledWith('docs', 'create', {});
    });
    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith({ id: 'doc-1' });
    });
  });

  it('toasts an info message when there is no create macro', () => {
    getLensManifest.mockReturnValue({
      domain: 'view',
      label: 'View',
      artifacts: ['report'],
      macros: { list: 'list', get: 'get' },
    });
    render(<EmptyStateCTA lensId="view" />);
    fireEvent.click(screen.getByText('Create your first report'));
    expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'info' }));
    expect(runDomain).not.toHaveBeenCalled();
  });
});
