// A vault as the planning code sees it: which directories are scanned, the notes and assets
// found in them, and the vault-owned tag vocabulary.
//
// Vault paths are relative POSIX paths from the vault root — "03-initiatives/deck/plan.md".
// Every result and message speaks them; absolute paths exist only at the filesystem edge,
// which is vault-fs.ts. This module imports nothing from Node: the Obsidian plugin bundles
// it, and Obsidian on a phone has no Node to import.

import type { TagVocabulary } from './vocabulary.ts';

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

/** The config a vault's own top-level folders imply: every `NN-name` folder is a bucket,
 *  plus `templates/`, and the archive, status, daily and inbox buckets are found by name.
 *  The Obsidian plugin runs in vaults whose buckets were named before this template's —
 *  `06-misc-knowledge`, `99-deleted` — so it reads them off the vault instead of assuming
 *  DEFAULT_CONFIG. A vault with no numbered folders yet gets the default. */
export function configFromFolders(folders: string[]): VaultConfig {
  const numbered = folders.filter((f) => /^\d+-./.test(f)).sort();
  if (numbered.length === 0) return DEFAULT_CONFIG;
  const named = (...names: string[]): string[] =>
    numbered.filter((f) => names.includes(f.slice(f.indexOf('-') + 1)));
  const machinery = [TEMPLATES, ...named('daily', 'inbox')];
  return {
    buckets: [...numbered, TEMPLATES],
    archiveBucket: named('archive')[0] ?? ARCHIVE_BUCKET,
    statusBuckets: named('initiatives', 'areas'),
    unlinkedBuckets: machinery,
    emptyTagBuckets: machinery,
    skipPrefixes: named('inbox').map((b) => `${b}/secrets/`),
  };
}

// ─── Paths ───────────────────────────────────────────────────────────────────

/** Windows separators and a leading "./" normalize away, as does a trailing slash —
 *  which is how a shell completes a directory name. */
export function normalizeVaultPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
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
  if (/^(\/|[A-Za-z]:)/.test(path) || path.split('/').includes('..')) return false;
  return config.buckets.some((b) => path === b || path.startsWith(`${b}/`));
}

export function isSkipped(vaultPath: string, config = DEFAULT_CONFIG): boolean {
  return config.skipPrefixes.some((p) => vaultPath.startsWith(p));
}

/** Whether a file at this path is a vault entry: under a bucket, not skipped, and no dot
 *  segment anywhere — .DS_Store is not an attachment, .obsidian/ is not a bucket. The disk
 *  walk and the Obsidian plugin both filter by this, so they index the same vault. */
export function isScanned(vaultPath: string, config = DEFAULT_CONFIG): boolean {
  const path = normalizeVaultPath(vaultPath);
  return (
    config.buckets.some((b) => path.startsWith(`${b}/`)) &&
    !path.split('/').some((s) => s.startsWith('.')) &&
    !isSkipped(path, config)
  );
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
  /** Whether moving `self` to `path` would overwrite something. Asks the storage, not the
   *  index: a destination the scan skipped would still be overwritten. `self` is excluded
   *  because a case-insensitive filesystem reports `note.md` as present when `Note.md` is
   *  the file being renamed. */
  occupied(path: string, self: string): boolean;
}

export function entryOf(vaultPath: string, isNote: boolean): VaultEntry {
  const segments = segmentsOf(vaultPath);
  // Index, not .at(-1): the plugin runs this in iOS WebViews older than 15.4.
  return { path: vaultPath, segments, basename: segments[segments.length - 1] ?? '', isNote };
}

/** The entry index over already-listed files, filtered and split by `isScanned` and the
 *  `.md` suffix. Everything that is not a note is an asset — a leaf that links nothing and
 *  owes nothing, but that a link may land on. */
export function indexEntries(
  paths: Iterable<string>,
  config = DEFAULT_CONFIG
): Pick<Vault, 'notes' | 'assets' | 'entries' | 'byPath'> {
  const scanned = [...paths].map(normalizeVaultPath).filter((p) => isScanned(p, config)).sort();
  const notes = scanned.filter((p) => p.endsWith('.md')).map((p) => entryOf(p, true));
  const assets = scanned.filter((p) => !p.endsWith('.md')).map((p) => entryOf(p, false));
  const entries = [...notes, ...assets];
  return { notes, assets, entries, byPath: new Map(entries.map((e) => [e.path, e])) };
}
