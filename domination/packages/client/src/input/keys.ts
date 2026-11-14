/**
 * Which key does what on the game screen (work package WP4).
 *
 * Pure functions over plain data, so the table of shortcuts is tested in
 * plain Node; input/mapInput.ts feeds real keyboard events into them.
 */

export type PanDirection = 'left' | 'right' | 'up' | 'down';

/** What a key press asks for. */
export type KeyCommand =
  | { kind: 'pan'; direction: PanDirection }
  | { kind: 'zoom'; steps: 1 | -1 }
  | { kind: 'endTurn' }
  | { kind: 'deselect' }
  | { kind: 'foundCity' }
  | { kind: 'nextUnit' };

/**
 * What has the keyboard focus:
 *  'text'    a place to type (input, textarea, select, contenteditable): every key belongs to it;
 *  'button'  a button: Enter and Space belong to it, every other key to the map;
 *  'none'    anything else.
 */
export type FocusKind = 'none' | 'text' | 'button';

/** A keydown event, reduced to what matters here. */
export interface KeyPress {
  /** KeyboardEvent.key: the character or name the key produces ('f', '+', 'Enter'). */
  key: string;
  /** KeyboardEvent.code: the physical key ('KeyW', 'ArrowLeft'), the same on every keyboard layout. */
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  /** True for the repeats a held key produces. */
  repeat: boolean;
  focus: FocusKind;
}

/**
 * The keys that scroll the map while held. They go by POSITION on the
 * keyboard (`code`), so "W A S D" is the same cluster of keys on a French
 * or German keyboard, where those keys print other letters.
 */
const PAN_KEYS: Record<string, PanDirection> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  KeyA: 'left',
  KeyD: 'right',
  KeyW: 'up',
  KeyS: 'down',
};

/** The direction a physical key scrolls the map in, or null if it is not a pan key. */
export function panDirectionOfKey(code: string): PanDirection | null {
  return Object.hasOwn(PAN_KEYS, code) ? PAN_KEYS[code] : null;
}

/** Looks at the element that has the focus (or null) and says which kind it is. */
export function focusKind(target: { tagName?: string; isContentEditable?: boolean } | null): FocusKind {
  if (target === null) return 'none';
  const tag = (target.tagName ?? '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable === true) return 'text';
  if (tag === 'BUTTON') return 'button';
  return 'none';
}

/**
 * Was this click made with a mouse or a finger, rather than with the
 * keyboard (Enter or Space on the focused button)?
 *
 * The game screen asks, because the two leave the keyboard in different
 * hands. A button that was clicked keeps the focus, and Enter and Space on
 * a focused button belong to that button (see keyCommand): after a mouse
 * click on "-", Enter would zoom out once more instead of ending the turn.
 * So after a click by pointer the game screen gives the focus back to the
 * page. A button reached with Tab keeps it, because there Enter and Space
 * are the way to press it.
 *
 * @param detail  MouseEvent.detail of the click event: how many times the
 *                pointer went down for it (1, 2 for a double-click...), and
 *                0 for a click that came from the keyboard or from code
 */
export function clickWasByPointer(detail: number): boolean {
  return detail > 0;
}

/**
 * The command for a key press, or null if the key does nothing here.
 *
 *  - Keys pressed with Ctrl, Alt or Meta are the browser's: null.
 *  - While a text-entry element has the focus every key is typing: null.
 *  - Repeats of a held key are ignored (panning tracks keydown and keyup).
 *  - Arrow keys and W A S D pan; + and = zoom in; - and _ zoom out;
 *    Enter ends (or takes back) the turn; Escape deselects; F founds a
 *    city; N selects the next unit with moves left.
 *  - On a focused button, Enter and Space are left to the button, so that
 *    End Turn is not pressed twice by one key.
 */
export function keyCommand(press: KeyPress): KeyCommand | null {
  if (press.ctrlKey || press.altKey || press.metaKey) return null;
  if (press.focus === 'text') return null;
  if (press.repeat) return null;

  const direction = panDirectionOfKey(press.code);
  if (direction !== null) return { kind: 'pan', direction };

  if (press.focus === 'button' && (press.key === 'Enter' || press.key === ' ')) return null;

  switch (press.key.toLowerCase()) {
    case '+':
    case '=':
      return { kind: 'zoom', steps: 1 };
    case '-':
    case '_':
      return { kind: 'zoom', steps: -1 };
    case 'enter':
      return { kind: 'endTurn' };
    case 'escape':
      return { kind: 'deselect' };
    case 'f':
      return { kind: 'foundCity' };
    case 'n':
      return { kind: 'nextUnit' };
    default:
      return null;
  }
}
