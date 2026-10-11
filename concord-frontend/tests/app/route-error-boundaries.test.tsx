import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

const reportFrontendError = vi.fn(() => Promise.resolve());
vi.mock('@/lib/report-frontend-error', () => ({
  reportFrontendError: (...args: unknown[]) => reportFrontendError(...args),
}));

vi.mock('@/hooks/useBugContext', () => ({
  reportClientError: vi.fn(),
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}));

import RootError from '@/app/error';
import LensError from '@/app/lenses/error';
import GlobalError from '@/app/global-error';

function boom(message: string, digest: string) {
  return Object.assign(new Error(message), { digest });
}

describe('route error boundaries report once', () => {
  beforeEach(() => {
    reportFrontendError.mockClear();
    window.history.pushState({}, '', '/lenses/demo');
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function expectOnce(
    renderWith: (error: Error & { digest?: string }) => React.ReactElement,
    lens: string,
    visible: string,
  ) {
    const { rerender } = render(renderWith(boom('boom', 'dig1')));
    expect(screen.getByText(visible)).toBeInTheDocument();
    rerender(renderWith(boom('boom', 'dig1')));
    expect(reportFrontendError).toHaveBeenCalledTimes(1);
    expect(reportFrontendError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'boom', digest: 'dig1' }),
      expect.objectContaining({ lens, route: '/lenses/demo' }),
    );
  }

  it('app/error.tsx calls reportFrontendError exactly once across re-renders', () => {
    expectOnce(
      (error) => <RootError error={error} reset={() => {}} />,
      'root',
      'Something went wrong',
    );
  });

  it('app/lenses/error.tsx calls reportFrontendError exactly once across re-renders', () => {
    expectOnce(
      (error) => <LensError error={error} reset={() => {}} />,
      'lenses',
      'Lens Error',
    );
  });

  it('app/global-error.tsx calls reportFrontendError exactly once across re-renders', () => {
    expectOnce(
      (error) => <GlobalError error={error} reset={() => {}} />,
      'global',
      'Something went wrong',
    );
  });
});
