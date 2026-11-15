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
  options: ElementOptions = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const created = document.createElement(tag);
  // Everything below is the same for every kind of element.
  const element: HTMLElement = created;
  if (options.className !== undefined) element.className = options.className;
  if (options.text !== undefined) element.textContent = options.text;
  if (options.testId !== undefined) element.setAttribute('data-testid', options.testId);
  for (const [name, value] of Object.entries(options.attributes ?? {})) element.setAttribute(name, value);
  if (options.onClick !== undefined) element.addEventListener('click', options.onClick);
  // A <button> inside a <form> submits it unless told otherwise; ours never should.
  if (tag === 'button' && !element.hasAttribute('type')) element.setAttribute('type', 'button');
  element.append(...children);
  return created;
}

/** Sets textContent only if it differs (avoids needless layout work and keeps text selections). */
export function setText(element: HTMLElement, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}

/** Shows or hides an element through its `hidden` attribute. */
export function setHidden(element: HTMLElement, hidden: boolean): void {
  if (element.hidden !== hidden) element.hidden = hidden;
}

/** Sets an attribute only if it differs, for example data-ended="true". */
export function setAttribute(element: HTMLElement, name: string, value: string): void {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

/** Adds or removes one CSS class. */
export function setClass(element: HTMLElement, className: string, on: boolean): void {
  if (element.classList.contains(className) !== on) element.classList.toggle(className, on);
}

/**
 * Enables or disables a button (or another form control).
 *
 * A button that is disabled while it has the keyboard focus would swallow
 * every key press: browsers send no key events to a disabled control, so the
 * map shortcuts would stop working after a click on End Turn. The focus is
 * therefore given back to the page first.
 */
export function setDisabled(control: HTMLButtonElement | HTMLInputElement | HTMLSelectElement, disabled: boolean): void {
  if (control.disabled === disabled) return;
  if (disabled && document.activeElement === control) control.blur();
  control.disabled = disabled;
}

/** Fills a progress bar (`div.bar > div.bar-fill`) to a fraction from 0 to 1. */
export function setBar(fill: HTMLElement, fraction: number): void {
  const width = `${Math.round(fraction * 100)}%`;
  if (fill.style.width !== width) fill.style.width = width;
}
