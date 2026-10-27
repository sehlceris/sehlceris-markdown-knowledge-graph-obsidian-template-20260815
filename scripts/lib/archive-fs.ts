// Archiving from the command line: several paths in one run, each applied to disk.

import { type ArchiveOptions, planArchive, planUnarchive } from './archive.ts';
import { executeMove, resolveVaultPathInput } from './move-fs.ts';
import type { MovePlan } from './move.ts';
import { loadVault } from './vault-fs.ts';

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
