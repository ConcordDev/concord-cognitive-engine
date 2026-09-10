'use client';

import { useMemo } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiHelpers } from '@/lib/api/client';
import {
  TX_PAGE_SIZE,
  pageTransactions,
  type BalanceData,
  type ConnectStatus,
  type EarningsSummary,
  type TransactionPage,
  type TxFilterId,
  type WalletTransaction,
  type WithdrawalsPage,
} from './wallet-model';

export function useWalletBalance() {
  return useQuery({
    queryKey: ['wallet-balance'],
    queryFn: () => api.get('/api/economy/balance').then((r) => r.data as BalanceData),
    refetchInterval: 15000,
    retry: false,
  });
}

export function useWalletConnectStatus() {
  return useQuery({
    queryKey: ['stripe-connect-status'],
    queryFn: () => apiHelpers.economy.connectStatus().then((r) => r.data as ConnectStatus),
    retry: false,
  });
}

export function useWalletWithdrawals() {
  return useQuery({
    queryKey: ['wallet-withdrawals'],
    queryFn: () =>
      apiHelpers.economy.withdrawals().then((r) => r.data as WithdrawalsPage),
    retry: false,
  });
}

export function useWalletHistory(filter: TxFilterId) {
  return useInfiniteQuery({
    queryKey: ['wallet-transactions', filter],
    queryFn: ({ pageParam = 0 }) =>
      api
        .get('/api/economy/history', {
          params: {
            type: filter === 'all' ? undefined : filter,
            limit: TX_PAGE_SIZE,
            offset: pageParam,
          },
        })
        .then((r) => r.data as TransactionPage),
    getNextPageParam: (lastPage, allPages) => {
      const items = pageTransactions(lastPage);
      if (items.length < TX_PAGE_SIZE) return undefined;
      return allPages.reduce((sum, page) => sum + pageTransactions(page).length, 0);
    },
    initialPageParam: 0,
    retry: false,
  });
}

export function flattenHistoryPages(
  pages: TransactionPage[] | undefined,
): WalletTransaction[] {
  if (!pages) return [];
  return pages.flatMap(pageTransactions);
}

export function deriveEarnings(
  transactions: WalletTransaction[],
  totalCredits: number,
): EarningsSummary {
  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const earningTypes = new Set(['tip', 'earning', 'reward', 'bounty', 'sale', 'credit']);

  let totalEarned = 0;
  let tips = 0;
  let bounties = 0;
  let sales = 0;
  let thisMonth = 0;
  let lastMonth = 0;

  for (const tx of transactions) {
    if (!earningTypes.has(tx.type) || tx.amount <= 0) continue;
    totalEarned += tx.amount;
    const txDate = new Date(tx.created_at || tx.timestamp || '');
    if (tx.type === 'tip') tips += tx.amount;
    if (tx.type === 'bounty') bounties += tx.amount;
    if (tx.type === 'sale') sales += tx.amount;
    if (txDate >= thisMonthStart) thisMonth += tx.amount;
    else if (txDate >= lastMonthStart && txDate < thisMonthStart) lastMonth += tx.amount;
  }

  if (totalEarned === 0 && totalCredits > 0) totalEarned = totalCredits;
  return { totalEarned, tips, bounties, sales, thisMonth, lastMonth };
}

export function useWalletInvalidate() {
  const queryClient = useQueryClient();
  return useMemo(
    () => () => {
      queryClient.invalidateQueries({ queryKey: ['wallet-balance'] });
      queryClient.invalidateQueries({ queryKey: ['wallet-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['wallet-withdrawals'] });
      queryClient.invalidateQueries({ queryKey: ['economy-balance'] });
    },
    [queryClient],
  );
}
