import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const runDomain = vi.fn();
const addToast = vi.fn();
const getLensManifest = vi.fn();

vi.mock('@/lib/api/client', () => ({
  apiHelpers: { lens: { runDomain: (...args: unknown[]) => runDomain(...args) } },
  api: { post: vi.fn(), get: vi.fn() },
}));

vi.mock('@/store/ui', () => ({
  useUIStore: (sel: (s: unknown) => unknown) => sel({ addToast, accessibility: {}, osReducedMotion: false, setActiveLens: vi.fn() }),
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

import { ManifestActionBar } from '@/components/lens/ManifestActionBar';

describe('ManifestActionBar', () => {
  beforeEach(() => {
    runDomain.mockReset();
    addToast.mockReset();
    getLensManifest.mockReset();
  });

  it('renders nothing when the manifest is missing', () => {
    getLensManifest.mockReturnValue(undefined);
    const { container } = render(<ManifestActionBar lensId="unknown" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders one button per manifest.actions entry', () => {
    getLensManifest.mockReturnValue({
      domain: 'chat',
      label: 'Chat',
      actions: ['send', 'create', 'export'],
      macros: { list: 'list', get: 'get' },
    });
    render(<ManifestActionBar lensId="chat" />);
    expect(screen.getByText('Send')).toBeInTheDocument();
    expect(screen.getByText('Create')).toBeInTheDocument();
    expect(screen.getByText('Export')).toBeInTheDocument();
  });

  it('humanises kebab + snake names', () => {
    getLensManifest.mockReturnValue({
      domain: 'forge',
      label: 'Forge',
      actions: ['transpile-source', 'sign_machine'],
      macros: { list: 'list', get: 'get' },
    });
    render(<ManifestActionBar lensId="forge" />);
    expect(screen.getByText('Transpile Source')).toBeInTheDocument();
    expect(screen.getByText('Sign Machine')).toBeInTheDocument();
  });

  it('caps button count at the limit prop', () => {
    getLensManifest.mockReturnValue({
      domain: 'a',
      label: 'A',
      actions: ['one', 'two', 'three', 'four', 'five', 'six', 'seven'],
      macros: { list: 'list', get: 'get' },
    });
    render(<ManifestActionBar lensId="a" limit={3} />);
    expect(screen.getByText('One')).toBeInTheDocument();
    expect(screen.getByText('Three')).toBeInTheDocument();
    expect(screen.queryByText('Four')).not.toBeInTheDocument();
    expect(screen.queryByText('Seven')).not.toBeInTheDocument();
  });

  it('hides excluded actions', () => {
    getLensManifest.mockReturnValue({
      domain: 'b',
      label: 'B',
      actions: ['create', 'delete', 'export'],
      macros: { list: 'list', get: 'get' },
    });
    render(<ManifestActionBar lensId="b" exclude={['delete']} />);
    expect(screen.getByText('Create')).toBeInTheDocument();
    expect(screen.queryByText('Delete')).not.toBeInTheDocument();
  });

  it('routes button clicks through apiHelpers.lens.runDomain', async () => {
    getLensManifest.mockReturnValue({
      domain: 'chat',
      label: 'Chat',
      actions: ['send'],
      macros: { list: 'list', get: 'get' },
    });
    runDomain.mockResolvedValue({ data: { ok: true, result: 'sent' } });
    const onAction = vi.fn();
    render(<ManifestActionBar lensId="chat" onAction={onAction} />);
    fireEvent.click(screen.getByText('Send'));
    await waitFor(() => {
      expect(runDomain).toHaveBeenCalledWith('chat', 'send', {});
    });
    await waitFor(() => {
      expect(onAction).toHaveBeenCalledWith('send', 'sent');
    });
  });

  it('toasts the error when the macro returns ok=false', async () => {
    getLensManifest.mockReturnValue({
      domain: 'chat',
      label: 'Chat',
      actions: ['send'],
      macros: { list: 'list', get: 'get' },
    });
    runDomain.mockResolvedValue({ data: { ok: false, error: 'rate_limited' } });
    render(<ManifestActionBar lensId="chat" />);
    fireEvent.click(screen.getByText('Send'));
    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', message: 'rate_limited' }));
    });
  });
});
