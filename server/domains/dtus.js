// server/domains/dtus.js
// Domain actions for DTU management: lineage analysis, quality scoring,
// citation network analysis, tier recommendation, and duplication detection.
//
// Phase: knowledge-base browser parity — adds citation graph projection,
// faceted search, lineage tree drill-down, bulk operations, side-by-side
// compare + merge, saved views / smart collections, and a 4-layer DTU
// editor backed by a persistent per-user overlay store.

// ── Persistent per-user state ────────────────────────────────────────
// Saved views and 4-layer editor overlays live in process-global Maps
// keyed by userId. The DTU corpus itself is owned by the substrate; the
// overlay store only holds user-authored metadata (collections + layer
// edits) so the editor and saved-view features survive within a session.
function dtuStore() {
  const g = globalThis;
  if (!g._concordSTATE) g._concordSTATE = {};
  const STATE = g._concordSTATE;
  if (!STATE.dtusLens) {
    STATE.dtusLens = {
      views: new Map(),   // userId -> Array<{ id, name, filter, createdAt }>
      layers: new Map(),  // userId -> Map<dtuId, { human, core, machine, artifact, updatedAt }>
      seq: new Map(),     // userId -> { view }
    };
  }
  return STATE.dtusLens;
}

function actorId(ctx) {
  return ctx?.actor?.userId || ctx?.userId || "anon";
}

function ensureList(map, userId) {
  if (!map.has(userId)) map.set(userId, []);
  return map.get(userId);
}

function ensureLayerMap(map, userId) {
  if (!map.has(userId)) map.set(userId, new Map());
  return map.get(userId);
}

function nextSeq(s, userId, key) {
  if (!s.seq.has(userId)) s.seq.set(userId, { view: 1 });
  const seq = s.seq.get(userId);
  const n = seq[key] || 1;
  seq[key] = n + 1;
  return n;
}

// Normalize an arbitrary DTU-shaped record into the fields the lens needs.
function normalizeDtu(d) {
  if (!d || typeof d !== "object") return null;
  const data = d.data || {};
  const meta = d.meta || {};
  return {
    id: d.id || d.dtuId || null,
    title: d.title || d.summary || data.title || "",
    summary: d.summary || data.summary || "",
    tier: (d.tier || data.tier || meta.tier || "regular").toLowerCase(),
    layer: (d.layer || data.layer || meta.layer || "core").toLowerCase(),
    scope: (d.scope || data.scope || meta.scope || "personal").toLowerCase(),
    tags: Array.isArray(d.tags) ? d.tags
      : Array.isArray(meta.tags) ? meta.tags
      : Array.isArray(data.tags) ? data.tags : [],
    quality: Number(d.quality ?? data.qualityScore ?? meta.qualityScore ?? 0),
    citationCount: Number(d.citationCount ?? data.citationCount ?? meta.citationCount ?? 0),
    parents: Array.isArray(d.parents) ? d.parents : Array.isArray(data.parents) ? data.parents : [],
    children: Array.isArray(d.children) ? d.children : Array.isArray(data.children) ? data.children : [],
    timestamp: d.timestamp || d.createdAt || data.createdAt || null,
  };
}

export default function registerDtusActions(registerLensAction) {
  /**
   * lineageAnalysis
   * Trace the full lineage of a DTU — parent chain, child forks, depth,
   * and generation statistics.
   * artifact.data.parentId, artifact.data.children, artifact.data.lineage
   */
  registerLensAction("dtus", "lineageAnalysis", (ctx, artifact, _params) => {
  try {
    const data = artifact.data || {};
    const lineage = data.lineage || [];
    const children = data.children || [];
    const parentId = data.parentId || null;

    // Walk lineage chain
    const depth = lineage.length;
    const generations = new Map();
    for (const ancestor of lineage) {
      const gen = ancestor.generation || 0;
      generations.set(gen, (generations.get(gen) || 0) + 1);
    }

    // Child analysis
    const directChildren = children.filter(c => c.parentId === artifact.id || c.parent === artifact.id);
    const forkCount = directChildren.length;
    const childTiers = {};
    for (const child of directChildren) {
      const tier = child.tier || "regular";
      childTiers[tier] = (childTiers[tier] || 0) + 1;
    }

    // Lineage health: deeper lineage with active children = healthy
    const lineageHealth = depth === 0 && forkCount === 0
      ? "orphan"
      : forkCount >= 3 ? "prolific"
      : forkCount >= 1 ? "healthy"
      : depth > 0 ? "leaf"
      : "root";

    return {
      ok: true,
      result: {
        dtuId: artifact.id,
        title: artifact.title,
        depth,
        parentId,
        forkCount,
        childTiers,
        totalDescendants: children.length,
        generationBreakdown: Object.fromEntries(generations),
        lineageHealth,
        isRoot: !parentId,
        isLeaf: forkCount === 0 && depth > 0,
        oldestAncestor: lineage.length > 0 ? lineage[lineage.length - 1]?.title || lineage[lineage.length - 1]?.id : null,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * qualityScore
   * Compute a quality score for a DTU based on completeness, citation count,
   * content richness, metadata quality, and age.
   */
  registerLensAction("dtus", "qualityScore", (ctx, artifact, _params) => {
  try {
    const data = artifact.data || {};
    const meta = artifact.meta || {};

    // Content richness (0-25): based on data field count and content length
    const dataFields = Object.keys(data).length;
    const contentLength = JSON.stringify(data).length;
    const contentScore = Math.min(25, Math.round(
      (Math.min(dataFields / 10, 1) * 12.5) +
      (Math.min(contentLength / 2000, 1) * 12.5)
    ));

    // Metadata quality (0-25): tags, status, visibility set
    const hasTags = (meta.tags || []).length > 0;
    const hasStatus = !!meta.status && meta.status !== "draft";
    const hasVisibility = !!meta.visibility;
    const tagCount = (meta.tags || []).length;
    const metaScore = Math.min(25, Math.round(
      (hasTags ? 8 : 0) +
      (hasStatus ? 8 : 0) +
      (hasVisibility ? 4 : 0) +
      Math.min(tagCount / 5, 1) * 5
    ));

    // Citation impact (0-25)
    const citationCount = parseInt(data.citationCount) || parseInt(meta.citationCount) || 0;
    const citationScore = Math.min(25, Math.round(Math.min(citationCount / 10, 1) * 25));

    // Freshness (0-25): how recently updated
    const updatedAt = new Date(artifact.updatedAt || artifact.createdAt || Date.now());
    const daysSinceUpdate = (Date.now() - updatedAt.getTime()) / (1000 * 60 * 60 * 24);
    const freshnessScore = Math.min(25, Math.round(
      daysSinceUpdate < 1 ? 25 :
      daysSinceUpdate < 7 ? 20 :
      daysSinceUpdate < 30 ? 15 :
      daysSinceUpdate < 90 ? 10 :
      5
    ));

    const totalScore = contentScore + metaScore + citationScore + freshnessScore;
    const grade = totalScore >= 90 ? "A" : totalScore >= 75 ? "B" : totalScore >= 60 ? "C" : totalScore >= 40 ? "D" : "F";

    return {
      ok: true,
      result: {
        dtuId: artifact.id,
        title: artifact.title,
        totalScore,
        grade,
        breakdown: {
          content: contentScore,
          metadata: metaScore,
          citations: citationScore,
          freshness: freshnessScore,
        },
        details: {
          dataFields,
          contentLength,
          tagCount,
          citationCount,
          daysSinceUpdate: Math.round(daysSinceUpdate),
          status: meta.status || "unknown",
          tier: data.tier || meta.tier || "regular",
        },
        recommendations: [
          contentScore < 15 ? "Add more structured data fields to improve content richness" : null,
          metaScore < 15 ? "Add tags and update status to improve discoverability" : null,
          citationScore < 10 ? "Increase visibility to earn more citations" : null,
          freshnessScore < 15 ? "Update this DTU to improve freshness score" : null,
        ].filter(Boolean),
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * citationNetwork
   * Analyze the citation network around a DTU — who cites it, what it cites,
   * and compute influence metrics.
   */
  registerLensAction("dtus", "citationNetwork", (ctx, artifact, _params) => {
  try {
    const data = artifact.data || {};
    const citedBy = data.citedBy || [];
    const cites = data.cites || data.references || [];

    const inDegree = citedBy.length;
    const outDegree = cites.length;

    // Compute h-index analog: max h where h DTUs cite this with >= h citations each
    const citationCounts = citedBy.map(c => parseInt(c.count) || 1).sort((a, b) => b - a);
    let hIndex = 0;
    for (let i = 0; i < citationCounts.length; i++) {
      if (citationCounts[i] >= i + 1) hIndex = i + 1;
      else break;
    }

    // Influence score: weighted combination of in-degree, h-index, and out-degree ratio
    const influenceScore = Math.min(100, Math.round(
      (Math.min(inDegree / 20, 1) * 40) +
      (Math.min(hIndex / 5, 1) * 35) +
      (outDegree > 0 ? Math.min(inDegree / outDegree, 3) / 3 * 25 : 0)
    ));

    // Top citers
    const topCiters = citedBy
      .sort((a, b) => (parseInt(b.count) || 1) - (parseInt(a.count) || 1))
      .slice(0, 5)
      .map(c => ({
        id: c.id || c.dtuId,
        title: c.title || c.id || "Unknown",
        count: parseInt(c.count) || 1,
      }));

    // Reciprocal citations (mutual references)
    const citedByIds = new Set(citedBy.map(c => c.id || c.dtuId));
    const reciprocal = cites.filter(c => citedByIds.has(c.id || c.dtuId));

    return {
      ok: true,
      result: {
        dtuId: artifact.id,
        title: artifact.title,
        inDegree,
        outDegree,
        hIndex,
        influenceScore,
        influenceLevel: influenceScore >= 75 ? "high" : influenceScore >= 40 ? "moderate" : "low",
        topCiters,
        reciprocalCount: reciprocal.length,
        networkDensity: inDegree + outDegree > 0
          ? Math.round((reciprocal.length / (inDegree + outDegree)) * 10000) / 100
          : 0,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * tierRecommendation
   * Recommend whether a DTU should be promoted, demoted, or maintained
   * at its current tier based on usage metrics.
   */
  registerLensAction("dtus", "tierRecommendation", (ctx, artifact, _params) => {
  try {
    const data = artifact.data || {};
    const meta = artifact.meta || {};
    const currentTier = data.tier || meta.tier || "regular";

    const citationCount = parseInt(data.citationCount) || parseInt(meta.citationCount) || 0;
    const viewCount = parseInt(data.viewCount) || parseInt(meta.viewCount) || 0;
    const forkCount = parseInt(data.forkCount) || parseInt(meta.forkCount) || 0;
    const qualityIndicator = parseInt(data.qualityScore) || 50;

    // Tier thresholds
    const tierScores = {
      hyper: { minCitations: 50, minViews: 500, minForks: 10, minQuality: 80 },
      mega: { minCitations: 20, minViews: 200, minForks: 5, minQuality: 65 },
      regular: { minCitations: 0, minViews: 0, minForks: 0, minQuality: 0 },
    };

    // Calculate what tier the metrics support
    let recommendedTier = "regular";
    if (citationCount >= tierScores.hyper.minCitations &&
        viewCount >= tierScores.hyper.minViews &&
        qualityIndicator >= tierScores.hyper.minQuality) {
      recommendedTier = "hyper";
    } else if (citationCount >= tierScores.mega.minCitations &&
               viewCount >= tierScores.mega.minViews &&
               qualityIndicator >= tierScores.mega.minQuality) {
      recommendedTier = "mega";
    }

    const tierOrder = ["regular", "mega", "hyper"];
    const currentIndex = tierOrder.indexOf(currentTier);
    const recommendedIndex = tierOrder.indexOf(recommendedTier);

    const action = recommendedIndex > currentIndex ? "promote"
      : recommendedIndex < currentIndex ? "demote"
      : "maintain";

    return {
      ok: true,
      result: {
        dtuId: artifact.id,
        title: artifact.title,
        currentTier,
        recommendedTier,
        action,
        metrics: {
          citationCount,
          viewCount,
          forkCount,
          qualityIndicator,
        },
        thresholds: tierScores[recommendedTier] || tierScores.regular,
        reasoning: action === "promote"
          ? `Metrics support ${recommendedTier} tier. Citations: ${citationCount}, Views: ${viewCount}, Quality: ${qualityIndicator}.`
          : action === "demote"
          ? `Current metrics no longer support ${currentTier} tier. Consider updating content to maintain tier.`
          : `DTU is correctly classified at ${currentTier} tier.`,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * duplicateDetection
   * Detect potential duplicates by comparing title similarity, tag overlap,
   * and content fingerprints against sibling DTUs.
   */
  registerLensAction("dtus", "duplicateDetection", (ctx, artifact, _params) => {
  try {
    const data = artifact.data || {};
    const siblings = data.siblings || data.relatedDTUs || [];
    const title = (artifact.title || "").toLowerCase().trim();
    const tags = new Set((artifact.meta?.tags || []).map(t => t.toLowerCase()));

    if (siblings.length === 0) {
      return { ok: true, result: { message: "No sibling DTUs provided for duplicate detection.", duplicates: [], totalChecked: 0 } };
    }

    // Jaccard similarity for sets
    function jaccard(setA, setB) {
      if (setA.size === 0 && setB.size === 0) return 1;
      let intersection = 0;
      for (const item of setA) {
        if (setB.has(item)) intersection++;
      }
      const union = setA.size + setB.size - intersection;
      return union > 0 ? intersection / union : 0;
    }

    // Simple trigram similarity for titles
    function trigrams(str) {
      const s = str.toLowerCase().trim();
      const set = new Set();
      for (let i = 0; i <= s.length - 3; i++) {
        set.add(s.substring(i, i + 3));
      }
      return set;
    }

    const titleTrigrams = trigrams(title);

    const candidates = siblings.map(sib => {
      const sibTitle = (sib.title || "").toLowerCase().trim();
      const sibTags = new Set((sib.tags || []).map(t => t.toLowerCase()));
      const sibTrigrams = trigrams(sibTitle);

      const titleSimilarity = jaccard(titleTrigrams, sibTrigrams);
      const tagOverlap = jaccard(tags, sibTags);
      const combinedScore = Math.round((titleSimilarity * 0.6 + tagOverlap * 0.4) * 100);

      return {
        id: sib.id,
        title: sib.title,
        titleSimilarity: Math.round(titleSimilarity * 100),
        tagOverlap: Math.round(tagOverlap * 100),
        combinedScore,
        isDuplicate: combinedScore >= 70,
        isPossibleDuplicate: combinedScore >= 45,
      };
    }).sort((a, b) => b.combinedScore - a.combinedScore);

    const duplicates = candidates.filter(c => c.isDuplicate);
    const possibleDuplicates = candidates.filter(c => c.isPossibleDuplicate && !c.isDuplicate);

    return {
      ok: true,
      result: {
        dtuId: artifact.id,
        title: artifact.title,
        totalChecked: siblings.length,
        duplicatesFound: duplicates.length,
        possibleDuplicatesFound: possibleDuplicates.length,
        duplicates: duplicates.slice(0, 5),
        possibleDuplicates: possibleDuplicates.slice(0, 5),
        isUnique: duplicates.length === 0 && possibleDuplicates.length === 0,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * citationGraph
   * Project a corpus of DTUs into an interactive node-link graph of
   * citation lineage. Input: params.dtus = [{ id, title, tier, cites?,
   * citedBy? }]. Returns nodes (with computed in/out degree + influence
   * size) and edges (source → target citation links) for a force graph.
   */
  registerLensAction("dtus", "citationGraph", (ctx, artifact, params) => {
    try {
      const raw = (params?.dtus || artifact.data?.dtus || []).map(normalizeDtu).filter(Boolean);
      if (raw.length === 0) {
        return { ok: true, result: { nodes: [], edges: [], stats: { nodeCount: 0, edgeCount: 0 } } };
      }
      const byId = new Map(raw.map(d => [d.id, d]));
      const inDeg = new Map();
      const outDeg = new Map();
      const edges = [];
      const seenEdge = new Set();

      for (const d of raw) {
        const cites = [
          ...(Array.isArray(d.parents) ? d.parents : []),
        ];
        // accept explicit cites list from params too
        const explicit = (params?.dtus || []).find(x => (x.id || x.dtuId) === d.id);
        if (explicit && Array.isArray(explicit.cites)) cites.push(...explicit.cites);
        for (const c of cites) {
          const targetId = typeof c === "string" ? c : (c?.id || c?.dtuId);
          if (!targetId || !byId.has(targetId) || targetId === d.id) continue;
          const key = `${d.id}->${targetId}`;
          if (seenEdge.has(key)) continue;
          seenEdge.add(key);
          edges.push({ source: d.id, target: targetId });
          outDeg.set(d.id, (outDeg.get(d.id) || 0) + 1);
          inDeg.set(targetId, (inDeg.get(targetId) || 0) + 1);
        }
      }

      const maxIn = Math.max(1, ...raw.map(d => inDeg.get(d.id) || 0));
      const nodes = raw.map(d => {
        const inD = inDeg.get(d.id) || 0;
        const outD = outDeg.get(d.id) || 0;
        return {
          id: d.id,
          label: d.title || d.id,
          tier: d.tier,
          inDegree: inD,
          outDegree: outD,
          influence: Math.round((inD / maxIn) * 100),
          size: 8 + Math.round((inD / maxIn) * 24),
        };
      });

      const hubs = [...nodes].sort((a, b) => b.inDegree - a.inDegree).slice(0, 5);
      return {
        ok: true,
        result: {
          nodes,
          edges,
          hubs,
          stats: {
            nodeCount: nodes.length,
            edgeCount: edges.length,
            isolated: nodes.filter(n => n.inDegree === 0 && n.outDegree === 0).length,
            density: nodes.length > 1
              ? Math.round((edges.length / (nodes.length * (nodes.length - 1))) * 10000) / 100
              : 0,
          },
        },
      };
    } catch (e) {
      return { ok: false, error: `citationGraph failed: ${e?.message || e}` };
    }
  });

  /**
   * facets
   * Compute facet buckets over a corpus so the UI can render a faceted
   * filter sidebar. Input: params.dtus. Returns counts per layer, tier,
   * scope, quality band, and tag.
   */
  registerLensAction("dtus", "facets", (ctx, artifact, params) => {
    try {
      const raw = (params?.dtus || artifact.data?.dtus || []).map(normalizeDtu).filter(Boolean);
      const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
      const layer = new Map();
      const tier = new Map();
      const scope = new Map();
      const quality = new Map();
      const tag = new Map();

      for (const d of raw) {
        bump(layer, d.layer);
        bump(tier, d.tier);
        bump(scope, d.scope);
        const q = d.quality;
        const band = q >= 90 ? "90-100" : q >= 75 ? "75-89" : q >= 60 ? "60-74"
          : q >= 40 ? "40-59" : q > 0 ? "1-39" : "unscored";
        bump(quality, band);
        for (const t of d.tags) bump(tag, String(t).toLowerCase());
      }

      const toArr = (m) => [...m.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count);

      return {
        ok: true,
        result: {
          total: raw.length,
          facets: {
            layer: toArr(layer),
            tier: toArr(tier),
            scope: toArr(scope),
            quality: toArr(quality),
            tag: toArr(tag).slice(0, 40),
          },
        },
      };
    } catch (e) {
      return { ok: false, error: `facets failed: ${e?.message || e}` };
    }
  });

  /**
   * facetedSearch
   * Filter a corpus by a facet selection. Input: params.dtus + params.filter
   * = { query?, layers?[], tiers?[], scopes?[], tags?[], minQuality?,
   * maxQuality? }. Returns the matching subset plus per-filter hit counts.
   */
  registerLensAction("dtus", "facetedSearch", (ctx, artifact, params) => {
    try {
      const raw = (params?.dtus || artifact.data?.dtus || []).map(normalizeDtu).filter(Boolean);
      const f = params?.filter || artifact.data?.filter || {};
      const q = (f.query || "").toLowerCase().trim();
      const layers = new Set((f.layers || []).map(x => String(x).toLowerCase()));
      const tiers = new Set((f.tiers || []).map(x => String(x).toLowerCase()));
      const scopes = new Set((f.scopes || []).map(x => String(x).toLowerCase()));
      const tags = new Set((f.tags || []).map(x => String(x).toLowerCase()));
      const minQ = Number.isFinite(f.minQuality) ? f.minQuality : 0;
      const maxQ = Number.isFinite(f.maxQuality) ? f.maxQuality : 100;

      const matches = raw.filter(d => {
        if (q) {
          const hay = `${d.title} ${d.summary} ${d.tags.join(" ")}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        if (layers.size && !layers.has(d.layer)) return false;
        if (tiers.size && !tiers.has(d.tier)) return false;
        if (scopes.size && !scopes.has(d.scope)) return false;
        if (d.quality < minQ || d.quality > maxQ) return false;
        if (tags.size) {
          const dtuTags = new Set(d.tags.map(t => String(t).toLowerCase()));
          let any = false;
          for (const t of tags) if (dtuTags.has(t)) { any = true; break; }
          if (!any) return false;
        }
        return true;
      });

      return {
        ok: true,
        result: {
          total: raw.length,
          matched: matches.length,
          results: matches,
          appliedFilter: {
            query: q || null,
            layers: [...layers], tiers: [...tiers], scopes: [...scopes], tags: [...tags],
            minQuality: minQ, maxQuality: maxQ,
          },
        },
      };
    } catch (e) {
      return { ok: false, error: `facetedSearch failed: ${e?.message || e}` };
    }
  });

  /**
   * lineageTree
   * Build a drill-down tree for a consolidated DTU: MEGA → its originals,
   * HYPER → its MEGAs → originals. Input: params.root (a DTU with nested
   * children[] arrays). Returns a recursive { id, label, tier, children }
   * tree plus aggregate stats.
   */
  registerLensAction("dtus", "lineageTree", (ctx, artifact, params) => {
    try {
      const root = params?.root || artifact.data?.root || null;
      if (!root) return { ok: true, result: { tree: null, stats: { nodeCount: 0, maxDepth: 0 } } };

      let nodeCount = 0;
      let maxDepth = 0;
      const tierCounts = { regular: 0, mega: 0, hyper: 0, shadow: 0 };

      function build(d, depth) {
        const n = normalizeDtu(d);
        if (!n) return null;
        nodeCount += 1;
        maxDepth = Math.max(maxDepth, depth);
        if (tierCounts[n.tier] !== undefined) tierCounts[n.tier] += 1;
        const kids = (Array.isArray(d.children) ? d.children : n.children)
          .map(c => build(c, depth + 1))
          .filter(Boolean);
        return {
          id: n.id,
          label: n.title || n.id,
          tier: n.tier,
          tone: n.tier === "hyper" ? "bad" : n.tier === "mega" ? "info"
            : n.tier === "shadow" ? "warn" : "good",
          detail: `${n.tier} · ${kids.length} child${kids.length === 1 ? "" : "ren"}`,
          children: kids,
        };
      }

      const tree = build(root, 0);
      return {
        ok: true,
        result: {
          tree,
          stats: { nodeCount, maxDepth, tierCounts },
        },
      };
    } catch (e) {
      return { ok: false, error: `lineageTree failed: ${e?.message || e}` };
    }
  });

  /**
   * bulkOp
   * Apply a single operation to many DTUs at once. Input: params.dtuIds[]
   * + params.op ∈ {tag, untag, cite, tier, archive} + params.value.
   * This is a planning/preview macro — it validates the request and
   * returns the per-DTU change set the caller persists via the substrate
   * REST endpoints. Returns ok + the resolved plan.
   */
  registerLensAction("dtus", "bulkOp", (ctx, artifact, params) => {
    try {
      const dtuIds = params?.dtuIds || artifact.data?.dtuIds || [];
      const op = params?.op || artifact.data?.op;
      const value = params?.value ?? artifact.data?.value ?? null;
      const VALID = ["tag", "untag", "cite", "tier", "archive"];
      if (!Array.isArray(dtuIds) || dtuIds.length === 0) {
        return { ok: false, error: "dtuIds required (non-empty array)" };
      }
      if (!VALID.includes(op)) {
        return { ok: false, error: `op must be one of ${VALID.join(", ")}` };
      }
      if ((op === "tag" || op === "untag" || op === "tier" || op === "cite") && (value === null || value === "")) {
        return { ok: false, error: `op '${op}' requires a value` };
      }
      if (op === "tier" && !["regular", "mega", "hyper"].includes(String(value))) {
        return { ok: false, error: "tier value must be regular, mega, or hyper" };
      }

      const changes = dtuIds.map(id => {
        switch (op) {
          case "tag": return { dtuId: id, field: "tags", action: "add", value };
          case "untag": return { dtuId: id, field: "tags", action: "remove", value };
          case "cite": return { dtuId: id, field: "cites", action: "add", value };
          case "tier": return { dtuId: id, field: "tier", action: "set", value };
          case "archive": return { dtuId: id, field: "status", action: "set", value: "archived" };
          default: return null;
        }
      }).filter(Boolean);

      return {
        ok: true,
        result: {
          op,
          value,
          affected: changes.length,
          changes,
          summary: `${op} applied to ${changes.length} DTU${changes.length === 1 ? "" : "s"}`,
        },
      };
    } catch (e) {
      return { ok: false, error: `bulkOp failed: ${e?.message || e}` };
    }
  });

  /**
   * compareDtus
   * Side-by-side comparison of two DTUs. Input: params.a, params.b
   * (DTU-shaped records). Returns a field-by-field diff, similarity
   * score, and a merge suggestion.
   */
  registerLensAction("dtus", "compareDtus", (ctx, artifact, params) => {
    try {
      const a = normalizeDtu(params?.a || artifact.data?.a);
      const b = normalizeDtu(params?.b || artifact.data?.b);
      if (!a || !b) return { ok: false, error: "two DTUs (a, b) required" };

      function trigrams(str) {
        const s = String(str || "").toLowerCase().trim();
        const set = new Set();
        for (let i = 0; i <= s.length - 3; i++) set.add(s.substring(i, i + 3));
        return set;
      }
      function jaccard(x, y) {
        if (x.size === 0 && y.size === 0) return 1;
        let inter = 0;
        for (const v of x) if (y.has(v)) inter++;
        const union = x.size + y.size - inter;
        return union > 0 ? inter / union : 0;
      }

      const titleSim = jaccard(trigrams(a.title), trigrams(b.title));
      const bodySim = jaccard(trigrams(a.summary), trigrams(b.summary));
      const tagsA = new Set(a.tags.map(t => String(t).toLowerCase()));
      const tagsB = new Set(b.tags.map(t => String(t).toLowerCase()));
      const tagSim = jaccard(tagsA, tagsB);
      const overall = Math.round((titleSim * 0.4 + bodySim * 0.4 + tagSim * 0.2) * 100);

      const fields = ["title", "summary", "tier", "layer", "scope", "quality", "citationCount"];
      const diff = fields.map(f => ({
        field: f,
        a: a[f],
        b: b[f],
        same: JSON.stringify(a[f]) === JSON.stringify(b[f]),
      }));

      const sharedTags = [...tagsA].filter(t => tagsB.has(t));
      const uniqueA = [...tagsA].filter(t => !tagsB.has(t));
      const uniqueB = [...tagsB].filter(t => !tagsA.has(t));

      return {
        ok: true,
        result: {
          similarity: { title: Math.round(titleSim * 100), body: Math.round(bodySim * 100), tags: Math.round(tagSim * 100), overall },
          recommendation: overall >= 70 ? "merge" : overall >= 45 ? "review" : "keep_separate",
          diff,
          tags: { shared: sharedTags, onlyA: uniqueA, onlyB: uniqueB },
        },
      };
    } catch (e) {
      return { ok: false, error: `compareDtus failed: ${e?.message || e}` };
    }
  });

  /**
   * mergeDtus
   * Produce a merged DTU from two near-duplicates. Input: params.a,
   * params.b, params.strategy ∈ {prefer_a, prefer_b, union}. Returns the
   * merged record + which DTU should be tombstoned.
   */
  registerLensAction("dtus", "mergeDtus", (ctx, artifact, params) => {
    try {
      const a = normalizeDtu(params?.a || artifact.data?.a);
      const b = normalizeDtu(params?.b || artifact.data?.b);
      if (!a || !b) return { ok: false, error: "two DTUs (a, b) required" };
      const strategy = params?.strategy || artifact.data?.strategy || "union";
      const primary = strategy === "prefer_b" ? b : a;
      const secondary = primary === a ? b : a;

      const mergedTags = strategy === "union"
        ? [...new Set([...a.tags, ...b.tags].map(t => String(t)))]
        : primary.tags;

      const merged = {
        title: primary.title || secondary.title,
        summary: strategy === "union"
          ? [primary.summary, secondary.summary].filter(Boolean).join("\n\n").slice(0, 4000)
          : primary.summary,
        tier: [a.tier, b.tier].includes("hyper") ? "hyper"
          : [a.tier, b.tier].includes("mega") ? "mega" : primary.tier,
        layer: primary.layer,
        scope: primary.scope,
        tags: mergedTags,
        quality: Math.max(a.quality, b.quality),
        citationCount: a.citationCount + b.citationCount,
        mergedFrom: [a.id, b.id].filter(Boolean),
      };

      return {
        ok: true,
        result: {
          strategy,
          merged,
          tombstone: secondary.id,
          keep: primary.id,
          summary: `Merged ${secondary.id || "DTU"} into ${primary.id || "DTU"} (${strategy})`,
        },
      };
    } catch (e) {
      return { ok: false, error: `mergeDtus failed: ${e?.message || e}` };
    }
  });

  /**
   * saveView
   * Persist a smart collection / saved view (a named facet filter) for
   * the current user. Input: params.name + params.filter.
   */
  registerLensAction("dtus", "saveView", (ctx, artifact, params) => {
    try {
      const s = dtuStore();
      const userId = actorId(ctx);
      const name = (params?.name || artifact.data?.name || "").trim();
      const filter = params?.filter || artifact.data?.filter || {};
      if (!name) return { ok: false, error: "name required" };
      const list = ensureList(s.views, userId);
      if (list.length >= 50) return { ok: false, error: "saved-view limit reached (50)" };
      const view = {
        id: `view_${nextSeq(s, userId, "view")}`,
        name,
        filter,
        createdAt: new Date().toISOString(),
      };
      list.unshift(view);
      return { ok: true, result: { view, totalViews: list.length } };
    } catch (e) {
      return { ok: false, error: `saveView failed: ${e?.message || e}` };
    }
  });

  /**
   * listViews
   * Return the current user's saved views / smart collections.
   */
  registerLensAction("dtus", "listViews", (ctx, _artifact, _params) => {
    try {
      const s = dtuStore();
      const userId = actorId(ctx);
      const views = ensureList(s.views, userId);
      return { ok: true, result: { views, count: views.length } };
    } catch (e) {
      return { ok: false, error: `listViews failed: ${e?.message || e}` };
    }
  });

  /**
   * deleteView
   * Remove a saved view by id.
   */
  registerLensAction("dtus", "deleteView", (ctx, artifact, params) => {
    try {
      const s = dtuStore();
      const userId = actorId(ctx);
      const id = params?.viewId || params?.id || artifact.data?.viewId;
      if (!id) return { ok: false, error: "viewId required" };
      const list = ensureList(s.views, userId);
      const idx = list.findIndex(v => v.id === id);
      if (idx === -1) return { ok: false, error: "view not found" };
      list.splice(idx, 1);
      return { ok: true, result: { deleted: id, remaining: list.length } };
    } catch (e) {
      return { ok: false, error: `deleteView failed: ${e?.message || e}` };
    }
  });

  /**
   * getLayers
   * Return the editable 4-layer payload for a DTU (human / core /
   * machine / artifact). Input: params.dtuId + params.dtu (the source
   * record to seed layers from if no user overlay exists yet).
   */
  registerLensAction("dtus", "getLayers", (ctx, artifact, params) => {
    try {
      const s = dtuStore();
      const userId = actorId(ctx);
      const dtuId = params?.dtuId || params?.id || artifact.data?.dtuId;
      if (!dtuId) return { ok: false, error: "dtuId required" };
      const layerMap = ensureLayerMap(s.layers, userId);
      if (layerMap.has(dtuId)) {
        return { ok: true, result: { dtuId, layers: layerMap.get(dtuId), source: "overlay" } };
      }
      const src = normalizeDtu(params?.dtu || artifact.data?.dtu) || {};
      const layers = {
        human: src.summary || src.title || "",
        core: typeof params?.dtu?.core === "string" ? params.dtu.core
          : JSON.stringify(params?.dtu?.core || {}, null, 2),
        machine: JSON.stringify({ tags: src.tags || [], tier: src.tier || "regular" }, null, 2),
        artifact: params?.dtu?.artifact || "",
        updatedAt: null,
      };
      return { ok: true, result: { dtuId, layers, source: "seed" } };
    } catch (e) {
      return { ok: false, error: `getLayers failed: ${e?.message || e}` };
    }
  });

  /**
   * updateLayers
   * Persist edits to a DTU's 4 layers as a per-user overlay. Input:
   * params.dtuId + params.layers = { human?, core?, machine?, artifact? }.
   */
  registerLensAction("dtus", "updateLayers", (ctx, artifact, params) => {
    try {
      const s = dtuStore();
      const userId = actorId(ctx);
      const dtuId = params?.dtuId || params?.id || artifact.data?.dtuId;
      const layers = params?.layers || artifact.data?.layers;
      if (!dtuId) return { ok: false, error: "dtuId required" };
      if (!layers || typeof layers !== "object") return { ok: false, error: "layers object required" };
      const layerMap = ensureLayerMap(s.layers, userId);
      const prev = layerMap.get(dtuId) || {};
      const next = {
        human: typeof layers.human === "string" ? layers.human : (prev.human || ""),
        core: typeof layers.core === "string" ? layers.core : (prev.core || ""),
        machine: typeof layers.machine === "string" ? layers.machine : (prev.machine || ""),
        artifact: typeof layers.artifact === "string" ? layers.artifact : (prev.artifact || ""),
        updatedAt: new Date().toISOString(),
      };
      // validate core/machine parse as JSON when non-empty (machine layer)
      const warnings = [];
      if (next.machine.trim()) {
        try { JSON.parse(next.machine); }
        catch { warnings.push("machine layer is not valid JSON"); }
      }
      layerMap.set(dtuId, next);
      return { ok: true, result: { dtuId, layers: next, warnings } };
    } catch (e) {
      return { ok: false, error: `updateLayers failed: ${e?.message || e}` };
    }
  });
}
