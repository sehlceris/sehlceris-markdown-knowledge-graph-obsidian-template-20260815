// Bundles src/main.ts into the vault's .obsidian/plugins/<id>/, where Obsidian loads it.
// The output is committed: a phone that syncs the vault has no npm to build it with.
//
//   npm run plugin:build          once
//   npm run plugin:build -- --watch
//
// platform: 'browser' is the mobile guarantee. Obsidian on a phone has no Node, and esbuild
// refuses to resolve node:fs for a browser bundle — so a lib/ change that drags a Node
// import into the plugin fails this build instead of failing on someone's phone.

import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type BuildOptions, build, context } from 'esbuild';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const MANIFEST = join(HERE, 'manifest.json');

const { id } = JSON.parse(readFileSync(MANIFEST, 'utf8')) as { id: string };
export const OUT_DIR = join(ROOT, '.obsidian/plugins', id);

export function options(write = true): BuildOptions {
  return {
    entryPoints: [join(HERE, 'src/main.ts')],
    outfile: join(OUT_DIR, 'main.js'),
    // Relative to the vault root, so the path comments in main.js match on every machine.
    absWorkingDir: ROOT,
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    // Obsidian's own floor. esbuild lowers syntax to it; library calls are lib/'s job.
    target: 'es2018',
    external: ['obsidian'],
    banner: { js: '// Generated from plugins/sehlceris-markdown-knowledge-graph/ by `npm run plugin:build`. Do not edit.' },
    logLevel: 'info',
    metafile: true,
    write,
  };
}

/** The only runtime import a bundle may keep is Obsidian itself. */
export function strayImports(metafile: { outputs: Record<string, { imports: { path: string; external?: boolean }[] }> }): string[] {
  return Object.values(metafile.outputs)
    .flatMap((o) => o.imports)
    .filter((i) => i.external && i.path !== 'obsidian')
    .map((i) => i.path);
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  copyFileSync(MANIFEST, join(OUT_DIR, 'manifest.json'));

  if (process.argv.includes('--watch')) {
    const ctx = await context(options());
    await ctx.watch();
    return;
  }

  const result = await build(options());
  const stray = strayImports(result.metafile!);
  if (stray.length) {
    console.error(`main.js imports more than obsidian: ${stray.join(', ')}`);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
