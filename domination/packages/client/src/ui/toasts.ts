/**
 * Toasts (work package WP4): short messages that appear for a few seconds.
 */

import type { Store } from '../state/store';
import type { Unmount } from './dom';

/**
 * Shows store.toasts (each with TEST_IDS.toast) in a corner, newest last,
 * at most five at a time; 'error' toasts look different from 'info' ones.
 * Each toast removes itself from the store about four seconds after it
 * first appeared. Toast text is untrusted: textContent only.
 */
export function mountToasts(parent: HTMLElement, store: Store): Unmount {
  throw new Error('not implemented: mountToasts');
}

/** Adds a toast to the store (gives it the next id). */
export function showToast(store: Store, text: string, kind: 'info' | 'error'): void {
  throw new Error('not implemented: showToast');
}
