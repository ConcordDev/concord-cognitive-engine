'use client';

import {
  Plane, Navigation, MapPin, Calendar, Clock, CloudRain, UserCheck, Award,
  AlertTriangle, FileText, Wrench, DollarSign, Package, Weight, CheckCircle,
  XCircle, Wind, Eye, Thermometer, Droplets,
} from 'lucide-react';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { LensItem } from '@/lib/hooks/use-lens-data';
import {
  statusBadge, formatHobbs, currencyStatus, daysUntil,
  type PilotData, type AircraftData, type MaintenanceData, type CharterData,
  type WBData, type WeatherData,
} from './aviation-ops';

type CardProps = { item: LensItem; onOpen: (item: LensItem) => void };

export function FlightCard({ item, onOpen }: CardProps) {
  const d = item.data as Record<string, unknown>;
  const hobbs = formatHobbs(d.hobbsStart as number, d.hobbsEnd as number);
  return (
    <div key={item.id} className={ds.panelHover} onClick={() => onOpen(item)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
      <div className="flex items-start justify-between mb-2">
        <Plane className="w-5 h-5 text-sky-400" />
        <span className={statusBadge(item.meta?.status || 'planned')}>{item.meta?.status}</span>
      </div>
      <h3 className="font-semibold text-white mb-1 truncate">{item.title}</h3>
      {!!(d.departure || d.arrival) && (
        <div className="flex items-center gap-2 text-sm mb-2">
          <MapPin className="w-3 h-3 text-green-400" />
          <span className="text-white font-mono text-xs">{String(d.departure || '????')}</span>
          <Navigation className="w-3 h-3 text-gray-400" />
          <span className="text-white font-mono text-xs">{String(d.arrival || '????')}</span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-1 text-xs mt-2">
        {!!d.aircraft && <><span className="text-gray-400">Aircraft:</span><span className="text-white">{String(d.aircraft)}</span></>}
        {!!d.tailNumber && <><span className="text-gray-400">Tail #:</span><span className="text-white font-mono">{String(d.tailNumber)}</span></>}
        {!!d.pic && <><span className="text-gray-400">PIC:</span><span className="text-white">{String(d.pic)}</span></>}
        {!!d.passengers && <><span className="text-gray-400">PAX:</span><span className="text-white">{String(d.passengers)}</span></>}
        <span className="text-gray-400">Hobbs:</span><span className="text-white">{hobbs}</span>
        {!!d.fuelBurn && <><span className="text-gray-400">Fuel:</span><span className="text-white">{String(d.fuelBurn)} gal</span></>}
      </div>
      {!!d.weatherMins && (
        <div className="flex items-center gap-1 text-xs text-cyan-400 mt-2">
          <CloudRain className="w-3 h-3" /> WX Mins: {String(d.weatherMins)}
        </div>
      )}
      <div className="flex items-center justify-between text-xs text-gray-400 mt-3 pt-2 border-t border-lattice-border">
        {!!d.date && <span><Calendar className="w-3 h-3 inline mr-1" />{String(d.date)}</span>}
        <span><Clock className="w-3 h-3 inline mr-1" />{new Date(item.updatedAt).toLocaleDateString()}</span>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// Pilot cards
// -----------------------------------------------------------------------
export function PilotCard({ item, onOpen }: CardProps) {
  const d = item.data as unknown as PilotData;
  const medStatus = currencyStatus(d.medicalExpiry);
  const bfrStatus = currencyStatus(d.bfrDate);
  return (
    <div key={item.id} className={ds.panelHover} onClick={() => onOpen(item)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <UserCheck className="w-5 h-5 text-blue-400" />
          <span className={statusBadge(medStatus)}>{d.medicalClass || 'No Medical'}</span>
        </div>
        <Award className="w-4 h-4 text-amber-400" />
      </div>
      <h3 className="font-semibold text-white mb-1 truncate">{d.name || item.title}</h3>
      <div className="text-xs text-gray-400 mb-2">{d.certificate || '--'} | #{d.certificateNumber || '--'}</div>
      {d.ratings && d.ratings.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {d.ratings.map(r => <span key={r} className="text-xs px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400">{r}</span>)}
        </div>
      )}
      {d.typeRatings && d.typeRatings.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {d.typeRatings.map(r => <span key={r} className="text-xs px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400">{r}</span>)}
        </div>
      )}
      <div className="grid grid-cols-2 gap-1 text-xs mt-2">
        <span className="text-gray-400">Total:</span><span className="text-white">{d.totalHours || 0}h</span>
        <span className="text-gray-400">PIC:</span><span className="text-white">{d.picHours || 0}h</span>
        <span className="text-gray-400">Night:</span><span className="text-white">{d.nightHours || 0}h</span>
        <span className="text-gray-400">IFR:</span><span className="text-white">{d.instrumentHours || 0}h</span>
        <span className="text-gray-400">XC:</span><span className="text-white">{d.crossCountryHours || 0}h</span>
        <span className="text-gray-400">Multi:</span><span className="text-white">{d.multiEngineHours || 0}h</span>
      </div>
      <div className="flex gap-2 mt-3 pt-2 border-t border-lattice-border">
        <span className={statusBadge(medStatus)}>Med {d.medicalExpiry || 'N/A'}</span>
        <span className={statusBadge(bfrStatus)}>BFR {d.bfrDate || 'N/A'}</span>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// Aircraft cards
// -----------------------------------------------------------------------
export function AircraftOpsCard({ item, onOpen }: CardProps) {
  const d = item.data as unknown as AircraftData;
  const annualDays = daysUntil(d.nextAnnual);
  return (
    <div key={item.id} className={ds.panelHover} onClick={() => onOpen(item)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
      <div className="flex items-start justify-between mb-2">
        <Navigation className="w-5 h-5 text-cyan-400" />
        <span className={statusBadge(item.meta?.status || 'airworthy')}>{item.meta?.status}</span>
      </div>
      <h3 className="font-bold text-white mb-0.5 font-mono">{d.tailNumber || item.title}</h3>
      <div className={ds.textMuted}>{d.make} {d.model} {d.year ? `(${d.year})` : ''}</div>
      <div className="grid grid-cols-2 gap-1 text-xs mt-3">
        <span className="text-gray-400">Total Time:</span><span className="text-white">{d.totalTime?.toFixed(1) || 0}h</span>
        <span className="text-gray-400">TSMOH:</span><span className="text-white">{d.tsmoh?.toFixed(1) || 0}h</span>
        <span className="text-gray-400">TSPOH:</span><span className="text-white">{d.tspoh?.toFixed(1) || 0}h</span>
        <span className="text-gray-400">Engine:</span><span className="text-white">{d.engType || '--'} {d.engHP ? `${d.engHP}hp` : ''}</span>
        <span className="text-gray-400">Fuel Cap:</span><span className="text-white">{d.fuelCapacity || '--'} gal</span>
        <span className="text-gray-400">Useful Load:</span><span className="text-white">{d.usefulLoad || '--'} lbs</span>
      </div>
      <div className="mt-3 pt-2 border-t border-lattice-border space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-400">Next Annual:</span>
          <span className={cn(annualDays < 30 ? 'text-red-400 font-bold' : annualDays < 60 ? 'text-yellow-400' : 'text-white')}>
            {d.nextAnnual || 'N/A'} {annualDays < 90 && annualDays > -999 ? `(${annualDays}d)` : ''}
          </span>
        </div>
        {d.next100hr !== undefined && d.next100hr > 0 && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-400">Next 100hr:</span>
            <span className={cn(d.next100hr < 10 ? 'text-red-400 font-bold' : d.next100hr < 25 ? 'text-yellow-400' : 'text-white')}>
              {d.next100hr.toFixed(1)}h remaining
            </span>
          </div>
        )}
      </div>
      {d.squawks && d.squawks.length > 0 && (
        <div className="mt-2 text-xs text-yellow-400 flex items-center gap-1">
          <AlertTriangle className="w-3 h-3" /> {d.squawks.length} squawk{d.squawks.length > 1 ? 's' : ''}
        </div>
      )}
      {d.adCompliance && d.adCompliance.length > 0 && (
        <div className="mt-1 text-xs text-red-400 flex items-center gap-1">
          <FileText className="w-3 h-3" /> {d.adCompliance.length} AD{d.adCompliance.length > 1 ? 's' : ''} tracked
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------
// Maintenance cards
// -----------------------------------------------------------------------
export function MaintenanceCard({ item, onOpen }: CardProps) {
  const d = item.data as unknown as MaintenanceData;
  return (
    <div key={item.id} className={ds.panelHover} onClick={() => onOpen(item)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
      <div className="flex items-start justify-between mb-2">
        <Wrench className="w-5 h-5 text-orange-400" />
        <div className="flex gap-1">
          <span className={statusBadge(d.priority || 'routine')}>{d.priority || 'routine'}</span>
          <span className={statusBadge(d.category || 'unscheduled')}>{d.category || 'unscheduled'}</span>
        </div>
      </div>
      <h3 className="font-semibold text-white mb-1 truncate">{item.title}</h3>
      {d.workOrderNumber && <div className="text-xs font-mono text-gray-400 mb-1">WO# {d.workOrderNumber}</div>}
      <div className="text-sm text-gray-300 mb-2 line-clamp-2">{d.discrepancy}</div>
      <div className="grid grid-cols-2 gap-1 text-xs">
        {d.tailNumber && <><span className="text-gray-400">Aircraft:</span><span className="text-white font-mono">{d.tailNumber}</span></>}
        {d.melReference && <><span className="text-gray-400">MEL Ref:</span><span className="text-yellow-400">{d.melReference}</span></>}
        {d.laborHours && <><span className="text-gray-400">Labor:</span><span className="text-white">{d.laborHours}h</span></>}
        {d.mechanic && <><span className="text-gray-400">Mechanic:</span><span className="text-white">{d.mechanic}</span></>}
        {d.adReference && <><span className="text-gray-400">AD:</span><span className="text-red-400">{d.adReference}</span></>}
        {d.sbReference && <><span className="text-gray-400">SB:</span><span className="text-yellow-400">{d.sbReference}</span></>}
      </div>
      {d.componentName && (
        <div className="mt-2 pt-2 border-t border-lattice-border text-xs">
          <span className="text-gray-400">Component:</span> <span className="text-white">{d.componentName}</span>
          {d.componentLifeLimit > 0 && (
            <span className={cn('ml-2', d.componentTSN / d.componentLifeLimit > 0.9 ? 'text-red-400' : 'text-gray-400')}>
              ({d.componentTSN || 0}/{d.componentLifeLimit}h)
            </span>
          )}
        </div>
      )}
      <div className="flex items-center justify-between text-xs text-gray-400 mt-3 pt-2 border-t border-lattice-border">
        {d.dateOpened && <span>Opened: {d.dateOpened}</span>}
        {d.dateClosed ? <span className="text-green-400">Closed: {d.dateClosed}</span> : <span className="text-yellow-400">Open</span>}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// Charter cards
// -----------------------------------------------------------------------
export function CharterCard({ item, onOpen }: CardProps) {
  const d = item.data as unknown as CharterData;
  return (
    <div key={item.id} className={ds.panelHover} onClick={() => onOpen(item)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
      <div className="flex items-start justify-between mb-2">
        <DollarSign className="w-5 h-5 text-emerald-400" />
        <span className={statusBadge(item.meta?.status || 'inquiry')}>{item.meta?.status}</span>
      </div>
      <h3 className="font-semibold text-white mb-1 truncate">{item.title}</h3>
      {d.confirmationNumber && <div className="text-xs font-mono text-emerald-400 mb-1">Conf# {d.confirmationNumber}</div>}
      {(d.departure || d.arrival) && (
        <div className="flex items-center gap-2 text-sm mb-2">
          <MapPin className="w-3 h-3 text-green-400" />
          <span className="text-white font-mono text-xs">{d.departure || '????'}</span>
          <Navigation className="w-3 h-3 text-gray-400" />
          <span className="text-white font-mono text-xs">{d.arrival || '????'}</span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-1 text-xs mt-2">
        {d.clientName && <><span className="text-gray-400">Client:</span><span className="text-white">{d.clientName}</span></>}
        {d.aircraft && <><span className="text-gray-400">Aircraft:</span><span className="text-white">{d.aircraft}</span></>}
        {d.passengerCount && <><span className="text-gray-400">PAX:</span><span className="text-white">{d.passengerCount}</span></>}
        {d.distanceNM && <><span className="text-gray-400">Distance:</span><span className="text-white">{d.distanceNM} NM</span></>}
      </div>
      {d.totalPrice && (
        <div className="mt-3 pt-2 border-t border-lattice-border">
          <div className="flex items-center justify-between">
            <span className="text-gray-400 text-xs">Total Price:</span>
            <span className="text-emerald-400 font-bold">${d.totalPrice.toLocaleString()}</span>
          </div>
          {d.depositPaid > 0 && (
            <div className="flex items-center justify-between text-xs mt-1">
              <span className="text-gray-400">Deposit:</span>
              <span className="text-green-400">${d.depositPaid.toLocaleString()}</span>
            </div>
          )}
        </div>
      )}
      {d.catering && <div className="text-xs text-purple-400 mt-1"><Package className="w-3 h-3 inline mr-1" />{d.catering}</div>}
      {d.date && <div className="text-xs text-gray-400 mt-2"><Calendar className="w-3 h-3 inline mr-1" />{d.date}{d.returnDate ? ` - ${d.returnDate}` : ''}</div>}
    </div>
  );
}

// -----------------------------------------------------------------------
// Weight & Balance cards
// -----------------------------------------------------------------------
export function WeightBalanceCard({ item, onOpen }: CardProps) {
  const d = item.data as unknown as WBData;
  const withinLimits = d.withinLimits !== false && d.totalWeight <= (d.maxGross || 99999) && d.cg >= (d.fwdCGLimit || 0) && d.cg <= (d.aftCGLimit || 999);
  return (
    <div key={item.id} className={cn(ds.panelHover, withinLimits ? '' : 'border-red-500/50')} onClick={() => onOpen(item)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
      <div className="flex items-start justify-between mb-2">
        <Weight className="w-5 h-5 text-violet-400" />
        {withinLimits ? (
          <span className="inline-flex items-center gap-1 text-xs text-green-400"><CheckCircle className="w-3 h-3" /> Within Limits</span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-red-400"><XCircle className="w-3 h-3" /> OUT OF LIMITS</span>
        )}
      </div>
      <h3 className="font-semibold text-white mb-1 truncate">{item.title}</h3>
      <div className="text-xs text-gray-400 mb-2 font-mono">{d.tailNumber || '--'}</div>
      <div className="grid grid-cols-2 gap-1 text-xs">
        <span className="text-gray-400">Empty Wt:</span><span className="text-white">{d.emptyWeight || 0} lbs</span>
        <span className="text-gray-400">Fuel:</span><span className="text-white">{d.fuelWeight || 0} lbs</span>
        <span className="text-gray-400">Payload:</span><span className="text-white">{((d.pilotWeight || 0) + (d.copilotWeight || 0) + (d.paxRow1Weight || 0) + (d.paxRow2Weight || 0) + (d.cargoWeight || 0) + (d.baggageWeight || 0))} lbs</span>
        <span className="text-gray-400">Total:</span><span className={cn('font-bold', d.totalWeight > (d.maxGross || 99999) ? 'text-red-400' : 'text-white')}>{d.totalWeight || 0} lbs</span>
        <span className="text-gray-400">Max Gross:</span><span className="text-white">{d.maxGross || '--'} lbs</span>
        <span className="text-gray-400">CG:</span><span className={cn('font-bold', (d.cg < (d.fwdCGLimit || 0) || d.cg > (d.aftCGLimit || 999)) ? 'text-red-400' : 'text-white')}>{d.cg?.toFixed(2) || '--'} in</span>
      </div>
      <div className="mt-2 text-xs text-gray-400">
        CG Limits: {d.fwdCGLimit || '--'} - {d.aftCGLimit || '--'} in
      </div>
      {/* CG visual bar */}
      {d.fwdCGLimit && d.aftCGLimit && d.cg && (
        <div className="mt-2 h-3 bg-lattice-border rounded-full relative overflow-hidden">
          <div className="absolute inset-y-0 bg-green-500/30 rounded-full" style={{
            left: '10%', right: '10%'
          }} />
          <div className={cn('absolute top-0 w-1.5 h-3 rounded-full', withinLimits ? 'bg-green-400' : 'bg-red-400')} style={{
            left: `${Math.max(5, Math.min(95, ((d.cg - d.fwdCGLimit) / (d.aftCGLimit - d.fwdCGLimit)) * 80 + 10))}%`
          }} />
        </div>
      )}
      {d.date && <div className="text-xs text-gray-400 mt-2"><Calendar className="w-3 h-3 inline mr-1" />{d.date}</div>}
    </div>
  );
}

// -----------------------------------------------------------------------
// Weather cards
// -----------------------------------------------------------------------
export function WeatherOpsCard({ item, onOpen }: CardProps) {
  const d = item.data as unknown as WeatherData;
  const cat = d.flightCategory || 'VFR';
  const catColor = cat === 'VFR' ? 'text-green-400' : cat === 'MVFR' ? 'text-blue-400' : cat === 'IFR' ? 'text-red-400' : 'text-purple-400';
  const catBg = cat === 'VFR' ? 'border-l-green-500' : cat === 'MVFR' ? 'border-l-blue-500' : cat === 'IFR' ? 'border-l-red-500' : 'border-l-purple-500';
  return (
    <div key={item.id} className={cn(ds.panelHover, 'border-l-4', catBg)} onClick={() => onOpen(item)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <CloudRain className="w-5 h-5 text-cyan-400" />
          <span className="font-mono text-white font-bold text-sm">{d.stationId || item.title}</span>
        </div>
        <span className={cn('text-sm font-bold', catColor)}>{cat}</span>
      </div>
      {d.rawMetar && (
        <div className="bg-lattice-elevated rounded p-2 mb-2">
          <p className="font-mono text-xs text-cyan-300 break-all">{d.rawMetar}</p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-1 text-xs">
        <span className="text-gray-400 flex items-center gap-1"><Wind className="w-3 h-3" />Wind:</span>
        <span className="text-white">{d.windDirection || '--'}° @ {d.windSpeed || '--'}kt{d.windGust ? ` G${d.windGust}` : ''}</span>
        <span className="text-gray-400 flex items-center gap-1"><Eye className="w-3 h-3" />Vis:</span>
        <span className="text-white">{d.visibility || '--'} SM</span>
        <span className="text-gray-400 flex items-center gap-1"><CloudRain className="w-3 h-3" />Ceiling:</span>
        <span className={cn('text-white', (d.ceiling || 99999) < 1000 ? 'text-red-400 font-bold' : '')}>{d.ceiling ? `${d.ceiling} ft` : 'CLR'}</span>
        <span className="text-gray-400 flex items-center gap-1"><Thermometer className="w-3 h-3" />Temp:</span>
        <span className="text-white">{d.temperature !== undefined ? `${d.temperature}°C` : '--'} / {d.dewpoint !== undefined ? `${d.dewpoint}°C` : '--'}</span>
        <span className="text-gray-400">Altimeter:</span>
        <span className="text-white">{d.altimeter ? `${d.altimeter}" Hg` : '--'}</span>
      </div>
      {d.cloudLayers && (
        <div className="text-xs text-gray-400 mt-2">
          <span className="text-gray-400">Clouds:</span> {d.cloudLayers}
        </div>
      )}
      {d.wxConditions && (
        <div className="text-xs mt-1 flex items-center gap-1">
          <Droplets className="w-3 h-3 text-blue-400" />
          <span className="text-blue-400">{d.wxConditions}</span>
        </div>
      )}
      {d.sigmets && (
        <div className="text-xs text-red-400 mt-1 flex items-center gap-1">
          <AlertTriangle className="w-3 h-3" /> SIGMET: {d.sigmets}
        </div>
      )}
      {d.airmets && (
        <div className="text-xs text-yellow-400 mt-1 flex items-center gap-1">
          <AlertTriangle className="w-3 h-3" /> AIRMET: {d.airmets}
        </div>
      )}
      <div className="flex items-center text-xs text-gray-400 mt-2 pt-2 border-t border-lattice-border">
        <Clock className="w-3 h-3 mr-1" />{d.observationTime || new Date(item.updatedAt).toLocaleString()}
      </div>
    </div>
  );
}

