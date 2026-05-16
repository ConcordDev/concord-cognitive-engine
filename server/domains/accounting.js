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
        coa: new Map(),      // userId -> Map<accountId, account>
        journal: new Map(),  // userId -> Array<{ id, date, memo, lines: [{ accountId, debit, credit }] }>
        invoices: new Map(), // userId -> Array<{ id, customerId, customerName, total, status, issuedAt, dueAt, paidAt? }>
        seq: new Map(),      // userId -> { je: 1, inv: 1 }
      };
    }
    return STATE.accountingLens;
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
};
