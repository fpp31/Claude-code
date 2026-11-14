/**
 * Names the end-to-end test uses to find things on the page
 * (`data-testid="..."` attributes). They are part of the contract between
 * the UI (WP4) and the end-to-end script: do not rename one without changing
 * both.
 *
 * Elements that exist once use the id as it is. Elements that repeat add a
 * suffix: `lobby-seat-p1`, `lobby-civ-rome`, `build-warrior`.
 */
export const TEST_IDS = {
  // Home screen
  homeNameInput: 'home-name-input',
  homeCreateButton: 'home-create-button',
  homeCodeInput: 'home-code-input',
  homeJoinButton: 'home-join-button',
  /** The first paragraph: the welcome, or "You are invited to game K7QXM...". */
  homeIntro: 'home-intro',
  /** The line under the code field; it says why a game cannot be joined. */
  homeCodeHint: 'home-code-hint',

  // Lobby screen
  lobbyCode: 'lobby-code',
  /** The shareable link, as text. */
  lobbyLink: 'lobby-link',
  /** The warning under the link when it only works on this computer (the page was opened through localhost). */
  lobbyLocalNote: 'lobby-local-note',
  /** One per taken seat: `lobby-seat-<playerId>`. */
  lobbySeat: 'lobby-seat-',
  /** One per civilization: `lobby-civ-<civId>`. */
  lobbyCiv: 'lobby-civ-',
  /** A <select> whose option values are the map size ids. */
  lobbyMapSize: 'lobby-map-size',
  lobbyStartButton: 'lobby-start-button',
  lobbyLeaveButton: 'lobby-leave-button',

  // Game screen
  gameCanvas: 'game-canvas',
  /** Text contains the turn number, for example "Turn 7". */
  topTurn: 'top-turn',
  topCiv: 'top-civ',
  /** One per player: `top-player-<playerId>`; has the attribute data-ended="true|false". */
  topPlayer: 'top-player-',
  /** Text is the connection status: "online", "connecting" or "reconnecting". */
  topConnection: 'top-connection',
  /** Has the attribute data-ended="true|false" for the viewer's own state. */
  endTurnButton: 'end-turn-button',

  /** The "First steps" note at the start of a game (shown while nothing is selected and the player has no city). */
  startHint: 'start-hint',

  unitPanel: 'unit-panel',
  unitName: 'unit-name',
  unitMoves: 'unit-moves',
  foundCityButton: 'found-city-button',

  cityPanel: 'city-panel',
  cityName: 'city-name',
  cityPopulation: 'city-population',
  cityFood: 'city-food',
  cityProduction: 'city-production',
  /** One per build option: `build-<unitTypeId>`. */
  buildOption: 'build-',

  /** Every toast. */
  toast: 'toast',
} as const;

export type TestId = (typeof TEST_IDS)[keyof typeof TEST_IDS];
