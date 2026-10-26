/**
 * PostMediaCard — real media cards for posts that attach a Studio track
 * or a Marketplace item (job oc-social-3b item d).
 *
 * The substrate is real (server/lib/social-share.js): Studio shares carry
 * mediaType 'audio' + a public https mediaUrl; marketplace shares carry a
 * `listing` object copied from the listing row. These tests prove the
 * render is honest about both, and — the spec's hard rule — that audio
 * NEVER autoplays: play() is only called from the click handler, and the
 * audio element has preload="none" with no autoPlay attribute.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: (...a: unknown[]) => push(...a), back: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
}));
vi.mock('next/image', () => ({
  default: (props: { alt?: string }) => React.createElement('img', { alt: props.alt || '' }),
}));

import { PostMediaCard } from '@/components/social/PostMediaCard';

const AUDIO_URL = 'https://cdn.example.test/tracks/t-1.mp3';

describe('PostMediaCard', () => {
  let playSpy: ReturnType<typeof vi.fn>;
  let pauseSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    push.mockReset();
    playSpy = vi.fn(() => Promise.resolve());
    pauseSpy = vi.fn();
    // jsdom has no real media playback — stub the element API the card
    // drives. The assertions below are about WHO calls play() and WHEN.
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
      playSpy();
      return Promise.resolve();
    });
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
      pauseSpy();
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it('renders an audio card with a play button and a native audio element — never autoplay', () => {
    const { container } = render(<PostMediaCard mediaType="audio" mediaUrl={AUDIO_URL} />);
    expect(screen.getByRole('button', { name: 'Play attached audio track' })).toBeTruthy();
    const audio = container.querySelector('audio');
    expect(audio).toBeTruthy();
    expect(audio?.getAttribute('src')).toBe(AUDIO_URL);
    // No autoplay, and nothing is preloaded before the user acts.
    expect(audio?.hasAttribute('autoplay')).toBe(false);
    expect(audio?.getAttribute('preload')).toBe('none');
  });

  it('does NOT call play() on mount — playback starts only from the click', () => {
    render(<PostMediaCard mediaType="audio" mediaUrl={AUDIO_URL} />);
    expect(playSpy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Play attached audio track' }));
    expect(playSpy).toHaveBeenCalledTimes(1);
  });

  it('clicking play then clicking again pauses the track', () => {
    render(<PostMediaCard mediaType="audio" mediaUrl={AUDIO_URL} />);
    const btn = screen.getByRole('button', { name: 'Play attached audio track' });
    fireEvent.click(btn);
    // The element's 'play' listener (real event dispatch by the stubbed
    // play implementation is not automatic in jsdom) — flip the state the
    // way the browser would, then pause via the button.
    fireEvent(btn.ownerDocument.querySelector('audio')!, new Event('play'));
    fireEvent.click(screen.getByRole('button', { name: 'Pause attached audio track' }));
    expect(pauseSpy).toHaveBeenCalledTimes(1);
  });

  it('renders a marketplace listing as a real commerce card with the row’s real fields', () => {
    render(
      <PostMediaCard
        listing={{ id: 'list-9', title: 'Midnight Loop', priceCents: 1200, currency: 'CC', transferRate: 0.02, marketplaceRate: 0.03 }}
      />,
    );
    // price_cents is the listings table's canonical column — /100 is a unit
    // conversion the card must do, not a made-up number.
    expect(screen.getByText('Midnight Loop')).toBeTruthy();
    expect(screen.getByText('12 CC')).toBeTruthy();
    // Fee rates copied by the server from economy/fees.js — rendered from
    // the payload, never hard-coded.
    expect(screen.getByText(/transfer fee 2\.00% · marketplace fee 3\.00%/)).toBeTruthy();
  });

  it('opens the real marketplace listing page when the item is tapped', () => {
    render(<PostMediaCard listing={{ id: 'list-9', title: 'Midnight Loop', price: 12, currency: 'CC' }} />);
    fireEvent.click(screen.getByText('Midnight Loop'));
    expect(push).toHaveBeenCalledWith('/lenses/marketplace/music/list-9');
  });

  it('a listing without any price gets an honest text line, not a fake card', () => {
    render(<PostMediaCard listing={{ id: 'list-10', title: 'Untitled item', transferRate: 0.02 }} />);
    expect(screen.getByText(/Shared a marketplace item: Untitled item/)).toBeTruthy();
    expect(screen.getByText(/transfer fee 2\.00%/)).toBeTruthy();
    // No commerce card is claimed when the data never carried a price.
    expect(screen.queryByText('Buy')).toBeNull();
  });

  it('renders nothing when the post has neither attachment', () => {
    const { container } = render(<PostMediaCard mediaType="text" mediaUrl={null} listing={null} />);
    expect(container.firstElementChild).toBeNull();
  });
});