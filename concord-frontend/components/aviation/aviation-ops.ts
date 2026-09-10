/** Shared ops types, catalogs, and honest formatters for the aviation lens. */

export type OpsKind = 'flights' | 'pilots' | 'fleet' | 'maintenance' | 'charter' | 'wb' | 'weather';

export interface PilotData {
  name: string;
  employeeId: string;
  certificate: string;
  certificateNumber: string;
  ratings: string[];
  typeRatings: string[];
  medicalClass: string;
  medicalExpiry: string;
  bfrDate: string;
  ipcDate: string;
  totalHours: number;
  picHours: number;
  sicHours: number;
  nightHours: number;
  instrumentHours: number;
  crossCountryHours: number;
  multiEngineHours: number;
  last30Days: number;
  last90Days: number;
  last12Months: number;
  dutyOnTime: string;
  dutyOffTime: string;
  restStart: string;
  flightRegulation: string;
  phone: string;
  email: string;
  baseAirport: string;
}

export interface AircraftData {
  tailNumber: string;
  type: string;
  make: string;
  model: string;
  year: number;
  serialNumber: string;
  totalTime: number;
  tsmoh: number;
  tspoh: number;
  nextAnnual: string;
  next100hr: number;
  adCompliance: string[];
  squawks: string[];
  emptyWeight: number;
  emptyCG: number;
  maxGross: number;
  fuelCapacity: number;
  usefulLoad: number;
  stations: string;
  engType: string;
  engHP: number;
  avionics: string;
  insuranceExpiry: string;
  registrationExpiry: string;
}

export interface MaintenanceData {
  aircraft: string;
  tailNumber: string;
  workOrderNumber: string;
  discrepancy: string;
  melReference: string;
  partsUsed: string;
  laborHours: number;
  mechanic: string;
  mechanicCert: string;
  inspector: string;
  inspectorCert: string;
  adReference: string;
  sbReference: string;
  componentName: string;
  componentTSN: number;
  componentLifeLimit: number;
  dateOpened: string;
  dateClosed: string;
  category: string;
  priority: string;
}

export interface CharterData {
  clientName: string;
  clientPhone: string;
  clientEmail: string;
  departure: string;
  arrival: string;
  date: string;
  returnDate: string;
  aircraft: string;
  passengerCount: number;
  passengerNames: string;
  catering: string;
  groundTransport: string;
  distanceNM: number;
  ratePerNM: number;
  baseFee: number;
  fuelSurcharge: number;
  cateringCost: number;
  groundTransportCost: number;
  totalPrice: number;
  depositPaid: number;
  specialRequests: string;
  confirmationNumber: string;
}

export interface WBData {
  aircraft: string;
  tailNumber: string;
  emptyWeight: number;
  emptyArm: number;
  emptyMoment: number;
  fuelWeight: number;
  fuelArm: number;
  pilotWeight: number;
  pilotArm: number;
  copilotWeight: number;
  copilotArm: number;
  paxRow1Weight: number;
  paxRow1Arm: number;
  paxRow2Weight: number;
  paxRow2Arm: number;
  cargoWeight: number;
  cargoArm: number;
  baggageWeight: number;
  baggageArm: number;
  totalWeight: number;
  totalMoment: number;
  cg: number;
  maxGross: number;
  fwdCGLimit: number;
  aftCGLimit: number;
  withinLimits: boolean;
  date: string;
}

export interface WeatherData {
  stationId: string;
  observationTime: string;
  rawMetar: string;
  windDirection: number;
  windSpeed: number;
  windGust: number;
  visibility: number;
  ceiling: number;
  temperature: number;
  dewpoint: number;
  altimeter: number;
  flightCategory: string;
  wxConditions: string;
  cloudLayers: string;
  remarks: string;
  taf: string;
  notams: string;
  pirepSummary: string;
  airmets: string;
  sigmets: string;
}

export const FLIGHT_STATUSES = ['planned', 'dispatched', 'airborne', 'completed', 'cancelled', 'diverted'];
export const PILOT_CERTS = ['PPL', 'CPL', 'ATP'];
export const PILOT_RATINGS = ['IFR', 'Multi-Engine', 'SEL', 'SES', 'MEL', 'MES'];
export const AIRCRAFT_STATUSES = ['airworthy', 'in-maintenance', 'grounded', 'stored'];
export const MX_CATEGORIES = ['scheduled', 'unscheduled', 'ad-compliance', 'sb-compliance', 'inspection', 'overhaul'];
export const MX_PRIORITIES = ['routine', 'priority', 'AOG', 'safety'];
export const CHARTER_STATUSES = ['inquiry', 'quoted', 'confirmed', 'completed', 'cancelled'];
export const FLIGHT_REGS = ['14 CFR 91', '14 CFR 91.1059', '14 CFR 135.267', '14 CFR 121'];
export const FLIGHT_CATEGORIES = ['VFR', 'MVFR', 'IFR', 'LIFR'];

export const STATUS_COLORS: Record<string, string> = {
  planned: 'blue-400', dispatched: 'yellow-400', airborne: 'green-400',
  completed: 'gray-400', cancelled: 'red-400', diverted: 'orange-400',
  airworthy: 'green-400', 'in-maintenance': 'orange-400', grounded: 'red-400',
  stored: 'purple-400', routine: 'blue-400', priority: 'yellow-400',
  AOG: 'red-400', safety: 'red-500', inquiry: 'blue-400', quoted: 'yellow-400',
  confirmed: 'green-400', current: 'green-400', expiring: 'yellow-400', expired: 'red-400',
  scheduled: 'blue-400', unscheduled: 'orange-400', 'ad-compliance': 'red-400',
  'sb-compliance': 'yellow-400', inspection: 'cyan-400', overhaul: 'purple-400',
  VFR: 'green-400', MVFR: 'blue-400', IFR: 'red-400', LIFR: 'purple-400',
};

const BADGE_CLASS: Record<string, string> = {
  'blue-400': 'bg-blue-500/20 text-blue-400',
  'yellow-400': 'bg-yellow-500/20 text-yellow-400',
  'green-400': 'bg-green-500/20 text-green-400',
  'gray-400': 'bg-gray-500/20 text-gray-400',
  'red-400': 'bg-red-500/20 text-red-400',
  'orange-400': 'bg-orange-500/20 text-orange-400',
  'purple-400': 'bg-purple-500/20 text-purple-400',
  'red-500': 'bg-red-500/20 text-red-500',
  'cyan-400': 'bg-cyan-500/20 text-cyan-400',
};

export function statusBadge(status: string): string {
  const color = STATUS_COLORS[status] || 'gray-400';
  const tone = BADGE_CLASS[color] || 'bg-gray-500/20 text-gray-400';
  return `inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${tone}`;
}

export function getTypeForKind(kind: OpsKind): string {
  switch (kind) {
    case 'flights': return 'Flight';
    case 'pilots': return 'Pilot';
    case 'fleet': return 'Aircraft';
    case 'maintenance': return 'WorkOrder';
    case 'charter': return 'Charter';
    case 'wb': return 'WeightBalance';
    case 'weather': return 'Weather';
  }
}

export function getStatusesForKind(kind: OpsKind): string[] {
  switch (kind) {
    case 'flights': return FLIGHT_STATUSES;
    case 'fleet': return AIRCRAFT_STATUSES;
    case 'maintenance': return MX_CATEGORIES;
    case 'charter': return CHARTER_STATUSES;
    case 'weather': return FLIGHT_CATEGORIES;
    default: return [];
  }
}

export function daysUntil(dateStr: string): number {
  if (!dateStr) return 999;
  const d = new Date(dateStr);
  const now = new Date();
  return Math.floor((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

export function currencyStatus(dateStr: string): string {
  const days = daysUntil(dateStr);
  if (days < 0) return 'expired';
  if (days < 30) return 'expiring';
  return 'current';
}

export function formatHobbs(start: number, end: number): string {
  if (!start && !end) return '--';
  if (end && start) return `${(end - start).toFixed(1)}h`;
  return `${(start || 0).toFixed(1)}`;
}

export type FormFields = Record<string, unknown>;
export type SetField = (key: string, value: unknown) => void;

export function num(form: FormFields, key: string): number {
  return (form[key] as number) || 0;
}

/** Live W&B totals from the flat editor shape the calculate-wb / validate-wb macros read. */
export function computeWbTotals(form: FormFields) {
  const ew = num(form, 'emptyWeight');
  const ea = num(form, 'emptyArm');
  const fw = num(form, 'fuelWeight');
  const fa = num(form, 'fuelArm');
  const pw = num(form, 'pilotWeight');
  const pa = num(form, 'pilotArm');
  const cpw = num(form, 'copilotWeight');
  const cpa = num(form, 'copilotArm');
  const r1w = num(form, 'paxRow1Weight');
  const r1a = num(form, 'paxRow1Arm');
  const r2w = num(form, 'paxRow2Weight');
  const r2a = num(form, 'paxRow2Arm');
  const cw = num(form, 'cargoWeight');
  const ca = num(form, 'cargoArm');
  const bw = num(form, 'baggageWeight');
  const ba = num(form, 'baggageArm');
  const totalWeight = ew + fw + pw + cpw + r1w + r2w + cw + bw;
  const totalMoment = ew * ea + fw * fa + pw * pa + cpw * cpa + r1w * r1a + r2w * r2a + cw * ca + bw * ba;
  const cg = totalWeight > 0 ? totalMoment / totalWeight : 0;
  const maxGross = (form.maxGross as number) || 99999;
  const fwdCGLimit = (form.fwdCGLimit as number) || 0;
  const aftCGLimit = (form.aftCGLimit as number) || 999;
  const withinLimits = totalWeight <= maxGross && cg >= fwdCGLimit && cg <= aftCGLimit;
  return {
    emptyWeight: ew, emptyArm: ea, fuelWeight: fw, fuelArm: fa,
    pilotWeight: pw, pilotArm: pa, copilotWeight: cpw, copilotArm: cpa,
    paxRow1Weight: r1w, paxRow1Arm: r1a, paxRow2Weight: r2w, paxRow2Arm: r2a,
    cargoWeight: cw, cargoArm: ca, baggageWeight: bw, baggageArm: ba,
    totalWeight, totalMoment, cg, maxGross, fwdCGLimit, aftCGLimit, withinLimits,
    emptyMoment: ew * ea,
  };
}
