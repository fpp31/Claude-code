/**
 * The page elements that print what game/tileInfo.ts says about a tile: a
 * heading and a list of lines. The tile card and the hover box each have a
 * copy, so the two show the same words in the same order and look alike.
 */

import { jsonEqual } from '@domination/shared';
import type { TileInfo, TileInfoLine } from '../game/tileInfo';
import { setCivColors } from './civColors';
import { h, setHidden, setText } from './dom';

/** The page elements for one TileInfo: a heading and a list of lines. Used by the tile card and by the hover box. */
export interface TileInfoView {
  /** The heading, `h2.tile-info-title`. The caller puts it where it wants it (the tile card: into its sticky head). */
  title: HTMLElement;
  /** The list, `ul.tile-info-lines`. */
  lines: HTMLElement;
  /** Shows this description. Rewrites the list only if the description changed (jsonEqual). */
  update(info: TileInfo): void;
}

/**
 * Makes the heading and the list. Both are empty until the first `update`.
 *
 * The list has no buttons, so it may be rebuilt when the description
 * changes (see "HOW EVERY PANEL IS WRITTEN" in dom.ts). Each line is
 * `li.tile-info-line.<kind>` with the test id `ids.line + kind`; a line
 * about a player starts with a small square in that player's colours.
 * Names of players and cities arrive inside the finished sentences and are
 * only ever put into the page as text.
 *
 * @param ids  the test ids of this copy: `title` for the heading, `line`
 *             as the beginning of every line's id (`line + kind`)
 */
export function createTileInfoView(ids: { title: string; line: string }): TileInfoView {
  const title = h('h2', { className: 'tile-info-title', testId: ids.title });
  const lines = h('ul', { className: 'tile-info-lines' });
  lines.hidden = true;
  let shown: TileInfo | null = null;

  function lineElement(line: TileInfoLine): HTMLElement {
    const item = h('li', { className: `tile-info-line ${line.kind}`, testId: ids.line + line.kind });
    if (line.civ !== null) {
      const swatch = h('span', { className: 'swatch' });
      setCivColors(swatch, line.civ);
      item.append(swatch);
    }
    item.append(h('span', { text: line.text }));
    return item;
  }

  return {
    title,
    lines,
    update(info) {
      if (shown !== null && jsonEqual(shown, info)) return;
      shown = info;
      setText(title, info.title);
      lines.replaceChildren(...info.lines.map(lineElement));
      // An unexplored tile has a heading and nothing else: no empty list with its gap under it.
      setHidden(lines, info.lines.length === 0);
    },
  };
}
