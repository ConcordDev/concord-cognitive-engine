import React, { useMemo } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { CentralizedDashboard } from '../components/CentralizedDashboard';
import { useMeshStatus } from '../../hooks/useMeshStatus';
import { useWallet } from '../../hooks/useWallet';
import { useIdentity } from '../../hooks/useIdentity';
import type { RootStackParamList, RootTabParamList } from '../navigation/AppNavigator';

function formatCoin(amount: number): string {
  return amount.toFixed(2).replace(/\.?0+$/, '') || '0';
}

type DashboardNavigation = CompositeNavigationProp<
  BottomTabNavigationProp<RootTabParamList, 'Dashboard'>,
  NativeStackNavigationProp<RootStackParamList>
>;

export function DashboardScreen() {
  const navigation = useNavigation<DashboardNavigation>();
  const { connectionState, peerCount, activeTransports } = useMeshStatus();
  const { balance, unpropagatedCount } = useWallet();
  const { linkedDeviceCount } = useIdentity();

  const actions = useMemo(() => ([
    {
      id: 'chat',
      label: 'Chat',
      detail: 'Talk with Concord and run cognitive workflows.',
      accent: '#22d3ee',
      onPress: () => navigation.navigate('Chat'),
    },
    {
      id: 'lenses',
      label: 'Lenses',
      detail: 'Browse core domains and jump into specialized surfaces.',
      accent: '#a78bfa',
      onPress: () => navigation.navigate('Lenses'),
    },
    {
      id: 'market',
      label: 'Marketplace',
      detail: 'Inspect and acquire DTU-linked creative artifacts.',
      accent: '#34d399',
      onPress: () => navigation.navigate('Marketplace'),
    },
    {
      id: 'wallet',
      label: 'Wallet',
      detail: 'Track balance, sync status, and transaction activity.',
      accent: '#38bdf8',
      onPress: () => navigation.navigate('Wallet'),
    },
    {
      id: 'mesh',
      label: 'Mesh',
      detail: 'Monitor peers, transport layers, and device connectivity.',
      accent: '#f59e0b',
      onPress: () => navigation.navigate('Mesh'),
    },
    {
      id: 'atlas',
      label: 'Atlas',
      detail: 'Open deep graph and signal visualization surfaces.',
      accent: '#f472b6',
      onPress: () => navigation.navigate('Atlas'),
    },
  ]), [navigation]);

  return (
    <CentralizedDashboard
      connectionLabel={connectionState}
      peerCount={peerCount}
      activeTransportCount={activeTransports.length}
      availableBalanceLabel={formatCoin(balance.available)}
      linkedDeviceCount={linkedDeviceCount}
      unpropagatedCount={unpropagatedCount}
      actions={actions}
    />
  );
}
