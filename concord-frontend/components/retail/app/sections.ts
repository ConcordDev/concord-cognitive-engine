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

/**
 * The chalked header over each section view: a stall-voice title and one
 * line saying what the view does. Copy only — every view below it is the
 * domain's real macro-backed panel.
 */
export const SECTION_COPY: Record<string, { title: string; line: string }> = {
  'orders:all': { title: 'The order book', line: 'Every sale rung up — refund it or open a return from here.' },
  'orders:returns': { title: 'Returns bench', line: 'Approve, receive and close returns. Money only moves as a refund.' },
  'orders:refunds': { title: 'Refunds', line: 'What went back to customers, and why.' },
  'orders:abandoned': { title: 'Left at the counter', line: "Carts customers walked away from — nudge them back." },
  'products:catalog': { title: 'The stock room', line: 'Stock crates, set prices, track suppliers and variants.' },
  'products:lowstock': { title: 'Running low', line: 'Crates at or under the reorder point.' },
  'products:collections': { title: 'Collections', line: 'Group crates into shelves for the shop front.' },
  'products:transfers': { title: 'Transfers', line: 'Move stock between locations and receive it in.' },
  'customers:': { title: 'The regulars', line: 'Who shops here, what they spend, and who you haven’t seen in a while.' },
  'fulfillment:queue': { title: 'Packing table', line: 'Online orders from picked to shipped.' },
  'fulfillment:labels': { title: 'Shipping labels', line: 'Quote, buy and track carrier labels.' },
  'fulfillment:zones': { title: 'Delivery zones', line: 'Where you ship and what it costs.' },
  'marketing:discounts': { title: 'Specials board', line: 'Discount codes the register accepts — and how often they’re used.' },
  'marketing:campaigns': { title: 'Campaigns', line: 'Send offers to your customers and see what converts.' },
  'marketing:gift': { title: 'Gift cards', line: 'Issue cards and check balances. They’re a tender at the register.' },
  'marketing:displays': { title: 'Window displays', line: 'Track displays and the sales they bring in.' },
  'analytics:sales': { title: 'The ledger', line: 'Sales over time, top crates and order value — net of refunds.' },
  'analytics:ops': { title: 'Back-office maths', line: 'Reorder points, pipeline value, customer lifetime value, SLAs.' },
  'analytics:market': { title: 'Market wire', line: 'Retail news and a public product feed for ideas.' },
  'service:tickets': { title: 'Help desk', line: 'Customer tickets with response-time targets.' },
  'service:reviews': { title: 'Reviews', line: 'What customers say — moderate and reply.' },
  'service:pipeline': { title: 'Trade deals', line: 'Wholesale and B2B deals by stage.' },
  'store:storefront': { title: 'Online shop', line: 'Publish a public storefront from the same stock.' },
  'store:channels': { title: 'Channels', line: 'Sell the same crates on other marketplaces.' },
  'store:taxes': { title: 'Sales tax', line: 'The rate the register charges. Set a default.' },
  'store:staff': { title: 'Staff', line: 'Who can work the till and what they can do.' },
};
