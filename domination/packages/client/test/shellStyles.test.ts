import { describe, expect, it } from 'vitest';
import { CIVS, CIV_IDS } from '@domination/shared';
import styles from '../src/styles.css?raw';

/**
 * Words that must stay readable where the page dims them. The colours are
 * read from the stylesheet itself (src/styles.css), so a change there that
 * makes greyed words too faint fails here. Small print needs a contrast of
 * 4.5 to 1 (WCAG AA); the test for words on a civilization's own colour is
 * in packages/shared/test/tables.test.ts.
 *
 * What this cannot see: a `filter` changes the colours after the fact. The
 * dimmed states below must therefore not use one, and the test says so.
 */

/** A colour as red, green, blue (0 to 255). */
type Rgb = [number, number, number];

/** Relative luminance, as WCAG 2 defines it. */
function luminance(color: Rgb): number {
  const [r, g, b] = color.map((value) => {
    const part = value / 255;
    return part <= 0.04045 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: Rgb, b: Rgb): number {
  const [dark, light] = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (light + 0.05) / (dark + 0.05);
}

/** '#rrggbb' as numbers. */
function fromHex(color: string): Rgb {
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error(`"${color}" is not a colour written as #rrggbb`);
  return [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16)) as Rgb;
}

/** 'rgb(24 24 40 / 0.6)' as a colour and how much of it covers what is underneath (0 to 1). */
function fromRgbWithAlpha(color: string): { color: Rgb; alpha: number } {
  const match = /^rgb\((\d+) (\d+) (\d+) \/ (0?\.\d+)\)$/.exec(color);
  if (match === null) throw new Error(`"${color}" is not a colour written as rgb(r g b / a)`);
  return { color: [Number(match[1]), Number(match[2]), Number(match[3])], alpha: Number(match[4]) };
}

/** What is seen where `veil` lies over `ground`. */
function under(veil: { color: Rgb; alpha: number }, ground: Rgb): Rgb {
  return ground.map((value, index) => Math.round(value * (1 - veil.alpha) + veil.color[index] * veil.alpha)) as Rgb;
}

/** A stylesheet, or the inside of one of its @media blocks, read into rules. */
interface Sheet {
  /** The rules outside every block: for each selector its declarations (a later rule adds to an earlier one, as in a browser). */
  rules: Map<string, Map<string, string>>;
  /** The blocks that begin with "@": what stands before the brace ('@media (max-height: 480px)'), and what is inside. */
  blocks: { prelude: string; inside: Sheet }[];
}

function readSheet(css: string): Sheet {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = new Map<string, Map<string, string>>();
  const blocks: Sheet['blocks'] = [];
  let position = 0;
  while (position < text.length) {
    const open = text.indexOf('{', position);
    if (open === -1) break;
    const prelude = text.slice(position, open).trim();
    // The end of this block: the brace that closes it (a block may hold blocks).
    let depth = 1;
    let end = open + 1;
    while (end < text.length && depth > 0) {
      if (text[end] === '{') depth += 1;
      else if (text[end] === '}') depth -= 1;
      end += 1;
    }
    if (prelude.startsWith('@')) {
      blocks.push({ prelude: prelude.replace(/\s+/g, ' '), inside: readSheet(text.slice(open + 1, end - 1)) });
    } else {
      const declarations = text.slice(open + 1, end - 1).split(';');
      for (const selector of prelude.split(',').map((part) => part.trim().replace(/\s+/g, ' '))) {
        const known = rules.get(selector) ?? new Map<string, string>();
        for (const declaration of declarations) {
          const colon = declaration.indexOf(':');
          if (colon === -1) continue;
          known.set(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim().replace(/\s+/g, ' '));
        }
        rules.set(selector, known);
      }
    }
    position = end;
  }
  return { rules, blocks };
}

const SHEET = readSheet(styles);
const RULES = SHEET.rules;

/**
 * A declaration of a rule as it is written; fails if the stylesheet has no
 * such rule or declaration.
 *
 * @param block  the @media block to look in ('@media (max-height: 480px)'); left out, the rules outside every block
 */
function written(selector: string, property: string, block?: string): string {
  const rules = block === undefined ? RULES : SHEET.blocks.find((candidate) => candidate.prelude === block)?.inside.rules;
  const value = rules?.get(selector)?.get(property);
  if (value === undefined) throw new Error(`styles.css has no "${property}" in a rule for "${selector}" (${block ?? 'outside @media'})`);
  return value;
}

/** A declaration with a variable of :root put in: 'var(--paper)' becomes '#f8f0d8'. */
function resolved(selector: string, property: string): string {
  return written(selector, property).replace(/var\((--[a-z-]+)\)/g, (_all, name: string) => written(':root', name));
}

describe('the stylesheet reader of this test', () => {
  it('knows the formula: black on white is 21 to 1, #777777 on white just misses 4.5', () => {
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrast(fromHex('#777777'), [255, 255, 255])).toBeCloseTo(4.48, 2);
  });

  it('reads rules, variables and colours as they are written', () => {
    expect(written(':root', '--paper')).toBe('#f8f0d8');
    expect(resolved('.toast', 'background')).toBe('#f8f0d8');
    expect(written('.button', 'min-height')).toBe('36px'); // the rule outside @media, not the one for touch screens
    expect(under({ color: [0, 0, 0], alpha: 0.5 }, [200, 100, 0])).toEqual([100, 50, 0]);
    expect(() => written('.no-such-thing', 'color')).toThrow();
  });
});

describe('buttons a finger must hit (styles.css)', () => {
  it('the bigger buttons are for every device that HAS a touch screen (any-pointer), not only for one whose first pointer is a finger', () => {
    // A laptop with a touch screen reports a mouse as its first pointer: under "(pointer: coarse)" a finger
    // there got the 30 pixel buttons of the build queue.
    const preludes = SHEET.blocks.map((block) => block.prelude);
    expect(preludes).toContain('@media (any-pointer: coarse)');
    expect(preludes.filter((prelude) => /\(pointer:/.test(prelude))).toEqual([]);

    const touch = SHEET.blocks.find((block) => block.prelude === '@media (any-pointer: coarse)')?.inside.rules;
    const size = (selector: string, property: string): number => parseInt(touch?.get(selector)?.get(property) ?? '0', 10);
    // 44 pixels both ways for everything in a panel that is pressed: the row buttons of the queue, the close button, every other button.
    expect(size('.button', 'min-height')).toBeGreaterThanOrEqual(44);
    expect(size('.queue-button', 'width')).toBeGreaterThanOrEqual(44);
    expect(size('.queue-button', 'min-height')).toBeGreaterThanOrEqual(44);
    expect(size('.panel-close', 'width')).toBeGreaterThanOrEqual(44);
    expect(size('.zoom-button', 'width')).toBeGreaterThanOrEqual(44);
    expect(size('.zoom-button', 'min-height')).toBeGreaterThanOrEqual(44);
    // Sizes only: nothing in that block changes how the page behaves for a mouse.
    const properties = [...(touch?.values() ?? [])].flatMap((declarations) => [...declarations.keys()]);
    expect(properties.every((property) => property === 'width' || property === 'min-height')).toBe(true);
  });
});

describe('the news of a turn does not swallow taps meant for the map (styles.css)', () => {
  it('on the game screen of a narrow or low window and of a touch screen a press goes through a toast; elsewhere a press closes it', () => {
    // Everywhere else a toast takes presses (ui/toasts.ts closes it then): a large window with a mouse, the first screen, the lobby.
    expect(written('.toast', 'pointer-events')).toBe('auto');
    // The windows where the stack of toasts reaches the middle of the map: the narrow layout, the low layout, a touch screen.
    expect(written('.unit-panel', 'max-height', '@media (max-height: 480px)')).toBe('220px'); // the low layout's breakpoint is still 480
    expect(SHEET.blocks.map((block) => block.prelude)).toContain('@media (max-width: 720px)'); // and the narrow layout's 720
    const through = SHEET.blocks.find((block) => block.prelude === '@media (max-width: 720px), (max-height: 480px), (any-pointer: coarse)')?.inside.rules;
    expect(through).toBeDefined();
    // Only on the game screen, only the toasts, and nothing else in that block.
    expect([...(through?.keys() ?? [])]).toEqual(["[data-screen='game'] .toast"]);
    expect([...(through?.get("[data-screen='game'] .toast")?.entries() ?? [])]).toEqual([['pointer-events', 'none']]);
  });
});

describe('greyed words can still be read (styles.css)', () => {
  it('a button that cannot be pressed: its words have a contrast of at least 4.5 to 1 on its face, and it stays flat', () => {
    const face = fromHex(resolved('.button:disabled', 'background'));
    const words = fromHex(resolved('.button:disabled', 'color'));
    // The add buttons of a city, the Worker's job buttons and "Stop work" are read while they are grey (after End
    // Turn, with a full queue): cost, turns, what a unit is for.
    expect(contrast(words, face)).toBeGreaterThanOrEqual(4.5);
    // Their small print takes the same colour, not a fainter one.
    expect(written('.build-button:disabled .build-about', 'color')).toBe('inherit');
    expect(written('.job-button:disabled .job-about', 'color')).toBe('inherit');
    // "Cannot be pressed" is said by the flat look: no light and dark edge, as a raised button has.
    expect(written('.button', 'box-shadow')).toContain('inset');
    expect(written('.button:disabled', 'box-shadow')).not.toContain('inset');
    // And it is still told apart from a button that can be pressed.
    expect(resolved('.button:disabled', 'background')).not.toBe(resolved('.button', 'background'));
    expect(contrast(words, face)).toBeLessThan(contrast(fromHex(resolved('.button', 'color')), fromHex(resolved('.button', 'background'))));
  });

  it('a civilization somebody else has taken (lobby) and a player who is not connected (top bar): the name has at least 4.5 to 1 for EVERY civilization', () => {
    const veil = fromRgbWithAlpha(written(':root', '--veil'));
    for (const selector of ['.civ-button:disabled', ".chip[data-connected='false']"]) {
      // The civilization's colour under a dark veil, and light words on it. No filter: it would change both colours after the fact.
      expect(written(selector, 'background'), selector).toBe('linear-gradient(var(--veil), var(--veil)), var(--civ)');
      expect(RULES.get(selector)?.has('filter'), selector).toBe(false);
      const words = fromHex(resolved(selector, 'color'));
      for (const id of CIV_IDS) {
        const ground = under(veil, fromHex(CIVS[id].primary));
        expect(contrast(words, ground), `${selector}, ${id}`).toBeGreaterThanOrEqual(4.5);
        // Dimmed means darker than the civilization's own colour, for every civilization.
        expect(luminance(ground), `${selector}, ${id}`).toBeLessThan(luminance(fromHex(CIVS[id].primary)));
      }
    }
  });

  it('in the lobby "connected" and "not connected" beside a seat have at least 4.5 to 1 on every ground a seat row has', () => {
    // "not connected" is the word the host must notice before pressing Start. It was the red of the error
    // messages, which is 2.98 to 1 on a taken seat's row (12 pixel letters).
    const grounds = ['.seat', '.seat.taken'].map((selector) => ({ selector, color: fromHex(resolved(selector, 'background')) }));
    for (const state of ['.seat-status', '.seat-status.absent']) {
      const words = fromHex(resolved(state, 'color'));
      for (const ground of grounds) {
        expect(contrast(words, ground.color), `${state} on ${ground.selector}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    // The two states are told apart by their colour, and nothing dims a row that shows one after the fact.
    expect(resolved('.seat-status.absent', 'color')).not.toBe(resolved('.seat-status', 'color'));
    for (const selector of ['.seat', '.seat.taken', '.seat-status', '.seat-status.absent']) {
      expect(RULES.get(selector)?.has('opacity'), selector).toBe(false);
      expect(RULES.get(selector)?.has('filter'), selector).toBe(false);
    }
  });
});

describe('"Grow first" / "Build first", and "Stop work" while it asks (styles.css)', () => {
  const chosen = ".focus-button[aria-pressed='true']";
  const greyed = `${chosen}:disabled`;

  it('the words of a chosen focus button (light on the sunk face) and of a chosen, greyed one (grey on the sunk face) stand at 4.5 to 1 or more; the chosen button\'s rule names no --accent', () => {
    // Sunk: the face of a well, with a shadow on the inside, where an ordinary button has a light upper edge.
    expect(written(chosen, 'background')).toBe('var(--chrome-sunk)');
    expect(written(chosen, 'box-shadow')).toContain('inset');
    expect(written(chosen, 'box-shadow')).not.toContain('255 255 255');
    const face = fromHex(resolved(chosen, 'background'));
    // Light words and a light edge: the name, and the small line under it.
    expect(contrast(fromHex(resolved(chosen, 'color')), face)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(fromHex(resolved(`${chosen} .focus-about`, 'color')), face)).toBeGreaterThanOrEqual(4.5);
    expect(written(chosen, 'border-color')).toBe(written(chosen, 'color'));

    // Greyed while no order can be given: still on the sunk face, so that it is told from the other button
    // (which has the face of every greyed button), with grey words and a grey edge that can be read.
    expect(resolved(greyed, 'background')).toBe(resolved(chosen, 'background'));
    expect(resolved(greyed, 'background')).not.toBe(resolved('.button:disabled', 'background'));
    expect(contrast(fromHex(resolved(greyed, 'color')), fromHex(resolved(greyed, 'background')))).toBeGreaterThanOrEqual(4.5);
    expect(written(greyed, 'border-color')).toBe(written(greyed, 'color'));
    // The small line of a greyed button takes its button's colour, chosen or not, as the add buttons' small print does.
    expect(written('.focus-button:disabled .focus-about', 'color')).toBe('inherit');
    // ... and that rule comes after the chosen button's light small line, which has the same weight: the later one wins.
    expect(styles.indexOf('.focus-button:disabled .focus-about')).toBeGreaterThan(styles.indexOf(`${chosen} .focus-about`));

    // Gold stays the colour of warnings and of buttons that ask ("Nothing to build", "Tap again to stop"): no
    // rule of the two buttons names it, by its variable or by its value, inside an @media block or outside.
    const gold = written(':root', '--accent');
    const everyRule = [RULES, ...SHEET.blocks.map((block) => block.inside.rules)];
    let looked = 0;
    for (const rules of everyRule) {
      for (const [selector, declarations] of rules) {
        if (!selector.includes('.focus-')) continue;
        looked += 1;
        for (const [property, value] of declarations) {
          expect(value, `${selector} { ${property} }`).not.toContain('--accent');
          expect(value.toLowerCase(), `${selector} { ${property} }`).not.toContain(gold);
        }
      }
    }
    expect(looked).toBeGreaterThanOrEqual(6); // the row, the button, the name, the small line, the chosen one, the chosen one greyed
  });

  it('the small line inside a focus button is hidden in no window, and the two buttons stand side by side', () => {
    // The city panel hides its hints (.panel-hint) on phones and in low windows. The two small lines must be
    // read there, so they are a class of their own, and no rule anywhere takes that class or the block away.
    expect(written('.city-panel .panel-hint', 'display', '@media (max-width: 720px)')).toBe('none');
    expect(written('.city-panel .panel-hint', 'display', '@media (max-height: 480px)')).toBe('none');
    for (const rules of [RULES, ...SHEET.blocks.map((block) => block.inside.rules)]) {
      for (const [selector, declarations] of rules) {
        if (!selector.includes('.focus-')) continue;
        expect(declarations.get('display'), selector).not.toBe('none');
        expect(declarations.has('visibility'), selector).toBe(false);
        expect(declarations.has('height'), selector).toBe(false);
        expect(declarations.has('max-height'), selector).toBe(false);
      }
    }
    // Two columns of one width; a low window only moves the block closer to the head.
    expect(written('.focus-row', 'grid-template-columns')).toBe('1fr 1fr');
    expect([...(SHEET.blocks.find((block) => block.prelude === '@media (max-height: 480px)')?.inside.rules.get('.focus-row')?.keys() ?? [])]).toEqual(['margin-top']);
    // Each name is one line at every size, so the block is as tall under either choice.
    expect(written('.focus-name', 'white-space')).toBe('nowrap');
  });

  it('"Tap again to stop" has the look of the other button that asks, and the button keeps its right edge when its words get longer', () => {
    expect(written('.job-stop.armed', 'color')).toBe('var(--accent)');
    expect(written('.job-stop.armed', 'color')).toBe(written('.queue-clear.armed', 'color'));
    // The row: small print on the left, the button at the right end and never squeezed, so it grows to the left only.
    expect(written('.job-stop-row', 'display')).toBe('flex');
    expect(written('.job-stop-row', 'align-items')).toBe('center');
    expect(written('.job-stop-row .button', 'flex')).toBe('none');
    expect(written('.job-stop-row .button', 'margin-left')).toBe('auto');
  });
});

describe('the add buttons of the city panel keep their height (styles.css)', () => {
  it('each of the three lines of an add button is one line whatever the font: never wrapped, cut with an ellipsis where a font is too wide, and no rule anywhere lets one wrap again', () => {
    // A middle line that took a second line made the Settler's button a line taller at an answer: the buttons
    // under it moved, and a quick second press landed on another unit. The words are short enough for the fonts
    // they were measured in (ADD_LINE_MAX in ui/texts.ts); this rule holds the height in every other font.
    const lines = ['.build-name', '.build-detail', '.build-about'];
    for (const line of lines) {
      expect(written(line, 'white-space'), line).toBe('nowrap');
      expect(written(line, 'overflow'), line).toBe('hidden');
      expect(written(line, 'text-overflow'), line).toBe('ellipsis');
    }
    // The line can only be cut where its column can get narrower than its words: the button's one column starts at 0.
    expect(written('.build-button', 'grid-template-columns')).toBe('minmax(0, 1fr)');
    // No rule, in any window, takes that back or wraps the words another way.
    let looked = 0;
    for (const rules of [RULES, ...SHEET.blocks.map((block) => block.inside.rules)]) {
      for (const [selector, declarations] of rules) {
        if (!lines.some((line) => selector.includes(line))) continue;
        looked += 1;
        expect(declarations.get('white-space') ?? 'nowrap', selector).toBe('nowrap');
        expect(declarations.get('overflow') ?? 'hidden', selector).toBe('hidden');
        for (const wrapping of ['text-wrap', 'overflow-wrap', 'word-break', 'display', 'height', 'max-height', '-webkit-line-clamp']) {
          expect(declarations.has(wrapping), `${selector} { ${wrapping} }`).toBe(false);
        }
      }
    }
    expect(looked).toBeGreaterThanOrEqual(5); // the three lines, the greyed description, "Added to the queue"
  });
});
