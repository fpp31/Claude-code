/**
 * How a city places its citizens: the "Grow first / Build first" choice of
 * every city (round 3). One table; the two names, the two small lines and
 * the two descriptions the city panel prints are here.
 *
 * What each way DOES is in cityEconomy (rules/city.ts): one function for
 * turn resolution, the view and the forecast.
 *
 * Never remove or rename an id that saved games may contain without writing
 * a save migration (see data/rules.ts).
 */

export type CityFocusId = 'grow' | 'build';

export interface CityFocusDef {
  /**
   * The words on the button: 'Grow first', 'Build first'. At most 11
   * characters, one line. Not the bare verb: "Build" alone reads as an
   * order to the city's queue ("Nothing to build", "Choose what to build").
   */
  name: string;
  /**
   * The small line inside the button: what this way puts first. Plain
   * words, at most 34 characters, no digit, no full stop, a small first
   * letter. It never changes with the city, so the two buttons never
   * change their size.
   */
  summary: string;
  /**
   * One or two sentences for players: what the citizens do under this way,
   * and what it costs. The button's tooltip. Ends with a full stop, no
   * digit. Build's says that the city never shrinks: its food line may show
   * a minus, and a city on Build eats its saved food down to nothing and
   * never loses a citizen.
   */
  description: string;
}

/** Both ways, in the order the city panel shows them. */
export const CITY_FOCUS_IDS: readonly CityFocusId[] = ['grow', 'build'];

export const CITY_FOCUS: Record<CityFocusId, CityFocusDef> = {
  grow: {
    name: 'Grow first', summary: 'growth before production',
    description: 'Citizens take the best tiles, and food before production whenever the city would stop growing.',
  },
  build: {
    name: 'Build first', summary: 'most production, growth may stop',
    description: 'Citizens take the tiles with the most production. The city grows slowly or not at all; it never shrinks.',
  },
};

/** The way a newly founded city starts with, and every city of an older saved game. */
export const DEFAULT_CITY_FOCUS: CityFocusId = 'grow';
