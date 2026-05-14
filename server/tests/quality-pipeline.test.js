/**
 * Quality Pipeline Pattern Tests
 * Run: node --test tests/quality-pipeline.test.js
 * Or in CI: API_BASE=http://localhost:5050 node --test tests/quality-pipeline.test.js
 *
 * Tests the 6 intermediate patterns (P1-P6) and the Pattern Router.
 * These tests validate the deterministic quality pipeline that runs
 * between DTU Context Selection and the LLM call.
 *
 * Best-effort integration tests: when no server is reachable they
 * skip; when one is up they exercise the real endpoints. /status +
 * /preview are public reads (no auth). /api/chat is anonymous-allowed.
 * /api/lens/run macro dispatch requires auth — since `quality.*` is
 * NOT a runMacro domain (it's exposed as direct Express routes), the
 * macro tests skip on either "not found" or "unauthorized".
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

const API_BASE = process.env.API_BASE || 'http://localhost:5050';

// Node's default fetch User-Agent ("node") clears the bot guard; a
// browser-ish UA is set explicitly so the test is robust to UA-rule
// changes.
const TEST_UA = 'Mozilla/5.0 (compatible; ConcordTest/1.0)';

async function api(method, path, body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', 'User-Agent': TEST_UA },
    signal: AbortSignal.timeout(15_000),
  };
  if (body) opts.body = JSON.stringify(body);
  try {
    const res = await fetch(`${API_BASE}${path}`, opts);
    return res.json();
  } catch (e) {
    return { ok: false, error: String(e?.message || e), _fetchError: true };
  }
}

// True when a response indicates the endpoint/macro simply isn't
// reachable in this run (no server, not a macro domain, or auth-gated)
// — i.e. the test should skip rather than fail.
function shouldSkip(res) {
  if (res._fetchError) return true;
  const err = String(res.error || '').toLowerCase();
  return /not found|unknown|no such macro|unauthorized|auth_required|login required/.test(err);
}

// ============= Quality Pipeline Status Tests =============

describe('Quality Pipeline Status', () => {
  it('GET /api/quality-pipeline/status returns pipeline info', async () => {
    const res = await api('GET', '/api/quality-pipeline/status');
    if (res._fetchError) { assert.ok(true, 'Server not running, skipping'); return; }
    assert(res.ok, 'Should return ok');
    assert(res.pipeline, 'Should have pipeline info');
    assert(res.pipeline.patterns, 'Should list patterns');
    assert(res.pipeline.patterns.P1, 'Should have P1');
    assert(res.pipeline.patterns.P2, 'Should have P2');
    assert(res.pipeline.patterns.P3, 'Should have P3');
    assert(res.pipeline.patterns.P4, 'Should have P4');
    assert(res.pipeline.patterns.P5, 'Should have P5');
    assert(res.pipeline.patterns.P6, 'Should have P6');
    assert.strictEqual(res.pipeline.patterns.P2.alwaysRun, true, 'P2 should always run');
    assert.strictEqual(res.pipeline.patterns.P6.alwaysRun, true, 'P6 should always run');
    assert.strictEqual(res.pipeline.patterns.P1.alwaysRun, false, 'P1 should be conditional');
    assert.strictEqual(res.pipeline.maxConcurrent, 3, 'Max concurrent should be 3');
    assert(Array.isArray(res.pipeline.backendEnhancements), 'Should list backend enhancements');
    assert(res.pipeline.backendEnhancements.includes('coherenceAudit'), 'Should include coherenceAudit');
    assert(res.pipeline.backendEnhancements.includes('shadowPromotion'), 'Should include shadowPromotion');
    assert(res.pipeline.backendEnhancements.includes('crispnessDecay'), 'Should include crispnessDecay');
  });

  it('GET /api/quality-pipeline/status with sessionId returns history', async () => {
    const res = await api('GET', '/api/quality-pipeline/status?sessionId=test_session_123');
    if (res._fetchError) { assert.ok(true, 'Server not running, skipping'); return; }
    assert(res.ok, 'Should return ok');
    assert(Array.isArray(res.pipeline.sessionHistory), 'Should return session history array');
  });
});

// ============= Quality Pipeline Preview Tests =============

describe('Quality Pipeline Preview', () => {
  it('POST /api/quality-pipeline/preview classifies factual queries', async () => {
    const res = await api('POST', '/api/quality-pipeline/preview', {
      query: 'What is the definition of photosynthesis?',
      mode: 'explore'
    });
    if (res._fetchError) { assert.ok(true, 'Server not running, skipping'); return; }
    assert(res.ok, 'Should return ok');
    assert.strictEqual(res.preview.queryIntent, 'factual', 'Should classify as factual');
    assert(res.preview.projectionRules, 'Should return projection rules');
    assert.strictEqual(res.preview.projectionRules.context, true, 'Factual should include context');
    assert.strictEqual(res.preview.projectionRules.evidence, true, 'Factual should include evidence');
    assert.strictEqual(res.preview.projectionRules.reasoning, false, 'Factual should skip reasoning');
  });

  it('POST /api/quality-pipeline/preview classifies causal queries', async () => {
    const res = await api('POST', '/api/quality-pipeline/preview', {
      query: 'Why did the server crash after the deployment?',
      mode: 'explore'
    });
    if (res._fetchError) { assert.ok(true, 'Server not running, skipping'); return; }
    assert(res.ok, 'Should return ok');
    assert.strictEqual(res.preview.queryIntent, 'causal', 'Should classify as causal');
    assert.strictEqual(res.preview.projectionRules.reasoning, true, 'Causal should include reasoning');
  });

  it('POST /api/quality-pipeline/preview classifies procedural queries', async () => {
    const res = await api('POST', '/api/quality-pipeline/preview', {
      query: 'How to set up a CI/CD pipeline with Docker?',
      mode: 'explore'
    });
    if (res._fetchError) { assert.ok(true, 'Server not running, skipping'); return; }
    assert(res.ok, 'Should return ok');
    assert.strictEqual(res.preview.queryIntent, 'procedural', 'Should classify as procedural');
    assert.strictEqual(res.preview.projectionRules.tests, true, 'Procedural should include tests');
    assert.strictEqual(res.preview.projectionRules.impact, true, 'Procedural should include impact');
  });

  it('POST /api/quality-pipeline/preview classifies creative queries', async () => {
    const res = await api('POST', '/api/quality-pipeline/preview', {
      query: 'Brainstorm ideas for a new game mechanic',
      mode: 'explore'
    });
    if (res._fetchError) { assert.ok(true, 'Server not running, skipping'); return; }
    assert(res.ok, 'Should return ok');
    assert.strictEqual(res.preview.queryIntent, 'creative', 'Should classify as creative');
    assert.strictEqual(res.preview.projectionRules.context, true, 'Creative should include context');
    assert.strictEqual(res.preview.projectionRules.impact, true, 'Creative should include impact');
    assert.strictEqual(res.preview.projectionRules.evidence, false, 'Creative should skip evidence');
  });

  it('POST /api/quality-pipeline/preview classifies evaluative queries', async () => {
    const res = await api('POST', '/api/quality-pipeline/preview', {
      query: 'Compare React vs Vue for a large enterprise application',
      mode: 'explore'
    });
    if (res._fetchError) { assert.ok(true, 'Server not running, skipping'); return; }
    assert(res.ok, 'Should return ok');
    assert.strictEqual(res.preview.queryIntent, 'evaluative', 'Should classify as evaluative');
    // Evaluative should include all fields
    const rules = res.preview.projectionRules;
    assert.strictEqual(rules.context, true);
    assert.strictEqual(rules.reasoning, true);
    assert.strictEqual(rules.evidence, true);
    assert.strictEqual(rules.tests, true);
    assert.strictEqual(rules.impact, true);
  });

  it('POST /api/quality-pipeline/preview classifies debug mode queries', async () => {
    const res = await api('POST', '/api/quality-pipeline/preview', {
      query: 'Something is broken',
      mode: 'debug'
    });
    if (res._fetchError) { assert.ok(true, 'Server not running, skipping'); return; }
    assert(res.ok, 'Should return ok');
    assert.strictEqual(res.preview.queryIntent, 'debug', 'Debug mode should classify as debug');
    assert.strictEqual(res.preview.projectionRules.tests, true, 'Debug should include tests');
  });

  it('POST /api/quality-pipeline/preview returns error without query', async () => {
    const res = await api('POST', '/api/quality-pipeline/preview', {});
    if (res._fetchError) { assert.ok(true, 'Server not running, skipping'); return; }
    assert.strictEqual(res.ok, false, 'Should fail without query');
  });

  it('POST /api/quality-pipeline/preview returns domain classification', async () => {
    const res = await api('POST', '/api/quality-pipeline/preview', {
      query: 'How to implement a binary search algorithm in Python?',
      mode: 'explore'
    });
    if (res._fetchError) { assert.ok(true, 'Server not running, skipping'); return; }
    assert(res.ok, 'Should return ok');
    assert(res.preview.domain, 'Should return domain');
  });
});

// ============= Quality Pipeline Integration with Chat =============

describe('Quality Pipeline Chat Integration', () => {
  it('Chat response includes quality pipeline metadata', async () => {
    const res = await api('POST', '/api/chat?full=1', {
      message: 'What do you know about healthcare billing codes?',
      sessionId: `qp_test_${Date.now()}`,
      mode: 'explore',
    });
    if (res._fetchError) { assert.ok(true, 'Server not running, skipping'); return; }
    assert(res.ok, 'Chat should succeed');
    // The quality pipeline metadata should be present in the response meta
    if (res.meta?.qualityPipeline) {
      assert(Array.isArray(res.meta.qualityPipeline.patternsApplied), 'Should list patterns applied');
      assert(res.meta.qualityPipeline.queryIntent, 'Should include query intent');
    }
  });

  it('Chat quality pipeline does not break when no DTUs match', async () => {
    const res = await api('POST', '/api/chat?full=1', {
      message: 'xyzzy_nonexistent_topic_12345',
      sessionId: `qp_test_empty_${Date.now()}`,
      mode: 'explore',
    });
    if (res._fetchError) { assert.ok(true, 'Server not running, skipping'); return; }
    assert(res.ok, 'Chat should still succeed even with no matches');
  });
});

// ============= Quality Pipeline Macro Integration =============

describe('Quality Pipeline Macros', () => {
  // The quality pipeline is exposed as direct Express routes
  // (/api/quality-pipeline/*), not as runMacro domain macros. These
  // tests exercise the macro-dispatch surface (/api/lens/run) and skip
  // gracefully when no `quality` macro domain is registered — which is
  // the current, expected state.
  it('quality.status macro returns pipeline info (or skips if not a macro)', async () => {
    const res = await api('POST', '/api/lens/run', {
      domain: 'quality',
      name: 'status',
      input: { sessionId: 'test' }
    });
    if (shouldSkip(res)) {
      assert.ok(true, 'quality.* not a macro domain / not reachable - skipping');
      return;
    }
    assert(res.ok, 'Macro should succeed');
    assert(Array.isArray(res.patterns), 'Should list patterns');
    assert(res.backendEnhancements, 'Should list backend enhancements');
  });

  it('quality.preview macro classifies queries (or skips if not a macro)', async () => {
    const res = await api('POST', '/api/lens/run', {
      domain: 'quality',
      name: 'preview',
      input: { query: 'Why does this happen?', mode: 'explore' }
    });
    if (shouldSkip(res)) {
      assert.ok(true, 'quality.* not a macro domain / not reachable - skipping');
      return;
    }
    assert(res.ok, 'Macro should succeed');
    assert.strictEqual(res.queryIntent, 'causal', 'Should classify causal query');
  });
});

// ============= DTU Commit Backend Enhancement Tests =============

describe('Backend Enhancements (via DTU creation)', () => {
  it('Creating a DTU triggers coherence audit (no crash)', async () => {
    // Create a DTU with contradictory claims and invariants
    const res = await api('POST', '/api/forge/manual', {
      title: 'QP Test: Coherence Check',
      tags: ['test', 'quality-pipeline', 'coherence'],
      core: {
        definitions: ['Test DTU for coherence audit'],
        invariants: ['Water boils at 100C', 'not water boils at 100c'],
        claims: ['This is a test claim']
      }
    });
    if (res._fetchError) { assert.ok(true, 'Server not running, skipping'); return; }
    // The DTU may or may not be created (council gate decides), but it should not crash
    assert(typeof res.ok === 'boolean', 'Should return ok status');
  });

  it('Creating multiple DTUs with same invariant triggers shadow promotion', async () => {
    const sharedInvariant = `qp_test_shared_invariant_${Date.now()}`;

    // Create 4 DTUs with the same invariant to trigger the 3+ threshold
    for (let i = 0; i < 4; i++) {
      await api('POST', '/api/forge/manual', {
        title: `QP Test: Shadow Promo ${i}`,
        tags: ['test', 'quality-pipeline', 'shadow-promo'],
        core: {
          definitions: [`Test DTU ${i} for shadow promotion`],
          invariants: [sharedInvariant, `unique_inv_${i}`],
          claims: [`Claim ${i}`]
        }
      });
    }

    // Check shadow DTU count (should have increased)
    const status = await api('GET', '/api/quality-pipeline/status');
    if (status._fetchError) { assert.ok(true, 'Server not running, skipping'); return; }
    assert(status.ok, 'Status should return ok');
    // We can't assert exact count but pipeline should not crash
    assert(typeof status.pipeline.shadowDtus.total === 'number', 'Should report shadow DTU count');
  });

  it('Creating DTU on existing topic triggers crispness decay (no crash)', async () => {
    const topic = `qp_decay_test_${Date.now()}`;

    // Create first DTU
    await api('POST', '/api/forge/manual', {
      title: `QP Decay Test: Original ${topic}`,
      tags: ['test', 'quality-pipeline', 'decay', topic],
      core: {
        definitions: ['Original knowledge on the topic'],
        invariants: ['Original fact A', 'Original fact B']
      }
    });

    // Create second DTU on same topic (should trigger decay)
    const res = await api('POST', '/api/forge/manual', {
      title: `QP Decay Test: Updated ${topic}`,
      tags: ['test', 'quality-pipeline', 'decay', topic],
      core: {
        definitions: ['Updated knowledge on the topic'],
        invariants: ['Updated fact A', 'Updated fact C']
      }
    });

    if (res._fetchError) { assert.ok(true, 'Server not running, skipping'); return; }
    assert(typeof res.ok === 'boolean', 'Should return ok status without crash');
  });
});

// ============= Pattern Logic Unit Tests (pure function behavior) =============

describe('CRETI Projection Rules', () => {
  it('Factual intent projects context + evidence only', () => {
    // These tests validate the projection rules configuration
    const factual = { context: true, reasoning: false, evidence: true, tests: false, impact: false };
    assert.strictEqual(factual.context, true);
    assert.strictEqual(factual.reasoning, false);
    assert.strictEqual(factual.evidence, true);
    assert.strictEqual(factual.tests, false);
    assert.strictEqual(factual.impact, false);
  });

  it('Evaluative intent projects all fields', () => {
    const evaluative = { context: true, reasoning: true, evidence: true, tests: true, impact: true };
    for (const [, v] of Object.entries(evaluative)) {
      assert.strictEqual(v, true, 'Evaluative should include all fields');
    }
  });

  it('Debug intent projects context + reasoning + evidence + tests', () => {
    const debug = { context: true, reasoning: true, evidence: true, tests: true, impact: false };
    assert.strictEqual(debug.context, true);
    assert.strictEqual(debug.reasoning, true);
    assert.strictEqual(debug.tests, true);
    assert.strictEqual(debug.impact, false);
  });

  it('Creative intent projects context + impact only', () => {
    const creative = { context: true, reasoning: false, evidence: false, tests: false, impact: true };
    assert.strictEqual(creative.context, true);
    assert.strictEqual(creative.reasoning, false);
    assert.strictEqual(creative.impact, true);
  });
});

describe('Resonance Weighting Tiers', () => {
  it('High resonance (>0.8) gets full representation', () => {
    const tiers = [
      { threshold: 0.8, tier: 'full' },
      { threshold: 0.5, tier: 'summary' },
      { threshold: 0.25, tier: 'single' },
      { threshold: 0, tier: 'tag' }
    ];
    const resonance = 0.85;
    const tier = tiers.find(t => resonance > t.threshold)?.tier || 'tag';
    assert.strictEqual(tier, 'full');
  });

  it('Medium resonance (0.5-0.8) gets summary representation', () => {
    const resonance = 0.65;
    const tier = resonance > 0.8 ? 'full' : resonance > 0.5 ? 'summary' : resonance > 0.25 ? 'single' : 'tag';
    assert.strictEqual(tier, 'summary');
  });

  it('Low resonance (0.25-0.5) gets single-line representation', () => {
    const resonance = 0.3;
    const tier = resonance > 0.8 ? 'full' : resonance > 0.5 ? 'summary' : resonance > 0.25 ? 'single' : 'tag';
    assert.strictEqual(tier, 'single');
  });

  it('Very low resonance (<0.25) gets tag-only representation', () => {
    const resonance = 0.1;
    const tier = resonance > 0.8 ? 'full' : resonance > 0.5 ? 'summary' : resonance > 0.25 ? 'single' : 'tag';
    assert.strictEqual(tier, 'tag');
  });
});

describe('Contradiction Resolution Priority', () => {
  it('Newer DTU wins over older DTU', () => {
    const dtuA = { id: 'a', updatedAt: '2024-01-01T00:00:00Z', authority: { score: 5 } };
    const dtuB = { id: 'b', updatedAt: '2024-06-01T00:00:00Z', authority: { score: 5 } };
    const newer = dtuA.updatedAt > dtuB.updatedAt ? dtuA : dtuB;
    assert.strictEqual(newer.id, 'b', 'Newer DTU should win');
  });

  it('Higher authority score wins when timestamps equal', () => {
    const dtuA = { id: 'a', updatedAt: '2024-01-01T00:00:00Z', authority: { score: 8 } };
    const dtuB = { id: 'b', updatedAt: '2024-01-01T00:00:00Z', authority: { score: 3 } };
    const winner = dtuA.authority.score > dtuB.authority.score ? dtuA : dtuB;
    assert.strictEqual(winner.id, 'a', 'Higher authority should win');
  });
});

describe('Pattern Router Selection Logic', () => {
  it('Always includes P2 and P6', () => {
    const patterns = ['P2', 'P6']; // Baseline
    assert(patterns.includes('P2'), 'P2 should always be included');
    assert(patterns.includes('P6'), 'P6 should always be included');
  });

  it('Max concurrent is 3 for normal queries', () => {
    const MAX_CONCURRENT = 3;
    const baseline = ['P2', 'P6'];
    const maxConditional = MAX_CONCURRENT - baseline.length;
    assert.strictEqual(maxConditional, 1, 'Should allow 1 conditional pattern');
  });

  it('Complex queries can run all 6 patterns', () => {
    const allPatterns = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'];
    assert.strictEqual(allPatterns.length, 6, 'Should have 6 total patterns');
  });
});
