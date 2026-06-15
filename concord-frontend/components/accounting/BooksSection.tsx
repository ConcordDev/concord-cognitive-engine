'use client';

/**
 * BooksSection — top-level workbench for the accounting lens.
 *
 * Owns the nav-state and mounts the right panel per nav. Wires the
 * dashboard's "jump-to" shortcuts and the JAX-style ask bar to the
 * accounting domain macros.
 */

import { useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { BooksShell, BooksNav } from './BooksShell';
import { AccountingAskBar } from './AccountingAskBar';
import { AccountingDashboard } from './AccountingDashboard';
import { BankFeedsInbox } from './BankFeedsInbox';
import { CustomersPanel } from './CustomersPanel';
import { VendorsPanel } from './VendorsPanel';
import { BillsPanel } from './BillsPanel';
import { ExpensesPanel } from './ExpensesPanel';
import { EstimatesPanel } from './EstimatesPanel';
import { RecurringInvoicesPanel } from './RecurringInvoicesPanel';
import { PLStatement } from './PLStatement';
import { CashFlowStatement } from './CashFlowStatement';
import { RunwayForecast } from './RunwayForecast';
import { APAgingPanel } from './APAgingPanel';
import { Form1099Panel } from './Form1099Panel';
import { AcPayrollPanel } from './AcPayrollPanel';
import { AcBudgetsPanel } from './AcBudgetsPanel';
import { AcInventoryPanel } from './AcInventoryPanel';
import { AcSalesTaxPanel } from './AcSalesTaxPanel';
import { AcPurchaseOrdersPanel } from './AcPurchaseOrdersPanel';
import { AcRatiosPanel } from './AcRatiosPanel';

export function BooksSection() {
  const [nav, setNav] = useState<BooksNav>('dashboard');
  const [badges, setBadges] = useState<Partial<Record<BooksNav, number>>>({});

  useEffect(() => { refreshBadges(); }, [nav]);

  async function refreshBadges() {
    try {
      const r = await lensRun({ domain: 'accounting', action: 'dashboard-summary', input: {} });
      const d = r.data?.result;
      if (d) {
        setBadges({
          banking: d.uncategorizedTxns || 0,
          invoices: d.openInvCount || 0,
          bills: d.openBillsCount || 0,
        });
      }
    } catch {}
  }

  return (
    <BooksShell
      activeNav={nav}
      onNavChange={setNav}
      badges={badges}
      askBar={<AccountingAskBar />}
    >
      {nav === 'dashboard' && <AccountingDashboard onJumpTo={(n) => setNav(n as BooksNav)} />}
      {nav === 'banking'   && <BankFeedsInbox />}
      {nav === 'invoices'  && <InvoicesPlaceholder />}
      {nav === 'estimates' && <EstimatesPanel />}
      {nav === 'recurring' && <RecurringInvoicesPanel />}
      {nav === 'customers' && <CustomersPanel />}
      {nav === 'bills'     && <BillsPanel />}
      {nav === 'expenses'  && <ExpensesPanel />}
      {nav === 'vendors'   && <VendorsPanel />}
      {nav === 'pl'        && <PLStatement />}
      {nav === 'cashflow'  && <CashFlowStatement />}
      {nav === 'runway'    && <RunwayForecast />}
      {nav === 'aging-ar'  && <ARAgingPlaceholder />}
      {nav === 'aging-ap'  && <APAgingPanel />}
      {nav === 'ledger'    && <LedgerHint />}
      {nav === 'coa'       && <CoaHint />}
      {nav === 'ten99'     && <Form1099Panel />}
      {nav === 'payroll'   && <AcPayrollPanel />}
      {nav === 'budgets'   && <AcBudgetsPanel />}
      {nav === 'inventory' && <AcInventoryPanel />}
      {nav === 'salestax'  && <AcSalesTaxPanel />}
      {nav === 'purchaseorders' && <AcPurchaseOrdersPanel />}
      {nav === 'ratios'    && <AcRatiosPanel />}
    </BooksShell>
  );
}

/** The detailed invoice grid lives in AccountingWorkbench (the existing
 *  side-drawer with create / Stripe link / mark-paid). For QB-section
 *  parity we surface a quick-open hint. */
function InvoicesPlaceholder() {
  return (
    <div className="p-6 text-center text-sm text-gray-400 bg-black/30 border border-white/10 rounded">
      Invoices live in the Workbench drawer — open the side workbench (button in the lens header) for full create / Stripe link / mark-paid flow. The dashboard counter and runway forecast already include them.
    </div>
  );
}
function ARAgingPlaceholder() {
  return (
    <div className="p-6 text-center text-sm text-gray-400 bg-black/30 border border-white/10 rounded">
      A/R aging — open the Workbench &gt; Aging tab.
    </div>
  );
}
function LedgerHint() {
  return (
    <div className="p-6 text-center text-sm text-gray-400 bg-black/30 border border-white/10 rounded">
      Full ledger lives in the Workbench &gt; Ledger tab (date / account filters).
    </div>
  );
}
function CoaHint() {
  return (
    <div className="p-6 text-center text-sm text-gray-400 bg-black/30 border border-white/10 rounded">
      Chart of accounts — Workbench &gt; CoA tab supports create / archive.
    </div>
  );
}

export default BooksSection;
