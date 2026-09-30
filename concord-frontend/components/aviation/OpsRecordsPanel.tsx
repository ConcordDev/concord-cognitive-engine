'use client';

import { useCallback, useState } from 'react';
import { Clipboard, CloudRain, Shield, Timer, AlertTriangle, Calculator, ShieldCheck } from 'lucide-react';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { useLensData, LensItem } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { showToast } from '@/components/common/Toasts';
import { ArtifactBench } from './ArtifactBench';
import {
  OpsKind, getTypeForKind, getStatusesForKind, computeWbTotals, type FormFields,
} from './aviation-ops';
import {
  FlightCard, PilotCard, AircraftOpsCard, MaintenanceCard, CharterCard,
  WeightBalanceCard, WeatherOpsCard,
} from './aviation-cards';
import {
  FlightEditor, PilotEditor, AircraftOpsEditor, MaintenanceEditor, CharterEditor,
  WeightBalanceEditor, WeatherOpsEditor,
} from './aviation-editors';

const KIND_LABEL: Record<OpsKind, string> = {
  flights: 'Flights',
  pilots: 'Pilots',
  fleet: 'Fleet',
  maintenance: 'Maintenance',
  charter: 'Charter',
  wb: 'Weight & Balance',
  weather: 'Weather',
};

export function OpsRecordsPanel({ kind }: { kind: OpsKind }) {
  const type = getTypeForKind(kind);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showEditor, setShowEditor] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormFields>({});
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);

  const query = useLensData('aviation', type, {
    search: searchQuery || undefined,
    status: statusesEnabled(kind) ? (statusFilter || undefined) : undefined,
  });
  const { items, create, update, remove, isLoading, isError, error, refetch } = query;
  const runAction = useRunArtifact('aviation');

  const setField = useCallback((key: string, value: unknown) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const resetForm = useCallback(() => {
    setForm({});
    setEditingId(null);
    setShowEditor(false);
  }, []);

  const openNew = useCallback(() => {
    setForm({});
    setEditingId(null);
    setShowEditor(true);
  }, []);

  const openEdit = useCallback((item: LensItem) => {
    setEditingId(item.id);
    const d = item.data as Record<string, unknown>;
    setForm({ ...d, _title: item.title, _status: item.meta?.status || '' });
    setShowEditor(true);
  }, []);

  const handleAction = async (action: string, artifactId?: string) => {
    const targetId = artifactId || editingId || items[0]?.id;
    if (!targetId) return;
    try {
      const result = await runAction.mutateAsync({ id: targetId, action });
      if (result.ok === false) {
        setActionResult({ message: `Action failed: ${(result as Record<string, unknown>).error || 'Unknown error'}` });
      } else {
        setActionResult(result.result as Record<string, unknown>);
      }
    } catch (err) {
      console.error('Action failed:', err);
      showToast('error', 'Action failed');
    }
  };

  const handleSave = async () => {
    let data = { ...form };
    const title = (data._title as string) || `New ${type}`;
    const status = (data._status as string) || defaultStatus(kind);
    delete data._title;
    delete data._status;
    if (kind === 'wb') {
      data = { ...data, ...computeWbTotals(form) };
    }
    if (editingId) {
      await update(editingId, {
        title,
        data: data as Record<string, unknown>,
        meta: { status },
      });
    } else {
      await create({
        title,
        data: data as Record<string, unknown>,
        meta: { status, tags: [] },
      });
    }
    resetForm();
  };

  const handleDelete = async () => {
    if (!editingId) return;
    await remove(editingId);
    resetForm();
  };

  return (
    <ArtifactBench
      label={KIND_LABEL[kind]}
      typeLabel={type}
      statuses={getStatusesForKind(kind)}
      items={items}
      isLoading={isLoading}
      isError={isError}
      error={error as Error | null}
      refetch={refetch}
      searchQuery={searchQuery}
      setSearchQuery={setSearchQuery}
      statusFilter={statusFilter}
      setStatusFilter={setStatusFilter}
      onNew={openNew}
      pending={runAction.isPending}
      actionButtons={<KindActions kind={kind} onAction={handleAction} />}
      actionResult={actionResult}
      onClearResult={() => setActionResult(null)}
      showEditor={showEditor}
      editingId={editingId}
      onCloseEditor={resetForm}
      onSave={handleSave}
      onDelete={handleDelete}
      editor={<KindEditor kind={kind} form={form} setField={setField} />}
      editorActions={editingId ? <KindEditorActions kind={kind} onAction={(a) => handleAction(a, editingId)} /> : null}
      renderCard={(item) => <KindCard kind={kind} item={item} onOpen={openEdit} />}
    />
  );
}

function statusesEnabled(kind: OpsKind) {
  return getStatusesForKind(kind).length > 0;
}

function defaultStatus(kind: OpsKind): string {
  switch (kind) {
    case 'flights': return 'planned';
    case 'fleet': return 'airworthy';
    case 'maintenance': return 'unscheduled';
    case 'charter': return 'inquiry';
    case 'weather': return 'VFR';
    default: return 'planned';
  }
}

function KindCard({ kind, item, onOpen }: { kind: OpsKind; item: LensItem; onOpen: (item: LensItem) => void }) {
  switch (kind) {
    case 'flights': return <FlightCard item={item} onOpen={onOpen} />;
    case 'pilots': return <PilotCard item={item} onOpen={onOpen} />;
    case 'fleet': return <AircraftOpsCard item={item} onOpen={onOpen} />;
    case 'maintenance': return <MaintenanceCard item={item} onOpen={onOpen} />;
    case 'charter': return <CharterCard item={item} onOpen={onOpen} />;
    case 'wb': return <WeightBalanceCard item={item} onOpen={onOpen} />;
    case 'weather': return <WeatherOpsCard item={item} onOpen={onOpen} />;
  }
}

function KindEditor({ kind, form, setField }: { kind: OpsKind; form: FormFields; setField: (k: string, v: unknown) => void }) {
  switch (kind) {
    case 'flights': return <FlightEditor form={form} setField={setField} />;
    case 'pilots': return <PilotEditor form={form} setField={setField} />;
    case 'fleet': return <AircraftOpsEditor form={form} setField={setField} />;
    case 'maintenance': return <MaintenanceEditor form={form} setField={setField} />;
    case 'charter': return <CharterEditor form={form} setField={setField} />;
    case 'wb': return <WeightBalanceEditor form={form} setField={setField} />;
    case 'weather': return <WeatherOpsEditor form={form} setField={setField} />;
  }
}

function KindActions({ kind, onAction }: { kind: OpsKind; onAction: (action: string) => void }) {
  const btn = cn(ds.btnGhost, ds.btnSmall);
  switch (kind) {
    case 'flights':
      return (
        <>
          <button type="button" onClick={() => onAction('flightSummary')} className={btn}><Clipboard className="w-3 h-3" /> Flight Summary</button>
          <button type="button" onClick={() => onAction('weatherCheck')} className={btn}><CloudRain className="w-3 h-3" /> Weather Check</button>
        </>
      );
    case 'pilots':
      return (
        <>
          <button type="button" onClick={() => onAction('currencyCheck')} className={btn}><Shield className="w-3 h-3" /> Currency Check</button>
          <button type="button" onClick={() => onAction('dutyTimeCheck')} className={btn}><Timer className="w-3 h-3" /> Duty Time Check</button>
        </>
      );
    case 'fleet':
      return (
        <button type="button" onClick={() => onAction('maintenanceAlert')} className={btn}><AlertTriangle className="w-3 h-3" /> Maintenance Alert</button>
      );
    case 'maintenance':
      return (
        <button type="button" onClick={() => onAction('maintenanceAlert')} className={btn}><AlertTriangle className="w-3 h-3" /> Check ADs</button>
      );
    case 'wb':
      return (
        <>
          <button type="button" onClick={() => onAction('calculate-wb')} className={btn}><Calculator className="w-3 h-3" /> W&B Calculate</button>
          <button type="button" onClick={() => onAction('validate-wb')} className={btn}><ShieldCheck className="w-3 h-3" /> W&B Validate</button>
        </>
      );
    case 'weather':
      return (
        <>
          <button type="button" onClick={() => onAction('weatherCheck')} className={btn}><CloudRain className="w-3 h-3" /> Refresh Weather</button>
          <button type="button" onClick={() => onAction('flightSummary')} className={btn}><Clipboard className="w-3 h-3" /> Weather Summary</button>
        </>
      );
    default:
      return null;
  }
}

function KindEditorActions({ kind, onAction }: { kind: OpsKind; onAction: (action: string) => void }) {
  switch (kind) {
    case 'flights':
      return (
        <button type="button" onClick={() => onAction('flightSummary')} className={ds.btnSecondary}>
          <Clipboard className="w-4 h-4" /> Summary
        </button>
      );
    case 'pilots':
      return (
        <button type="button" onClick={() => onAction('currencyCheck')} className={ds.btnSecondary}>
          <Shield className="w-4 h-4" /> Check Currency
        </button>
      );
    case 'wb':
      return (
        <>
          <button type="button" onClick={() => onAction('calculate-wb')} className={ds.btnSecondary}>
            <Calculator className="w-4 h-4" /> Calculate
          </button>
          <button type="button" onClick={() => onAction('validate-wb')} className={ds.btnSecondary}>
            <ShieldCheck className="w-4 h-4" /> Validate
          </button>
        </>
      );
    case 'weather':
      return (
        <button type="button" onClick={() => onAction('weatherCheck')} className={ds.btnSecondary}>
          <CloudRain className="w-4 h-4" /> Refresh
        </button>
      );
    default:
      return null;
  }
}

export default OpsRecordsPanel;
