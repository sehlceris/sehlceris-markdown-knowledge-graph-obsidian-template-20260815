// Archiving is a move into 08-archive/ plus two frontmatter bumps: `updated` to today, and
// `status: done` only where a status exists — never invent the key. Unarchiving is the same
// move backwards and bumps `updated` only: nothing knows what the status was before, and
// guessing `active` would be inventing a fact.

import { readFrontmatter } from './frontmatter.ts';
import { executeMove, type FrontmatterEdit, movedFiles, type MovePlan, planMove, refusedPlan, resolveVaultPathInput } from './move.ts';
import {
  archivePathFor,
  bucketOf,
  isArchived,
  loadVault,
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
  const to = archivePathFor(from, vault.config);
  return planMove(vault, from, to, bumps(vault, from, to, opts, true));
}

export function planUnarchive(vault: Vault, path: string, opts: ArchiveOptions = {}): MovePlan {
  const from = normalizeVaultPath(path);
  if (!isArchived(from, vault.config)) return refusedPlan(from, from, [`not archived: ${from}`]);
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

export interface BatchResult {
  ok: boolean;
  human: string[];
  plans: MovePlan[];
}

/** Several paths at once, each planned against a freshly loaded vault because the one
 *  before it changed the index. A refusal stops the run; the earlier paths already moved.
 *  Under --dry-run nothing moves, so every path is planned against the same vault. */
export function archiveAll(
  baseDir: string,
  paths: string[],
  opts: ArchiveOptions & { dryRun?: boolean; cwd?: string; unarchive?: boolean } = {}
): BatchResult {
  const plan = opts.unarchive ? planUnarchive : planArchive;
  const verb = opts.unarchive ? 'unarchive' : 'archive';
  const human: string[] = [];
  const plans: MovePlan[] = [];

  for (const input of paths) {
    const vault = loadVault(baseDir);
    const path = resolveVaultPathInput(vault, input, opts.cwd ?? baseDir);
    const outcome = executeMove(vault, plan(vault, path, opts), { verb, dryRun: opts.dryRun === true });
    plans.push(outcome.plan);
    human.push(...outcome.human);
    if (!outcome.ok) return { ok: false, human, plans };
  }
  return { ok: true, human, plans };
}

/** Local date, not UTC: the vault's dates are the day the user is having. */
export function isoDate(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
