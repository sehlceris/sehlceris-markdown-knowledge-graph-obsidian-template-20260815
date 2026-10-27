// The command layer as a caller sees it: exit code, which stream the text went to, and that
// --json puts a document on stdout and nothing else. Most tests go through runCommand, which
// is everything kg.ts does short of writing to the process; a few spawn kg.ts for real,
// because Node still has to strip the types and resolve the .ts imports.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, it } from 'node:test';

import { DEFAULT_VAULT, type Output, parseArgs, runCommand, SHARED_FLAGS, UsageError } from '../cli.ts';
import { COMMANDS, findCommand } from '../commands/index.ts';
import { TAG_VOCABULARY_FILE, type TagVocabulary } from '../lib/vocabulary.ts';
import { makeVault, note, read } from './helpers.ts';

const SCRIPTS = resolve(import.meta.dirname, '..');

/** `kg <argv...>` without the process: the same lookup and the same runCommand. */
function kg(argv: string[], cwd = process.cwd()): Output {
  const found = findCommand(argv);
  assert.ok(found, `no command for ${argv.join(' ')}`);
  return runCommand(found.command, found.rest, cwd);
}

function spawnKg(...args: string[]) {
  const r = spawnSync(process.execPath, [join(SCRIPTS, 'kg.ts'), ...args], { encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

const fm = (body: string) => note(body, ['work']);

const CLEAN = {
  '06-knowledge/a.md': fm('Points at [[b]].'),
  '06-knowledge/b.md': fm('Points back at [[a]].'),
};

describe('parseArgs', () => {
  it('separates positionals from flags', () => {
    assert.deepEqual(parseArgs(['a.md', 'b.md', '--json'], SHARED_FLAGS), {
      positionals: ['a.md', 'b.md'],
      flags: { json: true },
    });
  });

  it("takes a string flag's value as the next token, or inline", () => {
    assert.equal(parseArgs(['--base', '/vault'], SHARED_FLAGS).flags['base'], '/vault');
    assert.equal(parseArgs(['--base=/vault'], SHARED_FLAGS).flags['base'], '/vault');
  });

  it('resolves an alias', () => {
    assert.equal(parseArgs(['-h'], SHARED_FLAGS).flags['help'], true);
  });

  it('treats everything after -- as positional', () => {
    assert.deepEqual(parseArgs(['--', '--json'], SHARED_FLAGS).positionals, ['--json']);
  });

  it('rejects an unknown flag, a string flag with no value, and a value on a boolean', () => {
    assert.throws(() => parseArgs(['--nope'], SHARED_FLAGS), UsageError);
    assert.throws(() => parseArgs(['--base'], SHARED_FLAGS), /needs a value/);
    assert.throws(() => parseArgs(['--json=yes'], SHARED_FLAGS), /takes no value/);
  });

  it('accepts an extra flag a command declares', () => {
    const spec = { ...SHARED_FLAGS, force: { type: 'boolean' as const, description: '' } };
    assert.equal(parseArgs(['--force'], spec).flags['force'], true);
  });
});

describe('findCommand', () => {
  it('matches a two-word subcommand before a one-word one, and passes the rest through', () => {
    assert.equal(findCommand(['tag', 'add', 'x'])?.command.name, 'tag add');
    assert.deepEqual(findCommand(['tag', 'add', 'x'])?.rest, ['x']);
    assert.equal(findCommand(['resolve', 'b'])?.command.name, 'resolve');
    assert.equal(findCommand(['tag', 'nope']), null);
    assert.equal(findCommand([]), null);
  });

  it('has no duplicate command names', () => {
    const names = COMMANDS.map((c) => c.name);
    assert.deepEqual(names, [...new Set(names)]);
  });
});

describe('runCommand — the contract every command shares', () => {
  it('sends a pass to stdout with exit 0 and a failure to stderr with exit 1', () => {
    const dir = makeVault(CLEAN);
    assert.deepEqual(kg(['resolve', 'b', '--base', dir]), {
      stdout: 'ok — [[b]] resolves to 06-knowledge/b.md\n',
      stderr: '',
      code: 0,
    });
    assert.deepEqual(kg(['resolve', 'gone', '--base', dir]), {
      stdout: '',
      stderr: '[[gone]] points at nothing\n',
      code: 1,
    });
  });

  it('prints only the JSON document under --json, pass or fail', () => {
    const dir = makeVault(CLEAN);
    const r = kg(['resolve', 'gone', '--base', dir, '--json']);
    assert.equal(r.code, 1);
    assert.equal(r.stderr, '');
    assert.deepEqual(JSON.parse(r.stdout), { target: 'gone', ok: false, matches: [] });
  });

  it('exits 2 with the usage on bad arguments and an unknown flag', () => {
    const missing = kg(['resolve']);
    assert.equal(missing.code, 2);
    assert.match(missing.stderr, /usage: node scripts\/kg\.ts resolve <target>/);

    const flag = kg(['resolve', 'b', '--nope']);
    assert.equal(flag.code, 2);
    assert.match(flag.stderr, /unknown flag --nope/);
  });

  it('answers --help on stdout with exit 0 and touches nothing', () => {
    const r = kg(['move', '--help']);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /usage: node scripts\/kg\.ts move <from> <to> \[flags\]/);
    assert.match(r.stdout, /--dry-run/);
  });

  it('reports a thrown error as exit 1 on stderr, prefixed with the command', () => {
    const r = kg(['check-links', '--base', '/nonexistent/vault/for/kg-tests']);
    assert.equal(r.code, 1);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /^check-links: /);
  });

  it('resolves a relative --base against cwd', () => {
    const dir = makeVault(CLEAN);
    const r = kg(['resolve', 'b', '--base', relative(join(dir, '..'), dir)], join(dir, '..'));
    assert.equal(r.code, 0);
  });

  it('defaults to the vault scripts/ sits in', () => {
    assert.equal(DEFAULT_VAULT, resolve(SCRIPTS, '..'));
  });

  it('runs the link commands on a vault with no vocabulary', () => {
    const dir = makeVault(CLEAN, { vocabulary: null });
    assert.equal(kg(['resolve', 'b', '--base', dir]).code, 0);
    assert.equal(kg(['check-links', '--base', dir]).code, 0);
    // ...while the check that needs it says why it cannot pass.
    const fmCheck = kg(['check-frontmatter', '--base', dir]);
    assert.equal(fmCheck.code, 1);
    assert.match(fmCheck.stderr, new RegExp(`${TAG_VOCABULARY_FILE}: .*missing`));
  });
});

describe('check-links', () => {
  it('prints the ok line on stdout and exits 0', () => {
    const r = kg(['check-links', '--base', makeVault(CLEAN)]);
    assert.equal(r.code, 0);
    assert.equal(r.stdout.trim(), 'ok — 2 notes, every link resolves');
    assert.equal(r.stderr, '');
  });

  it('exits 1 with the broken link on stderr', () => {
    const dir = makeVault({ ...CLEAN, '06-knowledge/c.md': fm('Points at [[gone]] from [[a]].') });
    const r = kg(['check-links', '--base', dir]);
    assert.equal(r.code, 1);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /06-knowledge\/c\.md: \[\[gone\]\] points at nothing/);
    assert.match(r.stderr, /1 broken and 0 ambiguous link\(s\) across 3 notes/);
  });

  it('lists orphans and still exits 0', () => {
    const r = kg(['check-links', '--base', makeVault({ ...CLEAN, '06-knowledge/lonely.md': fm('x') })]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /1 note\(s\) nothing links to, for review:/);
    assert.match(r.stdout, /^ {2}06-knowledge\/lonely\.md$/m);
    assert.match(r.stdout, /ok — 3 notes, every link resolves/);
  });

  it('puts only the JSON document on stdout under --json', () => {
    const r = kg(['check-links', '--base', makeVault(CLEAN), '--json']);
    assert.equal(r.code, 0);
    const doc = JSON.parse(r.stdout);
    assert.equal(doc.ok, true);
    assert.equal(doc.notes, 2);
    assert.deepEqual(doc.broken, []);
  });
});

describe('check-frontmatter and check', () => {
  it('passes a clean vault and fails a note with no block', () => {
    assert.equal(kg(['check-frontmatter', '--base', makeVault(CLEAN)]).stdout.trim(), 'ok — 2 notes, frontmatter clean');

    const r = kg(['check-frontmatter', '--base', makeVault({ '06-knowledge/a.md': 'no frontmatter here\n' })]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /06-knowledge\/a\.md: no frontmatter/);
  });

  it('check fails when either check fails, and reports both', () => {
    const dir = makeVault({ ...CLEAN, '06-knowledge/c.md': 'Points at [[a]] and [[gone]].\n' });
    const r = kg(['check', '--base', dir]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /FAIL — links:/);
    assert.match(r.stderr, /FAIL — frontmatter:/);
  });
});

describe('resolve, backlinks, links', () => {
  it('names both notes when a target is ambiguous', () => {
    const dir = makeVault({ '06-knowledge/note.md': fm('x'), '07-references/note.md': fm('x') });
    const r = kg(['resolve', 'note', '--base', dir]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /\[\[note\]\] matches 2 notes/);
    assert.match(r.stderr, /Lengthen it/);
  });

  it('names every linker and the link text that does it', () => {
    const dir = makeVault({ '06-knowledge/b.md': fm('x'), '06-knowledge/a.md': fm('Points at [[b|the other one]].') });
    const r = kg(['backlinks', 'b', '--base', dir]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /1 link\(s\) to 06-knowledge\/b\.md:/);
    assert.match(r.stdout, / {2}06-knowledge\/a\.md: \[\[b\|the other one\]\]/);
  });

  it('accepts a vault path as well as a bare target', () => {
    const r = kg(['backlinks', '06-knowledge/b.md', '--base', makeVault(CLEAN), '--json']);
    assert.equal(r.code, 0);
    assert.equal(JSON.parse(r.stdout).note, '06-knowledge/b.md');
  });

  it('says so plainly when nothing links to the note', () => {
    const r = kg(['backlinks', 'a', '--base', makeVault({ '06-knowledge/a.md': fm('x') })]);
    assert.equal(r.code, 0);
    assert.equal(r.stdout.trim(), 'nothing links to 06-knowledge/a.md');
  });

  it('refuses an ambiguous argument rather than picking one', () => {
    const dir = makeVault({ '06-knowledge/note.md': fm('x'), '07-references/note.md': fm('x') });
    const r = kg(['backlinks', 'note', '--base', dir]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /"note" matches 2 notes/);
  });

  it('marks each outgoing link resolved, broken or ambiguous, in document order', () => {
    const dir = makeVault({
      '06-knowledge/note.md': fm('x'),
      '07-references/note.md': fm('x'),
      '06-knowledge/a.md': fm('[[06-knowledge/note]], then [[gone]], then [[note]].'),
    });
    const r = kg(['links', 'a', '--base', dir]);
    assert.equal(r.code, 0);
    const lines = r.stdout.trimEnd().split('\n');
    assert.equal(lines[0], '06-knowledge/a.md links to 3 target(s):');
    assert.equal(lines[1], '  [[06-knowledge/note]] -> 06-knowledge/note.md');
    assert.equal(lines[2], '  [[gone]] -> broken, points at nothing');
    assert.match(lines[3]!, /^ {2}\[\[note\]\] -> ambiguous, matches/);
  });
});

describe('unlink-missing', () => {
  it('previews on --dry-run, then replaces the dead link and keeps the missing embed', () => {
    const before = fm('Points at [[gone|Gone]], [[a]] and ![[missing.png]].');
    const dir = makeVault({ ...CLEAN, '06-knowledge/c.md': before });

    const dry = kg(['unlink-missing', '--base', dir, '--dry-run']);
    assert.equal(dry.code, 0);
    assert.match(dry.stdout, /06-knowledge\/c\.md: \[\[gone\|Gone\]\] -> Gone/);
    assert.match(dry.stdout, /would unlink 1 link in 1 note/);
    assert.equal(read(dir, '06-knowledge/c.md'), before);

    const applied = kg(['unlink-missing', '--base', dir]);
    assert.equal(applied.code, 0);
    assert.match(applied.stdout, /unlinked 1 link in 1 note/);
    assert.equal(read(dir, '06-knowledge/c.md'), fm('Points at Gone, [[a]] and ![[missing.png]].'));
  });

  it('reports nothing to do on a clean vault', () => {
    const r = kg(['unlink-missing', '--base', makeVault(CLEAN), '--json']);
    assert.equal(r.code, 0);
    assert.deepEqual(JSON.parse(r.stdout).plan, { edits: [], embeds: [] });
  });
});

const initiative =
  '---\ncreated: 2026-05-03\nupdated: 2026-06-01\ntags:\n  - house-elm\nstatus: active\n---\n\n# Deck\n\nSee [[marco]].\n';

describe('archive and unarchive', () => {
  it('archives a directory and says what it did', () => {
    const dir = makeVault({
      '03-initiatives/house-elm/deck-rebuild.md': initiative,
      '05-entities/marco.md': 'Building [[deck-rebuild]].\n',
    });

    const r = kg(['archive', '--base', dir, '03-initiatives/house-elm']);

    assert.equal(r.stderr, '');
    assert.equal(r.code, 0);
    assert.match(r.stdout, /archived 03-initiatives\/house-elm -> 08-archive\/03-initiatives\/house-elm/);
    assert.match(r.stdout, /no links needed rewriting/);
    assert.match(r.stdout, /set status: done in/);
    assert.equal(read(dir, '05-entities/marco.md'), 'Building [[deck-rebuild]].\n');
    assert.match(read(dir, '08-archive/03-initiatives/house-elm/deck-rebuild.md'), /status: done/);
  });

  it('writes nothing under --dry-run', () => {
    const dir = makeVault({ '03-initiatives/deck-rebuild.md': initiative });

    const r = kg(['archive', '--base', dir, '--dry-run', '03-initiatives/deck-rebuild.md']);

    assert.equal(r.code, 0);
    assert.match(r.stdout, /dry run — nothing written/);
    assert.match(r.stdout, /would archive/);
    assert.equal(existsSync(join(dir, '03-initiatives/deck-rebuild.md')), true);
    assert.equal(existsSync(join(dir, '08-archive')), false);
  });

  it('leaves frontmatter alone under --no-frontmatter', () => {
    const dir = makeVault({ '03-initiatives/deck-rebuild.md': initiative });
    kg(['archive', '--base', dir, '--no-frontmatter', '03-initiatives/deck-rebuild.md']);
    assert.equal(read(dir, '08-archive/03-initiatives/deck-rebuild.md'), initiative);
  });

  it('refuses with exit 1 on stderr, and prints only JSON under --json', () => {
    const dir = makeVault({ '08-archive/03-initiatives/old.md': initiative });

    const refused = kg(['archive', '--base', dir, '08-archive/03-initiatives/old.md']);
    assert.equal(refused.code, 1);
    assert.equal(refused.stdout, '');
    assert.match(refused.stderr, /refused: already archived/);

    const json = kg(['archive', '--base', dir, '--json', '08-archive/03-initiatives/old.md']);
    assert.equal(json.code, 1);
    assert.deepEqual(JSON.parse(json.stdout)[0].conflicts, ['already archived: 08-archive/03-initiatives/old.md']);
  });

  it('exits 2 with usage on bad arguments', () => {
    const r = kg(['archive', '--base', '/nowhere']);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /expected at least one <path>/);
    assert.match(r.stderr, /usage: node scripts\/kg\.ts archive <path\.\.\.> \[flags\]/);
  });

  it('brings a note back to its live bucket', () => {
    const dir = makeVault({ '08-archive/03-initiatives/deck-rebuild.md': initiative });

    const r = kg(['unarchive', '--base', dir, '08-archive/03-initiatives/deck-rebuild.md']);

    assert.equal(r.code, 0);
    assert.match(r.stdout, /unarchived 08-archive\/03-initiatives\/deck-rebuild\.md -> 03-initiatives\/deck-rebuild\.md/);
    assert.equal(existsSync(join(dir, '03-initiatives/deck-rebuild.md')), true);
  });
});

describe('move and rename', () => {
  it('moves a note and reports that nothing needed rewriting', () => {
    const dir = makeVault({ '02-inbox/note.md': 'x\n', '05-entities/who.md': 'See [[note]].\n' });

    const r = kg(['move', '--base', dir, '02-inbox/note.md', '06-knowledge/note.md']);

    assert.equal(r.code, 0);
    assert.equal(r.stdout, 'moved 02-inbox/note.md -> 06-knowledge/note.md (no links needed rewriting)\n');
    assert.equal(read(dir, '05-entities/who.md'), 'See [[note]].\n');
  });

  it("takes paths relative to the caller's cwd", () => {
    const dir = makeVault({ '02-inbox/note.md': 'x\n' });

    const r = kg(['move', '--base', dir, 'note.md', 'moved.md'], join(dir, '02-inbox'));

    assert.equal(r.code, 0);
    assert.equal(existsSync(join(dir, '02-inbox/moved.md')), true);
  });

  it('refuses with exit 1 and writes nothing when the destination exists', () => {
    const dir = makeVault({ '06-knowledge/a.md': 'x\n', '07-references/a.md': 'y\n', '05-entities/who.md': 'See [[a]].\n' });

    const r = kg(['move', '--base', dir, '06-knowledge/a.md', '07-references/a.md']);

    assert.equal(r.code, 1);
    assert.match(r.stderr, /refused: destination already exists: 07-references\/a\.md/);
    assert.equal(read(dir, '06-knowledge/a.md'), 'x\n');
    assert.equal(read(dir, '07-references/a.md'), 'y\n');
  });

  it('writes nothing under --dry-run but lists the rewrites it would make', () => {
    const dir = makeVault({ '06-knowledge/old.md': 'x\n', '05-entities/who.md': 'See [[old]].\n' });

    const r = kg(['move', '--base', dir, '--dry-run', '06-knowledge/old.md', '06-knowledge/new.md']);

    assert.equal(r.code, 0);
    assert.match(r.stdout, /would move 06-knowledge\/old\.md -> 06-knowledge\/new\.md \(would rewrite 1 link in 1 note\)/);
    assert.match(r.stdout, / {2}05-entities\/who\.md: old -> new/);
    assert.equal(read(dir, '05-entities/who.md'), 'See [[old]].\n');
    assert.equal(existsSync(join(dir, '06-knowledge/new.md')), false);
  });

  it('renames in place and rewrites the inbound links', () => {
    const dir = makeVault({ '06-knowledge/old.md': 'x\n', '05-entities/who.md': 'See [[old|the old one]].\n' });

    const r = kg(['rename', '--base', dir, '06-knowledge/old.md', 'new']);

    assert.equal(r.code, 0);
    assert.match(r.stdout, /renamed 06-knowledge\/old\.md -> 06-knowledge\/new\.md \(rewrote 1 link in 1 note\)/);
    assert.equal(read(dir, '05-entities/who.md'), 'See [[new|the old one]].\n');
  });

  it('accepts the new name with its .md already on', () => {
    const dir = makeVault({ '06-knowledge/old.md': 'x\n' });
    assert.equal(kg(['rename', '--base', dir, '06-knowledge/old.md', 'new.md']).code, 0);
    assert.equal(existsSync(join(dir, '06-knowledge/new.md')), true);
  });

  it('keeps an attachment rename exactly as typed', () => {
    const dir = makeVault({ '06-knowledge/pic.png': 'png', '06-knowledge/a.md': '![[pic.png]]\n' });
    assert.equal(kg(['rename', '--base', dir, '06-knowledge/pic.png', 'photo.png']).code, 0);
    assert.equal(read(dir, '06-knowledge/a.md'), '![[photo.png]]\n');
  });

  it('refuses a name that would change directory', () => {
    const dir = makeVault({ '06-knowledge/old.md': 'x\n' });
    const r = kg(['rename', '--base', dir, '06-knowledge/old.md', '07-references/new']);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /use move to change directory/);
    assert.equal(existsSync(join(dir, '06-knowledge/old.md')), true);
  });
});

describe('tag list and tag add', () => {
  const fixture = (vocabulary: TagVocabulary | string | null) => makeVault({}, { vocabulary });
  const bytesOrAbsent = (dir: string): string | null =>
    existsSync(join(dir, TAG_VOCABULARY_FILE)) ? readFileSync(join(dir, TAG_VOCABULARY_FILE), 'utf8') : null;

  it('prints the domain and shape vocabulary in human and JSON forms', () => {
    const dir = fixture({ domainTags: ['cycling', 'work'], shapeTags: ['measurement'] });

    assert.deepEqual(kg(['tag', 'list', '--base', dir]), {
      stdout: 'domain tags:\n  cycling\n  work\nshape tags:\n  measurement\n',
      stderr: '',
      code: 0,
    });
    const json = kg(['tag', 'list', '--base', dir, '--json']);
    assert.equal(json.code, 0);
    assert.deepEqual(JSON.parse(json.stdout), { domainTags: ['cycling', 'work'], shapeTags: ['measurement'] });
  });

  it('diagnoses an uninitialized vocabulary instead of presenting an empty list', () => {
    const r = kg(['tag', 'list', '--base', fixture({ domainTags: [], shapeTags: [] })]);
    assert.equal(r.code, 1);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /domainTags is empty; run kg tag add <tag>/);
  });

  const cases: {
    name: string;
    vocabulary: TagVocabulary | null;
    tag: string;
    flags: string[];
    outcome: string;
    code: number;
  }[] = [
    { name: 'absent bootstrap', vocabulary: null, tag: 'gardening', flags: [], outcome: 'added', code: 0 },
    {
      name: 'domain-empty bootstrap',
      vocabulary: { domainTags: [], shapeTags: ['measurement'] },
      tag: 'gardening',
      flags: [],
      outcome: 'added',
      code: 0,
    },
    { name: 'ordinary addition', vocabulary: { domainTags: ['work'], shapeTags: [] }, tag: 'gardening', flags: [], outcome: 'added', code: 0 },
    { name: 'exact-existing no-op', vocabulary: { domainTags: ['work'], shapeTags: [] }, tag: 'work', flags: [], outcome: 'existing', code: 0 },
    { name: 'refused near duplicate', vocabulary: { domainTags: ['cycling'], shapeTags: [] }, tag: 'cyclng', flags: [], outcome: 'refused', code: 1 },
    {
      name: 'near-duplicate override',
      vocabulary: { domainTags: ['cycling'], shapeTags: [] },
      tag: 'cyclng',
      flags: ['--allow-near-duplicate'],
      outcome: 'added',
      code: 0,
    },
  ];

  for (const { name, vocabulary, tag, flags, outcome, code } of cases) {
    it(`makes dry-run and apply agree for ${name}, and dry-run preserves the bytes`, () => {
      const dryVault = fixture(vocabulary);
      const applyVault = fixture(vocabulary);
      const dryBefore = bytesOrAbsent(dryVault);
      const applyBefore = bytesOrAbsent(applyVault);

      const dry = kg(['tag', 'add', tag, '--base', dryVault, '--dry-run', '--json', ...flags]);
      const applied = kg(['tag', 'add', tag, '--base', applyVault, '--json', ...flags]);

      assert.equal(dry.code, code);
      assert.equal(applied.code, code);
      assert.deepEqual(JSON.parse(dry.stdout), JSON.parse(applied.stdout));
      const result = JSON.parse(applied.stdout);
      assert.equal(result.outcome, outcome);
      assert.equal(bytesOrAbsent(dryVault), dryBefore);
      assert.equal(
        bytesOrAbsent(applyVault),
        outcome === 'added' ? `${JSON.stringify(result.vocabulary, null, 2)}\n` : applyBefore
      );
    });
  }

  it('preserves malformed bytes and reports the parser diagnostic', () => {
    const malformed = '{"domainTags":["work"],"shapeTags":[';
    const dir = fixture(malformed);

    const r = kg(['tag', 'add', 'gardening', '--base', dir]);

    assert.equal(r.code, 1);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /malformed tag vocabulary: invalid JSON/);
    assert.equal(bytesOrAbsent(dir), malformed);
  });

  it('uses human output that distinguishes dry-run, added, existing, and refused results', () => {
    const dir = fixture({ domainTags: ['work'], shapeTags: [] });
    assert.equal(kg(['tag', 'add', 'gardening', '--base', dir, '--dry-run']).stdout, 'would register domain tag: gardening\ndry run — nothing written\n');
    assert.equal(kg(['tag', 'add', 'gardening', '--base', dir]).stdout, 'registered domain tag: gardening\n');
    assert.equal(kg(['tag', 'add', 'gardening', '--base', dir]).stdout, 'ok — domain tag already registered: gardening\n');

    const refusal = kg(['tag', 'add', 'cyclng', '--base', fixture({ domainTags: ['cycling'], shapeTags: [] })]);
    assert.equal(refusal.code, 1);
    assert.equal(refusal.stdout, '');
    assert.match(refusal.stderr, /refused: one edit away from cycling/);
  });

  it('rejects invalid spelling with 1 and a missing tag with 2', () => {
    const dir = fixture({ domainTags: ['work'], shapeTags: [] });
    assert.equal(kg(['tag', 'add', 'Not-A-Tag', '--base', dir]).code, 1);
    assert.equal(kg(['tag', 'add', '--base', dir]).code, 2);
    assert.equal(kg(['tag', 'add', 'a', 'b', '--base', dir]).code, 2);
  });
});

describe('kg.ts, spawned', () => {
  it('lists every command on stdout with no argument', () => {
    const r = spawnKg();
    assert.equal(r.code, 0);
    assert.match(r.stdout, /usage: node scripts\/kg\.ts <command>/);
    for (const c of COMMANDS) assert.ok(r.stdout.includes(c.name), c.name);
    assert.equal(spawnKg('--help').stdout, r.stdout);
  });

  it('forwards argv and the exit code to the command', () => {
    const dir = makeVault(CLEAN);
    const ok = spawnKg('resolve', 'b', '--base', dir);
    assert.equal(ok.code, 0);
    assert.equal(ok.stdout.trim(), 'ok — [[b]] resolves to 06-knowledge/b.md');
    assert.equal(spawnKg('resolve', 'gone', '--base', dir).code, 1);
    assert.equal(spawnKg('tag', 'list', '--base', dir).code, 0);
  });

  it('exits 2 on a command it does not have', () => {
    const r = spawnKg('frobnicate');
    assert.equal(r.code, 2);
    assert.match(r.stderr, /unknown command "frobnicate"/);
    assert.equal(spawnKg('tag', 'unknown').code, 2);
  });
});
