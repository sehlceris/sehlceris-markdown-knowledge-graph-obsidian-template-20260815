// Two guards on what reaches a phone. The import walk runs with no install: everything the
// plugin bundles must import nothing from Node, because Obsidian mobile has none — and the
// only thing standing between a lib/ edit and that mistake is this test. The freshness
// check needs esbuild, so it skips until `npm install` has run.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(HERE, 'main.ts');

/** Every runtime import reachable from `entry`, as [importer, specifier]. `import type` is
 *  erased by the bundler and skipped here too. */
function reachableImports(entry: string): [string, string][] {
  const out: [string, string][] = [];
  const seen = new Set<string>();
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const m of source.matchAll(/^(?:import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s+)?'([^']+)'/gm)) {
      if (m[1]) continue;
      const spec = m[2]!;
      if (spec.startsWith('.')) visit(resolve(dirname(file), spec));
      else out.push([file, spec]);
    }
  };
  visit(entry);
  return out;
}

describe('the plugin bundle', () => {
  it('imports nothing but obsidian at runtime, however deep into scripts/lib it reaches', () => {
    const external = reachableImports(ENTRY).filter(([, spec]) => spec !== 'obsidian');
    assert.deepEqual(external, []);
  });

  it('the import walk catches a Node import two files away', (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'kg-bundle-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(join(dir, 'lib'));
    writeFileSync(join(dir, 'main.ts'), "import type { X } from 'node:path';\nimport { a } from './lib/a.ts';\n");
    writeFileSync(join(dir, 'lib/a.ts'), "export { b as a } from './b.ts';\n");
    writeFileSync(join(dir, 'lib/b.ts'), "import {\n  readFileSync,\n} from 'node:fs';\nexport const b = 1;\n");

    assert.deepEqual(
      reachableImports(join(dir, 'main.ts')).map(([, spec]) => spec),
      ['node:fs']
    );
  });

  it('is committed as built from the current source', async (t) => {
    let esbuild: typeof import('esbuild');
    try {
      esbuild = await import('esbuild');
    } catch {
      t.skip('esbuild is not installed — run npm install');
      return;
    }
    const { OUT_DIR, options } = await import('../build.ts');
    const result = await esbuild.build({ ...options(false), logLevel: 'silent' });
    const built = result.outputFiles![0]!.text;
    assert.equal(built, readFileSync(join(OUT_DIR, 'main.js'), 'utf8'), 'main.js is stale — run npm run plugin:build');
    assert.equal(
      readFileSync(join(HERE, '../manifest.json'), 'utf8'),
      readFileSync(join(OUT_DIR, 'manifest.json'), 'utf8'),
      'manifest.json is stale — run npm run plugin:build'
    );
  });
});
