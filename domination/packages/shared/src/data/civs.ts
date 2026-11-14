/**
 * Civilization table: the six playable civilizations of phase 1.
 *
 * Colours are fixed by the art direction: `primary` is the main owner colour
 * (roofs, soldiers, borders, banner background), `secondary` is the accent
 * (banner text, inner border line). `text` is for the web page only: small
 * print on `primary` (a player's name in the top bar, the leader in the
 * lobby). It is the accent where the accent is easy enough to read there,
 * and a lighter or darker colour where it is not; a table test holds every
 * `text` to a contrast of 4.5 to 1 against `primary`. The map never uses it.
 *
 * City names are real historical places, written in plain ASCII letters and
 * spaces only, because the in-game pixel font only has those characters.
 * The first name of each list is the capital. Leader names are never drawn
 * with that font (the lobby prints them as ordinary page text), so they may
 * also carry an apostrophe: "Yax K'uk' Mo'".
 */

export type CivId = 'rome' | 'egypt' | 'china' | 'mali' | 'maya' | 'norse';

export interface CivDef {
  /** Name shown to players. */
  name: string;
  /** A historical leader, shown in the lobby for flavour only (page text: letters, spaces and apostrophes). */
  leader: string;
  /** Main owner colour, '#rrggbb'. */
  primary: string;
  /** Accent colour, '#rrggbb'. */
  secondary: string;
  /** Colour of small page text on `primary`, '#rrggbb' (see the top of this file). */
  text: string;
  /** Names given to this civilization's cities, in founding order. */
  cityNames: readonly string[];
}

/** All civ ids, in the order they are offered in the lobby. */
export const CIV_IDS: readonly CivId[] = ['rome', 'egypt', 'china', 'mali', 'maya', 'norse'];

export const CIVS: Record<CivId, CivDef> = {
  rome: {
    name: 'Rome', leader: 'Hadrian', primary: '#c81e1e', secondary: '#f6dc8c', text: '#fff3cc',
    cityNames: ['Rome', 'Ostia', 'Capua', 'Ravenna', 'Mediolanum', 'Neapolis', 'Tarentum', 'Aquileia'],
  },
  egypt: {
    name: 'Egypt', leader: 'Hatshepsut', primary: '#e3b94a', secondary: '#17323a', text: '#17323a',
    cityNames: ['Thebes', 'Memphis', 'Heliopolis', 'Abydos', 'Elephantine', 'Giza', 'Edfu', 'Dendera'],
  },
  china: {
    name: 'China', leader: 'Taizong of Tang', primary: '#1f8f5a', secondary: '#f5e3a3', text: '#06120a',
    cityNames: ['Changan', 'Luoyang', 'Kaifeng', 'Hangzhou', 'Nanjing', 'Chengdu', 'Guangzhou', 'Suzhou'],
  },
  mali: {
    name: 'Mali', leader: 'Mansa Musa', primary: '#d98a3a', secondary: '#2a1606', text: '#2a1606',
    cityNames: ['Niani', 'Timbuktu', 'Djenne', 'Gao', 'Walata', 'Koumbi', 'Kangaba', 'Tadmekka'],
  },
  maya: {
    name: 'Maya', leader: "Yax K'uk' Mo'", primary: '#1f7fa0', secondary: '#a9ecd4', text: '#ffffff',
    cityNames: ['Copan', 'Tikal', 'Palenque', 'Calakmul', 'Uxmal', 'Chichen Itza', 'Caracol', 'Yaxchilan'],
  },
  norse: {
    name: 'Norse', leader: 'Harald Hardrada', primary: '#4a5a9a', secondary: '#dfe5f2', text: '#dfe5f2',
    cityNames: ['Nidaros', 'Uppsala', 'Birka', 'Hedeby', 'Ribe', 'Kaupang', 'Jelling', 'Sigtuna'],
  },
};

/**
 * Name of the next city a civilization founds.
 *
 * @param civ            the founding player's civilization
 * @param citiesFounded  how many cities that player has founded before this one (0 for the capital)
 *
 * The list is used in order. When it runs out it starts again with a number
 * added: 'Rome', 'Ostia', ..., 'Aquileia', 'Rome 2', 'Ostia 2', ...
 *
 * A deliberate choice: because the order is fixed, seeing a city called
 * 'Ravenna' tells you Rome has founded at least four cities. That is the
 * classic behaviour of the genre and is on the list of public facts in
 * protocol.ts. (Shuffling the list per player would hide the count but still
 * not make names independent of hidden cities; only player-chosen names
 * would, and those are a later feature.)
 */
export function cityNameFor(civ: CivId, citiesFounded: number): string {
  const names = CIVS[civ].cityNames;
  const base = names[citiesFounded % names.length];
  const round = Math.floor(citiesFounded / names.length);
  return round === 0 ? base : `${base} ${round + 1}`;
}
