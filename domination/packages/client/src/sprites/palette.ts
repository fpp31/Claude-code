/**
 * The colours of art style D, taken from docs/art/style-d-reference.svg.
 * Sprites should use these names instead of repeating hex codes, so the
 * whole look can be adjusted in one place.
 */

export const PALETTE = {
  /** Dark outline of every raised object; also the colour of the unknown (never-seen tiles, page background). */
  outline: '#22223a',
  /** Cast shadow: black at 25%. */
  shadow: '#00000040',
  /** Faint hint of the hex grid on the lower and right edges of a ground tile: black at 10%. */
  gridHint: '#0000001a',

  oceanBase: '#3a70f0',
  oceanWave: '#78a8ff',
  coastBase: '#58a8f8',
  coastWave: '#d8f0ff',

  grassBase: '#a8e038',
  grassTuftDark: '#58b030',
  grassTuftLight: '#e0f880',

  plainsBase: '#e0d850',
  plainsStalkDark: '#b89828',
  plainsStalkLight: '#fff8a8',

  desertBase: '#f8e098',
  desertDune: '#e0b860',
  desertDuneLight: '#fff4c8',
  cactus: '#3cc050',

  pine: '#48c058',
  pineShade: '#1c7858',
  pineLight: '#b0f080',
  trunk: '#a86a32',

  hill: '#78d048',
  hillShade: '#38a048',
  hillLight: '#d8f890',
  /** Hills on plains and on desert take their colours from that ground (not in the reference, which only has hills on grass). */
  plainsHill: '#e8c838',
  plainsHillShade: '#b89828',
  plainsHillLight: '#fff8a8',
  desertHill: '#f0c870',
  desertHillShade: '#d09848',
  desertHillLight: '#fff4c8',

  rock: '#c8b090',
  rockShade: '#7c6858',
  rockLight: '#f0e0c0',
  snow: '#ffffff',
  snowShade: '#b8d0f0',
  /** Mountains in the desert are warmer sandstone (not in the reference). */
  sandstone: '#e0a868',
  sandstoneShade: '#a06840',
  sandstoneLight: '#f8dca8',

  wall: '#f8f0d8',
  wallShade: '#c8bca0',
  window: '#3a5088',
  door: '#6a4a2a',

  skin: '#ffd0a0',
  /** Skin in shade: skin with 22% black, as on the right cheek of the reference soldier. */
  skinShade: '#c7a27d',
  steel: '#ffffff',
  gold: '#f8c020',
  /** Wood of the bow of the reference's second soldier. */
  bow: '#e89040',

  // Not in the reference: what the Scout and the Settler wear and carry.
  hair: '#6a4a2a',
  boot: '#8a5a32',
  straw: '#f0d060',
  strawShade: '#c09838',
  strawLight: '#fff4a8',
  sack: '#f8f0d8',
  sackShade: '#c8bca0',
  plank: '#c08040',
  plankShade: '#8a5428',

  // Not in the reference: the Worker and what it builds.
  steelShade: '#b8c8e0',
  soil: '#b07a48',
  soilShade: '#8a5428',
  desertSoil: '#c89858',
  crop: '#2f9a40',

  /** Not in the reference: the pale line around a unit that stands among trees (sprites/rim.ts). */
  unitRim: '#fff8e0',

  // Not in the reference: selection and highlights (sprites/art/markers.ts).
  markerWhite: '#ffffff',
  /** Reachable tiles: a darker line on the tile's edge and inside the white ring, and a light wash over the middle. */
  reachEdge: '#22223a80',
  reachInner: '#22223a40',
  reachWash: '#ffffff38',
  hoverLine: '#ffffff99',
  /**
   * The token of a tile that citizens gather from (sprites/art/markers.ts)
   * is a rim of `gold` around this white face, the lower right of the rim
   * in `tokenShade`, a deeper gold. The white face is what no hill has: a
   * mound of hills on plains is an oval in nearly the token's own gold.
   */
  tokenFace: '#ffffff',
  tokenShade: '#f8a800',
} as const;
