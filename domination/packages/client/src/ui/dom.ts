/**
 * A tiny helper for building DOM elements (work package WP4). The UI is
 * plain DOM: no framework. Phase 1 has six small panels, which does not
 * justify a library or the extra concepts that come with one.
 *
 * HOW EVERY PANEL IS WRITTEN (the rule that keeps clicks from getting lost
 * when the server updates the game while a button is being pressed):
 *  - build the elements ONCE, when the panel is mounted;
 *  - on every store change only UPDATE them: textContent, hidden, disabled,
 *    class names. Never rebuild a subtree that contains a button or a form
 *    control, except for lists whose items really changed.
 *
 * SAFETY: player and city names come from other people. They are only ever
 * put into the page as TEXT (textContent / text nodes). Never use innerHTML.
 */

import type { TestId } from './testIds';

/** A function that removes a mounted piece of UI again (listeners, subscriptions, elements). */
export type Unmount = () => void;

export interface ElementOptions {
  /** CSS class names. */
  className?: string;
  /** Text content (set through textContent, so it is always safe). */
  text?: string;
  /** Sets the `data-testid` attribute, which the end-to-end test uses to find elements. */
  testId?: TestId | string;
  /** Other attributes, for example { type: 'text', maxlength: '20' }. */
  attributes?: Record<string, string>;
  /** Click handler. */
  onClick?: (event: MouseEvent) => void;
}

/**
 * Creates an element, for example
 *   h('button', { className: 'primary', text: 'End Turn', onClick: endTurn })
 *   h('div', { className: 'panel' }, title, body)
 * String children become text nodes.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options?: ElementOptions,
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  throw new Error('not implemented: h');
}

/** Sets textContent only if it differs (avoids needless layout work and keeps text selections). */
export function setText(element: HTMLElement, text: string): void {
  throw new Error('not implemented: setText');
}
