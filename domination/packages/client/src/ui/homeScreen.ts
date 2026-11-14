/**
 * Home screen (work package WP4): type a name, then create a game or join
 * one by code.
 */

import { GAME_CODE_LENGTH, RULES } from '@domination/shared';
import type { Connection } from '../net/connection';
import { gameCodeFromUrl, gameLinkIsBroken, loadLastGame, savePlayerName } from '../net/identity';
import type { AppState, Store } from '../state/store';
import { h, setClass, setDisabled, setHidden, setText } from './dom';
import type { Unmount } from './dom';
import { TEST_IDS } from './testIds';
import { codeHintText, homeIntroText } from './texts';

/**
 * After Create has been pressed, the buttons stay off for this long (or
 * until the lobby appears, whichever is first). A double-click would
 * otherwise make two games, and the first one would sit there for ever with
 * an empty host seat.
 */
const CREATE_GUARD_MS = 4000;

/**
 *  - Name field (TEST_IDS.homeNameInput), at most RULES.maxNameLength
 *    characters, pre-filled from the store; saved with savePlayerName on change.
 *  - "Create private game" (homeCreateButton): sends `createGame { name }`.
 *  - Code field (homeCodeInput, pre-filled from ?g=CODE or the last game)
 *    and "Join" (homeJoinButton): sends `joinGame { code, name }`.
 *  - Both buttons are disabled while the name is empty or the connection is
 *    not 'online'. Pressing Enter in a field presses the matching button.
 *  - While state.joining is set (the app is asking the server for the game
 *    in the address bar: after a reload, a reconnect or opening a link) show
 *    "Opening game K7QXM..." and keep both buttons disabled, so nobody creates
 *    a second game by accident in that moment.
 *  - If the page was opened through a shared link (?g=CODE) by somebody who
 *    has no seat in that game yet, the server answers `nameRequired`, and
 *    this screen is what the player sees: the code is already filled in,
 *    they type a name (or keep the remembered one) and press Join. Opening a
 *    link never takes a seat by itself.
 *  - If the server says the game cannot be joined at all (state.joinProblem:
 *    it does not exist, it has already started, it is full), the screen does
 *    NOT say "you are invited": the reason stays under the code field until
 *    the code is edited, and "Create private game" becomes the gold button.
 *  - If the link the page was opened through names something that cannot
 *    be a game code (a link damaged on its way), nothing is asked of the
 *    server and nothing from the link is shown: the code field stays empty
 *    and the line under it says that the link is damaged, until a code is
 *    typed.
 *  - Works on a phone: large touch targets, no hover-only controls.
 *
 * "The matching button" for the NAME field is Join while a game code is
 * filled in that can still be joined (somebody who followed an invite link
 * types their name and presses Enter: they mean to join that game, not to
 * start another one) and Create otherwise. The button Enter will press is
 * the one drawn in gold.
 */
export function mountHomeScreen(parent: HTMLElement, store: Store, connection: Connection): Unmount {
  const invitedTo = gameCodeFromUrl();
  /** The address named a game, but not by anything that could be a code. Cleared when the code field is edited. */
  let brokenLink = gameLinkIsBroken();

  // ---- Build once -------------------------------------------------------------
  const intro = h('p', { className: 'home-intro', testId: TEST_IDS.homeIntro });

  const nameInput = h('input', {
    className: 'field',
    testId: TEST_IDS.homeNameInput,
    attributes: {
      id: 'home-name',
      type: 'text',
      maxlength: String(RULES.maxNameLength),
      autocomplete: 'nickname',
      spellcheck: 'false',
      placeholder: 'For example Ada',
    },
  });
  nameInput.value = store.get().playerName;
  const nameHint = h('p', { className: 'field-hint attention', text: 'Type your name first.' });

  const createButton = h('button', {
    className: 'button big',
    text: 'Create private game',
    testId: TEST_IDS.homeCreateButton,
    onClick: createGame,
  });
  const createHint = h('p', { className: 'field-hint', text: 'You get a link to send to your friends.' });

  const codeInput = h('input', {
    className: 'field code-field',
    testId: TEST_IDS.homeCodeInput,
    attributes: {
      id: 'home-code',
      type: 'text',
      maxlength: String(GAME_CODE_LENGTH),
      autocomplete: 'off',
      autocapitalize: 'characters',
      spellcheck: 'false',
      placeholder: '5 letters',
    },
  });
  // (After a damaged link the last game is not offered either: the player came for another one.)
  codeInput.value = invitedTo ?? (brokenLink ? '' : loadLastGame() ?? '');
  const joinButton = h('button', { className: 'button big', text: 'Join', testId: TEST_IDS.homeJoinButton, onClick: joinGame });
  const codeHint = h('p', { className: 'field-hint', testId: TEST_IDS.homeCodeHint });

  const status = h('p', { className: 'home-status', attributes: { role: 'status' } });

  const createSection = h('div', { className: 'home-section' }, createButton, createHint);
  const joinSection = h(
    'div',
    { className: 'home-section' },
    h('label', { className: 'field-label', text: 'Game code', attributes: { for: 'home-code' } }),
    h('div', { className: 'code-row' }, codeInput, joinButton),
    codeHint,
  );
  // Somebody who followed an invite link came to join: that part goes first.
  const sections =
    invitedTo !== null
      ? [joinSection, h('div', { className: 'divider', text: 'or start a new game' }), createSection]
      : [createSection, h('div', { className: 'divider', text: 'or join a game' }), joinSection];

  const card = h(
    'div',
    { className: 'card home-card' },
    h('div', { className: 'logo' }, h('span', { className: 'logo-hex' }), h('h1', { className: 'title', text: 'Domination' })),
    intro,
    h('label', { className: 'field-label', text: 'Your name', attributes: { for: 'home-name' } }),
    nameInput,
    nameHint,
    ...sections,
    status,
  );
  const screen = h('div', { className: 'screen centered' }, card);
  parent.append(screen);

  // ---- Behaviour ----------------------------------------------------------------

  /** Set while a Create is on its way (see CREATE_GUARD_MS). */
  let creating = false;
  let createTimer: number | null = null;
  /** Set when Join was pressed without a usable code; cleared as soon as the code is edited. */
  let codeProblem = false;

  const currentName = (): string => nameInput.value.trim();
  const currentCode = (): string => codeInput.value.trim().toUpperCase();

  function createGame(): void {
    const name = currentName();
    if (name === '' || creating) return;
    if (!connection.send({ type: 'createGame', name })) return;
    creating = true;
    createTimer = window.setTimeout(() => {
      creating = false;
      createTimer = null;
      update(store.get());
    }, CREATE_GUARD_MS);
    update(store.get());
  }

  function joinGame(): void {
    const name = currentName();
    const code = currentCode();
    if (name === '') return;
    if (code.length !== GAME_CODE_LENGTH) {
      codeProblem = true;
      codeInput.focus();
      update(store.get());
      return;
    }
    // A new try: what the server said about the last one no longer counts.
    if (connection.send({ type: 'joinGame', code, name }) && store.get().joinProblem !== null) store.set({ joinProblem: null });
  }

  /** Is Join the button to press next (and the one Enter in the name field presses)? */
  function joinComesNext(state: AppState): boolean {
    return currentCode() !== '' && state.joinProblem === null;
  }

  function onNameInput(): void {
    savePlayerName(currentName());
    store.set({ playerName: nameInput.value }); // the store change redraws the screen
  }

  function onCodeInput(): void {
    // Codes are capitals: show them that way while typing (keeping the cursor where it was).
    const upper = codeInput.value.toUpperCase();
    if (upper !== codeInput.value) {
      const cursor = codeInput.selectionStart;
      codeInput.value = upper;
      if (cursor !== null) codeInput.setSelectionRange(cursor, cursor);
    }
    codeProblem = false;
    brokenLink = false;
    // Another code is another game: the server's verdict on the old one goes with it.
    if (store.get().joinProblem !== null) store.set({ joinProblem: null });
    else update(store.get());
  }

  /** Enter in a field presses the button that goes with it (see the doc comment above). */
  function onNameKey(event: KeyboardEvent): void {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (joinComesNext(store.get())) joinButton.click();
    else createButton.click();
  }

  function onCodeKey(event: KeyboardEvent): void {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    joinButton.click();
  }

  nameInput.addEventListener('input', onNameInput);
  nameInput.addEventListener('keydown', onNameKey);
  codeInput.addEventListener('input', onCodeInput);
  codeInput.addEventListener('keydown', onCodeKey);

  // ---- Update in place on every store change ----------------------------------

  function update(state: AppState): void {
    const hasName = currentName() !== '';
    const joinNext = joinComesNext(state);
    const online = state.connection === 'online';
    const opening = state.joining !== null;
    const blocked = !hasName || !online || opening || creating;

    setDisabled(createButton, blocked);
    setDisabled(joinButton, blocked);
    // Gold marks the button that Enter presses, which is also the likely next step.
    setClass(joinButton, 'primary', joinNext);
    setClass(createButton, 'primary', !joinNext);

    // While the game in the address bar is being asked for, nothing can be
    // typed or pressed that would matter yet: no "do this next" marks.
    setHidden(nameHint, hasName || opening);
    setClass(nameInput, 'needs-input', !hasName && !opening);

    // The invitation is only shown once the server has said that this
    // browser has no seat in that game (a player coming back to their own
    // game after a reload is not "invited"), and only if the game can be joined.
    setText(intro, homeIntroText(invitedTo, opening, state.joinProblem));

    setText(codeHint, codeHintText(codeProblem, state.joinProblem, brokenLink));
    setClass(codeHint, 'attention', codeProblem || brokenLink || state.joinProblem !== null);

    // (A lost connection needs no line here: the app shows its own notice at the top of every screen.)
    let statusText = '';
    if (opening) statusText = `Opening game ${state.joining}...`;
    else if (creating) statusText = 'Creating your game...';
    else if (state.connection === 'connecting') statusText = 'Connecting to the server...';
    setText(status, statusText);
    setHidden(status, statusText === '');
  }

  const unsubscribe = store.subscribe(update);
  update(store.get());

  // Put the cursor where the first thing has to be typed, but not on a touch
  // screen: there it would throw the on-screen keyboard over the page at once.
  if (currentName() === '' && window.matchMedia('(pointer: fine)').matches) nameInput.focus();

  return () => {
    unsubscribe();
    if (createTimer !== null) window.clearTimeout(createTimer);
    nameInput.removeEventListener('input', onNameInput);
    nameInput.removeEventListener('keydown', onNameKey);
    codeInput.removeEventListener('input', onCodeInput);
    codeInput.removeEventListener('keydown', onCodeKey);
    screen.remove();
  };
}
