import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The shared package must stay pure and deterministic: the same inputs give
 * the same game on the server, in the browser and in tests. This test reads
 * the source files and fails if one of them reaches for the clock, the
 * built-in random function, or anything that only exists in Node or in a
 * browser. (The TypeScript settings of the package catch most of these too;
 * this catches the rest, such as Math.random.)
 */

const SOURCE_DIR = fileURLToPath(new URL('../src', import.meta.url));

const FORBIDDEN: { pattern: RegExp; why: string }[] = [
  { pattern: /\bMath\s*\.\s*random\b/, why: 'use rng.ts (seeded) instead of Math.random' },
  { pattern: /\bDate\b/, why: 'the rules must not read the clock' },
  { pattern: /\bperformance\b/, why: 'the rules must not read the clock' },
  { pattern: /\bprocess\s*\./, why: 'no Node APIs in shared' },
  { pattern: /\brequire\s*\(/, why: 'no Node APIs in shared' },
  { pattern: /from\s+['"]node:/, why: 'no Node APIs in shared' },
  { pattern: /\b(window|document|localStorage|navigator)\b/, why: 'no browser APIs in shared' },
  { pattern: /\b(setTimeout|setInterval)\b/, why: 'no timers in shared' },
  { pattern: /\bconsole\s*\./, why: 'no logging in shared (return errors instead)' },
  // Maths that may differ in the last digit between machines or browsers.
  // Allowed: floor, ceil, round, trunc, abs, sign, min, max, sqrt, imul.
  {
    pattern: /\bMath\s*\.\s*(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|asinh|acosh|atanh|exp|expm1|log|log2|log10|log1p|pow|cbrt|hypot)\b/,
    why: 'this Math function is not guaranteed to give the same result everywhere (see mapgen/generateMap.ts)',
  },
  { pattern: /\*\*/, why: 'the ** operator is Math.pow in disguise; write x * x' },
];

function listSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listSourceFiles(path));
    else if (entry.name.endsWith('.ts')) files.push(path);
  }
  return files;
}

/** Removes comments, so that explaining a rule in a comment does not trip the scan. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('packages/shared stays pure', () => {
  const files = listSourceFiles(SOURCE_DIR);

  it('finds the source files', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('uses no clock, no built-in randomness, no Node and no browser APIs', () => {
    const problems: string[] = [];
    for (const file of files) {
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const { pattern, why } of FORBIDDEN) {
        if (pattern.test(code)) problems.push(`${file.slice(SOURCE_DIR.length + 1)}: ${why}`);
      }
    }
    expect(problems).toEqual([]);
  });
});
