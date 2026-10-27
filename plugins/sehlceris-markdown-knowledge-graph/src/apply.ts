// Archiving from inside Obsidian. The plan is the CLI's — scripts/lib plans it and renders
// every byte to write — so this file only decides the order of writes and talks to the app
// through VaultIO, which keeps it testable without Obsidian.
//
// The CLI writes to files nobody has open. Here the user may be typing in the very note
// being archived, so every write checks that the file still holds what the plan read, and
// refuses rather than splice offsets into text that moved under it.

import { type ArchiveOptions, planArchive, planUnarchive } from '../../../scripts/lib/archive.ts';
import { describeMove, type MovePlan, renderMove, type TextWrite } from '../../../scripts/lib/move.ts';
import { DEFAULT_CONFIG, isArchived, isInBuckets, normalizeVaultPath, type Vault } from '../../../scripts/lib/vault.ts';

/** The app, narrowed to what an archive needs. Paths are vault paths. */
export interface VaultIO {
  /** Current contents, read past any cache. */
  read(path: string): Promise<string>;
  /** Read, transform and write as one step; `fn` throwing leaves the file alone. */
  process(path: string, fn: (text: string) => string): Promise<void>;
  /** Anything at all at `path`, in any case — including what the index never lists. */
  exists(path: string): Promise<boolean>;
  rename(from: string, to: string): Promise<void>;
  createFolder(path: string): Promise<void>;
  /** Removes the folder only when nothing at all is in it, hidden files included. */
  removeEmptyFolder(path: string): Promise<boolean>;
}

export type Verb = 'archive' | 'unarchive';

/** Which menu item a selection gets: one verb for all of it, or none. A bucket itself is
 *  never offered — the plan would refuse it anyway. */
export function verbFor(paths: string[], config = DEFAULT_CONFIG): Verb | null {
  const filed = paths.map(normalizeVaultPath).filter((p) => isInBuckets(p, config) && !config.buckets.includes(p));
  if (filed.length === 0 || filed.length !== paths.length) return null;
  if (filed.every((p) => isArchived(p, config))) return 'unarchive';
  if (filed.every((p) => !isArchived(p, config))) return 'archive';
  return null;
}

export function planFor(verb: Verb, vault: Vault, path: string, opts: ArchiveOptions = {}): MovePlan {
  return verb === 'archive' ? planArchive(vault, path, opts) : planUnarchive(vault, path, opts);
}

export interface Applied {
  ok: boolean;
  /** Notes whose links were spliced. */
  edited: string[];
  moved: { from: string; to: string }[];
  /** Notes whose frontmatter actually changed. */
  frontmatter: string[];
  removedDirs: string[];
  /** Why it stopped and what had already been written. Empty when ok. */
  errors: string[];
}

/** The same order as the CLI's applyMove: links at the old paths, the move, frontmatter at
 *  the new paths, then folders the move emptied. */
export async function applyPlan(vault: Vault, plan: MovePlan, io: VaultIO): Promise<Applied> {
  const result: Applied = { ok: true, edited: [], moved: [], frontmatter: [], removedDirs: [], errors: [] };
  if (plan.conflicts.length) return { ...result, ok: false, errors: [...plan.conflicts] };

  // The index can miss what is on disk — a file still arriving from iCloud, a hidden one.
  // A merge expects its folder to exist, so each file's landing spot is checked instead.
  const targets = plan.merge ? plan.files.map((f) => f.to) : [plan.to];
  const taken: string[] = [];
  for (const target of targets) if (await io.exists(target)) taken.push(`destination already exists: ${target}`);
  if (taken.length) return { ...result, ok: false, errors: taken };

  const writes = renderMove(vault, plan);
  // Every file the writes were rendered from, read fresh before anything is written: a
  // refusal here costs nothing and a retry plans against the new text.
  const sources = new Set([...writes.links.map((w) => w.path), ...writes.frontmatter.map((w) => sourceOf(plan, w.path))]);
  for (const path of sources) {
    if ((await io.read(path)) !== vault.read(path)) {
      return { ...result, ok: false, errors: [`${path} changed while the archive was planned; nothing was written — try again`] };
    }
  }

  try {
    for (const w of writes.links) {
      await io.process(w.path, splice(w));
      result.edited.push(w.path);
    }
    for (const file of plan.files) {
      await ensureFolder(io, parentOf(file.to));
      await io.rename(file.from, file.to);
      result.moved.push(file);
    }
    for (const w of writes.frontmatter) {
      await io.process(w.path, splice(w));
      result.frontmatter.push(w.path);
    }
    await pruneEmptyFolders(vault, plan, io, result);
  } catch (err) {
    return halted(result, plan, err);
  }
  return result;
}

export interface BatchResult {
  ok: boolean;
  lines: string[];
  plans: MovePlan[];
}

/** Several paths in one go, each planned against a freshly loaded vault because the one
 *  before it changed the index. A refusal stops the run; the earlier paths already moved. */
export async function archivePaths(
  verb: Verb,
  paths: string[],
  load: () => Promise<Vault>,
  io: VaultIO,
  opts: ArchiveOptions = {}
): Promise<BatchResult> {
  const lines: string[] = [];
  const plans: MovePlan[] = [];
  for (const path of paths) {
    const vault = await load();
    const plan = planFor(verb, vault, path, opts);
    plans.push(plan);
    const applied = await applyPlan(vault, plan, io);
    if (!applied.ok) {
      lines.push(...(plan.conflicts.length ? plan.conflicts.map((c) => `refused: ${c}`) : applied.errors));
      return { ok: false, lines, plans };
    }
    lines.push(...describeMove(plan, { verb, dryRun: false }));
  }
  return { ok: true, lines, plans };
}

/** What the run would do, every path planned against the same vault — the CLI's --dry-run. */
export function preview(verb: Verb, vault: Vault, paths: string[], opts: ArchiveOptions = {}): { ok: boolean; lines: string[] } {
  const lines: string[] = [];
  let ok = true;
  for (const path of paths) {
    const plan = planFor(verb, vault, path, opts);
    if (plan.conflicts.length) {
      ok = false;
      lines.push(...plan.conflicts.map((c) => `refused: ${c}`));
    } else {
      lines.push(...describeMove(plan, { verb, dryRun: true }));
    }
  }
  return { ok, lines };
}

function splice(w: TextWrite): (text: string) => string {
  return (text) => {
    if (text !== w.expected) throw new Error(`${w.path} changed while it was being archived`);
    return w.text;
  };
}

function sourceOf(plan: MovePlan, to: string): string {
  return plan.files.find((f) => f.to === to)?.from ?? to;
}

const parentOf = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

async function ensureFolder(io: VaultIO, path: string): Promise<void> {
  let prefix = '';
  for (const segment of path.split('/').filter(Boolean)) {
    prefix = prefix ? `${prefix}/${segment}` : segment;
    if (!(await io.exists(prefix))) await io.createFolder(prefix);
  }
}

/** A folder the move emptied is removed, up to but never including a bucket root. */
async function pruneEmptyFolders(vault: Vault, plan: MovePlan, io: VaultIO, result: Applied): Promise<void> {
  for (const start of new Set(plan.files.map((f) => parentOf(f.from)))) {
    let dir = start;
    while (dir && !vault.config.buckets.includes(dir)) {
      if (!(await io.removeEmptyFolder(dir))) break;
      result.removedDirs.push(dir);
      dir = parentOf(dir);
    }
  }
}

/** Everything already written when a step threw, which is what the user has to put back. */
function halted(result: Applied, plan: MovePlan, err: unknown): Applied {
  const errors = [err instanceof Error ? err.message : String(err)];
  if (result.edited.length) errors.push(`links were already rewritten in: ${result.edited.join(', ')}`);
  if (result.moved.length) {
    errors.push(`files were already moved: ${result.moved.map((m) => `${m.from} -> ${m.to}`).join(', ')}`);
  }
  if (result.frontmatter.length) errors.push(`frontmatter was already set in: ${result.frontmatter.join(', ')}`);
  errors.push(
    result.moved.length === 0
      ? 'nothing was moved: try again'
      : `${result.moved.length} of ${plan.files.length} files are already at the destination; finish the rest by hand`
  );
  return { ...result, ok: false, errors };
}
