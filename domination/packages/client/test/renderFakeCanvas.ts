/**
 * A stand-in browser for the renderer's tests (work package WP5).
 *
 * The renderer needs very little from a browser: a canvas with a 2D context,
 * `document.createElement('canvas')` for its offscreen pictures,
 * `window.devicePixelRatio`, a ResizeObserver and requestAnimationFrame.
 * This file fakes exactly those, in plain Node, and RECORDS what is drawn
 * instead of drawing it. So a test can ask "was the fogged city sprite
 * drawn, and where?" without a real browser. How the map LOOKS is checked
 * by eye; these fakes check what the renderer DOES.
 *
 * Use:  const browser = installFakeBrowser({ devicePixelRatio: 1 });
 *       const canvas = browser.createCanvas({ left: 0, top: 0, width: 800, height: 600 });
 *       ... createMapRenderer(canvas.element) ...
 *       browser.runFrames();      // lets every requested animation frame happen
 *       browser.uninstall();      // in afterEach
 */

import { vi } from 'vitest';

/** One recorded call of a drawing method. */
export interface DrawCall {
  method: string;
  args: unknown[];
  /** The fill colour that was set when the call was made. */
  fillStyle: unknown;
}

export interface FakeCanvas {
  /** Hand this to the code under test. */
  element: HTMLCanvasElement;
  /** Everything drawn on this canvas so far, oldest first. */
  calls: DrawCall[];
  /** Moves or resizes the canvas box on the pretend screen (CSS pixels). */
  setBox(box: { left: number; top: number; width: number; height: number }): void;
}

export interface FakeBrowser {
  createCanvas(box: { left: number; top: number; width: number; height: number }): FakeCanvas;
  /** Canvases the code under test made itself with document.createElement('canvas'). */
  offscreen: FakeCanvas[];
  /** Runs every animation frame that has been requested (and those requested meanwhile, up to `most` rounds). Returns how many ran. */
  runFrames(most?: number): number;
  /** How many animation frames are waiting to run. */
  pendingFrames(): number;
  /** Pretends the browser reports a new size for everything a ResizeObserver watches. */
  fireResize(devicePixelSize?: { width: number; height: number }): void;
  /** How many ResizeObservers are still watching something. */
  activeObservers(): number;
  /** Changes window.devicePixelRatio (as moving the window to another display does). */
  setDevicePixelRatio(ratio: number): void;
  /** The time `performance.now()` and animation frames report; tests move it forward by hand. */
  now: number;
  uninstall(): void;
}

function createFakeCanvas(box: { left: number; top: number; width: number; height: number }): FakeCanvas {
  const calls: DrawCall[] = [];
  let current = { ...box };

  // The context accepts any drawing call and remembers it; properties can be
  // set and read back like on the real thing.
  const properties: Record<string, unknown> = {};
  const context = new Proxy(
    {},
    {
      get(_target, name) {
        if (typeof name !== 'string') return undefined;
        if (name === 'createImageData') {
          return (width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) });
        }
        if (name in properties) return properties[name];
        return (...args: unknown[]) => {
          calls.push({ method: name, args, fillStyle: properties.fillStyle });
        };
      },
      set(_target, name, value) {
        if (typeof name === 'string') properties[name] = value;
        return true;
      },
    },
  );

  const element = {
    width: 300,
    height: 150,
    style: {},
    getContext: (kind: string) => (kind === '2d' ? context : null),
    getBoundingClientRect: () => ({
      left: current.left,
      top: current.top,
      width: current.width,
      height: current.height,
      right: current.left + current.width,
      bottom: current.top + current.height,
      x: current.left,
      y: current.top,
    }),
  };

  return {
    element: element as unknown as HTMLCanvasElement,
    calls,
    setBox(next) {
      current = { ...next };
    },
  };
}

export function installFakeBrowser(options: { devicePixelRatio: number }): FakeBrowser {
  const offscreen: FakeCanvas[] = [];
  let frames: { id: number; callback: (time: number) => void }[] = [];
  let nextFrameId = 1;
  const observers = new Set<{ callback: (entries: unknown[]) => void; watching: boolean }>();
  const fakeWindow = { devicePixelRatio: options.devicePixelRatio };

  const browser: FakeBrowser = {
    createCanvas: createFakeCanvas,
    offscreen,
    now: 1000,
    runFrames(most = 50) {
      let ran = 0;
      for (let round = 0; round < most && frames.length > 0; round++) {
        const due = frames;
        frames = [];
        for (const frame of due) {
          frame.callback(browser.now);
          ran += 1;
        }
      }
      return ran;
    },
    pendingFrames: () => frames.length,
    fireResize(devicePixelSize) {
      for (const observer of observers) {
        if (!observer.watching) continue;
        const entry =
          devicePixelSize === undefined
            ? {}
            : { devicePixelContentBoxSize: [{ inlineSize: devicePixelSize.width, blockSize: devicePixelSize.height }] };
        observer.callback([entry]);
      }
    },
    activeObservers: () => [...observers].filter((observer) => observer.watching).length,
    setDevicePixelRatio(ratio) {
      fakeWindow.devicePixelRatio = ratio;
    },
    uninstall() {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    },
  };

  class FakeResizeObserver {
    private readonly record: { callback: (entries: unknown[]) => void; watching: boolean };
    constructor(callback: (entries: unknown[]) => void) {
      this.record = { callback, watching: false };
      observers.add(this.record);
    }
    observe(): void {
      this.record.watching = true;
    }
    unobserve(): void {
      this.record.watching = false;
    }
    disconnect(): void {
      this.record.watching = false;
    }
  }

  vi.stubGlobal('window', fakeWindow);
  vi.stubGlobal('document', {
    createElement: (tag: string) => {
      if (tag !== 'canvas') throw new Error(`the fake document can only create canvases, not <${tag}>`);
      const canvas = createFakeCanvas({ left: 0, top: 0, width: 0, height: 0 });
      offscreen.push(canvas);
      return canvas.element;
    },
  });
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.stubGlobal('requestAnimationFrame', (callback: (time: number) => void) => {
    frames.push({ id: nextFrameId, callback });
    return nextFrameId++;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    frames = frames.filter((frame) => frame.id !== id);
  });
  vi.spyOn(performance, 'now').mockImplementation(() => browser.now);

  return browser;
}
