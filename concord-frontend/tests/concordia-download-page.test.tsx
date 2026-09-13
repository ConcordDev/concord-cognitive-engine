import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ConcordiaDownloadPage from '@/app/download/concordia/page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    back: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

describe('Concordia download page', () => {
  it('names the WebGL path and does not invent a desktop installer', () => {
    render(<ConcordiaDownloadPage />);
    expect(screen.getByTestId('concordia-download')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open WebGL directly/i })).toHaveAttribute(
      'href',
      '/unity-client/index.html',
    );
    expect(screen.getByRole('link', { name: /Play in browser/i })).toHaveAttribute(
      'href',
      '/lenses/world',
    );
    expect(screen.getByText(/no standalone desktop installer/i)).toBeInTheDocument();
  });
});
