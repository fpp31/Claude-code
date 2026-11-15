# Domination: architecture (phase 1 and round 2)

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
- A tile is `terrain` (ocean, coast, grassland, plains, desert) + optional `feature` (forest, hills, mountains) + owning `cityId` + optional `improvement` (a farm or a mine, `data/improvements.ts`). A feature's numbers *replace* the ground's; an improvement's are *added*. Rules read tiles only through `tileMoveCost`, `tileYields`, `tileIsWorkable`, `tileAllowsCity`, `cityCenterYields` and `improvementFits`.
- Territory has one source of truth: `tile.cityId`. Worked tiles and yields are derived by `cityEconomy`, never stored.
- `applyAction(state, playerId, turn, action)` validates fully, then works on a copy. Every action carries the turn it was issued in (`staleTurn`). Accepted no-ops are reported with `changed: false`. "Not yours" and "does not exist" share one error code.
- A move carries the path the client chose from its own view. The server walks it one step at a time on the truth, refreshing sight after each step, and stops before the first illegal step. The server never path-finds, so a route cannot give hidden things away.
- One movement implementation behind the small `Board` interface (`boardFromState` on the server, `boardFromView` on the client), so the reachable-tile highlight matches what the server accepts.
- Turns are simultaneous. The turn resolves inside the `endTurn` action that makes everybody ready (same call, same save). `resolveTurn` is a short list of named steps: `runCities`, `runJobs`, `refreshUnits`, `beginNextTurn`, `updateKnowledge`. `runJobs` comes after `runCities`: an improvement that is finished when a turn resolves first counts when the next turn resolves (the rule a new citizen already follows), so a city gets exactly what its panel showed.
- Randomness: one seed string, several independent streams (`seedRng(seed, stream)`): the map, gameplay dice (unused in phase 1), and one id stream per player.
- Unit and city ids are random, per player (`u3_k7m2qd`), so the ids a player sees depend only on their own actions.
- Fog of war: visible = within sight of own units, plus own territory and one ring around it. Explored tiles and last-seen owners, cities and improvements are remembered per player *on the server*, inside the game state.
- Events (`GameEvent`) are cosmetic news for toasts. The engine hands out every event together with its audience (`AddressedEvent`: `to` is a list of players or `'all'`); `filterEvents` picks one player's events and drops the audience lists, which never leave the server. Phase 1 addresses a player's events to that player only, plus `turnStarted` to all; `improvementBuilt` (round 2) goes to the owner of the unit that built it. The client must work if events are ignored.
- Cities are named from their civilization's list in founding order. That makes "how many cities has this player founded" readable from a city's name, which is accepted and written down as a public fact (`protocol.ts`).
- A city has a build QUEUE and one store of production. One turn of a city is ONE function, `runCityTurn` (`rules/city.ts`). Turn resolution calls it; the view's forecast (`buildPlan`) calls the same function on a scratch copy, turn after turn (at most `RULES.forecastTurns`), so every "in N turns" of the city panel is what the engine will do if nothing outside the city changes. `OwnCityDetail.held` says when the first entry is paid for and waiting (the city must grow first, or there is no free tile for the unit).
- A queue is changed by ONE action that carries the whole list (`setBuildQueue`), as a move carries its path; the engine stores only objects it made itself. No queue edit touches what the city has saved.
- Citizens are placed in two steps (`cityEconomy`): the best tiles first, then food before production while the city would not grow (`RULES.minFoodSurplus`). So no improvement and no terrain can stop a city growing while it owns food that nobody works. A city that cannot grow whatever its citizens do keeps the first step's choice: giving up production there would buy nothing. Its food store then runs empty, which costs nothing as long as a hungry city loses no citizen; the doc comment of `cityEconomy` says to look at the rule again on the day one can.
- Work in progress lives on the unit (`Unit.job`); a tile changes only when an improvement is finished, and a unit at work does not move (`unitBusy`). Where an improvement may be built is one function behind a small interface (`improvementSiteError`, with `siteOfTile` on the server and `siteInView` on the client), the pattern of `Board`. Other players learn nothing of a job or a queue: both are orders, and orders are private.
- Start positions come with hard guarantees (distinct, legal city sites, at least `minCityDistance` apart, room to walk) and stronger ones when the map is not crowded (distance, one landmass, fairness within 70%); the generator checks every result and retries with the next attempt stream until they hold. On a crowded map the stronger ones become aims, in that order, behind one that comes first: nobody is put alone on an island too small to grow on.
- All balance numbers live in `shared/src/data/`. Table tests guard the relationships fog and rules rely on (for example: a settler sees far enough that "too close to a city" reveals nothing; every unit sees at least as far as it walks in a turn, so the highlighted tiles are exactly the ones the server lets it reach). The numbers that only shape what generated maps look like live in `shared/src/mapgen/tuning.ts`.

**Server**

- One process, one port: `node:http` serves the built client and upgrades `/ws` to a `ws` WebSocket. Each message is handled synchronously from start to finish: no queues, no locks.
- The commit rule, for every change to a room (lobby or game): **prepare** (build the next file and every message; pure, so an exception here means nothing happened), **save** (temp file written in full and checked for its size, fsync, rename), **adopt and send** (cannot fail: sending never throws). For an action that is: rules, then every seat's view and each socket's update, then save, then adopt, then send, then `actionOk` to the sender. A player whose view did not change receives nothing. A failure before the save answers the actor `actionRejected serverError` and changes nothing.
- A client is never shown the text of an exception: every `serverError` carries the one constant sentence `SERVER_ERROR_MESSAGE`; details go to the server log.
- One JSON file per game (`data/rooms/CODE.json`), rewritten atomically after every accepted change. All games are loaded before the server starts listening.
- Identity: a random token that the browser keeps in localStorage; a seat stores only its SHA-256. The page makes the token on its first visit and stores it before it says hello; the server takes any token of the right form (it keeps no list of them) and makes one for a page that sends none. A game is joined by a five-character code. `joinGame` is also the reconnect message: sent with `name: null` it only brings a player back to a seat they have; taking a seat needs a name, that is, the Join button. A seat whose stored hash is `null` is unclaimed and goes to the next player who joins (the manual rescue for a lost token; later the hook for empty and AI seats).
- A socket is attached to at most one room. Joining another game detaches it from the old one only after the join succeeded, and never gives up the old seat; only `leaveGame` does. The room is the authority on which sockets it holds.
- Per socket: its own `seq` counter (plus one for every `gameSync` and `gameUpdate` sent on it) and last-sent view. Full `gameSync` on attach and on `resync`, `gameUpdate` patches afterwards. `DOMINATION_FULL_SYNC=1` turns patches off.
- Liveness survives background tabs, whose timers run about once a minute: the client pings every 25 s and gives up only if nothing arrives within 10 s after a ping (never on a late timer alone); the server drops a socket after 150 s of silence.
- A save from another version of the game (newer file format, or a game-state layout it cannot migrate) is left untouched on disk and not loaded; its code stays reserved. An older layout is brought up to date in memory by `migrateGameState` (`shared/src/stateMigrations.ts`) when the save is loaded, and must then pass `checkInvariants`, or it is left alone like a save from another version; the file is rewritten with the next save, and no copy of the older file is kept.
- The message check bounds a build queue at 64 entries (`parseMessage.ts`); whether a queue is too long for the rules (`RULES.maxQueueLength`) is the rules' answer, which comes with a request id instead of a closed socket.
- Start-up refuses a data folder inside the public client folder, and warns loudly about a fixed seed.
- Everything about playing reaches the rules through the `Rules` bundle (`server/src/rules.ts`); tests can pass a fake. Loading is the one exception: `storage.ts` imports `migrateGameState`, `checkInvariants` and `STATE_SCHEMA` directly, so a converted save meets the real health check whatever bundle the server runs with.
- No absolute paths: defaults are resolved from the source file location to the project root.

**Client**

- No UI framework. Panels are built once and then updated in place (`textContent`, `hidden`, `disabled`; the small helpers for that are in `ui/dom.ts`, among them `setBar` for the progress bars of both panels), which keeps clicks from being lost when an update arrives mid-press. Names from other players only ever become text nodes.
- One small store holds everything on screen; game data enters it only from server messages. One action in flight at a time (`busy`, set only when a message really went out). One question, `canActNow`, decides both whether reachable tiles are highlighted and whether a tap moves the unit. Buttons that give orders, End Turn among them, are greyed by `ordersClosed` (no connection, turn ended), with a sentence that says why; never for `busy`, which lasts a blink. For the two panels, which buttons that is and which sentence, is the answer of two plain functions (`cityPanelButtons` and `unitPanelButtons` in `ui/panelButtons.ts`); the panels print it. The sentence stands where it stays in sight together with the grey buttons: in the head of the city panel, which does not scroll away, and as the first line of a unit's job block. A press in that blink is ignored, with one exception: a press on an add button of the build queue waits for the answer to an edit of the same queue and is sent on top of it (`Controller.addToQueue`), because on an ordinary internet link the blink is longer than a quick second tap. End Turn is ignored during that time, and what waited is sent in the very store update that brings the answer, so it cannot overtake it.
- The words of the client, and every decision of it that has a clock or arithmetic in it, are pure functions tested in plain Node: `game/`, `state/`, `input/hoverInfo.ts`, `input/gestures.ts`, `input/keys.ts`, and in `ui/` the files `texts.ts`, `panelButtons.ts`, `pressGuard.ts`, `queuePresses.ts`, `hoverPlacement.ts` and `mapReveal.ts`. The files that touch the page print what those answer, measure the page for them, and still decide a few things themselves, which no test in Node can reach and only the end-to-end test watches:
  - `ui/cityPanel.ts`: where the keyboard focus goes when the row it was on leaves the queue; what is held in place on the screen after an add or a removal (the spacer under the rows, the look a frame later, the box the mouse must leave), from what it measures; which add button says "Added to the queue";
  - `ui/unitPanel.ts`: the order of the lines in the job block (the reason first);
  - `ui/gameScreen.ts`: WHEN the map steps aside (always after a selection; after a change of size only for a tile that was in the open before), with how far left to `ui/mapReveal.ts`;
  - `ui/hoverBox.ts`: what the box must keep off (the two corners), and that it is hidden when it fits nowhere; `ui/tileCard.ts`: that the card is rewritten for a new view or another tile; `input/mapInput.ts`: what it tells the hover timer (patient while a unit can be sent, which camera moves were the pointer's);
  - `ui/toasts.ts` and the stylesheet: how long a message stays, and where a press goes through it.
  A decision that is added to one of these files gets a look in the end-to-end test, or is moved out into a plain function. (The review of round 2 took 38 small pieces out of these files, one at a time: 31 of them were noticed by no test. The repair moved the guards, the greying and the stepping aside out, and added looks for the rest that mattered; section 7 has the list.)
- What a tile says comes from one function, `describeTile` (`game/tileInfo.ts`), used by the hover box and the tile card; the unit panel's one line about its tile (`unitTileText`) is in the same file. It reads the view and the shared tables and functions only, so no place can say what the server did not send. The card and the box store tile numbers, never words: both are rewritten from every new view.
- `net/identity.ts` is the only place that touches localStorage, the address bar and page reloads, and it works (as a no-op) where they do not exist, so the app logic is tested in plain Node. The token is also kept in memory, so an open page never forgets who it is. One exception keeps one browser one player on a first visit in several tabs: a page whose token is new and that shows no lobby and no game takes over the token it finds in the storage (section 7, "Cured later").
- End Turn and Cancel share one button; the controller ignores presses for 0.6 s after the button's meaning changed, which makes a double-click or a held Enter key harmless. That is one of the guards against a second press on a spot of the screen that has changed its meaning; each is a plain function, or a few lines of the controller, with a clock handed in:
  - End Turn (0.6 s after its meaning changed) and the Worker's Start and Stop (0.6 s after the job appeared or went), in the controller;
  - the selection guard (0.5 s, in the controller): after the selection went to another unit or city, the order buttons of the panel that opened do nothing (Found City, the job buttons, Stop work, every queue button), because the panel may have come up under the finger that selected. The F key and map taps are not held back;
  - the rows of the build queue (0.6 s, `createKeyedPressGuard` in `ui/pressGuard.ts`): only a second press on the SAME button of the SAME row place is ignored; another row's button counts at once, so an entry can be walked up the queue at any pace;
  - after a removal (`ui/queuePresses.ts`, called by `ui/cityPanel.ts`): the add buttons and "Empty the queue" keep quiet for 0.6 s (`createQuietTime`), and the rows above the removed one keep their place on the screen until the mouse has left the queue, or, for a finger, until nothing was pressed in the panel for 1.5 s (`createRowHold`), so that the entry that followed comes under the pointer as in any list;
  - "Empty the queue" asks once (`createAskOnce`): the first press changes the button's words for four seconds, a second press within 0.6 s is taken for the same double-click, a later one empties the queue.
  That is six guards on the game screen, in three places (the controller, `ui/pressGuard.ts`, `ui/queuePresses.ts`); the lobby has a seventh of its own: Start and Leave ignore a second press for a second (`createPressGuard`).
  Nothing else holds an add button back: two quick taps on "Warrior" are two Warriors, on a slow link too (see `busy` above).
- A queue edit is composed from the view (`game/queueEdits.ts`) and sent as a whole list; the screen changes only when the server's view comes back.
- The news of a turn is made from the events of ONE server message (`eventToasts` in `state/serverMessages.ts`): equal sentences are counted ("3 Farms were finished near Rome."), and a message with more lines than the five the list holds keeps the turn's own line and the lines that ask for something (a city with nothing left to build) and folds what does not fit into one last line. The older rule of `ui/toasts.ts`, that a sentence already on screen is replaced, is left for repeated refusals and for the same news a turn later. On the game screen of a narrow or low window and of a touch screen a press goes through a message to the map (the stylesheet); elsewhere it closes the message.
- The renderer owns canvas, camera and sprites. The app shell owns input events and what they mean. They meet in `render/api.ts`.
- Sprites are authored as text (rows of characters with a small palette and reserved owner-colour characters) and rasterised at start-up behind the `SpriteSheet` interface, so PNG sheets can replace them later. No binary assets, no font files.
- All hex shapes (hit test, fog, highlights, borders) derive from `render/geometry.ts`. Zoom is a whole number of device pixels per art pixel; one zoom step is about one CSS pixel per art pixel, which gives about six levels on every display.
- The camera keeps the middle of the canvas on the map: the map can be dragged until its edge reaches the middle, no further. So `centerOn` really centres every tile, and a tile can always be brought out from under a panel that floats over a corner of the map.
- When a panel lies on the marked tile (the selected unit or city, or the tile of the open tile card), the map steps aside, up or sideways, and it brings the marked tile back from beyond a side edge of the map (a phone that was turned). `ui/gameScreen.ts` decides when; how far is arithmetic on rectangles in `ui/mapReveal.ts`, the pattern of `ui/hoverPlacement.ts`: a tile is "in the open" at least 44 pixels from each edge of the map and from the corner panels. When a panel or the window only changes its size, the map moves only for a tile that was in the open before, never for one the player has scrolled away. The renderer reports every camera change (`onCameraChange`), also from inside `setView` and `centerOn`; a listener may read the renderer but never move the camera. Because such a report can put a new hover tile into the store in the middle of an update, the game screen makes the overlay from the store as it is at that moment (`overlayFor(store.get())`), and its question "is the marked tile in the open?" answers no instead of throwing while the renderer already holds another map.
- Farms and mines are part of the terrain picture (`render/terrainLayer.ts` stamps `sprites/art/improvements.ts` over the feature, with bare ground underneath). Two small signs are drawn from the view alone, not through the overlay: "at work" beside an own unit with a job, and "builds nothing" over an own city with an empty queue (`workingSignOffset` and `cityIsIdle` in `render/scene.ts`). The gold tokens of the selected city's worked tiles are the one highlight of the overlay that is drawn AFTER the units, in the top point of each tile, where no unit, improvement or sign reaches (`sprites/art/markers.ts`): in the middle of the tile they lay under whatever stood there. A city's name banner hangs over the city with its lower edge on the flag and so covers the lower third of the two tiles above it; `BANNER_BOTTOM` in `render/frame.ts` says what was tried instead.
- The renderer is created on a canvas that is already in the page and measures it at once (the game screen therefore puts its panels into the page first, because they take room from the map area); without a view its camera calls do nothing (`render/api.ts`). It measures the canvas again at the start of every camera and hit-test call, so no answer is ever a frame behind a resized window. Fog is applied per sprite (a fogged twin), not as a hexagon laid on top, because sprites stick out of their tile.

**Tooling**

- `tsx` runs the server in development and in production; `tsc` only type-checks (`noEmit`). `shared` is consumed as TypeScript source, so there is no build step for it and no `.js` import suffixes.
- Vite builds and serves the client; Vitest runs all tests from the project root. Runtime dependencies: `ws` and `tsx` (both in `dependencies`, so `npm start` works after an install without development tools; building the client still needs them).

## 3. Module map

Phase 1 was built in five parts at the same time, and many file headers still say which part a file belongs to: **WP1** map generation, **WP2** rules + fog of war + views, **WP3** server, **WP4** client app shell (screens, input, network), **WP5** map renderer + sprites + camera. The *scaffold* is what was written before them: the contracts, the data tables and the foundations. All five parts are merged; nothing is a stub any more. Round 2 (the build queue, the Worker with farms and mines, and the words about every tile) was added on top by five packages with other borders: rules and views, server, client logic, client page, renderer and art. The files it added are marked "round 2" below; the older files it changed keep their old mark.

```
package.json, tsconfig.base.json, vitest.config.ts, .gitignore      project set-up
scripts/dev.mjs, devEnv.mjs                                          what "npm run dev" runs, and the environment it gives
                                                                     its server (its own folder of saved games)
docs/art/, docs/screenshots/                                         the approved art style; pictures for the README
e2e/two-players.ts                                                   the end-to-end test (two browsers, real server)

packages/shared/src/                                                 THE RULES (pure, no Node, no browser)
  index.ts              the public exports of the package            scaffold
  types.ts              GameState, Tile, Unit, City, PlayerState     scaffold
  actions.ts            Action, RuleError, GameEvent, ActionResult   scaffold
  viewTypes.ts          PlayerView, ViewPatch and their parts        scaffold
  protocol.ts           wire messages, PROTOCOL_VERSION              scaffold
  data/                 terrain, units, civs, rules + map sizes,
                        improvements (farm, mine: round 2)           scaffold (the numbers may be tuned)
  stateMigrations.ts    migrateGameState: a saved game of an older
                        layout brought up to today's                 round 2
  hex.ts  rng.ts  ids.ts  json.ts    hex maths, seeded random,
                        ids, JSON helpers                            scaffold
  mapgen/               generateMap.ts (the contract), attempts,
                        buildMap, land, ground, mountains,
                        hillsAndForest, passes, starts, startRules,
                        grid, noise, tuning (the generator's knobs)  WP1
  rules/                createGame; applyAction with one file per
                        action (moveUnit, foundCity, setBuildQueue,
                        endTurn; unitJob holds startJob and stopJob);
                        movement (Board, reachableTiles, pathTo);
                        city (one turn of a city, the forecast);
                        improvements (where one may be built); turn;
                        invariants; results and stateQueries
                        (internal helpers)                           WP2, round 2
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
  rulesQueue, rulesJobs, stateMigrations, contracts (.test.ts)       round 2
  fixtures/             two games saved by phase 1 (a game state and
                        a whole room file): read by the migration
                        and server tests, never edited or remade     round 2

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
                        real sockets), fakeRules.ts and realWorld.ts
                        (the real rules; also helpers for queues,
                        ending a turn and getting a Worker built)    all WP3
                        phaseOneSave.ts: reads the phase 1 room file
                        for the storage and persistence tests        round 2
                        devScript.test.ts: scripts/devEnv.mjs

packages/client/                                                     THE WEB PAGE (browser)
  vite.config.ts, tsconfig.json, tsconfig.node.json                  set-up
  index.html, src/main.ts, src/styles.css                            WP4
  src/ui/               app (which screen), home, lobby and game
                        screens, top bar, unit and city panels, the
                        "First steps" note (startHint), End Turn
                        button, toasts, texts (the sentences), dom,
                        civColors and pressGuard (helpers)           WP4
                        queuePresses (the timing rules of the queue's
                        buttons, beside pressGuard), panelButtons
                        (what the two panels grey out, and the
                        sentence that says why), mapReveal (how far
                        the map steps aside for a panel or a turned
                        phone)                                       repair after round 2
                        tileCard and hoverBox (what is on a tile),
                        tileInfoView (the list both print),
                        hoverPlacement (where the box goes)          round 2
  src/ui/testIds.ts     data-testid names (the e2e contract)         scaffold
  src/net/              connection (reconnect, liveness), identity
                        (token, address bar, storage)                WP4
  src/state/            store, serverMessages                        WP4
  src/game/             controller (what a tap means), selectors     WP4
                        tileInfo (describeTile: every word about a
                        tile), queueEdits (the list a queue button
                        sends)                                       round 2
  src/input/            mapInput (browser events), gestures and keys
                        (the decisions, free of browser code)        WP4
                        hoverInfo (when the hover box comes and goes) round 2
  src/debugHook.ts, src/demo.ts                                      WP4
  src/render/api.ts     MapRenderer, MapOverlay: the seam between
                        the app shell and the renderer               scaffold
  src/render/           renderer (the frame loop), frame (one frame),
                        camera, geometry, terrainLayer, borders,
                        scene, banner + bannerCache, slide, owners,
                        backingStore                                 WP5
  src/sprites/          format (sprites as text), art/ (the
                        pictures; improvements.ts: farm and mine,
                        round 2), font, palette, catalog, looks,
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
| Rules -> server | The `Rules` bundle: `createGame`, `applyAction`, `buildPlayerView`, `filterEvents`, `checkInvariants`; plus `diffViews`. Most server tests pass a small fake bundle; the conflict, leak and restart tests use the real one. Beside the bundle, `storage.ts` uses `migrateGameState`, `checkInvariants` and `STATE_SCHEMA` for a save of an older layout. |
| Rules -> client | `PlayerView` (render-ready), `reachableTiles(boardFromView(view), unit)`, `pathTo`, `applyViewPatch`. The controller and `overlayFor` take the reach function as an option, so their tests can pass a hand-made one. For the tile information only: `tileYields`, `tileMoveCost`, `tileIsWorkable`, `cityCenterYields` and `improvementSiteError(siteInView(view, tile), id)`. These and the reachable-tile highlight are the two places where the client works something out from its own view; everything else comes ready-made (the header of `viewTypes.ts` says the same). |
| Server <-> client | `protocol.ts`, nothing else. |
| App shell -> renderer | `createMapRenderer(canvas)` and `render/api.ts`: `setView`, `setOverlay`, `panBy`, `zoomBy`, `centerOn`, `tileAt`, `tileToScreen`, `tileScreenRect`, `onCameraChange`, `destroy`, and its two "not ready yet" rules (the canvas is in the page before the renderer is created; without a view the camera calls do nothing). |
| Client -> e2e | `ui/testIds.ts` and `window.__domination` (`debugHook.ts`). The script also imports five files of the client that are free of page types: four to compare the page's words and greyed buttons with what they give (`game/tileInfo.ts`, `game/selectors.ts`, `ui/texts.ts`, `ui/panelButtons.ts`), and one for a number (`ui/hoverPlacement.ts`, the gap between a tile and its box). |
| Server -> e2e | `loadConfig(env)` and `startServer({ config })`. |

**How the parts are tested**

- `npm test` runs every unit test, in plain Node. The rules are tested on hand-drawn maps and on generated ones; the server is tested through real sockets against a real `startServer()` on a free port with temporary folders; the client's logic (store, messages, controller, connection, gestures) and the renderer (against a recording stand-in canvas) run without a browser.
- `npm run e2e` is the one test with real browsers: two players, the built page, the real server, the real rules and a generated map, including a reload and a server restart. It has 35 numbered steps and six that were put between them later (5a, 15a, 21a, 21b, 28a, 28b), listed in the header comment of `e2e/two-players.ts`, plays 18 turns and takes a little over 70 seconds. Steps 1 to 16 are phase 1's. Steps 15a, 21a, 28a and 32 to 35 came with the repair after the review of round 2: every press of the build queue and of a panel that has just opened, with a mouse in two window sizes, with a finger on two phone sizes, with the keyboard, and once through a link with delay. Steps 21b and 28b came with the same repair: what the panels grey out with a full queue and after End Turn, compared with the plain functions of `ui/panelButtons.ts`, and the sentence that says why in sight on phone-sized touch screens; and one look (in step 33) uses a second browser, one that shows its scroll bars, which the first hides as a phone does. Six looks inside older steps came last, for what the page files decide and for the map and the news of a turn: a click closes a message in a laptop window (step 15) and a tap goes through it on a phone (21b); the hover box takes its full 0.4 s while a unit can be sent (17) and keeps off an open card (18); a phone that is turned keeps the selected city on the map (21); and a tile card left open across End Turn shows the words of the new turn (in the first turn of steps 22 and 24 in which Ada's city grows). Steps 17 to 31 are round 2's: the hover box and the tile card with a mouse and with a finger on a phone-sized touch screen, a queue that runs empty, and a Worker that builds a farm, up to a reload that still shows it. Every press of a queue or job button is followed by a wait for the view, because nothing on the page changes before the server has answered.
- No test is skipped and none is marked "todo" (the one exception: two tests about file links, which Windows cannot run, skip themselves there). (While the parts were being built, tests that needed another part were guarded with `isImplemented`; those guards were removed at the merge. The helper stays in `shared/src/testing/notImplemented.ts` for the next phase. Round 2 needed no such guard: the server was built after the rules, the page after the client's logic.)

**Checking one part**

`npm test` and `npm run typecheck` check the WHOLE project. To check one part while working on it:

| Part | Tests | Types |
|---|---|---|
| Map generation | `npx vitest run packages/shared/test/mapgen` | `npx tsc -p packages/shared && npx tsc -p packages/shared/test` |
| Rules and views | `npx vitest run packages/shared/test/rules packages/shared/test/visibility packages/shared/test/stateMigrations packages/shared/test/contracts` | as above |
| Server | `npx vitest run packages/server` | `npx tsc -p packages/server` |
| App shell | `npx vitest run packages/client/test/shell` | `npx tsc -p packages/client` |
| Renderer | `npx vitest run packages/client/test/geometry packages/client/test/render` | `npx tsc -p packages/client` |

(The words after `vitest run` are matched against test file paths, so `packages/shared/test/rulesCity.test.ts`, `rulesQueue.test.ts` and `rulesJobs.test.ts` are picked up by the second command, and `shellTileInfo`, `shellHoverInfo` and `shellQueue` by the fourth. `npx vitest run packages/shared` runs everything of the rules package in about 20 seconds.)

When somebody else is at work in the same folder, `tsc` still checks a whole project, so its output can hold errors in files that are not yours and are caught in mid-edit. Keep the lines that name your own files with a `grep` behind it; the part is clean when that prints nothing. `vitest` does not check types and loads only the files a test imports, so the test commands above are yours alone. The lines round 2 used:

```
npx tsc -p packages/server --pretty false | grep -E '^packages/server/'
npx tsc -p packages/client --pretty false | grep -E '^packages/client/(src/(game|state)/|src/input/hoverInfo|src/ui/(texts|hoverPlacement)\.|test/shell)'      # the client's logic
npx tsc -p packages/client --pretty false | grep -E '^packages/client/(src/(render|sprites|dev)/|test/(render|geometry))'                                    # renderer and art
```

(Nobody else edits `packages/shared` while the rules are worked on, so `npx tsc -p packages/shared && npx tsc -p packages/shared/test` needs no `grep`. The files that touch the page, the panels and screens of `src/ui/` and `src/input/mapInput.ts`, have no tests in plain Node: they are tried by hand in the browser and by the end-to-end test. Section 2, Client, lists what they decide.)

When several people (or several copies of the project) run on one machine: give each development setup its own ports and, within one copy of the project, its own folder of saved games (`PORT=8801 DEV_PORT=5201 DOMINATION_DATA_DIR=data-dev-2 npm run dev`), and never test against the shared `packages/client/dist`, because every `npm run build` empties it. Two servers must never share a data folder: each would write over the other's saves. `npm run dev` therefore defaults to `data-dev/`, away from the `data/` of `npm start`. Server tests always use port 0 (a free port), a temporary data folder and a temporary client folder.

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
- **Terrain is ground + feature**, with replace semantics (simple tables, matches the art). The slot this left for improvements is used since round 2: a farm or a mine, whose numbers are added.
- **A city builds from a queue** (round 2; phase 1 kept one item selected and built it over and over). A completed entry leaves the queue; an empty queue loses the turn's production; a first entry that is paid for and cannot be completed holds the queue. A Settler needs population 2 and takes one.
- **Citizens are assigned** by total yield, then food, then lower tile index; then (round 2) they give up production for food while the city would not grow, unless nothing they could do would make it grow. Cities never shrink in phase 1.
- **Random tokens, stored as hashes** (issued by the server in phase 1; made by the page on its first visit since the repair after round 2, see section 7). "Which games am I in?" is answered by the browser remembering its last game code, not by a server-side index.
- **No journal, lock file, turn backups or async queue** in phase 1. Backup is copying `data/`.
- **Patches are whole-section replacements** (`ViewPatch`), implemented and tested in the scaffold, with a full-sync fallback switch.
- **Input is handled by the app shell (WP4)**, which drives the renderer's camera through `panBy` / `zoomBy`; the renderer never listens to pointer or key events.
- **Implemented in the scaffold beyond hex and RNG**, because several work packages meet there: ids, JSON helpers, table accessors, view patches, test fixtures, `pathTo`, the pixel-hex geometry (`client/src/render/geometry.ts`) and a map test page. (It also had a flat-colour stand-in renderer, removed when the real one was merged.)
- **Opening an invite link never takes a seat**; pressing Join does. The page's automatic `joinGame` carries no name and can only bring a player back to a seat they already have. This keeps accidental second seats (phone and laptop) out of the lobby.
- **Seats cannot be removed by the host in phase 1.** Instead: the lobby warns the host before starting with a seat that is not connected; a stuck lobby is replaced by a new game; in a running game the server's owner can free a seat by hand (`tokenHash: null`, see README).
- **City names stay in list order** (the genre's habit), although that tells an observer how many cities a player has founded. It is listed as a public fact; non-interference tests keep the number of founded cities equal between the worlds they compare.
- **Worked tiles are shown on the map** (a marker per tile while the city is selected, `MapOverlay.workedTiles`), not listed in the city panel. (Since the repair after round 2 the marker lies in the top point of the tile and is drawn over the units.)
- **TypeScript 7, Vite 8, Vitest 5** (current releases at the time of writing).

## 7. Points settled when the parts were merged

Each of the five parts reported where it had to decide something its contract left open, or where the contract did not fit. These are the decisions; the doc comments in the code say the same.

**Rules and map**

- `applyAction` answers `badAction` not only for an unknown player or action type but also when a field of a known action is of the wrong basic kind (an id that is not a string, a path that is not a list). Wrong *values* keep their own codes.
- `createGame` gives the state its own copy of the generated map, and throws if the generator breaks its promise (wrong number of starts, a start off the map).
- `OwnUnitDetail.foundCityError` is about the unit and its tile only. After End Turn it can still be null while the action would be answered `turnAlreadyEnded`; the unit panel explains that in words.
- A move ends early only if the world changed after the player's view was made (somebody else stepped into the way in the same instant): every unit sees at least as far as it can walk in a turn, and a table test guards that.
- A foreign unit that a moving unit sees only in passing leaves no trace in the mover's view: units are never remembered. Phase 2 collects who saw whom while the path is walked.
- On a crowded map the generator first keeps every player off a small island of their own (a landmass under `MAPGEN.roomyLandmassTiles` tiles gets a start only if all starts are on it, or if nothing else fits at any allowed distance), then keeps the starts apart up to `RULES.minStartDistance`, then prefers one landmass, then similar scores. More distance than that is not bought with worse fairness.
- The generator's own numbers (the 70% of the fairness rule, the 100 attempts, everything about the look of the land) stay in `mapgen/tuning.ts`. The fairness rule scores the tiles within 2 of a start, the land a city claims; a table test fails if `RULES.cityClaimRadius` ever stops being 2, so the two are changed together.
- `mapgen/grid.ts` keeps one set of read-only lookup tables per map size between calls. It is the only thing the "pure" package remembers, and it cannot change any result.
- The map generator's "gave up" error names the seed. Exception texts only ever reach the server log, where the seed is no secret (it is in the save file too).
- The legend of the text maps (`testing/asciiMap.ts`) has a character for every kind of tile (`A`, mountains on desert, was missing), and `mapToAscii` lives next to `mapFromAscii`, so any generated map can be drawn as text and read back.

**Server**

- A rejected action is answered with the error rebuilt from its code, so only the code and its standard sentence travel.
- `Storage.has` also counts a save that was moved aside as `.corrupt` (its code stays reserved). The version numbers of a save are looked at before its details, so a save from another version is left alone rather than moved aside as damaged. Since round 2 there are two game-state layouts: `shared/src/stateMigrations.ts` holds one step per older layout (today one, from layout 1 to 2: a city's one item becomes its queue, and tiles, units and remembered tiles gain the Worker's fields), and `storage.ts` runs it when it loads an older save.
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

**After the review**

A second group went through the finished phase 1 looking for faults, and a sceptic repeated each one before it counted. What was changed, and what was left:

*Saving*

- **A save is written in full or not at all.** A disk that is nearly full can take the first part of a file and report no error. `storage.save` now writes until every byte is in the file (the next write then fails with "no space left"), compares the file's size with the save, and only then renames it over the old one. A failed save answers the actor `serverError` and keeps the old state, as before.
- **The seats of a started game must be its players.** `checkRoomFile` compares the two (and refuses two seats with one token hash): a seat line that was deleted or renamed by hand used to load without a word and freeze the game. Such a file is moved aside as `.corrupt` with a sentence naming the seat, like every other slip in the envelope. A byte-order mark in front of the file (some editors add one) is ignored.
- **`npm run dev` has its own data folder**, `data-dev/` (`scripts/devEnv.mjs`). There is still no lock file (section 6): two servers started by hand on one folder overwrite each other's saves, and only the README says so.

*Rules and map*

- **Crowded maps: nobody alone on a small island.** The fallback placement used to try "every site there is" at the full distance before trying one landmass a tile closer, which put up to three of six players on islands of fewer than 30 tiles on about one small map in 200 (often with no site for a second city, and never a way off). Small islands are now the last resort (see "Rules and map" above); six players on the small map are 7 instead of 8 apart on about one map in 180.
- **A unit a city completes appears in the city or on land of the city that is joined to it** (`findSpawnTile`): a tile the city owns across a channel is no room, where a unit used to appear that could never walk back. "Joined" means by the city's own land and by the ground alone. It looks no further on purpose: the answer is shown to the owner (then `productionBlocked`; since round 2 `OwnCityDetail.held` and the forecast of `buildPlan`), and the city's own tiles are all the owner is sure to see.
- `generateForSize` takes the placement step as an optional argument, so tests reach the generator's own checks of the start rules, which nothing could reach before.

*Client*

- **A page the server no longer knows goes back to the first screen.** `noSuchGame`, `nameRequired`, `gameAlreadyStarted` and `gameFull` are answers to `joinGame`; arriving while a lobby or game is on screen they can only answer the automatic rejoin, and they take that screen down (it used to stay up, looking alive, with every button refused).
- **`left` during a game means "you are still in it".** It is the answer to a Leave pressed in the lobby in the instant the host pressed Start; the server keeps the seat. The page asks to be let back in instead of dropping to the first screen. Leaving a lobby also forgets it as the "last game", so the first screen does not offer it again.
- **Small things on the page:** Start and Leave ignore a second press for a second (`ui/pressGuard.ts`); a button of the game screen that was clicked by mouse or finger gives the keyboard focus back, so Enter still ends the turn; a `?g=` that cannot be a game code is neither sent nor printed (`cleanGameCode`); the lobby says when its link only works on this computer; at most one "Turn N has begun." toast is on screen (`Toast.slot`); the toast's slide and the blinking dot respect "reduce motion".
- **Words on a civilization's colour have a colour of their own** (`CivDef.text`, `--civ-text`): the accent where it reaches a contrast of 4.5 to 1, otherwise a lighter or darker one (Rome, China, Maya). A table test holds it there. The map, banners and swatches keep primary and accent.
- The end-to-end test gained steps 12 to 16 for the things above that only a real page shows; each was seen to fail with its fix taken out.

*Left as it is*

- **A freed seat goes to whoever joins first, and several freed seats in join order.** That is the documented rescue (section 6); the README now says who "whoever" can be and to free one seat at a time. A claim word belongs with seat management in a later phase.
- **The start placement is still greedy.** An exact search would keep the full distance on some of the crowded maps that now give up a tile; not worth its cost.
- **Focus after End Turn** goes back to the page, by the rule in `dom.ts`; the next Tab starts from where the browser left off.

*Cured later: two tabs on a browser's first visit*

- **Two tabs opened on a browser's very first visit were two players; since the repair after round 2 one browser is one player.** A page used to say `hello` with the token it found in the browser's storage and to store the token the server answered with. A second tab that said `hello` before the first had heard back found no token and was given one of its own: two players, the storage kept whichever token was written last, and the other tab lost its seat on reload. The gap was open for as long as the server's first answer took. Measured with Chromium before the cure: with the messages on the game's socket held back by 120 ms each way, a second tab opened 0, 100 or 200 ms after the first was a second player 15 times out of 15; on one computer without any delay, two tabs opened in the same instant 5 times out of 8.
  The cure is in the page (`net/identity.ts`, `net/connection.ts`). On a first visit the page makes the token itself (`tokenForHello`: 32 lower-case hex characters from the browser's `crypto.getRandomValues`) and stores it BEFORE it says hello, so a second tab finds it. The server needed no change: it keeps no list of tokens, only their hashes on seats, and always took any token of the right form, so a token a page proposes gives nothing that knowing it would not give (a malformed or missing one is still answered with a token of the server's making; `server/test/server.test.ts` holds both). Two tabs can still find the storage empty in the same instant and each write a token. Two nets catch that: a page whose identity is new (it found no token when it loaded) and that shows no lobby and no game takes over the token in the storage (`adoptStoredToken`), once when the server's answer arrives and again whenever the browser says that another tab stored a token (the `storage` event), and says hello again on a new socket as that player. It never writes when it takes a token over, so two tabs cannot swap. A page that came back with a stored token never changes who it is, and neither does a page that shows a lobby or a game: those may own seats.
  Measured again with the same two tabs: through the link with 120 ms of delay 0 second players in 50 tries (gaps of 0, 100 and 200 ms), and 0 in 40 tries without delay in the same instant. In 9 of 30 same-instant tries that were looked at more closely, both tabs had made a token and a net brought them together. What is left: a browser that stores nothing (some private windows), where every tab is a player of its own and the page says so when it opens; and two tabs that would each have to take a seat within the milliseconds before the nets act, which no hand does. All of this was seen in Chromium only.

**Round 2: what the owner asked for after playing**

The owner played phase 1 and asked for three things, in these words: "tooltip that shows what is on each tile when clicking or hovering on it, same when clicking on a unit"; "Queue for construction in the city and ability to stop a construction, should also be able to edit queue, move units up or down in priority and remove. Currently it just keeps building the same unit over and over."; and "Should add worker option to test that." One specification was written for all three and challenged by three critics before anything was built. Then the contracts were written (types, tables, test ids, the renderer seam), and five packages built on them: rules and views, server, client logic, client page, renderer and art. The decisions, each with its reason:

*For the whole round*

- **One new save layout and one new protocol version**, each raised once (`STATE_SCHEMA` 2, `PROTOCOL_VERSION` 2). One migration step covers the queue and the Worker's fields, so no save can carry the new number with half of the fields; an open page is told to reload once. The repair after the review of round 2 raised the protocol number once more, to 3, and left the save layout at 2: the server answers with a new error code (`gameNotLoaded`), and the page carries its own copy of the number tables, one of which changed (a Mine gives +2 production), so every open page has to fetch the new build.
- **The server keeps no copy of a save it converts.** "Backup is copying `data/`" stays the rule, and the README tells whoever runs the server to copy the folder before updating. A converted save that fails the health check is not loaded and its file is not touched.
- **One rule for greying buttons that give orders** (`ordersClosed`): grey for a lasting reason, with the sentence that says so; never for the blink of a round trip. Thirty buttons flashing grey at every tap read as flicker.
- **One description column** for units and one for improvements, at most 45 characters, so that it is one line in the panels that print it (a table test holds the length). Where a wide font or a scroll bar leaves an add button less room, the line takes a second one; it is never cut.

*Words about a tile*

- **One function makes every word** (`describeTile`): a title and finished lines in a fixed order. The hover box and the tile card print the same thing for the same tile, and neither can show what the server did not send. Nothing was added to the view for it.
- **Two places on screen.** A hover box beside the tile under a resting mouse, and a tile card bottom left for a tap or click on a tile that holds nothing of the player's (touch has no hover). A tap on the player's own unit or city opens its panel as before; the unit panel gained a description and one line about its tile. Another player's unit or city is read on the card of its tile.
- **The box sits beside the tile, never on it, and not at the pointer**, so it cannot hide what it describes and does not jitter while the mouse moves inside a tile. Where it goes is plain arithmetic on rectangles (`placeHoverBox`).
- **When the box comes and goes** is a timer of its own (`input/hoverInfo.ts`): after 0.4 s on one tile; gone at once on the next tile, where the next box comes after 0.15 s, or after the full 0.4 s while a unit is selected that can be ordered about; gone on every press, on Escape (which then closes only the box) and on every camera move. A box that followed the mouse at once hopped over the very tiles a unit was being sent to.
- **Taps keep their meaning.** Orders and selecting work as in phase 1. A tap on a tile with nothing of the player's still clears the selection and now also opens the card; after End Turn or without a connection every tile answers a tap the same way.
- **The map steps aside for its own panels**, sideways too, and only for a tile that was in the open: with the taller panels a city in the left part of the screen stayed under its own panel, and watching a panel's size made the map jump back while the player looked elsewhere. In a window at most 480 pixels high the tile card is at most 150 pixels tall and the unit panel at most 220.

*The build queue*

- **`City.buildQueue` with one store.** The first entry is the current build; a completed entry leaves the queue; duplicates and an empty queue are allowed; no edit ever touches what the city has saved, so reordering or removing destroys nothing.
- **One action carries the whole list.** A whole list can only make a queue that was on the sender's screen plus one edit, and it is one shape to check against a hostile client.
- **A first entry that cannot be completed yet holds the queue** (a Settler in a city of one; no free tile): with one store, "working on the next entry" could only mean spending the savings on something ranked lower. **An empty queue loses the turn's production**, as "nothing chosen" did.
- **"In N turns" is a forecast** made by playing the city forward with the engine's own function, growth included, for at most 50 turns. "Waiting" is said only when the first entry is paid for and held: the first wording said it from the first turn and talked players into the slower order.
- **An idle city is hard to miss and never in the way**: the toast of the completion that emptied the queue, the first line of the End Turn hint, "Show me", a gold sign on the map and "Builds nothing" in the hover box. Nothing blocks End Turn, because with simultaneous turns nobody may be held up by a dialog.
- **At most 8 entries** (`RULES.maxQueueLength`; the server's message check only bounds the list at 64, so a queue that is too long gets an answer, not a closed socket). Other players learn nothing about a queue.
- **A row button ignores a second press for 0.6 s; "Empty the queue" asks once.** A double-click on a remove button took two entries, and a double-click on an arrow undid itself. (First built as one guard for all row buttons. The review of round 2 showed what that cost: an entry could not be walked up the queue faster than one row in 0.6 s, and the clicks in between moved other entries. Since the repair the guard has a key, the button and its row place, and after a removal the rows above stay where they are; section 2, Client, lists the guards as they are now.)

*The Worker, farms and mines*

- **A fourth unit and one table of improvements** (`UNITS.worker`, `data/improvements.ts`): a farm on open grassland, plains or desert, a mine on hills, one improvement per tile, only on the builder's own land, never under a city. Every number is one table cell.
- **Work in progress lives on the unit** (`Unit.job` stores the turns worked; the table says how many it takes). There is no half-built thing to fog, to remember or to show to others, and the numbers can be tuned under a running game.
- **Two small actions**, `startJob` (needs no moves left: walking onto hills uses them all) and `stopJob` (the progress is lost). A unit at work does not move, so a stray tap can never throw away turns of work.
- **Citizens put growing first.** A mined hill gives no food and would outrank coast and forest, so a mine could have stopped a city growing for good, with no way back. The second step of `cityEconomy` cures that at the root, for any numbers, and also a stall phase 1 had. A mine therefore needs the food of a farm: the centre feeds one citizen and no unimproved tile feeds more than the citizen who works it, so in a city without a farm a citizen in a mine would end the growth, and the mine stands unused for as long as the city can still grow; its tile says so ("No citizen works this tile"). Growing does not bring a mine into use; only a city that has reached the size its land can feed goes back to its first choice, and with it to the mine. With one farmed grassland tile it is worked from the second citizen on, because a mined hill (0 food, 4 production) is ahead of every unimproved tile in the citizens' first choice; a table test holds it there.
- **Other players see a Worker at work as any Worker**, and the improvement once it stands and they have the tile in sight; a fogged tile shows what was last seen (`RememberedTile.improvement`).
- **The End Turn hint, "Show me" and the N key pass a unit at work by**; it is drawn dimmed with a small white sign, and nothing is highlighted for it. It is not "a unit that can still move".

*Struck on the way*

- A copy of every converted save next to the original (see above).
- A city panel that opens by itself when a city is founded: nobody asked for it, and the gold sign, the hint and "Show me" lead there.
- An event for a job that is dropped because its site went bad (`jobCancelled`): nothing in today's rules can cause it. The check itself is in `runJobs`; the rule that first makes it possible adds the event.
- A key for the Worker's jobs, a "build this first" button on queue rows, a line about work in progress on a tile, a job that removes an improvement.

*Found by building it and trying it by hand*

- The news of a city's growth named the wrong size when a city grew to 2 and released its Settler in the same turn ("grew to 1"); the event now names the size the city grew to.
- Three of the five new pictures were redrawn after being looked at in a browser: the mine read as a tree and is now the timbered mouth of a tunnel in a pale rock; the farm's dotted fields looked like a brick wall and are furrows now; the "builds nothing" sign sat on the head of the unit standing in the city and moved to the upper left of the hall, under the name banner.
- A panel's head (its name, the queue count and the close button) stays in place while the panel scrolls. The style rule for it had to be `top: -12px`, not `top: 0`: a sticky box is held against the inside of the scroll box's padding.
- The new checks of the end-to-end test were tried against the game with one piece of code taken out at a time: 130 such changes, each of which made the script fail at the check it was aimed at. Three checks did not fail when first tried and were changed (the width of a queue row, "a drag is not a click", "the map stepped aside"). (That speaks of what the script looked at. What it did not look at is in the last block of this section.)
- The finished round was played once more through a browser driven by a program that behaves like a person: the hover box with a mouse that moves like a hand and with the many small wheel events of a trackpad, the city panel and the Worker's job buttons under a finger in a phone-sized window upright and on its side, and a game saved by phase 1, which the server converted and four players played on for fourteen turns across a restart. Nothing had to be repaired. What that could NOT try is in the README under "Good to know": a real mouse, a real trackpad, real phones, Firefox and Safari.

**After the review of round 2**

Five people went through the finished round looking for faults, and two sceptics repeated each fault before it counted: 36 findings, and four more things from the lead. They were repaired by four people, one after the other. What was changed, and what was left:

*Rules and saved games*

- **A Mine gives +2 production** (it gave +1). At +1 a mined hill was level with open land in the citizens' first choice and came last of all: a mine stood unused for a whole game. A table test now holds that a mined hill gives more food and production together than any unimproved tile. A mine still needs the food of a farm ("Citizens put growing first" above).
- **A city that cannot grow whatever its citizens do keeps their first choice** (step 3 of `economyOnLand` in `rules/city.ts`): giving up production there bought nothing. Growing first itself stayed, and what it costs was measured again on 390 capitals of generated maps over 100 turns: 49 make less production than under phase 1's placement and 12 more, 2 % less on average, a third less at worst (the README has the sentence). Whether citizens should put growing first at all is for the owner.
- **Saves.** A phase 1 game that was played with tuned numbers is still refused whole (a refused game loses nothing; a wrongly converted one could be written over), but the server's line now names up to three things that do not fit and ends with what to do. A game that is on disk and could not be loaded is answered with its own error code, `gameNotLoaded`, instead of "no such game": the page says so and keeps the game's link, so it is back by itself after the repair. The branches of loading an older save that no test entered have their tests.

*The day of the update*

- **Forgetting `npm run build` no longer leaves everybody waiting.** The server writes one line the first time a page of another protocol number says hello (once per number); the page's "not the same version" sentence says what the person who runs the server has to do; the README has one section, "Updating the game", whose commands were tried in a clone, the way back included. A tab reloads itself for an update once per update, not once in its life (`pageWasWelcomed` in `net/identity.ts`).
- **Two tabs on a first visit are one player** ("Cured later" above).

*Every press counts for what the player chose*

- **The guards of the game screen** are plain functions with a clock handed in, or a few lines of the controller, and section 2 lists them. What changed: the one guard for all row buttons became a guard per button and row place; after a removal the rows above stay where they are and the add buttons keep quiet; a panel that has just opened ignores its order buttons for half a second; a press on an add button waits for the answer that is on its way instead of being dropped (`Controller.addToQueue`); End Turn is never grey for the blink of an answer; the keyboard focus follows a removed row; "Empty the queue" asks once.
- **On an upright phone the row under the panel has one height** (100 pixels: "Show me" above the zoom buttons, End Turn beside them), whatever the End Turn hint says. It used to grow and shrink with the hint and moved the add buttons 64 pixels between two taps.

*The panels' words and looks*

- **What the two panels grey out, and the sentence that says why, is the answer of two plain functions** (`ui/panelButtons.ts`); the sentence stands where it stays in sight with the grey buttons. The queue's small print says what it means ("building now, ready in 8 turns", "costs 18, ready in 30 turns"), a line under the queue's title says what the x does, and "Stop work" warns only while it can be pressed.
- **Dimmed things can be read.** A button that cannot be pressed has words at 5 to 1 on its face; a civilization that is taken (lobby) and a player who is not connected (top bar) are that civilization's colour under a dark veil with light words, no `filter`. `test/shellStyles.test.ts` reads the colours and the `@media` blocks from the stylesheet itself (one line in `vitest.config.ts` hands a test the stylesheet's text).
- **Small things:** the bigger buttons are for every device that HAS a touch screen (`any-pointer`); a panel's scroll bar is thin, in the panel's colours, and its room is kept free so that nothing reflows when a queue grows; a description under an add button wraps instead of being cut; the box around End Turn lets a press through to the map beside "Show me".

*The map, the news of a turn, the hover box*

- **The news of a turn is counted and folded, not merged and cut.** Three farms finished near Rome in one turn were one "Your Worker finished a Farm near Rome.", and with more than five messages the first city's were the ones cut. Now equal sentences of one server message are counted, and what does not fit is one last line; the lines that ask for something are kept first (section 2).
- **A message does not swallow a tap meant for the map** on a phone or in a small window, where the stack reaches the middle of the map: the press goes through, and the message goes by time.
- **The gold tokens of the worked tiles are drawn over the units**, in the top point of each tile. They were in the middle, under whatever stood there, and the worked tiles are where the Workers stand: with a city selected most could not be seen. The token is six rows tall for it instead of seven (it ends on the dark line around a unit's head) and covers one thing, the feather on a Scout's cap.
- **The map steps back from beyond its side edge** (`ui/mapReveal.ts`): turning a phone with a city selected used to leave the city off the screen with its panel still open. "In the open" has a margin at the sides too.
- **The quiet after Escape or a click ends when the map itself has put another tile under the mouse** and the mouse then moves (`input/hoverInfo.ts`); it used to last until the tile after that one.
- **The city's name banner stayed where it is.** It lies on the lower third of the two tiles above the city at every zoom, and on the feet of a Worker or the lower rows of a farm or mine there. Lower, with its edge on the roof, those tiles are clear (at every zoom but the smallest) and the flag is gone under the banner at every zoom; halfway neither is true. A render test holds the place, and `BANNER_BOTTOM` in `render/frame.ts` is the one number to change if the owner would rather lose the flag.

*What the tests did not see, and what they see now*

- **Decisions had crept into the files that touch the page**, where no test in plain Node reaches. A reviewer took 38 small pieces out of those files, one at a time: no unit test noticed any, the end-to-end test noticed 7. The repair moved out what has a clock or arithmetic (the guards, the ask-once rule, the greying, the stepping aside), and section 2 now says what those files still decide. The end-to-end test gained nine steps and about a dozen looks inside older ones; each new check was seen to fail with its repair taken out (44 such changes in the three parts of the repair that touched the page).

*Left as it is, for the owner*

- On common laptop windows the queue and the add buttons of a city are not in view together; on a 360 by 640 phone the map is a strip of about 140 pixels while a city panel is open. Both need a decision about the panel's layout.
- Whether citizens should put growing first at all, or the player should choose per city; whether "Stop work" should ask once, like "Empty the queue"; whether the banner should sit on the roof.
- The news of a turn is on screen for four seconds and nowhere afterwards. A list to read it again belongs with stored events (section 8).

## 8. Deferred to later phases (do not build now)

The design leaves room for each of these; the note says where it will plug in.

| Later | Where it plugs in |
|---|---|
| Combat, hit points, ranged attacks, city defence (phase 2) | New action types and columns in `UNITS`; dice from `GameState.rng`; `Unit` gains fields |
| Tech tree, buildings (phase 2) | New data tables; `BuildItem` gains a `kind`; a step in `resolveTurn` |
| Resources, roads, more improvements | Rows in `IMPROVEMENTS`; new `Tile` fields, each with a last-seen twin in `RememberedTile` (Workers and two improvements exist since round 2) |
| Placing citizens by hand; removing an improvement | An action that pins a citizen, read by `cityEconomy` before its two steps; a job without an improvement in `runJobs` |
| A key for the Worker's jobs; a "build this first" button on queue rows | `input/keys.ts`; one more row button that sends the reordered list through `setBuildQueue` |
| A hold-your-finger gesture for reading a highlighted tile on a phone | `input/gestures.ts` decides, `controller.onTileTap` gets a second entrance that only inspects |
| An event when a job is cancelled (with land changing hands) | Step 2a of `runJobs` in `rules/turn.ts`; a new `GameEvent` addressed to the unit's owner |
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
