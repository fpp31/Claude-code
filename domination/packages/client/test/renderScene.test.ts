import { afterEach, describe, expect, it } from 'vitest';
import { CIVS, MAP_SIZES, tileCoord } from '@domination/shared';
import type { PlayerView, UnitView } from '@domination/shared';
import { sampleView } from '@domination/shared/testing';
import { bannerFrame, bannerLayout, bannerScale, bannerSize, drawBanner } from '../src/render/banner';
import { BANNER_REACH } from '../src/render/frame';
import { TILE_WIDTH, tileOrigin } from '../src/render/geometry';
import { civsByPlayer, ownerColors } from '../src/render/owners';
import { citiesInDrawingOrder, pathMarks, unitDrawings } from '../src/render/scene';
import { SLIDE_MS, slideOffset, startSlides } from '../src/render/slide';
import { packImages } from '../src/sprites/atlas';
import { parseColor } from '../src/sprites/color';
import { FONT_HEIGHT, measureText } from '../src/sprites/font';
import type { RasterImage } from '../src/sprites/format';
import { blendPixel, createImage, getPixel } from '../src/sprites/image';
import { FOG_AMOUNT, FOG_COLOR, colorWithLook, foggedColor, imageWithLook } from '../src/sprites/looks';
import { PALETTE } from '../src/sprites/palette';
import { RIM_COLOR, RIM_ROWS_ADDED, imageWithRim } from '../src/sprites/rim';
import { NEUTRAL_OWNER, buildSpriteImages, pickVariant, spriteKey } from '../src/sprites/spriteSheet';
import { installFakeBrowser } from './renderFakeCanvas';
import type { FakeBrowser } from './renderFakeCanvas';

/**
 * The renderer's remaining pure parts (WP5): who stands in front on a
 * shared tile, the slide animation, banner layout, the fog and spent looks,
 * and the packing of the sprite sheet. Plain Node.
 */

/** The sample view with other units: `at` lists [id, type, owner, tile, movesLeft or null for a foreign unit]. */
function viewWithUnits(at: [string, UnitView['type'], string, number, number | null][]): PlayerView {
  const units: UnitView[] = at.map(([id, type, owner, tile, movesLeft]) => ({
    id, type, owner, tile,
    own: movesLeft === null ? null : { movesLeft, foundCityError: 'cannotFoundCity' },
  }));
  return { ...sampleView(), units };
}

describe('unitDrawings (WP5)', () => {
  const OPEN = 5 * 14 + 4; // a tile without a city
  const ROME = 4 * 14 + 3; // Rome's tile in the sample view

  it('lists units row by row from the top, whatever order the view has them in', () => {
    const view = viewWithUnits([
      ['c', 'warrior', 'p1', 100, 2],
      ['a', 'scout', 'p1', 20, 2],
      ['b', 'warrior', 'p2', 61, null],
    ]);
    expect(unitDrawings(view, null).map((drawing) => drawing.unit.id)).toEqual(['a', 'b', 'c']);
  });

  it('a unit alone on open ground stands in the middle of its tile', () => {
    const view = viewWithUnits([['a', 'warrior', 'p1', OPEN, 2]]);
    expect(unitDrawings(view, null)).toEqual([{ unit: view.units[0], dx: 0, dy: 0, look: 'normal', rim: false }]);
  });

  it('on a tile with two units the civilian stands behind the military unit', () => {
    for (const order of [['s', 'w'], ['w', 's']]) {
      const view = viewWithUnits(
        order.map((id) => [id, id === 's' ? 'settler' : 'warrior', 'p1', OPEN, 2] as [string, UnitView['type'], string, number, number]),
      );
      const [behind, front] = unitDrawings(view, null);
      // Drawn later = in front.
      expect([behind.unit.id, front.unit.id]).toEqual(['s', 'w']);
      // Both are moved off the middle so both can be seen: the one in front to the lower right of the other.
      expect(front.dx).toBeGreaterThan(behind.dx);
      expect(front.dy).toBeGreaterThan(behind.dy);
      expect(front.dx - behind.dx).toBeGreaterThanOrEqual(6);
    }
  });

  it('the selected unit stands in front, also when it is the civilian', () => {
    const view = viewWithUnits([
      ['w', 'warrior', 'p1', OPEN, 2],
      ['s', 'settler', 'p1', OPEN, 2],
    ]);
    const selected = unitDrawings(view, 's');
    expect(selected.map((drawing) => drawing.unit.id)).toEqual(['w', 's']);
    expect(selected[1].dx).toBeGreaterThan(selected[0].dx);
    // Selecting the military unit, or a unit somewhere else, changes nothing.
    expect(unitDrawings(view, 'w').map((drawing) => drawing.unit.id)).toEqual(['s', 'w']);
    expect(unitDrawings(view, 'elsewhere')).toEqual(unitDrawings(view, null));
  });

  it('units on a city tile stand beside the hall, not on top of it', () => {
    const alone = unitDrawings(viewWithUnits([['w', 'warrior', 'p1', ROME, 2]]), null);
    expect(alone[0].dx).toBeGreaterThanOrEqual(6);
    const pair = unitDrawings(viewWithUnits([['w', 'warrior', 'p1', ROME, 2], ['s', 'settler', 'p1', ROME, 2]]), null);
    expect(pair.map((drawing) => drawing.unit.id)).toEqual(['s', 'w']);
    expect(pair[0].dx).toBeLessThanOrEqual(-6); // one on each side
    expect(pair[1].dx).toBeGreaterThanOrEqual(6);
  });

  it('own units with no moves left are dimmed; own units with moves and foreign units are not', () => {
    const view = viewWithUnits([
      ['spent', 'warrior', 'p1', 20, 0],
      ['fresh', 'warrior', 'p1', 30, 1],
      ['foreign', 'warrior', 'p2', 40, null],
    ]);
    expect(unitDrawings(view, null).map((drawing) => [drawing.unit.id, drawing.look])).toEqual([
      ['spent', 'spent'],
      ['fresh', 'normal'],
      ['foreign', 'normal'],
    ]);
  });

  it('a unit among trees gets the pale line around it, whoever owns it; on open ground and on hills none does', () => {
    const FOREST = 1 * 14 + 4;
    const HILLS = 3 * 14 + 6;
    const sample = sampleView();
    expect(sample.tiles[FOREST]?.feature).toBe('forest');
    expect(sample.tiles[HILLS]?.feature).toBe('hills');

    const view = viewWithUnits([
      ['inForest', 'warrior', 'p1', FOREST, 0],
      ['foreignInForest', 'scout', 'p2', FOREST, null],
      ['onHills', 'warrior', 'p1', HILLS, 2],
      ['inTheOpen', 'settler', 'p1', OPEN, 2],
    ]);
    const rims = new Map(unitDrawings(view, null).map((drawing) => [drawing.unit.id, drawing.rim]));
    expect(rims.get('inForest')).toBe(true);
    expect(rims.get('foreignInForest')).toBe(true);
    expect(rims.get('onHills')).toBe(false);
    expect(rims.get('inTheOpen')).toBe(false);
  });

  it('does not change the view it is given', () => {
    const view = viewWithUnits([['b', 'warrior', 'p1', 90, 2], ['a', 'settler', 'p1', 20, 2]]);
    const before = JSON.stringify(view);
    unitDrawings(view, 'a');
    citiesInDrawingOrder(view);
    expect(JSON.stringify(view)).toBe(before);
  });
});

describe('citiesInDrawingOrder and owners (WP5)', () => {
  it('lists cities row by row from the top', () => {
    const view = sampleView(); // Rome is on tile 59, Thebes on tile 52
    expect(citiesInDrawingOrder(view).map((city) => city.name)).toEqual(['Thebes', 'Rome']);
    expect(citiesInDrawingOrder({ ...view, cities: [...view.cities].reverse() }).map((city) => city.name)).toEqual(['Thebes', 'Rome']);
  });

  it('finds every player\'s civilization, and gives an unknown owner neutral colours instead of failing', () => {
    const civs = civsByPlayer(sampleView());
    expect(civs.get('p1')).toBe('rome');
    expect(civs.get('p2')).toBe('egypt');
    expect(civs.get('p9')).toBeUndefined();
    expect(ownerColors(civs.get('p1'))).toEqual({ primary: CIVS.rome.primary, secondary: CIVS.rome.secondary });
    expect(ownerColors(civs.get('p9'))).toEqual(NEUTRAL_OWNER);
  });
});

describe('pathMarks (WP5)', () => {
  const view = sampleView(); // 14 tiles per row
  const at = (tile: number) => tileOrigin(tileCoord(tile, view));

  it('is a dotted line: a dot on every tile, one halfway between neighbors, and the ring on the last tile', () => {
    // From tile 47 east to 48, then south-west to 62 (row 3 is an odd row: its south-west neighbor is in the same column).
    const marks = pathMarks(view, 47, [48, 62]);
    expect(marks.map((mark) => mark.kind)).toEqual(['step', 'step', 'step', 'end']);
    expect(marks[0]).toEqual({ kind: 'step', px: (at(47).px + at(48).px) / 2, py: at(47).py });
    expect(marks[1]).toEqual({ kind: 'step', ...at(48) });
    expect(marks[3]).toEqual({ kind: 'end', ...at(62) });
    // The halfway dot of a slanted step lies between the two tiles, on whole pixels.
    expect(Number.isInteger(marks[2].px) && Number.isInteger(marks[2].py)).toBe(true);
    expect(Math.abs(marks[2].px - (at(48).px + at(62).px) / 2)).toBeLessThanOrEqual(0.5);
    expect(marks[2].py).toBe((at(48).py + at(62).py) / 2);
  });

  it('has no marks without a path, and only the ring for a path of one step from an unknown start', () => {
    expect(pathMarks(view, 47, [])).toEqual([]);
    expect(pathMarks(view, null, [48])).toEqual([{ kind: 'end', ...at(48) }]);
    // A start that is not next to the first tile gets no halfway dot either.
    expect(pathMarks(view, 0, [48])).toEqual([{ kind: 'end', ...at(48) }]);
  });

  it('leaves out tiles that are not on the map instead of failing', () => {
    expect(pathMarks(view, 47, [48, 9999, 49]).map((mark) => mark.kind)).toEqual(['step', 'step', 'end']);
    expect(pathMarks(view, -5, [48])).toEqual([{ kind: 'end', ...at(48) }]);
  });
});

describe('slide animation (WP5)', () => {
  const view = sampleView();
  const moved = (tile: number): PlayerView => ({
    ...view,
    units: view.units.map((unit) => (unit.id === 'u1_k7m2qd' ? { ...unit, tile } : unit)),
  });

  it('starts a slide for every unit that is in both views on different tiles, and only for those', () => {
    const next = moved(48);
    const slides = startSlides(view, next, 5000);
    expect(slides.length).toBe(1);
    expect(slides[0].unitId).toBe('u1_k7m2qd');
    expect(slides[0].startedAt).toBe(5000);
    // It starts where the unit was: one tile to the west of where it is now.
    const from = tileOrigin(tileCoord(47, view));
    const to = tileOrigin(tileCoord(48, view));
    expect([slides[0].fromDx, slides[0].fromDy]).toEqual([from.px - to.px, from.py - to.py]);

    expect(startSlides(view, view, 0)).toEqual([]);
    // A unit that is new in the view, or gone from it, does not slide.
    const withNew = { ...view, units: [...view.units, { ...view.units[0], id: 'new', tile: 30 }] };
    expect(startSlides(view, withNew, 0)).toEqual([]);
    expect(startSlides(withNew, view, 0)).toEqual([]);
  });

  it('does not slide between views of different maps', () => {
    const other = { ...moved(48), width: view.width + 1 };
    expect(startSlides(view, other, 0)).toEqual([]);
  });

  it('a slide starts at the old tile, moves steadily closer and is over after SLIDE_MS', () => {
    const [slide] = startSlides(view, moved(48), 1000);
    expect(slideOffset(slide, 1000)).toEqual({ dx: slide.fromDx, dy: slide.fromDy });
    let last = Math.abs(slide.fromDx);
    for (let time = 1000 + 10; time < 1000 + SLIDE_MS; time += 10) {
      const offset = slideOffset(slide, time)!;
      expect(Math.abs(offset.dx)).toBeLessThan(last);
      expect(Math.sign(offset.dx)).toBe(Math.sign(slide.fromDx));
      last = Math.abs(offset.dx);
    }
    expect(slideOffset(slide, 1000 + SLIDE_MS)).toBeNull();
    expect(slideOffset(slide, 1000 + SLIDE_MS * 10)).toBeNull();
    expect(SLIDE_MS).toBeLessThanOrEqual(300); // "a short slide"
  });
});

describe('city banners (WP5)', () => {
  let browser: FakeBrowser | null = null;
  afterEach(() => {
    browser?.uninstall();
    browser = null;
  });

  it('text is drawn at a whole number of device pixels per font pixel, growing half as fast as the map', () => {
    expect([1, 2, 3, 4, 5, 6].map(bannerScale)).toEqual([1, 1, 2, 2, 3, 3]);
    for (let zoom = 1; zoom <= 18; zoom++) {
      expect(Number.isInteger(bannerScale(zoom))).toBe(true);
      expect(bannerScale(zoom)).toBeGreaterThanOrEqual(1);
      expect(bannerScale(zoom)).toBeGreaterThanOrEqual(zoom / 2);
      expect(bannerScale(zoom)).toBeLessThan(zoom / 2 + 1);
    }
  });

  it('the frame is one art pixel thick: as many device pixels as the zoom', () => {
    expect([1, 2, 3, 4, 6, 12].map(bannerFrame)).toEqual([1, 2, 3, 4, 6, 12]);
  });

  it('even the longest city name with a large population stays within BANNER_REACH tiles of its city at every zoom', () => {
    // The renderer skips the banners of cities further off screen than that.
    for (const civ of Object.values(CIVS)) {
      for (const cityName of civ.cityNames) {
        const layout = bannerLayout(`${cityName} 9`, 99); // a name from the second round through the list
        for (let zoom = 1; zoom <= 18; zoom++) {
          const artPixelsWide = bannerSize(layout, bannerScale(zoom), bannerFrame(zoom)).width / zoom;
          expect(artPixelsWide / 2, `${cityName} at zoom ${zoom}`).toBeLessThanOrEqual(BANNER_REACH * TILE_WIDTH);
        }
      }
    }
  });

  it('lays out the name in upper case and the population in a cell of its own', () => {
    const layout = bannerLayout('Rome', 2);
    expect(layout.name).toBe('ROME');
    expect(layout.population).toBe('2');
    // Padding, name, padding, dividing line, padding, population, padding.
    expect(layout.width).toBe(3 + measureText('ROME') + 3 + 1 + 3 + measureText('2') + 3);
    expect(layout.height).toBe(1 + FONT_HEIGHT + 1);
    expect(layout.nameX + measureText(layout.name)).toBeLessThan(layout.dividerX);
    expect(layout.dividerX).toBeLessThan(layout.populationX);
    expect(layout.populationX + measureText(layout.population)).toBeLessThan(layout.width);

    // A longer name or a two-digit population makes the banner wider by exactly the extra letters.
    expect(bannerLayout('Thebes', 2).width - layout.width).toBe(measureText('THEBES') - measureText('ROME'));
    expect(bannerLayout('Rome', 12).width - layout.width).toBe(measureText('12') - measureText('2'));
    // "Rome 2" with 5 citizens and "Rome" with 25 are told apart by where the line is.
    expect(bannerLayout('Rome 2', 5).dividerX).not.toBe(bannerLayout('Rome', 25).dividerX);
    // The whole banner is the plate plus the frame on every side.
    expect(bannerSize(layout, 2, 3)).toEqual({ width: layout.width * 2 + 6, height: layout.height * 2 + 6 });
  });

  it('draws a dark frame, a plate in the primary colour and the text in the secondary colour; fogged, both are dimmed', () => {
    browser = installFakeBrowser({ devicePixelRatio: 1 });
    const colors = { primary: CIVS.rome.primary, secondary: CIVS.rome.secondary };
    const layout = bannerLayout('Rome', 2);
    const size = bannerSize(layout, 2, 3);

    const bright = browser.createCanvas({ left: 0, top: 0, width: 200, height: 50 });
    drawBanner(bright.element.getContext('2d')!, layout, colors, false, 10, 20, 2, 3);
    const rects = bright.calls.filter((call) => call.method === 'fillRect');
    // First the whole banner in the frame colour, then the plate inside the frame.
    expect(rects[0]).toMatchObject({ args: [10, 20, size.width, size.height], fillStyle: PALETTE.outline });
    expect(rects[1]).toMatchObject({ args: [13, 23, layout.width * 2, layout.height * 2], fillStyle: colors.primary });
    // Everything else is the letters (in the secondary colour) and the dividing line (frame colour).
    const rest = rects.slice(2);
    const ink = rest.filter((call) => call.fillStyle === colors.secondary);
    const line = rest.filter((call) => call.fillStyle === PALETTE.outline);
    expect(ink.length).toBeGreaterThan(40);
    expect(line.length).toBe(1);
    expect(ink.length + line.length).toBe(rest.length);
    expect(line[0].args).toEqual([13 + layout.dividerX * 2, 23, 2, layout.height * 2]);
    // Every rectangle is on whole pixels and inside the banner; the letters stay on the plate.
    for (const call of rects) {
      const [x, y, width, height] = call.args as number[];
      for (const value of [x, y, width, height]) expect(Number.isInteger(value)).toBe(true);
      expect(x).toBeGreaterThanOrEqual(10);
      expect(y).toBeGreaterThanOrEqual(20);
      expect(x + width).toBeLessThanOrEqual(10 + size.width);
      expect(y + height).toBeLessThanOrEqual(20 + size.height);
    }
    for (const call of ink) {
      const [x, y, width, height] = call.args as number[];
      expect(x).toBeGreaterThan(13);
      expect(y).toBeGreaterThan(23);
      expect(x + width).toBeLessThan(13 + layout.width * 2);
      expect(y + height).toBeLessThan(23 + layout.height * 2);
    }

    const fogged = browser.createCanvas({ left: 0, top: 0, width: 200, height: 50 });
    drawBanner(fogged.element.getContext('2d')!, layout, colors, true, 10, 20, 2, 3);
    const foggedRects = fogged.calls.filter((call) => call.method === 'fillRect');
    expect(foggedRects.length).toBe(rects.length);
    expect(foggedRects[1].fillStyle).toBe(foggedColor(colors.primary));
    expect(foggedRects.some((call) => call.fillStyle === foggedColor(colors.secondary))).toBe(true);
    expect(foggedRects.some((call) => call.fillStyle === colors.primary || call.fillStyle === colors.secondary)).toBe(false);
  });
});

describe('the fogged and the spent look (WP5)', () => {
  it('fogged is every colour blended 45% towards the colour of the unknown, alpha untouched', () => {
    expect(FOG_COLOR).toBe('#22223a');
    expect(FOG_AMOUNT).toBe(0.45);
    // White: 255 + (0x22 - 255) * 0.45 = 155.55, and 255 + (0x3a - 255) * 0.45 = 166.35.
    expect(colorWithLook([255, 255, 255, 255], 'fogged')).toEqual([156, 156, 166, 255]);
    expect(colorWithLook([0, 0, 0, 64], 'fogged')).toEqual([15, 15, 26, 64]);
    expect(colorWithLook(parseColor(FOG_COLOR), 'fogged')).toEqual(parseColor(FOG_COLOR));
    expect(foggedColor('#ffffff')).toBe('#9c9ca6');
    expect(colorWithLook([12, 34, 56, 78], 'normal')).toEqual([12, 34, 56, 78]);
  });

  it('imageWithLook changes every pixel of a copy and leaves the original alone', () => {
    const image = createImage(2, 1);
    blendPixel(image, 0, 0, [255, 255, 255, 255]);
    const fogged = imageWithLook(image, 'fogged');
    expect(getPixel(fogged, 0, 0)).toEqual([156, 156, 166, 255]);
    expect(getPixel(fogged, 1, 0)[3]).toBe(0); // an empty pixel stays empty
    expect(getPixel(image, 0, 0)).toEqual([255, 255, 255, 255]);
    expect(imageWithLook(image, 'normal').pixels).toEqual(image.pixels);
    expect(imageWithLook(image, 'normal').pixels).not.toBe(image.pixels);
  });

  it('a shadow drawn over a fogged ground gives the same as fogging the finished picture', () => {
    // This is why fogging sprite by sprite is allowed to stand in for fogging the whole tile.
    const ground = parseColor(PALETTE.grassBase);
    const shadow = parseColor(PALETTE.shadow);

    const together = createImage(1, 1);
    blendPixel(together, 0, 0, ground);
    blendPixel(together, 0, 0, shadow);
    const foggedAfterwards = getPixel(imageWithLook(together, 'fogged'), 0, 0);

    const separately = createImage(1, 1);
    blendPixel(separately, 0, 0, colorWithLook(ground, 'fogged'));
    blendPixel(separately, 0, 0, colorWithLook(shadow, 'fogged'));
    const foggedEach = getPixel(separately, 0, 0);

    for (let channel = 0; channel < 4; channel++) {
      expect(Math.abs(foggedEach[channel] - foggedAfterwards[channel])).toBeLessThanOrEqual(1); // rounding only
    }
  });

  it('spent is darker and greyer than the colour itself, but keeps which channel is strongest', () => {
    for (const civ of Object.values(CIVS)) {
      const color = parseColor(civ.primary);
      const spent = colorWithLook(color, 'spent');
      const spread = (rgba: number[]) => Math.max(rgba[0], rgba[1], rgba[2]) - Math.min(rgba[0], rgba[1], rgba[2]);
      const brightness = (rgba: number[]) => rgba[0] + rgba[1] + rgba[2];
      expect(spread(spent)).toBeLessThan(spread(color));
      expect(brightness(spent)).toBeLessThan(brightness(color));
      expect(spread(spent)).toBeGreaterThan(10); // not plain grey: still the owner's colour
      const strongest = (rgba: number[]) => rgba.indexOf(Math.max(rgba[0], rgba[1], rgba[2]));
      expect(strongest(spent)).toBe(strongest(color));
      expect(spent[3]).toBe(255);
    }
  });
});

describe('the pale line around a unit among trees', () => {
  const SOLID = parseColor('#c81e1e');
  const SHADOW = parseColor(PALETTE.shadow);

  /** A picture from rows of characters: 'X' solid, ':' shadow, '.' empty. */
  function picture(rows: string[]): RasterImage {
    const image = createImage(rows[0].length, rows.length);
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        if (row[x] === 'X') blendPixel(image, x, y, SOLID);
        if (row[x] === ':') blendPixel(image, x, y, SHADOW);
      }
    });
    return image;
  }

  /** The picture as rows of characters again: 'r' is the line. */
  function drawn(image: RasterImage): string[] {
    const rows: string[] = [];
    for (let y = 0; y < image.height; y++) {
      let row = '';
      for (let x = 0; x < image.width; x++) {
        const pixel = getPixel(image, x, y);
        if (pixel[3] === 0) row += '.';
        else if (pixel.join() === RIM_COLOR.join()) row += 'r';
        else if (pixel.join() === SOLID.join()) row += 'X';
        else if (pixel.join() === SHADOW.join()) row += ':';
        else row += '?';
      }
      rows.push(row);
    }
    return rows;
  }

  it('paints the empty pixels left, right, above and below every solid pixel, and not the corners', () => {
    expect(RIM_ROWS_ADDED).toBe(1);
    expect(drawn(imageWithRim(picture(['.....', '..X..', '..X..', '.....'])))).toEqual([
      '.....', // the row that was added on top
      '..r..',
      '.rXr.',
      '.rXr.',
      '..r..',
    ]);
  });

  it('a figure that touches the top edge gets its line in the added row; at the sides and the bottom the line is cut off', () => {
    expect(drawn(imageWithRim(picture(['X..', '...', '..X'])))).toEqual([
      'r..',
      'Xr.',
      'r.r',
      '.rX',
    ]);
  });

  it('leaves the cast shadow alone: it is not painted over and gets no line of its own', () => {
    expect(drawn(imageWithRim(picture(['....', '.X..', '.:::', '....'])))).toEqual([
      '....',
      '.r..',
      'rXr.',
      '.:::',
      '....',
    ]);
  });

  it('does not change the picture it is given', () => {
    const image = picture(['.X.', '...']);
    const before = Array.from(image.pixels);
    imageWithRim(image);
    expect(Array.from(image.pixels)).toEqual(before);
  });

  it('every unit has a rimmed picture for every owner and look: the same figure, one row taller and drawn one row higher', () => {
    const images = new Map(buildSpriteImages().map((entry) => [entry.key, entry]));
    for (const unit of ['unit.warrior', 'unit.scout', 'unit.settler'] as const) {
      for (const owner of ['rome', 'norse', 'neutral'] as const) {
        for (const look of ['normal', 'spent'] as const) {
          const plain = images.get(spriteKey(unit, '', owner, look));
          const rimmed = images.get(spriteKey(unit, 'rim', owner, look));
          if (plain === undefined || rimmed === undefined) throw new Error(`no pictures for ${unit} of ${owner}, ${look}`);
          expect(rimmed.image.width).toBe(plain.image.width);
          expect(rimmed.image.height).toBe(plain.image.height + 1);
          expect(rimmed.offsetX).toBe(plain.offsetX);
          expect(rimmed.offsetY).toBe(plain.offsetY - 1);
          // Every pixel of the plain picture is still there, one row down; the line only fills empty pixels.
          let linePixels = 0;
          for (let y = 0; y < rimmed.image.height; y++) {
            for (let x = 0; x < rimmed.image.width; x++) {
              const before: number[] = y === 0 ? [0, 0, 0, 0] : getPixel(plain.image, x, y - 1);
              const after = getPixel(rimmed.image, x, y);
              if (before[3] !== 0) expect(after).toEqual(before);
              else if (after[3] !== 0) linePixels += 1;
            }
          }
          // The line goes all the way round a figure about 12 x 16 pixels: a few dozen pixels.
          expect(linePixels).toBeGreaterThan(30);
        }
      }
    }
  });
});

describe('the sprite sheet\'s layout (WP5)', () => {
  /** A picture filled with one colour, so it can be found again on the sheet. */
  function block(width: number, height: number, shade: number): RasterImage {
    const image = createImage(width, height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) blendPixel(image, x, y, [shade, shade, shade, 255]);
    return image;
  }

  it('packImages puts every picture on the sheet whole, apart from the others and from the edge', () => {
    const pictures = [block(26, 28, 10), block(8, 9, 20), block(26, 14, 30), block(13, 7, 40), block(26, 28, 50), block(4, 4, 60)];
    const { sheet, places } = packImages(pictures, 64);
    expect(sheet.width).toBe(64);
    expect(places.length).toBe(pictures.length);

    let filled = 0;
    pictures.forEach((picture, index) => {
      const shade = (index + 1) * 10;
      const { x, y } = places[index];
      expect(x).toBeGreaterThanOrEqual(1);
      expect(y).toBeGreaterThanOrEqual(1);
      expect(x + picture.width).toBeLessThanOrEqual(sheet.width - 1);
      expect(y + picture.height).toBeLessThanOrEqual(sheet.height - 1);
      for (let row = 0; row < picture.height; row++) {
        for (let column = 0; column < picture.width; column++) {
          expect(getPixel(sheet, x + column, y + row)).toEqual([shade, shade, shade, 255]);
        }
      }
      // An empty line of pixels all the way round: nothing of a neighbor can bleed in when the sprite is enlarged.
      for (let column = -1; column <= picture.width; column++) {
        expect(getPixel(sheet, x + column, y - 1)[3]).toBe(0);
        expect(getPixel(sheet, x + column, y + picture.height)[3]).toBe(0);
      }
      for (let row = -1; row <= picture.height; row++) {
        expect(getPixel(sheet, x - 1, y + row)[3]).toBe(0);
        expect(getPixel(sheet, x + picture.width, y + row)[3]).toBe(0);
      }
      filled += picture.width * picture.height;
    });
    // Nothing overlaps: the sheet holds exactly as many filled pixels as the pictures have.
    let opaque = 0;
    for (let at = 3; at < sheet.pixels.length; at += 4) if (sheet.pixels[at] !== 0) opaque += 1;
    expect(opaque).toBe(filled);
  });

  it('packImages copies see-through pixels unchanged (a shadow stays a 25% shadow)', () => {
    const shadow = createImage(2, 1);
    blendPixel(shadow, 0, 0, [0, 0, 0, 64]);
    blendPixel(shadow, 1, 0, [255, 255, 255, 56]);
    const { sheet, places } = packImages([block(3, 3, 10), shadow], 16);
    expect(getPixel(sheet, places[1].x, places[1].y)).toEqual([0, 0, 0, 64]);
    expect(getPixel(sheet, places[1].x + 1, places[1].y)).toEqual([255, 255, 255, 56]);
  });

  it('packImages refuses a picture that is wider than the sheet', () => {
    expect(() => packImages([block(63, 4, 10)], 64)).toThrow();
    expect(() => packImages([block(62, 4, 10)], 64)).not.toThrow();
  });

  it('pickVariant gives every tile one variant, always the same, spread evenly and without stripes', () => {
    const size = MAP_SIZES.large;
    const counts = [0, 0, 0];
    let sameAsLeft = 0;
    let sameAsAbove = 0;
    for (let tile = 0; tile < size.width * size.height; tile++) {
      const variant = pickVariant(tile, 3);
      expect(variant).toBe(pickVariant(tile, 3));
      expect([0, 1, 2]).toContain(variant);
      counts[variant] += 1;
      if (tile % size.width > 0 && variant === pickVariant(tile - 1, 3)) sameAsLeft += 1;
      if (tile >= size.width && variant === pickVariant(tile - size.width, 3)) sameAsAbove += 1;
    }
    const tiles = size.width * size.height;
    for (const count of counts) {
      expect(count).toBeGreaterThan(tiles * 0.28);
      expect(count).toBeLessThan(tiles * 0.39);
    }
    // With three variants a tile matches its neighbor about one time in three: no runs along rows, no columns.
    expect(sameAsLeft / tiles).toBeGreaterThan(0.25);
    expect(sameAsLeft / tiles).toBeLessThan(0.42);
    expect(sameAsAbove / tiles).toBeGreaterThan(0.25);
    expect(sameAsAbove / tiles).toBeLessThan(0.42);
    expect(pickVariant(123, 1)).toBe(0);
  });
});
