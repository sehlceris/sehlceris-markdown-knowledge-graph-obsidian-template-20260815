// Move and rename, with every wikilink kept pointing where it already points.
//
// A link is rewritten only when it would otherwise stop resolving to the note it resolves
// to today. Foam instead canonicalizes every backlink, so a move that broke nothing still
// dirties every note that mentioned the moved one; here a move that changes no basename and
// creates no ambiguity produces zero edits.
//
// Two consequences. Every note is scanned, not just the inbound links — a move can create a
// basename collision that breaks some third note's bare link. And replacements are computed
// against the *future* entry list, so a moved note never competes with its own old path.
//
// Split into plan and apply: the plan is exactly what `--dry-run` prints and what the
// apply writes. This module plans and renders the text to write; the writing is
// move-fs.ts for the CLI and the Obsidian plugin's apply for the app. Nothing here imports
// Node, so both can use it.

import { setFrontmatterKey } from './frontmatter.ts';
import { resolveLink, shortestTarget } from './graph.ts';
import { entryOf, isInBuckets, normalizeVaultPath, type Vault, type VaultEntry } from './vault.ts';
import { parseWikilinks } from './wikilinks.ts';

export interface LinkEdit {
  /** The note being edited, at its path *before* the move — edits land first. */
  path: string;
  start: number;
  end: number;
  replacement: string;
  was: string;
}

export interface FrontmatterEdit {
  /** Path *after* the move: these are set once the file is in place. */
  path: string;
  key: string;
  value: string;
}

export interface MovePlan {
  /** For a directory move, the directory paths. */
  from: string;
  to: string;
  /** Every file the move touches; one entry for a file move. */
  files: { from: string; to: string }[];
  /** Wikilink rewrites, in file order and ascending by offset. */
  edits: LinkEdit[];
  frontmatter: FrontmatterEdit[];
  /** Reasons the plan cannot be applied. Non-empty means refused, and promises nothing. */
  conflicts: string[];
}

/** Every file the move touches: one for a file, every entry underneath for a directory. */
export function movedFiles(vault: Vault, from: string, to: string): { from: string; to: string }[] {
  const src = normalizeVaultPath(from);
  const dest = normalizeVaultPath(to);
  if (vault.byPath.has(src)) return [{ from: src, to: dest }];
  const prefix = `${src}/`;
  return vault.entries
    .filter((e) => e.path.startsWith(prefix))
    .map((e) => ({ from: e.path, to: `${dest}/${e.path.slice(prefix.length)}` }));
}

export function planMove(
  vault: Vault,
  from: string,
  to: string,
  frontmatter: FrontmatterEdit[] = []
): MovePlan {
  const src = normalizeVaultPath(from);
  const dest = normalizeVaultPath(to);
  const conflicts = refusals(vault, src, dest);
  if (conflicts.length) return refusedPlan(src, dest, conflicts);

  const files = movedFiles(vault, src, dest);
  return { from: src, to: dest, files, edits: computeEdits(vault, files), frontmatter, conflicts };
}

export function refusedPlan(from: string, to: string, conflicts: string[]): MovePlan {
  return { from, to, files: [], edits: [], frontmatter: [], conflicts };
}

function refusals(vault: Vault, from: string, to: string): string[] {
  if (!from || !to) return ['a source and a destination are both required'];
  if (from === to) return [`source and destination are the same: ${from}`];

  const out: string[] = [];
  if (!isInBuckets(from, vault.config)) out.push(`source is outside the vault buckets: ${from}`);
  if (!isInBuckets(to, vault.config)) out.push(`destination is outside the vault buckets: ${to}`);
  if (movedFiles(vault, from, to).length === 0) out.push(`no such note or directory: ${from}`);
  if (to.startsWith(`${from}/`)) out.push(`destination is inside the source: ${to}`);
  if (vault.occupied(to, from)) out.push(`destination already exists: ${to}`);
  return out;
}

function computeEdits(vault: Vault, files: { from: string; to: string }[]): LinkEdit[] {
  const moves = new Map(files.map((f) => [f.from, f.to]));
  const future = (list: VaultEntry[]) =>
    list.map((e) => {
      const to = moves.get(e.path);
      return to ? entryOf(to, e.isNote) : e;
    });
  const futureNotes = future(vault.notes);
  const futureAssets = future(vault.assets);

  const edits: LinkEdit[] = [];
  for (const note of vault.notes) {
    for (const link of parseWikilinks(vault.read(note.path))) {
      const now = resolveLink(link.target, vault.notes, vault.assets);
      // Already broken or ambiguous: not this move's business, and not healed by it.
      if (now.length !== 1) continue;
      const current = now[0]!;

      const destPath = moves.get(current.path) ?? current.path;
      const after = resolveLink(link.target, futureNotes, futureAssets);
      // Still lands on the same note: the author's chosen form is left alone.
      if (after.length === 1 && after[0]!.path === destPath) continue;

      edits.push({
        path: note.path,
        start: link.targetStart,
        end: link.targetEnd,
        replacement: shortestTarget(entryOf(destPath, current.isNote), futureNotes, futureAssets),
        was: link.target,
      });
    }
  }
  return edits;
}

/** One file's full new contents. `expected` is what the file holds when the write is due,
 *  so an apply that cannot hold a lock — Obsidian saves constantly — can refuse to splice
 *  offsets into a note that changed under it. */
export interface TextWrite {
  path: string;
  expected: string;
  text: string;
}

/** The plan as whole-file writes, in apply order: link rewrites land before the move, at
 *  the old paths; frontmatter lands after it, at the new ones, and only where a value
 *  actually changes. */
export function renderMove(vault: Vault, plan: MovePlan): { links: TextWrite[]; frontmatter: TextWrite[] } {
  const links: TextWrite[] = [];
  for (const [path, edits] of byPath(plan.edits)) {
    const expected = vault.read(path);
    let text = expected;
    // Last link first keeps every earlier offset valid.
    for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
      text = text.slice(0, edit.start) + edit.replacement + text.slice(edit.end);
    }
    links.push({ path, expected, text });
  }

  const linked = new Map(links.map((w) => [w.path, w.text]));
  const source = new Map(plan.files.map((f) => [f.to, f.from]));
  const frontmatter: TextWrite[] = [];
  for (const [path, sets] of byPath(plan.frontmatter)) {
    const from = source.get(path) ?? path;
    const expected = linked.get(from) ?? vault.read(from);
    let text = expected;
    for (const set of sets) text = setFrontmatterKey(text, set.key, set.value).text;
    if (text !== expected) frontmatter.push({ path, expected, text });
  }
  return { links, frontmatter };
}

/** Map.groupBy by hand: this runs in Obsidian's mobile WebView, where an iOS older than
 *  17.4 has no Map.groupBy, and a bundler lowers syntax but never polyfills a library call. */
function byPath<T extends { path: string }>(items: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) out.set(item.path, [...(out.get(item.path) ?? []), item]);
  return out;
}

/** Every verb used ends in "e", so the past tense is the verb plus "d". */
export function describeMove(plan: MovePlan, opts: { verb: string; dryRun: boolean }): string[] {
  const verb = opts.dryRun ? `would ${opts.verb}` : `${opts.verb}d`;
  const notes = new Set(plan.edits.map((e) => e.path)).size;
  const detail = [
    plan.files.length === 1 ? null : count(plan.files.length, 'file'),
    plan.edits.length === 0
      ? 'no links needed rewriting'
      : `${opts.dryRun ? 'would rewrite' : 'rewrote'} ${count(plan.edits.length, 'link')} in ${count(notes, 'note')}`,
  ].filter((s) => s !== null);

  return [
    `${verb} ${plan.from} -> ${plan.to} (${detail.join(', ')})`,
    ...plan.edits.map((e) => `  ${e.path}: ${e.was} -> ${e.replacement}`),
    ...plan.frontmatter.map((f) => `  ${opts.dryRun ? 'would set' : 'set'} ${f.key}: ${f.value} in ${f.path}`),
  ];
}

export const count = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
