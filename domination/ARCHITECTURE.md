# Domination: architecture (phase 1)

This file is the map of the project. The precise contracts live in the code as types and doc comments; where this file and a doc comment disagree, the doc comment wins and this file should be fixed.

## 1. The design in one page

Three packages in one npm workspace, all TypeScript, strict mode, ES modules:

| Package | What it is | May use |
|---|---|---|
| `packages/shared` | The rules of the game, the data tables and the message types. Pure and deterministic. | Nothing: no Node, no browser, no clock, no built-in random |
| `packages/server` | One Node process: keeps the truth, validates, saves, sends each player their view. | Node, `ws`, `shared` |
| `packages/client` | A plain static web app: Canvas 2D map plus DOM panels. | Browser, `shared` |

The ideas everything else follows from:

1. **The server is authoritative.** Clients send wishes (actions). The server asks the shared rules engine, saves, and tells each player what they may see.
2. **One gate.** A game state changes only through `applyAction` (a player did something) and `resolveTurn` (the turn ended), both in `shared`.
3. **One filter.** Everything a client learns about a game comes from `buildPlayerView` and `filterEvents`, or is a diff of two views. Views are built by allow-list, from scratch.
4. **The saved file is the truth.** The rules never edit the state they are given; they return a new one. The server first works out everything it is going to send (so a failure there stops the change before it exists), then saves the new state, adopts it only if the save succeeded, and only then sends. Disk is never behind what a client was told, and nobody is told "rejected" about something that was saved.
5. **The client shows the last view it was sent.** No prediction, no resending. After any hiccup a full view puts it right.

## 2. Final design decisions

**Rules engine (`shared`)**

- State is plain JSON (`types.ts`). Positions are always a `TileIndex`; `{x, y}` coordinates exist only inside `hex.ts` and the renderer.
- A tile is `terrain` (ocean, coast, grassland, plains, desert) + optional `feature` (forest, hills, mountains) + owning `cityId`. A feature's numbers *replace* the ground's. Rules read tiles only through `tileMoveCost`, `tileYields`, `tileIsWorkable`, `tileAllowsCity`.
- Territory has one source of truth: `tile.cityId`. Worked tiles and yields are derived by `cityEconomy`, never stored.
- `applyAction(state, playerId, turn, action)` validates fully, then works on a copy. Every action carries the turn it was issued in (`staleTurn`). Accepted no-ops are reported with `changed: false`. "Not yours" and "does not exist" share one error code.
- A move carries the path the client chose from its own view. The server walks it one step at a time on the truth, refreshing sight after each step, and stops before the first illegal step. The server never path-finds, so a route cannot give hidden things away.
- One movement implementation behind the small `Board` interface (`boardFromState` on the server, `boardFromView` on the client), so the reachable-tile highlight matches what the server accepts.
- Turns are simultaneous. The turn resolves inside the `endTurn` action that makes everybody ready (same call, same save). `resolveTurn` is a short list of named steps.
- Randomness: one seed string, several independent streams (`seedRng(seed, stream)`): the map, gameplay dice (unused in phase 1), and one id stream per player.
- Unit and city ids are random, per player (`u3_k7m2qd`), so the ids a player sees depend only on their own actions.
- Fog of war: visible = within sight of own units, plus own territory and one ring around it. Explored tiles and last-seen owners/cities are remembered per player *on the server*, inside the game state.
- Events (`GameEvent`) are cosmetic news for toasts. The engine hands out every event together with its audience (`AddressedEvent`: `to` is a list of players or `'all'`); `filterEvents` picks one player's events and drops the audience lists, which never leave the server. Phase 1 addresses a player's events to that player only, plus `turnStarted` to all. The client must work if events are ignored.
- Cities are named from their civilization's list in founding order. That makes "how many cities has this player founded" readable from a city's name, which is accepted and written down as a public fact (`protocol.ts`).
- A city's view says why a finished item is not appearing (`productionBlocked`: needs population, or no free tile); one function (`productionBlocked` in `rules/city.ts`) serves both turn resolution and the view.
- Start positions come with hard guarantees (distinct, legal city sites, at least `minCityDistance` apart, room to walk) and stronger ones when the map is not crowded (distance, one landmass, fairness within 70%); the generator checks every result and retries with the next attempt stream until they hold. On a crowded map the stronger ones become aims, in that order.
- All balance numbers live in `shared/src/data/`. Table tests guard the relationships fog and rules rely on (for example: a settler sees far enough that "too close to a city" reveals nothing; every unit sees at least as far as it walks in a turn, so the highlighted tiles are exactly the ones the server lets it reach). The numbers that only shape what generated maps look like live in `shared/src/mapgen/tuning.ts`.

**Server**

- One process, one port: `node:http` serves the built client and upgrades `/ws` to a `ws` WebSocket. Each message is handled synchronously from start to finish: no queues, no locks.
- The commit rule, for every change to a room (lobby or game): **prepare** (build the next file and every message; pure, so an exception here means nothing happened), **save** (temp file, fsync, rename), **adopt and send** (cannot fail: sending never throws). For an action that is: rules, then every seat's view and each socket's update, then save, then adopt, then send, then `actionOk` to the sender. A player whose view did not change receives nothing. A failure before the save answers the actor `actionRejected serverError` and changes nothing.
- A client is never shown the text of an exception: every `serverError` carries the one constant sentence `SERVER_ERROR_MESSAGE`; details go to the server log.
- One JSON file per game (`data/rooms/CODE.json`), rewritten atomically after every accepted change. All games are loaded before the server starts listening.
- Identity: the server issues a random token; the browser keeps it in localStorage; a seat stores only its SHA-256. A game is joined by a five-character code. `joinGame` is also the reconnect message: sent with `name: null` it only brings a player back to a seat they have; taking a seat needs a name, that is, the Join button. A seat whose stored hash is `null` is unclaimed and goes to the next player who joins (the manual rescue for a lost token; later the hook for empty and AI seats).
- A socket is attached to at most one room. Joining another game detaches it from the old one only after the join succeeded, and never gives up the old seat; only `leaveGame` does. The room is the authority on which sockets it holds.
- Per socket: its own `seq` counter (plus one for every `gameSync` and `gameUpdate` sent on it) and last-sent view. Full `gameSync` on attach and on `resync`, `gameUpdate` patches afterwards. `DOMINATION_FULL_SYNC=1` turns patches off.
- Liveness survives background tabs, whose timers run about once a minute: the client pings every 25 s and gives up only if nothing arrives within 10 s after a ping (never on a late timer alone); the server drops a socket after 150 s of silence.
- A save from another version of the game (newer file format, or a game-state layout it cannot migrate) is left untouched on disk and not loaded; its code stays reserved.
- Start-up refuses a data folder inside the public client folder, and warns loudly about a fixed seed.
- The server reaches the rules only through the `Rules` bundle (`server/src/rules.ts`); tests can pass a fake.
- No absolute paths: defaults are resolved from the source file location to the project root.

**Client**

- No UI framework. Panels are built once and then updated in place (`textContent`, `hidden`, `disabled`), which keeps clicks from being lost when an update arrives mid-press. Names from other players only ever become text nodes.
- One small store holds everything on screen; game data enters it only from server messages. One action in flight at a time (`busy`, set only when a message really went out). One question, `canActNow`, decides both whether reachable tiles are highlighted and whether a tap moves the unit.
- `net/identity.ts` is the only place that touches localStorage, the address bar and page reloads, and it works (as a no-op) where they do not exist, so the app logic is tested in plain Node. The token is also kept in memory, so an open page never forgets who it is.
- End Turn and Cancel share one button; the controller ignores presses for 0.6 s after the button's meaning changed, which makes a double-click or a held Enter key harmless.
- The renderer owns canvas, camera and sprites. The app shell owns input events and what they mean. They meet in `render/api.ts`.
- Sprites are authored as text (rows of characters with a small palette and reserved owner-colour characters) and rasterised at start-up behind the `SpriteSheet` interface, so PNG sheets can replace them later. No binary assets, no font files.
- All hex shapes (hit test, fog, highlights, borders) derive from `render/geometry.ts`. Zoom is a whole number of device pixels per art pixel; one zoom step is about one CSS pixel per art pixel, which gives about six levels on every display.
- The camera keeps the middle of the canvas on the map: the map can be dragged until its edge reaches the middle, no further. So `centerOn` really centres every tile, and a tile can always be brought out from under a panel that floats over a corner of the map.
- The renderer is created on a canvas that is already in the page and measures it at once (the game screen therefore puts its panels into the page first, because they take room from the map area); without a view its camera calls do nothing (`render/api.ts`). It measures the canvas again at the start of every camera and hit-test call, so no answer is ever a frame behind a resized window. Fog is applied per sprite (a fogged twin), not as a hexagon laid on top, because sprites stick out of their tile.

**Tooling**

- `tsx` runs the server in development and in production; `tsc` only type-checks (`noEmit`). `shared` is consumed as TypeScript source, so there is no build step for it and no `.js` import suffixes.
- Vite builds and serves the client; Vitest runs all tests from the project root. Runtime dependencies: `ws` and `tsx` (both in `dependencies`, so `npm start` works after an install without development tools; building the client still needs them).

## 3. Module map

Phase 1 was built in five parts at the same time, and many file headers still say which part a file belongs to: **WP1** map generation, **WP2** rules + fog of war + views, **WP3** server, **WP4** client app shell (screens, input, network), **WP5** map renderer + sprites + camera. The *scaffold* is what was written before them: the contracts, the data tables and the foundations. All five parts are merged; nothing is a stub any more.

```
package.json, tsconfig.base.json, vitest.config.ts, .gitignore      project set-up
scripts/dev.mjs                                                      what "npm run dev" runs
e2e/two-players.ts                                                   the end-to-end test (two browsers, real server)

packages/shared/src/                                                 THE RULES (pure, no Node, no browser)
  index.ts              the public exports of the package            scaffold
  types.ts              GameState, Tile, Unit, City, PlayerState     scaffold
  actions.ts            Action, RuleError, GameEvent, ActionResult   scaffold
  viewTypes.ts          PlayerView, ViewPatch and their parts        scaffold
  protocol.ts           wire messages, PROTOCOL_VERSION              scaffold
  data/                 terrain, units, civs, rules + map sizes      scaffold (the numbers may be tuned)
  hex.ts  rng.ts  ids.ts  json.ts    hex maths, seeded random,
                        ids, JSON helpers                            scaffold
  mapgen/               generateMap.ts (the contract), attempts,
                        buildMap, land, ground, mountains,
                        hillsAndForest, passes, starts, startRules,
                        grid, noise, tuning (the generator's knobs)  WP1
  rules/                createGame; applyAction with one file per
                        action (moveUnit, foundCity, setProduction,
                        endTurn); movement (Board, reachableTiles,
                        pathTo); city; turn; invariants;
                        results and stateQueries (internal helpers)  WP2
  view/visibility.ts    computeVisible, updateKnowledge              WP2
  view/playerView.ts    buildPlayerView, filterEvents                WP2
  view/patch.ts         diffViews, applyViewPatch                    scaffold
  testing/              for tests and demo mode only: mapFromAscii,
                        mapToAscii, sampleView, sampleLobby,
                        notImplementedError / isImplemented          scaffold
packages/shared/test/
  hex, rng, ids, json, tables, patch, fixtures, purity, pathTo       scaffold
  mapgen*.test.ts                                                    WP1
  rules*.test.ts, visibility*.test.ts, and their helper files
  (rulesKit, rulesRandomPlay, visibilityOracle, visibilityScenes)    WP2

packages/server/src/                                                 THE SERVER (Node)
  main.ts               entry point of "npm start"
  config.ts             settings from environment variables
  server.ts             startServer: http + WebSocket on one port
  httpStatic.ts         serves the built client; paths.ts guards folders
  connection.ts         one socket: hello, rate limit, liveness
  parseMessage.ts       shape check of every message, name cleaning
  tokens.ts             player tokens, game codes, seeds
  roomManager.ts        all games by code
  room.ts               one game: the commit rule, actions, sync
  roomLobby.ts          the lobby as plain functions on the save file
  deliveries.ts         messages worked out but not sent yet
  errors.ts             the wording of everything the server refuses
  roomFile.ts           the save file's layout; roomFileText.ts writes
                        it as text and checks one read back
  storage.ts            atomic saving and loading
  rules.ts              the Rules bundle (the seam to packages/shared)
packages/server/test/   one file per subject (see the top of
                        server.test.ts), plus harness.ts (real server,
                        real sockets), fakeRules.ts and realWorld.ts  all WP3

packages/client/                                                     THE WEB PAGE (browser)
  vite.config.ts, tsconfig.json, tsconfig.node.json                  set-up
  index.html, src/main.ts, src/styles.css                            WP4
  src/ui/               app (which screen), home, lobby and game
                        screens, top bar, unit and city panels, the
                        "First steps" note (startHint), End Turn
                        button, toasts, texts (the sentences), dom
                        and civColors (helpers)                      WP4
  src/ui/testIds.ts     data-testid names (the e2e contract)         scaffold
  src/net/              connection (reconnect, liveness), identity
                        (token, address bar, storage)                WP4
  src/state/            store, serverMessages                        WP4
  src/game/             controller (what a tap means), selectors     WP4
  src/input/            mapInput (browser events), gestures and keys
                        (the decisions, free of browser code)        WP4
  src/debugHook.ts, src/demo.ts                                      WP4
  src/render/api.ts     MapRenderer, MapOverlay: the seam between
                        the app shell and the renderer               scaffold
  src/render/           renderer (the frame loop), frame (one frame),
                        camera, geometry, terrainLayer, borders,
                        scene, banner + bannerCache, slide, owners,
                        backingStore                                 WP5
  src/sprites/          format (sprites as text), art/ (the
                        pictures), font, palette, catalog, looks,
                        rim (the pale line around a unit among
                        trees), rasterize, atlas, spriteSheet, color,
                        image, canvas                                WP5
  dev-map.html, sprites.html, src/dev/   development pages: the map
                        on its own, every sprite, a 56 x 36 map with
                        a frame-time read-out (not in the built game) scaffold, WP5
  test/geometry.test.ts, test/render*.test.ts                        WP5
  test/shell*.test.ts                                                WP4
```

**The seams between the parts**

| Between | Contract |
|---|---|
| Map generator -> rules | `generateMap(seed, mapSize, playerCount)` returns `{ map, starts }`, with the start-position guarantees H1-H5 in its doc comment. `createGame` takes the generator as an optional second argument, so tests can use hand-drawn maps (`mapFromAscii`). |
| Rules -> server | The `Rules` bundle: `createGame`, `applyAction`, `buildPlayerView`, `filterEvents`, `checkInvariants`; plus `diffViews`. Most server tests pass a small fake bundle; the conflict, leak and restart tests use the real one. |
| Rules -> client | `PlayerView` (render-ready), `reachableTiles(boardFromView(view), unit)`, `pathTo`, `applyViewPatch`. The controller and `overlayFor` take the reach function as an option, so their tests can pass a hand-made one. |
| Server <-> client | `protocol.ts`, nothing else. |
| App shell -> renderer | `createMapRenderer(canvas)` and `render/api.ts`: `setView`, `setOverlay`, `panBy`, `zoomBy`, `centerOn`, `tileAt`, `tileToScreen`, `destroy`, and its two "not ready yet" rules (the canvas is in the page before the renderer is created; without a view the camera calls do nothing). |
| Client -> e2e | `ui/testIds.ts` and `window.__domination` (`debugHook.ts`). |
| Server -> e2e | `loadConfig(env)` and `startServer({ config })`. |

**How the parts are tested**

- `npm test` runs every unit test, in plain Node. The rules are tested on hand-drawn maps and on generated ones; the server is tested through real sockets against a real `startServer()` on a free port with temporary folders; the client's logic (store, messages, controller, connection, gestures) and the renderer (against a recording stand-in canvas) run without a browser.
- `npm run e2e` is the one test with real browsers: two players, the built page, the real server, the real rules and a generated map, including a reload and a server restart.
- No test is skipped and none is marked "todo" (the one exception: two tests about file links, which Windows cannot run, skip themselves there). (While the parts were being built, tests that needed another part were guarded with `isImplemented`; those guards were removed at the merge. The helper stays in `shared/src/testing/notImplemented.ts` for the next phase.)

**Checking one part**

`npm test` and `npm run typecheck` check the WHOLE project. To check one part while working on it:

| Part | Tests | Types |
|---|---|---|
| Map generation | `npx vitest run packages/shared/test/mapgen` | `npx tsc -p packages/shared && npx tsc -p packages/shared/test` |
| Rules and views | `npx vitest run packages/shared/test/rules packages/shared/test/visibility` | as above |
| Server | `npx vitest run packages/server` | `npx tsc -p packages/server` |
| App shell | `npx vitest run packages/client/test/shell` | `npx tsc -p packages/client` |
| Renderer | `npx vitest run packages/client/test/geometry packages/client/test/render` | `npx tsc -p packages/client` |

(The words after `vitest run` are matched against test file paths, so `packages/shared/test/rulesCity.test.ts` is picked up by the second command.)

When several people (or several copies of the project) run on one machine: give each development setup its own ports (`PORT=8801 DEV_PORT=5201 npm run dev`), and never test against the shared `packages/client/dist`, because every `npm run build` empties it. Server tests always use port 0 (a free port), a temporary data folder and a temporary client folder.

## 4. From a click to a redraw

1. The player taps a highlighted tile. `input/mapInput.ts` sees a tap (not a drag), asks `renderer.tileAt(point)` which tile it was, and calls `controller.onTileTap(tile)`.
2. `game/controller.ts` sees a selected unit, that the tile is in `reachableTiles(boardFromView(view), unit)` and that the player may act right now (`canActNow`). It sends `{ type: 'action', requestId, turn, action: { type: 'moveUnit', unitId, path } }` and sets `busy`.
3. On the server, `connection.ts` parses and checks the message (`parseClientMessage`) and hands it to the socket's `Room`.
4. `room.ts` takes the player id from the socket's seat and calls `rules.applyAction(state, playerId, turn, action)`. The rules walk the path on a copy of the state and return the new state plus events.
5. Still without having changed anything, the room builds every player's view of the new state (`buildPlayerView`) and, for every attached socket, the difference to the last view sent on that socket (`diffViews`).
6. The room saves the new state (`storage.save`: temp file, fsync, rename), and only then adopts it. Now it sends each socket its prepared `gameUpdate` (nothing, if that player's view did not change), and then `actionOk` to the sender.
7. In the browser, `net/connection.ts` passes the message to `state/serverMessages.ts`, which checks `seq`, applies the patch (`applyViewPatch`) and puts the new view into the store.
8. Store subscribers run: `ui/gameScreen.ts` calls `renderer.setView(view)` and `renderer.setOverlay(overlayFor(state))`; the panels update their texts.
9. The renderer marks itself dirty and draws the visible tiles on the next animation frame.

If the action is refused, step 4 returns an error, nothing is saved or broadcast, and only the sender gets `actionRejected` (shown as a toast). The same happens, with the code `serverError`, if anything in steps 4 to 6 fails before the state was adopted.

## 5. Conventions

- **Language:** TypeScript strict, ES modules, relative imports without file extensions. Use `import type` for types.
- **Spelling in code** follows the web platform: `color`, `neighbor`, `center`.
- **Style:** plain functions and plain data. Small files with one job. A `switch` on `action.type` with an exhaustive `never` check rather than registries or class hierarchies. Comments explain *why*; doc comments on every export.
- **No new dependencies** without a written reason. Phase 1 needs none beyond `ws` and the tools already installed.
- **Determinism in `shared`:** no clock, no built-in random, no I/O, no logging, and only maths that gives the same result on every machine (`+ - * / %`, `Math.floor/ceil/round/trunc/abs/sign/min/max/sqrt/imul`; no `sin`, `pow`, `**` and the like). Anything order-dependent iterates in a documented order (players in seat order, units and cities in creation order, tiles by index). `test/purity.test.ts` and the package's TypeScript settings enforce this.
- **Errors:** rule violations by players are returned (`RuleError` with a code); programming errors throw. Tests compare codes, never message texts.
- **Never trust the client:** the acting player comes from the socket; every message is shape-checked; names are cleaned on the server and rendered as text on the client.
- **Tests** live in `packages/<name>/test/*.test.ts` and run with `npm test`. Server tests use a real server on port 0 with a temporary data folder and close everything afterwards.
- **Paths:** nothing in the repository contains an absolute path of the project, so the folder can be moved. (One documented exception: the default location of the globally installed Playwright in `e2e/`, overridable with `PLAYWRIGHT_PATH`.)
- **Ports:** server 8787 (`PORT`), Vite dev server 5173 (`DEV_PORT`); the Vite proxy follows `PORT`.
- **Work that is split up again** (a later phase): a function that is still to be written gets its final signature and doc comment and the body `throw notImplementedError('<name>')` (`shared/src/testing/notImplemented.ts`); tests that need somebody else's unfinished function are wrapped in `describe.skipIf(!isImplemented(...))`, and code that must call one catches exactly that error (`isNotImplementedError`), nothing wider. When the parts are merged, every such body, guard and catch is removed again. Today there is none.

## 6. Points settled while writing the scaffold

Where the brief or the design proposals left something open, or where the scaffold departs from a suggestion:

- **Six players today, eight seats by design.** Civilizations are unique per game and there are six, so `maxPlayers()` is `min(RULES.maxSeats, number of civs)`. Types, lobby layout and rules are sized for 8.
- **Map sizes carry a recommended player count that is shown, not enforced.** The generator must always return a start for every player.
- **Terrain is ground + feature**, with replace semantics (simple tables, matches the art, leaves a slot for phase 2 improvements).
- **Production stays selected** after a unit is completed; a city with nothing chosen makes no progress that turn; a Settler needs population 2 and takes one.
- **Citizens are assigned** by total yield, then food, then lower tile index. Cities never shrink in phase 1.
- **Server-issued tokens, stored as hashes.** "Which games am I in?" is answered by the browser remembering its last game code, not by a server-side index.
- **No journal, lock file, turn backups or async queue** in phase 1. Backup is copying `data/`.
- **Patches are whole-section replacements** (`ViewPatch`), implemented and tested in the scaffold, with a full-sync fallback switch.
- **Input is handled by the app shell (WP4)**, which drives the renderer's camera through `panBy` / `zoomBy`; the renderer never listens to pointer or key events.
- **Implemented in the scaffold beyond hex and RNG**, because several work packages meet there: ids, JSON helpers, table accessors, view patches, test fixtures, `pathTo`, the pixel-hex geometry (`client/src/render/geometry.ts`) and a map test page. (It also had a flat-colour stand-in renderer, removed when the real one was merged.)
- **Opening an invite link never takes a seat**; pressing Join does. The page's automatic `joinGame` carries no name and can only bring a player back to a seat they already have. This keeps accidental second seats (phone and laptop) out of the lobby.
- **Seats cannot be removed by the host in phase 1.** Instead: the lobby warns the host before starting with a seat that is not connected; a stuck lobby is replaced by a new game; in a running game the server's owner can free a seat by hand (`tokenHash: null`, see README).
- **City names stay in list order** (the genre's habit), although that tells an observer how many cities a player has founded. It is listed as a public fact; non-interference tests keep the number of founded cities equal between the worlds they compare.
- **Worked tiles are shown on the map** (a marker per tile while the city is selected, `MapOverlay.workedTiles`), not listed in the city panel.
- **TypeScript 7, Vite 8, Vitest 5** (current releases at the time of writing).

## 7. Points settled when the parts were merged

Each of the five parts reported where it had to decide something its contract left open, or where the contract did not fit. These are the decisions; the doc comments in the code say the same.

**Rules and map**

- `applyAction` answers `badAction` not only for an unknown player or action type but also when a field of a known action is of the wrong basic kind (an id that is not a string, a path that is not a list). Wrong *values* keep their own codes.
- `createGame` gives the state its own copy of the generated map, and throws if the generator breaks its promise (wrong number of starts, a start off the map).
- `OwnUnitDetail.foundCityError` is about the unit and its tile only. After End Turn it can still be null while the action would be answered `turnAlreadyEnded`; the unit panel explains that in words.
- A move ends early only if the world changed after the player's view was made (somebody else stepped into the way in the same instant): every unit sees at least as far as it can walk in a turn, and a table test guards that.
- A foreign unit that a moving unit sees only in passing leaves no trace in the mover's view: units are never remembered. Phase 2 collects who saw whom while the path is walked.
- On a crowded map the generator keeps the starts apart up to `RULES.minStartDistance`, then prefers one landmass, then similar scores. More distance than that is not bought with worse fairness.
- The generator's own numbers (the 70% of the fairness rule, the 100 attempts, everything about the look of the land) stay in `mapgen/tuning.ts`. The fairness rule scores the tiles within 2 of a start, the land a city claims; a table test fails if `RULES.cityClaimRadius` ever stops being 2, so the two are changed together.
- `mapgen/grid.ts` keeps one set of read-only lookup tables per map size between calls. It is the only thing the "pure" package remembers, and it cannot change any result.
- The map generator's "gave up" error names the seed. Exception texts only ever reach the server log, where the seed is no secret (it is in the save file too).
- The legend of the text maps (`testing/asciiMap.ts`) has a character for every kind of tile (`A`, mountains on desert, was missing), and `mapToAscii` lives next to `mapFromAscii`, so any generated map can be drawn as text and read back.

**Server**

- A rejected action is answered with the error rebuilt from its code, so only the code and its standard sentence travel.
- `Storage.has` also counts a save that was moved aside as `.corrupt` (its code stays reserved). The version numbers of a save are looked at before its details, so a save from another version is left alone rather than moved aside as damaged. There is no game-state migration yet, because there has only ever been one layout.
- Name cleaning turns white space into single spaces first and removes control and invisible characters after that.
- Static files: the "run npm run build" hint is sent with status 503; every method but GET gets 405; every answer carries `X-Content-Type-Options: nosniff`; a link that points out of the client folder is answered 404.
- A socket is cut off (not closed politely) after 150 s of silence or when 8 MB wait to be sent to it; five bad messages or a protocol mismatch close it with code 1008.
- `ServerOptions.storage` and `ServerOptions.maxMessagesPerSecond` exist for tests only (a storage that fails on command; scripted games that play faster than the rate limit allows).
- There is no limit on the number of games, and a lobby whose creator closes the tab stays on disk until somebody deletes its file. Accepted for a server among friends; see the next section.

**Client**

- The camera rule above (the middle of the canvas stays on the map) replaced "the camera never shows anything beyond the map", which could leave a selected tile under a floating panel.
- The scaffold's flat-colour stand-in renderer is gone; the game screen and the map test page create the real renderer.
- Banner text is drawn at `max(1, ceil(zoom / 2))` device pixels per font pixel (the first draft said floor, which was too small to read at the starting zoom).
- `SpriteSheet.get` takes a third argument (look, variant, bare ground, the ground a feature stands on); a unit or city whose owner is unknown is drawn grey instead of failing.
- Owner colours come from the civilization table only: Rome is `#c81e1e` on the map, on banners and in the panels. The reference picture paints roofs and tunics a brighter red; that is not reproduced.
- `window.__domination.reachable(unitId)` reports what the rules say, also in the instant an action is in flight (when nothing is highlighted), so the end-to-end test can rely on it.
- On the home screen, Enter in the name field presses Join when a game code is filled in and Create otherwise. A move that stopped early gets a toast; the store keeps at most five toasts.
- The connection also gives up on a socket that is not welcomed within 10 s, and retries at once when the page wakes up while waiting to reconnect.

**After the first play-through**

The finished game was played by two, three and six players in real browsers (laptop, large screen, phone upright and on its side). What that changed:

- The home screen no longer "invites" anybody to a game that cannot be joined. The store remembers the server's answer (`joinProblem`: no such game, already started, full) until the code is edited or a game is entered, and the screen prints the reason under the code field; a toast alone was gone after four seconds. The same sentence is never on screen twice (`toastsWith`).
- The top bar's "Waiting for ..." sentence moves to a line of its own when the player chips leave it less than 220 pixels (six players with long names used to squeeze it into a column one word wide). On a phone a chip takes at most a third of the line.
- The strip that holds the bottom panels is exactly as tall as the map, and a panel scrolls inside itself, so the city panel can no longer stick out over the top bar in a low window. The panels sit below the map (instead of floating over it) only in a window that is narrow and taller than wide; a small phone held sideways keeps the floating panels, because a deck below the map would leave it a strip a few tiles high.
- The unit panel says how to select the other thing on the same tile (the Settler under the Warrior at the start, a city under a unit), and a "First steps" note is shown until the player has a city. Both are plain functions of the view (`unitHintText`, `firstStepsText` in `ui/texts.ts`).
- A unit standing among trees is drawn with a pale line around it (`sprites/rim.ts`, the 'rim' version of the unit sprites, `UnitDrawing.rim`). The reference picture has no unit in a forest; on open ground units are drawn as in the reference.
- A line of the map size menu is short enough for a phone ("Small, best for up to 3 players"); the size in tiles moved to the note under the menu.
- When the host leaves the lobby, the host's job goes to the lowest seat whose player is connected (`withoutSeat` in `server/src/roomLobby.ts`), not to a seat nobody is sitting on.
- The end-to-end test gained three steps that look at the screen (a stranger on the link of a running game, the city panel in a low window, the top bar with the longest names). Each was seen to fail with its fix taken out.

**After the independent check**

Somebody who had not built the game checked all of phase 1 against the brief. Two things came out of it:

- **The renderer is never a frame behind a resize.** A browser tells a `ResizeObserver` about a new size only while it makes the next frame. Until then the renderer worked with the old size, so "where is this tile?" straight after the window had changed was answered for a canvas that was no longer there. That made the end-to-end test fail about once in 35 runs (its step 10 makes the window low and clicks at once). Now `panBy`, `zoomBy`, `centerOn`, `tileAt` and `tileToScreen` measure the canvas first (`measure` in `render/renderer.ts`). The observer stays for the exact size in device pixels and for resizes while nobody calls the renderer; when it reports, the frame is drawn in that moment rather than at the next animation frame, because a resized canvas is empty and the browser paints right afterwards (before, the map was missing from the picture for one frame at every change of size).
- **A single notch of the mouse wheel always zooms one step.** What a notch is worth differs between computers (100 units on most; less where the display or the page is enlarged). Counted against a fixed 100, a wheel that reports less did nothing when turned one notch at a time. Now the first wheel event after a pause (0.4 s) is a step by itself, and only while the wheel keeps turning are the units added up, 100 to a step, which is what keeps a trackpad from racing through all zoom levels (`createWheelStepper` in `input/gestures.ts`). This was tried with a simulated wheel at several display densities, not yet with a real mouse or trackpad.

## 8. Deferred to later phases (do not build now)

The design leaves room for each of these; the note says where it will plug in.

| Later | Where it plugs in |
|---|---|
| Combat, hit points, ranged attacks, city defence (phase 2) | New action types and columns in `UNITS`; dice from `GameState.rng`; `Unit` gains fields |
| Tech tree, buildings (phase 2) | New data tables; `BuildItem` gains a `kind`; a step in `resolveTurn` |
| Workers, tile improvements, resources (phase 2) | New `Tile` fields, each with a last-seen twin in `RememberedTile` |
| More unit types, sea units | Rows in `UNITS`; `canEnterTile` learns about domains |
| Multi-turn move orders (phase 2) | `Unit` gains an order; a step in `resolveTurn` paths on `boardFromView` of the owner |
| Ordered turns and secretly planned orders between players at war (phase 3) | `GameSettings.turnMode`; a gate in `applyAction`; queued actions run through the same action code |
| Turn timers, Discord and email notifications (phase 3) | Deadlines in the room file (never in `GameState`); the server calls `resolveTurn`; reacts to `turnStarted` |
| Teams, shared vision | `PlayerState` gains a team; one check in `computeVisible` and in `canEnterTile` |
| Events about other players (phase 2: the victim and the onlookers of a fight), turn reports, replays (phase 3) | The engine adds more players to an event's audience (`AddressedEvent.to`), collected where it already walks step by step; no type changes. Events get stored |
| City-states, policies, happiness, diplomacy, trade (phase 4) | More players and tables; new actions |
| Religion, espionage, great people, victory, AI seats (phase 5) | An AI is a player that produces `Action`s from its `PlayerView`; an empty seat is one with `tokenHash: null` |
| Desktop wrapper, PNG art (phase 6) | The client is a static site; `SpriteSheet` gets a PNG implementation |

| A limit on the number of games, tidying away lobbies nobody is in, a check of where a WebSocket comes from (needed before the server faces strangers) | A new `ProtocolErrorCode` in `protocol.ts`; `RoomManager.createRoom`; a timer next to the liveness timer in `connection.ts`; the WebSocket server's `verifyClient` in `server.ts` |

Also left out of phase 1 on purpose: leaving a running game from the game screen (a player opens the page without the code in the address instead), client prediction, animation beyond an optional cosmetic slide, line-of-sight blocking, map wrap, rivers, border growth, manual citizen assignment, manual city names, joining a running game, spectators, chat, kicking players or removing seats, a host override for absent players, moving a seat to another device (other than the manual rescue in the README), accounts, HTTPS in the Node process, a database, sound, a minimap.
