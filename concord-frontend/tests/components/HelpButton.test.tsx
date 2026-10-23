import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// Mock lucide-react icons for jsdom environment.
vi.mock('lucide-react', async () => {
  const makeMockIcon = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props })
    );
    Icon.displayName = name;
    return Icon;
  };
  return {
    __esModule: true,
    HelpCircle: makeMockIcon('HelpCircle'),
    X: makeMockIcon('X'),
    Send: makeMockIcon('Send'),
    BookOpen: makeMockIcon('BookOpen'),
    Bug: makeMockIcon('Bug'),
    Mail: makeMockIcon('Mail'),
  };
});

// next/link → plain anchor.
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, onClick }: { children: React.ReactNode; href: string; onClick?: () => void }) =>
    React.createElement('a', { href, onClick }, children),
}));

// useBugContext → reportClientError (client-error funnel).
const reportClientError = vi.fn();
vi.mock('@/hooks/useBugContext', () => ({
  __esModule: true,
  reportClientError: (...args: unknown[]) => reportClientError(...args),
}));

// Real UI store (not a mock): HelpButton reads the live
// installBannerFootprint the InstallPrompt publishes, and toasts are
// asserted against the real store state.
import { useUIStore } from '@/store/ui';
import { HelpButton } from '@/components/help/HelpButton';

describe('HelpButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true }) });
    useUIStore.setState({ toasts: [], installBannerFootprint: 0 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useUIStore.setState({ toasts: [], installBannerFootprint: 0 });
  });

  it('renders the floating launcher button', () => {
    render(<HelpButton />);
    expect(screen.getByLabelText('Help and feedback')).toBeDefined();
    // Closed: HelpCircle icon visible, no dialog.
    expect(screen.getByTestId('icon-HelpCircle')).toBeDefined();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the menu when the launcher is clicked', () => {
    render(<HelpButton />);
    fireEvent.click(screen.getByLabelText('Help and feedback'));
    expect(screen.getByRole('dialog')).toBeDefined();
    expect(screen.getByText('Need a hand?')).toBeDefined();
    // Launcher now shows the X (close) icon.
    expect(screen.getByTestId('icon-X')).toBeDefined();
  });

  it('toggles closed when the launcher is clicked again', () => {
    render(<HelpButton />);
    const launcher = screen.getByLabelText('Help and feedback');
    fireEvent.click(launcher);
    expect(screen.getByRole('dialog')).toBeDefined();
    fireEvent.click(launcher);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens via the concord:open-help window event', () => {
    render(<HelpButton />);
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => {
      window.dispatchEvent(new Event('concord:open-help'));
    });
    expect(screen.getByRole('dialog')).toBeDefined();
    expect(screen.getByText('Need a hand?')).toBeDefined();
  });

  it('closes when Escape is pressed', () => {
    render(<HelpButton />);
    fireEvent.click(screen.getByLabelText('Help and feedback'));
    expect(screen.getByRole('dialog')).toBeDefined();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not close on a non-Escape key', () => {
    render(<HelpButton />);
    fireEvent.click(screen.getByLabelText('Help and feedback'));
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    });
    expect(screen.getByRole('dialog')).toBeDefined();
  });

  it('renders the menu links (onboarding + email)', () => {
    render(<HelpButton />);
    fireEvent.click(screen.getByLabelText('Help and feedback'));
    const onboarding = screen.getByText('Getting started — replay the intro').closest('a');
    expect(onboarding?.getAttribute('href')).toBe('/onboarding');
    const email = screen.getByText(/Email us/).closest('a');
    expect(email?.getAttribute('href')).toBe('mailto:support@concord-os.org');
  });

  it('onboarding link closes the panel on click', () => {
    render(<HelpButton />);
    fireEvent.click(screen.getByLabelText('Help and feedback'));
    fireEvent.click(screen.getByText('Getting started — replay the intro'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('switches to the bug report form', () => {
    render(<HelpButton />);
    fireEvent.click(screen.getByLabelText('Help and feedback'));
    fireEvent.click(screen.getByText('Report a bug or problem'));
    expect(screen.getByText('Report a problem')).toBeDefined();
    expect(screen.getByPlaceholderText('What happened? What did you expect?')).toBeDefined();
  });

  it('switches to the feedback form', () => {
    render(<HelpButton />);
    fireEvent.click(screen.getByLabelText('Help and feedback'));
    fireEvent.click(screen.getByText('Share feedback or an idea'));
    expect(screen.getByText('Share feedback')).toBeDefined();
    expect(screen.getByPlaceholderText("Tell us what's on your mind…")).toBeDefined();
  });

  it('Back returns to the menu from the report form', () => {
    render(<HelpButton />);
    fireEvent.click(screen.getByLabelText('Help and feedback'));
    fireEvent.click(screen.getByText('Report a bug or problem'));
    fireEvent.click(screen.getByText('Back'));
    expect(screen.getByText('Need a hand?')).toBeDefined();
  });

  it('changing the select updates the heading', () => {
    render(<HelpButton />);
    fireEvent.click(screen.getByLabelText('Help and feedback'));
    fireEvent.click(screen.getByText('Report a bug or problem'));
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'feature_request' } });
    expect(select.value).toBe('feature_request');
    expect(screen.getByText('Share feedback')).toBeDefined();
  });

  it('Send is disabled when the message is empty, enabled once typed', () => {
    render(<HelpButton />);
    fireEvent.click(screen.getByLabelText('Help and feedback'));
    fireEvent.click(screen.getByText('Report a bug or problem'));
    const sendBtn = screen.getByText('Send').closest('button') as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(true);
    const textarea = screen.getByPlaceholderText('What happened? What did you expect?');
    fireEvent.change(textarea, { target: { value: 'It crashed on load' } });
    expect((textarea as HTMLTextAreaElement).value).toBe('It crashed on load');
    expect(sendBtn.disabled).toBe(false);
  });

  it('submits a bug report: posts to /api/feedback/submit, funnels client error, shows sent view', async () => {
    render(<HelpButton />);
    fireEvent.click(screen.getByLabelText('Help and feedback'));
    fireEvent.click(screen.getByText('Report a bug or problem'));
    fireEvent.change(screen.getByPlaceholderText('What happened? What did you expect?'), {
      target: { value: 'Button does nothing' },
    });
    fireEvent.click(screen.getByText('Send').closest('button') as HTMLButtonElement);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/feedback/submit',
        expect.objectContaining({ method: 'POST' })
      );
    });
    // Bug reports route through the client-error funnel.
    expect(reportClientError).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'feedback', message: 'Button does nothing' })
    );
    await waitFor(() => {
      expect(screen.getByText('Thank you — we got it.')).toBeDefined();
    });
  });

  it('feedback submit does NOT call the client-error funnel', async () => {
    render(<HelpButton />);
    fireEvent.click(screen.getByLabelText('Help and feedback'));
    fireEvent.click(screen.getByText('Share feedback or an idea'));
    fireEvent.change(screen.getByPlaceholderText("Tell us what's on your mind…"), {
      target: { value: 'Love the UI' },
    });
    fireEvent.click(screen.getByText('Send').closest('button') as HTMLButtonElement);

    await waitFor(() => {
      expect(screen.getByText('Thank you — we got it.')).toBeDefined();
    });
    expect(reportClientError).not.toHaveBeenCalled();
  });

  it('Back from the sent view returns to the menu', async () => {
    render(<HelpButton />);
    fireEvent.click(screen.getByLabelText('Help and feedback'));
    fireEvent.click(screen.getByText('Report a bug or problem'));
    fireEvent.change(screen.getByPlaceholderText('What happened? What did you expect?'), {
      target: { value: 'Something broke' },
    });
    fireEvent.click(screen.getByText('Send').closest('button') as HTMLButtonElement);

    // Wait for the sent view, then click its Back button.
    await screen.findByText('Thank you — we got it.');
    fireEvent.click(screen.getByText('Back'));
    await waitFor(() => {
      expect(screen.getByText('Need a hand?')).toBeDefined();
    });
  });

  it('shows an error toast when the response is not ok', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<HelpButton />);
    fireEvent.click(screen.getByLabelText('Help and feedback'));
    fireEvent.click(screen.getByText('Report a bug or problem'));
    fireEvent.change(screen.getByPlaceholderText('What happened? What did you expect?'), {
      target: { value: 'fails' },
    });
    fireEvent.click(screen.getByText('Send').closest('button') as HTMLButtonElement);

    await waitFor(() => {
      expect(
        useUIStore.getState().toasts.some((t) => t.type === 'error')
      ).toBe(true);
    });
    // Still on the form, not the sent view.
    expect(screen.queryByText('Thank you — we got it.')).toBeNull();
  });

  it('shows an error toast when fetch rejects', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<HelpButton />);
    fireEvent.click(screen.getByLabelText('Help and feedback'));
    fireEvent.click(screen.getByText('Report a bug or problem'));
    fireEvent.change(screen.getByPlaceholderText('What happened? What did you expect?'), {
      target: { value: 'boom' },
    });
    fireEvent.click(screen.getByText('Send').closest('button') as HTMLButtonElement);

    await waitFor(() => {
      expect(
        useUIStore
          .getState()
          .toasts.some((t) => t.type === 'error' && t.message.includes('support@concord-os.org'))
      ).toBe(true);
    });
  });

  it('submitting an empty/whitespace message is a no-op (no fetch)', () => {
    render(<HelpButton />);
    fireEvent.click(screen.getByLabelText('Help and feedback'));
    fireEvent.click(screen.getByText('Report a bug or problem'));
    const textarea = screen.getByPlaceholderText('What happened? What did you expect?');
    fireEvent.change(textarea, { target: { value: '   ' } });
    // Button is disabled at whitespace, but exercise submit() guard directly via the enabled path is impossible;
    // assert the disabled state holds and no request fired.
    const sendBtn = screen.getByText('Send').closest('button') as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('launcher and panel clear the global bottom bar + safe area on phones', () => {
    // Real defect: the launcher's hard-coded bottom-20 (80px) sat under the
    // global MobileNav at phone width (h-14 = 56px + up to 34px home-indicator
    // inset on notched phones), and the panel then opened over the bar too.
    // Structure assertion (jsdom has no layout): below md both offset by
    // calc(4rem + safe-area inset) / calc(7rem + safe-area inset); at md+
    // (bar hidden) the old md:bottom-5 / md:bottom-20 values are kept.
    render(<HelpButton />);
    const launcher = screen.getByLabelText('Help and feedback');
    expect(launcher.className).toContain('bottom-[calc(4rem+env(safe-area-inset-bottom,0px))]');
    expect(launcher.className).toContain('md:bottom-5');
    fireEvent.click(launcher);
    const panel = screen.getByRole('dialog');
    expect(panel.className).toContain('bottom-[calc(7rem+env(safe-area-inset-bottom,0px))]');
    expect(panel.className).toContain('md:bottom-20');
  });

  it('never shares a position with the Install banner: launcher + panel lift above its measured footprint', () => {
    // Real defect (oc-social-3afix item 1): at 390x844 the launcher's
    // bottom offset landed exactly on the Install banner's X close button,
    // so tapping X opened this menu and the banner could not be dismissed.
    // The banner publishes its measured footprint; while it is showing
    // the launcher sits 16px above the banner top (inline style wins over
    // the class offsets at every width) and the panel opens above the
    // launcher.
    useUIStore.setState({ installBannerFootprint: 168 });
    render(<HelpButton />);
    const launcher = screen.getByLabelText('Help and feedback');
    expect(launcher.style.bottom).toBe('184px'); // 168 + 16
    fireEvent.click(launcher);
    const panel = screen.getByRole('dialog');
    expect(panel.style.bottom).toBe('232px'); // 168 + 64 (above the 44px launcher)
    // The banner's own close button stays clickable — the help menu is
    // nowhere near it.
  });

  it('returns to its normal offsets once the banner is dismissed (no leftover inline style)', () => {
    useUIStore.setState({ installBannerFootprint: 168 });
    const { rerender } = render(<HelpButton />);
    expect(screen.getByLabelText('Help and feedback').style.bottom).toBe('184px');
    useUIStore.setState({ installBannerFootprint: 0 });
    rerender(<HelpButton />);
    expect(screen.getByLabelText('Help and feedback').style.bottom).toBe('');
  });
});
