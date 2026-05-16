export default function registerLegalActions(registerLensAction) {
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
      const hours = parseFloat(e.hours) || 0;
      const rate = parseFloat(e.rate) || 0;
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
    const timeEntries = artifact.data?.timeEntries || [];
    const expenses = artifact.data?.expenses || [];
    const taxRate = params.taxRate != null ? params.taxRate : 0;

    let totalHours = 0;
    const lineItems = timeEntries.map((entry, idx) => {
      const hours = parseFloat(entry.hours) || 0;
      const rate = parseFloat(entry.rate) || 0;
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
      amount: Math.round((parseFloat(e.amount) || 0) * 100) / 100,
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
    return STATE.legalLens;
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
