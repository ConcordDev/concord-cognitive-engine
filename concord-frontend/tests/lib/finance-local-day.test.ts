import { describe, expect, it } from 'vitest';
import { localCalendarDay } from '@/lib/finance/local-day';
import { PRICE_FEED_UNAVAILABLE, priceFeedLabel } from '@/lib/finance/price-feed';
import { authorLabel } from '@/components/social/feed/authorLabel';

describe('localCalendarDay', () => {
  it('uses the local calendar fields', () => {
    const night = new Date(2026, 9, 10, 23, 30, 0);
    expect(localCalendarDay(night)).toBe('2026-10-10');
  });
});

describe('price feed status copy', () => {
  it('uses one phrase for an unavailable feed', () => {
    expect(priceFeedLabel('unavailable')).toBe(PRICE_FEED_UNAVAILABLE);
    expect(PRICE_FEED_UNAVAILABLE).toBe('price feed unavailable');
    expect(priceFeedLabel('live')).toBe('Market feed live');
  });
});

describe('authorLabel', () => {
  it('shows a display name and handle, and hides a raw user id', () => {
    expect(authorLabel('user_abc', 'ada', 'Ada Lovelace')).toEqual({ name: 'Ada Lovelace', handle: 'ada' });
    expect(authorLabel('user_abc', 'user_abc', null)).toEqual({ name: 'Member', handle: null });
  });
});
