/**
 * Pointer, wheel and keyboard input on the map (work package WP4).
 *
 * This module turns raw browser events into three kinds of calls:
 *  - camera moves on the renderer: panBy, zoomBy, centerOn;
 *  - taps and hovers on tiles for the controller (using renderer.tileAt);
 *  - keyboard commands for the controller.
 * It contains no game logic and no drawing.
 *
 * The decisions themselves live in two files without any browser in them,
 * which is what lets them be unit-tested: input/gestures.ts (tap, drag,
 * pinch, hover, wheel steps) and input/keys.ts (which key does what). This
 * file only listens and passes things on.
 */

import type { Controller } from '../game/controller';
import type { MapRenderer, ScreenPoint } from '../render/api';
import { createPointerTracker, createWheelStepper } from './gestures';
import type { PointerKind, PointerSample } from './gestures';
import { focusKind, keyCommand, panDirectionOfKey } from './keys';
import type { PanDirection } from './keys';

/** How fast the arrow keys scroll the map, in CSS pixels per second. */
const KEY_PAN_SPEED = 600;
/** The longest step one animation frame may stand for (a frame after a pause must not make the map jump). */
const LONGEST_FRAME_SECONDS = 0.05;

/**
 * Starts listening. Returns a function that removes every listener again.
 *
 * POINTER (Pointer Events only: one code path for mouse, touch and pen)
 *  - Press, move more than the drag threshold (4 px for a mouse, 10 px for
 *    touch/pen), and it is a DRAG: renderer.panBy(dx, dy) with the movement
 *    since the last event. A drag never counts as a tap.
 *  - Press and release without dragging is a TAP:
 *    controller.onTileTap(tile) if renderer.tileAt(point) is not null.
 *    The right mouse button behaves like the left one; the context menu is
 *    suppressed on the canvas.
 *  - Two pointers down is a PINCH: when the distance between them has grown
 *    or shrunk by about 30%, renderer.zoomBy(+1 or -1, midpoint) and measure
 *    again from there. A pinch never produces a tap.
 *  - Mouse movement with no button pressed is a HOVER:
 *    controller.onTileHover(renderer.tileAt(point)); onTileHover(null) when
 *    the pointer leaves the canvas. Touch never hovers.
 *  - Use setPointerCapture so a drag keeps working outside the canvas.
 *
 * WHEEL
 *  - The first wheel event after a pause is one step: renderer.zoomBy(-1 or
 *    +1, pointer position) (wheel up zooms in). So one notch of a mouse
 *    wheel always zooms, whatever number this computer reports for a notch.
 *  - While the wheel keeps turning, add up deltaY; every 100 units is one
 *    more step. Adding up keeps trackpads, which send many small deltas,
 *    from overshooting. (Both rules: createWheelStepper in gestures.ts.)
 *  - preventDefault so the page does not scroll.
 *
 * KEYBOARD (listen on window)
 *  - Ignore keys pressed with Ctrl/Alt/Meta.
 *  - Ignore ALL keys while a text-entry element has focus: input, textarea,
 *    select, or anything contenteditable.
 *  - A focused BUTTON does not switch the keyboard off: the map keys must
 *    go on working. Skip only Enter and Space then, because the button
 *    handles those itself (otherwise End Turn would fire twice). A button
 *    has the focus only when it was reached with the Tab key: the game
 *    screen takes the focus off a button that was clicked with the mouse
 *    (ui/gameScreen.ts), so Enter after a click on a zoom button still
 *    ends the turn.
 *  - Ignore keydown events with `event.repeat` set: holding a key must not
 *    fire a command thirty times a second. (Panning does not need repeats;
 *    it tracks keydown and keyup.)
 *  - Arrow keys and W A S D: pan while held (about 600 CSS px per second,
 *    driven by requestAnimationFrame only while a key is down).
 *  - + and - (also = and _): zoomBy(+1 / -1).
 *  - Enter: controller.toggleEndTurn().  Escape: controller.deselect().
 *  - F: controller.foundCity().
 *  - N: tile = controller.selectNextIdleUnit(); if not null, renderer.centerOn(tile).
 *
 * @param canvas  the map canvas (CSS gives it `touch-action: none`, so the
 *                browser does not scroll or zoom the page on touch)
 */
export function attachMapInput(canvas: HTMLCanvasElement, renderer: MapRenderer, controller: Controller): () => void {
  /** Where the mouse last was over the map, so the hover can be refreshed when the keyboard moves the map under it. */
  let mousePoint: ScreenPoint | null = null;

  function hover(point: ScreenPoint | null): void {
    mousePoint = point;
    controller.onTileHover(point === null ? null : renderer.tileAt(point));
  }

  const tracker = createPointerTracker({
    pan: (dx, dy) => renderer.panBy(dx, dy),
    tap(point) {
      const tile = renderer.tileAt(point);
      if (tile !== null) controller.onTileTap(tile);
    },
    zoom: (steps, anchor) => renderer.zoomBy(steps, anchor),
    hover,
  });
  const wheel = createWheelStepper();

  // ---- Pointer ----------------------------------------------------------------

  function kindOf(event: PointerEvent): PointerKind {
    return event.pointerType === 'mouse' ? 'mouse' : 'touch';
  }

  function sampleOf(event: PointerEvent): PointerSample {
    return { id: event.pointerId, kind: kindOf(event), x: event.clientX, y: event.clientY };
  }

  function onPointerDown(event: PointerEvent): void {
    try {
      // Keeps the moves coming to the canvas when a drag leaves it.
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // A pointer that cannot be captured still works while it stays over the canvas.
    }
    tracker.down(sampleOf(event));
  }

  const onPointerMove = (event: PointerEvent): void => tracker.move(sampleOf(event));
  const onPointerUp = (event: PointerEvent): void => tracker.up(sampleOf(event));
  const onPointerCancel = (event: PointerEvent): void => tracker.cancel(event.pointerId);
  const onPointerLeave = (event: PointerEvent): void => tracker.leave(kindOf(event));
  const onContextMenu = (event: Event): void => event.preventDefault();

  /**
   * Tells the browser that touches on the map are handled by this page.
   * Without it, a browser that sees a quick swipe believes the page is still
   * coasting along afterwards, and swallows the next tap as "stop coasting":
   * End Turn would ignore a tap made right after a swipe on the map. (Found
   * in Chromium; the Pointer Events this module works with are not affected.)
   */
  const onTouchStart = (event: Event): void => event.preventDefault();

  function onWheel(event: WheelEvent): void {
    event.preventDefault();
    const steps = wheel.add(event.deltaY, event.deltaMode, event.timeStamp);
    if (steps !== 0) renderer.zoomBy(steps, { x: event.clientX, y: event.clientY });
  }

  // ---- Keyboard ---------------------------------------------------------------

  /** The pan keys that are down right now (by physical key), and where each one scrolls. */
  const heldPanKeys = new Map<string, PanDirection>();
  let panFrame: number | null = null;
  let lastFrameTime = 0;

  /** After the keyboard has moved the map, the tile under a resting mouse is another one. */
  function refreshHover(): void {
    if (mousePoint !== null) hover(mousePoint);
  }

  function panStep(time: number): void {
    panFrame = null;
    if (heldPanKeys.size === 0) return;
    const seconds = Math.min(LONGEST_FRAME_SECONDS, Math.max(0, (time - lastFrameTime) / 1000));
    lastFrameTime = time;

    // Pressing "left" shows what is to the left: the map itself moves right.
    let dx = 0;
    let dy = 0;
    for (const direction of new Set(heldPanKeys.values())) {
      if (direction === 'left') dx += 1;
      if (direction === 'right') dx -= 1;
      if (direction === 'up') dy += 1;
      if (direction === 'down') dy -= 1;
    }
    if (dx !== 0 || dy !== 0) {
      renderer.panBy(dx * KEY_PAN_SPEED * seconds, dy * KEY_PAN_SPEED * seconds);
      refreshHover();
    }
    panFrame = requestAnimationFrame(panStep);
  }

  function startPanning(): void {
    if (panFrame !== null) return;
    lastFrameTime = performance.now();
    panFrame = requestAnimationFrame(panStep);
  }

  function onKeyDown(event: KeyboardEvent): void {
    const focus = focusKind(event.target instanceof Element ? event.target : null);

    // A held Enter would otherwise press a focused button again and again
    // (End Turn, Cancel, End Turn...): let only the first press through.
    if (event.repeat && focus === 'button' && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      return;
    }

    const command = keyCommand({
      key: event.key,
      code: event.code,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
      repeat: event.repeat,
      focus,
    });
    if (command === null) return;
    event.preventDefault();

    switch (command.kind) {
      case 'pan':
        heldPanKeys.set(event.code, command.direction);
        startPanning();
        break;
      case 'zoom':
        renderer.zoomBy(command.steps);
        refreshHover();
        break;
      case 'endTurn':
        controller.toggleEndTurn();
        break;
      case 'deselect':
        controller.deselect();
        break;
      case 'foundCity':
        controller.foundCity();
        break;
      case 'nextUnit': {
        const tile = controller.selectNextIdleUnit();
        if (tile !== null) {
          renderer.centerOn(tile);
          refreshHover();
        }
        break;
      }
    }
  }

  function onKeyUp(event: KeyboardEvent): void {
    // Always let go, whatever has the focus by now: a key that was pressed must not stay "held".
    if (panDirectionOfKey(event.code) !== null) heldPanKeys.delete(event.code);
  }

  /** When the window loses the focus the keyup never arrives: stop scrolling. */
  const onWindowBlur = (): void => heldPanKeys.clear();

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('contextmenu', onContextMenu);
  canvas.addEventListener('touchstart', onTouchStart, { passive: false });
  canvas.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onWindowBlur);

  return () => {
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerCancel);
    canvas.removeEventListener('pointerleave', onPointerLeave);
    canvas.removeEventListener('contextmenu', onContextMenu);
    canvas.removeEventListener('touchstart', onTouchStart);
    canvas.removeEventListener('wheel', onWheel);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onWindowBlur);
    heldPanKeys.clear();
    if (panFrame !== null) cancelAnimationFrame(panFrame);
    panFrame = null;
  };
}
