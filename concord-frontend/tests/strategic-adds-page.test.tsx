import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';

vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: React.PropsWithChildren) => React.createElement(React.Fragment, null, children),
}));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/ManifestActionBar', () => ({ ManifestActionBar: () => null }));

vi.mock('@/components/privacy/DataControlsPanel', () => ({ DataControlsPanel: () => <div>DataControlsPanel</div> }));
vi.mock('@/components/integrations/ConnectorCatalog', () => ({ ConnectorCatalog: () => <div>ConnectorCatalog</div> }));
vi.mock('@/components/attention/FocusToolkit', () => ({ FocusToolkit: () => <div>FocusToolkit</div> }));
vi.mock('@/components/srs/SrsWorkbench', () => ({ SrsWorkbench: () => <div>SrsWorkbench</div> }));
vi.mock('@/components/geology/SeismicHazardPanel', () => ({ SeismicHazardPanel: () => <div>SeismicHazardPanel</div> }));
vi.mock('@/components/forestry/FireIncidents', () => ({ FireIncidents: () => <div>FireIncidents</div> }));
vi.mock('@/components/hr/BlsSeriesExplorer', () => ({ BlsSeriesExplorer: () => <div>BlsSeriesExplorer</div> }));
vi.mock('@/components/hr/BlsWageForecast', () => ({ BlsWageForecast: () => <div>BlsWageForecast</div> }));
vi.mock('@/components/grounding/ClaimVerificationPanel', () => ({ ClaimVerificationPanel: () => <div>ClaimVerificationPanel</div> }));
vi.mock('@/components/grounding/FactGroundingWorkbench', () => ({ FactGroundingWorkbench: () => <div>FactGroundingWorkbench</div> }));
vi.mock('@/components/dx-platform/DevToolingPulse', () => ({ DevToolingPulse: () => <div>DevToolingPulse</div> }));

import StrategicAddsPage from '@/app/lenses/strategic-adds/page';

describe('/lenses/strategic-adds', () => {
  it('renders all eight tracks and keeps honest deferred state for contact network', () => {
    const { getByText } = render(<StrategicAddsPage />);

    getByText('1) Sovereign API Hub');
    getByText('2) Burnout + Focus');
    getByText('3) Adaptive Learning Twin');
    getByText('4) Disaster Hazard Suite');
    getByText('5) Labor/Career Forecasting');
    getByText('6) Provenance Shield');
    getByText('7) Contact + Preference Network');
    getByText('8) Go-live Platform');

    fireEvent.click(getByText('7) Contact + Preference Network'));
    getByText('Honest status: foundational packaging only');
  });
});
