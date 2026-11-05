/* Shared types/constants for the services lens desk. Extracted from page.tsx. */

import type { LucideIcon } from 'lucide-react';
import {
  Users,
  CalendarCheck,
  Sparkles,
  UserCheck,
  BarChart3,
  CreditCard,
  Package,
} from 'lucide-react';

export type ModeTab = 'Dashboard' | 'Appointments' | 'Clients' | 'Services' | 'Staff' | 'POS' | 'Inventory';
export type ArtifactType = 'Appointment' | 'Client' | 'ServiceItem' | 'StaffMember' | 'Transaction' | 'Product';

export type AppointmentStatus = 'booked' | 'confirmed' | 'in_progress' | 'completed' | 'no_show' | 'cancelled';
export type PaymentMethod = 'cash' | 'credit' | 'debit' | 'check' | 'gift_card' | 'other';

export interface AppointmentData {
  clientName: string;
  /** Link to the Desk Client record this appointment belongs to (F5: the
   *  reminder pipeline resolves its recipient through this link). */
  clientId?: string;
  /** Snapshot of the linked client's Concord user ID, when the client
   *  record carries one — the identity the ActionDock's DM reminder sends to. */
  clientUserId?: string;
  serviceType: string;
  provider: string;
  date: string;
  time: string;
  duration: number;
  recurring: boolean;
  recurringFrequency: string;
  noShowCount: number;
  notes: string;
  price: number;
  reminderSent: boolean;
}

export interface ClientData {
  /** The client's Concord account ID, when known — lets appointment
   *  reminders reach them by DM (see AppointmentData.clientUserId). */
  userId?: string;
  phone: string;
  email: string;
  visitHistory: number;
  preferences: string;
  notes: string;
  totalSpend: number;
  loyaltyPoints: number;
  birthday: string;
  lastVisit: string;
  preferredProvider: string;
  allergies: string;
  referralSource: string;
}

export interface ServiceItemData {
  category: string;
  duration: number;
  price: number;
  requiredStaff: string;
  requiredEquipment: string;
  addOns: string[];
  packageDeals: string[];
  description: string;
  isActive: boolean;
}

export interface StaffMemberData {
  skills: string[];
  schedule: string;
  commissionRate: number;
  bookingsThisMonth: number;
  revenueThisMonth: number;
  retentionRate: number;
  phone: string;
  email: string;
  hireDate: string;
  role: string;
  bio: string;
}

export interface TransactionData {
  clientName: string;
  services: string[];
  products: string[];
  subtotal: number;
  tax: number;
  tip: number;
  discount: number;
  discountCode: string;
  total: number;
  paymentMethod: PaymentMethod;
  staffMember: string;
  date: string;
  time: string;
  receiptNumber: string;
}

export interface ProductData {
  sku: string;
  category: string;
  costPrice: number;
  retailPrice: number;
  stockLevel: number;
  reorderLevel: number;
  salesVelocity: number;
  supplier: string;
  lastRestocked: string;
  description: string;
}

export type ArtifactDataUnion = AppointmentData | ClientData | ServiceItemData | StaffMemberData | TransactionData | ProductData;

export type ServicesView = 'desk' | 'suite' | 'feed' | 'retention';

export const MODE_TABS: { id: ModeTab; icon: LucideIcon; artifactType?: ArtifactType }[] = [
  { id: 'Dashboard', icon: BarChart3 },
  { id: 'Appointments', icon: CalendarCheck, artifactType: 'Appointment' },
  { id: 'Clients', icon: Users, artifactType: 'Client' },
  { id: 'Services', icon: Sparkles, artifactType: 'ServiceItem' },
  { id: 'Staff', icon: UserCheck, artifactType: 'StaffMember' },
  { id: 'POS', icon: CreditCard, artifactType: 'Transaction' },
  { id: 'Inventory', icon: Package, artifactType: 'Product' },
];

export const APPOINTMENT_STATUSES: AppointmentStatus[] = ['booked', 'confirmed', 'in_progress', 'completed', 'no_show', 'cancelled'];
export const PAYMENT_METHODS: PaymentMethod[] = ['cash', 'credit', 'debit', 'check', 'gift_card', 'other'];
export const SERVICE_CATEGORIES = ['Hair', 'Nails', 'Skin/Facial', 'Massage', 'Waxing', 'Lashes/Brows', 'Makeup', 'Other'];
export const STAFF_ROLES = ['Stylist', 'Barber', 'Nail Tech', 'Esthetician', 'Massage Therapist', 'Lash Tech', 'Makeup Artist', 'Manager', 'Front Desk'];
export const PRODUCT_CATEGORIES = ['Hair Care', 'Skin Care', 'Nail Products', 'Styling Tools', 'Accessories', 'Gift Cards', 'Other'];

export const STATUS_COLORS: Record<string, string> = {
  booked: 'blue-400',
  confirmed: 'cyan-400',
  in_progress: 'yellow-400',
  completed: 'green-400',
  no_show: 'red-400',
  cancelled: 'gray-400',
  active: 'green-400',
  inactive: 'gray-400',
};

/* ================================================================== */
/*  Booking-suite plane (server/domains/services.js svcStore)          */
/*                                                                     */
/*  The lens keeps two record planes: Desk artifacts (above) and the   */
/*  booking suite's own store. The helpers below are the ONE shared    */
/*  projection both panels use, so the Desk, the suite, and the        */
/*  Dashboard all read the same book, the same clients, and the same   */
/*  stock truth.                                                       */
/* ================================================================== */

export interface SuiteBooking {
  id: string;
  client: string;
  clientUserId?: string | null;
  service: string;
  staff: string;
  date: string;
  time: string;
  duration: number;
  price: number;
  status: string;
  source: string;
  contact?: { phone?: string; email?: string };
  waitlistId?: string;
}

export interface SuiteClientProfile {
  clientKey: string;
  name: string;
  phone?: string;
  email?: string;
  notes?: string;
  preferences?: string;
  allergies?: string;
  preferredProvider?: string;
}

/** The suite joins clients by normalized name (clientHistory does the
 *  same server-side) — the union uses that same key. */
export const normalizeClientKey = (name: string): string => (name || '').trim().toLowerCase();

/** Reorder level the Inventory Check (supplyCheck) applies when a
 *  product record carries none. */
export const DEFAULT_REORDER_LEVEL = 5;

/** One low-stock truth for the Dashboard and the Inventory Check. */
export function isLowStock(p: { stockLevel?: number; reorderLevel?: number }): boolean {
  return (p.stockLevel ?? 0) <= (p.reorderLevel ?? DEFAULT_REORDER_LEVEL);
}

/** Project a Desk appointment artifact into the suite booking shape. */
export function deskAppointmentAsBooking(item: {
  id: string;
  meta: { status?: string };
  data: AppointmentData;
}): SuiteBooking {
  const d = item.data;
  return {
    id: item.id,
    client: d.clientName || 'Client',
    clientUserId: d.clientUserId || null,
    service: d.serviceType || 'Service',
    staff: d.provider || 'Unassigned',
    date: d.date || '',
    time: d.time || '',
    duration: d.duration || 30,
    price: d.price || 0,
    status: (item.meta.status as string) || 'booked',
    source: 'desk',
  };
}

export function getStatusesForTab(tab: ModeTab): string[] {
  switch (tab) {
    case 'Appointments': return APPOINTMENT_STATUSES;
    case 'Clients': return ['active', 'inactive'];
    case 'Services': return ['active', 'inactive'];
    case 'Staff': return ['active', 'inactive'];
    case 'POS': return ['completed', 'cancelled'];
    case 'Inventory': return ['active', 'inactive'];
    default: return ['active', 'inactive'];
  }
}

