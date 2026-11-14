/**
 * GB-1538 genus leg 4 (FIX-grounding-001, office ruling (i)) — the FE
 * side of the gate: AutoActionStrip skips actions the discovery metadata
 * marks gated unless the signed-in role is privileged. Pins the
 * predicate, the privileged-role mirror, and the wiring (the strip's
 * visible chain actually applies the predicate with the auth role, and
 * the server endpoint annotates from the gate's own lookup).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { actionVisibleForRole, GATE_PRIVILEGED_ROLES } from '@/components/lens/AutoActionStrip';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

const gated = { action: 'approve_action', gated: true, requiresRole: 'admin' } as never;
const open = { action: 'status' } as never;

describe('actionVisibleForRole', () => {
  it('ungated actions show for everyone, including signed-out', () => {
    expect(actionVisibleForRole(open, null)).toBe(true);
    expect(actionVisibleForRole(open, undefined)).toBe(true);
    expect(actionVisibleForRole(open, 'member')).toBe(true);
  });

  it('gated actions are skipped for members, viewers, and signed-out users', () => {
    expect(actionVisibleForRole(gated, 'member')).toBe(false);
    expect(actionVisibleForRole(gated, 'viewer')).toBe(false);
    expect(actionVisibleForRole(gated, null)).toBe(false);
    expect(actionVisibleForRole(gated, undefined)).toBe(false);
  });

  it('gated actions show for privileged roles (the server gate list)', () => {
    for (const role of ['owner', 'admin', 'founder', 'sovereign']) {
      expect(actionVisibleForRole(gated, role)).toBe(true);
      expect(GATE_PRIVILEGED_ROLES.has(role)).toBe(true);
    }
    expect(GATE_PRIVILEGED_ROLES.has('member')).toBe(false);
  });
});

describe('wiring', () => {
  it('the strip applies the predicate with the auth role in its visible chain', () => {
    const src = read('components/lens/AutoActionStrip.tsx');
    expect(src).toContain('actionVisibleForRole(a, user?.role)');
    expect(src).toContain("from '@/hooks/useAuth'");
  });

  it('the server endpoint annotates from macroGateFor (no second gate copy)', () => {
    const src = read('../server/server.js');
    expect(src).toContain('macroGateFor({ domain, name, macroAcl: MACRO_ACL, macroAclDomain: MACRO_ACL_DOMAIN })');
    expect(src).toContain('gated: true, requiresRole: gate.requiresRole');
  });
});
