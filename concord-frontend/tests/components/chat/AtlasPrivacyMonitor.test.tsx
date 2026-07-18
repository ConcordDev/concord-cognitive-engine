/**
 * AtlasPrivacyMonitor — Wave 4 gap-closure coverage. This card was previously
 * mounted only inside the generic tool-result-card renderer on the chat lens
 * (never inside the atlas lens itself, which is the actual privacy-zones
 * capability's natural home — docs/lens-specs/atlas-capability-map.md §1d).
 * It is now also reused directly inside a new atlas-lens "Privacy" tab
 * (app/lenses/atlas/page.tsx). This file pins the display contract against
 * the exact shape `GET /api/atlas/privacy_zones?view=...` returns
 * (server/server.js ~line 57507): zones list renders real data, stats view
 * renders real data, and honest loading/empty/error states throughout.
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import AtlasPrivacyMonitor from '@/components/chat/AtlasPrivacyMonitor';

describe('AtlasPrivacyMonitor', () => {
  it('renders a loading state', () => {
    const { getByText } = render(<AtlasPrivacyMonitor data={null} loading />);
    expect(getByText('Loading privacy monitor...')).toBeInTheDocument();
  });

  it('renders an honest "no data" state when ok is false and no error is given', () => {
    const { getByText } = render(<AtlasPrivacyMonitor data={{ ok: false, view: 'zones' }} loading={false} />);
    expect(getByText('No privacy data available')).toBeInTheDocument();
  });

  it('surfaces a real backend error message instead of a generic fallback', () => {
    const { getByText } = render(
      <AtlasPrivacyMonitor data={{ ok: false, view: 'verify', error: 'zone_not_found' }} loading={false} />
    );
    expect(getByText('zone_not_found')).toBeInTheDocument();
  });

  it('renders real zones list data (classification, protection level, confidence)', () => {
    const { getByText } = render(
      <AtlasPrivacyMonitor
        data={{
          ok: true,
          view: 'zones',
          zones: {
            count: 2,
            zones: [
              { id: 'zone_1', classification: 'residential', protection_level: 'ABSOLUTE', confidence: 0.91, established: '2026-07-01T00:00:00Z' },
              { id: 'zone_2', classification: 'medical', protection_level: 'RESTRICTED', confidence: 0.83, established: '2026-07-02T00:00:00Z' },
            ],
          },
        }}
        loading={false}
      />
    );
    expect(getByText('2 zones')).toBeInTheDocument();
    expect(getByText('residential')).toBeInTheDocument();
    expect(getByText('ABSOLUTE')).toBeInTheDocument();
    expect(getByText('91%')).toBeInTheDocument();
    expect(getByText('medical')).toBeInTheDocument();
    expect(getByText('RESTRICTED')).toBeInTheDocument();
  });

  it('renders an honest empty state for zones — never a fabricated placeholder zone', () => {
    const { getByText, queryByText } = render(
      <AtlasPrivacyMonitor data={{ ok: true, view: 'zones', zones: { count: 0, zones: [] } }} loading={false} />
    );
    expect(getByText('No privacy zones established')).toBeInTheDocument();
    expect(queryByText('residential')).not.toBeInTheDocument();
  });

  it('renders real stats view data (protection-level breakdown + suppression counters)', () => {
    const { getByText } = render(
      <AtlasPrivacyMonitor
        data={{
          ok: true,
          view: 'stats',
          stats: {
            totalZones: 5,
            byProtectionLevel: { ABSOLUTE: 3, RESTRICTED: 2 },
            byClassification: { residential: 3, medical: 2 },
            blocksEnforced: 12,
            presenceDetectionsSuppressed: 4,
            vehicleTrackingSuppressed: 1,
          },
        }}
        loading={false}
      />
    );
    expect(getByText('Privacy Statistics')).toBeInTheDocument();
    expect(getByText('ABSOLUTE')).toBeInTheDocument();
    expect(getByText('3')).toBeInTheDocument();
    expect(getByText('12')).toBeInTheDocument();
    expect(getByText('4')).toBeInTheDocument();
    expect(getByText('1')).toBeInTheDocument();
  });

  it('renders a real verify result and reflects the interior-never-generated guarantee', () => {
    const { getByText, getAllByText } = render(
      <AtlasPrivacyMonitor
        data={{
          ok: true,
          view: 'verify',
          verify: {
            zone_id: 'zone_abc123456789',
            classification: 'residential',
            protection_level: 'ABSOLUTE',
            interior_data_exists: false,
            interior_reconstructable: false,
            integrity: 'verified',
          },
        }}
        loading={false}
      />
    );
    expect(getByText(/Zone Integrity: verified/)).toBeInTheDocument();
    expect(getAllByText('NO')).toHaveLength(2);
  });
});
