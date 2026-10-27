// Every command that relocates a file. Use these instead of `mv`, which moves the bytes and
// leaves every inbound wikilink to rot.

import { type Command, type Context, UsageError } from '../cli.ts';
import { archiveAll } from '../lib/archive.ts';
import { executeMove, planMove, resolveVaultPathInput } from '../lib/move.ts';
import { loadVault } from '../lib/vault.ts';

export const move: Command = {
  name: 'move',
  args: '<from> <to>',
  summary: 'move a note, attachment or folder, maintaining inbound links',
  run(ctx) {
    const [from, to, ...extra] = ctx.positionals;
    if (!from || !to || extra.length) throw new UsageError('expected <from> and <to>');
    const vault = loadVault(ctx.baseDir);
    const plan = planMove(vault, resolveVaultPathInput(vault, from, ctx.cwd), resolveVaultPathInput(vault, to, ctx.cwd));
    const outcome = executeMove(vault, plan, { verb: 'move', dryRun: ctx.dryRun });
    return { ok: outcome.ok, human: outcome.human, json: outcome.plan };
  },
};

export const rename: Command = {
  name: 'rename',
  args: '<path> <new-name>',
  summary: 'same directory, new basename — the move that always breaks links by hand',
  run(ctx) {
    const [path, name, ...extra] = ctx.positionals;
    if (!path || !name || extra.length) throw new UsageError('expected <path> and <new-name>');
    if (name.includes('/')) throw new UsageError('a new name is a bare filename — use move to change directory');
    const vault = loadVault(ctx.baseDir);
    const from = resolveVaultPathInput(vault, path, ctx.cwd);
    // "deck" and "deck.md" are the same request for a note; an attachment keeps what was typed.
    const file = from.endsWith('.md') && !name.endsWith('.md') ? `${name}.md` : name;
    const dir = from.includes('/') ? from.slice(0, from.lastIndexOf('/') + 1) : '';
    const outcome = executeMove(vault, planMove(vault, from, dir + file), { verb: 'rename', dryRun: ctx.dryRun });
    return { ok: outcome.ok, human: outcome.human, json: outcome.plan };
  },
};

function archiveCommand(unarchive: boolean): Command {
  return {
    name: unarchive ? 'unarchive' : 'archive',
    args: '<path...>',
    summary: unarchive
      ? 'move back out of 08-archive/, bumping updated:'
      : 'move into 08-archive/<same-bucket>/, bumping updated: and status: done',
    flags: { 'no-frontmatter': { type: 'boolean', description: 'leave updated: and status: alone' } },
    run(ctx: Context) {
      if (!ctx.positionals.length) throw new UsageError('expected at least one <path>');
      const result = archiveAll(ctx.baseDir, ctx.positionals, {
        unarchive,
        frontmatter: ctx.flags['no-frontmatter'] !== true,
        dryRun: ctx.dryRun,
        cwd: ctx.cwd,
      });
      return { ok: result.ok, human: result.human, json: result.plans };
    },
  };
}

export const archive = archiveCommand(false);
export const unarchive = archiveCommand(true);
