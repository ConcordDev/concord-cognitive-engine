export default function registerLegalActions(registerLensAction) {
  // Fail-CLOSED numeric coercion. parseFloat("Infinity") === Infinity and
  // Number("1e999") === Infinity both slip past a bare `|| 0`, leaking a
  // non-finite value into a rendered total. finiteNum rejects NaN/±Infinity and
  // any non-finite coercion back to the supplied fallback (default 0).
  const finiteNum = (v, fallback = 0) => {
    const n = typeof v === "number" ? v : parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  };

  registerLensAction("legal", "deadlineCheck", (ctx, artifact, params) => {
    const now = new Date();
    const items = artifact.data?.items || [];
    const upcoming = items.filter(i => {
      if (!i.deadline) return false;
      const dl = new Date(i.deadline);
      const daysUntil = (dl - now) / (1000 * 60 * 60 * 24);
      return daysUntil >= 0 && daysUntil <= (params.daysAhead || 30);
    }).map(i => ({
      ...i,
      daysUntil: Math.ceil((new Date(i.deadline) - now) / (1000 * 60 * 60 * 24)),
    })).sort((a, b) => a.daysUntil - b.daysUntil);
    return { ok: true, result: { upcoming, count: upcoming.length } };
  });

  registerLensAction("legal", "contractRenewal", (ctx, artifact, _params) => {
    const expiryDate = artifact.data?.expiryDate ? new Date(artifact.data.expiryDate) : null;
    if (!expiryDate) return { ok: true, result: { status: "no_expiry", message: "No expiry date set" } };
    // Fail-CLOSED: an unparseable expiry date would yield a NaN daysUntilExpiry
    // that leaks into the rendered urgency band — reject it as no_expiry.
    if (Number.isNaN(expiryDate.getTime())) return { ok: true, result: { status: "no_expiry", message: "Invalid expiry date" } };
    const now = new Date();
    const daysUntilExpiry = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
    const autoRenewal = artifact.data?.renewalType === 'auto';
    return {
      ok: true,
      result: {
        contractId: artifact.id,
        title: artifact.title,
        expiryDate: artifact.data.expiryDate,
        daysUntilExpiry,
        autoRenewal,
        actionRequired: daysUntilExpiry <= 60,
        urgency: daysUntilExpiry <= 14 ? 'critical' : daysUntilExpiry <= 30 ? 'high' : daysUntilExpiry <= 60 ? 'medium' : 'low',
      },
    };
  });

  registerLensAction("legal", "conflictCheck", (ctx, artifact, params) => {
    const parties = artifact.data?.parties || [];
    const client = artifact.data?.client || '';
    const opposingParty = artifact.data?.opposingParty || '';
    const conflicts = [];
    if (params.checkAgainst) {
      for (const name of params.checkAgainst) {
        if (parties.includes(name) || client === name || opposingParty === name) {
          conflicts.push({ name, conflictType: 'direct_party', caseId: artifact.id });
        }
      }
    }
    return { ok: true, result: { conflicts, hasConflict: conflicts.length > 0, checkedAt: new Date().toISOString() } };
  });

  registerLensAction("legal", "caseSummary", (ctx, artifact, _params) => {
    const parties = artifact.data?.parties || [];
    const client = artifact.data?.client || '';
    const opposingParty = artifact.data?.opposingParty || '';
    const status = artifact.data?.status || 'unknown';
    const filingDate = artifact.data?.filingDate || null;
    const closingDate = artifact.data?.closingDate || null;
    const documents = artifact.data?.documents || [];
    const timeEntries = artifact.data?.timeEntries || [];
    const billingTotal = Math.round(timeEntries.reduce((sum, e) => {
      const hours = finiteNum(e.hours);
      const rate = finiteNum(e.rate);
      return sum + hours * rate;
    }, 0) * 100) / 100;
    const keyDates = [];
    if (filingDate) keyDates.push({ event: 'Filing', date: filingDate });
    if (closingDate) keyDates.push({ event: 'Closing', date: closingDate });
    if (artifact.data?.nextHearing) keyDates.push({ event: 'Next Hearing', date: artifact.data.nextHearing });
    if (artifact.data?.trialDate) keyDates.push({ event: 'Trial', date: artifact.data.trialDate });
    return {
      ok: true,
      result: {
        caseId: artifact.id,
        title: artifact.title,
        client,
        opposingParty,
        parties,
        status,
        keyDates,
        relatedDocumentsCount: documents.length,
        billingTotal,
        generatedAt: new Date().toISOString(),
      },
    };
  });

  registerLensAction("legal", "complianceAudit", (ctx, artifact, _params) => {
    const requirements = artifact.data?.requirements || [];
    const now = new Date();
    const findings = [];
    let passCount = 0;
    let failCount = 0;
    const checked = requirements.map(req => {
      const deadline = req.deadline ? new Date(req.deadline) : null;
      const isOverdue = deadline && deadline < now && req.status !== 'compliant';
      const passed = req.status === 'compliant' && !isOverdue;
      if (passed) passCount++; else failCount++;
      if (!passed) {
        findings.push({
          requirement: req.name || req.description || 'Unknown',
          reason: isOverdue ? 'overdue' : (req.status || 'non-compliant'),
          deadline: req.deadline || null,
          severity: isOverdue ? 'high' : 'medium',
        });
      }
      return {
        requirement: req.name || req.description || 'Unknown',
        status: passed ? 'pass' : 'fail',
        deadline: req.deadline || null,
      };
    });
    const score = requirements.length > 0 ? Math.round((passCount / requirements.length) * 100) : 100;
    return {
      ok: true,
      result: {
        auditedAt: new Date().toISOString(),
        totalRequirements: requirements.length,
        passed: passCount,
        failed: failCount,
        score,
        rating: score >= 90 ? 'excellent' : score >= 70 ? 'good' : score >= 50 ? 'fair' : 'poor',
        findings,
        checklist: checked,
      },
    };
  });

  registerLensAction("legal", "deadlineCalculator", (ctx, artifact, params) => {
    const filingDate = artifact.data?.filingDate || params.filingDate;
    if (!filingDate) return { ok: true, result: { error: 'No filing date provided' } };
    const base = new Date(filingDate);
    // Fail-CLOSED: an unparseable filing date yields an Invalid Date whose
    // .toISOString() throws RangeError inside addDays — reject before computing.
    if (Number.isNaN(base.getTime())) return { ok: true, result: { error: 'Invalid filing date' } };
    const jurisdiction = artifact.data?.jurisdiction || params.jurisdiction || 'default';
    const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r.toISOString().split('T')[0]; };

    const rules = {
      federal: { responseDays: 21, discoveryDays: 180, motionDays: 14, trialDays: 365, extensionDays: 30 },
      state: { responseDays: 30, discoveryDays: 120, motionDays: 21, trialDays: 270, extensionDays: 14 },
      default: { responseDays: 30, discoveryDays: 150, motionDays: 21, trialDays: 300, extensionDays: 21 },
    };
    const r = rules[jurisdiction] || rules.default;

    const deadlines = [
      { event: 'Response Due', date: addDays(base, r.responseDays), daysFromFiling: r.responseDays },
      { event: 'Response Extension', date: addDays(base, r.responseDays + r.extensionDays), daysFromFiling: r.responseDays + r.extensionDays },
      { event: 'Discovery Cutoff', date: addDays(base, r.discoveryDays), daysFromFiling: r.discoveryDays },
      { event: 'Motion Deadline', date: addDays(base, r.discoveryDays + r.motionDays), daysFromFiling: r.discoveryDays + r.motionDays },
      { event: 'Estimated Trial', date: addDays(base, r.trialDays), daysFromFiling: r.trialDays },
    ];

    const now = new Date();
    for (const dl of deadlines) {
      const d = new Date(dl.date);
      dl.daysRemaining = Math.ceil((d - now) / (1000 * 60 * 60 * 24));
      dl.status = dl.daysRemaining < 0 ? 'past' : dl.daysRemaining <= 7 ? 'urgent' : dl.daysRemaining <= 30 ? 'upcoming' : 'future';
    }

    return { ok: true, result: { filingDate, jurisdiction, deadlines, generatedAt: new Date().toISOString() } };
  });

  registerLensAction("legal", "generateInvoice", (ctx, artifact, params) => {
  try {
    const timeEntries = artifact.data?.timeEntries || [];
    const expenses = artifact.data?.expenses || [];
    const taxRate = finiteNum(params.taxRate, 0);

    let totalHours = 0;
    const lineItems = timeEntries.map((entry, idx) => {
      const hours = finiteNum(entry.hours);
      const rate = finiteNum(entry.rate);
      const amount = Math.round(hours * rate * 100) / 100;
      totalHours += hours;
      return {
        line: idx + 1,
        date: entry.date || null,
        description: entry.description || entry.task || '',
        attorney: entry.attorney || entry.provider || '',
        hours,
        rate,
        amount,
      };
    });

    const laborSubtotal = Math.round(lineItems.reduce((s, l) => s + l.amount, 0) * 100) / 100;
    const expenseItems = expenses.map((e, idx) => ({
      line: idx + 1,
      description: e.description || e.name || '',
      amount: Math.round(finiteNum(e.amount) * 100) / 100,
    }));
    const expenseSubtotal = Math.round(expenseItems.reduce((s, e) => s + e.amount, 0) * 100) / 100;
    const subtotal = Math.round((laborSubtotal + expenseSubtotal) * 100) / 100;
    const taxAmount = Math.round(subtotal * taxRate * 100) / 100;
    const total = Math.round((subtotal + taxAmount) * 100) / 100;

    return {
      ok: true,
      result: {
        invoiceDate: new Date().toISOString().split('T')[0],
        client: artifact.data?.client || '',
        matter: artifact.title || '',
        timeEntries: lineItems,
        totalHours: Math.round(totalHours * 100) / 100,
        laborSubtotal,
        expenseItems,
        expenseSubtotal,
        subtotal,
        taxRate,
        taxAmount,
        total,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("legal", "complianceScore", (ctx, artifact, _params) => {
    const items = artifact.data?.requirements || [];
    if (items.length === 0) return { ok: true, result: { score: 100, compliant: 0, overdue: 0, total: 0 } };
    const now = new Date();
    const compliant = items.filter(i => i.status === 'compliant').length;
    const overdue = items.filter(i => i.status === 'overdue' || (i.deadline && new Date(i.deadline) < now && i.status !== 'compliant')).length;
    const score = Math.round((compliant / items.length) * 100);
    return { ok: true, result: { score, compliant, overdue, total: items.length, rating: score >= 90 ? 'excellent' : score >= 70 ? 'good' : score >= 50 ? 'fair' : 'poor' } };
  });

  // ─── Parity-sprint macros ──

  function getLegalState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.legalLens) STATE.legalLens = { cases: new Map() };
    const s = STATE.legalLens;
    // Phase 2 (Clio-parity) backfills — append-only, never break older buckets.
    if (!s.matters)      s.matters      = new Map();
    if (!s.contacts)     s.contacts     = new Map();
    if (!s.timeEntries)  s.timeEntries  = new Map();
    if (!s.timers)       s.timers       = new Map();
    if (!s.trustAccts)   s.trustAccts   = new Map();
    if (!s.trustTxns)    s.trustTxns    = new Map();
    if (!s.invoices)     s.invoices     = new Map();
    if (!s.documents)    s.documents    = new Map();
    if (!s.templates)    s.templates    = new Map();
    if (!s.esignEnv)     s.esignEnv     = new Map();
    if (!s.calendar)     s.calendar     = new Map();
    if (!s.seq)          s.seq          = new Map();
    // Parity backlog (May 2026) — intake forms, payments, matter budgets.
    if (!s.intakeForms)  s.intakeForms  = new Map();   // form definitions
    if (!s.intakeSubs)   s.intakeSubs   = new Map();   // submitted responses
    if (!s.payments)     s.payments     = new Map();   // client payment records
    if (!s.budgets)      s.budgets      = new Map();   // matter budgets (keyed matterId)
    return s;
  }
  function saveLegalState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }

  registerLensAction("legal", "contract-analyze", async (ctx, _artifact, params = {}) => {
    if (!ctx?.llm?.chat) return { ok: false, error: "llm unavailable" };
    const contract = String(params.contract || "").trim();
    const perspective = ["sign", "send", "review"].includes(params.perspective) ? params.perspective : "sign";
    if (contract.length < 200) return { ok: false, error: "contract too short (min 200 chars)" };
    const sys = `You analyze contracts. Output ONLY JSON, no prose, no fences:
{"documentType":"e.g. NDA","partyCount":2,"effectiveDate":"YYYY-MM-DD or null","termLength":"e.g. 12 months or null","riskFlags":[{"severity":"high|moderate|low|info","category":"...","clause":"...","excerpt":"...","whatItMeans":"...","recommendation":"..."}],"obligationsForYou":["..."],"obligationsForCounterparty":["..."],"terminationConditions":["..."],"governing":{"law":"...","venue":"..."},"summary":"..."}
Reading perspective: ${perspective}. Decision-support, NOT legal advice.`;
    try {
      const llmRes = await ctx.llm.chat({
        messages: [{ role: "system", content: sys }, { role: "user", content: `Contract:\n${contract.slice(0, 12000)}\n\nAnalyze.` }],
        temperature: 0.1, maxTokens: 3000, slot: "conscious",
      });
      const raw = String(llmRes?.text || llmRes?.content || "").trim();
      const parsed = extractJsonLegal(raw);
      if (!parsed?.documentType) return { ok: false, error: "could not parse analysis", raw: raw.slice(0, 200) };
      return { ok: true, result: parsed };
    } catch (e) {
      return { ok: false, error: e?.message || "analysis failed" };
    }
  });

  registerLensAction("legal", "case-list", (ctx, _artifact, _params = {}) => {
    const state = getLegalState(); if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    return { ok: true, result: { cases: state.cases.get(userId) || [] } };
  });

  registerLensAction("legal", "case-add", (ctx, _artifact, params = {}) => {
  try {
    const state = getLegalState(); if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const caption = String(params.caption || "").trim();
    const caseNumber = String(params.caseNumber || "").trim();
    if (!caption || !caseNumber) return { ok: false, error: "caption and caseNumber required" };
    if (!state.cases.has(userId)) state.cases.set(userId, []);
    const c = {
      id: `case_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      caption, caseNumber,
      court: String(params.court || ""),
      jurisdiction: String(params.jurisdiction || ""),
      filedAt: params.filedAt || new Date().toISOString().slice(0, 10),
      status: "active",
      matterType: ["civil", "criminal", "family", "probate", "corporate", "admin"].includes(params.matterType) ? params.matterType : "civil",
      events: [{ date: new Date().toISOString().slice(0, 10), kind: "filed", description: "Case opened" }],
    };
    state.cases.get(userId).push(c);
    saveLegalState();
    return { ok: true, result: { case: c } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("legal", "legal-question", async (ctx, _artifact, params = {}) => {
    const question = String(params.question || "").trim();
    const jurisdiction = String(params.jurisdiction || "US-Federal");
    if (!question) return { ok: false, error: "question required" };
    if (!ctx?.llm?.chat) return { ok: true, result: { answer: "AI unavailable. Consult a licensed attorney.", jurisdiction, citations: [], caveats: ["This response indicates AI is offline."] } };
    const sys = `You are a legal research assistant. NEVER provide legal advice. Output ONLY JSON:
{"answer":"plain-language explanation","jurisdiction":"${jurisdiction}","citations":[{"title":"e.g. California Civil Code § 1542","url":"optional","section":"optional"}],"caveats":["..."]}
Rules: cite real statutes/cases/regs; ALWAYS include not-legal-advice caveat; if outside jurisdiction, say so; for criminal, recommend criminal defense attorney.`;
    try {
      const llmRes = await ctx.llm.chat({
        messages: [{ role: "system", content: sys }, { role: "user", content: `Question: ${question}\n\nAnswer for jurisdiction ${jurisdiction}.` }],
        temperature: 0.2, maxTokens: 1500, slot: "conscious",
      });
      const raw = String(llmRes?.text || llmRes?.content || "").trim();
      const parsed = extractJsonLegal(raw);
      if (!parsed?.answer) return { ok: true, result: { answer: "Could not generate a confident answer. Consult an attorney.", jurisdiction, citations: [], caveats: ["AI parse failure."] } };
      const caveats = Array.isArray(parsed.caveats) ? parsed.caveats : [];
      if (!caveats.some(c => /not legal advice|consult.*attorney/i.test(String(c)))) {
        caveats.unshift("This is not legal advice. Consult a licensed attorney in your jurisdiction for a binding answer.");
      }
      return { ok: true, result: { answer: String(parsed.answer), jurisdiction, citations: Array.isArray(parsed.citations) ? parsed.citations.slice(0, 8) : [], caveats } };
    } catch (e) {
      return { ok: true, result: { answer: `Error: ${e?.message || "unknown"}. Consult an attorney.`, jurisdiction, citations: [], caveats: ["AI request failed."] } };
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // Clio 2026 parity — matter management, contacts, time tracking,
  // IOLTA trust accounting, document automation, e-signature,
  // court-rules-aware deadline calculator, Manage AI features.
  // ═══════════════════════════════════════════════════════════════

  function aid(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }
  function uid(prefix) { return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
  function isoNow() { return new Date().toISOString(); }
  function isoDay() { return new Date().toISOString().slice(0, 10); }
  function ensureBucket(m, userId) { if (!m.has(userId)) m.set(userId, []); return m.get(userId); }
  function ensureSeqLegal(s, userId) {
    if (!s.seq.has(userId)) s.seq.set(userId, { mat: 1, party: 1, te: 1, inv: 1, doc: 1, env: 1, ev: 1, ta: 1, frm: 1, sub: 1, pay: 1 });
    const seq = s.seq.get(userId);
    for (const k of ['mat','party','te','inv','doc','env','ev','ta','frm','sub','pay']) if (!Number.isFinite(seq[k])) seq[k] = 1;
    return seq;
  }

  const MATTER_TYPES = ['litigation','transactional','family','probate','criminal','employment','ip','real_estate','corporate','immigration','tax','bankruptcy','other'];
  const MATTER_STATUSES = ['intake','open','pending','closed','archived'];
  const CONTACT_KINDS = ['client','opposing_party','opposing_counsel','witness','court','expert','other'];

  // ── Matters ────────────────────────────────────────────────────

  registerLensAction("legal", "matters-list", (ctx, _a, params = {}) => {
    const s = getLegalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aid(ctx);
    const status = params.status && MATTER_STATUSES.includes(params.status) ? params.status : null;
    const list = ensureBucket(s.matters, userId);
    const filtered = status ? list.filter(m => m.status === status) : list;
    return { ok: true, result: { matters: filtered.slice().sort((a, b) => (b.openedAt || '').localeCompare(a.openedAt || '')) } };
  });

  registerLensAction("legal", "matters-create", (ctx, _a, params = {}) => {
  try {
    const s = getLegalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aid(ctx);
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    const seq = ensureSeqLegal(s, userId);
    const matter = {
      id: uid("matter"),
      number: `MAT-${String(seq.mat).padStart(5, "0")}`,
      name,
      clientId: params.clientId ? String(params.clientId) : null,
      clientName: String(params.clientName || ""),
      matterType: MATTER_TYPES.includes(params.matterType) ? params.matterType : 'other',
      status: 'open',
      jurisdiction: String(params.jurisdiction || ""),
      court: String(params.court || ""),
      caseNumber: String(params.caseNumber || ""),
      hourlyRate: Number(params.hourlyRate) || 0,
      flatFee: Number(params.flatFee) || 0,
      billingType: ['hourly','flat','contingency','pro_bono'].includes(params.billingType) ? params.billingType : 'hourly',
      openedAt: isoDay(),
      closedAt: null,
      description: String(params.description || "").slice(0, 1000),
      partyIds: Array.isArray(params.partyIds) ? params.partyIds.map(String) : [],
    };
    seq.mat++;
    ensureBucket(s.matters, userId).push(matter);
    saveLegalState();
    return { ok: true, result: { matter } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("legal", "matters-update", (ctx, _a, params = {}) => {
    const s = getLegalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const id = String(params.id || "");
    const m = ensureBucket(s.matters, aid(ctx)).find(x => x.id === id);
    if (!m) return { ok: false, error: "matter not found" };
    for (const k of ['name','clientName','jurisdiction','court','caseNumber','description']) {
      if (typeof params[k] === 'string') m[k] = params[k];
    }
    for (const k of ['hourlyRate','flatFee']) {
      if (Number.isFinite(Number(params[k]))) m[k] = Number(params[k]);
    }
    if (MATTER_TYPES.includes(params.matterType)) m.matterType = params.matterType;
    if (MATTER_STATUSES.includes(params.status)) m.status = params.status;
    if (['hourly','flat','contingency','pro_bono'].includes(params.billingType)) m.billingType = params.billingType;
    if (Array.isArray(params.partyIds)) m.partyIds = params.partyIds.map(String);
    saveLegalState();
    return { ok: true, result: { matter: m } };
  });

  registerLensAction("legal", "matters-close", (ctx, _a, params = {}) => {
    const s = getLegalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const m = ensureBucket(s.matters, aid(ctx)).find(x => x.id === String(params.id || ""));
    if (!m) return { ok: false, error: "matter not found" };
    m.status = 'closed';
    m.closedAt = isoDay();
    saveLegalState();
    return { ok: true, result: { matter: m } };
  });

  registerLensAction("legal", "matters-detail", (ctx, _a, params = {}) => {
  try {
    const s = getLegalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aid(ctx);
    const id = String(params.id || "");
    const m = ensureBucket(s.matters, userId).find(x => x.id === id);
    if (!m) return { ok: false, error: "matter not found" };
    const contacts = ensureBucket(s.contacts, userId);
    const parties = (m.partyIds || []).map(pid => contacts.find(c => c.id === pid)).filter(Boolean);
    const time = ensureBucket(s.timeEntries, userId).filter(t => t.matterId === id);
    const totalBilled = time.filter(t => t.status === 'billed').reduce((sum, t) => sum + (t.amount || 0), 0);
    const totalUnbilled = time.filter(t => t.status === 'unbilled').reduce((sum, t) => sum + (t.amount || 0), 0);
    const totalHours = time.reduce((sum, t) => sum + (t.hours || 0), 0);
    const invoices = ensureBucket(s.invoices, userId).filter(i => i.matterId === id);
    const documents = ensureBucket(s.documents, userId).filter(d => d.matterId === id);
    const trustBalance = (() => {
      const txns = ensureBucket(s.trustTxns, userId).filter(t => t.matterId === id);
      return txns.reduce((sum, t) => sum + (t.kind === 'deposit' ? t.amount : -t.amount), 0);
    })();
    const events = ensureBucket(s.calendar, userId).filter(e => e.matterId === id);
    return {
      ok: true,
      result: {
        matter: m,
        parties,
        time,
        invoices,
        documents,
        events,
        totals: { billed: totalBilled, unbilled: totalUnbilled, hours: totalHours, trustBalance },
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Contacts (clients, opposing parties, etc) ──────────────────

  registerLensAction("legal", "contacts-list", (ctx, _a, params = {}) => {
    const s = getLegalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const kind = CONTACT_KINDS.includes(params.kind) ? params.kind : null;
    const list = ensureBucket(s.contacts, aid(ctx));
    const filtered = kind ? list.filter(c => c.kind === kind) : list;
    return { ok: true, result: { contacts: filtered.slice().sort((a, b) => a.name.localeCompare(b.name)) } };
  });

  registerLensAction("legal", "contacts-create", (ctx, _a, params = {}) => {
    const s = getLegalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aid(ctx);
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    const seq = ensureSeqLegal(s, userId);
    const c = {
      id: uid("party"),
      number: `P-${String(seq.party).padStart(5, "0")}`,
      name,
      kind: CONTACT_KINDS.includes(params.kind) ? params.kind : 'client',
      email: String(params.email || "").trim(),
      phone: String(params.phone || "").trim(),
      organization: String(params.organization || "").trim(),
      address: String(params.address || "").trim(),
      notes: String(params.notes || "").slice(0, 1000),
      createdAt: isoNow(),
    };
    seq.party++;
    ensureBucket(s.contacts, userId).push(c);
    saveLegalState();
    return { ok: true, result: { contact: c } };
  });

  registerLensAction("legal", "contacts-update", (ctx, _a, params = {}) => {
    const s = getLegalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const c = ensureBucket(s.contacts, aid(ctx)).find(x => x.id === String(params.id || ""));
    if (!c) return { ok: false, error: "contact not found" };
    for (const k of ['name','email','phone','organization','address','notes']) {
      if (typeof params[k] === 'string') c[k] = params[k];
    }
    if (CONTACT_KINDS.includes(params.kind)) c.kind = params.kind;
    saveLegalState();
    return { ok: true, result: { contact: c } };
  });

  registerLensAction("legal", "contacts-delete", (ctx, _a, params = {}) => {
    const s = getLegalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = ensureBucket(s.contacts, aid(ctx));
    const i = list.findIndex(c => c.id === String(params.id || ""));
    if (i < 0) return { ok: false, error: "contact not found" };
    list.splice(i, 1);
    saveLegalState();
    return { ok: true, result: { deleted: true } };
  });

  // ── Conflict check (real STATE-backed) ────────────────────────

  registerLensAction("legal", "conflict-search", (ctx, _a, params = {}) => {
  try {
    const s = getLegalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aid(ctx);
    const query = String(params.name || params.query || "").trim().toLowerCase();
    if (!query) return { ok: false, error: "name or query required" };
    const contacts = ensureBucket(s.contacts, userId);
    const matters = ensureBucket(s.matters, userId);
    const matches = [];
    for (const c of contacts) {
      const hay = `${c.name} ${c.organization} ${c.email}`.toLowerCase();
      if (hay.includes(query)) {
        const relatedMatters = matters.filter(m => (m.partyIds || []).includes(c.id) || (m.clientId === c.id) || (m.clientName || '').toLowerCase().includes(c.name.toLowerCase()));
        matches.push({ kind: 'contact', contact: c, matters: relatedMatters });
      }
    }
    for (const m of matters) {
      const hay = `${m.name} ${m.clientName} ${m.caseNumber}`.toLowerCase();
      if (hay.includes(query) && !matches.some(x => x.kind === 'matter' && x.matter.id === m.id)) {
        matches.push({ kind: 'matter', matter: m });
      }
    }
    return { ok: true, result: { query, hits: matches.length, matches, hasConflict: matches.length > 0 } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Time tracking ──────────────────────────────────────────────

  registerLensAction("legal", "time-entries-list", (ctx, _a, params = {}) => {
    const s = getLegalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aid(ctx);
    const matterId = params.matterId ? String(params.matterId) : null;
    const status = ['unbilled','billed','non_billable','all'].includes(params.status) ? params.status : 'all';
    const list = ensureBucket(s.timeEntries, userId);
    let filtered = list;
    if (matterId) filtered = filtered.filter(t => t.matterId === matterId);
    if (status !== 'all') filtered = filtered.filter(t => t.status === status);
    return { ok: true, result: { entries: filtered.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')) } };
  });

  registerLensAction("legal", "time-entries-create", (ctx, _a, params = {}) => {
  try {
    const s = getLegalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aid(ctx);
    const matterId = String(params.matterId || "");
    const matter = ensureBucket(s.matters, userId).find(m => m.id === matterId);
    if (!matter) return { ok: false, error: "matter not found" };
    const hours = Number(params.hours);
    if (!Number.isFinite(hours) || hours <= 0) return { ok: false, error: "hours must be > 0" };
    const seq = ensureSeqLegal(s, userId);
    const billable = params.billable !== false;
    const rate = Number.isFinite(Number(params.rate)) && Number(params.rate) > 0 ? Number(params.rate) : (matter.hourlyRate || 0);
    const entry = {
      id: uid("te"),
      number: `TE-${String(seq.te).padStart(6, "0")}`,
      matterId,
      matterName: matter.name,
      date: String(params.date || isoDay()),
      description: String(params.description || "").slice(0, 500),
      hours,
      rate,
      amount: billable ? Math.round(hours * rate * 100) / 100 : 0,
      status: billable ? 'unbilled' : 'non_billable',
      activityCode: String(params.activityCode || ""),
      createdAt: isoNow(),
      invoiceId: null,
    };
    seq.te++;
    ensureBucket(s.timeEntries, userId).push(entry);
    saveLegalState();
    return { ok: true, result: { entry } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("legal", "time-entries-delete", (ctx, _a, params = {}) => {
    const s = getLegalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = ensureBucket(s.timeEntries, aid(ctx));
    const i = list.findIndex(t => t.id === String(params.id || ""));
    if (i < 0) return { ok: false, error: "entry not found" };
    if (list[i].status === 'billed') return { ok: false, error: "cannot delete a billed entry" };
    list.splice(i, 1);
    saveLegalState();
    return { ok: true, result: { deleted: true } };
  });

  // Multiple concurrent timers (Clio-parity).
  registerLensAction("legal", "timer-start", (ctx, _a, params = {}) => {
    const s = getLegalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aid(ctx);
    const matterId = String(params.matterId || "");
    const matter = ensureBucket(s.matters, userId).find(m => m.id === matterId);
    if (!matter) return { ok: false, error: "matter not found" };
    const timer = {
      id: uid("timer"),
      matterId, matterName: matter.name,
      description: String(params.description || ""),
      startedAt: isoNow(),
      elapsedSec: 0,
    };
    ensureBucket(s.timers, userId).push(timer);
    saveLegalState();
    return { ok: true, result: { timer } };
  });

  registerLensAction("legal", "timer-stop", (ctx, _a, params = {}) => {
    const s = getLegalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aid(ctx);
    const timers = ensureBucket(s.timers, userId);
    const i = timers.findIndex(t => t.id === String(params.id || ""));
    if (i < 0) return { ok: false, error: "timer not found" };
    const timer = timers[i];
    const elapsedMs = Date.now() - new Date(timer.startedAt).getTime();
    const hours = Math.max(0.01, Math.round((elapsedMs / 3_600_000) * 100) / 100);
    timers.splice(i, 1);
    // Auto-create time entry from timer
    const matter = ensureBucket(s.matters, userId).find(m => m.id === timer.matterId);
    if (!matter) {
      saveLegalState();
      return { ok: true, result: { timer, stoppedNoEntry: true } };
    }
    const seq = ensureSeqLegal(s, userId);
    const rate = matter.hourlyRate || 0;
    const entry = {
      id: uid("te"),
      number: `TE-${String(seq.te).padStart(6, "0")}`,
      matterId: timer.matterId,
      matterName: timer.matterName,
      date: isoDay(),
      description: timer.description || `Auto from timer ${timer.id}`,
      hours,
      rate,
      amount: Math.round(hours * rate * 100) / 100,
      status: 'unbilled',
      activityCode: "",
      createdAt: isoNow(),
      invoiceId: null,
      fromTimer: true,
    };
    seq.te++;
    ensureBucket(s.timeEntries, userId).push(entry);
    saveLegalState();
    return { ok: true, result: { timer, entry, hours } };
  });

  registerLensAction("legal", "timer-list", (ctx, _a, _p = {}) => {
    const s = getLegalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = ensureBucket(s.timers, aid(ctx)).map(t => ({
      ...t,
      elapsedSec: Math.floor((Date.now() - new Date(t.startedAt).getTime()) / 1000),
    }));
    return { ok: true, result: { timers: list } };
  });

  // ── IOLTA Trust Accounting ─────────────────────────────────────

  registerLensAction("legal", "trust-account-create", (ctx, _a, params = {}) => {
  try {
    const s = getLegalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aid(ctx);
    const name = String(params.name || "Operating Trust (IOLTA)").trim();
    const accountNumber = String(params.accountNumber || `IOLTA-${Date.now().toString(36).slice(-6)}`);
    const seq = ensureSeqLegal(s, userId);
    const account = {
      id: uid("trustacct"),
      number: `TA-${String(seq.ta).padStart(3, "0")}`,
      name,
      accountNumber,
      bankName: String(params.bankName || ""),
      isIOLTA: params.isIOLTA !== false,
      bankStatementBalance: 0,    // user-entered for 3-way recon
      createdAt: isoNow(),
    };
    seq.ta++;
    ensureBucket(s.trustAccts, userId).push(account);
    saveLegalState();
    return { ok: true, result: { account } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("legal", "trust-accounts-list", (ctx, _a, _p = {}) => {
    const s = getLegalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    return { ok: true, result: { accounts: ensureBucket(s.trustAccts, aid(ctx)) } };
  });

  registerLensAction("legal", "trust-deposit", (ctx, _a, params = {}) => {
    const s = getLegalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aid(ctx);
    const accountId = String(params.accountId || "");
    const matterId = String(params.matterId || "");
    const amount = Number(params.amount);
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "amount must be > 0" };
    const acct = ensureBucket(s.trustAccts, userId).find(a => a.id === accountId);
    if (!acct) return { ok: false, error: "trust account not found" };
    const matter = ensureBucket(s.matters, userId).find(m => m.id === matterId);
    if (!matter) return { ok: false, error: "matter not found" };
    const txn = {
      id: uid("trtxn"),
      accountId, matterId, matterName: matter.name,
      clientId: matter.clientId, clientName: matter.clientName,
      kind: 'deposit',
      amount,
      memo: String(params.memo || "Retainer/deposit"),
      date: String(params.date || isoDay()),
      checkNumber: String(params.checkNumber || ""),
      createdAt: isoNow(),
    };
    ensureBucket(s.trustTxns, userId).push(txn);
    saveLegalState();
    return { ok: true, result: { txn } };
  });

  registerLensAction("legal", "trust-disburse", (ctx, _a, params = {}) => {
  try {
    const s = getLegalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aid(ctx);
    const accountId = String(params.accountId || "");
    const matterId = String(params.matterId || "");
    const amount = Number(params.amount);
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "amount must be > 0" };
    const acct = ensureBucket(s.trustAccts, userId).find(a => a.id === accountId);
    if (!acct) return { ok: false, error: "trust account not found" };
    const matter = ensureBucket(s.matters, userId).find(m => m.id === matterId);
    if (!matter) return { ok: false, error: "matter not found" };
    // ENFORCE: cannot overdraw client's trust balance.
    const txns = ensureBucket(s.trustTxns, userId).filter(t => t.matterId === matterId);
    const clientBal = txns.reduce((sum, t) => sum + (t.kind === 'deposit' ? t.amount : -t.amount), 0);
    if (amount > clientBal) {
      return { ok: false, error: `IOLTA violation: client trust balance is $${clientBal.toFixed(2)}, cannot disburse $${amount.toFixed(2)}.` };
    }
    const txn = {
      id: uid("trtxn"),
      accountId, matterId, matterName: matter.name,
      clientId: matter.clientId, clientName: matter.clientName,
      kind: 'disbursement',
      amount,
      memo: String(params.memo || "Disbursement"),
      payee: String(params.payee || ""),
      date: String(params.date || isoDay()),
      checkNumber: String(params.checkNumber || ""),
      invoiceId: params.invoiceId ? String(params.invoiceId) : null,
      createdAt: isoNow(),
    };
    ensureBucket(s.trustTxns, userId).push(txn);
    saveLegalState();
    return { ok: true, result: { txn } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("legal", "trust-balance", (ctx, _a, params = {}) => {
  try {
    const s = getLegalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aid(ctx);
    const accountId = params.accountId ? String(params.accountId) : null;
    const matterId = params.matterId ? String(params.matterId) : null;
    let txns = ensureBucket(s.trustTxns, userId);
    if (accountId) txns = txns.filter(t => t.accountId === accountId);
    if (matterId) txns = txns.filter(t => t.matterId === matterId);
    const total = txns.reduce((sum, t) => sum + (t.kind === 'deposit' ? t.amount : -t.amount), 0);
    // per-matter ledger
    const byMatter = new Map();
    for (const t of txns) {
      const mk = t.matterId;
      const cur = byMatter.get(mk) || { matterId: mk, matterName: t.matterName, clientName: t.clientName, deposits: 0, disbursements: 0, balance: 0 };
      if (t.kind === 'deposit') cur.deposits += t.amount; else cur.disbursements += t.amount;
      cur.balance = cur.deposits - cur.disbursements;
      byMatter.set(mk, cur);
    }
    return { ok: true, result: { total, byMatter: Array.from(byMatter.values()), txnCount: txns.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("legal", "trust-reconcile", (ctx, _a, params = {}) => {
    const s = getLegalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aid(ctx);
    const accountId = String(params.accountId || "");
    const acct = ensureBucket(s.trustAccts, userId).find(a => a.id === accountId);
    if (!acct) return { ok: false, error: "trust account not found" };
    if (Number.isFinite(Number(params.bankBalance))) {
      acct.bankStatementBalance = Number(params.bankBalance);
      acct.lastReconcileAt = isoDay();
      saveLegalState();
    }
    const txns = ensureBucket(s.trustTxns, userId).filter(t => t.accountId === accountId);
    const bookBalance = txns.reduce((sum, t) => sum + (t.kind === 'deposit' ? t.amount : -t.amount), 0);
    // Sum of client ledgers (third leg).
    const clientLedgerTotal = (() => {
      const byMatter = new Map();
      for (const t of txns) {
        byMatter.set(t.matterId, (byMatter.get(t.matterId) || 0) + (t.kind === 'deposit' ? t.amount : -t.amount));
      }
      return Array.from(byMatter.values()).reduce((s, v) => s + v, 0);
    })();
    const bankBalance = acct.bankStatementBalance || 0;
    const reconciled = Math.abs(bookBalance - clientLedgerTotal) < 0.01 && Math.abs(bookBalance - bankBalance) < 0.01;
    return {
      ok: true,
      result: {
        accountId,
        bookBalance,
        clientLedgerTotal,
        bankBalance,
        bookVsClient: bookBalance - clientLedgerTotal,
        bookVsBank: bookBalance - bankBalance,
        reconciled,
        warnings: [
          Math.abs(bookBalance - clientLedgerTotal) > 0.01 ? "Book vs client ledger out of balance — investigate matters" : null,
          Math.abs(bookBalance - bankBalance) > 0.01 ? "Book vs bank out of balance — match deposits/checks" : null,
        ].filter(Boolean),
      },
    };
  });

  // ── Invoices (matter-scoped, from time entries) ────────────────

  registerLensAction("legal", "invoices-from-time", (ctx, _a, params = {}) => {
  try {
    const s = getLegalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aid(ctx);
    const matterId = String(params.matterId || "");
    const matter = ensureBucket(s.matters, userId).find(m => m.id === matterId);
    if (!matter) return { ok: false, error: "matter not found" };
    const entries = ensureBucket(s.timeEntries, userId).filter(t => t.matterId === matterId && t.status === 'unbilled');
    if (entries.length === 0) return { ok: false, error: "no unbilled time entries for this matter" };
    const subtotal = entries.reduce((sum, t) => sum + (t.amount || 0), 0);
    const tax = Number(params.taxRate) > 0 ? Math.round(subtotal * Number(params.taxRate) * 100) / 100 : 0;
    const seq = ensureSeqLegal(s, userId);
    const invoice = {
      id: uid("inv"),
      number: `INV-${String(seq.inv).padStart(5, "0")}`,
      matterId, matterName: matter.name,
      clientId: matter.clientId, clientName: matter.clientName,
      issuedAt: isoDay(),
      dueAt: String(params.dueAt || new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)),
      lineItemIds: entries.map(e => e.id),
      lineItems: entries.map(e => ({ entryId: e.id, date: e.date, description: e.description, hours: e.hours, rate: e.rate, amount: e.amount })),
      subtotal,
      taxRate: Number(params.taxRate) || 0,
      tax,
      total: subtotal + tax,
      status: 'open',
      paidAt: null,
    };
    seq.inv++;
    for (const e of entries) { e.status = 'billed'; e.invoiceId = invoice.id; }
    ensureBucket(s.invoices, userId).push(invoice);
    saveLegalState();
    return { ok: true, result: { invoice } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("legal", "invoices-list", (ctx, _a, params = {}) => {
    const s = getLegalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aid(ctx);
    const status = ['open','paid','all'].includes(params.status) ? params.status : 'all';
    const matterId = params.matterId ? String(params.matterId) : null;
    let list = ensureBucket(s.invoices, userId);
    if (status !== 'all') list = list.filter(i => i.status === status);
    if (matterId) list = list.filter(i => i.matterId === matterId);
    return { ok: true, result: { invoices: list.slice().sort((a, b) => (b.issuedAt || '').localeCompare(a.issuedAt || '')) } };
  });

  registerLensAction("legal", "invoices-mark-paid", (ctx, _a, params = {}) => {
    const s = getLegalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const inv = ensureBucket(s.invoices, aid(ctx)).find(i => i.id === String(params.id || ""));
    if (!inv) return { ok: false, error: "invoice not found" };
    inv.status = 'paid';
    inv.paidAt = String(params.paidAt || isoDay());
    inv.paidVia = String(params.paidVia || "manual");
    saveLegalState();
    return { ok: true, result: { invoice: inv } };
  });

  // ── Documents (templates + generated) ─────────────────────────

  registerLensAction("legal", "doc-templates-list", (ctx, _a, _p = {}) => {
    const s = getLegalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aid(ctx);
    const list = ensureBucket(s.templates, userId);
    if (list.length === 0) {
      // seed a few canonical templates so users see something on first run.
      const seed = [
        { name: "Engagement Letter", body: "Dear {{client_name}},\n\nThis letter confirms our agreement to represent you in {{matter_name}}. Our hourly rate is {{hourly_rate}}.\n\nSincerely,\n{{attorney_name}}", kind: 'letter' },
        { name: "Demand Letter", body: "To {{opposing_party}},\n\nMy client, {{client_name}}, demands {{relief_sought}} regarding {{matter_name}}. Please respond within 14 days.\n\n{{attorney_name}}", kind: 'letter' },
        { name: "Settlement Agreement", body: "SETTLEMENT AGREEMENT\n\nThis agreement is between {{client_name}} and {{opposing_party}}, dated {{today}}, in re: {{matter_name}}.\n\nTerms: ...", kind: 'agreement' },
      ];
      for (const tpl of seed) {
        list.push({ id: uid("tpl"), createdAt: isoNow(), ...tpl });
      }
      saveLegalState();
    }
    return { ok: true, result: { templates: list } };
  });

  registerLensAction("legal", "doc-templates-create", (ctx, _a, params = {}) => {
    const s = getLegalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = String(params.name || "").trim();
    const body = String(params.body || "").trim();
    if (!name || !body) return { ok: false, error: "name and body required" };
    const tpl = {
      id: uid("tpl"),
      name,
      body,
      kind: String(params.kind || 'document'),
      createdAt: isoNow(),
    };
    ensureBucket(s.templates, aid(ctx)).push(tpl);
    saveLegalState();
    return { ok: true, result: { template: tpl } };
  });

  registerLensAction("legal", "doc-generate", (ctx, _a, params = {}) => {
  try {
    const s = getLegalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aid(ctx);
    const templateId = String(params.templateId || "");
    const matterId = String(params.matterId || "");
    const tpl = ensureBucket(s.templates, userId).find(t => t.id === templateId);
    if (!tpl) return { ok: false, error: "template not found" };
    const matter = ensureBucket(s.matters, userId).find(m => m.id === matterId);
    if (!matter) return { ok: false, error: "matter not found" };
    const parties = (matter.partyIds || []).map(pid => ensureBucket(s.contacts, userId).find(c => c.id === pid)).filter(Boolean);
    const opposingParty = parties.find(p => p.kind === 'opposing_party')?.name || (params.opposing_party || "");
    const mergeData = {
      client_name: matter.clientName || (parties.find(p => p.kind === 'client')?.name) || "[CLIENT]",
      matter_name: matter.name,
      case_number: matter.caseNumber || "[CASE]",
      hourly_rate: matter.hourlyRate ? `$${matter.hourlyRate}/hr` : "[RATE]",
      opposing_party: opposingParty || "[OPPOSING PARTY]",
      relief_sought: String(params.relief_sought || "[RELIEF]"),
      attorney_name: String(params.attorney_name || ctx?.actor?.fullName || "[ATTORNEY]"),
      today: isoDay(),
      ...(params.merge && typeof params.merge === 'object' ? params.merge : {}),
    };
    const body = tpl.body.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
      const val = mergeData[key];
      return val !== undefined && val !== null ? String(val) : `{{${key}}}`;
    });
    const seq = ensureSeqLegal(s, userId);
    const doc = {
      id: uid("doc"),
      number: `DOC-${String(seq.doc).padStart(5, "0")}`,
      name: `${tpl.name} — ${matter.name}`,
      matterId, matterName: matter.name,
      templateId,
      templateName: tpl.name,
      body,
      version: 1,
      status: 'draft',
      createdAt: isoNow(),
    };
    seq.doc++;
    ensureBucket(s.documents, userId).push(doc);
    saveLegalState();
    return { ok: true, result: { document: doc } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("legal", "documents-list", (ctx, _a, params = {}) => {
    const s = getLegalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const matterId = params.matterId ? String(params.matterId) : null;
    let list = ensureBucket(s.documents, aid(ctx));
    if (matterId) list = list.filter(d => d.matterId === matterId);
    return { ok: true, result: { documents: list.slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')) } };
  });

  // ── E-signature envelope ──────────────────────────────────────

  registerLensAction("legal", "esign-envelope-create", (ctx, _a, params = {}) => {
  try {
    const s = getLegalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aid(ctx);
    const documentId = String(params.documentId || "");
    const doc = ensureBucket(s.documents, userId).find(d => d.id === documentId);
    if (!doc) return { ok: false, error: "document not found" };
    const recipients = Array.isArray(params.recipients) ? params.recipients : [];
    if (recipients.length === 0) return { ok: false, error: "recipients required" };
    const seq = ensureSeqLegal(s, userId);
    const envelope = {
      id: uid("env"),
      number: `ENV-${String(seq.env).padStart(5, "0")}`,
      documentId,
      documentName: doc.name,
      matterId: doc.matterId,
      recipients: recipients.map((r, i) => ({
        id: `${uid("rcpt")}_${i}`,
        name: String(r.name || ""),
        email: String(r.email || ""),
        role: String(r.role || "signer"),
        status: 'pending',
        signedAt: null,
        token: Math.random().toString(36).slice(2, 16),
      })),
      status: 'sent',
      createdAt: isoNow(),
      sentAt: isoNow(),
      completedAt: null,
      esignActDisclosure: "Consents recorded under E-SIGN Act 15 USC § 7001 + UETA § 7.",
    };
    seq.env++;
    ensureBucket(s.esignEnv, userId).push(envelope);
    doc.status = 'sent_for_signature';
    saveLegalState();
    return { ok: true, result: { envelope } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("legal", "esign-envelope-sign", (ctx, _a, params = {}) => {
    const s = getLegalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aid(ctx);
    const envelopeId = String(params.envelopeId || "");
    const recipientId = String(params.recipientId || "");
    const env = ensureBucket(s.esignEnv, userId).find(e => e.id === envelopeId);
    if (!env) return { ok: false, error: "envelope not found" };
    const r = env.recipients.find(x => x.id === recipientId);
    if (!r) return { ok: false, error: "recipient not found" };
    if (r.status === 'signed') return { ok: false, error: "recipient already signed" };
    r.status = 'signed';
    r.signedAt = isoNow();
    r.ip = String(params.ip || "");
    r.userAgent = String(params.userAgent || "");
    if (env.recipients.every(x => x.status === 'signed')) {
      env.status = 'completed';
      env.completedAt = isoNow();
      const doc = ensureBucket(s.documents, userId).find(d => d.id === env.documentId);
      if (doc) doc.status = 'signed';
    }
    saveLegalState();
    return { ok: true, result: { envelope: env } };
  });

  registerLensAction("legal", "esign-envelopes-list", (ctx, _a, params = {}) => {
    const s = getLegalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const status = ['sent','completed','all'].includes(params.status) ? params.status : 'all';
    let list = ensureBucket(s.esignEnv, aid(ctx));
    if (status !== 'all') list = list.filter(e => e.status === status);
    return { ok: true, result: { envelopes: list.slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')) } };
  });

  // ── Calendar / deadlines + court-rules deadline calc ──────────

  registerLensAction("legal", "calendar-list", (ctx, _a, params = {}) => {
    const s = getLegalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const matterId = params.matterId ? String(params.matterId) : null;
    let list = ensureBucket(s.calendar, aid(ctx));
    if (matterId) list = list.filter(e => e.matterId === matterId);
    return { ok: true, result: { events: list.slice().sort((a, b) => (a.date || '').localeCompare(b.date || '')) } };
  });

  registerLensAction("legal", "calendar-create", (ctx, _a, params = {}) => {
    const s = getLegalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aid(ctx);
    const date = String(params.date || isoDay());
    const title = String(params.title || "").trim();
    if (!title) return { ok: false, error: "title required" };
    const seq = ensureSeqLegal(s, userId);
    const event = {
      id: uid("ev"),
      number: `EV-${String(seq.ev).padStart(5, "0")}`,
      matterId: params.matterId ? String(params.matterId) : null,
      title,
      kind: ['deadline','hearing','meeting','filing','other'].includes(params.kind) ? params.kind : 'deadline',
      date,
      time: String(params.time || ""),
      location: String(params.location || ""),
      description: String(params.description || ""),
      sourceRule: String(params.sourceRule || ""),
      createdAt: isoNow(),
    };
    seq.ev++;
    ensureBucket(s.calendar, userId).push(event);
    saveLegalState();
    return { ok: true, result: { event } };
  });

  // Court rules deadline calculator. Supports federal civil + a few state rules.
  // Returns the calendar date for a deadline N days after a trigger event,
  // accounting for weekends and major federal holidays (FRCP 6(a)).
  registerLensAction("legal", "court-rules-deadline", (ctx, _a, params = {}) => {
  try {
    const trigger = String(params.triggerDate || isoDay());
    const rule = String(params.rule || "").toLowerCase();
    const jurisdiction = String(params.jurisdiction || "US-Federal");
    // Rule library (days from trigger). The number is the deadline-from-event
    // statutory window. All "days" here are calendar days per FRCP 6(a)(1)
    // except where noted. State-specific rules can be added by extending this map.
    const RULES = {
      'frcp-12-answer':           { days: 21, name: "FRCP 12(a)(1)(A) — Answer to complaint" },
      'frcp-12-answer-removed':   { days: 7,  name: "FRCP 81(c)(2) — Answer after removal" },
      'frcp-12-motion':           { days: 21, name: "FRCP 12 — Motion to dismiss" },
      'frcp-26-conference':       { days: 21, name: "FRCP 26(f) — Discovery conference" },
      'frcp-26-disclosures':      { days: 14, name: "FRCP 26(a)(1)(C) — Initial disclosures" },
      'frcp-33-interrogatories':  { days: 30, name: "FRCP 33(b)(2) — Answer interrogatories" },
      'frcp-34-rfp':              { days: 30, name: "FRCP 34(b)(2) — Respond to RFP" },
      'frcp-36-rfa':              { days: 30, name: "FRCP 36(a)(3) — Respond to RFA" },
      'frcp-56-msj-response':     { days: 21, name: "FRCP 56 — MSJ response (local rule typical)" },
      'frap-4-notice-appeal':     { days: 30, name: "FRAP 4(a)(1)(A) — Notice of appeal (civil)" },
      'us-statute-limitations-tort': { days: 365 * 2, name: "Generic 2-year tort SOL (state-specific)" },
    };
    if (!RULES[rule]) return { ok: false, error: `unknown rule. Supported: ${Object.keys(RULES).join(', ')}` };
    const start = new Date(trigger);
    if (isNaN(start.getTime())) return { ok: false, error: "triggerDate invalid" };
    // Federal holidays (FRCP 6(a)(6)(A)).
    const year = start.getFullYear();
    function nthWeekday(year, month, dow, n) { let d = new Date(Date.UTC(year, month, 1)); let count = 0; while (d.getUTCMonth() === month) { if (d.getUTCDay() === dow) { count++; if (count === n) return d.toISOString().slice(0, 10); } d.setUTCDate(d.getUTCDate() + 1); } return null; }
    function lastWeekday(year, month, dow) { let d = new Date(Date.UTC(year, month + 1, 0)); while (d.getUTCDay() !== dow) d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); }
    const holidays = new Set([
      `${year}-01-01`, `${year}-07-04`, `${year}-11-11`, `${year}-12-25`,                    // fixed
      nthWeekday(year, 0, 1, 3),                                                              // MLK 3rd Mon Jan
      nthWeekday(year, 1, 1, 3),                                                              // Presidents 3rd Mon Feb
      lastWeekday(year, 4, 1),                                                                // Memorial last Mon May
      `${year}-06-19`,                                                                        // Juneteenth
      nthWeekday(year, 8, 1, 1),                                                              // Labor 1st Mon Sep
      nthWeekday(year, 9, 1, 2),                                                              // Columbus 2nd Mon Oct
      nthWeekday(year, 10, 4, 4),                                                             // Thanksgiving 4th Thu Nov
    ].filter(Boolean));
    let d = new Date(start);
    d.setUTCDate(d.getUTCDate() + RULES[rule].days);
    // FRCP 6(a)(1)(C): roll to next business day if deadline lands on weekend/holiday.
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6 || holidays.has(d.toISOString().slice(0, 10))) {
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return {
      ok: true,
      result: {
        rule,
        ruleName: RULES[rule].name,
        jurisdiction,
        triggerDate: trigger,
        rawDeadline: new Date(new Date(trigger).getTime() + RULES[rule].days * 86_400_000).toISOString().slice(0, 10),
        adjustedDeadline: d.toISOString().slice(0, 10),
        rolledForward: d.toISOString().slice(0, 10) !== new Date(new Date(trigger).getTime() + RULES[rule].days * 86_400_000).toISOString().slice(0, 10),
        days: RULES[rule].days,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Clio "Manage AI" parity — matter update + court-doc → calendar ─

  registerLensAction("legal", "ai-matter-update", async (ctx, _a, params = {}) => {
    const s = getLegalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aid(ctx);
    const matterId = String(params.matterId || "");
    const matter = ensureBucket(s.matters, userId).find(m => m.id === matterId);
    if (!matter) return { ok: false, error: "matter not found" };
    // Build a deterministic activity digest first.
    const cutoff = String(params.since || new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10));
    const recentTime = ensureBucket(s.timeEntries, userId).filter(t => t.matterId === matterId && t.date >= cutoff);
    const recentDocs = ensureBucket(s.documents, userId).filter(d => d.matterId === matterId && (d.createdAt || '').slice(0, 10) >= cutoff);
    const recentEvents = ensureBucket(s.calendar, userId).filter(e => e.matterId === matterId && e.date >= cutoff);
    const recentInvoices = ensureBucket(s.invoices, userId).filter(i => i.matterId === matterId && (i.issuedAt || '') >= cutoff);
    const trustTxns = ensureBucket(s.trustTxns, userId).filter(t => t.matterId === matterId && t.date >= cutoff);
    const hoursRecent = recentTime.reduce((sum, t) => sum + (t.hours || 0), 0);
    const billed = recentTime.reduce((sum, t) => sum + (t.amount || 0), 0);
    const context = `Matter ${matter.name} (${matter.number}, ${matter.matterType}). Since ${cutoff}: ${recentTime.length} time entries (${hoursRecent.toFixed(2)} hrs, $${billed.toFixed(2)}), ${recentDocs.length} documents created, ${recentEvents.length} calendar events, ${recentInvoices.length} invoices issued, ${trustTxns.length} trust transactions.`;
    const deterministic = `Update on ${matter.name} since ${cutoff}: We have logged ${hoursRecent.toFixed(1)} hours of work. ${recentDocs.length > 0 ? `Drafted ${recentDocs.length} document(s) including ${recentDocs.slice(0, 2).map(d => d.name).join(', ')}.` : ''} ${recentEvents.length > 0 ? `Upcoming/recent ${recentEvents.length} event(s).` : ''} ${recentInvoices.length > 0 ? `Issued ${recentInvoices.length} invoice(s) totaling $${recentInvoices.reduce((s, i) => s + i.total, 0).toFixed(2)}.` : ''}`.trim();
    const brain = ctx?.llm?.chat;
    if (typeof brain !== 'function') {
      return { ok: true, result: { summary: deterministic, context, source: 'deterministic' } };
    }
    try {
      const r = await brain({
        messages: [
          { role: 'system', content: "You are a legal assistant drafting a brief client update. Reply in 2-3 short professional sentences. Use only facts from the snapshot. Do not provide legal advice." },
          { role: 'user', content: `Snapshot: ${context}\n\nDraft the client update.` },
        ],
        temperature: 0.2,
        maxTokens: 300,
      });
      const summary = String(r?.content || r?.text || r || '').trim();
      return { ok: true, result: { summary: summary || deterministic, context, source: summary ? 'brain' : 'deterministic' } };
    } catch (e) {
      return { ok: true, result: { summary: deterministic, context, source: 'deterministic_after_brain_error', error: String(e) } };
    }
  });

  // Parse a court document body for deadline language → suggest calendar events.
  registerLensAction("legal", "ai-court-doc-to-calendar", (ctx, _a, params = {}) => {
  try {
    const text = String(params.text || "").slice(0, 12000);
    if (!text || text.length < 40) return { ok: false, error: "text too short" };
    // Deterministic regex pass — pull "within N days" / "by [date]" phrases.
    const suggestions = [];
    const triggerDate = String(params.triggerDate || isoDay());
    const within = /within\s+(\d{1,3})\s+days?(?:\s+of\s+([^.,;]+))?/gi;
    let m;
    while ((m = within.exec(text)) !== null) {
      const days = parseInt(m[1], 10);
      if (days > 0 && days <= 730) {
        const d = new Date(triggerDate);
        d.setUTCDate(d.getUTCDate() + days);
        suggestions.push({
          kind: 'deadline',
          source: 'within_clause',
          days,
          context: text.slice(Math.max(0, m.index - 60), Math.min(text.length, m.index + 120)).trim(),
          suggestedDate: d.toISOString().slice(0, 10),
        });
      }
    }
    const byDate = /by\s+(?:on\s+or\s+before\s+)?([A-Z][a-z]+ \d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})/g;
    while ((m = byDate.exec(text)) !== null) {
      const parsed = new Date(m[1]);
      if (!isNaN(parsed.getTime())) {
        suggestions.push({
          kind: 'deadline',
          source: 'by_date',
          context: text.slice(Math.max(0, m.index - 60), Math.min(text.length, m.index + 120)).trim(),
          suggestedDate: parsed.toISOString().slice(0, 10),
        });
      }
    }
    // Find every month-day-year and ISO date; classify as 'hearing' if surrounding text mentions hearing/trial/conference.
    const allDates = /([A-Z][a-z]+ \d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})/g;
    const seen = new Set(suggestions.map(s => s.suggestedDate));
    while ((m = allDates.exec(text)) !== null) {
      const parsed = new Date(m[1]);
      if (isNaN(parsed.getTime())) continue;
      const dayKey = parsed.toISOString().slice(0, 10);
      if (seen.has(dayKey)) continue;
      const ctx = text.slice(Math.max(0, m.index - 80), Math.min(text.length, m.index + 80)).toLowerCase();
      if (/hearing|trial|conference/.test(ctx)) {
        seen.add(dayKey);
        suggestions.push({
          kind: 'hearing',
          source: 'hearing_clause',
          context: text.slice(Math.max(0, m.index - 60), Math.min(text.length, m.index + 120)).trim(),
          suggestedDate: dayKey,
        });
      }
    }
    return { ok: true, result: { suggestions, count: suggestions.length, triggerDate } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Dashboard summary ─────────────────────────────────────────

  registerLensAction("legal", "dashboard-summary", (ctx, _a, _p = {}) => {
  try {
    const s = getLegalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aid(ctx);
    const matters = ensureBucket(s.matters, userId);
    const time = ensureBucket(s.timeEntries, userId);
    const invoices = ensureBucket(s.invoices, userId);
    const trustTxns = ensureBucket(s.trustTxns, userId);
    const calendar = ensureBucket(s.calendar, userId);
    const timers = ensureBucket(s.timers, userId);
    const today = isoDay();
    const openMatters = matters.filter(m => m.status === 'open' || m.status === 'pending' || m.status === 'intake').length;
    const unbilledTime = time.filter(t => t.status === 'unbilled').reduce((sum, t) => sum + (t.amount || 0), 0);
    const unbilledHours = time.filter(t => t.status === 'unbilled').reduce((sum, t) => sum + (t.hours || 0), 0);
    const openInvTotal = invoices.filter(i => i.status === 'open').reduce((sum, i) => sum + (i.total || 0), 0);
    const overdueCount = invoices.filter(i => i.status === 'open' && (i.dueAt || '') < today).length;
    const trustBalance = trustTxns.reduce((sum, t) => sum + (t.kind === 'deposit' ? t.amount : -t.amount), 0);
    const upcoming = calendar.filter(e => e.date >= today).slice(0, 5);
    return {
      ok: true,
      result: {
        openMatters,
        unbilledHours: Math.round(unbilledHours * 100) / 100,
        unbilledTime: Math.round(unbilledTime),
        openInvTotal: Math.round(openInvTotal),
        overdueInvoices: overdueCount,
        trustBalance: Math.round(trustBalance),
        runningTimers: timers.length,
        upcomingEvents: upcoming,
        contactCount: ensureBucket(s.contacts, userId).length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ═══════════════════════════════════════════════════════════════
  // Parity backlog (May 2026) — client intake forms, online client
  // payment portal, and matter budgeting + realization reporting.
  // ═══════════════════════════════════════════════════════════════

  const FIELD_TYPES = ['text','textarea','email','phone','date','number','select','checkbox'];

  // ── Client intake forms ────────────────────────────────────────
  // A firm builds a reusable intake form (custom fields); a prospective
  // client submits responses; the submission can be converted to a real
  // contact + matter in one call.

  registerLensAction("legal", "intake-forms-list", (ctx, _a, _p = {}) => {
    const s = getLegalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aid(ctx);
    const forms = ensureBucket(s.intakeForms, userId);
    const subs = ensureBucket(s.intakeSubs, userId);
    const withCounts = forms.map(f => ({
      ...f,
      submissionCount: subs.filter(x => x.formId === f.id).length,
      newCount: subs.filter(x => x.formId === f.id && x.status === 'new').length,
    }));
    return { ok: true, result: { forms: withCounts.slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')) } };
  });

  registerLensAction("legal", "intake-forms-create", (ctx, _a, params = {}) => {
  try {
    const s = getLegalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aid(ctx);
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    const rawFields = Array.isArray(params.fields) ? params.fields : [];
    const fields = rawFields.map((f, i) => ({
      key: String(f.key || `field_${i + 1}`).trim().replace(/[^a-z0-9_]/gi, '_').toLowerCase() || `field_${i + 1}`,
      label: String(f.label || `Field ${i + 1}`).trim(),
      type: FIELD_TYPES.includes(f.type) ? f.type : 'text',
      required: f.required === true,
      options: Array.isArray(f.options) ? f.options.map(String) : [],
    })).filter(f => f.label);
    if (fields.length === 0) return { ok: false, error: "at least one field required" };
    const seq = ensureSeqLegal(s, userId);
    const form = {
      id: uid("intakeform"),
      number: `IF-${String(seq.frm).padStart(4, "0")}`,
      name,
      matterType: MATTER_TYPES.includes(params.matterType) ? params.matterType : 'other',
      description: String(params.description || "").slice(0, 500),
      fields,
      status: 'published',
      createdAt: isoNow(),
    };
    seq.frm++;
    ensureBucket(s.intakeForms, userId).push(form);
    saveLegalState();
    return { ok: true, result: { form } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("legal", "intake-forms-delete", (ctx, _a, params = {}) => {
    const s = getLegalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = ensureBucket(s.intakeForms, aid(ctx));
    const i = list.findIndex(f => f.id === String(params.id || ""));
    if (i < 0) return { ok: false, error: "form not found" };
    list.splice(i, 1);
    saveLegalState();
    return { ok: true, result: { deleted: true } };
  });

  registerLensAction("legal", "intake-submit", (ctx, _a, params = {}) => {
  try {
    const s = getLegalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aid(ctx);
    const formId = String(params.formId || "");
    const form = ensureBucket(s.intakeForms, userId).find(f => f.id === formId);
    if (!form) return { ok: false, error: "form not found" };
    const answers = params.answers && typeof params.answers === 'object' ? params.answers : {};
    const missing = form.fields.filter(f => f.required && !String(answers[f.key] ?? '').trim()).map(f => f.label);
    if (missing.length > 0) return { ok: false, error: `required fields missing: ${missing.join(', ')}` };
    const contactName = String(params.contactName || answers.name || answers.full_name || answers.client_name || "").trim();
    if (!contactName) return { ok: false, error: "contactName (or a name answer) required" };
    const seq = ensureSeqLegal(s, userId);
    const sub = {
      id: uid("intakesub"),
      number: `IS-${String(seq.sub).padStart(5, "0")}`,
      formId,
      formName: form.name,
      contactName,
      contactEmail: String(params.contactEmail || answers.email || "").trim(),
      contactPhone: String(params.contactPhone || answers.phone || "").trim(),
      matterType: form.matterType,
      answers: form.fields.reduce((acc, f) => { acc[f.key] = answers[f.key] ?? ''; return acc; }, {}),
      status: 'new',
      convertedContactId: null,
      convertedMatterId: null,
      createdAt: isoNow(),
    };
    seq.sub++;
    ensureBucket(s.intakeSubs, userId).push(sub);
    saveLegalState();
    return { ok: true, result: { submission: sub } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("legal", "intake-submissions-list", (ctx, _a, params = {}) => {
    const s = getLegalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const formId = params.formId ? String(params.formId) : null;
    const status = ['new','converted','declined','all'].includes(params.status) ? params.status : 'all';
    let list = ensureBucket(s.intakeSubs, aid(ctx));
    if (formId) list = list.filter(x => x.formId === formId);
    if (status !== 'all') list = list.filter(x => x.status === status);
    return { ok: true, result: { submissions: list.slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')) } };
  });

  // Convert an intake submission into a real client contact + open matter.
  registerLensAction("legal", "intake-convert", (ctx, _a, params = {}) => {
    const s = getLegalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aid(ctx);
    const sub = ensureBucket(s.intakeSubs, userId).find(x => x.id === String(params.id || ""));
    if (!sub) return { ok: false, error: "submission not found" };
    if (sub.status === 'converted') return { ok: false, error: "submission already converted" };
    const seq = ensureSeqLegal(s, userId);
    const contact = {
      id: uid("party"),
      number: `P-${String(seq.party).padStart(5, "0")}`,
      name: sub.contactName,
      kind: 'client',
      email: sub.contactEmail,
      phone: sub.contactPhone,
      organization: String(sub.answers.organization || ""),
      address: String(sub.answers.address || ""),
      notes: `Created from intake submission ${sub.number}`,
      createdAt: isoNow(),
    };
    seq.party++;
    ensureBucket(s.contacts, userId).push(contact);
    const matter = {
      id: uid("matter"),
      number: `MAT-${String(seq.mat).padStart(5, "0")}`,
      name: String(params.matterName || `${sub.contactName} — ${sub.formName}`),
      clientId: contact.id,
      clientName: contact.name,
      matterType: sub.matterType,
      status: 'intake',
      jurisdiction: "",
      court: "",
      caseNumber: "",
      hourlyRate: Number(params.hourlyRate) || 0,
      flatFee: 0,
      billingType: 'hourly',
      openedAt: isoDay(),
      closedAt: null,
      description: String(sub.answers.description || sub.answers.matter_description || `Intake: ${sub.formName}`).slice(0, 1000),
      partyIds: [contact.id],
    };
    seq.mat++;
    ensureBucket(s.matters, userId).push(matter);
    sub.status = 'converted';
    sub.convertedContactId = contact.id;
    sub.convertedMatterId = matter.id;
    saveLegalState();
    return { ok: true, result: { submission: sub, contact, matter } };
  });

  // ── Online client payment portal ───────────────────────────────
  // Records client payments against an invoice (or a matter as a general
  // retainer/credit). Self-service: the client pays online → status flips.

  const PAYMENT_METHODS = ['card','ach','check','wire','cash'];

  registerLensAction("legal", "payment-record", (ctx, _a, params = {}) => {
  try {
    const s = getLegalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aid(ctx);
    const amount = Number(params.amount);
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "amount must be > 0" };
    const method = PAYMENT_METHODS.includes(params.method) ? params.method : 'card';
    const invoiceId = params.invoiceId ? String(params.invoiceId) : null;
    const matterId = params.matterId ? String(params.matterId) : null;
    let invoice = null;
    let matter = null;
    if (invoiceId) {
      invoice = ensureBucket(s.invoices, userId).find(i => i.id === invoiceId);
      if (!invoice) return { ok: false, error: "invoice not found" };
    }
    if (matterId) {
      matter = ensureBucket(s.matters, userId).find(m => m.id === matterId);
      if (!matter) return { ok: false, error: "matter not found" };
    }
    if (!invoice && !matter) return { ok: false, error: "invoiceId or matterId required" };
    const resolvedMatterId = invoice ? invoice.matterId : matterId;
    // Card payments incur a processing fee (Concord token-purchase rate parity).
    const feeRate = method === 'card' ? 0.029 : 0;
    const processingFee = Math.round(amount * feeRate * 100) / 100;
    const netAmount = Math.round((amount - processingFee) * 100) / 100;
    const seq = ensureSeqLegal(s, userId);
    const payment = {
      id: uid("pay"),
      number: `PMT-${String(seq.pay).padStart(5, "0")}`,
      invoiceId,
      invoiceNumber: invoice ? invoice.number : null,
      matterId: resolvedMatterId,
      matterName: invoice ? invoice.matterName : (matter ? matter.name : ""),
      clientName: invoice ? invoice.clientName : (matter ? matter.clientName : String(params.clientName || "")),
      amount,
      method,
      processingFee,
      netAmount,
      reference: String(params.reference || ""),
      memo: String(params.memo || (invoice ? `Payment for ${invoice.number}` : "Retainer / account credit")),
      portalPaid: params.portalPaid === true,
      date: String(params.date || isoDay()),
      createdAt: isoNow(),
    };
    seq.pay++;
    ensureBucket(s.payments, userId).push(payment);
    // Apply against the invoice — flip to paid when fully covered.
    if (invoice) {
      const paidSoFar = ensureBucket(s.payments, userId)
        .filter(p => p.invoiceId === invoice.id)
        .reduce((sum, p) => sum + p.amount, 0);
      payment.invoiceBalanceAfter = Math.round((invoice.total - paidSoFar) * 100) / 100;
      if (paidSoFar + 0.01 >= invoice.total && invoice.status !== 'paid') {
        invoice.status = 'paid';
        invoice.paidAt = payment.date;
        invoice.paidVia = method;
      }
    }
    saveLegalState();
    return { ok: true, result: { payment, invoice: invoice || null } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("legal", "payments-list", (ctx, _a, params = {}) => {
  try {
    const s = getLegalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const matterId = params.matterId ? String(params.matterId) : null;
    const invoiceId = params.invoiceId ? String(params.invoiceId) : null;
    let list = ensureBucket(s.payments, aid(ctx));
    if (matterId) list = list.filter(p => p.matterId === matterId);
    if (invoiceId) list = list.filter(p => p.invoiceId === invoiceId);
    const total = list.reduce((sum, p) => sum + p.amount, 0);
    const fees = list.reduce((sum, p) => sum + (p.processingFee || 0), 0);
    return {
      ok: true,
      result: {
        payments: list.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')),
        total: Math.round(total * 100) / 100,
        processingFees: Math.round(fees * 100) / 100,
        netReceived: Math.round((total - fees) * 100) / 100,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // Client-facing portal view: what a given client owes + has paid.
  registerLensAction("legal", "payment-portal-summary", (ctx, _a, params = {}) => {
  try {
    const s = getLegalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aid(ctx);
    const matterId = params.matterId ? String(params.matterId) : null;
    let invoices = ensureBucket(s.invoices, userId);
    let payments = ensureBucket(s.payments, userId);
    if (matterId) {
      invoices = invoices.filter(i => i.matterId === matterId);
      payments = payments.filter(p => p.matterId === matterId);
    }
    const openInvoices = invoices.filter(i => i.status === 'open').map(inv => {
      const paid = payments.filter(p => p.invoiceId === inv.id).reduce((sum, p) => sum + p.amount, 0);
      return {
        id: inv.id,
        number: inv.number,
        matterName: inv.matterName,
        clientName: inv.clientName,
        issuedAt: inv.issuedAt,
        dueAt: inv.dueAt,
        total: inv.total,
        paid: Math.round(paid * 100) / 100,
        balance: Math.round((inv.total - paid) * 100) / 100,
        overdue: (inv.dueAt || '') < isoDay(),
      };
    });
    const totalDue = openInvoices.reduce((sum, i) => sum + i.balance, 0);
    const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
    return {
      ok: true,
      result: {
        openInvoices: openInvoices.sort((a, b) => (a.dueAt || '').localeCompare(b.dueAt || '')),
        totalDue: Math.round(totalDue * 100) / 100,
        totalPaid: Math.round(totalPaid * 100) / 100,
        overdueCount: openInvoices.filter(i => i.overdue).length,
        paidInvoiceCount: invoices.filter(i => i.status === 'paid').length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Matter budgeting + realization / collection-rate reporting ─

  registerLensAction("legal", "budget-set", (ctx, _a, params = {}) => {
    const s = getLegalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aid(ctx);
    const matterId = String(params.matterId || "");
    const matter = ensureBucket(s.matters, userId).find(m => m.id === matterId);
    if (!matter) return { ok: false, error: "matter not found" };
    const budgetAmount = Number(params.budgetAmount);
    if (!Number.isFinite(budgetAmount) || budgetAmount < 0) return { ok: false, error: "budgetAmount must be >= 0" };
    const budgetHours = Number.isFinite(Number(params.budgetHours)) ? Number(params.budgetHours) : 0;
    const budget = {
      matterId,
      matterName: matter.name,
      budgetAmount,
      budgetHours,
      alertThreshold: Number.isFinite(Number(params.alertThreshold)) && Number(params.alertThreshold) > 0 && Number(params.alertThreshold) <= 1
        ? Number(params.alertThreshold) : 0.8,
      note: String(params.note || "").slice(0, 300),
      updatedAt: isoNow(),
    };
    s.budgets.set(`${userId}::${matterId}`, budget);
    saveLegalState();
    return { ok: true, result: { budget } };
  });

  // Realization report for one matter: budget vs worked vs billed vs collected.
  registerLensAction("legal", "budget-report", (ctx, _a, params = {}) => {
  try {
    const s = getLegalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aid(ctx);
    const matterId = String(params.matterId || "");
    const matter = ensureBucket(s.matters, userId).find(m => m.id === matterId);
    if (!matter) return { ok: false, error: "matter not found" };
    const budget = s.budgets.get(`${userId}::${matterId}`) || null;
    const time = ensureBucket(s.timeEntries, userId).filter(t => t.matterId === matterId);
    const invoices = ensureBucket(s.invoices, userId).filter(i => i.matterId === matterId);
    const payments = ensureBucket(s.payments, userId).filter(p => p.matterId === matterId);
    // Worked value = potential value of all billable hours at their rate.
    const workedValue = Math.round(time.filter(t => t.status !== 'non_billable')
      .reduce((sum, t) => sum + (t.amount || 0), 0) * 100) / 100;
    const workedHours = Math.round(time.reduce((sum, t) => sum + (t.hours || 0), 0) * 100) / 100;
    const billableHours = Math.round(time.filter(t => t.status !== 'non_billable')
      .reduce((sum, t) => sum + (t.hours || 0), 0) * 100) / 100;
    const billedValue = Math.round(invoices.reduce((sum, i) => sum + (i.subtotal || 0), 0) * 100) / 100;
    const collectedValue = Math.round(payments.reduce((sum, p) => sum + p.amount, 0) * 100) / 100;
    // Realization = billed / worked.  Collection = collected / billed.
    const realizationRate = workedValue > 0 ? Math.round((billedValue / workedValue) * 1000) / 1000 : null;
    const collectionRate = billedValue > 0 ? Math.round((collectedValue / billedValue) * 1000) / 1000 : null;
    const overallRate = workedValue > 0 ? Math.round((collectedValue / workedValue) * 1000) / 1000 : null;
    const utilizationRate = workedHours > 0 ? Math.round((billableHours / workedHours) * 1000) / 1000 : null;
    let budgetStatus = null;
    if (budget && budget.budgetAmount > 0) {
      const consumed = workedValue / budget.budgetAmount;
      budgetStatus = {
        consumedFraction: Math.round(consumed * 1000) / 1000,
        remaining: Math.round((budget.budgetAmount - workedValue) * 100) / 100,
        overBudget: workedValue > budget.budgetAmount,
        alert: consumed >= budget.alertThreshold,
        hoursConsumedFraction: budget.budgetHours > 0
          ? Math.round((workedHours / budget.budgetHours) * 1000) / 1000 : null,
      };
    }
    return {
      ok: true,
      result: {
        matterId,
        matterName: matter.name,
        budget,
        budgetStatus,
        workedValue,
        workedHours,
        billableHours,
        billedValue,
        collectedValue,
        realizationRate,
        collectionRate,
        overallRate,
        utilizationRate,
        unbilledValue: Math.round((workedValue - billedValue) * 100) / 100,
        uncollectedValue: Math.round((billedValue - collectedValue) * 100) / 100,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // Firm-wide realization rollup across every matter.
  registerLensAction("legal", "realization-rollup", (ctx, _a, _p = {}) => {
  try {
    const s = getLegalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aid(ctx);
    const matters = ensureBucket(s.matters, userId);
    const time = ensureBucket(s.timeEntries, userId);
    const invoices = ensureBucket(s.invoices, userId);
    const payments = ensureBucket(s.payments, userId);
    const rows = matters.map(m => {
      const mt = time.filter(t => t.matterId === m.id);
      const worked = mt.filter(t => t.status !== 'non_billable').reduce((sum, t) => sum + (t.amount || 0), 0);
      const billed = invoices.filter(i => i.matterId === m.id).reduce((sum, i) => sum + (i.subtotal || 0), 0);
      const collected = payments.filter(p => p.matterId === m.id).reduce((sum, p) => sum + p.amount, 0);
      const budget = s.budgets.get(`${userId}::${m.id}`) || null;
      return {
        matterId: m.id,
        matterName: m.name,
        status: m.status,
        worked: Math.round(worked * 100) / 100,
        billed: Math.round(billed * 100) / 100,
        collected: Math.round(collected * 100) / 100,
        realizationRate: worked > 0 ? Math.round((billed / worked) * 1000) / 1000 : null,
        collectionRate: billed > 0 ? Math.round((collected / billed) * 1000) / 1000 : null,
        budgetAmount: budget ? budget.budgetAmount : null,
        overBudget: budget && budget.budgetAmount > 0 ? worked > budget.budgetAmount : false,
      };
    });
    const totWorked = rows.reduce((sum, r) => sum + r.worked, 0);
    const totBilled = rows.reduce((sum, r) => sum + r.billed, 0);
    const totCollected = rows.reduce((sum, r) => sum + r.collected, 0);
    return {
      ok: true,
      result: {
        matters: rows.sort((a, b) => b.worked - a.worked),
        totals: {
          worked: Math.round(totWorked * 100) / 100,
          billed: Math.round(totBilled * 100) / 100,
          collected: Math.round(totCollected * 100) / 100,
          firmRealizationRate: totWorked > 0 ? Math.round((totBilled / totWorked) * 1000) / 1000 : null,
          firmCollectionRate: totBilled > 0 ? Math.round((totCollected / totBilled) * 1000) / 1000 : null,
          mattersOverBudget: rows.filter(r => r.overBudget).length,
        },
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});
};

function extractJsonLegal(text) {
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : text;
  const first = body.indexOf("{");
  const last = body.lastIndexOf("}");
  if (first < 0 || last <= first) return null;
  try { return JSON.parse(body.slice(first, last + 1)); } catch { return null; }
}
