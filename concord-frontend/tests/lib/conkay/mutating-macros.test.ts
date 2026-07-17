// concord-frontend/tests/lib/conkay/mutating-macros.test.ts
//
// Unit A2 — pins the classifier that decides whether ConKay must confirm
// before running a macro on the CLIENT-INITIATED path. Real macro names are
// drawn from `server/server.js`'s `publicReadDomains` object (the domain+name
// allowlist for public reads) and from the CLAUDE.md macro inventory, so the
// fixtures are grounded in the live macro set, not invented.
//
// Placement note: this exercises a `lib/` module; vitest's `include` in
// vitest.config.ts scans `tests/**` (not `lib/**`), so — same convention as
// `tests/lib/conkay/artifact-kinds.test.ts` — this lives under
// tests/lib/conkay/.

import { describe, it, expect } from 'vitest';
import { isMutatingMacro } from '@/lib/conkay/mutating-macros';

describe('isMutatingMacro', () => {
  describe('real read macros are NOT gated (never confirm a read)', () => {
    // Drawn verbatim from server/server.js publicReadDomains, macros that are
    // genuinely read-only per their own doc comments in that object.
    const reads: Array<[string, string]> = [
      ['dtu', 'list'],
      ['dtu', 'get'],
      ['dtu', 'search'],
      ['dtu', 'recent'],
      ['dtu', 'stats'],
      ['dtu', 'count'],
      ['dtu', 'export'],
      ['creatures', 'taxonomy'],
      ['creatures', 'species'],
      ['detective', 'list'],
      ['detective', 'evidence'],
      ['society', 'wb-indicator-search'],
      ['society', 'wb-country-dashboard'],
      ['mounts', 'list_species'],
      ['mounts', 'get_active_mount'],
      ['mounts', 'history'],
      ['land_claims', 'list_for_user'],
      ['land_claims', 'can_act_in'],
      ['dx', 'list_codebases'],
      ['dx', 'list_weights'],
      ['dx', 'get_weight'],
      ['discovery', 'search'],
      ['discovery', 'facets'],
      ['discovery', 'trending'],
      ['billing', 'usage'],
      ['billing', 'balance'],
      ['billing', 'history'],
      ['billing', 'getCurrentQuota'],
      ['reasoning', 'traces'],
      ['refusal', 'strength'],
      ['refusal', 'composition'],
      ['code', 'dtu_query'],
      ['astronomy', 'live_apod'],
      ['scope', 'checkCitations'],
      ['society', 'wb-compare'],
    ];
    it.each(reads)('%s.%s is NOT mutating', (domain, macro) => {
      expect(isMutatingMacro(domain, macro)).toBe(false);
    });
  });

  describe('real mutating macros ARE gated', () => {
    // Also drawn from the live macro set / CLAUDE.md invariants — every one
    // of these genuinely writes (mints CC, spends a bond, changes a row).
    const writes: Array<[string, string]> = [
      ['dtu', 'create'],
      ['dtu', 'update'],
      ['dtu', 'delete'],
      ['dtu', 'bulkCreate'],
      ['social', 'post'],
      ['social', 'follow'],
      ['social', 'unfollow'],
      ['social', 'comment'],
      ['social', 'share'],
      ['reels', 'record_view'],
      ['governance', 'cast_vote'],
      ['governance', 'open_proposal'],
      ['economy', 'transfer'],
      ['economy', 'tip'],
      ['marketplace', 'purchase'],
      ['mounts', 'tame'],
      ['mounts', 'mount'],
      ['mounts', 'dismount'],
      ['mounts', 'feed'],
      ['mounts', 'groom'],
      ['land_claims', 'claim'],
      ['land_claims', 'invite'],
      ['land_claims', 'topup'],
      ['glyph_spells', 'mint'],
      ['forge_marketplace', 'mint'],
      ['game-design', 'building-publish'],
      ['combat_polish', 'attempt_parry'],
      ['combat_polish', 'attempt_dodge'],
      ['combat_polish', 'change_stance'],
    ];
    it.each(writes)('%s.%s IS mutating', (domain, macro) => {
      expect(isMutatingMacro(domain, macro)).toBe(true);
    });
  });

  describe('safe default: unrecognized macro-name shapes are treated as mutating', () => {
    it('a name matching neither list defaults to mutating', () => {
      expect(isMutatingMacro('mystery', 'zorblax')).toBe(true);
    });
    it('a compound name containing a write token anywhere is mutating even though it starts with a read verb', () => {
      // A hypothetical get-or-create shape — no such macro exists today, but
      // this proves the WRITE-token-anywhere check (not just a prefix check)
      // is what makes the classifier safe against this class of name.
      expect(isMutatingMacro('profile', 'get_or_create_profile')).toBe(true);
    });
    it('empty/garbage macro names default to mutating, never throw', () => {
      expect(isMutatingMacro('x', '')).toBe(true);
      expect(() => isMutatingMacro('x', undefined as unknown as string)).not.toThrow();
      expect(isMutatingMacro('x', undefined as unknown as string)).toBe(true);
    });
    it('camelCase macro names tokenize correctly', () => {
      expect(isMutatingMacro('dx', 'listMultiFramework')).toBe(false); // starts with "list"
      expect(isMutatingMacro('creatures', 'seedStarterGear')).toBe(true); // contains "seed"
    });
  });

  describe('write tokens always win over a leading read verb (order matters)', () => {
    it('"checkout" is mutating, not read, despite starting with "check"', () => {
      expect(isMutatingMacro('economy', 'checkout')).toBe(true);
    });
  });

  describe('ambiguous verb/noun tokens are only treated as writes as the FIRST token', () => {
    it('mounts.get_active_mount is a read — "mount" appears only as a trailing noun', () => {
      expect(isMutatingMacro('mounts', 'get_active_mount')).toBe(false);
    });
    it('mounts.mount (bare) is a write — "mount" is the whole/first token, i.e. the verb', () => {
      expect(isMutatingMacro('mounts', 'mount')).toBe(true);
    });
    it('land_claims.can_act_in is a read — a permission check, not a mutation', () => {
      expect(isMutatingMacro('land_claims', 'can_act_in')).toBe(false);
    });
  });

  describe('the live_* prefix (this codebase\'s own read-only-external-fetch convention) is trusted', () => {
    it.each([
      ['astronomy', 'live_apod'],
      ['physics', 'live_arxiv'],
      ['history', 'live_wiki_otd'],
    ])('%s.%s is NOT mutating', (domain, macro) => {
      expect(isMutatingMacro(domain, macro)).toBe(false);
    });
  });

  describe('documented residual imprecision — a few real reads are over-gated by design', () => {
    // These ARE genuinely read-only per their own doc comments in
    // server/server.js's publicReadDomains, but their names don't contain a
    // token this classifier recognizes as a read signal, so the safe default
    // (mutating) wins. Pinned here so the tradeoff is visible and intentional
    // rather than an accidental gap — see the file header's "KNOWN RESIDUAL
    // IMPRECISION" note.
    it('land_claims.claim_at over-gates (contains the write token "claim")', () => {
      expect(isMutatingMacro('land_claims', 'claim_at')).toBe(true);
    });
    it('creatures.for_world over-gates (no recognized verb token at all)', () => {
      expect(isMutatingMacro('creatures', 'for_world')).toBe(true);
    });
  });
});
