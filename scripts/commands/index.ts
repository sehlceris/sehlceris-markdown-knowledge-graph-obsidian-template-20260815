// The command registry. Adding a command is a `Command` object and a line here.

import type { Command } from '../cli.ts';
import { check, checkFrontmatterCommand, checkLinksCommand, unlinkMissing } from './checks.ts';
import { archive, move, rename, unarchive } from './moves.ts';
import { backlinks, links, resolve } from './queries.ts';
import { tagAdd, tagList } from './tags.ts';

export const COMMANDS: Command[] = [
  check,
  checkLinksCommand,
  checkFrontmatterCommand,
  unlinkMissing,
  resolve,
  backlinks,
  links,
  move,
  rename,
  archive,
  unarchive,
  tagList,
  tagAdd,
];

/** The command named by the leading words of argv: "tag add x" is `tag add`. */
export function findCommand(argv: string[]): { command: Command; rest: string[] } | null {
  for (const words of [2, 1]) {
    const name = argv.slice(0, words).join(' ');
    const command = COMMANDS.find((c) => c.name === name);
    if (command) return { command, rest: argv.slice(words) };
  }
  return null;
}

export function usage(): string {
  const label = (c: Command) => `${c.name} ${c.args}`.trim();
  const width = Math.max(...COMMANDS.map((c) => label(c).length));
  return [
    'usage: node scripts/kg.ts <command> [args] [flags]',
    '',
    ...COMMANDS.map((c) => `  ${label(c).padEnd(width)}  ${c.summary}`),
    '',
    'The vault is the folder scripts/ sits in, or --base <dir>. Every command takes --json;',
    "mutating ones take --dry-run. `<command> --help` shows one command's flags.",
    '',
  ].join('\n');
}
