// CB-0485 guard — error-surfacing genus, second leg. Pins:
//  - FIX-dx-platform-016: every DxWorkbench/DevToolingPulse error funnel
//    passes through dxErrorWords, whose map carries the domain's tokens.
//  - FIX-platform-003: EmpiricalGatesPanel translates its tokens.
//  - FIX-codex-001: DeepLinkModal translates 'unknown_event'.
//  - FIX-export-003: a rejected decrypt file clears the loaded envelope.
//  - FIX-forge-001: ForgeWorkbench renders both mutations' error state.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FE = join(__dirname, '..');
const read = (p: string) => readFileSync(join(FE, p), 'utf8');

describe('CB-0485 error-surfacing genus', () => {
  it('dx funnels translate through one vocabulary module', () => {
    const words = read('components/dx-platform/errorWords.ts');
    expect(words).toContain("'team_not_found'");
    expect(words).toContain("'invalid_regex'");
    const wb = read('components/dx-platform/DxWorkbench.tsx');
    expect(wb).toContain("dxErrorWords(r.data?.error)");
    expect(wb).not.toContain("setErr(r.data?.error ||");
    expect(wb).not.toContain("setMsg(r.data?.error ||");
    const pulse = read('components/dx-platform/DevToolingPulse.tsx');
    expect(pulse).toContain('dxErrorWords(res.data?.reason || res.data?.error)');
  });

  it('empirical panel translates its tokens', () => {
    const panel = read('components/platform/EmpiricalGatesPanel.tsx');
    expect(panel).toContain('empiricalErrorWords(mathMutation.data.data.error)');
    expect(panel).toContain('empiricalErrorWords(convertMutation.data.data.error)');
    expect(panel).toContain('fromUnits_and_toUnits_required');
  });

  it('codex deep-link modal words the unknown-event token', () => {
    const modal = read('components/codex/DeepLinkModal.tsx');
    expect(modal).toContain("raw === 'unknown_event'");
    expect(modal).toContain("'No entry matches this link.'");
  });

  it('decrypt rejection clears the stale envelope', () => {
    const tk = read('components/export/ExportToolkit.tsx');
    expect(tk).toContain("setEnvelope(null); setFileName(null); setInfo('Not a recognized .enc envelope");
    expect(tk).toContain('setEnvelope(null); setFileName(null);');
  });

  it('forge renders mutation failures', () => {
    const fw = read('components/forge/ForgeWorkbench.tsx');
    expect(fw).toContain('validateMutation.isError');
    expect(fw).toContain('generateMutation.isError');
    expect(fw).toContain('Validation could not reach the server');
  });
});
