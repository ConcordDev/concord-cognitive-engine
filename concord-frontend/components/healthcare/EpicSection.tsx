'use client';

import { useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { EpicShell, EpicNav } from './EpicShell';
import { EpicAskBar } from './EpicAskBar';
import { HealthcareDashboard } from './HealthcareDashboard';
import { PatientsPanel } from './PatientsPanel';
import { PatientChartPanel } from './PatientChartPanel';
import { EncountersPanel } from './EncountersPanel';
import { OrdersPanel } from './OrdersPanel';
import { CareManagementPanel } from './CareManagementPanel';
import { AIScribePanel } from './AIScribePanel';
import { InboxPanel } from './InboxPanel';
import { RefillsPanel } from './RefillsPanel';
import { SmartPhrasesPanel } from './SmartPhrasesPanel';
import { CodeLookup } from './CodeLookup';
import { TelehealthPanel } from './TelehealthPanel';
import { ResultsReleasePanel } from './ResultsReleasePanel';
import { DeviceDataPanel } from './DeviceDataPanel';
import { InsurancePanel } from './InsurancePanel';
import { RecordSharingPanel } from './RecordSharingPanel';
import { CdsOrderCheckPanel } from './CdsOrderCheckPanel';
import { ProtocolsPanel } from './ProtocolsPanel';
import AppointmentScheduler from './AppointmentScheduler';
import { ClinicalArtifactsPanel } from './ClinicalArtifactsPanel';
import { ImmunizationsPanel } from './ImmunizationsPanel';
import { HealthcareActionPanel } from './HealthcareActionPanel';
import { PipingProvider } from '@/components/panel-polish';

interface Patient { id: string; firstName: string; lastName: string; mrn: string }

export interface EpicSectionProps {
  activeNav?: EpicNav;
  onNavChange?: (n: EpicNav) => void;
}

export function EpicSection({ activeNav, onNavChange }: EpicSectionProps = {} as EpicSectionProps) {
  const [internalNav, setInternalNav] = useState<EpicNav>('dashboard');
  const nav = activeNav ?? internalNav;
  const setNav = onNavChange ?? setInternalNav;
  const [patientId, setPatientId] = useState<string | null>(null);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [badges, setBadges] = useState<Partial<Record<EpicNav, number>>>({});

  useEffect(() => { refreshBadges(); }, [nav]);
  useEffect(() => {
    let cancelled = false;
    if (!patientId) { setPatient(null); return; }
    lensRun({ domain: 'healthcare', action: 'patients-detail', input: { id: patientId } })
      .then(r => { if (!cancelled) setPatient((r.data?.result?.patient || null) as Patient | null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [patientId]);

  async function refreshBadges() {
    try {
      const r = await lensRun({ domain: 'healthcare', action: 'dashboard-summary', input: {} });
      const d = r.data?.result;
      if (d) {
        setBadges({
          patients: d.patientCount || 0,
          inbox: d.inboxUnread || 0,
          refills: d.pendingRefills || 0,
          encounters: d.unsignedNotes || 0,
        });
      }
    } catch {}
  }

  function selectPatient(id: string) {
    setPatientId(id);
    setNav('chart');
  }

  return (
    <EpicShell
      activeNav={nav}
      onNavChange={setNav}
      badges={badges}
      askBar={<EpicAskBar patientId={patientId} />}
    >
      {nav === 'dashboard'    && <HealthcareDashboard onJumpTo={(n) => setNav(n)} />}
      {nav === 'patients'     && <PatientsPanel onSelect={selectPatient} />}
      {nav === 'chart'        && (patientId ? <PatientChartPanel patientId={patientId} /> : <NoPatient onJump={() => setNav('patients')} />)}
      {nav === 'orders'       && (patientId ? <OrdersPanel patientId={patientId} /> : <NoPatient onJump={() => setNav('patients')} />)}
      {nav === 'cds'          && (patientId ? <CdsOrderCheckPanel patientId={patientId} /> : <NoPatient onJump={() => setNav('patients')} />)}
      {nav === 'protocols'    && <ProtocolsPanel patientId={patientId} />}
      {nav === 'care'         && (patientId ? <CareManagementPanel patientId={patientId} /> : <NoPatient onJump={() => setNav('patients')} />)}
      {nav === 'encounters'   && (patientId ? <EncountersPanel patientId={patientId} /> : <NoPatient onJump={() => setNav('patients')} />)}
      {nav === 'schedule'     && <AppointmentScheduler />}
      {nav === 'telehealth'   && (patientId ? <TelehealthPanel patientId={patientId} /> : <NoPatient onJump={() => setNav('patients')} />)}
      {nav === 'results'      && (patientId ? <ResultsReleasePanel patientId={patientId} /> : <NoPatient onJump={() => setNav('patients')} />)}
      {nav === 'devices'      && (patientId ? <DeviceDataPanel patientId={patientId} /> : <NoPatient onJump={() => setNav('patients')} />)}
      {nav === 'insurance'    && (patientId ? <InsurancePanel patientId={patientId} /> : <NoPatient onJump={() => setNav('patients')} />)}
      {nav === 'sharing'      && (patientId ? <RecordSharingPanel patientId={patientId} /> : <NoPatient onJump={() => setNav('patients')} />)}
      {nav === 'inbox'        && <InboxPanel />}
      {nav === 'refills'      && <RefillsPanel />}
      {nav === 'scribe'       && <AIScribePanel patient={patient} encounter={null} />}
      {nav === 'smartphrases' && <SmartPhrasesPanel />}
      {nav === 'codes'        && <CodeLookup />}
      {nav === 'reports'      && (
        <div className="p-6 text-center text-sm text-gray-400 bg-black/30 border border-white/10 rounded">
          Headline metrics live on the Dashboard tab. Per-patient detail (problem-list / labs / vitals / encounters with abnormal-flag rollup) is in <button onClick={() => setNav('patients')} className="underline text-cyan-300">Patients → Chart</button>.
        </div>
      )}
      {nav === 'artifacts'     && <ClinicalArtifactsPanel />}
      {nav === 'immunizations' && (
        <PipingProvider>
          <ImmunizationsPanel />
        </PipingProvider>
      )}
      {nav === 'actions'      && (
        <PipingProvider>
          <HealthcareActionPanel />
        </PipingProvider>
      )}
    </EpicShell>
  );
}

function NoPatient({ onJump }: { onJump: () => void }) {
  return (
    <div className="p-10 text-center text-sm text-gray-400 bg-black/30 border border-white/10 rounded">
      Pick a patient first. <button onClick={onJump} className="underline text-cyan-300">Open Patients →</button>
    </div>
  );
}

export default EpicSection;
