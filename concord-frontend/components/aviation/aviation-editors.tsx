'use client';

import { CheckCircle, XCircle } from 'lucide-react';
import { DraftedTextarea } from '@/components/lens/DraftedTextarea';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import {
  FLIGHT_STATUSES, PILOT_CERTS, PILOT_RATINGS, AIRCRAFT_STATUSES,
  MX_CATEGORIES, MX_PRIORITIES, CHARTER_STATUSES, FLIGHT_REGS, FLIGHT_CATEGORIES,
  computeWbTotals, type FormFields, type SetField,
} from './aviation-ops';

type EditorProps = { form: FormFields; setField: SetField };

export function FlightEditor({ form, setField }: EditorProps) {
  return (
  <div className="space-y-4">
    <div className={ds.grid2}>
      <div><label className={ds.label}>Flight Title</label><input className={ds.input} value={(form._title as string) || ''} onChange={e => setField('_title', e.target.value)} placeholder="Flight identifier..." /></div>
      <div><label className={ds.label}>Status</label>
        <select className={ds.select} value={(form._status as string) || 'planned'} onChange={e => setField('_status', e.target.value)}>
          {FLIGHT_STATUSES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
        </select>
      </div>
    </div>
    <div className={ds.grid2}>
      <div><label className={ds.label}>Aircraft Type</label><input className={ds.input} value={(form.aircraft as string) || ''} onChange={e => setField('aircraft', e.target.value)} placeholder="C172, PA28..." /></div>
      <div><label className={ds.label}>Tail Number</label><input className={ds.input} value={(form.tailNumber as string) || ''} onChange={e => setField('tailNumber', e.target.value)} placeholder="N12345" /></div>
    </div>
    <div className={ds.grid2}>
      <div><label className={ds.label}>PIC</label><input className={ds.input} value={(form.pic as string) || ''} onChange={e => setField('pic', e.target.value)} placeholder="Pilot in Command" /></div>
      <div><label className={ds.label}>SIC</label><input className={ds.input} value={(form.sic as string) || ''} onChange={e => setField('sic', e.target.value)} placeholder="Second in Command" /></div>
    </div>
    <div className={ds.grid2}>
      <div><label className={ds.label}>Departure (ICAO)</label><input className={ds.input} value={(form.departure as string) || ''} onChange={e => setField('departure', e.target.value)} placeholder="KJFK" /></div>
      <div><label className={ds.label}>Arrival (ICAO)</label><input className={ds.input} value={(form.arrival as string) || ''} onChange={e => setField('arrival', e.target.value)} placeholder="KLAX" /></div>
    </div>
    <div className={ds.grid3}>
      <div><label className={ds.label}>Date</label><input type="date" className={ds.input} value={(form.date as string) || ''} onChange={e => setField('date', e.target.value)} /></div>
      <div><label className={ds.label}>ETD (Z)</label><input type="time" className={ds.input} value={(form.etd as string) || ''} onChange={e => setField('etd', e.target.value)} /></div>
      <div><label className={ds.label}>ETA (Z)</label><input type="time" className={ds.input} value={(form.eta as string) || ''} onChange={e => setField('eta', e.target.value)} /></div>
    </div>
    <div className={ds.grid4}>
      <div><label className={ds.label}>Hobbs Start</label><input type="number" step="0.1" className={ds.input} value={(form.hobbsStart as number) || ''} onChange={e => setField('hobbsStart', parseFloat(e.target.value) || 0)} /></div>
      <div><label className={ds.label}>Hobbs End</label><input type="number" step="0.1" className={ds.input} value={(form.hobbsEnd as number) || ''} onChange={e => setField('hobbsEnd', parseFloat(e.target.value) || 0)} /></div>
      <div><label className={ds.label}>Tach Start</label><input type="number" step="0.1" className={ds.input} value={(form.tachStart as number) || ''} onChange={e => setField('tachStart', parseFloat(e.target.value) || 0)} /></div>
      <div><label className={ds.label}>Tach End</label><input type="number" step="0.1" className={ds.input} value={(form.tachEnd as number) || ''} onChange={e => setField('tachEnd', parseFloat(e.target.value) || 0)} /></div>
    </div>
    <div className={ds.grid3}>
      <div><label className={ds.label}>Fuel Burn (gal)</label><input type="number" step="0.1" className={ds.input} value={(form.fuelBurn as number) || ''} onChange={e => setField('fuelBurn', parseFloat(e.target.value) || 0)} /></div>
      <div><label className={ds.label}>Fuel Onboard (gal)</label><input type="number" step="0.1" className={ds.input} value={(form.fuelOnboard as number) || ''} onChange={e => setField('fuelOnboard', parseFloat(e.target.value) || 0)} /></div>
      <div><label className={ds.label}>Passengers</label><input type="number" className={ds.input} value={(form.passengers as number) || ''} onChange={e => setField('passengers', parseInt(e.target.value) || 0)} /></div>
    </div>
    <div><label className={ds.label}>Passenger Names</label><input className={ds.input} value={(form.passengerNames as string) || ''} onChange={e => setField('passengerNames', e.target.value)} placeholder="Comma separated..." /></div>
    <div><label className={ds.label}>Route</label><input className={ds.input} value={(form.route as string) || ''} onChange={e => setField('route', e.target.value)} placeholder="V16 ALB V3 JFK..." /></div>
    <div className={ds.grid3}>
      <div><label className={ds.label}>Altitude</label><input className={ds.input} value={(form.altitude as string) || ''} onChange={e => setField('altitude', e.target.value)} placeholder="FL350, 8500..." /></div>
      <div><label className={ds.label}>Ceiling Min (ft)</label><input type="number" className={ds.input} value={(form.ceilingReq as number) || ''} onChange={e => setField('ceilingReq', parseInt(e.target.value) || 0)} /></div>
      <div><label className={ds.label}>Vis Min (SM)</label><input type="number" step="0.5" className={ds.input} value={(form.visibilityReq as number) || ''} onChange={e => setField('visibilityReq', parseFloat(e.target.value) || 0)} /></div>
    </div>
    <div><label className={ds.label}>Weather Minimums Notes</label><input className={ds.input} value={(form.weatherMins as string) || ''} onChange={e => setField('weatherMins', e.target.value)} placeholder="IFR alternate required, 1-2-3 rule..." /></div>
    <div><label className={ds.label}>Squawks</label><DraftedTextarea lensId="aviation" draftKey="flight_squawks" initial={(form.squawks as string) || ''} onValueChange={(v) => setField('squawks', v)} className={cn(ds.textarea, 'h-16')} placeholder="Post-flight squawks..." /></div>
    <div><label className={ds.label}>Remarks</label><DraftedTextarea lensId="aviation" draftKey="flight_remarks" initial={(form.remarks as string) || ''} onValueChange={(v) => setField('remarks', v)} className={cn(ds.textarea, 'h-20')} placeholder="Flight remarks..." /></div>
  </div>
);
}

export function PilotEditor({ form, setField }: EditorProps) {
  return (
  <div className="space-y-4">
    <div className={ds.grid2}>
      <div><label className={ds.label}>Pilot Name</label><input className={ds.input} value={(form.name as string) || ''} onChange={e => { setField('name', e.target.value); setField('_title', e.target.value); }} placeholder="Full name" /></div>
      <div><label className={ds.label}>Employee ID</label><input className={ds.input} value={(form.employeeId as string) || ''} onChange={e => setField('employeeId', e.target.value)} placeholder="EMP-001" /></div>
    </div>
    <div className={ds.grid3}>
      <div><label className={ds.label}>Certificate</label>
        <select className={ds.select} value={(form.certificate as string) || ''} onChange={e => setField('certificate', e.target.value)}>
          <option value="">Select...</option>{PILOT_CERTS.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div><label className={ds.label}>Certificate Number</label><input className={ds.input} value={(form.certificateNumber as string) || ''} onChange={e => setField('certificateNumber', e.target.value)} /></div>
      <div><label className={ds.label}>Base Airport</label><input className={ds.input} value={(form.baseAirport as string) || ''} onChange={e => setField('baseAirport', e.target.value)} placeholder="KJFK" /></div>
    </div>
    <div>
      <label className={ds.label}>Ratings</label>
      <div className="flex flex-wrap gap-2 mt-1">
        {PILOT_RATINGS.map(r => {
          const ratings = (form.ratings as string[]) || [];
          const selected = ratings.includes(r);
          return (
            <button key={r} onClick={() => setField('ratings', selected ? ratings.filter(x => x !== r) : [...ratings, r])}
              className={cn('px-2 py-1 rounded text-xs border transition-colors', selected ? 'bg-blue-500/20 border-blue-500 text-blue-400' : 'border-lattice-border text-gray-400 hover:text-white')}>
              {r}
            </button>
          );
        })}
      </div>
    </div>
    <div><label className={ds.label}>Type Ratings (comma-separated)</label><input className={ds.input} value={((form.typeRatings as string[]) || []).join(', ')} onChange={e => setField('typeRatings', e.target.value.split(',').map(s => s.trim()).filter(Boolean))} placeholder="B737, CE-525..." /></div>
    <div className={ds.grid3}>
      <div><label className={ds.label}>Medical Class</label>
        <select className={ds.select} value={(form.medicalClass as string) || ''} onChange={e => setField('medicalClass', e.target.value)}>
          <option value="">Select...</option><option value="1st Class">1st Class</option><option value="2nd Class">2nd Class</option><option value="3rd Class">3rd Class</option><option value="BasicMed">BasicMed</option>
        </select>
      </div>
      <div><label className={ds.label}>Medical Expiry</label><input type="date" className={ds.input} value={(form.medicalExpiry as string) || ''} onChange={e => setField('medicalExpiry', e.target.value)} /></div>
      <div><label className={ds.label}>Flight Regulation</label>
        <select className={ds.select} value={(form.flightRegulation as string) || ''} onChange={e => setField('flightRegulation', e.target.value)}>
          <option value="">Select...</option>{FLIGHT_REGS.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>
    </div>
    <div className={ds.grid2}>
      <div><label className={ds.label}>BFR Date</label><input type="date" className={ds.input} value={(form.bfrDate as string) || ''} onChange={e => setField('bfrDate', e.target.value)} /></div>
      <div><label className={ds.label}>IPC Date</label><input type="date" className={ds.input} value={(form.ipcDate as string) || ''} onChange={e => setField('ipcDate', e.target.value)} /></div>
    </div>
    <div className="border-t border-lattice-border pt-4">
      <h4 className={cn(ds.heading3, 'text-sm mb-3')}>Flight Hours</h4>
      <div className={ds.grid3}>
        <div><label className={ds.label}>Total</label><input type="number" className={ds.input} value={(form.totalHours as number) || ''} onChange={e => setField('totalHours', parseFloat(e.target.value) || 0)} /></div>
        <div><label className={ds.label}>PIC</label><input type="number" className={ds.input} value={(form.picHours as number) || ''} onChange={e => setField('picHours', parseFloat(e.target.value) || 0)} /></div>
        <div><label className={ds.label}>SIC</label><input type="number" className={ds.input} value={(form.sicHours as number) || ''} onChange={e => setField('sicHours', parseFloat(e.target.value) || 0)} /></div>
        <div><label className={ds.label}>Night</label><input type="number" className={ds.input} value={(form.nightHours as number) || ''} onChange={e => setField('nightHours', parseFloat(e.target.value) || 0)} /></div>
        <div><label className={ds.label}>Instrument</label><input type="number" className={ds.input} value={(form.instrumentHours as number) || ''} onChange={e => setField('instrumentHours', parseFloat(e.target.value) || 0)} /></div>
        <div><label className={ds.label}>Cross-Country</label><input type="number" className={ds.input} value={(form.crossCountryHours as number) || ''} onChange={e => setField('crossCountryHours', parseFloat(e.target.value) || 0)} /></div>
        <div><label className={ds.label}>Multi-Engine</label><input type="number" className={ds.input} value={(form.multiEngineHours as number) || ''} onChange={e => setField('multiEngineHours', parseFloat(e.target.value) || 0)} /></div>
      </div>
    </div>
    <div className="border-t border-lattice-border pt-4">
      <h4 className={cn(ds.heading3, 'text-sm mb-3')}>Duty Time Tracking</h4>
      <div className={ds.grid4}>
        <div><label className={ds.label}>Last 30 Days</label><input type="number" className={ds.input} value={(form.last30Days as number) || ''} onChange={e => setField('last30Days', parseFloat(e.target.value) || 0)} /></div>
        <div><label className={ds.label}>Last 90 Days</label><input type="number" className={ds.input} value={(form.last90Days as number) || ''} onChange={e => setField('last90Days', parseFloat(e.target.value) || 0)} /></div>
        <div><label className={ds.label}>Last 12 Months</label><input type="number" className={ds.input} value={(form.last12Months as number) || ''} onChange={e => setField('last12Months', parseFloat(e.target.value) || 0)} /></div>
        <div><label className={ds.label}>Duty On</label><input type="time" className={ds.input} value={(form.dutyOnTime as string) || ''} onChange={e => setField('dutyOnTime', e.target.value)} /></div>
      </div>
    </div>
    <div className={ds.grid2}>
      <div><label className={ds.label}>Phone</label><input className={ds.input} value={(form.phone as string) || ''} onChange={e => setField('phone', e.target.value)} /></div>
      <div><label className={ds.label}>Email</label><input className={ds.input} value={(form.email as string) || ''} onChange={e => setField('email', e.target.value)} /></div>
    </div>
  </div>
);
}

export function AircraftOpsEditor({ form, setField }: EditorProps) {
  return (
  <div className="space-y-4">
    <div className={ds.grid2}>
      <div><label className={ds.label}>Tail Number</label><input className={ds.input} value={(form.tailNumber as string) || ''} onChange={e => { setField('tailNumber', e.target.value); setField('_title', e.target.value); }} placeholder="N12345" /></div>
      <div><label className={ds.label}>Status</label>
        <select className={ds.select} value={(form._status as string) || 'airworthy'} onChange={e => setField('_status', e.target.value)}>
          {AIRCRAFT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
    </div>
    <div className={ds.grid3}>
      <div><label className={ds.label}>Make</label><input className={ds.input} value={(form.make as string) || ''} onChange={e => setField('make', e.target.value)} placeholder="Cessna" /></div>
      <div><label className={ds.label}>Model</label><input className={ds.input} value={(form.model as string) || ''} onChange={e => setField('model', e.target.value)} placeholder="172S" /></div>
      <div><label className={ds.label}>Year</label><input type="number" className={ds.input} value={(form.year as number) || ''} onChange={e => setField('year', parseInt(e.target.value) || 0)} /></div>
    </div>
    <div className={ds.grid2}>
      <div><label className={ds.label}>Serial Number</label><input className={ds.input} value={(form.serialNumber as string) || ''} onChange={e => setField('serialNumber', e.target.value)} /></div>
      <div><label className={ds.label}>Type</label><input className={ds.input} value={(form.type as string) || ''} onChange={e => setField('type', e.target.value)} placeholder="Single-engine piston" /></div>
    </div>
    <div className={ds.grid3}>
      <div><label className={ds.label}>Total Time</label><input type="number" step="0.1" className={ds.input} value={(form.totalTime as number) || ''} onChange={e => setField('totalTime', parseFloat(e.target.value) || 0)} /></div>
      <div><label className={ds.label}>TSMOH</label><input type="number" step="0.1" className={ds.input} value={(form.tsmoh as number) || ''} onChange={e => setField('tsmoh', parseFloat(e.target.value) || 0)} /></div>
      <div><label className={ds.label}>TSPOH</label><input type="number" step="0.1" className={ds.input} value={(form.tspoh as number) || ''} onChange={e => setField('tspoh', parseFloat(e.target.value) || 0)} /></div>
    </div>
    <div className={ds.grid3}>
      <div><label className={ds.label}>Engine Type</label><input className={ds.input} value={(form.engType as string) || ''} onChange={e => setField('engType', e.target.value)} placeholder="IO-360" /></div>
      <div><label className={ds.label}>Engine HP</label><input type="number" className={ds.input} value={(form.engHP as number) || ''} onChange={e => setField('engHP', parseInt(e.target.value) || 0)} /></div>
      <div><label className={ds.label}>Avionics</label><input className={ds.input} value={(form.avionics as string) || ''} onChange={e => setField('avionics', e.target.value)} placeholder="G1000, GNS530..." /></div>
    </div>
    <div className={ds.grid2}>
      <div><label className={ds.label}>Next Annual</label><input type="date" className={ds.input} value={(form.nextAnnual as string) || ''} onChange={e => setField('nextAnnual', e.target.value)} /></div>
      <div><label className={ds.label}>Hrs Until 100hr</label><input type="number" step="0.1" className={ds.input} value={(form.next100hr as number) || ''} onChange={e => setField('next100hr', parseFloat(e.target.value) || 0)} /></div>
    </div>
    <div className="border-t border-lattice-border pt-4">
      <h4 className={cn(ds.heading3, 'text-sm mb-3')}>Weight & Balance (Empty)</h4>
      <div className={ds.grid4}>
        <div><label className={ds.label}>Empty Weight (lbs)</label><input type="number" className={ds.input} value={(form.emptyWeight as number) || ''} onChange={e => setField('emptyWeight', parseFloat(e.target.value) || 0)} /></div>
        <div><label className={ds.label}>Empty CG (in)</label><input type="number" step="0.01" className={ds.input} value={(form.emptyCG as number) || ''} onChange={e => setField('emptyCG', parseFloat(e.target.value) || 0)} /></div>
        <div><label className={ds.label}>Max Gross (lbs)</label><input type="number" className={ds.input} value={(form.maxGross as number) || ''} onChange={e => setField('maxGross', parseFloat(e.target.value) || 0)} /></div>
        <div><label className={ds.label}>Useful Load (lbs)</label><input type="number" className={ds.input} value={(form.usefulLoad as number) || ''} onChange={e => setField('usefulLoad', parseFloat(e.target.value) || 0)} /></div>
      </div>
      <div className={ds.grid2}>
        <div><label className={ds.label}>Fuel Capacity (gal)</label><input type="number" className={ds.input} value={(form.fuelCapacity as number) || ''} onChange={e => setField('fuelCapacity', parseFloat(e.target.value) || 0)} /></div>
        <div><label className={ds.label}>Loading Stations</label><input className={ds.input} value={(form.stations as string) || ''} onChange={e => setField('stations', e.target.value)} placeholder="Pilot:37, Rear:73, Baggage:95" /></div>
      </div>
    </div>
    <div><label className={ds.label}>AD Compliance (comma-separated)</label><DraftedTextarea lensId="aviation" draftKey="maint_ad_compliance" initial={((form.adCompliance as string[]) || []).join(', ')} onValueChange={(v) => setField('adCompliance', v.split(',').map(s => s.trim()).filter(Boolean))} className={cn(ds.textarea, 'h-16')} placeholder="AD 2020-10-15, AD 2019-25-51..." /></div>
    <div><label className={ds.label}>Open Squawks (comma-separated)</label><DraftedTextarea lensId="aviation" draftKey="maint_open_squawks" initial={((form.squawks as string[]) || []).join(', ')} onValueChange={(v) => setField('squawks', v.split(',').map(s => s.trim()).filter(Boolean))} className={cn(ds.textarea, 'h-16')} placeholder="Loose trim tab, Oil leak..." /></div>
    <div className={ds.grid2}>
      <div><label className={ds.label}>Insurance Expiry</label><input type="date" className={ds.input} value={(form.insuranceExpiry as string) || ''} onChange={e => setField('insuranceExpiry', e.target.value)} /></div>
      <div><label className={ds.label}>Registration Expiry</label><input type="date" className={ds.input} value={(form.registrationExpiry as string) || ''} onChange={e => setField('registrationExpiry', e.target.value)} /></div>
    </div>
  </div>
);
}

export function MaintenanceEditor({ form, setField }: EditorProps) {
  return (
  <div className="space-y-4">
    <div className={ds.grid2}>
      <div><label className={ds.label}>Work Order Title</label><input className={ds.input} value={(form._title as string) || ''} onChange={e => setField('_title', e.target.value)} placeholder="Describe the work..." /></div>
      <div><label className={ds.label}>WO Number</label><input className={ds.input} value={(form.workOrderNumber as string) || ''} onChange={e => setField('workOrderNumber', e.target.value)} placeholder="WO-2026-001" /></div>
    </div>
    <div className={ds.grid3}>
      <div><label className={ds.label}>Aircraft</label><input className={ds.input} value={(form.aircraft as string) || ''} onChange={e => setField('aircraft', e.target.value)} placeholder="C172S" /></div>
      <div><label className={ds.label}>Tail Number</label><input className={ds.input} value={(form.tailNumber as string) || ''} onChange={e => setField('tailNumber', e.target.value)} placeholder="N12345" /></div>
      <div><label className={ds.label}>Category</label>
        <select className={ds.select} value={(form._status as string) || 'unscheduled'} onChange={e => { setField('_status', e.target.value); setField('category', e.target.value); }}>
          {MX_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
    </div>
    <div><label className={ds.label}>Discrepancy</label><DraftedTextarea lensId="aviation" draftKey="maint_discrepancy" initial={(form.discrepancy as string) || ''} onValueChange={(v) => setField('discrepancy', v)} className={cn(ds.textarea, 'h-20')} placeholder="Describe the discrepancy..." /></div>
    <div className={ds.grid3}>
      <div><label className={ds.label}>MEL Reference</label><input className={ds.input} value={(form.melReference as string) || ''} onChange={e => setField('melReference', e.target.value)} placeholder="MEL 32-1" /></div>
      <div><label className={ds.label}>AD Reference</label><input className={ds.input} value={(form.adReference as string) || ''} onChange={e => setField('adReference', e.target.value)} placeholder="AD 2024-10-15" /></div>
      <div><label className={ds.label}>SB Reference</label><input className={ds.input} value={(form.sbReference as string) || ''} onChange={e => setField('sbReference', e.target.value)} placeholder="SB-172-88" /></div>
    </div>
    <div className={ds.grid2}>
      <div><label className={ds.label}>Priority</label>
        <select className={ds.select} value={(form.priority as string) || 'routine'} onChange={e => setField('priority', e.target.value)}>
          {MX_PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      <div><label className={ds.label}>Labor Hours</label><input type="number" step="0.1" className={ds.input} value={(form.laborHours as number) || ''} onChange={e => setField('laborHours', parseFloat(e.target.value) || 0)} /></div>
    </div>
    <div><label className={ds.label}>Parts Used</label><DraftedTextarea lensId="aviation" draftKey="maint_parts_used" initial={(form.partsUsed as string) || ''} onValueChange={(v) => setField('partsUsed', v)} className={cn(ds.textarea, 'h-16')} placeholder="Part number, description, qty..." /></div>
    <div className="border-t border-lattice-border pt-4">
      <h4 className={cn(ds.heading3, 'text-sm mb-3')}>Sign-Off</h4>
      <div className={ds.grid2}>
        <div><label className={ds.label}>Mechanic (A&P)</label><input className={ds.input} value={(form.mechanic as string) || ''} onChange={e => setField('mechanic', e.target.value)} /></div>
        <div><label className={ds.label}>A&P Cert #</label><input className={ds.input} value={(form.mechanicCert as string) || ''} onChange={e => setField('mechanicCert', e.target.value)} /></div>
        <div><label className={ds.label}>Inspector (IA)</label><input className={ds.input} value={(form.inspector as string) || ''} onChange={e => setField('inspector', e.target.value)} /></div>
        <div><label className={ds.label}>IA Cert #</label><input className={ds.input} value={(form.inspectorCert as string) || ''} onChange={e => setField('inspectorCert', e.target.value)} /></div>
      </div>
    </div>
    <div className="border-t border-lattice-border pt-4">
      <h4 className={cn(ds.heading3, 'text-sm mb-3')}>Component Tracking</h4>
      <div className={ds.grid3}>
        <div><label className={ds.label}>Component Name</label><input className={ds.input} value={(form.componentName as string) || ''} onChange={e => setField('componentName', e.target.value)} /></div>
        <div><label className={ds.label}>TSN (hours)</label><input type="number" step="0.1" className={ds.input} value={(form.componentTSN as number) || ''} onChange={e => setField('componentTSN', parseFloat(e.target.value) || 0)} /></div>
        <div><label className={ds.label}>Life Limit (hours)</label><input type="number" step="0.1" className={ds.input} value={(form.componentLifeLimit as number) || ''} onChange={e => setField('componentLifeLimit', parseFloat(e.target.value) || 0)} /></div>
      </div>
    </div>
    <div className={ds.grid2}>
      <div><label className={ds.label}>Date Opened</label><input type="date" className={ds.input} value={(form.dateOpened as string) || ''} onChange={e => setField('dateOpened', e.target.value)} /></div>
      <div><label className={ds.label}>Date Closed</label><input type="date" className={ds.input} value={(form.dateClosed as string) || ''} onChange={e => setField('dateClosed', e.target.value)} /></div>
    </div>
  </div>
);
}

export function CharterEditor({ form, setField }: EditorProps) {
  return (
  <div className="space-y-4">
    <div className={ds.grid2}>
      <div><label className={ds.label}>Charter Title</label><input className={ds.input} value={(form._title as string) || ''} onChange={e => setField('_title', e.target.value)} placeholder="Charter description..." /></div>
      <div><label className={ds.label}>Status</label>
        <select className={ds.select} value={(form._status as string) || 'inquiry'} onChange={e => setField('_status', e.target.value)}>
          {CHARTER_STATUSES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
        </select>
      </div>
    </div>
    <div className={ds.grid3}>
      <div><label className={ds.label}>Client Name</label><input className={ds.input} value={(form.clientName as string) || ''} onChange={e => setField('clientName', e.target.value)} /></div>
      <div><label className={ds.label}>Client Phone</label><input className={ds.input} value={(form.clientPhone as string) || ''} onChange={e => setField('clientPhone', e.target.value)} /></div>
      <div><label className={ds.label}>Client Email</label><input className={ds.input} value={(form.clientEmail as string) || ''} onChange={e => setField('clientEmail', e.target.value)} /></div>
    </div>
    <div className={ds.grid2}>
      <div><label className={ds.label}>Departure (ICAO)</label><input className={ds.input} value={(form.departure as string) || ''} onChange={e => setField('departure', e.target.value)} placeholder="KJFK" /></div>
      <div><label className={ds.label}>Arrival (ICAO)</label><input className={ds.input} value={(form.arrival as string) || ''} onChange={e => setField('arrival', e.target.value)} placeholder="KMIA" /></div>
    </div>
    <div className={ds.grid3}>
      <div><label className={ds.label}>Date</label><input type="date" className={ds.input} value={(form.date as string) || ''} onChange={e => setField('date', e.target.value)} /></div>
      <div><label className={ds.label}>Return Date</label><input type="date" className={ds.input} value={(form.returnDate as string) || ''} onChange={e => setField('returnDate', e.target.value)} /></div>
      <div><label className={ds.label}>Confirmation #</label><input className={ds.input} value={(form.confirmationNumber as string) || ''} onChange={e => setField('confirmationNumber', e.target.value)} placeholder="CHR-2026-001" /></div>
    </div>
    <div className={ds.grid3}>
      <div><label className={ds.label}>Aircraft</label><input className={ds.input} value={(form.aircraft as string) || ''} onChange={e => setField('aircraft', e.target.value)} placeholder="Citation CJ3" /></div>
      <div><label className={ds.label}>Passenger Count</label><input type="number" className={ds.input} value={(form.passengerCount as number) || ''} onChange={e => setField('passengerCount', parseInt(e.target.value) || 0)} /></div>
      <div><label className={ds.label}>Distance (NM)</label><input type="number" className={ds.input} value={(form.distanceNM as number) || ''} onChange={e => setField('distanceNM', parseInt(e.target.value) || 0)} /></div>
    </div>
    <div><label className={ds.label}>Passenger Names</label><input className={ds.input} value={(form.passengerNames as string) || ''} onChange={e => setField('passengerNames', e.target.value)} placeholder="Comma-separated names..." /></div>
    <div className="border-t border-lattice-border pt-4">
      <h4 className={cn(ds.heading3, 'text-sm mb-3')}>Pricing Calculator</h4>
      <div className={ds.grid4}>
        <div><label className={ds.label}>Rate/NM ($)</label><input type="number" step="0.01" className={ds.input} value={(form.ratePerNM as number) || ''} onChange={e => setField('ratePerNM', parseFloat(e.target.value) || 0)} /></div>
        <div><label className={ds.label}>Base Fee ($)</label><input type="number" step="0.01" className={ds.input} value={(form.baseFee as number) || ''} onChange={e => setField('baseFee', parseFloat(e.target.value) || 0)} /></div>
        <div><label className={ds.label}>Fuel Surcharge ($)</label><input type="number" step="0.01" className={ds.input} value={(form.fuelSurcharge as number) || ''} onChange={e => setField('fuelSurcharge', parseFloat(e.target.value) || 0)} /></div>
        <div>
          <label className={ds.label}>Calculated</label>
          <div className={cn(ds.input, 'bg-lattice-border text-emerald-400 font-bold')}>
            ${(((form.ratePerNM as number) || 0) * ((form.distanceNM as number) || 0) + ((form.baseFee as number) || 0) + ((form.fuelSurcharge as number) || 0)).toLocaleString()}
          </div>
        </div>
      </div>
    </div>
    <div className={ds.grid2}>
      <div><label className={ds.label}>Catering</label><input className={ds.input} value={(form.catering as string) || ''} onChange={e => setField('catering', e.target.value)} placeholder="Light snacks, full meal..." /></div>
      <div><label className={ds.label}>Catering Cost ($)</label><input type="number" step="0.01" className={ds.input} value={(form.cateringCost as number) || ''} onChange={e => setField('cateringCost', parseFloat(e.target.value) || 0)} /></div>
    </div>
    <div className={ds.grid2}>
      <div><label className={ds.label}>Ground Transport</label><input className={ds.input} value={(form.groundTransport as string) || ''} onChange={e => setField('groundTransport', e.target.value)} placeholder="Limo, SUV..." /></div>
      <div><label className={ds.label}>Transport Cost ($)</label><input type="number" step="0.01" className={ds.input} value={(form.groundTransportCost as number) || ''} onChange={e => setField('groundTransportCost', parseFloat(e.target.value) || 0)} /></div>
    </div>
    <div className={ds.grid3}>
      <div>
        <label className={ds.label}>Total Price ($)</label>
        <input type="number" step="0.01" className={ds.input} value={(form.totalPrice as number) || ''} onChange={e => setField('totalPrice', parseFloat(e.target.value) || 0)} />
      </div>
      <div><label className={ds.label}>Deposit Paid ($)</label><input type="number" step="0.01" className={ds.input} value={(form.depositPaid as number) || ''} onChange={e => setField('depositPaid', parseFloat(e.target.value) || 0)} /></div>
      <div>
        <label className={ds.label}>Balance Due</label>
        <div className={cn(ds.input, 'bg-lattice-border text-yellow-400 font-bold')}>
          ${(((form.totalPrice as number) || 0) - ((form.depositPaid as number) || 0)).toLocaleString()}
        </div>
      </div>
    </div>
    <div><label className={ds.label}>Special Requests</label><DraftedTextarea lensId="aviation" draftKey="pax_special_requests" initial={(form.specialRequests as string) || ''} onValueChange={(v) => setField('specialRequests', v)} className={cn(ds.textarea, 'h-16')} /></div>
  </div>
);
}

export function WeatherOpsEditor({ form, setField }: EditorProps) {
  return (
  <div className="space-y-4">
    <div className={ds.grid2}>
      <div><label className={ds.label}>Station / Airport (ICAO)</label><input className={ds.input} value={(form.stationId as string) || ''} onChange={e => { setField('stationId', e.target.value.toUpperCase()); setField('_title', e.target.value.toUpperCase()); }} placeholder="KJFK" /></div>
      <div><label className={ds.label}>Flight Category</label>
        <select className={ds.select} value={(form._status as string) || 'VFR'} onChange={e => { setField('_status', e.target.value); setField('flightCategory', e.target.value); }}>
          {FLIGHT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
    </div>
    <div>
      <label className={ds.label}>Raw METAR</label>
      <DraftedTextarea lensId="aviation" draftKey="wx_raw_metar" initial={(form.rawMetar as string) || ''} onValueChange={(v) => setField('rawMetar', v)} className={cn(ds.textarea, 'font-mono text-xs h-16')} placeholder="KJFK 221456Z 27015G25KT 10SM FEW250 08/M04 A3012 RMK AO2..." />
    </div>
    <div><label className={ds.label}>Observation Time (UTC)</label><input type="datetime-local" className={ds.input} value={(form.observationTime as string) || ''} onChange={e => setField('observationTime', e.target.value)} /></div>
    <div className="border-t border-lattice-border pt-4">
      <h4 className={cn(ds.heading3, 'text-sm mb-3')}>Wind</h4>
      <div className={ds.grid3}>
        <div><label className={ds.label}>Direction (°)</label><input type="number" className={ds.input} value={(form.windDirection as number) || ''} onChange={e => setField('windDirection', parseInt(e.target.value) || 0)} placeholder="270" /></div>
        <div><label className={ds.label}>Speed (kt)</label><input type="number" className={ds.input} value={(form.windSpeed as number) || ''} onChange={e => setField('windSpeed', parseInt(e.target.value) || 0)} placeholder="15" /></div>
        <div><label className={ds.label}>Gust (kt)</label><input type="number" className={ds.input} value={(form.windGust as number) || ''} onChange={e => setField('windGust', parseInt(e.target.value) || 0)} placeholder="25" /></div>
      </div>
    </div>
    <div className="border-t border-lattice-border pt-4">
      <h4 className={cn(ds.heading3, 'text-sm mb-3')}>Conditions</h4>
      <div className={ds.grid3}>
        <div><label className={ds.label}>Visibility (SM)</label><input type="number" step="0.25" className={ds.input} value={(form.visibility as number) || ''} onChange={e => setField('visibility', parseFloat(e.target.value) || 0)} placeholder="10" /></div>
        <div><label className={ds.label}>Ceiling (ft AGL)</label><input type="number" className={ds.input} value={(form.ceiling as number) || ''} onChange={e => setField('ceiling', parseInt(e.target.value) || 0)} placeholder="25000" /></div>
        <div><label className={ds.label}>Weather Conditions</label><input className={ds.input} value={(form.wxConditions as string) || ''} onChange={e => setField('wxConditions', e.target.value)} placeholder="RA, SN, BR, FG..." /></div>
      </div>
      <div className={ds.grid2}>
        <div><label className={ds.label}>Temperature (°C)</label><input type="number" className={ds.input} value={(form.temperature as number) ?? ''} onChange={e => setField('temperature', parseInt(e.target.value))} placeholder="8" /></div>
        <div><label className={ds.label}>Dewpoint (°C)</label><input type="number" className={ds.input} value={(form.dewpoint as number) ?? ''} onChange={e => setField('dewpoint', parseInt(e.target.value))} placeholder="-4" /></div>
      </div>
      <div className={ds.grid2}>
        <div><label className={ds.label}>Altimeter (" Hg)</label><input type="number" step="0.01" className={ds.input} value={(form.altimeter as number) || ''} onChange={e => setField('altimeter', parseFloat(e.target.value) || 0)} placeholder="30.12" /></div>
        <div><label className={ds.label}>Cloud Layers</label><input className={ds.input} value={(form.cloudLayers as string) || ''} onChange={e => setField('cloudLayers', e.target.value)} placeholder="FEW250, SCT120, BKN080..." /></div>
      </div>
    </div>
    <div className="border-t border-lattice-border pt-4">
      <h4 className={cn(ds.heading3, 'text-sm mb-3')}>Forecast & Advisories</h4>
      <div><label className={ds.label}>TAF (Terminal Forecast)</label><DraftedTextarea lensId="aviation" draftKey="wx_taf" initial={(form.taf as string) || ''} onValueChange={(v) => setField('taf', v)} className={cn(ds.textarea, 'font-mono text-xs h-20')} placeholder="TAF KJFK 221130Z..." /></div>
      <div><label className={ds.label}>NOTAMs</label><DraftedTextarea lensId="aviation" draftKey="wx_notams" initial={(form.notams as string) || ''} onValueChange={(v) => setField('notams', v)} className={cn(ds.textarea, 'h-16')} placeholder="Active NOTAMs for this station..." /></div>
      <div><label className={ds.label}>PIREPs</label><DraftedTextarea lensId="aviation" draftKey="wx_pireps" initial={(form.pirepSummary as string) || ''} onValueChange={(v) => setField('pirepSummary', v)} className={cn(ds.textarea, 'h-16')} placeholder="Pilot reports of turbulence, icing..." /></div>
      <div className={ds.grid2}>
        <div><label className={ds.label}>AIRMETs</label><DraftedTextarea lensId="aviation" draftKey="wx_airmets" initial={(form.airmets as string) || ''} onValueChange={(v) => setField('airmets', v)} className={cn(ds.textarea, 'h-12')} placeholder="Active AIRMETs..." /></div>
        <div><label className={ds.label}>SIGMETs</label><DraftedTextarea lensId="aviation" draftKey="wx_sigmets" initial={(form.sigmets as string) || ''} onValueChange={(v) => setField('sigmets', v)} className={cn(ds.textarea, 'h-12')} placeholder="Active SIGMETs..." /></div>
      </div>
    </div>
    <div><label className={ds.label}>Remarks</label><DraftedTextarea lensId="aviation" draftKey="wx_remarks" initial={(form.remarks as string) || ''} onValueChange={(v) => setField('remarks', v)} className={cn(ds.textarea, 'h-12')} placeholder="Additional remarks..." /></div>
  </div>
);
}

export function WeightBalanceEditor({ form, setField }: EditorProps) {
  const t = computeWbTotals(form);
  const { emptyWeight: ew, emptyArm: ea, fuelWeight: fw, fuelArm: fa,
    pilotWeight: pw, pilotArm: pa, copilotWeight: cpw, copilotArm: cpa,
    paxRow1Weight: r1w, paxRow1Arm: r1a, paxRow2Weight: r2w, paxRow2Arm: r2a,
    cargoWeight: cw, cargoArm: ca, baggageWeight: bw, baggageArm: ba,
    totalWeight: totalW, totalMoment: totalM, cg: cgCalc, maxGross: mg,
    fwdCGLimit: fwdL, aftCGLimit: aftL, withinLimits: inLimits } = t;
  return (
    <div className="space-y-4">
    <div className={ds.grid2}>
      <div><label className={ds.label}>W&B Title</label><input className={ds.input} value={(form._title as string) || ''} onChange={e => setField('_title', e.target.value)} placeholder="W&B calculation name..." /></div>
      <div><label className={ds.label}>Date</label><input type="date" className={ds.input} value={(form.date as string) || ''} onChange={e => setField('date', e.target.value)} /></div>
    </div>
    <div className={ds.grid2}>
      <div><label className={ds.label}>Aircraft</label><input className={ds.input} value={(form.aircraft as string) || ''} onChange={e => setField('aircraft', e.target.value)} placeholder="C172S" /></div>
      <div><label className={ds.label}>Tail Number</label><input className={ds.input} value={(form.tailNumber as string) || ''} onChange={e => setField('tailNumber', e.target.value)} placeholder="N12345" /></div>
    </div>

    <div className="border-t border-lattice-border pt-4">
      <h4 className={cn(ds.heading3, 'text-sm mb-3')}>Loading Stations</h4>
      <div className="space-y-2">
        {/* Table header */}
        <div className="grid grid-cols-3 gap-2 text-xs text-gray-400 font-medium px-1">
          <span>Station</span><span>Weight (lbs)</span><span>Arm (in)</span>
        </div>
        {/* Empty weight */}
        <div className="grid grid-cols-3 gap-2 items-center">
          <span className={cn(ds.label, 'mb-0')}>Empty Weight</span>
          <input type="number" className={ds.input} value={ew || ''} onChange={e => setField('emptyWeight', parseFloat(e.target.value) || 0)} />
          <input type="number" step="0.01" className={ds.input} value={ea || ''} onChange={e => setField('emptyArm', parseFloat(e.target.value) || 0)} />
        </div>
        {/* Fuel */}
        <div className="grid grid-cols-3 gap-2 items-center">
          <span className={cn(ds.label, 'mb-0')}>Fuel</span>
          <input type="number" className={ds.input} value={fw || ''} onChange={e => setField('fuelWeight', parseFloat(e.target.value) || 0)} />
          <input type="number" step="0.01" className={ds.input} value={fa || ''} onChange={e => setField('fuelArm', parseFloat(e.target.value) || 0)} />
        </div>
        {/* Pilot */}
        <div className="grid grid-cols-3 gap-2 items-center">
          <span className={cn(ds.label, 'mb-0')}>Pilot</span>
          <input type="number" className={ds.input} value={pw || ''} onChange={e => setField('pilotWeight', parseFloat(e.target.value) || 0)} />
          <input type="number" step="0.01" className={ds.input} value={pa || ''} onChange={e => setField('pilotArm', parseFloat(e.target.value) || 0)} />
        </div>
        {/* Copilot */}
        <div className="grid grid-cols-3 gap-2 items-center">
          <span className={cn(ds.label, 'mb-0')}>Copilot / Front PAX</span>
          <input type="number" className={ds.input} value={cpw || ''} onChange={e => setField('copilotWeight', parseFloat(e.target.value) || 0)} />
          <input type="number" step="0.01" className={ds.input} value={cpa || ''} onChange={e => setField('copilotArm', parseFloat(e.target.value) || 0)} />
        </div>
        {/* Row 1 */}
        <div className="grid grid-cols-3 gap-2 items-center">
          <span className={cn(ds.label, 'mb-0')}>PAX Row 1</span>
          <input type="number" className={ds.input} value={r1w || ''} onChange={e => setField('paxRow1Weight', parseFloat(e.target.value) || 0)} />
          <input type="number" step="0.01" className={ds.input} value={r1a || ''} onChange={e => setField('paxRow1Arm', parseFloat(e.target.value) || 0)} />
        </div>
        {/* Row 2 */}
        <div className="grid grid-cols-3 gap-2 items-center">
          <span className={cn(ds.label, 'mb-0')}>PAX Row 2</span>
          <input type="number" className={ds.input} value={r2w || ''} onChange={e => setField('paxRow2Weight', parseFloat(e.target.value) || 0)} />
          <input type="number" step="0.01" className={ds.input} value={r2a || ''} onChange={e => setField('paxRow2Arm', parseFloat(e.target.value) || 0)} />
        </div>
        {/* Cargo */}
        <div className="grid grid-cols-3 gap-2 items-center">
          <span className={cn(ds.label, 'mb-0')}>Cargo</span>
          <input type="number" className={ds.input} value={cw || ''} onChange={e => setField('cargoWeight', parseFloat(e.target.value) || 0)} />
          <input type="number" step="0.01" className={ds.input} value={ca || ''} onChange={e => setField('cargoArm', parseFloat(e.target.value) || 0)} />
        </div>
        {/* Baggage */}
        <div className="grid grid-cols-3 gap-2 items-center">
          <span className={cn(ds.label, 'mb-0')}>Baggage</span>
          <input type="number" className={ds.input} value={bw || ''} onChange={e => setField('baggageWeight', parseFloat(e.target.value) || 0)} />
          <input type="number" step="0.01" className={ds.input} value={ba || ''} onChange={e => setField('baggageArm', parseFloat(e.target.value) || 0)} />
        </div>
      </div>
    </div>

    <div className="border-t border-lattice-border pt-4">
      <h4 className={cn(ds.heading3, 'text-sm mb-3')}>CG Envelope Limits</h4>
      <div className={ds.grid3}>
        <div><label className={ds.label}>Max Gross (lbs)</label><input type="number" className={ds.input} value={mg < 99999 ? mg : ''} onChange={e => setField('maxGross', parseFloat(e.target.value) || 0)} /></div>
        <div><label className={ds.label}>Fwd CG Limit (in)</label><input type="number" step="0.01" className={ds.input} value={fwdL || ''} onChange={e => setField('fwdCGLimit', parseFloat(e.target.value) || 0)} /></div>
        <div><label className={ds.label}>Aft CG Limit (in)</label><input type="number" step="0.01" className={ds.input} value={aftL < 999 ? aftL : ''} onChange={e => setField('aftCGLimit', parseFloat(e.target.value) || 0)} /></div>
      </div>
    </div>

    {/* Live Results */}
    <div className={cn(ds.panel, 'border-2', inLimits ? 'border-green-500/50 bg-green-500/5' : 'border-red-500/50 bg-red-500/5')}>
      <div className="flex items-center gap-2 mb-3">
        {inLimits ? <CheckCircle className="w-5 h-5 text-green-400" /> : <XCircle className="w-5 h-5 text-red-400" />}
        <h4 className={cn(ds.heading3, 'text-sm')}>{inLimits ? 'WITHIN LIMITS' : 'OUT OF LIMITS - DO NOT FLY'}</h4>
      </div>
      <div className={ds.grid4}>
        <div>
          <div className="text-xs text-gray-400">Total Weight</div>
          <div className={cn('text-lg font-bold', totalW > mg ? 'text-red-400' : 'text-white')}>{totalW.toFixed(1)} lbs</div>
        </div>
        <div>
          <div className="text-xs text-gray-400">Total Moment</div>
          <div className="text-lg font-bold text-white">{totalM.toFixed(1)}</div>
        </div>
        <div>
          <div className="text-xs text-gray-400">CG Location</div>
          <div className={cn('text-lg font-bold', (cgCalc < fwdL || cgCalc > aftL) ? 'text-red-400' : 'text-white')}>{cgCalc.toFixed(2)} in</div>
        </div>
        <div>
          <div className="text-xs text-gray-400">Max Gross</div>
          <div className="text-lg font-bold text-white">{mg < 99999 ? `${mg} lbs` : 'N/A'}</div>
        </div>
      </div>
      {/* CG bar indicator */}
      {fwdL > 0 && aftL < 999 && (
        <div className="mt-3">
          <div className="flex justify-between text-xs text-gray-400 mb-1">
            <span>Fwd: {fwdL}"</span><span>Aft: {aftL}"</span>
          </div>
          <div className="h-4 bg-lattice-border rounded-full relative overflow-hidden">
            <div className="absolute inset-y-0 bg-green-500/30 rounded-full" style={{ left: '5%', right: '5%' }} />
            <div className={cn('absolute top-0 w-2 h-4 rounded-full', inLimits ? 'bg-green-400' : 'bg-red-400')} style={{
              left: `${Math.max(2, Math.min(98, ((cgCalc - fwdL) / (aftL - fwdL)) * 90 + 5))}%`
            }} />
          </div>
        </div>
      )}
    </div>
  </div>
  );
}

