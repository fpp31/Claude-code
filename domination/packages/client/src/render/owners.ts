/**
 * Whose colours something is drawn in (work package WP5). Pure.
 *
 * A view names owners by player id; colours belong to civilizations. This
 * is the one place that goes from the first to the second.
 */

import { CIVS } from '@domination/shared';
import type { CivId, PlayerId, PlayerView } from '@domination/shared';
import type { OwnerColors } from '../sprites/format';
import { NEUTRAL_OWNER } from '../sprites/spriteSheet';

/** The civilization of every player in the view. */
export function civsByPlayer(view: PlayerView): Map<PlayerId, CivId> {
  return new Map(view.players.map((player) => [player.id, player.civ]));
}

/**
 * The colours of a civilization. A view should never name an owner that is
 * not in its player list; if one does, that owner is drawn in neutral grey
 * instead of breaking the whole map.
 */
export function ownerColors(civ: CivId | undefined): OwnerColors {
  if (civ === undefined) return NEUTRAL_OWNER;
  return { primary: CIVS[civ].primary, secondary: CIVS[civ].secondary };
}
