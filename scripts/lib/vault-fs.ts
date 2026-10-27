// The vault read from disk: the CLI's half of vault.ts. Everything here needs Node, so
// nothing the Obsidian plugin bundles may import it.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

import { DEFAULT_CONFIG, indexEntries, isScanned, normalizeVaultPath, type Vault, type VaultConfig } from './vault.ts';
import { loadTagVocabulary, type TagVocabulary } from './vocabulary.ts';

/** A vault backed by a directory, which is what writing to it needs. */
export interface DiskVault extends Vault {
  /** Absolute. */
  baseDir: string;
  /** Vault path -> absolute path. Throws for a path outside the vault. */
  absolute(path: string): string;
}

export function toVaultPath(baseDir: string, absPath: string): string {
  return normalizeVaultPath(relative(resolve(baseDir), absPath));
}

/** Lexical, deliberately: on macOS `/var` is a symlink to `/private/var`, so comparing a
 *  realpath'd candidate against a lexical base puts every temp-dir note outside its vault. */
export function isContained(baseDir: string, vaultPath: string): boolean {
  const base = resolve(baseDir);
  const abs = resolve(base, normalizeVaultPath(vaultPath));
  return abs === base || abs.startsWith(base + sep);
}

/** Device plus inode — true for `Note.md` and `note.md` on a case-insensitive filesystem,
 *  which realpath does not reveal. */
export function isSameFile(a: string, b: string): boolean {
  try {
    const x = statSync(a);
    const y = statSync(b);
    return x.dev === y.dev && x.ino === y.ino;
  } catch {
    return false;
  }
}

export function loadVault(baseDir: string, config: Partial<VaultConfig> = {}): DiskVault {
  const resolved = { ...DEFAULT_CONFIG, ...config };
  const abs = resolve(baseDir);
  const { notes, assets } = walkVault(abs, resolved);

  let vocabulary: TagVocabulary | null = null;
  let vocabularyError: string | null = null;
  try {
    vocabulary = loadTagVocabulary(abs);
  } catch (err) {
    vocabularyError = err instanceof Error ? err.message : String(err);
  }

  const absolute = (path: string): string => {
    if (!isContained(abs, path)) throw new Error(`path escapes the vault: ${path}`);
    return resolve(abs, normalizeVaultPath(path));
  };

  return {
    baseDir: abs,
    config: resolved,
    vocabulary,
    vocabularyError,
    ...indexEntries([...notes, ...assets], resolved),
    read: (path) => readFileSync(absolute(path), 'utf8'),
    occupied: (path, self) =>
      isContained(abs, path) &&
      isContained(abs, self) &&
      existsSync(absolute(path)) &&
      !isSameFile(absolute(self), absolute(path)),
    absolute,
  };
}

/** Every `.md` under the buckets is a note; everything else is an asset. A missing bucket is
 *  fine (a fresh vault has few); a missing root throws, because "the vault is gone" is not
 *  "empty". */
export function walkVault(baseDir: string, config = DEFAULT_CONFIG): { notes: string[]; assets: string[] } {
  const notes: string[] = [];
  const assets: string[] = [];
  const root = new Map(readdirSync(baseDir, { withFileTypes: true }).map((e) => [e.name, e]));

  const collect = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      // A dot directory is never descended; isScanned would drop everything in it anyway.
      if (e.isSymbolicLink() || e.name.startsWith('.')) continue;
      const abs = join(dir, e.name);
      const rel = toVaultPath(baseDir, abs);
      if (e.isDirectory()) collect(abs);
      else if (!isScanned(rel, config)) continue;
      else if (e.name.endsWith('.md')) notes.push(rel);
      else assets.push(rel);
    }
  };

  for (const bucket of config.buckets) {
    const entry = root.get(bucket);
    if (entry?.isDirectory()) collect(join(baseDir, bucket));
  }

  return { notes: notes.sort(), assets: assets.sort() };
}
