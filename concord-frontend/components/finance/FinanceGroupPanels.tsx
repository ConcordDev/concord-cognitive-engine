'use client';

/**
 * Finance group panels — thin composers extracted from finance page switch.
 * Each child already owns its real macros. No Coinbase / trading-book surfaces.
 */

import NetWorthTracker from '@/components/finance/NetWorthTracker';
import EnvelopeBudget from '@/components/finance/EnvelopeBudget';
import InvestmentCheckup from '@/components/finance/InvestmentCheckup';
import TaxEstimator from '@/components/finance/TaxEstimator';
import RetirementSimulator from '@/components/finance/RetirementSimulator';
import SubscriptionDetector from '@/components/finance/SubscriptionDetector';
import BillsCalendar from '@/components/finance/BillsCalendar';
import GoalsTracker from '@/components/finance/GoalsTracker';
import RecurringInvestments from '@/components/finance/RecurringInvestments';
import HoldingsManager from '@/components/finance/HoldingsManager';
import CryptoExposureChart from '@/components/finance/CryptoExposureChart';
import AllocationPie from '@/components/finance/AllocationPie';
import DividendTracker from '@/components/finance/DividendTracker';
import SpendingInsights from '@/components/finance/SpendingInsights';
import CategorisationRules from '@/components/finance/CategorisationRules';
import TaxLossHarvester from '@/components/finance/TaxLossHarvester';
import AccountsPanel from '@/components/finance/AccountsPanel';
import FinanceAssistant from '@/components/finance/FinanceAssistant';
import BankAggregation from '@/components/finance/BankAggregation';
import TransactionFeed from '@/components/finance/TransactionFeed';
import HouseholdBudgets from '@/components/finance/HouseholdBudgets';
import CreditScoreMonitor from '@/components/finance/CreditScoreMonitor';
import CashFlowSankey from '@/components/finance/CashFlowSankey';
import BillReminders from '@/components/finance/BillReminders';
import RolloverRules from '@/components/finance/RolloverRules';
import { MarketsPulse } from '@/components/finance/MarketsPulse';
import { FredSeriesPanel } from '@/components/finance/FredSeriesPanel';
import { WorldBankPanel } from '@/components/global/WorldBankPanel';
import { LensFeedPanel } from '@/components/feeds/LensFeedPanel';

export function PositionsGroupPanel() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-4">
        <HoldingsManager />
        <CryptoExposureChart />
        <InvestmentCheckup />
      </div>
      <AllocationPie />
    </div>
  );
}

export function CashflowGroupPanel() {
  return (
    <div className="space-y-4">
      <TransactionFeed />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CashFlowSankey />
        <SpendingInsights />
      </div>
    </div>
  );
}

export function AccountsGroupPanel() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <AccountsPanel />
      <BankAggregation />
      <CreditScoreMonitor />
      <NetWorthTracker />
    </div>
  );
}

export function PlanningGroupPanel() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <GoalsTracker />
      <RetirementSimulator />
      <TaxEstimator />
      <TaxLossHarvester />
    </div>
  );
}

export function BillsBudgetGroupPanel() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <BillsCalendar />
      <BillReminders />
      <EnvelopeBudget />
      <RolloverRules />
      <HouseholdBudgets />
      <RecurringInvestments />
      <SubscriptionDetector />
      <DividendTracker />
      <CategorisationRules />
    </div>
  );
}

export function MacroGroupPanel() {
  return (
    <div className="space-y-4">
      <FredSeriesPanel />
      <WorldBankPanel domain="finance" />
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <MarketsPulse />
      </div>
      <LensFeedPanel lensId="finance" />
    </div>
  );
}

export function AssistantGroupPanel() {
  return <FinanceAssistant />;
}
