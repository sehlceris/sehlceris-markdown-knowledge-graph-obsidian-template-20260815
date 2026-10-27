// Applying a move plan to disk: the CLI's half of move.ts. Everything here needs Node, so
// nothing the Obsidian plugin bundles may import it.

import { existsSync, mkdirSync, readdirSync, realpathSync, renameSync, rmdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

import { describeMove, type MovePlan, renderMove } from './move.ts';
import { isInBuckets, normalizeVaultPath } from './vault.ts';
import { type DiskVault, isContained, isSameFile, toVaultPath } from './vault-fs.ts';

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

export function applyMove(vault: DiskVault, plan: MovePlan): AppliedMove {
  const result: AppliedMove = { ok: true, edited: [], moved: [], frontmatter: [], removedDirs: [], errors: [] };
  if (plan.conflicts.length) return { ...result, ok: false, errors: [...plan.conflicts] };

  // One guard over every write: a throw halfway must still report what already landed.
  try {
    const writes = renderMove(vault, plan);
    // Edits before the move, so a link inside a moving file is spliced while it is still at
    // the offsets the plan recorded.
    for (const { path, text } of writes.links) {
      step(`could not rewrite links in ${path}`, () => writeFileSync(vault.absolute(path), text));
      result.edited.push(path);
    }

    moveFiles(vault, plan, result);

    for (const { path, text } of writes.frontmatter) {
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
function moveFiles(vault: DiskVault, plan: MovePlan, result: AppliedMove): void {
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
function pruneEmptyDirs(vault: DiskVault, plan: MovePlan, result: AppliedMove): void {
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
export function executeMove(vault: DiskVault, plan: MovePlan, opts: { verb: string; dryRun: boolean }): MoveOutcome {
  if (plan.conflicts.length) return { ok: false, human: plan.conflicts.map((c) => `refused: ${c}`), plan };
  if (opts.dryRun) return { ok: true, human: ['dry run — nothing written', ...describeMove(plan, opts)], plan };
  const applied = applyMove(vault, plan);
  return { ok: applied.ok, human: applied.ok ? describeMove(plan, opts) : applied.errors, plan };
}

/** A path typed at the command line may be vault-relative (`03-initiatives/x.md`, from
 *  anywhere) or cwd-relative (`x.md`, standing in `03-initiatives/`). One that names a bucket
 *  or already exists under the root is vault-relative; anything else is read against cwd. */
export function resolveVaultPathInput(vault: DiskVault, input: string, cwd: string): string {
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

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));
