// Phase G4 — WebView HUD wrappers contract test.
//
// Asserts the 9 wrapper screens exist + import without throw, the
// AuthedWebView component exports the expected interface, the API
// base URL helper returns a non-empty string, and the AppNavigator
// declares the 9 deep-link routes.

import { describe, expect, it } from '@jest/globals';
import { getApiBaseUrl } from '../../config/api';

// Note: we deliberately avoid rendering these components in the test
// because react-native-webview requires native module wiring that
// Jest can't load. We import them as modules and assert their type
// signatures.

describe('Phase G4 — WebView HUD wrappers', () => {
  it('config/api.getApiBaseUrl returns a non-empty string', () => {
    const url = getApiBaseUrl();
    expect(typeof url).toBe('string');
    expect(url.length).toBeGreaterThan(0);
  });

  it('9 wrapper screens are importable', async () => {
    const screens = await Promise.all([
      import('../../surface/screens/DreamReaderScreen').then(m => m.DreamReaderScreen),
      import('../../surface/screens/StrategicWarBannerScreen').then(m => m.StrategicWarBannerScreen),
      import('../../surface/screens/ForwardPredictionsScreen').then(m => m.ForwardPredictionsScreen),
      import('../../surface/screens/NPCSchemeOverhearScreen').then(m => m.NPCSchemeOverhearScreen),
      import('../../surface/screens/LFGBoardScreen').then(m => m.LFGBoardScreen),
      import('../../surface/screens/BrawlMatchmakingScreen').then(m => m.BrawlMatchmakingScreen),
      import('../../surface/screens/SpectatorScreen').then(m => m.SpectatorScreen),
      import('../../surface/screens/EmergentEventFeedScreen').then(m => m.EmergentEventFeedScreen),
      import('../../surface/screens/PersonalBeatScreen').then(m => m.PersonalBeatScreen),
    ]);
    for (const screen of screens) {
      expect(typeof screen).toBe('function');
    }
    expect(screens.length).toBe(9);
  });

  it('AuthedWebView exports a function component', async () => {
    const mod = await import('../../surface/components/AuthedWebView');
    expect(typeof mod.AuthedWebView).toBe('function');
  });

  it('AppNavigator declares the 9 new deep-link routes', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', '..', 'surface', 'navigation', 'AppNavigator.tsx'),
      'utf8',
    );
    for (const route of [
      'hud/dream-reader',
      'hud/war-banner',
      'hud/forward-predictions',
      'hud/scheme-overhear',
      'hud/lfg-board',
      'hud/brawl-queue',
      'hud/spectator',
      'hud/event-feed',
      'hud/personal-beat',
    ]) {
      expect(src).toContain(route);
    }
  });
});
