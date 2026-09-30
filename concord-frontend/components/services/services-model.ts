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

