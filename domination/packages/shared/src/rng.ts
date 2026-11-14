/**
 * Seeded random numbers.
 *
 * The rules must be deterministic: the same seed and the same actions always
 * give the same game. So nothing in packages/shared may use the built-in
 * random function or the clock. All randomness comes from here.
 *
 * A generator is just its STATE: four whole numbers that live inside the game
 * state and are saved with it. Every function below takes the state, updates
 * it in place and returns the next random value. Load a save, keep calling,
 * and the sequence carries on exactly where it stopped.
 *
 * One seed string feeds several independent STREAMS, each named by a string:
 *   seedRng(seed, 'map')     map generation (stream names starting with 'map')
 *   seedRng(seed, 'dice')    gameplay dice (GameState.rng, unused in phase 1)
 *   seedRng(seed, 'ids:p3')  unit and city ids of player p3 (PlayerState.idRng)
 * Separate streams keep secrets apart: ids a player can see reveal nothing
 * about the dice or about what other players have built.
 *
 * The generator is "sfc32" (small fast counting generator, 32-bit); the seed
 * hash is "cyrb128". Both are well-known public-domain algorithms.
 * Changing either would change every map and break saved games.
 */

/** The four numbers of a generator, each a whole number from 0 to 4294967295. */
export type RngState = [number, number, number, number];

/** Turns any string into four well-mixed 32-bit numbers (the cyrb128 hash). */
function hashString(text: string): RngState {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/**
 * Creates the starting state of one random stream.
 *
 * @param seed    the game's seed (any string)
 * @param stream  name of the stream; different names give unrelated sequences
 */
export function seedRng(seed: string, stream: string): RngState {
  // The length prefix keeps ('ab', 'c') and ('a', 'bc') apart.
  const rng = hashString(`${seed.length}:${seed}/${stream}`);
  // Throw away the first few values so the hash is thoroughly stirred in.
  for (let i = 0; i < 16; i++) nextUint32(rng);
  return rng;
}

/** The next random whole number from 0 to 4294967295. Advances the state. */
export function nextUint32(rng: RngState): number {
  let a = rng[0] | 0;
  let b = rng[1] | 0;
  let c = rng[2] | 0;
  let d = rng[3] | 0;
  const t = (((a + b) | 0) + d) | 0;
  d = (d + 1) | 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) | 0;
  c = (c << 21) | (c >>> 11);
  c = (c + t) | 0;
  // ">>> 0" stores each number as a non-negative whole number, which is tidy in save files.
  rng[0] = a >>> 0;
  rng[1] = b >>> 0;
  rng[2] = c >>> 0;
  rng[3] = d >>> 0;
  return t >>> 0;
}

/** The next random fraction: at least 0, less than 1. Advances the state. */
export function nextFloat(rng: RngState): number {
  return nextUint32(rng) / 4294967296;
}

/**
 * The next random whole number from 0 to bound - 1, every value equally
 * likely. `bound` must be a whole number from 1 to 4294967296.
 */
export function nextInt(rng: RngState, bound: number): number {
  if (!Number.isInteger(bound) || bound < 1 || bound > 4294967296) {
    throw new Error(`nextInt: bound must be a whole number from 1 to 4294967296, got ${bound}`);
  }
  // Values at the very top of the range would make small results slightly
  // more likely, so they are skipped and drawn again.
  const limit = 4294967296 - (4294967296 % bound);
  let value = nextUint32(rng);
  while (value >= limit) value = nextUint32(rng);
  return value % bound;
}

/** Picks one item at random. The list must not be empty. */
export function pick<T>(rng: RngState, items: readonly T[]): T {
  if (items.length === 0) throw new Error('pick: the list is empty');
  return items[nextInt(rng, items.length)];
}

/** Shuffles the list in place (Fisher-Yates) and returns it. */
export function shuffle<T>(rng: RngState, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = nextInt(rng, i + 1);
    const swap = items[i];
    items[i] = items[j];
    items[j] = swap;
  }
  return items;
}
