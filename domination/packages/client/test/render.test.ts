import { describe, it } from 'vitest';

/**
 * Tests WP5 must write for the renderer's pure parts. They run in plain
 * Node (no canvas): sprite rasterising and camera maths are pure functions
 * exactly so that they can be tested here. (geometry.test.ts already covers
 * the hex shape, tiling and hit testing.)
 *
 * How the map LOOKS is checked by eye against
 * docs/art/style-d-reference.svg, in demo mode (/?demo).
 */

describe('rasterizeSprite (WP5)', () => {
  it.todo('draws the example tree: outline, three greens, trunk and a 25% shadow in the right pixels');
  it.todo('maps the reserved characters . # : 1 2 3 4 as documented in format.ts');
  it.todo('stamps parts first and the sprite\'s own rows on top');
  it.todo('blends semi-transparent pixels over what is underneath');
  it.todo('throws a clear error for a row of the wrong length, a missing row, an unknown character, or an owner character without an owner');
  it.todo('ownerRamp returns a lighter, the same and a darker colour');
});

describe('the art (WP5)', () => {
  it.todo('there is a sprite for every SpriteId (every terrain, feature and unit type in the tables, and the city)');
  it.todo('every sprite rasterises without error, for every civilization where it uses owner colours');
  it.todo('every ground sprite covers exactly the pixel hexagon (isInsideHex) and nothing outside it');
  it.todo('unit and city sprites use owner colours, so two civilizations give different pixels');
  it.todo('the pixel font has a 5 x 7 glyph for A-Z, 0-9 and space, and measureText adds up widths and gaps');
});

describe('camera (WP5)', () => {
  it.todo('zoomRange gives whole-number zooms for device pixel ratios 1, 1.25, 1.5, 2 and 3');
  it.todo('deviceToArt and artToDevice are inverses at every zoom');
  it.todo('clampCamera keeps a large map from scrolling away and centres a map smaller than the viewport');
  it.todo('zoomCamera keeps the art pixel under the anchor in place and stays inside the zoom range');
  it.todo('visibleTileRange covers every tile that touches the viewport and stays inside the map');
});
