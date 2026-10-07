import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiPost: vi.fn(),
  lensRun: vi.fn(),
  createTransaction: vi.fn(),
  updateChain: vi.fn(),
  createWallet: vi.fn(),
  createChain: vi.fn(),
  commands: [] as Array<{ action: () => void }>,
}));

vi.mock('@/lib/api/client', () => ({
  api: { post: mocks.apiPost },
  lensRun: mocks.lensRun,
  apiHelpers: { credits: { earn: vi.fn(), spend: vi.fn() } },
}));
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: (_domain: string, kind: string) => {
    if (kind === 'chain') return {
      items: [{ id: 'chain-1', title: 'Bitcoin', createdAt: '2026-01-01', data: { chainId: 'bitcoin', name: 'Bitcoin', symbol: 'BTC', balance: 20, price: 2 } }],
      isLoading: false, isError: false, refetch: vi.fn(), create: mocks.createChain, update: mocks.updateChain,
    };
    if (kind === 'transaction') return {
      items: [
        { id: 'tx-1', title: 'Earned', createdAt: '2026-01-03', data: { type: 'earn', amount: 10, symbol: 'BTC', description: 'Earned', timestamp: '2026-01-03' } },
        { id: 'tx-2', title: 'Spent', createdAt: '2026-01-02', data: { type: 'spend', amount: 2, symbol: 'BTC', description: 'Spent', timestamp: '2026-01-02' } },
        { id: 'tx-3', title: 'Sent', createdAt: '2026-01-01', data: { type: 'transfer', amount: 1, symbol: 'BTC', description: 'Sent', timestamp: '2026-01-01', to: 'ada' } },
      ],
      isLoading: false, isError: false, refetch: vi.fn(), create: mocks.createTransaction,
    };
    return {
      items: [{ id: 'wallet-1', title: 'Primary', createdAt: '2026-01-01', data: { name: 'Primary', address: '0xabc', chainId: 'bitcoin', isDefault: true } }],
      isLoading: false, isError: false, refetch: vi.fn(), create: mocks.createWallet, remove: vi.fn(),
    };
  },
}));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({ useRunArtifact: () => ({ mutateAsync: vi.fn(async () => ({ message: 'done' })) }) }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: vi.fn() }));
vi.mock('@/hooks/useLensCommand', () => ({
  useLensCommand: (commands: Array<{ action: () => void }>) => {
    mocks.commands = commands;
  },
}));
vi.mock('@/hooks/useTilePush', () => ({ useTilePush: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { username: 'ada' } }) }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: { coins: [{ id: 'ethereum', price: 3, change24h: '1.5', marketCap: 30 }] }, isLive: true, lastUpdated: new Date(), insights: [] }),
}));
vi.mock('@/store/ui', () => ({ useUIStore: { getState: () => ({ addToast: vi.fn() }) } }));
vi.mock('@/components/crypto/TokenSearch', () => ({ TokenSearch: () => <div>TokenSearch</div>, loadWatchlist: () => [], saveWatchlist: vi.fn() }));
vi.mock('next/dynamic', () => ({ default: () => () => <div>CandleChart</div> }));
vi.mock('@/components/lens/LensShell', () => ({ LensShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/ShellPreview', () => ({ ShellPreview: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/crypto/ExchangeSection', () => ({ ExchangeSection: () => null }));
vi.mock('@/components/crypto/PortfolioBalanceHero', () => ({ PortfolioBalanceHero: () => null }));
vi.mock('@/components/crypto/PortfolioWorkbench', () => ({ PortfolioWorkbench: () => <div>PortfolioWorkbench</div> }));
vi.mock('@/components/crypto/SwapPanel', () => ({ SwapPanel: () => <div>SwapPanel</div> }));
vi.mock('@/components/crypto/PriceAlerts', () => ({ PriceAlerts: () => <div>PriceAlerts</div> }));
vi.mock('@/components/crypto/ApprovalsManager', () => ({ ApprovalsManager: () => <div>ApprovalsManager</div> }));
vi.mock('@/components/crypto-explorer/SwapRoutePanel', () => ({ SwapRoutePanel: () => <div>SwapRoutePanel</div> }));
vi.mock('@/components/crypto/CoinGeckoTicker', () => ({ CoinGeckoTicker: () => <div>CoinGeckoTicker</div> }));
vi.mock('@/components/crypto/AddressBookPanel', () => ({ AddressBookPanel: () => <div>AddressBookPanel</div> }));
vi.mock('@/components/crypto/CryptoActionPanel', () => ({ CryptoActionPanel: () => <div>CryptoActionPanel</div> }));
vi.mock('@/components/crypto/QRCodeReceive', () => ({ QRCodeReceive: () => <div>QRCodeReceive</div> }));
vi.mock('@/components/panel-polish', () => ({ PipingProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

import { CryptoWalletWorkspace } from '@/components/crypto/CryptoWalletWorkspace';

describe('CryptoWalletWorkspace', () => {
  beforeEach(() => {
    mocks.commands = [];
    mocks.apiPost.mockReset().mockResolvedValue({ data: { result: { candles: [] } } });
    mocks.lensRun.mockReset().mockResolvedValue({ data: { result: { watchlist: [] } } });
    for (const fn of [mocks.createTransaction, mocks.updateChain, mocks.createWallet, mocks.createChain]) {
      fn.mockReset().mockResolvedValue({});
    }
  });

  it('executes every canonical workspace and wallet transaction flow', async () => {
    render(<CryptoWalletWorkspace />);
    act(() => {
      for (const command of mocks.commands) command.action();
    });
    for (const label of ['Holdings', 'Chart', 'Swap', 'Activity', 'Wallets', 'Alerts', 'Approvals', 'Route', 'Ticker', 'Contacts', 'Tools', 'Portfolio']) {
      fireEvent.click(screen.getByTitle(new RegExp(`^${label}`)));
    }

    fireEvent.click(screen.getByRole('button', { name: /Earn 10 BTC/ }));
    await waitFor(() => expect(mocks.createTransaction).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /Spend 5 BTC/ }));
    for (const action of ['Analyze Portfolio', 'Verify Transaction', 'Estimate Gas Fees', 'Detect Patterns']) {
      fireEvent.click(screen.getByRole('button', { name: action }));
      await waitFor(() => expect(screen.getByText('done')).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss result' }));
    }

    fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));
    fireEvent.change(screen.getByPlaceholderText('Recipient address or name'), { target: { value: '0xdef' } });
    fireEvent.change(screen.getByPlaceholderText('Amount'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record send' }));
    await waitFor(() => expect(mocks.updateChain).toHaveBeenCalled());

    fireEvent.click(screen.getByTitle(/^Wallets/));
    fireEvent.click(screen.getByRole('button', { name: /Add Wallet/i }));
    fireEvent.change(screen.getByPlaceholderText('Wallet Name'), { target: { value: 'Backup' } });
    fireEvent.change(screen.getByPlaceholderText('Wallet Address'), { target: { value: '0x123' } });
    fireEvent.click(screen.getAllByRole('button', { name: /^Add Wallet$/ }).at(-1)!);
    await waitFor(() => expect(mocks.createWallet).toHaveBeenCalled());
  });
});
