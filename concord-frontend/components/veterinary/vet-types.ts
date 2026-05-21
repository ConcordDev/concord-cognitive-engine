// Shared types for the veterinary practice-management lens. Every shape
// mirrors a real macro return in server/domains/veterinary.js.

export interface VetVisit {
  id: string;
  kind: string;
  date: string;
  diagnosis: string;
  treatment: string;
  cost: number;
}

export interface VetVaccination {
  id: string;
  vaccine: string;
  date: string;
  nextDue: string;
}

export interface VetPatient {
  id: string;
  name: string;
  species: string;
  breed: string;
  owner: string;
  ageYears: number;
  weightLbs: number;
  notes: string;
  visits: VetVisit[];
  vaccinations: VetVaccination[];
  createdAt: string;
  visitCount?: number;
  vaccinationCount?: number;
  lastVisit?: string | null;
}

export interface VetAppointment {
  id: string;
  patientId: string;
  patientName: string;
  owner: string;
  type: string;
  date: string;
  time: string;
  durationMin: number;
  vet: string;
  reason: string;
  status: string;
  createdAt: string;
  updatedAt?: string;
}

export interface VetLineItem {
  description: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
}

export interface VetPayment {
  amount: number;
  method: string;
  date: string;
}

export interface VetInvoice {
  id: string;
  patientId: string;
  patientName: string;
  owner: string;
  lineItems: VetLineItem[];
  subtotal: number;
  taxRate: number;
  tax: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
  status: string;
  payments: VetPayment[];
  createdAt: string;
}

export interface VetSoapNote {
  id: string;
  patientId: string;
  patientName: string;
  visitId: string;
  date: string;
  vet: string;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  createdAt: string;
}

export interface VetPrescription {
  id: string;
  patientId: string;
  patientName: string;
  drug: string;
  dosage: string;
  frequency: string;
  durationDays: number;
  refillsTotal: number;
  refillsUsed: number;
  refillsRemaining: number;
  prescribedBy: string;
  status: string;
  prescribedAt: string;
  refillHistory: Array<{ date: string }>;
}

export interface VetLabResult {
  id: string;
  patientId: string;
  patientName: string;
  visitId: string;
  kind: string;
  title: string;
  findings: string;
  attachmentUrl: string;
  flag: string;
  date: string;
  createdAt: string;
}

export interface VetInventoryItem {
  id: string;
  name: string;
  category: string;
  sku: string;
  quantity: number;
  unit: string;
  reorderLevel: number;
  unitCost: number;
  expiryDate: string;
  createdAt: string;
  updatedAt?: string;
}

export interface VetReminderEntry {
  patientId: string;
  patientName: string;
  owner: string;
  vaccine: string;
  nextDue: string;
  daysOut: number;
}

export const SPECIES_OPTIONS = ['dog', 'cat', 'bird', 'rabbit', 'reptile', 'horse', 'other'];
export const APPT_TYPES = ['wellness', 'sick', 'surgery', 'dental', 'emergency', 'vaccination', 'followup'];
export const APPT_STATUSES = ['scheduled', 'checked_in', 'in_progress', 'completed', 'no_show', 'cancelled'];
export const VISIT_KINDS = ['checkup', 'vaccination', 'surgery', 'dental', 'emergency', 'followup'];
export const PAY_METHODS = ['cash', 'card', 'check', 'insurance', 'plan'];
export const LAB_KINDS = ['bloodwork', 'urinalysis', 'xray', 'ultrasound', 'cytology', 'biopsy', 'other'];
export const LAB_FLAGS = ['normal', 'abnormal', 'critical', 'pending'];
export const INVENTORY_CATEGORIES = ['medication', 'vaccine', 'supply', 'food', 'equipment', 'other'];

export const SPECIES_EMOJI: Record<string, string> = {
  dog: '🐶',
  cat: '🐱',
  bird: '🐦',
  rabbit: '🐇',
  reptile: '🦎',
  horse: '🐴',
  other: '🐾',
};
