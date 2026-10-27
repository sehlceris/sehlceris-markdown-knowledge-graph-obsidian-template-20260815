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
// apply writes.

import { existsSync, mkdirSync, readdirSync, realpathSync, renameSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

import { setFrontmatterKey } from './frontmatter.ts';
import { resolveLink, shortestTarget } from './graph.ts';
import { entryOf, isContained, isInBuckets, normalizeVaultPath, toVaultPath, type Vault, type VaultEntry } from './vault.ts';
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
  // existsSync, not the index: a destination the walk skipped would still be overwritten.
  // But on a case-insensitive filesystem existsSync says yes for the source itself, so
  // `Note.md` -> `note.md` is checked for file identity first, the way `git mv` does.
  if (
    isContained(vault.baseDir, from) &&
    isContained(vault.baseDir, to) &&
    existsSync(vault.absolute(to)) &&
    !isSameFile(vault.absolute(from), vault.absolute(to))
  ) {
    out.push(`destination already exists: ${to}`);
  }
  return out;
}

/** Device plus inode — true for `Note.md` and `note.md` on a case-insensitive filesystem,
 *  which realpath does not reveal. */
function isSameFile(a: string, b: string): boolean {
  try {
    const x = statSync(a);
    const y = statSync(b);
    return x.dev === y.dev && x.ino === y.ino;
  } catch {
    return false;
  }
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

export interface AppliedMove {
  ok: boolean;
  /** Notes whose links were spliced. */
  edited: string[];
  moved: { from: string; to: string }[];
  /** Notes whose frontmatter actually changed. */
  frontmatter: string[];
  /** Directories removed because the move emptied them. */
  removedDirs: string[];
  /** Why it stopped, what had already been written, and how to recover. Empty when ok. */
  errors: string[];
}

export function applyMove(vault: Vault, plan: MovePlan): AppliedMove {
  const result: AppliedMove = { ok: true, edited: [], moved: [], frontmatter: [], removedDirs: [], errors: [] };
  if (plan.conflicts.length) return { ...result, ok: false, errors: [...plan.conflicts] };

  // One guard over every write: a throw halfway must still report what already landed.
  try {
    // Edits before the move, so a link inside a moving file is spliced while it is still at
    // the offsets the plan recorded. Last link first keeps every earlier offset valid.
    for (const [path, edits] of Map.groupBy(plan.edits, (e) => e.path)) {
      let text = vault.read(path);
      for (const edit of edits.toSorted((a, b) => b.start - a.start)) {
        text = text.slice(0, edit.start) + edit.replacement + text.slice(edit.end);
      }
      step(`could not rewrite links in ${path}`, () => writeFileSync(vault.absolute(path), text));
      result.edited.push(path);
    }

    moveFiles(vault, plan, result);

    for (const [path, sets] of Map.groupBy(plan.frontmatter, (f) => f.path)) {
      let text = vault.read(path);
      let changed = false;
      for (const set of sets) {
        const next = setFrontmatterKey(text, set.key, set.value);
        text = next.text;
        changed ||= next.changed;
      }
      if (!changed) continue;
      step(`could not set frontmatter in ${path}`, () => writeFileSync(vault.absolute(path), text));
      result.frontmatter.push(path);
    }

    pruneEmptyDirs(vault, plan, result);
  } catch (err) {
    return halted(result, plan, err);
  }
  return result;
}

/** A case-only rename on a case-insensitive filesystem goes through a temporary name in one
 *  step, which is what `git mv` does; a plain rename there is a no-op for a directory. */
function moveFiles(vault: Vault, plan: MovePlan, result: AppliedMove): void {
  const fromAbs = vault.absolute(plan.from);
  const toAbs = vault.absolute(plan.to);

  if (plan.files.length > 0 && isSameFile(fromAbs, toAbs)) {
    step(`could not rename ${plan.from} -> ${plan.to}`, () => {
      const temp = join(dirname(toAbs), `.kg-rename-${process.pid}-${Date.now()}`);
      renameSync(fromAbs, temp);
      try {
        renameSync(temp, toAbs);
      } catch (err) {
        renameSync(temp, fromAbs);
        throw err;
      }
    });
    result.moved.push(...plan.files);
    return;
  }

  for (const file of plan.files) {
    step(`could not move ${file.from} -> ${file.to}`, () => {
      mkdirSync(dirname(vault.absolute(file.to)), { recursive: true });
      renameSync(vault.absolute(file.from), vault.absolute(file.to));
    });
    result.moved.push(file);
  }
}

/** A directory the move emptied is removed, up to but never including a bucket root. */
function pruneEmptyDirs(vault: Vault, plan: MovePlan, result: AppliedMove): void {
  for (const start of new Set(plan.files.map((f) => dirname(f.from)))) {
    let dir = start;
    while (dir && dir !== '.' && !vault.config.buckets.includes(dir)) {
      const abs = vault.absolute(dir);
      if (!existsSync(abs) || readdirSync(abs).length > 0) break;
      step(`could not remove the emptied directory ${dir}`, () => rmdirSync(abs));
      result.removedDirs.push(dir);
      dir = dirname(dir);
    }
  }
}

function step(what: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    throw new Error(`${what}: ${message(err)}`);
  }
}

/** Everything already written when a step threw, then how to repair it. With nothing moved,
 *  the rewritten links read as already-broken to the next plan, which declines to touch them,
 *  so re-running the same command completes the move cleanly. Once files have moved, the
 *  same command will refuse, and the rest is a manual job — say which. */
function halted(result: AppliedMove, plan: MovePlan, err: unknown): AppliedMove {
  const errors = [message(err)];
  if (result.edited.length) errors.push(`links were already rewritten in: ${result.edited.join(', ')}`);
  if (result.moved.length) {
    errors.push(`files were already moved: ${result.moved.map((m) => `${m.from} -> ${m.to}`).join(', ')}`);
  }
  if (result.frontmatter.length) errors.push(`frontmatter was already set in: ${result.frontmatter.join(', ')}`);
  if (result.removedDirs.length) errors.push(`directories were already removed: ${result.removedDirs.join(', ')}`);
  errors.push(
    result.moved.length === 0
      ? 'nothing was moved: fix the cause and run the identical command again'
      : `${result.moved.length} of ${plan.files.length} files are already at the destination, so the` +
          ' same command will now refuse; finish the remaining steps by hand'
  );
  return { ...result, ok: false, errors };
}

export interface MoveOutcome {
  ok: boolean;
  /** Lines to print. Nothing in lib/ writes to a stream. */
  human: string[];
  plan: MovePlan;
}

/** Plan in, outcome out: refuse, describe a dry run, or apply and describe. The commands
 *  differ only in how they compute the destination; everything after is this. */
export function executeMove(vault: Vault, plan: MovePlan, opts: { verb: string; dryRun: boolean }): MoveOutcome {
  if (plan.conflicts.length) return { ok: false, human: plan.conflicts.map((c) => `refused: ${c}`), plan };
  if (opts.dryRun) return { ok: true, human: ['dry run — nothing written', ...describeMove(plan, opts)], plan };
  const applied = applyMove(vault, plan);
  return { ok: applied.ok, human: applied.ok ? describeMove(plan, opts) : applied.errors, plan };
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

/** A path typed at the command line may be vault-relative (`03-initiatives/x.md`, from
 *  anywhere) or cwd-relative (`x.md`, standing in `03-initiatives/`). One that names a bucket
 *  or already exists under the root is vault-relative; anything else is read against cwd. */
export function resolveVaultPathInput(vault: Vault, input: string, cwd: string): string {
  const normalized = normalizeVaultPath(input);
  if (
    !isAbsolute(input) &&
    (isInBuckets(normalized, vault.config) ||
      (isContained(vault.baseDir, normalized) && existsSync(vault.absolute(normalized))))
  ) {
    return normalized;
  }

  // Both sides through realpath, or a vault reached by a symlink (all of macOS's /tmp)
  // relativizes to "../" and is refused. The leaf stays as typed: a destination does not
  // exist yet.
  const abs = isAbsolute(input) ? input : resolve(cwd, input);
  const parent = dirname(abs);
  return toVaultPath(
    realpathSync(vault.baseDir),
    existsSync(parent) ? join(realpathSync(parent), basename(abs)) : abs
  );
}

export const count = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));
