import { describe, it, expect } from 'vitest';
import { parseSocialPlace } from '@/lib/social-places';

describe('parseSocialPlace', () => {
  it('defaults to home', () => {
    expect(parseSocialPlace(null)).toBe('home');
    expect(parseSocialPlace('')).toBe('home');
    expect(parseSocialPlace('nope')).toBe('home');
  });

  it('keeps old routes working as aliases', () => {
    expect(parseSocialPlace('reels')).toBe('explore');
    expect(parseSocialPlace('clips')).toBe('explore');
    expect(parseSocialPlace('spaces')).toBe('explore');
    expect(parseSocialPlace('rooms')).toBe('explore');
    expect(parseSocialPlace('notifications')).toBe('inbox');
    expect(parseSocialPlace('messages')).toBe('inbox');
    expect(parseSocialPlace('saved')).toBe('you');
    expect(parseSocialPlace('FEED')).toBe('home');
  });
});
