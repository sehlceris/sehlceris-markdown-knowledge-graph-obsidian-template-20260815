// Read-only questions about links. A note argument is a vault path or a bare wikilink
// target — the same query, since a wikilink is a path suffix.

import { type Command, type CommandResult, UsageError } from '../cli.ts';
import { buildLinkGraph, resolveLink, resolveTarget } from '../lib/graph.ts';
import type { Vault } from '../lib/vault.ts';
import { loadVault } from '../lib/vault-fs.ts';

/** The one note `arg` names, or the failed result to return instead of guessing. */
function findNote(vault: Vault, arg: string | undefined): { path: string } | { fail: CommandResult } {
  if (!arg) throw new UsageError('needs a note');
  const hits = resolveTarget(arg, vault.notes).map((h) => h.path);
  if (hits.length === 1) return { path: hits[0]! };
  const human =
    hits.length === 0
      ? [`no note matches "${arg}"`]
      : [`"${arg}" matches ${hits.length} notes — ${hits.join(', ')}`, 'Lengthen it to the shortest path that names one.'];
  return { fail: { ok: false, human, json: { note: null, matches: hits } } };
}

export const resolve: Command = {
  name: 'resolve',
  args: '<target>',
  summary: 'where a [[link]] would land, if anywhere — run before writing one',
  run(ctx) {
    const target = ctx.positionals[0];
    if (!target) throw new UsageError('needs a target');
    const vault = loadVault(ctx.baseDir);
    const matches = resolveLink(target, vault.notes, vault.assets).map((h) => h.path);
    const json = { target, ok: matches.length === 1, matches };
    if (matches.length === 1) return { ok: true, human: [`ok — [[${target}]] resolves to ${matches[0]}`], json };
    if (matches.length === 0) return { ok: false, human: [`[[${target}]] points at nothing`], json };
    return {
      ok: false,
      human: [`[[${target}]] matches ${matches.length} notes — ${matches.join(', ')}`, 'Lengthen it to the shortest path that names one.'],
      json,
    };
  },
};

export const backlinks: Command = {
  name: 'backlinks',
  args: '<note>',
  summary: 'every note that links to this one',
  run(ctx) {
    const vault = loadVault(ctx.baseDir);
    const found = findNote(vault, ctx.positionals[0]);
    if ('fail' in found) return found.fail;

    const refs = buildLinkGraph(vault)
      .backlinks(found.path)
      .map((r) => ({ from: r.from, link: r.link.raw }));
    const human = refs.length
      ? [`${refs.length} link(s) to ${found.path}:`, ...refs.map((r) => `  ${r.from}: ${r.link}`)]
      : [`nothing links to ${found.path}`];
    return { ok: true, human, json: { note: found.path, backlinks: refs } };
  },
};

export const links: Command = {
  name: 'links',
  args: '<note>',
  summary: "a note's outgoing links in document order, and how each resolves",
  run(ctx) {
    const vault = loadVault(ctx.baseDir);
    const found = findNote(vault, ctx.positionals[0]);
    if ('fail' in found) return found.fail;
    const note = found.path;
    const graph = buildLinkGraph(vault);

    const rows = [
      ...graph.outgoing(note).map((r) => ({ link: r.link, status: 'resolved', matches: [r.to] })),
      ...graph.broken.filter((b) => b.from === note).map((b) => ({ link: b.link, status: 'broken', matches: [] as string[] })),
      ...graph.ambiguous.filter((a) => a.from === note).map((a) => ({ link: a.link, status: 'ambiguous', matches: a.matches })),
    ]
      .sort((x, y) => x.link.start - y.link.start)
      .map(({ link, status, matches }) => ({ target: link.target, raw: link.raw, status, matches }));

    const describe = (r: (typeof rows)[number]): string =>
      r.status === 'resolved'
        ? `  ${r.raw} -> ${r.matches[0]}`
        : r.status === 'broken'
          ? `  ${r.raw} -> broken, points at nothing`
          : `  ${r.raw} -> ambiguous, matches ${r.matches.join(', ')}`;

    const human = rows.length ? [`${note} links to ${rows.length} target(s):`, ...rows.map(describe)] : [`${note} links to nothing`];
    return { ok: true, human, json: { note, links: rows } };
  },
};
