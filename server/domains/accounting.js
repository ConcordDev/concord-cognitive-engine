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
        debitSum += parseFloat(entry.debit) || 0;
        creditSum += parseFloat(entry.credit) || 0;
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
  });

  /**
   * profitLoss
   * Generate a P&L statement for a given period.
   * artifact.data.accounts: same as trialBalance
   * params.startDate, params.endDate — period boundaries
   */
  registerLensAction("accounting", "profitLoss", (ctx, artifact, params) => {
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
            const credit = parseFloat(entry.credit) || 0;
            const debit = parseFloat(entry.debit) || 0;
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
            const debit = parseFloat(entry.debit) || 0;
            const credit = parseFloat(entry.credit) || 0;
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
  });

  /**
   * invoiceAging
   * Categorize unpaid invoices by age buckets: current, 1-30, 31-60, 61-90, 90+.
   * artifact.data.invoices: [{ invoiceId, customer, amount, issueDate, dueDate, paidDate }]
   */
  registerLensAction("accounting", "invoiceAging", (ctx, artifact, params) => {
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
      const amount = parseFloat(inv.amount) || 0;

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
      const amount = parseFloat(inv.amount) || 0;
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
  });

  /**
   * budgetVariance
   * Compare actual vs planned amounts for budget line items.
   * artifact.data.budget: [{ category, planned, actual }]
   * params.period — label for the period
   */
  registerLensAction("accounting", "budgetVariance", (ctx, artifact, params) => {
    const budget = artifact.data.budget || [];
    const period = params.period || "current";

    let totalPlanned = 0;
    let totalActual = 0;

    const lines = budget.map((item) => {
      const planned = parseFloat(item.planned) || 0;
      const actual = parseFloat(item.actual) || 0;
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
  });

  /**
   * rentRoll
   * Aggregate properties and their rent payment status.
   * artifact.data.properties: [{ propertyId, address, units: [{ unitId, tenant, monthlyRent, leaseEnd, paidThrough }] }]
   * params.asOfMonth — "YYYY-MM" to check (defaults to current month)
   */
  registerLensAction("accounting", "rentRoll", (ctx, artifact, params) => {
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
        const rent = parseFloat(unit.monthlyRent) || 0;
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
    const accounts = artifact.data?.accounts || [];
    let totalDebits = 0;
    let totalCredits = 0;
    const accountIssues = [];

    for (const acct of accounts) {
      let dr = 0;
      let cr = 0;
      for (const entry of (acct.entries || [])) {
        dr += parseFloat(entry.debit) || 0;
        cr += parseFloat(entry.credit) || 0;
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
    const lineItems = artifact.data?.lineItems || params?.lineItems || [];
    const client = params?.client || artifact.data?.client || {};
    const dueDays = Number(params?.dueDays) || 30;
    const issueDate = new Date();
    const dueDate = new Date(issueDate.getTime() + dueDays * 86_400_000);

    const enriched = lineItems.map((li, i) => {
      const qty = Number(li.quantity) || 0;
      const unit = Number(li.unitPrice) || 0;
      const subtotal = Math.round(qty * unit * 100) / 100;
      const taxRate = Number(li.taxRate) || 0;
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
    const bankLines = (artifact.data?.bankLines || []).filter(l => !l.matchedTxId);
    const transactions = (artifact.data?.transactions || []).filter(t => !t.reconciled);

    const matches = [];
    const used = new Set();

    for (const bl of bankLines) {
      const blAmt = Number(bl.amount) || 0;
      const blDate = new Date(bl.date);
      const blTokens = String(bl.description || '').toLowerCase().split(/\W+/).filter(t => t.length >= 3);

      let bestTx = null;
      let bestScore = 0;
      for (const tx of transactions) {
        if (used.has(tx.id)) continue;
        const txAmt = Number(tx.amount) || 0;
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
  });

  /**
   * generate-statements
   * Builds Income Statement (P&L) + Balance Sheet + Cash Flow snapshot
   * in one payload. Reuses the trialBalance + profitLoss math for
   * shape consistency.
   */
  registerLensAction("accounting", "generate-statements", (ctx, artifact, params) => {
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
        const dr = parseFloat(entry.debit) || 0;
        const cr = parseFloat(entry.credit) || 0;
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
  });

  /**
   * audit-trail
   * Verifies no gaps in the financial artifact audit trail. Checks
   * for missing transaction sequence numbers, orphaned ledger entries
   * (no matching transaction), and accounts with entries but no
   * matching account record.
   */
  registerLensAction("accounting", "audit-trail", (ctx, artifact, _params) => {
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
    return s;
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
    const s = getAccountingState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    seedDefaultCoA(userId, s);
    const accounts = Array.from(s.coa.get(userId).values())
      .sort((a, b) => a.code.localeCompare(b.code));
    return { ok: true, result: { accounts, categories: COA_CATEGORIES } };
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
      const debit = Number(l.debit) || 0;
      const credit = Number(l.credit) || 0;
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
    saveAccountingState();
    return { ok: true, result: { entry } };
  });

  // ── Ledger (paginated transaction list with filtering) ──

  registerLensAction("accounting", "ledger-list", (ctx, _artifact, params = {}) => {
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
  });

  // ── Balance Sheet (computed from journal) ──

  registerLensAction("accounting", "balance-sheet-compute", (ctx, _artifact, params = {}) => {
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
  });

  // ── AR Aging Report (buckets from invoices) ──

  registerLensAction("accounting", "invoice-create", (ctx, _artifact, params = {}) => {
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
  });

  // ── Customers (CRM-lite for invoicing) ─────────────────────────

  registerLensAction("accounting", "customers-list", (ctx, _a, _p = {}) => {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = ensureList(s.customers, actId(ctx));
    return { ok: true, result: { customers: list.slice().sort((a, b) => a.name.localeCompare(b.name)) } };
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
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = ensureList(s.vendors, actId(ctx));
    return { ok: true, result: { vendors: list.slice().sort((a, b) => a.name.localeCompare(b.name)) } };
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
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const status = ["open", "paid", "all"].includes(params.status) ? params.status : "all";
    const list = ensureList(s.bills, actId(ctx));
    const filtered = status === "all" ? list : list.filter(b => b.status === status);
    return { ok: true, result: { bills: filtered.slice().sort((a, b) => (b.issuedAt || "").localeCompare(a.issuedAt || "")) } };
  });

  registerLensAction("accounting", "bills-create", (ctx, _a, params = {}) => {
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
  });

  registerLensAction("accounting", "bills-pay", (ctx, _a, params = {}) => {
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
  });

  // ── P&L from journal (real, not artifact-driven) ──────────────

  registerLensAction("accounting", "pl-compute", (ctx, _a, params = {}) => {
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
  });

  // ── Cash flow (direct method, from cash-account journal activity) ─

  registerLensAction("accounting", "cashflow-compute", (ctx, _a, params = {}) => {
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
  });

  // ── Runway forecast (cash + AR − AP, projected months) ────────

  registerLensAction("accounting", "runway-forecast", (ctx, _a, params = {}) => {
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
  });

  // ── Recurring invoices ────────────────────────────────────────

  registerLensAction("accounting", "recurring-invoices-list", (ctx, _a, _p = {}) => {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    return { ok: true, result: { recurring: ensureList(s.recurring, actId(ctx)) } };
  });

  registerLensAction("accounting", "recurring-invoices-create", (ctx, _a, params = {}) => {
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
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    return { ok: true, result: { estimates: ensureList(s.estimates, actId(ctx)) } };
  });

  registerLensAction("accounting", "estimates-create", (ctx, _a, params = {}) => {
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
  });

  registerLensAction("accounting", "estimates-convert", (ctx, _a, params = {}) => {
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
  });

  // ── Bank feeds (transaction inbox) ─────────────────────────────

  registerLensAction("accounting", "bank-feeds-list", (ctx, _a, params = {}) => {
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const status = ["uncategorized", "categorized", "all"].includes(params.status) ? params.status : "uncategorized";
    const list = ensureList(s.bankTxns, actId(ctx));
    const filtered = status === "all" ? list : list.filter(t => (status === "uncategorized") ? !t.accountId : !!t.accountId);
    return { ok: true, result: { txns: filtered.slice().sort((a, b) => b.date.localeCompare(a.date)) } };
  });

  registerLensAction("accounting", "bank-feeds-import", (ctx, _a, params = {}) => {
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
  });

  registerLensAction("accounting", "bank-feeds-categorize", (ctx, _a, params = {}) => {
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
  });

  // ── AI suggest vendor for a bank txn description ──────────────

  registerLensAction("accounting", "ai-suggest-vendor", (ctx, _a, params = {}) => {
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
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    return { ok: true, result: { rules: ensureList(s.catRules, actId(ctx)) } };
  });

  registerLensAction("accounting", "category-rules-create", (ctx, _a, params = {}) => {
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
    const s = getAccountingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = ensureList(s.expenses, actId(ctx));
    return { ok: true, result: { expenses: list.slice().sort((a, b) => (b.date || "").localeCompare(a.date || "")) } };
  });

  registerLensAction("accounting", "expenses-create", (ctx, _a, params = {}) => {
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
  });

  // ── 1099 summary (vendor totals for the tax year) ──────────────

  registerLensAction("accounting", "summary-1099", (ctx, _a, params = {}) => {
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
  });

  // ── Dashboard summary (KPI strip) ──────────────────────────────

  registerLensAction("accounting", "dashboard-summary", (ctx, _a, _p = {}) => {
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
  });
};
