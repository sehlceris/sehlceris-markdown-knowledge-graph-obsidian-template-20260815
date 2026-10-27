#!/usr/bin/env node
// The vault's maintenance commands: `node scripts/kg.ts <command> [args] [flags]`.
//
// Node ≥22.18 runs this TypeScript directly — no install, no build, no dependencies.
// commands/ holds the commands and their registry; lib/ holds the vault logic, which never
// prints or exits. This file is the only one that touches the process.

import { runCommand } from './cli.ts';
import { findCommand, usage } from './commands/index.ts';

const argv = process.argv.slice(2);
const found = findCommand(argv);

if (found) {
  const out = runCommand(found.command, found.rest);
  if (out.stdout) process.stdout.write(out.stdout);
  if (out.stderr) process.stderr.write(out.stderr);
  // exitCode rather than exit(): exit() can truncate a pipe that is still draining.
  process.exitCode = out.code;
} else if (!argv[0] || argv[0] === '-h' || argv[0] === '--help') {
  process.stdout.write(usage());
} else {
  process.stderr.write(`kg: unknown command "${argv[0]}"\n\n${usage()}`);
  process.exitCode = 2;
}
