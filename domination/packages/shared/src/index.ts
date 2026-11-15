/**
 * Everything the server and the client may import from the shared package:
 *   import { applyAction, type PlayerView } from '@domination/shared';
 *
 * This package is the rules of the game. It is pure: no Node, no browser, no
 * clock, no built-in random function. See ARCHITECTURE.md at the project root.
 */

// Data tables (every balance number lives in src/data/)
export * from './data/terrain';
export * from './data/units';
export * from './data/improvements';
export * from './data/civs';
export * from './data/rules';

// Contract types
export * from './types';
export * from './actions';
export * from './viewTypes';
export * from './protocol';
export * from './stateMigrations';

// Foundations
export * from './hex';
export * from './rng';
export * from './ids';
export * from './json';

// Map generation (WP1)
export * from './mapgen/generateMap';

// Rules engine (WP2)
export * from './rules/createGame';
export * from './rules/applyAction';
export * from './rules/movement';
export * from './rules/city';
export * from './rules/improvements';
export * from './rules/turn';
export * from './rules/invariants';

// Fog of war and per-player views (WP2)
export * from './view/visibility';
export * from './view/playerView';
export * from './view/patch';
