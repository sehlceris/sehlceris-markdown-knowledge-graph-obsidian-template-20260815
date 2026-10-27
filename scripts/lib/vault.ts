// A loaded vault: which directories are scanned, the notes and assets found in them, and
// the vault-owned tag vocabulary.
//
// Vault paths are relative POSIX paths from the vault root — "03-initiatives/deck/plan.md".
// Every result and message speaks them; absolute paths exist only at the filesystem edge.

import { readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { loadTagVocabulary, type TagVocabulary } from './vocabulary.ts';

// ─── Policy ──────────────────────────────────────────────────────────────────

export const ARCHIVE_BUCKET = '08-archive';
export const TEMPLATES = 'templates';

export interface VaultConfig {
  /** Scanned directories. `templates/` is unnumbered because it is machinery. */
  buckets: string[];
  /** Mirrors the live buckets, so `08-archive/03-initiatives/x.md` is an archived initiative. */
  archiveBucket: string;
  /** Only work with a lifecycle carries `status:`. */
  statusBuckets: string[];
  /** Machinery and capture surfaces: they owe nobody an inbound link. */
  unlinkedBuckets: string[];
  /** Buckets whose notes may carry an empty tag list. */
  emptyTagBuckets: string[];
  /** Vault-path prefixes never read. `02-inbox/secrets/` is nobody's business. */
  skipPrefixes: string[];
}

export const DEFAULT_CONFIG: VaultConfig = {
  buckets: [
    '01-daily',
    '02-inbox',
    '03-initiatives',
    '04-areas',
    '05-entities',
    '06-knowledge',
    '07-references',
    ARCHIVE_BUCKET,
    TEMPLATES,
  ],
  archiveBucket: ARCHIVE_BUCKET,
  statusBuckets: ['03-initiatives', '04-areas'],
  unlinkedBuckets: [TEMPLATES, '01-daily', '02-inbox'],
  emptyTagBuckets: [TEMPLATES, '01-daily', '02-inbox'],
  skipPrefixes: ['02-inbox/secrets/'],
};

// ─── Paths ───────────────────────────────────────────────────────────────────

/** Windows separators and a leading "./" normalize away, as does a trailing slash —
 *  which is how a shell completes a directory name. */
export function normalizeVaultPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
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

/** Path without ".md", split on "/". Assets keep their extension: `![[diagram.png]]`
 *  writes it. */
export function segmentsOf(vaultPath: string): string[] {
  return normalizeVaultPath(vaultPath).replace(/\.md$/, '').split('/');
}

/** The live bucket a path belongs to, read through the archive mirror. */
export function bucketOf(vaultPath: string, config = DEFAULT_CONFIG): string {
  const segs = normalizeVaultPath(vaultPath).split('/');
  if (segs[0] === config.archiveBucket) segs.shift();
  return segs[0] ?? '';
}

export function isArchived(vaultPath: string, config = DEFAULT_CONFIG): boolean {
  return normalizeVaultPath(vaultPath).startsWith(`${config.archiveBucket}/`);
}

export function archivePathFor(vaultPath: string, config = DEFAULT_CONFIG): string {
  const path = normalizeVaultPath(vaultPath);
  return isArchived(path, config) ? path : `${config.archiveBucket}/${path}`;
}

export function unarchivePathFor(vaultPath: string, config = DEFAULT_CONFIG): string {
  const path = normalizeVaultPath(vaultPath);
  return isArchived(path, config) ? path.slice(config.archiveBucket.length + 1) : path;
}

export function isInBuckets(vaultPath: string, config = DEFAULT_CONFIG): boolean {
  const path = normalizeVaultPath(vaultPath);
  if (path.startsWith('../') || isAbsolute(path)) return false;
  return config.buckets.some((b) => path === b || path.startsWith(`${b}/`));
}

function isSkipped(vaultPath: string, config: VaultConfig): boolean {
  return config.skipPrefixes.some((p) => vaultPath.startsWith(p));
}

// ─── The loaded vault ────────────────────────────────────────────────────────

export interface VaultEntry {
  /** Vault path, e.g. "06-knowledge/foo.md". */
  path: string;
  /** Path without ".md", split on "/". */
  segments: string[];
  /** "foo" for a note, "diagram.png" for an asset. */
  basename: string;
  /** false for assets. */
  isNote: boolean;
}

export interface Vault {
  /** Absolute. */
  baseDir: string;
  config: VaultConfig;
  /** null when the vocabulary is missing or unusable; `vocabularyError` says why. Only the
   *  frontmatter check needs it, so the link commands still work on a vault without one. */
  vocabulary: TagVocabulary | null;
  vocabularyError: string | null;
  notes: VaultEntry[];
  assets: VaultEntry[];
  /** notes ++ assets. */
  entries: VaultEntry[];
  byPath: Map<string, VaultEntry>;
  /** File contents, utf8, line endings untouched. */
  read(path: string): string;
  /** Vault path -> absolute path. Throws for a path outside the vault. */
  absolute(path: string): string;
}

export function entryOf(vaultPath: string, isNote: boolean): VaultEntry {
  const segments = segmentsOf(vaultPath);
  return { path: vaultPath, segments, basename: segments.at(-1) ?? '', isNote };
}

export function loadVault(baseDir: string, config: Partial<VaultConfig> = {}): Vault {
  const resolved = { ...DEFAULT_CONFIG, ...config };
  const abs = resolve(baseDir);
  const { notes: notePaths, assets: assetPaths } = walkVault(abs, resolved);

  let vocabulary: TagVocabulary | null = null;
  let vocabularyError: string | null = null;
  try {
    vocabulary = loadTagVocabulary(abs);
  } catch (err) {
    vocabularyError = err instanceof Error ? err.message : String(err);
  }

  const notes = notePaths.map((p) => entryOf(p, true));
  const assets = assetPaths.map((p) => entryOf(p, false));
  const entries = [...notes, ...assets];

  const absolute = (path: string): string => {
    if (!isContained(abs, path)) throw new Error(`path escapes the vault: ${path}`);
    return resolve(abs, normalizeVaultPath(path));
  };

  return {
    baseDir: abs,
    config: resolved,
    vocabulary,
    vocabularyError,
    notes,
    assets,
    entries,
    byPath: new Map(entries.map((e) => [e.path, e])),
    read: (path) => readFileSync(absolute(path), 'utf8'),
    absolute,
  };
}

/** Every `.md` under the buckets is a note; everything else is an asset — a leaf that links
 *  nothing and owes nothing, but that a link may land on. A missing bucket is fine (a fresh
 *  vault has few); a missing root throws, because "the vault is gone" is not "empty". */
export function walkVault(baseDir: string, config = DEFAULT_CONFIG): { notes: string[]; assets: string[] } {
  const notes: string[] = [];
  const assets: string[] = [];
  const root = new Map(readdirSync(baseDir, { withFileTypes: true }).map((e) => [e.name, e]));

  const collect = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      // Dotfiles are the filesystem's business: .DS_Store is not an attachment, .gitkeep
      // is not a note.
      if (e.isSymbolicLink() || e.name.startsWith('.')) continue;
      const abs = join(dir, e.name);
      const rel = toVaultPath(baseDir, abs);
      if (isSkipped(rel, config)) continue;
      if (e.isDirectory()) collect(abs);
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
