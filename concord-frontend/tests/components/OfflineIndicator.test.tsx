import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';

// Mock framer-motion to render plain elements
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: import('react').ReactNode }) => children,
  motion: {
    button: ({ children, ...props }: Record<string, unknown>) => <button {...props}>{children as React.ReactNode}</button>,
    div: ({ children, ...props }: Record<string, unknown>) => <div {...props}>{children as React.ReactNode}</div>,
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock lucide-react
vi.mock('lucide-react', () => ({
  Wifi: ({ className }: { className?: string }) => <span data-testid="wifi-icon" className={className} />,
  WifiOff: ({ className }: { className?: string }) => <span data-testid="wifi-off-icon" className={className} />,
  Cloud: ({ className }: { className?: string }) => <span data-testid="cloud-icon" className={className} />,
  RefreshCw: ({ className }: { className?: string }) => <span data-testid="refresh-icon" className={className} />,
  Check: ({ className }: { className?: string }) => <span data-testid="check-icon" className={className} />,
  AlertCircle: ({ className }: { className?: string }) => <span data-testid="alert-icon" className={className} />,
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: (string | boolean | undefined | null)[]) => args.filter(Boolean).join(' '),
}));

import { OfflineIndicator, SyncStatusDot, ConnectionToast, useOnlineStatus } from '@/components/common/OfflineIndicator';
import { renderHook } from '@testing-library/react';

describe('OfflineIndicator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default to online
    Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true });
  });

  it('renders with default "All changes saved" status', () => {
    render(<OfflineIndicator />);
    expect(screen.getByText('All changes saved')).toBeInTheDocument();
  });

  it('renders with pending changes status', () => {
    render(<OfflineIndicator pendingChanges={3} />);
    expect(screen.getByText('3 pending')).toBeInTheDocument();
  });

  it('toggles expanded details on click', () => {
    render(<OfflineIndicator pendingChanges={0} />);

    const button = screen.getByText('All changes saved').closest('button')!;
    fireEvent.click(button);

    // Expanded content should now be visible
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('Real-time sync active')).toBeInTheDocument();
  });

  it('shows pending changes count in expanded view', () => {
    render(<OfflineIndicator pendingChanges={5} />);

    const button = screen.getByText('5 pending').closest('button')!;
    fireEvent.click(button);

    expect(screen.getByText('Pending changes')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('shows lastSynced time in expanded view', () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    render(<OfflineIndicator lastSynced={fiveMinutesAgo} />);

    const button = screen.getByText('All changes saved').closest('button')!;
    fireEvent.click(button);

    expect(screen.getByText('Last synced')).toBeInTheDocument();
    expect(screen.getByText('5m ago')).toBeInTheDocument();
  });

  it('shows "Just now" for very recent sync', () => {
    const justNow = new Date();
    render(<OfflineIndicator lastSynced={justNow} />);

    const button = screen.getByText('All changes saved').closest('button')!;
    fireEvent.click(button);

    expect(screen.getByText('Just now')).toBeInTheDocument();
  });

  it('shows hours ago for older sync', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    render(<OfflineIndicator lastSynced={twoHoursAgo} />);

    const button = screen.getByText('All changes saved').closest('button')!;
    fireEvent.click(button);

    expect(screen.getByText('2h ago')).toBeInTheDocument();
  });

  it('shows "Sync now" button when online with pending changes', () => {
    const onSync = vi.fn();
    render(<OfflineIndicator pendingChanges={3} onSync={onSync} />);

    const button = screen.getByText('3 pending').closest('button')!;
    fireEvent.click(button);

    const syncButton = screen.getByText('Sync now');
    expect(syncButton).toBeInTheDocument();

    fireEvent.click(syncButton);
    expect(onSync).toHaveBeenCalledTimes(1);
  });

  it('shows offline message when offline', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, writable: true, configurable: true });
    render(<OfflineIndicator />);

    const button = screen.getByText('Offline').closest('button')!;
    fireEvent.click(button);

    expect(screen.getByText(/changes are being saved locally/i)).toBeInTheDocument();
  });

  it('does not show expanded details when showDetails is false', () => {
    render(<OfflineIndicator showDetails={false} />);

    const button = screen.getByText('All changes saved').closest('button')!;
    fireEvent.click(button);

    // Should not show expanded content
    expect(screen.queryByText('Connected')).not.toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(<OfflineIndicator className="my-custom-class" />);
    expect(container.firstChild).toHaveClass('my-custom-class');
  });

  it('responds to online/offline events', () => {
    render(<OfflineIndicator />);
    expect(screen.getByText('All changes saved')).toBeInTheDocument();

    act(() => {
      Object.defineProperty(navigator, 'onLine', { value: false, writable: true, configurable: true });
      window.dispatchEvent(new Event('offline'));
    });

    expect(screen.getByText('Offline')).toBeInTheDocument();
  });
});

describe('SyncStatusDot', () => {
  it('renders a dot for synced status', () => {
    const { container } = render(<SyncStatusDot status="synced" />);
    expect(container.querySelector('.bg-green-400')).toBeInTheDocument();
  });

  it('renders a dot for offline status', () => {
    const { container } = render(<SyncStatusDot status="offline" />);
    expect(container.querySelector('.bg-gray-400')).toBeInTheDocument();
  });

  it('renders a dot for error status', () => {
    const { container } = render(<SyncStatusDot status="error" />);
    expect(container.querySelector('.bg-red-400')).toBeInTheDocument();
  });

  it('renders a dot for pending status', () => {
    const { container } = render(<SyncStatusDot status="pending" />);
    expect(container.querySelector('.bg-yellow-400')).toBeInTheDocument();
  });
});

describe('ConnectionToast', () => {
  it('renders online message', () => {
    render(<ConnectionToast isOnline={true} />);
    expect(screen.getByText(/Back online/i)).toBeInTheDocument();
  });

  it('renders offline message', () => {
    render(<ConnectionToast isOnline={false} />);
    expect(screen.getByText(/You're offline/i)).toBeInTheDocument();
  });
});

describe('useOnlineStatus', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true });
  });

  it('returns isOnline true when online', () => {
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current.isOnline).toBe(true);
    expect(result.current.wasOffline).toBe(false);
  });

  it('updates when going offline', () => {
    const { result } = renderHook(() => useOnlineStatus());

    act(() => {
      Object.defineProperty(navigator, 'onLine', { value: false, writable: true, configurable: true });
      window.dispatchEvent(new Event('offline'));
    });

    expect(result.current.isOnline).toBe(false);
    expect(result.current.wasOffline).toBe(true);
  });

  it('updates when coming back online', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, writable: true, configurable: true });
    const { result } = renderHook(() => useOnlineStatus());

    act(() => {
      Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true });
      window.dispatchEvent(new Event('online'));
    });

    expect(result.current.isOnline).toBe(true);
  });
});
