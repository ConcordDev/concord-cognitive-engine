import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();

vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { PublishAsBlueprintDialog } from '@/components/whiteboard/PublishAsBlueprintDialog';

describe('PublishAsBlueprintDialog', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
    lensRunMock.mockImplementation((_d: string, action: string) => {
      if (action === 'published-blueprint-coverage') {
        return Promise.resolve({ data: { ok: true, result: {
          userId: 'user_alice',
          archetypes: { tavern: null, archive: null, forge: null, market: null, tower: null },
        } } });
      }
      return Promise.resolve({ data: { ok: false, error: 'unknown' } });
    });
  });

  it('renders all 5 archetype buttons', () => {
    const { container } = render(<PublishAsBlueprintDialog boardId="b1" onClose={() => undefined} />);
    const buttons = Array.from(container.querySelectorAll('button'))
      .filter((b) => ['tavern', 'archive', 'forge', 'market', 'tower']
        .includes(b.firstChild?.textContent?.trim() ?? ''));
    expect(buttons.length).toBe(5);
  });

  it('fetches coverage on mount', async () => {
    render(<PublishAsBlueprintDialog boardId="b1" onClose={() => undefined} />);
    await waitFor(() => {
      const cov = lensRunMock.mock.calls.find((c) => c[1] === 'published-blueprint-coverage');
      expect(cov).toBeTruthy();
    });
  });

  it('Publish call carries archetype + boardId + json-snap when no svgDataUrl', async () => {
    lensRunMock.mockImplementation((_d: string, action: string) => {
      if (action === 'published-blueprint-coverage') {
        return Promise.resolve({ data: { ok: true, result: {
          userId: 'user_alice',
          archetypes: { tavern: null, archive: null, forge: null, market: null, tower: null },
        } } });
      }
      if (action === 'publish-as-blueprint') {
        return Promise.resolve({ data: { ok: true, result: {
          assetId: 'a1', created: true, sourceId: 'blueprint:tavern:user_alice:b1',
          archetype: 'tavern', boardId: 'b1', elementCount: 0,
          previewIncluded: false, resolveUrl: '/api/evo-asset/resolve?source=authored&sourceId=blueprint%3Atavern%3Auser_alice%3Ab1',
        } } });
      }
      return Promise.resolve({ data: { ok: false, error: 'unknown' } });
    });
    render(<PublishAsBlueprintDialog boardId="b1" onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /^Publish$/ }));
    await waitFor(() => {
      const publishCall = lensRunMock.mock.calls.find((c) => c[1] === 'publish-as-blueprint');
      expect(publishCall).toBeTruthy();
      expect(publishCall?.[2]).toMatchObject({
        archetype: 'tavern',
        boardId: 'b1',
        snapshotFormat: 'json-snap',
      });
    });
  });

  it('Publish carries svgDataUrl + svg-raster format when provided', async () => {
    lensRunMock.mockImplementation((_d: string, action: string) => {
      if (action === 'published-blueprint-coverage') {
        return Promise.resolve({ data: { ok: true, result: {
          userId: 'user_alice',
          archetypes: { tavern: null, archive: null, forge: null, market: null, tower: null },
        } } });
      }
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    render(
      <PublishAsBlueprintDialog
        boardId="b1"
        svgDataUrl="data:image/svg+xml;base64,PHN2Zy8+"
        onClose={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Publish$/ }));
    await waitFor(() => {
      const call = lensRunMock.mock.calls.find((c) => c[1] === 'publish-as-blueprint');
      expect(call?.[2]).toMatchObject({
        snapshotFormat: 'svg-raster',
        svgDataUrl: expect.stringMatching(/^data:image\/svg\+xml/),
      });
    });
  });

  it('shows error from server', async () => {
    lensRunMock.mockImplementation((_d: string, action: string) => {
      if (action === 'published-blueprint-coverage') {
        return Promise.resolve({ data: { ok: true, result: {
          userId: 'user_alice',
          archetypes: { tavern: null, archive: null, forge: null, market: null, tower: null },
        } } });
      }
      return Promise.resolve({ data: { ok: false, error: 'board not found' } });
    });
    render(<PublishAsBlueprintDialog boardId="b1" onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /^Publish$/ }));
    await waitFor(() => {
      expect(screen.getByText(/board not found/i)).toBeTruthy();
    });
  });

  it('backdrop click closes', () => {
    const onClose = vi.fn();
    render(<PublishAsBlueprintDialog boardId="b1" onClose={onClose} />);
    const dialog = screen.getByRole('dialog');
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalled();
  });

  it('empty boardId disables Publish', () => {
    render(<PublishAsBlueprintDialog boardId="" onClose={() => undefined} />);
    const btn = screen.getByRole('button', { name: /^Publish$/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
