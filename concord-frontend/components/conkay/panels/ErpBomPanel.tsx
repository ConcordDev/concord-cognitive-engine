'use client';

/**
 * ERP-class BOM panel for ConKay.
 * Part numbers, revisions, qty, material, mass/volume, vendor stubs, CSV+JSON, rollup.
 * Honesty: ERP-shaped BOM export LIVE — NOT SAP/Oracle integration.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createAssembly,
  downloadErpBomCsv,
  downloadErpBomJson,
  fetchErpBom,
} from '@/lib/conkay/assembly-to-world';
import { mintConkayArtifactDtu } from '@/lib/conkay/mint-artifact-dtu';

type ErpLine = {
  partNumber?: string;
  revision?: string;
  name?: string;
  partId?: string;
  kind?: string;
  qty?: number;
  material?: string;
  materialName?: string;
  volumeM3?: number | null;
  massKg?: number | null;
  volumeSource?: string;
  vendorId?: string;
  vendorName?: string;
  leadTimeDays?: number;
  unitCostUsd?: number | null;
  extendedCostUsd?: number | null;
  triangleCount?: number | null;
};

type ErpBom = {
  ok?: boolean;
  assemblyId?: string;
  assemblyName?: string;
  totalParts?: number;
  lines?: ErpLine[];
  rollup?: {
    totalMassKg?: number | null;
    materialCostUsd?: number;
    overheadPct?: number;
    overheadUsd?: number;
    rollupCostUsd?: number;
    currency?: string;
  };
  honesty?: { note?: string; not?: string; status?: string };
  reason?: string;
  error?: string;
};

function readStoredAssemblyId(): string {
  try {
    return String(sessionStorage.getItem('conkay.assemblyId') || '');
  } catch {
    return '';
  }
}

function fmt(n: number | null | undefined, digits = 4): string {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return Number(n).toFixed(digits);
}

export function ErpBomPanel() {
  const [assemblyId, setAssemblyId] = useState('');
  const [bom, setBom] = useState<ErpBom | null>(null);
  const [status, setStatus] = useState('Idle — load ERP BOM for an assembly');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [loadMs, setLoadMs] = useState<number | null>(null);
  const [sortKey, setSortKey] = useState<'partNumber' | 'qty' | 'massKg' | 'extendedCostUsd'>('partNumber');

  const load = useCallback(async (aid?: string) => {
    const id = (aid ?? assemblyId).trim();
    if (!id) {
      setStatus('Enter an assemblyId (or create one via Feature Tree / Assembly toolbar)');
      return;
    }
    setBusy(true);
    const t0 = Date.now();
    setStatus('Loading ERP BOM…');
    try {
      const data = (await fetchErpBom(id)) as ErpBom;
      const elapsed = Date.now() - t0;
      setLoadMs(elapsed);
      if (!data?.ok) {
        setBom(null);
        setSelectedIdx(null);
        setStatus(`ERP BOM failed — ${data?.reason || data?.error || 'unknown'} (${elapsed}ms)`);
        return;
      }
      setBom(data);
      setSelectedIdx(null);
      setStatus(
        `ERP BOM LIVE — ${data.totalParts ?? data.lines?.length ?? 0} parts · rollup $${fmt(data.rollup?.rollupCostUsd, 2)} · ${elapsed}ms (not SAP/Oracle)`,
      );
      void mintConkayArtifactDtu({
        title: 'ERP BOM load',
        work: {
          action: 'erp_bom_load',
          channel: 'cad',
          assemblyId: id,
          totalParts: data.totalParts ?? null,
          rollupCostUsd: data.rollup?.rollupCostUsd ?? null,
          lines: (data.lines || []).slice(0, 12).map((l) => ({
            partNumber: l.partNumber,
            revision: l.revision,
            qty: l.qty,
            material: l.material,
            massKg: l.massKg,
          })),
        },
        tags: ['erp-bom'],
      });
    } catch (e) {
      setStatus(`ERP BOM failed — ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [assemblyId]);

  useEffect(() => {
    const aid = readStoredAssemblyId();
    if (aid) {
      setAssemblyId(aid);
      void load(aid);
    }
    const onAsm = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.assemblyId) {
        const id = String(detail.assemblyId);
        setAssemblyId(id);
        void load(id);
      }
    };
    window.addEventListener('conkay:assembly', onAsm as EventListener);
    return () => window.removeEventListener('conkay:assembly', onAsm as EventListener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ensureAssembly = async () => {
    setBusy(true);
    try {
      const created = await createAssembly('erp-bom-panel');
      const id = created?.assembly?.id || created?.id;
      if (!id) {
        setStatus(`Create assembly failed — ${created?.error || 'unknown'}`);
        return;
      }
      setAssemblyId(id);
      try {
        sessionStorage.setItem('conkay.assemblyId', id);
        window.dispatchEvent(new CustomEvent('conkay:assembly', { detail: { assemblyId: id } }));
      } catch {
        /* ignore */
      }
      setStatus(`Assembly created ${String(id).slice(0, 8)}… — add parts then Reload`);
    } finally {
      setBusy(false);
    }
  };

  const exportJson = async () => {
    if (!assemblyId) return;
    setBusy(true);
    try {
      const r = await downloadErpBomJson(assemblyId);
      if (!r.ok) {
        setStatus(`JSON export failed — ${r.error}`);
        return;
      }
      setStatus(`ERP BOM JSON download LIVE — ${r.filename}`);
      void mintConkayArtifactDtu({
        title: 'ERP BOM JSON export',
        work: { action: 'erp_bom_json', channel: 'cad', assemblyId, filename: r.filename },
        tags: ['erp-bom', 'export'],
      });
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = async () => {
    if (!assemblyId) return;
    setBusy(true);
    try {
      const r = await downloadErpBomCsv(assemblyId);
      if (!r.ok) {
        setStatus(`CSV export failed — ${(r as { error?: string }).error || 'unknown'}`);
        return;
      }
      setStatus(`ERP BOM CSV download LIVE — ${r.filename} (${r.size} bytes)`);
      void mintConkayArtifactDtu({
        title: 'ERP BOM CSV export',
        work: {
          action: 'erp_bom_csv',
          channel: 'cad',
          assemblyId,
          filename: r.filename,
          size: r.size,
        },
        tags: ['erp-bom', 'export', 'csv'],
      });
    } finally {
      setBusy(false);
    }
  };

  const lines = useMemo(() => {
    const raw = bom?.lines || [];
    const q = filter.trim().toLowerCase();
    let list = !q
      ? raw
      : raw.filter((l) => {
          const hay = `${l.partNumber || ''} ${l.name || ''} ${l.material || ''} ${l.vendorId || ''}`.toLowerCase();
          return hay.includes(q);
        });
    const sorted = [...list].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === 'string' || typeof bv === 'string') {
        return String(av || '').localeCompare(String(bv || ''));
      }
      return (Number(av) || 0) - (Number(bv) || 0);
    });
    return sorted;
  }, [bom?.lines, filter, sortKey]);

  const selected = selectedIdx != null ? lines[selectedIdx] : null;

  return (
    <div
      data-testid="ck-erp-bom-panel"
      className="mx-auto mt-2 max-w-2xl rounded-xl border border-cyan-400/15 bg-black/30 p-3 text-[11px] text-white/80"
    >
      <div className="flex items-center justify-between gap-2 px-1 pb-2">
        <div className="text-[10px] uppercase tracking-wide text-cyan-300/60">ERP BOM</div>
        <div className="text-[9px] text-white/35" data-testid="ck-erp-bom-honesty">
          ERP-shaped export LIVE — not SAP/Oracle
        </div>
      </div>

      <div className="mb-2 grid grid-cols-[1fr_auto_auto_auto_auto] gap-1">
        <input
          data-testid="ck-erp-bom-assembly-id"
          className="rounded border border-white/10 bg-black/40 px-2 py-1 font-mono text-[10px] text-cyan-100"
          placeholder="assemblyId"
          value={assemblyId}
          onChange={(e) => setAssemblyId(e.target.value.trim())}
        />
        <button
          type="button"
          data-testid="ck-erp-bom-reload"
          disabled={busy}
          onClick={() => void load()}
          className="rounded border border-cyan-400/30 bg-cyan-400/10 px-2 py-1 text-cyan-200 hover:bg-cyan-400/20 disabled:opacity-40"
        >
          Reload
        </button>
        <button
          type="button"
          data-testid="ck-erp-bom-create-asm"
          disabled={busy}
          onClick={() => void ensureAssembly()}
          className="rounded border border-white/15 bg-white/5 px-2 py-1 text-white/70 hover:bg-white/10 disabled:opacity-40"
        >
          New asm
        </button>
        <button
          type="button"
          data-testid="ck-erp-bom-export-json"
          disabled={busy || !assemblyId}
          onClick={() => void exportJson()}
          className="rounded border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 text-emerald-200 hover:bg-emerald-400/20 disabled:opacity-40"
        >
          JSON
        </button>
        <button
          type="button"
          data-testid="ck-erp-bom-export-csv"
          disabled={busy || !assemblyId}
          onClick={() => void exportCsv()}
          className="rounded border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-amber-200 hover:bg-amber-400/20 disabled:opacity-40"
        >
          CSV
        </button>
      </div>

      <div className="mb-2 grid grid-cols-[1fr_auto] gap-2">
        <input
          data-testid="ck-erp-bom-filter"
          className="rounded border border-white/10 bg-black/40 px-2 py-1 text-[10px] text-white/80"
          placeholder="Filter PN / material / vendor…"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setSelectedIdx(null);
          }}
        />
        <select
          data-testid="ck-erp-bom-sort"
          className="rounded border border-white/10 bg-black/40 px-2 py-1 text-[10px]"
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as typeof sortKey)}
        >
          <option value="partNumber">Sort: PN</option>
          <option value="qty">Sort: Qty</option>
          <option value="massKg">Sort: Mass</option>
          <option value="extendedCostUsd">Sort: Ext $</option>
        </select>
      </div>

      {bom?.rollup ? (
        <div
          data-testid="ck-erp-bom-rollup"
          className="mb-2 rounded border border-white/10 bg-black/25 px-2 py-1.5 font-mono text-[10px] text-cyan-100/85"
        >
          rollup ${fmt(bom.rollup.rollupCostUsd, 2)} {bom.rollup.currency || 'USD'} · material $
          {fmt(bom.rollup.materialCostUsd, 2)} · overhead{' '}
          {((bom.rollup.overheadPct || 0) * 100).toFixed(0)}% ($
          {fmt(bom.rollup.overheadUsd, 2)}) · mass {fmt(bom.rollup.totalMassKg, 3)} kg
        </div>
      ) : null}

      <div
        data-testid="ck-erp-bom-table"
        className="mb-2 max-h-52 overflow-auto rounded border border-white/10 bg-black/25"
      >
        {!lines.length ? (
          <div data-testid="ck-erp-bom-empty" className="px-2 py-3 text-white/35">
            {bom?.lines?.length
              ? 'No lines match filter — clear filter to see all.'
              : 'No ERP BOM lines yet — create/select an assembly with parts, then Reload.'}
          </div>
        ) : (
          <table className="w-full border-collapse text-left">
            <thead className="sticky top-0 bg-black/80 text-[9px] uppercase tracking-wide text-cyan-300/50">
              <tr>
                <th className="px-2 py-1">PN</th>
                <th className="px-2 py-1">Rev</th>
                <th className="px-2 py-1">Qty</th>
                <th className="px-2 py-1">Mat</th>
                <th className="px-2 py-1">Mass</th>
                <th className="px-2 py-1">Vendor</th>
                <th className="px-2 py-1">Ext $</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const active = selectedIdx === i;
                return (
                  <tr
                    key={l.partId || i}
                    data-testid={`ck-erp-bom-row-${i}`}
                    data-selected={active ? 'true' : 'false'}
                    onClick={() => setSelectedIdx(i)}
                    className={`cursor-pointer border-t border-white/5 font-mono text-[10px] ${
                      active ? 'bg-cyan-400/15 text-cyan-50' : 'hover:bg-white/5'
                    }`}
                  >
                    <td className="px-2 py-1 text-cyan-100">{l.partNumber}</td>
                    <td className="px-2 py-1">{l.revision}</td>
                    <td className="px-2 py-1">{l.qty}</td>
                    <td className="px-2 py-1">{l.material}</td>
                    <td className="px-2 py-1" title={l.volumeSource || ''}>
                      {fmt(l.massKg, 3)}
                    </td>
                    <td className="px-2 py-1 text-white/50">{l.vendorId}</td>
                    <td className="px-2 py-1">{fmt(l.extendedCostUsd, 2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {selected ? (
        <div
          data-testid="ck-erp-bom-selection"
          className="mb-2 rounded border border-cyan-400/20 bg-cyan-400/5 px-2 py-1.5 text-[10px] text-cyan-100/85"
        >
          <div className="font-mono">
            {selected.partNumber} rev {selected.revision} · qty {selected.qty} · {selected.materialName || selected.material}
          </div>
          <div className="mt-0.5 text-white/45">
            vendor {selected.vendorName || selected.vendorId || '—'} · lead {selected.leadTimeDays ?? '—'}d ·
            mass {fmt(selected.massKg, 3)} kg · vol {fmt(selected.volumeM3, 6)} m³ · unit $
            {fmt(selected.unitCostUsd, 2)}
          </div>
        </div>
      ) : null}

      <div
        data-testid="ck-erp-bom-load-feedback"
        className="mb-1 flex flex-wrap gap-2 px-1 text-[9px] uppercase tracking-wide text-white/35"
      >
        <span>Rows {lines.length}{bom?.lines ? ` / ${bom.lines.length}` : ''}</span>
        {loadMs != null ? (
          <span data-testid="ck-erp-bom-load-ms" className="font-mono normal-case">
            last load {loadMs}ms
          </span>
        ) : null}
      </div>

      <div data-testid="ck-erp-bom-status" className="px-1 text-[10px] text-white/50">
        {status}
      </div>
    </div>
  );
}

export default ErpBomPanel;
