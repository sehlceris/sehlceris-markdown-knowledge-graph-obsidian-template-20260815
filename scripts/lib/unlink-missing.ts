// Replaces every wikilink that resolves to nothing with the text it displays, so a dead link
// stops failing check-links without inventing the note it named. `[[target]]` and
// `[[target#heading]]` become `target`; `[[target|display]]` becomes `display`.
//
// "Missing" is exactly what check-links calls broken. An ambiguous link names notes that
// exist and is left for a human to lengthen. A missing embed is reported but kept:
// `![[photo.png]]` may be an attachment still on its way in, and a file name is not prose.

import { writeFileSync } from 'node:fs';

import { buildLinkGraph } from './graph.ts';
import { count } from './move.ts';
import type { Vault } from './vault.ts';

export interface UnlinkEdit {
  path: string;
  start: number;
  end: number;
  /** The whole link as written. */
  was: string;
  replacement: string;
}

export interface UnlinkMissingPlan {
  edits: UnlinkEdit[];
  /** Embeds of files that do not exist; never edited. */
  embeds: { path: string; raw: string }[];
}

export function planUnlinkMissing(vault: Vault): UnlinkMissingPlan {
  const plan: UnlinkMissingPlan = { edits: [], embeds: [] };
  for (const { from, link } of buildLinkGraph(vault).broken) {
    if (link.isEmbed) plan.embeds.push({ path: from, raw: link.raw });
    else {
      plan.edits.push({
        path: from,
        start: link.start,
        end: link.end,
        was: link.raw,
        replacement: link.display ?? link.target,
      });
    }
  }
  return plan;
}

/** A note edited between plan and apply — Obsidian saves constantly — is skipped whole
 *  rather than spliced at offsets that no longer hold the links the plan saw. */
export function applyUnlinkMissing(vault: Vault, plan: UnlinkMissingPlan): { edited: string[]; errors: string[] } {
  const edited: string[] = [];
  const errors: string[] = [];
  for (const [path, edits] of Map.groupBy(plan.edits, (e) => e.path)) {
    let text = vault.read(path);
    if (edits.some((e) => text.slice(e.start, e.end) !== e.was)) {
      errors.push(`${path} changed since the plan was made; left alone — run it again`);
      continue;
    }
    for (const edit of edits.toSorted((a, b) => b.start - a.start)) {
      text = text.slice(0, edit.start) + edit.replacement + text.slice(edit.end);
    }
    try {
      writeFileSync(vault.absolute(path), text);
      edited.push(path);
    } catch (err) {
      errors.push(`could not write ${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { edited, errors };
}

export function executeUnlinkMissing(vault: Vault, opts: { dryRun: boolean }) {
  const plan = planUnlinkMissing(vault);
  const applied = opts.dryRun ? null : applyUnlinkMissing(vault, plan);
  const done = applied ? plan.edits.filter((e) => applied.edited.includes(e.path)) : plan.edits;
  const notes = new Set(done.map((e) => e.path)).size;

  const human = [
    ...(opts.dryRun ? ['dry run — nothing written'] : []),
    ...done.map((e) => `${e.path}: ${e.was} -> ${e.replacement}`),
    ...(plan.embeds.length
      ? [`${count(plan.embeds.length, 'missing embed')} left in place:`, ...plan.embeds.map((e) => `  ${e.path}: ${e.raw}`)]
      : []),
    ...(applied?.errors ?? []),
    done.length === 0
      ? 'no missing links to unlink'
      : `${opts.dryRun ? 'would unlink' : 'unlinked'} ${count(done.length, 'link')} in ${count(notes, 'note')}`,
  ];
  return { ok: (applied?.errors.length ?? 0) === 0, human, plan, applied };
}
