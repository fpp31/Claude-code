/**
 * Lobby screen (work package WP4): who is in, which civilization everybody
 * plays, map size, start.
 */

import { CIVS, CIV_IDS, MAP_SIZE_IDS, RULES } from '@domination/shared';
import type { CivId, LobbyView, MapSizeId } from '@domination/shared';
import type { Connection } from '../net/connection';
import { shareLink } from '../net/identity';
import type { AppState, Store } from '../state/store';
import { setCivColors } from './civColors';
import { h, setAttribute, setClass, setDisabled, setHidden, setText } from './dom';
import type { Unmount } from './dom';
import { TEST_IDS } from './testIds';
import { countOf, ghostSeatWarning, mapSizeNote, mapSizeText } from './texts';
import { showToast } from './toasts';

/** The parts of one row of the seat list. */
interface SeatRow {
  row: HTMLElement;
  swatch: HTMLElement;
  name: HTMLElement;
  tags: HTMLElement;
  status: HTMLElement;
}

/** The parts of one button of the civilization picker. */
interface CivButton {
  button: HTMLButtonElement;
  note: HTMLElement;
}

/**
 * Shows store.lobby (a LobbyView) and sends lobby messages.
 *
 *  - The game code (TEST_IDS.lobbyCode) and the shareable link (lobbyLink,
 *    from shareLink(code)) with a "Copy link" button.
 *  - Seats: always RULES.maxSeats (8) rows, so the layout is ready for 8
 *    players. Taken seats (`lobby-seat-<playerId>`) show name, civilization
 *    colours, a host mark and whether the player is connected; free seats
 *    up to lobby.maxPlayers say "Open"; seats beyond that say "Not available
 *    yet" (only six civilizations exist in phase 1).
 *  - Civilization picker: one button per CIV_IDS entry (`lobby-civ-<civ>`)
 *    in the civ's colours, with name and leader; disabled if another seat
 *    has it; the player's own choice is marked. Click sends `chooseCiv`.
 *  - Map size: a <select> (lobbyMapSize) over MAP_SIZE_IDS showing name and
 *    "best for up to N players" (short enough for a phone); the note under
 *    it gives the size in tiles; enabled for the host only; change sends
 *    `setMapSize`.
 *  - "Start game" (lobbyStartButton): host only; sends `startGame`. Allowed
 *    with a single player.
 *    GHOST-SEAT WARNING: every seat becomes a player and the game waits for
 *    each of them every turn, so a seat nobody sits on stalls the game for
 *    good. If any seat has `connected: false` when Start is pressed, ask
 *    first with window.confirm: "Ben is not connected. The game waits for
 *    every player each turn. Start anyway?" (list all such names), and send
 *    `startGame` only on OK. The host cannot remove a seat in phase 1; the
 *    way out is for that player to come back and press Leave, or to make a
 *    new game.
 *  - "Leave" (lobbyLeaveButton): sends `leaveGame`.
 *  - Names are untrusted text: textContent only.
 */
export function mountLobbyScreen(parent: HTMLElement, store: Store, connection: Connection): Unmount {
  // ---- Build once -------------------------------------------------------------

  const code = h('span', { className: 'lobby-code', testId: TEST_IDS.lobbyCode });
  const leaveButton = h('button', {
    className: 'button',
    text: 'Leave',
    testId: TEST_IDS.lobbyLeaveButton,
    onClick: () => connection.send({ type: 'leaveGame' }),
  });

  const link = h('span', { className: 'link-text', testId: TEST_IDS.lobbyLink });
  const copyButton = h('button', { className: 'button', text: 'Copy link', onClick: copyLink });

  const seatsTitle = h('h2', { className: 'section-title' });
  const seatRows: SeatRow[] = [];
  const seatList = h('ol', { className: 'seat-list' });
  for (let index = 0; index < RULES.maxSeats; index++) {
    const swatch = h('span', { className: 'swatch' });
    const name = h('span', { className: 'seat-name' });
    const tags = h('span', { className: 'seat-tags' });
    const status = h('span', { className: 'seat-status' });
    const row = h('li', { className: 'seat' }, swatch, name, tags, status);
    seatRows.push({ row, swatch, name, tags, status });
    seatList.append(row);
  }

  const civButtons = new Map<CivId, CivButton>();
  const civGrid = h('div', { className: 'civ-grid' });
  for (const civ of CIV_IDS) {
    const note = h('span', { className: 'civ-note' });
    const button = h(
      'button',
      { className: 'civ-button', testId: TEST_IDS.lobbyCiv + civ, onClick: () => chooseCiv(civ) },
      h('span', { className: 'civ-name', text: CIVS[civ].name }),
      h('span', { className: 'civ-leader', text: CIVS[civ].leader }),
      note,
    );
    setCivColors(button, civ);
    civButtons.set(civ, { button, note });
    civGrid.append(button);
  }

  const mapSelect = h('select', { className: 'field', testId: TEST_IDS.lobbyMapSize, attributes: { id: 'lobby-map-size' } });
  for (const id of MAP_SIZE_IDS) {
    const option = h('option', { text: mapSizeText(id) });
    option.value = id;
    mapSelect.append(option);
  }
  mapSelect.addEventListener('change', onMapSizeChange);
  const mapNote = h('p', { className: 'field-hint' });

  const nextStep = h('p', { className: 'next-step', attributes: { role: 'status' } });
  const startButton = h('button', {
    className: 'button primary big',
    text: 'Start game',
    testId: TEST_IDS.lobbyStartButton,
    onClick: startGame,
  });

  const card = h(
    'div',
    { className: 'card lobby-card' },
    h('div', { className: 'lobby-head' }, h('h1', { className: 'title' }, 'Game ', code), leaveButton),
    h(
      'div',
      { className: 'invite' },
      h('p', { className: 'invite-text', text: 'Send this link to your friends so they can join:' }),
      h('div', { className: 'link-row' }, link, copyButton),
    ),
    h(
      'div',
      { className: 'lobby-columns' },
      h('section', { className: 'lobby-section' }, seatsTitle, seatList),
      h(
        'section',
        { className: 'lobby-section' },
        h('h2', { className: 'section-title', text: 'Your civilization' }),
        civGrid,
        h('label', { className: 'section-title', text: 'Map size', attributes: { for: 'lobby-map-size' } }),
        mapSelect,
        mapNote,
      ),
    ),
    h('div', { className: 'lobby-foot' }, nextStep, startButton),
  );
  const screen = h('div', { className: 'screen centered' }, card);
  parent.append(screen);

  // ---- Behaviour ----------------------------------------------------------------

  function chooseCiv(civ: CivId): void {
    const lobby = store.get().lobby;
    if (lobby === null) return;
    const mine = lobby.seats.find((seat) => seat.playerId === lobby.you);
    if (mine !== undefined && mine.civ === civ) return; // already playing it
    connection.send({ type: 'chooseCiv', civ });
  }

  function onMapSizeChange(): void {
    connection.send({ type: 'setMapSize', mapSize: mapSelect.value as MapSizeId });
  }

  function startGame(): void {
    const lobby = store.get().lobby;
    if (lobby === null) return;
    const absent = lobby.seats.filter((seat) => !seat.connected).map((seat) => seat.name);
    if (absent.length > 0 && !window.confirm(ghostSeatWarning(absent))) return;
    connection.send({ type: 'startGame' });
  }

  function copyLink(): void {
    const text = link.textContent ?? '';
    copyToClipboard(text, link).then((copied) => {
      showToast(store, copied ? 'Link copied. Paste it into a message to your friends.' : 'Select the link and copy it by hand.', 'info');
    });
  }

  // ---- Update in place on every store change ----------------------------------

  function update(state: AppState): void {
    const lobby = state.lobby;
    if (lobby === null) return; // the app is about to take this screen down
    const online = state.connection === 'online';
    const isHost = lobby.you === lobby.hostId;
    const host = lobby.seats.find((seat) => seat.playerId === lobby.hostId);

    setText(code, lobby.code);
    setText(link, shareLink(lobby.code));
    setDisabled(leaveButton, !online);

    setText(seatsTitle, `Players (${lobby.seats.length} of ${lobby.maxPlayers})`);
    seatRows.forEach((parts, index) => updateSeatRow(parts, index, lobby));

    for (const [civ, parts] of civButtons) {
      const owner = lobby.seats.find((seat) => seat.civ === civ);
      const mine = owner !== undefined && owner.playerId === lobby.you;
      const taken = owner !== undefined && !mine;
      setDisabled(parts.button, taken || !online);
      setClass(parts.button, 'chosen', mine);
      setClass(parts.button, 'taken', taken);
      setAttribute(parts.button, 'aria-pressed', mine ? 'true' : 'false');
      setText(parts.note, mine ? 'Your choice' : taken ? `Taken by ${owner.name}` : '');
    }

    if (mapSelect.value !== lobby.mapSize) mapSelect.value = lobby.mapSize;
    setDisabled(mapSelect, !isHost || !online);
    setText(mapNote, mapSizeNote(lobby.mapSize, isHost ? null : host?.name ?? 'The host'));

    setHidden(startButton, !isHost);
    setDisabled(startButton, !online);
    setText(nextStep, nextStepText(lobby, isHost, host?.name ?? 'the host'));
  }

  const unsubscribe = store.subscribe(update);
  update(store.get());

  return () => {
    unsubscribe();
    mapSelect.removeEventListener('change', onMapSizeChange);
    screen.remove();
  };
}

/** Brings one row of the seat list in line with the lobby: a taken seat, an open one, or one that cannot be used yet. */
function updateSeatRow(parts: SeatRow, index: number, lobby: LobbyView): void {
  const seat = lobby.seats[index];
  const taken = seat !== undefined;
  const open = !taken && index < lobby.maxPlayers;

  setClass(parts.row, 'taken', taken);
  setClass(parts.row, 'open', open);
  setClass(parts.row, 'unavailable', !taken && !open);
  setHidden(parts.swatch, !taken);

  if (!taken) {
    parts.row.removeAttribute('data-testid');
    setText(parts.name, open ? 'Open' : 'Not available yet');
    setText(parts.tags, '');
    setText(parts.status, '');
    return;
  }

  setAttribute(parts.row, 'data-testid', TEST_IDS.lobbySeat + seat.playerId);
  setCivColors(parts.swatch, seat.civ);
  setText(parts.name, seat.name);
  const tags = [CIVS[seat.civ].name];
  if (seat.playerId === lobby.hostId) tags.push('host');
  if (seat.playerId === lobby.you) tags.push('you');
  setText(parts.tags, tags.join(', '));
  setText(parts.status, seat.connected ? 'connected' : 'not connected');
  setClass(parts.status, 'absent', !seat.connected);
}

/** One sentence that says what happens next, for the host and for everybody else. */
function nextStepText(lobby: LobbyView, isHost: boolean, hostName: string): string {
  if (!isHost) return `Waiting for ${hostName} to start the game.`;
  const absent = lobby.seats.filter((seat) => !seat.connected).length;
  if (absent > 0) {
    return `${countOf(absent, 'player is', 'players are')} not connected. Wait for them, or the game will wait for them every turn.`;
  }
  if (lobby.seats.length === 1) return 'Send the link to your friends. When everyone is here, press Start game. You can also start alone.';
  return 'When everyone is here, press Start game.';
}

/**
 * Copies text to the clipboard. The modern way only works on https pages
 * and on localhost; a game served on the home network (http://192.168...)
 * needs the old way: select the text on the page and ask the browser to
 * copy the selection. Resolves to false if neither worked; the text is then
 * left selected so the player can copy it by hand.
 */
async function copyToClipboard(text: string, shownIn: HTMLElement): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Not available or not allowed: fall through to the old way.
  }
  try {
    const range = document.createRange();
    range.selectNodeContents(shownIn);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return document.execCommand('copy');
  } catch {
    return false;
  }
}
