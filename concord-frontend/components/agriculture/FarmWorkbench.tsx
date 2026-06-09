'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  X, Loader2, Sprout, Cloud, Eye, Plus, Trash2, Save, MapPin, Droplets, ThermometerSun,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface Field {
  id: string;
  name: string;
  acreage: number;
  lat: number;
  lng: number;
  soilType: string;
  currentCrop: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScoutingPin {
  id: string;
  fieldId: string;
  note: string;
  category: 'pest' | 'disease' | 'weed' | 'irrigation' | 'growth' | 'soil' | 'other';
  severity: 'low' | 'medium' | 'high';
  lat: number | null;
  lng: number | null;
  createdAt: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

type Tab = 'fields' | 'weather' | 'scout';

const SEVERITY_COLOR: Record<ScoutingPin['severity'], string> = {
  low: 'bg-emerald-500/15 text-emerald-300',
  medium: 'bg-amber-500/15 text-amber-300',
  high: 'bg-rose-500/15 text-rose-300',
};

export function FarmWorkbench({ open, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('fields');
  const [fields, setFields] = useState<Field[]>([]);
  const [activeField, setActiveField] = useState<Field | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshFields = useCallback(async () => {
    setLoading(true);
    try {
      const res = await lensRun({
        domain: 'agriculture', action: 'field-list', input: {},
      });
      const list = (res.data as { result?: { fields?: Field[] } })?.result?.fields || [];
      setFields(list);
      if (list.length && !activeField) setActiveField(list[0]);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [activeField]);

  useEffect(() => {
    if (open) refreshFields();
  }, [open, refreshFields]);

  if (!open) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-[620px] max-w-[100vw] z-40 bg-[#0d1117] border-l border-emerald-500/20 shadow-2xl overflow-hidden flex flex-col">
      <header className="px-4 py-3 border-b border-white/10 flex items-center justify-between bg-gradient-to-r from-emerald-950/40 to-transparent">
        <div className="flex items-center gap-2">
          <Sprout className="w-4 h-4 text-emerald-400" />
          <span className="text-sm font-semibold text-gray-200">Farm Workbench</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-md hover:bg-white/5 text-gray-400"
          aria-label="Close workbench"
        >
          <X className="w-4 h-4" />
        </button>
      </header>

      <nav className="px-3 py-2 border-b border-white/10 flex items-center gap-1">
        {[
          { id: 'fields' as const, label: 'Fields', icon: MapPin },
          { id: 'weather' as const, label: 'Weather + Soil', icon: Cloud },
          { id: 'scout' as const, label: 'Scouting log', icon: Eye },
        ].map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition',
                active
                  ? 'bg-emerald-500/15 text-emerald-200 border border-emerald-500/40'
                  : 'text-gray-400 hover:text-gray-200 border border-transparent',
              )}
            >
              <Icon className="w-3 h-3" />
              {t.label}
            </button>
          );
        })}
      </nav>

      <div className="flex-1 overflow-y-auto">
        {tab === 'fields' && (
          <FieldsTab
            fields={fields}
            loading={loading}
            onChange={refreshFields}
            activeField={activeField}
            onSelect={setActiveField}
          />
        )}
        {tab === 'weather' && <WeatherTab field={activeField} fields={fields} onSelect={setActiveField} />}
        {tab === 'scout' && <ScoutTab field={activeField} fields={fields} onSelect={setActiveField} />}
      </div>
    </div>
  );
}

// ── Fields tab ─────────────────────────────────────────────────────

function FieldsTab({
  fields, loading, onChange, activeField, onSelect,
}: {
  fields: Field[];
  loading: boolean;
  onChange: () => Promise<void>;
  activeField: Field | null;
  onSelect: (f: Field) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({
    name: '', acreage: 40, lat: 40.0, lng: -100.0, soilType: 'loam', currentCrop: 'corn',
  });

  const save = async () => {
    try {
      await lensRun({
        domain: 'agriculture', action: 'field-create', input: draft,
      });
      setCreating(false);
      setDraft({ name: '', acreage: 40, lat: 40.0, lng: -100.0, soilType: 'loam', currentCrop: 'corn' });
      await onChange();
    } catch (e) { console.error(e); }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this field?')) return;
    try {
      await lensRun({
        domain: 'agriculture', action: 'field-delete', input: { id },
      });
      await onChange();
    } catch (e) { console.error(e); }
  };

  return (
    <div className="p-3 space-y-2">
      <button
        type="button"
        onClick={() => setCreating((v) => !v)}
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 text-xs text-emerald-200"
      >
        <Plus className="w-3 h-3" /> New field
      </button>

      {creating && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2">
          <input
            type="text" value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="Field name (e.g. North 40)" maxLength={60}
            className="w-full px-2 py-1.5 text-sm bg-black/40 border border-white/10 rounded text-gray-100"
          />
          <div className="grid grid-cols-3 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase text-gray-400">Acreage</span>
              <input type="number" min="0" step="0.1"
                value={draft.acreage}
                onChange={(e) => setDraft({ ...draft, acreage: Number(e.target.value) })}
                className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase text-gray-400">Latitude</span>
              <input type="number" min="-90" max="90" step="0.0001"
                value={draft.lat}
                onChange={(e) => setDraft({ ...draft, lat: Number(e.target.value) })}
                className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase text-gray-400">Longitude</span>
              <input type="number" min="-180" max="180" step="0.0001"
                value={draft.lng}
                onChange={(e) => setDraft({ ...draft, lng: Number(e.target.value) })}
                className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono" />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input type="text" value={draft.soilType}
              onChange={(e) => setDraft({ ...draft, soilType: e.target.value })}
              placeholder="Soil type (e.g. loam)" maxLength={24}
              className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100" />
            <input type="text" value={draft.currentCrop}
              onChange={(e) => setDraft({ ...draft, currentCrop: e.target.value })}
              placeholder="Current crop" maxLength={40}
              className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100" />
          </div>
          <button type="button" onClick={save}
            disabled={!draft.name.trim() || draft.acreage <= 0}
            className="inline-flex items-center gap-1 px-3 py-1 rounded-md border border-emerald-500/40 bg-emerald-500/15 text-xs text-emerald-100 hover:brightness-110 disabled:opacity-40">
            <Save className="w-3 h-3" /> Save field
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8 text-xs text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
        </div>
      ) : fields.length === 0 ? (
        <div className="text-center py-8 px-4">
          <Sprout className="w-8 h-8 mx-auto text-gray-600 mb-2" />
          <p className="text-xs text-gray-400">No fields yet</p>
          <p className="text-[10px] text-gray-400 mt-1">Add your first field with lat/lng to unlock weather + soil data.</p>
        </div>
      ) : (
        fields.map((f) => (
          <div key={f.id}
            className={cn(
              'rounded-md border p-3 transition group cursor-pointer',
              activeField?.id === f.id
                ? 'border-emerald-500/50 bg-emerald-500/10'
                : 'border-white/10 bg-black/20 hover:bg-white/5',
            )}
            onClick={() => onSelect(f)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-100">{f.name}</p>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  {f.acreage}ac · {f.soilType}{f.currentCrop && ` · ${f.currentCrop}`}
                </p>
                <p className="text-[10px] text-gray-400 font-mono mt-0.5">
                  {f.lat.toFixed(4)}, {f.lng.toFixed(4)}
                </p>
              </div>
              <button aria-label="Delete" type="button"
                onClick={(e) => { e.stopPropagation(); remove(f.id); }}
                className="p-1 text-gray-600 hover:text-rose-300 opacity-0 group-hover:opacity-100"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ── Weather + soil tab ─────────────────────────────────────────────

interface WeatherData {
  today?: { tempMax?: number; tempMin?: number; precipSum?: number; et0?: number };
  forecast7?: { date: string; tempMax: number; tempMin: number; precip: number; et0: number }[];
  currentSoilMoisture?: number;
  currentSoilTemp?: number;
  source?: string;
}

function WeatherTab({ field, fields, onSelect }: { field: Field | null; fields: Field[]; onSelect: (f: Field) => void }) {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!field) return;
    setLoading(true);
    setError(null);
    setWeather(null);
    (async () => {
      try {
        const res = await lensRun({
          domain: 'agriculture', action: 'weather-for-field',
          input: { lat: field.lat, lng: field.lng },
        });
        const data = res.data as { ok?: boolean; error?: string; result?: WeatherData };
        if (data.ok) setWeather(data.result || null);
        else setError(data.error || 'Failed to load weather');
      } catch (e) { setError((e as Error).message || 'Network error'); }
      finally { setLoading(false); }
    })();
  }, [field]);

  if (!field) {
    return (
      <div className="p-4">
        <p className="text-xs text-gray-400 mb-2">Pick a field to view weather + soil data.</p>
        {fields.map((f) => (
          <button key={f.id} type="button" onClick={() => onSelect(f)}
            className="block w-full text-left px-2 py-1.5 text-sm text-gray-300 hover:bg-white/5 rounded">
            {f.name}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-200">{field.name}</h3>
        <span className="text-[10px] text-gray-400 font-mono">{field.lat.toFixed(3)}, {field.lng.toFixed(3)}</span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8 text-xs text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading weather…
        </div>
      ) : error ? (
        <p className="text-xs text-rose-300">{error}</p>
      ) : weather ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded border border-white/10 bg-black/20 p-3">
              <p className="text-[10px] uppercase text-gray-400 mb-1 flex items-center gap-1">
                <ThermometerSun className="w-3 h-3" /> Today
              </p>
              <p className="text-sm text-gray-100">
                {weather.today?.tempMin?.toFixed(0)}° – {weather.today?.tempMax?.toFixed(0)}°C
              </p>
              {weather.today?.precipSum != null && (
                <p className="text-[11px] text-cyan-300 mt-1">
                  {weather.today.precipSum.toFixed(1)} mm precip
                </p>
              )}
            </div>
            <div className="rounded border border-white/10 bg-black/20 p-3">
              <p className="text-[10px] uppercase text-gray-400 mb-1 flex items-center gap-1">
                <Droplets className="w-3 h-3" /> Soil
              </p>
              {weather.currentSoilMoisture != null && (
                <p className="text-sm text-gray-100">
                  {(weather.currentSoilMoisture * 100).toFixed(1)}% moisture
                </p>
              )}
              {weather.currentSoilTemp != null && (
                <p className="text-[11px] text-amber-300 mt-1">{weather.currentSoilTemp.toFixed(1)}°C temp</p>
              )}
            </div>
          </div>

          <div className="border border-white/10 rounded overflow-hidden">
            <div className="px-3 py-1.5 bg-black/40 text-[10px] uppercase tracking-wider text-gray-400">
              7-day forecast
            </div>
            {weather.forecast7?.map((d) => (
              <div key={d.date} className="px-3 py-1.5 border-t border-white/5 grid grid-cols-4 text-xs gap-2">
                <span className="text-gray-400 font-mono">{d.date.slice(5)}</span>
                <span className="text-gray-200">{d.tempMin?.toFixed(0)}–{d.tempMax?.toFixed(0)}°</span>
                <span className="text-cyan-300">{d.precip?.toFixed(1) || '0.0'} mm</span>
                <span className="text-gray-400 text-right">ET₀ {d.et0?.toFixed(1) || '–'}</span>
              </div>
            ))}
          </div>

          <p className="text-[10px] text-gray-400 italic">Source: {weather.source}</p>
        </>
      ) : null}
    </div>
  );
}

// ── Scouting log tab ───────────────────────────────────────────────

function ScoutTab({ field, fields, onSelect }: { field: Field | null; fields: Field[]; onSelect: (f: Field) => void }) {
  const [pins, setPins] = useState<ScoutingPin[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<{
    note: string; category: ScoutingPin['category']; severity: ScoutingPin['severity'];
  }>({ note: '', category: 'pest', severity: 'low' });

  const refresh = useCallback(async () => {
    if (!field) { setPins([]); setLoading(false); return; }
    setLoading(true);
    try {
      const res = await lensRun({
        domain: 'agriculture', action: 'scout-list',
        input: { fieldId: field.id },
      });
      const result = (res.data as { result?: { pins?: ScoutingPin[] } })?.result;
      setPins(result?.pins || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [field]);

  useEffect(() => { refresh(); }, [refresh]);

  const save = async () => {
    if (!field) return;
    try {
      await lensRun({
        domain: 'agriculture', action: 'scout-add',
        input: { fieldId: field.id, ...draft, lat: field.lat, lng: field.lng },
      });
      setAdding(false);
      setDraft({ note: '', category: 'pest', severity: 'low' });
      await refresh();
    } catch (e) { console.error(e); }
  };

  const remove = async (id: string) => {
    try {
      await lensRun({
        domain: 'agriculture', action: 'scout-delete', input: { id },
      });
      await refresh();
    } catch (e) { console.error(e); }
  };

  if (!field) {
    return (
      <div className="p-4">
        <p className="text-xs text-gray-400 mb-2">Pick a field to view its scouting log.</p>
        {fields.map((f) => (
          <button key={f.id} type="button" onClick={() => onSelect(f)}
            className="block w-full text-left px-2 py-1.5 text-sm text-gray-300 hover:bg-white/5 rounded">
            {f.name}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-200">{field.name}</h3>
        <button type="button"
          onClick={() => setAdding((v) => !v)}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 text-xs text-emerald-200"
        >
          <Plus className="w-3 h-3" /> New observation
        </button>
      </div>

      {adding && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2">
          <textarea
            value={draft.note}
            onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            placeholder="Observation note (what you saw, where, how widespread)"
            maxLength={1000} rows={4}
            className="w-full px-2 py-1.5 text-sm bg-black/40 border border-white/10 rounded text-gray-100 resize-none"
          />
          <div className="grid grid-cols-2 gap-2">
            <select value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value as ScoutingPin['category'] })}
              className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100">
              {['pest', 'disease', 'weed', 'irrigation', 'growth', 'soil', 'other'].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <select value={draft.severity}
              onChange={(e) => setDraft({ ...draft, severity: e.target.value as ScoutingPin['severity'] })}
              className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100">
              {['low', 'medium', 'high'].map((s) => (
                <option key={s} value={s}>{s} severity</option>
              ))}
            </select>
          </div>
          <button type="button" onClick={save} disabled={!draft.note.trim()}
            className="inline-flex items-center gap-1 px-3 py-1 rounded-md border border-emerald-500/40 bg-emerald-500/15 text-xs text-emerald-100 hover:brightness-110 disabled:opacity-40">
            <Save className="w-3 h-3" /> Save observation
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8 text-xs text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
        </div>
      ) : pins.length === 0 ? (
        <p className="text-center text-xs text-gray-400 py-8">No observations yet.</p>
      ) : (
        pins.map((p) => (
          <div key={p.id} className="rounded-md border border-white/10 bg-black/20 p-3 hover:bg-white/5 group">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={cn('text-[10px] px-1.5 py-0.5 rounded uppercase', SEVERITY_COLOR[p.severity])}>
                    {p.severity}
                  </span>
                  <span className="text-[10px] text-gray-400 uppercase">{p.category}</span>
                  <span className="text-[10px] text-gray-400 ml-auto">{new Date(p.createdAt).toLocaleDateString()}</span>
                </div>
                <p className="text-xs text-gray-200">{p.note}</p>
              </div>
              <button aria-label="Delete" type="button" onClick={() => remove(p.id)}
                className="p-1 text-gray-600 hover:text-rose-300 opacity-0 group-hover:opacity-100">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

export default FarmWorkbench;
