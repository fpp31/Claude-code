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

  rock: '#c8b090',
  rockShade: '#7c6858',
  rockLight: '#f0e0c0',
  snow: '#ffffff',
  snowShade: '#b8d0f0',

  wall: '#f8f0d8',
  wallShade: '#c8bca0',
  window: '#3a5088',
  door: '#6a4a2a',

  skin: '#ffd0a0',
  steel: '#ffffff',
  gold: '#f8c020',
} as const;
