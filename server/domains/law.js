// server/domains/law.js
// Domain actions for law: case analysis, statute lookup, deadline
// tracking, billing calculation, plus real USPTO PatentsView (patent
// search) and CourtListener (federal + state case opinions).
//
// USPTO PatentsView is free + no API key.
// CourtListener search is free without auth; full text + dockets
// require a free COURTLISTENER_API_TOKEN env (courtlistener.com/help/api/rest/).

const USPTO_PATENTSVIEW = "https://search.patentsview.org/api/v1";
const COURTLISTENER_BASE = "https://www.courtlistener.com/api/rest/v4";

export default function registerLawActions(registerLensAction) {
  /**
   * caseAnalysis
   * Analyze case data: compute duration, categorize by type, track outcomes and win rates.
   * artifact.data.cases = [{ id, type, filedDate, closedDate, outcome, parties, judge, ... }]
   */
  registerLensAction("law", "caseAnalysis", (ctx, artifact, _params) => {
    const cases = artifact.data?.cases || [];
    if (cases.length === 0) {
      return { ok: true, result: { message: "No case data provided. Supply artifact.data.cases as an array of case objects with fields: id, type, filedDate, closedDate, outcome." } };
    }

    const now = new Date();
    const r = (v) => Math.round(v * 100) / 100;

    // Compute duration for each case
    const analyzed = cases.map(c => {
      const filed = c.filedDate ? new Date(c.filedDate) : null;
      const closed = c.closedDate ? new Date(c.closedDate) : null;
      const endDate = closed || now;
      const durationDays = filed ? Math.ceil((endDate - filed) / (1000 * 60 * 60 * 24)) : null;
      return {
        id: c.id,
        type: (c.type || "unknown").toLowerCase(),
        outcome: (c.outcome || "pending").toLowerCase(),
        durationDays,
        isOpen: !closed,
        parties: c.parties || [],
        judge: c.judge || null,
      };
    });

    // Categorize by type
    const byType = {};
    for (const c of analyzed) {
      if (!byType[c.type]) byType[c.type] = { count: 0, totalDuration: 0, withDuration: 0, outcomes: {} };
      byType[c.type].count++;
      if (c.durationDays !== null) {
        byType[c.type].totalDuration += c.durationDays;
        byType[c.type].withDuration++;
      }
      const out = c.outcome;
      byType[c.type].outcomes[out] = (byType[c.type].outcomes[out] || 0) + 1;
    }

    // Compute averages per type
    const typeBreakdown = Object.entries(byType).map(([type, data]) => ({
      type,
      count: data.count,
      avgDurationDays: data.withDuration > 0 ? r(data.totalDuration / data.withDuration) : null,
      outcomes: data.outcomes,
    }));

    // Overall outcome tracking
    const outcomeCounts = {};
    let closedCount = 0;
    for (const c of analyzed) {
      if (!c.isOpen) {
        closedCount++;
        outcomeCounts[c.outcome] = (outcomeCounts[c.outcome] || 0) + 1;
      }
    }

    // Win rate calculation (outcomes containing "won", "win", "favorable", "settled")
    const winKeywords = ["won", "win", "favorable", "settled", "dismissed"];
    const lossKeywords = ["lost", "loss", "unfavorable", "adverse"];
    let wins = 0;
    let losses = 0;
    for (const [outcome, count] of Object.entries(outcomeCounts)) {
      if (winKeywords.some(k => outcome.includes(k))) wins += count;
      if (lossKeywords.some(k => outcome.includes(k))) losses += count;
    }
    const decided = wins + losses;
    const winRate = decided > 0 ? r((wins / decided) * 100) : null;

    // Duration statistics
    const durations = analyzed.filter(c => c.durationDays !== null).map(c => c.durationDays);
    const avgDuration = durations.length > 0 ? r(durations.reduce((s, d) => s + d, 0) / durations.length) : null;
    const sortedDurations = [...durations].sort((a, b) => a - b);
    const medianDuration = sortedDurations.length > 0
      ? sortedDurations.length % 2 === 0
        ? r((sortedDurations[sortedDurations.length / 2 - 1] + sortedDurations[sortedDurations.length / 2]) / 2)
        : sortedDurations[Math.floor(sortedDurations.length / 2)]
      : null;

    // Judge breakdown
    const byJudge = {};
    for (const c of analyzed) {
      if (c.judge) {
        if (!byJudge[c.judge]) byJudge[c.judge] = { total: 0, wins: 0, losses: 0 };
        byJudge[c.judge].total++;
        if (!c.isOpen) {
          if (winKeywords.some(k => c.outcome.includes(k))) byJudge[c.judge].wins++;
          if (lossKeywords.some(k => c.outcome.includes(k))) byJudge[c.judge].losses++;
        }
      }
    }
    const judgeStats = Object.entries(byJudge).map(([judge, data]) => ({
      judge,
      totalCases: data.total,
      wins: data.wins,
      losses: data.losses,
      winRate: (data.wins + data.losses) > 0 ? r((data.wins / (data.wins + data.losses)) * 100) : null,
    }));

    return {
      ok: true,
      result: {
        totalCases: cases.length,
        openCases: analyzed.filter(c => c.isOpen).length,
        closedCases: closedCount,
        duration: { avgDays: avgDuration, medianDays: medianDuration, minDays: sortedDurations[0] || null, maxDays: sortedDurations[sortedDurations.length - 1] || null },
        typeBreakdown,
        outcomes: outcomeCounts,
        winRate: { wins, losses, decided, percentage: winRate },
        judgeStats,
      },
    };
  });

  /**
   * statuteLookup
   * Search statutes by keyword in provisions array, rank by relevance.
   * artifact.data.statutes = [{ code, title, provisions: [{ section, text }], jurisdiction }]
   */
  registerLensAction("law", "statuteLookup", (ctx, artifact, _params) => {
    const statutes = artifact.data?.statutes || [];
    const query = (artifact.data?.query || _params.query || "").toLowerCase().trim();

    if (statutes.length === 0) {
      return { ok: true, result: { message: "No statutes provided. Supply artifact.data.statutes as an array of statute objects with code, title, and provisions." } };
    }
    if (!query) {
      return { ok: true, result: { message: "No search query provided. Supply artifact.data.query or params.query with keywords to search.", totalStatutes: statutes.length } };
    }

    const keywords = query.split(/\s+/).filter(k => k.length > 0);

    // Score each provision against the query
    const results = [];
    for (const statute of statutes) {
      const provisions = statute.provisions || [];
      for (const provision of provisions) {
        const text = (provision.text || "").toLowerCase();
        const title = (provision.title || statute.title || "").toLowerCase();
        const section = provision.section || "";

        // Count keyword matches in text and title
        let textMatches = 0;
        let titleMatches = 0;
        const exactPhraseMatch = text.includes(query) || title.includes(query);

        for (const kw of keywords) {
          // Count occurrences in text
          let idx = 0;
          let count = 0;
          while ((idx = text.indexOf(kw, idx)) !== -1) { count++; idx += kw.length; }
          textMatches += count;

          // Count occurrences in title
          idx = 0;
          count = 0;
          while ((idx = title.indexOf(kw, idx)) !== -1) { count++; idx += kw.length; }
          titleMatches += count;
        }

        if (textMatches === 0 && titleMatches === 0) continue;

        // Relevance scoring: title matches weighted 3x, exact phrase bonus, normalize by text length
        const textLen = Math.max(text.split(/\s+/).length, 1);
        const density = textMatches / textLen;
        const relevanceScore = (titleMatches * 3) + textMatches + (density * 10) + (exactPhraseMatch ? 5 : 0);

        results.push({
          code: statute.code,
          jurisdiction: statute.jurisdiction || null,
          section,
          title: statute.title || provision.title || "",
          snippet: extractSnippet(text, keywords, 120),
          relevanceScore: Math.round(relevanceScore * 100) / 100,
          keywordHits: textMatches + titleMatches,
          exactPhraseMatch,
        });
      }
    }

    // Sort by relevance descending
    results.sort((a, b) => b.relevanceScore - a.relevanceScore);

    // Group by statute code
    const byCode = {};
    for (const r of results) {
      if (!byCode[r.code]) byCode[r.code] = { code: r.code, jurisdiction: r.jurisdiction, matchCount: 0, topScore: 0 };
      byCode[r.code].matchCount++;
      byCode[r.code].topScore = Math.max(byCode[r.code].topScore, r.relevanceScore);
    }

    return {
      ok: true,
      result: {
        query,
        keywords,
        totalMatches: results.length,
        matches: results.slice(0, 20),
        statuteSummary: Object.values(byCode).sort((a, b) => b.topScore - a.topScore),
      },
    };
  });

  /**
   * deadlineTracker
   * Calculate days remaining for legal deadlines, flag overdue and urgent items.
   * artifact.data.deadlines = [{ id, description, dueDate, category, status, filingType }]
   */
  registerLensAction("law", "deadlineTracker", (ctx, artifact, _params) => {
    const deadlines = artifact.data?.deadlines || [];
    if (deadlines.length === 0) {
      return { ok: true, result: { message: "No deadlines provided. Supply artifact.data.deadlines as an array with id, description, dueDate, category, and status fields." } };
    }

    const now = new Date();
    const urgentThresholdDays = _params.urgentDays || 7;
    const warningThresholdDays = _params.warningDays || 14;

    const processed = deadlines.map(d => {
      const due = d.dueDate ? new Date(d.dueDate) : null;
      if (!due || isNaN(due.getTime())) {
        return { ...d, daysRemaining: null, status: "invalid_date", priority: "unknown" };
      }

      const daysRemaining = Math.ceil((due - now) / (1000 * 60 * 60 * 24));
      const isCompleted = (d.status || "").toLowerCase() === "completed" || (d.status || "").toLowerCase() === "done";

      let priority;
      if (isCompleted) priority = "completed";
      else if (daysRemaining < 0) priority = "overdue";
      else if (daysRemaining <= urgentThresholdDays) priority = "urgent";
      else if (daysRemaining <= warningThresholdDays) priority = "warning";
      else priority = "on_track";

      return {
        id: d.id,
        description: d.description || "Untitled deadline",
        category: d.category || "general",
        filingType: d.filingType || null,
        dueDate: d.dueDate,
        daysRemaining,
        priority,
        isCompleted,
        isOverdue: daysRemaining < 0 && !isCompleted,
        isUrgent: daysRemaining >= 0 && daysRemaining <= urgentThresholdDays && !isCompleted,
      };
    });

    // Sort: overdue first (most overdue at top), then by days remaining ascending
    processed.sort((a, b) => {
      if (a.isCompleted && !b.isCompleted) return 1;
      if (!a.isCompleted && b.isCompleted) return -1;
      if (a.daysRemaining === null) return 1;
      if (b.daysRemaining === null) return -1;
      return a.daysRemaining - b.daysRemaining;
    });

    // Category breakdown
    const byCategory = {};
    for (const d of processed) {
      const cat = d.category;
      if (!byCategory[cat]) byCategory[cat] = { total: 0, overdue: 0, urgent: 0, onTrack: 0, completed: 0 };
      byCategory[cat].total++;
      if (d.isOverdue) byCategory[cat].overdue++;
      else if (d.isUrgent) byCategory[cat].urgent++;
      else if (d.isCompleted) byCategory[cat].completed++;
      else byCategory[cat].onTrack++;
    }

    // Summary counts
    const overdue = processed.filter(d => d.isOverdue);
    const urgent = processed.filter(d => d.isUrgent);
    const completed = processed.filter(d => d.isCompleted);
    const upcoming = processed.filter(d => !d.isOverdue && !d.isUrgent && !d.isCompleted && d.daysRemaining !== null);

    // Average days remaining for non-completed items
    const activeDays = processed.filter(d => !d.isCompleted && d.daysRemaining !== null).map(d => d.daysRemaining);
    const avgDaysRemaining = activeDays.length > 0 ? Math.round((activeDays.reduce((s, d) => s + d, 0) / activeDays.length) * 100) / 100 : null;

    return {
      ok: true,
      result: {
        summary: {
          total: processed.length,
          overdue: overdue.length,
          urgent: urgent.length,
          upcoming: upcoming.length,
          completed: completed.length,
          avgDaysRemaining,
        },
        overdue: overdue.map(d => ({ id: d.id, description: d.description, daysOverdue: Math.abs(d.daysRemaining), category: d.category })),
        urgent: urgent.map(d => ({ id: d.id, description: d.description, daysRemaining: d.daysRemaining, category: d.category })),
        byCategory,
        allDeadlines: processed,
      },
    };
  });

  /**
   * billingCalculator
   * Compute legal billing from time entries: hourly rates, totals, by-attorney breakdown.
   * artifact.data.timeEntries = [{ attorney, hours, rate, date, description, category, billable }]
   */
  registerLensAction("law", "billingCalculator", (ctx, artifact, _params) => {
    const entries = artifact.data?.timeEntries || [];
    if (entries.length === 0) {
      return { ok: true, result: { message: "No time entries provided. Supply artifact.data.timeEntries as an array with attorney, hours, rate, date, description, category, and billable fields." } };
    }

    const r = (v) => Math.round(v * 100) / 100;
    const taxRate = _params.taxRate || 0;
    const discountPercent = _params.discountPercent || 0;

    // Process each entry
    const processed = entries.map(e => {
      const hours = parseFloat(e.hours) || 0;
      const rate = parseFloat(e.rate) || 0;
      const isBillable = e.billable !== false;
      return {
        attorney: e.attorney || "Unassigned",
        hours,
        rate,
        amount: r(hours * rate),
        date: e.date || null,
        description: e.description || "",
        category: e.category || "general",
        billable: isBillable,
      };
    });

    // By-attorney breakdown
    const byAttorney = {};
    for (const e of processed) {
      if (!byAttorney[e.attorney]) {
        byAttorney[e.attorney] = { totalHours: 0, billableHours: 0, nonBillableHours: 0, totalAmount: 0, billableAmount: 0, rates: new Set(), entryCount: 0 };
      }
      byAttorney[e.attorney].totalHours += e.hours;
      byAttorney[e.attorney].entryCount++;
      if (e.billable) {
        byAttorney[e.attorney].billableHours += e.hours;
        byAttorney[e.attorney].billableAmount += e.amount;
      } else {
        byAttorney[e.attorney].nonBillableHours += e.hours;
      }
      byAttorney[e.attorney].totalAmount += e.amount;
      if (e.rate > 0) byAttorney[e.attorney].rates.add(e.rate);
    }

    const attorneyBreakdown = Object.entries(byAttorney).map(([attorney, data]) => ({
      attorney,
      totalHours: r(data.totalHours),
      billableHours: r(data.billableHours),
      nonBillableHours: r(data.nonBillableHours),
      billableAmount: r(data.billableAmount),
      totalAmount: r(data.totalAmount),
      utilizationRate: data.totalHours > 0 ? r((data.billableHours / data.totalHours) * 100) : 0,
      rates: [...data.rates].sort((a, b) => a - b),
      effectiveRate: data.billableHours > 0 ? r(data.billableAmount / data.billableHours) : 0,
      entryCount: data.entryCount,
    })).sort((a, b) => b.billableAmount - a.billableAmount);

    // By category
    const byCategory = {};
    for (const e of processed) {
      if (!byCategory[e.category]) byCategory[e.category] = { hours: 0, amount: 0, count: 0 };
      byCategory[e.category].hours += e.hours;
      byCategory[e.category].amount += e.amount;
      byCategory[e.category].count++;
    }
    const categoryBreakdown = Object.entries(byCategory).map(([category, data]) => ({
      category,
      hours: r(data.hours),
      amount: r(data.amount),
      count: data.count,
    })).sort((a, b) => b.amount - a.amount);

    // By date (monthly)
    const byMonth = {};
    for (const e of processed) {
      if (e.date) {
        const month = e.date.substring(0, 7); // YYYY-MM
        if (!byMonth[month]) byMonth[month] = { hours: 0, amount: 0, count: 0 };
        byMonth[month].hours += e.hours;
        byMonth[month].amount += e.amount;
        byMonth[month].count++;
      }
    }
    const monthlyBreakdown = Object.entries(byMonth)
      .map(([month, data]) => ({ month, hours: r(data.hours), amount: r(data.amount), count: data.count }))
      .sort((a, b) => a.month.localeCompare(b.month));

    // Grand totals
    const totalBillableHours = r(processed.filter(e => e.billable).reduce((s, e) => s + e.hours, 0));
    const totalNonBillableHours = r(processed.filter(e => !e.billable).reduce((s, e) => s + e.hours, 0));
    const subtotal = r(processed.filter(e => e.billable).reduce((s, e) => s + e.amount, 0));
    const discount = r(subtotal * (discountPercent / 100));
    const afterDiscount = r(subtotal - discount);
    const tax = r(afterDiscount * (taxRate / 100));
    const grandTotal = r(afterDiscount + tax);

    return {
      ok: true,
      result: {
        totals: {
          billableHours: totalBillableHours,
          nonBillableHours: totalNonBillableHours,
          totalHours: r(totalBillableHours + totalNonBillableHours),
          subtotal,
          discountPercent,
          discount,
          afterDiscount,
          taxRate,
          tax,
          grandTotal,
          entryCount: processed.length,
        },
        attorneyBreakdown,
        categoryBreakdown,
        monthlyBreakdown,
      },
    };
  });

  /**
   * uspto-patent-search — Real US patent search via USPTO PatentsView.
   * Free, no API key. Searches by inventor name, title keyword, or
   * assignee. Returns patent number, title, abstract, grant date,
   * inventor, assignee.
   *
   * params: { query: string, field?: "title"|"abstract"|"inventor"|"assignee", limit?: 1-100 }
   */
  registerLensAction("law", "uspto-patent-search", async (_ctx, _artifact, params = {}) => {
    const query = String(params.query || "").trim();
    if (!query) return { ok: false, error: "query required" };
    const field = ["title", "abstract", "inventor", "assignee"].includes(params.field) ? params.field : "title";
    const limit = Math.max(1, Math.min(100, Number(params.limit) || 25));
    const queryShape = field === "title"
      ? { _text_phrase: { patent_title: query } }
      : field === "abstract"
      ? { _text_phrase: { patent_abstract: query } }
      : field === "inventor"
      ? { _text_phrase: { inventor_name_last: query } }
      : { _text_phrase: { assignee_organization: query } };
    try {
      const url = `${USPTO_PATENTSVIEW}/patent/?q=${encodeURIComponent(JSON.stringify(queryShape))}&f=${encodeURIComponent(JSON.stringify(["patent_id","patent_title","patent_abstract","patent_date","inventors","assignees"]))}&o=${encodeURIComponent(JSON.stringify({ per_page: limit }))}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`uspto ${r.status}`);
      const data = await r.json();
      const patents = (data.patents || []).map((p) => ({
        patentId: p.patent_id,
        title: p.patent_title,
        abstract: p.patent_abstract,
        grantDate: p.patent_date,
        inventors: (p.inventors || []).map((i) => `${i.inventor_name_first} ${i.inventor_name_last}`.trim()),
        assignees: (p.assignees || []).map((a) => a.assignee_organization || a.assignee_individual_name).filter(Boolean),
      }));
      return {
        ok: true,
        result: {
          query, field,
          patents, count: patents.length,
          totalHits: data.count || data.total_patent_count,
          source: "uspto-patentsview",
        },
      };
    } catch (e) {
      return { ok: false, error: `uspto unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * courtlistener-search — Real federal + state case opinion search
   * via CourtListener (Free Law Project). Search-only endpoint is
   * unauthenticated; full-text + dockets require COURTLISTENER_API_TOKEN
   * env (free at courtlistener.com/help/api/rest/).
   *
   * params: { query: string, court?: court code (e.g. "scotus"|"ca9"|"cal-1"),
   *           dateAfter?: "YYYY-MM-DD", dateBefore?: "YYYY-MM-DD", limit?: 1-50 }
   */
  registerLensAction("law", "courtlistener-search", async (_ctx, _artifact, params = {}) => {
    const query = String(params.query || "").trim();
    if (!query) return { ok: false, error: "query required" };
    const limit = Math.max(1, Math.min(50, Number(params.limit) || 10));
    const token = process.env.COURTLISTENER_API_TOKEN;
    const qs = new URLSearchParams({ q: query, type: "o" });  // type=o = opinions
    if (params.court) qs.set("court", String(params.court));
    if (params.dateAfter) qs.set("filed_after", String(params.dateAfter));
    if (params.dateBefore) qs.set("filed_before", String(params.dateBefore));
    qs.set("page_size", String(limit));
    try {
      const headers = token ? { Authorization: `Token ${token}` } : {};
      const r = await fetch(`${COURTLISTENER_BASE}/search/?${qs.toString()}`, { headers });
      if (!r.ok) {
        if (r.status === 429) return { ok: false, error: "courtlistener rate limit — set COURTLISTENER_API_TOKEN env" };
        throw new Error(`courtlistener ${r.status}`);
      }
      const data = await r.json();
      const results = (data.results || []).map((o) => ({
        id: o.id,
        caseName: o.caseName,
        court: o.court,
        courtId: o.court_id,
        dateFiled: o.dateFiled,
        absoluteUrl: o.absolute_url ? `https://www.courtlistener.com${o.absolute_url}` : null,
        snippet: o.snippet,
        citation: o.citation,
        precedentialStatus: o.status,
        docketNumber: o.docketNumber,
        judges: o.judge,
        author: o.author,
      }));
      return {
        ok: true,
        result: {
          query,
          results, count: results.length,
          totalHits: data.count,
          authenticatedWithToken: !!token,
          source: "courtlistener",
        },
      };
    } catch (e) {
      return { ok: false, error: `courtlistener unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });
}

/**
 * Extract a text snippet around the first keyword match.
 */
function extractSnippet(text, keywords, maxLen) {
  const words = text.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    for (const kw of keywords) {
      if (words[i].includes(kw)) {
        const start = Math.max(0, i - 5);
        const end = Math.min(words.length, i + 15);
        let snippet = words.slice(start, end).join(" ");
        if (start > 0) snippet = "..." + snippet;
        if (end < words.length) snippet = snippet + "...";
        if (snippet.length > maxLen) snippet = snippet.substring(0, maxLen) + "...";
        return snippet;
      }
    }
  }
  return text.substring(0, maxLen) + (text.length > maxLen ? "..." : "");
}
