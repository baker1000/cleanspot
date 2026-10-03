// @vitest-environment node
// Guards RTL support: UI code must use logical Tailwind utilities (ms-/me-/ps-/pe-/start-/end-,
// text-start/text-end, border-s/e, rounded-s/e) instead of physical left/right ones.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(import.meta.dirname, '..', '..', 'src');

const PHYSICAL =
  /(?<![\w-])(?:-?m[lr]|p[lr]|-?left|-?right|border-[lr]|rounded-[lr]|rounded-[tb][lr]|scroll-[mp][lr]|text-(?:left|right)|float-(?:left|right)|clear-(?:left|right))(?:-[\w[\]./]+)?(?![\w-])/g;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx$/.test(name) && !name.endsWith('.test.tsx') ? [path] : [];
  });
}

/** Only look inside className strings / template literals to avoid false positives. */
function classStrings(source: string): string[] {
  return [...source.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)].map(
    (m) => m[1] ?? m[2] ?? '',
  );
}

describe('RTL guard', () => {
  it('uses no physical left/right Tailwind utilities in className', () => {
    const offenders: string[] = [];
    for (const file of files(SRC)) {
      for (const cls of classStrings(readFileSync(file, 'utf8'))) {
        for (const m of cls.matchAll(PHYSICAL)) offenders.push(`${relative(SRC, file)}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('detects offenders (self-test)', () => {
    expect('ml-2 pr-4 text-left inset-x-0 ms-2 left-0'.match(PHYSICAL)).toEqual([
      'ml-2',
      'pr-4',
      'text-left',
      'left-0',
    ]);
  });
});
