// server/domains/timeline.js
// Domain actions for temporal analysis: critical path computation, Gantt
// scheduling, temporal clustering, and event pattern detection.

export default function registerTimelineActions(registerLensAction) {
  /**
   * criticalPath
   * Compute the critical path through a project network using CPM.
   * artifact.data.tasks = [{ id, name, duration, dependencies?: string[] }]
   * Duration in any consistent unit (days, hours, etc.)
   */
  registerLensAction("timeline", "criticalPath", (ctx, artifact, _params) => {
    const tasks = artifact.data?.tasks || [];
    if (tasks.length === 0) return { ok: false, error: "No tasks defined." };

    const taskMap = {};
    for (const t of tasks) taskMap[t.id] = { ...t, dependencies: t.dependencies || [], es: 0, ef: 0, ls: Infinity, lf: Infinity, slack: 0 };

    // Topological sort
    const sorted = [];
    const visited = new Set();
    const visiting = new Set();
    function visit(id) {
      if (visited.has(id)) return true;
      if (visiting.has(id)) return false; // cycle
      visiting.add(id);
      const task = taskMap[id];
      if (!task) return true;
      for (const dep of task.dependencies) {
        if (!visit(dep)) return false;
      }
      visiting.delete(id);
      visited.add(id);
      sorted.push(id);
      return true;
    }
    for (const t of tasks) {
      if (!visit(t.id)) return { ok: false, error: `Circular dependency detected involving task "${t.id}".` };
    }

    // Forward pass: compute earliest start (ES) and earliest finish (EF)
    for (const id of sorted) {
      const task = taskMap[id];
      task.es = task.dependencies.length > 0
        ? Math.max(...task.dependencies.map(d => taskMap[d]?.ef || 0))
        : 0;
      task.ef = task.es + (task.duration || 0);
    }

    // Project duration
    const projectDuration = Math.max(...Object.values(taskMap).map(t => t.ef));

    // Backward pass: compute latest start (LS) and latest finish (LF)
    for (const id of [...sorted].reverse()) {
      const task = taskMap[id];
      // Find tasks that depend on this one
      const successors = Object.values(taskMap).filter(t => t.dependencies.includes(id));
      task.lf = successors.length > 0
        ? Math.min(...successors.map(s => s.ls))
        : projectDuration;
      task.ls = task.lf - (task.duration || 0);
      task.slack = task.ls - task.es;
    }

    // Critical path: tasks with zero slack
    const criticalTasks = sorted.filter(id => taskMap[id].slack === 0);

    // Build the critical path chain (ordered)
    const criticalChain = [];
    const remaining = new Set(criticalTasks);
    let current = criticalTasks.find(id => taskMap[id].dependencies.filter(d => remaining.has(d)).length === 0);
    while (current && remaining.size > 0) {
      criticalChain.push(current);
      remaining.delete(current);
      const successors = [...remaining].filter(id => taskMap[id].dependencies.includes(current));
      current = successors[0];
    }

    const result = sorted.map(id => {
      const t = taskMap[id];
      return {
        id, name: t.name, duration: t.duration,
        earliestStart: t.es, earliestFinish: t.ef,
        latestStart: t.ls, latestFinish: t.lf,
        slack: t.slack, isCritical: t.slack === 0,
      };
    });

    return {
      ok: true, result: {
        tasks: result,
        projectDuration,
        criticalPath: criticalChain.map(id => ({ id, name: taskMap[id].name, duration: taskMap[id].duration })),
        criticalPathLength: criticalChain.reduce((s, id) => s + (taskMap[id].duration || 0), 0),
        totalTasks: tasks.length,
        criticalTaskCount: criticalChain.length,
        averageSlack: result.length > 0 ? Math.round(result.reduce((s, t) => s + t.slack, 0) / result.length * 100) / 100 : 0,
      },
    };
  });

  /**
   * ganttSchedule
   * Generate a Gantt chart schedule with resource leveling.
   * artifact.data.tasks = [{ id, name, duration, dependencies?, resource?, priority? }]
   * params.maxParallel (resource constraint, default: unlimited)
   */
  registerLensAction("timeline", "ganttSchedule", (ctx, artifact, params) => {
    const tasks = artifact.data?.tasks || [];
    if (tasks.length === 0) return { ok: false, error: "No tasks defined." };

    const maxParallel = params.maxParallel || Infinity;

    // Build dependency graph
    const taskMap = {};
    for (const t of tasks) {
      taskMap[t.id] = { ...t, dependencies: t.dependencies || [], start: null, end: null, scheduled: false };
    }

    // Schedule greedily respecting dependencies and resource limits
    const schedule = [];
    let time = 0;
    let maxTime = 0;
    const maxIterations = tasks.length * tasks.length;
    let iterations = 0;

    while (schedule.length < tasks.length && iterations < maxIterations) {
      iterations++;
      // Find ready tasks (all deps scheduled, not yet scheduled)
      const ready = Object.values(taskMap).filter(t =>
        !t.scheduled &&
        t.dependencies.every(d => taskMap[d]?.scheduled)
      );

      if (ready.length === 0) {
        // Advance time to next task completion
        const nextEnd = Math.min(...schedule.filter(s => s.end > time).map(s => s.end));
        if (nextEnd === Infinity) break;
        time = nextEnd;
        continue;
      }

      // Sort by priority (lower = higher priority), then by dependency chain length
      ready.sort((a, b) => (a.priority || 99) - (b.priority || 99));

      // How many tasks are currently running at this time?
      const running = schedule.filter(s => s.start <= time && s.end > time).length;
      const available = maxParallel - running;

      for (let i = 0; i < Math.min(ready.length, available); i++) {
        const task = ready[i];
        // Earliest start: max of dependency completions and current time
        const depEnd = task.dependencies.length > 0
          ? Math.max(...task.dependencies.map(d => taskMap[d].end || 0))
          : 0;
        const start = Math.max(time, depEnd);
        const end = start + (task.duration || 0);

        task.start = start;
        task.end = end;
        task.scheduled = true;
        schedule.push({ id: task.id, name: task.name, start, end, duration: task.duration, resource: task.resource });
        maxTime = Math.max(maxTime, end);
      }

      // Advance time
      const nextEvents = schedule.filter(s => s.end > time).map(s => s.end);
      if (nextEvents.length > 0) {
        time = Math.min(...nextEvents);
      } else {
        time++;
      }
    }

    // Resource utilization
    const resources = {};
    for (const s of schedule) {
      const r = s.resource || "unassigned";
      if (!resources[r]) resources[r] = { totalDuration: 0, taskCount: 0, tasks: [] };
      resources[r].totalDuration += s.duration || 0;
      resources[r].taskCount++;
      resources[r].tasks.push(s.id);
    }
    for (const r of Object.values(resources)) {
      r.utilization = maxTime > 0 ? Math.round((r.totalDuration / maxTime) * 10000) / 100 : 0;
    }

    // Find bottlenecks (time periods with max parallelism)
    let peakParallel = 0;
    for (let t = 0; t <= maxTime; t++) {
      const parallel = schedule.filter(s => s.start <= t && s.end > t).length;
      peakParallel = Math.max(peakParallel, parallel);
    }

    schedule.sort((a, b) => a.start - b.start);

    return {
      ok: true, result: {
        schedule,
        projectDuration: maxTime,
        peakParallelism: peakParallel,
        resourceUtilization: resources,
        taskCount: schedule.length,
        averageDuration: schedule.length > 0
          ? Math.round(schedule.reduce((s, t) => s + (t.duration || 0), 0) / schedule.length * 100) / 100
          : 0,
      },
    };
  });

  /**
   * temporalClustering
   * Group events into temporal clusters using gap-based detection.
   * artifact.data.events = [{ timestamp, label?, value?, category? }]
   * params.gapThreshold (minimum gap between clusters, in ms)
   */
  registerLensAction("timeline", "temporalClustering", (ctx, artifact, params) => {
    const events = artifact.data?.events || [];
    if (events.length === 0) return { ok: true, result: { message: "No events." } };

    const sorted = [...events]
      .map(e => ({ ...e, ts: new Date(e.timestamp).getTime() }))
      .filter(e => !isNaN(e.ts))
      .sort((a, b) => a.ts - b.ts);

    if (sorted.length === 0) return { ok: false, error: "No valid timestamps." };

    // Auto-detect gap threshold if not provided: use 2x median inter-event gap
    const gaps = [];
    for (let i = 1; i < sorted.length; i++) {
      gaps.push(sorted[i].ts - sorted[i - 1].ts);
    }
    gaps.sort((a, b) => a - b);
    const medianGap = gaps.length > 0 ? gaps[Math.floor(gaps.length / 2)] : 60000;
    const gapThreshold = params.gapThreshold || medianGap * 2;

    // Cluster by gap
    const clusters = [];
    let currentCluster = { events: [sorted[0]], start: sorted[0].ts, end: sorted[0].ts };

    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i].ts - sorted[i - 1].ts;
      if (gap > gapThreshold) {
        clusters.push(currentCluster);
        currentCluster = { events: [sorted[i]], start: sorted[i].ts, end: sorted[i].ts };
      } else {
        currentCluster.events.push(sorted[i]);
        currentCluster.end = sorted[i].ts;
      }
    }
    clusters.push(currentCluster);

    // Analyze each cluster
    const analyzed = clusters.map((c, i) => {
      const duration = c.end - c.start;
      const categories = {};
      for (const e of c.events) {
        const cat = e.category || "uncategorized";
        categories[cat] = (categories[cat] || 0) + 1;
      }
      const values = c.events.map(e => e.value).filter(v => v != null);
      const avgValue = values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : null;

      // Event rate (events per minute)
      const ratePerMinute = duration > 0 ? (c.events.length / (duration / 60000)) : c.events.length;

      return {
        cluster: i + 1,
        eventCount: c.events.length,
        start: new Date(c.start).toISOString(),
        end: new Date(c.end).toISOString(),
        durationMs: duration,
        durationMinutes: Math.round(duration / 60000 * 100) / 100,
        ratePerMinute: Math.round(ratePerMinute * 100) / 100,
        categories,
        avgValue: avgValue != null ? Math.round(avgValue * 1000) / 1000 : null,
        labels: c.events.map(e => e.label).filter(Boolean).slice(0, 5),
      };
    });

    // Periodicity detection: check if clusters are roughly evenly spaced
    const clusterStarts = clusters.map(c => c.start);
    const interClusterGaps = [];
    for (let i = 1; i < clusterStarts.length; i++) {
      interClusterGaps.push(clusterStarts[i] - clusterStarts[i - 1]);
    }
    let periodicity = null;
    if (interClusterGaps.length >= 2) {
      const avgGap = interClusterGaps.reduce((s, g) => s + g, 0) / interClusterGaps.length;
      const gapVariance = interClusterGaps.reduce((s, g) => s + Math.pow(g - avgGap, 2), 0) / interClusterGaps.length;
      const cv = avgGap > 0 ? Math.sqrt(gapVariance) / avgGap : Infinity;
      if (cv < 0.3) {
        periodicity = {
          detected: true, periodMs: Math.round(avgGap),
          periodMinutes: Math.round(avgGap / 60000 * 100) / 100,
          regularity: cv < 0.1 ? "highly-regular" : "moderately-regular",
          coefficientOfVariation: Math.round(cv * 10000) / 10000,
        };
      }
    }

    return {
      ok: true, result: {
        clusters: analyzed,
        totalClusters: clusters.length,
        totalEvents: sorted.length,
        gapThresholdMs: gapThreshold,
        timespan: { start: new Date(sorted[0].ts).toISOString(), end: new Date(sorted[sorted.length - 1].ts).toISOString() },
        periodicity: periodicity || { detected: false },
        largestCluster: analyzed.sort((a, b) => b.eventCount - a.eventCount)[0]?.cluster,
      },
    };
  });

  /**
   * trendAnalysis
   * Detect trends, seasonality, and anomalies in time-series data.
   * artifact.data.series = [{ timestamp, value }]
   * params.windowSize (for moving average, default: auto)
   */
  registerLensAction("timeline", "trendAnalysis", (ctx, artifact, _params) => {
    const series = artifact.data?.series || [];
    if (series.length < 3) return { ok: false, error: "Need at least 3 data points." };

    const sorted = [...series]
      .map(s => ({ ts: new Date(s.timestamp).getTime(), value: s.value }))
      .filter(s => !isNaN(s.ts) && !isNaN(s.value))
      .sort((a, b) => a.ts - b.ts);

    const n = sorted.length;
    const values = sorted.map(s => s.value);
    const r = v => Math.round(v * 10000) / 10000;

    // Linear trend (least squares on index)
    const xs = sorted.map((_, i) => i);
    const sumX = xs.reduce((s, x) => s + x, 0);
    const sumY = values.reduce((s, v) => s + v, 0);
    const sumXY = xs.reduce((s, x, i) => s + x * values[i], 0);
    const sumX2 = xs.reduce((s, x) => s + x * x, 0);
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    const yMean = sumY / n;
    const ssRes = values.reduce((s, y, i) => s + Math.pow(y - (slope * i + intercept), 2), 0);
    const ssTot = values.reduce((s, y) => s + Math.pow(y - yMean, 2), 0);
    const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;

    const trendDirection = slope > 0.001 ? "increasing" : slope < -0.001 ? "decreasing" : "flat";

    // Moving average and residuals
    const windowSize = Math.max(3, Math.min(Math.floor(n / 4), 12));
    const movingAvg = [];
    const residuals = [];
    for (let i = 0; i < n; i++) {
      const start = Math.max(0, i - Math.floor(windowSize / 2));
      const end = Math.min(n, i + Math.ceil(windowSize / 2));
      const window = values.slice(start, end);
      const avg = window.reduce((s, v) => s + v, 0) / window.length;
      movingAvg.push(r(avg));
      residuals.push(r(values[i] - avg));
    }

    // Anomaly detection: values > 2 stddev from moving average
    const residualMean = residuals.reduce((s, r) => s + r, 0) / residuals.length;
    const residualStd = Math.sqrt(residuals.reduce((s, r) => s + Math.pow(r - residualMean, 2), 0) / residuals.length);
    const anomalies = [];
    for (let i = 0; i < n; i++) {
      const zScore = residualStd > 0 ? Math.abs(residuals[i] - residualMean) / residualStd : 0;
      if (zScore > 2) {
        anomalies.push({
          index: i, timestamp: new Date(sorted[i].ts).toISOString(),
          value: sorted[i].value, expected: movingAvg[i],
          deviation: residuals[i], zScore: r(zScore),
          type: residuals[i] > 0 ? "spike" : "dip",
        });
      }
    }

    // Seasonality check via autocorrelation
    const maxLag = Math.min(Math.floor(n / 2), 50);
    const autocorrelations = [];
    for (let lag = 1; lag <= maxLag; lag++) {
      let num = 0, den = 0;
      for (let i = 0; i < n - lag; i++) {
        num += (values[i] - yMean) * (values[i + lag] - yMean);
      }
      den = values.reduce((s, v) => s + Math.pow(v - yMean, 2), 0);
      const acf = den > 0 ? num / den : 0;
      autocorrelations.push({ lag, acf: r(acf) });
    }

    // Find peaks in autocorrelation (possible seasonal periods)
    const seasonalCandidates = [];
    for (let i = 1; i < autocorrelations.length - 1; i++) {
      const ac = autocorrelations[i];
      if (ac.acf > 0.3 && ac.acf > autocorrelations[i - 1].acf && ac.acf > autocorrelations[i + 1].acf) {
        seasonalCandidates.push({ period: ac.lag, strength: ac.acf });
      }
    }

    // Rate of change
    const changes = [];
    for (let i = 1; i < n; i++) {
      const timeDiff = sorted[i].ts - sorted[i - 1].ts;
      const valueDiff = values[i] - values[i - 1];
      const rate = timeDiff > 0 ? valueDiff / (timeDiff / 3600000) : 0; // per hour
      changes.push(rate);
    }
    const maxAcceleration = changes.length > 1
      ? Math.max(...changes.slice(1).map((c, i) => Math.abs(c - changes[i])))
      : 0;

    return {
      ok: true, result: {
        trend: { direction: trendDirection, slope: r(slope), intercept: r(intercept), rSquared: r(rSquared) },
        statistics: {
          count: n, mean: r(yMean),
          min: r(Math.min(...values)), max: r(Math.max(...values)),
          range: r(Math.max(...values) - Math.min(...values)),
        },
        anomalies: anomalies.slice(0, 10),
        anomalyCount: anomalies.length,
        seasonality: seasonalCandidates.length > 0
          ? { detected: true, candidates: seasonalCandidates.slice(0, 3) }
          : { detected: false },
        movingAverage: { windowSize, values: movingAvg.length > 50 ? movingAvg.filter((_, i) => i % Math.ceil(n / 50) === 0) : movingAvg },
        maxRateOfChange: r(Math.max(...changes.map(Math.abs))),
        maxAcceleration: r(maxAcceleration),
      },
    };
  });

  // ──────────────────────────────────────────────────────────────────────
  // Personal-feed substrate — Facebook-style timeline features.
  // All data is persisted per-user in globalThis._concordSTATE.timelineLens,
  // a set of Maps keyed by userId. Handlers never throw — every code path
  // returns { ok: boolean, ... }.
  // ──────────────────────────────────────────────────────────────────────

  function getTlState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.timelineLens) STATE.timelineLens = {};
    const s = STATE.timelineLens;
    // posts:    Map<userId, Post[]>          — feed posts authored by the user
    // comments: Map<postId, Comment[]>       — flat list, nested via parentId
    // reactions:Map<postId, Reaction[]>      — one row per (userId, post)
    // albums:   Map<userId, Album[]>         — media albums + their media items
    // profiles: Map<userId, Profile>         — cover photo / bio / about
    // notifs:   Map<userId, Notification[]>  — reaction/comment/tag alerts
    for (const k of ["posts", "comments", "reactions", "albums", "profiles", "notifs"]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }
  function saveTlState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const tlId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const tlNow = () => new Date().toISOString();
  const tlAid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const tlList = (map, k) => { if (!map.has(k)) map.set(k, []); return map.get(k); };
  const tlClean = (v, max = 2000) => String(v == null ? "" : v).trim().slice(0, max);
  const tlNum = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const REACTION_KINDS = ["like", "love", "haha", "sad", "angry"];
  const PRIVACY_KINDS = ["public", "friends", "private"];
  const MEDIA_KINDS = ["photo", "video"];

  // Find a post by id across all users' feeds — returns { ownerId, post } | null.
  function findPost(s, postId) {
    for (const [ownerId, posts] of s.posts.entries()) {
      const post = posts.find((p) => p.id === postId);
      if (post) return { ownerId, post };
    }
    return null;
  }

  // Append a notification for a recipient (skips self-notifications).
  function pushNotif(s, recipientId, actorId, type, payload) {
    if (!recipientId || recipientId === actorId) return;
    const list = tlList(s.notifs, recipientId);
    list.unshift({
      id: tlId("ntf"), type, actorId,
      ...payload, read: false, at: tlNow(),
    });
    if (list.length > 200) list.length = 200;
  }

  // ── Post creation with privacy controls ────────────────────────────────
  // Privacy controls per post (public / friends / only-me). Posts are the
  // canonical timeline feed object; reactions/comments hang off post.id.
  registerLensAction("timeline", "post-create", (ctx, _a, params = {}) => {
    const s = getTlState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const content = tlClean(params.content, 5000);
    const media = Array.isArray(params.media) ? params.media : [];
    if (!content && media.length === 0) {
      return { ok: false, error: "Post needs content or media." };
    }
    const privacy = PRIVACY_KINDS.includes(String(params.privacy))
      ? String(params.privacy) : "private";
    const post = {
      id: tlId("pst"),
      authorId: tlAid(ctx),
      content,
      media: media
        .filter((m) => m && MEDIA_KINDS.includes(String(m.kind)))
        .slice(0, 12)
        .map((m) => ({ kind: String(m.kind), url: tlClean(m.url, 1000), caption: tlClean(m.caption, 200) })),
      privacy,
      taggedUserIds: Array.isArray(params.taggedUserIds)
        ? params.taggedUserIds.map((u) => tlClean(u, 64)).filter(Boolean).slice(0, 20)
        : [],
      sharedFrom: null,
      createdAt: tlNow(),
    };
    tlList(s.posts, post.authorId).unshift(post);
    // Tag notifications.
    for (const tagged of post.taggedUserIds) {
      pushNotif(s, tagged, post.authorId, "tag", { postId: post.id, preview: content.slice(0, 80) });
    }
    saveTlState();
    return { ok: true, result: { post } };
  });

  // ── Feed listing (privacy-aware) ───────────────────────────────────────
  // viewerId sees: own posts (all privacy), friends' posts marked
  // public|friends, everyone else's public posts only.
  registerLensAction("timeline", "feed-list", (ctx, _a, params = {}) => {
    const s = getTlState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const viewerId = tlAid(ctx);
    const friendIds = new Set(
      (Array.isArray(params.friendIds) ? params.friendIds : []).map((f) => tlClean(f, 64)),
    );
    const onlyAuthor = params.authorId ? tlClean(params.authorId, 64) : null;
    let all = [];
    for (const [ownerId, posts] of s.posts.entries()) {
      if (onlyAuthor && ownerId !== onlyAuthor) continue;
      for (const p of posts) {
        const visible =
          ownerId === viewerId ||
          p.privacy === "public" ||
          (p.privacy === "friends" && friendIds.has(ownerId));
        if (!visible) continue;
        const reactions = s.reactions.get(p.id) || [];
        const counts = REACTION_KINDS.reduce((acc, k) => {
          acc[k] = reactions.filter((r) => r.kind === k).length;
          return acc;
        }, {});
        const mine = reactions.find((r) => r.userId === viewerId);
        all.push({
          ...p,
          reactionCounts: counts,
          reactionTotal: reactions.length,
          userReaction: mine ? mine.kind : null,
          commentCount: (s.comments.get(p.id) || []).length,
        });
      }
    }
    all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const limit = Math.max(1, Math.min(100, tlNum(params.limit, 30)));
    const offset = Math.max(0, tlNum(params.offset, 0));
    return {
      ok: true,
      result: { posts: all.slice(offset, offset + limit), total: all.length },
    };
  });

  // ── Comments with nested replies ───────────────────────────────────────
  registerLensAction("timeline", "comment-add", (ctx, _a, params = {}) => {
    const s = getTlState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const postId = tlClean(params.postId, 64);
    const text = tlClean(params.text, 2000);
    if (!postId || !text) return { ok: false, error: "postId and text required." };
    const found = findPost(s, postId);
    if (!found) return { ok: false, error: "Post not found." };
    const parentId = params.parentId ? tlClean(params.parentId, 64) : null;
    const list = tlList(s.comments, postId);
    if (parentId && !list.some((c) => c.id === parentId)) {
      return { ok: false, error: "Parent comment not found." };
    }
    const actorId = tlAid(ctx);
    const comment = {
      id: tlId("cmt"), postId, parentId,
      authorId: actorId, text, createdAt: tlNow(),
    };
    list.push(comment);
    pushNotif(s, found.post.authorId, actorId, "comment", { postId, preview: text.slice(0, 80) });
    if (parentId) {
      const parent = list.find((c) => c.id === parentId);
      if (parent) pushNotif(s, parent.authorId, actorId, "reply", { postId, preview: text.slice(0, 80) });
    }
    saveTlState();
    return { ok: true, result: { comment, total: list.length } };
  });

  // List comments for a post as a nested thread tree.
  registerLensAction("timeline", "comment-list", (_ctx, _a, params = {}) => {
    const s = getTlState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const postId = tlClean(params.postId, 64);
    if (!postId) return { ok: false, error: "postId required." };
    const flat = [...(s.comments.get(postId) || [])];
    flat.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const byId = new Map(flat.map((c) => [c.id, { ...c, replies: [] }]));
    const roots = [];
    for (const c of byId.values()) {
      if (c.parentId && byId.has(c.parentId)) byId.get(c.parentId).replies.push(c);
      else roots.push(c);
    }
    return { ok: true, result: { thread: roots, total: flat.length } };
  });

  registerLensAction("timeline", "comment-delete", (ctx, _a, params = {}) => {
    const s = getTlState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const postId = tlClean(params.postId, 64);
    const commentId = tlClean(params.commentId, 64);
    if (!postId || !commentId) return { ok: false, error: "postId and commentId required." };
    const list = s.comments.get(postId) || [];
    const target = list.find((c) => c.id === commentId);
    if (!target) return { ok: false, error: "Comment not found." };
    if (target.authorId !== tlAid(ctx)) return { ok: false, error: "Not your comment." };
    // Drop the comment and any direct replies to it.
    const next = list.filter((c) => c.id !== commentId && c.parentId !== commentId);
    s.comments.set(postId, next);
    saveTlState();
    return { ok: true, result: { removed: list.length - next.length, total: next.length } };
  });

  // ── Reactions with counts + "who reacted" breakdown ────────────────────
  // Idempotent per (user, post): re-reacting changes the kind; reacting with
  // the same kind toggles it off.
  registerLensAction("timeline", "react", (ctx, _a, params = {}) => {
    const s = getTlState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const postId = tlClean(params.postId, 64);
    const kind = String(params.kind || "like");
    if (!postId) return { ok: false, error: "postId required." };
    if (!REACTION_KINDS.includes(kind)) return { ok: false, error: "Unknown reaction kind." };
    const found = findPost(s, postId);
    if (!found) return { ok: false, error: "Post not found." };
    const actorId = tlAid(ctx);
    const list = tlList(s.reactions, postId);
    const existing = list.findIndex((r) => r.userId === actorId);
    let action;
    if (existing >= 0) {
      if (list[existing].kind === kind) {
        list.splice(existing, 1);
        action = "removed";
      } else {
        list[existing] = { userId: actorId, kind, at: tlNow() };
        action = "changed";
      }
    } else {
      list.push({ userId: actorId, kind, at: tlNow() });
      action = "added";
      pushNotif(s, found.post.authorId, actorId, "reaction", { postId, kind });
    }
    const counts = REACTION_KINDS.reduce((acc, k) => {
      acc[k] = list.filter((r) => r.kind === k).length;
      return acc;
    }, {});
    saveTlState();
    return {
      ok: true,
      result: { action, kind, counts, total: list.length, userReaction: action === "removed" ? null : kind },
    };
  });

  // Full "who reacted" breakdown for a post.
  registerLensAction("timeline", "reactions-breakdown", (_ctx, _a, params = {}) => {
    const s = getTlState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const postId = tlClean(params.postId, 64);
    if (!postId) return { ok: false, error: "postId required." };
    const list = [...(s.reactions.get(postId) || [])];
    list.sort((a, b) => b.at.localeCompare(a.at));
    const byKind = REACTION_KINDS.reduce((acc, k) => {
      acc[k] = list.filter((r) => r.kind === k).map((r) => ({ userId: r.userId, at: r.at }));
      return acc;
    }, {});
    const counts = REACTION_KINDS.reduce((acc, k) => { acc[k] = byKind[k].length; return acc; }, {});
    return {
      ok: true,
      result: {
        total: list.length, counts, byKind,
        reactors: list.map((r) => ({ userId: r.userId, kind: r.kind, at: r.at })),
      },
    };
  });

  // ── Share / repost ─────────────────────────────────────────────────────
  registerLensAction("timeline", "share-post", (ctx, _a, params = {}) => {
    const s = getTlState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const postId = tlClean(params.postId, 64);
    if (!postId) return { ok: false, error: "postId required." };
    const found = findPost(s, postId);
    if (!found) return { ok: false, error: "Post not found." };
    if (found.post.privacy === "private" && found.ownerId !== tlAid(ctx)) {
      return { ok: false, error: "Cannot share a private post." };
    }
    const privacy = PRIVACY_KINDS.includes(String(params.privacy))
      ? String(params.privacy) : "friends";
    const actorId = tlAid(ctx);
    const shared = {
      id: tlId("pst"),
      authorId: actorId,
      content: tlClean(params.comment, 1000),
      media: [],
      privacy,
      taggedUserIds: [],
      sharedFrom: {
        postId: found.post.id,
        authorId: found.post.authorId,
        content: found.post.content,
        media: found.post.media,
        createdAt: found.post.createdAt,
      },
      createdAt: tlNow(),
    };
    tlList(s.posts, actorId).unshift(shared);
    pushNotif(s, found.post.authorId, actorId, "share", { postId: found.post.id });
    saveTlState();
    return { ok: true, result: { post: shared } };
  });

  // ── Media albums ───────────────────────────────────────────────────────
  registerLensAction("timeline", "album-create", (ctx, _a, params = {}) => {
    const s = getTlState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const name = tlClean(params.name, 120);
    if (!name) return { ok: false, error: "Album name required." };
    const album = {
      id: tlId("alb"),
      ownerId: tlAid(ctx),
      name,
      description: tlClean(params.description, 500),
      coverUrl: tlClean(params.coverUrl, 1000) || null,
      media: [],
      createdAt: tlNow(),
    };
    tlList(s.albums, album.ownerId).unshift(album);
    saveTlState();
    return { ok: true, result: { album } };
  });

  registerLensAction("timeline", "album-add-media", (ctx, _a, params = {}) => {
    const s = getTlState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const albumId = tlClean(params.albumId, 64);
    const userId = tlAid(ctx);
    const album = (s.albums.get(userId) || []).find((a) => a.id === albumId);
    if (!album) return { ok: false, error: "Album not found." };
    const items = Array.isArray(params.media) ? params.media : [params];
    const added = [];
    for (const m of items) {
      const kind = String(m && m.kind);
      const url = tlClean(m && m.url, 1000);
      if (!MEDIA_KINDS.includes(kind) || !url) continue;
      const item = { id: tlId("med"), kind, url, caption: tlClean(m.caption, 200), at: tlNow() };
      album.media.push(item);
      added.push(item);
    }
    if (added.length === 0) return { ok: false, error: "No valid media supplied." };
    if (!album.coverUrl) album.coverUrl = added[0].url;
    saveTlState();
    return { ok: true, result: { album, added: added.length, mediaCount: album.media.length } };
  });

  registerLensAction("timeline", "album-list", (ctx, _a, params = {}) => {
    const s = getTlState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = params.ownerId ? tlClean(params.ownerId, 64) : tlAid(ctx);
    const albums = [...(s.albums.get(userId) || [])];
    albums.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return {
      ok: true,
      result: {
        albums,
        totalAlbums: albums.length,
        totalMedia: albums.reduce((n, a) => n + a.media.length, 0),
      },
    };
  });

  // ── Profile: cover photo, bio, about ──────────────────────────────────
  registerLensAction("timeline", "profile-get", (ctx, _a, params = {}) => {
    const s = getTlState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = params.userId ? tlClean(params.userId, 64) : tlAid(ctx);
    const profile = s.profiles.get(userId) || {
      userId, coverUrl: null, avatarUrl: null, bio: "",
      about: { work: "", education: "", location: "", relationship: "", website: "" },
      updatedAt: null,
    };
    const posts = s.posts.get(userId) || [];
    return {
      ok: true,
      result: {
        profile,
        stats: {
          posts: posts.length,
          albums: (s.albums.get(userId) || []).length,
        },
      },
    };
  });

  registerLensAction("timeline", "profile-update", (ctx, _a, params = {}) => {
    const s = getTlState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tlAid(ctx);
    const prev = s.profiles.get(userId) || {
      userId, coverUrl: null, avatarUrl: null, bio: "",
      about: { work: "", education: "", location: "", relationship: "", website: "" },
    };
    const a = params.about || {};
    const profile = {
      userId,
      coverUrl: params.coverUrl !== undefined ? (tlClean(params.coverUrl, 1000) || null) : prev.coverUrl,
      avatarUrl: params.avatarUrl !== undefined ? (tlClean(params.avatarUrl, 1000) || null) : prev.avatarUrl,
      bio: params.bio !== undefined ? tlClean(params.bio, 500) : prev.bio,
      about: {
        work: a.work !== undefined ? tlClean(a.work, 200) : prev.about.work,
        education: a.education !== undefined ? tlClean(a.education, 200) : prev.about.education,
        location: a.location !== undefined ? tlClean(a.location, 200) : prev.about.location,
        relationship: a.relationship !== undefined ? tlClean(a.relationship, 100) : prev.about.relationship,
        website: a.website !== undefined ? tlClean(a.website, 300) : prev.about.website,
      },
      updatedAt: tlNow(),
    };
    s.profiles.set(userId, profile);
    saveTlState();
    return { ok: true, result: { profile } };
  });

  // ── Memories / "On this day" ──────────────────────────────────────────
  // Surfaces past posts whose month+day match the requested day (default
  // today) but from a prior year — the Facebook Memories experience.
  registerLensAction("timeline", "memories", (ctx, _a, params = {}) => {
    const s = getTlState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tlAid(ctx);
    const ref = params.date ? new Date(params.date) : new Date();
    if (isNaN(ref.getTime())) return { ok: false, error: "Invalid date." };
    const refMonth = ref.getMonth();
    const refDay = ref.getDate();
    const refYear = ref.getFullYear();
    const posts = s.posts.get(userId) || [];
    const memories = [];
    for (const p of posts) {
      const d = new Date(p.createdAt);
      if (isNaN(d.getTime())) continue;
      if (d.getMonth() === refMonth && d.getDate() === refDay && d.getFullYear() < refYear) {
        memories.push({
          ...p,
          yearsAgo: refYear - d.getFullYear(),
          reactionTotal: (s.reactions.get(p.id) || []).length,
          commentCount: (s.comments.get(p.id) || []).length,
        });
      }
    }
    memories.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return {
      ok: true,
      result: {
        memories,
        count: memories.length,
        onThisDay: `${ref.toLocaleString("en-US", { month: "long" })} ${refDay}`,
      },
    };
  });

  // ── Notifications ──────────────────────────────────────────────────────
  registerLensAction("timeline", "notifications-list", (ctx, _a, params = {}) => {
    const s = getTlState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tlAid(ctx);
    let list = [...(s.notifs.get(userId) || [])];
    if (params.unreadOnly) list = list.filter((n) => !n.read);
    const limit = Math.max(1, Math.min(100, tlNum(params.limit, 50)));
    return {
      ok: true,
      result: {
        notifications: list.slice(0, limit),
        total: list.length,
        unread: (s.notifs.get(userId) || []).filter((n) => !n.read).length,
      },
    };
  });

  registerLensAction("timeline", "notifications-mark-read", (ctx, _a, params = {}) => {
    const s = getTlState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tlAid(ctx);
    const list = s.notifs.get(userId) || [];
    const ids = Array.isArray(params.ids) ? new Set(params.ids.map((i) => tlClean(i, 64))) : null;
    let marked = 0;
    for (const n of list) {
      if (!n.read && (!ids || ids.has(n.id))) { n.read = true; marked += 1; }
    }
    saveTlState();
    return {
      ok: true,
      result: { marked, unread: list.filter((n) => !n.read).length },
    };
  });

  // Delete a post (author only) — cascades comments + reactions.
  registerLensAction("timeline", "post-delete", (ctx, _a, params = {}) => {
    const s = getTlState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const postId = tlClean(params.postId, 64);
    if (!postId) return { ok: false, error: "postId required." };
    const userId = tlAid(ctx);
    const list = s.posts.get(userId) || [];
    const before = list.length;
    const next = list.filter((p) => p.id !== postId);
    if (next.length === before) return { ok: false, error: "Post not found or not yours." };
    s.posts.set(userId, next);
    s.comments.delete(postId);
    s.reactions.delete(postId);
    saveTlState();
    return { ok: true, result: { removed: true } };
  });
}
