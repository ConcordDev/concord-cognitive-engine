// concord-frontend/components/conkay/conkay-skills.ts
//
// ConKay's SKILLS — the part that makes Kay actually *do* things, not just talk.
// JARVIS-like manner, Concord substrate (never fiction): each skill runs against
// REAL Concord endpoints (your DTU archive, live presence, world events, the lens
// registry) and returns spoken prose + an optional live visualization + archive
// citations + an optional navigation/ambient action.
//
// Skills are matched locally and run instantly — so Kay is useful even when the
// LLM brains are offline. Anything that doesn't match a skill falls through to the
// normal chat pipeline (the four-brain router). The match is intentionally narrow:
// short imperative phrasings ("brief me", "search my archive for X", "open music")
// trigger a skill; free-form questions go to the brain.

import { LENS_REGISTRY } from '@/lib/lens-registry';

export interface ConKayVizSpec {
  type: 'metrics' | 'series' | 'bars' | 'graph';
  title?: string;
  data: unknown;
}

export interface ConKaySkillResult {
  /** Spoken-friendly prose. Always rendered; spoken aloud when unmuted. */
  spoken: string;
  /** Optional live visualization (rendered via the conkay-viz fence). */
  viz?: ConKayVizSpec;
  /** Archive (DTU) citations — "pulling from your archives". */
  dtuRefs?: Array<{ id: string; title: string | null; tier: string | null }>;
  /** Research/web sources. */
  sources?: Array<{ type: string; title: string; url: string; source: string; snippet?: string }>;
  /** Ambient action chips — what Kay touched. */
  toolCalls?: Array<{ tool: string; params: Record<string, unknown>; result: unknown; ok: boolean }>;
  /** A path to navigate to (full navigation) once the reply is delivered. */
  navigate?: string;
  /** Flare the ambient "acting" state (Kay touched a system). */
  acting?: boolean;
}

export interface ConKaySkillContext {
  apiBase: string;
  /** GET a Concord endpoint as JSON, credentials included. Never throws. */
  fetchJson: (path: string) => Promise<unknown>;
  /** Run a real Concord macro via /api/lens/run. Returns the macro envelope
   *  ({ ok, result, ... }) or null. Lets a skill DELEGATE to a deterministic
   *  backend engine (e.g. the math CAS) instead of reasoning. Never throws. */
  runMacro?: (domain: string, name: string, input: Record<string, unknown>) => Promise<unknown>;
}

export interface ConKaySkill {
  id: string;
  label: string;
  /** Example utterance, shown by the "what can you do" skill. */
  hint: string;
  /** Returns captured args if this skill handles the utterance, else null. */
  match: (utterance: string) => Record<string, string> | null;
  run: (args: Record<string, string>, ctx: ConKaySkillContext) => Promise<ConKaySkillResult>;
}

// ── shape readers (responses are untyped JSON; narrow defensively) ──────────

interface DtuLite { id: string; title: string; tier: string | null; createdAt: string }

function readDtus(resp: unknown): DtuLite[] {
  const o = resp && typeof resp === 'object' ? (resp as Record<string, unknown>) : {};
  const arr = Array.isArray(o.dtus) ? o.dtus : Array.isArray(o.result) ? o.result : Array.isArray(resp) ? (resp as unknown[]) : [];
  return (arr as unknown[])
    .map((d) => {
      const r = d && typeof d === 'object' ? (d as Record<string, unknown>) : {};
      return {
        id: String(r.id ?? r.dtuId ?? ''),
        title: String(r.title ?? r.name ?? 'Untitled'),
        tier: r.tier != null ? String(r.tier) : null,
        createdAt: String(r.createdAt ?? r.created_at ?? ''),
      };
    })
    .filter((d) => d.id);
}

function readUsers(resp: unknown): Array<{ id: string }> {
  const o = resp && typeof resp === 'object' ? (resp as Record<string, unknown>) : {};
  const arr = Array.isArray(o.users) ? o.users : Array.isArray(resp) ? (resp as unknown[]) : [];
  return (arr as unknown[])
    .map((u) => {
      const r = u && typeof u === 'object' ? (u as Record<string, unknown>) : {};
      return { id: String(r.userId ?? r.id ?? '') };
    })
    .filter((u) => u.id);
}

function readEvents(resp: unknown): Array<Record<string, unknown>> {
  const o = resp && typeof resp === 'object' ? (resp as Record<string, unknown>) : {};
  const arr = Array.isArray(o.events) ? o.events : Array.isArray(resp) ? (resp as unknown[]) : [];
  return (arr as unknown[]).filter((e): e is Record<string, unknown> => !!e && typeof e === 'object');
}

// Resolve a spoken lens name ("music", "the accounting books") → a registry entry.
function resolveLens(name: string): { name: string; path: string } | null {
  const n = name.toLowerCase().replace(/\b(the|a|an|my)\b/g, '').replace(/\s+/g, ' ').trim();
  if (!n) return null;
  const reg = LENS_REGISTRY;
  const hit =
    reg.find((l) => l.id.toLowerCase() === n || l.name.toLowerCase() === n) ||
    reg.find((l) => (l.keywords ?? []).some((k) => k.toLowerCase() === n)) ||
    reg.find((l) => l.name.toLowerCase().includes(n) || l.id.toLowerCase().includes(n)) ||
    reg.find((l) => (l.keywords ?? []).some((k) => k.toLowerCase().includes(n)));
  return hit ? { name: hit.name, path: hit.path } : null;
}

const DAY_MS = 86_400_000;

/** Turn the math CAS result envelope into a clean spoken sentence. */
function formatMathAnswer(res: Record<string, unknown>, q: string): string {
  const kind = String(res.kind || '');
  const answer = res.answer;
  const s = (v: unknown) => (typeof v === 'object' ? JSON.stringify(v) : String(v));
  switch (kind) {
    case 'evaluate': return `${q} = ${s(answer)}`;
    case 'definite-integral': {
      const b = Array.isArray(res.bounds) ? res.bounds : [];
      return `∫ ${s(res.expression)} from ${s(b[0])} to ${s(b[1])} = ${s(answer)}${res.closedForm ? '' : ' (numeric)'}`;
    }
    case 'antiderivative': return answer ? `∫ = ${s(answer)}` : `No closed-form antiderivative — try definite bounds for a numeric value.`;
    case 'derivative': return `d/dx = ${s(answer)}`;
    case 'solve': return answer != null ? `Solution: ${s(answer)}` : `No closed-form solution found.`;
    case 'simplify': return `= ${s(answer)}`;
    case 'factorize': return `${s(res.number)} = ${(Array.isArray(res.primeFactors) ? res.primeFactors : []).join(' × ')}`;
    case 'isprime': return `${s(res.number)} is ${res.isPrime ? '' : 'not '}prime.`;
    case 'convert': return `${s(res.from)} → ${s(res.to)}: ${s(answer)}`;
    default: return answer != null ? s(answer) : 'Computed.';
  }
}

// ── the skill registry ──────────────────────────────────────────────────────
// Order matters: specific skills before the greedy `search` catch-all.

export const CONKAY_SKILLS: ConKaySkill[] = [
  {
    id: 'brief',
    label: 'Brief me',
    hint: 'brief me',
    match: (u) =>
      /^\s*(brief me|morning brief|debrief|catch me up|give me (a|the) (brief|rundown|status)|status( report)?|sitrep|where do (things|we) stand)\b/i.test(u)
        ? {}
        : null,
    run: async (_a, ctx) => {
      const [dtuResp, presenceResp, eventResp] = await Promise.all([
        ctx.fetchJson('/api/dtus?mine=true&limit=200&pageSize=200'),
        ctx.fetchJson('/api/presence/active?lens=feed&windowMs=300000&limit=30'),
        ctx.fetchJson('/api/events?limit=8'),
      ]);
      const dtus = readDtus(dtuResp);
      const now = Date.now();
      const last7 = dtus.filter((d) => {
        const t = Date.parse(d.createdAt);
        return !!t && now - t < 7 * DAY_MS;
      }).length;
      const people = readUsers(presenceResp).length;
      const events = readEvents(eventResp);
      const metrics = [
        { label: 'Your DTUs', value: String(dtus.length) },
        { label: 'New this week', value: String(last7), delta: last7 > 0 ? `+${last7}` : undefined },
        { label: 'People around', value: String(people) },
        { label: 'Live events', value: String(events.length) },
      ];
      const spoken =
        dtus.length === 0
          ? `Here's your brief. Your archive is empty so far — create a DTU and I'll start tracking your rhythm. ${people} ${people === 1 ? 'person is' : 'people are'} around right now.`
          : `Here's your brief. ${dtus.length} DTU${dtus.length === 1 ? '' : 's'} in your archive, ${last7} new this week. ${people} ${people === 1 ? 'person is' : 'people are'} around, and ${events.length} live event${events.length === 1 ? '' : 's'}.`;
      return {
        spoken,
        viz: { type: 'metrics', title: 'Your brief', data: metrics },
        dtuRefs: dtus.slice(0, 5).map((d) => ({ id: d.id, title: d.title, tier: d.tier })),
        acting: true,
      };
    },
  },
  {
    id: 'activity',
    label: 'My activity',
    hint: 'show my activity',
    match: (u) =>
      /^\s*(my activity|show (me )?my (activity|work|creations|dtus)|what have i (made|created|been (working on|up to)))\b/i.test(u)
        ? {}
        : null,
    run: async (_a, ctx) => {
      const dtus = readDtus(await ctx.fetchJson('/api/dtus?mine=true&limit=200&pageSize=200'));
      const days = 14;
      const today = new Date();
      const buckets: Array<{ x: string; y: number }> = [];
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        buckets.push({
          x: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
          y: dtus.filter((x) => (x.createdAt || '').slice(0, 10) === key).length,
        });
      }
      const total14 = buckets.reduce((s, b) => s + b.y, 0);
      const spoken =
        dtus.length === 0
          ? `You haven't created anything yet — your activity chart fills in as you build.`
          : `You've created ${dtus.length} DTU${dtus.length === 1 ? '' : 's'} total, ${total14} in the last two weeks. Here's your rhythm.`;
      return { spoken, viz: { type: 'series', title: 'Your last 14 days', data: buckets }, acting: true };
    },
  },
  {
    id: 'world',
    label: 'World pulse',
    hint: "what's happening in the world",
    match: (u) =>
      /^\s*(world (status|report|update|pulse)|what'?s (happening|going on)( in the world)?|who'?s (around|online|here)|anyone (around|online|here))\b/i.test(u)
        ? {}
        : null,
    run: async (_a, ctx) => {
      const [presenceResp, eventResp] = await Promise.all([
        ctx.fetchJson('/api/presence/active?lens=feed&windowMs=300000&limit=50'),
        ctx.fetchJson('/api/events?limit=10'),
      ]);
      const people = readUsers(presenceResp).length;
      const events = readEvents(eventResp);
      const metrics = [
        { label: 'People around', value: String(people) },
        { label: 'Live events', value: String(events.length) },
      ];
      const spoken = `${people} ${people === 1 ? 'person is' : 'people are'} around right now, and ${events.length} event${events.length === 1 ? '' : 's'} ${events.length === 1 ? 'is' : 'are'} live. Say "enter the world" and I'll take you in.`;
      return { spoken, viz: { type: 'metrics', title: 'World pulse', data: metrics }, acting: true };
    },
  },
  {
    id: 'enter-world',
    label: 'Enter the world',
    hint: 'enter the world',
    match: (u) => (/^\s*(enter|take me (in|into|to)( the)?|go (in|into)|drop me into)\s*(the\s*)?(world|concordia)\b/i.test(u) ? {} : null),
    run: async () => ({ spoken: 'Taking you into Concordia.', navigate: '/lenses/world', acting: true }),
  },
  {
    id: 'help',
    label: 'What can you do',
    hint: 'what can you do',
    match: (u) =>
      /^\s*(what can you do|your (skills|abilities)|what are your (skills|abilities)|how do you work|help|commands)\s*\??\s*$/i.test(u)
        ? {}
        : null,
    run: async () => ({
      spoken:
        "I can act on your real Concord data directly: brief you, search your archive, chart your activity, read the world's pulse, take you into Concordia, and open any lens by name. Ask me anything else and I'll reason it through with the brains and your archives.",
      viz: {
        type: 'graph',
        title: 'ConKay skills',
        data: {
          nodes: CONKAY_SKILLS.filter((s) => s.id !== 'help').map((s) => ({ id: s.id, label: s.label })),
          edges: [],
        },
      },
    }),
  },
  {
    id: 'open',
    label: 'Open a lens',
    hint: 'open the music lens',
    match: (u) => {
      const m = u.match(/^\s*(?:open|go to|take me to|switch to|launch|navigate to|bring up|pull up)\s+(?:the\s+)?(.+?)(?:\s+lens)?\s*$/i);
      if (!m || !m[1]) return null;
      const name = m[1].replace(/[?.!]+$/, '').trim();
      return name.length >= 2 ? { name } : null;
    },
    run: async (a) => {
      const lens = resolveLens(a.name);
      if (!lens) {
        return { spoken: `I couldn't find a "${a.name}" lens. Try the command palette — Control or Command K.` };
      }
      return { spoken: `Opening ${lens.name}.`, navigate: lens.path, acting: true };
    },
  },
  {
    // COMPUTE, DON'T GUESS. Math is deterministic — routing it to the real CAS
    // (server/domains/math.js#naturalQuery: parser, symbolic diff/integrate,
    // solve, factor, primality, unit convert) gives a CORRECT, grounded answer
    // instead of an LLM that's confidently wrong on arithmetic. The result is
    // backed by a real computation (toolCalls) → "Grounded" in the trust badge.
    id: 'math',
    label: 'Compute (deterministic math)',
    hint: 'what is 2^10 · solve x^2-5x+6=0 · derivative of sin(x) · is 97 prime',
    match: (u) => {
      const t = u.trim().replace(/[?]+$/, '').trim();
      // Verbs the CAS understands → pass the whole phrase through.
      if (/^(?:integrate|integral of|antiderivative of|derivative of|differentiate|d\/dx|solve|simplify|expand|reduce|factor|factorize|convert)\b/i.test(t)) return { query: t };
      if (/^is\s+-?\d+\s+prime\b/i.test(t)) return { query: t };
      // Verbs the CAS does NOT strip → strip them, keep the expression. Require
      // a digit + an operator/function so we don't hijack prose ("what is a DTU").
      const m = t.match(/^(?:please\s+)?(?:calculate|compute|evaluate|work out|what(?:'s| is)|how much is)\s+(.+)$/i);
      if (m) {
        const expr = m[1].trim();
        if (/\d/.test(expr) && (/[+\-*/^%!]/.test(expr) || /\b(sqrt|cbrt|sin|cos|tan|asin|acos|atan|sinh|cosh|tanh|log|ln|exp|pi|tau|phi)\b/i.test(expr))) return { query: expr };
        return null;
      }
      // A bare arithmetic/function expression: "2+2*3", "sqrt(16)", "3!".
      if (/\d/.test(t) && /[+\-*/^%!]/.test(t) && /^[\d\s().,+\-*/^%!a-z]+$/i.test(t)) return { query: t };
      return null;
    },
    run: async (a, ctx) => {
      const q = a.query;
      if (!ctx.runMacro) {
        return { spoken: `I can compute "${q}", but the macro bridge isn't available here.`, acting: false };
      }
      const env = await ctx.runMacro('math', 'naturalQuery', { query: q }) as
        { ok?: boolean; result?: Record<string, unknown>; error?: string } | null;
      const res = env && typeof env === 'object' ? (env.result ?? null) : null;
      if (!env || env.ok === false || !res) {
        // Be honest: we could NOT compute it deterministically. Don't fake a number.
        return { spoken: `I couldn't compute "${q}" with the math engine${env?.error ? ` (${env.error})` : ''}. I won't guess at a number — rephrase it as an expression and I'll run it for real.`, acting: true };
      }
      return {
        spoken: formatMathAnswer(res, q),
        // Marks the reply Grounded (computed by the CAS, not the model).
        toolCalls: [{ tool: 'math.naturalQuery', params: { query: q }, result: res, ok: true }],
        acting: true,
      };
    },
  },
  {
    id: 'search',
    label: 'Search your archive',
    hint: 'search my archive for …',
    match: (u) => {
      const m = u.match(/^\s*(?:search|find|look up|dig up|surface)\s+(?:(?:my|the)\s+)?(?:archive\s+)?(?:dtus?\s+)?(?:notes?\s+)?(?:for|about|on|named|titled)?\s*(.+?)\s*$/i);
      if (!m || !m[1]) return null;
      const q = m[1].replace(/[?.!]+$/, '').trim();
      return q.length >= 2 ? { q } : null;
    },
    run: async (a, ctx) => {
      const q = a.q;
      let items: Array<{ id: string; title: string; tier: string | null }> = [];
      let semantic = false;
      let usedMacro = false;
      // Prefer the semantic discovery macro (embedding re-rank when the brains
      // are up; keyword+recency fallback server-side otherwise). The `semantic`
      // flag reports honestly which ranking actually ran.
      if (ctx.runMacro) {
        const env = await ctx.runMacro('discovery', 'search', { query: q, mine: true, limit: 12 }) as
          { ok?: boolean; results?: Array<Record<string, unknown>>; semantic?: boolean } | null;
        if (env && env.ok !== false && Array.isArray(env.results)) {
          usedMacro = true;
          semantic = env.semantic === true;
          items = env.results
            .map((r) => ({ id: String(r.id ?? ''), title: String(r.title ?? 'Untitled'), tier: r.kind != null ? String(r.kind) : null }))
            .filter((d) => d.id);
        }
      }
      // Fallback to the keyword endpoint only if the macro bridge is unavailable.
      if (!usedMacro) {
        const dtus = readDtus(await ctx.fetchJson(`/api/dtus?mine=true&q=${encodeURIComponent(q)}&limit=40`));
        items = dtus.map((d) => ({ id: d.id, title: d.title, tier: d.tier }));
      }
      if (items.length === 0) {
        return { spoken: `I searched your archive for "${q}" and came up empty. Nothing there yet.`, acting: true };
      }
      const how = semantic ? ', ranked by meaning' : '';
      return {
        spoken: `Found ${items.length} ${items.length === 1 ? 'entry' : 'entries'} for "${q}" in your archive${how}.`,
        dtuRefs: items.slice(0, 8),
        acting: true,
      };
    },
  },
];

/** Match an utterance to a ConKay skill, or null to fall through to the LLM. */
export function matchConKaySkill(utterance: string): { skill: ConKaySkill; args: Record<string, string> } | null {
  const u = (utterance || '').trim();
  if (!u) return null;
  for (const skill of CONKAY_SKILLS) {
    const args = skill.match(u);
    if (args) return { skill, args };
  }
  return null;
}
