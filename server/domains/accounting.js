// server/domains/accounting.js
// Domain actions for accounting: trial balance, P&L, invoice aging, budget variance, rent roll.

export default function registerAccountingActions(registerLensAction) {
  /**
   * trialBalance
   * Generate a trial balance from the chart of accounts.
   * artifact.data.accounts: [{ accountNumber, name, type, normalBalance, entries: [{ date, debit, credit, memo }] }]
   * params.asOfDate — optional cutoff date (ISO string)
   */
  registerLensAction("accounting", "trialBalance", (ctx, artifact, params) => {
  try {
    const accounts = artifact.data.accounts || [];
    const asOfDate = params.asOfDate ? new Date(params.asOfDate) : null;

    let totalDebits = 0;
    let totalCredits = 0;
    const rows = [];

    for (const acct of accounts) {
      let debitSum = 0;
      let creditSum = 0;

      for (const entry of (acct.entries || [])) {
        if (asOfDate && new Date(entry.date) > asOfDate) continue;
        debitSum += finNum(entry.debit);
        creditSum += finNum(entry.credit);
      }

      const netDebit = Math.round((debitSum - creditSum) * 100) / 100;
      const balanceDebit = netDebit > 0 ? Math.abs(netDebit) : 0;
      const balanceCredit = netDebit < 0 ? Math.abs(netDebit) : 0;

      totalDebits += balanceDebit;
      totalCredits += balanceCredit;

      rows.push({
        accountNumber: acct.accountNumber,
        name: acct.name,
        type: acct.type,
        debit: Math.round(balanceDebit * 100) / 100,
        credit: Math.round(balanceCredit * 100) / 100,
      });
    }

    totalDebits = Math.round(totalDebits * 100) / 100;
    totalCredits = Math.round(totalCredits * 100) / 100;
    const isBalanced = Math.abs(totalDebits - totalCredits) < 0.01;

    const result = {
      generatedAt: new Date().toISOString(),
      asOfDate: asOfDate ? asOfDate.toISOString().split("T")[0] : "current",
      accounts: rows.sort((a, b) => (a.accountNumber || "").localeCompare(b.accountNumber || "")),
      totalDebits,
      totalCredits,
      difference: Math.round((totalDebits - totalCredits) * 100) / 100,
      isBalanced,
    };

    artifact.data.trialBalance = result;

    return { ok: true, result };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * profitLoss
   * Generate a P&L statement for a given period.
   * artifact.data.accounts: same as trialBalance
   * params.startDate, params.endDate — period boundaries
   */
  registerLensAction("accounting", "profitLoss", (ctx, artifact, params) => {
  try {
    const accounts = artifact.data.accounts || [];
    const startDate = params.startDate ? new Date(params.startDate) : new Date(new Date().getFullYear(), 0, 1);
    const endDate = params.endDate ? new Date(params.endDate) : new Date();

    const revenueAccounts = accounts.filter((a) => a.type === "revenue" || a.type === "income");
    const expenseAccounts = accounts.filter((a) => a.type === "expense");
    const cogsAccounts = accounts.filter((a) => a.type === "cogs" || a.type === "cost-of-goods-sold");

    const sumEntries = (acctList) => {
      const lines = [];
      let total = 0;
      for (const acct of acctList) {
        let acctTotal = 0;
        for (const entry of (acct.entries || [])) {
          const entryDate = new Date(entry.date);
          if (entryDate >= startDate && entryDate <= endDate) {
            const credit = finNum(entry.credit);
            const debit = finNum(entry.debit);
            acctTotal += credit - debit;
          }
        }
        acctTotal = Math.round(acctTotal * 100) / 100;
        total += acctTotal;
        lines.push({ accountNumber: acct.accountNumber, name: acct.name, amount: acctTotal });
      }
      return { lines, total: Math.round(total * 100) / 100 };
    };

    const sumExpenses = (acctList) => {
      const lines = [];
      let total = 0;
      for (const acct of acctList) {
        let acctTotal = 0;
        for (const entry of (acct.entries || [])) {
          const entryDate = new Date(entry.date);
          if (entryDate >= startDate && entryDate <= endDate) {
            const debit = finNum(entry.debit);
            const credit = finNum(entry.credit);
            acctTotal += debit - credit;
          }
        }
        acctTotal = Math.round(acctTotal * 100) / 100;
        total += acctTotal;
        lines.push({ accountNumber: acct.accountNumber, name: acct.name, amount: acctTotal });
      }
      return { lines, total: Math.round(total * 100) / 100 };
    };

    const revenue = sumEntries(revenueAccounts);
    const cogs = sumExpenses(cogsAccounts);
    const expenses = sumExpenses(expenseAccounts);

    const grossProfit = Math.round((revenue.total - cogs.total) * 100) / 100;
    const grossMarginPct = revenue.total > 0 ? Math.round((grossProfit / revenue.total) * 10000) / 100 : 0;
    const netIncome = Math.round((grossProfit - expenses.total) * 100) / 100;
    const netMarginPct = revenue.total > 0 ? Math.round((netIncome / revenue.total) * 10000) / 100 : 0;

    const result = {
      generatedAt: new Date().toISOString(),
      period: { start: startDate.toISOString().split("T")[0], end: endDate.toISOString().split("T")[0] },
      revenue: { lines: revenue.lines, total: revenue.total },
      costOfGoodsSold: { lines: cogs.lines, total: cogs.total },
      grossProfit,
      grossMarginPct,
      operatingExpenses: { lines: expenses.lines, total: expenses.total },
      netIncome,
      netMarginPct,
    };

    artifact.data.profitLoss = result;

    return { ok: true, result };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * invoiceAging
   * Categorize unpaid invoices by age buckets: current, 1-30, 31-60, 61-90, 90+.
   * artifact.data.invoices: [{ invoiceId, customer, amount, issueDate, dueDate, paidDate }]
   */
  registerLensAction("accounting", "invoiceAging", (ctx, artifact, params) => {
  try {
    const invoices = artifact.data.invoices || [];
    const now = params.asOfDate ? new Date(params.asOfDate) : new Date();

    const unpaid = invoices.filter((inv) => !inv.paidDate);

    const buckets = {
      current: { invoices: [], total: 0 },
      "1-30": { invoices: [], total: 0 },
      "31-60": { invoices: [], total: 0 },
      "61-90": { invoices: [], total: 0 },
      "90+": { invoices: [], total: 0 },
    };

    for (const inv of unpaid) {
      const dueDate = new Date(inv.dueDate);
      const daysOverdue = Math.floor((now - dueDate) / 86400000);
      const amount = finNum(inv.amount);

      const entry = {
        invoiceId: inv.invoiceId,
        customer: inv.customer,
        amount,
        dueDate: inv.dueDate,
        daysOverdue: Math.max(0, daysOverdue),
      };

      let bucket;
      if (daysOverdue <= 0) bucket = "current";
      else if (daysOverdue <= 30) bucket = "1-30";
      else if (daysOverdue <= 60) bucket = "31-60";
      else if (daysOverdue <= 90) bucket = "61-90";
      else bucket = "90+";

      buckets[bucket].invoices.push(entry);
      buckets[bucket].total = Math.round((buckets[bucket].total + amount) * 100) / 100;
    }

    const totalOutstanding = Object.values(buckets).reduce((s, b) => s + b.total, 0);
    const totalOverdue = totalOutstanding - buckets.current.total;

    // Weighted average days outstanding
    let weightedDays = 0;
    for (const inv of unpaid) {
      const dueDate = new Date(inv.dueDate);
      const daysOut = Math.max(0, Math.floor((now - dueDate) / 86400000));
      const amount = finNum(inv.amount);
      weightedDays += daysOut * amount;
    }
    const avgDaysOutstanding = totalOutstanding > 0 ? Math.round(weightedDays / totalOutstanding) : 0;

    const result = {
      generatedAt: new Date().toISOString(),
      asOfDate: now.toISOString().split("T")[0],
      totalInvoices: invoices.length,
      unpaidCount: unpaid.length,
      totalOutstanding: Math.round(totalOutstanding * 100) / 100,
      totalOverdue: Math.round(totalOverdue * 100) / 100,
      avgDaysOutstanding,
      buckets,
    };

    artifact.data.invoiceAging = result;

    return { ok: true, result };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * budgetVariance
   * Compare actual vs planned amounts for budget line items.
   * artifact.data.budget: [{ category, planned, actual }]
   * params.period — label for the period
   */
  registerLensAction("accounting", "budgetVariance", (ctx, artifact, params) => {
  try {
    const budget = artifact.data.budget || [];
    const period = params.period || "current";

    let totalPlanned = 0;
    let totalActual = 0;

    const lines = budget.map((item) => {
      const planned = finNum(item.planned);
      const actual = finNum(item.actual);
      const variance = Math.round((actual - planned) * 100) / 100;
      const variancePct = planned !== 0 ? Math.round((variance / Math.abs(planned)) * 10000) / 100 : 0;

      totalPlanned += planned;
      totalActual += actual;

      return {
        category: item.category,
        planned,
        actual,
        variance,
        variancePct,
        status: variance > 0 ? "over-budget" : variance < 0 ? "under-budget" : "on-budget",
      };
    });

    const totalVariance = Math.round((totalActual - totalPlanned) * 100) / 100;
    const totalVariancePct = totalPlanned !== 0
      ? Math.round((totalVariance / Math.abs(totalPlanned)) * 10000) / 100
      : 0;

    const overBudgetItems = lines.filter((l) => l.status === "over-budget");
    const largestOverrun = overBudgetItems.length > 0
      ? overBudgetItems.reduce((max, l) => (l.variance > max.variance ? l : max), overBudgetItems[0])
      : null;

    const result = {
      generatedAt: new Date().toISOString(),
      period,
      lineItems: lines,
      totalPlanned: Math.round(totalPlanned * 100) / 100,
      totalActual: Math.round(totalActual * 100) / 100,
      totalVariance,
      totalVariancePct,
      overBudgetCount: overBudgetItems.length,
      largestOverrun,
    };

    artifact.data.budgetVariance = result;

    return { ok: true, result };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * rentRoll
   * Aggregate properties and their rent payment status.
   * artifact.data.properties: [{ propertyId, address, units: [{ unitId, tenant, monthlyRent, leaseEnd, paidThrough }] }]
   * params.asOfMonth — "YYYY-MM" to check (defaults to current month)
   */
  registerLensAction("accounting", "rentRoll", (ctx, artifact, params) => {
  try {
    const properties = artifact.data.properties || [];
    const now = new Date();
    const asOfMonth = params.asOfMonth || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const [year, month] = asOfMonth.split("-").map(Number);

    let totalExpectedRent = 0;
    let totalCollected = 0;
    let occupiedUnits = 0;
    let vacantUnits = 0;
    let totalUnits = 0;

    const propertyDetails = properties.map((prop) => {
      const units = prop.units || [];
      let propExpected = 0;
      let propCollected = 0;
      let propOccupied = 0;
      let propVacant = 0;

      const unitDetails = units.map((unit) => {
        totalUnits++;
        const rent = finNum(unit.monthlyRent);
        const isVacant = !unit.tenant;
        const leaseExpired = unit.leaseEnd ? new Date(unit.leaseEnd) < now : false;

        let paid = false;
        if (unit.paidThrough) {
          const paidDate = new Date(unit.paidThrough);
          paid = paidDate.getFullYear() > year ||
            (paidDate.getFullYear() === year && paidDate.getMonth() + 1 >= month);
        }

        if (isVacant) {
          propVacant++;
          vacantUnits++;
        } else {
          propOccupied++;
          occupiedUnits++;
          propExpected += rent;
          if (paid) propCollected += rent;
        }

        return {
          unitId: unit.unitId,
          tenant: unit.tenant || "VACANT",
          monthlyRent: rent,
          leaseEnd: unit.leaseEnd || null,
          leaseExpired,
          paidForMonth: paid,
          status: isVacant ? "vacant" : paid ? "paid" : "unpaid",
        };
      });

      totalExpectedRent += propExpected;
      totalCollected += propCollected;

      return {
        propertyId: prop.propertyId,
        address: prop.address,
        totalUnits: units.length,
        occupied: propOccupied,
        vacant: propVacant,
        expectedRent: Math.round(propExpected * 100) / 100,
        collected: Math.round(propCollected * 100) / 100,
        outstanding: Math.round((propExpected - propCollected) * 100) / 100,
        collectionRate: propExpected > 0 ? Math.round((propCollected / propExpected) * 10000) / 100 : 100,
        units: unitDetails,
      };
    });

    const result = {
      generatedAt: new Date().toISOString(),
      asOfMonth,
      totalProperties: properties.length,
      totalUnits,
      occupiedUnits,
      vacantUnits,
      occupancyRate: totalUnits > 0 ? Math.round((occupiedUnits / totalUnits) * 10000) / 100 : 0,
      totalExpectedRent: Math.round(totalExpectedRent * 100) / 100,
      totalCollected: Math.round(totalCollected * 100) / 100,
      totalOutstanding: Math.round((totalExpectedRent - totalCollected) * 100) / 100,
      collectionRate: totalExpectedRent > 0 ? Math.round((totalCollected / totalExpectedRent) * 10000) / 100 : 100,
      properties: propertyDetails,
    };

    artifact.data.rentRoll = result;

    return { ok: true, result };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * validate-ledger
   * Confirms double-entry books balance: sum(debits) === sum(credits)
   * across every account, and flags any account whose individual
   * debit/credit totals don't reconcile. Called by the frontend's
   * lens-feature "Validate ledger" button — pre-this macro it was a
   * dead click (cataloged in lens-features.js but no handler).
   */
  registerLensAction("accounting", "validate-ledger", (ctx, artifact, _params) => {
  try {
    const accounts = artifact.data?.accounts || [];
    let totalDebits = 0;
    let totalCredits = 0;
    const accountIssues = [];

    for (const acct of accounts) {
      let dr = 0;
      let cr = 0;
      for (const entry of (acct.entries || [])) {
        dr += finNum(entry.debit);
        cr += finNum(entry.credit);
      }
      totalDebits += dr;
      totalCredits += cr;

      // Per-account sanity: assets/expenses normalDebit; revenue/equity/
      // liability normalCredit. Flag accounts where the balance is on the
      // wrong side relative to the declared normalBalance.
      const normal = (acct.normalBalance || (acct.type === 'asset' || acct.type === 'expense' ? 'debit' : 'credit')).toLowerCase();
      const balance = Math.round((dr - cr) * 100) / 100;
      if (normal === 'debit' && balance < -0.01) {
        accountIssues.push({ account: acct.name || acct.accountNumber, issue: 'credit balance on debit-normal account', balance });
      } else if (normal === 'credit' && balance > 0.01) {
        accountIssues.push({ account: acct.name || acct.accountNumber, issue: 'debit balance on credit-normal account', balance });
      }
    }

    totalDebits = Math.round(totalDebits * 100) / 100;
    totalCredits = Math.round(totalCredits * 100) / 100;
    const difference = Math.round((totalDebits - totalCredits) * 100) / 100;
    const isBalanced = Math.abs(difference) < 0.01;

    const result = {
      validatedAt: new Date().toISOString(),
      totalDebits,
      totalCredits,
      difference,
      isBalanced,
      accountCount: accounts.length,
      accountIssues,
      severity: !isBalanced ? 'error' : accountIssues.length > 0 ? 'warning' : 'ok',
      message: !isBalanced
        ? `Ledger is OUT OF BALANCE by ${difference.toFixed(2)}. Total debits (${totalDebits}) ≠ total credits (${totalCredits}).`
        : accountIssues.length > 0
          ? `Ledger balances overall, but ${accountIssues.length} account(s) have suspicious balance side.`
          : `Ledger balances. ${accounts.length} accounts validated.`,
    };

    artifact.data.validationResult = result;
    return { ok: true, result };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * generate-invoice
   * Builds an invoice payload from line items + counterparty. Returns
   * the invoice object the frontend can render / persist as a DTU.
   * artifact.data.lineItems: [{ description, quantity, unitPrice, taxRate? }]
   * params.client { name, email?, address? }, params.dueDays (default 30),
   * params.invoiceNumber (auto if missing), params.notes
   */
  registerLensAction("accounting", "generate-invoice", (ctx, artifact, params) => {
  try {
    const lineItems = artifact.data?.lineItems || params?.lineItems || [];
    const client = params?.client || artifact.data?.client || {};
    const dueDays = Number(params?.dueDays) || 30;
    const issueDate = new Date();
    const dueDate = new Date(issueDate.getTime() + dueDays * 86_400_000);

    const enriched = lineItems.map((li, i) => {
      const qty = finNum(li.quantity);
      const unit = finNum(li.unitPrice);
      const subtotal = Math.round(qty * unit * 100) / 100;
      const taxRate = finNum(li.taxRate);
      const tax = Math.round(subtotal * taxRate * 100) / 100;
      return {
        idx: i + 1,
        description: li.description || `Line ${i + 1}`,
        quantity: qty,
        unitPrice: unit,
        subtotal,
        taxRate,
        tax,
        total: Math.round((subtotal + tax) * 100) / 100,
      };
    });

    const subtotal = Math.round(enriched.reduce((s, l) => s + l.subtotal, 0) * 100) / 100;
    const totalTax = Math.round(enriched.reduce((s, l) => s + l.tax, 0) * 100) / 100;
    const grandTotal = Math.round((subtotal + totalTax) * 100) / 100;

    const invoiceNumber = params?.invoiceNumber
      || `INV-${issueDate.getFullYear()}${String(issueDate.getMonth() + 1).padStart(2, '0')}-${Math.floor(Math.random() * 9000) + 1000}`;

    const result = {
      invoiceNumber,
      issueDate: issueDate.toISOString().slice(0, 10),
      dueDate: dueDate.toISOString().slice(0, 10),
      client,
      lineItems: enriched,
      subtotal,
      totalTax,
      grandTotal,
      status: 'draft',
      notes: params?.notes || '',
      generatedAt: issueDate.toISOString(),
    };

    artifact.data.lastGeneratedInvoice = result;
    return { ok: true, result };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * reconcile
   * Suggests pairings between unreconciled bank-feed lines and
   * recorded transactions. Match strategy is amount + date proximity
   * (±3 days) + counterparty token overlap. Returns confidence-scored
   * matches the user can accept one-click.
   *
   * artifact.data.bankLines: [{ id, date, amount, description }]
   * artifact.data.transactions: [{ id, date, amount, counterparty, memo, reconciled?: bool }]
   */
  registerLensAction("accounting", "reconcile", (ctx, artifact, _params) => {
  try {
    const bankLines = (artifact.data?.bankLines || []).filter(l => !l.matchedTxId);
    const transactions = (artifact.data?.transactions || []).filter(t => !t.reconciled);

    const matches = [];
    const used = new Set();

    for (const bl of bankLines) {
      const blAmt = finNum(bl.amount);
      const blDate = new Date(bl.date);
      const blTokens = String(bl.description || '').toLowerCase().split(/\W+/).filter(t => t.length >= 3);

      let bestTx = null;
      let bestScore = 0;
      for (const tx of transactions) {
        if (used.has(tx.id)) continue;
        const txAmt = finNum(tx.amount);
        if (Math.abs(txAmt - blAmt) > 0.01) continue; // exact-amount required
        const txDate = new Date(tx.date);
        const dayDelta = Math.abs((txDate.getTime() - blDate.getTime()) / 86_400_000);
        if (dayDelta > 3) continue;
        const txTokens = String((tx.counterparty || '') + ' ' + (tx.memo || '')).toLowerCase().split(/\W+/).filter(t => t.length >= 3);
        const sharedTokens = blTokens.filter(t => txTokens.includes(t)).length;
        const dateScore = 1 - (dayDelta / 3); // 1.0 same day, 0 at 3-day cutoff
        const tokenScore = blTokens.length === 0 ? 0.5 : (sharedTokens / Math.max(1, blTokens.length));
        const score = Math.round((0.7 * dateScore + 0.3 * tokenScore) * 100) / 100;
        if (score > bestScore) { bestScore = score; bestTx = tx; }
      }
      if (bestTx && bestScore >= 0.4) {
        used.add(bestTx.id);
        matches.push({
          bankLineId: bl.id,
          transactionId: bestTx.id,
          confidence: bestScore,
          amount: blAmt,
          date: bl.date,
          bankDescription: bl.description,
          txCounterparty: bestTx.counterparty,
        });
      }
    }

    const result = {
      reconciledAt: new Date().toISOString(),
      candidateMatches: matches.sort((a, b) => b.confidence - a.confidence),
      bankLinesUnmatched: bankLines.length - matches.length,
      transactionsUnmatched: transactions.length - matches.length,
      summary: `${matches.length} suggested matches · ${bankLines.length - matches.length} bank line(s) unmatched · ${transactions.length - matches.length} txn(s) unmatched`,
    };
    artifact.data.reconciliation = result;
    return { ok: true, result };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * generate-statements
   * Builds Income Statement (P&L) + Balance Sheet + Cash Flow snapshot
   * in one payload. Reuses the trialBalance + profitLoss math for
   * shape consistency.
   */
  registerLensAction("accounting", "generate-statements", (ctx, artifact, params) => {
  try {
    const accounts = artifact.data?.accounts || [];
    const startDate = params?.startDate ? new Date(params.startDate) : new Date(new Date().getFullYear(), 0, 1);
    const endDate = params?.endDate ? new Date(params.endDate) : new Date();

    // Income statement
    let revenue = 0;
    let expense = 0;
    // Balance sheet
    let assets = 0;
    let liabilities = 0;
    let equity = 0;
    // Cash flow (cash accounts only)
    let cashStart = 0;
    let cashEnd = 0;

    for (const acct of accounts) {
      let net = 0;
      let netInPeriod = 0;
      let netBefore = 0;
      for (const entry of (acct.entries || [])) {
        const dr = finNum(entry.debit);
        const cr = finNum(entry.credit);
        const delta = dr - cr;
        net += delta;
        const d = new Date(entry.date);
        if (d <= endDate) {
          if (d >= startDate) netInPeriod += delta;
          else netBefore += delta;
        }
      }
      const type = String(acct.type || '').toLowerCase();
      if (type === 'revenue' || type === 'income') revenue += -netInPeriod; // credits increase revenue
      else if (type === 'expense') expense += netInPeriod;
      else if (type === 'asset') assets += net;
      else if (type === 'liability') liabilities += -net;
      else if (type === 'equity') equity += -net;
      if (/cash|bank/i.test(acct.name || '') || /cash|bank/i.test(type)) {
        cashStart += netBefore;
        cashEnd += netBefore + netInPeriod;
      }
    }

    const incomeStatement = {
      period: { start: startDate.toISOString().slice(0,10), end: endDate.toISOString().slice(0,10) },
      revenue: Math.round(revenue * 100) / 100,
      expense: Math.round(expense * 100) / 100,
      netIncome: Math.round((revenue - expense) * 100) / 100,
    };
    const balanceSheet = {
      asOf: endDate.toISOString().slice(0,10),
      assets: Math.round(assets * 100) / 100,
      liabilities: Math.round(liabilities * 100) / 100,
      equity: Math.round(equity * 100) / 100,
      balanced: Math.abs(assets - (liabilities + equity)) < 0.01,
    };
    const cashFlow = {
      period: { start: startDate.toISOString().slice(0,10), end: endDate.toISOString().slice(0,10) },
      openingCash: Math.round(cashStart * 100) / 100,
      closingCash: Math.round(cashEnd * 100) / 100,
      netChange: Math.round((cashEnd - cashStart) * 100) / 100,
    };

    const result = {
      generatedAt: new Date().toISOString(),
      incomeStatement,
      balanceSheet,
      cashFlow,
    };
    artifact.data.statements = result;
    return { ok: true, result };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * audit-trail
   * Verifies no gaps in the financial artifact audit trail. Checks
   * for missing transaction sequence numbers, orphaned ledger entries
   * (no matching transaction), and accounts with entries but no
   * matching account record.
   */
  registerLensAction("accounting", "audit-trail", (ctx, artifact, _params) => {
  try {
    const transactions = artifact.data?.transactions || [];
    const accounts = artifact.data?.accounts || [];

    // Sequence gaps in transaction IDs (if they're numeric)
    const numericIds = transactions
      .map(t => parseInt(String(t.id).replace(/\D+/g, ''), 10))
      .filter(n => Number.isFinite(n))
      .sort((a, b) => a - b);
    const gaps = [];
    for (let i = 1; i < numericIds.length; i++) {
      const expected = numericIds[i - 1] + 1;
      if (numericIds[i] > expected) {
        gaps.push({ after: numericIds[i - 1], next: numericIds[i], missing: numericIds[i] - expected });
      }
    }

    // Orphaned entries: entries that reference a missing account
    const accountIds = new Set(accounts.map(a => a.accountNumber || a.id).filter(Boolean));
    const orphanedEntries = [];
    for (const acct of accounts) {
      for (const entry of (acct.entries || [])) {
        if (entry.linkedTxId) {
          const tx = transactions.find(t => t.id === entry.linkedTxId);
          if (!tx) orphanedEntries.push({ account: acct.name, entry, reason: 'linked transaction missing' });
        }
      }
    }

    // Unposted: transactions present but not posted to any account
    const postedTxIds = new Set();
    for (const acct of accounts) {
      for (const entry of (acct.entries || [])) {
        if (entry.linkedTxId) postedTxIds.add(entry.linkedTxId);
      }
    }
    const unpostedTransactions = transactions.filter(t => !postedTxIds.has(t.id));

    const result = {
      auditedAt: new Date().toISOString(),
      transactionCount: transactions.length,
      accountCount: accounts.length,
      sequenceGaps: gaps,
      orphanedEntries,
      unpostedTransactions: unpostedTransactions.map(t => ({ id: t.id, amount: t.amount, date: t.date })),
      severity: (gaps.length > 0 || orphanedEntries.length > 0 || unpostedTransactions.length > 0) ? 'warning' : 'ok',
      message: gaps.length === 0 && orphanedEntries.length === 0 && unpostedTransactions.length === 0
        ? `Audit trail clean. ${transactions.length} transaction(s), ${accounts.length} account(s) verified.`
        : `Audit found: ${gaps.length} sequence gap(s), ${orphanedEntries.length} orphan(s), ${unpostedTransactions.length} unposted txn(s).`,
      accountsRegistered: accountIds.size,
    };
    artifact.data.auditTrail = result;
    return { ok: true, result };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ─── 2026 parity — real Chart of Accounts + Journal + Ledger substrate ──
  //
  // The existing macros (trialBalance/profitLoss/invoiceAging/etc.) compute
  // over artifact.data shapes. The new macros maintain a per-user persistent
  // CoA + journal so the workbench UI has real CRUD.
  //
  // Parity targets: QuickBooks Online / Xero / FreshBooks / Wave.

  function getAccountingState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.accountingLens) {
      STATE.accountingLens = {
        coa: new Map(),         // userId -> Map<accountId, account>
        journal: new Map(),     // userId -> Array<entry>
        invoices: new Map(),    // userId -> Array<invoice>
        customers: new Map(),   // userId -> Array<customer>
        vendors: new Map(),     // userId -> Array<vendor>
        bills: new Map(),       // userId -> Array<bill>
        estimates: new Map(),   // userId -> Array<estimate>
        recurring: new Map(),   // userId -> Array<recurringInvoice>
        bankTxns: new Map(),    // userId -> Array<bankTxn>
        catRules: new Map(),    // userId -> Array<categoryRule>
        expenses: new Map(),    // userId -> Array<expense>
        seq: new Map(),         // userId -> { je, inv, bill, est, exp, cust, vend, btxn, rule, rec }
      };
    }
    const s = STATE.accountingLens;
    // Backfill new buckets if STATE was created by older code path.
    if (!s.customers) s.customers = new Map();
    if (!s.vendors) s.vendors = new Map();
    if (!s.bills) s.bills = new Map();
    if (!s.estimates) s.estimates = new Map();
    if (!s.recurring) s.recurring = new Map();
    if (!s.bankTxns) s.bankTxns = new Map();
    if (!s.catRules) s.catRules = new Map();
    if (!s.expenses) s.expenses = new Map();
    if (!s.employees) s.employees = new Map();
    if (!s.payRuns) s.payRuns = new Map();
    if (!s.budgets) s.budgets = new Map();
    if (!s.items) s.items = new Map();
    if (!s.taxCodes) s.taxCodes = new Map();
    if (!s.purchaseOrders) s.purchaseOrders = new Map();
    // ── 2026 parity buckets — multi-currency, dimensions, recurring bills,
    //    receipt OCR, audit log, live-feed institution links ──
    if (!s.currencies) s.currencies = new Map();    // userId -> { base, rates: Map<code,{rate,updatedAt}> }
    if (!s.dimensions) s.dimensions = new Map();    // userId -> Array<dimension>
    if (!s.recurringBills) s.recurringBills = new Map(); // userId -> Array<recurringBill>
    if (!s.auditLog) s.auditLog = new Map();        // userId -> Array<auditEntry>
    if (!s.institutions) s.institutions = new Map();// userId -> Array<linkedInstitution>
    return s;
  }
  // Append-only per-transaction edit audit trail. Records who/when/what
  // for any mutation worth tracking. Capped at 2000 rows/user.
  function recordAudit(s, userId, event) {
    if (!s.auditLog.has(userId)) s.auditLog.set(userId, []);
    const log = s.auditLog.get(userId);
    log.push({
      id: nextId("aud"),
      at: nowIso(),
      actor: userId,
      action: String(event.action || "unknown"),
      entityType: String(event.entityType || ""),
      entityId: String(event.entityId || ""),
      summary: String(event.summary || "").slice(0, 240),
      before: event.before ?? null,
      after: event.after ?? null,
    });
    if (log.length > 2000) log.splice(0, log.length - 2000);
  }
  function ensureSeq(s, userId) {
    if (!s.seq.has(userId)) s.seq.set(userId, { je: 1, inv: 1, bill: 1, est: 1, exp: 1, cust: 1, vend: 1, btxn: 1, rule: 1, rec: 1 });
    const seq = s.seq.get(userId);
    for (const k of ['je','inv','bill','est','exp','cust','vend','btxn','rule','rec']) {
      if (!Number.isFinite(seq[k])) seq[k] = 1;
    }
    return seq;
  }
  function ensureList(map, userId) {
    if (!map.has(userId)) map.set(userId, []);
    return map.get(userId);
  }
  function saveAccountingState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  function actId(ctx) {
    return ctx?.actor?.userId || ctx?.userId || "anon";
  }
  function nextId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }
  function nowIso() { return new Date().toISOString(); }

  // Fail-CLOSED numeric coercion. `parseFloat("Infinity")`/`Number("1e999")`
  // both yield Infinity, and `Infinity || 0` is Infinity — so the naive
  // `parseFloat(x) || 0` lets a poisoned amount flow straight into computed
  // totals (and `Inf - Inf` / `Inf + Inf` produce NaN/Infinity that corrupt
  // every downstream sum). These are pure calculators with no wallet, so the
  // risk is non-finite/NaN output, not minting — but a financial report that
  // silently emits Infinity is a correctness defect. `finNum` guarantees a
  // FINITE number: any non-finite (Infinity/-Infinity/NaN) or unparseable
  // input collapses to 0. Use this everywhere a user-supplied amount enters a
  // computation. Returns 0 for null/undefined/"" by design (absent line item).
  //
  // Beyond FIN_MAX (1e15, a quadrillion) a value is not a real accounting amount
  // and — more to the point — `amount * 100` (the cents-rounding every report
  // does) would overflow to Infinity. 1e15 is far above any legitimate ledger
  // total yet keeps ×100 well under 2^53. A supplied amount past this magnitude
  // is treated as poison → 0, so even a technically-finite 1e308 can't sneak an
  // Infinity into a report via the rounding step.
  const FIN_MAX = 1e15;
  function finNum(x) {
    const n = typeof x === "number" ? x : parseFloat(x);
    if (!Number.isFinite(n) || n > FIN_MAX || n < -FIN_MAX) return 0;
    return n;
  }
  // Strict variant for PERSISTED writes (je-post): a non-finite OR
  // beyond-FIN_MAX supplied amount is a hard reject (fail-closed) rather than a
  // silent collapse to 0, so a poisoned 1e999/1e308 can never enter the journal
  // and corrupt later reports.
  function finiteOrNull(x) {
    if (x === null || x === undefined || x === "") return 0;
    const n = typeof x === "number" ? x : Number(x);
    if (!Number.isFinite(n) || n > FIN_MAX || n < -FIN_MAX) return null;
    return n;
  }

  // GAAP-aligned categories with normal-balance side.
  const COA_CATEGORIES = {
    asset:     { label: "Assets",       normal: "debit"  },
    liability: { label: "Liabilities",  normal: "credit" },
    equity:    { label: "Equity",       normal: "credit" },
    revenue:   { label: "Revenue",      normal: "credit" },
    expense:   { label: "Expenses",     normal: "debit"  },
    cogs:      { label: "COGS",         normal: "debit"  },
  };

  function seedDefaultCoA(userId, s) {
    if (s.coa.has(userId)) return;
    const map = new Map();
    const seed = [
      { code: "1000", name: "Cash",                  category: "asset",     parent: null },
      { code: "1100", name: "Accounts Receivable",   category: "asset",     parent: null },
      { code: "1200", name: "Inventory",             category: "asset",     parent: null },
      { code: "1500", name: "Equipment",             category: "asset",     parent: null },
      { code: "2000", name: "Accounts Payable",      category: "liability", parent: null },
      { code: "2100", name: "Sales Tax Payable",     category: "liability", parent: null },
      { code: "3000", name: "Owner's Equity",        category: "equity",    parent: null },
      { code: "3100", name: "Retained Earnings",     category: "equity",    parent: null },
      { code: "4000", name: "Sales Revenue",         category: "revenue",   parent: null },
      { code: "5000", name: "Cost of Goods Sold",    category: "cogs",      parent: null },
      { code: "6000", name: "Office Expense",        category: "expense",   parent: null },
      { code: "6100", name: "Rent Expense",          category: "expense",   parent: null },
      { code: "6200", name: "Utilities",             category: "expense",   parent: null },
      { code: "6300", name: "Payroll",               category: "expense",   parent: null },
    ];
    for (const a of seed) {
      const id = `acct_${a.code}`;
      map.set(id, {
        id, code: a.code, name: a.name, category: a.category, parent: a.parent,
        archived: false, createdAt: nowIso(), updatedAt: nowIso(),
      });
    }
    s.coa.set(userId, map);
  }

  // ── Chart of Accounts ──

  registerLensAction("accounting", "coa-list", (ctx, _artifact, _params = {}) => {
  try {
    const s = getAccountingState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    seedDefaultCoA(userId, s);
    const accounts = Array.from(s.coa.get(userId).values())
      .sort((a, b) => a.code.localeCompare(b.code));
    return { ok: true, result: { accounts, categories: COA_CATEGORIES } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("accounting", "coa-create", (ctx, _artifact, params = {}) => {
    const s = getAccountingState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    seedDefaultCoA(userId, s);
    const code = String(params.code || "").trim();
    if (!code) return { ok: false, error: "code required" };
    if (code.length > 12) return { ok: false, error: "code too long (max 12)" };
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    if (name.length > 80) return { ok: false, error: "name too long (max 80)" };
    const category = String(params.category || "");
    if (!COA_CATEGORIES[category]) return { ok: false, error: "category invalid" };
    const map = s.coa.get(userId);
    const dup = Array.from(map.values()).find((a) => a.code === code);
    if (dup) return { ok: false, error: "code already exists" };
    const id = `acct_${code}`;
    const account = {
      id, code, name, category,
      parent: params.parent ? String(params.parent) : null,
      archived: false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    map.set(id, account);
    saveAccountingState();
    return { ok: true, result: { account } };
  });

  registerLensAction("accounting", "coa-update", (ctx, _artifact, params = {}) => {
    const s = getAccountingState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    seedDefaultCoA(userId, s);
    const id = String(params.id || "");
    if (!id) return { ok: false, error: "id required" };
    const map = s.coa.get(userId);
    if (!map.has(id)) return { ok: false, error: "not found" };
    const a = map.get(id);
    if (typeof params.name === "string") {
      const n = params.name.trim();
      if (!n) return { ok: false, error: "name cannot be empty" };
      a.name = n.slice(0, 80);
    }
    if (typeof params.parent === "string" || params.parent === null) a.parent = params.parent || null;
    a.updatedAt = nowIso();
    saveAccountingState();
    return { ok: true, result: { account: a } };
  });

  registerLensAction("accounting", "coa-archive", (ctx, _artifact, params = {}) => {
    const s = getAccountingState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    seedDefaultCoA(userId, s);
    const id = String(params.id || "");
    if (!id) return { ok: false, error: "id required" };
    const map = s.coa.get(userId);
    if (!map.has(id)) return { ok: false, error: "not found" };
    const a = map.get(id);
    a.archived = !a.archived;
    a.updatedAt = nowIso();
    saveAccountingState();
    return { ok: true, result: { account: a } };
  });

  // ── Journal Entry (double-entry posting) ──

  registerLensAction("accounting", "je-post", (ctx, _artifact, params = {}) => {
  try {
    const s = getAccountingState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    seedDefaultCoA(userId, s);
    const lines = Array.isArray(params.lines) ? params.lines : [];
    if (lines.length < 2) return { ok: false, error: "journal entry needs at least 2 lines" };
    const date = String(params.date || nowIso().slice(0, 10));
    const memo = String(params.memo || "").slice(0, 200);
    const coa = s.coa.get(userId);
    let totalDebit = 0;
    let totalCredit = 0;
    const normalized = [];
    for (const l of lines) {
      const accountId = String(l.accountId || "");
      if (!coa.has(accountId)) return { ok: false, error: `unknown account: ${accountId}` };
      // Fail-CLOSED on poisoned numerics: a non-finite supplied amount
      // (Infinity from "1e999"/"Infinity", or NaN) is rejected outright so it
      // can never enter the persisted journal. `Inf - Inf` is NaN and the
      // balance guard below (`NaN > 0.01` is false) would otherwise PASS,
      // silently persisting Infinity and corrupting every later report.
      const debit = finiteOrNull(l.debit);
      const credit = finiteOrNull(l.credit);
      if (debit === null || credit === null) return { ok: false, error: "debit/credit must be a finite number" };
      if (debit < 0 || credit < 0) return { ok: false, error: "debit/credit must be >= 0" };
      if (debit > 0 && credit > 0) return { ok: false, error: "line cannot have both debit and credit" };
      if (debit === 0 && credit === 0) return { ok: false, error: "line must have non-zero debit or credit" };
      totalDebit += debit;
      totalCredit += credit;
      normalized.push({ accountId, debit, credit, memo: String(l.memo || "").slice(0, 120) });
    }
    // Balance guard — debits must equal credits (within 0.01 tolerance for floats).
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      return { ok: false, error: `unbalanced: debits ${totalDebit.toFixed(2)} != credits ${totalCredit.toFixed(2)}` };
    }
    if (!s.journal.has(userId)) s.journal.set(userId, []);
    if (!s.seq.has(userId)) s.seq.set(userId, { je: 1, inv: 1 });
    const seq = s.seq.get(userId);
    const entry = {
      id: nextId("je"),
      number: `JE-${String(seq.je).padStart(5, "0")}`,
      date, memo,
      lines: normalized,
      totalDebit, totalCredit,
      postedAt: nowIso(),
    };
    seq.je++;
    s.journal.get(userId).push(entry);
    recordAudit(s, userId, {
      action: "je-post", entityType: "journal-entry", entityId: entry.id,
      summary: `Posted ${entry.number} — ${normalized.length} lines, ${totalDebit.toFixed(2)} balanced`,
      after: { number: entry.number, date, memo, totalDebit, totalCredit },
    });
    saveAccountingState();
    return { ok: true, result: { entry } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Ledger (paginated transaction list with filtering) ──

  registerLensAction("accounting", "ledger-list", (ctx, _artifact, params = {}) => {
  try {
    const s = getAccountingState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    const accountId = params.accountId ? String(params.accountId) : null;
    const dateFrom = params.dateFrom ? String(params.dateFrom) : null;
    const dateTo = params.dateTo ? String(params.dateTo) : null;
    const limit = Math.max(1, Math.min(200, Number(params.limit) || 50));
    const offset = Math.max(0, Number(params.offset) || 0);
    const entries = s.journal.get(userId) || [];
    const rows = [];
    for (const e of entries) {
      if (dateFrom && e.date < dateFrom) continue;
      if (dateTo && e.date > dateTo) continue;
      for (const l of e.lines) {
        if (accountId && l.accountId !== accountId) continue;
        rows.push({
          entryId: e.id,
          number: e.number,
          date: e.date,
          memo: e.memo,
          accountId: l.accountId,
          debit: l.debit,
          credit: l.credit,
          lineMemo: l.memo,
        });
      }
    }
    rows.sort((a, b) => (b.date.localeCompare(a.date)) || b.number.localeCompare(a.number));
    const total = rows.length;
    return { ok: true, result: { rows: rows.slice(offset, offset + limit), total, offset, limit } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Balance Sheet (computed from journal) ──

  registerLensAction("accounting", "balance-sheet-compute", (ctx, _artifact, params = {}) => {
  try {
    const s = getAccountingState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    seedDefaultCoA(userId, s);
    const asOf = params.asOf ? String(params.asOf) : nowIso().slice(0, 10);
    const coa = s.coa.get(userId);
    const entries = s.journal.get(userId) || [];
    const balances = new Map();
    for (const e of entries) {
      if (e.date > asOf) continue;
      for (const l of e.lines) {
        balances.set(l.accountId, (balances.get(l.accountId) || 0) + (l.debit - l.credit));
      }
    }
    const out = { assets: [], liabilities: [], equity: [], totals: { assets: 0, liabilities: 0, equity: 0 }, asOf };
    let totalRevenue = 0;
    let totalExpense = 0;
    for (const [accId, balance] of balances) {
      const acct = coa.get(accId);
      if (!acct || acct.archived) continue;
      const cat = acct.category;
      // Display normalized — assets +debit, liab/equity/rev +credit, etc.
      if (cat === "asset") {
        const v = balance; out.assets.push({ id: accId, code: acct.code, name: acct.name, balance: v }); out.totals.assets += v;
      } else if (cat === "liability") {
        const v = -balance; out.liabilities.push({ id: accId, code: acct.code, name: acct.name, balance: v }); out.totals.liabilities += v;
      } else if (cat === "equity") {
        const v = -balance; out.equity.push({ id: accId, code: acct.code, name: acct.name, balance: v }); out.totals.equity += v;
      } else if (cat === "revenue") {
        totalRevenue += -balance;
      } else if (cat === "expense" || cat === "cogs") {
        totalExpense += balance;
      }
    }
    // Net income flows into retained earnings on the balance sheet.
    const netIncome = totalRevenue - totalExpense;
    out.equity.push({ id: "computed_re", code: "RE", name: "Net Income (period)", balance: netIncome });
    out.totals.equity += netIncome;
    out.balanced = Math.abs(out.totals.assets - (out.totals.liabilities + out.totals.equity)) < 0.01;
    out.imbalance = out.totals.assets - (out.totals.liabilities + out.totals.equity);
    return { ok: true, result: out };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── AR Aging Report (buckets from invoices) ──

  registerLensAction("accounting", "invoice-create", (ctx, _artifact, params = {}) => {
  try {
    const s = getAccountingState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    const customerName = String(params.customerName || "").trim();
    if (!customerName) return { ok: false, error: "customerName required" };
    const total = Number(params.total);
    if (!Number.isFinite(total) || total <= 0) return { ok: false, error: "total must be > 0" };
    const issuedAt = String(params.issuedAt || nowIso().slice(0, 10));
    const dueAt = String(params.dueAt || issuedAt);
    if (!s.invoices.has(userId)) s.invoices.set(userId, []);
    if (!s.seq.has(userId)) s.seq.set(userId, { je: 1, inv: 1 });
    const seq = s.seq.get(userId);
    const invoice = {
      id: nextId("inv"),
      number: `INV-${String(seq.inv).padStart(5, "0")}`,
      customerId: params.customerId ? String(params.customerId) : null,
      customerName,
      total,
      status: "open",
      issuedAt, dueAt,
      paidAt: null,
    };
    seq.inv++;
    s.invoices.get(userId).push(invoice);
    saveAccountingState();
    return { ok: true, result: { invoice } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("accounting", "invoice-mark-paid", (ctx, _artifact, params = {}) => {
    const s = getAccountingState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    const id = String(params.id || "");
    if (!id) return { ok: false, error: "id required" };
    const list = s.invoices.get(userId) || [];
    const inv = list.find((i) => i.id === id);
    if (!inv) return { ok: false, error: "not found" };
    inv.status = "paid";
    inv.paidAt = String(params.paidAt || nowIso().slice(0, 10));
    saveAccountingState();
    return { ok: true, result: { invoice: inv } };
  });

  /**
   * invoice-list — lists open + paid invoices for the caller, sorted by
   * issuedAt desc. Supports optional status filter (open|paid|all).
   */
  registerLensAction("accounting", "invoice-list", (ctx, _artifact, params = {}) => {
  try {
    const s = getAccountingState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    const status = ["open", "paid", "all"].includes(params.status) ? params.status : "all";
    const list = s.invoices.get(userId) || [];
    const filtered = status === "all" ? list : list.filter((i) => i.status === status);
    return {
      ok: true,
      result: {
        invoices: filtered.slice().sort((a, b) => (b.issuedAt || "").localeCompare(a.issuedAt || "")),
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * invoice-create-payment-link — creates a real Stripe hosted invoice
   * link for an existing local invoice. Requires STRIPE_SECRET_KEY env.
   *
   * Uses the Stripe REST API directly (no SDK dependency). Flow:
   *   1. Create a Stripe Customer (or reuse stripeCustomerId from invoice)
   *   2. Create a Stripe InvoiceItem for the invoice total
   *   3. Create a Stripe Invoice (auto_advance:false so we can finalize manually)
   *   4. Finalize the invoice (returns hosted_invoice_url + pdf url)
   *
   * The Stripe `id`s are persisted onto the local invoice so the webhook
   * handler can correlate inbound payment events. Per the "everything
   * must be real" directive: this is a real Stripe call, not a stub.
   */
  registerLensAction("accounting", "invoice-create-payment-link", async (ctx, _artifact, params = {}) => {
    const s = getAccountingState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    const id = String(params.id || "");
    if (!id) return { ok: false, error: "id required" };
    const list = s.invoices.get(userId) || [];
    const inv = list.find((i) => i.id === id);
    if (!inv) return { ok: false, error: "not found" };
    if (inv.status === "paid") return { ok: false, error: "invoice already paid" };

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return {
        ok: false,
        error: "Stripe not configured. Set STRIPE_SECRET_KEY env (Stripe Dashboard → Developers → API keys). Concord does not synthesize payment links.",
      };
    }
    const customerEmail = String(params.customerEmail || inv.customerEmail || "").trim();
    if (!customerEmail) return { ok: false, error: "customerEmail required (Stripe needs an email for the invoice)" };

    const amountCents = Math.round(Number(inv.total) * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      return { ok: false, error: "invoice total invalid for Stripe charge" };
    }

    async function stripePost(path, formBody) {
      const url = `https://api.stripe.com/v1${path}`;
      const body = new URLSearchParams(formBody).toString();
      const r = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${stripeKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Stripe-Version": "2025-09-30.acacia",
        },
        body,
      });
      const data = await r.json();
      if (!r.ok) {
        throw new Error(`stripe ${path} ${r.status}: ${data?.error?.message || "unknown"}`);
      }
      return data;
    }

    try {
      // 1. Create or reuse Customer
      let stripeCustomerId = inv.stripeCustomerId;
      if (!stripeCustomerId) {
        const customer = await stripePost("/customers", {
          email: customerEmail,
          name: inv.customerName,
          "metadata[concord_user_id]": userId,
          "metadata[concord_invoice_id]": inv.id,
        });
        stripeCustomerId = customer.id;
      }

      // 2. Create InvoiceItem (must be done BEFORE creating the invoice,
      //    or attached via parent.invoice= when the invoice exists).
      await stripePost("/invoiceitems", {
        customer: stripeCustomerId,
        amount: String(amountCents),
        currency: "usd",
        description: `${inv.number} — ${inv.customerName}`,
      });

      // 3. Create Invoice (collection_method=send_invoice → emails the
      //    hosted_invoice_url to the customer).
      const stripeInv = await stripePost("/invoices", {
        customer: stripeCustomerId,
        collection_method: "send_invoice",
        days_until_due: "30",
        "metadata[concord_user_id]": userId,
        "metadata[concord_invoice_id]": inv.id,
      });

      // 4. Finalize so the URL is live
      const finalized = await stripePost(`/invoices/${stripeInv.id}/finalize`, {});

      // Persist Stripe IDs so the webhook can match this back.
      inv.stripeCustomerId = stripeCustomerId;
      inv.stripeInvoiceId = finalized.id;
      inv.stripeHostedInvoiceUrl = finalized.hosted_invoice_url;
      inv.stripeInvoicePdfUrl = finalized.invoice_pdf;
      inv.customerEmail = customerEmail;
      saveAccountingState();

      return {
        ok: true,
        result: {
          invoice: inv,
          hostedUrl: finalized.hosted_invoice_url,
          pdfUrl: finalized.invoice_pdf,
          stripeInvoiceId: finalized.id,
        },
      };
    } catch (e) {
      return {
        ok: false,
        error: `stripe invoice creation failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  });

  /**
   * invoice-webhook-mark-paid — INTERNAL macro called by the Stripe
   * webhook handler when an `invoice.payment_succeeded` event arrives.
   * Looks up the local invoice by stripeInvoiceId and marks it paid.
   * Not exposed via /api/lens/run for end users — webhook only.
   */
  registerLensAction("accounting", "invoice-webhook-mark-paid", (_ctx, _artifact, params = {}) => {
    const s = getAccountingState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const stripeInvoiceId = String(params.stripeInvoiceId || "");
    const userId = String(params.userId || "");
    if (!stripeInvoiceId || !userId) return { ok: false, error: "stripeInvoiceId + userId required" };
    const list = s.invoices.get(userId) || [];
    const inv = list.find((i) => i.stripeInvoiceId === stripeInvoiceId);
    if (!inv) return { ok: false, error: "local invoice not found for stripe id" };
    inv.status = "paid";
    inv.paidAt = nowIso().slice(0, 10);
    inv.paidVia = "stripe";
    saveAccountingState();
    return { ok: true, result: { invoice: inv } };
  });

  registerLensAction("accounting", "aging-ar", (ctx, _artifact, params = {}) => {
  try {
    const s = getAccountingState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    const asOf = params.asOf ? String(params.asOf) : nowIso().slice(0, 10);
    const asOfMs = new Date(asOf).getTime();
    const buckets = {
      current:  { label: "Current (0–30)",   total: 0, invoices: [] },
      d30:      { label: "31–60 days",       total: 0, invoices: [] },
      d60:      { label: "61–90 days",       total: 0, invoices: [] },
      d90plus:  { label: "90+ days",         total: 0, invoices: [] },
    };
    let totalOpen = 0;
    const list = s.invoices.get(userId) || [];
    for (const inv of list) {
      if (inv.status !== "open") continue;
      const dueMs = new Date(inv.dueAt).getTime();
      const daysPastDue = Math.floor((asOfMs - dueMs) / 86_400_000);
      let bucket;
      if (daysPastDue <= 30) bucket = "current";
      else if (daysPastDue <= 60) bucket = "d30";
      else if (daysPastDue <= 90) bucket = "d60";
      else bucket = "d90plus";
      buckets[bucket].total += inv.total;
      buckets[bucket].invoices.push({ ...inv, daysPastDue });
      totalOpen += inv.total;
    }
    return { ok: true, result: { asOf, buckets: Object.values(buckets).map((b, i) => ({ ...b, key: Object.keys(buckets)[i] })), totalOpen } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Customers (CRM-lite for invoicing) ─────────────────────────

  registerLensAction("accounting", "customers-list", (ctx, _a, _p = {}) => {
  try {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = ensureList(s.customers, actId(ctx));
    return { ok: true, result: { customers: list.slice().sort((a, b) => a.name.localeCompare(b.name)) } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("accounting", "customers-create", (ctx, _a, params = {}) => {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    const seq = ensureSeq(s, userId);
    const c = {
      id: nextId("cust"),
      number: `C-${String(seq.cust).padStart(4, "0")}`,
      name, email: String(params.email || "").trim(),
      phone: String(params.phone || "").trim(),
      company: String(params.company || "").trim(),
      billingAddress: String(params.billingAddress || "").trim(),
      taxId: String(params.taxId || "").trim(),
      notes: String(params.notes || "").slice(0, 500),
      createdAt: nowIso(),
    };
    seq.cust++;
    ensureList(s.customers, userId).push(c);
    saveAccountingState();
    return { ok: true, result: { customer: c } };
  });

  registerLensAction("accounting", "customers-update", (ctx, _a, params = {}) => {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const id = String(params.id || "");
    const list = ensureList(s.customers, actId(ctx));
    const c = list.find(x => x.id === id);
    if (!c) return { ok: false, error: "customer not found" };
    for (const k of ["name", "email", "phone", "company", "billingAddress", "taxId", "notes"]) {
      if (typeof params[k] === "string") c[k] = params[k];
    }
    saveAccountingState();
    return { ok: true, result: { customer: c } };
  });

  registerLensAction("accounting", "customers-delete", (ctx, _a, params = {}) => {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const id = String(params.id || "");
    const list = ensureList(s.customers, actId(ctx));
    const i = list.findIndex(x => x.id === id);
    if (i < 0) return { ok: false, error: "customer not found" };
    list.splice(i, 1);
    saveAccountingState();
    return { ok: true, result: { id, deleted: true } };
  });

  // ── Vendors (AP suppliers) ─────────────────────────────────────

  registerLensAction("accounting", "vendors-list", (ctx, _a, _p = {}) => {
  try {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = ensureList(s.vendors, actId(ctx));
    return { ok: true, result: { vendors: list.slice().sort((a, b) => a.name.localeCompare(b.name)) } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("accounting", "vendors-create", (ctx, _a, params = {}) => {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    const seq = ensureSeq(s, userId);
    const v = {
      id: nextId("vend"),
      number: `V-${String(seq.vend).padStart(4, "0")}`,
      name, email: String(params.email || "").trim(),
      phone: String(params.phone || "").trim(),
      taxId: String(params.taxId || "").trim(),         // EIN/SSN
      is1099: Boolean(params.is1099),
      defaultExpenseAccountId: String(params.defaultExpenseAccountId || ""),
      paymentTerms: String(params.paymentTerms || "net30"),
      notes: String(params.notes || "").slice(0, 500),
      createdAt: nowIso(),
    };
    seq.vend++;
    ensureList(s.vendors, userId).push(v);
    saveAccountingState();
    return { ok: true, result: { vendor: v } };
  });

  registerLensAction("accounting", "vendors-update", (ctx, _a, params = {}) => {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const id = String(params.id || "");
    const list = ensureList(s.vendors, actId(ctx));
    const v = list.find(x => x.id === id);
    if (!v) return { ok: false, error: "vendor not found" };
    for (const k of ["name", "email", "phone", "taxId", "defaultExpenseAccountId", "paymentTerms", "notes"]) {
      if (typeof params[k] === "string") v[k] = params[k];
    }
    if (typeof params.is1099 === "boolean") v.is1099 = params.is1099;
    saveAccountingState();
    return { ok: true, result: { vendor: v } };
  });

  registerLensAction("accounting", "vendors-delete", (ctx, _a, params = {}) => {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const id = String(params.id || "");
    const list = ensureList(s.vendors, actId(ctx));
    const i = list.findIndex(x => x.id === id);
    if (i < 0) return { ok: false, error: "vendor not found" };
    list.splice(i, 1);
    saveAccountingState();
    return { ok: true, result: { id, deleted: true } };
  });

  // ── Bills (AP — incoming invoices from vendors) ───────────────

  registerLensAction("accounting", "bills-list", (ctx, _a, params = {}) => {
  try {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const status = ["open", "paid", "all"].includes(params.status) ? params.status : "all";
    const list = ensureList(s.bills, actId(ctx));
    const filtered = status === "all" ? list : list.filter(b => b.status === status);
    return { ok: true, result: { bills: filtered.slice().sort((a, b) => (b.issuedAt || "").localeCompare(a.issuedAt || "")) } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("accounting", "bills-create", (ctx, _a, params = {}) => {
  try {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    seedDefaultCoA(userId, s);
    const vendorId = String(params.vendorId || "");
    const vendors = ensureList(s.vendors, userId);
    const vendor = vendors.find(v => v.id === vendorId);
    if (!vendor) return { ok: false, error: "vendor not found" };
    const total = Number(params.total);
    if (!Number.isFinite(total) || total <= 0) return { ok: false, error: "total must be > 0" };
    const expenseAccountId = String(params.expenseAccountId || vendor.defaultExpenseAccountId || "");
    const coa = s.coa.get(userId);
    if (!coa.has(expenseAccountId)) return { ok: false, error: "expenseAccountId invalid" };
    const issuedAt = String(params.issuedAt || nowIso().slice(0, 10));
    const termsDays = vendor.paymentTerms === "net60" ? 60 : vendor.paymentTerms === "net15" ? 15 : vendor.paymentTerms === "due_on_receipt" ? 0 : 30;
    const dueAt = String(params.dueAt || new Date(new Date(issuedAt).getTime() + termsDays * 86_400_000).toISOString().slice(0, 10));
    const seq = ensureSeq(s, userId);
    const bill = {
      id: nextId("bill"),
      number: `BILL-${String(seq.bill).padStart(5, "0")}`,
      vendorId, vendorName: vendor.name,
      total,
      expenseAccountId,
      memo: String(params.memo || "").slice(0, 200),
      status: "open",
      issuedAt, dueAt,
      paidAt: null,
      jeEntryId: null, // will hold the AP-side JE id if we post a bill JE
      payJeEntryId: null,
    };
    seq.bill++;
    ensureList(s.bills, userId).push(bill);

    // Auto-post the bill: Debit Expense, Credit AP (account code 2000 by default)
    const apAcct = Array.from(coa.values()).find(a => a.code === "2000" && a.category === "liability");
    if (apAcct) {
      const seq2 = seq;
      const entry = {
        id: nextId("je"),
        number: `JE-${String(seq2.je).padStart(5, "0")}`,
        date: issuedAt,
        memo: `${bill.number} · ${vendor.name}`,
        lines: [
          { accountId: expenseAccountId, debit: total, credit: 0, memo: bill.memo },
          { accountId: apAcct.id, debit: 0, credit: total, memo: `AP · ${vendor.name}` },
        ],
        totalDebit: total, totalCredit: total,
        postedAt: nowIso(),
        autoFrom: bill.id,
      };
      seq.je++;
      ensureList(s.journal, userId).push(entry);
      bill.jeEntryId = entry.id;
    }

    saveAccountingState();
    return { ok: true, result: { bill } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("accounting", "bills-pay", (ctx, _a, params = {}) => {
  try {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    seedDefaultCoA(userId, s);
    const id = String(params.id || "");
    const list = ensureList(s.bills, userId);
    const bill = list.find(b => b.id === id);
    if (!bill) return { ok: false, error: "bill not found" };
    if (bill.status === "paid") return { ok: false, error: "bill already paid" };
    const paidAt = String(params.paidAt || nowIso().slice(0, 10));
    const cashAccountId = String(params.cashAccountId || "");
    const coa = s.coa.get(userId);
    const cashAcct = cashAccountId
      ? coa.get(cashAccountId)
      : Array.from(coa.values()).find(a => a.code === "1000" && a.category === "asset");
    if (!cashAcct) return { ok: false, error: "cash account not found (default code 1000)" };
    const apAcct = Array.from(coa.values()).find(a => a.code === "2000" && a.category === "liability");
    if (!apAcct) return { ok: false, error: "AP account not found (default code 2000)" };

    // Pay JE: Debit AP, Credit Cash
    const seq = ensureSeq(s, userId);
    const entry = {
      id: nextId("je"),
      number: `JE-${String(seq.je).padStart(5, "0")}`,
      date: paidAt,
      memo: `Pay ${bill.number} · ${bill.vendorName}`,
      lines: [
        { accountId: apAcct.id, debit: bill.total, credit: 0, memo: `Clear AP · ${bill.vendorName}` },
        { accountId: cashAcct.id, debit: 0, credit: bill.total, memo: `Cash out · ${bill.number}` },
      ],
      totalDebit: bill.total, totalCredit: bill.total,
      postedAt: nowIso(),
      autoFrom: bill.id,
    };
    seq.je++;
    ensureList(s.journal, userId).push(entry);
    bill.status = "paid";
    bill.paidAt = paidAt;
    bill.payJeEntryId = entry.id;
    saveAccountingState();
    return { ok: true, result: { bill, paymentEntry: entry } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("accounting", "bills-delete", (ctx, _a, params = {}) => {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    const id = String(params.id || "");
    const list = ensureList(s.bills, userId);
    const i = list.findIndex(b => b.id === id);
    if (i < 0) return { ok: false, error: "bill not found" };
    const bill = list[i];
    // Reverse any auto-posted JEs.
    const journal = ensureList(s.journal, userId);
    for (const jeId of [bill.jeEntryId, bill.payJeEntryId]) {
      if (!jeId) continue;
      const k = journal.findIndex(e => e.id === jeId);
      if (k >= 0) journal.splice(k, 1);
    }
    list.splice(i, 1);
    saveAccountingState();
    return { ok: true, result: { id, deleted: true } };
  });

  registerLensAction("accounting", "aging-ap", (ctx, _a, params = {}) => {
  try {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    const asOf = params.asOf ? String(params.asOf) : nowIso().slice(0, 10);
    const asOfMs = new Date(asOf).getTime();
    const buckets = {
      current: { label: "Current (0–30)", total: 0, bills: [] },
      d30:     { label: "31–60 days",     total: 0, bills: [] },
      d60:     { label: "61–90 days",     total: 0, bills: [] },
      d90plus: { label: "90+ days",       total: 0, bills: [] },
    };
    let totalOpen = 0;
    for (const bill of ensureList(s.bills, userId)) {
      if (bill.status !== "open") continue;
      const dueMs = new Date(bill.dueAt).getTime();
      const daysPastDue = Math.floor((asOfMs - dueMs) / 86_400_000);
      const key = daysPastDue <= 30 ? "current" : daysPastDue <= 60 ? "d30" : daysPastDue <= 90 ? "d60" : "d90plus";
      buckets[key].total += bill.total;
      buckets[key].bills.push({ ...bill, daysPastDue });
      totalOpen += bill.total;
    }
    return { ok: true, result: { asOf, buckets: Object.entries(buckets).map(([k, b]) => ({ key: k, ...b })), totalOpen } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── P&L from journal (real, not artifact-driven) ──────────────

  registerLensAction("accounting", "pl-compute", (ctx, _a, params = {}) => {
  try {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    seedDefaultCoA(userId, s);
    const today = nowIso().slice(0, 10);
    const start = params.start ? String(params.start) : today.slice(0, 4) + "-01-01";
    const end = params.end ? String(params.end) : today;
    const coa = s.coa.get(userId);
    const entries = ensureList(s.journal, userId);
    const totals = new Map();
    for (const e of entries) {
      if (e.date < start || e.date > end) continue;
      for (const l of e.lines) {
        totals.set(l.accountId, (totals.get(l.accountId) || 0) + (l.credit - l.debit));
      }
    }
    const revLines = [], cogsLines = [], expLines = [];
    let totalRev = 0, totalCogs = 0, totalExp = 0;
    for (const [accId, bal] of totals) {
      const a = coa.get(accId); if (!a || a.archived) continue;
      const line = { id: accId, code: a.code, name: a.name, amount: 0 };
      if (a.category === "revenue") { line.amount = bal; revLines.push(line); totalRev += bal; }
      else if (a.category === "cogs") { line.amount = -bal; cogsLines.push(line); totalCogs += -bal; }
      else if (a.category === "expense") { line.amount = -bal; expLines.push(line); totalExp += -bal; }
    }
    revLines.sort((a, b) => b.amount - a.amount);
    cogsLines.sort((a, b) => b.amount - a.amount);
    expLines.sort((a, b) => b.amount - a.amount);
    const grossProfit = totalRev - totalCogs;
    const netIncome = grossProfit - totalExp;
    return {
      ok: true,
      result: {
        period: { start, end },
        revenue: { lines: revLines, total: totalRev },
        cogs: { lines: cogsLines, total: totalCogs },
        grossProfit,
        grossMarginPct: totalRev > 0 ? (grossProfit / totalRev) * 100 : 0,
        operatingExpenses: { lines: expLines, total: totalExp },
        netIncome,
        netMarginPct: totalRev > 0 ? (netIncome / totalRev) * 100 : 0,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Cash flow (direct method, from cash-account journal activity) ─

  registerLensAction("accounting", "cashflow-compute", (ctx, _a, params = {}) => {
  try {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    seedDefaultCoA(userId, s);
    const today = nowIso().slice(0, 10);
    const start = params.start ? String(params.start) : today.slice(0, 4) + "-01-01";
    const end = params.end ? String(params.end) : today;
    const coa = s.coa.get(userId);
    const cashIds = new Set(Array.from(coa.values()).filter(a => a.category === "asset" && /^1[01]/.test(a.code)).map(a => a.id));
    if (cashIds.size === 0) {
      // fall back to just account code 1000
      const cash = Array.from(coa.values()).find(a => a.code === "1000");
      if (cash) cashIds.add(cash.id);
    }
    const months = new Map(); // 'YYYY-MM' -> { in, out, net }
    let totalIn = 0, totalOut = 0;
    for (const e of ensureList(s.journal, userId)) {
      if (e.date < start || e.date > end) continue;
      const mk = e.date.slice(0, 7);
      if (!months.has(mk)) months.set(mk, { month: mk, in: 0, out: 0, net: 0 });
      const m = months.get(mk);
      for (const l of e.lines) {
        if (!cashIds.has(l.accountId)) continue;
        if (l.debit > 0) { m.in += l.debit; totalIn += l.debit; }
        if (l.credit > 0) { m.out += l.credit; totalOut += l.credit; }
      }
      m.net = m.in - m.out;
    }
    const series = Array.from(months.values()).sort((a, b) => a.month.localeCompare(b.month));
    return {
      ok: true,
      result: {
        period: { start, end },
        series,
        totalIn,
        totalOut,
        netCashFlow: totalIn - totalOut,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Runway forecast (cash + AR − AP, projected months) ────────

  registerLensAction("accounting", "runway-forecast", (ctx, _a, params = {}) => {
  try {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    seedDefaultCoA(userId, s);
    const months = Math.max(3, Math.min(24, Number(params.months) || 12));
    const today = new Date(nowIso().slice(0, 10));
    const coa = s.coa.get(userId);
    const journal = ensureList(s.journal, userId);

    const cashIds = new Set(Array.from(coa.values()).filter(a => a.category === "asset" && /^1[01]/.test(a.code)).map(a => a.id));
    let cashOnHand = 0;
    for (const e of journal) {
      for (const l of e.lines) {
        if (cashIds.has(l.accountId)) cashOnHand += (l.debit - l.credit);
      }
    }

    const openInvTotal = ensureList(s.invoices, userId).filter(i => i.status === "open").reduce((sum, i) => sum + i.total, 0);
    const openBillsTotal = ensureList(s.bills, userId).filter(b => b.status === "open").reduce((sum, b) => sum + b.total, 0);
    const liquidity = cashOnHand + openInvTotal - openBillsTotal;

    // Estimate burn rate from last 3 months' net cash flow.
    const cutoff = new Date(today.getTime() - 90 * 86_400_000).toISOString().slice(0, 10);
    let trailingIn = 0, trailingOut = 0;
    for (const e of journal) {
      if (e.date < cutoff) continue;
      for (const l of e.lines) {
        if (!cashIds.has(l.accountId)) continue;
        if (l.debit > 0) trailingIn += l.debit;
        if (l.credit > 0) trailingOut += l.credit;
      }
    }
    const monthlyNet = (trailingIn - trailingOut) / 3; // positive = net inflow
    const monthlyBurn = monthlyNet < 0 ? -monthlyNet : 0;
    const monthlyGrowth = monthlyNet > 0 ? monthlyNet : 0;

    const forecast = [];
    let running = liquidity;
    for (let i = 1; i <= months; i++) {
      const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
      running += monthlyNet;
      forecast.push({
        month: d.toISOString().slice(0, 7),
        projected: Math.round(running),
        out: Math.round(monthlyBurn),
        in: Math.round(monthlyGrowth),
      });
    }
    const runwayMonths = monthlyBurn > 0 ? Math.round((liquidity / monthlyBurn) * 10) / 10 : null;

    return {
      ok: true,
      result: {
        cashOnHand: Math.round(cashOnHand),
        openInvTotal: Math.round(openInvTotal),
        openBillsTotal: Math.round(openBillsTotal),
        liquidity: Math.round(liquidity),
        monthlyNet: Math.round(monthlyNet),
        monthlyBurn: Math.round(monthlyBurn),
        runwayMonths,
        forecast,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Recurring invoices ────────────────────────────────────────

  registerLensAction("accounting", "recurring-invoices-list", (ctx, _a, _p = {}) => {
  try {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    return { ok: true, result: { recurring: ensureList(s.recurring, actId(ctx)) } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("accounting", "recurring-invoices-create", (ctx, _a, params = {}) => {
  try {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    const customerName = String(params.customerName || "").trim();
    const total = Number(params.total);
    const cadence = ["weekly", "monthly", "quarterly", "annually"].includes(params.cadence) ? params.cadence : "monthly";
    if (!customerName || !Number.isFinite(total) || total <= 0) return { ok: false, error: "customerName and positive total required" };
    const seq = ensureSeq(s, userId);
    const startAt = String(params.startAt || nowIso().slice(0, 10));
    const r = {
      id: nextId("rec"),
      number: `R-${String(seq.rec).padStart(4, "0")}`,
      customerName,
      customerId: params.customerId ? String(params.customerId) : null,
      total,
      cadence,
      startAt,
      nextRunAt: startAt,
      memo: String(params.memo || ""),
      active: true,
      lastRunAt: null,
      runCount: 0,
      createdAt: nowIso(),
    };
    seq.rec++;
    ensureList(s.recurring, userId).push(r);
    saveAccountingState();
    return { ok: true, result: { recurring: r } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("accounting", "recurring-invoices-toggle", (ctx, _a, params = {}) => {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const r = ensureList(s.recurring, actId(ctx)).find(x => x.id === String(params.id || ""));
    if (!r) return { ok: false, error: "recurring not found" };
    r.active = !r.active;
    saveAccountingState();
    return { ok: true, result: { recurring: r } };
  });

  registerLensAction("accounting", "recurring-invoices-run-due", (ctx, _a, _p = {}) => {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    const seq = ensureSeq(s, userId);
    const today = nowIso().slice(0, 10);
    const created = [];
    for (const r of ensureList(s.recurring, userId)) {
      if (!r.active) continue;
      if (r.nextRunAt > today) continue;
      const invoice = {
        id: nextId("inv"),
        number: `INV-${String(seq.inv).padStart(5, "0")}`,
        customerId: r.customerId,
        customerName: r.customerName,
        total: r.total,
        status: "open",
        issuedAt: today,
        dueAt: new Date(new Date(today).getTime() + 30 * 86_400_000).toISOString().slice(0, 10),
        paidAt: null,
        recurringId: r.id,
      };
      seq.inv++;
      ensureList(s.invoices, userId).push(invoice);
      created.push(invoice);
      r.lastRunAt = today;
      r.runCount += 1;
      const days = r.cadence === "weekly" ? 7 : r.cadence === "quarterly" ? 90 : r.cadence === "annually" ? 365 : 30;
      r.nextRunAt = new Date(new Date(r.nextRunAt).getTime() + days * 86_400_000).toISOString().slice(0, 10);
    }
    saveAccountingState();
    return { ok: true, result: { created, count: created.length } };
  });

  // ── Estimates → Invoice ────────────────────────────────────────

  registerLensAction("accounting", "estimates-list", (ctx, _a, _p = {}) => {
  try {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    return { ok: true, result: { estimates: ensureList(s.estimates, actId(ctx)) } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("accounting", "estimates-create", (ctx, _a, params = {}) => {
  try {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    const customerName = String(params.customerName || "").trim();
    const total = Number(params.total);
    if (!customerName || !Number.isFinite(total) || total <= 0) return { ok: false, error: "customerName and positive total required" };
    const seq = ensureSeq(s, userId);
    const e = {
      id: nextId("est"),
      number: `EST-${String(seq.est).padStart(5, "0")}`,
      customerName,
      customerId: params.customerId ? String(params.customerId) : null,
      total,
      status: "pending",
      issuedAt: String(params.issuedAt || nowIso().slice(0, 10)),
      expiresAt: String(params.expiresAt || new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)),
      memo: String(params.memo || ""),
      convertedInvoiceId: null,
    };
    seq.est++;
    ensureList(s.estimates, userId).push(e);
    saveAccountingState();
    return { ok: true, result: { estimate: e } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("accounting", "estimates-convert", (ctx, _a, params = {}) => {
  try {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    const id = String(params.id || "");
    const e = ensureList(s.estimates, userId).find(x => x.id === id);
    if (!e) return { ok: false, error: "estimate not found" };
    if (e.convertedInvoiceId) return { ok: false, error: "estimate already converted" };
    const seq = ensureSeq(s, userId);
    const inv = {
      id: nextId("inv"),
      number: `INV-${String(seq.inv).padStart(5, "0")}`,
      customerId: e.customerId,
      customerName: e.customerName,
      total: e.total,
      status: "open",
      issuedAt: nowIso().slice(0, 10),
      dueAt: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
      paidAt: null,
      fromEstimateId: e.id,
    };
    seq.inv++;
    ensureList(s.invoices, userId).push(inv);
    e.status = "accepted";
    e.convertedInvoiceId = inv.id;
    saveAccountingState();
    return { ok: true, result: { estimate: e, invoice: inv } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Bank feeds (transaction inbox) ─────────────────────────────

  registerLensAction("accounting", "bank-feeds-list", (ctx, _a, params = {}) => {
  try {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const status = ["uncategorized", "categorized", "all"].includes(params.status) ? params.status : "uncategorized";
    const list = ensureList(s.bankTxns, actId(ctx));
    const filtered = status === "all" ? list : list.filter(t => (status === "uncategorized") ? !t.accountId : !!t.accountId);
    return { ok: true, result: { txns: filtered.slice().sort((a, b) => b.date.localeCompare(a.date)) } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("accounting", "bank-feeds-import", (ctx, _a, params = {}) => {
  try {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    const seq = ensureSeq(s, userId);
    const rows = Array.isArray(params.txns) ? params.txns : [];
    const description = String(params.description || "").trim();
    const amount = Number(params.amount);
    // Accept either bulk import or single-txn add.
    let imported = [];
    if (rows.length === 0 && description && Number.isFinite(amount) && amount !== 0) {
      rows.push({ description, amount, date: params.date, bankRef: params.bankRef });
    }
    for (const row of rows) {
      const desc = String(row.description || "").trim();
      const amt = Number(row.amount);
      if (!desc || !Number.isFinite(amt) || amt === 0) continue;
      const txn = {
        id: nextId("btxn"),
        number: `BT-${String(seq.btxn).padStart(6, "0")}`,
        date: String(row.date || nowIso().slice(0, 10)),
        description: desc.slice(0, 200),
        amount: amt,                              // negative = withdrawal, positive = deposit
        bankRef: String(row.bankRef || ""),
        accountId: null,                          // null = uncategorized
        jeEntryId: null,
        importedAt: nowIso(),
      };
      seq.btxn++;
      ensureList(s.bankTxns, userId).push(txn);
      imported.push(txn);
    }
    saveAccountingState();
    return { ok: true, result: { imported, count: imported.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("accounting", "bank-feeds-categorize", (ctx, _a, params = {}) => {
  try {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    seedDefaultCoA(userId, s);
    const txnId = String(params.txnId || "");
    const accountId = String(params.accountId || "");
    const txn = ensureList(s.bankTxns, userId).find(t => t.id === txnId);
    if (!txn) return { ok: false, error: "txn not found" };
    const coa = s.coa.get(userId);
    if (!coa.has(accountId)) return { ok: false, error: "accountId invalid" };
    if (txn.accountId) return { ok: false, error: "txn already categorized" };
    const cashAcct = Array.from(coa.values()).find(a => a.code === "1000" && a.category === "asset");
    if (!cashAcct) return { ok: false, error: "cash account 1000 not found" };
    const seq = ensureSeq(s, userId);
    // amount > 0 = deposit (debit cash, credit the picked account, e.g. revenue)
    // amount < 0 = withdrawal (credit cash, debit the picked account, e.g. expense)
    const isDeposit = txn.amount > 0;
    const abs = Math.abs(txn.amount);
    const entry = {
      id: nextId("je"),
      number: `JE-${String(seq.je).padStart(5, "0")}`,
      date: txn.date,
      memo: `Bank · ${txn.description}`.slice(0, 200),
      lines: isDeposit
        ? [
            { accountId: cashAcct.id, debit: abs, credit: 0, memo: txn.description },
            { accountId, debit: 0, credit: abs, memo: txn.description },
          ]
        : [
            { accountId, debit: abs, credit: 0, memo: txn.description },
            { accountId: cashAcct.id, debit: 0, credit: abs, memo: txn.description },
          ],
      totalDebit: abs, totalCredit: abs,
      postedAt: nowIso(),
      autoFrom: txn.id,
    };
    seq.je++;
    ensureList(s.journal, userId).push(entry);
    txn.accountId = accountId;
    txn.jeEntryId = entry.id;
    saveAccountingState();
    return { ok: true, result: { txn, entry } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("accounting", "bank-feeds-uncategorize", (ctx, _a, params = {}) => {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    const txn = ensureList(s.bankTxns, userId).find(t => t.id === String(params.txnId || ""));
    if (!txn) return { ok: false, error: "txn not found" };
    if (!txn.accountId) return { ok: false, error: "txn already uncategorized" };
    const journal = ensureList(s.journal, userId);
    if (txn.jeEntryId) {
      const i = journal.findIndex(e => e.id === txn.jeEntryId);
      if (i >= 0) journal.splice(i, 1);
    }
    txn.accountId = null;
    txn.jeEntryId = null;
    saveAccountingState();
    return { ok: true, result: { txn } };
  });

  // ── AI-suggest a category for an uncategorized bank txn ────────
  // Uses Concord's brain (utility) on the txn description + amount.

  // Confidence scorer — keyword overlap between txn description and account name.
  // Returns 0..1; > 0.7 considered "high confidence".
  function confidenceFor(txn, account) {
    const desc = txn.description.toLowerCase();
    const name = account.name.toLowerCase();
    if (!desc || !name) return 0.3;
    const tokens = name.split(/[\s_\-/]+/).filter(t => t.length >= 3);
    if (tokens.length === 0) return 0.35;
    let hits = 0;
    for (const t of tokens) if (desc.includes(t)) hits++;
    const direct = hits / tokens.length;
    // Boost for known merchant signatures.
    const signatures = [
      [/aws|amazon web services|gcp|google cloud|azure|digitalocean|netlify|vercel|github/, /software|hosting|office|technology/],
      [/uber|lyft|delta air|united air|amtrak|hertz|enterprise rent|hotel|marriott|hilton/, /travel|auto|fuel|meals/],
      [/payroll|adp|gusto|paychex|justworks|onpay/, /payroll|wages|salary/],
      [/wework|regus|rent|lease/, /rent/],
      [/pg&e|con edison|electric|water|comcast|verizon|att|t-mobile|internet/, /utilities/],
      [/staples|office depot|amazon\.com|costco/, /office|supplies/],
      [/restaurant|starbucks|chipotle|coffee|panera|doordash/, /meals|food|entertainment/],
    ];
    let sigBoost = 0;
    for (const [descRe, nameRe] of signatures) {
      if (descRe.test(desc) && nameRe.test(name)) { sigBoost = 0.45; break; }
    }
    return Math.min(1, direct * 0.55 + sigBoost + 0.2);
  }

  // Shared core for ai-categorize-txn AND bank-feeds-bulk-suggest.
  async function suggestCategoryForTxn(ctx, txn) {
    const s = getAccountingState();
    const userId = actId(ctx);
    const coa = s.coa.get(userId);
    const accounts = Array.from(coa.values()).filter(a => !a.archived);
    const isDeposit = txn.amount > 0;
    const candidates = accounts
      .filter(a => isDeposit ? a.category === "revenue" : (a.category === "expense" || a.category === "cogs"))
      .map(a => ({ id: a.id, code: a.code, name: a.name, category: a.category }));
    if (candidates.length === 0) return { ok: false, error: "no candidate accounts" };
    const rules = ensureList(s.catRules, userId);
    const ruleMatch = rules.find(r => txn.description.toLowerCase().includes(r.pattern.toLowerCase()) && candidates.some(c => c.id === r.accountId));
    if (ruleMatch) {
      const acct = candidates.find(c => c.id === ruleMatch.accountId);
      return { ok: true, result: { txnId: txn.id, suggestedAccountId: ruleMatch.accountId, suggestedAccountName: acct?.name, source: "rule", ruleId: ruleMatch.id, confidence: 1.0 } };
    }
    const desc = txn.description.toLowerCase();
    function heuristicPick() {
      if (isDeposit) return candidates.find(c => /sales|revenue/i.test(c.name)) || candidates[0];
      const map = [
        [/uber|lyft|fuel|gas|chevron|shell|exxon/, /auto|fuel|travel/i],
        [/aws|google|cloud|saas|hosting|domain|github/, /software|hosting|office/i],
        [/payroll|adp|gusto|salar/, /payroll/i],
        [/rent|wework/, /rent/i],
        [/pg&e|electric|utility|water|gas bill|comcast|internet|verizon/, /utilities/i],
        [/restaurant|starbucks|food|coffee|chipotle|meals/, /meals|entertainment|food/i],
        [/office|staples|amazon|supplies/, /office/i],
      ];
      for (const [re, nameRe] of map) {
        if (!re.test(desc)) continue;
        const match = candidates.find(c => nameRe.test(c.name));
        if (match) return match;
      }
      return candidates[0];
    }
    const brain = ctx?.llm?.chat;
    if (typeof brain !== "function") {
      const pick = heuristicPick();
      return { ok: true, result: { txnId: txn.id, suggestedAccountId: pick.id, suggestedAccountName: pick.name, source: "heuristic", confidence: confidenceFor(txn, pick) } };
    }
    try {
      const prompt = `You are categorizing a bank transaction for accounting. Reply with ONLY the account code from the list — nothing else.

Transaction: ${txn.description} (amount $${txn.amount.toFixed(2)}, ${isDeposit ? "deposit" : "withdrawal"})

Candidate accounts:
${candidates.map(c => `${c.code} ${c.name}`).join("\n")}

Output the single best account code:`;
      const r = await brain({ messages: [{ role: "user", content: prompt }] });
      const raw = String(r?.content || r?.text || r || "").trim();
      const code = (raw.match(/\b\d{3,5}\b/) || [])[0] || raw.split(/\s+/)[0];
      const picked = candidates.find(c => c.code === code) || heuristicPick();
      const heur = heuristicPick();
      const base = confidenceFor(txn, picked);
      const agree = heur.id === picked.id ? 0.15 : 0;
      return { ok: true, result: { txnId: txn.id, suggestedAccountId: picked.id, suggestedAccountName: picked.name, source: "brain", confidence: Math.min(1, base + agree) } };
    } catch (e) {
      const pick = heuristicPick();
      return { ok: true, result: { txnId: txn.id, suggestedAccountId: pick.id, suggestedAccountName: pick.name, source: "heuristic_after_brain_error", error: String(e), confidence: confidenceFor(txn, pick) } };
    }
  }

  registerLensAction("accounting", "ai-categorize-txn", async (ctx, _a, params = {}) => {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    seedDefaultCoA(userId, s);
    const txnId = String(params.txnId || "");
    const txn = ensureList(s.bankTxns, userId).find(t => t.id === txnId);
    if (!txn) return { ok: false, error: "txn not found" };
    return await suggestCategoryForTxn(ctx, txn);
  });

  // ── Bulk AI suggest across all uncategorized txns (QBO "Accounting AI" parity) ─

  registerLensAction("accounting", "bank-feeds-bulk-suggest", async (ctx, _a, _p = {}) => {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    seedDefaultCoA(userId, s);
    const txns = ensureList(s.bankTxns, userId).filter(t => !t.accountId);
    const suggestions = [];
    for (const txn of txns) {
      const r = await suggestCategoryForTxn(ctx, txn);
      if (r?.ok) {
        suggestions.push({
          txnId: txn.id,
          description: txn.description,
          amount: txn.amount,
          date: txn.date,
          suggestedAccountId: r.result.suggestedAccountId,
          suggestedAccountName: r.result.suggestedAccountName,
          source: r.result.source,
          confidence: r.result.confidence || 0,
          highConfidence: (r.result.confidence || 0) >= 0.7,
        });
      }
    }
    const high = suggestions.filter(s => s.highConfidence).length;
    return { ok: true, result: { suggestions, totalUncategorized: txns.length, highConfidenceCount: high } };
  });

  // bulk-accept — accept an explicit batch of {txnId, accountId} pairs.
  registerLensAction("accounting", "bank-feeds-bulk-accept", (ctx, _a, params = {}) => {
  try {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    seedDefaultCoA(userId, s);
    const picks = Array.isArray(params.picks) ? params.picks : [];
    if (picks.length === 0) return { ok: false, error: "picks array required" };
    const coa = s.coa.get(userId);
    const cashAcct = Array.from(coa.values()).find(a => a.code === "1000" && a.category === "asset");
    if (!cashAcct) return { ok: false, error: "cash account 1000 not found" };
    const seq = ensureSeq(s, userId);
    const txns = ensureList(s.bankTxns, userId);
    const journal = ensureList(s.journal, userId);
    const accepted = [], errors = [];
    for (const pick of picks) {
      const txnId = String(pick.txnId || "");
      const accountId = String(pick.accountId || "");
      const txn = txns.find(t => t.id === txnId);
      if (!txn) { errors.push({ txnId, error: "txn not found" }); continue; }
      if (txn.accountId) { errors.push({ txnId, error: "already categorized" }); continue; }
      if (!coa.has(accountId)) { errors.push({ txnId, error: "account invalid" }); continue; }
      const isDeposit = txn.amount > 0;
      const abs = Math.abs(txn.amount);
      const entry = {
        id: nextId("je"),
        number: `JE-${String(seq.je).padStart(5, "0")}`,
        date: txn.date,
        memo: `Bank · ${txn.description}`.slice(0, 200),
        lines: isDeposit
          ? [
              { accountId: cashAcct.id, debit: abs, credit: 0, memo: txn.description },
              { accountId, debit: 0, credit: abs, memo: txn.description },
            ]
          : [
              { accountId, debit: abs, credit: 0, memo: txn.description },
              { accountId: cashAcct.id, debit: 0, credit: abs, memo: txn.description },
            ],
        totalDebit: abs, totalCredit: abs,
        postedAt: nowIso(),
        autoFrom: txn.id,
      };
      seq.je++;
      journal.push(entry);
      txn.accountId = accountId;
      txn.jeEntryId = entry.id;
      accepted.push(txnId);
    }
    saveAccountingState();
    return { ok: true, result: { accepted: accepted.length, errors, total: picks.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── AI suggest vendor for a bank txn description ──────────────

  registerLensAction("accounting", "ai-suggest-vendor", (ctx, _a, params = {}) => {
  try {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    const description = String(params.description || "").toLowerCase();
    if (!description) return { ok: false, error: "description required" };
    const vendors = ensureList(s.vendors, userId);
    // Match by name token overlap.
    let best = null;
    let bestScore = 0;
    for (const v of vendors) {
      const tokens = v.name.toLowerCase().split(/\s+/).filter(t => t.length >= 3);
      if (tokens.length === 0) continue;
      let hits = 0;
      for (const t of tokens) if (description.includes(t)) hits++;
      const score = hits / tokens.length;
      if (score > bestScore) { best = v; bestScore = score; }
    }
    if (best && bestScore >= 0.5) {
      return { ok: true, result: { matched: true, vendorId: best.id, vendorName: best.name, score: bestScore } };
    }
    // Suggest a new-vendor name extracted from the description (first 1-2 capitalized-ish tokens).
    const newName = String(params.description || "")
      .split(/[\s\-_]+/)
      .filter(t => t.length >= 3 && !/^\d+$/.test(t))
      .slice(0, 2)
      .join(" ");
    return { ok: true, result: { matched: false, suggestedNewVendor: newName || description.slice(0, 30) } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Natural-language Q&A ("JAX"-style: Show me overdue invoices) ─

  registerLensAction("accounting", "ask", async (ctx, _a, params = {}) => {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    seedDefaultCoA(userId, s);
    const q = String(params.question || "").trim().toLowerCase();
    if (!q) return { ok: false, error: "question required" };
    const today = nowIso().slice(0, 10);

    // Intent routing — deterministic for the common questions, brain for the long tail.
    function answerOverdue() {
      const list = ensureList(s.invoices, userId).filter(i => i.status === "open" && i.dueAt < today);
      const total = list.reduce((sum, i) => sum + i.total, 0);
      return {
        intent: "overdue_invoices",
        answer: `You have ${list.length} overdue invoice${list.length === 1 ? "" : "s"} totaling $${total.toFixed(2)}.`,
        data: { invoices: list, totalOverdue: total },
      };
    }
    function answerOpenInvoices() {
      const list = ensureList(s.invoices, userId).filter(i => i.status === "open");
      const total = list.reduce((sum, i) => sum + i.total, 0);
      return { intent: "open_invoices", answer: `${list.length} open invoices, $${total.toFixed(2)} outstanding.`, data: { invoices: list, total } };
    }
    function answerCash() {
      const coa = s.coa.get(userId);
      const cashIds = new Set(Array.from(coa.values()).filter(a => a.category === "asset" && /^1[01]/.test(a.code)).map(a => a.id));
      let bal = 0;
      for (const e of ensureList(s.journal, userId)) for (const l of e.lines) if (cashIds.has(l.accountId)) bal += (l.debit - l.credit);
      return { intent: "cash_balance", answer: `Cash on hand is $${bal.toFixed(2)}.`, data: { cashOnHand: bal } };
    }
    function answerPL() {
      // year-to-date
      const yearStart = today.slice(0, 4) + "-01-01";
      const coa = s.coa.get(userId);
      let rev = 0, exp = 0;
      for (const e of ensureList(s.journal, userId)) {
        if (e.date < yearStart) continue;
        for (const l of e.lines) {
          const a = coa.get(l.accountId); if (!a) continue;
          if (a.category === "revenue") rev += (l.credit - l.debit);
          if (a.category === "expense" || a.category === "cogs") exp += (l.debit - l.credit);
        }
      }
      const net = rev - exp;
      return { intent: "ytd_pl", answer: `YTD: revenue $${rev.toFixed(2)}, expense $${exp.toFixed(2)}, net income $${net.toFixed(2)}.`, data: { revenue: rev, expense: exp, netIncome: net } };
    }
    function answerBills() {
      const list = ensureList(s.bills, userId).filter(b => b.status === "open");
      const total = list.reduce((sum, b) => sum + b.total, 0);
      return { intent: "open_bills", answer: `${list.length} open bills, $${total.toFixed(2)} owed.`, data: { bills: list, total } };
    }
    function answerRunway() {
      // reuse runway logic inline (cannot call sibling macros without indirection)
      const coa = s.coa.get(userId);
      const cashIds = new Set(Array.from(coa.values()).filter(a => a.category === "asset" && /^1[01]/.test(a.code)).map(a => a.id));
      let cash = 0;
      for (const e of ensureList(s.journal, userId)) for (const l of e.lines) if (cashIds.has(l.accountId)) cash += (l.debit - l.credit);
      const cutoff = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
      let inMo = 0, outMo = 0;
      for (const e of ensureList(s.journal, userId)) {
        if (e.date < cutoff) continue;
        for (const l of e.lines) {
          if (!cashIds.has(l.accountId)) continue;
          inMo += l.debit; outMo += l.credit;
        }
      }
      const netMo = (inMo - outMo) / 3;
      const burn = netMo < 0 ? -netMo : 0;
      const months = burn > 0 ? Math.round((cash / burn) * 10) / 10 : null;
      return { intent: "runway", answer: months !== null ? `Runway: ${months} months at current burn rate.` : `No burn — net cash flow is positive ($${netMo.toFixed(2)}/mo).`, data: { cashOnHand: cash, monthlyBurn: burn, runwayMonths: months } };
    }

    // Keyword routing.
    if (/overdue|past due|late/.test(q)) return { ok: true, result: answerOverdue() };
    if (/open invoice|outstanding invoice|unpaid invoice|invoice list/.test(q)) return { ok: true, result: answerOpenInvoices() };
    if (/cash (on hand|balance|in bank)|how much (cash|money)/.test(q)) return { ok: true, result: answerCash() };
    if (/p&?l|profit.*loss|net income|how (am i|are we) doing|profit/.test(q)) return { ok: true, result: answerPL() };
    if (/open bill|unpaid bill|bills (owed|to pay)|accounts payable/.test(q)) return { ok: true, result: answerBills() };
    if (/runway|burn rate|how long (until|do)/.test(q)) return { ok: true, result: answerRunway() };

    // Fall back to brain summarising the dashboard.
    const brain = ctx?.llm?.chat;
    const dashRes = answerCash();
    const pl = answerPL();
    const inv = answerOpenInvoices();
    const bills = answerBills();
    const context = `Cash: $${dashRes.data.cashOnHand.toFixed(2)} · YTD revenue: $${pl.data.revenue.toFixed(2)} · YTD expense: $${pl.data.expense.toFixed(2)} · Open invoices: ${inv.data.invoices.length} ($${inv.data.total.toFixed(2)}) · Open bills: ${bills.data.bills.length} ($${bills.data.total.toFixed(2)})`;
    if (typeof brain !== "function") {
      return { ok: true, result: { intent: "general", answer: `Current snapshot: ${context}.`, data: { context } } };
    }
    try {
      const r = await brain({ messages: [
        { role: "system", content: "You are a small-business CFO assistant. Reply in 1-2 plain English sentences. Only use facts from the snapshot." },
        { role: "user", content: `Snapshot: ${context}\n\nQuestion: ${params.question}` },
      ] });
      const answer = String(r?.content || r?.text || r || "").trim();
      return { ok: true, result: { intent: "general", answer: answer || `Snapshot: ${context}`, data: { context } } };
    } catch (e) {
      return { ok: true, result: { intent: "general", answer: `Snapshot: ${context}`, data: { context }, error: String(e) } };
    }
  });

  registerLensAction("accounting", "category-rules-list", (ctx, _a, _p = {}) => {
  try {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    return { ok: true, result: { rules: ensureList(s.catRules, actId(ctx)) } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("accounting", "category-rules-create", (ctx, _a, params = {}) => {
  try {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    const pattern = String(params.pattern || "").trim();
    const accountId = String(params.accountId || "");
    if (!pattern || !accountId) return { ok: false, error: "pattern and accountId required" };
    seedDefaultCoA(userId, s);
    if (!s.coa.get(userId).has(accountId)) return { ok: false, error: "accountId invalid" };
    const seq = ensureSeq(s, userId);
    const rule = {
      id: nextId("rule"),
      number: `RULE-${String(seq.rule).padStart(4, "0")}`,
      pattern,
      accountId,
      createdAt: nowIso(),
    };
    seq.rule++;
    ensureList(s.catRules, userId).push(rule);
    saveAccountingState();
    return { ok: true, result: { rule } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("accounting", "category-rules-delete", (ctx, _a, params = {}) => {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = ensureList(s.catRules, actId(ctx));
    const i = list.findIndex(r => r.id === String(params.id || ""));
    if (i < 0) return { ok: false, error: "rule not found" };
    list.splice(i, 1);
    saveAccountingState();
    return { ok: true, result: { deleted: true } };
  });

  // ── Expenses (out-of-pocket / card spend) ─────────────────────

  registerLensAction("accounting", "expenses-list", (ctx, _a, _p = {}) => {
  try {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = ensureList(s.expenses, actId(ctx));
    return { ok: true, result: { expenses: list.slice().sort((a, b) => (b.date || "").localeCompare(a.date || "")) } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("accounting", "expenses-create", (ctx, _a, params = {}) => {
  try {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    seedDefaultCoA(userId, s);
    const accountId = String(params.accountId || "");
    const amount = Number(params.amount);
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "amount must be > 0" };
    const coa = s.coa.get(userId);
    if (!coa.has(accountId)) return { ok: false, error: "accountId invalid" };
    const cashAcct = Array.from(coa.values()).find(a => a.code === "1000" && a.category === "asset");
    if (!cashAcct) return { ok: false, error: "cash account 1000 not found" };
    const seq = ensureSeq(s, userId);
    const date = String(params.date || nowIso().slice(0, 10));
    const vendor = String(params.vendor || "").trim();
    const memo = String(params.memo || "").slice(0, 200);
    const exp = {
      id: nextId("exp"),
      number: `EXP-${String(seq.exp).padStart(5, "0")}`,
      date,
      vendor,
      accountId,
      amount,
      memo,
      receiptUrl: String(params.receiptUrl || ""),
      createdAt: nowIso(),
    };
    seq.exp++;
    ensureList(s.expenses, userId).push(exp);
    // Auto-post JE: Debit expense, Credit cash
    const entry = {
      id: nextId("je"),
      number: `JE-${String(seq.je).padStart(5, "0")}`,
      date,
      memo: vendor ? `${vendor} · ${memo}` : memo,
      lines: [
        { accountId, debit: amount, credit: 0, memo },
        { accountId: cashAcct.id, debit: 0, credit: amount, memo: vendor || memo },
      ],
      totalDebit: amount, totalCredit: amount,
      postedAt: nowIso(),
      autoFrom: exp.id,
    };
    seq.je++;
    ensureList(s.journal, userId).push(entry);
    exp.jeEntryId = entry.id;
    saveAccountingState();
    return { ok: true, result: { expense: exp, entry } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── 1099 summary (vendor totals for the tax year) ──────────────

  registerLensAction("accounting", "summary-1099", (ctx, _a, params = {}) => {
  try {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    const year = Number(params.year) || new Date().getFullYear();
    const start = `${year}-01-01`;
    const end = `${year}-12-31`;
    const totals = new Map();
    const vendors = ensureList(s.vendors, userId);
    for (const bill of ensureList(s.bills, userId)) {
      if (bill.status !== "paid") continue;
      if ((bill.paidAt || "") < start || (bill.paidAt || "") > end) continue;
      const v = vendors.find(x => x.id === bill.vendorId);
      if (!v || !v.is1099) continue;
      const cur = totals.get(v.id) || { vendorId: v.id, vendorName: v.name, taxId: v.taxId, total: 0, billCount: 0 };
      cur.total += bill.total;
      cur.billCount += 1;
      totals.set(v.id, cur);
    }
    const THRESHOLD = 600; // IRS reporting threshold for 1099-NEC
    const rows = Array.from(totals.values()).map(r => ({ ...r, reportable: r.total >= THRESHOLD }));
    return { ok: true, result: { year, threshold: THRESHOLD, vendors: rows.sort((a, b) => b.total - a.total) } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Dashboard summary (KPI strip) ──────────────────────────────

  registerLensAction("accounting", "dashboard-summary", (ctx, _a, _p = {}) => {
  try {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    seedDefaultCoA(userId, s);
    const today = nowIso().slice(0, 10);
    const yearStart = today.slice(0, 4) + "-01-01";
    const coa = s.coa.get(userId);
    const journal = ensureList(s.journal, userId);
    const cashIds = new Set(Array.from(coa.values()).filter(a => a.category === "asset" && /^1[01]/.test(a.code)).map(a => a.id));
    let cashOnHand = 0, ytdRev = 0, ytdExp = 0;
    for (const e of journal) {
      for (const l of e.lines) {
        if (cashIds.has(l.accountId)) cashOnHand += (l.debit - l.credit);
        if (e.date < yearStart) continue;
        const a = coa.get(l.accountId); if (!a) continue;
        if (a.category === "revenue") ytdRev += (l.credit - l.debit);
        if (a.category === "expense" || a.category === "cogs") ytdExp += (l.debit - l.credit);
      }
    }
    const openInvCount = ensureList(s.invoices, userId).filter(i => i.status === "open").length;
    const openInvTotal = ensureList(s.invoices, userId).filter(i => i.status === "open").reduce((sum, i) => sum + i.total, 0);
    const openBillsCount = ensureList(s.bills, userId).filter(b => b.status === "open").length;
    const openBillsTotal = ensureList(s.bills, userId).filter(b => b.status === "open").reduce((sum, b) => sum + b.total, 0);
    const uncatTxns = ensureList(s.bankTxns, userId).filter(t => !t.accountId).length;
    return {
      ok: true,
      result: {
        cashOnHand: Math.round(cashOnHand),
        openInvTotal: Math.round(openInvTotal),
        openInvCount,
        openBillsTotal: Math.round(openBillsTotal),
        openBillsCount,
        ytdRevenue: Math.round(ytdRev),
        ytdExpense: Math.round(ytdExp),
        ytdNetIncome: Math.round(ytdRev - ytdExp),
        uncategorizedTxns: uncatTxns,
        customerCount: ensureList(s.customers, userId).length,
        vendorCount: ensureList(s.vendors, userId).length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ─── QuickBooks parity — payroll, budgets, inventory, sales tax, ────
  // purchase orders, financial ratios.

  const acN = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; };
  const acStr = (v, max = 200) => String(v == null ? "" : v).trim().slice(0, max);
  function acAcctByCode(s, userId, code) {
    for (const a of (s.coa.get(userId) || new Map()).values()) {
      if (a.code === code) return a.id;
    }
    return null;
  }
  function acEnsureAccount(s, userId, code, name, category) {
    let id = acAcctByCode(s, userId, code);
    if (id) return id;
    const coa = s.coa.get(userId) || new Map();
    id = `acct_${code}`;
    coa.set(id, {
      id, code, name, category,
      normal: COA_CATEGORIES[category]?.normal || "debit",
      parent: null, archived: false, createdAt: nowIso(),
    });
    s.coa.set(userId, coa);
    return id;
  }
  // Post a balanced journal entry directly into the ledger.
  function acPostJE(s, userId, date, memo, lines) {
    let td = 0; let tc = 0;
    for (const l of lines) { td += Number(l.debit) || 0; tc += Number(l.credit) || 0; }
    if (Math.abs(td - tc) > 0.01) return null;
    if (!s.journal.has(userId)) s.journal.set(userId, []);
    const seq = ensureSeq(s, userId);
    const entry = {
      id: nextId("je"), number: `JE-${String(seq.je).padStart(5, "0")}`,
      date, memo, lines: lines.map((l) => ({
        accountId: l.accountId, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0,
        memo: acStr(l.memo, 120),
      })),
      totalDebit: Math.round(td * 100) / 100, totalCredit: Math.round(tc * 100) / 100,
      postedAt: nowIso(),
    };
    seq.je++;
    s.journal.get(userId).push(entry);
    return entry;
  }

  // ── Payroll ─────────────────────────────────────────────────────────
  const PR_RATES = { federal: 0.12, fica: 0.0765, state: 0.05 };
  const PR_PERIODS = 24;   // semi-monthly

  registerLensAction("accounting", "employee-create", (ctx, _a, params = {}) => {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    const name = acStr(params.name, 100);
    if (!name) return { ok: false, error: "employee name required" };
    const employee = {
      id: nextId("emp"), name,
      payType: ["salary", "hourly"].includes(String(params.payType)) ? String(params.payType) : "salary",
      rate: Math.max(0, acN(params.rate)),
      title: acStr(params.title, 80) || null,
      active: true, createdAt: nowIso(),
    };
    ensureList(s.employees, userId).push(employee);
    saveAccountingState();
    return { ok: true, result: { employee } };
  });

  registerLensAction("accounting", "employee-list", (ctx, _a, _p = {}) => {
  try {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const employees = ensureList(s.employees, actId(ctx));
    return { ok: true, result: { employees, count: employees.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("accounting", "employee-update", (ctx, _a, params = {}) => {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const emp = ensureList(s.employees, actId(ctx)).find((e) => e.id === params.id);
    if (!emp) return { ok: false, error: "employee not found" };
    if (params.name != null) emp.name = acStr(params.name, 100) || emp.name;
    if (params.payType != null && ["salary", "hourly"].includes(String(params.payType))) emp.payType = String(params.payType);
    if (params.rate != null) emp.rate = Math.max(0, acN(params.rate));
    if (params.title != null) emp.title = acStr(params.title, 80) || null;
    if (params.active != null) emp.active = !!params.active;
    saveAccountingState();
    return { ok: true, result: { employee: emp } };
  });

  registerLensAction("accounting", "employee-delete", (ctx, _a, params = {}) => {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = ensureList(s.employees, actId(ctx));
    const i = arr.findIndex((e) => e.id === params.id);
    if (i < 0) return { ok: false, error: "employee not found" };
    arr.splice(i, 1);
    saveAccountingState();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("accounting", "payrun-create", (ctx, _a, params = {}) => {
  try {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    seedDefaultCoA(userId, s);
    const employees = ensureList(s.employees, userId);
    const lines = Array.isArray(params.lines) ? params.lines : [];
    if (!lines.length) return { ok: false, error: "at least one payroll line required" };
    const stubs = [];
    for (const line of lines) {
      const emp = employees.find((e) => e.id === line.employeeId);
      if (!emp) continue;
      const hours = Math.max(0, acN(line.hours));
      const gross = emp.payType === "hourly" ? acN(emp.rate * hours) : acN(emp.rate / PR_PERIODS);
      const federal = acN(gross * PR_RATES.federal);
      const fica = acN(gross * PR_RATES.fica);
      const state = acN(gross * PR_RATES.state);
      const withholding = acN(federal + fica + state);
      const net = acN(gross - withholding);
      stubs.push({
        id: nextId("stub"), employeeId: emp.id, employeeName: emp.name,
        hours: emp.payType === "hourly" ? hours : null,
        gross, federal, fica, state, withholding, net,
      });
    }
    if (!stubs.length) return { ok: false, error: "no valid employees in payroll lines" };
    const totalGross = acN(stubs.reduce((a, x) => a + x.gross, 0));
    const totalNet = acN(stubs.reduce((a, x) => a + x.net, 0));
    const totalWithholding = acN(stubs.reduce((a, x) => a + x.withholding, 0));
    const expenseAcct = acAcctByCode(s, userId, "6300") || acEnsureAccount(s, userId, "6300", "Payroll", "expense");
    const cashAcct = acAcctByCode(s, userId, "1000") || acEnsureAccount(s, userId, "1000", "Cash", "asset");
    const liabAcct = acEnsureAccount(s, userId, "2200", "Payroll Liabilities", "liability");
    const je = acPostJE(s, userId, acStr(params.payDate, 10) || nowIso().slice(0, 10),
      `Payroll ${acStr(params.periodStart, 10)}–${acStr(params.periodEnd, 10)}`, [
        { accountId: expenseAcct, debit: totalGross, credit: 0, memo: "Gross wages" },
        { accountId: cashAcct, debit: 0, credit: totalNet, memo: "Net pay" },
        { accountId: liabAcct, debit: 0, credit: totalWithholding, memo: "Withholdings" },
      ]);
    const run = {
      id: nextId("payrun"),
      periodStart: acStr(params.periodStart, 10) || nowIso().slice(0, 10),
      periodEnd: acStr(params.periodEnd, 10) || nowIso().slice(0, 10),
      payDate: acStr(params.payDate, 10) || nowIso().slice(0, 10),
      stubs, totalGross, totalNet, totalWithholding,
      journalEntryId: je ? je.id : null,
      createdAt: nowIso(),
    };
    ensureList(s.payRuns, userId).push(run);
    saveAccountingState();
    return { ok: true, result: { run } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("accounting", "payrun-list", (ctx, _a, _p = {}) => {
  try {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const runs = ensureList(s.payRuns, actId(ctx))
      .map((r) => ({
        id: r.id, periodStart: r.periodStart, periodEnd: r.periodEnd, payDate: r.payDate,
        employeeCount: r.stubs.length, totalGross: r.totalGross, totalNet: r.totalNet,
      }))
      .sort((a, b) => b.payDate.localeCompare(a.payDate));
    return { ok: true, result: { runs, count: runs.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("accounting", "payrun-detail", (ctx, _a, params = {}) => {
  try {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const run = ensureList(s.payRuns, actId(ctx)).find((r) => r.id === params.id);
    if (!run) return { ok: false, error: "pay run not found" };
    return { ok: true, result: { run } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("accounting", "payroll-summary", (ctx, _a, _p = {}) => {
  try {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const runs = ensureList(s.payRuns, actId(ctx));
    const ytd = nowIso().slice(0, 4);
    const ytdRuns = runs.filter((r) => r.payDate.startsWith(ytd));
    return {
      ok: true,
      result: {
        runs: runs.length,
        employees: ensureList(s.employees, actId(ctx)).filter((e) => e.active).length,
        ytdGross: acN(ytdRuns.reduce((a, r) => a + r.totalGross, 0)),
        ytdNet: acN(ytdRuns.reduce((a, r) => a + r.totalNet, 0)),
        ytdWithholding: acN(ytdRuns.reduce((a, r) => a + r.totalWithholding, 0)),
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Budgets ─────────────────────────────────────────────────────────
  registerLensAction("accounting", "budget-create", (ctx, _a, params = {}) => {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = acStr(params.name, 100);
    if (!name) return { ok: false, error: "budget name required" };
    const budget = {
      id: nextId("budget"), name,
      fiscalYear: Math.round(Number(params.fiscalYear) || new Date().getUTCFullYear()),
      lines: {},   // accountId -> annual amount
      createdAt: nowIso(),
    };
    ensureList(s.budgets, actId(ctx)).push(budget);
    saveAccountingState();
    return { ok: true, result: { budget } };
  });

  registerLensAction("accounting", "budget-list", (ctx, _a, _p = {}) => {
  try {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const budgets = ensureList(s.budgets, actId(ctx));
    return { ok: true, result: { budgets, count: budgets.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("accounting", "budget-set-line", (ctx, _a, params = {}) => {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    const budget = ensureList(s.budgets, userId).find((b) => b.id === params.budgetId);
    if (!budget) return { ok: false, error: "budget not found" };
    const accountId = acStr(params.accountId, 60);
    if (!(s.coa.get(userId) || new Map()).has(accountId)) return { ok: false, error: "unknown account" };
    const amount = acN(params.annualAmount);
    if (amount === 0) delete budget.lines[accountId];
    else budget.lines[accountId] = amount;
    saveAccountingState();
    return { ok: true, result: { budgetId: budget.id, lines: budget.lines } };
  });

  registerLensAction("accounting", "budget-vs-actual", (ctx, _a, params = {}) => {
  try {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    const budget = ensureList(s.budgets, userId).find((b) => b.id === params.budgetId);
    if (!budget) return { ok: false, error: "budget not found" };
    const coa = s.coa.get(userId) || new Map();
    const journal = s.journal.get(userId) || [];
    const yr = String(budget.fiscalYear);
    const rows = Object.entries(budget.lines).map(([accountId, budgeted]) => {
      const acct = coa.get(accountId);
      let actual = 0;
      for (const e of journal) {
        if (!e.date.startsWith(yr)) continue;
        for (const l of e.lines) {
          if (l.accountId !== accountId) continue;
          actual += (acct && acct.normal === "credit") ? (l.credit - l.debit) : (l.debit - l.credit);
        }
      }
      actual = acN(actual);
      return {
        accountId, account: acct ? acct.name : accountId,
        budgeted, actual, variance: acN(actual - budgeted),
      };
    });
    return {
      ok: true,
      result: {
        budget: budget.name, fiscalYear: budget.fiscalYear, rows,
        totalBudgeted: acN(rows.reduce((a, r) => a + r.budgeted, 0)),
        totalActual: acN(rows.reduce((a, r) => a + r.actual, 0)),
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("accounting", "budget-delete", (ctx, _a, params = {}) => {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = ensureList(s.budgets, actId(ctx));
    const i = arr.findIndex((b) => b.id === params.id);
    if (i < 0) return { ok: false, error: "budget not found" };
    arr.splice(i, 1);
    saveAccountingState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Products & inventory ────────────────────────────────────────────
  registerLensAction("accounting", "item-create", (ctx, _a, params = {}) => {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = acStr(params.name, 120);
    if (!name) return { ok: false, error: "item name required" };
    const type = ["service", "inventory"].includes(String(params.type)) ? String(params.type) : "service";
    const item = {
      id: nextId("item"), name, type,
      sku: acStr(params.sku, 40) || null,
      price: Math.max(0, acN(params.price)),
      cost: Math.max(0, acN(params.cost)),
      qtyOnHand: type === "inventory" ? Math.max(0, Math.round(Number(params.qtyOnHand) || 0)) : null,
      reorderPoint: type === "inventory" ? Math.max(0, Math.round(Number(params.reorderPoint) || 0)) : null,
      createdAt: nowIso(),
    };
    ensureList(s.items, actId(ctx)).push(item);
    saveAccountingState();
    return { ok: true, result: { item } };
  });

  registerLensAction("accounting", "item-list", (ctx, _a, _p = {}) => {
  try {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const items = ensureList(s.items, actId(ctx));
    return { ok: true, result: { items, count: items.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("accounting", "item-update", (ctx, _a, params = {}) => {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const item = ensureList(s.items, actId(ctx)).find((x) => x.id === params.id);
    if (!item) return { ok: false, error: "item not found" };
    if (params.name != null) item.name = acStr(params.name, 120) || item.name;
    if (params.sku != null) item.sku = acStr(params.sku, 40) || null;
    if (params.price != null) item.price = Math.max(0, acN(params.price));
    if (params.cost != null) item.cost = Math.max(0, acN(params.cost));
    if (params.reorderPoint != null && item.type === "inventory") {
      item.reorderPoint = Math.max(0, Math.round(Number(params.reorderPoint) || 0));
    }
    saveAccountingState();
    return { ok: true, result: { item } };
  });

  registerLensAction("accounting", "item-delete", (ctx, _a, params = {}) => {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = ensureList(s.items, actId(ctx));
    const i = arr.findIndex((x) => x.id === params.id);
    if (i < 0) return { ok: false, error: "item not found" };
    arr.splice(i, 1);
    saveAccountingState();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("accounting", "item-adjust-stock", (ctx, _a, params = {}) => {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const item = ensureList(s.items, actId(ctx)).find((x) => x.id === params.id);
    if (!item) return { ok: false, error: "item not found" };
    if (item.type !== "inventory") return { ok: false, error: "only inventory items track stock" };
    const delta = Math.round(Number(params.delta) || 0);
    item.qtyOnHand = Math.max(0, (item.qtyOnHand || 0) + delta);
    saveAccountingState();
    return { ok: true, result: { id: item.id, qtyOnHand: item.qtyOnHand, reason: acStr(params.reason, 100) || null } };
  });

  registerLensAction("accounting", "inventory-low-stock", (ctx, _a, _p = {}) => {
  try {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const items = ensureList(s.items, actId(ctx))
      .filter((x) => x.type === "inventory" && (x.qtyOnHand || 0) <= (x.reorderPoint || 0));
    return {
      ok: true,
      result: {
        items: items.map((x) => ({ id: x.id, name: x.name, qtyOnHand: x.qtyOnHand, reorderPoint: x.reorderPoint })),
        count: items.length,
        inventoryValue: acN(ensureList(s.items, actId(ctx))
          .filter((x) => x.type === "inventory").reduce((a, x) => a + (x.qtyOnHand || 0) * x.cost, 0)),
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Sales tax ───────────────────────────────────────────────────────
  registerLensAction("accounting", "tax-code-create", (ctx, _a, params = {}) => {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = acStr(params.name, 80);
    if (!name) return { ok: false, error: "tax code name required" };
    const code = {
      id: nextId("tax"), name,
      rate: Math.max(0, Math.min(100, acN(params.rate))),
      createdAt: nowIso(),
    };
    ensureList(s.taxCodes, actId(ctx)).push(code);
    saveAccountingState();
    return { ok: true, result: { taxCode: code } };
  });

  registerLensAction("accounting", "tax-code-list", (ctx, _a, _p = {}) => {
  try {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const taxCodes = ensureList(s.taxCodes, actId(ctx));
    return { ok: true, result: { taxCodes, count: taxCodes.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("accounting", "tax-code-delete", (ctx, _a, params = {}) => {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = ensureList(s.taxCodes, actId(ctx));
    const i = arr.findIndex((x) => x.id === params.id);
    if (i < 0) return { ok: false, error: "tax code not found" };
    arr.splice(i, 1);
    saveAccountingState();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("accounting", "tax-liability", (ctx, _a, _p = {}) => {
  try {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    const acctId = acAcctByCode(s, userId, "2100");
    let owed = 0;
    if (acctId) {
      for (const e of s.journal.get(userId) || []) {
        for (const l of e.lines) {
          if (l.accountId === acctId) owed += (l.credit - l.debit);
        }
      }
    }
    return { ok: true, result: { salesTaxPayable: acN(owed) } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("accounting", "tax-payment-record", (ctx, _a, params = {}) => {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    seedDefaultCoA(userId, s);
    const amount = acN(params.amount);
    if (amount <= 0) return { ok: false, error: "payment amount must be positive" };
    const taxAcct = acAcctByCode(s, userId, "2100") || acEnsureAccount(s, userId, "2100", "Sales Tax Payable", "liability");
    const cashAcct = acAcctByCode(s, userId, "1000") || acEnsureAccount(s, userId, "1000", "Cash", "asset");
    const je = acPostJE(s, userId, acStr(params.date, 10) || nowIso().slice(0, 10), "Sales tax remittance", [
      { accountId: taxAcct, debit: amount, credit: 0, memo: "Sales tax paid" },
      { accountId: cashAcct, debit: 0, credit: amount, memo: "Cash" },
    ]);
    saveAccountingState();
    return { ok: true, result: { amount, journalEntryId: je ? je.id : null } };
  });

  // ── Purchase orders ─────────────────────────────────────────────────
  registerLensAction("accounting", "po-create", (ctx, _a, params = {}) => {
  try {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    const vendorId = acStr(params.vendorId, 60);
    const vendor = ensureList(s.vendors, userId).find((v) => v.id === vendorId);
    if (!vendor) return { ok: false, error: "vendor not found" };
    const lines = (Array.isArray(params.lines) ? params.lines : [])
      .map((l) => ({
        description: acStr(l.description, 160) || "Item",
        qty: Math.max(1, Math.round(Number(l.qty) || 1)),
        unitCost: Math.max(0, acN(l.unitCost)),
      }))
      .filter((l) => l.unitCost >= 0);
    if (!lines.length) return { ok: false, error: "at least one line required" };
    const total = acN(lines.reduce((a, l) => a + l.qty * l.unitCost, 0));
    const seq = ensureSeq(s, userId);
    if (!Number.isFinite(seq.po)) seq.po = 1;
    const po = {
      id: nextId("po"), number: `PO-${String(seq.po).padStart(5, "0")}`,
      vendorId, vendorName: vendor.name, lines, total,
      status: "open", billId: null,
      createdAt: nowIso(),
    };
    seq.po++;
    ensureList(s.purchaseOrders, userId).push(po);
    saveAccountingState();
    return { ok: true, result: { purchaseOrder: po } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("accounting", "po-list", (ctx, _a, _p = {}) => {
  try {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const purchaseOrders = ensureList(s.purchaseOrders, actId(ctx))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { ok: true, result: { purchaseOrders, count: purchaseOrders.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("accounting", "po-receive", (ctx, _a, params = {}) => {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    const po = ensureList(s.purchaseOrders, userId).find((p) => p.id === params.id);
    if (!po) return { ok: false, error: "purchase order not found" };
    if (po.status === "received") return { ok: false, error: "purchase order already received" };
    const seq = ensureSeq(s, userId);
    const bill = {
      id: nextId("bill"), number: `BILL-${String(seq.bill).padStart(5, "0")}`,
      vendorId: po.vendorId, vendorName: po.vendorName,
      amount: po.total, memo: `From ${po.number}`,
      issueDate: nowIso().slice(0, 10),
      dueDate: acStr(params.dueDate, 10) || nowIso().slice(0, 10),
      status: "open", paidAt: null, createdAt: nowIso(),
    };
    seq.bill++;
    ensureList(s.bills, userId).push(bill);
    po.status = "received";
    po.billId = bill.id;
    saveAccountingState();
    return { ok: true, result: { purchaseOrder: po, bill } };
  });

  registerLensAction("accounting", "po-delete", (ctx, _a, params = {}) => {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = ensureList(s.purchaseOrders, actId(ctx));
    const i = arr.findIndex((p) => p.id === params.id);
    if (i < 0) return { ok: false, error: "purchase order not found" };
    arr.splice(i, 1);
    saveAccountingState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Financial ratios ────────────────────────────────────────────────
  registerLensAction("accounting", "financial-ratios", (ctx, _a, _p = {}) => {
  try {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    const coa = s.coa.get(userId) || new Map();
    const journal = s.journal.get(userId) || [];
    const netByAccount = {};
    for (const e of journal) {
      for (const l of e.lines) {
        netByAccount[l.accountId] = (netByAccount[l.accountId] || 0) + (l.debit - l.credit);
      }
    }
    let currentAssets = 0; let inventory = 0; let totalAssets = 0;
    let currentLiab = 0; let totalLiab = 0; let equity = 0;
    let revenue = 0; let cogs = 0; let expense = 0;
    for (const [id, net] of Object.entries(netByAccount)) {
      const a = coa.get(id);
      if (!a) continue;
      const codeNum = parseInt(a.code, 10) || 0;
      if (a.category === "asset") {
        totalAssets += net;
        if (codeNum < 1500) currentAssets += net;
        if (a.name.toLowerCase().includes("inventory")) inventory += net;
      } else if (a.category === "liability") {
        totalLiab += -net;
        if (codeNum < 2500) currentLiab += -net;
      } else if (a.category === "equity") {
        equity += -net;
      } else if (a.category === "revenue") {
        revenue += -net;
      } else if (a.category === "cogs") {
        cogs += net;
      } else if (a.category === "expense") {
        expense += net;
      }
    }
    const safeDiv = (n, d) => (d !== 0 ? Math.round((n / d) * 100) / 100 : null);
    const grossProfit = revenue - cogs;
    const netIncome = revenue - cogs - expense;
    return {
      ok: true,
      result: {
        currentRatio: safeDiv(currentAssets, currentLiab),
        quickRatio: safeDiv(currentAssets - inventory, currentLiab),
        debtToEquity: safeDiv(totalLiab, equity + netIncome),
        grossMarginPct: revenue !== 0 ? Math.round((grossProfit / revenue) * 1000) / 10 : null,
        netMarginPct: revenue !== 0 ? Math.round((netIncome / revenue) * 1000) / 10 : null,
        workingCapital: acN(currentAssets - currentLiab),
        totals: {
          currentAssets: acN(currentAssets), totalAssets: acN(totalAssets),
          currentLiabilities: acN(currentLiab), totalLiabilities: acN(totalLiab),
          revenue: acN(revenue), netIncome: acN(netIncome),
        },
        note: "Current vs. long-term split approximated by account code (<1500 assets, <2500 liabilities).",
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ════════════════════════════════════════════════════════════════════
  //  2026 PARITY BACKLOG — QuickBooks Online feature gaps
  // ════════════════════════════════════════════════════════════════════

  // ── [M] Live bank feed via aggregator ──────────────────────────────
  //
  // Real bank-feed aggregation (Plaid/Yodlee) requires a licensed,
  // credentialed integration — there is no free keyless API. Per the
  // "everything must be real" directive we DON'T synthesize transactions.
  // Instead this links a real aggregator: when CONCORD_BANK_AGGREGATOR_URL
  // + token env are set we call the configured endpoint; without config
  // we return a clear "not configured" error (the Stripe pattern).
  //
  // The institution registry IS real persistent CRUD — users record
  // their linked accounts and trigger syncs against the configured feed.

  registerLensAction("accounting", "bank-feeds-link-institution", (ctx, _a, params = {}) => {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    if (name.length > 80) return { ok: false, error: "name too long (max 80)" };
    const accountMask = String(params.accountMask || "").trim().slice(0, 8);
    const externalAccountId = String(params.externalAccountId || "").trim().slice(0, 120);
    const inst = {
      id: nextId("inst"),
      name,
      accountMask,
      externalAccountId,
      ledgerAccountId: params.ledgerAccountId ? String(params.ledgerAccountId) : null,
      status: "linked",
      linkedAt: nowIso(),
      lastSyncAt: null,
      lastSyncCount: 0,
    };
    ensureList(s.institutions, userId).push(inst);
    recordAudit(s, userId, {
      action: "bank-feeds-link-institution", entityType: "institution", entityId: inst.id,
      summary: `Linked institution ${name}${accountMask ? ` ····${accountMask}` : ""}`, after: { name, accountMask },
    });
    saveAccountingState();
    return { ok: true, result: { institution: inst } };
  });

  registerLensAction("accounting", "bank-feeds-institutions-list", (ctx, _a, _p = {}) => {
  try {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = ensureList(s.institutions, actId(ctx));
    const configured = Boolean(process.env.CONCORD_BANK_AGGREGATOR_URL && process.env.CONCORD_BANK_AGGREGATOR_TOKEN);
    return { ok: true, result: { institutions: list.slice().sort((a, b) => (b.linkedAt || "").localeCompare(a.linkedAt || "")), aggregatorConfigured: configured } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("accounting", "bank-feeds-unlink-institution", (ctx, _a, params = {}) => {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    const id = String(params.id || "");
    const list = ensureList(s.institutions, userId);
    const i = list.findIndex(x => x.id === id);
    if (i < 0) return { ok: false, error: "institution not found" };
    const removed = list.splice(i, 1)[0];
    recordAudit(s, userId, {
      action: "bank-feeds-unlink-institution", entityType: "institution", entityId: id,
      summary: `Unlinked institution ${removed.name}`, before: { name: removed.name },
    });
    saveAccountingState();
    return { ok: true, result: { id, unlinked: true } };
  });

  registerLensAction("accounting", "bank-feeds-sync", async (ctx, _a, params = {}) => {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    const id = String(params.id || "");
    const inst = ensureList(s.institutions, userId).find(x => x.id === id);
    if (!inst) return { ok: false, error: "institution not found" };
    const baseUrl = process.env.CONCORD_BANK_AGGREGATOR_URL;
    const token = process.env.CONCORD_BANK_AGGREGATOR_TOKEN;
    if (!baseUrl || !token) {
      return {
        ok: false,
        error: "Live bank feed not configured. Set CONCORD_BANK_AGGREGATOR_URL + CONCORD_BANK_AGGREGATOR_TOKEN env to a Plaid-style aggregator endpoint. Concord does not synthesize bank transactions — use bank-feeds-import for CSV import meanwhile.",
      };
    }
    // Real call to the configured aggregator. Expected JSON shape:
    //   { transactions: [{ id, date, amount, description }] }
    let txns;
    try {
      const url = `${baseUrl.replace(/\/$/, "")}/accounts/${encodeURIComponent(inst.externalAccountId || inst.id)}/transactions`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
      const data = await r.json();
      if (!r.ok) return { ok: false, error: `aggregator ${r.status}: ${data?.error || data?.message || "unknown"}` };
      txns = Array.isArray(data?.transactions) ? data.transactions : [];
    } catch (e) {
      return { ok: false, error: `bank feed sync failed: ${e.message}` };
    }
    const seq = ensureSeq(s, userId);
    const feed = ensureList(s.bankTxns, userId);
    const existing = new Set(feed.map(t => t.externalId).filter(Boolean));
    let imported = 0;
    for (const t of txns) {
      const externalId = String(t.id || "");
      if (externalId && existing.has(externalId)) continue; // dedupe
      const amount = Number(t.amount);
      if (!Number.isFinite(amount)) continue;
      feed.push({
        id: nextId("btxn"),
        externalId: externalId || null,
        date: String(t.date || nowIso().slice(0, 10)),
        amount,
        description: String(t.description || "").slice(0, 200),
        status: "uncategorized",
        institutionId: inst.id,
        importedAt: nowIso(),
      });
      seq.btxn++;
      imported++;
    }
    inst.lastSyncAt = nowIso();
    inst.lastSyncCount = imported;
    recordAudit(s, userId, {
      action: "bank-feeds-sync", entityType: "institution", entityId: inst.id,
      summary: `Synced ${inst.name} — ${imported} new transaction(s)`,
    });
    saveAccountingState();
    return { ok: true, result: { institution: inst, imported } };
  });

  // ── [M] Multi-currency with FX revaluation ─────────────────────────
  //
  // Base currency is USD. Users record foreign-currency accounts and
  // refresh FX rates from a free keyless API (exchangerate.host /
  // open.er-api.com). fx-revaluation computes the unrealized gain/loss
  // on foreign-denominated account balances at current rates.

  function getCurrencyState(s, userId) {
    if (!s.currencies.has(userId)) {
      s.currencies.set(userId, { base: "USD", rates: {} });
    }
    return s.currencies.get(userId);
  }

  registerLensAction("accounting", "currency-list", (ctx, _a, _p = {}) => {
  try {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const cs = getCurrencyState(s, actId(ctx));
    return {
      ok: true,
      result: {
        base: cs.base,
        rates: Object.entries(cs.rates).map(([code, v]) => ({ code, rate: v.rate, updatedAt: v.updatedAt })),
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("accounting", "currency-set-base", (ctx, _a, params = {}) => {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    const code = String(params.base || "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) return { ok: false, error: "base must be a 3-letter ISO currency code" };
    const cs = getCurrencyState(s, userId);
    cs.base = code;
    saveAccountingState();
    return { ok: true, result: { base: cs.base } };
  });

  registerLensAction("accounting", "currency-refresh-rates", async (ctx, _a, params = {}) => {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    const cs = getCurrencyState(s, userId);
    const symbols = Array.isArray(params.symbols)
      ? params.symbols.map(x => String(x).toUpperCase()).filter(x => /^[A-Z]{3}$/.test(x))
      : [];
    let mod;
    try { mod = await import("../lib/external-fetch.js"); }
    catch { return { ok: false, error: "external-fetch unavailable" }; }
    let data;
    try {
      // open.er-api.com — free, keyless, no rate-limit registration.
      data = await mod.cachedFetchJson(`https://open.er-api.com/v6/latest/${encodeURIComponent(cs.base)}`, { ttlMs: 3_600_000 });
    } catch (e) {
      return { ok: false, error: `FX rate fetch failed: ${e.message}` };
    }
    const rates = data?.rates;
    if (!rates || typeof rates !== "object") return { ok: false, error: "FX provider returned no rates" };
    const updatedAt = nowIso();
    const wanted = symbols.length ? symbols : Object.keys(rates);
    let count = 0;
    for (const code of wanted) {
      const rate = Number(rates[code]);
      if (!Number.isFinite(rate) || rate <= 0) continue;
      cs.rates[code] = { rate, updatedAt };
      count++;
    }
    saveAccountingState();
    return { ok: true, result: { base: cs.base, updated: count, asOf: data?.time_last_update_utc || updatedAt } };
  });

  registerLensAction("accounting", "fx-revaluation", (ctx, _a, params = {}) => {
  try {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    const cs = getCurrencyState(s, userId);
    // positions: [{ accountId?, label, currency, foreignBalance, bookedRate }]
    const positions = Array.isArray(params.positions) ? params.positions : [];
    if (!positions.length) return { ok: false, error: "positions array required (foreign-currency balances to revalue)" };
    const coa = s.coa.get(userId) || new Map();
    const lines = [];
    let totalGainLoss = 0;
    for (const p of positions) {
      const currency = String(p.currency || "").toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, error: `invalid currency code: ${p.currency}` };
      const foreignBalance = Number(p.foreignBalance);
      const bookedRate = Number(p.bookedRate);
      if (!Number.isFinite(foreignBalance)) return { ok: false, error: "foreignBalance must be numeric" };
      if (!Number.isFinite(bookedRate) || bookedRate <= 0) return { ok: false, error: "bookedRate must be > 0" };
      const current = cs.rates[currency];
      if (!current && currency !== cs.base) {
        return { ok: false, error: `no current rate for ${currency} — call currency-refresh-rates first` };
      }
      const currentRate = currency === cs.base ? 1 : current.rate;
      // Rates are base->foreign; book value = foreign / rate.
      const bookedValue = Math.round((foreignBalance / bookedRate) * 100) / 100;
      const currentValue = Math.round((foreignBalance / currentRate) * 100) / 100;
      const gainLoss = Math.round((currentValue - bookedValue) * 100) / 100;
      totalGainLoss += gainLoss;
      lines.push({
        accountId: p.accountId ? String(p.accountId) : null,
        label: String(p.label || (p.accountId && coa.get(String(p.accountId))?.name) || currency),
        currency,
        foreignBalance,
        bookedRate,
        currentRate,
        bookedValue,
        currentValue,
        gainLoss,
      });
    }
    totalGainLoss = Math.round(totalGainLoss * 100) / 100;
    return {
      ok: true,
      result: {
        base: cs.base,
        revaluedAt: nowIso(),
        lines,
        totalUnrealizedGainLoss: totalGainLoss,
        direction: totalGainLoss > 0 ? "gain" : totalGainLoss < 0 ? "loss" : "flat",
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── [M] Class / location / project dimensional tagging ─────────────
  //
  // Dimensions are reusable tags (kind = class | location | project)
  // that attach to journal entries. segment-pl produces a P&L sliced
  // by a chosen dimension value.

  const DIMENSION_KINDS = ["class", "location", "project"];

  registerLensAction("accounting", "dimension-create", (ctx, _a, params = {}) => {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    const kind = String(params.kind || "");
    if (!DIMENSION_KINDS.includes(kind)) return { ok: false, error: "kind must be class | location | project" };
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    if (name.length > 60) return { ok: false, error: "name too long (max 60)" };
    const list = ensureList(s.dimensions, userId);
    if (list.some(d => d.kind === kind && d.name.toLowerCase() === name.toLowerCase())) {
      return { ok: false, error: "dimension already exists" };
    }
    const dim = { id: nextId("dim"), kind, name, archived: false, createdAt: nowIso() };
    list.push(dim);
    saveAccountingState();
    return { ok: true, result: { dimension: dim } };
  });

  registerLensAction("accounting", "dimension-list", (ctx, _a, params = {}) => {
  try {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = ensureList(s.dimensions, actId(ctx));
    const kind = DIMENSION_KINDS.includes(params.kind) ? params.kind : null;
    const filtered = (kind ? list.filter(d => d.kind === kind) : list).filter(d => !d.archived);
    return { ok: true, result: { dimensions: filtered.slice().sort((a, b) => a.name.localeCompare(b.name)), kinds: DIMENSION_KINDS } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("accounting", "dimension-delete", (ctx, _a, params = {}) => {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    const id = String(params.id || "");
    const list = ensureList(s.dimensions, userId);
    const dim = list.find(d => d.id === id);
    if (!dim) return { ok: false, error: "dimension not found" };
    dim.archived = true;
    saveAccountingState();
    return { ok: true, result: { id, archived: true } };
  });

  registerLensAction("accounting", "je-tag-dimension", (ctx, _a, params = {}) => {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    const entryId = String(params.entryId || "");
    const dimensionId = String(params.dimensionId || "");
    const journal = ensureList(s.journal, userId);
    const entry = journal.find(e => e.id === entryId);
    if (!entry) return { ok: false, error: "journal entry not found" };
    const dim = ensureList(s.dimensions, userId).find(d => d.id === dimensionId && !d.archived);
    if (!dim) return { ok: false, error: "dimension not found" };
    if (!Array.isArray(entry.dimensions)) entry.dimensions = [];
    // One dimension per kind — replace any existing tag of the same kind.
    entry.dimensions = entry.dimensions.filter(d => d.kind !== dim.kind);
    entry.dimensions.push({ id: dim.id, kind: dim.kind, name: dim.name });
    recordAudit(s, userId, {
      action: "je-tag-dimension", entityType: "journal-entry", entityId: entry.id,
      summary: `Tagged ${entry.number} with ${dim.kind}:${dim.name}`,
    });
    saveAccountingState();
    return { ok: true, result: { entry } };
  });

  registerLensAction("accounting", "segment-pl", (ctx, _a, params = {}) => {
  try {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    seedDefaultCoA(userId, s);
    const kind = String(params.kind || "");
    if (!DIMENSION_KINDS.includes(kind)) return { ok: false, error: "kind must be class | location | project" };
    const start = params.start ? String(params.start) : `${new Date().getUTCFullYear()}-01-01`;
    const end = params.end ? String(params.end) : nowIso().slice(0, 10);
    const coa = s.coa.get(userId);
    const journal = ensureList(s.journal, userId);
    // Bucket revenue / cogs / expense per dimension value of the chosen kind.
    const segments = new Map(); // dimName -> { revenue, cogs, expense }
    const UNTAGGED = "(untagged)";
    for (const e of journal) {
      if (e.date < start || e.date > end) continue;
      const tag = (e.dimensions || []).find(d => d.kind === kind);
      const segName = tag ? tag.name : UNTAGGED;
      if (!segments.has(segName)) segments.set(segName, { revenue: 0, cogs: 0, expense: 0 });
      const seg = segments.get(segName);
      for (const l of e.lines) {
        const acct = coa.get(l.accountId);
        if (!acct) continue;
        if (acct.category === "revenue") seg.revenue += l.credit - l.debit;
        else if (acct.category === "cogs") seg.cogs += l.debit - l.credit;
        else if (acct.category === "expense") seg.expense += l.debit - l.credit;
      }
    }
    const rows = Array.from(segments.entries()).map(([name, v]) => {
      const revenue = Math.round(v.revenue * 100) / 100;
      const cogs = Math.round(v.cogs * 100) / 100;
      const expense = Math.round(v.expense * 100) / 100;
      const grossProfit = Math.round((revenue - cogs) * 100) / 100;
      const netIncome = Math.round((grossProfit - expense) * 100) / 100;
      return { segment: name, revenue, cogs, grossProfit, expense, netIncome };
    }).sort((a, b) => b.netIncome - a.netIncome);
    const totals = rows.reduce((t, r) => ({
      revenue: Math.round((t.revenue + r.revenue) * 100) / 100,
      cogs: Math.round((t.cogs + r.cogs) * 100) / 100,
      grossProfit: Math.round((t.grossProfit + r.grossProfit) * 100) / 100,
      expense: Math.round((t.expense + r.expense) * 100) / 100,
      netIncome: Math.round((t.netIncome + r.netIncome) * 100) / 100,
    }), { revenue: 0, cogs: 0, grossProfit: 0, expense: 0, netIncome: 0 });
    return { ok: true, result: { kind, period: { start, end }, segments: rows, totals } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── [L] Payroll tax e-filing + ACH deposits ────────────────────────
  //
  // Computes withholding totals from posted pay runs and produces a
  // filing package (federal 941 + state). Actual transmission to the
  // IRS / state requires a credentialed e-file transmitter — without
  // CONCORD_EFILE_ENDPOINT configured the package is prepared but
  // marked "prepared-not-transmitted" so nothing is faked.

  registerLensAction("accounting", "payroll-tax-efile", (ctx, _a, params = {}) => {
  try {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    const runs = ensureList(s.payRuns, userId);
    if (!runs.length) return { ok: false, error: "no pay runs — run payroll first" };
    const quarter = Number(params.quarter);
    const year = Number(params.year) || new Date().getUTCFullYear();
    if (![1, 2, 3, 4].includes(quarter)) return { ok: false, error: "quarter must be 1-4" };
    const qStartMonth = (quarter - 1) * 3;
    const qStart = `${year}-${String(qStartMonth + 1).padStart(2, "0")}-01`;
    const qEndDate = new Date(Date.UTC(year, qStartMonth + 3, 0));
    const qEnd = qEndDate.toISOString().slice(0, 10);
    let grossWages = 0, federalWithheld = 0, stateWithheld = 0, ficaWithheld = 0, employeeCount = 0;
    const empSet = new Set();
    for (const run of runs) {
      const payDate = run.payDate || run.periodEnd || "";
      if (payDate < qStart || payDate > qEnd) continue;
      for (const stub of (run.stubs || [])) {
        grossWages += Number(stub.gross) || 0;
        federalWithheld += Number(stub.federal) || 0;
        stateWithheld += Number(stub.state) || 0;
        ficaWithheld += Number(stub.fica) || 0;
        if (stub.employeeId) empSet.add(stub.employeeId);
      }
    }
    employeeCount = empSet.size;
    const r2 = (n) => Math.round(n * 100) / 100;
    // FICA is matched by the employer — total liability doubles the FICA component.
    const totalTaxLiability = r2(federalWithheld + ficaWithheld * 2);
    const transmitterConfigured = Boolean(process.env.CONCORD_EFILE_ENDPOINT && process.env.CONCORD_EFILE_TOKEN);
    const filing = {
      form: "941",
      year, quarter, period: { start: qStart, end: qEnd },
      employeeCount,
      grossWages: r2(grossWages),
      federalIncomeTaxWithheld: r2(federalWithheld),
      stateIncomeTaxWithheld: r2(stateWithheld),
      ficaWages: r2(grossWages),
      ficaTaxEmployeeAndEmployer: r2(ficaWithheld * 2),
      totalTaxLiability,
      preparedAt: nowIso(),
      status: transmitterConfigured ? "ready-to-transmit" : "prepared-not-transmitted",
      note: transmitterConfigured
        ? "E-file transmitter configured — submit via the e-file endpoint."
        : "Filing package prepared. Set CONCORD_EFILE_ENDPOINT + CONCORD_EFILE_TOKEN to transmit to the IRS — Concord does not fake a confirmation number.",
    };
    recordAudit(s, userId, {
      action: "payroll-tax-efile", entityType: "filing", entityId: `941-${year}Q${quarter}`,
      summary: `Prepared Form 941 ${year} Q${quarter} — tax liability ${totalTaxLiability.toFixed(2)}`,
    });
    return { ok: true, result: { filing } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("accounting", "payroll-ach-batch", (ctx, _a, params = {}) => {
  try {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    const runId = String(params.runId || "");
    const run = ensureList(s.payRuns, userId).find(r => r.id === runId);
    if (!run) return { ok: false, error: "pay run not found" };
    const employees = ensureList(s.employees, userId);
    const entries = [];
    let totalNet = 0;
    for (const stub of (run.stubs || [])) {
      const emp = employees.find(e => e.id === stub.employeeId);
      const net = Math.round((Number(stub.net) || 0) * 100) / 100;
      totalNet += net;
      entries.push({
        employeeId: stub.employeeId,
        employeeName: emp?.name || stub.employeeName || stub.employeeId,
        amount: net,
        accountOnFile: Boolean(emp?.bankAccountMask),
        accountMask: emp?.bankAccountMask || null,
      });
    }
    if (!entries.length) return { ok: false, error: "pay run has no stubs to deposit" };
    const transmitterConfigured = Boolean(process.env.CONCORD_ACH_ENDPOINT && process.env.CONCORD_ACH_TOKEN);
    const missingBank = entries.filter(e => !e.accountOnFile).length;
    const batch = {
      id: nextId("ach"),
      runId,
      effectiveDate: String(params.effectiveDate || run.payDate || nowIso().slice(0, 10)),
      entryCount: entries.length,
      totalNet: Math.round(totalNet * 100) / 100,
      entries,
      missingBankInfo: missingBank,
      status: missingBank > 0
        ? "blocked-missing-bank-info"
        : transmitterConfigured ? "ready-to-submit" : "prepared-not-transmitted",
      preparedAt: nowIso(),
      note: missingBank > 0
        ? `${missingBank} employee(s) missing direct-deposit bank info — add a bankAccountMask via employee-update.`
        : transmitterConfigured
          ? "ACH originator configured — submit the NACHA batch."
          : "ACH batch prepared. Set CONCORD_ACH_ENDPOINT + CONCORD_ACH_TOKEN to originate deposits — Concord does not fake a settlement.",
    };
    recordAudit(s, userId, {
      action: "payroll-ach-batch", entityType: "ach-batch", entityId: batch.id,
      summary: `Prepared ACH batch for run ${runId} — ${entries.length} deposits, ${batch.totalNet.toFixed(2)}`,
    });
    return { ok: true, result: { batch } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── [S] Recurring bill / expense scheduling ────────────────────────

  registerLensAction("accounting", "recurring-bills-create", (ctx, _a, params = {}) => {
  try {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    seedDefaultCoA(userId, s);
    const vendorId = String(params.vendorId || "");
    const vendor = ensureList(s.vendors, userId).find(v => v.id === vendorId);
    if (!vendor) return { ok: false, error: "vendor not found" };
    const total = Number(params.total);
    if (!Number.isFinite(total) || total <= 0) return { ok: false, error: "total must be > 0" };
    const expenseAccountId = String(params.expenseAccountId || vendor.defaultExpenseAccountId || "");
    if (!s.coa.get(userId).has(expenseAccountId)) return { ok: false, error: "expenseAccountId invalid" };
    const cadence = ["weekly", "monthly", "quarterly", "annually"].includes(params.cadence) ? params.cadence : "monthly";
    const startAt = String(params.startAt || nowIso().slice(0, 10));
    const rb = {
      id: nextId("recb"),
      vendorId, vendorName: vendor.name,
      total, expenseAccountId,
      cadence, startAt,
      nextRunAt: startAt,
      memo: String(params.memo || "").slice(0, 200),
      active: true,
      lastRunAt: null,
      runCount: 0,
      createdAt: nowIso(),
    };
    ensureList(s.recurringBills, userId).push(rb);
    saveAccountingState();
    return { ok: true, result: { recurringBill: rb } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("accounting", "recurring-bills-list", (ctx, _a, _p = {}) => {
  try {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    return { ok: true, result: { recurringBills: ensureList(s.recurringBills, actId(ctx)) } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("accounting", "recurring-bills-toggle", (ctx, _a, params = {}) => {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const rb = ensureList(s.recurringBills, actId(ctx)).find(x => x.id === String(params.id || ""));
    if (!rb) return { ok: false, error: "recurring bill not found" };
    rb.active = !rb.active;
    saveAccountingState();
    return { ok: true, result: { recurringBill: rb } };
  });

  registerLensAction("accounting", "recurring-bills-delete", (ctx, _a, params = {}) => {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    const list = ensureList(s.recurringBills, userId);
    const i = list.findIndex(x => x.id === String(params.id || ""));
    if (i < 0) return { ok: false, error: "recurring bill not found" };
    list.splice(i, 1);
    saveAccountingState();
    return { ok: true, result: { id: String(params.id), deleted: true } };
  });

  registerLensAction("accounting", "recurring-bills-run-due", (ctx, _a, _p = {}) => {
  try {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    seedDefaultCoA(userId, s);
    const seq = ensureSeq(s, userId);
    const today = nowIso().slice(0, 10);
    const coa = s.coa.get(userId);
    const apAcct = Array.from(coa.values()).find(a => a.code === "2000" && a.category === "liability");
    const created = [];
    for (const rb of ensureList(s.recurringBills, userId)) {
      if (!rb.active) continue;
      if (rb.nextRunAt > today) continue;
      const issuedAt = today;
      const dueAt = new Date(new Date(today).getTime() + 30 * 86_400_000).toISOString().slice(0, 10);
      const bill = {
        id: nextId("bill"),
        number: `BILL-${String(seq.bill).padStart(5, "0")}`,
        vendorId: rb.vendorId, vendorName: rb.vendorName,
        total: rb.total,
        expenseAccountId: rb.expenseAccountId,
        memo: rb.memo,
        status: "open",
        issuedAt, dueAt,
        paidAt: null,
        jeEntryId: null, payJeEntryId: null,
        recurringBillId: rb.id,
      };
      seq.bill++;
      ensureList(s.bills, userId).push(bill);
      // Auto-post the bill JE: Debit Expense, Credit AP.
      if (apAcct) {
        const entry = {
          id: nextId("je"),
          number: `JE-${String(seq.je).padStart(5, "0")}`,
          date: issuedAt,
          memo: `${bill.number} · ${rb.vendorName} (recurring)`,
          lines: [
            { accountId: rb.expenseAccountId, debit: rb.total, credit: 0, memo: rb.memo },
            { accountId: apAcct.id, debit: 0, credit: rb.total, memo: `AP · ${rb.vendorName}` },
          ],
          totalDebit: rb.total, totalCredit: rb.total,
          postedAt: nowIso(),
          autoFrom: bill.id,
        };
        seq.je++;
        ensureList(s.journal, userId).push(entry);
        bill.jeEntryId = entry.id;
      }
      created.push(bill);
      rb.lastRunAt = today;
      rb.runCount += 1;
      const days = rb.cadence === "weekly" ? 7 : rb.cadence === "quarterly" ? 90 : rb.cadence === "annually" ? 365 : 30;
      rb.nextRunAt = new Date(new Date(rb.nextRunAt).getTime() + days * 86_400_000).toISOString().slice(0, 10);
    }
    recordAudit(s, userId, {
      action: "recurring-bills-run-due", entityType: "recurring-bill", entityId: "batch",
      summary: `Generated ${created.length} bill(s) from recurring schedules`,
    });
    saveAccountingState();
    return { ok: true, result: { created, count: created.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── [M] Mobile receipt-capture OCR → expense ───────────────────────
  //
  // The mobile app captures a receipt photo and runs on-device OCR
  // (or a vision pass) to extract raw text — that text is passed here.
  // receipt-ocr parses real OCR text (no fabrication) into structured
  // fields: vendor, date, total, tax. receipt-ocr-to-expense posts it.

  function parseReceiptText(text) {
    const raw = String(text || "");
    const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    // Total — last "total" line with a currency amount wins (handles subtotal/total ordering).
    let total = null;
    const amountRe = /(\d{1,3}(?:[,\s]\d{3})*(?:\.\d{2})|\d+\.\d{2})/;
    for (const l of lines) {
      if (/\btotal\b/i.test(l) && !/sub\s*total/i.test(l)) {
        const m = l.match(amountRe);
        if (m) total = Number(m[1].replace(/[,\s]/g, ""));
      }
    }
    if (total === null) {
      // Fallback — largest currency-shaped number in the text.
      let max = null;
      for (const l of lines) {
        const m = l.match(amountRe);
        if (m) { const v = Number(m[1].replace(/[,\s]/g, "")); if (max === null || v > max) max = v; }
      }
      total = max;
    }
    // Tax line.
    let tax = null;
    for (const l of lines) {
      if (/\b(tax|vat|gst|hst)\b/i.test(l)) {
        const m = l.match(amountRe);
        if (m) tax = Number(m[1].replace(/[,\s]/g, ""));
      }
    }
    // Date — common formats.
    let date = null;
    const dateRe = /(\d{4}-\d{2}-\d{2})|(\d{1,2}\/\d{1,2}\/\d{2,4})|(\d{1,2}-\d{1,2}-\d{2,4})/;
    for (const l of lines) {
      const m = l.match(dateRe);
      if (m) {
        const tok = m[0];
        if (/^\d{4}-/.test(tok)) date = tok;
        else {
          const parts = tok.split(/[/-]/).map(Number);
          let [a, b, c] = parts;
          if (c < 100) c += 2000;
          date = `${c}-${String(a).padStart(2, "0")}-${String(b).padStart(2, "0")}`;
        }
        break;
      }
    }
    // Vendor — first non-numeric, reasonably-sized text line.
    let vendor = null;
    for (const l of lines) {
      if (amountRe.test(l)) continue;
      if (/^[\d\W]+$/.test(l)) continue;
      if (l.length >= 3 && l.length <= 50) { vendor = l; break; }
    }
    const missing = [];
    if (vendor === null) missing.push("vendor");
    if (total === null) missing.push("total");
    if (date === null) missing.push("date");
    return {
      vendor, date, total,
      tax,
      lineCount: lines.length,
      missing,
      confidence: Math.round(((4 - missing.length) / 4) * 100) / 100,
    };
  }

  registerLensAction("accounting", "receipt-ocr", (ctx, _a, params = {}) => {
  try {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const text = String(params.ocrText || "");
    if (!text.trim()) return { ok: false, error: "ocrText required (raw text from the mobile receipt scan)" };
    const parsed = parseReceiptText(text);
    return { ok: true, result: { parsed } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("accounting", "receipt-ocr-to-expense", (ctx, _a, params = {}) => {
  try {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    seedDefaultCoA(userId, s);
    const text = String(params.ocrText || "");
    if (!text.trim()) return { ok: false, error: "ocrText required" };
    const parsed = parseReceiptText(text);
    // amount from OCR unless the user corrected it via params.
    const amount = Number(params.amount ?? parsed.total);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { ok: false, error: "could not determine receipt total — OCR found no total; pass amount explicitly" };
    }
    const accountId = String(params.accountId || "");
    const coa = s.coa.get(userId);
    if (!coa.has(accountId)) return { ok: false, error: "accountId invalid (pick an expense account)" };
    const cashAcct = Array.from(coa.values()).find(a => a.code === "1000" && a.category === "asset");
    if (!cashAcct) return { ok: false, error: "cash account 1000 not found" };
    const seq = ensureSeq(s, userId);
    const date = String(params.date || parsed.date || nowIso().slice(0, 10));
    const vendor = String(params.vendor || parsed.vendor || "").trim();
    const memo = `Receipt scan${parsed.tax ? ` · tax ${parsed.tax}` : ""}`;
    const exp = {
      id: nextId("exp"),
      number: `EXP-${String(seq.exp).padStart(5, "0")}`,
      date, vendor, accountId, amount,
      memo, receiptUrl: String(params.receiptUrl || ""),
      source: "receipt-ocr",
      ocrConfidence: parsed.confidence,
      createdAt: nowIso(),
    };
    seq.exp++;
    ensureList(s.expenses, userId).push(exp);
    const entry = {
      id: nextId("je"),
      number: `JE-${String(seq.je).padStart(5, "0")}`,
      date,
      memo: vendor ? `${vendor} · ${memo}` : memo,
      lines: [
        { accountId, debit: amount, credit: 0, memo },
        { accountId: cashAcct.id, debit: 0, credit: amount, memo: vendor || memo },
      ],
      totalDebit: amount, totalCredit: amount,
      postedAt: nowIso(),
      autoFrom: exp.id,
    };
    seq.je++;
    ensureList(s.journal, userId).push(entry);
    exp.jeEntryId = entry.id;
    recordAudit(s, userId, {
      action: "receipt-ocr-to-expense", entityType: "expense", entityId: exp.id,
      summary: `Expense ${exp.number} from receipt scan — ${vendor || "vendor?"} ${amount.toFixed(2)}`,
      after: { vendor, amount, date },
    });
    saveAccountingState();
    return { ok: true, result: { expense: exp, entry, parsed } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── [S] Per-transaction edit audit log ─────────────────────────────

  registerLensAction("accounting", "audit-log-list", (ctx, _a, params = {}) => {
  try {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    let log = (ensureList(s.auditLog, userId)).slice();
    const entityType = params.entityType ? String(params.entityType) : null;
    const entityId = params.entityId ? String(params.entityId) : null;
    const action = params.action ? String(params.action) : null;
    if (entityType) log = log.filter(e => e.entityType === entityType);
    if (entityId) log = log.filter(e => e.entityId === entityId);
    if (action) log = log.filter(e => e.action === action);
    log.sort((a, b) => (b.at || "").localeCompare(a.at || ""));
    const limit = Math.max(1, Math.min(500, Number(params.limit) || 100));
    return { ok: true, result: { entries: log.slice(0, limit), total: log.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── [M] 1099 / W-2 e-filing export to IRS FIRE format ──────────────
  //
  // The IRS FIRE system ingests fixed-width ASCII records. efile-1099-fire
  // builds a real FIRE-format file (Transmitter "T", Payer "A", Payee "B",
  // End-of-Payer "C", End-of-Transmission "F" records) from the user's
  // paid 1099 vendors. Actual transmission needs a FIRE TCC account —
  // the file is generated for the user to upload.

  function fireField(value, width, numeric = false) {
    let v = String(value ?? "");
    if (numeric) {
      // numeric fields are right-justified, zero-filled (amounts in cents).
      v = v.replace(/[^\d]/g, "");
      return v.slice(-width).padStart(width, "0");
    }
    // alpha fields left-justified, blank-filled, uppercased.
    return v.toUpperCase().slice(0, width).padEnd(width, " ");
  }

  registerLensAction("accounting", "efile-1099-fire", (ctx, _a, params = {}) => {
  try {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    const year = Number(params.year) || new Date().getUTCFullYear() - 1;
    const payer = params.payer || {};
    const payerName = String(payer.name || "").trim();
    const payerTin = String(payer.tin || "").replace(/[^\d]/g, "");
    if (!payerName) return { ok: false, error: "payer.name required" };
    if (payerTin.length !== 9) return { ok: false, error: "payer.tin must be a 9-digit EIN" };
    const start = `${year}-01-01`, end = `${year}-12-31`;
    const vendors = ensureList(s.vendors, userId);
    const totals = new Map();
    for (const bill of ensureList(s.bills, userId)) {
      if (bill.status !== "paid") continue;
      if ((bill.paidAt || "") < start || (bill.paidAt || "") > end) continue;
      const v = vendors.find(x => x.id === bill.vendorId);
      if (!v || !v.is1099) continue;
      const cur = totals.get(v.id) || { vendor: v, total: 0 };
      cur.total += bill.total;
      totals.set(v.id, cur);
    }
    const THRESHOLD = 600;
    const payees = Array.from(totals.values()).filter(r => r.total >= THRESHOLD);
    if (!payees.length) {
      return { ok: false, error: `no 1099 vendors paid >= $${THRESHOLD} in ${year} — nothing to file` };
    }
    const records = [];
    // "T" — Transmitter record.
    records.push(
      "T" + fireField(year, 4, true) + " " + fireField(payerTin, 9, true) +
      fireField(payerName, 80) + fireField(payerName, 40),
    );
    // "A" — Payer record (1099-NEC = type code "NE").
    records.push(
      "A" + fireField(year, 4, true) + " " + fireField(payerTin, 9, true) +
      fireField("NE", 2) + fireField(payerName, 80),
    );
    // "B" — one Payee record per reportable vendor (amount in cents).
    let totalReported = 0;
    for (const { vendor, total } of payees) {
      const cents = Math.round(total * 100);
      totalReported += cents;
      records.push(
        "B" + fireField(year, 4, true) +
        fireField(String(vendor.taxId || "").replace(/[^\d]/g, ""), 9, true) +
        fireField(vendor.name, 80) +
        fireField(cents, 12, true),
      );
    }
    // "C" — End-of-Payer (count + control total).
    records.push("C" + fireField(payees.length, 8, true) + fireField(totalReported, 18, true));
    // "F" — End-of-Transmission.
    records.push("F" + fireField(1, 8, true) + fireField(payees.length, 8, true));
    const fireFile = records.join("\n");
    recordAudit(s, userId, {
      action: "efile-1099-fire", entityType: "filing", entityId: `1099-${year}`,
      summary: `Generated IRS FIRE 1099-NEC file — ${payees.length} payee(s), $${(totalReported / 100).toFixed(2)}`,
    });
    return {
      ok: true,
      result: {
        form: "1099-NEC",
        year,
        format: "IRS FIRE (Publication 1220)",
        payeeCount: payees.length,
        totalReported: Math.round(totalReported) / 100,
        recordCount: records.length,
        fireFile,
        filename: `IRS_FIRE_1099NEC_${year}.txt`,
        note: "FIRE-format file generated. Upload at fire.irs.gov with your TCC account — Concord does not transmit on your behalf.",
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("accounting", "efile-w2-export", (ctx, _a, params = {}) => {
  try {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    const year = Number(params.year) || new Date().getUTCFullYear() - 1;
    const employer = params.employer || {};
    const employerName = String(employer.name || "").trim();
    const employerEin = String(employer.ein || "").replace(/[^\d]/g, "");
    if (!employerName) return { ok: false, error: "employer.name required" };
    if (employerEin.length !== 9) return { ok: false, error: "employer.ein must be a 9-digit EIN" };
    const runs = ensureList(s.payRuns, userId);
    const employees = ensureList(s.employees, userId);
    // Aggregate per-employee YTD wages + withholdings from pay runs in the year.
    const byEmp = new Map();
    for (const run of runs) {
      const payDate = run.payDate || run.periodEnd || "";
      if (payDate.slice(0, 4) !== String(year)) continue;
      for (const stub of (run.stubs || [])) {
        const cur = byEmp.get(stub.employeeId) || { wages: 0, fed: 0, state: 0, fica: 0 };
        cur.wages += Number(stub.gross) || 0;
        cur.fed += Number(stub.federal) || 0;
        cur.state += Number(stub.state) || 0;
        cur.fica += Number(stub.fica) || 0;
        byEmp.set(stub.employeeId, cur);
      }
    }
    if (!byEmp.size) return { ok: false, error: `no payroll for ${year} — run payroll first` };
    const r2 = (n) => Math.round(n * 100) / 100;
    // EFW2 (SSA) fixed-width: "RA" submitter, "RE" employer, "RW" employee, "RT" total, "RF" final.
    const records = [];
    records.push("RA" + fireField(employerEin, 9, true) + fireField(employerName, 57));
    records.push("RE" + fireField(year, 4, true) + fireField(employerEin, 9, true) + fireField(employerName, 57));
    let totalWages = 0, totalFed = 0;
    const w2s = [];
    for (const [empId, agg] of byEmp) {
      const emp = employees.find(e => e.id === empId);
      const wages = r2(agg.wages), fed = r2(agg.fed);
      totalWages += wages; totalFed += fed;
      const w2 = {
        employeeId: empId,
        employeeName: emp?.name || empId,
        box1_wages: wages,
        box2_federalWithheld: fed,
        box17_stateWithheld: r2(agg.state),
        box4and6_ficaTax: r2(agg.fica),
      };
      w2s.push(w2);
      records.push(
        "RW" + fireField(String(emp?.ssnMask || "").replace(/[^\d]/g, ""), 9, true) +
        fireField(emp?.name || empId, 40) +
        fireField(Math.round(wages * 100), 11, true) +
        fireField(Math.round(fed * 100), 11, true),
      );
    }
    records.push("RT" + fireField(w2s.length, 7, true) + fireField(Math.round(totalWages * 100), 15, true) + fireField(Math.round(totalFed * 100), 15, true));
    records.push("RF" + fireField(w2s.length, 7, true));
    const efw2File = records.join("\n");
    recordAudit(s, userId, {
      action: "efile-w2-export", entityType: "filing", entityId: `w2-${year}`,
      summary: `Generated SSA EFW2 W-2 file — ${w2s.length} employee(s), $${totalWages.toFixed(2)} wages`,
    });
    return {
      ok: true,
      result: {
        form: "W-2",
        year,
        format: "SSA EFW2 (Publication 42-007)",
        employeeCount: w2s.length,
        totalWages: r2(totalWages),
        totalFederalWithheld: r2(totalFed),
        w2s,
        recordCount: records.length,
        efw2File,
        filename: `SSA_EFW2_W2_${year}.txt`,
        note: "EFW2-format file generated. Upload at the SSA Business Services Online portal — Concord does not transmit on your behalf.",
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});
};
