/**
 * Toasts (work package WP4): short messages that appear for a few seconds.
 */

import type { Store, Toast } from '../state/store';
import { h } from './dom';
import type { Unmount } from './dom';
import { TEST_IDS } from './testIds';

/** At most this many toasts exist at a time; a new one pushes the oldest out. */
export const MAX_TOASTS = 5;

/** How long a toast stays on screen. */
export const TOAST_LIFETIME_MS = 4000;

/** A toast before it has an id. */
export interface NewToast {
  text: string;
  kind: 'info' | 'error';
}

/**
 * The id given to the newest toast of each store. Kept beside the store (not
 * in a single global counter) so that every store counts 1, 2, 3... on its
 * own, and ids are never used twice even after old toasts have gone.
 */
const lastToastId = new WeakMap<Store, number>();

/**
 * The store's toast list with these added: newest last, each with the next
 * id, cut down to the newest MAX_TOASTS. It only works the list out; the
 * caller puts it into the store, together with whatever else changed, so the
 * screen is updated once.
 *
 * A message is never on screen twice: a new toast that says exactly what
 * one already showing says takes that one's place (as the newest, with its
 * four seconds starting again). Otherwise pressing a button that is refused
 * three times in a row stacks up three copies of the same sentence.
 */
export function toastsWith(store: Store, added: NewToast[]): Toast[] {
  let id = lastToastId.get(store) ?? 0;
  let toasts = store.get().toasts.slice();
  for (const toast of added) {
    id += 1;
    toasts = toasts.filter((shown) => shown.text !== toast.text || shown.kind !== toast.kind);
    toasts.push({ id, text: toast.text, kind: toast.kind });
  }
  lastToastId.set(store, id);
  return toasts.slice(-MAX_TOASTS);
}

/** Adds a toast to the store (gives it the next id). */
export function showToast(store: Store, text: string, kind: 'info' | 'error'): void {
  store.set({ toasts: toastsWith(store, [{ text, kind }]) });
}

/**
 * Shows store.toasts (each with TEST_IDS.toast) in a corner, newest last,
 * at most five at a time; 'error' toasts look different from 'info' ones.
 * Each toast removes itself from the store about four seconds after it
 * first appeared. Toast text is untrusted: textContent only.
 */
export function mountToasts(parent: HTMLElement, store: Store): Unmount {
  // aria-live makes screen readers read a new toast out without moving the focus.
  const list = h('div', { className: 'toasts', attributes: { 'aria-live': 'polite' } });
  parent.append(list);

  /** What is on screen for each toast id: its element and the timer that will remove it. */
  const shown = new Map<number, { element: HTMLElement; timer: number }>();

  function removeFromStore(id: number): void {
    const toasts = store.get().toasts;
    if (toasts.some((toast) => toast.id === id)) store.set({ toasts: toasts.filter((toast) => toast.id !== id) });
  }

  function update(): void {
    const toasts = store.get().toasts;

    // Toasts that have left the store (timed out, tapped away or pushed out).
    for (const [id, entry] of shown) {
      if (toasts.some((toast) => toast.id === id)) continue;
      window.clearTimeout(entry.timer);
      entry.element.remove();
      shown.delete(id);
    }

    // New toasts. Ids only go up, so appending keeps the newest last.
    for (const toast of toasts) {
      if (shown.has(toast.id)) continue;
      const element = h('div', {
        className: toast.kind === 'error' ? 'toast toast-error' : 'toast',
        text: toast.text,
        testId: TEST_IDS.toast,
        attributes: { title: 'Tap to dismiss' },
        onClick: () => removeFromStore(toast.id),
      });
      list.append(element);
      const timer = window.setTimeout(() => removeFromStore(toast.id), TOAST_LIFETIME_MS);
      shown.set(toast.id, { element, timer });
    }
  }

  const unsubscribe = store.subscribe(update);
  update();

  return () => {
    unsubscribe();
    for (const entry of shown.values()) window.clearTimeout(entry.timer);
    shown.clear();
    list.remove();
  };
}
