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
  /** One sentence: what this kind of unit is for (UNITS[type].description). */
  unitDescription: 'unit-description',
  unitMoves: 'unit-moves',
  /** "Tile: Hills on Plains. Yields 0 food, 2 production." */
  unitTile: 'unit-tile',
  foundCityButton: 'found-city-button',
  /** The block of a unit that can build improvements: its job buttons, or its job in progress. Hidden for other units. */
  unitJobs: 'unit-jobs',
  /** One per improvement: `job-start-<improvementId>`, a button whose text begins "Build Farm (4 turns)". Disabled when the job cannot be started here. */
  jobStart: 'job-start-',
  /** The one sentence for the whole block when every job is impossible for the same reason. Hidden otherwise. */
  unitJobsReason: 'unit-jobs-reason',
  /** One per improvement: `job-reason-<improvementId>`: why its button is disabled. Hidden when it is not, and when unitJobsReason says it for all. */
  jobReason: 'job-reason-',
  /** "Building a Farm: 3 turns left". Hidden while the unit has no job. */
  unitJob: 'unit-job',
  /** The "Stop work" button. Hidden while the unit has no job. */
  jobStop: 'job-stop',

  cityPanel: 'city-panel',
  cityName: 'city-name',
  cityPopulation: 'city-population',
  cityFood: 'city-food',
  cityProduction: 'city-production',
  /** The line under the queue title that says why the queue cannot be changed (hidden when there is nothing to say). */
  queueNote: 'queue-note',
  /** "Queue 3 of 8", in the panel's head (it stays in sight while the panel scrolls). */
  queueCount: 'queue-count',
  /** The list of queue rows. */
  cityQueue: 'city-queue',
  /** One per queue entry, counted from 0: `queue-row-0`, `queue-row-1`... A row beyond the end of the queue is hidden. */
  queueRow: 'queue-row-',
  /** The three buttons of a row: `queue-up-0`, `queue-down-0`, `queue-remove-0`. */
  queueUp: 'queue-up-',
  queueDown: 'queue-down-',
  queueRemove: 'queue-remove-',
  queueClear: 'queue-clear',
  /** One per build option: `build-<unitTypeId>`. A press adds the item to the end of the queue. */
  buildOption: 'build-',

  /**
   * The tile card: what is on a tile the player tapped or clicked. Has the
   * attributes data-tile="<tile index>" and
   * data-knowledge="unexplored|remembered|visible".
   */
  tileCard: 'tile-card',
  tileCardClose: 'tile-card-close',
  /** The card's heading: the ground ("Forest on Grassland"), or "Unexplored". */
  tileCardTitle: 'tile-card-title',
  /**
   * One per line of the card: `tile-card-line-<kind>`, with the kinds of
   * TileInfoLineKind (remembered, city, building, unit, improvement,
   * yields, worked, canBuild, movement, owner). A tile with two units has
   * two `tile-card-line-unit`.
   */
  tileCardLine: 'tile-card-line-',

  /** The hover box: the same for the tile under a resting mouse. Same attributes as the tile card. */
  hoverBox: 'hover-box',
  hoverBoxTitle: 'hover-box-title',
  /** One per line: `hover-box-line-<kind>`. */
  hoverBoxLine: 'hover-box-line-',

  /** Every toast. */
  toast: 'toast',
} as const;

export type TestId = (typeof TEST_IDS)[keyof typeof TEST_IDS];
