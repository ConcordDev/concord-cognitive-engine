// Close-out A6 — the Chrome fix, in the shared shell components.
//
// Leg 1: LiveIndicator is a CONNECTION sign (socket health only). Its
// vocabulary names the connection — "Connected" / "Offline" — never
// "LIVE", the data claim that contradicted the tier banner beside it.
// Leg 2: ContentPublisher's Marketplace tab, mounted by the shared
// LensToolbar without an item, must not print the false "Save your
// work first" over work that already stands saved, and must not render
// a dead publish button as if a save were missing. With an item id, the
// publish control works exactly as before.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { ContentPublisher } from '@/components/lens/ContentPublisher';

vi.mock('@/lib/api/client', () => ({
  api: { post: vi.fn(async () => ({ data: { ok: true } })) },
}));

describe('A6 Leg 1 — the connection sign says what it measures', () => {
  it('compact: Connected when the socket is up, Offline when it is not — never LIVE/OFF', () => {
    const { rerender, container } = render(<LiveIndicator isLive lastUpdated={null} compact />);
    expect(screen.getByText('Connected')).toBeTruthy();
    expect(container.textContent).not.toMatch(/\bLIVE\b|\bOFF\b/);
    rerender(<LiveIndicator isLive={false} lastUpdated={null} compact />);
    expect(screen.getByText('Offline')).toBeTruthy();
    expect(container.textContent).not.toMatch(/\bLIVE\b/);
  });

  it('full: Connected / Disconnected, never LIVE', () => {
    const { rerender, container } = render(<LiveIndicator isLive lastUpdated={null} />);
    expect(screen.getByText('Connected')).toBeTruthy();
    expect(container.textContent).not.toMatch(/\bLIVE\b/);
    rerender(<LiveIndicator isLive={false} lastUpdated={null} />);
    expect(screen.getByText('Disconnected')).toBeTruthy();
  });
});

describe('A6 Leg 2 — the Marketplace tab without an item', () => {
  function openMarketTab(ui: React.ReactElement) {
    const { container } = render(ui);
    const toggle = container.querySelector('button');
    expect(toggle).toBeTruthy();
    fireEvent.click(toggle!);
    fireEvent.click(screen.getByText('Market'));
    return container;
  }

  it('no item: no false save-first note, no publish button — the truth in words', () => {
    const container = openMarketTab(<ContentPublisher domain="creative" compact />);
    expect(container.textContent).not.toMatch(/Save your work first/);
    expect(screen.queryByText('Publish to Marketplace')).toBeNull();
    expect(container.textContent).toMatch(/happens from the item itself/);
  });

  it('with an item: the publish control stands as before', () => {
    openMarketTab(<ContentPublisher domain="creative" artifactId="dtu_123" title="Board" />);
    expect(screen.getByText('Publish to Marketplace')).toBeTruthy();
  });
});
