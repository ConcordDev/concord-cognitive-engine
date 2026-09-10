export const TX_PAGE_SIZE = 25;

export const TRANSACTION_TABS = [
  { id: 'all', label: 'All' },
  { id: 'purchase', label: 'Purchases' },
  { id: 'tip', label: 'Tips' },
  { id: 'withdrawal', label: 'Withdrawals' },
  { id: 'earning', label: 'Earnings' },
] as const;

export type TxFilterId = (typeof TRANSACTION_TABS)[number]['id'];

export type WalletView = 'home' | 'activity' | 'pay' | 'cashout' | 'tools';

export type WalletPanelProps = { onNavigate?: (view: WalletView) => void };

export interface BalanceData {
  balance: number;
  totalCredits: number;
  totalDebits: number;
  tokens?: number;
}

export interface WalletTransaction {
  id: string;
  type: string;
  amount: number;
  fee?: number;
  net?: number;
  from?: string;
  to?: string;
  description?: string;
  status?: string;
  created_at: string;
  timestamp?: string;
  metadata?: Record<string, unknown>;
}

export interface TransactionPage {
  transactions?: WalletTransaction[];
  items?: WalletTransaction[];
  history?: WalletTransaction[];
  total?: number;
  hasMore?: boolean;
  nextOffset?: number;
}

export interface ConnectStatus {
  connected: boolean;
  stripeAccountId?: string;
  onboardingComplete?: boolean;
}

export interface WithdrawalRow {
  id: string;
  amount: number;
  fee: number;
  net: number;
  status: string;
  created_at: string;
}

export interface WithdrawalsPage {
  withdrawals?: WithdrawalRow[];
  items?: WithdrawalRow[];
}

export interface EarningsSummary {
  totalEarned: number;
  tips: number;
  bounties: number;
  sales: number;
  thisMonth: number;
  lastMonth: number;
}

export function pageTransactions(page: TransactionPage): WalletTransaction[] {
  return page.transactions || page.items || page.history || [];
}

export function formatTxType(type: string): string {
  const map: Record<string, string> = {
    purchase: 'Token Purchase',
    tip: 'Tip',
    withdrawal: 'Withdrawal',
    earning: 'Earning',
    reward: 'Reward',
    credit: 'Credit',
    debit: 'Debit',
    transfer: 'Transfer',
    bounty: 'Bounty Reward',
    sale: 'Sale',
    fee: 'Fee',
    TOKEN_PURCHASE: 'Token Purchase',
    WITHDRAWAL: 'Withdrawal',
    TIP: 'Tip',
    FEE: 'Fee',
    TRANSFER: 'Transfer',
  };
  return map[type] || type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
