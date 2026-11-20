/**
 * Retail catalog change signal.
 *
 * The catalog (ProductCatalogPanel) and the Register's product grid
 * (components/retail/app/Register) both read the same real
 * `retail.product-list` macro but live in separate views, so the register
 * must re-read after a catalog write.
 * After a successful write the catalog announces it; listeners re-read the
 * real list. The event carries no product data — nothing is faked locally.
 */

export const RETAIL_CATALOG_CHANGED = 'concord:retail-catalog-changed';

export function announceRetailCatalogChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(RETAIL_CATALOG_CHANGED));
}

/** Subscribe; returns the unsubscribe function. */
export function onRetailCatalogChanged(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(RETAIL_CATALOG_CHANGED, cb);
  return () => window.removeEventListener(RETAIL_CATALOG_CHANGED, cb);
}
