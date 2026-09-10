'use client';

import { FormalVerificationRepos } from '@/components/invariant/FormalVerificationRepos';
import { ConnectiveTissueBar } from '@/components/lens/ConnectiveTissueBar';
import { ds } from '@/lib/design-system';

/** Repo-linked formal verification — was stacked at page bottom. */
export function ReposPanel() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className={ds.heading2}>Verification repos</h2>
        <p className={ds.textMuted}>Formal verification repo wiring.</p>
      </div>
      <ConnectiveTissueBar lensId="invariant" />
      <FormalVerificationRepos />
    </div>
  );
}
