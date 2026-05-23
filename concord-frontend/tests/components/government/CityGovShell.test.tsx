import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

import { CityGovShell } from '@/components/government/CityGovShell';

const BASE = {
  totalServiceRequests: 10,
  openRequests: 4,
  closed30d: 6,
  avgResolutionDays: 3,
  permitCount: 5,
  scheduledInspections: 2,
  departmentCount: 3,
  assetCount: 8,
  brokenAssets: 1,
  requests: [],
  permits: [],
  assets: [],
};

describe('CityGovShell', () => {
  it('renders metric strip and three empty sections', () => {
    render(<CityGovShell {...BASE} />);
    expect(screen.getByText('Open 311 SRs')).toBeInTheDocument();
    expect(screen.getByText('of 10 total')).toBeInTheDocument();
    expect(screen.getByText('No requests yet — citizens file them from the workbench below.')).toBeInTheDocument();
    expect(screen.getByText('No permits yet — applicants apply from the workbench below.')).toBeInTheDocument();
    expect(screen.getByText('No assets yet — add streetlights, hydrants, signs from the workbench below.')).toBeInTheDocument();
  });

  it('renders populated requests, permits and assets', () => {
    render(
      <CityGovShell
        {...BASE}
        requests={[
          { id: 'r1', referenceNumber: 'SR-1', category: 'pot_hole', description: 'Big hole in the road', status: 'in_progress', priority: 'urgent', assignedDepartmentName: 'DPW', createdAt: '2026-01-01' },
          { id: 'r2', referenceNumber: 'SR-2', category: 'graffiti', description: 'tag', status: 'submitted', priority: 'low', createdAt: '2026-01-02' },
        ]}
        permits={[
          { id: 'p1', recordNumber: 'PMT-1', kind: 'building', applicantName: 'Jane', status: 'under_review', feeUsd: 50 },
        ]}
        assets={[
          { id: 'a1', kind: 'streetlight', label: 'SL-1', condition: 'good' },
          { id: 'a2', kind: 'hydrant', label: '', condition: 'broken' },
        ]}
        className="custom-cls"
      />,
    );
    expect(screen.getByText('SR-1')).toBeInTheDocument();
    expect(screen.getByText('urgent')).toBeInTheDocument();
    expect(screen.getByText('Assigned to DPW')).toBeInTheDocument();
    expect(screen.getByText('PMT-1')).toBeInTheDocument();
    expect(screen.getByText(/building/)).toBeInTheDocument();
    expect(screen.getByText('SL-1')).toBeInTheDocument();
    // empty label -> falls back to kind
    expect(screen.getAllByText('hydrant').length).toBeGreaterThan(0);
    expect(screen.getByText('good')).toBeInTheDocument();
    expect(screen.getByText('broken')).toBeInTheDocument();
  });

  it('caps lists at 8 items', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      id: `r${i}`, referenceNumber: `SR-${i}`, category: 'pothole', description: 'd',
      status: 'submitted', priority: 'medium' as const, createdAt: '2026-01-01',
    }));
    render(<CityGovShell {...BASE} requests={many} />);
    expect(screen.getByText('SR-0')).toBeInTheDocument();
    expect(screen.getByText('SR-7')).toBeInTheDocument();
    expect(screen.queryByText('SR-8')).not.toBeInTheDocument();
  });
});
