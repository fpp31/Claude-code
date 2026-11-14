import { describe, it } from 'vitest';

/**
 * Tests WP3 must write for the server. Each `it.todo` is a requirement;
 * replace it with a real test (split into several files if that reads
 * better: lobby.test.ts, actions.test.ts, persistence.test.ts, leak.test.ts).
 *
 * How to test: start the REAL server with startServer() on port 0 with a
 * temporary data folder (fs.mkdtempSync(os.tmpdir() + ...)), and talk to it
 * with real `ws` clients. Always close servers and sockets in afterEach so
 * no process or timer is left behind.
 *
 * NEVER point a test at the real packages/client/dist: other people build
 * into it while you test. For the static-file tests set config.clientDir to
 * a temporary folder with a tiny index.html of your own.
 *
 * THE FAKE RULES. Until the rules engine (WP2) is finished, pass a small
 * fake `Rules` object to startServer (test/fakeRules.ts, written and owned
 * by WP3; it stays useful afterwards for provoking failures). The server
 * never looks inside a game state, so the fake can be tiny:
 *  - createGame(setup): a GameState with the setup's players, no units and
 *    no cities, on sampleMap() from '@domination/shared/testing';
 *  - applyAction: accepts, rejects, reports "changed: false" or throws on
 *    command (for example by looking at the action's unitId), and bumps
 *    `turn` or flips `endedTurn` so that views really change;
 *  - buildPlayerView(state, playerId): `{ ...sampleView(), you: playerId,
 *    turn: state.turn, players: ... }` is enough (diffViews only insists
 *    that `you`, `width` and `height` stay the same);
 *  - filterEvents: the real one from '@domination/shared' is three lines
 *    once WP2 has it; until then filter on `to` yourself;
 *  - checkInvariants: returns [].
 *
 * TESTS THAT NEED THE REAL RULES are the sections marked "(real rules)".
 * Write them now, inside
 *     describe.skipIf(!isImplemented(() => realRules.createGame(setup)))(...)
 * (isImplemented comes from '@domination/shared/testing'). They are skipped
 * while WP1 or WP2 is unfinished and switch themselves on when both have
 * landed; the integrator makes sure none is still skipped after the merge.
 * To play on a map you drew yourself with the real rules, wrap them:
 *     const rules = { ...realRules, createGame: (s) => createGame(s, () => ({ map, starts })) };
 * (createGame and mapFromAscii come from the shared package.)
 */

describe('tokens, codes and parsing (WP3)', () => {
  it.todo('newToken makes 32 hex characters, different every time; hashToken is stable and 64 hex characters');
  it.todo('newGameCode uses only GAME_CODE_ALPHABET, has GAME_CODE_LENGTH characters and avoids taken codes');
  it.todo('normalizeGameCode trims and upper-cases, and rejects wrong lengths and characters');
  it.todo('parseClientMessage accepts one valid example of every message type');
  it.todo('parseClientMessage returns null for bad JSON, unknown types, missing fields, wrong field types, negative or fractional numbers, over-long strings and over-long paths');
  it.todo('parseClientMessage drops unexpected extra properties');
  it.todo('cleanPlayerName trims, removes control characters, limits the length and returns null for empty names');
});

describe('storage (WP3)', () => {
  it.todo('save then loadAll returns a deep-equal room file');
  it.todo('save leaves no .tmp file behind and replaces the previous save');
  it.todo('loadAll deletes leftover .tmp files and still loads the real file');
  it.todo('loadAll moves an unreadable file aside as .corrupt, reports it, and loads the others');
  it.todo('loadAll leaves a file with a newer format, or a game with another state schema, byte-identical on disk, reports it, and does not return it');
  it.todo('has is true for loaded and for skipped files, false for unknown codes; a new game never gets the code of a skipped file');
  it.todo('remove deletes a save and does nothing if there is none');
});

describe('connecting (WP3)', () => {
  it.todo('hello with the right protocol gets welcome with a new token when none was sent');
  it.todo('hello with a valid token gets the same token back');
  it.todo('hello with the wrong protocol version gets error protocolMismatch and the socket is closed');
  it.todo('any message before hello gets error notReady');
  it.todo('garbage, binary and oversized frames get error badMessage or a closed socket, and the server keeps running');
  it.todo('ping gets pong');
  it.todo('GET /healthz answers ok; GET / serves index.html; a path traversal attempt gets 404');
  it.todo('a file type that is not on the list and a dot-file are answered with 404 even though they exist in clientDir');
  it.todo('startServer refuses to start when the data folder is the client folder or inside it');
  it.todo('startServer logs a warning when a fixed seed is configured');
});

describe('lobby flow (WP3)', () => {
  it.todo('createGame puts the creator on seat p1 as host and sends the lobby with a 5-character code');
  it.todo('joinGame by code (any letter case) takes the lowest free seat and the first free civilization, and every socket receives the new lobby');
  it.todo('joinGame without a name for a new seat gets nameRequired and takes no seat; an empty name gets badName');
  it.todo('joinGame with an unknown code gets noSuchGame');
  it.todo('the lobby is full after maxPlayers() seats: gameFull (also when sent without a name)');
  it.todo('chooseCiv changes the civilization; picking a taken one gets civTaken');
  it.todo('only the host can setMapSize and startGame (notHost)');
  it.todo('leaveGame frees the seat; the lowest remaining seat becomes host; the last one leaving deletes the room and its file');
  it.todo('leaveGame in the lobby sends `left` to every socket of that seat (a second tab too), and those sockets then get notInGame');
  it.todo('a single player can start a game');
  it.todo('startGame sends every attached socket a gameSync with its own view');
  it.todo('startGame includes a seat with no socket attached; the game then waits for that seat');
  it.todo('joining a started game without a seat gets gameAlreadyStarted (with or without a name)');
  it.todo('a lobby message never contains a token or a token hash');
  it.todo('joinGame for the room the socket is already attached to re-sends the lobby (or a gameSync) and does not attach it twice: the next update arrives once, with seq + 1');
  it.todo('a failed joinGame (noSuchGame, gameFull, nameRequired) leaves the socket attached to the game it was in');
  it.todo('if saving fails during a lobby change (join, leave, chooseCiv, setMapSize, start) the sender gets serverError and nobody sees the change');
});

describe('authorisation and actions (WP3)', () => {
  it.todo('the acting player is taken from the socket\'s seat: a player cannot move another player\'s unit (noSuchUnit)');
  it.todo('an action from a socket that is not in a started game gets error notInGame (no actionRejected)');
  it.todo('every action that reaches a started game gets exactly one actionOk or actionRejected with its requestId');
  it.todo('an accepted action sends the actor a gameUpdate (seq + 1) before the actionOk');
  it.todo('a rejected action changes nothing: the save file is byte-identical and nobody else receives anything');
  it.todo('an action with an old turn number is rejected with staleTurn');
  it.todo('a player whose view did not change receives no message at all');
  it.todo('if saving fails (inject a storage that throws) the actor gets actionRejected serverError and the state is unchanged');
  it.todo('if the rules throw, the actor gets actionRejected serverError and the server keeps running');
  it.todo('if buildPlayerView throws for ANOTHER seat (attached or not), the actor gets actionRejected serverError, the save file is byte-identical and nobody receives an update');
  it.todo('serverError never quotes the exception: fake rules throw an Error containing a canary string; no frame on any socket contains it, the log does');
  it.todo('with patches turned off (sendPatches false) every change arrives as a full gameSync whose seq is the previous seq + 1');
});

describe('same-instant conflicts: first valid action wins (WP3, real rules)', () => {
  it.todo('two units sent to the same tile: exactly one arrives');
  it.todo('two cities founded too close together: the second gets tooCloseToCity');
  it.todo('the last endTurn racing another player\'s cancelEndTurn: whichever arrives first counts; a cancel after resolution gets staleTurn');
  it.todo('End Turn double-clicked: the second is an accepted no-op and the turn advances once');
  it.todo('two players choosing the same civilization: the second gets civTaken');
  it.todo('a join arriving just after the start gets gameAlreadyStarted');
});

describe('reconnect and resume (WP3)', () => {
  it.todo('a new socket with the same token re-attaches to the same seat (lobby) and gets the lobby');
  it.todo('a new socket with the same token re-attaches to the same seat (running game) and gets a full gameSync with seq 1');
  it.todo('a different token cannot take over a seat');
  it.todo('disconnecting marks the seat as not connected for the others (lobby message / presence) and reconnecting restores it');
  it.todo('a disconnected player is waited for: the turn does not resolve without them');
  it.todo('two sockets on one seat each get their own seq; resync on one does not disturb the other');
  it.todo('resync sends a fresh gameSync with seq + 1, and the next gameUpdate continues from it');
  it.todo('a socket that joins another game is detached from the first one, and its seat there is kept');
  it.todo('a seat whose tokenHash was set to null in the save file is taken over by the next token that joins with a name (lobby and running game), keeping its name and civ; with name null the answer is nameRequired');
});

describe('persistence and restart (WP3)', () => {
  it.todo('stop the server and start a new one on the same data folder: lobbies and running games are back, with deep-equal views');
  it.todo('after a restart players reconnect with their old tokens to their old seats');
  it.todo('the save file is written after every accepted action (kill without close, restart, nothing is lost)');
  it.todo('a corrupt save does not stop the server from starting');
  it.todo('the fixed seed (config.fixedSeed) gives the same map twice');
});

describe('NO LEAK on the wire (WP3, real rules)', () => {
  it.todo('canary: with a hidden foreign city (unique name) and hidden unit ids, no frame sent to the other player ever contains them');
  it.todo('twin worlds: two same-seed games in which player B acts differently out of A\'s sight (founding the same number of cities in both, because city names follow founding order); every frame A receives is identical in both');
  it.todo('no frame ever contains the seed, an rng state, a token, a token hash or an event audience list (`to`)');
});
