// Resolving a link, and the link graph built from every link in the vault. Backlinks, the
// link checks and move planning all read this one index.

import { bucketOf, type Vault, type VaultEntry } from './vault.ts';
import { parseWikilinks, type Wikilink } from './wikilinks.ts';

// A wikilink is a path suffix matched on segment boundaries, so [[note]], [[folder/note]]
// and [[full/path/to/note]] are one query. That is how Obsidian resolves, and why duplicate
// basenames are legal: two notes may share a name, but a link so short it matches both has
// no single answer. Lengthening it to the shortest path that names one note is the fix.
//
// A leading slash means "from the vault root" and is otherwise the same query. Case must
// match; every filename here is kebab-case.
export function resolveTarget(target: string, among: VaultEntry[]): VaultEntry[] {
  const segs = target.replace(/^\//, '').replace(/\.md$/, '').split('/');
  return among.filter(
    (e) =>
      segs.length <= e.segments.length &&
      segs.every((s, i) => s === e.segments[e.segments.length - segs.length + i])
  );
}

/** Resolution as Obsidian does it: notes first, assets only when no note answered, so a
 *  "diagram" note wins over a stray "diagram.png". Every question about where a link lands
 *  must be asked this way — asking one list alone once orphaned an attachment on a move. */
export function resolveLink(target: string, notes: VaultEntry[], assets: VaultEntry[]): VaultEntry[] {
  const hits = resolveTarget(target, notes);
  return hits.length > 0 ? hits : resolveTarget(target, assets);
}

/** Shortest suffix of `entry` that resolves to exactly `entry`. Falls back to the full
 *  path when even that is shadowed. */
export function shortestTarget(entry: VaultEntry, notes: VaultEntry[], assets: VaultEntry[]): string {
  for (let n = 1; n <= entry.segments.length; n++) {
    const candidate = entry.segments.slice(-n).join('/');
    const hits = resolveLink(candidate, notes, assets);
    if (hits.length === 1 && hits[0]?.path === entry.path) return candidate;
  }
  return entry.segments.join('/');
}

export interface LinkRef {
  /** Vault path of the note the link is written in. */
  from: string;
  /** Vault path of the entry it resolves to. */
  to: string;
  link: Wikilink;
}

export interface LinkGraph {
  outgoing(path: string): LinkRef[];
  backlinks(path: string): LinkRef[];
  broken: { from: string; link: Wikilink }[];
  ambiguous: { from: string; link: Wikilink; matches: string[] }[];
  /** Notes nothing links to, outside the buckets that owe nobody a link. */
  orphans: string[];
}

export function buildLinkGraph(vault: Vault): LinkGraph {
  const refs: LinkRef[] = [];
  const broken: LinkGraph['broken'] = [];
  const ambiguous: LinkGraph['ambiguous'] = [];

  for (const note of vault.notes) {
    for (const link of parseWikilinks(vault.read(note.path))) {
      const hits = resolveLink(link.target, vault.notes, vault.assets);
      if (hits.length === 1) refs.push({ from: note.path, to: hits[0]!.path, link });
      else if (hits.length > 1) ambiguous.push({ from: note.path, link, matches: hits.map((h) => h.path) });
      else broken.push({ from: note.path, link });
    }
  }

  // Keyed by resolved path, never by basename: with duplicates legal, a basename key would
  // credit one link to both notes carrying the name and hide an orphan behind the other.
  const byFrom = Map.groupBy(refs, (r) => r.from);
  const byTo = Map.groupBy(refs, (r) => r.to);

  // bucketOf reads through the archive, so an archived inbox note keeps the exemption.
  const orphans = vault.notes
    .filter((n) => !vault.config.unlinkedBuckets.includes(bucketOf(n.path, vault.config)))
    .filter((n) => !byTo.has(n.path))
    .map((n) => n.path);

  return {
    outgoing: (path) => byFrom.get(path) ?? [],
    backlinks: (path) => byTo.get(path) ?? [],
    broken,
    ambiguous,
    orphans,
  };
}
