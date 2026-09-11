import { describe, it, expect, vi } from 'vitest';

/**
 * Test that the barrel export file (components/index.ts) exports key symbols.
 *
 * We mock all heavy dependencies so the import can be evaluated without
 * requiring full build of every component. We just verify that the re-exports
 * resolve without throwing.
 */

// Mock heavy dependencies that component files pull in
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('next/link', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: null, isLoading: false, isError: false }),
  useMutation: () => ({ mutate: vi.fn() }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  QueryClient: vi.fn(),
  QueryClientProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('@/lib/realtime/socket', () => ({
  getSocket: vi.fn(),
  connectSocket: vi.fn(),
  disconnectSocket: vi.fn(),
  subscribe: vi.fn(),
  emit: vi.fn(),
}));

vi.mock('@/store/ui', () => ({
  useUIStore: Object.assign(
    () => ({}),
    { getState: () => ({}) }
  ),
}));

vi.mock('@/hooks/useLensNav', () => ({
  useLensNav: vi.fn(),
}));

vi.mock('@/lib/design-system', () => ({
  ds: new Proxy({}, { get: () => '' }),
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

vi.mock('@/lib/lens-registry', () => ({
  CORE_LENSES: [],
  getAbsorbedLenses: () => [],
  getExtensionLenses: () => [],
  getCommandPaletteLenses: () => [],
  getCoreLensConfig: () => null,
  getParentCoreLens: () => null,
  getLensById: () => null,
  LENS_CATEGORIES: {},
}));

vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: import('react').ReactNode }) => children,
  motion: new Proxy({}, { get: () => () => null }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  useAnimation: () => ({ start: vi.fn() }),
  useMotionValue: () => ({ get: () => 0, set: vi.fn() }),
}));

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => ({
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    connected: false,
  })),
}));

describe('components/index.ts barrel export', () => {
  it('exports Button', async () => {
    const mod = await import('@/components/index');
    expect(mod).toHaveProperty('Button');
  });

  it('exports Modal', async () => {
    const mod = await import('@/components/index');
    expect(mod).toHaveProperty('Modal');
  });

  it('exports Loading', async () => {
    const mod = await import('@/components/index');
    expect(mod).toHaveProperty('Loading');
  });

  it('exports Toasts and showToast', async () => {
    const mod = await import('@/components/index');
    expect(mod).toHaveProperty('Toasts');
    expect(mod).toHaveProperty('showToast');
  });

  it('exports Skeleton', async () => {
    const mod = await import('@/components/index');
    expect(mod).toHaveProperty('Skeleton');
  });

  it('exports OfflineIndicator', async () => {
    const mod = await import('@/components/index');
    expect(mod).toHaveProperty('OfflineIndicator');
  });

  it('exports Topbar', async () => {
    const mod = await import('@/components/index');
    expect(mod).toHaveProperty('Topbar');
  });

  it('exports CommandPalette', async () => {
    const mod = await import('@/components/index');
    expect(mod).toHaveProperty('CommandPalette');
  });
});
