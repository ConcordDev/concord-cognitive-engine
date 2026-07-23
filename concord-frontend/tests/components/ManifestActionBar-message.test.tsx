import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';

import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { getLensManifest } from '@/lib/lenses/manifest';

// Regression pin for a real, found-and-fixed bug: the `message` lens's
// manifest declared actions ('send_dm'/'list_threads'/'mark_read'/
// 'archive'/'search_messages') that matched no registered macro for the
// domain, so <ManifestActionBar /> — mounted unconditionally at the very
// top of the message lens page — rendered five buttons that all 404'd as
// unknown_macro on click. Fixed by emptying the manifest's actions array
// (the established pattern already used for `engineering`/`eco`'s
// equivalent bug), since every real capability already has a designed
// home elsewhere on the page (InboxShell, SlackSection, GmailSection,
// MessageWorkbench, LabelManagerPanel).
describe('message lens manifest — ManifestActionBar dead-button regression', () => {
  it('declares no quick-trigger actions (they only ever 404d)', () => {
    const manifest = getLensManifest('message');
    expect(manifest?.actions ?? []).toEqual([]);
  });

  it('renders nothing for the message lens (no broken button row)', () => {
    const { container } = render(<ManifestActionBar lensId="message" />);
    expect(container.innerHTML).toBe('');
  });
});
