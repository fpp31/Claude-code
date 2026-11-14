/**
 * Painting page elements in a civilization's colours (work package WP4).
 *
 * The colours live in one place, the CIVS table of the shared package. The
 * stylesheet never repeats them: an element is handed its two colours as CSS
 * variables, and the rules in styles.css use `var(--civ)` (the main colour:
 * backgrounds, swatches) and `var(--civ-accent)` (the accent: text and
 * details on top of the main colour), exactly as the map's city banners do.
 */

import { CIVS } from '@domination/shared';
import type { CivId } from '@domination/shared';

/** Gives `element` the two colours of `civ` as the CSS variables --civ and --civ-accent. */
export function setCivColors(element: HTMLElement, civ: CivId): void {
  const colors = CIVS[civ];
  if (element.style.getPropertyValue('--civ') !== colors.primary) element.style.setProperty('--civ', colors.primary);
  if (element.style.getPropertyValue('--civ-accent') !== colors.secondary) {
    element.style.setProperty('--civ-accent', colors.secondary);
  }
}
