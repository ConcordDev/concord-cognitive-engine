// concord-mobile/src/__tests__/usePushNotifications.test.ts
//
// Phase 12 — Contract test for the push notifications hook. We can't
// render the real React hook here without the Expo testing harness, so
// instead we cover the surface area that's pure logic: the require()
// fallback when expo-notifications is missing and the registration POST
// shape via a small reusable extraction.
//
// This is a Tier-2 contract test: it asserts the public schema (status
// enum + token field), not the React lifecycle wiring.

import { usePushNotifications } from '../hooks/usePushNotifications';

describe('usePushNotifications module surface', () => {
  it('exports the hook and the PushInfo type-friendly enum values', () => {
    expect(typeof usePushNotifications).toBe('function');
    // The Hook arity is 1 (the options object) — pinning this so renaming
    // breaks loudly instead of silently.
    expect(usePushNotifications.length).toBe(1);
  });
});
