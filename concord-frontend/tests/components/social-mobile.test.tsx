/**
 * Social lens mobile layout (job oc-social-3a).
 *
 * Real defects fixed this pass, found in a Chrome check at 390x844:
 *  1. The five-place nav was a fixed bottom-0 bar that sat *under* the
 *     global bottom bar (also fixed bottom-0, z-50 vs z-40) — Explore /
 *     Create / Inbox / You were unreachable on phones. The phone nav is
 *     now an in-flow segmented bar at the top of the lens, driven by the
 *     same `?view=` URL state as the desktop sidebar.
 *  7. "Create" was a filled teal pill in both navs, which reads as a
 *     permanently-active tab. Active state now follows the current view
 *     (aria-current + bg-white/10 on the current item only); Create is an
 *     outlined teal action and never carries aria-current.
 *  4. The 'Notifications blocked'/topbar pill row collided with the
 *     oversized serif title at phone width; the title scales down
 *     (text-3xl at phone, sm:text-5xl up) and the header wraps.
 *  6. Footer links clipped at phone width; the nav wraps now.
 *
 * Mocks follow the established harness for this page
 * (tests/components/social-honest-controls.test.tsx): only the HTTP layer
 * (@/lib/api/client), next/navigation, jsdom-hostile leaf components
 * (RoomStage's WebRTC, ReelsFeed, RoomList), LensShell/DepthBadge chrome,
 * and framer-motion's DOM passthrough. The page, both navs, and the
 * LegalFooter under test are real.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensIdentity', () => ({ useLensIdentity: () => ({}) }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, alerts: [], insights: [], isLive: false, lastUpdated: null }),
}));
const nav = vi.hoisted(() => ({ view: '', replaceCalls: [] as string[] }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
    replace: (url: string) => {
      nav.replaceCalls.push(String(url));
      const m = /[?&]view=([^&]+)/.exec(String(url));
      nav.view = m ? m[1] : '';
    },
  }),
  usePathname: () => '/lenses/social',
  useSearchParams: () => new URLSearchParams(nav.view ? `view=${nav.view}` : ''),
}));
vi.mock('next/image', () => ({
  default: (props: { alt?: string }) => React.createElement('img', { alt: props.alt || '' }),
}));
vi.mock('@/lib/realtime/socket', () => ({
  getSocket: () => null,
  subscribe: () => () => {},
}));
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: React.PropsWithChildren) => React.createElement('div', null, children),
}));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/audio-rooms/RoomStage', () => ({ default: () => null }));
vi.mock('@/components/reels/ReelsFeed', () => ({ ReelsFeed: () => React.createElement('div', null, 'Reels') }));
vi.mock('@/components/audio-rooms/RoomList', () => ({
  RoomList: () => React.createElement('div', null, 'Rooms'),
}));
vi.mock('framer-motion', () => {
  const passthrough = (tag: string) => {
    const Comp = React.forwardRef<HTMLElement, { children?: React.ReactNode }>((props, ref) =>
      React.createElement(tag, { ref }, props.children));
    Comp.displayName = `Motion${tag}`;
    return Comp;
  };
  return {
    useReducedMotion: () => false,
    AnimatePresence: ({ children }: { children?: React.ReactNode }) => children,
    motion: { div: passthrough('div'), button: passthrough('button'), span: passthrough('span'), li: passthrough('li') },
  };
});

vi.mock('@/lib/api/client', () => ({
  api: {
    get: vi.fn(async (url: string) => {
      if (url === '/api/auth/me') return { data: { ok: true, user: { id: 'u1', username: 'ana' } } };
      if (url === '/api/social/notifications/count') return { data: { count: 2 } };
      if (String(url).includes('/api/social/profile/')) return { data: { ok: false } };
      if (String(url).includes('/api/social/feed/following')) {
        const err = new Error('missing') as Error & { response?: { status: number } };
        err.response = { status: 404 };
        throw err;
      }
      if (String(url).includes('/api/social/discover')) return { data: { users: [] } };
      return { data: { ok: true, notifications: [], stories: [], topics: [], users: [] } };
    }),
    post: vi.fn(async () => ({ data: { ok: true } })),
    delete: vi.fn(async () => ({ data: { ok: true } })),
  },
  lensRun: vi.fn(async () => ({ data: { ok: true, result: {} } })),
}));

import SocialHubPage from '@/app/lenses/social/page';
import { LegalFooter } from '@/components/legal/LegalFooter';

function renderPage(view = '') {
  nav.view = view;
  nav.replaceCalls.length = 0;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SocialHubPage />
    </QueryClientProvider>,
  );
}

describe('social mobile nav (five places reachable on phones)', () => {
  beforeEach(() => { nav.view = ''; nav.replaceCalls.length = 0; });

  it('renders all five places as real buttons with aria-labels, in-flow (not over the global bottom bar)', async () => {
    renderPage();
    const bar = await screen.findByTestId('social-mobile-places');
    // In-flow phone chrome: visible below lg, never position:fixed, so it
    // cannot collide with the global Home/Lenses/Chat/Wallet/Profile bar.
    expect(bar.className).toContain('lg:hidden');
    expect(bar.className).not.toContain('fixed');
    for (const label of ['Home', 'Explore', 'Create', 'Inbox', 'You']) {
      const btn = within(bar).getByRole('button', { name: label });
      expect(btn.getAttribute('aria-label')).toBe(label);
      expect(btn.className).toContain('min-h-[44px]');
    }
    expect(within(bar).getAllByRole('button')).toHaveLength(5);
  });

  it('switching places writes the same ?view= URL state the desktop nav uses', async () => {
    renderPage();
    const bar = await screen.findByTestId('social-mobile-places');
    fireEvent.click(within(bar).getByRole('button', { name: 'Explore' }));
    expect(nav.replaceCalls).toContain('/lenses/social?view=explore');
    fireEvent.click(within(bar).getByRole('button', { name: 'Inbox' }));
    expect(nav.replaceCalls).toContain('/lenses/social?view=inbox');
    // Home is the default place: its URL has no ?view= param at all.
    fireEvent.click(within(bar).getByRole('button', { name: 'Home' }));
    expect(nav.replaceCalls).toContain('/lenses/social');
    // The desktop sidebar writes the exact same URLs from the same state.
    const navs = screen.getAllByRole('navigation', { name: 'Social places' });
    const desktopBar = navs.find((n) => n.className.includes('sticky')) as HTMLElement;
    fireEvent.click(within(desktopBar).getByRole('button', { name: 'Explore' }));
    expect(nav.replaceCalls.filter((u) => u === '/lenses/social?view=explore').length).toBe(2);
  });

  it('the unread count badges Inbox in the mobile nav from the shared query', async () => {
    renderPage();
    const bar = await screen.findByTestId('social-mobile-places');
    const inbox = within(bar).getByRole('button', { name: 'Inbox' });
    await waitFor(() => expect(inbox).toHaveTextContent('2'));
  });
});

describe('social place active state follows the current view (Create never highlights)', () => {
  beforeEach(() => { nav.view = ''; nav.replaceCalls.length = 0; });

  const desktopBar = () => {
    const navs = screen.getAllByRole('navigation', { name: 'Social places' });
    return navs.find((n) => n.className.includes('sticky')) as HTMLElement;
  };

  it('on Home: Home carries aria-current, Create does not and is not a filled teal pill', async () => {
    renderPage();
    const bar = await screen.findByTestId('social-mobile-places');
    await waitFor(() => expect(within(bar).getByRole('button', { name: 'Home' }).getAttribute('aria-current')).toBe('page'));
    for (const scope of [bar, desktopBar()]) {
      const create = within(scope).getByRole('button', { name: 'Create' });
      expect(create.getAttribute('aria-current')).toBeNull();
      // The old bug: Create was a filled teal pill (class token bg-teal-400)
      // that read as "active" on every view. Now it is an outlined action —
      // token check so hover:bg-teal-400/10 doesn't read as the fill.
      expect(create.className.split(' ')).not.toContain('bg-teal-400');
      expect(create.className).toContain('border-teal-400/40');
      expect(within(scope).getByRole('button', { name: 'You' }).getAttribute('aria-current')).toBeNull();
    }
  });

  it('on You: You carries aria-current in both navs; Create still does not', async () => {
    renderPage('you');
    const bar = await screen.findByTestId('social-mobile-places');
    await waitFor(() => expect(within(bar).getByRole('button', { name: 'You' }).getAttribute('aria-current')).toBe('page'));
    expect(within(desktopBar()).getByRole('button', { name: 'You' }).getAttribute('aria-current')).toBe('page');
    for (const scope of [bar, desktopBar()]) {
      expect(within(scope).getByRole('button', { name: 'Create' }).getAttribute('aria-current')).toBeNull();
      expect(within(scope).getByRole('button', { name: 'Home' }).getAttribute('aria-current')).toBeNull();
    }
  });
});

describe('social header at phone width (title vs. pills collision, oversized serif)', () => {
  it('scales the title down on small screens and lets the pill row wrap instead of colliding', async () => {
    renderPage();
    await screen.findByText('Social');
    const h1 = screen.getByText('Social', { selector: 'h1' });
    expect(h1.className).toContain('text-3xl');
    expect(h1.className).toContain('sm:text-5xl');
    // The header row and the topbar pill row (PushEnableButton / streak /
    // DM / bell / live) both wrap instead of pushing past the right edge.
    const titleCol = h1.parentElement as HTMLElement;
    const headerRow = titleCol.parentElement as HTMLElement;
    const pillRow = titleCol.nextElementSibling as HTMLElement;
    expect(headerRow.className).toContain('flex-wrap');
    expect(pillRow.className).toContain('flex-wrap');
  });
});

describe('legal footer links wrap at phone width', () => {
  it('the footer link nav wraps instead of clipping', () => {
    render(<LegalFooter />);
    const navEl = screen.getByRole('navigation');
    expect(navEl.className).toContain('flex-wrap');
    for (const label of ['Terms of Service', 'Privacy Policy', 'DMCA']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
  });
});

describe('motion on the social surface honors prefers-reduced-motion', () => {
  it('this pass adds no new animation; existing motion sits under the app-wide MotionConfig reducedMotion="user"', () => {
    // Providers.tsx wraps the entire app (every lens, Social included) in
    // <MotionConfig reducedMotion="user">, so every framer-motion component
    // rendered by the Social lens (NotificationBell badge, NotificationCenter
    // dropdown) already falls back to instant transitions when the OS
    // prefers-reduced-motion is set. The mobile pass adds zero new
    // animated elements — pure layout — so there is nothing new to opt out.
    // Source-checked the same way AppShell-mobile-viewport.test.tsx pins
    // globals.css classes.
    const source = readFileSync(resolve(__dirname, '../../components/Providers.tsx'), 'utf8');
    expect(source).toContain('reducedMotion="user"');
  });
});