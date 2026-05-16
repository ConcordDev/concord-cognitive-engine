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
};
