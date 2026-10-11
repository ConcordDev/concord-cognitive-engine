import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// Mock lucide-react
vi.mock('lucide-react', () => ({
  X: ({ className }: { className?: string }) => <span data-testid="x-icon" className={className} />,
  CheckCircle: ({ className }: { className?: string }) => <span data-testid="check-icon" className={className} />,
  AlertTriangle: ({ className }: { className?: string }) => <span data-testid="warning-icon" className={className} />,
  AlertCircle: ({ className }: { className?: string }) => <span data-testid="error-icon" className={className} />,
  Info: ({ className }: { className?: string }) => <span data-testid="info-icon" className={className} />,
}));

// Mock UI store
const mockRemoveToast = vi.fn();
const mockAddToast = vi.fn();
const mockUIStoreState = {
  toasts: [] as unknown[],
  removeToast: mockRemoveToast,
  addToast: mockAddToast,
};

vi.mock('@/store/ui', () => ({
  useUIStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) => selector(mockUIStoreState as unknown as Record<string, unknown>),
    {
      getState: () => mockUIStoreState,
    }
  ),
}));

import { Toasts, showToast } from '@/components/common/Toasts';

describe('Toasts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockUIStoreState.toasts = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders no toasts when list is empty', () => {
    render(<Toasts />);
    const region = screen.getByRole('region', { name: /notifications/i });
    expect(region).toBeInTheDocument();
    expect(region.children).toHaveLength(0);
  });

  it('renders an Open link next to the DTU id', () => {
    mockUIStoreState.toasts = [
      { id: 'toast-1', type: 'success', message: 'Private DTU dtu_field_notes', href: '/dtu/dtu_field_notes', linkLabel: 'Open' },
    ];

    render(<Toasts />);
    expect(screen.getByText('Private DTU dtu_field_notes')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/dtu/dtu_field_notes');
  });

  it('renders a success toast', () => {
    mockUIStoreState.toasts = [
      { id: 'toast-1', type: 'success', message: 'Item saved successfully' },
    ];

    render(<Toasts />);
    expect(screen.getByText('Item saved successfully')).toBeInTheDocument();
    expect(screen.getByTestId('check-icon')).toBeInTheDocument();
  });

  it('renders an error toast', () => {
    mockUIStoreState.toasts = [
      { id: 'toast-1', type: 'error', message: 'Something went wrong' },
    ];

    render(<Toasts />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByTestId('error-icon')).toBeInTheDocument();
  });

  it('renders a warning toast', () => {
    mockUIStoreState.toasts = [
      { id: 'toast-1', type: 'warning', message: 'This action cannot be undone' },
    ];

    render(<Toasts />);
    expect(screen.getByText('This action cannot be undone')).toBeInTheDocument();
    expect(screen.getByTestId('warning-icon')).toBeInTheDocument();
  });

  it('renders an info toast', () => {
    mockUIStoreState.toasts = [
      { id: 'toast-1', type: 'info', message: 'New update available' },
    ];

    render(<Toasts />);
    expect(screen.getByText('New update available')).toBeInTheDocument();
    expect(screen.getByTestId('info-icon')).toBeInTheDocument();
  });

  it('renders multiple toasts', () => {
    mockUIStoreState.toasts = [
      { id: 'toast-1', type: 'success', message: 'First toast' },
      { id: 'toast-2', type: 'error', message: 'Second toast' },
    ];

    render(<Toasts />);
    expect(screen.getByText('First toast')).toBeInTheDocument();
    expect(screen.getByText('Second toast')).toBeInTheDocument();
  });

  it('calls removeToast when dismiss button is clicked', () => {
    mockUIStoreState.toasts = [
      { id: 'toast-1', type: 'info', message: 'Test toast' },
    ];

    render(<Toasts />);
    const dismissBtn = screen.getByLabelText('Dismiss notification');
    fireEvent.click(dismissBtn);

    expect(mockRemoveToast).toHaveBeenCalledWith('toast-1');
  });

  it('auto-dismisses toast after duration', () => {
    mockUIStoreState.toasts = [
      { id: 'toast-1', type: 'success', message: 'Auto dismiss', duration: 3000 },
    ];

    render(<Toasts />);

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(mockRemoveToast).toHaveBeenCalledWith('toast-1');
  });

  it('auto-dismisses after default 5000ms when no duration specified', () => {
    mockUIStoreState.toasts = [
      { id: 'toast-1', type: 'success', message: 'Auto dismiss' },
    ];

    render(<Toasts />);

    act(() => {
      vi.advanceTimersByTime(4999);
    });
    expect(mockRemoveToast).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(mockRemoveToast).toHaveBeenCalledWith('toast-1');
  });
});

describe('showToast', () => {
  it('calls addToast on the store', () => {
    showToast('success', 'Hello!', 3000);
    expect(mockAddToast).toHaveBeenCalledWith({
      type: 'success',
      message: 'Hello!',
      duration: 3000,
    });
  });

  it('works without duration argument', () => {
    showToast('error', 'Oops');
    expect(mockAddToast).toHaveBeenCalledWith({
      type: 'error',
      message: 'Oops',
      duration: undefined,
    });
  });
});
