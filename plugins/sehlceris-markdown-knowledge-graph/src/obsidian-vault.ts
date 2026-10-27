// The two seams between Obsidian and the planning code: a Vault built from the app's index,
// and a VaultIO that writes through the app. Writing through the app rather than to disk is
// what keeps open tabs on a moved note, and is the only way to write on a phone.

import { type App, TFile, TFolder } from 'obsidian';

import { isScanned } from '../../../scripts/lib/vault.ts';
import type { Vault } from '../../../scripts/lib/vault.ts';
import type { VaultIO } from './apply.ts';
import { indexedVault } from './indexed-vault.ts';

/** Reads every scanned note, because a move can break a bare link in any of them. */
export async function loadVault(app: App): Promise<Vault> {
  const files = app.vault.getFiles();
  const notes = files.filter((f) => f.path.endsWith('.md') && isScanned(f.path));
  const contents = new Map(await Promise.all(notes.map(async (f) => [f.path, await app.vault.cachedRead(f)] as const)));
  return indexedVault({
    files: files.map((f) => f.path),
    contents,
    taken: app.vault.getAllLoadedFiles().map((f) => f.path),
  });
}

/** Deliberately not FileManager.renameFile, which would run Obsidian's own link updating
 *  on top of the plan's, nor processFrontMatter, which reserializes the whole block. */
export function obsidianIO(app: App): VaultIO {
  const file = (path: string): TFile => {
    const f = app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) throw new Error(`no such file: ${path}`);
    return f;
  };

  return {
    read: (path) => app.vault.read(file(path)),
    process: async (path, fn) => {
      await app.vault.process(file(path), fn);
    },
    exists: (path) => app.vault.adapter.exists(path),
    rename: async (from, to) => {
      const f = app.vault.getAbstractFileByPath(from);
      if (!f) throw new Error(`no such file: ${from}`);
      await app.vault.rename(f, to);
    },
    createFolder: async (path) => {
      await app.vault.createFolder(path);
    },
    removeEmptyFolder: async (path) => {
      const folder = app.vault.getAbstractFileByPath(path);
      if (!(folder instanceof TFolder) || folder.children.length > 0) return false;
      // The index skips hidden files; a folder holding only .DS_Store is not empty to the
      // CLI either.
      const listed = await app.vault.adapter.list(path);
      if (listed.files.length > 0 || listed.folders.length > 0) return false;
      await app.vault.delete(folder);
      return true;
    },
  };
}
