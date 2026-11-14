/**
 * Painting page elements in a civilization's colours (work package WP4).
 *
 * The colours live in one place, the CIVS table of the shared package. The
 * stylesheet never repeats them: an element is handed its colours as CSS
 * variables, and the rules in styles.css use `var(--civ)` (the main colour:
 * backgrounds, swatches), `var(--civ-accent)` (the accent: details on top
 * of the main colour, exactly as on the map's city banners) and
 * `var(--civ-text)` (words on top of the main colour: the accent, or where
 * the accent is too faint for small print, a colour that is not).
 */

import { CIVS } from '@domination/shared';
import type { CivId } from '@domination/shared';

/** What setCivColors needs of an element: its inline style. (An HTMLElement fits; a test passes a stand-in.) */
export interface Paintable {
  style: Pick<CSSStyleDeclaration, 'getPropertyValue' | 'setProperty'>;
}

/** Gives `element` the colours of `civ` as the CSS variables --civ, --civ-accent and --civ-text. */
export function setCivColors(element: Paintable, civ: CivId): void {
  const colors = CIVS[civ];
  const wanted: [string, string][] = [
    ['--civ', colors.primary],
    ['--civ-accent', colors.secondary],
    ['--civ-text', colors.text],
  ];
  for (const [name, value] of wanted) {
    if (element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value);
  }
}
