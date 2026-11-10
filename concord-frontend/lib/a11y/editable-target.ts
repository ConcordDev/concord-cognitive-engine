/**
 * Shared guard for lens hotkeys and clickable wrappers.
 *
 * Bare-letter shortcuts and Space/Enter on role="button" chrome were
 * stealing keystrokes from create forms (RCA-form-hotkey-steal). One
 * predicate decides "this key belongs to an editable", and the wrapper
 * activator refuses to turn that key into a click.
 */

const EDITABLE_SELECTOR = [
  'input',
  'textarea',
  'select',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[role="textbox"]',
  '[role="searchbox"]',
  '[role="combobox"]',
].join(', ');

function asElement(node: EventTarget | null): HTMLElement | null {
  if (!node || typeof node !== 'object') return null;
  if (typeof (node as HTMLElement).tagName !== 'string') return null;
  return node as HTMLElement;
}

/** True when `el` is an editable, or sits inside one. */
export function isEditableElement(el: EventTarget | null): boolean {
  const node = asElement(el);
  if (!node) return false;
  if (node.isContentEditable) return true;
  const tag = node.tagName.toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  const role = (node.getAttribute('role') || '').toLowerCase();
  if (role === 'textbox' || role === 'searchbox' || role === 'combobox') return true;
  if (typeof node.closest === 'function' && node.closest(EDITABLE_SELECTOR)) return true;
  return false;
}

/**
 * True when this keystroke belongs to a field. Checks the event target,
 * the focused element, and the composed path so a role="button" wrapper
 * (or a retargeted listener) cannot claim a key the caret is using.
 */
export function isFormFieldEvent(event: KeyboardEvent): boolean {
  if (event.isComposing) return true;
  if (isEditableElement(event.target)) return true;
  if (typeof document !== 'undefined' && isEditableElement(document.activeElement)) return true;
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
  return path.some((node) => isEditableElement(node));
}

function hostStealsBareKeys(node: EventTarget | null): boolean {
  const el = asElement(node);
  if (!el || typeof document === 'undefined') return false;
  if (el === document.body || el === document.documentElement) return false;
  const role = (el.getAttribute('role') || '').toLowerCase();
  const dialogish = role === 'button' || role === 'dialog' || el.getAttribute('aria-modal') === 'true';
  if (!dialogish) return false;
  return !!el.querySelector(EDITABLE_SELECTOR);
}

/**
 * Non-global lens shortcuts must not run while the user is editing, or
 * while focus is on a button/dialog that itself contains a field (modal
 * chrome that took focus away from the input).
 */
export function shouldIgnoreLensHotkey(event: KeyboardEvent): boolean {
  if (isFormFieldEvent(event)) return true;
  if (hostStealsBareKeys(event.target)) return true;
  if (typeof document !== 'undefined' && hostStealsBareKeys(document.activeElement)) return true;
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
  return path.some((node) => hostStealsBareKeys(node));
}

type ActivatorEvent = {
  key: string;
  target: EventTarget | null;
  currentTarget: EventTarget | null;
  preventDefault: () => void;
};

/**
 * Keyboard stand-in for a clickable div. Space/Enter activate it, except
 * when the key started in a nested field — those keystrokes must type.
 */
export function activateOnEnterOrSpace(event: ActivatorEvent): void {
  if (isEditableElement(event.target)) return;
  if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return;
  event.preventDefault();
  const el = event.currentTarget as HTMLElement | null;
  if (el && typeof el.click === 'function') el.click();
}
