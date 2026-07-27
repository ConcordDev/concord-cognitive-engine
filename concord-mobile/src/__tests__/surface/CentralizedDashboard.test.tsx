import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { CentralizedDashboard } from '../../surface/components/CentralizedDashboard';

describe('CentralizedDashboard', () => {
  it('renders metrics and triggers action handlers', () => {
    const onOpenChat = jest.fn();
    const { getByText } = render(
      <CentralizedDashboard
        connectionLabel="online"
        peerCount={3}
        activeTransportCount={2}
        availableBalanceLabel="42"
        linkedDeviceCount={1}
        unpropagatedCount={4}
        actions={[
          {
            id: 'chat',
            label: 'Chat',
            detail: 'Talk with Concord and run cognitive workflows.',
            accent: '#22d3ee',
            onPress: onOpenChat,
          },
        ]}
      />,
    );

    expect(getByText('Concord Command Deck')).toBeTruthy();
    expect(getByText('3 peers')).toBeTruthy();
    expect(getByText('2 active')).toBeTruthy();
    expect(getByText('42 CC')).toBeTruthy();
    fireEvent.press(getByText('Chat'));
    expect(onOpenChat).toHaveBeenCalledTimes(1);
  });
});
