/**
 * React 18 → React 19 internals shim for @react-three/fiber v8.
 *
 * Next 15.5 bundles React 19 in app-pages-browser chunks. R3F v8 (and
 * its react-reconciler@0.27.0) reads
 *   React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentOwner
 * at module-evaluation time. React 19 removed that export, so every
 * R3F import throws TypeError on load.
 *
 * This shim writes empty mutables into the namespace so the read
 * succeeds. `current: null` is the same idle value the React 18
 * reconciler sets between renders, so R3F's reconciler reading it
 * sees the same shape it expects.
 *
 * Mount once on the client side via instrumentation-client.ts or the
 * root layout — must run BEFORE any R3F module is imported.
 *
 * Long-term fix: upgrade @react-three/fiber to v9 which targets
 * React 19 internals natively.
 */

import * as React from 'react';

const KEY = '__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED';

export function installR3FShim(): void {
  if (typeof window === 'undefined') return; // SSR no-op
  const R = React as unknown as Record<string, unknown>;
  const internals = (R[KEY] as Record<string, unknown> | undefined) ?? {};
  if (!internals.ReactCurrentOwner) {
    internals.ReactCurrentOwner = { current: null };
  }
  if (!internals.ReactCurrentDispatcher) {
    internals.ReactCurrentDispatcher = { current: null };
  }
  if (!internals.ReactCurrentBatchConfig) {
    internals.ReactCurrentBatchConfig = { transition: null };
  }
  if (!internals.ReactDebugCurrentFrame) {
    internals.ReactDebugCurrentFrame = {
      setExtraStackFrame: () => {},
      getCurrentStack: () => '',
    };
  }
  R[KEY] = internals;
}
