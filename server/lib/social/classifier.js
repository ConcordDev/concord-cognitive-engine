// server/lib/social/classifier.js
//
// 5-brain content classifier — labels every post on the 13 axes
// (8 positive, 5 negative) that feed the inverse-X ranker.
//
// LLM path: utility brain produces JSON with confidence 0-1 per axis.
// Fallback path: deterministic heuristic that pattern-matches on
// rage-bait tells, engagement-bait phrasing, helpful markers, etc.
// The fallback's job is to keep the lens functional offline; it's
// intentionally coarse — a real classifier needs the LLM.

const POSITIVE_AXES = ["informative","helpful","learning","calm","celebration","question","personal","creative"];
const NEGATIVE_AXES = ["rage_bait","engagement_bait","controversy","promotional","doomscroll"];
export const ALL_AXES = [...POSITIVE_AXES, ...NEGATIVE_AXES];

// ─── Deterministic heuristic ────────────────────────────────────

// These are intentionally pessimistic about negative axes — we'd
// rather over-detect rage_bait + tank it than let it through. The
// LLM classifier can override.

const RAGE_PATTERNS = [
  /\b(insane|outrageous|disgust|shameful|disgrace|sickening)\b/i,
  /\b(can't believe|unbelievable|how dare)\b/i,
  /\bthis is what.+wants you to/i,
  /\bwake up\b/i,
  /\bdestroyed\b/i,
];

const ENGAGEMENT_BAIT_PATTERNS = [
  /\b(reply (?:with|below|if))\b/i,
  /\b(am i (?:the|alone))\b/i,
  /\b(agree\??)$/i,
  /\b(yes or no\??)\b/i,
  /\b(retweet if|repost if)\b/i,
  /\b(only \w+ will (?:get|understand))\b/i,
];

const CONTROVERSY_PATTERNS = [
  /\bunpopular opinion\b/i,
  /\bcontroversial take\b/i,
  /\bhot take\b/i,
  /\b(left|right) (?:wing|leaning)\b/i,
];

const INFORMATIVE_PATTERNS = [
  /https?:\/\//,
  /\bsource:?\b/i,
  /\bcitation:?\b/i,
  /\b(study|research|paper|report) (?:shows|found|says|suggests)\b/i,
  /\b\d{4}\b/,           // year mention
];

const HELPFUL_PATTERNS = [
  /\b(how to|tutorial|guide|here's how|steps?:)\b/i,
  /\b(tip:?|pro tip)\b/i,
  /\bif you('re| are) struggling with\b/i,
];

const QUESTION_PATTERNS = [
  /\?$/m,
  /\b(does anyone|has anyone|where can i|how do i)\b/i,
];

const CELEBRATION_PATTERNS = [
  /\b(launched|shipped|published|released)\b/i,
  /\b(proud|grateful|excited|congrats?)\b/i,
  /[🎉🥳🎊✨🚀]/u,
];

const CREATIVE_PATTERNS = [
  /\b(poem|song|fiction|story|chapter|sketch)\b/i,
  /\[image\]|\[video\]|\[audio\]/i,
];

const PROMOTIONAL_PATTERNS = [
  /\b(buy now|limited time|free trial|sign up)\b/i,
  /\b\$\d+\b/,
  /\b\d+% off\b/i,
];

const DOOMSCROLL_PATTERNS = [
  /\b(crisis|collapse|catastroph|apocalyp)/i,
  /\b(everything is|nothing is|we're all)\b/i,
];

const CALM_PATTERNS = [
  /\b(reflection|reflecting|noticed|gentle|reminder)\b/i,
];

function _matchScore(text, patterns) {
  let hits = 0;
  for (const re of patterns) if (re.test(text)) hits++;
  if (hits === 0) return 0;
  return Math.min(1, hits / 3 + 0.2);  // 1 hit ≈ 0.53, 2 ≈ 0.87, 3+ ≈ 1.0
}

export function classifyDeterministic(content, { allDay: _allDay } = {}) {
  const t = String(content || "");
  if (!t.trim()) return Object.fromEntries(ALL_AXES.map((k) => [k, 0]));

  const positive = {
    informative: _matchScore(t, INFORMATIVE_PATTERNS),
    helpful:     _matchScore(t, HELPFUL_PATTERNS),
    learning:    _matchScore(t, INFORMATIVE_PATTERNS) * 0.8,
    calm:        _matchScore(t, CALM_PATTERNS),
    celebration: _matchScore(t, CELEBRATION_PATTERNS),
    question:    _matchScore(t, QUESTION_PATTERNS),
    personal:    /\b(i (?:was|am|feel|think|believe))\b/i.test(t) ? 0.5 : 0,
    creative:    _matchScore(t, CREATIVE_PATTERNS),
  };
  const negative = {
    rage_bait:       _matchScore(t, RAGE_PATTERNS),
    engagement_bait: _matchScore(t, ENGAGEMENT_BAIT_PATTERNS),
    controversy:     _matchScore(t, CONTROVERSY_PATTERNS),
    promotional:     _matchScore(t, PROMOTIONAL_PATTERNS),
    doomscroll:      _matchScore(t, DOOMSCROLL_PATTERNS),
  };
  return { ...positive, ...negative };
}

// ─── Persistence ────────────────────────────────────────────────

function _now() { return Math.floor(Date.now() / 1000); }

export function saveClassification(db, postId, scores, { source = "llm", tokens = 0, latencyMs = null, reasoning = null, version = "v1" } = {}) {
  if (!db || !postId) return { ok: false, reason: "missing_args" };
  const merged = { ...Object.fromEntries(ALL_AXES.map((k) => [k, 0])), ...scores };
  const args = [
    postId, version,
    merged.informative, merged.helpful, merged.learning, merged.calm,
    merged.celebration, merged.question, merged.personal, merged.creative,
    merged.rage_bait, merged.engagement_bait, merged.controversy,
    merged.promotional, merged.doomscroll,
    source, tokens, latencyMs,
    reasoning ? String(reasoning).slice(0, 800) : null,
    _now(),
  ];
  db.prepare(`
    INSERT INTO social_post_classifications
      (post_id, classifier_version,
       informative, helpful, learning, calm, celebration, question, personal, creative,
       rage_bait, engagement_bait, controversy, promotional, doomscroll,
       source, tokens, latency_ms, reasoning, classified_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(post_id) DO UPDATE SET
      classifier_version = excluded.classifier_version,
      informative = excluded.informative,
      helpful = excluded.helpful,
      learning = excluded.learning,
      calm = excluded.calm,
      celebration = excluded.celebration,
      question = excluded.question,
      personal = excluded.personal,
      creative = excluded.creative,
      rage_bait = excluded.rage_bait,
      engagement_bait = excluded.engagement_bait,
      controversy = excluded.controversy,
      promotional = excluded.promotional,
      doomscroll = excluded.doomscroll,
      source = excluded.source,
      reasoning = excluded.reasoning,
      classified_at = excluded.classified_at
  `).run(...args);
  return { ok: true };
}

export function getClassification(db, postId) {
  if (!db || !postId) return null;
  return db.prepare(`SELECT * FROM social_post_classifications WHERE post_id = ?`).get(postId);
}

export function listUnclassifiedPosts(db, { limit = 100 } = {}) {
  if (!db) return [];
  return db.prepare(`
    SELECT p.id, p.content FROM social_posts p
    LEFT JOIN social_post_classifications c ON c.post_id = p.id
    WHERE p.deleted_at IS NULL AND p.published_at > 0 AND c.post_id IS NULL
    ORDER BY p.published_at DESC LIMIT ?
  `).all(Math.min(Number(limit), 500));
}
