// Tests for AppNavigator component

import React from 'react';
import { render } from '@testing-library/react-native';
import { AppNavigator, type RootTabParamList, type RootStackParamList } from '../../surface/navigation/AppNavigator';

// Mock all screen components
jest.mock('../../surface/screens/ChatScreen', () => ({
  ChatScreen: () => 'ChatScreen',
}));
jest.mock('../../surface/screens/LensesScreen', () => ({
  LensesScreen: () => 'LensesScreen',
}));
jest.mock('../../surface/screens/MarketplaceScreen', () => ({
  MarketplaceScreen: () => 'MarketplaceScreen',
}));
jest.mock('../../surface/screens/WalletScreen', () => ({
  WalletScreen: () => 'WalletScreen',
}));
jest.mock('../../surface/screens/MeshStatusScreen', () => ({
  MeshStatusScreen: () => 'MeshStatusScreen',
}));
jest.mock('../../surface/screens/AtlasScreen', () => ({
  AtlasScreen: () => 'AtlasScreen',
}));
jest.mock('../../surface/screens/SettingsScreen', () => ({
  SettingsScreen: () => 'SettingsScreen',
}));

// Track registered screens via the navigator mocks
const registeredTabScreens: string[] = [];
const registeredStackScreens: string[] = [];

jest.mock('@react-navigation/bottom-tabs', () => {
  const React = require('react');
  return {
    createBottomTabNavigator: () => ({
      Navigator: ({ children }: { children: React.ReactNode }) => (
        <>{children}</>
      ),
      Screen: ({ name }: { name: string }) => {
        if (!registeredTabScreens.includes(name)) {
          registeredTabScreens.push(name);
        }
        return null;
      },
    }),
  };
});

jest.mock('@react-navigation/native-stack', () => {
  const React = require('react');
  return {
    createNativeStackNavigator: () => ({
      Navigator: ({ children }: { children: React.ReactNode }) => (
        <>{children}</>
      ),
      Screen: ({ name, component: Component }: { name: string; component?: React.ComponentType }) => {
        if (!registeredStackScreens.includes(name)) {
          registeredStackScreens.push(name);
        }
        // Render the component so nested navigators (e.g. MainTabs) are exercised
        return Component ? <Component /> : null;
      },
    }),
  };
});

jest.mock('@react-navigation/native', () => {
  const React = require('react');
  return {
    NavigationContainer: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
    // createNavigationContainerRef lives in @react-navigation/core and is
    // re-exported by /native; under jest-expo the re-export sometimes
    // doesn't resolve. Stub the surface AppNavigator.tsx uses (line 117
    // exports navigationRef = createNavigationContainerRef<...>()).
    createNavigationContainerRef: () => ({
      isReady: () => true,
      navigate: jest.fn(),
      goBack: jest.fn(),
      getCurrentRoute: () => null,
      getRootState: () => null,
    }),
    useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
    useRoute: () => ({ params: {} }),
  };
});

describe('AppNavigator', () => {
  // The mocked Stack.Screen renders each registered screen component so
  // nested navigators (MainTabs) are exercised. That mounts the real tab
  // and HUD screens, some of which kick off async data fetches on mount.
  // Stub global.fetch so those never hit a real socket (ECONNREFUSED) and
  // bleed an unhandled rejection ("fetch failed") into an unrelated test.
  const realFetch = global.fetch;
  beforeAll(() => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve(''),
      } as Response),
    ) as unknown as typeof fetch;
  });
  afterAll(() => {
    global.fetch = realFetch;
  });

  beforeEach(() => {
    registeredTabScreens.length = 0;
    registeredStackScreens.length = 0;
  });

  it('renders without crashing', () => {
    const { toJSON } = render(<AppNavigator />);
    expect(toJSON).toBeDefined();
  });

  it('registers all expected tab screens', () => {
    render(<AppNavigator />);
    const expectedTabs: Array<keyof RootTabParamList> = [
      'Chat',
      'Lenses',
      'Marketplace',
      'Wallet',
      'Mesh',
    ];
    for (const tab of expectedTabs) {
      expect(registeredTabScreens).toContain(tab);
    }
  });

  it('registers all expected stack screens', () => {
    render(<AppNavigator />);
    const expectedStacks: Array<keyof RootStackParamList> = [
      'Main',
      'Atlas',
      'Settings',
      // Phase Z9 — Phase D sidebar lenses
      'Courtship',
      'Fishing',
      'Creatures',
      'Garage',
      'ReasoningTraces',
      // Phase G4.3 — WebView HUD wrappers
      'DreamReader',
      'StrategicWarBanner',
      'ForwardPredictions',
      'NPCSchemeOverhear',
      'LFGBoard',
      'BrawlMatchmaking',
      'Spectator',
      'EmergentEventFeed',
      'PersonalBeat',
    ];
    for (const stackScreen of expectedStacks) {
      expect(registeredStackScreens).toContain(stackScreen);
    }
  });

  it('registers exactly 5 tab screens', () => {
    render(<AppNavigator />);
    expect(registeredTabScreens).toHaveLength(5);
  });

  it('registers exactly 17 stack screens', () => {
    render(<AppNavigator />);
    // Main, Atlas, Settings (3 core) + Courtship, Fishing, Creatures, Garage,
    // ReasoningTraces (5 Phase Z9 lenses) + DreamReader, StrategicWarBanner,
    // ForwardPredictions, NPCSchemeOverhear, LFGBoard, BrawlMatchmaking,
    // Spectator, EmergentEventFeed, PersonalBeat (9 Phase G4.3 HUD wrappers)
    // = 17. (BuyCoins removed — coins are purchased on the website.)
    expect(registeredStackScreens).toHaveLength(17);
  });

  it('does not register duplicate screen names in tabs', () => {
    render(<AppNavigator />);
    const unique = new Set(registeredTabScreens);
    expect(unique.size).toBe(registeredTabScreens.length);
  });

  it('does not register duplicate screen names in stack', () => {
    render(<AppNavigator />);
    const unique = new Set(registeredStackScreens);
    expect(unique.size).toBe(registeredStackScreens.length);
  });

  it('exports RootTabParamList type with expected keys', () => {
    // Type-level check: ensure the param list type is correct.
    // If these types don't match, TypeScript compilation fails.
    const tabKeys: Record<keyof RootTabParamList, true> = {
      Chat: true,
      Lenses: true,
      Marketplace: true,
      Wallet: true,
      Mesh: true,
    };
    expect(Object.keys(tabKeys)).toHaveLength(5);
  });

  it('exports RootStackParamList type with expected keys', () => {
    const stackKeys: Record<keyof RootStackParamList, true> = {
      Main: true,
      Atlas: true,
      Settings: true,
      LensDetail: true,
      DTUDetail: true,
      PeerDetail: true,
      TransactionDetail: true,
      // Phase Z9 — Phase D sidebar lenses
      Courtship: true,
      Fishing: true,
      Creatures: true,
      Garage: true,
      ReasoningTraces: true,
      // Phase G4.3 — WebView HUD wrappers
      DreamReader: true,
      StrategicWarBanner: true,
      ForwardPredictions: true,
      NPCSchemeOverhear: true,
      LFGBoard: true,
      BrawlMatchmaking: true,
      Spectator: true,
      EmergentEventFeed: true,
      PersonalBeat: true,
    };
    expect(Object.keys(stackKeys)).toHaveLength(22);
  });
});
