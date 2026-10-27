// Archiving is a move into 08-archive/ plus two frontmatter bumps: `updated` to today, and
// `status: done` only where a status exists — never invent the key. Unarchiving is the same
// move backwards and bumps `updated` only: nothing knows what the status was before, and
// guessing `active` would be inventing a fact.
//
// Planning only, and no Node: the CLI applies these plans through archive-fs.ts, the
// Obsidian plugin through its own apply.

import { readFrontmatter } from './frontmatter.ts';
import { type FrontmatterEdit, movedFiles, type MovePlan, planMove, refusedPlan } from './move.ts';
import {
  archivePathFor,
  bucketOf,
  isArchived,
  normalizeVaultPath,
  unarchivePathFor,
  type Vault,
} from './vault.ts';

export interface ArchiveOptions {
  /** Set to false to leave `updated:` and `status:` alone. */
  frontmatter?: boolean;
  /** Injected so a test is not at the mercy of the clock. */
  today?: Date;
}

export function planArchive(vault: Vault, path: string, opts: ArchiveOptions = {}): MovePlan {
  const from = normalizeVaultPath(path);
  if (isArchived(from, vault.config)) return refusedPlan(from, from, [`already archived: ${from}`]);
  if (isBucketRoot(vault, from)) return refusedPlan(from, from, [`a bucket is not archived whole: ${from}`]);
  const to = archivePathFor(from, vault.config);
  return planMove(vault, from, to, bumps(vault, from, to, opts, true));
}

export function planUnarchive(vault: Vault, path: string, opts: ArchiveOptions = {}): MovePlan {
  const from = normalizeVaultPath(path);
  if (!isArchived(from, vault.config)) return refusedPlan(from, from, [`not archived: ${from}`]);
  if (isBucketRoot(vault, unarchivePathFor(from, vault.config))) {
    return refusedPlan(from, from, [`a bucket is not unarchived whole: ${from}`]);
  }
  const to = unarchivePathFor(from, vault.config);
  return planMove(vault, from, to, bumps(vault, from, to, opts, false));
}

function bumps(vault: Vault, from: string, to: string, opts: ArchiveOptions, setStatus: boolean): FrontmatterEdit[] {
  if (opts.frontmatter === false) return [];
  const today = isoDate(opts.today ?? new Date());
  const out: FrontmatterEdit[] = [];
  for (const file of movedFiles(vault, from, to)) {
    if (!vault.byPath.get(file.from)?.isNote) continue;
    const fm = readFrontmatter(vault.read(file.from));
    if (fm.get('updated') !== null) out.push({ path: file.to, key: 'updated', value: today });
    if (
      setStatus &&
      fm.get('status') !== null &&
      vault.config.statusBuckets.includes(bucketOf(file.to, vault.config))
    ) {
      out.push({ path: file.to, key: 'status', value: 'done' });
    }
  }
  return out;
}

/** `03-initiatives` itself, as opposed to something filed in it. */
function isBucketRoot(vault: Vault, path: string): boolean {
  return vault.config.buckets.includes(path);
}

/** Local date, not UTC: the vault's dates are the day the user is having. */
export function isoDate(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
