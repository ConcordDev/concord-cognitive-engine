import { describe, it, expect, beforeEach } from 'vitest';
import { validateReturnTo, currentReturnTo, DEFAULT_RETURN_TO } from '@/lib/return-to';
import { stashDraft, takeDraft, peekDraft, clearGuestDrafts } from '@/lib/draft-stash';
import { lensRunAllowedForGuest, GuestActionBlocked, isGuestActionBlocked } from '@/lib/guest-bridge';

/**
 * GB-1536 §6d (unit half) — the return-to rule and the intent-draft
 * stash. One validation rule everywhere (modal, login, register,
 * OAuth, confirm-age): a same-origin relative path, never back into
 * the auth flow, default /hub. The draft stash restores FIELDS ONLY —
 * nothing here can submit anything.
 */
describe('validateReturnTo', () => {
  it('keeps an ordinary in-app path with search + hash', () => {
    expect(validateReturnTo('/lenses/chem?study=beam-1#results')).toBe('/lenses/chem?study=beam-1#results');
    expect(validateReturnTo('/hub')).toBe('/hub');
    expect(validateReturnTo('/lenses/code')).toBe('/lenses/code');
  });

  it('rejects absolute and protocol-relative URLs (open-redirect shapes)', () => {
    expect(validateReturnTo('https://evil.example/hub')).toBe(DEFAULT_RETURN_TO);
    expect(validateReturnTo('//evil.example/hub')).toBe(DEFAULT_RETURN_TO);
    expect(validateReturnTo('/\\evil.example')).toBe(DEFAULT_RETURN_TO);
    expect(validateReturnTo('javascript:alert(1)')).toBe(DEFAULT_RETURN_TO);
  });

  it('rejects the auth flow itself (would loop or strand the user)', () => {
    expect(validateReturnTo('/login')).toBe(DEFAULT_RETURN_TO);
    expect(validateReturnTo('/login?from=/hub')).toBe(DEFAULT_RETURN_TO);
    expect(validateReturnTo('/register')).toBe(DEFAULT_RETURN_TO);
    expect(validateReturnTo('/signup')).toBe(DEFAULT_RETURN_TO);
    expect(validateReturnTo('/onboarding')).toBe(DEFAULT_RETURN_TO);
    expect(validateReturnTo('/onboarding/confirm-age')).toBe(DEFAULT_RETURN_TO);
  });

  it('rejects junk input to the default', () => {
    expect(validateReturnTo('')).toBe(DEFAULT_RETURN_TO);
    expect(validateReturnTo(null)).toBe(DEFAULT_RETURN_TO);
    expect(validateReturnTo(undefined)).toBe(DEFAULT_RETURN_TO);
    expect(validateReturnTo(42)).toBe(DEFAULT_RETURN_TO);
    expect(validateReturnTo('hub')).toBe(DEFAULT_RETURN_TO); // no leading slash
    expect(validateReturnTo('/' + 'x'.repeat(3000))).toBe(DEFAULT_RETURN_TO); // oversized
  });

  it('currentReturnTo reads path + search + hash from the live URL', () => {
    window.history.pushState({}, '', '/lenses/music?tab=tracks#top');
    expect(currentReturnTo()).toBe('/lenses/music?tab=tracks#top');
    window.history.pushState({}, '', '/login');
    expect(currentReturnTo()).toBe(DEFAULT_RETURN_TO);
  });
});

describe('draft stash (GB-1536 §3d safe subset)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    window.history.pushState({}, '', '/lenses/chem');
  });

  it('round-trips fields keyed by the exact returnTo, and taking consumes', () => {
    stashDraft('/lenses/chem', { chat: 'size a beam for a 4 m span' });
    expect(peekDraft('/lenses/chem')).toEqual({ chat: 'size a beam for a 4 m span' });
    expect(takeDraft('/lenses/chem')).toEqual({ chat: 'size a beam for a 4 m span' });
    expect(takeDraft('/lenses/chem')).toBeNull(); // consumed
  });

  it('is keyed per returnTo — a different page gets nothing', () => {
    stashDraft('/lenses/chem', { chat: 'x' });
    expect(takeDraft('/lenses/code')).toBeNull();
  });

  it('expires after 30 minutes', () => {
    stashDraft('/lenses/chem', { chat: 'old' });
    const key = 'concord_guest_draft:/lenses/chem';
    const entry = JSON.parse(sessionStorage.getItem(key)!);
    entry.savedAt = Date.now() - 31 * 60 * 1000;
    sessionStorage.setItem(key, JSON.stringify(entry));
    expect(takeDraft('/lenses/chem')).toBeNull();
  });

  it('clearGuestDrafts wipes every stashed intent (logout)', () => {
    stashDraft('/lenses/chem', { chat: 'a' });
    stashDraft('/lenses/code', { q: 'b' });
    clearGuestDrafts();
    expect(peekDraft('/lenses/chem')).toBeNull();
    expect(peekDraft('/lenses/code')).toBeNull();
  });
});

describe('guest-bridge lensRun mirror', () => {
  it('allows exactly the guestRead mirror list through the client backstop', () => {
    expect(lensRunAllowedForGuest({ domain: 'lens', action: 'list' })).toBe(true);
    expect(lensRunAllowedForGuest({ domain: 'lens', action: 'get' })).toBe(true);
    expect(lensRunAllowedForGuest({ domain: 'code', action: 'snippets-list' })).toBe(true);
    expect(lensRunAllowedForGuest({ domain: 'code', action: 'snapshots-list' })).toBe(true);
  });

  it('blocks everything else, including writes dressed as reads', () => {
    expect(lensRunAllowedForGuest({ domain: 'code', action: 'snippets-save' })).toBe(false);
    expect(lensRunAllowedForGuest({ domain: 'lens', action: 'create' })).toBe(false);
    expect(lensRunAllowedForGuest({ domain: 'lens', action: 'list ' })).toBe(false);
    expect(lensRunAllowedForGuest(null)).toBe(false);
    expect(lensRunAllowedForGuest({})).toBe(false);
    expect(lensRunAllowedForGuest('lens.list')).toBe(false);
  });

  it('GuestActionBlocked is a typed, detectable rejection carrying the returnTo', () => {
    const err = new GuestActionBlocked('/lenses/chem');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('GuestActionBlocked');
    expect(err.returnTo).toBe('/lenses/chem');
    expect(isGuestActionBlocked(err)).toBe(true);
    expect(isGuestActionBlocked(new Error('nope'))).toBe(false);
  });
});
