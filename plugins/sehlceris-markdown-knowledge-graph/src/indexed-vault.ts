// A Vault over files something else has already listed and read — Obsidian's index in the
// app, a fixture in a test. The planning code cannot tell it from the CLI's disk vault: the
// same filter decides what is a note, so both plan the same move.

import { DEFAULT_CONFIG, indexEntries, type Vault, type VaultConfig } from '../../../scripts/lib/vault.ts';

export interface IndexedFiles {
  /** Every file in the vault, scanned or not; the filter is applied here. */
  files: Iterable<string>;
  /** Contents of every scanned note. */
  contents: ReadonlyMap<string, string>;
  /** Every path that exists, folders included, scanned or not: what a move must not
   *  overwrite. */
  taken: Iterable<string>;
  config?: VaultConfig;
}

export function indexedVault({ files, contents, taken, config = DEFAULT_CONFIG }: IndexedFiles): Vault {
  // Lower-cased because the phone and the Mac both sit on case-insensitive filesystems,
  // where `Note.md` overwrites `note.md`.
  const occupied = new Set([...taken].map((p) => p.toLowerCase()));
  return {
    config,
    vocabulary: null,
    vocabularyError: 'the plugin does not load the tag vocabulary',
    ...indexEntries(files, config),
    read(path) {
      const text = contents.get(path);
      if (text === undefined) throw new Error(`not read into the index: ${path}`);
      return text;
    },
    // The file being moved is not in its own way, which matters only for a case-only rename.
    occupied: (path, self) => path.toLowerCase() !== self.toLowerCase() && occupied.has(path.toLowerCase()),
  };
}
