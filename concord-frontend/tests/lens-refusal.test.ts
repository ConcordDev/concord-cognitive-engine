/**
 * Lens-refusal classification (lib/api/lens-refusal.ts) — split out of
 * PR #1707's S16 per GB-0736 so the global api client's error-handler
 * change is reviewed on its own blast radius.
 *
 * The behaviour pinned here is the classification the response
 * interceptor in lib/api/client.ts delegates to: the dispatch rewrites
 * server handler TypeErrors to error:"invalid_input" (reason type_error
 * / not_a_function / invalid_time) — a server defect, not the user's
 * input. Those classify as handler defects (recorded in the
 * request-error list, never toasted); every other refusal is genuine
 * and toasts with the field/reason the server named.
 */
import { describe, expect, it } from 'vitest';

import { isHandlerDefectRefusal, refusalToastMessage } from '@/lib/api/lens-refusal';

describe('isHandlerDefectRefusal', () => {
  it('classifies dispatch-rewritten TypeErrors as handler defects', () => {
    expect(isHandlerDefectRefusal('invalid_input', 'type_error')).toBe(true);
    expect(isHandlerDefectRefusal('invalid_input', 'not_a_function')).toBe(true);
    expect(isHandlerDefectRefusal('invalid_input', 'invalid_time')).toBe(true);
  });
  it('does NOT classify genuine input refusals as defects', () => {
    expect(isHandlerDefectRefusal('invalid_input', 'expected_number')).toBe(false);
    expect(isHandlerDefectRefusal('invalid_input', undefined)).toBe(false);
    expect(isHandlerDefectRefusal('insufficient_balance', 'type_error')).toBe(false);
    expect(isHandlerDefectRefusal('not_found', null)).toBe(false);
  });
});

describe('refusalToastMessage', () => {
  it('humanizes the code and appends the named field/reason', () => {
    expect(refusalToastMessage('invalid_input', 'count', 'expected_number')).toBe('invalid input (count — expected_number)');
    expect(refusalToastMessage('insufficient_balance')).toBe('insufficient balance');
  });
});
