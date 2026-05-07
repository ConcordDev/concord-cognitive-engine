'use client';

import { useState, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensData, LensItem } from '@/lib/hooks/use-lens-data';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { UniversalActions } from '@/components/lens/UniversalActions';
import {
  BookOpen, Receipt, Wallet, PiggyBank, Building2, FileSpreadsheet,
  Plus, Search, Filter, X, Edit3, Trash2, TrendingUp, DollarSign,
  BarChart3, AlertCircle, ChevronDown, ChevronRight, ArrowUpRight,
  ArrowDownRight, ListChecks, Calculator, Scale, Landmark, CreditCard,
  Users, Clock, FileText, CheckCircle, XCircle, Percent,
  Layers, Download, RefreshCw, ArrowRight,
} from 'lucide-react';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type ModeTab = 'Ledger' | 'Invoicing' | 'Payroll' | 'Budget' | 'Properties' | 'Tax';
type ArtifactType = 'Account' | 'Transaction' | 'Invoice' | 'PayrollEntry' | 'Budget' | 'Property' | 'TaxItem';
type InvoiceStatus = 'draft' | 'sent' | 'partial' | 'paid' | 'overdue' | 'void';
type TransactionStatus = 'pending' | 'cleared' | 'reconciled';
type AccountCategory = 'Asset' | 'Liability' | 'Equity' | 'Revenue' | 'Expense';
type LedgerView = 'accounts' | 'journal' | 'trial-balance' | 'pnl' | 'balance-sheet' | 'cash-flow' | 'reconciliation';
type InvoicingView = 'list' | 'builder' | 'aging';
type PayrollView = 'list' | 'calculator' | 'summary';
type BudgetView = 'list' | 'variance';
type PeriodType = 'monthly' | 'quarterly' | 'annual';

interface Account { name: string; accountNumber: string; type: string; balance: number; currency: string; institution: string; parentAccount?: string; }
interface Transaction { description: string; account: string; debit: number; credit: number; category: string; reference: string; date: string; contraAccount?: string; memo?: string; }
interface Invoice { invoiceNumber: string; client: string; amount: number; dueDate: string; issuedDate: string; lineItems: number; notes: string; taxRate?: number; paidAmount?: number; paymentTerms?: string; }
interface PayrollEntry { employee: string; period: string; grossPay: number; deductions: number; netPay: number; department: string; payType?: string; hourlyRate?: number; hoursWorked?: number; federalTax?: number; stateTax?: number; insurance?: number; retirement?: number; ytdGross?: number; ytdNet?: number; }
interface BudgetItem { name: string; category: string; allocated: number; spent: number; period: string; department: string; }
interface Property { name: string; address: string; type: string; units: number; monthlyRent: number; occupancy: number; expenses: number; }
interface TaxItem { name: string; category: string; amount: number; taxYear: string; deductible: boolean; filingStatus: string; }

type ArtifactData = Account | Transaction | Invoice | PayrollEntry | BudgetItem | Property | TaxItem;

/* ------------------------------------------------------------------ */
/*  Line item for invoice builder                                      */
/* ------------------------------------------------------------------ */

interface InvoiceLineItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

/* ------------------------------------------------------------------ */
/*  Journal entry row for double-entry                                 */
/* ------------------------------------------------------------------ */

interface JournalRow {
  id: string;
  account: string;
  debit: number;
  credit: number;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const MODE_TABS: { id: ModeTab; icon: typeof BookOpen; types: ArtifactType[] }[] = [
  { id: 'Ledger', icon: BookOpen, types: ['Account', 'Transaction'] },
  { id: 'Invoicing', icon: Receipt, types: ['Invoice'] },
  { id: 'Payroll', icon: Wallet, types: ['PayrollEntry'] },
  { id: 'Budget', icon: PiggyBank, types: ['Budget'] },
  { id: 'Properties', icon: Building2, types: ['Property'] },
  { id: 'Tax', icon: FileSpreadsheet, types: ['TaxItem'] },
];

const ACCOUNT_CATEGORIES: AccountCategory[] = ['Asset', 'Liability', 'Equity', 'Revenue', 'Expense'];

const INVOICE_STATUS_COLORS: Record<InvoiceStatus, string> = { draft: 'gray-400', sent: 'neon-blue', partial: 'yellow-400', paid: 'green-400', overdue: 'red-400', void: 'gray-500' };
const TRANSACTION_STATUS_COLORS: Record<TransactionStatus, string> = { pending: 'yellow-400', cleared: 'neon-blue', reconciled: 'green-400' };

function statusColorFor(type: ArtifactType, status: string): string {
  if (type === 'Invoice') return INVOICE_STATUS_COLORS[status as InvoiceStatus] || 'gray-400';
  if (type === 'Transaction') return TRANSACTION_STATUS_COLORS[status as TransactionStatus] || 'gray-400';
  if (status === 'active') return 'green-400';
  if (status === 'pending') return 'yellow-400';
  return 'neon-cyan';
}

function statusOptionsFor(type: ArtifactType): string[] {
  if (type === 'Invoice') return ['draft', 'sent', 'partial', 'paid', 'overdue', 'void'];
  if (type === 'Transaction') return ['pending', 'cleared', 'reconciled'];
  return ['active', 'pending', 'closed'];
}

const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);
const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
const uid = () => Math.random().toString(36).slice(2, 10);

const seedData: Record<string, { title: string; data: Record<string, unknown>; meta: Record<string, unknown> }[]> = {
  Account: [],
  Transaction: [],
  Invoice: [],
  PayrollEntry: [],
  Budget: [],
  Property: [],
  TaxItem: [],
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function AccountingLensPage() {
  useLensNav('accounting');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('accounting');

  /* ---- top-level state ---- */
  const [mode, setMode] = useState<ModeTab>('Ledger');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showEditor, setShowEditor] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [view, setView] = useState<'library' | 'dashboard'>('dashboard');
  const [ledgerSubType, setLedgerSubType] = useState<'Account' | 'Transaction'>('Account');
  const [showFeatures, setShowFeatures] = useState(true);

  /* ---- sub-views per tab ---- */
  const [ledgerView, setLedgerView] = useState<LedgerView>('accounts');
  const [invoicingView, setInvoicingView] = useState<InvoicingView>('list');
  const [payrollView, setPayrollView] = useState<PayrollView>('list');
  const [budgetView, setBudgetView] = useState<BudgetView>('list');
  const [periodType, setPeriodType] = useState<PeriodType>('monthly');

  /* ---- form state ---- */
  const [formTitle, setFormTitle] = useState('');
  const [formStatus, setFormStatus] = useState<string>('active');
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);

  /* ---- backend action results ---- */
  const [trialBalanceResult, setTrialBalanceResult] = useState<Record<string, unknown> | null>(null);
  const [trialBalanceLoading, setTrialBalanceLoading] = useState(false);
  const [profitLossResult, setProfitLossResult] = useState<Record<string, unknown> | null>(null);
  const [profitLossLoading, setProfitLossLoading] = useState(false);
  const [backendAgingResult, setBackendAgingResult] = useState<Record<string, unknown> | null>(null);
  const [backendAgingLoading, setBackendAgingLoading] = useState(false);
  const [backendVarianceResult, setBackendVarianceResult] = useState<Record<string, unknown> | null>(null);
  const [backendVarianceLoading, setBackendVarianceLoading] = useState(false);
  const [rentRollResult, setRentRollResult] = useState<Record<string, unknown> | null>(null);
  const [rentRollLoading, setRentRollLoading] = useState(false);
  const [validateLedgerResult, setValidateLedgerResult] = useState<Record<string, unknown> | null>(null);
  const [validateLedgerLoading, setValidateLedgerLoading] = useState(false);

  /* ---- chart of accounts tree ---- */
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(ACCOUNT_CATEGORIES));

  /* ---- invoice builder ---- */
  const [invoiceLines, setInvoiceLines] = useState<InvoiceLineItem[]>([
    { id: uid(), description: '', quantity: 1, unitPrice: 0, amount: 0 },
  ]);
  const [invoiceTaxRate, setInvoiceTaxRate] = useState(0);
  const [invNumber, setInvNumber] = useState('');
  const [invClient, setInvClient] = useState('');
  const [invTerms, setInvTerms] = useState('net-30');
  const [invIssueDate, setInvIssueDate] = useState('');
  const [invDueDate, setInvDueDate] = useState('');
  const [invNotes, setInvNotes] = useState('');

  /* ---- reconciliation ---- */
  const [reconAccount, setReconAccount] = useState('');
  const [reconBankBalance, setReconBankBalance] = useState(0);
  const [reconDate, setReconDate] = useState('');

  /* ---- journal entry builder ---- */
  const [journalRows, setJournalRows] = useState<JournalRow[]>([
    { id: uid(), account: '', debit: 0, credit: 0 },
    { id: uid(), account: '', debit: 0, credit: 0 },
  ]);
  const [journalDate, setJournalDate] = useState('');
  const [journalDesc, setJournalDesc] = useState('');

  /* ---- payroll calculator ---- */
  const [calcGross, setCalcGross] = useState(0);
  const [calcFedRate, setCalcFedRate] = useState(22);
  const [calcStateRate, setCalcStateRate] = useState(5);
  const [calcInsurance, setCalcInsurance] = useState(200);
  const [calcRetirement, setCalcRetirement] = useState(6);

  /* ---- data hooks ---- */
  const currentType: ArtifactType = mode === 'Ledger' ? ledgerSubType : MODE_TABS.find(t => t.id === mode)!.types[0];

  const { items, isLoading, isError, error, refetch, create, update, remove } = useLensData<ArtifactData>('accounting', currentType, {
    seed: seedData[currentType] || [],
  });

  const accountData = useLensData<Account>('accounting', 'Account', { seed: seedData.Account });
  const transactionData = useLensData<Transaction>('accounting', 'Transaction', { seed: seedData.Transaction });
  const invoiceData = useLensData<Invoice>('accounting', 'Invoice', { seed: seedData.Invoice });
  const payrollData = useLensData<PayrollEntry>('accounting', 'PayrollEntry', { seed: seedData.PayrollEntry });
  const budgetData = useLensData<BudgetItem>('accounting', 'Budget', { seed: seedData.Budget });

  const runAction = useRunArtifact('accounting');

  /* ---- filtering ---- */
  const filtered = useMemo(() => {
    let list = items;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(i => i.title.toLowerCase().includes(q));
    }
    if (statusFilter !== 'all') {
      list = list.filter(i => i.meta.status === statusFilter);
    }
    return list;
  }, [items, searchQuery, statusFilter]);

  /* ---- editor handlers ---- */
  const openNew = () => {
    setEditingId(null);
    setFormTitle('');
    setFormStatus(statusOptionsFor(currentType)[0]);
    setFormData({});
    setShowEditor(true);
  };

  const openEdit = (item: LensItem<ArtifactData>) => {
    setEditingId(item.id);
    setFormTitle(item.title);
    setFormStatus(item.meta.status || 'active');
    setFormData(item.data as unknown as Record<string, unknown>);
    setShowEditor(true);
  };

  const handleSave = async () => {
    const payload = { title: formTitle, data: formData, meta: { status: formStatus } };
    if (editingId) await update(editingId, payload);
    else await create(payload);
    setShowEditor(false);
  };

  const handleDelete = async (id: string) => { await remove(id); };

  const handleAction = async (action: string, artifactId?: string) => {
    const targetId = artifactId || editingId || filtered[0]?.id;
    if (!targetId) return;
    try {
      const result = await runAction.mutateAsync({ id: targetId, action });
      if (result.ok === false) { setActionResult({ message: `Action failed: ${(result as Record<string, unknown>).error || 'Unknown error'}` }); } else { setActionResult(result.result as Record<string, unknown>); }
    } catch (err) {
      console.error('Action failed:', err);
    }
  };

  /* ---- backend computational action handlers ---- */
  const handleTrialBalance = async () => {
    const targetId = accountData.items[0]?.id || filtered[0]?.id;
    if (!targetId) return;
    setTrialBalanceLoading(true);
    try {
      const res = await runAction.mutateAsync({ id: targetId, action: 'trialBalance' });
      if (res.ok === false) { setTrialBalanceResult({ message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` }); } else { setTrialBalanceResult(res.result as Record<string, unknown>); }
    } catch (e) { console.error('trialBalance failed:', e); setActionResult({ message: `trialBalance failed: ${e instanceof Error ? e.message : 'Unknown error'}` }); }
    setTrialBalanceLoading(false);
  };

  const handleProfitLoss = async () => {
    const targetId = accountData.items[0]?.id || filtered[0]?.id;
    if (!targetId) return;
    setProfitLossLoading(true);
    try {
      const res = await runAction.mutateAsync({ id: targetId, action: 'profitLoss' });
      if (res.ok === false) { setProfitLossResult({ message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` }); } else { setProfitLossResult(res.result as Record<string, unknown>); }
    } catch (e) { console.error('profitLoss failed:', e); setActionResult({ message: `profitLoss failed: ${e instanceof Error ? e.message : 'Unknown error'}` }); }
    setProfitLossLoading(false);
  };

  const handleInvoiceAging = async () => {
    const targetId = invoiceData.items[0]?.id || filtered[0]?.id;
    if (!targetId) return;
    setBackendAgingLoading(true);
    try {
      const res = await runAction.mutateAsync({ id: targetId, action: 'invoiceAging' });
      if (res.ok === false) { setBackendAgingResult({ message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` }); } else { setBackendAgingResult(res.result as Record<string, unknown>); }
    } catch (e) { console.error('invoiceAging failed:', e); setActionResult({ message: `invoiceAging failed: ${e instanceof Error ? e.message : 'Unknown error'}` }); }
    setBackendAgingLoading(false);
  };

  const handleBudgetVariance = async () => {
    const targetId = budgetData.items[0]?.id || filtered[0]?.id;
    if (!targetId) return;
    setBackendVarianceLoading(true);
    try {
      const res = await runAction.mutateAsync({ id: targetId, action: 'budgetVariance' });
      if (res.ok === false) { setBackendVarianceResult({ message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` }); } else { setBackendVarianceResult(res.result as Record<string, unknown>); }
    } catch (e) { console.error('budgetVariance failed:', e); setActionResult({ message: `budgetVariance failed: ${e instanceof Error ? e.message : 'Unknown error'}` }); }
    setBackendVarianceLoading(false);
  };

  const handleRentRoll = async () => {
    const targetId = items[0]?.id || filtered[0]?.id;
    if (!targetId) return;
    setRentRollLoading(true);
    try {
      const res = await runAction.mutateAsync({ id: targetId, action: 'rentRoll' });
      if (res.ok === false) { setRentRollResult({ message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` }); } else { setRentRollResult(res.result as Record<string, unknown>); }
    } catch (e) { console.error('rentRoll failed:', e); setActionResult({ message: `rentRoll failed: ${e instanceof Error ? e.message : 'Unknown error'}` }); }
    setRentRollLoading(false);
  };

  const handleValidateLedger = async () => {
    const targetId = accountData.items[0]?.id || filtered[0]?.id;
    if (!targetId) return;
    setValidateLedgerLoading(true);
    try {
      const res = await runAction.mutateAsync({ id: targetId, action: 'validate-ledger' });
      if (res.ok === false) { setValidateLedgerResult({ message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` }); } else { setValidateLedgerResult(res.result as Record<string, unknown>); }
    } catch (e) { console.error('validate-ledger failed:', e); setActionResult({ message: `validate-ledger failed: ${e instanceof Error ? e.message : 'Unknown error'}` }); }
    setValidateLedgerLoading(false);
  };

  /* ---- toggle category expansion ---- */
  const toggleCategory = useCallback((cat: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  }, []);

  /* ---- invoice line helpers ---- */
  const addInvoiceLine = () => {
    setInvoiceLines(prev => [...prev, { id: uid(), description: '', quantity: 1, unitPrice: 0, amount: 0 }]);
  };

  const updateInvoiceLine = (id: string, field: keyof InvoiceLineItem, value: string | number) => {
    setInvoiceLines(prev => prev.map(line => {
      if (line.id !== id) return line;
      const updated = { ...line, [field]: value };
      updated.amount = updated.quantity * updated.unitPrice;
      return updated;
    }));
  };

  const removeInvoiceLine = (id: string) => {
    setInvoiceLines(prev => prev.filter(l => l.id !== id));
  };

  const invoiceSubtotal = useMemo(() => invoiceLines.reduce((s, l) => s + l.amount, 0), [invoiceLines]);
  const invoiceTax = useMemo(() => invoiceSubtotal * (invoiceTaxRate / 100), [invoiceSubtotal, invoiceTaxRate]);
  const invoiceTotal = useMemo(() => invoiceSubtotal + invoiceTax, [invoiceSubtotal, invoiceTax]);

  /* ---- journal entry helpers ---- */
  const addJournalRow = () => {
    setJournalRows(prev => [...prev, { id: uid(), account: '', debit: 0, credit: 0 }]);
  };

  const updateJournalRow = (id: string, field: keyof JournalRow, value: string | number) => {
    setJournalRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  };

  const removeJournalRow = (id: string) => {
    setJournalRows(prev => prev.filter(r => r.id !== id));
  };

  const journalTotalDebits = useMemo(() => journalRows.reduce((s, r) => s + (r.debit || 0), 0), [journalRows]);
  const journalTotalCredits = useMemo(() => journalRows.reduce((s, r) => s + (r.credit || 0), 0), [journalRows]);
  const journalBalanced = useMemo(() => Math.abs(journalTotalDebits - journalTotalCredits) < 0.01 && journalTotalDebits > 0, [journalTotalDebits, journalTotalCredits]);

  /* ---- payroll calculator ---- */
  const calcFedTax = useMemo(() => calcGross * (calcFedRate / 100), [calcGross, calcFedRate]);
  const calcStateTax = useMemo(() => calcGross * (calcStateRate / 100), [calcGross, calcStateRate]);
  const calcRetAmt = useMemo(() => calcGross * (calcRetirement / 100), [calcGross, calcRetirement]);
  const calcTotalDeductions = useMemo(() => calcFedTax + calcStateTax + calcInsurance + calcRetAmt, [calcFedTax, calcStateTax, calcInsurance, calcRetAmt]);
  const calcNetPay = useMemo(() => calcGross - calcTotalDeductions, [calcGross, calcTotalDeductions]);

  /* ---- computed metrics from real items ---- */
  const accountsByType = useMemo(() => {
    const map: Record<string, LensItem<Account>[]> = {};
    ACCOUNT_CATEGORIES.forEach(c => { map[c] = []; });
    accountData.items.forEach(a => {
      const t = (a.data as unknown as Account).type || 'Asset';
      if (!map[t]) map[t] = [];
      map[t].push(a as unknown as LensItem<Account>);
    });
    return map;
  }, [accountData.items]);

  const totalByType = useMemo(() => {
    const totals: Record<string, number> = {};
    ACCOUNT_CATEGORIES.forEach(cat => {
      totals[cat] = (accountsByType[cat] || []).reduce((s, a) => s + ((a.data as unknown as Account).balance || 0), 0);
    });
    return totals;
  }, [accountsByType]);

  const totalAssets = totalByType['Asset'] || 0;
  const totalLiabilities = totalByType['Liability'] || 0;
  const totalEquity = totalByType['Equity'] || 0;
  const totalRevenue = totalByType['Revenue'] || 0;
  const totalExpenses = totalByType['Expense'] || 0;
  const netIncome = totalRevenue - totalExpenses;
  const totalDebits = totalAssets + totalExpenses;
  const totalCredits = totalLiabilities + totalEquity + totalRevenue;

  const invoiceAging = useMemo(() => {
    const aging = { current: 0, thirtyDay: 0, sixtyDay: 0, ninetyPlus: 0, total: 0 };
    invoiceData.items.forEach(inv => {
      const d = inv.data as unknown as Invoice;
      if (inv.meta.status === 'paid' || inv.meta.status === 'void') return;
      const due = new Date(d.dueDate);
      const now = new Date();
      const daysPast = Math.floor((now.getTime() - due.getTime()) / 86400000);
      const amt = (d.amount || 0) - (d.paidAmount || 0);
      if (amt <= 0) return;
      aging.total += amt;
      if (daysPast <= 0) aging.current += amt;
      else if (daysPast <= 30) aging.thirtyDay += amt;
      else if (daysPast <= 60) aging.sixtyDay += amt;
      else aging.ninetyPlus += amt;
    });
    return aging;
  }, [invoiceData.items]);

  const budgetVariance = useMemo(() => {
    return budgetData.items.map(b => {
      const d = b.data as unknown as BudgetItem;
      const allocated = d.allocated || 0;
      const spent = d.spent || 0;
      return {
        id: b.id,
        name: d.name || b.title,
        category: d.category,
        department: d.department,
        allocated,
        spent,
        variance: allocated - spent,
        pctUsed: allocated > 0 ? (spent / allocated) * 100 : 0,
        pctVariance: allocated > 0 ? ((allocated - spent) / allocated) * 100 : 0,
      };
    });
  }, [budgetData.items]);

  const totalPayroll = useMemo(() => {
    return payrollData.items.reduce((acc, p) => {
      const d = p.data as unknown as PayrollEntry;
      return { gross: acc.gross + (d.grossPay || 0), deductions: acc.deductions + (d.deductions || 0), net: acc.net + (d.netPay || 0) };
    }, { gross: 0, deductions: 0, net: 0 });
  }, [payrollData.items]);

  const rentRoll = useMemo(() => {
    return items.reduce((s, p) => {
      if (currentType !== 'Property') return s;
      return s + ((p.data as unknown as Property).monthlyRent || 0);
    }, 0);
  }, [items, currentType]);

  /* ---- badge renderer ---- */
  const renderStatusBadge = (status: string, type?: ArtifactType) => {
    const color = statusColorFor(type || currentType, status);
    return <span className={ds.badge(color)}>{status}</span>;
  };

  /* ================================================================ */
  /*  CHART OF ACCOUNTS (tree view)                                    */
  /* ================================================================ */

  const renderChartOfAccounts = () => (
    <div className="space-y-3">
      <div className={ds.sectionHeader}>
        <h2 className={ds.heading2}>Chart of Accounts</h2>
        <button className={ds.btnPrimary} onClick={() => { setLedgerSubType('Account'); openNew(); }}>
          <Plus className="w-4 h-4" /> Add Account
        </button>
      </div>
      {ACCOUNT_CATEGORIES.map(cat => {
        const accounts = accountsByType[cat] || [];
        const isExpanded = expandedCategories.has(cat);
        const catTotal = totalByType[cat] || 0;
        const catColor = cat === 'Asset' || cat === 'Revenue' ? 'text-green-400'
          : cat === 'Liability' || cat === 'Expense' ? 'text-red-400' : 'text-neon-cyan';
        return (
          <div key={cat} className={ds.panel}>
            <button
              className="w-full flex items-center justify-between"
              onClick={() => toggleCategory(cat)}
            >
              <div className="flex items-center gap-3">
                {isExpanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                <Layers className={cn('w-5 h-5', catColor)} />
                <span className={ds.heading3}>{cat}</span>
                <span className={ds.badge('gray-400')}>{accounts.length}</span>
              </div>
              <span className={cn(ds.textMono, catColor)}>{fmt(catTotal)}</span>
            </button>
            {isExpanded && (
              <div className="mt-3 ml-8 space-y-1">
                {accounts.length === 0 ? (
                  <p className={cn(ds.textMuted, 'py-2')}>No {cat.toLowerCase()} accounts yet.</p>
                ) : (
                  <table className="w-full">
                    <thead>
                      <tr className="text-left text-xs text-gray-500 border-b border-lattice-border/30">
                        <th className="pb-2 pr-4">Account #</th>
                        <th className="pb-2 pr-4">Name</th>
                        <th className="pb-2 pr-4">Institution</th>
                        <th className="pb-2 text-right">Balance</th>
                        <th className="pb-2 w-20"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {accounts.map(acct => {
                        const d = acct.data as unknown as Account;
                        return (
                          <tr key={acct.id} className="border-b border-lattice-border/20 hover:bg-lattice-elevated/30">
                            <td className={cn(ds.textMono, 'py-2 pr-4 text-gray-400')}>{d.accountNumber || '-'}</td>
                            <td className="py-2 pr-4 text-sm text-white">{d.name || acct.title}</td>
                            <td className={cn(ds.textMuted, 'py-2 pr-4')}>{d.institution || '-'}</td>
                            <td className={cn(ds.textMono, 'py-2 text-right', catColor)}>{fmt(d.balance || 0)}</td>
                            <td className="py-2 text-right">
                              <div className="flex items-center gap-1 justify-end">
                                <button className={cn(ds.btnGhost, ds.btnSmall)} onClick={() => openEdit(acct as unknown as LensItem<ArtifactData>)}><Edit3 className="w-3 h-3" /></button>
                                <button className={cn(ds.btnGhost, ds.btnSmall, 'text-red-400')} onClick={() => handleDelete(acct.id)}><Trash2 className="w-3 h-3" /></button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  /* ================================================================ */
  /*  DOUBLE-ENTRY JOURNAL                                             */
  /* ================================================================ */

  const renderJournalEntry = () => (
    <div className="space-y-4">
      <div className={ds.sectionHeader}>
        <h2 className={ds.heading2}>Double-Entry Journal</h2>
        <button className={ds.btnPrimary} onClick={() => { setLedgerSubType('Transaction'); openNew(); }}>
          <Plus className="w-4 h-4" /> Quick Entry
        </button>
      </div>

      {/* New journal entry form */}
      <div className={ds.panel}>
        <h3 className={cn(ds.heading3, 'mb-4')}>New Journal Entry</h3>
        <div className={cn(ds.grid2, 'mb-4')}>
          <div>
            <label className={ds.label}>Date</label>
            <input type="date" className={ds.input} value={journalDate} onChange={e => setJournalDate(e.target.value)} />
          </div>
          <div>
            <label className={ds.label}>Description</label>
            <input className={ds.input} value={journalDesc} onChange={e => setJournalDesc(e.target.value)} placeholder="Journal entry description..." />
          </div>
        </div>

        <table className="w-full mb-4">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b border-lattice-border/30">
              <th className="pb-2 pr-3">Account</th>
              <th className="pb-2 pr-3 text-right w-36">Debit</th>
              <th className="pb-2 pr-3 text-right w-36">Credit</th>
              <th className="pb-2 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {journalRows.map(row => (
              <tr key={row.id} className="border-b border-lattice-border/20">
                <td className="py-2 pr-3">
                  <input className={ds.input} value={row.account} onChange={e => updateJournalRow(row.id, 'account', e.target.value)} placeholder="Account name..." />
                </td>
                <td className="py-2 pr-3">
                  <input type="number" step="0.01" className={cn(ds.input, 'text-right')} value={row.debit || ''} onChange={e => updateJournalRow(row.id, 'debit', parseFloat(e.target.value) || 0)} placeholder="0.00" />
                </td>
                <td className="py-2 pr-3">
                  <input type="number" step="0.01" className={cn(ds.input, 'text-right')} value={row.credit || ''} onChange={e => updateJournalRow(row.id, 'credit', parseFloat(e.target.value) || 0)} placeholder="0.00" />
                </td>
                <td className="py-2">
                  {journalRows.length > 2 && (
                    <button className={cn(ds.btnGhost, ds.btnSmall, 'text-red-400')} onClick={() => removeJournalRow(row.id)}><X className="w-3.5 h-3.5" /></button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td className="pt-3 text-sm text-white">Totals</td>
              <td className={cn('pt-3 text-right', ds.textMono, 'text-green-400')}>{fmt(journalTotalDebits)}</td>
              <td className={cn('pt-3 text-right', ds.textMono, 'text-red-400')}>{fmt(journalTotalCredits)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>

        <div className="flex items-center justify-between">
          <button className={ds.btnSecondary} onClick={addJournalRow}><Plus className="w-4 h-4" /> Add Row</button>
          <div className="flex items-center gap-3">
            {journalBalanced ? (
              <span className="flex items-center gap-1 text-green-400 text-sm"><CheckCircle className="w-4 h-4" /> Balanced</span>
            ) : (
              <span className="flex items-center gap-1 text-red-400 text-sm"><XCircle className="w-4 h-4" /> Unbalanced ({fmt(Math.abs(journalTotalDebits - journalTotalCredits))})</span>
            )}
            <button onClick={() => { transactionData.create({ title: journalDesc, data: { description: journalDesc, entries: journalRows, date: new Date().toISOString(), type: 'journal', status: 'posted' } as unknown as Record<string, unknown> }); setJournalDesc(''); setJournalRows([{ id: uid(), account: '', debit: 0, credit: 0 }]); }} className={ds.btnPrimary} disabled={!journalBalanced || !journalDesc.trim()}>
              <CheckCircle className="w-4 h-4" /> Post Entry
            </button>
          </div>
        </div>
      </div>

      {/* Journal entry list */}
      <div className={ds.panel}>
        <h3 className={cn(ds.heading3, 'mb-4')}>Recent Journal Entries</h3>
        {transactionData.items.length === 0 ? (
          <p className={ds.textMuted}>No journal entries recorded yet.</p>
        ) : (
          <div className="space-y-3">
            {transactionData.items.map(txn => {
              const d = txn.data as unknown as Transaction;
              return (
                <div key={txn.id} className={cn(ds.panelHover, 'flex items-center justify-between')}>
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-1">
                      <span className={cn(ds.textMono, 'text-gray-400 text-xs')}>{d.date || '-'}</span>
                      <span className="text-sm text-white font-medium">{d.description || txn.title}</span>
                      {renderStatusBadge(txn.meta.status, 'Transaction')}
                    </div>
                    <div className="flex items-center gap-4 text-xs text-gray-500">
                      <span>Acct: {d.account || '-'}</span>
                      {d.contraAccount && <span>Contra: {d.contraAccount}</span>}
                      <span>Ref: {d.reference || '-'}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="text-right">
                      <p className={cn(ds.textMono, 'text-green-400')}>{fmt(d.debit || 0)}</p>
                      <p className="text-xs text-gray-500">Debit</p>
                    </div>
                    <div className="text-right">
                      <p className={cn(ds.textMono, 'text-red-400')}>{fmt(d.credit || 0)}</p>
                      <p className="text-xs text-gray-500">Credit</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button className={cn(ds.btnGhost, ds.btnSmall)} onClick={() => openEdit(txn as unknown as LensItem<ArtifactData>)}><Edit3 className="w-3 h-3" /></button>
                      <button className={cn(ds.btnGhost, ds.btnSmall, 'text-red-400')} onClick={() => handleDelete(txn.id)}><Trash2 className="w-3 h-3" /></button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  /* ================================================================ */
  /*  TRIAL BALANCE                                                    */
  /* ================================================================ */

  const renderTrialBalance = () => (
    <div className="space-y-4">
      <div className={ds.sectionHeader}>
        <h2 className={ds.heading2}>Trial Balance Report</h2>
        <div className="flex items-center gap-2">
          <button className={ds.btnPrimary} onClick={handleTrialBalance} disabled={trialBalanceLoading}>
            {trialBalanceLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Calculator className="w-4 h-4" />} Generate Trial Balance
          </button>
          <button className={ds.btnSecondary} onClick={handleValidateLedger} disabled={validateLedgerLoading}>
            {validateLedgerLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />} Validate Ledger
          </button>
          <button onClick={() => { const data = JSON.stringify(trialBalanceResult || transactionData.items, null, 2); const blob = new Blob([data], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'trial-balance.json'; a.click(); URL.revokeObjectURL(url); }} className={ds.btnSecondary}><Download className="w-4 h-4" /> Export</button>
        </div>
      </div>

      {/* Backend Trial Balance Result */}
      {trialBalanceResult && (
        <div className={cn(ds.panel, 'border border-green-400/30')}>
          <div className="flex items-center justify-between mb-4">
            <h3 className={cn(ds.heading3, 'flex items-center gap-2')}>
              <Scale className="w-5 h-5 text-green-400" /> Server-Computed Trial Balance
            </h3>
            <div className="flex items-center gap-3">
              <span className={cn(ds.textMuted, 'text-xs')}>Generated: {(trialBalanceResult.generatedAt as string)?.split('T')[0] || '-'}</span>
              <span className={cn(ds.textMuted, 'text-xs')}>As of: {(trialBalanceResult.asOfDate as string) || '-'}</span>
              <button onClick={() => setTrialBalanceResult(null)} className={ds.btnGhost}><X className="w-4 h-4" /></button>
            </div>
          </div>
          {Array.isArray(trialBalanceResult.accounts) && (trialBalanceResult.accounts as Array<Record<string, unknown>>).length > 0 && (
            <table className="w-full mb-4">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-lattice-border">
                  <th className="pb-2 pr-4">Account #</th>
                  <th className="pb-2 pr-4">Name</th>
                  <th className="pb-2 pr-4">Type</th>
                  <th className="pb-2 text-right pr-4">Debit</th>
                  <th className="pb-2 text-right">Credit</th>
                </tr>
              </thead>
              <tbody>
                {(trialBalanceResult.accounts as Array<Record<string, unknown>>).map((row, idx) => (
                  <tr key={idx} className="border-b border-lattice-border/20 hover:bg-lattice-elevated/30">
                    <td className={cn(ds.textMono, 'py-2 pr-4 text-gray-400')}>{(row.accountNumber as string) || '-'}</td>
                    <td className="py-2 pr-4 text-sm text-white">{row.name as string}</td>
                    <td className="py-2 pr-4"><span className={ds.badge('gray-400')}>{row.type as string}</span></td>
                    <td className={cn(ds.textMono, 'py-2 text-right pr-4', (row.debit as number) > 0 ? 'text-green-400' : 'text-gray-600')}>
                      {(row.debit as number) > 0 ? fmt(row.debit as number) : '-'}
                    </td>
                    <td className={cn(ds.textMono, 'py-2 text-right', (row.credit as number) > 0 ? 'text-neon-cyan' : 'text-gray-600')}>
                      {(row.credit as number) > 0 ? fmt(row.credit as number) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-lattice-border font-bold">
                  <td colSpan={3} className="pt-3 text-white">Totals</td>
                  <td className={cn(ds.textMono, 'pt-3 text-right pr-4 text-green-400')}>{fmt(trialBalanceResult.totalDebits as number)}</td>
                  <td className={cn(ds.textMono, 'pt-3 text-right text-neon-cyan')}>{fmt(trialBalanceResult.totalCredits as number)}</td>
                </tr>
              </tfoot>
            </table>
          )}
          <div className={cn('p-3 rounded-lg text-center', (trialBalanceResult.isBalanced as boolean) ? 'bg-green-400/10 border border-green-400/30' : 'bg-red-400/10 border border-red-400/30')}>
            {(trialBalanceResult.isBalanced as boolean) ? (
              <span className="flex items-center justify-center gap-2 text-green-400"><CheckCircle className="w-5 h-5" /> Books are balanced (Difference: {fmt((trialBalanceResult.difference as number) || 0)})</span>
            ) : (
              <span className="flex items-center justify-center gap-2 text-red-400"><AlertCircle className="w-5 h-5" /> Out of balance by {fmt(Math.abs((trialBalanceResult.difference as number) || 0))}</span>
            )}
          </div>
        </div>
      )}

      {/* Validate Ledger Result */}
      {validateLedgerResult && (
        <div className={cn(ds.panel, 'border border-neon-blue/30')}>
          <div className="flex items-center justify-between mb-3">
            <h3 className={cn(ds.heading3, 'flex items-center gap-2')}>
              <ListChecks className="w-5 h-5 text-neon-blue" /> Ledger Validation Result
            </h3>
            <button onClick={() => setValidateLedgerResult(null)} className={ds.btnGhost}><X className="w-4 h-4" /></button>
          </div>
          <pre className={cn(ds.textMono, 'text-xs overflow-auto max-h-48 p-3 bg-lattice-elevated/50 rounded-lg')}>{JSON.stringify(validateLedgerResult, null, 2)}</pre>
        </div>
      )}

      <div className={ds.panel}>
        <table className="w-full">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b border-lattice-border">
              <th className="pb-3 pr-4">Account #</th>
              <th className="pb-3 pr-4">Account Name</th>
              <th className="pb-3 pr-4">Type</th>
              <th className="pb-3 text-right pr-4">Debit</th>
              <th className="pb-3 text-right">Credit</th>
            </tr>
          </thead>
          <tbody>
            {ACCOUNT_CATEGORIES.map(cat => {
              const accounts = accountsByType[cat] || [];
              const isDebitNormal = cat === 'Asset' || cat === 'Expense';
              return accounts.map(acct => {
                const d = acct.data as unknown as Account;
                const bal = d.balance || 0;
                return (
                  <tr key={acct.id} className="border-b border-lattice-border/20 hover:bg-lattice-elevated/30">
                    <td className={cn(ds.textMono, 'py-2.5 pr-4 text-gray-400')}>{d.accountNumber || '-'}</td>
                    <td className="py-2.5 pr-4 text-sm text-white">{d.name || acct.title}</td>
                    <td className="py-2.5 pr-4"><span className={ds.badge(cat === 'Asset' || cat === 'Revenue' ? 'green-400' : cat === 'Liability' || cat === 'Expense' ? 'red-400' : 'neon-cyan')}>{cat}</span></td>
                    <td className={cn(ds.textMono, 'py-2.5 text-right pr-4', isDebitNormal ? 'text-green-400' : 'text-gray-600')}>{isDebitNormal ? fmt(bal) : '-'}</td>
                    <td className={cn(ds.textMono, 'py-2.5 text-right', !isDebitNormal ? 'text-neon-cyan' : 'text-gray-600')}>{!isDebitNormal ? fmt(bal) : '-'}</td>
                  </tr>
                );
              });
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-lattice-border font-bold">
              <td colSpan={3} className="pt-4 text-white">Totals</td>
              <td className={cn(ds.textMono, 'pt-4 text-right pr-4 text-green-400')}>{fmt(totalDebits)}</td>
              <td className={cn(ds.textMono, 'pt-4 text-right text-neon-cyan')}>{fmt(totalCredits)}</td>
            </tr>
          </tfoot>
        </table>

        <div className={cn('mt-4 p-3 rounded-lg text-center', Math.abs(totalDebits - totalCredits) < 0.01 ? 'bg-green-400/10 border border-green-400/30' : 'bg-red-400/10 border border-red-400/30')}>
          {Math.abs(totalDebits - totalCredits) < 0.01 ? (
            <span className="flex items-center justify-center gap-2 text-green-400"><CheckCircle className="w-5 h-5" /> Trial Balance is in equilibrium</span>
          ) : (
            <span className="flex items-center justify-center gap-2 text-red-400"><AlertCircle className="w-5 h-5" /> Out of balance by {fmt(Math.abs(totalDebits - totalCredits))}</span>
          )}
        </div>
      </div>

      {/* Adjusting entries section */}
      <div className={ds.panel}>
        <h3 className={cn(ds.heading3, 'mb-3')}>Adjusting Entries</h3>
        <p className={ds.textMuted}>Record period-end adjustments such as accruals, deferrals, depreciation, and estimates.</p>
        <button className={cn(ds.btnSecondary, 'mt-3')} onClick={() => setLedgerView('journal')}>
          <Plus className="w-4 h-4" /> Create Adjusting Entry
        </button>
      </div>
    </div>
  );

  /* ================================================================ */
  /*  PROFIT & LOSS                                                    */
  /* ================================================================ */

  const renderProfitLoss = () => {
    const revenueAccounts = accountsByType['Revenue'] || [];
    const expenseAccounts = accountsByType['Expense'] || [];

    return (
      <div className="space-y-4">
        <div className={ds.sectionHeader}>
          <h2 className={ds.heading2}>Profit &amp; Loss Statement</h2>
          <div className="flex items-center gap-2">
            <select className={cn(ds.select, 'w-auto')} value={periodType} onChange={e => setPeriodType(e.target.value as PeriodType)}>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="annual">Annual</option>
            </select>
            <button className={ds.btnPrimary} onClick={handleProfitLoss} disabled={profitLossLoading}>
              {profitLossLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Calculator className="w-4 h-4" />} Generate P&amp;L
            </button>
            <button className={ds.btnSecondary} onClick={() => { if (filtered[0]) handleAction('pnl-report', filtered[0].id); }}>
              <Download className="w-4 h-4" /> Export
            </button>
          </div>
        </div>

        <div className={ds.panel}>
          {/* Revenue section */}
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-green-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <TrendingUp className="w-4 h-4" /> Revenue
            </h3>
            {revenueAccounts.length === 0 ? (
              <p className={cn(ds.textMuted, 'ml-6')}>No revenue accounts.</p>
            ) : (
              revenueAccounts.map(acct => {
                const d = acct.data as unknown as Account;
                return (
                  <div key={acct.id} className="flex items-center justify-between py-2 px-4 hover:bg-lattice-elevated/30 rounded">
                    <span className="text-sm text-white">{d.name || acct.title}</span>
                    <span className={cn(ds.textMono, 'text-green-400')}>{fmt(d.balance || 0)}</span>
                  </div>
                );
              })
            )}
            <div className="flex items-center justify-between py-2 px-4 mt-1 border-t border-lattice-border/30 font-semibold">
              <span className="text-white">Total Revenue</span>
              <span className={cn(ds.textMono, 'text-green-400')}>{fmt(totalRevenue)}</span>
            </div>
          </div>

          {/* Expense section */}
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-red-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <ArrowDownRight className="w-4 h-4" /> Expenses
            </h3>
            {expenseAccounts.length === 0 ? (
              <p className={cn(ds.textMuted, 'ml-6')}>No expense accounts.</p>
            ) : (
              expenseAccounts.map(acct => {
                const d = acct.data as unknown as Account;
                return (
                  <div key={acct.id} className="flex items-center justify-between py-2 px-4 hover:bg-lattice-elevated/30 rounded">
                    <span className="text-sm text-white">{d.name || acct.title}</span>
                    <span className={cn(ds.textMono, 'text-red-400')}>{fmt(d.balance || 0)}</span>
                  </div>
                );
              })
            )}
            <div className="flex items-center justify-between py-2 px-4 mt-1 border-t border-lattice-border/30 font-semibold">
              <span className="text-white">Total Expenses</span>
              <span className={cn(ds.textMono, 'text-red-400')}>{fmt(totalExpenses)}</span>
            </div>
          </div>

          {/* Net income */}
          <div className={cn('p-4 rounded-lg', netIncome >= 0 ? 'bg-green-400/10 border border-green-400/30' : 'bg-red-400/10 border border-red-400/30')}>
            <div className="flex items-center justify-between">
              <span className="text-lg font-bold text-white">Net Income</span>
              <span className={cn('text-xl font-bold', ds.textMono, netIncome >= 0 ? 'text-green-400' : 'text-red-400')}>
                {fmt(netIncome)}
              </span>
            </div>
            <p className={cn(ds.textMuted, 'mt-1')}>
              Margin: {totalRevenue > 0 ? ((netIncome / totalRevenue) * 100).toFixed(1) : '0.0'}%
            </p>
          </div>

          {/* Period comparison placeholder */}
          <div className="mt-6">
            <h3 className={cn(ds.heading3, 'mb-3')}>Period Comparison</h3>
            <div className={ds.grid3}>
              <div className="text-center p-4 rounded-lg bg-lattice-elevated/50">
                <p className={ds.textMuted}>Current Period</p>
                <p className={cn(ds.heading2, netIncome >= 0 ? 'text-green-400' : 'text-red-400')}>{fmt(netIncome)}</p>
              </div>
              <div className="text-center p-4 rounded-lg bg-lattice-elevated/50">
                <p className={ds.textMuted}>Prior Period</p>
                <p className={cn(ds.heading2, 'text-gray-400')}>{fmt(0)}</p>
              </div>
              <div className="text-center p-4 rounded-lg bg-lattice-elevated/50">
                <p className={ds.textMuted}>Change</p>
                <p className={cn(ds.heading2, 'text-neon-cyan')}>{fmt(netIncome)}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Backend P&L Result */}
        {profitLossResult && (
          <div className={cn(ds.panel, 'border border-green-400/30')}>
            <div className="flex items-center justify-between mb-4">
              <h3 className={cn(ds.heading3, 'flex items-center gap-2')}>
                <TrendingUp className="w-5 h-5 text-green-400" /> Server-Computed P&amp;L Statement
              </h3>
              <div className="flex items-center gap-3">
                <span className={cn(ds.textMuted, 'text-xs')}>
                  Period: {((profitLossResult.period as Record<string, string>)?.start || '-')} to {((profitLossResult.period as Record<string, string>)?.end || '-')}
                </span>
                <button onClick={() => setProfitLossResult(null)} className={ds.btnGhost}><X className="w-4 h-4" /></button>
              </div>
            </div>

            {/* Revenue */}
            <div className="mb-4">
              <h4 className="text-sm font-semibold text-green-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                <ArrowUpRight className="w-4 h-4" /> Revenue
              </h4>
              {Array.isArray((profitLossResult.revenue as Record<string, unknown>)?.lines) &&
                ((profitLossResult.revenue as Record<string, unknown>).lines as Array<Record<string, unknown>>).map((line, i) => (
                  <div key={i} className="flex items-center justify-between py-1.5 px-4 hover:bg-lattice-elevated/30 rounded">
                    <span className="text-sm text-white">{line.name as string}</span>
                    <span className={cn(ds.textMono, 'text-green-400')}>{fmt(line.amount as number)}</span>
                  </div>
                ))
              }
              <div className="flex items-center justify-between py-2 px-4 border-t border-lattice-border/30 font-semibold">
                <span className="text-white">Total Revenue</span>
                <span className={cn(ds.textMono, 'text-green-400')}>{fmt((profitLossResult.revenue as Record<string, unknown>)?.total as number || 0)}</span>
              </div>
            </div>

            {/* COGS */}
            {((profitLossResult.costOfGoodsSold as Record<string, unknown>)?.total as number || 0) > 0 && (
              <div className="mb-4">
                <h4 className="text-sm font-semibold text-orange-400 uppercase tracking-wider mb-2">Cost of Goods Sold</h4>
                {Array.isArray((profitLossResult.costOfGoodsSold as Record<string, unknown>)?.lines) &&
                  ((profitLossResult.costOfGoodsSold as Record<string, unknown>).lines as Array<Record<string, unknown>>).map((line, i) => (
                    <div key={i} className="flex items-center justify-between py-1.5 px-4 hover:bg-lattice-elevated/30 rounded">
                      <span className="text-sm text-white">{line.name as string}</span>
                      <span className={cn(ds.textMono, 'text-orange-400')}>{fmt(line.amount as number)}</span>
                    </div>
                  ))
                }
                <div className="flex items-center justify-between py-2 px-4 border-t border-lattice-border/30 font-semibold">
                  <span className="text-white">Total COGS</span>
                  <span className={cn(ds.textMono, 'text-orange-400')}>{fmt((profitLossResult.costOfGoodsSold as Record<string, unknown>)?.total as number || 0)}</span>
                </div>
              </div>
            )}

            {/* Gross Profit */}
            <div className="flex items-center justify-between py-2 px-4 mb-4 bg-lattice-elevated/50 rounded-lg font-semibold">
              <span className="text-white">Gross Profit</span>
              <div className="flex items-center gap-3">
                <span className={cn(ds.textMono, (profitLossResult.grossProfit as number) >= 0 ? 'text-green-400' : 'text-red-400')}>
                  {fmt(profitLossResult.grossProfit as number || 0)}
                </span>
                <span className={cn(ds.textMuted, 'text-xs')}>({profitLossResult.grossMarginPct as number || 0}% margin)</span>
              </div>
            </div>

            {/* Operating Expenses */}
            <div className="mb-4">
              <h4 className="text-sm font-semibold text-red-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                <ArrowDownRight className="w-4 h-4" /> Operating Expenses
              </h4>
              {Array.isArray((profitLossResult.operatingExpenses as Record<string, unknown>)?.lines) &&
                ((profitLossResult.operatingExpenses as Record<string, unknown>).lines as Array<Record<string, unknown>>).map((line, i) => (
                  <div key={i} className="flex items-center justify-between py-1.5 px-4 hover:bg-lattice-elevated/30 rounded">
                    <span className="text-sm text-white">{line.name as string}</span>
                    <span className={cn(ds.textMono, 'text-red-400')}>{fmt(line.amount as number)}</span>
                  </div>
                ))
              }
              <div className="flex items-center justify-between py-2 px-4 border-t border-lattice-border/30 font-semibold">
                <span className="text-white">Total Expenses</span>
                <span className={cn(ds.textMono, 'text-red-400')}>{fmt((profitLossResult.operatingExpenses as Record<string, unknown>)?.total as number || 0)}</span>
              </div>
            </div>

            {/* Net Income */}
            <div className={cn('p-4 rounded-lg', (profitLossResult.netIncome as number) >= 0 ? 'bg-green-400/10 border border-green-400/30' : 'bg-red-400/10 border border-red-400/30')}>
              <div className="flex items-center justify-between">
                <span className="text-lg font-bold text-white">Net Income</span>
                <div className="flex items-center gap-3">
                  <span className={cn('text-xl font-bold', ds.textMono, (profitLossResult.netIncome as number) >= 0 ? 'text-green-400' : 'text-red-400')}>
                    {fmt(profitLossResult.netIncome as number || 0)}
                  </span>
                  <span className={cn(ds.textMuted, 'text-sm')}>({profitLossResult.netMarginPct as number || 0}% margin)</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  /* ================================================================ */
  /*  BALANCE SHEET                                                    */
  /* ================================================================ */

  const renderBalanceSheet = () => {
    const assetAccounts = accountsByType['Asset'] || [];
    const liabilityAccounts = accountsByType['Liability'] || [];
    const equityAccounts = accountsByType['Equity'] || [];

    return (
      <div className="space-y-4">
        <div className={ds.sectionHeader}>
          <h2 className={ds.heading2}>Balance Sheet</h2>
          <div className="flex items-center gap-2">
            <select className={cn(ds.select, 'w-auto')} value={periodType} onChange={e => setPeriodType(e.target.value as PeriodType)}>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="annual">Annual</option>
            </select>
            <button className={ds.btnSecondary} onClick={() => { const data = JSON.stringify({ assets: totalAssets, liabilities: totalLiabilities, equity: totalEquity + netIncome, date: new Date().toISOString() }, null, 2); const blob = new Blob([data], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'balance-sheet.json'; a.click(); URL.revokeObjectURL(url); }}>
              <Download className="w-4 h-4" /> Export
            </button>
          </div>
        </div>

        <div className={ds.panel}>
          {/* Assets */}
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-green-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <ArrowUpRight className="w-4 h-4" /> Assets
            </h3>
            {assetAccounts.length === 0 ? (
              <p className={cn(ds.textMuted, 'ml-6')}>No asset accounts.</p>
            ) : (
              assetAccounts.map(acct => {
                const d = acct.data as unknown as Account;
                return (
                  <div key={acct.id} className="flex items-center justify-between py-2 px-4 hover:bg-lattice-elevated/30 rounded">
                    <span className="text-sm text-white">{d.name || acct.title}</span>
                    <span className={cn(ds.textMono, 'text-green-400')}>{fmt(d.balance || 0)}</span>
                  </div>
                );
              })
            )}
            <div className="flex items-center justify-between py-2 px-4 mt-1 border-t border-lattice-border/30 font-semibold">
              <span className="text-white">Total Assets</span>
              <span className={cn(ds.textMono, 'text-green-400')}>{fmt(totalAssets)}</span>
            </div>
          </div>

          {/* Liabilities */}
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-red-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <ArrowDownRight className="w-4 h-4" /> Liabilities
            </h3>
            {liabilityAccounts.length === 0 ? (
              <p className={cn(ds.textMuted, 'ml-6')}>No liability accounts.</p>
            ) : (
              liabilityAccounts.map(acct => {
                const d = acct.data as unknown as Account;
                return (
                  <div key={acct.id} className="flex items-center justify-between py-2 px-4 hover:bg-lattice-elevated/30 rounded">
                    <span className="text-sm text-white">{d.name || acct.title}</span>
                    <span className={cn(ds.textMono, 'text-red-400')}>{fmt(d.balance || 0)}</span>
                  </div>
                );
              })
            )}
            <div className="flex items-center justify-between py-2 px-4 mt-1 border-t border-lattice-border/30 font-semibold">
              <span className="text-white">Total Liabilities</span>
              <span className={cn(ds.textMono, 'text-red-400')}>{fmt(totalLiabilities)}</span>
            </div>
          </div>

          {/* Equity */}
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-neon-cyan uppercase tracking-wider mb-3 flex items-center gap-2">
              <Landmark className="w-4 h-4" /> Equity
            </h3>
            {equityAccounts.length === 0 ? (
              <p className={cn(ds.textMuted, 'ml-6')}>No equity accounts.</p>
            ) : (
              equityAccounts.map(acct => {
                const d = acct.data as unknown as Account;
                return (
                  <div key={acct.id} className="flex items-center justify-between py-2 px-4 hover:bg-lattice-elevated/30 rounded">
                    <span className="text-sm text-white">{d.name || acct.title}</span>
                    <span className={cn(ds.textMono, 'text-neon-cyan')}>{fmt(d.balance || 0)}</span>
                  </div>
                );
              })
            )}
            <div className="flex items-center justify-between py-2 px-4 hover:bg-lattice-elevated/30 rounded">
              <span className="text-sm text-white italic">Retained Earnings (Net Income)</span>
              <span className={cn(ds.textMono, netIncome >= 0 ? 'text-green-400' : 'text-red-400')}>{fmt(netIncome)}</span>
            </div>
            <div className="flex items-center justify-between py-2 px-4 mt-1 border-t border-lattice-border/30 font-semibold">
              <span className="text-white">Total Equity</span>
              <span className={cn(ds.textMono, 'text-neon-cyan')}>{fmt(totalEquity + netIncome)}</span>
            </div>
          </div>

          {/* Total L+E */}
          <div className="flex items-center justify-between py-2 px-4 border-t-2 border-lattice-border font-bold text-lg">
            <span className="text-white">Total Liabilities + Equity</span>
            <span className={cn(ds.textMono, 'text-neon-cyan')}>{fmt(totalLiabilities + totalEquity + netIncome)}</span>
          </div>

          {/* Balance check */}
          <div className={cn('mt-4 p-3 rounded-lg text-center', Math.abs(totalAssets - (totalLiabilities + totalEquity + netIncome)) < 0.01 ? 'bg-green-400/10 border border-green-400/30' : 'bg-red-400/10 border border-red-400/30')}>
            {Math.abs(totalAssets - (totalLiabilities + totalEquity + netIncome)) < 0.01 ? (
              <span className="flex items-center justify-center gap-2 text-green-400"><CheckCircle className="w-5 h-5" /> Assets = Liabilities + Equity (Balanced)</span>
            ) : (
              <span className="flex items-center justify-center gap-2 text-red-400"><AlertCircle className="w-5 h-5" /> Out of balance by {fmt(Math.abs(totalAssets - (totalLiabilities + totalEquity + netIncome)))}</span>
            )}
          </div>
        </div>
      </div>
    );
  };

  /* ================================================================ */
  /*  CASH FLOW STATEMENT                                              */
  /* ================================================================ */

  const renderCashFlow = () => {
    const operatingInflows = transactionData.items.filter(t => {
      const d = t.data as unknown as Transaction;
      return d.category === 'Revenue' || (d.credit || 0) > 0;
    }).reduce((s, t) => s + ((t.data as unknown as Transaction).credit || 0), 0);

    const operatingOutflows = transactionData.items.filter(t => {
      const d = t.data as unknown as Transaction;
      return d.category === 'Expense' || d.category === 'COGS';
    }).reduce((s, t) => s + ((t.data as unknown as Transaction).debit || 0), 0);

    const netOperating = operatingInflows - operatingOutflows;

    const investingActivity = transactionData.items.filter(t => {
      const d = t.data as unknown as Transaction;
      return d.category === 'Transfer' && d.account?.toLowerCase().includes('asset');
    }).reduce((s, t) => {
      const d = t.data as unknown as Transaction;
      return s + (d.credit || 0) - (d.debit || 0);
    }, 0);

    const financingActivity = transactionData.items.filter(t => {
      const d = t.data as unknown as Transaction;
      return d.category === 'Transfer' && (d.account?.toLowerCase().includes('loan') || d.account?.toLowerCase().includes('equity'));
    }).reduce((s, t) => {
      const d = t.data as unknown as Transaction;
      return s + (d.credit || 0) - (d.debit || 0);
    }, 0);

    const netCashChange = netOperating + investingActivity + financingActivity;

    return (
      <div className="space-y-4">
        <div className={ds.sectionHeader}>
          <h2 className={ds.heading2}>Cash Flow Statement</h2>
          <select className={cn(ds.select, 'w-auto')} value={periodType} onChange={e => setPeriodType(e.target.value as PeriodType)}>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="annual">Annual</option>
          </select>
        </div>

        <div className={ds.panel}>
          {/* Operating Activities */}
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-green-400 uppercase tracking-wider mb-3">Operating Activities</h3>
            <div className="space-y-2 px-4">
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-white">Cash received from customers</span>
                <span className={cn(ds.textMono, 'text-green-400')}>{fmt(operatingInflows)}</span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-white">Cash paid for operations</span>
                <span className={cn(ds.textMono, 'text-red-400')}>({fmt(operatingOutflows)})</span>
              </div>
            </div>
            <div className="flex items-center justify-between py-2 px-4 mt-1 border-t border-lattice-border/30 font-semibold">
              <span className="text-white">Net Cash from Operations</span>
              <span className={cn(ds.textMono, netOperating >= 0 ? 'text-green-400' : 'text-red-400')}>{fmt(netOperating)}</span>
            </div>
          </div>

          {/* Investing Activities */}
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-neon-blue uppercase tracking-wider mb-3">Investing Activities</h3>
            <div className="space-y-2 px-4">
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-white">Capital asset transactions</span>
                <span className={cn(ds.textMono, investingActivity >= 0 ? 'text-green-400' : 'text-red-400')}>{fmt(investingActivity)}</span>
              </div>
            </div>
            <div className="flex items-center justify-between py-2 px-4 mt-1 border-t border-lattice-border/30 font-semibold">
              <span className="text-white">Net Cash from Investing</span>
              <span className={cn(ds.textMono, investingActivity >= 0 ? 'text-green-400' : 'text-red-400')}>{fmt(investingActivity)}</span>
            </div>
          </div>

          {/* Financing Activities */}
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-neon-purple uppercase tracking-wider mb-3">Financing Activities</h3>
            <div className="space-y-2 px-4">
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-white">Loan &amp; equity transactions</span>
                <span className={cn(ds.textMono, financingActivity >= 0 ? 'text-green-400' : 'text-red-400')}>{fmt(financingActivity)}</span>
              </div>
            </div>
            <div className="flex items-center justify-between py-2 px-4 mt-1 border-t border-lattice-border/30 font-semibold">
              <span className="text-white">Net Cash from Financing</span>
              <span className={cn(ds.textMono, financingActivity >= 0 ? 'text-green-400' : 'text-red-400')}>{fmt(financingActivity)}</span>
            </div>
          </div>

          {/* Net Change */}
          <div className={cn('p-4 rounded-lg', netCashChange >= 0 ? 'bg-green-400/10 border border-green-400/30' : 'bg-red-400/10 border border-red-400/30')}>
            <div className="flex items-center justify-between">
              <span className="text-lg font-bold text-white">Net Change in Cash</span>
              <span className={cn('text-xl font-bold', ds.textMono, netCashChange >= 0 ? 'text-green-400' : 'text-red-400')}>
                {fmt(netCashChange)}
              </span>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between py-3 px-4 bg-lattice-elevated/50 rounded-lg">
            <span className="text-sm font-medium text-white">Ending Cash Position (Total Assets)</span>
            <span className={cn(ds.textMono, 'text-neon-cyan font-bold')}>{fmt(totalAssets)}</span>
          </div>
        </div>
      </div>
    );
  };

  /* ================================================================ */
  /*  BANK RECONCILIATION                                              */
  /* ================================================================ */

  const reconAccountObj = useMemo(() => {
    if (!reconAccount) return null;
    return accountData.items.find(a => a.id === reconAccount || (a.data as unknown as Account).name === reconAccount);
  }, [reconAccount, accountData.items]);

  const reconBookBalance = useMemo(() => {
    if (!reconAccountObj) return 0;
    return (reconAccountObj.data as unknown as Account).balance || 0;
  }, [reconAccountObj]);

  const reconUnmatchedTxns = useMemo(() => {
    if (!reconAccount) return [];
    return transactionData.items.filter(t => {
      const d = t.data as unknown as Transaction;
      return (d.account === reconAccount || (reconAccountObj && d.account === (reconAccountObj.data as unknown as Account).name)) && t.meta.status !== 'reconciled';
    });
  }, [reconAccount, reconAccountObj, transactionData.items]);

  const reconDifference = useMemo(() => {
    return reconBankBalance - reconBookBalance;
  }, [reconBankBalance, reconBookBalance]);

  const renderReconciliation = () => (
    <div className="space-y-4">
      <div className={ds.sectionHeader}>
        <h2 className={ds.heading2}>Bank Reconciliation</h2>
      </div>

      {/* Setup */}
      <div className={ds.panel}>
        <h3 className={cn(ds.heading3, 'mb-4')}>Reconciliation Setup</h3>
        <div className={ds.grid3}>
          <div>
            <label className={ds.label}>Account to Reconcile</label>
            <select className={ds.select} value={reconAccount} onChange={e => setReconAccount(e.target.value)}>
              <option value="">Select account...</option>
              {accountData.items.filter(a => (a.data as unknown as Account).type === 'Asset').map(a => {
                const d = a.data as unknown as Account;
                return <option key={a.id} value={d.name || a.title}>{d.accountNumber ? `${d.accountNumber} - ` : ''}{d.name || a.title}</option>;
              })}
            </select>
          </div>
          <div>
            <label className={ds.label}>Statement Date</label>
            <input type="date" className={ds.input} value={reconDate} onChange={e => setReconDate(e.target.value)} />
          </div>
          <div>
            <label className={ds.label}>Bank Statement Balance ($)</label>
            <input type="number" step="0.01" className={ds.input} value={reconBankBalance || ''} onChange={e => setReconBankBalance(parseFloat(e.target.value) || 0)} placeholder="0.00" />
          </div>
        </div>
      </div>

      {reconAccount && (
        <>
          {/* Comparison */}
          <div className={ds.grid3}>
            <div className={cn(ds.panel, 'text-center')}>
              <p className={ds.textMuted}>Book Balance</p>
              <p className={cn(ds.heading2, 'text-neon-cyan')}>{fmt(reconBookBalance)}</p>
            </div>
            <div className={cn(ds.panel, 'text-center')}>
              <p className={ds.textMuted}>Bank Statement Balance</p>
              <p className={cn(ds.heading2, 'text-white')}>{fmt(reconBankBalance)}</p>
            </div>
            <div className={cn(ds.panel, 'text-center')}>
              <p className={ds.textMuted}>Difference</p>
              <p className={cn(ds.heading2, Math.abs(reconDifference) < 0.01 ? 'text-green-400' : 'text-red-400')}>{fmt(reconDifference)}</p>
            </div>
          </div>

          {/* Status */}
          <div className={cn('p-3 rounded-lg text-center', Math.abs(reconDifference) < 0.01 ? 'bg-green-400/10 border border-green-400/30' : 'bg-yellow-400/10 border border-yellow-400/30')}>
            {Math.abs(reconDifference) < 0.01 ? (
              <span className="flex items-center justify-center gap-2 text-green-400"><CheckCircle className="w-5 h-5" /> Account is reconciled</span>
            ) : (
              <span className="flex items-center justify-center gap-2 text-yellow-400"><AlertCircle className="w-5 h-5" /> Unreconciled difference of {fmt(Math.abs(reconDifference))}</span>
            )}
          </div>

          {/* Unmatched transactions */}
          <div className={ds.panel}>
            <div className={ds.sectionHeader}>
              <h3 className={ds.heading3}>Outstanding Transactions</h3>
              <span className={ds.badge('yellow-400')}>{reconUnmatchedTxns.length} unreconciled</span>
            </div>
            {reconUnmatchedTxns.length === 0 ? (
              <p className={cn(ds.textMuted, 'mt-3')}>No outstanding transactions for this account.</p>
            ) : (
              <table className="w-full mt-3">
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b border-lattice-border/30">
                    <th className="pb-2 pr-4">Date</th>
                    <th className="pb-2 pr-4">Description</th>
                    <th className="pb-2 pr-4">Reference</th>
                    <th className="pb-2 text-right pr-4">Debit</th>
                    <th className="pb-2 text-right pr-4">Credit</th>
                    <th className="pb-2 text-center">Match</th>
                  </tr>
                </thead>
                <tbody>
                  {reconUnmatchedTxns.map(txn => {
                    const d = txn.data as unknown as Transaction;
                    return (
                      <tr key={txn.id} className="border-b border-lattice-border/20 hover:bg-lattice-elevated/30">
                        <td className={cn(ds.textMono, 'py-2.5 pr-4 text-gray-400')}>{d.date || '-'}</td>
                        <td className="py-2.5 pr-4 text-sm text-white">{d.description || txn.title}</td>
                        <td className={cn(ds.textMuted, 'py-2.5 pr-4')}>{d.reference || '-'}</td>
                        <td className={cn(ds.textMono, 'py-2.5 text-right pr-4 text-green-400')}>{(d.debit || 0) > 0 ? fmt(d.debit) : '-'}</td>
                        <td className={cn(ds.textMono, 'py-2.5 text-right pr-4 text-red-400')}>{(d.credit || 0) > 0 ? fmt(d.credit) : '-'}</td>
                        <td className="py-2.5 text-center">
                          <button
                            className={cn(ds.btnSmall, 'text-green-400 hover:bg-green-400/20')}
                            onClick={() => transactionData.update(txn.id, { ...txn, meta: { ...txn.meta, status: 'reconciled' } })}
                          >
                            <CheckCircle className="w-3.5 h-3.5" /> Reconcile
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );

  /* ================================================================ */
  /*  INVOICE BUILDER                                                  */
  /* ================================================================ */

  const renderInvoiceBuilder = () => (
    <div className="space-y-4">
      <div className={ds.sectionHeader}>
        <h2 className={ds.heading2}>Invoice Builder</h2>
        <button className={ds.btnSecondary} onClick={() => setInvoicingView('list')}>
          <ArrowRight className="w-4 h-4" /> Back to List
        </button>
      </div>

      <div className={ds.panel}>
        {/* Header info */}
        <div className={cn(ds.grid3, 'mb-6')}>
          <div>
            <label className={ds.label}>Invoice Number</label>
            <input className={ds.input} placeholder="INV-001" value={invNumber} onChange={e => setInvNumber(e.target.value)} />
          </div>
          <div>
            <label className={ds.label}>Client</label>
            <input className={ds.input} placeholder="Client name..." value={invClient} onChange={e => setInvClient(e.target.value)} />
          </div>
          <div>
            <label className={ds.label}>Payment Terms</label>
            <select className={ds.select} value={invTerms} onChange={e => setInvTerms(e.target.value)}>
              <option value="net-15">Net 15</option>
              <option value="net-30">Net 30</option>
              <option value="net-45">Net 45</option>
              <option value="net-60">Net 60</option>
              <option value="due-receipt">Due on Receipt</option>
            </select>
          </div>
        </div>
        <div className={cn(ds.grid2, 'mb-6')}>
          <div>
            <label className={ds.label}>Issue Date</label>
            <input type="date" className={ds.input} value={invIssueDate} onChange={e => setInvIssueDate(e.target.value)} />
          </div>
          <div>
            <label className={ds.label}>Due Date</label>
            <input type="date" className={ds.input} value={invDueDate} onChange={e => setInvDueDate(e.target.value)} />
          </div>
        </div>

        {/* Line items */}
        <h3 className={cn(ds.heading3, 'mb-3')}>Line Items</h3>
        <table className="w-full mb-4">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b border-lattice-border/30">
              <th className="pb-2 pr-3">Description</th>
              <th className="pb-2 pr-3 text-right w-24">Qty</th>
              <th className="pb-2 pr-3 text-right w-32">Unit Price</th>
              <th className="pb-2 pr-3 text-right w-32">Amount</th>
              <th className="pb-2 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {invoiceLines.map(line => (
              <tr key={line.id} className="border-b border-lattice-border/20">
                <td className="py-2 pr-3">
                  <input className={ds.input} value={line.description} onChange={e => updateInvoiceLine(line.id, 'description', e.target.value)} placeholder="Service or product..." />
                </td>
                <td className="py-2 pr-3">
                  <input type="number" min="1" className={cn(ds.input, 'text-right')} value={line.quantity} onChange={e => updateInvoiceLine(line.id, 'quantity', parseInt(e.target.value) || 1)} />
                </td>
                <td className="py-2 pr-3">
                  <input type="number" step="0.01" className={cn(ds.input, 'text-right')} value={line.unitPrice || ''} onChange={e => updateInvoiceLine(line.id, 'unitPrice', parseFloat(e.target.value) || 0)} placeholder="0.00" />
                </td>
                <td className={cn('py-2 pr-3 text-right', ds.textMono, 'text-white')}>{fmt(line.amount)}</td>
                <td className="py-2">
                  {invoiceLines.length > 1 && (
                    <button className={cn(ds.btnGhost, ds.btnSmall, 'text-red-400')} onClick={() => removeInvoiceLine(line.id)}><X className="w-3.5 h-3.5" /></button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <button className={ds.btnSecondary} onClick={addInvoiceLine}><Plus className="w-4 h-4" /> Add Line Item</button>

        {/* Totals */}
        <div className="mt-6 flex justify-end">
          <div className="w-72 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className={ds.textMuted}>Subtotal</span>
              <span className={cn(ds.textMono, 'text-white')}>{fmt(invoiceSubtotal)}</span>
            </div>
            <div className="flex items-center justify-between text-sm gap-3">
              <div className="flex items-center gap-2">
                <span className={ds.textMuted}>Tax</span>
                <input type="number" step="0.5" min="0" max="100" className={cn(ds.input, 'w-20 text-right text-xs py-1')} value={invoiceTaxRate} onChange={e => setInvoiceTaxRate(parseFloat(e.target.value) || 0)} />
                <Percent className="w-3 h-3 text-gray-500" />
              </div>
              <span className={cn(ds.textMono, 'text-white')}>{fmt(invoiceTax)}</span>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-lattice-border font-bold">
              <span className="text-white">Total</span>
              <span className={cn(ds.textMono, 'text-green-400 text-lg')}>{fmt(invoiceTotal)}</span>
            </div>
          </div>
        </div>

        {/* Notes */}
        <div className="mt-6">
          <label className={ds.label}>Notes / Terms</label>
          <textarea className={ds.textarea} rows={3} placeholder="Payment terms, thank you note, etc..." value={invNotes} onChange={e => setInvNotes(e.target.value)} />
        </div>

        <div className="mt-4 flex items-center justify-end gap-3">
          <button onClick={() => { const payload = { title: invNumber || `INV-${Date.now()}`, data: { invoiceNumber: invNumber, client: invClient, amount: invoiceTotal, taxRate: invoiceTaxRate, issuedDate: invIssueDate, dueDate: invDueDate, paymentTerms: invTerms, notes: invNotes, lineItems: invoiceLines.length, paidAmount: 0 } as unknown as Record<string, unknown>, meta: { status: 'draft' } }; invoiceData.create(payload); setInvNumber(''); setInvClient(''); setInvNotes(''); setInvoiceLines([{ id: uid(), description: '', quantity: 1, unitPrice: 0, amount: 0 }]); setInvoiceTaxRate(0); setInvoicingView('list'); }} className={ds.btnSecondary}>Save as Draft</button>
          <button onClick={() => { const payload = { title: invNumber || `INV-${Date.now()}`, data: { invoiceNumber: invNumber, client: invClient, amount: invoiceTotal, taxRate: invoiceTaxRate, issuedDate: invIssueDate || new Date().toISOString().split('T')[0], dueDate: invDueDate, paymentTerms: invTerms, notes: invNotes, lineItems: invoiceLines.length, paidAmount: 0 } as unknown as Record<string, unknown>, meta: { status: 'sent' } }; invoiceData.create(payload); setInvNumber(''); setInvClient(''); setInvNotes(''); setInvoiceLines([{ id: uid(), description: '', quantity: 1, unitPrice: 0, amount: 0 }]); setInvoiceTaxRate(0); setInvoicingView('list'); }} className={ds.btnPrimary}><FileText className="w-4 h-4" /> Create &amp; Send Invoice</button>
        </div>
      </div>
    </div>
  );

  /* ================================================================ */
  /*  INVOICE AGING REPORT                                             */
  /* ================================================================ */

  const renderInvoiceAging = () => (
    <div className="space-y-4">
      <div className={ds.sectionHeader}>
        <h2 className={ds.heading2}>Invoice Aging Report</h2>
        <div className="flex items-center gap-2">
          <button className={ds.btnPrimary} onClick={handleInvoiceAging} disabled={backendAgingLoading}>
            {backendAgingLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />} Run Aging Analysis
          </button>
          <button className={ds.btnSecondary} onClick={() => setInvoicingView('list')}>
            <ArrowRight className="w-4 h-4" /> Back to List
          </button>
        </div>
      </div>

      {/* Backend Aging Result */}
      {backendAgingResult && (
        <div className={cn(ds.panel, 'border border-yellow-400/30')}>
          <div className="flex items-center justify-between mb-4">
            <h3 className={cn(ds.heading3, 'flex items-center gap-2')}>
              <Clock className="w-5 h-5 text-yellow-400" /> Server-Computed Aging Analysis
            </h3>
            <div className="flex items-center gap-3">
              <span className={cn(ds.textMuted, 'text-xs')}>As of: {(backendAgingResult.asOfDate as string) || '-'}</span>
              <button onClick={() => setBackendAgingResult(null)} className={ds.btnGhost}><X className="w-4 h-4" /></button>
            </div>
          </div>

          <div className={ds.grid3}>
            <div className="text-center p-3 rounded-lg bg-lattice-elevated/50">
              <p className={ds.textMuted}>Total Invoices</p>
              <p className={cn(ds.heading2, 'text-white')}>{backendAgingResult.totalInvoices as number || 0}</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-lattice-elevated/50">
              <p className={ds.textMuted}>Unpaid Count</p>
              <p className={cn(ds.heading2, 'text-yellow-400')}>{backendAgingResult.unpaidCount as number || 0}</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-lattice-elevated/50">
              <p className={ds.textMuted}>Avg Days Outstanding</p>
              <p className={cn(ds.heading2, 'text-neon-cyan')}>{backendAgingResult.avgDaysOutstanding as number || 0}</p>
            </div>
          </div>

          {!!backendAgingResult.buckets && (
            <div className="grid grid-cols-5 gap-3 mt-4">
              {Object.entries(backendAgingResult.buckets as Record<string, Record<string, unknown>>).map(([key, bucket]) => {
                const colorMap: Record<string, string> = { current: 'text-green-400 border-green-400/30 bg-green-400/10', '1-30': 'text-yellow-400 border-yellow-400/30 bg-yellow-400/10', '31-60': 'text-orange-400 border-orange-400/30 bg-orange-400/10', '61-90': 'text-red-400 border-red-400/30 bg-red-400/10', '90+': 'text-red-500 border-red-500/30 bg-red-500/10' };
                return (
                  <div key={key} className={cn('text-center p-3 rounded-lg border', colorMap[key] || 'border-gray-400/30')}>
                    <p className={ds.textMuted}>{key === 'current' ? 'Current' : `${key} Days`}</p>
                    <p className={cn(ds.heading3, colorMap[key]?.split(' ')[0])}>{fmt(bucket.total as number || 0)}</p>
                    <p className="text-xs text-gray-500">{(bucket.invoices as Array<unknown>)?.length || 0} invoices</p>
                  </div>
                );
              })}
            </div>
          )}

          <div className={cn(ds.grid2, 'mt-4')}>
            <div className={cn('p-3 rounded-lg text-center', 'bg-yellow-400/10 border border-yellow-400/30')}>
              <p className={ds.textMuted}>Total Outstanding</p>
              <p className={cn(ds.heading2, 'text-yellow-400')}>{fmt(backendAgingResult.totalOutstanding as number || 0)}</p>
            </div>
            <div className={cn('p-3 rounded-lg text-center', 'bg-red-400/10 border border-red-400/30')}>
              <p className={ds.textMuted}>Total Overdue</p>
              <p className={cn(ds.heading2, 'text-red-400')}>{fmt(backendAgingResult.totalOverdue as number || 0)}</p>
            </div>
          </div>
        </div>
      )}

      {/* Client-side aging buckets */}
      <div className={ds.grid4}>
        <div className={cn(ds.panel, 'text-center border-green-400/30')}>
          <p className={ds.textMuted}>Current</p>
          <p className={cn(ds.heading2, 'text-green-400')}>{fmt(invoiceAging.current)}</p>
        </div>
        <div className={cn(ds.panel, 'text-center border-yellow-400/30')}>
          <p className={ds.textMuted}>1-30 Days</p>
          <p className={cn(ds.heading2, 'text-yellow-400')}>{fmt(invoiceAging.thirtyDay)}</p>
        </div>
        <div className={cn(ds.panel, 'text-center border-orange-400/30')}>
          <p className={ds.textMuted}>31-60 Days</p>
          <p className={cn(ds.heading2, 'text-orange-400')}>{fmt(invoiceAging.sixtyDay)}</p>
        </div>
        <div className={cn(ds.panel, 'text-center border-red-400/30')}>
          <p className={ds.textMuted}>90+ Days</p>
          <p className={cn(ds.heading2, 'text-red-400')}>{fmt(invoiceAging.ninetyPlus)}</p>
        </div>
      </div>

      <div className={ds.panel}>
        <div className="flex items-center justify-between mb-3">
          <h3 className={ds.heading3}>Outstanding Invoices</h3>
          <span className={cn(ds.textMono, 'text-neon-cyan')}>Total: {fmt(invoiceAging.total)}</span>
        </div>
        {invoiceData.items.filter(inv => inv.meta.status !== 'paid' && inv.meta.status !== 'void').length === 0 ? (
          <p className={ds.textMuted}>No outstanding invoices.</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-lattice-border/30">
                <th className="pb-2 pr-4">Invoice #</th>
                <th className="pb-2 pr-4">Client</th>
                <th className="pb-2 pr-4">Due Date</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2 text-right pr-4">Amount</th>
                <th className="pb-2 text-right">Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {invoiceData.items.filter(inv => inv.meta.status !== 'paid' && inv.meta.status !== 'void').map(inv => {
                const d = inv.data as unknown as Invoice;
                const outstanding = (d.amount || 0) - (d.paidAmount || 0);
                return (
                  <tr key={inv.id} className="border-b border-lattice-border/20 hover:bg-lattice-elevated/30">
                    <td className={cn(ds.textMono, 'py-2.5 pr-4 text-gray-400')}>{d.invoiceNumber || '-'}</td>
                    <td className="py-2.5 pr-4 text-sm text-white">{d.client}</td>
                    <td className={cn(ds.textMuted, 'py-2.5 pr-4')}>{d.dueDate}</td>
                    <td className="py-2.5 pr-4">{renderStatusBadge(inv.meta.status, 'Invoice')}</td>
                    <td className={cn(ds.textMono, 'py-2.5 text-right pr-4 text-white')}>{fmt(d.amount || 0)}</td>
                    <td className={cn(ds.textMono, 'py-2.5 text-right text-red-400')}>{fmt(outstanding)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );

  /* ================================================================ */
  /*  PAYROLL CALCULATOR                                               */
  /* ================================================================ */

  const renderPayrollCalculator = () => (
    <div className="space-y-4">
      <div className={ds.sectionHeader}>
        <h2 className={ds.heading2}>Payroll Calculator</h2>
        <button className={ds.btnSecondary} onClick={() => setPayrollView('list')}>
          <ArrowRight className="w-4 h-4" /> Back to List
        </button>
      </div>

      <div className={ds.grid2}>
        {/* Input side */}
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-4')}>Pay Calculation</h3>
          <div className="space-y-4">
            <div>
              <label className={ds.label}>Gross Pay ($)</label>
              <input type="number" step="0.01" className={ds.input} value={calcGross || ''} onChange={e => setCalcGross(parseFloat(e.target.value) || 0)} placeholder="0.00" />
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Federal Tax Rate (%)</label>
                <input type="number" step="0.5" className={ds.input} value={calcFedRate} onChange={e => setCalcFedRate(parseFloat(e.target.value) || 0)} />
              </div>
              <div>
                <label className={ds.label}>State Tax Rate (%)</label>
                <input type="number" step="0.5" className={ds.input} value={calcStateRate} onChange={e => setCalcStateRate(parseFloat(e.target.value) || 0)} />
              </div>
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Health Insurance ($)</label>
                <input type="number" step="1" className={ds.input} value={calcInsurance} onChange={e => setCalcInsurance(parseFloat(e.target.value) || 0)} />
              </div>
              <div>
                <label className={ds.label}>Retirement (%)</label>
                <input type="number" step="0.5" className={ds.input} value={calcRetirement} onChange={e => setCalcRetirement(parseFloat(e.target.value) || 0)} />
              </div>
            </div>
          </div>
        </div>

        {/* Output side */}
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-4')}>Pay Breakdown</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-white">Gross Pay</span>
              <span className={cn(ds.textMono, 'text-white')}>{fmt(calcGross)}</span>
            </div>
            <div className="border-t border-lattice-border/30 pt-2 space-y-2">
              <p className="text-xs text-gray-500 uppercase tracking-wider">Deductions</p>
              <div className="flex items-center justify-between py-1">
                <span className={ds.textMuted}>Federal Tax ({calcFedRate}%)</span>
                <span className={cn(ds.textMono, 'text-red-400')}>-{fmt(calcFedTax)}</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className={ds.textMuted}>State Tax ({calcStateRate}%)</span>
                <span className={cn(ds.textMono, 'text-red-400')}>-{fmt(calcStateTax)}</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className={ds.textMuted}>Health Insurance</span>
                <span className={cn(ds.textMono, 'text-red-400')}>-{fmt(calcInsurance)}</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className={ds.textMuted}>Retirement ({calcRetirement}%)</span>
                <span className={cn(ds.textMono, 'text-red-400')}>-{fmt(calcRetAmt)}</span>
              </div>
            </div>
            <div className="flex items-center justify-between py-1 border-t border-lattice-border/30">
              <span className="text-sm font-medium text-white">Total Deductions</span>
              <span className={cn(ds.textMono, 'text-red-400 font-semibold')}>{fmt(calcTotalDeductions)}</span>
            </div>
            <div className={cn('flex items-center justify-between p-3 rounded-lg', calcNetPay >= 0 ? 'bg-green-400/10 border border-green-400/30' : 'bg-red-400/10 border border-red-400/30')}>
              <span className="text-lg font-bold text-white">Net Pay</span>
              <span className={cn('text-lg font-bold', ds.textMono, calcNetPay >= 0 ? 'text-green-400' : 'text-red-400')}>{fmt(calcNetPay)}</span>
            </div>
            <p className={ds.textMuted}>Effective tax rate: {calcGross > 0 ? ((calcTotalDeductions / calcGross) * 100).toFixed(1) : '0.0'}%</p>
          </div>
        </div>
      </div>

      {/* Payroll summary */}
      <div className={ds.panel}>
        <h3 className={cn(ds.heading3, 'mb-4')}>Payroll Summary</h3>
        <div className={ds.grid3}>
          <div className="text-center p-4 rounded-lg bg-lattice-elevated/50">
            <p className={ds.textMuted}>Total Gross</p>
            <p className={cn(ds.heading2, 'text-white')}>{fmt(totalPayroll.gross)}</p>
          </div>
          <div className="text-center p-4 rounded-lg bg-lattice-elevated/50">
            <p className={ds.textMuted}>Total Deductions</p>
            <p className={cn(ds.heading2, 'text-red-400')}>{fmt(totalPayroll.deductions)}</p>
          </div>
          <div className="text-center p-4 rounded-lg bg-lattice-elevated/50">
            <p className={ds.textMuted}>Total Net Pay</p>
            <p className={cn(ds.heading2, 'text-green-400')}>{fmt(totalPayroll.net)}</p>
          </div>
        </div>
        <p className={cn(ds.textMuted, 'mt-3')}>{payrollData.items.length} employee records</p>
      </div>
    </div>
  );

  /* ================================================================ */
  /*  BUDGET VS ACTUAL                                                 */
  /* ================================================================ */

  const renderBudgetVariance = () => {
    const totalAllocated = budgetVariance.reduce((s, b) => s + b.allocated, 0);
    const totalSpent = budgetVariance.reduce((s, b) => s + b.spent, 0);
    const totalVar = totalAllocated - totalSpent;

    return (
      <div className="space-y-4">
        <div className={ds.sectionHeader}>
          <h2 className={ds.heading2}>Budget vs Actual</h2>
          <div className="flex items-center gap-2">
            <button className={ds.btnPrimary} onClick={handleBudgetVariance} disabled={backendVarianceLoading}>
              {backendVarianceLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <BarChart3 className="w-4 h-4" />} Run Variance Analysis
            </button>
            <button className={ds.btnSecondary} onClick={() => setBudgetView('list')}>
              <ArrowRight className="w-4 h-4" /> Back to List
            </button>
          </div>
        </div>

        {/* Backend Variance Result */}
        {backendVarianceResult && (
          <div className={cn(ds.panel, 'border border-neon-cyan/30')}>
            <div className="flex items-center justify-between mb-4">
              <h3 className={cn(ds.heading3, 'flex items-center gap-2')}>
                <BarChart3 className="w-5 h-5 text-neon-cyan" /> Server-Computed Variance Analysis
              </h3>
              <div className="flex items-center gap-3">
                <span className={cn(ds.textMuted, 'text-xs')}>Period: {(backendVarianceResult.period as string) || '-'}</span>
                <button onClick={() => setBackendVarianceResult(null)} className={ds.btnGhost}><X className="w-4 h-4" /></button>
              </div>
            </div>

            <div className={ds.grid4}>
              <div className="text-center p-3 rounded-lg bg-lattice-elevated/50">
                <p className={ds.textMuted}>Total Planned</p>
                <p className={cn(ds.heading3, 'text-white')}>{fmt(backendVarianceResult.totalPlanned as number || 0)}</p>
              </div>
              <div className="text-center p-3 rounded-lg bg-lattice-elevated/50">
                <p className={ds.textMuted}>Total Actual</p>
                <p className={cn(ds.heading3, 'text-neon-cyan')}>{fmt(backendVarianceResult.totalActual as number || 0)}</p>
              </div>
              <div className={cn('text-center p-3 rounded-lg', (backendVarianceResult.totalVariance as number) > 0 ? 'bg-red-400/10 border border-red-400/30' : 'bg-green-400/10 border border-green-400/30')}>
                <p className={ds.textMuted}>Total Variance</p>
                <p className={cn(ds.heading3, (backendVarianceResult.totalVariance as number) > 0 ? 'text-red-400' : 'text-green-400')}>
                  {fmt(backendVarianceResult.totalVariance as number || 0)}
                </p>
              </div>
              <div className={cn('text-center p-3 rounded-lg bg-lattice-elevated/50')}>
                <p className={ds.textMuted}>Over-Budget Items</p>
                <p className={cn(ds.heading3, (backendVarianceResult.overBudgetCount as number) > 0 ? 'text-red-400' : 'text-green-400')}>
                  {backendVarianceResult.overBudgetCount as number || 0}
                </p>
              </div>
            </div>

            {Array.isArray(backendVarianceResult.lineItems) && (backendVarianceResult.lineItems as Array<Record<string, unknown>>).length > 0 && (
              <table className="w-full mt-4">
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b border-lattice-border">
                    <th className="pb-2 pr-4">Category</th>
                    <th className="pb-2 text-right pr-4">Planned</th>
                    <th className="pb-2 text-right pr-4">Actual</th>
                    <th className="pb-2 text-right pr-4">Variance</th>
                    <th className="pb-2 text-right pr-4">Variance %</th>
                    <th className="pb-2 text-center">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(backendVarianceResult.lineItems as Array<Record<string, unknown>>).map((line, i) => (
                    <tr key={i} className="border-b border-lattice-border/20 hover:bg-lattice-elevated/30">
                      <td className="py-2 pr-4 text-sm text-white">{line.category as string}</td>
                      <td className={cn(ds.textMono, 'py-2 text-right pr-4 text-white')}>{fmt(line.planned as number)}</td>
                      <td className={cn(ds.textMono, 'py-2 text-right pr-4 text-neon-cyan')}>{fmt(line.actual as number)}</td>
                      <td className={cn(ds.textMono, 'py-2 text-right pr-4', (line.variance as number) > 0 ? 'text-red-400' : 'text-green-400')}>
                        {fmt(line.variance as number)}
                      </td>
                      <td className={cn(ds.textMono, 'py-2 text-right pr-4', (line.variancePct as number) > 0 ? 'text-red-400' : 'text-green-400')}>
                        {fmtPct(line.variancePct as number)}
                      </td>
                      <td className="py-2 text-center">
                        <span className={ds.badge(
                          (line.status as string) === 'over-budget' ? 'red-400' : (line.status as string) === 'under-budget' ? 'green-400' : 'neon-cyan'
                        )}>
                          {line.status as string}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {!!backendVarianceResult.largestOverrun && (
              <div className="mt-4 p-3 rounded-lg bg-red-400/10 border border-red-400/30">
                <div className="flex items-center gap-2 text-red-400">
                  <AlertCircle className="w-4 h-4" />
                  <span className="text-sm font-semibold">Largest Overrun:</span>
                  <span className="text-sm">{(backendVarianceResult.largestOverrun as Record<string, unknown>).category as string}</span>
                  <span className={cn(ds.textMono, 'text-sm')}>({fmt((backendVarianceResult.largestOverrun as Record<string, unknown>).variance as number)} over)</span>
                </div>
              </div>
            )}
          </div>
        )}

        <div className={ds.grid3}>
          <div className={cn(ds.panel, 'text-center')}>
            <p className={ds.textMuted}>Total Budgeted</p>
            <p className={cn(ds.heading2, 'text-white')}>{fmt(totalAllocated)}</p>
          </div>
          <div className={cn(ds.panel, 'text-center')}>
            <p className={ds.textMuted}>Total Actual</p>
            <p className={cn(ds.heading2, 'text-neon-cyan')}>{fmt(totalSpent)}</p>
          </div>
          <div className={cn(ds.panel, 'text-center')}>
            <p className={ds.textMuted}>Total Variance</p>
            <p className={cn(ds.heading2, totalVar >= 0 ? 'text-green-400' : 'text-red-400')}>{fmt(totalVar)}</p>
          </div>
        </div>

        <div className={ds.panel}>
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-lattice-border">
                <th className="pb-3 pr-4">Category</th>
                <th className="pb-3 pr-4">Department</th>
                <th className="pb-3 text-right pr-4">Budget</th>
                <th className="pb-3 text-right pr-4">Actual</th>
                <th className="pb-3 text-right pr-4">Variance ($)</th>
                <th className="pb-3 text-right pr-4">Variance (%)</th>
                <th className="pb-3 w-40">Utilization</th>
              </tr>
            </thead>
            <tbody>
              {budgetVariance.length === 0 ? (
                <tr><td colSpan={7} className={cn(ds.textMuted, 'py-4 text-center')}>No budget items yet.</td></tr>
              ) : (
                budgetVariance.map(b => (
                  <tr key={b.id} className="border-b border-lattice-border/20 hover:bg-lattice-elevated/30">
                    <td className="py-2.5 pr-4 text-sm text-white">{b.name}</td>
                    <td className={cn(ds.textMuted, 'py-2.5 pr-4')}>{b.department || '-'}</td>
                    <td className={cn(ds.textMono, 'py-2.5 text-right pr-4 text-white')}>{fmt(b.allocated)}</td>
                    <td className={cn(ds.textMono, 'py-2.5 text-right pr-4 text-neon-cyan')}>{fmt(b.spent)}</td>
                    <td className={cn(ds.textMono, 'py-2.5 text-right pr-4', b.variance >= 0 ? 'text-green-400' : 'text-red-400')}>
                      {b.variance >= 0 ? '+' : ''}{fmt(b.variance)}
                    </td>
                    <td className={cn(ds.textMono, 'py-2.5 text-right pr-4', b.pctVariance >= 0 ? 'text-green-400' : 'text-red-400')}>
                      {fmtPct(b.pctVariance)}
                    </td>
                    <td className="py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2.5 bg-lattice-elevated rounded-full overflow-hidden">
                          <div
                            className={cn('h-full rounded-full transition-all', b.pctUsed > 100 ? 'bg-red-400' : b.pctUsed > 90 ? 'bg-yellow-400' : 'bg-green-400')}
                            style={{ width: `${Math.min(100, b.pctUsed)}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-400 w-10 text-right">{b.pctUsed.toFixed(0)}%</span>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  /* ================================================================ */
  /*  ENHANCED DASHBOARD                                               */
  /* ================================================================ */

  const renderDashboard = () => (
    <div className="space-y-6">
      {/* Key metrics row */}
      <div className={ds.grid4}>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2"><DollarSign className="w-4 h-4 text-green-400" /><span className={ds.textMuted}>Cash Position</span></div>
          <p className={ds.heading2}>{fmt(totalAssets)}</p>
          <div className="flex items-center gap-1 mt-1 text-green-400 text-sm"><ArrowUpRight className="w-3 h-3" /> Total bank accounts</div>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2"><Receipt className="w-4 h-4 text-neon-cyan" /><span className={ds.textMuted}>Accounts Receivable</span></div>
          <p className={ds.heading2}>{fmt(invoiceAging.total)}</p>
          <div className="flex items-center gap-1 mt-1 text-yellow-400 text-sm"><Clock className="w-3 h-3" /> {invoiceData.items.filter(i => i.meta.status !== 'paid' && i.meta.status !== 'void').length} outstanding</div>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2"><CreditCard className="w-4 h-4 text-red-400" /><span className={ds.textMuted}>Accounts Payable</span></div>
          <p className={ds.heading2}>{fmt(totalLiabilities)}</p>
          <div className="flex items-center gap-1 mt-1 text-green-400 text-sm"><ArrowDownRight className="w-3 h-3" /> Total liabilities</div>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2"><TrendingUp className={cn('w-4 h-4', netIncome >= 0 ? 'text-green-400' : 'text-red-400')} /><span className={ds.textMuted}>Net Income MTD</span></div>
          <p className={cn(ds.heading2, netIncome >= 0 ? 'text-green-400' : 'text-red-400')}>{fmt(netIncome)}</p>
          <p className={ds.textMuted}>Revenue - Expenses</p>
        </div>
      </div>

      {/* Second row */}
      <div className={ds.grid2}>
        {/* Outstanding invoices */}
        <div className={ds.panel}>
          <div className={ds.sectionHeader}>
            <h3 className={ds.heading3}>Outstanding Invoices</h3>
            <span className={ds.badge('yellow-400')}>{invoiceData.items.filter(i => i.meta.status !== 'paid' && i.meta.status !== 'void').length}</span>
          </div>
          <div className="mt-3 space-y-2">
            {invoiceData.items.filter(i => i.meta.status !== 'paid' && i.meta.status !== 'void').slice(0, 5).map(inv => {
              const d = inv.data as unknown as Invoice;
              return (
                <div key={inv.id} className="flex items-center justify-between py-2 border-b border-lattice-border/20">
                  <div>
                    <p className="text-sm text-white">{d.client || inv.title}</p>
                    <p className="text-xs text-gray-500">Due: {d.dueDate || '-'}</p>
                  </div>
                  <div className="text-right">
                    <p className={cn(ds.textMono, 'text-white')}>{fmt(d.amount || 0)}</p>
                    {renderStatusBadge(inv.meta.status, 'Invoice')}
                  </div>
                </div>
              );
            })}
            {invoiceData.items.filter(i => i.meta.status !== 'paid' && i.meta.status !== 'void').length === 0 && (
              <p className={ds.textMuted}>No outstanding invoices.</p>
            )}
          </div>
        </div>

        {/* Payroll overview */}
        <div className={ds.panel}>
          <div className={ds.sectionHeader}>
            <h3 className={ds.heading3}>Payroll Overview</h3>
            <span className={ds.badge('neon-cyan')}>{payrollData.items.length} employees</span>
          </div>
          <div className="mt-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className={ds.textMuted}>Total Gross Pay</span>
              <span className={cn(ds.textMono, 'text-white')}>{fmt(totalPayroll.gross)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className={ds.textMuted}>Total Deductions</span>
              <span className={cn(ds.textMono, 'text-red-400')}>{fmt(totalPayroll.deductions)}</span>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-lattice-border/30">
              <span className="text-sm font-semibold text-white">Net Payroll</span>
              <span className={cn(ds.textMono, 'text-green-400 font-semibold')}>{fmt(totalPayroll.net)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Rent Roll */}
      {currentType === 'Property' && rentRoll > 0 && (
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2"><Building2 className="w-4 h-4 text-neon-purple" /><span className={ds.textMuted}>Monthly Rent Roll</span></div>
          <p className={cn(ds.heading2, 'text-neon-purple')}>{fmt(rentRoll)}</p>
          <p className={ds.textMuted}>Total monthly rental income from properties</p>
        </div>
      )}

      {/* Invoice Aging */}
      <div className={ds.panel}>
        <h3 className={cn(ds.heading3, 'mb-4')}>Invoice Aging Report</h3>
        <div className={ds.grid4}>
          <div className="text-center p-4 rounded-lg bg-green-400/10 border border-green-400/20">
            <p className={ds.textMuted}>Current</p>
            <p className={cn(ds.heading2, 'text-green-400')}>{fmt(invoiceAging.current)}</p>
          </div>
          <div className="text-center p-4 rounded-lg bg-yellow-400/10 border border-yellow-400/20">
            <p className={ds.textMuted}>1-30 Days</p>
            <p className={cn(ds.heading2, 'text-yellow-400')}>{fmt(invoiceAging.thirtyDay)}</p>
          </div>
          <div className="text-center p-4 rounded-lg bg-orange-400/10 border border-orange-400/20">
            <p className={ds.textMuted}>31-60 Days</p>
            <p className={cn(ds.heading2, 'text-orange-400')}>{fmt(invoiceAging.sixtyDay)}</p>
          </div>
          <div className="text-center p-4 rounded-lg bg-red-400/10 border border-red-400/20">
            <p className={ds.textMuted}>90+ Days</p>
            <p className={cn(ds.heading2, 'text-red-400')}>{fmt(invoiceAging.ninetyPlus)}</p>
          </div>
        </div>
      </div>

      {/* Trial Balance Summary */}
      <div className={ds.panel}>
        <div className={ds.sectionHeader}>
          <h3 className={ds.heading3}>Trial Balance Summary</h3>
          <Scale className="w-5 h-5 text-gray-400" />
        </div>
        <div className={cn(ds.grid2, 'mt-4')}>
          <div>
            <h4 className={cn(ds.textMuted, 'mb-3 uppercase tracking-wider text-xs')}>Debits</h4>
            {['Asset', 'Expense'].map(cat => (
              (accountsByType[cat] || []).map(a => {
                const d = a.data as unknown as Account;
                return (
                  <div key={a.id} className="flex items-center justify-between py-2 border-b border-lattice-border/30">
                    <span className="text-sm text-white">{d.name || a.title}</span>
                    <span className={cn(ds.textMono, 'text-green-400')}>{fmt(d.balance || 0)}</span>
                  </div>
                );
              })
            ))}
            <div className="flex items-center justify-between py-2 font-bold">
              <span className="text-white">Total Debits</span>
              <span className={cn(ds.textMono, 'text-green-400')}>{fmt(totalDebits)}</span>
            </div>
          </div>
          <div>
            <h4 className={cn(ds.textMuted, 'mb-3 uppercase tracking-wider text-xs')}>Credits</h4>
            {['Liability', 'Equity', 'Revenue'].map(cat => (
              (accountsByType[cat] || []).map(a => {
                const d = a.data as unknown as Account;
                return (
                  <div key={a.id} className="flex items-center justify-between py-2 border-b border-lattice-border/30">
                    <span className="text-sm text-white">{d.name || a.title}</span>
                    <span className={cn(ds.textMono, 'text-neon-cyan')}>{fmt(d.balance || 0)}</span>
                  </div>
                );
              })
            ))}
            <div className="flex items-center justify-between py-2 font-bold">
              <span className="text-white">Total Credits</span>
              <span className={cn(ds.textMono, 'text-neon-cyan')}>{fmt(totalCredits)}</span>
            </div>
          </div>
        </div>
        <div className={cn('mt-3 p-2 rounded-lg text-center text-sm', Math.abs(totalDebits - totalCredits) < 0.01 ? 'bg-green-400/10 text-green-400' : 'bg-red-400/10 text-red-400')}>
          {Math.abs(totalDebits - totalCredits) < 0.01 ? 'Balanced' : `Out of balance by ${fmt(Math.abs(totalDebits - totalCredits))}`}
        </div>
      </div>

      {/* Budget Variance */}
      <div className={ds.panel}>
        <h3 className={cn(ds.heading3, 'mb-4')}>Budget Variance Analysis</h3>
        <div className="space-y-4">
          {budgetVariance.length === 0 ? (
            <p className={ds.textMuted}>No budget items to analyze.</p>
          ) : (
            budgetVariance.map(b => (
              <div key={b.id}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-white">{b.name}</span>
                  <div className="flex items-center gap-3">
                    <span className={ds.textMuted}>{b.pctUsed.toFixed(1)}% used</span>
                    <span className={cn(ds.textMono, b.variance >= 0 ? 'text-green-400' : 'text-red-400')}>
                      {b.variance >= 0 ? '+' : ''}{fmt(b.variance)} remaining
                    </span>
                  </div>
                </div>
                <div className="h-3 bg-lattice-elevated rounded-full overflow-hidden">
                  <div
                    className={cn('h-full rounded-full transition-all', b.pctUsed > 100 ? 'bg-red-400' : b.pctUsed > 90 ? 'bg-yellow-400' : 'bg-green-400')}
                    style={{ width: `${Math.min(100, b.pctUsed)}%` }}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Domain Actions */}
      <div className={ds.panel}>
        <h3 className={cn(ds.heading3, 'mb-4')}>Financial Actions</h3>
        <div className="flex flex-wrap gap-3">
          <button className={ds.btnSecondary} onClick={() => { setMode('Ledger'); setView('library'); setLedgerView('trial-balance'); }}>
            <Scale className="w-4 h-4" /> Trial Balance
          </button>
          <button className={ds.btnSecondary} onClick={() => { setMode('Ledger'); setView('library'); setLedgerView('pnl'); }}>
            <Calculator className="w-4 h-4" /> P&amp;L Report
          </button>
          <button className={ds.btnSecondary} onClick={() => { setMode('Invoicing'); setView('library'); setInvoicingView('aging'); }}>
            <AlertCircle className="w-4 h-4" /> Invoice Aging
          </button>
          <button className={ds.btnSecondary} onClick={() => { setMode('Ledger'); setView('library'); setLedgerView('balance-sheet'); }}>
            <Landmark className="w-4 h-4" /> Balance Sheet
          </button>
          <button className={ds.btnSecondary} onClick={() => { setMode('Ledger'); setView('library'); setLedgerView('cash-flow'); }}>
            <DollarSign className="w-4 h-4" /> Cash Flow
          </button>
          <button className={ds.btnSecondary} onClick={() => { setMode('Budget'); setView('library'); setBudgetView('variance'); }}>
            <BarChart3 className="w-4 h-4" /> Budget Variance
          </button>
          <button className={ds.btnSecondary} onClick={() => { setMode('Ledger'); setView('library'); setLedgerView('reconciliation'); }}>
            <RefreshCw className="w-4 h-4" /> Reconcile
          </button>
        </div>
      </div>
    </div>
  );

  /* ================================================================ */
  /*  FORM FIELDS (editor modal)                                       */
  /* ================================================================ */

  const renderFormFields = () => {
    switch (currentType) {
      case 'Account':
        return (
          <>
            <div><label className={ds.label}>Account Name</label><input className={ds.input} value={(formData.name as string) || ''} onChange={e => setFormData({ ...formData, name: e.target.value })} /></div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Account Number</label><input className={ds.input} value={(formData.accountNumber as string) || ''} onChange={e => setFormData({ ...formData, accountNumber: e.target.value })} /></div>
              <div><label className={ds.label}>Type</label><select className={ds.select} value={(formData.type as string) || ''} onChange={e => setFormData({ ...formData, type: e.target.value })}><option value="">Select...</option>{ACCOUNT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Balance ($)</label><input type="number" step="0.01" className={ds.input} value={(formData.balance as number) || ''} onChange={e => setFormData({ ...formData, balance: parseFloat(e.target.value) || 0 })} /></div>
              <div><label className={ds.label}>Institution</label><input className={ds.input} value={(formData.institution as string) || ''} onChange={e => setFormData({ ...formData, institution: e.target.value })} /></div>
            </div>
            <div><label className={ds.label}>Parent Account (optional)</label><input className={ds.input} value={(formData.parentAccount as string) || ''} onChange={e => setFormData({ ...formData, parentAccount: e.target.value })} placeholder="For sub-accounts..." /></div>
          </>
        );
      case 'Transaction':
        return (
          <>
            <div><label className={ds.label}>Description</label><input className={ds.input} value={(formData.description as string) || ''} onChange={e => setFormData({ ...formData, description: e.target.value })} /></div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Account</label><input className={ds.input} value={(formData.account as string) || ''} onChange={e => setFormData({ ...formData, account: e.target.value })} /></div>
              <div><label className={ds.label}>Contra Account</label><input className={ds.input} value={(formData.contraAccount as string) || ''} onChange={e => setFormData({ ...formData, contraAccount: e.target.value })} /></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Category</label><select className={ds.select} value={(formData.category as string) || ''} onChange={e => setFormData({ ...formData, category: e.target.value })}><option value="">Select...</option><option value="Revenue">Revenue</option><option value="Expense">Expense</option><option value="COGS">COGS</option><option value="Transfer">Transfer</option><option value="Adjustment">Adjustment</option></select></div>
              <div><label className={ds.label}>Date</label><input type="date" className={ds.input} value={(formData.date as string) || ''} onChange={e => setFormData({ ...formData, date: e.target.value })} /></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Debit ($)</label><input type="number" step="0.01" className={ds.input} value={(formData.debit as number) || ''} onChange={e => setFormData({ ...formData, debit: parseFloat(e.target.value) || 0 })} /></div>
              <div><label className={ds.label}>Credit ($)</label><input type="number" step="0.01" className={ds.input} value={(formData.credit as number) || ''} onChange={e => setFormData({ ...formData, credit: parseFloat(e.target.value) || 0 })} /></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Reference</label><input className={ds.input} value={(formData.reference as string) || ''} onChange={e => setFormData({ ...formData, reference: e.target.value })} /></div>
              <div><label className={ds.label}>Memo</label><input className={ds.input} value={(formData.memo as string) || ''} onChange={e => setFormData({ ...formData, memo: e.target.value })} placeholder="Optional note..." /></div>
            </div>
          </>
        );
      case 'Invoice':
        return (
          <>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Invoice Number</label><input className={ds.input} value={(formData.invoiceNumber as string) || ''} onChange={e => setFormData({ ...formData, invoiceNumber: e.target.value })} /></div>
              <div><label className={ds.label}>Client</label><input className={ds.input} value={(formData.client as string) || ''} onChange={e => setFormData({ ...formData, client: e.target.value })} /></div>
            </div>
            <div className={ds.grid3}>
              <div><label className={ds.label}>Amount ($)</label><input type="number" step="0.01" className={ds.input} value={(formData.amount as number) || ''} onChange={e => setFormData({ ...formData, amount: parseFloat(e.target.value) || 0 })} /></div>
              <div><label className={ds.label}>Paid Amount ($)</label><input type="number" step="0.01" className={ds.input} value={(formData.paidAmount as number) || ''} onChange={e => setFormData({ ...formData, paidAmount: parseFloat(e.target.value) || 0 })} /></div>
              <div><label className={ds.label}>Tax Rate (%)</label><input type="number" step="0.5" className={ds.input} value={(formData.taxRate as number) || ''} onChange={e => setFormData({ ...formData, taxRate: parseFloat(e.target.value) || 0 })} /></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Issued Date</label><input type="date" className={ds.input} value={(formData.issuedDate as string) || ''} onChange={e => setFormData({ ...formData, issuedDate: e.target.value })} /></div>
              <div><label className={ds.label}>Due Date</label><input type="date" className={ds.input} value={(formData.dueDate as string) || ''} onChange={e => setFormData({ ...formData, dueDate: e.target.value })} /></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Payment Terms</label><select className={ds.select} value={(formData.paymentTerms as string) || ''} onChange={e => setFormData({ ...formData, paymentTerms: e.target.value })}><option value="">Select...</option><option value="net-15">Net 15</option><option value="net-30">Net 30</option><option value="net-45">Net 45</option><option value="net-60">Net 60</option><option value="due-receipt">Due on Receipt</option></select></div>
              <div><label className={ds.label}>Line Items</label><input type="number" className={ds.input} value={(formData.lineItems as number) || ''} onChange={e => setFormData({ ...formData, lineItems: parseInt(e.target.value) || 0 })} /></div>
            </div>
            <div><label className={ds.label}>Notes</label><textarea className={ds.textarea} rows={3} value={(formData.notes as string) || ''} onChange={e => setFormData({ ...formData, notes: e.target.value })} /></div>
          </>
        );
      case 'PayrollEntry':
        return (
          <>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Employee</label><input className={ds.input} value={(formData.employee as string) || ''} onChange={e => setFormData({ ...formData, employee: e.target.value })} /></div>
              <div><label className={ds.label}>Period (YYYY-MM)</label><input className={ds.input} value={(formData.period as string) || ''} onChange={e => setFormData({ ...formData, period: e.target.value })} placeholder="2026-02" /></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Pay Type</label><select className={ds.select} value={(formData.payType as string) || 'salary'} onChange={e => setFormData({ ...formData, payType: e.target.value })}><option value="salary">Salary</option><option value="hourly">Hourly</option></select></div>
              <div><label className={ds.label}>Department</label><input className={ds.input} value={(formData.department as string) || ''} onChange={e => setFormData({ ...formData, department: e.target.value })} /></div>
            </div>
            {(formData.payType === 'hourly') && (
              <div className={ds.grid2}>
                <div><label className={ds.label}>Hourly Rate ($)</label><input type="number" step="0.01" className={ds.input} value={(formData.hourlyRate as number) || ''} onChange={e => setFormData({ ...formData, hourlyRate: parseFloat(e.target.value) || 0 })} /></div>
                <div><label className={ds.label}>Hours Worked</label><input type="number" step="0.5" className={ds.input} value={(formData.hoursWorked as number) || ''} onChange={e => setFormData({ ...formData, hoursWorked: parseFloat(e.target.value) || 0 })} /></div>
              </div>
            )}
            <div className={ds.grid3}>
              <div><label className={ds.label}>Gross Pay ($)</label><input type="number" step="0.01" className={ds.input} value={(formData.grossPay as number) || ''} onChange={e => setFormData({ ...formData, grossPay: parseFloat(e.target.value) || 0 })} /></div>
              <div><label className={ds.label}>Deductions ($)</label><input type="number" step="0.01" className={ds.input} value={(formData.deductions as number) || ''} onChange={e => setFormData({ ...formData, deductions: parseFloat(e.target.value) || 0 })} /></div>
              <div><label className={ds.label}>Net Pay ($)</label><input type="number" step="0.01" className={ds.input} value={(formData.netPay as number) || ''} onChange={e => setFormData({ ...formData, netPay: parseFloat(e.target.value) || 0 })} /></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Federal Tax ($)</label><input type="number" step="0.01" className={ds.input} value={(formData.federalTax as number) || ''} onChange={e => setFormData({ ...formData, federalTax: parseFloat(e.target.value) || 0 })} /></div>
              <div><label className={ds.label}>State Tax ($)</label><input type="number" step="0.01" className={ds.input} value={(formData.stateTax as number) || ''} onChange={e => setFormData({ ...formData, stateTax: parseFloat(e.target.value) || 0 })} /></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Insurance ($)</label><input type="number" step="0.01" className={ds.input} value={(formData.insurance as number) || ''} onChange={e => setFormData({ ...formData, insurance: parseFloat(e.target.value) || 0 })} /></div>
              <div><label className={ds.label}>Retirement ($)</label><input type="number" step="0.01" className={ds.input} value={(formData.retirement as number) || ''} onChange={e => setFormData({ ...formData, retirement: parseFloat(e.target.value) || 0 })} /></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>YTD Gross ($)</label><input type="number" step="0.01" className={ds.input} value={(formData.ytdGross as number) || ''} onChange={e => setFormData({ ...formData, ytdGross: parseFloat(e.target.value) || 0 })} /></div>
              <div><label className={ds.label}>YTD Net ($)</label><input type="number" step="0.01" className={ds.input} value={(formData.ytdNet as number) || ''} onChange={e => setFormData({ ...formData, ytdNet: parseFloat(e.target.value) || 0 })} /></div>
            </div>
          </>
        );
      case 'Budget':
        return (
          <>
            <div><label className={ds.label}>Budget Name</label><input className={ds.input} value={(formData.name as string) || ''} onChange={e => setFormData({ ...formData, name: e.target.value })} /></div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Category</label><input className={ds.input} value={(formData.category as string) || ''} onChange={e => setFormData({ ...formData, category: e.target.value })} /></div>
              <div><label className={ds.label}>Department</label><input className={ds.input} value={(formData.department as string) || ''} onChange={e => setFormData({ ...formData, department: e.target.value })} /></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Allocated ($)</label><input type="number" step="0.01" className={ds.input} value={(formData.allocated as number) || ''} onChange={e => setFormData({ ...formData, allocated: parseFloat(e.target.value) || 0 })} /></div>
              <div><label className={ds.label}>Spent ($)</label><input type="number" step="0.01" className={ds.input} value={(formData.spent as number) || ''} onChange={e => setFormData({ ...formData, spent: parseFloat(e.target.value) || 0 })} /></div>
            </div>
            <div><label className={ds.label}>Period</label><input className={ds.input} value={(formData.period as string) || ''} onChange={e => setFormData({ ...formData, period: e.target.value })} placeholder="Q1-2026" /></div>
          </>
        );
      case 'Property':
        return (
          <>
            <div><label className={ds.label}>Property Name</label><input className={ds.input} value={(formData.name as string) || ''} onChange={e => setFormData({ ...formData, name: e.target.value })} /></div>
            <div><label className={ds.label}>Address</label><input className={ds.input} value={(formData.address as string) || ''} onChange={e => setFormData({ ...formData, address: e.target.value })} /></div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Type</label><select className={ds.select} value={(formData.type as string) || ''} onChange={e => setFormData({ ...formData, type: e.target.value })}><option value="">Select...</option><option value="Commercial">Commercial</option><option value="Residential">Residential</option><option value="Industrial">Industrial</option><option value="Mixed-Use">Mixed-Use</option></select></div>
              <div><label className={ds.label}>Units</label><input type="number" className={ds.input} value={(formData.units as number) || ''} onChange={e => setFormData({ ...formData, units: parseInt(e.target.value) || 0 })} /></div>
            </div>
            <div className={ds.grid3}>
              <div><label className={ds.label}>Monthly Rent ($)</label><input type="number" step="0.01" className={ds.input} value={(formData.monthlyRent as number) || ''} onChange={e => setFormData({ ...formData, monthlyRent: parseFloat(e.target.value) || 0 })} /></div>
              <div><label className={ds.label}>Occupancy (%)</label><input type="number" min="0" max="100" className={ds.input} value={(formData.occupancy as number) || ''} onChange={e => setFormData({ ...formData, occupancy: parseFloat(e.target.value) || 0 })} /></div>
              <div><label className={ds.label}>Monthly Expenses ($)</label><input type="number" step="0.01" className={ds.input} value={(formData.expenses as number) || ''} onChange={e => setFormData({ ...formData, expenses: parseFloat(e.target.value) || 0 })} /></div>
            </div>
          </>
        );
      case 'TaxItem':
        return (
          <>
            <div><label className={ds.label}>Item Name</label><input className={ds.input} value={(formData.name as string) || ''} onChange={e => setFormData({ ...formData, name: e.target.value })} /></div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Category</label><select className={ds.select} value={(formData.category as string) || ''} onChange={e => setFormData({ ...formData, category: e.target.value })}><option value="">Select...</option><option value="Depreciation">Depreciation</option><option value="Insurance">Insurance</option><option value="Estimated Tax">Estimated Tax</option><option value="Deduction">Deduction</option><option value="Credit">Credit</option></select></div>
              <div><label className={ds.label}>Amount ($)</label><input type="number" step="0.01" className={ds.input} value={(formData.amount as number) || ''} onChange={e => setFormData({ ...formData, amount: parseFloat(e.target.value) || 0 })} /></div>
            </div>
            <div className={ds.grid2}>
              <div><label className={ds.label}>Tax Year</label><input className={ds.input} value={(formData.taxYear as string) || ''} onChange={e => setFormData({ ...formData, taxYear: e.target.value })} placeholder="2025" /></div>
              <div><label className={ds.label}>Deductible?</label><select className={ds.select} value={formData.deductible ? 'true' : 'false'} onChange={e => setFormData({ ...formData, deductible: e.target.value === 'true' })}><option value="true">Yes</option><option value="false">No</option></select></div>
            </div>
          </>
        );
      default: return null;
    }
  };

  /* ================================================================ */
  /*  CARD RENDERER                                                    */
  /* ================================================================ */

  const renderCard = (item: LensItem<ArtifactData>) => {
    const d = item.data as unknown as Record<string, unknown>;
    return (
      <div key={item.id} className={ds.panelHover}>
        <div className={ds.sectionHeader}>
          <h3 className={ds.heading3}>{item.title}</h3>
          {renderStatusBadge(item.meta.status)}
        </div>
        <div className="mt-2 space-y-1">
          {currentType === 'Account' && (
            <>
              <p className={cn(ds.textMono, 'text-gray-500')}>{d.accountNumber as string} | {d.type as string}</p>
              <p className={cn(ds.heading3, (d.type as string) === 'Liability' || (d.type as string) === 'Expense' ? 'text-red-400' : 'text-green-400')}>{fmt(d.balance as number)}</p>
              <p className={ds.textMuted}>{d.institution as string}</p>
              {d.parentAccount && <p className={cn(ds.textMuted, 'text-xs')}>Sub-account of: {d.parentAccount as string}</p>}
            </>
          )}
          {currentType === 'Transaction' && (
            <>
              <p className={ds.textMuted}>{d.account as string} {d.contraAccount ? `-> ${d.contraAccount as string}` : ''} | {d.category as string}</p>
              <div className="flex items-center gap-4">
                <span className={cn(ds.textMono, 'text-green-400')}>DR {fmt(d.debit as number)}</span>
                <span className={cn(ds.textMono, 'text-red-400')}>CR {fmt(d.credit as number)}</span>
              </div>
              <p className={ds.textMuted}>Ref: {d.reference as string} | {d.date as string}</p>
            </>
          )}
          {currentType === 'Invoice' && (
            <>
              <p className={ds.textMuted}>Client: {d.client as string}</p>
              <p className={ds.heading3}>{fmt(d.amount as number)}</p>
              {(d.paidAmount as number) > 0 && <p className={cn(ds.textMuted, 'text-green-400')}>Paid: {fmt(d.paidAmount as number)} | Outstanding: {fmt((d.amount as number) - (d.paidAmount as number))}</p>}
              <p className={ds.textMuted}>Issued: {d.issuedDate as string} | Due: {d.dueDate as string}</p>
              {d.paymentTerms && <p className={cn(ds.textMuted, 'text-xs')}>Terms: {d.paymentTerms as string}</p>}
            </>
          )}
          {currentType === 'PayrollEntry' && (
            <>
              <p className={ds.textMuted}>{d.employee as string} | {d.department as string}</p>
              <p className={ds.textMuted}>Period: {d.period as string} | {d.payType as string || 'salary'}</p>
              <div className="flex items-center gap-3">
                <span className={ds.textMuted}>Gross: {fmt(d.grossPay as number)}</span>
                <span className={ds.textMuted}>Net: {fmt(d.netPay as number)}</span>
              </div>
              {((d.ytdGross as number) || 0) > 0 && <p className={cn(ds.textMuted, 'text-xs')}>YTD: {fmt(d.ytdGross as number)}</p>}
            </>
          )}
          {currentType === 'Budget' && (
            <>
              <p className={ds.textMuted}>{d.category as string} | {d.department as string}</p>
              <div className="mt-2">
                <div className="flex justify-between text-xs text-gray-400 mb-1">
                  <span>{fmt(d.spent as number)} spent</span>
                  <span>{fmt(d.allocated as number)} allocated</span>
                </div>
                <div className="h-2 bg-lattice-elevated rounded-full overflow-hidden">
                  <div className={cn('h-full rounded-full', ((d.spent as number) / (d.allocated as number)) > 0.9 ? 'bg-red-400' : ((d.spent as number) / (d.allocated as number)) > 0.7 ? 'bg-yellow-400' : 'bg-green-400')} style={{ width: `${Math.min(100, ((d.spent as number) / (d.allocated as number)) * 100)}%` }} />
                </div>
              </div>
              <p className={ds.textMuted}>Remaining: {fmt((d.allocated as number) - (d.spent as number))}</p>
            </>
          )}
          {currentType === 'Property' && (
            <>
              <p className={ds.textMuted}>{d.address as string}</p>
              <p className={ds.textMuted}>{d.type as string} | {d.units as number} units | {d.occupancy as number}% occupied</p>
              <div className="flex items-center gap-3">
                <span className={cn(ds.textMono, 'text-green-400')}>Rent: {fmt(d.monthlyRent as number)}/mo</span>
                <span className={cn(ds.textMono, 'text-red-400')}>Exp: {fmt(d.expenses as number)}/mo</span>
              </div>
              <p className={ds.textMuted}>NOI: {fmt((d.monthlyRent as number) - (d.expenses as number))}/mo</p>
            </>
          )}
          {currentType === 'TaxItem' && (
            <>
              <p className={ds.textMuted}>{d.category as string} | Tax Year: {d.taxYear as string}</p>
              <p className={ds.heading3}>{fmt(d.amount as number)}</p>
              <span className={ds.badge((d.deductible as boolean) ? 'green-400' : 'gray-400')}>{(d.deductible as boolean) ? 'Deductible' : 'Non-deductible'}</span>
            </>
          )}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button className={cn(ds.btnGhost, ds.btnSmall)} onClick={() => openEdit(item)}><Edit3 className="w-3.5 h-3.5" /> Edit</button>
          <button className={cn(ds.btnDanger, ds.btnSmall)} onClick={() => handleDelete(item.id)}><Trash2 className="w-3.5 h-3.5" /> Delete</button>
        </div>
      </div>
    );
  };

  /* ================================================================ */
  /*  TAB-SPECIFIC CONTENT ROUTER                                      */
  /* ================================================================ */

  const renderTabContent = () => {
    if (view === 'dashboard') return renderDashboard();

    /* Ledger tab sub-views */
    if (mode === 'Ledger') {
      if (ledgerView === 'accounts') return renderChartOfAccounts();
      if (ledgerView === 'journal') return renderJournalEntry();
      if (ledgerView === 'trial-balance') return renderTrialBalance();
      if (ledgerView === 'pnl') return renderProfitLoss();
      if (ledgerView === 'balance-sheet') return renderBalanceSheet();
      if (ledgerView === 'cash-flow') return renderCashFlow();
      if (ledgerView === 'reconciliation') return renderReconciliation();
    }

    /* Invoicing tab sub-views */
    if (mode === 'Invoicing') {
      if (invoicingView === 'builder') return renderInvoiceBuilder();
      if (invoicingView === 'aging') return renderInvoiceAging();
    }

    /* Payroll tab sub-views */
    if (mode === 'Payroll') {
      if (payrollView === 'calculator') return renderPayrollCalculator();
    }

    /* Budget tab sub-views */
    if (mode === 'Budget') {
      if (budgetView === 'variance') return renderBudgetVariance();
    }

    /* Default: standard library view */
    return renderLibraryView();
  };

  const renderLibraryView = () => (
    <>
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            className={cn(ds.input, 'pl-10')}
            placeholder={`Search ${currentType.toLowerCase()}s...`}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-1">
          <Filter className="w-4 h-4 text-gray-400" />
          <select className={cn(ds.select, 'w-auto')} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="all">All Statuses</option>
            {statusOptionsFor(currentType).map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <button className={ds.btnPrimary} onClick={openNew}>
          <Plus className="w-4 h-4" /> New {currentType}
        </button>
        {runAction.isPending && <span className="text-xs text-neon-blue animate-pulse">Running...</span>}
      </div>

      {actionResult && (
        <div className={ds.panel}>
          <div className="flex items-center justify-between mb-2">
            <h3 className={ds.heading3}>Action Result</h3>
            <button onClick={() => setActionResult(null)} className={ds.btnGhost}><X className="w-4 h-4" /></button>
          </div>
          <pre className={cn(ds.textMono, 'text-xs overflow-auto max-h-48')}>{JSON.stringify(actionResult, null, 2)}</pre>
        </div>
      )}

      {/* Rent Roll Action Panel (Properties tab) */}
      {mode === 'Properties' && (
        <div className={ds.panel}>
          <div className={ds.sectionHeader}>
            <h3 className={cn(ds.heading3, 'flex items-center gap-2')}>
              <Building2 className="w-5 h-5 text-neon-purple" /> Rent Roll Report
            </h3>
            <button className={ds.btnPrimary} onClick={handleRentRoll} disabled={rentRollLoading}>
              {rentRollLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />} Generate Rent Roll
            </button>
          </div>

          {rentRollResult && (
            <div className="mt-4 space-y-4">
              <div className="flex items-center justify-between">
                <span className={cn(ds.textMuted, 'text-xs')}>As of: {(rentRollResult.asOfMonth as string) || '-'}</span>
                <button onClick={() => setRentRollResult(null)} className={ds.btnGhost}><X className="w-4 h-4" /></button>
              </div>

              <div className={ds.grid4}>
                <div className="text-center p-3 rounded-lg bg-lattice-elevated/50">
                  <p className={ds.textMuted}>Properties</p>
                  <p className={cn(ds.heading3, 'text-white')}>{rentRollResult.totalProperties as number || 0}</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-lattice-elevated/50">
                  <p className={ds.textMuted}>Total Units</p>
                  <p className={cn(ds.heading3, 'text-white')}>{rentRollResult.totalUnits as number || 0}</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-green-400/10 border border-green-400/30">
                  <p className={ds.textMuted}>Occupancy Rate</p>
                  <p className={cn(ds.heading3, 'text-green-400')}>{rentRollResult.occupancyRate as number || 0}%</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-neon-cyan/10 border border-neon-cyan/30">
                  <p className={ds.textMuted}>Collection Rate</p>
                  <p className={cn(ds.heading3, 'text-neon-cyan')}>{rentRollResult.collectionRate as number || 0}%</p>
                </div>
              </div>

              <div className={ds.grid3}>
                <div className="text-center p-3 rounded-lg bg-lattice-elevated/50">
                  <p className={ds.textMuted}>Expected Rent</p>
                  <p className={cn(ds.heading3, 'text-white')}>{fmt(rentRollResult.totalExpectedRent as number || 0)}</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-green-400/10 border border-green-400/30">
                  <p className={ds.textMuted}>Collected</p>
                  <p className={cn(ds.heading3, 'text-green-400')}>{fmt(rentRollResult.totalCollected as number || 0)}</p>
                </div>
                <div className={cn('text-center p-3 rounded-lg', (rentRollResult.totalOutstanding as number) > 0 ? 'bg-red-400/10 border border-red-400/30' : 'bg-green-400/10 border border-green-400/30')}>
                  <p className={ds.textMuted}>Outstanding</p>
                  <p className={cn(ds.heading3, (rentRollResult.totalOutstanding as number) > 0 ? 'text-red-400' : 'text-green-400')}>{fmt(rentRollResult.totalOutstanding as number || 0)}</p>
                </div>
              </div>

              {/* Per-property breakdown */}
              {Array.isArray(rentRollResult.properties) && (rentRollResult.properties as Array<Record<string, unknown>>).length > 0 && (
                <div className="space-y-3">
                  <h4 className={cn(ds.heading3, 'text-sm')}>Property Breakdown</h4>
                  {(rentRollResult.properties as Array<Record<string, unknown>>).map((prop, i) => (
                    <div key={i} className={cn(ds.panelHover, 'flex items-center justify-between')}>
                      <div>
                        <p className="text-sm text-white font-medium">{prop.address as string || prop.propertyId as string}</p>
                        <p className={ds.textMuted}>{prop.occupied as number}/{prop.totalUnits as number} occupied | {prop.vacant as number} vacant</p>
                      </div>
                      <div className="text-right">
                        <p className={cn(ds.textMono, 'text-green-400')}>{fmt(prop.collected as number || 0)} / {fmt(prop.expectedRent as number || 0)}</p>
                        <p className={cn(ds.textMuted, 'text-xs')}>{prop.collectionRate as number || 0}% collected</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Artifact library */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-green-400" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20">
          <Landmark className="w-12 h-12 text-gray-600 mx-auto mb-3" />
          <p className={ds.heading3}>No {currentType}s found</p>
          <p className={ds.textMuted}>Create one to get started.</p>
          <button className={cn(ds.btnPrimary, 'mt-4')} onClick={openNew}>
            <Plus className="w-4 h-4" /> Add {currentType}
          </button>
        </div>
      ) : (
        <div className={ds.grid3}>
          {filtered.map(renderCard)}
        </div>
      )}
    </>
  );

  /* ================================================================ */
  /*  MAIN RENDER                                                      */
  /* ================================================================ */

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div data-lens-theme="accounting" className={ds.pageContainer}>
      {/* Header */}
      <header className={ds.sectionHeader}>
        <div className="flex items-center gap-3">
          <Landmark className="w-7 h-7 text-green-400" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className={ds.heading1}>Accounting &amp; Finance</h1>
              <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
            </div>
            <p className={ds.textMuted}>General ledger, invoicing, payroll &amp; financial reporting</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className={view === 'library' ? ds.btnPrimary : ds.btnSecondary} onClick={() => setView('library')}>
            <ListChecks className="w-4 h-4" /> Library
          </button>
          <button className={view === 'dashboard' ? ds.btnPrimary : ds.btnSecondary} onClick={() => setView('dashboard')}>
            <BarChart3 className="w-4 h-4" /> Dashboard
          </button>
        </div>
      </header>


      {/* AI Actions */}
      <UniversalActions domain="accounting" artifactId={items[0]?.id} compact />
      <RealtimeDataPanel domain="accounting" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
      <DTUExportButton domain="accounting" data={{}} compact />

      {/* Stat Cards Row */}
      {(() => {
        const accounts = accountData.items.map(i => i.data as unknown as Account);
        const transactions = transactionData.items;
        const invoices = invoiceData.items.map(i => ({ ...i, d: i.data as unknown as Invoice }));
        const totalAssets = accounts.filter(a => a.type === 'Asset').reduce((s, a) => s + (a.balance || 0), 0);
        const totalLiabilities = accounts.filter(a => a.type === 'Liability').reduce((s, a) => s + (a.balance || 0), 0);
        const totalRevenue = accounts.filter(a => a.type === 'Revenue').reduce((s, a) => s + Math.abs(a.balance || 0), 0);
        const totalExpenses = accounts.filter(a => a.type === 'Expense').reduce((s, a) => s + Math.abs(a.balance || 0), 0);
        const netIncome = totalRevenue - totalExpenses;
        const overdueInvoices = invoices.filter(inv => inv.d.dueDate && new Date(inv.d.dueDate) < new Date() && inv.meta.status !== 'paid').length;
        return (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { icon: Calculator, label: 'Total Assets', value: fmt(totalAssets), color: 'text-green-400' },
                { icon: Scale, label: 'Total Liabilities', value: fmt(totalLiabilities), color: 'text-red-400' },
                { icon: TrendingUp, label: 'Net Income', value: fmt(netIncome), color: netIncome >= 0 ? 'text-green-400' : 'text-red-400' },
                { icon: DollarSign, label: 'Overdue Invoices', value: overdueInvoices, color: overdueInvoices > 0 ? 'text-red-400' : 'text-green-400' },
              ].map((stat, i) => (
                <motion.div key={stat.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }} className={ds.panel}>
                  <stat.icon className={`w-5 h-5 ${stat.color} mb-2`} />
                  <p className={ds.textMuted}>{stat.label}</p>
                  <p className="text-xl font-bold text-white">{stat.value}</p>
                </motion.div>
              ))}
            </div>

            {/* P&L Summary Bar */}
            {(totalRevenue > 0 || totalExpenses > 0) && (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }} className={ds.panel}>
                <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2"><BarChart3 className="w-4 h-4 text-green-400" /> P&L Summary</h3>
                <div className="space-y-2">
                  <div>
                    <div className="flex justify-between text-xs text-gray-400 mb-1"><span>Revenue</span><span className="text-green-400">{fmt(totalRevenue)}</span></div>
                    <div className="h-3 bg-white/5 rounded-full overflow-hidden"><motion.div initial={{ width: 0 }} animate={{ width: `${Math.min(totalRevenue / Math.max(totalRevenue, totalExpenses) * 100, 100)}%` }} transition={{ duration: 0.8 }} className="h-full bg-green-500 rounded-full" /></div>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs text-gray-400 mb-1"><span>Expenses</span><span className="text-red-400">{fmt(totalExpenses)}</span></div>
                    <div className="h-3 bg-white/5 rounded-full overflow-hidden"><motion.div initial={{ width: 0 }} animate={{ width: `${Math.min(totalExpenses / Math.max(totalRevenue, totalExpenses) * 100, 100)}%` }} transition={{ duration: 0.8 }} className="h-full bg-red-500 rounded-full" /></div>
                  </div>
                </div>
                {/* Account Type Badges */}
                <div className="flex flex-wrap gap-2 mt-3">
                  {ACCOUNT_CATEGORIES.map(cat => {
                    const count = accounts.filter(a => a.type === cat).length;
                    const catColors: Record<string, string> = { Asset: 'bg-blue-500/20 text-blue-400', Liability: 'bg-red-500/20 text-red-400', Equity: 'bg-purple-500/20 text-purple-400', Revenue: 'bg-green-500/20 text-green-400', Expense: 'bg-orange-500/20 text-orange-400' };
                    return <span key={cat} className={`px-2 py-1 rounded text-xs font-medium ${catColors[cat] || 'bg-gray-500/20 text-gray-400'}`}>{cat}: {count}</span>;
                  })}
                </div>
              </motion.div>
            )}

            {/* Journal Entry Timeline */}
            {transactions.length > 0 ? (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className={ds.panel}>
                <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2"><Clock className="w-4 h-4 text-neon-cyan" /> Recent Journal Entries</h3>
                <div className="space-y-0">
                  {transactionData.items.slice(0, 5).map((t, _i) => {
                    const d = t.data as unknown as Transaction;
                    return (
                      <div key={t.id} className="flex items-center gap-3 py-2 border-b border-white/5 last:border-0">
                        <div className="w-2 h-2 rounded-full bg-neon-cyan shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-white truncate">{d.description || t.title}</p>
                          <p className="text-xs text-gray-500">{d.date || ''} {d.account ? `- ${d.account}` : ''}</p>
                        </div>
                        <div className="text-right shrink-0">
                          {d.debit > 0 && <span className="text-xs text-green-400">DR {fmt(d.debit)}</span>}
                          {d.credit > 0 && <span className="text-xs text-red-400 ml-2">CR {fmt(d.credit)}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            ) : (
              <div className="text-center py-6 text-gray-500 text-sm border border-dashed border-white/10 rounded-lg">
                <p>No transactions recorded yet. Add transactions to see your financial ledger.</p>
              </div>
            )}
          </>
        );
      })()}

      {/* Mode tabs */}
      <nav className="flex items-center gap-2 border-b border-lattice-border pb-4 flex-wrap">
        {MODE_TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => { setMode(tab.id); setStatusFilter('all'); setSearchQuery(''); setView('library'); }}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg transition-colors whitespace-nowrap',
                mode === tab.id && view === 'library'
                  ? 'bg-green-400/20 text-green-400'
                  : 'text-gray-400 hover:text-white hover:bg-lattice-elevated'
              )}
            >
              <Icon className="w-4 h-4" />
              {tab.id}
            </button>
          );
        })}
      </nav>

      {/* Sub-view selectors per tab */}
      {view === 'library' && mode === 'Ledger' && (
        <div className="flex items-center gap-2 flex-wrap">
          <button className={ledgerView === 'accounts' ? ds.btnPrimary : ds.btnSecondary} onClick={() => { setLedgerView('accounts'); setLedgerSubType('Account'); }}>
            <Layers className="w-4 h-4" /> Chart of Accounts
          </button>
          <button className={ledgerView === 'journal' ? ds.btnPrimary : ds.btnSecondary} onClick={() => { setLedgerView('journal'); setLedgerSubType('Transaction'); }}>
            <BookOpen className="w-4 h-4" /> Journal Entries
          </button>
          <button className={ledgerView === 'trial-balance' ? ds.btnPrimary : ds.btnSecondary} onClick={() => setLedgerView('trial-balance')}>
            <Scale className="w-4 h-4" /> Trial Balance
          </button>
          <button className={ledgerView === 'pnl' ? ds.btnPrimary : ds.btnSecondary} onClick={() => setLedgerView('pnl')}>
            <TrendingUp className="w-4 h-4" /> P&amp;L
          </button>
          <button className={ledgerView === 'balance-sheet' ? ds.btnPrimary : ds.btnSecondary} onClick={() => setLedgerView('balance-sheet')}>
            <Landmark className="w-4 h-4" /> Balance Sheet
          </button>
          <button className={ledgerView === 'cash-flow' ? ds.btnPrimary : ds.btnSecondary} onClick={() => setLedgerView('cash-flow')}>
            <DollarSign className="w-4 h-4" /> Cash Flow
          </button>
          <button className={ledgerView === 'reconciliation' ? ds.btnPrimary : ds.btnSecondary} onClick={() => setLedgerView('reconciliation')}>
            <RefreshCw className="w-4 h-4" /> Reconciliation
          </button>
        </div>
      )}

      {view === 'library' && mode === 'Invoicing' && (
        <div className="flex items-center gap-2">
          <button className={invoicingView === 'list' ? ds.btnPrimary : ds.btnSecondary} onClick={() => setInvoicingView('list')}>
            <Receipt className="w-4 h-4" /> Invoice List
          </button>
          <button className={invoicingView === 'builder' ? ds.btnPrimary : ds.btnSecondary} onClick={() => setInvoicingView('builder')}>
            <FileText className="w-4 h-4" /> Invoice Builder
          </button>
          <button className={invoicingView === 'aging' ? ds.btnPrimary : ds.btnSecondary} onClick={() => setInvoicingView('aging')}>
            <Clock className="w-4 h-4" /> Aging Report
          </button>
        </div>
      )}

      {view === 'library' && mode === 'Payroll' && (
        <div className="flex items-center gap-2">
          <button className={payrollView === 'list' ? ds.btnPrimary : ds.btnSecondary} onClick={() => setPayrollView('list')}>
            <Users className="w-4 h-4" /> Employee List
          </button>
          <button className={payrollView === 'calculator' ? ds.btnPrimary : ds.btnSecondary} onClick={() => setPayrollView('calculator')}>
            <Calculator className="w-4 h-4" /> Payroll Calculator
          </button>
        </div>
      )}

      {view === 'library' && mode === 'Budget' && (
        <div className="flex items-center gap-2">
          <button className={budgetView === 'list' ? ds.btnPrimary : ds.btnSecondary} onClick={() => setBudgetView('list')}>
            <PiggyBank className="w-4 h-4" /> Budget List
          </button>
          <button className={budgetView === 'variance' ? ds.btnPrimary : ds.btnSecondary} onClick={() => setBudgetView('variance')}>
            <BarChart3 className="w-4 h-4" /> Budget vs Actual
          </button>
        </div>
      )}

      {/* Main content */}
      {renderTabContent()}

      {/* Editor modal */}
      {showEditor && (
        <div className={ds.modalBackdrop} onClick={() => setShowEditor(false)}>
          <div className={ds.modalContainer}>
            <div className={cn(ds.modalPanel, 'max-w-2xl')} onClick={e => e.stopPropagation()}>
              <div className="p-6 border-b border-lattice-border">
                <div className={ds.sectionHeader}>
                  <h2 className={ds.heading2}>{editingId ? 'Edit' : 'New'} {currentType}</h2>
                  <button className={ds.btnGhost} onClick={() => setShowEditor(false)}><X className="w-5 h-5" /></button>
                </div>
              </div>
              <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
                <div>
                  <label className={ds.label}>Title</label>
                  <input className={ds.input} value={formTitle} onChange={e => setFormTitle(e.target.value)} placeholder="Artifact title..." />
                </div>
                <div>
                  <label className={ds.label}>Status</label>
                  <select className={ds.select} value={formStatus} onChange={e => setFormStatus(e.target.value)}>
                    {statusOptionsFor(currentType).map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                {renderFormFields()}
              </div>
              <div className="p-6 border-t border-lattice-border flex items-center justify-end gap-3">
                <button className={ds.btnSecondary} onClick={() => setShowEditor(false)}>Cancel</button>
                <button className={ds.btnPrimary} onClick={handleSave} disabled={!formTitle.trim()}>
                  {editingId ? 'Update' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Lens Features */}
      <div className="border-t border-white/10">
        <button
          onClick={() => setShowFeatures(!showFeatures)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"
        >
          <span className="flex items-center gap-2">
            <Layers className="w-4 h-4" />
            Lens Features & Capabilities
          </span>
          <ChevronDown className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`} />
        </button>
        {showFeatures && (
          <div className="px-4 pb-4">
            <LensFeaturePanel lensId="accounting" />
          </div>
        )}
      </div>
    </div>
  );
}
