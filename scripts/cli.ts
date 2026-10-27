// The command layer: argument parsing, the shape every command returns, and the one place
// that writes to stdout and stderr. Commands return results; lib/ never prints or exits.

import { resolve } from 'node:path';

export interface FlagSpec {
  type: 'boolean' | 'string';
  /** Single-letter alias, without the dash. */
  alias?: string;
  description: string;
}

export type ArgSpec = Record<string, FlagSpec>;

export interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string | boolean>;
}

/** Anything the user could fix by reading the usage line. Exit code 2. */
export class UsageError extends Error {
  override name = 'UsageError';
}

/** Every command takes these. --dry-run is meaningful only on a mutating one, but accepting
 *  it everywhere costs nothing. */
export const SHARED_FLAGS: ArgSpec = {
  base: { type: 'string', description: 'vault root (default: the vault this scripts/ folder is in)' },
  json: { type: 'boolean', description: 'machine-readable output on stdout' },
  'dry-run': { type: 'boolean', description: 'print the plan, touch nothing' },
  help: { type: 'boolean', alias: 'h', description: 'usage' },
};

/** The vault these scripts ship inside: scripts/ sits at its root. */
export const DEFAULT_VAULT = resolve(import.meta.dirname, '..');

export interface Context extends ParsedArgs {
  /** Absolute vault root: --base resolved against cwd, else DEFAULT_VAULT. */
  baseDir: string;
  cwd: string;
  dryRun: boolean;
}

export interface CommandResult {
  /** false: the check failed or the operation was refused — exit 1. */
  ok: boolean;
  /** Human-readable lines, no trailing newlines. */
  human: string[];
  /** The whole document printed under --json. */
  json: unknown;
}

export interface Command {
  /** "check", or "tag add" for a subcommand. */
  name: string;
  /** Positional part of the usage line, e.g. "<from> <to>". */
  args: string;
  summary: string;
  /** Command-specific flags, merged over SHARED_FLAGS. */
  flags?: ArgSpec;
  run(ctx: Context): CommandResult;
}

export function parseArgs(argv: string[], spec: ArgSpec): ParsedArgs {
  const byAlias = new Map(Object.entries(spec).flatMap(([name, s]) => (s.alias ? [[s.alias, name]] : [])));
  const positionals: string[] = [];
  const flags: ParsedArgs['flags'] = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    // Everything after "--" is positional, so a note named "--odd.md" stays reachable.
    if (arg === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (!arg.startsWith('-') || arg === '-') {
      positionals.push(arg);
      continue;
    }

    const eq = arg.indexOf('=');
    const token = eq >= 0 ? arg.slice(0, eq) : arg;
    const inline = eq >= 0 ? arg.slice(eq + 1) : null;
    const name = token.startsWith('--') ? token.slice(2) : (byAlias.get(token.slice(1)) ?? token.slice(1));
    const flag = spec[name];
    if (!flag) throw new UsageError(`unknown flag ${token}`);

    if (flag.type === 'boolean') {
      if (inline !== null) throw new UsageError(`${token} takes no value`);
      flags[name] = true;
      continue;
    }
    const value = inline ?? argv[++i];
    if (value === undefined) throw new UsageError(`${token} needs a value`);
    flags[name] = value;
  }
  return { positionals, flags };
}

export function commandUsage(cmd: Command): string {
  const spec = { ...SHARED_FLAGS, ...cmd.flags };
  const label = (name: string, s: FlagSpec) =>
    `--${name}${s.type === 'string' ? ' <value>' : ''}${s.alias ? `, -${s.alias}` : ''}`;
  const width = Math.max(...Object.entries(spec).map(([n, s]) => label(n, s).length));
  return [
    `usage: node scripts/kg.ts ${cmd.name} ${cmd.args ? `${cmd.args} ` : ''}[flags]`,
    '',
    cmd.summary,
    '',
    ...Object.entries(spec).map(([n, s]) => `  ${label(n, s).padEnd(width)}  ${s.description}`),
    '',
  ].join('\n');
}

export interface Output {
  stdout: string;
  stderr: string;
  /** 0 ok, 1 failed or refused, 2 bad usage. */
  code: number;
}

/** Runs one command over argv and returns what to print. Pure apart from what the command
 *  itself does to the vault, so tests call this rather than spawning a process. */
export function runCommand(cmd: Command, argv: string[], cwd = process.cwd()): Output {
  const usageError = (err: unknown): Output => ({
    stdout: '',
    stderr: `${cmd.name}: ${err instanceof Error ? err.message : String(err)}\n\n${commandUsage(cmd)}`,
    code: 2,
  });

  let args: ParsedArgs;
  try {
    args = parseArgs(argv, { ...SHARED_FLAGS, ...cmd.flags });
  } catch (err) {
    return usageError(err);
  }
  if (args.flags['help']) return { stdout: commandUsage(cmd), stderr: '', code: 0 };

  const base = args.flags['base'];
  const ctx: Context = {
    ...args,
    baseDir: typeof base === 'string' ? resolve(cwd, base) : DEFAULT_VAULT,
    cwd,
    dryRun: args.flags['dry-run'] === true,
  };

  let result: CommandResult;
  try {
    result = cmd.run(ctx);
  } catch (err) {
    if (err instanceof UsageError) return usageError(err);
    return { stdout: '', stderr: `${cmd.name}: ${err instanceof Error ? err.message : String(err)}\n`, code: 1 };
  }

  // With --json, stdout is only the document, so a pipe into jq gets a document.
  if (args.flags['json']) return { stdout: `${JSON.stringify(result.json, null, 2)}\n`, stderr: '', code: result.ok ? 0 : 1 };
  const text = result.human.length ? `${result.human.join('\n')}\n` : '';
  return result.ok ? { stdout: text, stderr: '', code: 0 } : { stdout: '', stderr: text, code: 1 };
}
