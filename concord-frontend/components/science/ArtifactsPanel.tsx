'use client';

/**
 * Artifact desk — Notebook / Samples / Equipment / Analysis / Protocols / Publications.
 * Owns CRUD via useLensData. Extracted from the fat science page (no behavior invented).
 */

import { useMemo, useState, useRef } from 'react';
import {
  FlaskConical,
  Plus,
  Search,
  Filter,
  X,
  Edit3,
  Trash2,
  Download,
  CheckCircle2,
  Users,
  Activity,
  PieChart,
  FileText,
  Hash,
  Eye,
  AlertTriangle,
} from 'lucide-react';
import { useLensData, type LensItem } from '@/lib/hooks/use-lens-data';
import { useLensCommand } from '@/hooks/useLensCommand';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/components/common/EmptyState';
import {
  type ArtifactType,
  type ArtifactDataUnion,
  STATUS_COLORS,
  SAMPLE_TYPES,
  HAZARD_CLASSES,
  SAMPLE_CONDITIONS,
  EQUIPMENT_CONDITIONS,
  PROTOCOL_APPROVALS,
  PUB_STATUSES,
  VIZ_TYPES,
  SAFETY_LEVELS,
  REPRODUCIBILITY,
  getStatusesForArtifact,
} from '@/components/science/science-types';

function statusBadge(status: string) {
  const color = STATUS_COLORS[status] || 'gray-400';
  return <span className={ds.badge(color)}>{status.replace(/_/g, ' ')}</span>;
}

function renderFormFields(
  currentType: ArtifactType,
  formData: Record<string, unknown>,
  setFormData: (v: Record<string, unknown>) => void,
) {
    switch (currentType) {
      case 'Experiment':
        return (
          <>
            <div>
              <label className={ds.label}>Hypothesis</label>
              <textarea
                className={ds.textarea}
                rows={3}
                value={(formData.hypothesis as string) || ''}
                onChange={(e) => setFormData({ ...formData, hypothesis: e.target.value })}
                placeholder="State your hypothesis..."
              />
            </div>
            <div>
              <label className={ds.label}>Protocol / Method</label>
              <textarea
                className={ds.textarea}
                rows={3}
                value={(formData.protocol as string) || ''}
                onChange={(e) => setFormData({ ...formData, protocol: e.target.value })}
                placeholder="Describe the experimental protocol..."
              />
            </div>
            <div>
              <label className={ds.label}>Observations</label>
              <textarea
                className={ds.textarea}
                rows={3}
                value={(formData.observations as string) || ''}
                onChange={(e) => setFormData({ ...formData, observations: e.target.value })}
                placeholder="Record observations..."
              />
            </div>
            <div>
              <label className={ds.label}>Results</label>
              <textarea
                className={ds.textarea}
                rows={3}
                value={(formData.results as string) || ''}
                onChange={(e) => setFormData({ ...formData, results: e.target.value })}
                placeholder="Document results..."
              />
            </div>
            <div>
              <label className={ds.label}>Conclusions</label>
              <textarea
                className={ds.textarea}
                rows={2}
                value={(formData.conclusions as string) || ''}
                onChange={(e) => setFormData({ ...formData, conclusions: e.target.value })}
                placeholder="Conclusions drawn..."
              />
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Reproducibility</label>
                <select
                  className={ds.select}
                  value={(formData.reproducibility as string) || 'not_tested'}
                  onChange={(e) => setFormData({ ...formData, reproducibility: e.target.value })}
                >
                  {REPRODUCIBILITY.map((r) => (
                    <option key={r} value={r}>
                      {r.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={ds.label}>Principal Investigator</label>
                <input
                  className={ds.input}
                  value={(formData.pi as string) || ''}
                  onChange={(e) => setFormData({ ...formData, pi: e.target.value })}
                />
              </div>
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Start Date</label>
                <input
                  type="date"
                  className={ds.input}
                  value={(formData.startDate as string) || ''}
                  onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                />
              </div>
              <div>
                <label className={ds.label}>End Date</label>
                <input
                  type="date"
                  className={ds.input}
                  value={(formData.endDate as string) || ''}
                  onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label className={ds.label}>Funding Source</label>
              <input
                className={ds.input}
                value={(formData.fundingSource as string) || ''}
                onChange={(e) => setFormData({ ...formData, fundingSource: e.target.value })}
              />
            </div>
            <div>
              <label className={ds.label}>Tags (comma-separated)</label>
              <input
                className={ds.input}
                value={((formData.tags as string[]) || []).join(', ')}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    tags: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              />
            </div>
          </>
        );
      case 'Sample':
        return (
          <>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Sample ID</label>
                <input
                  className={ds.input}
                  value={(formData.sampleId as string) || ''}
                  onChange={(e) => setFormData({ ...formData, sampleId: e.target.value })}
                  placeholder="SMP-0001"
                />
              </div>
              <div>
                <label className={ds.label}>Sample Type</label>
                <select
                  className={ds.select}
                  value={(formData.type as string) || ''}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                >
                  <option value="">Select type...</option>
                  {SAMPLE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Storage Location</label>
                <input
                  className={ds.input}
                  value={(formData.storageLocation as string) || ''}
                  onChange={(e) => setFormData({ ...formData, storageLocation: e.target.value })}
                  placeholder="Freezer B, Shelf 3"
                />
              </div>
              <div>
                <label className={ds.label}>Condition</label>
                <select
                  className={ds.select}
                  value={(formData.condition as string) || 'excellent'}
                  onChange={(e) => setFormData({ ...formData, condition: e.target.value })}
                >
                  {SAMPLE_CONDITIONS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Hazard Classification</label>
                <select
                  className={ds.select}
                  value={(formData.hazardClass as string) || 'none'}
                  onChange={(e) => setFormData({ ...formData, hazardClass: e.target.value })}
                >
                  {HAZARD_CLASSES.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={ds.label}>Collector</label>
                <input
                  className={ds.input}
                  value={(formData.collector as string) || ''}
                  onChange={(e) => setFormData({ ...formData, collector: e.target.value })}
                />
              </div>
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Collection Date</label>
                <input
                  type="date"
                  className={ds.input}
                  value={(formData.collectionDate as string) || ''}
                  onChange={(e) => setFormData({ ...formData, collectionDate: e.target.value })}
                />
              </div>
              <div>
                <label className={ds.label}>Expiration Date</label>
                <input
                  type="date"
                  className={ds.input}
                  value={(formData.expirationDate as string) || ''}
                  onChange={(e) => setFormData({ ...formData, expirationDate: e.target.value })}
                />
              </div>
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Quantity</label>
                <input
                  type="number"
                  className={ds.input}
                  value={(formData.quantity as number) || ''}
                  onChange={(e) =>
                    setFormData({ ...formData, quantity: parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
              <div>
                <label className={ds.label}>Unit</label>
                <input
                  className={ds.input}
                  value={(formData.unit as string) || ''}
                  onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                  placeholder="mL, g, etc."
                />
              </div>
            </div>
            <div>
              <label className={ds.label}>Chain of Custody (comma-separated)</label>
              <input
                className={ds.input}
                value={((formData.chainOfCustody as string[]) || []).join(', ')}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    chainOfCustody: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="Person 1, Person 2..."
              />
            </div>
            <div>
              <label className={ds.label}>Notes</label>
              <textarea
                className={ds.textarea}
                rows={2}
                value={(formData.notes as string) || ''}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              />
            </div>
          </>
        );
      case 'Equipment':
        return (
          <>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Model</label>
                <input
                  className={ds.input}
                  value={(formData.model as string) || ''}
                  onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                />
              </div>
              <div>
                <label className={ds.label}>Serial Number</label>
                <input
                  className={ds.input}
                  value={(formData.serialNumber as string) || ''}
                  onChange={(e) => setFormData({ ...formData, serialNumber: e.target.value })}
                />
              </div>
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Condition</label>
                <select
                  className={ds.select}
                  value={(formData.condition as string) || 'operational'}
                  onChange={(e) => setFormData({ ...formData, condition: e.target.value })}
                >
                  {EQUIPMENT_CONDITIONS.map((c) => (
                    <option key={c} value={c}>
                      {c.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={ds.label}>Location</label>
                <input
                  className={ds.input}
                  value={(formData.location as string) || ''}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                />
              </div>
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Last Calibration</label>
                <input
                  type="date"
                  className={ds.input}
                  value={(formData.calibrationDate as string) || ''}
                  onChange={(e) => setFormData({ ...formData, calibrationDate: e.target.value })}
                />
              </div>
              <div>
                <label className={ds.label}>Next Calibration</label>
                <input
                  type="date"
                  className={ds.input}
                  value={(formData.nextCalibration as string) || ''}
                  onChange={(e) => setFormData({ ...formData, nextCalibration: e.target.value })}
                />
              </div>
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Purchase Date</label>
                <input
                  type="date"
                  className={ds.input}
                  value={(formData.purchaseDate as string) || ''}
                  onChange={(e) => setFormData({ ...formData, purchaseDate: e.target.value })}
                />
              </div>
              <div>
                <label className={ds.label}>Warranty Expiry</label>
                <input
                  type="date"
                  className={ds.input}
                  value={(formData.warrantyExpiry as string) || ''}
                  onChange={(e) => setFormData({ ...formData, warrantyExpiry: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label className={ds.label}>Assigned To</label>
              <input
                className={ds.input}
                value={(formData.assignedTo as string) || ''}
                onChange={(e) => setFormData({ ...formData, assignedTo: e.target.value })}
              />
            </div>
            <div>
              <label className={ds.label}>Maintenance Schedule</label>
              <input
                className={ds.input}
                value={(formData.maintenanceSchedule as string) || ''}
                onChange={(e) => setFormData({ ...formData, maintenanceSchedule: e.target.value })}
                placeholder="e.g. Monthly, Quarterly"
              />
            </div>
          </>
        );
      case 'Analysis':
        return (
          <>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Dataset Name</label>
                <input
                  className={ds.input}
                  value={(formData.datasetName as string) || ''}
                  onChange={(e) => setFormData({ ...formData, datasetName: e.target.value })}
                />
              </div>
              <div>
                <label className={ds.label}>Dataset Size</label>
                <input
                  className={ds.input}
                  value={(formData.datasetSize as string) || ''}
                  onChange={(e) => setFormData({ ...formData, datasetSize: e.target.value })}
                  placeholder="e.g. 10,000 rows"
                />
              </div>
            </div>
            <div className={ds.grid4}>
              <div>
                <label className={ds.label}>Mean</label>
                <input
                  type="number"
                  step="0.001"
                  className={ds.input}
                  value={(formData.mean as number) || ''}
                  onChange={(e) =>
                    setFormData({ ...formData, mean: parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
              <div>
                <label className={ds.label}>Median</label>
                <input
                  type="number"
                  step="0.001"
                  className={ds.input}
                  value={(formData.median as number) || ''}
                  onChange={(e) =>
                    setFormData({ ...formData, median: parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
              <div>
                <label className={ds.label}>Std Dev</label>
                <input
                  type="number"
                  step="0.001"
                  className={ds.input}
                  value={(formData.stdDev as number) || ''}
                  onChange={(e) =>
                    setFormData({ ...formData, stdDev: parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
              <div>
                <label className={ds.label}>N (sample size)</label>
                <input
                  type="number"
                  className={ds.input}
                  value={(formData.sampleN as number) || ''}
                  onChange={(e) =>
                    setFormData({ ...formData, sampleN: parseInt(e.target.value) || 0 })
                  }
                />
              </div>
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>p-Value</label>
                <input
                  className={ds.input}
                  value={(formData.pValue as string) || ''}
                  onChange={(e) => setFormData({ ...formData, pValue: e.target.value })}
                  placeholder="e.g. 0.003"
                />
              </div>
              <div>
                <label className={ds.label}>Confidence Interval</label>
                <input
                  className={ds.input}
                  value={(formData.confidenceInterval as string) || ''}
                  onChange={(e) => setFormData({ ...formData, confidenceInterval: e.target.value })}
                  placeholder="e.g. 95% CI [1.2, 3.4]"
                />
              </div>
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Visualization Type</label>
                <select
                  className={ds.select}
                  value={(formData.vizType as string) || 'bar'}
                  onChange={(e) => setFormData({ ...formData, vizType: e.target.value })}
                >
                  {VIZ_TYPES.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={ds.label}>Software</label>
                <input
                  className={ds.input}
                  value={(formData.software as string) || ''}
                  onChange={(e) => setFormData({ ...formData, software: e.target.value })}
                  placeholder="R, Python, SPSS..."
                />
              </div>
            </div>
            <div>
              <label className={ds.label}>Pipeline Steps (comma-separated)</label>
              <input
                className={ds.input}
                value={((formData.pipelineSteps as string[]) || []).join(', ')}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    pipelineSteps: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="Import, Clean, Transform, Model, Validate"
              />
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Author</label>
                <input
                  className={ds.input}
                  value={(formData.author as string) || ''}
                  onChange={(e) => setFormData({ ...formData, author: e.target.value })}
                />
              </div>
              <div>
                <label className={ds.label}>Start Date</label>
                <input
                  type="date"
                  className={ds.input}
                  value={(formData.startDate as string) || ''}
                  onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label className={ds.label}>Conclusion</label>
              <textarea
                className={ds.textarea}
                rows={3}
                value={(formData.conclusion as string) || ''}
                onChange={(e) => setFormData({ ...formData, conclusion: e.target.value })}
              />
            </div>
          </>
        );
      case 'Protocol':
        return (
          <>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Version</label>
                <input
                  className={ds.input}
                  value={(formData.version as string) || ''}
                  onChange={(e) => setFormData({ ...formData, version: e.target.value })}
                  placeholder="v1.0"
                />
              </div>
              <div>
                <label className={ds.label}>Approval Status</label>
                <select
                  className={ds.select}
                  value={(formData.approvalStatus as string) || 'draft'}
                  onChange={(e) => setFormData({ ...formData, approvalStatus: e.target.value })}
                >
                  {PROTOCOL_APPROVALS.map((a) => (
                    <option key={a} value={a}>
                      {a.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Approved By</label>
                <input
                  className={ds.input}
                  value={(formData.approvedBy as string) || ''}
                  onChange={(e) => setFormData({ ...formData, approvedBy: e.target.value })}
                />
              </div>
              <div>
                <label className={ds.label}>Author</label>
                <input
                  className={ds.input}
                  value={(formData.author as string) || ''}
                  onChange={(e) => setFormData({ ...formData, author: e.target.value })}
                />
              </div>
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Review Date</label>
                <input
                  type="date"
                  className={ds.input}
                  value={(formData.reviewDate as string) || ''}
                  onChange={(e) => setFormData({ ...formData, reviewDate: e.target.value })}
                />
              </div>
              <div>
                <label className={ds.label}>Next Review Date</label>
                <input
                  type="date"
                  className={ds.input}
                  value={(formData.nextReviewDate as string) || ''}
                  onChange={(e) => setFormData({ ...formData, nextReviewDate: e.target.value })}
                />
              </div>
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Safety Level</label>
                <select
                  className={ds.select}
                  value={(formData.safetyLevel as string) || 'BSL-1'}
                  onChange={(e) => setFormData({ ...formData, safetyLevel: e.target.value })}
                >
                  {SAFETY_LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={ds.label}>Duration</label>
                <input
                  className={ds.input}
                  value={(formData.duration as string) || ''}
                  onChange={(e) => setFormData({ ...formData, duration: e.target.value })}
                  placeholder="e.g. 4 hours"
                />
              </div>
            </div>
            <div>
              <label className={ds.label}>Equipment (comma-separated)</label>
              <input
                className={ds.input}
                value={((formData.equipment as string[]) || []).join(', ')}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    equipment: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              />
            </div>
            <div>
              <label className={ds.label}>Steps (one per line)</label>
              <textarea
                className={ds.textarea}
                rows={4}
                value={((formData.steps as string[]) || []).join('\n')}
                onChange={(e) =>
                  setFormData({ ...formData, steps: e.target.value.split('\n').filter(Boolean) })
                }
                placeholder="Step 1: ...\nStep 2: ..."
              />
            </div>
            <div>
              <label className={ds.label}>References (comma-separated)</label>
              <input
                className={ds.input}
                value={((formData.references as string[]) || []).join(', ')}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    references: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              />
            </div>
            <div>
              <label className={ds.label}>Change Log (one per line)</label>
              <textarea
                className={ds.textarea}
                rows={2}
                value={((formData.changeLog as string[]) || []).join('\n')}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    changeLog: e.target.value.split('\n').filter(Boolean),
                  })
                }
                placeholder="v1.0: Initial release\nv1.1: Updated step 3"
              />
            </div>
          </>
        );
      case 'Publication':
        return (
          <>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Journal</label>
                <input
                  className={ds.input}
                  value={(formData.journal as string) || ''}
                  onChange={(e) => setFormData({ ...formData, journal: e.target.value })}
                  placeholder="Nature, Science, etc."
                />
              </div>
              <div>
                <label className={ds.label}>Publication Status</label>
                <select
                  className={ds.select}
                  value={(formData.status as string) || 'draft'}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                >
                  {PUB_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className={ds.label}>Co-Authors (comma-separated)</label>
              <input
                className={ds.input}
                value={((formData.coAuthors as string[]) || []).join(', ')}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    coAuthors: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              />
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Corresponding Author</label>
                <input
                  className={ds.input}
                  value={(formData.correspondingAuthor as string) || ''}
                  onChange={(e) =>
                    setFormData({ ...formData, correspondingAuthor: e.target.value })
                  }
                />
              </div>
              <div>
                <label className={ds.label}>DOI</label>
                <input
                  className={ds.input}
                  value={(formData.doi as string) || ''}
                  onChange={(e) => setFormData({ ...formData, doi: e.target.value })}
                  placeholder="10.xxxx/xxxxx"
                />
              </div>
            </div>
            <div className={ds.grid2}>
              <div>
                <label className={ds.label}>Submission Date</label>
                <input
                  type="date"
                  className={ds.input}
                  value={(formData.submissionDate as string) || ''}
                  onChange={(e) => setFormData({ ...formData, submissionDate: e.target.value })}
                />
              </div>
              <div>
                <label className={ds.label}>Acceptance Date</label>
                <input
                  type="date"
                  className={ds.input}
                  value={(formData.acceptanceDate as string) || ''}
                  onChange={(e) => setFormData({ ...formData, acceptanceDate: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label className={ds.label}>Impact Factor</label>
              <input
                type="number"
                step="0.01"
                className={ds.input}
                value={(formData.impactFactor as number) || ''}
                onChange={(e) =>
                  setFormData({ ...formData, impactFactor: parseFloat(e.target.value) || 0 })
                }
              />
            </div>
            <div>
              <label className={ds.label}>Abstract</label>
              <textarea
                className={ds.textarea}
                rows={4}
                value={(formData.abstract as string) || ''}
                onChange={(e) => setFormData({ ...formData, abstract: e.target.value })}
              />
            </div>
            <div>
              <label className={ds.label}>Keywords (comma-separated)</label>
              <input
                className={ds.input}
                value={((formData.keywords as string[]) || []).join(', ')}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    keywords: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              />
            </div>
            <div>
              <label className={ds.label}>Funding Acknowledgement</label>
              <input
                className={ds.input}
                value={(formData.fundingAck as string) || ''}
                onChange={(e) => setFormData({ ...formData, fundingAck: e.target.value })}
              />
            </div>
          </>
        );
      default:
        return null;
    }
}


function renderCard(
  item: LensItem<ArtifactDataUnion>,
  opts: {
    currentType: ArtifactType;
    openEdit: (item: LensItem<ArtifactDataUnion>) => void;
    handleDelete: (id: string) => void;
  },
) {
  const { currentType, openEdit, handleDelete } = opts;
    const d = item.data as unknown as Record<string, unknown>;
    return (
      <div key={item.id} className={ds.panelHover}>
        <div className={ds.sectionHeader}>
          <h3 className={cn(ds.heading3, 'line-clamp-1')}>{item.title}</h3>
          {statusBadge(item.meta.status)}
        </div>

        <div className="mt-2 space-y-1">
          {/* Experiment card */}
          {currentType === 'Experiment' && (
            <>
              {Boolean(d.hypothesis) && (
                <p className={cn(ds.textMuted, 'line-clamp-2')}>
                  <Eye className="w-3 h-3 inline mr-1" />
                  {d.hypothesis as string}
                </p>
              )}
              {Boolean(d.pi) && <p className={ds.textMuted}>PI: {d.pi as string}</p>}
              <div className="flex items-center gap-2 flex-wrap mt-1">
                {Boolean(d.reproducibility) && statusBadge(d.reproducibility as string)}
                {Boolean(d.fundingSource) && (
                  <span className={ds.badge('blue-400')}>{d.fundingSource as string}</span>
                )}
              </div>
              {Boolean(d.startDate) && (
                <p className={cn(ds.textMono, 'text-gray-400 text-xs')}>
                  {d.startDate as string} to {(d.endDate as string) || 'ongoing'}
                </p>
              )}
              {Boolean(d.conclusions) && (
                <p className={cn(ds.textMuted, 'line-clamp-2 mt-1 italic')}>
                  {d.conclusions as string}
                </p>
              )}
              {(d.tags as string[])?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {(d.tags as string[]).map((tag) => (
                    <span key={tag} className={ds.badge('gray-400')}>
                      <Hash className="w-2.5 h-2.5" />
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Sample card */}
          {currentType === 'Sample' && (
            <>
              <p className={cn(ds.textMono, 'text-gray-400')}>{d.sampleId as string}</p>
              <p className={ds.textMuted}>
                {d.type as string} | {d.storageLocation as string}
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                {Boolean(d.condition) && statusBadge(d.condition as string)}
                {Boolean(d.hazardClass) && (d.hazardClass as string) !== 'none' && (
                  <span className={cn(ds.badge('red-400'), 'flex items-center gap-1')}>
                    <AlertTriangle className="w-3 h-3" />
                    {d.hazardClass as string}
                  </span>
                )}
              </div>
              <p className={ds.textMuted}>
                {d.quantity as number} {d.unit as string} | Collected: {d.collectionDate as string}
              </p>
              {(d.chainOfCustody as string[])?.length > 0 && (
                <p className={cn(ds.textMuted, 'text-xs')}>
                  Custody: {(d.chainOfCustody as string[]).join(' -> ')}
                </p>
              )}
            </>
          )}

          {/* Equipment card */}
          {currentType === 'Equipment' && (
            <>
              <p className={ds.textMuted}>
                {d.model as string} | SN: {d.serialNumber as string}
              </p>
              <div className="flex items-center gap-2">
                {Boolean(d.condition) && statusBadge(d.condition as string)}
              </div>
              <p className={ds.textMuted}>Location: {d.location as string}</p>
              <p className={ds.textMuted}>Assigned: {d.assignedTo as string}</p>
              <p className={cn(ds.textMono, 'text-gray-400 text-xs')}>
                Cal: {d.calibrationDate as string} | Next: {d.nextCalibration as string}
              </p>
              {Boolean(d.maintenanceSchedule) && (
                <p className={ds.textMuted}>Maint: {d.maintenanceSchedule as string}</p>
              )}
            </>
          )}

          {/* Analysis card */}
          {currentType === 'Analysis' && (
            <>
              <p className={ds.textMuted}>
                Dataset: {d.datasetName as string} ({d.datasetSize as string})
              </p>
              <div className={cn(ds.panel, 'mt-2 p-2 space-y-1')}>
                <p className={cn(ds.textMono, 'text-xs text-gray-300')}>
                  Mean: {d.mean as number} | Median: {d.median as number}
                </p>
                <p className={cn(ds.textMono, 'text-xs text-gray-300')}>
                  SD: {d.stdDev as number} | N: {d.sampleN as number}
                </p>
                {Boolean(d.pValue) && (
                  <p className={cn(ds.textMono, 'text-xs text-green-400')}>
                    p = {d.pValue as string}
                  </p>
                )}
                {Boolean(d.confidenceInterval) && (
                  <p className={cn(ds.textMono, 'text-xs text-gray-400')}>
                    {d.confidenceInterval as string}
                  </p>
                )}
              </div>
              {Boolean(d.vizType) && (
                <span className={ds.badge('neon-cyan')}>
                  <PieChart className="w-3 h-3" />
                  {d.vizType as string}
                </span>
              )}
              <p className={ds.textMuted}>
                {d.software as string} | {d.author as string}
              </p>
              {(d.pipelineSteps as string[])?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {(d.pipelineSteps as string[]).map((step, i) => (
                    <span key={i} className={ds.badge('blue-400')}>
                      {i + 1}. {step}
                    </span>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Protocol card */}
          {currentType === 'Protocol' && (
            <>
              <div className="flex items-center gap-2">
                <span className={ds.badge('neon-blue')}>v{d.version as string}</span>
                {Boolean(d.approvalStatus) && statusBadge(d.approvalStatus as string)}
                {Boolean(d.safetyLevel) && (
                  <span className={ds.badge('orange-400')}>{d.safetyLevel as string}</span>
                )}
              </div>
              <p className={ds.textMuted}>
                Author: {d.author as string} | Duration: {d.duration as string}
              </p>
              {Boolean(d.approvedBy) && (
                <p className={ds.textMuted}>Approved by: {d.approvedBy as string}</p>
              )}
              <p className={cn(ds.textMono, 'text-xs text-gray-400')}>
                Review: {d.reviewDate as string} | Next: {d.nextReviewDate as string}
              </p>
              {(d.equipment as string[])?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {(d.equipment as string[]).map((eq) => (
                    <span key={eq} className={ds.badge('neon-cyan')}>
                      {eq}
                    </span>
                  ))}
                </div>
              )}
              {(d.steps as string[])?.length > 0 && (
                <p className={cn(ds.textMuted, 'text-xs')}>
                  {(d.steps as string[]).length} steps defined
                </p>
              )}
            </>
          )}

          {/* Publication card */}
          {currentType === 'Publication' && (
            <>
              <p className={cn(ds.textMuted, 'font-medium')}>{d.journal as string}</p>
              <div className="flex items-center gap-2">
                {Boolean(d.status) && statusBadge(d.status as string)}
                {(d.impactFactor as number) > 0 && (
                  <span className={ds.badge('yellow-400')}>IF: {d.impactFactor as number}</span>
                )}
              </div>
              {(d.coAuthors as string[])?.length > 0 && (
                <p className={cn(ds.textMuted, 'text-xs')}>
                  <Users className="w-3 h-3 inline mr-1" />
                  {(d.coAuthors as string[]).join(', ')}
                </p>
              )}
              {Boolean(d.doi) && (
                <p className={cn(ds.textMono, 'text-xs text-neon-cyan')}>DOI: {d.doi as string}</p>
              )}
              {Boolean(d.abstract) && (
                <p className={cn(ds.textMuted, 'line-clamp-2 text-xs italic mt-1')}>
                  {d.abstract as string}
                </p>
              )}
              {(d.keywords as string[])?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {(d.keywords as string[]).map((kw) => (
                    <span key={kw} className={ds.badge('gray-400')}>
                      {kw}
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="mt-3 flex items-center gap-2 pt-2 border-t border-lattice-border">
          <button className={cn(ds.btnGhost, ds.btnSmall)} onClick={() => openEdit(item)}>
            <Edit3 className="w-3.5 h-3.5" /> Edit
          </button>
          <button className={cn(ds.btnDanger, ds.btnSmall)} onClick={() => handleDelete(item.id)}>
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </button>
        </div>
      </div>
    );
  }

export function ArtifactsPanel({ artifactType }: { artifactType: ArtifactType }) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  useLensCommand(
    [
      { id: 'focus-search', keys: '/', description: 'Focus search', category: 'navigation', action: () => searchInputRef.current?.focus() },
    ],
    { lensId: 'science' },
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showEditor, setShowEditor] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formTitle, setFormTitle] = useState('');
  const [formStatus, setFormStatus] = useState<string>('planned');
  const [formData, setFormData] = useState<Record<string, unknown>>({});

  const currentType = artifactType;
  const { items, isLoading, isError, error, refetch, create, update, remove } =
    useLensData<ArtifactDataUnion>('science', currentType, { seed: [] });

  const filtered = useMemo(() => {
    let list = items;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter((i) => i.title.toLowerCase().includes(q));
    }
    if (statusFilter !== 'all') {
      list = list.filter((i) => i.meta.status === statusFilter);
    }
    return list;
  }, [items, searchQuery, statusFilter]);

  const openNew = () => {
    setEditingId(null);
    setFormTitle('');
    setFormStatus(getStatusesForArtifact(currentType)[0] || 'planned');
    setFormData({});
    setShowEditor(true);
  };

  const openEdit = (item: LensItem<ArtifactDataUnion>) => {
    setEditingId(item.id);
    setFormTitle(item.title);
    setFormStatus((item.meta.status as string) || 'planned');
    setFormData(item.data as unknown as Record<string, unknown>);
    setShowEditor(true);
  };

  const handleSave = async () => {
    const payload = { title: formTitle, data: formData, meta: { status: formStatus } };
    if (editingId) {
      await update(editingId, payload);
    } else {
      await create(payload);
    }
    setShowEditor(false);
  };

  const handleDelete = async (id: string) => {
    await remove(id);
  };

  const exportCSV = () => {
    const headers = ['Title', 'Status', 'Created'];
    const rows = items.map((i) => [i.title, i.meta.status, i.createdAt]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `science-${currentType.toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-neon-purple" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center py-20">
        <ErrorState error={error?.message} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap flex-1">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              ref={searchInputRef}
              className={cn(ds.input, 'pl-10')}
              placeholder={`Search ${currentType.toLowerCase()}s...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-1">
            <Filter className="w-4 h-4 text-gray-400" />
            <select
              className={cn(ds.select, 'w-auto')}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">All Statuses</option>
              {getStatusesForArtifact(currentType).map((s) => (
                <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className={ds.btnGhost} onClick={exportCSV} title="Export CSV">
            <Download className="w-4 h-4" />
          </button>
          <button type="button" className={ds.btnPrimary} onClick={openNew}>
            <Plus className="w-4 h-4" /> New {currentType}
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-20">
          <FlaskConical className="w-12 h-12 text-gray-600 mx-auto mb-3" />
          <p className={ds.heading3}>No {currentType}s found</p>
          <p className={ds.textMuted}>Create one to get started.</p>
          <button type="button" className={cn(ds.btnPrimary, 'mt-4')} onClick={openNew}>
            <Plus className="w-4 h-4" /> Add {currentType}
          </button>
        </div>
      ) : (
        <div className={ds.grid3}>
          {filtered.map((item) => renderCard(item, { currentType, openEdit, handleDelete }))}
        </div>
      )}

      {showEditor && (
        <div
          className={ds.modalBackdrop}
          onClick={() => setShowEditor(false)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              (e.currentTarget as HTMLElement).click();
            }
          }}
        >
          <div className={ds.modalContainer}>
            <div
              className={cn(ds.modalPanel, 'max-w-2xl max-h-[85vh] overflow-hidden flex flex-col')}
              onClick={(e) => e.stopPropagation()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  (e.currentTarget as HTMLElement).click();
                }
              }}
            >
              <div className="p-6 border-b border-lattice-border">
                <div className={ds.sectionHeader}>
                  <h2 className={ds.heading2}>
                    {editingId ? 'Edit' : 'New'} {currentType}
                  </h2>
                  <button type="button" className={ds.btnGhost} onClick={() => setShowEditor(false)} aria-label="Close">
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>
              <div className="p-6 space-y-4 overflow-y-auto flex-1">
                <div>
                  <label className={ds.label}>Title</label>
                  <input
                    className={ds.input}
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    placeholder="Artifact title..."
                  />
                </div>
                <div>
                  <label className={ds.label}>Status</label>
                  <select
                    className={ds.select}
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value)}
                  >
                    {getStatusesForArtifact(currentType).map((s) => (
                      <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                    ))}
                  </select>
                </div>
                {renderFormFields(currentType, formData, setFormData)}
              </div>
              <div className="p-6 border-t border-lattice-border flex items-center justify-end gap-3">
                <button type="button" className={ds.btnSecondary} onClick={() => setShowEditor(false)}>
                  Cancel
                </button>
                <button type="button" className={ds.btnPrimary} onClick={handleSave} disabled={!formTitle.trim()}>
                  <CheckCircle2 className="w-4 h-4" /> {editingId ? 'Update' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ArtifactsPanel;
