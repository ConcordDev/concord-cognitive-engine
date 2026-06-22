// Concord Mobile — Root Navigation
// Bottom tab navigation with core screens

import React, { useEffect } from 'react';
import { DeviceEventEmitter } from 'react-native';
import {
  NavigationContainer,
  createNavigationContainerRef,
  type NavigatorScreenParams,
  type LinkingOptions,
} from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { ChatScreen } from '../screens/ChatScreen';
import { LensesScreen } from '../screens/LensesScreen';
import { MarketplaceScreen } from '../screens/MarketplaceScreen';
import { WalletScreen } from '../screens/WalletScreen';
import { MeshStatusScreen } from '../screens/MeshStatusScreen';
import { AtlasScreen } from '../screens/AtlasScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
// NOTE: In-app coin purchasing is intentionally NOT in the mobile app.
// Coins are bought on the website (concord-os.org); the app only spends +
// earns them. This keeps the iOS build clear of App Store IAP / external-
// purchase rules. The checkout-complete deep link (App.tsx) still refreshes
// the wallet when a user returns from a web purchase.
// Phase Z9 — mobile parity for the 5 Phase D sidebar lenses.
import { CourtshipScreen } from '../screens/CourtshipScreen';
import { FishingScreen } from '../screens/FishingScreen';
import { CreaturesScreen } from '../screens/CreaturesScreen';
import { GarageScreen } from '../screens/GarageScreen';
import { ReasoningTracesScreen } from '../screens/ReasoningTracesScreen';
// Phase G4.3 — WebView HUD wrappers.
import { DreamReaderScreen } from '../screens/DreamReaderScreen';
import { StrategicWarBannerScreen } from '../screens/StrategicWarBannerScreen';
import { ForwardPredictionsScreen } from '../screens/ForwardPredictionsScreen';
import { NPCSchemeOverhearScreen } from '../screens/NPCSchemeOverhearScreen';
import { LFGBoardScreen } from '../screens/LFGBoardScreen';
import { BrawlMatchmakingScreen } from '../screens/BrawlMatchmakingScreen';
import { SpectatorScreen } from '../screens/SpectatorScreen';
import { EmergentEventFeedScreen } from '../screens/EmergentEventFeedScreen';
import { PersonalBeatScreen } from '../screens/PersonalBeatScreen';

export type RootTabParamList = {
  Chat: undefined;
  Lenses: undefined;
  Marketplace: undefined;
  Wallet: undefined;
  Mesh: undefined;
};

export type RootStackParamList = {
  Main: NavigatorScreenParams<RootTabParamList>;
  Atlas: undefined;
  Settings: undefined;
  LensDetail: { lensId: string };
  DTUDetail: { dtuId: string };
  PeerDetail: { peerId: string };
  TransactionDetail: { txId: string };
  // Phase Z9 — Phase D sidebar lenses (mobile parallel screens).
  Courtship: undefined;
  Fishing: undefined;
  Creatures: undefined;
  Garage: undefined;
  ReasoningTraces: undefined;
  // Phase G4.3 — WebView HUD wrappers.
  DreamReader: undefined;
  StrategicWarBanner: undefined;
  ForwardPredictions: undefined;
  NPCSchemeOverhear: undefined;
  LFGBoard: undefined;
  BrawlMatchmaking: undefined;
  Spectator: undefined;
  EmergentEventFeed: undefined;
  PersonalBeat: undefined;
};

const Tab = createBottomTabNavigator<RootTabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#0a0a0f',
          borderTopColor: '#1a1a2e',
          borderTopWidth: 1,
        },
        tabBarActiveTintColor: '#00d4ff',
        tabBarInactiveTintColor: '#666',
      }}
    >
      <Tab.Screen
        name="Chat"
        component={ChatScreen}
        options={{ tabBarLabel: 'Chat' }}
      />
      <Tab.Screen
        name="Lenses"
        component={LensesScreen}
        options={{ tabBarLabel: 'Lenses' }}
      />
      <Tab.Screen
        name="Marketplace"
        component={MarketplaceScreen}
        options={{ tabBarLabel: 'Market' }}
      />
      <Tab.Screen
        name="Wallet"
        component={WalletScreen}
        options={{ tabBarLabel: 'Wallet' }}
      />
      <Tab.Screen
        name="Mesh"
        component={MeshStatusScreen}
        options={{ tabBarLabel: 'Mesh' }}
      />
    </Tab.Navigator>
  );
}

// Deep linking — surfaces a native nav target for every URL form the
// shared web/native scheme supports. concordapp://dtu/<id>, /quest/<id>,
// /event/<id>, /listing/<id>, plus the existing checkout flow.
const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['concordapp://', 'https://concord-os.org/', 'https://www.concord-os.org/'],
  config: {
    screens: {
      Main: {
        screens: {
          Wallet: 'checkout-complete',
          Lenses: 'lenses',
          Marketplace: {
            path: 'listing/:listingId',
            parse: { listingId: (v) => v },
          },
          Chat: 'chat',
        },
      },
      Atlas: 'atlas',
      Settings: 'settings',
      DTUDetail: { path: 'dtu/:dtuId', parse: { dtuId: (v) => v } },
      LensDetail: { path: 'lens/:lensId', parse: { lensId: (v) => v } },
      Courtship: 'lenses/courtship',
      Fishing: 'lenses/fishing',
      Creatures: 'lenses/creatures',
      Garage: 'lenses/garage',
      ReasoningTraces: 'lenses/reasoning/traces',
      // Phase G4.3 — WebView HUD deep-link routes.
      DreamReader: 'hud/dream-reader',
      StrategicWarBanner: 'hud/war-banner',
      ForwardPredictions: 'hud/forward-predictions',
      NPCSchemeOverhear: 'hud/scheme-overhear',
      LFGBoard: 'hud/lfg-board',
      BrawlMatchmaking: 'hud/brawl-queue',
      Spectator: 'hud/spectator',
      EmergentEventFeed: 'hud/event-feed',
      PersonalBeat: 'hud/personal-beat',
    },
  },
};

// Navigation ref for imperative deep-link routing from App.tsx event handler.
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export function AppNavigator() {
  // Per-screen deep link bridge: App.tsx parses concordapp:// URLs into
  // DeviceEventEmitter signals; we listen here and push the appropriate
  // stack route. Per-screen subscribers can also listen if they need the
  // ID alongside their own state.
  useEffect(() => {
    const subs: Array<{ remove: () => void }> = [];
    subs.push(DeviceEventEmitter.addListener('concord:open-dtu', ({ dtuId }: { dtuId: string }) => {
      if (navigationRef.isReady() && dtuId) {
        navigationRef.navigate('DTUDetail', { dtuId });
      }
    }));
    subs.push(DeviceEventEmitter.addListener('concord:open-quest', ({ questId }: { questId: string }) => {
      // Quests live within Lenses; route there with a query param.
      if (navigationRef.isReady() && questId) {
        navigationRef.navigate('Main', {
          screen: 'Lenses',
          params: { questId },
        } as never);
      }
    }));
    subs.push(DeviceEventEmitter.addListener('concord:open-event', ({ eventId }: { eventId: string }) => {
      if (navigationRef.isReady() && eventId) {
        // World events tab on the Lenses screen with an eventId param.
        navigationRef.navigate('Main', {
          screen: 'Lenses',
          params: { eventId, focus: 'events' },
        } as never);
      }
    }));
    subs.push(DeviceEventEmitter.addListener('concord:open-listing', ({ listingId }: { listingId: string }) => {
      if (navigationRef.isReady() && listingId) {
        navigationRef.navigate('Main', {
          screen: 'Marketplace',
          params: { listingId },
        } as never);
      }
    }));
    return () => { for (const s of subs) s.remove(); };
  }, []);

  return (
    <NavigationContainer ref={navigationRef} linking={linking}>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#0a0a0f' },
        }}
      >
        <Stack.Screen name="Main" component={MainTabs} />
        <Stack.Screen name="Atlas" component={AtlasScreen} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
        {/* Phase Z9 — Phase D sidebar lenses */}
        <Stack.Screen name="Courtship" component={CourtshipScreen} options={{ headerShown: true, title: 'Courtship', headerStyle: { backgroundColor: '#0a0a0f' }, headerTintColor: '#fda4af' }} />
        <Stack.Screen name="Fishing" component={FishingScreen} options={{ headerShown: true, title: 'Fishing', headerStyle: { backgroundColor: '#0a0a0f' }, headerTintColor: '#a5f3fc' }} />
        <Stack.Screen name="Creatures" component={CreaturesScreen} options={{ headerShown: true, title: 'Creatures', headerStyle: { backgroundColor: '#0a0a0f' }, headerTintColor: '#c4b5fd' }} />
        <Stack.Screen name="Garage" component={GarageScreen} options={{ headerShown: true, title: 'Garage', headerStyle: { backgroundColor: '#0a0a0f' }, headerTintColor: '#fde68a' }} />
        <Stack.Screen name="ReasoningTraces" component={ReasoningTracesScreen} options={{ headerShown: true, title: 'HLR Traces', headerStyle: { backgroundColor: '#0a0a0f' }, headerTintColor: '#a5f3fc' }} />
        {/* Phase G4.3 — WebView HUD wrappers */}
        <Stack.Screen name="DreamReader" component={DreamReaderScreen} options={{ headerShown: true, title: "Last night's dreams", headerStyle: { backgroundColor: '#0a0a0f' }, headerTintColor: '#a5b4fc' }} />
        <Stack.Screen name="StrategicWarBanner" component={StrategicWarBannerScreen} options={{ headerShown: true, title: 'Active wars', headerStyle: { backgroundColor: '#0a0a0f' }, headerTintColor: '#fcd34d' }} />
        <Stack.Screen name="ForwardPredictions" component={ForwardPredictionsScreen} options={{ headerShown: true, title: 'Anticipating', headerStyle: { backgroundColor: '#0a0a0f' }, headerTintColor: '#c4b5fd' }} />
        <Stack.Screen name="NPCSchemeOverhear" component={NPCSchemeOverhearScreen} options={{ headerShown: true, title: 'Overheard', headerStyle: { backgroundColor: '#0a0a0f' }, headerTintColor: '#d8b4fe' }} />
        <Stack.Screen name="LFGBoard" component={LFGBoardScreen} options={{ headerShown: true, title: 'Find a group', headerStyle: { backgroundColor: '#0a0a0f' }, headerTintColor: '#6ee7b7' }} />
        <Stack.Screen name="BrawlMatchmaking" component={BrawlMatchmakingScreen} options={{ headerShown: true, title: 'Brawl matchmaker', headerStyle: { backgroundColor: '#0a0a0f' }, headerTintColor: '#fda4af' }} />
        <Stack.Screen name="Spectator" component={SpectatorScreen} options={{ headerShown: true, title: 'Spectator', headerStyle: { backgroundColor: '#0a0a0f' }, headerTintColor: '#d8b4fe' }} />
        <Stack.Screen name="EmergentEventFeed" component={EmergentEventFeedScreen} options={{ headerShown: true, title: 'World events', headerStyle: { backgroundColor: '#0a0a0f' }, headerTintColor: '#86efac' }} />
        <Stack.Screen name="PersonalBeat" component={PersonalBeatScreen} options={{ headerShown: true, title: 'Personal beats', headerStyle: { backgroundColor: '#0a0a0f' }, headerTintColor: '#fda4af' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
