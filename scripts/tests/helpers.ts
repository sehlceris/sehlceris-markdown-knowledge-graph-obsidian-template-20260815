// Every test builds its own vault under os.tmpdir() and removes it afterwards. Nothing in
// the suite reads the real vault.

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { after } from 'node:test';

import { TAG_VOCABULARY_FILE, type TagVocabulary } from '../lib/vocabulary.ts';

export const TEST_TAG_VOCABULARY: TagVocabulary = {
  domainTags: ['computing', 'house-elm', 'local', 'people', 'pottery', 'work'],
  shapeTags: ['measurement'],
};

const temps: string[] = [];
after(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

/** A temp vault holding `files` (vault path -> exact contents, no newline added) plus the
 *  test vocabulary. Pass `vocabulary: null` to leave it absent, or a string for exact bytes. */
export function makeVault(
  files: Record<string, string>,
  opts: { vocabulary?: TagVocabulary | string | null } = {}
): string {
  const dir = mkdtempSync(join(tmpdir(), 'kg-vault-'));
  temps.push(dir);
  const vocabulary = opts.vocabulary === undefined ? TEST_TAG_VOCABULARY : opts.vocabulary;
  const all =
    vocabulary === null
      ? files
      : {
          [TAG_VOCABULARY_FILE]:
            typeof vocabulary === 'string' ? vocabulary : `${JSON.stringify(vocabulary, null, 2)}\n`,
          ...files,
        };
  for (const [path, contents] of Object.entries(all)) {
    const abs = join(dir, path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, contents);
  }
  return dir;
}

/** Every file under `dir`, path -> contents. A refusal has to leave this identical. */
export function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const abs = join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else out[relative(dir, abs)] = readFileSync(abs, 'utf8');
    }
  };
  walk(dir);
  return out;
}

export const read = (dir: string, path: string): string => readFileSync(join(dir, path), 'utf8');

/** A note with valid frontmatter around `body`. */
export function note(body = '', tags = ['computing'], extra = ''): string {
  return `---\ncreated: 2026-01-01\nupdated: 2026-01-01\ntags:\n${tags.map((t) => `  - ${t}`).join('\n')}\n${extra}---\n\n${body}\n`;
}
