// Phase G4 — WebView HUD wrappers contract test.
//
// Asserts the 9 wrapper screens exist + import without throw, the
// AuthedWebView component exports the expected interface, the API
// base URL helper returns a non-empty string, and the AppNavigator
// declares the 9 deep-link routes.

import fs from 'fs';
import path from 'path';
import { describe, expect, it } from '@jest/globals';
import { getApiBaseUrl } from '../../config/api';

// We deliberately avoid rendering these components because
// react-native-webview requires native module wiring (mocked in
// __mocks__/react-native-webview.js). We import them as modules and
// assert their type signatures. Static imports are used (not dynamic
// import()) because Jest's CJS transform doesn't support the dynamic
// import callback without --experimental-vm-modules.
import { DreamReaderScreen } from '../../surface/screens/DreamReaderScreen';
import { StrategicWarBannerScreen } from '../../surface/screens/StrategicWarBannerScreen';
import { ForwardPredictionsScreen } from '../../surface/screens/ForwardPredictionsScreen';
import { NPCSchemeOverhearScreen } from '../../surface/screens/NPCSchemeOverhearScreen';
import { LFGBoardScreen } from '../../surface/screens/LFGBoardScreen';
import { BrawlMatchmakingScreen } from '../../surface/screens/BrawlMatchmakingScreen';
import { SpectatorScreen } from '../../surface/screens/SpectatorScreen';
import { EmergentEventFeedScreen } from '../../surface/screens/EmergentEventFeedScreen';
import { PersonalBeatScreen } from '../../surface/screens/PersonalBeatScreen';
import { AuthedWebView } from '../../surface/components/AuthedWebView';

describe('Phase G4 — WebView HUD wrappers', () => {
  it('config/api.getApiBaseUrl returns a non-empty string', () => {
    const url = getApiBaseUrl();
    expect(typeof url).toBe('string');
    expect(url.length).toBeGreaterThan(0);
  });

  it('9 wrapper screens are importable', () => {
    const screens = [
      DreamReaderScreen,
      StrategicWarBannerScreen,
      ForwardPredictionsScreen,
      NPCSchemeOverhearScreen,
      LFGBoardScreen,
      BrawlMatchmakingScreen,
      SpectatorScreen,
      EmergentEventFeedScreen,
      PersonalBeatScreen,
    ];
    for (const screen of screens) {
      expect(typeof screen).toBe('function');
    }
    expect(screens.length).toBe(9);
  });

  it('AuthedWebView exports a function component', () => {
    expect(typeof AuthedWebView).toBe('function');
  });

  it('AppNavigator declares the 9 new deep-link routes', () => {
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
