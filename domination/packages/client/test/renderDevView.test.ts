import { describe, expect, it } from 'vitest';
import { MAP_SIZES, MAP_SIZE_IDS, UNITS, improvementFits, neighbors, tileMoveCost, tilesInRange } from '@domination/shared';
import type { PlayerView, TileIndex, UnitView } from '@domination/shared';
import { syntheticView } from '../src/dev/syntheticView';

/**
 * The made-up view of the big-map development page (src/dev/syntheticView.ts).
 * It is not part of the game. But the art of the water is looked at on that
 * page (the boats, the net under a boat, the net with and without the gold
 * token of a worked tile), so what the view promises to show is counted
 * here: a change to the made-up land that loses one of these looks is then
 * noticed without opening the page. Plain Node.
 */

/** The viewer's units of one type. */
function own(view: PlayerView, type: UnitView['type']): UnitView[] {
  return view.units.filter((unit) => unit.type === type && unit.own !== null);
}

describe('the made-up view of the big-map page (dev/syntheticView.ts)', () => {
  for (const sizeId of MAP_SIZE_IDS) {
    const size = MAP_SIZES[sizeId];
    const view = syntheticView({ width: size.width, height: size.height, fog: 'none' });
    const tileOf = (tile: TileIndex) => view.tiles[tile]!;

    it(`${sizeId}: a boat stands on water and a land unit on land, and a tile holds one unit of a class`, () => {
      const boats = view.units.filter((unit) => UNITS[unit.type].domain === 'sea');
      expect(boats.some((unit) => unit.type === 'fishingBoat')).toBe(true);
      expect(boats.some((unit) => unit.type === 'scoutBoat')).toBe(true);
      // Every civilization has both boats somewhere, so all six colours can be looked at on the water.
      for (const player of view.players) {
        expect(boats.some((unit) => unit.owner === player.id && unit.type === 'fishingBoat'), `${player.civ}: a Fishing Boat`).toBe(true);
        expect(boats.some((unit) => unit.owner === player.id && unit.type === 'scoutBoat'), `${player.civ}: a Scout Boat`).toBe(true);
      }
      for (const unit of view.units) {
        // The ground the unit's kind can enter at all: water for a boat, land that is no mountain for the others.
        expect(tileMoveCost(tileOf(unit.tile), UNITS[unit.type].domain), `${unit.type} ${unit.id} on tile ${unit.tile}`).not.toBeNull();
      }
      // The rules' stacking rule, for the boats: never two of one class on a tile. (The land units of the made-up
      // view were placed before there were boats and are left as they were.)
      const places = boats.map((unit) => `${unit.tile} ${UNITS[unit.type].unitClass}`);
      expect(new Set(places).size).toBe(places.length);
      // Ids are still one per unit.
      expect(new Set(view.units.map((unit) => unit.id)).size).toBe(view.units.length);
    });

    it(`${sizeId}: a net lies on coast only, a farm and a mine where they fit; a Worker of the viewer has two job options and a Fishing Boat one`, () => {
      let nets = 0;
      view.tiles.forEach((tile, index) => {
        if (tile === null || tile.improvement === null) return;
        expect(improvementFits(tile.improvement, tile), `the ${tile.improvement} on tile ${index}`).toBe(true);
        expect(tile.owner, `the ${tile.improvement} on tile ${index}`).not.toBeNull();
        if (tile.improvement === 'fishingNet') nets += 1;
      });
      expect(nets).toBeGreaterThan(5);

      expect(own(view, 'worker').length).toBeGreaterThan(0);
      for (const worker of own(view, 'worker')) {
        expect(worker.own!.jobOptions.map((option) => option.improvement), worker.id).toEqual(['farm', 'mine']);
      }
      expect(own(view, 'fishingBoat').length).toBeGreaterThan(0);
      for (const boat of own(view, 'fishingBoat')) {
        expect(boat.own!.jobOptions.map((option) => option.improvement), boat.id).toEqual(['fishingNet']);
        if (boat.own!.job !== null) expect(boat.own!.job.improvement).toBe('fishingNet');
      }
      // Units that build nothing have no options and no job.
      for (const unit of view.units) {
        if (unit.own !== null && UNITS[unit.type].improvements.length === 0) expect([unit.own.job, unit.own.jobOptions]).toEqual([null, []]);
      }
    });

    it(`${sizeId}: shows a Fishing Boat at work on a netted coast tile next to a plain one, a Scout Boat beside a Fishing Boat on one tile, and a net with the token beside a net without`, () => {
      // The one look the rules never give: the sign over a finished net. Exactly one boat has it.
      const atWorkOnNet = own(view, 'fishingBoat').filter((boat) => boat.own!.job !== null && tileOf(boat.tile).improvement === 'fishingNet');
      expect(atWorkOnNet.length).toBe(1);
      const [boat] = atWorkOnNet;
      expect(tileOf(boat.tile)).toMatchObject({ terrain: 'coast', owner: view.you });
      const plainBeside = neighbors(boat.tile, view).filter((tile) => {
        const beside = tileOf(tile);
        return beside.terrain === 'coast' && beside.improvement === null && beside.owner === view.you;
      });
      expect(plainBeside.length).toBeGreaterThanOrEqual(1);

      // Two boats of the viewer on one tile: one of each kind.
      const tilesWithBoth = own(view, 'scoutBoat').map((scout) => scout.tile).filter((tile) => own(view, 'fishingBoat').some((fishing) => fishing.tile === tile));
      expect(tilesWithBoth.length).toBeGreaterThanOrEqual(1);

      // With one of the viewer's cities selected (its worked tiles carry the gold token): a net a citizen
      // gathers from and, inside the same borders, a net nobody gathers from.
      const citiesWithBoth = view.cities.filter((city) => {
        if (city.own === null) return false;
        const nets = tilesInRange(city.tile, 2, view).filter((tile) => tileOf(tile).improvement === 'fishingNet' && tileOf(tile).owner === view.you);
        return nets.some((tile) => city.own!.worked.includes(tile)) && nets.some((tile) => !city.own!.worked.includes(tile));
      });
      expect(citiesWithBoth.length).toBeGreaterThanOrEqual(1);
      // A city never works its own tile or a tile outside its borders, and no tile twice.
      for (const city of view.cities) {
        if (city.own === null) continue;
        expect(new Set(city.own.worked).size).toBe(city.own.worked.length);
        for (const tile of city.own.worked) expect(tile !== city.tile && tileOf(tile).owner === city.owner, `${city.name} works tile ${tile}`).toBe(true);
      }
    });

    it(`${sizeId}: with fog, a remembered net and remembered plain coast lie out of sight; the same options give the same view`, () => {
      const fogged = syntheticView({ width: size.width, height: size.height, fog: 'some' });
      // Both fogged twins can be looked at on the page: a net as it was last seen, and coast without one.
      const outOfSight = fogged.tiles.filter((tile) => tile !== null && !tile.visible && tile.terrain === 'coast');
      expect(outOfSight.filter((tile) => tile!.improvement === 'fishingNet').length).toBeGreaterThanOrEqual(1);
      expect(outOfSight.filter((tile) => tile!.improvement === null).length).toBeGreaterThanOrEqual(1);
      // Only what is in sight is in the list of units, and every unit of it stands on a tile in sight.
      for (const unit of fogged.units) expect(fogged.tiles[unit.tile]?.visible, unit.id).toBe(true);

      expect(syntheticView({ width: size.width, height: size.height, fog: 'none' })).toEqual(view);
      expect(syntheticView({ width: size.width, height: size.height, fog: 'some' })).toEqual(fogged);
    });
  }
});
