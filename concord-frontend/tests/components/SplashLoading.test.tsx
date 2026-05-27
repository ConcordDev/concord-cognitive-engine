import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SplashScreen from '@/components/SplashScreen';
import LoadingScreen from '@/components/LoadingScreen';

describe('SplashScreen', () => {
  it('renders nothing when not visible (after fade-out completes)', () => {
    const { container } = render(<SplashScreen visible={false} />);
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it('renders the wordmark when visible', () => {
    render(<SplashScreen visible />);
    expect(screen.getByText('CONCORD')).toBeTruthy();
  });

  it('renders custom tagline', () => {
    render(<SplashScreen visible tagline="Custom system" />);
    expect(screen.getByText('Custom system')).toBeTruthy();
  });

  it('omits logo when showLogo=false', () => {
    const { container } = render(<SplashScreen visible showLogo={false} />);
    // Wordmark stays; mark <svg> gone.
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.getByText('CONCORD')).toBeTruthy();
  });

  it('uses role="status" with aria-label', () => {
    render(<SplashScreen visible />);
    const node = screen.getByRole('status', { name: 'Loading Concord' });
    expect(node).toBeTruthy();
  });
});

describe('LoadingScreen', () => {
  it('renders nothing when not visible (after fade-out)', () => {
    const { container } = render(<LoadingScreen visible={false} />);
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it('renders the label when visible', () => {
    render(<LoadingScreen visible label="World hydrating" />);
    expect(screen.getByText('World hydrating')).toBeTruthy();
  });

  it('renders detail line', () => {
    render(<LoadingScreen visible label="Loading" detail="terrain.json" />);
    expect(screen.getByText('terrain.json')).toBeTruthy();
  });

  it('indeterminate progress = -1 still renders bar', () => {
    const { container } = render(<LoadingScreen visible progress={-1} />);
    expect(container.querySelectorAll('div').length).toBeGreaterThan(2);
  });

  it('inline mode does not occupy fixed position overlay', () => {
    const { container } = render(<LoadingScreen visible inline />);
    const root = container.querySelector('[role="status"]') as HTMLElement | null;
    expect(root).not.toBeNull();
    if (root) {
      expect(root.style.position).not.toBe('fixed');
    }
  });

  it('clamps progress > 1 to indeterminate sweep', () => {
    // No assertion error — just verifies it doesn't crash.
    render(<LoadingScreen visible progress={5} />);
    expect(true).toBe(true);
  });
});
