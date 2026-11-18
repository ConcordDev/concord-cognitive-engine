/**
 * The retail lens's own navigation: one section rail (Shopify-admin shape),
 * each section owning its sub-views. This is the single view-state machine
 * for the lens — panels never keep a competing top-level tab state.
 */

export type RetailSection =
  | 'register'
  | 'orders'
  | 'products'
  | 'customers'
  | 'fulfillment'
  | 'marketing'
  | 'analytics'
  | 'service'
  | 'store';

export interface SectionDef {
  id: RetailSection;
  label: string;
  /** Single-key jump, shown in the rail and registered as a lens command. */
  key: string;
  subs?: { id: string; label: string }[];
}

export const SECTIONS: SectionDef[] = [
  { id: 'register', label: 'Register', key: '1' },
  { id: 'orders', label: 'Orders', key: '2', subs: [
    { id: 'all', label: 'All orders' },
    { id: 'returns', label: 'Returns' },
    { id: 'refunds', label: 'Refunds' },
    { id: 'abandoned', label: 'Abandoned carts' },
  ] },
  { id: 'products', label: 'Products', key: '3', subs: [
    { id: 'catalog', label: 'Catalog' },
    { id: 'lowstock', label: 'Low stock' },
    { id: 'collections', label: 'Collections' },
    { id: 'transfers', label: 'Transfers' },
  ] },
  { id: 'customers', label: 'Customers', key: '4' },
  { id: 'fulfillment', label: 'Fulfillment', key: '5', subs: [
    { id: 'queue', label: 'Queue' },
    { id: 'labels', label: 'Labels' },
    { id: 'zones', label: 'Shipping zones' },
  ] },
  { id: 'marketing', label: 'Marketing', key: '6', subs: [
    { id: 'discounts', label: 'Discounts' },
    { id: 'campaigns', label: 'Campaigns' },
    { id: 'gift', label: 'Gift cards' },
    { id: 'displays', label: 'Displays' },
  ] },
  { id: 'analytics', label: 'Analytics', key: '7', subs: [
    { id: 'sales', label: 'Sales' },
    { id: 'ops', label: 'Inventory & pipeline math' },
    { id: 'market', label: 'Market wire' },
  ] },
  { id: 'service', label: 'Service', key: '8', subs: [
    { id: 'tickets', label: 'Tickets' },
    { id: 'reviews', label: 'Reviews' },
    { id: 'pipeline', label: 'B2B pipeline' },
  ] },
  { id: 'store', label: 'Store', key: '9', subs: [
    { id: 'storefront', label: 'Online store' },
    { id: 'channels', label: 'Channels' },
    { id: 'taxes', label: 'Taxes' },
    { id: 'staff', label: 'Staff' },
  ] },
];

export const sectionById = (id: RetailSection) => SECTIONS.find((s) => s.id === id)!;

export function defaultSub(id: RetailSection): string | undefined {
  return sectionById(id).subs?.[0]?.id;
}
